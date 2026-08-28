import type { QueryResultRow } from 'pg'
import { database } from './database'
import { redis } from './redis'

export type LeaderboardEntry = { userId: string; username: string; score: number; rank: number; githubProfileUrl?: string }

type RedisEntry = { userId: string; score: number }

export async function leaderboardForGame(gameId: string): Promise<LeaderboardEntry[]> {
  const index = await redis().zrevrange(`leaderboard:${gameId}`, 0, -1, 'WITHSCORES')
  const entries: RedisEntry[] = []
  for (let indexPosition = 0; indexPosition < index.length; indexPosition += 2) {
    entries.push({ userId: index[indexPosition]!, score: Number(index[indexPosition + 1]) })
  }
  if (entries.length === 0) return []

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
  let previousScore: number | undefined
  let rank = 0
  return entries.flatMap((entry, position) => {
    const user = usersById.get(entry.userId)
    if (!user) return []
    if (entry.score !== previousScore) rank = position + 1
    previousScore = entry.score
    return [{ ...entry, username: user.username, rank, ...(user.githubProfileUrl ? { githubProfileUrl: user.githubProfileUrl } : {}) }]
  })
}
