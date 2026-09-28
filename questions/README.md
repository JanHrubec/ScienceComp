# Question bank format

The five subject JSON files are the source of truth. All three age tracks live in the subject's file. Questions appear in array order, with no randomisation. All 300 supplied questions include English and Czech. The bank retains the original competition’s subject matter, but is ordered and edited against the same age-relative progression in all 15 tracks. IDs remain stable identifiers; their numeric suffix is **not** the displayed question number. Array position determines the displayed number.

Difficulty should rise gradually from the very first question. There is no designated warm-up block, fixed breakpoint at question 5, or automatic difficulty band. Even the first question should require interpreting evidence, distinguishing quantities, applying a concept or performing a short calculation; recognising an obvious word alone should not be enough.

As a track progresses, build on that starting level by gradually combining more conditions, operations, unit conversions and competing explanations. Keep late questions demanding without introducing a sudden dependence on obscure terminology. A conceptual question can be as demanding as a numerical one: compare the reasoning required, not prompt length or answer type. Retain useful formulas where they prevent specialist recall from dominating, but avoid hints that effectively state the answer.

Use the same age-relative standard across subjects. Compare neighbouring questions and equivalent positions in other tracks when editing, including the opening items; there is no special status for question 5. English and Czech must preserve the same reasoning and constraints. Difficulty remains an editorial judgement until tested with representative teams; rehearsal timings, errors and skips can reveal local dips or spikes.

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
        "cs": {
          "prompt": "Která jednotka je jednotkou síly v SI?",
          "choices": ["Joule", "Newton", "Watt", "Pascal"]
        },
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
  "cs": {
    "prompt": "Která organela je hlavním místem aerobní tvorby ATP v eukaryotických buňkách?",
    "acceptedAnswers": ["mitochondrie"]
  },
  "ignorePunctuation": false,
  "reward": 10
}
```

Matching ignores case, leading/trailing whitespace and repeated whitespace. Only the explicit English **or Czech** variants are accepted, regardless of the selected UI language. Accents are not removed automatically: add accentless forms to `cs.acceptedAnswers` if desired. Chemical symbols, abbreviations and intentionally English code terms may be identical in both lists. `ignorePunctuation` optionally removes Unicode punctuation from both the submission and accepted answers; it defaults to false. No stemming, semantic matching or LLM is involved. Case-insensitive matching also applies to chemical symbols; prefer names if case is meaningful in your question.

Numerical question:

```json
{
  "id": "physics-17-example",
  "type": "numerical",
  "prompt": "Enter Earth's approximate gravitational acceleration in m/s², to two decimal places.",
  "cs": {
    "prompt": "Zadejte přibližné tíhové zrychlení na Zemi v m/s² na dvě desetinná místa."
  },
  "numericAnswer": 9.81,
  "tolerance": 0.02,
  "reward": 10
}
```

Tolerance is an inclusive absolute difference, not a percentage. It defaults to zero. A tiny floating-point allowance handles representation errors. Students enter numbers without units; `5`, `5.0`, `+5` and `5e0` match the same value. Negative numbers, a decimal point **or comma**, and scientific notation are supported. `5,0` is also 5; `0,5` is 0.5. A single comma is always a decimal separator, never a thousands separator. Mixed separators, fractions such as `1/2`, units, infinity, hex and empty strings are rejected without counting an attempt. JSON `numericAnswer` and `tolerance` still use JSON numbers with decimal points. State units and rounding in the prompt. Put nonzero tolerance on approximate calculations.

Every question requires a `cs.prompt`. Multiple choice also requires `cs.choices` in **exactly the same order and count** as the English choices; one shared `correctIndex` applies to both. Text requires `cs.acceptedAnswers`. Numerical translations share the same numeric answer and tolerance. Startup validation rejects missing translations or mismatched choice counts. Only prompts and choices in both languages reach the browser; all accepted answers stay on the server.

Prompts are plain text, not HTML or Markdown. `\n` creates a line break, useful for pseudocode. Type-specific fields cannot be mixed. The runtime validator is in `server/questions.ts`.

Editing checklist: ensure one precise answer, explicit assumptions/units, no prose grading, valid distractors, and an age-appropriate difficulty progression. Keep accepted variants intentional. Review both languages together for identical numbers, units, assumptions and answer-choice order. Pseudocode keywords stay the same in both languages, with Czech explanations where needed. Reordering/removing questions during an event can change which question a stored progress index points at; edit between events and reset.

The revised bank uses explicit units, reference quantities and operation order to distinguish careful reasoning from rushed answers. Distractors target common misconceptions. Numerical tolerances still apply to the requested final quantity, not an intermediate calculation.
