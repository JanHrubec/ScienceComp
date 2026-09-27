# Question bank format

The five subject JSON files are the source of truth. All three age tracks live in the subject's file. Questions appear in array order, with no randomisation. The supplied tracks progress from foundation concepts to calculations or multi-step reasoning.

```json
{
  "subject": "physics",
  "tracks": {
    "11–13": [
      {
        "id": "physics-11-01",
        "type": "multiple-choice",
        "prompt": "Which is the SI unit of force?",
        "choices": ["Joule", "Newton", "Watt", "Pascal"],
        "correctIndex": 1,
        "reward": 10
      }
    ],
    "14–16": [],
    "17–18": []
  }
}
```

This illustrates the structure; **every age track must contain at least one question** in a real file. IDs must be unique across the entire bank. `correctIndex` is zero-based. Choices appear in the supplied order. `reward` is optional and defaults to 10; a positive number up to 10000 is accepted. It configures text/numerical first-attempt rewards; the second attempt earns half and later attempts earn zero. Half rewards may be fractional. Multiple choice always awards +10 for a first-attempt correct answer, 0 on the second, and −5 for every third-or-later submission (including incorrect answers), independent of `reward`.

Exact text question:

```json
{
  "id": "biology-14-example",
  "type": "text",
  "prompt": "Which organelle is the main site of aerobic ATP production in eukaryotic cells?",
  "acceptedAnswers": ["mitochondrion", "mitochondria"],
  "ignorePunctuation": false,
  "reward": 10
}
```

Matching ignores case, leading/trailing whitespace and repeated whitespace. Only the explicit variants are accepted. `ignorePunctuation` optionally removes Unicode punctuation from both the submission and accepted answers; it defaults to false. No stemming, semantic matching or LLM is involved. Case-insensitive matching also applies to chemical symbols; prefer names if case is meaningful in your question.

Numerical question:

```json
{
  "id": "physics-17-example",
  "type": "numerical",
  "prompt": "Enter Earth's approximate gravitational acceleration in m/s², to two decimal places.",
  "numericAnswer": 9.81,
  "tolerance": 0.02,
  "reward": 10
}
```

Tolerance is an inclusive absolute difference, not a percentage. It defaults to zero. A tiny floating-point allowance handles representation errors. Students enter numbers without units; `5`, `5.0`, `+5` and `5e0` match the same value. Negative numbers, decimal points and scientific notation are supported. Commas, fractions such as `1/2`, units, infinity, hex and empty strings are rejected without counting an attempt. State units and rounding in the prompt. Put nonzero tolerance on approximate calculations.

Prompts are plain text, not HTML or Markdown. `\n` creates a line break, useful for pseudocode. Type-specific fields cannot be mixed. The runtime validator is in `server/questions.ts`.

Editing checklist: ensure one precise answer, explicit assumptions/units, no prose grading, valid distractors, and an age-appropriate difficulty progression. Keep accepted variants intentional. Reordering/removing questions during an event can change which question a stored progress index points at; edit between events and reset.

The revised bank uses explicit units, reference quantities and operation order to distinguish careful reasoning from rushed answers. Distractors target common misconceptions. Numerical tolerances still apply to the requested final quantity, not an intermediate calculation.
