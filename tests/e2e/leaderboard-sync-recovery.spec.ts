import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import Redis from 'ioredis'
import { Client } from 'pg'
import { safeErrorMessage } from '../../server/utils/leaderboard-sync'
import { leaderboardRedisKey, leaderboardRevisionRedisKey, publishStagedLeaderboard, writeStagedLeaderboard } from '../../shared/redis-leaderboard-rebuild.mjs'
import { acknowledgePublishedLeaderboard, publishLeaderboardIfLeaseCurrent } from '../../shared/leaderboard-sync-fence.mjs'

const execFile = promisify(execFileCallback)
const adminEmail = 'admin@example.test'
const adminPassword = 'e2e-admin-password'
const emailPattern = 'sync-recovery-%'

function suffix() {
  return `${Date.now()}${Math.floor(Math.random() * 100_000)}`
}

async function databaseClient() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  return client
}

async function redisClient() {
  const client = new Redis(process.env.REDIS_URL!)
  await client.ping()
  return client
}

async function setRedisProxyEnabled(enabled: boolean) {
  const response = await fetch(`${process.env.TOXIPROXY_URL}/proxies/redis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!response.ok) throw new Error(`Unable to ${enabled ? 'enable' : 'disable'} Redis proxy: ${response.status}`)
}

test.afterEach(async () => {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) return
  if (process.env.TOXIPROXY_URL) await setRedisProxyEnabled(true)
  const database = await databaseClient()
  try {
    const entries = await database.query<{ game_id: string; user_id: string }>(
      `SELECT score_submissions.game_id, score_submissions.user_id
       FROM score_submissions JOIN users ON users.id = score_submissions.user_id
       WHERE users.email LIKE $1`,
      [emailPattern],
    )
    const cache = await redisClient()
    try {
      await Promise.all(entries.rows.map((entry) => cache.zrem(`leaderboard:${entry.game_id}`, entry.user_id)))
    } finally {
      await cache.quit()
    }
    await database.query('DELETE FROM score_submissions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [emailPattern])
    await database.query('DELETE FROM users WHERE email LIKE $1', [emailPattern])
  } finally {
    await database.end()
  }
})

test('synchronization diagnostics redact secrets and remain bounded', () => {
  const message = safeErrorMessage(new Error(`redis://worker:redis-secret@cache.test:6379 password=hunter2 ${'attacker-controlled '.repeat(100)}`))
  expect(message).not.toContain('redis-secret')
  expect(message).not.toContain('hunter2')
  expect(message).toContain('[connection string redacted]')
  expect(message.length).toBeLessThanOrEqual(500)
})

test('a stolen or expired lease cannot publish its staged leaderboard snapshot', async () => {
  test.skip(!process.env.DATABASE_URL || !process.env.REDIS_URL, 'requires PostgreSQL and Redis')
  const id = suffix()
  const database = await databaseClient()
  const cache = await redisClient()
  const gameId = randomUUID()
  const staleToken = randomUUID()
  const replacementToken = randomUUID()
  const liveKey = leaderboardRedisKey(gameId)
  const revisionKey = leaderboardRevisionRedisKey(gameId)
  const stagingKey = `${liveKey}:staging:${staleToken}`
  try {
    await database.query('INSERT INTO games (id, name, slug) VALUES ($1, $2, $3)', [gameId, `Lease fence ${id}`, `lease-fence-${id}`])
    await database.query('INSERT INTO leaderboard_sync_states (game_id, revision, synced_revision) VALUES ($1, 1, 0)', [gameId])
    await database.query(
      `INSERT INTO leaderboard_sync_jobs (game_id, target_revision, lock_token, locked_until)
       VALUES ($1, 1, $2::uuid, now() - interval '1 second')`,
      [gameId, staleToken],
    )
    await writeStagedLeaderboard(cache, stagingKey, [{ user_id: 'stale-member', score: '100' }])
    await cache.zadd(liveKey, 999, 'newer-member')
    // A second worker has claimed the expired lease before the old worker can
    // reach its publish fence.
    await database.query(
      `UPDATE leaderboard_sync_jobs
       SET lock_token = $2::uuid, locked_until = now() + interval '30 seconds'
       WHERE game_id = $1`,
      [gameId, replacementToken],
    )

    const published = await publishLeaderboardIfLeaseCurrent({
      database,
      gameId,
      targetRevision: '1',
      lockToken: staleToken,
      leaseMs: 30_000,
      publish: () => publishStagedLeaderboard(cache, stagingKey, liveKey, revisionKey, '1'),
    })
    expect(published).toBe(false)
    expect(await cache.zrange(liveKey, 0, -1, 'WITHSCORES')).toEqual(['newer-member', '999'])
    const job = await database.query<{ lock_token: string; target_revision: string }>(
      'SELECT lock_token::text, target_revision::text FROM leaderboard_sync_jobs WHERE game_id = $1', [gameId],
    )
    expect(job.rows[0]).toEqual({ lock_token: replacementToken, target_revision: '1' })
  } finally {
    await cache.del(stagingKey, liveKey, revisionKey)
    await database.query('DELETE FROM games WHERE id = $1', [gameId])
    await cache.quit()
    await database.end()
  }
})

test('the Redis revision fence rejects a delayed older publish and preserves an empty replacement', async () => {
  test.skip(!process.env.DATABASE_URL || !process.env.REDIS_URL, 'requires PostgreSQL and Redis')
  const id = suffix()
  const database = await databaseClient()
  const cache = await redisClient()
  const gameId = randomUUID()
  const emptyGameId = randomUUID()
  const lockToken = randomUUID()
  const emptyLockToken = randomUUID()
  const liveKey = leaderboardRedisKey(gameId)
  const revisionKey = leaderboardRevisionRedisKey(gameId)
  const newerStagingKey = `${liveKey}:staging:newer`
  const olderStagingKey = `${liveKey}:staging:older`
  const emptyLiveKey = leaderboardRedisKey(emptyGameId)
  const emptyRevisionKey = leaderboardRevisionRedisKey(emptyGameId)
  const emptyStagingKey = `${emptyLiveKey}:staging:empty`
  let releaseOlderPublish: (() => void) | undefined
  try {
    await database.query(
      'INSERT INTO games (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)',
      [gameId, `Revision fence ${id}`, `revision-fence-${id}`, emptyGameId, `Empty revision fence ${id}`, `empty-revision-fence-${id}`],
    )
    await database.query(
      `INSERT INTO leaderboard_sync_states (game_id, revision, synced_revision)
       VALUES ($1, 2, 1), ($2, 1, 0)`,
      [gameId, emptyGameId],
    )
    await database.query(
      `INSERT INTO leaderboard_sync_jobs (game_id, target_revision, lock_token, locked_until)
       VALUES ($1, 2, $2::uuid, now() + interval '30 seconds'),
              ($3, 1, $4::uuid, now() + interval '30 seconds')`,
      [gameId, lockToken, emptyGameId, emptyLockToken],
    )

    await writeStagedLeaderboard(cache, olderStagingKey, [{ user_id: 'older-member', score: '100' }])
    let olderPublishStarted!: () => void
    const olderStarted = new Promise<void>((resolve) => { olderPublishStarted = resolve })
    const olderGate = new Promise<void>((resolve) => { releaseOlderPublish = resolve })
    // Start an old publisher, but hold it before the Lua command as a
    // deterministic model of a command delayed by a broken connection.
    const delayedOlderPublish = (async () => {
      olderPublishStarted()
      await olderGate
      return publishStagedLeaderboard(cache, olderStagingKey, liveKey, revisionKey, '1')
    })()
    await olderStarted

    await writeStagedLeaderboard(cache, newerStagingKey, [{ user_id: 'newer-member', score: '900' }])
    expect(await publishStagedLeaderboard(cache, newerStagingKey, liveKey, revisionKey, '2')).toBe(true)
    expect(await acknowledgePublishedLeaderboard(database, { gameId, targetRevision: '2', lockToken })).toBe(true)

    // Release the delayed old command only after the newer revision is durable.
    releaseOlderPublish!()
    expect(await delayedOlderPublish).toBe(false)
    expect(await cache.zrange(liveKey, 0, -1, 'WITHSCORES')).toEqual(['newer-member', '900'])
    expect(await cache.get(revisionKey)).toBe('2')
    const state = await database.query<{ revision: string; synced_revision: string }>(
      'SELECT revision::text, synced_revision::text FROM leaderboard_sync_states WHERE game_id = $1', [gameId],
    )
    expect(state.rows[0]).toEqual({ revision: '2', synced_revision: '2' })
    expect((await database.query('SELECT 1 FROM leaderboard_sync_jobs WHERE game_id = $1', [gameId])).rowCount).toBe(0)

    await cache.zadd(emptyLiveKey, 777, 'stale-member')
    // No staging key deliberately represents the authoritative empty set.
    expect(await publishStagedLeaderboard(cache, emptyStagingKey, emptyLiveKey, emptyRevisionKey, '1')).toBe(true)
    expect(await acknowledgePublishedLeaderboard(database, { gameId: emptyGameId, targetRevision: '1', lockToken: emptyLockToken })).toBe(true)
    expect(await cache.exists(emptyLiveKey)).toBe(0)
    expect(await cache.get(emptyRevisionKey)).toBe('1')
    expect(await cache.pttl(emptyRevisionKey)).toBe(-1)
  } finally {
    releaseOlderPublish?.()
    await cache.del(newerStagingKey, olderStagingKey, liveKey, revisionKey, emptyStagingKey, emptyLiveKey, emptyRevisionKey)
    await database.query('DELETE FROM games WHERE id = ANY($1::uuid[])', [[gameId, emptyGameId]])
    await cache.quit()
    await database.end()
  }
})

test('ownership fencing commits before a delayed Redis publish can block an approval-side state update', async () => {
  test.skip(!process.env.DATABASE_URL, 'requires PostgreSQL')
  const id = suffix()
  const database = await databaseClient()
  const concurrent = await databaseClient()
  const gameId = randomUUID()
  const lockToken = randomUUID()
  let releasePublish: (() => void) | undefined
  try {
    await database.query('INSERT INTO games (id, name, slug) VALUES ($1, $2, $3)', [gameId, `Publish fence ${id}`, `publish-fence-${id}`])
    await database.query('INSERT INTO leaderboard_sync_states (game_id, revision, synced_revision) VALUES ($1, 1, 0)', [gameId])
    await database.query(
      `INSERT INTO leaderboard_sync_jobs (game_id, target_revision, lock_token, locked_until)
       VALUES ($1, 1, $2::uuid, now() + interval '30 seconds')`,
      [gameId, lockToken],
    )
    let publishStarted!: () => void
    const started = new Promise<void>((resolve) => { publishStarted = resolve })
    const delayedPublish = new Promise<void>((resolve) => { releasePublish = resolve })
    const publishing = publishLeaderboardIfLeaseCurrent({
      database,
      gameId,
      targetRevision: '1',
      lockToken,
      leaseMs: 30_000,
      publish: async () => {
        publishStarted()
        await delayedPublish
        return true
      },
    })
    await started
    // This models the approval transaction's state-row update. It must complete
    // while the fake Redis command remains deliberately unresolved.
    const updated = await Promise.race([
      concurrent.query('UPDATE leaderboard_sync_states SET revision = revision + 1 WHERE game_id = $1', [gameId]).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ])
    expect(updated).toBe(true)
    releasePublish!()
    expect(await publishing).toBe(false)
    const job = await database.query('SELECT target_revision::text FROM leaderboard_sync_jobs WHERE game_id = $1', [gameId])
    expect(job.rows[0]).toMatchObject({ target_revision: '1' })
  } finally {
    releasePublish?.()
    await database.query('DELETE FROM games WHERE id = $1', [gameId])
    await concurrent.end()
    await database.end()
  }
})

test('approval is durable during a Redis outage and the app retries its authoritative leaderboard rebuild', async ({ browser }) => {
  test.skip(!process.env.TOXIPROXY_URL || !process.env.DATABASE_URL || !process.env.REDIS_URL, 'requires the Compose-local Redis proxy')
  const id = suffix()
  const email = `sync-recovery-outage-${id}@example.test`
  const username = `syncoutage${id}`
  const player = await browser.newContext({ baseURL: process.env.BASE_URL })
  const playerPage = await player.newPage()
  await playerPage.goto('/register')
  await playerPage.getByLabel('Email').fill(email)
  await playerPage.getByLabel('Password').fill('a-safe-test-password')
  await playerPage.getByLabel('Game username').fill(username)
  await playerPage.getByRole('button', { name: 'Create account' }).click()
  await expect(playerPage.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  const pending = await playerPage.evaluate(async () => {
    const game = await fetch('/api/games').then((response) => response.json()).then((body) => body.find((entry: { slug: string }) => entry.slug === 'sky-sprint'))
    await fetch(`/api/games/${game.slug}/scores`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ score: 4321 }),
    })
    return fetch('/api/scores').then((response) => response.json()).then((body) => body.submissions.find((entry: { status: string }) => entry.status === 'pending'))
  })
  expect(pending).toMatchObject({ status: 'pending', score: 4321 })

  const secondPlayer = await browser.newContext({ baseURL: process.env.BASE_URL })
  const secondPlayerPage = await secondPlayer.newPage()
  await secondPlayerPage.goto('/register')
  await secondPlayerPage.getByLabel('Email').fill(`sync-recovery-outage-second-${id}@example.test`)
  await secondPlayerPage.getByLabel('Password').fill('a-safe-test-password')
  await secondPlayerPage.getByLabel('Game username').fill(`syncoutagetwo${id}`)
  await secondPlayerPage.getByRole('button', { name: 'Create account' }).click()
  await expect(secondPlayerPage.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  const secondPending = await secondPlayerPage.evaluate(async () => {
    await fetch('/api/games/sky-sprint/scores', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ score: 5432 }),
    })
    return fetch('/api/scores').then((response) => response.json()).then((body) => body.submissions.find((entry: { status: string }) => entry.status === 'pending'))
  })
  expect(secondPending).toMatchObject({ status: 'pending', score: 5432 })

  await setRedisProxyEnabled(false)
  const admin = await browser.newContext({ baseURL: process.env.BASE_URL })
  const adminPage = await admin.newPage()
  await adminPage.goto('/login')
  await adminPage.getByLabel('Email').fill(adminEmail)
  await adminPage.getByLabel('Password').fill(adminPassword)
  await adminPage.getByRole('button', { name: 'Log in' }).click()
  await expect(adminPage.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  const approval = await adminPage.evaluate(async (submissionId) => {
    const response = await fetch(`/api/admin/scores/${submissionId}/approve`, { method: 'POST' })
    return { status: response.status, body: await response.json() }
  }, pending.id)
  expect(approval.status).toBe(200)
  const secondApproval = await adminPage.evaluate(async (submissionId) => {
    const response = await fetch(`/api/admin/scores/${submissionId}/approve`, { method: 'POST' })
    return response.status
  }, secondPending.id)
  expect(secondApproval).toBe(200)

  const database = await databaseClient()
  try {
    await expect.poll(async () => {
      const result = await database.query(
        `SELECT score_submissions.status, leaderboard_sync_jobs.attempt_count, leaderboard_sync_jobs.last_error,
                (SELECT count(*)::int FROM leaderboard_sync_jobs WHERE game_id = score_submissions.game_id) AS job_count
         FROM score_submissions
         JOIN leaderboard_sync_jobs ON leaderboard_sync_jobs.game_id = score_submissions.game_id
         WHERE score_submissions.id = $1`,
        [pending.id],
      )
      return result.rows[0]
    }).toMatchObject({ status: 'approved', attempt_count: expect.any(Number), last_error: expect.any(String), job_count: 1 })
  } finally {
    await database.end()
  }
  await setRedisProxyEnabled(true)
  const cache = await redisClient()
  try {
    const lookup = await databaseClient()
    const gameAndUser = await lookup.query<{ game_id: string; user_id: string; score: string }>(
      `SELECT score_submissions.game_id, score_submissions.user_id, score_submissions.score::text
       FROM score_submissions WHERE id = ANY($1::uuid[])`, [[pending.id, secondPending.id]],
    )
    await lookup.end()
    // The direct Redis client is only test observation; the application reached
    // Redis exclusively through Toxiproxy above.
    for (const entry of gameAndUser.rows) {
      await expect.poll(() => cache.zscore(`leaderboard:${entry.game_id}`, entry.user_id)).toBe(entry.score)
    }
  } finally {
    await cache.quit()
  }
  await Promise.all([player.close(), secondPlayer.close(), admin.close()])
})

test('the operator rebuild command reconstructs exact best scores, removes stale members, handles empty games, and is idempotent', async () => {
  test.skip(!process.env.DATABASE_URL || !process.env.REDIS_URL, 'requires PostgreSQL and Redis')
  const id = suffix()
  const database = await databaseClient()
  const cache = await redisClient()
  try {
    const games = await database.query<{ id: string; slug: string }>("SELECT id::text, slug FROM games WHERE slug IN ('sky-sprint', 'orbital-dodger')")
    const sky = games.rows.find((game) => game.slug === 'sky-sprint')!
    const orbital = games.rows.find((game) => game.slug === 'orbital-dodger')!
    const first = await database.query<{ id: string }>(
      `INSERT INTO users (email, game_username, password_hash) VALUES ($1, $2, 'test') RETURNING id::text`,
      [`sync-recovery-first-${id}@example.test`, `syncfirst${id}`],
    )
    const second = await database.query<{ id: string }>(
      `INSERT INTO users (email, game_username, password_hash) VALUES ($1, $2, 'test') RETURNING id::text`,
      [`sync-recovery-second-${id}@example.test`, `syncsecond${id}`],
    )
    await database.query(
      `INSERT INTO score_submissions (game_id, user_id, score, status)
       VALUES ($1, $2, 100, 'approved'), ($1, $2, 900, 'approved'), ($1, $3, 500, 'approved')`,
      [sky.id, first.rows[0]!.id, second.rows[0]!.id],
    )
    await cache.zadd(`leaderboard:${sky.id}`, 9999, '00000000-0000-0000-0000-000000000000')
    await cache.zadd(`leaderboard:${orbital.id}`, 7777, '00000000-0000-0000-0000-000000000000')

    await execFile('node', ['scripts/rebuild-leaderboard.mjs', '--game', 'sky-sprint'], { env: process.env })
    await execFile('node', ['scripts/rebuild-leaderboard.mjs', '--game', 'sky-sprint'], { env: process.env })
    const expected = await database.query<{ user_id: string; score: string }>(
      `SELECT user_id::text, max(score)::text AS score
       FROM score_submissions WHERE game_id = $1 AND status = 'approved'
       GROUP BY user_id`, [sky.id],
    )
    const rebuilt = await cache.zrange(`leaderboard:${sky.id}`, 0, -1, 'WITHSCORES')
    const rebuiltScores = new Map(Array.from({ length: rebuilt.length / 2 }, (_, index) => [rebuilt[index * 2]!, rebuilt[index * 2 + 1]!]))
    expect([...rebuiltScores.entries()].sort()).toEqual(expected.rows.map((entry) => [entry.user_id, entry.score]).sort())
    expect(rebuiltScores.has('00000000-0000-0000-0000-000000000000')).toBe(false)
    const skyState = await database.query<{ revision: string; synced_revision: string }>(
      'SELECT revision::text, synced_revision::text FROM leaderboard_sync_states WHERE game_id = $1', [sky.id],
    )
    expect(await cache.get(leaderboardRevisionRedisKey(sky.id))).toBe(skyState.rows[0]!.revision)
    expect(skyState.rows[0]!.synced_revision).toBe(skyState.rows[0]!.revision)

    await execFile('node', ['scripts/rebuild-leaderboard.mjs', '--game', 'orbital-dodger'], { env: process.env })
    expect(await cache.exists(`leaderboard:${orbital.id}`)).toBe(0)
    const orbitalState = await database.query<{ revision: string; synced_revision: string }>(
      'SELECT revision::text, synced_revision::text FROM leaderboard_sync_states WHERE game_id = $1', [orbital.id],
    )
    expect(await cache.get(leaderboardRevisionRedisKey(orbital.id))).toBe(orbitalState.rows[0]!.revision)
    expect(await cache.pttl(leaderboardRevisionRedisKey(orbital.id))).toBe(-1)
    expect(orbitalState.rows[0]!.synced_revision).toBe(orbitalState.rows[0]!.revision)
    const invalidOutput = await execFile('node', ['scripts/rebuild-leaderboard.mjs', '--game', '../not-a-game'], { env: process.env })
      .then(() => '')
      .catch((error: { stderr?: unknown; message?: unknown }) => `${String(error.stderr ?? '')}${String(error.message ?? '')}`)
    expect(invalidOutput).toContain('Usage:')
  } finally {
    await cache.quit()
    await database.end()
  }
})
