# ai/evals/intent-routing-v1/ — gold evaluation fixture

**This is EVAL DATA. Never automatically train on this dataset.** Its
entire value as a benchmark depends on staying held out — a model trained
on its own exam makes every future comparison against this fixture
meaningless. See
[ADR-0020](../../../docs/decisions/adr/ADR-0020-ai-learning-foundation-and-shadow-model-governance.md)
Decision item 7. There is no code anywhere in this repository that reads
`cases.jsonl` and writes it into a training export; none should be added
without a fresh ADR decision.

## What this is

`cases.jsonl` is the first version of SmartFlow's fixed gold standard for
the `intent_routing_v1` learning task — 117 hand-authored cases recording
**approved product semantics**, independent of any current implementation
(`intentValidator.ts`, `flow-write-policy.ts`, or any model). It exists so
a candidate base model, a LoRA adapter, or a future change to the
deterministic routing code can be scored against a fixed target via
`scripts/ai-learning/score-eval.mjs`.

## Coverage

117 cases, balanced exactly 39/39/39 across English, German, and
Farsi/Dari, spread evenly (9 cases each) across 13 categories:

| Category | What it tests |
|---|---|
| `ordinary_conversation` | Small talk / no action needed |
| `task_read` | Reading existing tasks |
| `task_create` | Creating a task, no date/time involved |
| `calendar_read` | Reading calendar/events |
| `calendar_create` | Creating a calendar event via an explicit calendar/meeting noun |
| `exact_time_scheduling` | A task-noun request that carries a concrete clock time — resolves to **calendar**, not tasks, because Tasks has no time-of-day field (the PO's core "preserve the user's semantics, not the database noun" rule — see `shared/schedulingDomain.ts`) |
| `date_only_task` | A task-noun request with a date but no clock time — stays a **task** |
| `calendar_update` | Rescheduling/moving an existing calendar event |
| `ambiguous` | Conflicting task/calendar nouns in one request — resolves to `interactionClass: 'clarification'`, `domain: 'unknown'` |
| `negative_time_mention` | A time is mentioned but the turn is a **read**, not a write (e.g. "What time is my meeting tomorrow?") |
| `github_read` | Reading GitHub PRs/issues/checks |
| `finance_classification` | Finance reads (spending/income summaries) and one finance write (logging an expense) per language |
| `unsupported` | Out-of-scope requests SmartFlow has no domain for (ordering food, booking flights, playing music) |

### The two canonical semantic cases

These two Farsi cases are the reference pair the task/calendar routing
rule is built around, and are marked `"canonical": true` in the fixture:

1. **"برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم"** (with an exact
   time) → `interactionClass: 'write'`, `domain: 'calendar'`,
   `intentType: 'create_calendar_event'`, `toolId: 'calendar.create_event'`,
   `requiresApproval: true`.
2. **"برای فردا یک تسک بساز که به احمد زنگ بزنم"** (date only, no time) →
   `interactionClass: 'write'`, `domain: 'tasks'`,
   `intentType: 'create_task'`, `toolId: 'tasks.create'`,
   `requiresApproval: true`.

This fixture does not depend on PR #203's implementation code — it
records the approved semantics independently of whichever code currently
implements them.

## Record shape

One JSON object per line (JSONL):

```json
{
  "caseId": "routing-fa-exact_time_scheduling-01",
  "category": "exact_time_scheduling",
  "language": "fa",
  "utterance": "برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم.",
  "expected": {
    "schemaVersion": "intent-routing-v1",
    "language": "fa",
    "interactionClass": "write",
    "domain": "calendar",
    "intentType": "create_calendar_event",
    "toolId": "calendar.create_event",
    "requiresClarification": false,
    "requiresApproval": true
  },
  "canonical": true
}
```

- `expected` is shaped exactly like `IntentRoutingLearningPayloadV1`
  (`shared/aiLearning.ts`) — the same type a `turn_observed`/
  `production_label`/`shadow_prediction` ledger event's `payload` carries.
- `intentType`/`toolId` are omitted for cases with no concrete resolved
  intent (`ordinary_conversation`, `ambiguous`).
- `canonical: true` marks the two reference cases above; absent (not
  `false`) on every other case.

## Running the scorer against this fixture

See [scripts/ai-learning/README.md](../../../scripts/ai-learning/README.md).
A prediction JSONL file must supply one `{ "caseId": "...", "predicted":
{...} }` line per case (`predicted` in the same shape as `expected`).
