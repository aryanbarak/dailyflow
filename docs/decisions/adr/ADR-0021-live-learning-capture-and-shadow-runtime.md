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

## Correction (round 1)

An architectural review of the first ALF-1A implementation found six truth
boundaries that needed tightening before this design is sound. The
Decision items below already reflect the corrected design; this note
records what changed and why, for anyone comparing against the original
implementation:

1. **Removed the non-write/read production-label capture point.**
   The original design captured `interactionClass: 'conversation',
   domain: 'none'` whenever no write trigger matched. This was found to be
   a false claim of truth: production `/chat` has no deterministic
   classifier that distinguishes ordinary conversation from a read of
   tasks, calendar, GitHub, or any other domain for such a turn -- only
   the ABSENCE of a matched write trigger is actually known. That is not
   the same thing as a validated label. This capture point is REMOVED
   entirely (no replacement heuristic, no `read/unknown` catch-all) --
   see Decision item 13. The original acceptance examples M ("سلام" ->
   conversation/none) and P (informational time-mention -> no false
   write) are SUPERSEDED and deferred until SmartFlow has a real
   deterministic non-write/read classifier, built and reviewed as its own
   slice.
2. **Durable-insert-before-capture ordering, enforced structurally.** Every
   capture must follow a successful `agent_chat_messages` insert for the
   exact `sourceMessageId` it references -- never the reverse, and never
   in parallel. The four early/terminal capture points already had this
   order naturally (a synchronous `await` insert precedes the capture
   line; if the insert throws, execution never reaches the capture code).
   The pending-ask-mode capture (`pendingWritePolicy: 'ask'`) did NOT: its
   insert happens later, after the plain-chat model call, in one of three
   different branches. It is now STAGED (in a local variable) at decision
   time and only actually scheduled via `ctx.waitUntil` immediately after
   whichever of those three inserts succeeds -- see
   `scheduleStagedLearningCapture` in `agent/worker/index.ts`.
3. **`source_hash` is now populated on every ledger row this module
   writes**, computed once per `captureProductionRoutingTurn` invocation
   via ALF-0's existing `computeSourceHash` and reused identically for
   both the `production_label` and (when it fires) the `shadow_prediction`
   row belonging to the same turn -- never two independently-computed
   hashes for one turn, and never the raw message itself.
4. **The top-level catch in `captureProductionRoutingTurn` no longer logs
   `error.message`/`String(error)`.** An unexpected failure at that level
   could originate from any dependency in the call chain, including one
   whose own thrown `Error` happens to embed request content -- the only
   safe thing to log unconditionally is a fixed, bounded, content-free
   line (`status=failed reason=unexpected_error`).
5. **`provider_unavailable` is no longer captured as a clarification
   outcome.** It means the AI provider used to resolve a title was
   unreachable -- production returns an honest unavailability reply, not
   a clarifying question, so `requiresClarification` must be `false` for
   it. Only `'clarify'` (the deterministic parser's own follow-up
   question) is a genuine clarification outcome. See
   `agent/worker/ai-learning/write-execution-label.ts`'s
   `requiresClarificationForWriteExecutionStatus`.
6. **Production-label `language` is now always `'unknown'`.** See Decision
   item 15 below.

## Correction (round 2)

A second architectural review, focused on Shadow-boundary safety and
Workers AI catalog compatibility, found four further issues:

1. **A Shadow-specific closed vocabulary now gates `intentType`/`toolId`.**
   `shared/aiLearning.ts`'s `IntentRoutingLearningPayloadV1` deliberately
   keeps `intentType`/`toolId` freeform (any non-empty string) at the
   generic shared-contract level -- correct for that contract, but not
   safe enough for a live Shadow model that has just seen the raw user
   message: a confused or adversarial model could echo that raw message
   straight into `intentType`/`toolId` and still pass generic schema
   validation. `agent/worker/ai-learning/shadow-vocabulary.ts` adds a
   SECOND, Shadow-only gate -- an ALLOWLIST, audited against
   `shared/writeIntentRegistry.ts` (every real write intent/tool) and
   `ai/evals/intent-routing-v1/cases.jsonl` (every audited non-write
   intentType) -- applied in `shadow-routing-prompt.ts`'s
   `parseShadowRoutingOutput` AFTER generic schema validation. Anything
   outside that allowlist is rejected (`schema_invalid`, mapped to
   `invalid_output` by the provider adapter) -- zero
   `shadow_prediction` persistence. The generic shared contract itself is
   deliberately left unchanged; narrowing it would weaken every OTHER
   producer of this payload to solve a problem specific to the Shadow
   boundary. See the Privacy note under Decision item 9 below.
2. **The Workers AI adapter now reads BOTH documented response shapes.**
   The Workers AI catalog has at least two relevant text-generation output
   shapes: the OpenAI-compatible `choices[0].message.content` (the only
   shape previously read) and a bespoke `{ response: "..." }` completion
   shape some candidate families (e.g. Qwen-family models) use instead.
   `WorkersAIShadowModelProvider` now tries both (chat-completions shape
   first, then the bespoke shape) within the SAME single `env.AI.run`
   call for the ONE configured model -- this is compatibility, never a
   fallback: no second model is ever queried, no retry occurs, and an
   unrecognized/missing shape in both locations still returns
   `invalid_output`, never a guess. This does NOT pick Qwen (or any other
   specific model) as SmartFlow Core's base or shadow model -- that stays
   UNDECIDED (Decision item 6) and independently configured; this is
   purely a response-parsing compatibility fix so a correctly-configured
   candidate from either response family can actually be read.
3. **Durable-insert-failure and durable-insert-order are now both
   explicitly tested**, not just structurally implied, for the staged
   `pendingWritePolicy: 'ask'` capture: a failing user-message insert
   results in zero `ctx.waitUntil` call and zero `ai_learning_events`
   POST for that turn (and `/chat` keeps its pre-existing, unrelated
   failure behavior -- the generic honest-retry reply, unchanged by ALF-1A);
   a succeeding insert is proven to happen strictly BEFORE the
   `ai_learning_events` POST it enables.
4. **Live-eval usability limitations are now documented explicitly** --
   see "Live-Eval Limitations (deferred to ALF-1B)" below. Nothing in this
   round changes ALF-1A's own scope: the limitations are recorded, not
   solved, here.

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
   an error string. The ledger stores only `source_message_id` +
   `source_hash` (never a text duplicate) -- the hash primitive itself is
   unchanged from ADR-0020's `computeSourceHash`, and (per the round-1
   correction) is now actually computed and populated on every row this
   module writes, once per turn, identically on the `production_label` and
   any `shadow_prediction` row for that same turn. **A closed top-level
   shape alone is not sufficient (round-2 correction):** even though
   `IntentRoutingLearningPayloadV1`'s top-level keys are closed (ADR-0020),
   two of its fields -- `intentType`/`toolId` -- are deliberately freeform
   strings at that generic level, which a model that has just seen the raw
   message could otherwise abuse to smuggle raw text through a
   structurally-valid field instead of an unrecognized one. Every value a
   Shadow prediction supplies for `intentType`/`toolId` is therefore ALSO
   checked against `shadow-vocabulary.ts`'s allowlist (Decision item 16)
   before the payload is accepted -- transience is enforced at both the
   payload-shape level AND the model-controlled-freeform-field level.
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
    Capture happens at exactly FOUR deterministic outcome points inside
    `handleChat` where production code's own decision is genuinely known
    (see `agent/worker/index.ts`'s own comment at each): the
    ambiguous-domain early return, the mode==='off' early return, each
    terminal outcome inside `respondToWriteExecution` (executed/clarify/
    failed/provider_unavailable), and the pendingWritePolicy('ask')
    assignment. A plain conversational/read turn (`writeDomainSignal ===
    'none'`) is DELIBERATELY NOT CAPTURED (round-1 correction, see the
    Correction note above): production `/chat` has no deterministic
    classifier for what such a turn actually is (ordinary conversation? a
    read of tasks? of calendar? of something else?) -- only the absence of
    a matched write trigger is known, and that absence is not itself a
    validated label. A real non-write/read classifier, once built and
    reviewed as its own slice, can add a truthful capture point for this
    case; until then, capturing nothing is more honest than capturing a
    guess. A turn whose write-domain signal matched but whose fuller
    intent assembly then declined (a narrower, separate edge case) remains
    deliberately uncaptured too, for the same reason.
14. **`user_feedback` and `execution_outcome` are explicitly out of
    scope for ALF-1A.** They require designing correlation with the
    approval/execution surfaces this slice does not touch, and will follow
    once that correlation is explicitly designed -- not bolted on here as
    a fabricated placeholder.
15. **Production-label `language` is always `'unknown'`.** SmartFlow has
    no existing deterministic classifier for the LANGUAGE OF THE CURRENT
    MESSAGE. `handleChat`'s own `language` variable (from
    `fetchUserLanguage`) is the user's stored RESPONSE-LANGUAGE preference
    -- a setting, not a per-message classification -- and using it as if it
    were the message's language would silently mislabel every turn where a
    user types in a language other than their configured preference (e.g.
    an English-preference user typing a Persian message). Every production
    label this slice writes therefore sets
    `IntentRoutingLearningPayloadV1.language = 'unknown'`, deliberately,
    rather than borrowing a value that is not actually message-language
    truth. This is a real capability gap, not an oversight: a future,
    separately reviewed deterministic (non-LLM) message-language
    classifier can fill it in later. The shadow model's OWN predicted
    `language` field is unaffected by this -- it is the model's own
    inference from the message text, independent of the production label
    (see `shadow-model-provider.ts`'s own comment on `languageHint`).
16. **A Shadow-only closed vocabulary gates `intentType`/`toolId`
    (round-2 correction).** `agent/worker/ai-learning/shadow-vocabulary.ts`
    exports an ALLOWLIST -- never a blacklist -- of every `intentType`/
    `toolId` value a Shadow prediction may legitimately carry, audited
    against `shared/writeIntentRegistry.ts` (every real write intent/tool)
    and `ai/evals/intent-routing-v1/cases.jsonl` (every audited non-write
    intentType). `shadow-routing-prompt.ts`'s `parseShadowRoutingOutput`
    applies this gate AFTER the generic `collectIntentRoutingLearningPayloadErrors`
    check passes -- a present `intentType`/`toolId` outside the allowlist
    is rejected (`schema_invalid`); an OMITTED `intentType`/`toolId` (a
    conversation/read/clarification turn) is unaffected, since the gate
    only constrains a value that is actually present. This is deliberately
    NOT a change to the generic shared contract (`shared/aiLearning.ts`) --
    that contract is used by non-Shadow producers too (the production
    label path), which do not carry this particular risk (their values
    come from SmartFlow's own deterministic code, never from a model that
    also saw the raw message).
17. **The Workers AI Shadow adapter reads two documented response shapes,
    never a fallback (round-2 correction).** `WorkersAIShadowModelProvider`
    tries `choices[0].message.content` (OpenAI-compatible, checked first)
    then `response` (a bespoke completion shape some Workers AI candidate
    families use) within the SAME single `env.AI.run` response for the ONE
    configured model. Neither is a retry or a second model query; an
    unrecognized/missing shape in both locations still returns
    `invalid_output`. This is a compatibility fix for reading a correctly-
    configured candidate's actual output shape, not a decision about which
    model SmartFlow Core uses -- the base/shadow model remains UNDECIDED
    (Decision item 6).

## Live-Eval Limitations (deferred to ALF-1B)

Recorded here, not solved here (round-2 correction item 4) -- these are
real gaps in what today's `production_label`/`shadow_prediction` pair can
be used for, not oversights this slice's own code fixes:

- **`production_label.payload.language = 'unknown'` is NOT usable as a
  language gold label** for scoring a Shadow prediction's own `language`
  field, comparing it, or computing anything like the offline scorer's
  existing `languageAccuracy` metric against LIVE-captured data -- see
  Decision item 15. It only becomes usable once a deterministic or
  user-confirmed message-language label exists for the same turn (a
  distinct future capability, not part of ALF-1A/ALF-1B's foundation as
  currently defined).
- **`requiresApproval` is server-policy-dependent, not a property of the
  message text alone.** The exact same message can legitimately produce
  `requiresApproval: true` for one user (a `'ask'`-mode
  `flow_write_permissions` row) and `requiresApproval: false` for another
  (an `'auto'`-mode row) -- this is correct, intentional behavior (Decision
  item 12), but it means a Shadow prediction's own `requiresApproval`
  guess cannot be fairly scored as right-or-wrong purely from the raw
  message; the comparison would need to also know (or explicitly mask
  against) the evaluated user's own resolved write-mode policy at
  prediction time.
- **Therefore: ALF-1B (or whichever slice first turns live-captured
  `production_label`/`shadow_prediction` pairs into a benchmark, a
  training signal, or a promotion decision) MUST define explicit
  comparison/masking semantics for these two fields before doing so** --
  e.g. excluding `language` from live-eval agreement metrics until a real
  gold label exists, and either excluding `requiresApproval` or scoring it
  only against turns where the evaluated user's own resolved policy is
  independently known. ALF-1A/this correction does NOT attempt to solve
  that evaluation-contract design here; solving it would require decisions
  (what counts as a fair comparison, whether/how to fetch the policy
  context at scoring time) that belong to whichever slice actually builds
  the live-eval consumer, not to the capture-only foundation this ADR
  describes. No schema change was found to be required to make this
  documentation possible -- if a future slice concludes one IS required to
  actually solve the comparison problem, that is its own decision to make
  and its own migration to propose, not something to retrofit here.

## What This ADR Deliberately Does NOT Do

- **Grants no runtime authority to any model.** Identical posture to
  ADR-0020 Section 13: no policy, permission, approval, or user-visible
  response changes as a result of this ADR or its accompanying code
  landing, regardless of which flags are later flipped on.
- **Does not enable anything.** Every flag ships OFF; enabling capture
  and/or shadow prediction in any real environment is a separate,
  explicit, reviewed configuration change this ADR does not itself make.
- **Does not pick a base/shadow model.** See Decision item 6 -- and does
  not pick Qwen (or any Workers AI candidate family) either, merely by
  parsing its response shape. See Decision item 17.
- **Does not define live-eval comparison/masking semantics.** See "Live-Eval
  Limitations (deferred to ALF-1B)" above -- capture-only, on purpose.
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

**Capture a production label for `writeDomainSignal==='none'` as
`interactionClass: 'conversation', domain: 'none'`.** This was the
original ALF-1A design, on the reasoning that the absence of
domain-specific handling truthfully represents ordinary conversation.
Round-1 review rejected this: the absence of a matched write trigger only
proves "no write trigger matched" -- it does NOT prove the turn was
ordinary conversation rather than, say, a read of tasks or calendar that
SmartFlow's `/chat` handler has no deterministic code to distinguish
today. Asserting `conversation`/`none` as a `validated`-confidence label
would be asserting more than production code actually knows. This
capture point is REMOVED (see Decision item 13 and the Correction note
above) rather than replaced with a weaker label like `read`/`unknown`,
which would still be a guess dressed up as validated truth.

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

- Four capture-decision points inside `agent/worker/index.ts`'s
  `handleChat` (and one new parameter pair threaded through
  `respondToWriteExecution`), each additive and gated on
  `liveCaptureConfig.captureEnabled`. Three of the four schedule capture
  immediately via `ctx.waitUntil` right after their own durable message
  insert; the fourth (`pendingWritePolicy: 'ask'`) stages its capture and
  schedules it via `ctx.waitUntil` only once the turn's message insert
  actually lands, at whichever of three later insert sites runs for that
  turn (`scheduleStagedLearningCapture`) -- so a disabled deployment, or
  an insert that itself fails, schedules zero extra work.
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
