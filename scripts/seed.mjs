import pg from 'pg'
import Redis from 'ioredis'
import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'

const databaseUrl = process.env.DATABASE_URL
const redisUrl = process.env.REDIS_URL
if (!databaseUrl || !redisUrl) throw new Error('DATABASE_URL and REDIS_URL are required')
const adminPassword = process.env.SEED_ADMIN_PASSWORD
if (!adminPassword || adminPassword.length < 8) throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters so the seeded admin can log in safely')
const scrypt = promisify(scryptCallback)

async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url')
  const derivedKey = await scrypt(password, salt, 64)
  return `scrypt$${salt}$${derivedKey.toString('base64url')}`
}
const database = new pg.Client({ connectionString: databaseUrl })
const redis = new Redis(redisUrl)
await database.connect()
const games = [
  ['Sky Sprint', 'sky-sprint'],
  ['Orbital Dodger', 'orbital-dodger'],
]
for (const [name, slug] of games) await database.query('INSERT INTO games (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING', [name, slug])
const seededAdminPasswordHash = await hashPassword(adminPassword)
await database.query(
  `INSERT INTO users (email, game_username, password_hash, role)
   VALUES ('admin@example.test', 'moderator', $1, 'admin')
   ON CONFLICT (email) DO UPDATE SET password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash), role = 'admin'`,
  [seededAdminPasswordHash],
)
for (const [email, username] of [['ada@example.test', 'ada'], ['grace@example.test', 'grace']]) {
  await database.query('INSERT INTO users (email, game_username, role) VALUES ($1, $2, \'player\') ON CONFLICT (email) DO NOTHING', [email, username])
}
const game = (await database.query("SELECT id FROM games WHERE slug = 'sky-sprint'" )).rows[0]
const players = (await database.query("SELECT id, game_username FROM users WHERE game_username IN ('ada', 'grace')" )).rows
const scores = { ada: 1200, grace: 900 }
for (const player of players) {
  await database.query("INSERT INTO score_submissions (game_id, user_id, score, status) SELECT $1, $2, $3, 'approved' WHERE NOT EXISTS (SELECT 1 FROM score_submissions WHERE game_id = $1 AND user_id = $2 AND score = $3)", [game.id, player.id, scores[player.game_username]])
  await redis.zadd(`leaderboard:${game.id}`, scores[player.game_username], player.id)
}
await database.end()
await redis.quit()
