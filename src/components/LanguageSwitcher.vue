<script setup lang="ts">
import { language } from '../i18n'
</script>
<template><select v-model="language" class="language-switch" aria-label="Language / Jazyk"><option value="en" lang="en">English</option><option value="cs" lang="cs">Čeština</option></select></template>
