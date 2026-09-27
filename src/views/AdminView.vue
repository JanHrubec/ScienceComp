<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { api, ApiError, errorMessage } from '../api'
import { subjects, subjectNames, ages, type AdminTeam, type AgeCategory, type CompetitionState } from '../../shared/domain'
import { competitionStatus, acceptCompetition } from '../competition'
import CompetitionTimer from '../components/CompetitionTimer.vue'
const signedIn = ref(false), password = ref(''), error = ref(''), busy = ref(false), teams = ref<AdminTeam[]>([])
const showEditor = ref(false), editing = ref<string | null>(null), name = ref(''), age = ref<AgeCategory>('11–13'), code = ref(''), resetWord = ref(''), showReset = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined, stopped = false
async function load() {
  try {
    teams.value = await api<AdminTeam[]>('/admin/teams'); signedIn.value = true
  } catch (e) { if (e instanceof ApiError && e.status === 401) signedIn.value = false; else error.value = errorMessage(e) }
}
async function poll() { await load(); if (!stopped) timer = setTimeout(poll, 2000) }
onMounted(poll); onUnmounted(() => { stopped = true; clearTimeout(timer) })
async function perform(action: () => Promise<void>) { busy.value = true; error.value = ''; try { await action() } catch (e) { error.value = errorMessage(e) } finally { busy.value = false } }
async function login() { await perform(async () => { await api('/admin/login', { password: password.value }); password.value = ''; await load() }) }
function clear() { showEditor.value = false; editing.value = null; name.value = ''; age.value = '11–13'; code.value = '' }
function edit(team: AdminTeam) { showEditor.value = true; editing.value = team.id; name.value = team.name; age.value = team.age; code.value = team.code; window.scrollTo({ top: 0, behavior: 'instant' }) }
async function save() {
  const old = teams.value.find(t => t.id === editing.value)
  if (old && old.age !== age.value && !window.confirm('Changing age category resets this team’s progress, Research, skips, diamonds and position. Continue?')) return
  await perform(async () => { await api(editing.value ? `/admin/teams/${editing.value}` : '/admin/teams', { name: name.value, age: age.value, ...(code.value.trim() ? { code: code.value } : {}) }, editing.value ? 'PUT' : 'POST'); clear(); await load() })
}
async function remove() {
  const team = teams.value.find(t => t.id === editing.value)
  if (!team || !window.confirm(`Delete ${team.name} and all its progress? This cannot be undone.`)) return
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
    <header class="admin-header"><RouterLink to="/">Login</RouterLink><CompetitionTimer /><button v-if="signedIn" class="text-button" @click="logout">Sign out</button></header>
    <main>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <form v-if="!signedIn" class="admin-login" @submit.prevent="login"><label for="password">Admin password</label><input id="password" v-model="password" type="password" autocomplete="current-password" required><button :disabled="busy">Sign in</button></form>
      <template v-else>
        <div class="admin-toolbar"><h1>Teams</h1><button class="secondary" @click="clear(); showEditor = true">Add team</button><button v-if="competitionStatus === 'waiting'" :disabled="busy" @click="start">Start game</button><span v-else class="hint">{{ competitionStatus === 'finished' ? 'Finished' : competitionStatus === 'running' ? 'Running' : 'Loading…' }}</span></div>
        <section v-if="showEditor" class="team-editor">
          <form class="team-form" @submit.prevent="save"><label>Team name<input v-model="name" maxlength="60" required></label><label>Age category<select v-model="age"><option v-for="a in ages" :key="a">{{ a }}</option></select></label><label>Login code<input v-model="code" minlength="4" maxlength="8" pattern="[A-Za-z0-9]{4,8}" placeholder="Auto-generate" class="code-input"></label><button :disabled="busy">{{ editing ? 'Save team' : 'Create team' }}</button><button class="text-button" type="button" @click="clear">Cancel</button><button v-if="editing" type="button" class="text-button danger" :disabled="busy" @click="remove">Delete team</button></form>
        </section>
        <div class="table-scroll"><table><thead><tr><th>Team</th><th>Age</th><th>Code</th><th>Research</th><th>Diamonds</th><th>Progress</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody><tr v-for="team in teams" :key="team.id"><th scope="row">{{ team.name }}</th><td>{{ team.age }}</td><td><strong class="mono">{{ team.code }}</strong></td><td>{{ team.research }}</td><td>{{ team.diamonds }}</td><td><details class="team-progress"><summary>{{ completed(team) }}/{{ total(team) }}</summary><dl><template v-for="s in subjects" :key="s"><dt>{{ subjectNames[s] }}</dt><dd>{{ team.progress[s].completed }}/{{ team.progress[s].total }}</dd></template><dt>Question score</dt><dd>{{ team.earned }}</dd><dt>Skips used</dt><dd>{{ team.skipsUsed }}/3</dd></dl></details></td><td><button class="text-button" @click="edit(team)">Edit</button></td></tr></tbody></table><p v-if="!teams.length" class="empty">No teams yet.</p></div>
        <section class="admin-reset">
          <button v-if="!showReset" class="text-button danger" @click="showReset = true">Reset competition…</button>
          <form v-else class="reset-form" @submit.prevent="reset"><p>Clear progress, scores and positions, and refill diamonds; return everyone to the waiting screen. Teams stay.</p><label for="reset">Type RESET to confirm.</label><input id="reset" v-model="resetWord" autocomplete="off"><button class="danger-button" :disabled="busy || resetWord !== 'RESET'">Confirm reset</button><button type="button" class="text-button" @click="showReset = false">Cancel</button></form>
        </section>
      </template>
    </main>
  </div>
</template>
