// Caller owns the surrounding PostgreSQL transaction. Keeping this helper free
// of runtime globals lets the Nitro approval path and operator CLI share exactly
// the same revision/job enqueue semantics.
export async function enqueueLeaderboardSynchronization(database, gameId) {
  const state = await database.query(
    `INSERT INTO leaderboard_sync_states (game_id, revision, synced_revision)
     VALUES ($1, 1, 0)
     ON CONFLICT (game_id) DO UPDATE
       SET revision = leaderboard_sync_states.revision + 1, updated_at = now()
     RETURNING revision::text`,
    [gameId],
  )
  const revision = state.rows[0].revision
  await database.query(
    `INSERT INTO leaderboard_sync_jobs (game_id, target_revision, next_attempt_at)
     VALUES ($1, $2::bigint, now())
     ON CONFLICT (game_id) DO UPDATE
       SET target_revision = EXCLUDED.target_revision,
           next_attempt_at = LEAST(leaderboard_sync_jobs.next_attempt_at, EXCLUDED.next_attempt_at),
           updated_at = now()`,
    [gameId, revision],
  )
  return revision
}
