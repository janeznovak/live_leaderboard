import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'

async function stubGithubAuthorization(page: Page, code: 'github-player' | 'link-local' | 'link-state' | 'collision') {
  const response = await page.request.post('http://github:4000/__test/authorization-code', { data: { code } })
  expect(response.ok()).toBeTruthy()
}

async function register(page: Page, email: string, gameUsername: string) {
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('a-safe-test-password')
  await page.getByLabel('Game username').fill(gameUsername)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
}

async function beginGithubOAuth(page: Page, path: '/api/auth/github' | '/api/auth/github/link') {
  const response = await page.request.get(path, { maxRedirects: 0 })
  expect(response.status()).toBe(302)
  const location = response.headers().location
  expect(location).toBeTruthy()
  return location!
}

test.describe.configure({ mode: 'serial' })

test('GitHub sign-in, local linking, identity uniqueness, and public link presentation', async ({ page }) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`

  await stubGithubAuthorization(page, 'github-player')
  await page.goto('/login')
  await page.getByRole('link', { name: 'Continue with GitHub' }).click()
  await expect(page.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  await expect(page.getByText('Signed in as github-player@example.test.')).toBeVisible()
  await expect(page.getByText('Your public username is github-player-1001.')).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await register(page, `collision-local-${suffix}@example.test`, 'ada-1000')
  await page.getByRole('button', { name: 'Log out' }).click()
  await stubGithubAuthorization(page, 'collision')
  await page.goto('/login')
  await page.getByRole('link', { name: 'Continue with GitHub' }).click()
  await expect(page.getByText('Your public username is Ada-1000-2.')).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await register(page, `linked-local-${suffix}@example.test`, `linkedlocal${suffix}`)
  const localIdentity = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  await stubGithubAuthorization(page, 'link-local')
  await page.getByRole('link', { name: 'Connect GitHub' }).click()
  await expect(page.getByRole('status')).toHaveText('GitHub profile connected.')
  await expect(page.getByRole('link', { name: 'linked-local' })).toHaveAttribute('href', 'https://github.com/linked-local')
  const linkedIdentity = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  expect(linkedIdentity.id).toBe(localIdentity.id)

  await page.getByRole('button', { name: 'Log out' }).click()
  await register(page, `other-local-${suffix}@example.test`, `otherlocal${suffix}`)
  const otherIdentity = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  await stubGithubAuthorization(page, 'link-local')
  await page.getByRole('link', { name: 'Connect GitHub' }).click()
  await expect(page.getByRole('alert')).toHaveText('That GitHub identity is already connected to another user.')
  const identityAfterRejectedLink = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  expect(identityAfterRejectedLink.id).toBe(otherIdentity.id)

  await page.getByRole('button', { name: 'Log out' }).click()
  await page.goto('/games/sky-sprint')
  const leaderboard = page.getByRole('list', { name: 'Leaderboard' })
  await expect(leaderboard.getByTitle('No GitHub profile is available for this player.').filter({ hasText: 'ada' })).toBeVisible()

  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  await database.query(
    `INSERT INTO github_identities (github_id, user_id, github_login, profile_url)
     SELECT 'seeded-ada', id, 'ada-github', 'https://github.com/ada-github' FROM users WHERE email = 'ada@example.test'
     ON CONFLICT (github_id) DO UPDATE SET github_login = EXCLUDED.github_login, profile_url = EXCLUDED.profile_url`,
  )
  await database.end()

  await page.reload()
  await expect(leaderboard.getByRole('link', { name: 'ada' })).toHaveAttribute('href', 'https://github.com/ada-github')
  await expect(leaderboard.getByTitle('No GitHub profile is available for this player.').filter({ hasText: 'grace' })).toBeVisible()
})

test('GitHub OAuth states are browser-bound, single-use, and reuse an existing identity', async ({ page, browser }) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  await register(page, `state-local-${suffix}@example.test`, `statelocal${suffix}`)

  await stubGithubAuthorization(page, 'link-state')
  const linkAuthorizationUrl = await beginGithubOAuth(page, '/api/auth/github/link')
  const transferredBrowser = await browser.newContext()
  const transferredPage = await transferredBrowser.newPage()
  await transferredPage.goto(linkAuthorizationUrl)
  await expect(transferredPage.getByRole('alert')).toHaveText('Your GitHub sign-in link expired. Please try again.')
  await transferredBrowser.close()

  await page.goto(linkAuthorizationUrl)
  await expect(page.getByRole('status')).toHaveText('GitHub profile connected.')

  await page.getByRole('button', { name: 'Log out' }).click()
  await stubGithubAuthorization(page, 'github-player')
  const firstAuthorizationUrl = await beginGithubOAuth(page, '/api/auth/github')
  await page.goto(firstAuthorizationUrl)
  const firstIdentity = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  await expect(page.getByText('Signed in as github-player@example.test.')).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await stubGithubAuthorization(page, 'github-player')
  const repeatedAuthorizationUrl = await beginGithubOAuth(page, '/api/auth/github')
  await page.goto(repeatedAuthorizationUrl)
  const repeatedIdentity = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  expect(repeatedIdentity.id).toBe(firstIdentity.id)

  await page.goto(repeatedAuthorizationUrl)
  await expect(page.getByRole('alert')).toHaveText('Your GitHub sign-in link expired. Please try again.')
  await page.goto('/api/auth/github/callback?state=not-a-state&state=second-value&code=github-player&code=second-code')
  await expect(page.getByRole('alert')).toHaveText('Your GitHub sign-in link expired. Please try again.')

  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  const identities = await database.query<{ count: string }>("SELECT count(*)::text AS count FROM github_identities WHERE github_id = '1001'")
  const users = await database.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE email = 'github-player@example.test'")
  await database.end()
  expect(identities.rows[0]?.count).toBe('1')
  expect(users.rows[0]?.count).toBe('1')
})
