# ADR-0021: Live Learning Capture and Shadow Runtime

- **Status:** Proposed. Newly authored/planned for this slice (ALF-1A) --
  not yet implemented as a live-enabled runtime behavior. Every flag this
  ADR describes ships disabled by default; nothing here is accepted
  architecture as an ACTIVE data-collection behavior until a Product Owner
  review lands it and explicitly enables it.
- **Date:** 2026-09-01
- **Decision Makers:** Product Owner (Aryan Barakzai) - decision; Claude Code - drafting.
- **Supersedes:** None
- **Superseded by:** None

## Operational note: ADR-0020's production migration

ADR-0020's `ai_learning_events` migration was applied to production after
explicit Product Owner authorization. Production migration record:

```
20260901184730_ai_learning_events
```

This ADR (ALF-1A) requires no new migration -- `ai_learning_events` and its
schema, RLS posture, and idempotency constraint (all from ADR-0020) are
reused unchanged. If a genuine schema gap is discovered during this slice's
own implementation, the correct response is to STOP and report it, not to
author/apply a new migration silently -- no such gap was found; this ADR
records none.

## Context

ADR-0020 built the foundation (the ledger, the contracts, the eval fixture,
the scorer) but deliberately granted it zero runtime authority and zero
connection to real Chat traffic (ADR-0020 Section 13). That foundation
cannot start accumulating real signal, and a shadow model cannot be
benchmarked against real usage, until something actually calls it from
inside `/chat`. ALF-1A is that connection -- and only that connection: it
makes the foundation *observe* real traffic, still with zero effect on
what any user sees or what SmartFlow does.

Two capabilities are added:

1. **Live production-label capture**: recording what SmartFlow's own
   deterministic `/chat` routing logic actually decided for a real turn,
   as a `production_label` ledger event.
2. **Shadow routing prediction**: optionally, for a sampled subset of
   turns, asking a separately-configured candidate model the same routing
   question and recording its answer as a `shadow_prediction` (`candidate`
   confidence, zero authority) ledger event.

## Problem

Building this naively risks exactly the failure modes ADR-0020 exists to
prevent:

- A shadow call that blocks or slows the user's `/chat` response.
- A shadow call whose failure becomes a user-visible `/chat` failure.
- A shadow prediction that quietly influences a real routing/write/approval
  decision because a future refactor added a shortcut "just this once."
- A shadow prediction persisted with more label confidence than it earned
  (ADR-0020: a model prediction is never truth).
- A production label that lies about what production code decided, because
  it was reconstructed from raw message text instead of read directly off
  the same deterministic decision production code already made.
- Silent enablement -- a misconfigured or partially-set flag accidentally
  turning capture or shadow prediction on.
- A raw user message ending up in the ledger, in a log line, or in a
  provider-provenance field.
- Duplicate/ambiguous ledger rows because the source message's identity
  isn't pinned to the same durable id the row was actually inserted with.

## Decision

1. **Production remains authoritative; the shadow subsystem has zero
   runtime authority.** Nothing this ADR introduces is read back into
   FAST vs. LEGACY lane selection, Task vs. Calendar domain resolution,
   tool selection, tool arguments, approval requirements, `flow_write_permissions`
   policy, execution intent, execution lifecycle, Memory, attachments,
   GitHub, or retries/fallback routing. There is no code path anywhere
   from a `shadow_prediction` event back into any of those systems. Every
   shadow-sourced event is unconditionally `producerType: 'shadow_model'`,
   `eventKind: 'shadow_prediction'`, `labelConfidence: 'candidate'` --
   enforced by ADR-0020's own closed `EVENT_KIND_SEMANTICS` table
   (`shared/aiLearning.ts`), not merely by this module's own discipline.
2. **`ctx.waitUntil` is not a durable queue.** Every capture call in this
   slice runs via Cloudflare's `ExecutionContext.waitUntil(...)`, which
   extends the Worker's execution lifetime for that promise but gives NO
   guarantee of eventual delivery -- an isolate eviction, a deploy
   boundary, or a crash mid-flight can silently drop the work. This is a
   best-effort observational signal, not an audit-grade record. Guaranteed
   completeness (never losing a turn's learning signal) requires a
   separate Queue/background-infrastructure slice, explicitly deferred.
   Nothing in ALF-1A claims or depends on delivery guarantees it cannot
   make.
3. **Learning failure is never production failure.** Every capture call is
   fire-and-forget: never awaited by the request path, never able to
   delay, alter, or fail the user's `/chat` response, its HTTP status, or
   trigger a retry of any consequential production action.
   `agent/worker/ai-learning/live-capture.ts`'s `captureProductionRoutingTurn`
   never throws (an internal try/catch is the last line of defense on top
   of every dependency already being individually non-throwing).
4. **Fail-closed configuration, every field independently.**
   `AI_LEARNING_CAPTURE_ENABLED`, `AI_SHADOW_ENABLED`,
   `AI_SHADOW_PROVIDER`, `AI_SHADOW_MODEL_ID`, `AI_SHADOW_MODEL_VERSION`,
   `AI_SHADOW_SAMPLE_RATE` are plain server-owned `wrangler` vars (no
   secret, nothing browser-exposed). An absent or malformed capture flag
   means capture is OFF; an absent/malformed shadow flag, provider, model
   id, model version, or an out-of-range/non-numeric sample rate means
   shadow prediction is OFF -- and shadow is force-disabled whenever
   capture itself is disabled, since there would be nowhere valid to
   persist it. None of these ship set to an enabling value in this slice.
5. **No provider fallback for shadow evaluation, ever.** The
   `ShadowModelProvider` interface
   (`agent/worker/ai-learning/shadow-model-provider.ts`) is provider-neutral;
   its only implementation today,
   `agent/worker/ai-learning/providers/workers-ai-shadow-provider.ts`, uses
   `env.AI` directly. If the configured candidate fails (binding throws,
   malformed/invalid output), the shadow attempt fails outright -- it is
   never silently retried against Gemini, the production text-generation
   provider, or any other model. Substituting providers on failure would
   corrupt model-specific evaluation provenance: a `shadow_prediction`
   event's entire value is knowing EXACTLY which model produced it.
6. **The Workers AI production Chat model is not automatically the shadow
   model. The base/shadow model remains independently configured, never
   inferred.** `AI_SHADOW_MODEL_ID`/`AI_SHADOW_MODEL_VERSION` are
   caller-supplied config, never derived from `AI_TEXT_PROVIDER`,
   `GEMINI_MODEL`, or any production text-generation constant. ADR-0020
   Decision 11 (`base model = UNDECIDED`) is unchanged by this slice --
   ALF-1A adds the capability to run a configured candidate, not a
   decision about which candidate SmartFlow Core will eventually use.
7. **Deterministic, server-owned sampling.** Shadow sampling
   (`agent/worker/ai-learning/shadow-sampling.ts`) is bucketed on the
   durable source-message id (a bit-mixed hash, not `Math.random()`), so
   the SAME source message at the SAME configured sample rate always
   produces the SAME sampling decision -- useful for later auditing which
   turns were even eligible. Production-label capture is independent of
   shadow sampling: every captured turn gets a production label regardless
   of whether it was also sampled for shadow.
8. **The minimal shadow routing prompt asks for exactly the ALF-0 contract,
   nothing else.** No prose, no chain-of-thought, no tool execution, no
   credentials, no database context -- see
   `agent/worker/ai-learning/shadow-routing-prompt.ts`'s
   `SHADOW_ROUTING_SYSTEM_PROMPT`. Temperature 0 where supported, a small
   bounded max-output-tokens. Output is parsed and run through the SAME
   canonical shared validator every other ledger payload uses
   (`collectIntentRoutingLearningPayloadErrors`) -- there is no separate,
   weaker acceptance rule for shadow output. Invalid output is never
   persisted; only bounded metadata is logged (reason code, provider,
   model, elapsed time) -- never the raw prompt or the raw model response.
9. **Raw message text is transient only.** The user's message is passed to
   a `ShadowModelProvider` because a prediction requires input, and
   nowhere else. It is never included in an `ai_learning_events.payload`,
   never logged, never part of a provider-provenance field, never part of
   an error string. The ledger continues to store only
   `source_message_id` + `source_hash` (never a text duplicate) --
   unchanged from ADR-0020.
10. **Exact durable source-message correlation, no lookup.** The Worker
    now pre-generates the user message's row id (`crypto.randomUUID()`,
    the same established pattern already used in `github-integration.ts`
    for a client-supplied `id` overriding a `default gen_random_uuid()`
    column) BEFORE the `agent_chat_messages` INSERT for this turn, and
    reuses that exact id as `ai_learning_events.source_message_id`. This
    was verified achievable with no migration, no added round trip, and no
    behavior change for any existing reader (see this slice's own
    architecture research: no foreign key references
    `agent_chat_messages.id`, and `Prefer: return=minimal` already meant
    the Worker never read the Postgres-generated id back). There is no
    "find the latest message" / "match by content" / "match by
    approximate timestamp" anywhere in this design -- all three are
    concurrency-unsafe and were explicitly rejected.
11. **Deterministic correlation and idempotency, never random/time-based
    once a source id exists.**
    `correlationId = ai-learning:chat:<sourceMessageId>`;
    `productionLabelIdempotencyKey = <correlationId>:production-label:intent-routing-v1`;
    `shadowIdempotencyKey = <correlationId>:shadow:<providerId>:<modelId>:<modelVersion>`
    (model provenance is part of the key -- a different model producing a
    prediction for the same turn is a genuinely distinct event, never a
    duplicate). ADR-0020's existing reconciliation
    (`agent/worker/ai-learning/learning-ledger.ts`) is reused unchanged and
    remains authoritative: identical content at the same key is an
    idempotent no-op success; different content at the same key is
    `IDEMPOTENCY_CONFLICT`; history is never rewritten.
12. **The production label describes what SmartFlow's OWN deterministic
    code decided -- never re-derived from raw text, never influenced by
    shadow output.** `buildProductionRoutingLabel`
    (`agent/worker/ai-learning/production-routing-label.ts`) is a thin
    assembler/validator; every field it receives is a value `/chat`'s own
    existing deterministic logic (`detectWriteDomainSignal`,
    `resolveServerFlowWriteMode`, `writeIntentOutcomeIdentity`, the
    literal `pendingWritePolicy`/`mode` values already sent to the
    frontend) already computed. `requiresApproval` reflects the actual
    resolved write mode (`'auto'` → false; a real `'ask'` pending state,
    or an `'auto'` execution that fell through to that same pending state
    because the target wasn't found → true; `'off'` → false, nothing is
    ever pending) -- never hardcoded to "every write requires approval."
    Core scheduling semantics stay exactly as `shared/schedulingDomain.ts`
    already defines them (unchanged by this ADR): a task-noun request
    carrying a concrete clock time resolves to Calendar; a date-only
    task-noun request stays a Task; an explicit calendar/event/meeting
    noun is Calendar; a non-write informational sentence that merely
    mentions a time is never treated as a write.
13. **A partial, truthful timeline beats a complete, fabricated one.**
    ALF-1A persists only `production_label` and `shadow_prediction`
    events -- `turn_observed` is NOT fabricated merely to make a turn's
    timeline look complete, and is not written by this slice at all.
    Capture happens at exactly five deterministic outcome points inside
    `handleChat` (see `agent/worker/index.ts`'s own comment at each): the
    ambiguous-domain early return, the mode==='off' early return, each
    terminal outcome inside `respondToWriteExecution` (executed/clarify/
    failed/provider_unavailable), the pendingWritePolicy('ask') assignment,
    and the no-write-trigger-at-all (`writeDomainSignal==='none'`)
    conversational path. A turn whose write-domain signal matched but
    whose fuller intent assembly then declined (a narrow edge case) is
    deliberately left uncaptured rather than mislabeled either way --
    see this slice's own architecture research for why.
14. **`user_feedback` and `execution_outcome` are explicitly out of
    scope for ALF-1A.** They require designing correlation with the
    approval/execution surfaces this slice does not touch, and will follow
    once that correlation is explicitly designed -- not bolted on here as
    a fabricated placeholder.

## What This ADR Deliberately Does NOT Do

- **Grants no runtime authority to any model.** Identical posture to
  ADR-0020 Section 13: no policy, permission, approval, or user-visible
  response changes as a result of this ADR or its accompanying code
  landing, regardless of which flags are later flipped on.
- **Does not enable anything.** Every flag ships OFF; enabling capture
  and/or shadow prediction in any real environment is a separate,
  explicit, reviewed configuration change this ADR does not itself make.
- **Does not pick a base/shadow model.** See Decision item 6.
- **Does not build guaranteed-delivery infrastructure.** See Decision
  item 2 -- a Queue-backed slice is future work.
- **Does not wire `user_feedback`/`execution_outcome`.** See Decision
  item 14.
- **Does not touch Chat V2's FAST/LEGACY lane logic, Slice 2A's execution
  lifecycle, Task vs. Calendar scheduling semantics, approval,
  `flow_write_permissions`, uncertainty handling, idempotency (the
  existing write-side kind), Memory, Attachments, GitHub, or Finance.**
  Every capture call site is purely additive, fired via `ctx.waitUntil`
  after the relevant production decision is already final.

## Alternatives Considered

**Fetch the just-inserted `agent_chat_messages` row back via `Prefer:
return=representation` instead of pre-generating the id.** Rejected: adds
a response body the Worker would then have to parse on every insert (a
behavior change to `supabasePost`'s own contract, used at every other call
site in this codebase), where pre-generating via `crypto.randomUUID()`
needs no round-trip change at all and already has a proven precedent in
this exact codebase (`github-integration.ts`).

**"Find the message" by latest-row-for-session, or by content/timestamp
match.** Rejected outright per this slice's own task constraints and this
ADR's Decision item 10 -- both are concurrency-unsafe (two turns in close
succession, or a retried request, can each observe or match the wrong
row), and neither was ever seriously pursued once the pre-generated-id
approach was confirmed feasible.

**Skip production-label capture for non-write (conversational/read) turns
entirely, only capture write-shaped turns.** Considered, and this slice's
actual design lands close to it: `writeDomainSignal==='none'` DOES get a
production label (interactionClass='conversation', domain='none'),
because that IS what production code's own absence of domain-specific
handling truthfully represents (see Decision item 12/13's own reasoning).
What is genuinely skipped is the narrower edge case where a write trigger
matched but intent assembly declined -- deliberately left uncaptured
rather than force-fit into either shape.

**Always run shadow prediction (rate 1, no config gate) whenever capture
is enabled.** Rejected: shadow prediction has real cost (an inference call
per turn) and a different risk profile (an external model call per
production turn) than production-label capture (which only reads values
production code already computed). Keeping them independently
configurable, with shadow additionally requiring its own explicit
enablement, provider, model, and version, lets capture alone be turned on
first and evaluated before any inference cost is incurred.

**Build the shadow prompt using Workers AI's structured/JSON-schema
generation mode, matching Gemini's structured-generation path.** Not
available: ADR-0018 Decision 5 keeps structured generation Gemini-only
today. The shadow adapter instead prompts for JSON via plain text
generation and parses defensively (tolerating a stray markdown code fence
the model may add despite instructions), running the result through the
same shared validator regardless.

## Consequences

- Five new call sites inside `agent/worker/index.ts`'s `handleChat` (and
  one new parameter pair threaded through `respondToWriteExecution`),
  each fire-and-forget via `ctx.waitUntil`, each additive and gated on
  `liveCaptureConfig.captureEnabled` before `ctx.waitUntil` is even
  called (so a disabled deployment schedules zero extra work of any kind).
- Every `agent_chat_messages` INSERT for the user's own message across
  every branch of `handleChat` now supplies an explicit, pre-generated
  `id` -- the row's identity is unchanged in shape (still a `uuid`), only
  its origin (Worker-generated vs. Postgres-default-generated) changes.
- New isolated modules under `agent/worker/ai-learning/` (config
  resolution, sampling, correlation, the production-label builder, the
  provider interface, the Workers AI adapter, the routing prompt, and the
  orchestrator) -- all independently unit-tested, all with zero import
  from any of the five files this codebase's own review process has
  historically treated as sensitive-to-touch (`ChatPage.tsx`,
  `intentValidator.ts`, `reasoningPrompt.ts` remain completely untouched;
  `flow-write-policy.ts` and `index.ts` are touched only additively).
- No new migration. `ai_learning_events`'s schema, RLS posture, and
  idempotency shape are exactly as ADR-0020 left them.
- No user-visible behavior change, regardless of whether the new flags are
  later enabled -- enabling them only changes what gets written to a
  table nothing in the product reads from yet.

## Related ADRs

- [ADR-0016: Proposal Outcome Ledger](ADR-0016-proposal-outcome-ledger.md)
- [ADR-0018: Capability-Oriented AI Provider Abstraction](ADR-0018-capability-oriented-ai-provider-abstraction.md)
- [ADR-0020: AI Learning Foundation and Shadow Model Governance](ADR-0020-ai-learning-foundation-and-shadow-model-governance.md)
