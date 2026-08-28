import { expect, test } from '@playwright/test'

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
