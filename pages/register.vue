<script setup lang="ts">
const email = ref('')
const password = ref('')
const gameUsername = ref('')
const errorMessage = ref('')
const submitting = ref(false)

async function register() {
  errorMessage.value = ''
  submitting.value = true
  try {
    await $fetch('/api/auth/register', { method: 'POST', body: { email: email.value, password: password.value, gameUsername: gameUsername.value } })
    await navigateTo('/profile')
  } catch (error: any) {
    errorMessage.value = error.data?.statusMessage ?? 'Registration failed. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main>
    <h1>Create your player account</h1>
    <form @submit.prevent="register">
      <p>
        <label for="email">Email</label>
        <input id="email" v-model="email" name="email" type="email" autocomplete="email" required>
      </p>
      <p>
        <label for="password">Password</label>
        <input id="password" v-model="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
      </p>
      <p>
        <label for="game-username">Game username</label>
        <input id="game-username" v-model="gameUsername" name="gameUsername" autocomplete="username" minlength="3" maxlength="32" required>
      </p>
      <p>Your game username is public and must be unique across all games.</p>
      <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
      <button type="submit" :disabled="submitting">{{ submitting ? 'Creating account…' : 'Create account' }}</button>
    </form>
    <p>Already have an account? <NuxtLink to="/login">Log in</NuxtLink>.</p>
  </main>
</template>
