import Redis from 'ioredis'

let client: Redis | undefined

export function redis() {
  if (!client) {
    const config = useRuntimeConfig()
    if (!config.redisUrl) throw createError({ statusCode: 500, statusMessage: 'REDIS_URL is not configured' })
    client = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 })
  }
  return client
}
