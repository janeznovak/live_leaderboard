import { expect, test, type Page } from '@playwright/test'
import Redis from 'ioredis'
import { Client } from 'pg'

const adminEmail = 'admin@example.test'
const adminPassword = 'e2e-admin-password'
const generatedUserEmailPatterns = ['admin-denied-%', 'oldest-%', 'newest-%', 'best-%', 'race-%', 'replacement-%']

test.afterEach(async () => {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) return
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  try {
    const leaderboardMembers = await database.query<{ game_id: string; user_id: string }>(
      `SELECT score_submissions.game_id, score_submissions.user_id
       FROM score_submissions
       JOIN users ON users.id = score_submissions.user_id
       WHERE users.email LIKE ANY($1::text[])`,
      [generatedUserEmailPatterns],
    )
    const cache = new Redis(process.env.REDIS_URL)
    try {
      await Promise.all(leaderboardMembers.rows.map((entry) => cache.zrem(`leaderboard:${entry.game_id}`, entry.user_id)))
    } finally {
      await cache.quit()
    }
    await database.query(
      `DELETE FROM score_submissions
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE ANY($1::text[]))`,
      [generatedUserEmailPatterns],
    )
    await database.query('DELETE FROM users WHERE email LIKE ANY($1::text[])', [generatedUserEmailPatterns])
  } finally {
    await database.end()
  }
})

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
}

async function registerAndSubmit(page: Page, email: string, username: string, score: number) {
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('a-safe-test-password')
  await page.getByLabel('Game username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  await page.goto('/games/sky-sprint')
  await page.getByLabel('Score', { exact: true }).fill(String(score))
  await page.getByRole('button', { name: 'Submit score' }).click()
  await expect(page.getByRole('status')).toHaveText('Score submitted for review. It is pending until an admin reviews it.')
}

async function ownPendingSubmission(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/scores')
    const history = await response.json()
    return history.submissions.find((submission: { status: string }) => submission.status === 'pending')
  })
}

async function moderate(page: Page, submissionId: string, action: 'approve' | 'decline') {
  return page.evaluate(async ({ id, moderationAction }) => {
    const response = await fetch(`/api/admin/scores/${id}/${moderationAction}`, { method: 'POST' })
    return { status: response.status, body: await response.json() }
  }, { id: submissionId, moderationAction: action })
}

async function leaderboardEntry(page: Page, username: string) {
  return page.evaluate(async (currentUsername) => {
    const response = await fetch('/api/games/sky-sprint/leaderboard')
    const leaderboard = await response.json()
    return leaderboard.entries.find((entry: { username: string }) => entry.username === currentUsername)
  }, username)
}

async function makeLatestSubmissionOldEnough(submissionId: string) {
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  await database.query("UPDATE score_submissions SET submitted_at = now() - interval '6 minutes' WHERE id = $1", [submissionId])
  await database.end()
}

async function replacePendingSubmission(existingSubmissionId: string, replacementUserId: string) {
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  try {
    await database.query('BEGIN')
    await database.query("UPDATE score_submissions SET status = 'declined', moderated_at = now() WHERE id = $1", [existingSubmissionId])
    await database.query(
      `INSERT INTO score_submissions (game_id, user_id, score, status)
       SELECT id, $1, 321, 'pending' FROM games WHERE slug = 'sky-sprint'`,
      [replacementUserId],
    )
    await database.query('COMMIT')
  } catch (error) {
    await database.query('ROLLBACK')
    throw error
  } finally {
    await database.end()
  }
}

test('only the manually seeded admin can open moderation APIs and the review page', async ({ browser, page }) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const anonymousQueue = await page.request.get('/api/admin/review-queue')
  const anonymousHistory = await page.request.get('/api/admin/scores')
  const anonymousEvents = await page.request.get('/api/admin/review-queue/events')
  const anonymousDecision = await page.request.post('/api/admin/scores/00000000-0000-0000-0000-000000000000/approve')
  expect(anonymousQueue.status()).toBe(401)
  expect(anonymousHistory.status()).toBe(401)
  expect(anonymousEvents.status()).toBe(401)
  expect(anonymousDecision.status()).toBe(401)

  await page.goto('/register')
  await page.getByLabel('Email').fill(`admin-denied-${suffix}@example.test`)
  await page.getByLabel('Password').fill('a-safe-test-password')
  await page.getByLabel('Game username').fill(`denied${suffix}`)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  const playerIdentity = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  expect(playerIdentity.role).toBe('player')
  await expect(page.getByRole('link', { name: 'Open score moderation' })).toHaveCount(0)
  const playerQueue = await page.request.get('/api/admin/review-queue')
  const playerHistory = await page.request.get('/api/admin/scores')
  const playerEvents = await page.request.get('/api/admin/review-queue/events')
  const playerDecision = await page.request.post('/api/admin/scores/00000000-0000-0000-0000-000000000000/decline')
  expect(playerQueue.status()).toBe(403)
  expect(playerHistory.status()).toBe(403)
  expect(playerEvents.status()).toBe(403)
  expect(playerDecision.status()).toBe(403)

  const adminContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const adminPage = await adminContext.newPage()
  await login(adminPage, adminEmail, adminPassword)
  await expect(adminPage.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  await expect(adminPage.getByRole('link', { name: 'Open score moderation' })).toBeVisible()
  await adminPage.getByRole('link', { name: 'Open score moderation' }).click()
  await expect(adminPage.getByRole('heading', { name: 'Score moderation' })).toBeVisible()
  await expect(adminPage.getByLabel('Pending reviews')).toBeVisible()
  await adminContext.close()
})

test('the admin review queue refreshes live, orders oldest first, and records approval and decline history', async ({ browser }) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const adminContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const adminPage = await adminContext.newPage()
  await login(adminPage, adminEmail, adminPassword)
  await adminPage.goto('/admin')
  await expect(adminPage.getByRole('heading', { name: 'Score moderation' })).toBeVisible()
  await expect(adminPage.getByLabel('Pending reviews')).toHaveText('Pending reviews: 0')
  await expect(adminPage.getByLabel('Review queue connection')).toHaveText('Live updates connected')

  const firstPlayerContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const firstPlayerPage = await firstPlayerContext.newPage()
  const secondPlayerContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const secondPlayerPage = await secondPlayerContext.newPage()
  const firstUsername = `oldest${suffix}`
  const secondUsername = `newest${suffix}`
  await registerAndSubmit(firstPlayerPage, `oldest-${suffix}@example.test`, firstUsername, 765)
  await registerAndSubmit(secondPlayerPage, `newest-${suffix}@example.test`, secondUsername, 432)

  const queue = adminPage.getByLabel('Pending score submissions')
  await expect(adminPage.getByLabel('Pending reviews')).toHaveText('Pending reviews: 2')
  const queueItems = queue.getByRole('listitem')
  await expect(queueItems.nth(0)).toContainText(firstUsername)
  await expect(queueItems.nth(1)).toContainText(secondUsername)

  await adminPage.getByRole('button', { name: `Approve score 765 from ${firstUsername}` }).click()
  await expect(adminPage.getByLabel('Pending reviews')).toHaveText('Pending reviews: 1')
  await adminPage.getByRole('button', { name: `Decline score 432 from ${secondUsername}` }).click()
  await expect(adminPage.getByLabel('Pending reviews')).toHaveText('Pending reviews: 0')
  const history = adminPage.getByLabel('All score submissions')
  await expect(history).toContainText(`Sky Sprint — ${firstUsername} — 765 — approved — submitted`)
  await expect(history).toContainText(`moderated by moderator at`)
  await expect(history).toContainText(`Sky Sprint — ${secondUsername} — 432 — declined — submitted`)

  await firstPlayerContext.close()
  await secondPlayerContext.close()
  await adminContext.close()
})

test('the live queue refreshes when one pending submission is replaced without changing its count', async ({ browser }) => {
  test.skip(!process.env.DATABASE_URL, 'Queue replacement setup requires the isolated E2E PostgreSQL service.')
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const adminContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const adminPage = await adminContext.newPage()
  await login(adminPage, adminEmail, adminPassword)
  await adminPage.goto('/admin')
  await expect(adminPage.getByLabel('Review queue connection')).toHaveText('Live updates connected')

  const originalPlayerContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const originalPlayerPage = await originalPlayerContext.newPage()
  const originalUsername = `oldqueue${suffix}`
  await registerAndSubmit(originalPlayerPage, `oldest-${suffix}@example.test`, originalUsername, 654)
  const originalPending = await ownPendingSubmission(originalPlayerPage)
  await expect(adminPage.getByLabel('Pending reviews')).toHaveText('Pending reviews: 1')

  const replacementPlayerContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const replacementPlayerPage = await replacementPlayerContext.newPage()
  const replacementUsername = `newqueue${suffix}`
  await replacementPlayerPage.goto('/register')
  await replacementPlayerPage.getByLabel('Email').fill(`replacement-${suffix}@example.test`)
  await replacementPlayerPage.getByLabel('Password').fill('a-safe-test-password')
  await replacementPlayerPage.getByLabel('Game username').fill(replacementUsername)
  await replacementPlayerPage.getByRole('button', { name: 'Create account' }).click()
  await expect(replacementPlayerPage.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  const replacementUser = await replacementPlayerPage.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))

  await replacePendingSubmission(originalPending.id, replacementUser.id)
  const queue = adminPage.getByLabel('Pending score submissions')
  await expect(adminPage.getByLabel('Pending reviews')).toHaveText('Pending reviews: 1')
  await expect(queue).toContainText(replacementUsername)
  await expect(queue).not.toContainText(originalUsername)

  await originalPlayerContext.close()
  await replacementPlayerContext.close()
  await adminContext.close()
})

test('approval keeps a lower approved score in history without lowering its game leaderboard, while decline leaves it unchanged', async ({ browser }) => {
  test.skip(!process.env.DATABASE_URL, 'Submission timing setup requires the isolated E2E PostgreSQL service.')
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const username = `best${suffix}`
  const playerContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const playerPage = await playerContext.newPage()
  const adminContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const adminPage = await adminContext.newPage()
  await registerAndSubmit(playerPage, `best-${suffix}@example.test`, username, 1000)
  const first = await ownPendingSubmission(playerPage)
  await login(adminPage, adminEmail, adminPassword)
  expect((await moderate(adminPage, first.id, 'approve')).status).toBe(200)
  await expect.poll(() => leaderboardEntry(playerPage, username)).toMatchObject({ score: 1000 })

  await makeLatestSubmissionOldEnough(first.id)
  await playerPage.goto('/games/sky-sprint')
  await playerPage.getByLabel('Score', { exact: true }).fill('300')
  await playerPage.getByRole('button', { name: 'Submit score' }).click()
  const lower = await ownPendingSubmission(playerPage)
  expect((await moderate(adminPage, lower.id, 'approve')).status).toBe(200)
  await expect.poll(() => leaderboardEntry(playerPage, username)).toMatchObject({ score: 1000 })
  const approvedHistory = await adminPage.evaluate(() => fetch('/api/admin/scores').then((response) => response.json()))
  expect(approvedHistory.submissions.filter((submission: { user: { gameUsername: string }; status: string }) => submission.user.gameUsername === username && submission.status === 'approved')).toHaveLength(2)

  await makeLatestSubmissionOldEnough(lower.id)
  await playerPage.getByLabel('Score', { exact: true }).fill('200')
  await playerPage.getByRole('button', { name: 'Submit score' }).click()
  const declined = await ownPendingSubmission(playerPage)
  expect((await moderate(adminPage, declined.id, 'decline')).status).toBe(200)
  await expect.poll(() => leaderboardEntry(playerPage, username)).toMatchObject({ score: 1000 })

  await playerContext.close()
  await adminContext.close()
})

test('competing admin decisions yield exactly one terminal moderation result', async ({ browser }) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const playerContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const playerPage = await playerContext.newPage()
  await registerAndSubmit(playerPage, `race-${suffix}@example.test`, `race${suffix}`, 678)
  const pending = await ownPendingSubmission(playerPage)

  const firstAdminContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const secondAdminContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const firstAdminPage = await firstAdminContext.newPage()
  const secondAdminPage = await secondAdminContext.newPage()
  await login(firstAdminPage, adminEmail, adminPassword)
  await login(secondAdminPage, adminEmail, adminPassword)
  const decisions = await Promise.all([
    moderate(firstAdminPage, pending.id, 'approve'),
    moderate(secondAdminPage, pending.id, 'decline'),
  ])
  expect(decisions.map((decision) => decision.status).sort()).toEqual([200, 409])
  const history = await firstAdminPage.evaluate(() => fetch('/api/admin/scores').then((response) => response.json()))
  const resolved = history.submissions.find((submission: { id: string }) => submission.id === pending.id)
  expect(resolved).toMatchObject({ id: pending.id, status: expect.stringMatching(/^(approved|declined)$/), moderatedBy: { gameUsername: 'moderator' } })

  await playerContext.close()
  await firstAdminContext.close()
  await secondAdminContext.close()
})
