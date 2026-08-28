import { expect, test } from '@playwright/test'

test('a player can register, rename their unique game username, and log in again', async ({ page }) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const email = `player-${suffix}@example.test`
  const password = 'a-safe-test-password'
  const firstUsername = `player${suffix}`
  const renamedUsername = `renamed${suffix}`

  const unauthenticated = await page.request.get('/api/auth/me')
  expect(unauthenticated.status()).toBe(401)

  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Game username').fill(firstUsername)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Your player profile' })).toBeVisible()
  await expect(page.getByText(`Your public username is ${firstUsername}.`)).toBeVisible()

  const identityBeforeRename = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  await page.getByLabel('Game username').fill('ada')
  await page.getByRole('button', { name: 'Save username' }).click()
  await expect(page.getByRole('alert')).toHaveText('That game username is already in use.')
  await expect(page.getByText(`Your public username is ${firstUsername}.`)).toBeVisible()

  await page.getByLabel('Game username').fill(renamedUsername)
  await page.getByRole('button', { name: 'Save username' }).click()
  await expect(page.getByRole('status')).toHaveText('Game username updated.')
  await expect(page.getByText(`Your public username is ${renamedUsername}.`)).toBeVisible()
  const identityAfterRename = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.json()))
  expect(identityAfterRename.id).toBe(identityBeforeRename.id)
  expect(identityAfterRename.gameUsername).toBe(renamedUsername)

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Game leaderboards' })).toBeVisible()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText(`Your public username is ${renamedUsername}.`)).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await page.goto('/register')
  await page.getByLabel('Email').fill(`other-${suffix}@example.test`)
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Game username').fill(renamedUsername)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('alert')).toHaveText('That game username is already in use.')
})
