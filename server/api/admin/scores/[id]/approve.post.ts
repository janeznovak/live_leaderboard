import { requireAdmin } from '../../../../utils/auth'
import { moderateScoreSubmission } from '../../../../utils/moderation'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Score submission ID is required.' })
  const submission = await moderateScoreSubmission(id, admin.id, 'approved')
  return {
    id: submission.id,
    score: submission.score,
    status: submission.status,
    moderatedAt: submission.moderatedAt,
    moderatedBy: { id: admin.id, gameUsername: admin.gameUsername },
  }
})
