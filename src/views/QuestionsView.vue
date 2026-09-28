<script setup lang="ts">
import { t, subjectLabel, language } from '../i18n'
import { computed, ref, watch } from 'vue'
import { TEAM_SKIP_LIMIT, subjects, type Subject, type TeamState } from '../../shared/domain'
import { teamState, acceptState, refreshState } from '../state'
import { api, errorMessage } from '../api'
import { competition } from '../competition'
import { answerReward } from '../../shared/scoring'
const subject = ref<Subject>('physics'), answer = ref(''), busy = ref(false), failure = ref(''), resultFeedback = ref<{ correct?: boolean; skipped?: boolean; awarded: number } | null>(null), tone = ref(''), confirmSkip = ref(false)
const progress = computed(() => teamState.value!.progress[subject.value])
const question = computed(() => progress.value.question)
const prompt = computed(() => language.value === 'cs' ? question.value?.cs.prompt : question.value?.prompt)
const choices = computed(() => language.value === 'cs' ? question.value?.cs.choices : question.value?.choices)
const feedback = computed(() => {
  if (failure.value) return t(failure.value)
  const result = resultFeedback.value
  if (!result) return ''
  if (result.skipped) return t('Skipped')
  const amount = result.correct || result.awarded < 0 ? ` · ${signed(result.awarded)} ${t('Research')}` : ''
  return t(result.correct ? 'Correct' : 'Try again') + amount
})
function clearFeedback() { failure.value = ''; resultFeedback.value = null }
const reward = computed(() => question.value ? answerReward(question.value.type, question.value.reward, progress.value.attempts, true) : 0)
const bookletUrl = computed(() => competition.value?.booklets[subject.value])
const signed = (amount: number) => amount > 0 ? `+${amount}` : String(amount)
watch(() => question.value?.id, () => { answer.value = ''; confirmSkip.value = false })
watch(subject, () => { clearFeedback(); confirmSkip.value = false })
async function submit(skip = false) {
  if (!question.value || busy.value) return
  const submittedSubject = subject.value
  busy.value = true; clearFeedback()
  try {
    const result = await api<{ correct?: boolean; skipped?: boolean; awarded: number; state: TeamState }>(skip ? '/team/skip' : '/team/answer', { subject: subject.value, questionId: question.value.id, ...(skip ? {} : { answer: answer.value }) })
    acceptState(result.state)
    if (submittedSubject === subject.value) { resultFeedback.value = result; tone.value = result.awarded < 0 ? 'error' : result.correct ? 'success' : '' }
  } catch (e) { failure.value = errorMessage(e); tone.value = 'error'; await refreshState() }
  finally { busy.value = false; confirmSkip.value = false }
}
</script>
<template>
  <main class="questions"><nav class="subject-tabs" :aria-label="t('Subjects')"><button v-for="s in subjects" :key="s" :aria-pressed="subject === s" :class="{ selected: subject === s }" @click="subject = s">{{ subjectLabel(s) }}</button></nav>
    <section class="question-area"><div class="question-meta"><span>{{ subjectLabel(subject) }} · {{ question ? t('Question {number} of {total}', { number: progress.completed + 1, total: progress.total }) : t('Track complete') }}</span><a v-if="bookletUrl" :href="bookletUrl" target="_blank" rel="noopener noreferrer" class="booklet-link">{{ t('Booklet') }}<span class="sr-only">{{ t(' (opens in a new tab)') }}</span></a></div>
      <template v-if="question"><h1 class="question-prompt">{{ prompt }}</h1>
        <form @submit.prevent="submit()"><fieldset v-if="question.type === 'multiple-choice'" class="choices"><legend class="sr-only">{{ t('Choose an answer') }}</legend><label v-for="(choice, index) in choices" :key="`${question.id}-${index}`" class="choice" :class="{ checked: answer === String(index) }"><input v-model="answer" type="radio" name="answer" :value="String(index)"><span>{{ choice }}</span></label></fieldset>
          <div v-else class="written-answer"><label for="answer">{{ t('Your answer') }}</label><input id="answer" v-model="answer" :inputmode="question.type === 'numerical' ? 'decimal' : 'text'" autocomplete="off" maxlength="500" :aria-describedby="question.type === 'numerical' ? 'number-hint' : undefined" required><p v-if="question.type === 'numerical'" id="number-hint" class="hint">{{ t('Number only; use a decimal point or comma.') }}</p></div>
          <div class="answer-actions"><button :disabled="busy || !answer.trim()">{{ t(busy ? 'Checking…' : 'Submit answer') }}</button><span class="hint">{{ signed(reward) }} {{ t('Research') }}</span></div>
        </form>
        <p class="feedback" :class="tone" role="status" aria-live="polite">{{ feedback }}</p>
        <details class="scoring-note"><summary>{{ t('Scoring') }}</summary><p v-if="question.type === 'multiple-choice'">{{ t('Correct on try 1: +10. Try 2: 0. Every submission from try 3: −5, including incorrect answers.') }}</p><p v-else>{{ t('Correct on try 1: {full}. Try 2: {half}. Later: 0.', { full: question.reward, half: question.reward / 2 }) }}</p></details>
        <div class="skip-area"><button class="text-button" :disabled="busy || teamState!.team.skipsUsed >= TEAM_SKIP_LIMIT" @click="confirmSkip = !confirmSkip">{{ t('Skip question') }}</button><span>{{ t('{count} team skips left', { count: TEAM_SKIP_LIMIT - teamState!.team.skipsUsed }) }}</span><div v-if="confirmSkip" class="skip-confirm">{{ t('Skip this question? You cannot return to it.') }}<div><button class="secondary" :disabled="busy" @click="submit(true)">{{ t('Yes, skip') }}</button><button class="text-button" @click="confirmSkip = false">{{ t('Keep trying') }}</button></div></div></div>
      </template><div v-else class="completed"><h1>{{ t('{subject} complete.', { subject: subjectLabel(subject) }) }}</h1><p class="feedback" :class="tone" role="status">{{ feedback }}</p></div>
    </section>
  </main>
</template>
