import { database } from '../../../utils/database'
import { isReportPeriod, periodReportForGame } from '../../../utils/period-reports'
import { parseBoundedPositivePage } from '../../../utils/pagination'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const game = await database().query<{ id: string; name: string; slug: string }>(
    'SELECT id, name, slug FROM games WHERE slug = $1',
    [slug],
  )
  const result = game.rows[0]
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Game not found' })

  const query = getQuery(event)
  if (!isReportPeriod(query.period)) {
    throw createError({ statusCode: 400, statusMessage: 'Period must be one of: today, this-week, this-month, this-year, all-time.' })
  }
  return {
    game: { name: result.name, slug: result.slug },
    ...await periodReportForGame(result.id, query.period, parseBoundedPositivePage(query.page) ?? 1),
  }
})
