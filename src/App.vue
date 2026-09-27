<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { startCompetitionClock } from './competition'
let stop: (() => void) | undefined
onMounted(() => { stop = startCompetitionClock() })
onUnmounted(() => stop?.())
</script>
<template><RouterView /></template>
