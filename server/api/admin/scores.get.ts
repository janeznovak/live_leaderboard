import { requireAdmin } from '../../utils/auth'
import { database } from '../../utils/database'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const result = await database().query<{
    id: string
    score: number
    status: 'pending' | 'approved' | 'declined'
    submitted_at: Date
    moderated_at: Date | null
    game_id: string
    game_name: string
    game_slug: string
    user_id: string
    game_username: string
    moderated_by_id: string | null
    moderated_by_game_username: string | null
  }>(
    `SELECT score_submissions.id, score_submissions.score::float8 AS score, score_submissions.status,
            score_submissions.submitted_at, score_submissions.moderated_at,
            games.id AS game_id, games.name AS game_name, games.slug AS game_slug,
            users.id AS user_id, users.game_username,
            moderators.id AS moderated_by_id, moderators.game_username AS moderated_by_game_username
     FROM score_submissions
     JOIN games ON games.id = score_submissions.game_id
     JOIN users ON users.id = score_submissions.user_id
     LEFT JOIN users AS moderators ON moderators.id = score_submissions.moderated_by
     ORDER BY score_submissions.submitted_at DESC, score_submissions.id DESC`,
  )
  return {
    submissions: result.rows.map((submission) => ({
      id: submission.id,
      score: submission.score,
      status: submission.status,
      submittedAt: submission.submitted_at,
      moderatedAt: submission.moderated_at,
      user: { id: submission.user_id, gameUsername: submission.game_username },
      game: { id: submission.game_id, name: submission.game_name, slug: submission.game_slug },
      moderatedBy: submission.moderated_by_id && submission.moderated_by_game_username
        ? { id: submission.moderated_by_id, gameUsername: submission.moderated_by_game_username }
        : null,
    })),
  }
})
