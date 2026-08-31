// This module deliberately has no Nitro dependency. Its database argument may
// be either a PoolClient or standalone pg Client. PostgreSQL lock phases are
// intentionally short: Redis I/O is always between committed transactions.
async function withTransaction(database, work) {
  let transactionOpen = false
  try {
    await database.query('BEGIN')
    transactionOpen = true
    const result = await work()
    if (result) await database.query('COMMIT')
    else await database.query('ROLLBACK')
    transactionOpen = false
    return result
  } catch (error) {
    if (transactionOpen) await database.query('ROLLBACK')
    throw error
  }
}

async function lockOwnedRevision(database, { gameId, targetRevision, lockToken }) {
  const fence = await database.query(
    `SELECT leaderboard_sync_states.revision::text AS revision,
            leaderboard_sync_jobs.target_revision::text AS target_revision
     FROM leaderboard_sync_states
     JOIN leaderboard_sync_jobs USING (game_id)
     WHERE leaderboard_sync_states.game_id = $1
       AND leaderboard_sync_jobs.lock_token = $2::uuid
     FOR UPDATE OF leaderboard_sync_states, leaderboard_sync_jobs`,
    [gameId, lockToken],
  )
  const row = fence.rows[0]
  return Boolean(row && row.revision === targetRevision && row.target_revision === targetRevision)
}

export async function renewLeaderboardPublishLease(database, { gameId, targetRevision, lockToken, leaseMs }) {
  return withTransaction(database, async () => {
    if (!await lockOwnedRevision(database, { gameId, targetRevision, lockToken })) return false
    const renewed = await database.query(
      `UPDATE leaderboard_sync_jobs
       SET locked_until = now() + ($3::text || ' milliseconds')::interval, updated_at = now()
       WHERE game_id = $1 AND lock_token = $2::uuid AND target_revision = $4::bigint
       RETURNING game_id`,
      [gameId, lockToken, leaseMs, targetRevision],
    )
    return Boolean(renewed.rowCount)
  })
}

export async function acknowledgePublishedLeaderboard(database, { gameId, targetRevision, lockToken }) {
  return withTransaction(database, async () => {
    if (!await lockOwnedRevision(database, { gameId, targetRevision, lockToken })) return false
    await database.query(
      `UPDATE leaderboard_sync_states
       SET synced_revision = revision, redis_synced_at = now(), updated_at = now()
       WHERE game_id = $1 AND revision = $2::bigint`,
      [gameId, targetRevision],
    )
    const deleted = await database.query(
      `DELETE FROM leaderboard_sync_jobs
       WHERE game_id = $1 AND lock_token = $2::uuid AND target_revision = $3::bigint
       RETURNING game_id`,
      [gameId, lockToken, targetRevision],
    )
    return Boolean(deleted.rowCount)
  })
}

export async function publishLeaderboardIfLeaseCurrent({ database, gameId, targetRevision, lockToken, leaseMs, publish }) {
  if (!await renewLeaderboardPublishLease(database, { gameId, targetRevision, lockToken, leaseMs })) return false
  // No PostgreSQL transaction is open here. A half-open Redis publish cannot
  // delay an approval's state-row update/enqueue transaction. A newer approval
  // can therefore arrive during this temporary stale Redis visibility; the ACK
  // below declines it and leaves durable work for convergence.
  if (!await publish()) return false
  return acknowledgePublishedLeaderboard(database, { gameId, targetRevision, lockToken })
}
