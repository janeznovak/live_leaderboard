type LeaderboardEntry = { user_id: string; score: string }

export function fetchApprovedLeaderboardEntries(
  database: { query<T = LeaderboardEntry>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> },
  gameId: string,
): Promise<LeaderboardEntry[]>
