<script setup lang="ts">
import LanguageSwitcher from '../components/LanguageSwitcher.vue'
import { t } from '../i18n'
import { onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { teamState, refreshState, connectionError, clearState } from '../state'
import CompetitionTimer from '../components/CompetitionTimer.vue'
import { competitionStatus } from '../competition'
const router = useRouter()
watch(competitionStatus, () => { void refreshState() })
let timer: ReturnType<typeof setTimeout> | undefined
let stopped = false
async function poll() { if (!await refreshState()) router.replace('/'); if (!stopped) timer = setTimeout(poll, 1500) }
onMounted(poll)
onUnmounted(() => { stopped = true; clearTimeout(timer) })
async function leave() { try { await api('/team/logout', {}); clearState(); router.push('/') } catch { connectionError.value = 'Could not sign out. Try again.' } }
</script>
<template>
  <div class="participant">
    <header class="play-shell">
      <nav class="main-tabs" :aria-label="t('Main')">
        <RouterLink to="/play/questions">{{ t('Questions') }}</RouterLink>
        <RouterLink to="/play/game">{{ t('Game') }}</RouterLink>
        <RouterLink to="/play/standings">{{ t('Standings') }}</RouterLink>
      </nav>
      <div v-if="teamState" class="team-heading">
        <span class="team-name">{{ teamState.team.name }}</span>
        <CompetitionTimer /><LanguageSwitcher /><strong class="research" aria-live="polite">{{ teamState.team.research }} <span>{{ t('Research') }}</span></strong>
      </div>
      <button class="text-button leave-button" @click="leave">{{ t('Leave') }}</button>
    </header>
    <p v-if="connectionError" class="connection" role="alert">{{ t(connectionError) }} {{ t('Reconnecting…') }}</p>
    <main v-if="teamState && competitionStatus !== 'running'" class="waiting-screen"><h1>{{ t(competitionStatus === 'finished' ? 'Competition over.' : 'Waiting for the start…') }}</h1></main>
    <RouterView v-else-if="teamState && teamState.competition.status === 'running'" v-slot="{ Component }"><KeepAlive><component :is="Component" /></KeepAlive></RouterView>
    <p v-else class="loading">{{ t('Loading…') }}</p>
  </div>
</template>
