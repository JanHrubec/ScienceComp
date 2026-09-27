<script setup lang="ts">
import { teamState } from '../state'
import DiamondScores from '../components/DiamondScores.vue'
</script>
<template>
  <main class="standings-view">
    <h1>Standings</h1>
    <p v-if="teamState!.standings.frozenAt !== null" class="hint" role="status">Frozen for the final 5 minutes.</p>
    <DiamondScores :teams="teamState!.standings.teams" :current-team-id="teamState!.team.id" />
  </main>
</template>
