import { database } from './database'
import { enqueueLeaderboardSynchronization } from '../../shared/leaderboard-sync-queue.mjs'
import { wakeLeaderboardSyncWorker } from './leaderboard-sync'
import { notifyPublicRankingChanged } from './public-ranking-events'
import { notifyReviewQueueChanged } from './review-queue-events'

type ModerationStatus = 'approved' | 'declined'

export async function moderateScoreSubmission(submissionId: string, adminId: string, status: ModerationStatus) {
  const client = await database().connect()
  let transactionActive = false
  let outcome!: {
    id: string
    score: number
    status: ModerationStatus
    gameId: string
    userId: string
    moderatedAt: Date
    updatesLeaderboard: boolean
  }
  try {
    await client.query('BEGIN')
    transactionActive = true
    const pending = await client.query<{ id: string; game_id: string; user_id: string; score: number }>(
      `SELECT id, game_id, user_id, score::float8 AS score
       FROM score_submissions
       WHERE id = $1 AND status = 'pending'
       FOR UPDATE`,
      [submissionId],
    )
    const submission = pending.rows[0]
    if (!submission) {
      await client.query('ROLLBACK')
      transactionActive = false
      throw createError({ statusCode: 409, statusMessage: 'This score submission has already been reviewed or does not exist.' })
    }

    let updatesLeaderboard = false
    if (status === 'approved') {
      const best = await client.query<{ score: number | null }>(
        `SELECT max(score)::float8 AS score
         FROM score_submissions
         WHERE game_id = $1 AND user_id = $2 AND status = 'approved'`,
        [submission.game_id, submission.user_id],
      )
      const priorBest = best.rows[0]?.score ?? null
      updatesLeaderboard = priorBest === null || submission.score > priorBest
    }

    const updated = await client.query<{ moderated_at: Date }>(
      `UPDATE score_submissions
       SET status = $1, moderated_at = now(), moderated_by = $2
       WHERE id = $3 AND status = 'pending'
       RETURNING moderated_at`,
      [status, adminId, submission.id],
    )
    if (!updated.rowCount) {
      await client.query('ROLLBACK')
      transactionActive = false
      throw createError({ statusCode: 409, statusMessage: 'This score submission has already been reviewed.' })
    }
    if (status === 'approved' && updatesLeaderboard) {
      // This durable outbox write is deliberately inside the same transaction as
      // the approval. A process crash after COMMIT therefore cannot lose the
      // derived-index work.
      await enqueueLeaderboardSynchronization(client, submission.game_id)
    }
    await client.query('COMMIT')
    transactionActive = false
    outcome = {
      id: submission.id,
      score: submission.score,
      status,
      gameId: submission.game_id,
      userId: submission.user_id,
      moderatedAt: updated.rows[0]!.moderated_at,
      updatesLeaderboard,
    }
  } catch (error) {
    if (transactionActive) await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  if (outcome.status === 'approved' && outcome.updatesLeaderboard) {
    wakeLeaderboardSyncWorker()
  }
  // Reports use all approved submissions in their UTC period, including a
  // score that is lower than the user's all-time leaderboard best.
  if (outcome.status === 'approved') {
    notifyPublicRankingChanged(outcome.gameId, 'report')
  }
  notifyReviewQueueChanged()
  return outcome
}
