<script setup lang="ts">
import { computed } from 'vue'
import { secondsLeft, competitionStatus } from '../competition'
const time = computed(() => secondsLeft.value === null ? '--:--' : `${String(Math.floor(secondsLeft.value / 60)).padStart(2, '0')}:${String(secondsLeft.value % 60).padStart(2, '0')}`)
</script>
<template><span class="competition-timer" :class="{ ending: secondsLeft !== null && secondsLeft <= 60 && competitionStatus !== 'waiting' }" role="timer" :aria-label="`Time remaining: ${time}`">{{ time }}</span></template>
