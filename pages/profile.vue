<script setup lang="ts">
type Profile = {
  id: string
  email: string
  gameUsername: string
  role: 'player' | 'admin'
  githubLogin?: string
  githubProfileUrl?: string
}
type ScoreHistory = {
  submissions: Array<{
    id: string
    score: number
    status: 'pending' | 'approved' | 'declined'
    submittedAt: string
    gameUsername: string
    game: { id: string; name: string; slug: string }
  }>
}

const { data: profile, error } = await useFetch<Profile>('/api/auth/me')
const { data: scoreHistory } = await useFetch<ScoreHistory>('/api/scores')
const route = useRoute()
const gameUsername = ref(profile.value?.gameUsername ?? '')
const message = ref('')
const errorMessage = ref('')
const saving = ref(false)

const githubMessage = computed(() => {
  if (route.query.github === 'connected') return { type: 'status', text: 'GitHub profile connected.' }
  if (route.query.github === 'already-connected') return { type: 'status', text: 'This GitHub profile is already connected.' }
  if (route.query.github === 'identity-in-use') return { type: 'alert', text: 'That GitHub identity is already connected to another user.' }
  if (route.query.github === 'failed') return { type: 'alert', text: 'GitHub connection could not be completed. Please try again.' }
  return undefined
})

async function saveUsername() {
  errorMessage.value = ''
  message.value = ''
  saving.value = true
  try {
    const updated = await $fetch<Profile>('/api/profile/game-username', {
      method: 'PATCH',
      body: { gameUsername: gameUsername.value },
    })
    profile.value = updated
    gameUsername.value = updated.gameUsername
    message.value = 'Game username updated.'
  } catch (requestError: any) {
    errorMessage.value = requestError.data?.statusMessage ?? 'Unable to update your game username.'
  } finally {
    saving.value = false
  }
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/')
}

watch(profile, (user: Profile | null) => {
  if (user) gameUsername.value = user.gameUsername
})
</script>

<template>
  <main>
    <template v-if="profile">
      <h1>Your player profile</h1>
      <p>Signed in as {{ profile.email }}.</p>
      <p v-if="profile.githubProfileUrl">
        GitHub profile: <a :href="profile.githubProfileUrl" target="_blank" rel="noopener noreferrer">{{ profile.githubLogin }}</a>.
      </p>
      <p v-else><a href="/api/auth/github/link">Connect GitHub</a></p>
      <p v-if="profile.role === 'admin'"><NuxtLink to="/admin">Open score moderation</NuxtLink></p>
      <form @submit.prevent="saveUsername">
        <p>
          <label for="game-username">Game username</label>
          <input id="game-username" v-model="gameUsername" name="gameUsername" minlength="3" maxlength="32" required>
        </p>
        <p>Your public username is {{ profile.gameUsername }}.</p>
        <p v-if="message" role="status">{{ message }}</p>
        <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
        <button type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save username' }}</button>
      </form>
      <p v-if="githubMessage" :role="githubMessage.type">{{ githubMessage.text }}</p>
      <section aria-labelledby="score-history-heading">
        <h2 id="score-history-heading">Your score history</h2>
        <ul v-if="scoreHistory?.submissions.length" aria-label="Your score submissions">
          <li v-for="submission in scoreHistory.submissions" :key="submission.id">
            <NuxtLink :to="`/games/${submission.game.slug}`">{{ submission.game.name }}</NuxtLink>
            — {{ profile.gameUsername }} — {{ submission.score }} — {{ submission.status }}
          </li>
        </ul>
        <p v-else>No submitted scores yet.</p>
      </section>
      <button type="button" @click="logout">Log out</button>
    </template>
    <template v-else-if="error">
      <h1>Sign in required</h1>
      <p>You need to log in before viewing your player profile.</p>
      <NuxtLink to="/login">Log in</NuxtLink>
    </template>
    <p v-else>Loading your profile…</p>
  </main>
</template>
