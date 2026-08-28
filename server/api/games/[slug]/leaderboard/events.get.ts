import { createEventStream } from 'h3'
import { database } from '../../../../utils/database'
import { subscribeLeaderboardChanges } from '../../../../utils/leaderboard-events'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const game = await database().query<{ id: string }>('SELECT id FROM games WHERE slug = $1', [slug])
  const gameId = game.rows[0]?.id
  if (!gameId) throw createError({ statusCode: 404, statusMessage: 'Game not found' })

  const stream = createEventStream(event)
  let streamClosed = false
  const push = (message: { event: string; data: string }) => {
    void stream.push(message).catch((error) => {
      if (!streamClosed) console.warn('Unable to publish leaderboard SSE event', error)
    })
  }
  // Event data is deliberately opaque: public clients refresh the public API,
  // rather than receiving approval, moderator, or submission information.
  const publishChange = () => push({ event: 'changed', data: 'leaderboard' })
  let unsubscribe: (() => void) | undefined
  const keepalive = setInterval(() => push({ event: 'ping', data: 'keepalive' }), 25_000)
  stream.onClosed(() => {
    streamClosed = true
    clearInterval(keepalive)
    unsubscribe?.()
  })
  unsubscribe = await subscribeLeaderboardChanges(gameId, publishChange)
  if (streamClosed) unsubscribe()
  else push({ event: 'ready', data: 'connected' })
  return stream.send()
})
