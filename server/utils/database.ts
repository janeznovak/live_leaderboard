import { Pool } from 'pg'

let pool: Pool | undefined

export function database() {
  if (!pool) {
    const config = useRuntimeConfig()
    if (!config.databaseUrl) throw createError({ statusCode: 500, statusMessage: 'DATABASE_URL is not configured' })
    pool = new Pool({ connectionString: config.databaseUrl })
  }
  return pool
}
