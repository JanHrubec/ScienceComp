<script setup lang="ts">
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
      <nav class="main-tabs" aria-label="Main">
        <RouterLink to="/play/questions">Questions</RouterLink>
        <RouterLink to="/play/game">Game</RouterLink>
        <RouterLink to="/play/standings">Standings</RouterLink>
      </nav>
      <div v-if="teamState" class="team-heading">
        <span class="team-name">{{ teamState.team.name }}</span>
        <CompetitionTimer /><strong class="research" aria-live="polite">{{ teamState.team.research }} <span>Research</span></strong>
      </div>
      <button class="text-button leave-button" @click="leave">Leave</button>
    </header>
    <p v-if="connectionError" class="connection" role="alert">{{ connectionError }} Reconnecting…</p>
    <main v-if="teamState && competitionStatus !== 'running'" class="waiting-screen"><h1>{{ competitionStatus === 'finished' ? 'Competition over.' : 'Waiting for the start…' }}</h1></main>
    <RouterView v-else-if="teamState && teamState.competition.status === 'running'" v-slot="{ Component }"><KeepAlive><component :is="Component" /></KeepAlive></RouterView>
    <p v-else class="loading">Loading…</p>
  </div>
</template>
