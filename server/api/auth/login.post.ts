import { createSession, normalizeEmail, validatePassword, verifyPassword } from '../../utils/auth'
import { database } from '../../utils/database'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const email = normalizeEmail(body?.email)
  const password = validatePassword(body?.password)
  if (!email || !password) throw createError({ statusCode: 400, statusMessage: 'Email and password are required.' })
  const result = await database().query<{
    id: string
    email: string
    game_username: string
    role: 'player' | 'admin'
    password_hash: string | null
  }>(
    'SELECT id, email, game_username, role, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  )
  const account = result.rows[0]
  if (!account?.password_hash || !(await verifyPassword(password, account.password_hash))) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password.' })
  }
  await createSession(event, account.id)
  return { id: account.id, email: account.email, gameUsername: account.game_username, role: account.role }
})
