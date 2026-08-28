import { expect, test } from '@playwright/test'
import Redis from 'ioredis'
import { Client } from 'pg'

const leaderboardEmailPattern = 'leaderboard-%'

test.afterEach(async () => {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) return
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  try {
    const members = await database.query<{ game_id: string; user_id: string }>(
      `SELECT score_submissions.game_id, score_submissions.user_id
       FROM score_submissions
       JOIN users ON users.id = score_submissions.user_id
       WHERE users.email LIKE $1`,
      [leaderboardEmailPattern],
    )
    const cache = new Redis(process.env.REDIS_URL)
    try {
      await Promise.all(members.rows.map((member) => cache.zrem(`leaderboard:${member.game_id}`, member.user_id)))
    } finally {
      await cache.quit()
    }
    await database.query(
      `DELETE FROM score_submissions
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [leaderboardEmailPattern],
    )
    await database.query('DELETE FROM users WHERE email LIKE $1', [leaderboardEmailPattern])
  } finally {
    await database.end()
  }
})

async function addApprovedLeaderboardEntries(entries: Array<{ email: string; username: string; score: number }>) {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error('Leaderboard setup requires PostgreSQL and Redis.')
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  const cache = new Redis(process.env.REDIS_URL)
  await database.connect()
  try {
    const game = await database.query<{ id: string }>("SELECT id FROM games WHERE slug = 'sky-sprint'")
    const gameId = game.rows[0]!.id
    for (const entry of entries) {
      const user = await database.query<{ id: string }>(
        'INSERT INTO users (email, game_username) VALUES ($1, $2) RETURNING id',
        [entry.email, entry.username],
      )
      const userId = user.rows[0]!.id
      await database.query(
        "INSERT INTO score_submissions (game_id, user_id, score, status) VALUES ($1, $2, $3, 'approved')",
        [gameId, userId, entry.score],
      )
      await cache.zadd(`leaderboard:${gameId}`, entry.score, userId)
    }
  } finally {
    await database.end()
    await cache.quit()
  }
}

async function addApprovedLeaderboardEntryForUser(userId: string, score: number) {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error('Leaderboard setup requires PostgreSQL and Redis.')
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  const cache = new Redis(process.env.REDIS_URL)
  await database.connect()
  try {
    const game = await database.query<{ id: string }>("SELECT id FROM games WHERE slug = 'sky-sprint'")
    const gameId = game.rows[0]!.id
    await database.query(
      "INSERT INTO score_submissions (game_id, user_id, score, status) VALUES ($1, $2, $3, 'approved')",
      [gameId, userId, score],
    )
    await cache.zadd(`leaderboard:${gameId}`, score, userId)
  } finally {
    await database.end()
    await cache.quit()
  }
}

async function register(page: import('@playwright/test').Page, email: string, username: string) {
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('a-safe-test-password')
  await page.getByLabel('Game username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
}

test('visitor can browse seeded games and a seeded game leaderboard', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Game leaderboards' })).toBeVisible()
  await page.getByRole('link', { name: 'Sky Sprint' }).click()
  await expect(page.getByRole('heading', { name: 'Sky Sprint leaderboard' })).toBeVisible()
  await expect(page.getByLabel('Leaderboard').getByRole('listitem')).toContainText([
    '1. ada — 1200',
    '2. grace — 900',
  ])
})

test('public leaderboard pagination preserves competition ranks for ties', async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, 'Leaderboard setup requires the isolated E2E PostgreSQL service.')
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  await addApprovedLeaderboardEntries([
    ...[2500, 2400, 2300, 2200, 2100, 2000, 1900, 1800, 1700, 1600].map((score, index) => ({
      email: `leaderboard-${suffix}-${index}@example.test`, username: `board${suffix}${index}`, score,
    })),
    { email: `leaderboard-${suffix}-tie-a@example.test`, username: `tiea${suffix}`, score: 1500 },
    { email: `leaderboard-${suffix}-tie-b@example.test`, username: `tieb${suffix}`, score: 1500 },
  ])

  await page.goto('/games/sky-sprint')
  await expect(page.getByLabel('Leaderboard pages')).toContainText('Page 1 of 2')
  await expect(page.getByRole('list', { name: 'Leaderboard' })).toContainText(`1. board${suffix}0 — 2500`)
  await page.getByRole('button', { name: 'Next leaderboard page' }).click()
  await expect(page.getByLabel('Leaderboard pages')).toContainText('Page 2 of 2')
  const entries = page.getByRole('list', { name: 'Leaderboard' }).getByRole('listitem')
  const entryTexts = await entries.allTextContents()
  expect(entryTexts.filter((text) => text.includes(`tiea${suffix}`) || text.includes(`tieb${suffix}`))).toHaveLength(2)
  expect(entryTexts.filter((text) => text.includes(`tiea${suffix}`) || text.includes(`tieb${suffix}`))).toEqual(expect.arrayContaining([
    expect.stringMatching(/^11\.\s+/), expect.stringMatching(/^11\.\s+/),
  ]))
  expect(entryTexts.find((text) => text.includes('ada'))).toMatch(/^13\.\s+/)
  await page.getByRole('button', { name: 'Previous leaderboard page' }).click()
  await expect(page.getByLabel('Leaderboard pages')).toContainText('Page 1 of 2')
})

test('a signed-in player starts on their rank page and explicit navigation remains on that page', async ({ browser }) => {
  test.skip(!process.env.DATABASE_URL, 'Leaderboard setup requires the isolated E2E PostgreSQL service.')
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  await addApprovedLeaderboardEntries([2500, 2400, 2300, 2200, 2100, 2000, 1900, 1800, 1700, 1600, 1500, 1450]
    .map((score, index) => ({ email: `leaderboard-${suffix}-${index}@example.test`, username: `rank${suffix}${index}`, score })))
  const playerContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const playerPage = await playerContext.newPage()
  const email = `leaderboard-player-${suffix}@example.test`
  const username = `player${suffix}`
  await register(playerPage, email, username)
  const player = await playerPage.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  await addApprovedLeaderboardEntryForUser(player.id, 1400)

  await playerPage.goto('/games/sky-sprint')
  await expect(playerPage.getByLabel('Leaderboard pages')).toContainText('Page 2 of 2')
  await expect(playerPage.getByRole('list', { name: 'Leaderboard' })).toContainText(`13. ${username} — 1400`)
  await expect(playerPage).toHaveURL(/page=2/)
  await playerPage.getByRole('button', { name: 'Previous leaderboard page' }).click()
  await expect(playerPage.getByLabel('Leaderboard pages')).toContainText('Page 1 of 2')
  await expect(playerPage.getByRole('list', { name: 'Leaderboard' })).not.toContainText(username)
  await expect(playerPage).toHaveURL(/page=1/)

  await expect(playerPage.getByLabel('Leaderboard connection')).toHaveText('Live updates connected')
  await addApprovedLeaderboardEntries([{
    email: `leaderboard-refresh-${suffix}@example.test`, username: `refresh${suffix}`, score: 2600,
  }])
  await expect(playerPage.getByRole('list', { name: 'Leaderboard' })).toContainText(`1. refresh${suffix} — 2600`)
  await expect(playerPage.getByLabel('Leaderboard pages')).toContainText('Page 1 of 2')
  await expect(playerPage).toHaveURL(/page=1/)

  await playerContext.close()
})

test('public leaderboard views refresh live after approval without receiving moderation details', async ({ browser }) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const publicContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const publicPage = await publicContext.newPage()
  await publicPage.addInitScript(() => {
    const NativeEventSource = window.EventSource
    const events: string[] = []
    ;(window as typeof window & { leaderboardSseEvents?: string[] }).leaderboardSseEvents = events
    window.EventSource = class extends NativeEventSource {
      constructor(...args: ConstructorParameters<typeof EventSource>) {
        super(...args)
        this.addEventListener('changed', (event) => events.push(event.data))
      }
    }
  })
  await publicPage.goto('/games/sky-sprint')
  await expect(publicPage.getByLabel('Leaderboard connection')).toHaveText('Live updates connected')

  const playerContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const playerPage = await playerContext.newPage()
  const username = `live${suffix}`
  await register(playerPage, `leaderboard-live-${suffix}@example.test`, username)
  await playerPage.goto('/games/sky-sprint')
  await playerPage.getByLabel('Score', { exact: true }).fill('1600')
  await playerPage.getByRole('button', { name: 'Submit score' }).click()
  await expect(playerPage.getByRole('status')).toHaveText('Score submitted for review. It is pending until an admin reviews it.')
  const pending = await playerPage.waitForFunction(async () => {
    const response = await fetch('/api/scores')
    const history = await response.json()
    return history.submissions.find((submission: { status: string }) => submission.status === 'pending')
  }).then((submission) => submission.jsonValue() as Promise<{ id: string }>)

  const adminContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/login')
  await adminPage.getByLabel('Email').fill('admin@example.test')
  await adminPage.getByLabel('Password').fill('e2e-admin-password')
  await adminPage.getByRole('button', { name: 'Log in' }).click()
  await expect(adminPage.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  const approvalStatus = await adminPage.evaluate(
    (submissionId) => fetch(`/api/admin/scores/${submissionId}/approve`, { method: 'POST' }).then((response) => response.status),
    pending.id,
  )
  expect(approvalStatus).toBe(200)

  await expect(publicPage.getByRole('list', { name: 'Leaderboard' })).toContainText(`1. ${username} — 1600`)
  await expect.poll(() => publicPage.evaluate(() => (window as typeof window & { leaderboardSseEvents?: string[] }).leaderboardSseEvents ?? [])).toContain('leaderboard')
  await expect(publicPage.locator('main')).not.toContainText('moderated by')
  await expect(publicPage.locator('main')).not.toContainText('approved')

  await publicContext.close()
  await playerContext.close()
  await adminContext.close()
})
