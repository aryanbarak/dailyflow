# ai/training/ — training-data contract and LoRA harness skeleton

**Status: contract/skeleton only. No training has run. No weights exist.**
See [ADR-0020](../../docs/decisions/adr/ADR-0020-ai-learning-foundation-and-shadow-model-governance.md)
Decision items 6, 7, and 9 for the full governance this directory
implements.

## Training-example contract

Defined in
[`shared/aiLearningTrainingExample.ts`](../../shared/aiLearningTrainingExample.ts)
as `AiTrainingExampleV1` (`schemaVersion: 'training-example-v1'`) — a
**separate format from the gold evaluation fixture**
(`ai/evals/intent-routing-v1/`). Evaluation examples exist to MEASURE a
model; training examples exist to TEACH one. There is no code anywhere in
this codebase that promotes an eval case into a training example, and
none should be added without a fresh ADR decision — see
`ai/evals/intent-routing-v1/README.md`'s own warning.

Every training example carries explicit provenance. `AiTrainingExampleV1`
is a **CLOSED top-level shape** — the ten fields below are the entire
allowed field set; an unrecognized extra field (a stray `access_token`, an
untracked `rawMetadata` blob, anything else) is rejected outright, the
same closed-shape discipline `IntentRoutingLearningPayloadV1`
(`shared/aiLearning.ts`) already applies to a ledger event's payload:

| Field | Meaning |
|---|---|
| `exampleId` | Stable identifier |
| `schemaVersion` | Always `'training-example-v1'` |
| `learningTask` | e.g. `'intent_routing_v1'` |
| `source` | `synthetic` \| `real_user` \| `corrected` \| `execution_verified` |
| `language` | `en` \| `de` \| `fa` \| `unknown` |
| `input` | The example's input text |
| `expectedOutput` | An `IntentRoutingLearningPayloadV1` (same shape as a ledger event's payload) |
| `confidence` | An `AiLearningLabelConfidence` — how much to trust `expectedOutput` |
| `privacyStatus` | `unreviewed` \| `sanitized` \| `cleared_for_export` |
| `createdAt` | ISO-8601 timestamp |

### `isExportableForTraining` — three separate gates, all required

`isExportableForTraining(value)` accepts `unknown` and combines **three**
independent checks, all of which must pass — a caller cannot skip any of
them by asserting a type or by satisfying only one:

1. **Structural validity.** The full `AiTrainingExampleV1` contract
   (`collectAiTrainingExampleErrors`) must pass — a malformed runtime
   object is never exportable merely because TypeScript typing was
   bypassed. This includes the closed-shape check above (an otherwise
   well-formed example carrying an extra unrecognized field is invalid,
   and therefore never exportable, even with maximal privacy/confidence)
   and enforces `example.language === example.expectedOutput.language`:
   an example cannot be categorized as one language while teaching the
   model to output another.
2. **Privacy.** `source: 'synthetic'` examples (no real user data
   involved) skip this gate entirely — there is nothing to sanitize.
   Every other source (`real_user`, `corrected`, `execution_verified`)
   defaults to `privacyStatus: 'unreviewed'` and is refused until a human
   or process step explicitly moves it to `sanitized` or
   `cleared_for_export`.
3. **Quality/truth — separate from privacy, and applies to EVERY source,
   `synthetic` included.** `source: 'synthetic'` means "no real-user
   privacy review required." **It does not mean "automatically trusted
   ground truth."** A model/teacher-generated candidate label
   (`confidence: 'candidate'`) is never training-exportable, for any
   source — see ADR-0020 Decision item 6. Each source has its own minimum
   confidence, compared by rank
   (`candidate < validated < user_confirmed < execution_verified`):

   | `source` | minimum `confidence` |
   |---|---|
   | `synthetic` | `validated` |
   | `real_user` | `validated` |
   | `corrected` | `user_confirmed` |
   | `execution_verified` | `execution_verified` (exact — already the top tier) |

   Confidence is compared by rank only; nothing here ever silently
   upgrades a weaker confidence to satisfy a stronger requirement.

**No automatic "all chats → training" exporter exists or is planned in
this slice.** Building one — even one that calls `isExportableForTraining`
correctly — is out of scope for ALF-0. This contract only defines the
shape and the gates a future, explicitly-reviewed exporter must satisfy.
Teacher/model-generated examples, whatever their `source`, must be
validated against every one of these gates before they may enter a
training dataset.

## LoRA training harness (skeleton only)

The config contract is defined in
[`shared/aiLoraTrainingConfig.ts`](../../shared/aiLoraTrainingConfig.ts)
as `LoraTrainingConfig` — no training code in this repository reads or
writes it yet; this is the shape a future harness must satisfy.

The intended training stack is **provider-independent**:

```
Hugging Face Transformers + PEFT/LoRA + TRL (or an equivalent SFT pipeline)
```

Cloudflare (Workers AI) is an **inference target**, never the owner of
training assets — no Cloudflare-specific model identifier belongs in the
neutral training contract below. A trained adapter may later be uploaded
to Cloudflare (or any other inference provider) for serving; that upload
step is not part of this contract.

A training run's configuration must eventually record every one of these
fields (no training code in this slice reads or writes them yet — this is
the checklist a future training-config module/file must satisfy):

- exact base model id **and** revision (see `AiModelManifest.baseModelId`
  / `exactBaseRevision` in `shared/aiLearning.ts`)
- tokenizer / chat template identity
- training dataset version (a set of `AiTrainingExampleV1` rows, pinned)
- LoRA rank
- LoRA alpha
- target modules
- learning rate
- epochs
- seed
- max sequence length
- eval suite version (which version of `ai/evals/intent-routing-v1/` the
  resulting adapter must be scored against before it can be considered
  usable — see [ADR-0020](../../docs/decisions/adr/ADR-0020-ai-learning-foundation-and-shadow-model-governance.md)
  Decision item 10)

### Base model selection: intentionally undecided

Per [ADR-0020](../../docs/decisions/adr/ADR-0020-ai-learning-foundation-and-shadow-model-governance.md)
Decision item 11:

```
base model = UNDECIDED
status = experimental selection pending benchmark
```

The current Workers AI production text model is **not** automatically the
SmartFlow Core training base. Candidate models are benchmarked separately,
using `scripts/ai-learning/score-eval.mjs` against
`ai/evals/intent-routing-v1/cases.jsonl`, before any base model is chosen.

## What this directory does NOT do

- Does not run training. No GPU job, no `transformers`/`peft`/`trl`
  dependency, no training script exists in this repository yet.
- Does not download or commit model weights (`*.safetensors`, `*.gguf`,
  checkpoints — see the root `.gitignore`).
- Does not pick a base model.
- Does not build the "all chats → training" exporter.
