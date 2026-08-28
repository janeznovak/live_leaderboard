import { requireUser } from '../utils/auth'
import { database } from '../utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const result = await database().query<{
    id: string
    score: number
    status: 'pending' | 'approved' | 'declined'
    submitted_at: Date
    game_id: string
    game_name: string
    game_slug: string
    game_username: string
  }>(
    `SELECT score_submissions.id, score_submissions.score::float8 AS score, score_submissions.status, score_submissions.submitted_at,
            games.id AS game_id, games.name AS game_name, games.slug AS game_slug,
            users.game_username
     FROM score_submissions
     JOIN games ON games.id = score_submissions.game_id
     JOIN users ON users.id = score_submissions.user_id
     WHERE score_submissions.user_id = $1
     ORDER BY score_submissions.submitted_at DESC, score_submissions.id DESC`,
    [user.id],
  )

  return {
    submissions: result.rows.map((submission) => ({
      id: submission.id,
      score: submission.score,
      status: submission.status,
      submittedAt: submission.submitted_at,
      gameUsername: submission.game_username,
      game: { id: submission.game_id, name: submission.game_name, slug: submission.game_slug },
    })),
  }
})
