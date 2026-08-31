import { database } from './database'

export type PublicRankingResource = 'leaderboard' | 'report'

type PublicRankingFingerprints = {
  leaderboard: string
  report: string
}

type PublicRankingWatcher = {
  listeners: Set<(resource: PublicRankingResource) => void>
  previousFingerprints?: PublicRankingFingerprints
  polling: boolean
  stopped: boolean
  initialize?: Promise<void>
  refreshInterval?: ReturnType<typeof setInterval>
}

// One watcher per game per Node process keeps the PostgreSQL fallback reliable
// across processes without multiplying database work for each public viewer.
const watchers = new Map<string, PublicRankingWatcher>()

function publishChange(watcher: PublicRankingWatcher, resource: PublicRankingResource) {
  for (const listener of watcher.listeners) listener(resource)
}

async function refreshPublicRankingFingerprints(gameId: string, watcher: PublicRankingWatcher) {
  if (watcher.polling) return
  watcher.polling = true
  try {
    const result = await database().query<{
      leaderboard_fingerprint: string
      report_fingerprint: string
    }>(
      `WITH approved_scores AS (
         SELECT user_id, score, moderated_at
         FROM score_submissions
         WHERE game_id = $1 AND status = 'approved'
       )
       SELECT
         -- Redis-backed leaderboards may be stale during an outage. Its event
         -- must wait for the worker's post-swap PostgreSQL acknowledgement,
         -- unlike reports which are derived directly from approved history.
         (SELECT COALESCE(synced_revision::text, '') FROM leaderboard_sync_states WHERE game_id = $1) AS leaderboard_fingerprint,
         (SELECT count(*)::text || ':' || COALESCE(max(moderated_at)::text, '') FROM approved_scores) AS report_fingerprint`,
      [gameId],
    )
    const row = result.rows[0]
    const fingerprints = {
      leaderboard: row?.leaderboard_fingerprint ?? '',
      report: row?.report_fingerprint ?? '',
    }
    const previous = watcher.previousFingerprints
    if (previous) {
      if (previous.leaderboard !== fingerprints.leaderboard) publishChange(watcher, 'leaderboard')
      if (previous.report !== fingerprints.report) publishChange(watcher, 'report')
    }
    watcher.previousFingerprints = fingerprints
  } catch (error) {
    console.warn('Unable to poll public ranking data for SSE changes', error)
  } finally {
    watcher.polling = false
    if (watcher.stopped && watcher.listeners.size === 0 && watchers.get(gameId) === watcher) watchers.delete(gameId)
  }
}

export async function subscribePublicRankingChanges(gameId: string, listener: (resource: PublicRankingResource) => void) {
  let watcher = watchers.get(gameId)
  if (!watcher) {
    watcher = { listeners: new Set(), polling: false, stopped: false }
    watchers.set(gameId, watcher)
  }
  watcher.listeners.add(listener)
  watcher.stopped = false

  if (!watcher.initialize) watcher.initialize = refreshPublicRankingFingerprints(gameId, watcher)
  await watcher.initialize
  if (!watcher.refreshInterval && watcher.listeners.size > 0) {
    watcher.refreshInterval = setInterval(() => { void refreshPublicRankingFingerprints(gameId, watcher) }, 1_000)
  }

  let unsubscribed = false
  return () => {
    if (unsubscribed) return
    unsubscribed = true
    watcher!.listeners.delete(listener)
    if (watcher!.listeners.size !== 0) return
    if (watcher!.refreshInterval) clearInterval(watcher!.refreshInterval)
    watcher!.refreshInterval = undefined
    watcher!.stopped = true
    if (!watcher!.polling && watchers.get(gameId) === watcher) watchers.delete(gameId)
  }
}

export function notifyPublicRankingChanged(gameId: string, resource: PublicRankingResource) {
  const watcher = watchers.get(gameId)
  if (watcher) publishChange(watcher, resource)
}
