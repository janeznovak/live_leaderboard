// Runtime-neutral authoritative source for full leaderboard rebuilds. Callers
// retain transaction/session ownership (including their per-game advisory lock).
export async function fetchApprovedLeaderboardEntries(database, gameId) {
  const result = await database.query(
    `SELECT user_id::text, max(score)::text AS score
     FROM score_submissions
     WHERE game_id = $1 AND status = 'approved'
     GROUP BY user_id`,
    [gameId],
  )
  return result.rows
}
