export type RedisLeaderboardEntry = { user_id: string, score: string }
export function leaderboardRedisKey(gameId: string): string
export function leaderboardRevisionRedisKey(gameId: string): string
export function writeStagedLeaderboard(cache: { del(key: string): Promise<unknown>, eval(script: string, keyCount: number, ...args: string[]): Promise<unknown> }, stagingKey: string, entries: RedisLeaderboardEntry[]): Promise<void>
export function publishStagedLeaderboard(cache: { eval(script: string, keyCount: number, ...args: string[]): Promise<unknown> }, stagingKey: string, liveKey: string, revisionKey: string, targetRevision: string): Promise<boolean>
export function discardStagedLeaderboard(cache: { del(key: string): Promise<unknown> }, stagingKey: string): Promise<void>
