import { database } from './database'

type LeaderboardWatcher = {
  listeners: Set<() => void>
  previousFingerprint?: string
  polling: boolean
  stopped: boolean
  initialize?: Promise<void>
  refreshInterval?: ReturnType<typeof setInterval>
}

// One watcher per game per Node process keeps the PostgreSQL fallback reliable
// across processes without multiplying database work for each public viewer.
const watchers = new Map<string, LeaderboardWatcher>()

function publishChange(watcher: LeaderboardWatcher) {
  for (const listener of watcher.listeners) listener()
}

async function refreshLeaderboardFingerprint(gameId: string, watcher: LeaderboardWatcher) {
  if (watcher.polling) return
  watcher.polling = true
  try {
    const result = await database().query<{ fingerprint: string }>(
      `SELECT md5(COALESCE(string_agg(user_id::text || ':' || best_score::text, ',' ORDER BY user_id), '')) AS fingerprint
       FROM (
         SELECT user_id, max(score) AS best_score
         FROM score_submissions
         WHERE game_id = $1 AND status = 'approved'
         GROUP BY user_id
       ) AS best_scores`,
      [gameId],
    )
    const fingerprint = result.rows[0]?.fingerprint ?? ''
    if (watcher.previousFingerprint !== undefined && fingerprint !== watcher.previousFingerprint) publishChange(watcher)
    watcher.previousFingerprint = fingerprint
  } catch (error) {
    console.warn('Unable to poll the leaderboard for SSE changes', error)
  } finally {
    watcher.polling = false
    if (watcher.stopped && watcher.listeners.size === 0 && watchers.get(gameId) === watcher) watchers.delete(gameId)
  }
}

export async function subscribeLeaderboardChanges(gameId: string, listener: () => void) {
  let watcher = watchers.get(gameId)
  if (!watcher) {
    watcher = { listeners: new Set(), polling: false, stopped: false }
    watchers.set(gameId, watcher)
  }
  watcher.listeners.add(listener)
  watcher.stopped = false

  if (!watcher.initialize) watcher.initialize = refreshLeaderboardFingerprint(gameId, watcher)
  await watcher.initialize
  if (!watcher.refreshInterval && watcher.listeners.size > 0) {
    watcher.refreshInterval = setInterval(() => { void refreshLeaderboardFingerprint(gameId, watcher) }, 1_000)
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

export function notifyLeaderboardChanged(gameId: string) {
  const watcher = watchers.get(gameId)
  if (watcher) publishChange(watcher)
}
