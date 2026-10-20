import type { CompetitionState } from '../shared/domain.js'

// Leave a subject URL empty to hide its booklet link.
export const subjectBooklets: CompetitionState['booklets'] = {
  'physics': 'https://www.cygnusinternational.org/uploads/pdf/hbm6rSO9t5tdwQpUdwHjIbBjwTzUagQ3YB2ftRf3.pdf',
  'biology': 'https://practical-science.com/wp-content/uploads/2026/06/Biology-Databook-V1-2026.pdf',
  'chemistry': 'https://www.ibchem.com/root_pdf/DataBook2025.pdf',
  'computer-science': '',
  'ess': '',
  'math': '',
}
