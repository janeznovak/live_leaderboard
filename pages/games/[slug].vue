<script setup lang="ts">
type LeaderboardResponse = {
  game: { id: string; name: string; slug: string }
  entries: Array<{ userId: string; username: string; score: number; rank: number; githubProfileUrl?: string }>
  page: number
  pageSize: number
  totalEntries: number
  totalPages: number
}
type CurrentUser = { id: string; email: string; gameUsername: string; role: 'player' | 'admin' }
type ReportPeriod = 'today' | 'this-week' | 'this-month' | 'this-year' | 'all-time'
type PeriodReportResponse = {
  period: { id: ReportPeriod; label: string; startsAt?: string; endsAt?: string }
  entries: Array<{ username: string; score: number; rank: number; githubProfileUrl?: string }>
  page: number
  totalPages: number
}

const reportPeriodOptions: Array<{ value: ReportPeriod; label: string }> = [
  { value: 'today', label: 'Today (UTC)' },
  { value: 'this-week', label: 'This week (UTC)' },
  { value: 'this-month', label: 'This month (UTC)' },
  { value: 'this-year', label: 'This year (UTC)' },
  { value: 'all-time', label: 'All time' },
]

const route = useRoute()
const router = useRouter()
const leaderboardEndpoint = computed(() => {
  const page = route.query.page
  const query = typeof page === 'string' ? `?page=${encodeURIComponent(page)}` : ''
  return `/api/games/${route.params.slug}/leaderboard${query}`
})
const { data: leaderboard, error, refresh: refreshLeaderboard } = await useFetch<LeaderboardResponse>(leaderboardEndpoint)
const { data: currentUser } = await useFetch<CurrentUser>('/api/auth/me')
const { data: games } = await useFetch<Array<{ id: string; name: string; slug: string }>>('/api/games')
const selectedReportPeriod = computed<ReportPeriod>({
  get() {
    const period = route.query.reportPeriod
    return typeof period === 'string' && reportPeriodOptions.some((option) => option.value === period)
      ? period as ReportPeriod
      : 'today'
  },
  set(period: ReportPeriod) {
    void router.push({ query: { ...route.query, reportPeriod: period, reportPage: undefined } })
  },
})
const selectedReportGame = computed({
  get: () => String(route.params.slug),
  set(slug: string) {
    void router.push({ path: `/games/${encodeURIComponent(slug)}`, query: { reportPeriod: selectedReportPeriod.value } })
  },
})
const reportEndpoint = computed(() => {
  const page = route.query.reportPage
  const pageQuery = typeof page === 'string' ? `&page=${encodeURIComponent(page)}` : ''
  return `/api/games/${route.params.slug}/report?period=${encodeURIComponent(selectedReportPeriod.value)}${pageQuery}`
})
const { data: report, error: reportError, refresh: refreshReport } = await useFetch<PeriodReportResponse>(reportEndpoint)
const maximumScore = Number.MAX_SAFE_INTEGER
const score = ref<number | null>(null)
const submitting = ref(false)
const submissionMessage = ref('')
const submissionError = ref('')
const leaderboardStreamConnected = ref(false)

function goToPage(page: number) {
  void router.push({ query: { ...route.query, page: String(page) } })
}

function goToReportPage(page: number) {
  void router.push({ query: { ...route.query, reportPage: String(page) } })
}

async function submitScore() {
  submissionMessage.value = ''
  submissionError.value = ''
  submitting.value = true
  try {
    await $fetch(`/api/games/${route.params.slug}/scores`, { method: 'POST', body: { score: score.value } })
    submissionMessage.value = 'Score submitted for review. It is pending until an admin reviews it.'
    score.value = null
  } catch (requestError: any) {
    const retryAt = requestError.data?.data?.retryAt
    submissionError.value = retryAt
      ? `You can submit another score after ${new Date(retryAt).toLocaleString()}.`
      : requestError.data?.statusMessage ?? 'Unable to submit your score.'
  } finally {
    submitting.value = false
  }
}

let rankingEvents: EventSource | undefined

function connectRankingEvents() {
  rankingEvents?.close()
  leaderboardStreamConnected.value = false
  rankingEvents = new EventSource(`/api/games/${route.params.slug}/leaderboard/events`)
  rankingEvents.addEventListener('ready', () => { leaderboardStreamConnected.value = true })
  rankingEvents.addEventListener('changed', (event) => {
    if (event.data === 'leaderboard') void refreshLeaderboard()
    if (event.data === 'report') void refreshReport()
  })
}

onMounted(() => {
  // Persist the API-selected initial page in the URL. Subsequent refreshes,
  // including SSE refreshes, now represent explicit navigation and cannot pull
  // a player back to their own position.
  if (leaderboard.value && route.query.page === undefined) goToPage(leaderboard.value.page)

  connectRankingEvents()
})
watch(() => String(route.params.slug), (slug: string, previousSlug: string) => {
  if (slug !== previousSlug) connectRankingEvents()
})
onBeforeUnmount(() => {
  rankingEvents?.close()
})
</script>

<template>
  <main>
    <NuxtLink to="/">All games</NuxtLink>
    <template v-if="leaderboard">
      <h1>{{ leaderboard.game.name }} leaderboard</h1>
      <p aria-label="Leaderboard connection" aria-live="polite">{{ leaderboardStreamConnected ? 'Live updates connected' : 'Connecting live updates…' }}</p>
      <ol aria-label="Leaderboard">
        <li v-for="entry in leaderboard.entries" :key="entry.userId">
          <strong>{{ entry.rank }}.</strong>{{ ' ' }}
          <a v-if="entry.githubProfileUrl" :href="entry.githubProfileUrl" target="_blank" rel="noopener noreferrer">{{ entry.username }}</a>
          <span v-else title="No GitHub profile is available for this player.">{{ entry.username }}</span>
          — {{ entry.score }}
        </li>
      </ol>
      <p v-if="leaderboard.entries.length === 0">No approved scores yet.</p>
      <nav v-if="leaderboard.totalPages > 1" aria-label="Leaderboard pages">
        <button type="button" :disabled="leaderboard.page === 1" aria-label="Previous leaderboard page" @click="goToPage(leaderboard.page - 1)">Previous</button>
        <span>Page {{ leaderboard.page }} of {{ leaderboard.totalPages }}</span>
        <button type="button" :disabled="leaderboard.page === leaderboard.totalPages" aria-label="Next leaderboard page" @click="goToPage(leaderboard.page + 1)">Next</button>
      </nav>
      <section aria-labelledby="period-report-heading">
        <h2 id="period-report-heading">Period report</h2>
        <p>Choose one game and a preset period. Calendar periods use UTC; weeks begin Monday at 00:00 UTC.</p>
        <p aria-label="Period report connection" aria-live="polite">{{ leaderboardStreamConnected ? 'Live updates connected' : 'Connecting live updates…' }}</p>
        <div>
          <label for="report-game">Game</label>
          <select id="report-game" v-model="selectedReportGame" name="report-game">
            <option v-for="game in games" :key="game.id" :value="game.slug">{{ game.name }}</option>
          </select>
        </div>
        <div>
          <label for="report-period">Report period</label>
          <select id="report-period" v-model="selectedReportPeriod" name="report-period">
            <option v-for="option in reportPeriodOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
        <template v-if="report">
          <h3>{{ report.period.label }} report</h3>
          <p v-if="report.period.startsAt">From {{ new Date(report.period.startsAt).toISOString() }} to {{ new Date(report.period.endsAt!).toISOString() }} (UTC).</p>
          <p v-else>All approved submissions.</p>
          <ol aria-label="Period report">
            <li v-for="entry in report.entries" :key="entry.username">
              <strong>{{ entry.rank }}.</strong>{{ ' ' }}
              <a v-if="entry.githubProfileUrl" :href="entry.githubProfileUrl" target="_blank" rel="noopener noreferrer">{{ entry.username }}</a>
              <span v-else title="No GitHub profile is available for this player.">{{ entry.username }}</span>
              — {{ entry.score }}
            </li>
          </ol>
          <p v-if="report.entries.length === 0">No approved scores in this period.</p>
          <nav v-if="report.totalPages > 1" aria-label="Period report pages">
            <button type="button" :disabled="report.page === 1" aria-label="Previous period report page" @click="goToReportPage(report.page - 1)">Previous</button>
            <span>Page {{ report.page }} of {{ report.totalPages }}</span>
            <button type="button" :disabled="report.page === report.totalPages" aria-label="Next period report page" @click="goToReportPage(report.page + 1)">Next</button>
          </nav>
        </template>
        <p v-else-if="reportError">Period report is temporarily unavailable.</p>
        <p v-else>Loading period report…</p>
      </section>
      <section v-if="currentUser" aria-labelledby="submit-score-heading">
        <h2 id="submit-score-heading">Submit a score</h2>
        <form @submit.prevent="submitScore">
          <label for="score">Score</label>
          <input id="score" v-model.number="score" name="score" type="number" min="0" :max="maximumScore" step="1" required>
          <p>Use a whole number from 0 to {{ maximumScore }}.</p>
          <button type="submit" :disabled="submitting">{{ submitting ? 'Submitting…' : 'Submit score' }}</button>
        </form>
        <p v-if="submissionMessage" role="status">{{ submissionMessage }}</p>
        <p v-if="submissionError" role="alert">{{ submissionError }}</p>
      </section>
      <p v-else><NuxtLink to="/login">Log in</NuxtLink> to submit a score.</p>
    </template>
    <p v-else-if="error">Leaderboard not found.</p>
    <p v-else>Loading leaderboard…</p>
  </main>
</template>
