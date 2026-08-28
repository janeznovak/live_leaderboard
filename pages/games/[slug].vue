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

const route = useRoute()
const router = useRouter()
const leaderboardEndpoint = computed(() => {
  const page = route.query.page
  const query = typeof page === 'string' ? `?page=${encodeURIComponent(page)}` : ''
  return `/api/games/${route.params.slug}/leaderboard${query}`
})
const { data: leaderboard, error, refresh: refreshLeaderboard } = await useFetch<LeaderboardResponse>(leaderboardEndpoint)
const { data: currentUser } = await useFetch<CurrentUser>('/api/auth/me')
const maximumScore = Number.MAX_SAFE_INTEGER
const score = ref<number | null>(null)
const submitting = ref(false)
const submissionMessage = ref('')
const submissionError = ref('')
const leaderboardStreamConnected = ref(false)

function goToPage(page: number) {
  void router.push({ query: { ...route.query, page: String(page) } })
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

let leaderboardEvents: EventSource | undefined
onMounted(() => {
  // Persist the API-selected initial page in the URL. Subsequent refreshes,
  // including SSE refreshes, now represent explicit navigation and cannot pull
  // a player back to their own position.
  if (leaderboard.value && route.query.page === undefined) goToPage(leaderboard.value.page)

  leaderboardEvents = new EventSource(`/api/games/${route.params.slug}/leaderboard/events`)
  leaderboardEvents.addEventListener('ready', () => { leaderboardStreamConnected.value = true })
  leaderboardEvents.addEventListener('changed', () => { void refreshLeaderboard() })
})
onBeforeUnmount(() => leaderboardEvents?.close())
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
