export function leaderboardRedisKey(gameId) {
  return `leaderboard:${gameId}`
}

export function leaderboardRevisionRedisKey(gameId) {
  return `${leaderboardRedisKey(gameId)}:revision`
}

export async function writeStagedLeaderboard(cache, stagingKey, entries) {
  await cache.del(stagingKey)
  for (let index = 0; index < entries.length; index += 500) {
    const values = entries.slice(index, index + 500).flatMap((entry) => [entry.score, entry.user_id])
    if (values.length) {
      // The TTL is part of the same Redis command as the write, so a process
      // death cannot leave an unbounded staging key behind.
      await cache.eval(
        "redis.call('ZADD', KEYS[1], unpack(ARGV)); return redis.call('PEXPIRE', KEYS[1], 60000)",
        1,
        stagingKey,
        ...values,
      )
    }
  }
}

export async function publishStagedLeaderboard(cache, stagingKey, liveKey, revisionKey, targetRevision) {
  // Lua keeps replacement/deletion plus the monotonically increasing published
  // revision atomic. Redis Lua numbers are doubles, so compare bigint revisions
  // as non-negative decimal strings: length first, then lexical order.
  const result = await cache.eval(
    "local incoming=ARGV[1]; local published=redis.call('GET', KEYS[3]); if published and (#incoming < #published or (#incoming == #published and incoming < published)) then return 0 end; if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('RENAME', KEYS[1], KEYS[2]); redis.call('PERSIST', KEYS[2]) else redis.call('DEL', KEYS[2]) end; redis.call('SET', KEYS[3], incoming); return 1",
    3,
    stagingKey,
    liveKey,
    revisionKey,
    targetRevision,
  )
  return result === 1 || result === '1'
}

export async function discardStagedLeaderboard(cache, stagingKey) {
  try { await cache.del(stagingKey) } catch { /* best-effort cleanup */ }
}
