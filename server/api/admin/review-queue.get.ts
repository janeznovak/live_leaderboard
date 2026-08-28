import { requireAdmin } from '../../utils/auth'
import { database } from '../../utils/database'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const result = await database().query<{
    id: string
    score: number
    submitted_at: Date
    game_id: string
    game_name: string
    game_slug: string
    user_id: string
    game_username: string
  }>(
    `SELECT score_submissions.id, score_submissions.score::float8 AS score, score_submissions.submitted_at,
            games.id AS game_id, games.name AS game_name, games.slug AS game_slug,
            users.id AS user_id, users.game_username
     FROM score_submissions
     JOIN games ON games.id = score_submissions.game_id
     JOIN users ON users.id = score_submissions.user_id
     WHERE score_submissions.status = 'pending'
     ORDER BY score_submissions.submitted_at ASC, score_submissions.id ASC`,
  )
  return {
    pendingCount: result.rows.length,
    submissions: result.rows.map((submission) => ({
      id: submission.id,
      score: submission.score,
      submittedAt: submission.submitted_at,
      user: { id: submission.user_id, gameUsername: submission.game_username },
      game: { id: submission.game_id, name: submission.game_name, slug: submission.game_slug },
    })),
  }
})
