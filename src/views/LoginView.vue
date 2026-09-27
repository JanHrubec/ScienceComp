<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, errorMessage } from '../api'
import { acceptState, refreshState, teamState } from '../state'
import type { TeamState } from '../../shared/domain'
import CompetitionTimer from '../components/CompetitionTimer.vue'
const code = ref(''), error = ref(''), busy = ref(false), router = useRouter()
onMounted(async () => { await refreshState(); if (teamState.value) router.replace('/play/questions') })
async function join() {
  busy.value = true; error.value = ''
  try { acceptState(await api<TeamState>('/team/login', { code: code.value })); router.push('/play/questions') }
  catch (e) { error.value = errorMessage(e) } finally { busy.value = false }
}
</script>
<template>
  <div class="landing"><header class="login-header"><CompetitionTimer /></header>
    <main class="join">
      <form @submit.prevent="join">
        <label for="code">Team code</label>
        <div class="join-controls">
          <input id="code" v-model="code" class="code-input" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
          <button :disabled="busy || !code.trim()">{{ busy ? 'Joining…' : 'Join' }}</button>
        </div>
      </form>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
    </main>
    <footer><RouterLink to="/admin">Admin</RouterLink></footer>
  </div>
</template>
