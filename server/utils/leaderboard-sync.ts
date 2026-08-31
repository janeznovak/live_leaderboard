import { fetchApprovedLeaderboardEntries } from '../../shared/approved-leaderboard-entries.mjs'
import { discardStagedLeaderboard, leaderboardRedisKey, leaderboardRevisionRedisKey, publishStagedLeaderboard, writeStagedLeaderboard } from '../../shared/redis-leaderboard-rebuild.mjs'
import { publishLeaderboardIfLeaseCurrent } from '../../shared/leaderboard-sync-fence.mjs'
import { database } from './database'
import { notifyPublicRankingChanged } from './public-ranking-events'
import { redis, stopRedis } from './redis'

const pollIntervalMs = 1_000
const lockDurationMs = 30_000
const shutdownDrainMs = 6_000
const maxErrorLength = 500
let acceptingRuns = true
let inFlightRun: Promise<void> | undefined
let wakeTimer: ReturnType<typeof setTimeout> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined

type ClaimedJob = {
  gameId: string
  targetRevision: string
  attemptCount: number
  lockToken: string
}

export function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Redis synchronization failed'
  // Redis and PostgreSQL URLs can contain passwords. Persist only a bounded,
  // connection-string-free diagnostic for operators.
  return message
    .replace(/(?:rediss?|postgres(?:ql)?):\/\/[^\s@]+@[^\s]+/gi, '[connection string redacted]')
    .replace(/\b(password|secret|token)=[^\s,&]+/gi, '$1=[redacted]')
    .slice(0, maxErrorLength)
}

function retryDelayMs(attemptCount: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attemptCount, 6))
}

async function claimJob(): Promise<ClaimedJob | undefined> {
  const result = await database().query<{
    game_id: string
    target_revision: string
    attempt_count: number
    lock_token: string
  }>(
    `WITH candidates AS (
       SELECT game_id
       FROM leaderboard_sync_jobs
       WHERE next_attempt_at <= now()
         AND (locked_until IS NULL OR locked_until < now())
       ORDER BY next_attempt_at, game_id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE leaderboard_sync_jobs AS jobs
     SET locked_until = now() + ($1::text || ' milliseconds')::interval,
         lock_token = gen_random_uuid(),
         attempt_count = jobs.attempt_count + 1,
         updated_at = now()
     FROM candidates
     WHERE jobs.game_id = candidates.game_id
     RETURNING jobs.game_id, jobs.target_revision::text, jobs.attempt_count, jobs.lock_token::text`,
    [lockDurationMs],
  )
  const row = result.rows[0]
  return row && {
    gameId: row.game_id,
    targetRevision: row.target_revision,
    attemptCount: row.attempt_count,
    lockToken: row.lock_token,
  }
}

async function recordFailure(job: ClaimedJob, error: unknown) {
  await database().query(
    `UPDATE leaderboard_sync_jobs
     SET locked_until = NULL,
         lock_token = NULL,
         next_attempt_at = now() + ($3::text || ' milliseconds')::interval,
         last_error = $4,
         updated_at = now()
     WHERE game_id = $1 AND lock_token = $2::uuid`,
    [job.gameId, job.lockToken, retryDelayMs(job.attemptCount), safeErrorMessage(error)],
  )
}

async function processJob(job: ClaimedJob) {
  const client = await database().connect()
  const cache = redis()
  const liveKey = leaderboardRedisKey(job.gameId)
  const revisionKey = leaderboardRevisionRedisKey(job.gameId)
  const stagingKey = `${liveKey}:staging:${job.lockToken}`
  try {
    // This session-level lock covers the authoritative SELECT through the Redis
    // swap and conditional ACK. It serializes a CLI rebuild with all workers for
    // the same game, so an old snapshot cannot overwrite a newer completed job.
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [job.gameId])
    try {
      const entries = await fetchApprovedLeaderboardEntries(client, job.gameId)
      await writeStagedLeaderboard(cache, stagingKey, entries)
      // The short fence transaction commits after locking state/job ownership and
      // renewing the lease, before this reader-visible Redis publish. Expired or
      // stolen workers therefore cannot publish their older snapshot.
      const published = await publishLeaderboardIfLeaseCurrent({
        database: client,
        gameId: job.gameId,
        targetRevision: job.targetRevision,
        lockToken: job.lockToken,
        leaseMs: lockDurationMs,
        publish: () => publishStagedLeaderboard(cache, stagingKey, liveKey, revisionKey, job.targetRevision),
      })
      if (published) notifyPublicRankingChanged(job.gameId, 'leaderboard')
      else {
        await discardStagedLeaderboard(cache, stagingKey)
        await client.query(
          `UPDATE leaderboard_sync_jobs
           SET locked_until = NULL, lock_token = NULL, next_attempt_at = now(), updated_at = now()
           WHERE game_id = $1 AND lock_token = $2::uuid`,
          [job.gameId, job.lockToken],
        )
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [job.gameId])
    }
  } catch (error) {
    await discardStagedLeaderboard(cache, stagingKey)
    try {
      await recordFailure(job, error)
    } catch (recordError) {
      console.error('Unable to record leaderboard synchronization failure', safeErrorMessage(recordError))
    }
    console.warn('Leaderboard synchronization will be retried', { gameId: job.gameId, error: safeErrorMessage(error) })
  } finally {
    client.release()
  }
}

export function runLeaderboardSyncOnce() {
  if (!acceptingRuns || inFlightRun) return inFlightRun ?? Promise.resolve()
  inFlightRun = (async () => {
    try {
      const job = await claimJob()
      if (job) await processJob(job)
    } catch (error) {
      console.error('Unable to claim leaderboard synchronization work', safeErrorMessage(error))
    } finally {
      inFlightRun = undefined
    }
  })()
  return inFlightRun
}

export function wakeLeaderboardSyncWorker() {
  if (!acceptingRuns || wakeTimer) return
  wakeTimer = setTimeout(() => {
    wakeTimer = undefined
    void runLeaderboardSyncOnce()
  }, 0)
}

export function startLeaderboardSyncWorker() {
  acceptingRuns = true
  if (pollTimer) return async () => undefined
  pollTimer = setInterval(() => { void runLeaderboardSyncOnce() }, pollIntervalMs)
  wakeLeaderboardSyncWorker()
  return async () => {
    acceptingRuns = false
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
    if (wakeTimer) clearTimeout(wakeTimer)
    wakeTimer = undefined
    const activeRun = inFlightRun
    if (!activeRun) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    const drained = await Promise.race([
      activeRun.then(() => true, (error) => {
        console.error('Leaderboard synchronization worker stopped with an error', safeErrorMessage(error))
        return true
      }),
      new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), shutdownDrainMs) }),
    ])
    if (timeout) clearTimeout(timeout)
    if (!drained) {
      // Abort any half-open Redis command so the current pass can unwind. Its
      // durable job was not ACKed and remains recoverable after restart.
      stopRedis()
      console.warn('Leaderboard synchronization worker shutdown timed out; durable work remains queued')
    }
    else stopRedis()
  }
}
