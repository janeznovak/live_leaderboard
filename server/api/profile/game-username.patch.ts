import { normalizeGameUsername, requireUser } from '../../utils/auth'
import { database } from '../../utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody(event)
  const gameUsername = normalizeGameUsername(body?.gameUsername)
  if (!gameUsername) {
    throw createError({ statusCode: 400, statusMessage: 'Use a 3-32 character username containing letters, numbers, underscores, or hyphens.' })
  }
  try {
    const result = await database().query<{ game_username: string }>(
      'UPDATE users SET game_username = $1 WHERE id = $2 RETURNING game_username',
      [gameUsername, user.id],
    )
    return { ...user, gameUsername: result.rows[0]!.game_username }
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'That game username is already in use.' })
    }
    throw error
  }
})
