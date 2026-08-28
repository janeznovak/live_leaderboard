import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'

type ApiResponse = { status: number; body: any; outgoingJson: string }

async function postScore(page: Page, body: unknown, slug = 'sky-sprint'): Promise<ApiResponse> {
  return page.evaluate(async ({ body: requestBody, slug: gameSlug }) => {
    const response = await fetch(`/api/games/${gameSlug}/scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    return { status: response.status, body: await response.json(), outgoingJson: JSON.stringify(requestBody) }
  }, { body, slug })
}

test('players can submit only valid personal scores, then see their private current-username history', async ({ browser, page }) => {
  test.skip(!process.env.DATABASE_URL, 'Cooldown setup requires the isolated E2E PostgreSQL service.')
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const password = 'a-safe-test-password'
  const email = `score-player-${suffix}@example.test`
  const username = `scorer${suffix}`
  const renamedUsername = `renamed${suffix}`
  const maximumScore = Number.MAX_SAFE_INTEGER
  const invalidScoreMessage = `Score must be a non-negative whole number no greater than ${maximumScore}.`

  const unauthenticated = await page.request.post('/api/games/sky-sprint/scores', { data: { score: 100 } })
  expect(unauthenticated.status()).toBe(401)

  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Game username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  const currentUser = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))

  const otherContext = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' })
  const otherPage = await otherContext.newPage()
  const otherEmail = `other-score-player-${suffix}@example.test`
  await otherPage.goto('/register')
  await otherPage.getByLabel('Email').fill(otherEmail)
  await otherPage.getByLabel('Password').fill(password)
  await otherPage.getByLabel('Game username').fill(`other${suffix}`)
  await otherPage.getByRole('button', { name: 'Create account' }).click()
  await expect(otherPage.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  const otherUser = await otherPage.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))

  const beforeLeaderboard = await page.evaluate(() => fetch('/api/games/sky-sprint/leaderboard').then((response) => response.json()))
  const beforeOrbitalLeaderboard = await page.evaluate(() => fetch('/api/games/orbital-dodger/leaderboard').then((response) => response.json()))
  for (const score of [-1, 1.5, '200', maximumScore + 1]) {
    const invalid = await postScore(page, { score })
    expect(invalid.status).toBe(400)
    expect(invalid.body.statusMessage).toBe(invalidScoreMessage)
  }
  const currentUserBeforeOwnershipCheck = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  const otherUserBeforeOwnershipCheck = await otherPage.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  expect(currentUserBeforeOwnershipCheck.id).toBe(currentUser.id)
  expect(otherUserBeforeOwnershipCheck.id).toBe(otherUser.id)
  expect(currentUserBeforeOwnershipCheck.id).not.toBe(otherUserBeforeOwnershipCheck.id)
  const crossUserRequest = { score: 200, userId: otherUserBeforeOwnershipCheck.id }
  const anotherUsersScore = await postScore(page, crossUserRequest, 'orbital-dodger')
  expect(anotherUsersScore.outgoingJson).toBe(JSON.stringify(crossUserRequest))
  expect(anotherUsersScore.status).toBe(403)
  expect(anotherUsersScore.body.statusMessage).toBe('You can submit scores only for your own account.')

  await page.goto('/games/sky-sprint')
  await page.getByLabel('Score', { exact: true }).fill(String(maximumScore))
  await page.getByRole('button', { name: 'Submit score' }).click()
  await expect(page.getByRole('status')).toHaveText('Score submitted for review. It is pending until an admin reviews it.')
  await page.locator('#score').evaluate((input: HTMLInputElement) => input.removeAttribute('min'))
  await page.getByLabel('Score', { exact: true }).fill('-1')
  await page.getByRole('button', { name: 'Submit score' }).click()
  await expect(page.getByRole('alert')).toHaveText(invalidScoreMessage)

  const parallel = await Promise.all([
    postScore(page, { score: 314 }, 'orbital-dodger'),
    postScore(page, { score: 271 }, 'orbital-dodger'),
  ])
  expect(parallel.map((response) => response.status).sort()).toEqual([201, 409])
  const accepted = parallel.find((response) => response.status === 201)!.body
  expect(accepted.status).toBe('pending')
  const duplicate = parallel.find((response) => response.status === 409)!.body
  expect(duplicate.statusMessage).toBe('You already have a pending score for this game.')

  const afterLeaderboard = await page.evaluate(() => fetch('/api/games/sky-sprint/leaderboard').then((response) => response.json()))
  const afterOrbitalLeaderboard = await page.evaluate(() => fetch('/api/games/orbital-dodger/leaderboard').then((response) => response.json()))
  expect(afterLeaderboard).toEqual(beforeLeaderboard)
  expect(afterOrbitalLeaderboard).toEqual(beforeOrbitalLeaderboard)

  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Your score history' })).toBeVisible()
  await expect(page.getByLabel('Your score submissions')).toContainText(`Sky Sprint — ${username} — ${maximumScore} — pending`)

  const otherHistory = await otherPage.evaluate(async (userId) => {
    const response = await fetch(`/api/scores?userId=${userId}`)
    return response.json()
  }, currentUser.id)
  expect(otherHistory.submissions).toEqual([])

  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  await database.query(
    `INSERT INTO score_submissions (game_id, user_id, score, status, submitted_at)
     SELECT id, $1, 900, 'approved', now() - interval '10 minutes'
     FROM games WHERE slug = 'sky-sprint'`,
    [currentUser.id],
  )
  await database.query(
    `INSERT INTO score_submissions (game_id, user_id, score, status, submitted_at)
     SELECT id, $1, 800, 'declined', now() - interval '9 minutes'
     FROM games WHERE slug = 'sky-sprint'`,
    [currentUser.id],
  )
  await page.reload()
  const history = page.getByLabel('Your score submissions')
  await expect(history).toContainText(`Sky Sprint — ${username} — ${maximumScore} — pending`)
  await expect(history).toContainText(`Sky Sprint — ${username} — 900 — approved`)
  await expect(history).toContainText(`Sky Sprint — ${username} — 800 — declined`)

  await page.getByLabel('Game username').fill(renamedUsername)
  await page.getByRole('button', { name: 'Save username' }).click()
  await expect(page.getByRole('status')).toHaveText('Game username updated.')
  await expect(history).toContainText(`Sky Sprint — ${renamedUsername} — ${maximumScore} — pending`)
  await expect(history).toContainText(`Sky Sprint — ${renamedUsername} — 900 — approved`)
  await expect(history).toContainText(`Sky Sprint — ${renamedUsername} — 800 — declined`)

  await database.query("UPDATE score_submissions SET status = 'declined' WHERE id = $1", [accepted.id])
  await database.end()

  await page.goto('/games/orbital-dodger')
  await page.getByLabel('Score', { exact: true }).fill('500')
  await page.getByRole('button', { name: 'Submit score' }).click()
  await expect(page.getByRole('alert')).toHaveText(/You can submit another score after .+\./)

  await otherContext.close()
})
