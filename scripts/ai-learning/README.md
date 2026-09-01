# scripts/ai-learning/

ALF-0's offline evaluation scorer for the `intent_routing_v1` learning
task. See
[ADR-0020](../../docs/decisions/adr/ADR-0020-ai-learning-foundation-and-shadow-model-governance.md).

## score-eval.mjs

Compares a gold JSONL fixture against a prediction JSONL file. No
external API call, no model inference — pure comparison.

```
node scripts/ai-learning/score-eval.mjs <gold.jsonl> <predictions.jsonl>
```

- `gold.jsonl`: the fixture shape from
  [`ai/evals/intent-routing-v1/cases.jsonl`](../../ai/evals/intent-routing-v1/cases.jsonl)
  (`{ caseId, language, expected, ... }` per line).
- `predictions.jsonl`: one `{ "caseId": "...", "predicted": {...} }` per
  line, `predicted` shaped like `expected`. Produced by whatever process
  ran a candidate model/policy against the gold fixture's `utterance`
  values — this script does not run inference itself.

Prints a JSON metrics object to stdout: `totalCases`,
`invalidPredictionCount`, `intentAccuracy`, `domainAccuracy`,
`toolAccuracy`, `clarificationAccuracy`, `approvalAccuracy`,
`exactMatchAccuracy`, and `perLanguageAccuracy` (exact-match rate per
language). A missing or structurally invalid prediction for a gold case
counts toward `invalidPredictionCount` and is never scored as a match on
any metric.

This is the permanent benchmark for comparing a base model, LoRA v0.1,
LoRA v0.2, etc. against the same fixed gold standard.

## Running its own tests

Like `scripts/local-qa-seed.mjs`/`local-qa-seed.test.mjs`, this script's
tests use Node's built-in test runner (not Vitest — `vite.config.ts`
excludes `scripts/**` from the Vitest run), and are not currently wired
into `npm test`:

```
node --test scripts/ai-learning/score-eval.test.mjs
```
