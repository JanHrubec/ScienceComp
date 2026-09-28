<script setup lang="ts">
import { t } from '../i18n'
import { computed } from 'vue'
import type { StandingsState } from '../../shared/domain'
const props = defineProps<{ teams: StandingsState['teams']; currentTeamId?: string }>()
const ranked = computed(() => [...props.teams].sort((a, b) => b.diamonds - a.diamonds || a.name.localeCompare(b.name)))
</script>
<template>
  <section class="diamond-scores" :aria-label="t('Diamond scores')">
    <table><thead><tr><th>{{ t('Team') }}</th><th>{{ t('Diamonds') }}</th></tr></thead><tbody><tr v-for="team in ranked" :key="team.id" :class="{ 'your-score': team.id === currentTeamId }"><th scope="row"><span class="color-dot" :style="{ background: team.color }" />{{ team.name }}{{ team.id === currentTeamId ? t(' (you)') : '' }}</th><td>{{ team.diamonds }}</td></tr></tbody></table>
  </section>
</template>
