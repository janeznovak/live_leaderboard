import { expect, test, type Page } from '@playwright/test'
import Redis from 'ioredis'
import { Client } from 'pg'

const generatedReportEmailPattern = 'report-%'

type Clock = {
  todayStart: Date
  todayEnd: Date
  weekStart: Date
  weekEnd: Date
  monthStart: Date
  monthEnd: Date
  yearStart: Date
  yearEnd: Date
}

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
      [generatedReportEmailPattern],
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
      [generatedReportEmailPattern],
    )
    await database.query('DELETE FROM users WHERE email LIKE $1', [generatedReportEmailPattern])
  } finally {
    await database.end()
  }
})

async function reportClock(): Promise<Clock> {
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  try {
    const result = await database.query<Clock>(
      `SELECT
         date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "todayStart",
         date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 day' AS "todayEnd",
         date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "weekStart",
         date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 week' AS "weekEnd",
         date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "monthStart",
         date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month' AS "monthEnd",
         date_trunc('year', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "yearStart",
         date_trunc('year', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 year' AS "yearEnd"`,
    )
    return result.rows[0]!
  } finally {
    await database.end()
  }
}

async function addSubmission(options: {
  email: string
  username: string
  score: number
  status: 'pending' | 'approved' | 'declined'
  submittedAt: Date
  moderatedAt?: Date
  gameSlug?: 'sky-sprint' | 'orbital-dodger'
}) {
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  try {
    const game = await database.query<{ id: string }>('SELECT id FROM games WHERE slug = $1', [options.gameSlug ?? 'sky-sprint'])
    const user = await database.query<{ id: string }>(
      'INSERT INTO users (email, game_username) VALUES ($1, $2) RETURNING id',
      [options.email, options.username],
    )
    await database.query(
      `INSERT INTO score_submissions (game_id, user_id, score, status, submitted_at, moderated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [game.rows[0]!.id, user.rows[0]!.id, options.score, options.status, options.submittedAt, options.moderatedAt ?? null],
    )
    return { gameId: game.rows[0]!.id, userId: user.rows[0]!.id }
  } finally {
    await database.end()
  }
}

async function addApprovedSubmissionForUser(gameId: string, userId: string, score: number, submittedAt: Date) {
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  try {
    await database.query(
      `INSERT INTO score_submissions (game_id, user_id, score, status, submitted_at, moderated_at)
       VALUES ($1, $2, $3, 'approved', $4, now())`,
      [gameId, userId, score, submittedAt],
    )
  } finally {
    await database.end()
  }
}

async function readReport(page: Page, period: string, reportPage?: string, gameSlug = 'sky-sprint') {
  const query = new URLSearchParams({ period })
  if (reportPage) query.set('page', reportPage)
  const response = await page.request.get(`/api/games/${gameSlug}/report?${query}`)
  return { status: response.status(), body: await response.json() }
}

async function allReportEntries(page: Page, period: string, gameSlug = 'sky-sprint') {
  const firstPage = await readReport(page, period, undefined, gameSlug)
  expect(firstPage.status).toBe(200)
  const entries = [...firstPage.body.entries]
  for (let pageNumber = 2; pageNumber <= firstPage.body.totalPages; pageNumber++) {
    const additionalPage = await readReport(page, period, String(pageNumber), gameSlug)
    expect(additionalPage.status).toBe(200)
    entries.push(...additionalPage.body.entries)
  }
  return { ...firstPage.body, entries }
}

test('public reports enforce every UTC boundary, approval status, and each player’s highest qualifying score', async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, 'Period report setup requires the isolated E2E PostgreSQL service.')
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const clock = await reportClock()
  const email = (name: string) => `report-${suffix}-${name}@example.test`
  const username = (name: string) => `report${suffix}${name}`
  const boundedPeriods = [
    { period: 'today', start: clock.todayStart, end: clock.todayEnd },
    { period: 'this-week', start: clock.weekStart, end: clock.weekEnd },
    { period: 'this-month', start: clock.monthStart, end: clock.monthEnd },
    { period: 'this-year', start: clock.yearStart, end: clock.yearEnd },
  ]
  for (const { period, start, end } of boundedPeriods) {
    await Promise.all([
      addSubmission({ email: email(`${period}-before`), username: username(`${period}before`), score: 100, status: 'approved', submittedAt: new Date(start.getTime() - 1) }),
      addSubmission({ email: email(`${period}-start`), username: username(`${period}start`), score: 101, status: 'approved', submittedAt: start }),
      addSubmission({ email: email(`${period}-end-before`), username: username(`${period}endbefore`), score: 102, status: 'approved', submittedAt: new Date(end.getTime() - 1) }),
      addSubmission({ email: email(`${period}-end`), username: username(`${period}end`), score: 103, status: 'approved', submittedAt: end }),
    ])
    const report = await allReportEntries(page, period)
    const usernames = report.entries.map((entry: { username: string }) => entry.username)
    expect(usernames).toEqual(expect.arrayContaining([username(`${period}start`), username(`${period}endbefore`)]))
    expect(usernames).not.toEqual(expect.arrayContaining([username(`${period}before`), username(`${period}end`)]))
    if (period === 'this-week') {
      expect(new Date(report.period.startsAt).getUTCDay()).toBe(1)
      expect(new Date(report.period.startsAt).getUTCHours()).toBe(0)
      expect(new Date(report.period.startsAt).getUTCMinutes()).toBe(0)
      expect(new Date(report.period.startsAt).toISOString()).toBe(clock.weekStart.toISOString())
    }
  }

  await addSubmission({ email: email('all-time'), username: username('alltime'), score: 99, status: 'approved', submittedAt: new Date(clock.yearStart.getTime() - 1) })
  expect((await allReportEntries(page, 'all-time')).entries.map((entry: { username: string }) => entry.username)).toContain(username('alltime'))

  const highest = await addSubmission({ email: email('highest'), username: username('highest'), score: 5_000, status: 'approved', submittedAt: clock.todayStart })
  await addApprovedSubmissionForUser(highest.gameId, highest.userId, 4_000, clock.todayStart)
  await Promise.all([
    addSubmission({ email: email('pending'), username: username('pending'), score: 6_000, status: 'pending', submittedAt: clock.todayStart }),
    addSubmission({ email: email('declined'), username: username('declined'), score: 5_900, status: 'declined', submittedAt: clock.todayStart }),
    // This approval occurs after today's end, but membership follows submitted_at.
    addSubmission({ email: email('late'), username: username('late'), score: 4_500, status: 'approved', submittedAt: clock.todayStart, moderatedAt: new Date(clock.todayEnd.getTime() + 1) }),
  ])
  const todayEntries = (await allReportEntries(page, 'today')).entries as Array<{ username: string; score: number; userId?: string }>
  expect(todayEntries.filter((entry) => entry.username === username('highest'))).toEqual([expect.objectContaining({ score: 5_000 })])
  expect(todayEntries.map((entry) => entry.username)).toEqual(expect.arrayContaining([username('late')]))
  expect(todayEntries.map((entry) => entry.username)).not.toEqual(expect.arrayContaining([username('pending'), username('declined')]))
  expect(todayEntries.find((entry) => entry.username === username('highest'))).not.toHaveProperty('userId')

  const invalidPeriod = await page.request.get('/api/games/sky-sprint/report?period=forever')
  const invalidPage = await page.request.get('/api/games/sky-sprint/report?period=today&page=0')
  const unknownGame = await page.request.get('/api/games/not-a-game/report?period=today')
  expect(invalidPeriod.status()).toBe(400)
  expect(invalidPage.status()).toBe(400)
  expect(unknownGame.status()).toBe(404)

  await page.goto('/games/sky-sprint')
  await expect(page.getByRole('heading', { name: 'Period report' })).toBeVisible()
  await expect(page.getByLabel('Report period')).toHaveValue('today')
  await page.getByLabel('Report period').selectOption('this-year')
  await expect(page.getByRole('heading', { name: 'This year report' })).toBeVisible()
  await expect(page.getByText('Calendar periods use UTC; weeks begin Monday at 00:00 UTC.')).toBeVisible()
})

test('the public report selector isolates the selected game', async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, 'Period report setup requires the isolated E2E PostgreSQL service.')
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const clock = await reportClock()
  const skyUsername = `report${suffix}skyonly`
  const orbitalUsername = `report${suffix}orbitalonly`
  await Promise.all([
    addSubmission({ email: `report-${suffix}-sky@example.test`, username: skyUsername, score: 7_000, status: 'approved', submittedAt: clock.todayStart }),
    addSubmission({ email: `report-${suffix}-orbital@example.test`, username: orbitalUsername, score: 8_000, status: 'approved', submittedAt: clock.todayStart, gameSlug: 'orbital-dodger' }),
  ])

  await page.goto('/games/sky-sprint')
  await expect(page.getByRole('list', { name: 'Period report' })).toContainText(skyUsername)
  await expect(page.getByRole('list', { name: 'Period report' })).not.toContainText(orbitalUsername)
  await page.getByLabel('Game').selectOption('orbital-dodger')
  await expect(page).toHaveURL(/\/games\/orbital-dodger/)
  await expect(page.getByRole('heading', { name: 'Orbital Dodger leaderboard' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Period report' })).toContainText(orbitalUsername)
  await expect(page.getByRole('list', { name: 'Period report' })).not.toContainText(skyUsername)
})

test('period reports paginate tied groups with competition ranks', async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, 'Period report setup requires the isolated E2E PostgreSQL service.')
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const clock = await reportClock()
  const email = (name: string) => `report-${suffix}-page-${name}@example.test`
  const username = (name: string) => `report${suffix}page${name}`
  await Promise.all([3000, 2900, 2800, 2700, 2600, 2500, 2400, 2300, 2200].map((score, index) => addSubmission({
    email: email(String(index)), username: username(String(index)), score, status: 'approved', submittedAt: clock.todayStart,
  })))
  await Promise.all(['a', 'b'].map((name) => addSubmission({
    email: email(`tie-${name}`), username: username(`tie${name}`), score: 2000, status: 'approved', submittedAt: clock.todayStart,
  })))

  await page.goto('/games/sky-sprint')
  await expect(page.getByLabel('Period report pages')).toContainText('Page 1 of 2')
  const firstPageEntries = await page.getByRole('list', { name: 'Period report' }).getByRole('listitem').allTextContents()
  expect(firstPageEntries.filter((entry) => entry.includes(username('tiea')) || entry.includes(username('tieb')))).toEqual([
    expect.stringMatching(/^10\.\s+/),
  ])
  await page.getByRole('button', { name: 'Next period report page' }).click()
  await expect(page.getByLabel('Period report pages')).toContainText('Page 2 of 2')
  const entries = await page.getByRole('list', { name: 'Period report' }).getByRole('listitem').allTextContents()
  expect(entries.filter((entry) => entry.includes(username('tiea')) || entry.includes(username('tieb')))).toEqual([
    expect.stringMatching(/^10\.\s+/),
  ])
})

test('a lower approved score refreshes an open period report even when Redis already has a higher all-time best', async ({ page }) => {
  test.skip(!process.env.DATABASE_URL || !process.env.REDIS_URL, 'Period report live update setup requires isolated PostgreSQL and Redis services.')
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const clock = await reportClock()
  const email = `report-${suffix}-live@example.test`
  const username = `report${suffix}live`
  const higher = await addSubmission({
    email, username, score: 1_000, status: 'approved', submittedAt: new Date(clock.todayStart.getTime() - 1),
  })
  const cache = new Redis(process.env.REDIS_URL!)
  await cache.zadd(`leaderboard:${higher.gameId}`, 1_000, higher.userId)
  await cache.quit()

  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource
    const events: string[] = []
    ;(window as typeof window & { publicRankingSseEvents?: string[] }).publicRankingSseEvents = events
    window.EventSource = class extends NativeEventSource {
      constructor(...args: ConstructorParameters<typeof EventSource>) {
        super(...args)
        this.addEventListener('changed', (event) => events.push(event.data))
      }
    }
  })
  await page.goto('/games/sky-sprint')
  await expect(page.getByLabel('Period report connection')).toHaveText('Live updates connected')
  await expect(page.getByRole('list', { name: 'Period report' })).not.toContainText(username)
  // Add the qualifying lower score to the same player without altering Redis.
  const database = new Client({ connectionString: process.env.DATABASE_URL })
  await database.connect()
  try {
    await database.query(
      `INSERT INTO score_submissions (game_id, user_id, score, status, submitted_at, moderated_at)
       VALUES ($1, $2, 500, 'approved', $3, now())`,
      [higher.gameId, higher.userId, clock.todayStart],
    )
  } finally {
    await database.end()
  }
  await expect(page.getByRole('list', { name: 'Period report' })).toContainText(`${username} — 500`)
  await expect.poll(() => page.evaluate(() => (window as typeof window & { publicRankingSseEvents?: string[] }).publicRankingSseEvents ?? [])).toContain('report')
  expect(await page.evaluate(() => (window as typeof window & { publicRankingSseEvents?: string[] }).publicRankingSseEvents ?? [])).not.toContain('leaderboard')
})
