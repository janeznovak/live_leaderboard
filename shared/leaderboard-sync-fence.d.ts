type Queryable = { query(sql: string, values?: unknown[]): Promise<{ rows: Array<{ revision?: string, target_revision?: string }>, rowCount: number | null }> }
type Lease = { gameId: string, targetRevision: string, lockToken: string }
export function renewLeaderboardPublishLease(database: Queryable, lease: Lease & { leaseMs: number }): Promise<boolean>
export function acknowledgePublishedLeaderboard(database: Queryable, lease: Lease): Promise<boolean>
export function publishLeaderboardIfLeaseCurrent(args: Lease & { database: Queryable, leaseMs: number, publish(): Promise<boolean> }): Promise<boolean>
