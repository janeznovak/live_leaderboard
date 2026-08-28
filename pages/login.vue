<script setup lang="ts">
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const submitting = ref(false)
const route = useRoute()

const githubError = computed(() => {
  if (route.query.github === 'invalid-state') return 'Your GitHub sign-in link expired. Please try again.'
  if (route.query.github === 'failed') return 'GitHub sign-in could not be completed. Please try again.'
  return ''
})

async function login() {
  errorMessage.value = ''
  submitting.value = true
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } })
    await navigateTo('/profile')
  } catch (error: any) {
    errorMessage.value = error.data?.statusMessage ?? 'Unable to log in. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main>
    <h1>Log in</h1>
    <form @submit.prevent="login">
      <p>
        <label for="email">Email</label>
        <input id="email" v-model="email" name="email" type="email" autocomplete="email" required>
      </p>
      <p>
        <label for="password">Password</label>
        <input id="password" v-model="password" name="password" type="password" autocomplete="current-password" required>
      </p>
      <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
      <button type="submit" :disabled="submitting">{{ submitting ? 'Logging in…' : 'Log in' }}</button>
    </form>
    <p v-if="githubError" role="alert">{{ githubError }}</p>
    <p><a href="/api/auth/github">Continue with GitHub</a></p>
  </main>
</template>
