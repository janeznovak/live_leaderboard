import { database } from '../../../utils/database'
import { leaderboardForGame } from '../../../utils/leaderboard'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const game = await database().query('SELECT id, name, slug FROM games WHERE slug = $1', [slug])
  const result = game.rows[0]
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Game not found' })
  return { game: result, entries: await leaderboardForGame(result.id) }
})
