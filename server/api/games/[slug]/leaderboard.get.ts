import { database } from '../../../utils/database'
import { currentUser } from '../../../utils/auth'
import { leaderboardForGame } from '../../../utils/leaderboard'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const game = await database().query('SELECT id, name, slug FROM games WHERE slug = $1', [slug])
  const result = game.rows[0]
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Game not found' })

  const pageParameter = getQuery(event).page
  let requestedPage: number | undefined
  if (pageParameter !== undefined) {
    if (typeof pageParameter !== 'string' || !/^[1-9]\d*$/.test(pageParameter)) {
      throw createError({ statusCode: 400, statusMessage: 'Page must be a positive whole number.' })
    }
    requestedPage = Number(pageParameter)
    if (!Number.isSafeInteger(requestedPage) || requestedPage > 10_000) {
      throw createError({ statusCode: 400, statusMessage: 'Page must be between 1 and 10000.' })
    }
  }

  const user = await currentUser(event)
  return { game: result, ...await leaderboardForGame(result.id, requestedPage, user?.id) }
})
