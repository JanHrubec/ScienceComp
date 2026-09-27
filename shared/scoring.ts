// Shared for honest UI previews; the server applies this inside its transaction.
export function answerReward(type: 'multiple-choice' | 'text' | 'numerical', reward: number, failedAttempts: number, correct: boolean): number {
  if (type === 'multiple-choice') {
    if (failedAttempts >= 2) return -5
    return correct && failedAttempts === 0 ? 10 : 0
  }
  return correct ? reward * (failedAttempts === 0 ? 1 : failedAttempts === 1 ? 0.5 : 0) : 0
}
