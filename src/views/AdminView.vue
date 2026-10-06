<script setup lang="ts">
import LanguageSwitcher from '../components/LanguageSwitcher.vue'
import { t, subjectLabel } from '../i18n'
import { ref, onMounted, onUnmounted } from 'vue'
import { api, ApiError, errorMessage } from '../api'
import { TEAM_SKIP_LIMIT, subjects, ages, type AdminTeam, type AgeCategory, type CompetitionState } from '../../shared/domain'
import { competitionStatus, acceptCompetition } from '../competition'
import CompetitionTimer from '../components/CompetitionTimer.vue'
const signedIn = ref(false), password = ref(''), error = ref(''), busy = ref(false), teams = ref<AdminTeam[]>([]), loaded = ref(false)
const showEditor = ref(false), editing = ref<string | null>(null), name = ref(''), age = ref<AgeCategory>('11–13'), code = ref(''), resetWord = ref(''), showReset = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined, stopped = false
async function load() {
  try {
    teams.value = await api<AdminTeam[]>('/admin/teams'); signedIn.value = loaded.value = true
  } catch (e) {
    // Only a 401 means signed out. Any other server answer comes from past the admin check, so the
    // dashboard and its reset stay reachable when the roster cannot load (say, game catch-up fails).
    if (e instanceof ApiError && e.status === 401) { signedIn.value = false; return }
    if (e instanceof ApiError) signedIn.value = true
    error.value = errorMessage(e)
  }
}
async function poll() { await load(); if (!stopped) timer = setTimeout(poll, 2000) }
onMounted(poll); onUnmounted(() => { stopped = true; clearTimeout(timer) })
async function perform(action: () => Promise<void>) { busy.value = true; error.value = ''; try { await action() } catch (e) { error.value = errorMessage(e) } finally { busy.value = false } }
async function login() { await perform(async () => { await api('/admin/login', { password: password.value }); password.value = ''; signedIn.value = true; await load() }) }
function clear() { showEditor.value = false; editing.value = null; name.value = ''; age.value = '11–13'; code.value = '' }
function edit(team: AdminTeam) { showEditor.value = true; editing.value = team.id; name.value = team.name; age.value = team.age; code.value = team.code; window.scrollTo({ top: 0, behavior: 'instant' }) }
async function save() {
  const old = teams.value.find(t => t.id === editing.value)
  if (old && old.age !== age.value && !window.confirm(t('Changing age category resets this team’s progress, Research, skips, score, boats and contract. Continue?'))) return
  await perform(async () => { await api(editing.value ? `/admin/teams/${editing.value}` : '/admin/teams', { name: name.value, age: age.value, ...(code.value.trim() ? { code: code.value } : {}) }, editing.value ? 'PUT' : 'POST'); clear(); await load() })
}
async function remove() {
  const team = teams.value.find(t => t.id === editing.value)
  if (!team || !window.confirm(t('Delete {name} and all its progress? This cannot be undone.', { name: team.name }))) return
  await perform(async () => { await api(`/admin/teams/${team.id}`, {}, 'DELETE'); clear(); await load() })
}
async function start() { await perform(async () => { acceptCompetition(await api<CompetitionState>('/admin/start', {})) }) }
async function reset() { await perform(async () => { await api('/admin/reset', { confirmation: resetWord.value }); acceptCompetition(await api<CompetitionState>('/competition')); showReset.value = false; resetWord.value = ''; await load() }) }
async function logout() { await perform(async () => { await api('/admin/logout', {}); signedIn.value = false }) }
const completed = (team: AdminTeam) => subjects.reduce((sum, s) => sum + team.progress[s].completed, 0)
const total = (team: AdminTeam) => subjects.reduce((sum, s) => sum + team.progress[s].total, 0)
</script>
<template>
  <div class="admin">
    <header class="admin-header"><RouterLink to="/">{{ t('Login') }}</RouterLink><CompetitionTimer /><LanguageSwitcher /><button v-if="signedIn" class="text-button" @click="logout">{{ t('Sign out') }}</button></header>
    <main>
      <p v-if="error" class="error" role="alert">{{ t(error) }}</p>
      <form v-if="!signedIn" class="admin-login" @submit.prevent="login"><label for="password">{{ t('Admin password') }}</label><input id="password" v-model="password" type="password" autocomplete="current-password" required><button :disabled="busy">{{ t('Sign in') }}</button></form>
      <template v-else>
        <div class="admin-toolbar"><h1>{{ t('Teams') }}</h1><button class="secondary" @click="clear(); showEditor = true">{{ t('Add team') }}</button><button v-if="competitionStatus === 'waiting'" :disabled="busy" @click="start">{{ t('Start game') }}</button><span v-else class="hint">{{ t(competitionStatus === 'finished' ? 'Finished' : competitionStatus === 'running' ? 'Running' : 'Loading…') }}</span></div>
        <section v-if="showEditor" class="team-editor">
          <form class="team-form" @submit.prevent="save"><label>{{ t('Team name') }}<input v-model="name" maxlength="60" required></label><label>{{ t('Age category') }}<select v-model="age"><option v-for="a in ages" :key="a">{{ a }}</option></select></label><label>{{ t('Login code') }}<input v-model="code" minlength="4" maxlength="8" pattern="[A-Za-z0-9]{4,8}" :placeholder="t('Auto-generate')" class="code-input"></label><button :disabled="busy">{{ t(editing ? 'Save team' : 'Create team') }}</button><button class="text-button" type="button" @click="clear">{{ t('Cancel') }}</button><button v-if="editing" type="button" class="text-button danger" :disabled="busy" @click="remove">{{ t('Delete team') }}</button></form>
        </section>
        <div class="table-scroll"><table><thead><tr><th>{{ t('Team') }}</th><th>{{ t('Age') }}</th><th>{{ t('Code') }}</th><th>{{ t('Research') }}</th><th>{{ t('Score') }}</th><th>{{ t('Progress') }}</th><th><span class="sr-only">{{ t('Actions') }}</span></th></tr></thead><tbody><tr v-for="team in teams" :key="team.id"><th scope="row">{{ team.name }}</th><td>{{ team.age }}</td><td><strong class="mono">{{ team.code }}</strong></td><td>{{ team.research }}</td><td>{{ team.score }}</td><td><details class="team-progress"><summary>{{ completed(team) }}/{{ total(team) }}</summary><dl><template v-for="s in subjects" :key="s"><dt>{{ subjectLabel(s) }}</dt><dd>{{ team.progress[s].completed }}/{{ team.progress[s].total }}</dd></template><dt>{{ t('Question score') }}</dt><dd>{{ team.earned }}</dd><dt>{{ t('Skips used') }}</dt><dd>{{ team.skipsUsed }}/{{ TEAM_SKIP_LIMIT }}</dd><dt>{{ t('Fish caught') }}</dt><dd>{{ team.fish }}</dd><dt>{{ t('Contract bonus') }}</dt><dd>{{ team.bonus }}</dd></dl></details></td><td><button class="text-button" @click="edit(team)">{{ t('Edit') }}</button></td></tr></tbody></table><p v-if="loaded && !teams.length" class="empty">{{ t('No teams yet.') }}</p></div>
        <section class="admin-reset">
          <a v-if="competitionStatus !== 'waiting'" class="history-link" href="/api/admin/history" download="match-history.json">{{ t('Match history (JSON)') }}</a>
          <button v-if="!showReset" class="text-button danger" @click="showReset = true">{{ t('Reset competition…') }}</button>
          <form v-else class="reset-form" @submit.prevent="reset"><p>{{ t('Clear progress, scores, boats and contracts, and restock the fishing grounds; return everyone to the waiting screen. Teams stay.') }}</p><label for="reset">{{ t('Type RESET to confirm.') }}</label><input id="reset" v-model="resetWord" autocomplete="off"><button class="danger-button" :disabled="busy || resetWord !== 'RESET'">{{ t('Confirm reset') }}</button><button type="button" class="text-button" @click="showReset = false">{{ t('Cancel') }}</button></form>
        </section>
      </template>
    </main>
  </div>
</template>
