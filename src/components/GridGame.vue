<script setup lang="ts">
import { computed, ref } from 'vue'
import { teamState, acceptState, refreshState } from '../state'
import { api, errorMessage } from '../api'
import type { TeamState } from '../../shared/domain'
const busy = ref(false), error = ref('')
const game = computed(() => teamState.value!.game)
const me = computed(() => game.value.teams.find(t => t.id === teamState.value!.team.id)!)
const cells = computed(() => game.value.cells.map(cell => ({ ...cell, teams: game.value.teams.filter(t => t.x === cell.x && t.y === cell.y), near: Math.abs(cell.x - me.value.x) + Math.abs(cell.y - me.value.y) === 1 })))
const stockHere = computed(() => game.value.cells.find(cell => cell.x === me.value.x && cell.y === me.value.y)?.stock ?? 0)
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase()
async function action(path: 'move' | 'mine', input: object) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { acceptState(await api<TeamState>(`/team/game/${path}`, input)) }
  catch (e) { error.value = errorMessage(e); await refreshState() } finally { busy.value = false }
}
function move(x: number, y: number) { return action('move', { x, y, fromX: me.value.x, fromY: me.value.y }) }
function mine() { return action('mine', { x: me.value.x, y: me.value.y }) }
</script>
<template>
  <main class="game-view">
    <h1 class="sr-only">Game</h1>
    <div class="mining-controls"><button :disabled="busy || stockHere === 0" @click="mine">Mine 1 diamond</button><span class="hint">{{ stockHere }} left here</span><strong class="diamond-total" aria-live="polite">{{ game.diamonds }} {{ game.diamonds === 1 ? 'diamond' : 'diamonds' }}</strong></div>
    <p class="hint game-rules">Move: 1 Research. Mining is free. Most diamonds wins.</p>
    <p class="feedback error" role="status">{{ error }}</p>
    <div class="grid" :style="{ gridTemplateColumns: `repeat(${game.size}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${game.size}, minmax(0, 1fr))` }" aria-label="Shared game board">
      <button v-for="cell in cells" :key="`${cell.x}-${cell.y}`" :disabled="!cell.near || busy || teamState!.team.research < 1" :class="{ neighbour: cell.near, own: cell.teams.some(t => t.id === me.id), depleted: cell.stock === 0 }" :aria-label="`Column ${cell.x + 1}, row ${cell.y + 1}${cell.teams.length ? ': ' + cell.teams.map(t => t.name).join(', ') : ''}; ${cell.stock} diamonds${cell.near ? ', move here' : ''}`" :title="`${cell.stock} diamonds${cell.teams.length ? ' · ' + cell.teams.map(t => t.name).join(', ') : ''}`" @click="move(cell.x, cell.y)">
        <span class="cell-stock">{{ cell.stock }}</span>
        <span v-if="cell.teams.length" class="cell-occupants"><span class="marker" :style="{ background: cell.teams[0]!.color }">{{ initials(cell.teams[0]!.name) }}</span><small v-if="cell.teams.length > 1">+{{ cell.teams.length - 1 }}</small></span>
      </button>
    </div>
  </main>
</template>
