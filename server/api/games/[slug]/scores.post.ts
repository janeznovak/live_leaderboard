import { requireUser } from '../../../utils/auth'
import { database } from '../../../utils/database'
import { notifyReviewQueueChanged } from '../../../utils/review-queue-events'

const maximumScore = Number.MAX_SAFE_INTEGER

function isNonNegativeWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody(event)

  if (body?.userId !== undefined && body.userId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'You can submit scores only for your own account.' })
  }
  if (!isNonNegativeWholeNumber(body?.score)) {
    throw createError({ statusCode: 400, statusMessage: `Score must be a non-negative whole number no greater than ${maximumScore}.` })
  }

  const slug = getRouterParam(event, 'slug')
  const gameResult = await database().query<{ id: string; name: string; slug: string }>(
    'SELECT id, name, slug FROM games WHERE slug = $1',
    [slug],
  )
  const game = gameResult.rows[0]
  if (!game) throw createError({ statusCode: 404, statusMessage: 'Game not found.' })

  const client = await database().connect()
  let transactionActive = false
  try {
    await client.query('BEGIN')
    transactionActive = true

    // Serializes this user/game pair so that a cooldown check and insert cannot race.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [user.id, game.id])

    const pending = await client.query(
      `SELECT id
       FROM score_submissions
       WHERE game_id = $1 AND user_id = $2 AND status = 'pending'
       LIMIT 1`,
      [game.id, user.id],
    )
    if (pending.rowCount) {
      await client.query('ROLLBACK')
      transactionActive = false
      throw createError({ statusCode: 409, statusMessage: 'You already have a pending score for this game.' })
    }

    const latest = await client.query<{ next_available_at: Date; is_cooling_down: boolean }>(
      `SELECT submitted_at + interval '5 minutes' AS next_available_at,
              now() < submitted_at + interval '5 minutes' AS is_cooling_down
       FROM score_submissions
       WHERE game_id = $1 AND user_id = $2
       ORDER BY submitted_at DESC, id DESC
       LIMIT 1`,
      [game.id, user.id],
    )
    const previousSubmission = latest.rows[0]
    if (previousSubmission?.is_cooling_down) {
      await client.query('ROLLBACK')
      transactionActive = false
      throw createError({
        statusCode: 429,
        statusMessage: 'You can submit another score for this game in five minutes from your previous submission.',
        data: { retryAt: previousSubmission.next_available_at.toISOString() },
      })
    }

    const inserted = await client.query<{
      id: string
      score: number
      status: 'pending'
      submitted_at: Date
    }>(
      `INSERT INTO score_submissions (game_id, user_id, score)
       VALUES ($1, $2, $3)
       RETURNING id, score::float8 AS score, status, submitted_at`,
      [game.id, user.id, body.score],
    )
    await client.query('COMMIT')
    transactionActive = false

    const submission = inserted.rows[0]!
    notifyReviewQueueChanged()
    setResponseStatus(event, 201)
    return {
      id: submission.id,
      score: submission.score,
      status: submission.status,
      submittedAt: submission.submitted_at,
      game,
    }
  } catch (error: unknown) {
    if (transactionActive) await client.query('ROLLBACK')
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'You already have a pending score for this game.' })
    }
    throw error
  } finally {
    client.release()
  }
})
