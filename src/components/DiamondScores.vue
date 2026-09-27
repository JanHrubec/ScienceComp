<script setup lang="ts">
import { computed } from 'vue'
import type { StandingsState } from '../../shared/domain'
const props = defineProps<{ teams: StandingsState['teams']; currentTeamId?: string }>()
const ranked = computed(() => [...props.teams].sort((a, b) => b.diamonds - a.diamonds || a.name.localeCompare(b.name)))
</script>
<template>
  <section class="diamond-scores" aria-label="Diamond scores">
    <table><thead><tr><th>Team</th><th>Diamonds</th></tr></thead><tbody><tr v-for="team in ranked" :key="team.id" :class="{ 'your-score': team.id === currentTeamId }"><th scope="row"><span class="color-dot" :style="{ background: team.color }" />{{ team.name }}{{ team.id === currentTeamId ? ' (you)' : '' }}</th><td>{{ team.diamonds }}</td></tr></tbody></table>
  </section>
</template>
