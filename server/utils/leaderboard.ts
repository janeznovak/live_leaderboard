import type { QueryResultRow } from 'pg'
import { database } from './database'
import { redis } from './redis'

export type LeaderboardEntry = { userId: string; username: string; score: number; rank: number; githubProfileUrl?: string }
export type LeaderboardPage = {
  entries: LeaderboardEntry[]
  page: number
  pageSize: number
  totalEntries: number
  totalPages: number
}

type RedisEntry = { userId: string; score: number }

export const leaderboardPageSize = 10

export async function leaderboardForGame(gameId: string, requestedPage?: number, currentUserId?: string): Promise<LeaderboardPage> {
  const key = `leaderboard:${gameId}`
  const cache = redis()
  const totalEntries = await cache.zcard(key)
  const totalPages = Math.max(1, Math.ceil(totalEntries / leaderboardPageSize))
  let page = requestedPage ?? 1

  // An omitted page is the one exception to normal page navigation: signed-in
  // players start on the page containing their Redis leaderboard position.
  if (requestedPage === undefined && currentUserId) {
    const position = await cache.zrevrank(key, currentUserId)
    if (position !== null) page = Math.floor(position / leaderboardPageSize) + 1
  }
  page = Math.min(page, totalPages)

  const start = (page - 1) * leaderboardPageSize
  const index = totalEntries === 0
    ? []
    : await cache.zrevrange(key, start, start + leaderboardPageSize - 1, 'WITHSCORES')
  const entries: RedisEntry[] = []
  for (let indexPosition = 0; indexPosition < index.length; indexPosition += 2) {
    entries.push({ userId: index[indexPosition]!, score: Number(index[indexPosition + 1]) })
  }
  if (entries.length === 0) return { entries: [], page, pageSize: leaderboardPageSize, totalEntries, totalPages }

  const users = await database().query<QueryResultRow>(
    `SELECT users.id, users.game_username, github_identities.profile_url AS github_profile_url
     FROM users
     LEFT JOIN github_identities ON github_identities.user_id = users.id
     WHERE users.id = ANY($1::uuid[])`,
    [entries.map((entry) => entry.userId)],
  )
  const usersById = new Map(users.rows.map((user) => [user.id, {
    username: user.game_username as string,
    githubProfileUrl: user.github_profile_url as string | null,
  }]))
  const ranks = await Promise.all(entries.map(async (entry) => {
    // Competition rank is the count of strictly higher scores plus one. Redis
    // supplies a deterministic member order for tied scores, but that order
    // must never create distinct displayed ranks.
    const higherScores = await cache.zcount(key, `(${entry.score}`, '+inf')
    return higherScores + 1
  }))
  const visibleEntries = entries.flatMap((entry, position) => {
    const user = usersById.get(entry.userId)
    if (!user) return []
    return [{ ...entry, username: user.username, rank: ranks[position]!, ...(user.githubProfileUrl ? { githubProfileUrl: user.githubProfileUrl } : {}) }]
  })
  return { entries: visibleEntries, page, pageSize: leaderboardPageSize, totalEntries, totalPages }
}
