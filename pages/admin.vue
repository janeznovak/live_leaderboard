<script setup lang="ts">
type Submission = {
  id: string
  score: number
  status?: 'pending' | 'approved' | 'declined'
  submittedAt: string
  moderatedAt?: string | null
  user: { id: string; gameUsername: string }
  game: { id: string; name: string; slug: string }
  moderatedBy?: { id: string; gameUsername: string } | null
}
type QueueResponse = { pendingCount: number; submissions: Submission[] }
type HistoryResponse = { submissions: Submission[] }

const { data: queue, error: queueError, refresh: refreshQueue } = await useFetch<QueueResponse>('/api/admin/review-queue')
const { data: history, refresh: refreshHistory } = await useFetch<HistoryResponse>('/api/admin/scores')
const actionError = ref('')
const actingOn = ref<string | null>(null)
const reviewStreamConnected = ref(false)

async function refreshReviewData() {
  await Promise.all([refreshQueue(), refreshHistory()])
}

async function moderate(submission: Submission, action: 'approve' | 'decline') {
  actionError.value = ''
  actingOn.value = submission.id
  try {
    await $fetch(`/api/admin/scores/${submission.id}/${action}`, { method: 'POST' })
    await refreshReviewData()
  } catch (error: any) {
    actionError.value = error.data?.statusMessage ?? 'Unable to review this score submission.'
    await refreshReviewData()
  } finally {
    actingOn.value = null
  }
}

let reviewEvents: EventSource | undefined
onMounted(() => {
  reviewEvents = new EventSource('/api/admin/review-queue/events')
  reviewEvents.addEventListener('ready', () => { reviewStreamConnected.value = true })
  reviewEvents.addEventListener('changed', () => { void refreshReviewData() })
})
onBeforeUnmount(() => reviewEvents?.close())
</script>

<template>
  <main>
    <NuxtLink to="/">All games</NuxtLink>
    <template v-if="queue">
      <h1>Score moderation</h1>
      <p aria-label="Pending reviews">Pending reviews: <strong>{{ queue.pendingCount }}</strong></p>
      <p aria-label="Review queue connection" aria-live="polite">{{ reviewStreamConnected ? 'Live updates connected' : 'Connecting live updates…' }}</p>
      <section aria-labelledby="review-queue-heading">
        <h2 id="review-queue-heading">Pending review queue</h2>
        <ol v-if="queue.submissions.length" aria-label="Pending score submissions">
          <li v-for="submission in queue.submissions" :key="submission.id">
            {{ submission.game.name }} — {{ submission.user.gameUsername }} — {{ submission.score }} — submitted {{ new Date(submission.submittedAt).toLocaleString() }}
            <button type="button" :disabled="actingOn === submission.id" :aria-label="`Approve score ${submission.score} from ${submission.user.gameUsername}`" @click="moderate(submission, 'approve')">Approve</button>
            <button type="button" :disabled="actingOn === submission.id" :aria-label="`Decline score ${submission.score} from ${submission.user.gameUsername}`" @click="moderate(submission, 'decline')">Decline</button>
          </li>
        </ol>
        <p v-else>No scores are awaiting review.</p>
      </section>
      <p v-if="actionError" role="alert">{{ actionError }}</p>
      <section aria-labelledby="all-history-heading">
        <h2 id="all-history-heading">All score and moderation history</h2>
        <ul v-if="history?.submissions.length" aria-label="All score submissions">
          <li v-for="submission in history.submissions" :key="submission.id">
            {{ submission.game.name }} — {{ submission.user.gameUsername }} — {{ submission.score }} — {{ submission.status }} — submitted {{ new Date(submission.submittedAt).toLocaleString() }}
            <template v-if="submission.moderatedAt && submission.moderatedBy"> — moderated by {{ submission.moderatedBy.gameUsername }} at {{ new Date(submission.moderatedAt).toLocaleString() }}</template>
          </li>
        </ul>
        <p v-else>No score submissions yet.</p>
      </section>
    </template>
    <template v-else-if="queueError">
      <h1>Administrator access required</h1>
      <p>Only an authenticated administrator can review score submissions.</p>
    </template>
    <p v-else>Loading score moderation…</p>
  </main>
</template>
