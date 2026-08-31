import { randomUUID } from 'node:crypto'
import pg from 'pg'
import Redis from 'ioredis'
import { fetchApprovedLeaderboardEntries } from '../shared/approved-leaderboard-entries.mjs'
import { discardStagedLeaderboard, leaderboardRedisKey, leaderboardRevisionRedisKey, publishStagedLeaderboard, writeStagedLeaderboard } from '../shared/redis-leaderboard-rebuild.mjs'
import { enqueueLeaderboardSynchronization } from '../shared/leaderboard-sync-queue.mjs'

const redisTimeoutMs = 5_000

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--game' || args[1].length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args[1])) {
  throw new Error('Usage: npm run leaderboard:rebuild -- --game <game-slug>')
}
const gameSlug = args[1]
const databaseUrl = process.env.DATABASE_URL
const redisUrl = process.env.REDIS_URL
if (!databaseUrl || !redisUrl) throw new Error('DATABASE_URL and REDIS_URL are required')

const database = new pg.Client({ connectionString: databaseUrl })
const cache = new Redis(redisUrl, { connectTimeout: redisTimeoutMs, commandTimeout: redisTimeoutMs, maxRetriesPerRequest: 1, retryStrategy: (attempt) => Math.min(1_000, attempt * 100) })
cache.on('error', () => undefined)
await database.connect()

try {
  const game = await database.query('SELECT id::text FROM games WHERE slug = $1', [gameSlug])
  if (!game.rowCount) throw new Error(`No game exists with slug "${gameSlug}"`)
  const gameId = game.rows[0].id

  await database.query('BEGIN')
  let revision
  try {
    revision = await enqueueLeaderboardSynchronization(database, gameId)
    await database.query('COMMIT')
  } catch (error) {
    await database.query('ROLLBACK')
    throw error
  }

  // Use the same per-game lock as the application worker from the authoritative
  // read through the swap and ACK. Without it, a slow CLI snapshot could replace
  // a newer worker rebuild after that newer job had already been acknowledged.
  await database.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [gameId])
  try {
    const entries = await fetchApprovedLeaderboardEntries(database, gameId)
    const key = leaderboardRedisKey(gameId)
    const revisionKey = leaderboardRevisionRedisKey(gameId)
    const stagingKey = `${key}:operator:${randomUUID()}`
    try {
      await writeStagedLeaderboard(cache, stagingKey, entries)
      const accepted = await publishStagedLeaderboard(cache, stagingKey, key, revisionKey, revision)
      if (!accepted) {
        await discardStagedLeaderboard(cache, stagingKey)
        console.log(`A newer Redis leaderboard revision is already published for ${gameSlug}; durable synchronization work remains queued.`)
        process.exitCode = 2
      } else {
        await database.query('BEGIN')
        try {
          const acknowledged = await database.query(
            `UPDATE leaderboard_sync_states
             SET synced_revision = revision, redis_synced_at = now(), updated_at = now()
             WHERE game_id = $1 AND revision = $2::bigint
             RETURNING game_id`,
            [gameId, revision],
          )
          if (acknowledged.rowCount) {
            // The state-row lock prevents a concurrent approval from enqueuing newer
            // work until this delete commits. Its subsequent upsert recreates the job.
            await database.query(
              `DELETE FROM leaderboard_sync_jobs
               WHERE game_id = $1 AND target_revision <= $2::bigint AND locked_until IS NULL`,
              [gameId, revision],
            )
          }
          await database.query('COMMIT')
          if (acknowledged.rowCount) console.log(`Rebuilt Redis leaderboard for ${gameSlug} (${entries.length} members).`)
          else console.log(`A newer approval arrived while rebuilding ${gameSlug}; its durable synchronization work remains queued.`)
        } catch (error) {
          await database.query('ROLLBACK')
          throw error
        }
      }
    } catch (error) {
      await discardStagedLeaderboard(cache, stagingKey)
      throw error
    }
  } finally {
    await database.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [gameId])
  }
} finally {
  await Promise.allSettled([database.end(), cache.quit()])
}
