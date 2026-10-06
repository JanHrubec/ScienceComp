<script setup lang="ts">
import { t } from '../i18n'
import { teamState } from '../state'
import ScoreTable from '../components/ScoreTable.vue'
</script>
<template>
  <main class="standings-view">
    <h1>{{ t('Standings') }}</h1>
    <p v-if="teamState!.standings.frozenAt !== null" class="hint" role="status">{{ t('Frozen for the final 5 minutes.') }}</p>
    <ScoreTable :teams="teamState!.standings.teams" :current-team-id="teamState!.team.id" />
  </main>
</template>
