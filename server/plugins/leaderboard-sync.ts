import { startLeaderboardSyncWorker } from '../utils/leaderboard-sync'

export default defineNitroPlugin((nitroApp) => {
  const stop = startLeaderboardSyncWorker()
  nitroApp.hooks.hook('close', async () => { await stop() })
})
