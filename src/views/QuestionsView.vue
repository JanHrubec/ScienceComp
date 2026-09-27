<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { subjects, subjectNames, type Subject, type TeamState } from '../../shared/domain'
import { teamState, acceptState, refreshState } from '../state'
import { api, errorMessage } from '../api'
import { competition } from '../competition'
import { answerReward } from '../../shared/scoring'
const subject = ref<Subject>('physics'), answer = ref(''), busy = ref(false), feedback = ref(''), tone = ref(''), confirmSkip = ref(false)
const progress = computed(() => teamState.value!.progress[subject.value])
const question = computed(() => progress.value.question)
const reward = computed(() => question.value ? answerReward(question.value.type, question.value.reward, progress.value.attempts, true) : 0)
const bookletUrl = computed(() => competition.value?.booklets[subject.value])
const signed = (amount: number) => amount > 0 ? `+${amount}` : String(amount)
watch(() => question.value?.id, () => { answer.value = ''; confirmSkip.value = false })
watch(subject, () => { feedback.value = ''; confirmSkip.value = false })
async function submit(skip = false) {
  if (!question.value || busy.value) return
  const submittedSubject = subject.value
  busy.value = true; feedback.value = ''
  try {
    const result = await api<{ correct?: boolean; skipped?: boolean; awarded: number; state: TeamState }>(skip ? '/team/skip' : '/team/answer', { subject: subject.value, questionId: question.value.id, ...(skip ? {} : { answer: answer.value }) })
    acceptState(result.state)
    if (submittedSubject === subject.value) { feedback.value = result.skipped ? 'Skipped' : result.correct ? `Correct · ${signed(result.awarded)} Research` : `Try again${result.awarded < 0 ? ` · ${result.awarded} Research` : ''}`; tone.value = result.awarded < 0 ? 'error' : result.correct ? 'success' : '' }
  } catch (e) { feedback.value = errorMessage(e); tone.value = 'error'; await refreshState() }
  finally { busy.value = false; confirmSkip.value = false }
}
</script>
<template>
  <main class="questions"><nav class="subject-tabs" aria-label="Subjects"><button v-for="s in subjects" :key="s" :aria-pressed="subject === s" :class="{ selected: subject === s }" @click="subject = s">{{ subjectNames[s] }}</button></nav>
    <section class="question-area"><div class="question-meta"><span>{{ subjectNames[subject] }} · {{ question ? `Question ${progress.completed + 1} of ${progress.total}` : 'Track complete' }}</span><a v-if="bookletUrl" :href="bookletUrl" target="_blank" rel="noopener noreferrer" class="booklet-link">Booklet<span class="sr-only"> (opens in a new tab)</span></a></div>
      <template v-if="question"><h1 class="question-prompt">{{ question.prompt }}</h1>
        <form @submit.prevent="submit()"><fieldset v-if="question.type === 'multiple-choice'" class="choices"><legend class="sr-only">Choose an answer</legend><label v-for="(choice, index) in question.choices" :key="`${question.id}-${index}`" class="choice" :class="{ checked: answer === String(index) }"><input v-model="answer" type="radio" name="answer" :value="String(index)"><span>{{ choice }}</span></label></fieldset>
          <div v-else class="written-answer"><label for="answer">Your answer</label><input id="answer" v-model="answer" :inputmode="question.type === 'numerical' ? 'decimal' : 'text'" autocomplete="off" maxlength="500" :aria-describedby="question.type === 'numerical' ? 'number-hint' : undefined" required><p v-if="question.type === 'numerical'" id="number-hint" class="hint">Number only; use a decimal point.</p></div>
          <div class="answer-actions"><button :disabled="busy || !answer.trim()">{{ busy ? 'Checking…' : 'Submit answer' }}</button><span class="hint">{{ signed(reward) }} Research</span></div>
        </form>
        <p class="feedback" :class="tone" role="status" aria-live="polite">{{ feedback }}</p>
        <details class="scoring-note"><summary>Scoring</summary><p v-if="question.type === 'multiple-choice'">Correct on try 1: +10. Try 2: 0. Every submission from try 3: −5, including incorrect answers.</p><p v-else>Correct on try 1: {{ question.reward }}. Try 2: {{ question.reward / 2 }}. Later: 0.</p></details>
        <div class="skip-area"><button class="text-button" :disabled="busy || teamState!.team.skipsUsed >= 3" @click="confirmSkip = !confirmSkip">Skip question</button><span>{{ 3 - teamState!.team.skipsUsed }} team skips left</span><div v-if="confirmSkip" class="skip-confirm">Skip this question? You cannot return to it.<div><button class="secondary" :disabled="busy" @click="submit(true)">Yes, skip</button><button class="text-button" @click="confirmSkip = false">Keep trying</button></div></div></div>
      </template><div v-else class="completed"><h1>{{ subjectNames[subject] }} complete.</h1><p class="feedback" :class="tone" role="status">{{ feedback }}</p></div>
    </section>
  </main>
</template>
