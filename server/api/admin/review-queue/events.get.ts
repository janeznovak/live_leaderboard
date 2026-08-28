import { createEventStream } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { database } from '../../../utils/database'
import { onReviewQueueChanged } from '../../../utils/review-queue-events'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const stream = createEventStream(event)
  let streamClosed = false
  const push = (message: { event: string; data: string }) => {
    void stream.push(message).catch((error) => {
      if (!streamClosed) console.warn('Unable to publish review queue SSE event', error)
    })
  }
  const publishChange = () => push({ event: 'changed', data: 'review-queue' })
  const unsubscribe = onReviewQueueChanged(publishChange)
  let previousQueueFingerprint: string | undefined
  let polling = false
  const refreshQueueFingerprint = async () => {
    if (polling) return
    polling = true
    try {
      const result = await database().query<{ fingerprint: string }>(
        `SELECT md5(COALESCE(string_agg(id::text, ',' ORDER BY submitted_at ASC, id ASC), '')) AS fingerprint
         FROM score_submissions
         WHERE status = 'pending'`,
      )
      const queueFingerprint = result.rows[0]?.fingerprint ?? ''
      if (previousQueueFingerprint !== undefined && queueFingerprint !== previousQueueFingerprint) publishChange()
      previousQueueFingerprint = queueFingerprint
    } catch (error) {
      console.warn('Unable to poll the review queue for SSE changes', error)
    } finally {
      polling = false
    }
  }
  await refreshQueueFingerprint()
  push({ event: 'ready', data: 'connected' })
  const refreshInterval = setInterval(() => { void refreshQueueFingerprint() }, 1_000)
  const keepalive = setInterval(() => push({ event: 'ping', data: 'keepalive' }), 25_000)
  stream.onClosed(() => {
    streamClosed = true
    clearInterval(refreshInterval)
    clearInterval(keepalive)
    unsubscribe()
  })
  return stream.send()
})
