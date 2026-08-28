import { database } from '../../utils/database'
import { createSession, hashPassword, normalizeEmail, normalizeGameUsername, validatePassword } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const email = normalizeEmail(body?.email)
  const gameUsername = normalizeGameUsername(body?.gameUsername)
  const password = validatePassword(body?.password)
  if (!email || !gameUsername || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Use a valid email, an 8-character password, and a 3-32 character username containing letters, numbers, underscores, or hyphens.',
    })
  }

  try {
    const result = await database().query<{ id: string; email: string; game_username: string; role: 'player' }>(
      `INSERT INTO users (email, game_username, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, game_username, role`,
      [email, gameUsername, await hashPassword(password)],
    )
    const user = result.rows[0]!
    await createSession(event, user.id)
    setResponseStatus(event, 201)
    return { id: user.id, email: user.email, gameUsername: user.game_username, role: user.role }
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      const constraint = 'constraint' in error ? error.constraint : undefined
      const message = constraint === 'users_email_key' || constraint === 'users_email_lower_unique'
        ? 'An account already exists for this email address.'
        : 'That game username is already in use.'
      throw createError({ statusCode: 409, statusMessage: message })
    }
    throw error
  }
})
