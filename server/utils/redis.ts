import Redis from 'ioredis'

const redisTimeoutMs = 5_000

let client: Redis | undefined

export function redis() {
  if (!client) {
    const config = useRuntimeConfig()
    if (!config.redisUrl) throw createError({ statusCode: 500, statusMessage: 'REDIS_URL is not configured' })
    client = new Redis(config.redisUrl, {
      connectTimeout: redisTimeoutMs,
      commandTimeout: redisTimeoutMs,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(1_000, attempt * 100),
    })
    // Keep the default startup command queue so the first healthy leaderboard
    // read is not rejected while this client is establishing its TCP connection.
    // The worker is isolated from approvals and maxRetriesPerRequest bounds a
    // failed synchronization attempt.
    client.on('error', () => undefined)
  }
  return client
}

export function stopRedis() {
  if (!client) return
  client.disconnect(false)
  client = undefined
}
