<script setup lang="ts">
const { data: games, error } = await useFetch('/api/games')
</script>

<template>
  <main>
    <h1>Game leaderboards</h1>
    <p>Browse the current rankings for every game.</p>
    <p v-if="error">Games are temporarily unavailable.</p>
    <ul v-else aria-label="Games">
      <li v-for="game in games" :key="game.id">
        <NuxtLink :to="`/games/${game.slug}`">{{ game.name }}</NuxtLink>
      </li>
    </ul>
  </main>
</template>
