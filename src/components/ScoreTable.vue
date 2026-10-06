<script setup lang="ts">
import { t } from '../i18n'
import { computed } from 'vue'
import type { StandingsState } from '../../shared/domain'
const props = defineProps<{ teams: StandingsState['teams']; currentTeamId?: string; limit?: number }>()
const ranked = computed(() => [...props.teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map(team => ({ ...team, rank: 1 + props.teams.filter(other => other.score > team.score).length })))
// A compact table keeps the leaders and always shows the viewing team.
const shown = computed(() => props.limit === undefined ? ranked.value : ranked.value.filter((team, index) => index < props.limit! || team.id === props.currentTeamId))
</script>
<template>
  <section class="score-table" :aria-label="t('Scores')">
    <table><thead><tr><th>#</th><th>{{ t('Team') }}</th><th>{{ t('Score') }}</th></tr></thead><tbody><tr v-for="team in shown" :key="team.id" :class="{ 'your-score': team.id === currentTeamId }"><td>{{ team.rank }}</td><th scope="row"><span class="color-dot" :style="{ background: team.color }" />{{ team.name }}{{ team.id === currentTeamId ? t(' (you)') : '' }}</th><td>{{ team.score }}</td></tr></tbody></table>
  </section>
</template>
