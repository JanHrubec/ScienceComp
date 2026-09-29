# Question bank format

The five subject JSON files are the source of truth. All three age tracks live in the subject's file. Questions appear in array order, with no randomisation. All 300 supplied questions include English and Czech. The bank retains the original competition’s subject matter, but is ordered and edited against the same age-relative progression in all 15 tracks. IDs remain stable identifiers; their numeric suffix is **not** the displayed question number. Array position determines the displayed number.

Difficulty should rise gradually from the very first question. There is no designated warm-up block, fixed breakpoint at question 5, or automatic difficulty band. Even the first question should require interpreting evidence, distinguishing quantities, applying a concept or performing a short calculation; recognising an obvious word alone should not be enough.

As a track progresses, build on that starting level by gradually combining more conditions, operations, unit conversions and competing explanations. Keep late questions demanding without introducing a sudden dependence on obscure terminology. A conceptual question can be as demanding as a numerical one: compare the reasoning required, not prompt length or answer type. Retain useful formulas where they prevent specialist recall from dominating, but avoid hints that effectively state the answer.

Mix calculations with predictions, experiments, model comparisons, classification and interpreting evidence. A younger track should build intuition about its subject, not merely attach subject nouns to arithmetic. Give unfamiliar definitions and relationships where they let students reason without having taken that IB course. Do not give away the inference the question asks them to make.

Short text is welcome for familiar scientific words, directions, inferred outcomes, formulas, sequences and code output. Constrain the requested answer and explicitly accept sensible English and Czech variants, including accentless Czech where helpful. Avoid obscure terminology recalled without context and anything requiring prose or semantic grading. Multiple choice is useful for comparing explanations, including the meaning of a supplied technical term.

The current bank has 128 numerical, 112 multiple-choice and 60 short-text questions, with all three types in every track. These are editorial choices, not required quotas. [Coverage and progression](COVERAGE.md) maps the questions to broad IB subject areas and records what this short competition does not assess.

Fair traps concern what is requested: change versus final value, distance versus displacement, pairs versus individuals, bits versus bytes, total versus per-item rate, or the order of two percentage changes. Keep each sentence necessary, specify units, and use distractors that reflect plausible mistakes. Avoid hidden assumptions and long puzzles that mostly test reading endurance.

Use the same age-relative standard across subjects. Compare neighbouring questions and equivalent positions in other tracks when editing, including the opening items; there is no special status for question 5. English and Czech must preserve the same reasoning and constraints. Difficulty remains an editorial judgement until tested with representative teams; rehearsal timings, errors and skips can reveal local dips or spikes.

```json
{
  "subject": "physics",
  "tracks": {
    "11–13": [
      {
        "id": "physics-11-01",
        "type": "multiple-choice",
        "prompt": "Equal masses of water at 20 °C and 40 °C are mixed. No heat escapes and the container absorbs no heat. What is the final temperature?",
        "choices": ["20 °C", "30 °C", "40 °C", "60 °C"],
        "correctIndex": 1,
        "cs": {
          "prompt": "Smícháme stejná množství vody o teplotách 20 °C a 40 °C. Teplo neuniká a nádoba žádné nepohltí. Jaká je výsledná teplota?",
          "choices": ["20 °C", "30 °C", "40 °C", "60 °C"]
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
  "id": "computer-science-11-example",
  "type": "text",
  "prompt": "Enter the word printed.\nx = 3 + 2\nIF x > 5 THEN PRINT \"YES\" ELSE PRINT \"NO\"",
  "acceptedAnswers": ["NO"],
  "cs": {
    "prompt": "Zadejte vypsané slovo.\nx = 3 + 2\nIF x > 5 THEN PRINT \"ANO\" ELSE PRINT \"NE\"",
    "acceptedAnswers": ["NE"]
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
  "prompt": "A runner covers 100 m in 13 s, then rests for 2 s. Find the average speed over the full interval in m/s. Round to two decimal places.",
  "cs": {
    "prompt": "Běžec urazí 100 m za 13 s a pak 2 s odpočívá. Určete průměrnou rychlost za celý interval v m/s. Zaokrouhlete na dvě desetinná místa."
  },
  "numericAnswer": 6.67,
  "tolerance": 0.005,
  "reward": 10
}
```

Tolerance is an inclusive absolute difference, not a percentage. It defaults to zero. A tiny floating-point allowance handles representation errors. Students enter numbers without units; `5`, `5.0`, `+5` and `5e0` match the same value. Negative numbers, a decimal point **or comma**, and scientific notation are supported. `5,0` is also 5; `0,5` is 0.5. A single comma is always a decimal separator, never a thousands separator. Mixed separators, fractions such as `1/2`, units, infinity, hex and empty strings are rejected without counting an attempt. JSON `numericAnswer` and `tolerance` still use JSON numbers with decimal points. State units and rounding in the prompt. Put nonzero tolerance on approximate calculations.

For an exact calculation rounded to two decimal places, use a tolerance of `0.005`, rather than `0.01`, and check the correct rounding plus the adjacent hundredths. For example, a result of 2/3 should accept `0.67` and its unrounded value, but reject `0.66` and `0.68`. Wider tolerances need a reason, such as approximate input data.

Every question requires a `cs.prompt`. Multiple choice also requires `cs.choices` in **exactly the same order and count** as the English choices; one shared `correctIndex` applies to both. Text requires `cs.acceptedAnswers`. Numerical translations share the same numeric answer and tolerance. Startup validation rejects missing translations or mismatched choice counts. Only prompts and choices in both languages reach the browser; all accepted answers stay on the server.

Prompts are plain text, not HTML or Markdown. `\n` creates a line break, useful for pseudocode. Type-specific fields cannot be mixed. The runtime validator is in `server/questions.ts`.

Editing checklist: ensure one precise answer, explicit assumptions/units, no prose grading, valid distractors, and an age-appropriate difficulty progression. Keep accepted variants intentional. Review both languages together for identical numbers, units, assumptions and answer-choice order. Pseudocode keywords stay the same in both languages, with Czech explanations where needed. Reordering/removing questions during an event can change which question a stored progress index points at; edit between events and reset.

Definitions and pseudocode explanations should provide equivalent help in both languages. For multiple choice, each wrong option should represent a plausible misunderstanding, not an obviously absurd statement. For indexing questions, use non-uniform values so the wrong indexing convention cannot accidentally produce the right result. For experimental comparisons, specify which conditions are held constant; for calculations, distinguish the measured system from its surroundings and state any necessary model assumptions.

The revised bank uses explicit units, reference quantities and operation order to distinguish careful reasoning from rushed answers. Distractors target common misconceptions. Numerical tolerances still apply to the requested final quantity, not an intermediate calculation.
