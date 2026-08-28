import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  workers: process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : undefined,
  use: { baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000' },
  reporter: 'list',
})
