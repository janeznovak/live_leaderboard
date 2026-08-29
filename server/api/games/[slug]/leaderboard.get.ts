import { database } from '../../../utils/database'
import { currentUser } from '../../../utils/auth'
import { leaderboardForGame } from '../../../utils/leaderboard'
import { parseBoundedPositivePage } from '../../../utils/pagination'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const game = await database().query('SELECT id, name, slug FROM games WHERE slug = $1', [slug])
  const result = game.rows[0]
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Game not found' })

  const requestedPage = parseBoundedPositivePage(getQuery(event).page)

  const user = await currentUser(event)
  return { game: result, ...await leaderboardForGame(result.id, requestedPage, user?.id) }
})
