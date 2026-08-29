import type { QueryResultRow } from 'pg'
import { database } from './database'

export const reportPeriods = ['today', 'this-week', 'this-month', 'this-year', 'all-time'] as const
export type ReportPeriod = typeof reportPeriods[number]

type PeriodRange = {
  id: ReportPeriod
  label: string
  startsAt?: Date
  endsAt?: Date
}

export type PeriodReportEntry = {
  username: string
  score: number
  rank: number
  githubProfileUrl?: string
}

export type PeriodReportPage = {
  period: PeriodRange
  entries: PeriodReportEntry[]
  page: number
  pageSize: number
  totalEntries: number
  totalPages: number
}

export const periodReportPageSize = 10

export function isReportPeriod(value: unknown): value is ReportPeriod {
  return typeof value === 'string' && (reportPeriods as readonly string[]).includes(value)
}

export function reportPeriodRange(period: ReportPeriod, now = new Date()): PeriodRange {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const date = now.getUTCDate()
  const day = now.getUTCDay()
  const startOfToday = new Date(Date.UTC(year, month, date))

  switch (period) {
    case 'today':
      return { id: period, label: 'Today', startsAt: startOfToday, endsAt: new Date(Date.UTC(year, month, date + 1)) }
    case 'this-week': {
      // ISO-style weeks start on Monday. UTC makes this definition identical
      // for every viewer, regardless of their local timezone.
      const daysSinceMonday = (day + 6) % 7
      const startsAt = new Date(Date.UTC(year, month, date - daysSinceMonday))
      return { id: period, label: 'This week', startsAt, endsAt: new Date(Date.UTC(year, month, date - daysSinceMonday + 7)) }
    }
    case 'this-month':
      return { id: period, label: 'This month', startsAt: new Date(Date.UTC(year, month, 1)), endsAt: new Date(Date.UTC(year, month + 1, 1)) }
    case 'this-year':
      return { id: period, label: 'This year', startsAt: new Date(Date.UTC(year, 0, 1)), endsAt: new Date(Date.UTC(year + 1, 0, 1)) }
    case 'all-time':
      return { id: period, label: 'All time' }
  }
}

export async function periodReportForGame(gameId: string, period: ReportPeriod, requestedPage: number): Promise<PeriodReportPage> {
  const range = reportPeriodRange(period)
  const whereRange = range.startsAt
    ? 'AND submitted_at >= $2 AND submitted_at < $3'
    : ''
  const parameters = range.startsAt ? [gameId, range.startsAt, range.endsAt] : [gameId]
  const qualifyingScores = `
    FROM score_submissions
    WHERE game_id = $1 AND status = 'approved' ${whereRange}
    GROUP BY user_id
  `
  const count = await database().query<{ total_entries: string }>(
    `SELECT count(*) AS total_entries
     FROM (SELECT user_id ${qualifyingScores}) AS qualifying_scores`,
    parameters,
  )
  const totalEntries = Number(count.rows[0]!.total_entries)
  const totalPages = Math.max(1, Math.ceil(totalEntries / periodReportPageSize))
  const page = Math.min(requestedPage, totalPages)
  const offset = (page - 1) * periodReportPageSize
  const entries = await database().query<QueryResultRow>(
    `WITH qualifying_scores AS (
       SELECT user_id, max(score)::float8 AS score
       ${qualifyingScores}
     ), ranked_scores AS (
       SELECT user_id, score, rank() OVER (ORDER BY score DESC) AS rank
       FROM qualifying_scores
     )
     SELECT users.game_username AS username,
            ranked_scores.score,
            ranked_scores.rank::int AS rank,
            github_identities.profile_url AS github_profile_url
     FROM ranked_scores
     JOIN users ON users.id = ranked_scores.user_id
     LEFT JOIN github_identities ON github_identities.user_id = users.id
     ORDER BY ranked_scores.score DESC, users.game_username ASC, users.id ASC
     LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
    [...parameters, periodReportPageSize, offset],
  )
  return {
    period: range,
    entries: entries.rows.map((entry) => ({
      username: entry.username as string,
      score: entry.score as number,
      rank: entry.rank as number,
      ...(entry.github_profile_url ? { githubProfileUrl: entry.github_profile_url as string } : {}),
    })),
    page,
    pageSize: periodReportPageSize,
    totalEntries,
    totalPages,
  }
}
