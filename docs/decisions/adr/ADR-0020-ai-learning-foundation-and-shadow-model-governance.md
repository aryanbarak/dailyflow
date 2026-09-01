# ADR-0020: AI Learning Foundation and Shadow Model Governance

- **Status:** Proposed. Newly authored/planned for this slice (ALF-0) --
  not yet implemented as a runtime behavior. Nothing in this ADR is
  accepted architecture until a Product Owner review lands it.
- **Date:** 2026-09-01
- **Decision Makers:** Product Owner (Aryan Barakzai) - decision; Claude Code - drafting.
- **Supersedes:** None
- **Superseded by:** None

## Context

SmartFlow's chat surface makes routing/write decisions on every turn
(read vs. write, which domain, which tool, whether approval is required),
but keeps no durable, portable, provenance-aware record of those
decisions or of how a shadow (candidate) model would have routed the same
turn. Without that record, SmartFlow cannot later train a SmartFlow-owned
model on its own real usage, cannot benchmark a candidate base model or
LoRA adapter against a fixed gold standard, and has no way to
distinguish "the model guessed this" from "this actually happened."

This ADR establishes only the FOUNDATION for that capability: an
append-only ledger, versioned data contracts, a first gold evaluation
fixture, an offline scorer, a training-data contract, and a LoRA training
harness skeleton. It intentionally does not build the loop itself --
Shadow Mode inference, Chat hookup, or any GPU training run are explicit
non-goals of this slice (Slice ALF-0). Runtime Chat hookup is deferred to
a follow-up slice (ALF-1), after the currently in-flight chat-scheduling
work (PR #203) is merged and this branch has rebased cleanly against it.

### Why this needs an ADR, not just a migration

This slice adds a new table that will eventually accumulate real user
turn data, and sets the governance rules for a class of subsystem
(shadow models, offline training) that has no precedent in this codebase.
Every existing ADR about AI in this repo (ADR-0003, ADR-0018) governs a
model that is already part of the live request path. This is the first
ADR governing a model that is explicitly NOT part of the live request
path -- the risk profile, and therefore the guardrails, are different
enough to warrant writing them down before any code that could accumulate
real data exists.

## Problem

Three concrete gaps this slice closes:

1. **No portable learning signal exists.** Every routing decision
   SmartFlow makes today is either implicit in application code (regex/
   pattern matching in `flow-write-policy.ts`/`intentValidator.ts`) or
   discarded after the turn completes. There is no record shaped for
   later training or evaluation.
2. **No gold standard exists.** There is no fixed, versioned set of
   "SmartFlow says this input should route this way" examples a future
   candidate model (base or fine-tuned) can be scored against. Every
   future "should we switch models / should we trust this adapter"
   decision needs one.
3. **No governance boundary exists for a not-yet-built subsystem.**
   Without an ADR fixing the rules now, the natural failure mode once a
   shadow model exists is scope creep -- a "small" hookup that lets a
   shadow prediction quietly influence a real response, or an export
   script that quietly ships raw chat text into a training set. This ADR
   exists to make those failure modes require a NEW ADR to introduce,
   not a silent code change.

## Options Considered

| Option | Description | Reason not chosen |
|--------|-------------|-------------------|
| Do nothing until a model is actually trained | Defer all contracts/schema until GPU training is imminent | Every real turn between now and then is lost signal that can never be reconstructed retroactively; the gold eval set could not exist yet either, so there would be no way to compare candidate models when the time came |
| Reuse `personal_memory_records`/`agent_proposal_outcomes` for learning data | Avoid a new table by piggy-backing on an existing ledger-shaped table | Both tables answer a different question by design (user-facing context; write-proposal shape/outcome) and neither carries the model/provider/label-confidence provenance a training pipeline needs -- overloading either would blur two already-load-bearing tables' semantics, the same anti-pattern ADR-0016 explicitly rejected for its own table (see that ADR's own "why not reuse" reasoning) |
| Let a shadow model's output write directly into `personal_memory_records` or influence `flow-write-policy.ts`'s decision, gated by a feature flag | Fastest path to a working loop | Directly contradicts the task's explicit hard constraint (no runtime authority in this slice) and, more fundamentally, treats an unvalidated model prediction as if it could be truth -- exactly the invariant this ADR exists to prevent from ever being informally waived |
| **Build the foundation only: ledger + contracts + eval fixture + scorer + training-data contract + LoRA harness skeleton, zero runtime hookup** | **Chosen** -- establishes durable schema/contracts now so real signal starts accumulating (once a future slice wires observation in) without granting any model authority yet | Slower to a working end-to-end loop, but the loop's value depends entirely on getting these contracts right before real data starts flowing through them; a foundation slice is the appropriate size for that |

## Decision

1. **A model prediction is never truth.** `ai_learning_events.label_confidence`
   exists specifically to distinguish a raw, unverified model guess
   (`candidate`) from a deterministically validated SmartFlow decision
   (`validated`), an explicit user confirmation/correction
   (`user_confirmed`), and a verified execution outcome
   (`execution_verified`) -- strictly increasing trust, left to right.
   Training truth comes from the latter three; a `shadow_prediction`
   event's payload is never, by itself, eligible to become training
   ground truth, only a candidate for comparison against whatever
   `production_label`/`user_feedback`/`execution_outcome` events exist
   for the same turn.
2. **Gemini (or any other) shadow-model output is not a gold label.**
   Only `deterministic_policy`, `user`, and `execution_verifier` producer
   types can ever attach `validated`, `user_confirmed`, or
   `execution_verified` confidence; `shadow_model` output is permanently
   ceilinged at `candidate`. Enforced today as a documented convention in
   `shared/aiLearning.ts` and the Worker's construction path
   (`agent/worker/ai-learning/learning-ledger.ts`); a database-level
   cross-column CHECK tying producer_type to label_confidence was
   considered and deferred (see Alternatives Considered) rather than
   built into this migration.
3. **The learning ledger is append-only.** `ai_learning_events` rows are
   never UPDATEd to rewrite history -- a later fact about an already-
   observed turn (a shadow prediction, a user correction, a verified
   execution outcome) is always a NEW row sharing the same
   `correlation_id`. This is an application-code discipline (the Worker's
   ledger module has exactly one write primitive, and it is a POST),
   matching the same convention `agent_proposal_outcomes` and
   `agent_tool_executions` already established for their own write paths
   -- not a database trigger, for consistency with those existing tables.
4. **The learning subsystem is not Memory.** `personal_memory_records`
   (ADR-0010) stores user-specific CONTEXT ("the user prefers concise
   replies," "the user's partner is named X") consumed to personalize a
   response. `ai_learning_events` stores REUSABLE DECISION PATTERNS
   ("given this shape of input, SmartFlow/a candidate model routed this
   way") intended to train a model that generalizes across users. Neither
   subsystem reads from or writes to the other; a future slice that finds
   itself wanting to blend them should treat that as a signal the
   boundary needs its own ADR, not a quiet cross-import.
5. **No raw message text is duplicated into the ledger.** Where a durable
   source message already exists (an `agent_chat_messages` row),
   `ai_learning_events` stores `source_message_id` plus `source_hash` (a
   SHA-256 fingerprint, reusing `shared/executionCanonicalization.ts`'s
   existing `sha256Hex` primitive) -- never a second copy of the full
   text. A future Shadow Mode inference call may still receive message
   text transiently (it has to, to produce a prediction), but nothing in
   this slice or its data model persists that text a second time. Export
   for training is a distinct, later, explicitly curated step (item 6),
   never an automatic byproduct of the ledger itself.
6. **Exported training datasets require explicit sanitization/curation.**
   `shared/aiLearningTrainingExample.ts` defines a training-example
   contract with its own `privacyStatus` field
   (`unreviewed` | `sanitized` | `cleared_for_export`), separate from and
   never automatically derived from the ledger. Real-user-sourced examples
   (`source` = `real_user` | `corrected` | `execution_verified`) default
   to `unreviewed` and are refused for export
   (`isExportableForTraining`) until a human/process step moves them past
   that gate. `synthetic` examples (no real user data involved) are
   export-ready unconditionally. No exporter that reads real chat data
   and automatically produces training examples exists or is planned in
   this slice -- see ADR-0020's Section 13 boundary and the task's own
   explicit "do not build an automatic all-chats -> training exporter"
   instruction.
7. **Evaluation data and training data are permanently separate formats
   with no automatic promotion path.** The gold evaluation fixture
   (`ai/evals/intent-routing-v1/cases.jsonl`) and the training-example
   format (`shared/aiLearningTrainingExample.ts`,
   `schemaVersion: 'training-example-v1'`) are distinct TypeScript types
   with distinct `schemaVersion` literals -- a value valid as one is not
   type-compatible with the other. There is no code anywhere in this
   slice, and none should be added later without a fresh ADR decision,
   that reads the eval fixture and writes it into a training export. Eval
   cases exist to MEASURE a model; training examples exist to TEACH one;
   a model that trained on its own exam would make every future
   comparison meaningless.
8. **Model, provider, base model, and adapter are versioned
   independently.** `AiModelManifest` (`shared/aiLearning.ts`) requires
   `providerId`, `baseModelId`, and (when an adapter is present)
   `exactBaseRevision` to be set together -- a manifest with `adapterId`
   set but no `exactBaseRevision` is invalid by construction, because an
   adapter trained against one base revision silently applied to a
   different revision is exactly the kind of drift this contract exists
   to make impossible to represent, let alone ship.
9. **LoRA training is offline and batched, never a per-message weight
   mutation.** `ai/training/README.md` documents the intended
   provider-independent stack (Hugging Face Transformers + PEFT/LoRA +
   TRL or equivalent SFT pipeline) and the fields a training run's config
   must eventually record (base model/revision, tokenizer/chat template,
   dataset version, LoRA rank/alpha/target modules, learning rate,
   epochs, seed, max sequence length, eval suite version). No training
   code runs in this slice; no weights are downloaded or committed.
10. **A new adapter becomes usable only after evaluation against the
    fixed gold set**, via the offline scorer
    (`scripts/ai-learning/score-eval.mjs`) -- exact intent accuracy,
    domain accuracy, tool accuracy, clarification accuracy, approval
    accuracy, per-language accuracy, and invalid-prediction count. No
    external API call, no model inference inside the scorer itself --
    it is a pure comparison between two JSONL files (gold vs.
    predictions), so the same benchmark can compare a base model, LoRA
    v0.1, LoRA v0.2, etc. on equal footing without re-implementing
    scoring each time.
11. **Base model selection is deliberately left undecided.**
    `AiModelManifest.baseModelId` has no fixed value in this slice, and
    the current Workers AI production text model is explicitly NOT
    assumed to be the eventual SmartFlow Core training base -- candidate
    models are benchmarked separately, later, using this slice's own
    scorer/eval fixture. Recorded status: `base model = UNDECIDED`,
    `status = experimental selection pending benchmark`.
12. **Policy, approval, and execution remain deterministic and
    server-owned**, completely unchanged by this slice. Nothing in
    `ai_learning_events`, the learning-ledger module, the eval fixture,
    the scorer, or the training-data contract is read by
    `flow-write-policy.ts`, `intentValidator.ts`, `reasoningPrompt.ts`,
    `agent/worker/index.ts`, or `ChatPage.tsx` -- all five are
    explicitly out of scope for this slice (see Section "Isolation from
    PR #203" below) and untouched by this branch.
13. **Server-owned writes only; no browser access to the ledger.**
    `ai_learning_events` grants `service_role` full access and
    `anon`/`authenticated` none at all (`revoke all ... from anon,
    authenticated`) -- stricter than `agent_tool_executions`'/
    `agent_proposal_outcomes`'s existing SELECT-own pattern, because
    nothing in this slice (or its immediately foreseeable follow-up)
    builds a user-facing surface that needs to read this table back. See
    Alternatives Considered for why the stricter default was chosen over
    matching the SELECT-own precedent.

## Isolation from PR #203

This slice's task instructions explicitly forbid touching
`src/pages/ChatPage.tsx`, `src/features/agent/reasoning/intentValidator.ts`,
`src/features/agent/reasoning/reasoningPrompt.ts`,
`agent/worker/flow-write-policy.ts`, or `agent/worker/index.ts` -- all
five are mid-flight in PR #203 (Chat V2 scheduling semantics). This ADR
and its accompanying code add exclusively new, additive files (a new
migration, a new shared contract module, a new isolated Worker submodule
under `agent/worker/ai-learning/`, new `ai/` and `scripts/ai-learning/`
directories, and this ADR itself) with no edits to any file PR #203
touches. Runtime Chat hookup (having `agent/worker/index.ts` actually call
`appendAiLearningEvent`) is explicitly deferred to a follow-up slice
(ALF-1), after PR #203 merges and this branch rebases cleanly.

## What This ADR Deliberately Does NOT Do

- **Grants no runtime authority to any model.** No approval, execution,
  policy, permission, or user-visible response changes as a result of
  this ADR or its accompanying code landing.
- **Does not call a shadow model.** No Shadow Mode inference code exists
  in this slice; `ai_learning_events.event_kind = 'shadow_prediction'` is
  a defined, valid enum value with no producer yet.
- **Does not wire anything into `/chat`.** `learning-ledger.ts` is
  exported and independently tested; no production call site invokes it.
- **Does not run or schedule any training.** The LoRA harness is a
  documented contract/config-shape skeleton only.
- **Does not pick a base model.** See Decision item 11.
- **Does not build a browser-facing view of learning data.** See
  Decision item 13.

## Alternatives Considered

**Add a database CHECK constraint tying `producer_type` to the maximum
`label_confidence` it may carry (e.g. `producer_type = 'shadow_model'`
implies `label_confidence != 'validated'`).** Considered, and deferred
rather than rejected outright. A hand-maintained cross-column vocabulary
CHECK in the database is exactly the failure class ADR-0013 (Write Intent
Registry v2) already spent significant effort eliminating from this
codebase's write path -- a rule enforceable in application code
(`shared/aiLearning.ts`, guarded by its own test) does not need a second,
harder-to-evolve enforcement point in the schema for a table with zero
runtime writers today. Revisit once a real writer exists and the rule has
proven itself in practice, the same discipline `agent_proposal_outcomes`
already applied to its own `target_fields` column (ADR-0016 Decision
item 6).

**Grant `authenticated` a SELECT-own policy on `ai_learning_events`,
matching `agent_tool_executions`/`agent_proposal_outcomes`.** Rejected for
this slice: those two tables exist specifically to give a user a durable
record of THEIR OWN actions (what they approved, what executed) that a
future UI plausibly reads back. `ai_learning_events` exists to accumulate
training/eval signal for a model that serves everyone -- there is no
concrete near-term reader that needs a user to see their own routing-
decision history. Granting SELECT now, before a reader exists, would be
speculative access-widening with no offsetting need; narrower-by-default
is easier to loosen later (a follow-up ADR amendment) than to tighten
after a UI has come to depend on it.

**Store raw chat message text directly in `ai_learning_events.payload`
for training convenience.** Rejected per the task's explicit instruction
and this ADR's own Decision item 5 -- gratuitous duplication of message
content into a long-lived ledger is a privacy liability with no
analytical need when a reference (`source_message_id`) plus a fingerprint
(`source_hash`) already answer "was this the same input" without
persisting the input a second time.

**Skip the gold evaluation fixture until a candidate model actually
exists to score.** Rejected: building the fixture now, while the desired
product semantics are fresh and explicitly reviewable (see
`ai/evals/intent-routing-v1/README.md`'s own "never train on this"
warning), is cheaper and more accurate than reconstructing "what should
SmartFlow have done" retroactively once training pressure exists to bias
the answer toward whatever the candidate model already produces.

## Consequences

- One new table (`ai_learning_events`), additive only -- no existing
  table, RLS policy, or application code path changes.
- A new `shared/aiLearning.ts` / `shared/aiLearningTrainingExample.ts`
  pair of framework-free contract modules, importable by both the Worker
  and (in a future slice) the frontend.
- A new, isolated Worker submodule (`agent/worker/ai-learning/`) exists,
  tested, and unused by any production call site.
- A new `ai/` directory (evals, training, manifests) begins accumulating
  versioned, git-tracked assets -- explicitly never model weights (see
  `.gitignore`'s new `*.safetensors`/`*.gguf`/checkpoint entries).
- A new `scripts/ai-learning/score-eval.mjs` offline scorer becomes the
  permanent benchmark harness for every future base-model/LoRA-version
  comparison.
- Any future slice that wants to (a) actually call a shadow model, (b)
  wire ledger observation into `/chat`, (c) run a real GPU training pass,
  or (d) pick a permanent base model needs its own follow-up ADR (or an
  amendment to this one) -- this ADR fixes the contracts and the
  governance boundary, not the timeline for crossing it.
- No user-visible behavior, no new runtime authority, no production
  deploy, and no migration apply result from this ADR landing on its own.

## Related ADRs

- [ADR-0003: /agent/reason Remains Local-QA-Only](ADR-0003-agent-reason-local-qa-only.md)
- [ADR-0010: Personal Memory Layer v1](ADR-0010-personal-memory-layer.md)
- [ADR-0011: Confirmed Personal Memory Consumption v1](ADR-0011-confirmed-personal-memory-consumption.md)
- [ADR-0013: Write Intent Registry v2](ADR-0013-write-intent-registry-v2.md)
- [ADR-0016: Proposal Outcome Ledger](ADR-0016-proposal-outcome-ledger.md)
- [ADR-0018: Capability-Oriented AI Provider Abstraction](ADR-0018-capability-oriented-ai-provider-abstraction.md)
