# ADR-0022: Live Routing Evaluation and Comparison Semantics

- **Status:** Proposed. Implemented as a read-only, provider-neutral
  comparison layer with zero runtime authority and zero persistence --
  nothing here is wired into `/chat`, and nothing here enables Shadow
  (production still has `AI_SHADOW_ENABLED=false` and no shadow model
  configured; this slice ships and is reviewed with Shadow still off).
- **Date:** 2026-09-02
- **Decision Makers:** Product Owner (Aryan Barakzai) - decision; Claude Code - drafting.
- **Supersedes:** None
- **Superseded by:** None
- **Related:** [ADR-0020](ADR-0020-ai-learning-foundation-and-shadow-model-governance.md), [ADR-0021](ADR-0021-live-learning-capture-and-shadow-runtime.md)

## Context

As of this slice (ALF-1B), production state is:

- ALF-0's `ai_learning_events` ledger is deployed.
- ALF-1A's live production-label capture is deployed and verified --
  `AI_LEARNING_CAPTURE_ENABLED=true`, real `production_label` rows exist.
- `AI_SHADOW_ENABLED=false`. No shadow model is configured. No
  `shadow_prediction` rows exist in production today.
- Shadow has zero runtime authority (ADR-0020/ADR-0021) -- this remains
  true and unchanged by this ADR.

ALF-0/ALF-1A built the CAPTURE side (recording what production decided,
and optionally what a candidate model predicted). Nothing yet reads those
two event kinds back TOGETHER to ask "did the candidate agree with
production, and on what." ALF-1B is exactly that: a deterministic,
read-only comparison layer -- and only that. It defines HOW two events for
the same turn are paired, WHICH fields are fair to score, WHICH fields are
masked and why, and WHAT counts as an exact routing match. It does not
enable Shadow, does not persist anything new, and does not feed any
comparison result back into production behavior.

## Decision

1. **`production_label` is authoritative truth; `shadow_prediction` is
   candidate-only.** `compareLiveRoutingEvents`
   (`agent/worker/ai-learning/live-routing-comparison.ts`) never has a
   code path that substitutes a shadow value for the production value it
   is scored against -- `LiveRoutingFieldResult.productionValue` always
   comes from the `production_label` row's own payload, unconditionally,
   even when production is a mismatch or the comparison as a whole is not
   an exact match. Nothing this ADR introduces can make a model-generated
   value become truth (ADR-0020 Decision 2) -- there is no online learning
   and no weight update anywhere in this slice; comparisons are read-only
   arithmetic over already-persisted events.
2. **Pairing is exact-key-only, never heuristic.** Two events are paired
   if and only if they share ALL FIVE of `user_id`, `source_message_id`,
   `correlation_id`, `learning_task`, and `schema_version`. Pairing NEVER
   uses text content, timestamp proximity, "the latest event," or model
   output content -- see `pairingKey` in `live-routing-comparison.ts`. A
   `schema_version` mismatch means the two events are simply never grouped
   together at all (never scored as "incompatible" after the fact --
   incompatibility is structural, by construction of the grouping key
   itself).
3. **Masking is LOCKED for ALF-1B, and explicitly reported, never
   silently dropped:**
   - **`language` is masked.** `production_label.payload.language` is
     always `'unknown'` (ADR-0021 Decision 15) -- it is not a real
     language gold label, so scoring a Shadow prediction's own `language`
     guess against it would only measure how well a model matches a
     placeholder, not a real language classification. `language` is
     never a member of `LIVE_ROUTING_SCORED_FIELDS`, never appears in
     `fieldAccuracy`, and never affects `exactRoutingMatch`.
   - **`requiresApproval` is masked.** It is server-policy-dependent, not
     a property of the message text alone -- the exact same message
     legitimately produces `requiresApproval: true` for one user's
     `'ask'`-mode `flow_write_permissions` row and `false` for another
     user's `'auto'`-mode row (ADR-0021 Decision 12). A Shadow prediction
     has no way to know that per-user policy from the message text, so
     scoring it would penalize the model for something it structurally
     cannot know, not for a routing error. Never scored, never in
     `fieldAccuracy`, never affects `exactRoutingMatch`.
   - Every `LiveRoutingComparisonV1` and every `LiveRoutingEvalReport`
     carries an explicit `maskedFields` array (`['language',
     'requiresApproval']`) and (report-level) a `maskedFieldNote` string
     -- masking is a stated fact of the output, not an implicit omission a
     reader has to infer. The CLI report
     (`scripts/ai-learning/live-eval-report.ts`) prints
     `language: masked` / `requiresApproval: masked` explicitly on every
     run, per this slice's own requirement.
4. **Scored fields**: `interactionClass`, `domain`, `intentType`,
   `toolId`, `requiresClarification` -- `LIVE_ROUTING_SCORED_FIELDS`.
   `exactRoutingMatch` is `true` if and only if ALL FIVE scored fields
   match; masked fields can never affect it, structurally, since they are
   never read into the match computation at all (not merely excluded by a
   conditional -- the loop that computes `exactRoutingMatch` only ever
   iterates `LIVE_ROUTING_SCORED_FIELDS`).
5. **Optional-field comparison semantics (locked):** `interactionClass`/
   `domain`/`requiresClarification` are always present on a structurally
   valid `IntentRoutingLearningPayloadV1`; `intentType`/`toolId` are
   genuinely optional. `scoredFieldMatches` applies ONE rule uniformly to
   every scored field: both sides omitted -> match; one side omitted, the
   other present -> mismatch; both present -> match iff equal. This is
   deliberately the SAME function for every field (not a special case for
   the two optional ones) -- the always-present fields simply never
   exercise the "both omitted" branch.
6. **Semantic-consistency validation, layered on top of the existing
   vocabulary allowlist.** ALF-1A's `shadow-vocabulary.ts` (ADR-0021
   correction round 2) only checks that an individual `intentType`/
   `toolId` VALUE is a known, audited value. It does not check that
   `domain`+`intentType`+`toolId`+`interactionClass` COMBINE into
   something that could ever actually happen -- every individual field
   could be independently legal while the combination is impossible
   (e.g. `domain: "tasks"` with `intentType: "create_calendar_event"` and
   `toolId: "calendar.create_event"`). `agent/worker/ai-learning/shadow-semantic-consistency.ts`
   adds that check: `isSemanticallyConsistentRoutingPayload` derives write
   semantics from `shared/writeIntentRegistry.ts` (never hand-duplicated)
   and pairs them with an explicit, reviewed, fixture-audited mapping for
   non-write (read/unsupported) intentTypes (`read_tasks`, `read_calendar`,
   `read_finance_summary`, `read_github`, `unsupported_request` -- audited
   against `ai/evals/intent-routing-v1/cases.jsonl`'s own gold case data,
   parity-tested against drift). This gate is wired into TWO places:
   - **`shadow-routing-prompt.ts`'s `parseShadowRoutingOutput`** (the LIVE
     Worker parsing path) -- an impossible combination is rejected at the
     earliest possible point, before a `shadow_prediction` row is ever
     persisted at all (defense in depth, matching this codebase's own
     "reject at the boundary" convention).
   - **`live-routing-comparison.ts`'s `isValidRoutingPayloadForComparison`**
     (ALF-1B's own comparison layer) -- a defensive RE-check against
     already-persisted ledger data, including any row written before this
     gate existed. Applied to BOTH `production_label` and
     `shadow_prediction` payloads: production is authoritative truth, but
     a malformed/inconsistent production label is never silently trusted
     as ground truth either -- it is excluded and counted as
     `invalidProductionLabelCount`, never scored.
   An unknown or inconsistent combination is EXCLUDED from eligible
   comparison and reported as an invalid prediction/label
   (`invalidShadowPredictionCount`/`invalidProductionLabelCount`) -- it is
   NEVER treated as mismatch "truth data" suitable for training or
   promotion, and never silently coerced into a comparable shape. This
   does NOT weaken `shared/aiLearning.ts`'s generic contract -- it is an
   additional, narrower check layered on top, exactly like the vocabulary
   allowlist before it.
7. **Duplicate handling is deterministic and documented, never
   arbitrary.** Two failure modes exist, both handled the same way --
   reported, excluded, never silently resolved by picking one:
   - **Duplicate `production_label` rows for one pairing key**
     (`ambiguousProductionGroups`): more than one `production_label` row
     sharing the same `(user_id, source_message_id, correlation_id,
     learning_task, schema_version)` key means production truth for that
     turn is itself ambiguous -- there is no rule (not "latest," not
     "first-seen") that safely resolves this, so the WHOLE key is excluded
     from comparison and counted, never partially used.
   - **Duplicate `shadow_prediction` rows for the SAME model slice**
     (`ambiguousShadowModelSlices`): shadow rows are first grouped by
     `(provider_id, model_id, model_version)` -- a DIFFERENT model
     producing a prediction for the same turn is a genuinely distinct,
     independently-scored observation (this is NOT the "duplicate" case;
     it produces one `LiveRoutingComparisonV1` per model, deterministically,
     matching ADR-0021 Decision 11's own per-model idempotency-key
     provenance). Only when the EXACT SAME model slice appears more than
     once for the same turn (which the ledger's own idempotency constraint
     should already prevent, but exported/replayed data could still
     contain) is it ambiguous, excluded, and counted.
8. **Zero runtime authority, structurally, not merely by convention.**
   `live-routing-comparison.ts` and `scripts/ai-learning/live-eval-report.ts`
   are never imported by `agent/worker/index.ts`,
   `agent/worker/flow-write-policy.ts`, or any other production `/chat`
   code path -- there is no code path from a comparison result back into
   the Chat response, routing, FAST/LEGACY lane selection, tool choice/
   arguments, approval, policy, permissions, execution intent/lifecycle,
   retries/fallback, Memory, GitHub, or files. This is the SAME posture
   ADR-0020/ADR-0021 already established for the ledger and Shadow
   themselves, extended to the new comparison layer.
9. **No comparison persistence in ALF-1B.** `compareLiveRoutingEvents`
   computes its report ON DEMAND from an in-memory array of
   already-fetched/already-exported `LiveLearningEventRecord`s -- it
   writes nothing back to `ai_learning_events` or any other table. No
   `live_routing_comparisons` table (or any comparison-shaped table) is
   created by this slice. If a genuine need for persistence is discovered
   later (e.g. to track trend over time without re-fetching/re-computing
   from scratch), that is a SEPARATE, explicitly reviewed architectural
   decision with its own migration proposal -- not something this ADR
   authorizes implicitly. No such need was found necessary during this
   slice's own implementation.
10. **No Shadow enablement in this slice.** This ADR describes a
    comparison layer that is CORRECT to run once Shadow produces real
    `shadow_prediction` rows -- it does not itself flip `AI_SHADOW_ENABLED`,
    configure a shadow model, or change any Cloudflare production variable.
    Every test in this slice exercises the comparison logic against
    HAND-CONSTRUCTED `LiveLearningEventRecord` fixtures, never against a
    live-enabled Shadow path.
11. **Shadow Chat routing vocabulary excludes ui-only registry entries
    (resolves a prior non-blocking concern).** `shadow-vocabulary.ts`
    previously derived its allowlist from the FULL
    `shared/writeIntentRegistry.ts`, including entries with
    `exposure: 'ui-only'` (today, exactly one: `import_bank_statement` /
    `finance.import_bank_statement`, reachable only via an
    already-server-validated file-upload flow, never from a chat message
    -- see that registry entry's own header comment). A live chat message
    can never legitimately route to a ui-only intent, so a Shadow model
    predicting one is not "a plausible answer the model happened to get
    wrong" -- it is wrong by construction, the same way an intentType the
    registry has never heard of is. DECISION: `shadow-vocabulary.ts` now
    scopes its allowlist to `exposure === 'chat'` entries only; the same
    scoping is used by `shadow-semantic-consistency.ts`'s write-semantics
    table, so both gates agree with each other for the same reason. This
    is a DELIBERATE, documented, tested change (see
    `shadow-vocabulary.test.ts`'s explicit "rejects every ui-only..."
    test and `shadow-semantic-consistency.test.ts`'s "rejects a ui-only
    registry intent..." test) -- not a silent behavior change.

## What This ADR Deliberately Does NOT Do

- **Does not enable Shadow.** `AI_SHADOW_ENABLED` stays `false` in
  production; no shadow model is configured by this slice.
- **Does not persist a comparison anywhere.** See Decision item 9.
- **Does not feed any comparison result back into production behavior.**
  See Decision item 8.
- **Does not solve `language`/`requiresApproval` evaluability.** Masking
  them is the whole point -- a future, separately reviewed capability
  (a deterministic/user-confirmed message-language classifier; a way to
  fairly score `requiresApproval` against the evaluated user's own
  resolved policy) could eventually un-mask one or both, but that is not
  this ADR's job.
- **Does not change `shared/aiLearning.ts`'s generic contract.** The
  semantic-consistency gate (Decision item 6) is additive, layered on top,
  exactly like the vocabulary allowlist before it.
- **Does not fetch or export ledger data itself.** `compareLiveRoutingEvents`
  is a pure function over an already-in-memory array;
  `scripts/ai-learning/live-eval-report.ts` reads a LOCAL JSONL file the
  caller already produced by some other, out-of-scope means (e.g. a
  manual read-only Supabase query) -- this script makes no network call
  and needs no credentials.

## Alternatives Considered

**Pair by "the most recent shadow_prediction for a user, regardless of
correlation_id."** Rejected outright -- this is exactly the "latest event"
heuristic the task's own pairing rules forbid, and it would silently
compare a shadow prediction for one turn against a production label for a
completely different turn whenever an exact-key pair happened to be
missing.

**Treat a semantically inconsistent Shadow prediction as a scored
mismatch (rather than excluding it as invalid).** Rejected: scoring it as
"wrong" would still imply it was a legitimate candidate answer to a real
question, which corrupts the exactRoutingMatch/field-accuracy metrics with
data that was never comparable in the first place (the model didn't
disagree with production, it produced structurally impossible output --
a different failure mode entirely, and a signal worth its OWN separate
counter, which `invalidShadowPredictionCount` is).

**Score `requiresApproval` but bucket it by whether the evaluated user's
policy is independently known.** Considered as a way to partially unmask
this field. Rejected for ALF-1B specifically: fetching or joining
per-user `flow_write_permissions` state at comparison time is a real
architectural addition (a second data source, a point-in-time consistency
question -- policy can change after the turn was captured) that deserves
its own explicit review, not a quiet addition to a slice whose brief was
"comparison semantics," not "policy-aware comparison." Full masking is the
conservative, honest default until that capability is deliberately built.

**Persist each computed comparison as a new ledger event kind (e.g.
`routing_comparison`) so trend queries don't need to recompute from raw
events every time.** Rejected for THIS slice per the task's own explicit
instruction (no comparison persistence in ALF-1B) -- recomputing from
`production_label`/`shadow_prediction` events is cheap, avoids a new
migration entirely, and keeps the comparison layer purely a read-side
concern. A future slice with a real operational need for persisted trend
data can make that case explicitly, including how it interacts with
ADR-0020's append-only design.

## Tests

`agent/worker/ai-learning/live-routing-comparison.test.ts` covers, at
minimum: a perfect exact match; a single-field mismatch; intentType/toolId
omitted-on-both (match) vs. present-on-one-side (mismatch), independently;
language/requiresApproval mismatches never affecting the score; an
impossible domain/intentType/toolId combination on either side excluded as
invalid (never scored); pairing correctness (a `source_message_id`,
`correlation_id`, or `schema_version` difference never pairs); production
never being replaced by a shadow value; ambiguous production
(duplicate rows for one key) failing closed; duplicate shadow predictions
for the same vs. different model slices handled deterministically; zero
raw-message leakage into the report; and per-field/masked-field metric
denominator correctness (including the zero-eligible-pairs case never
dividing by zero).

`agent/worker/ai-learning/shadow-semantic-consistency.test.ts` and the
updated `shadow-vocabulary.test.ts`/`shadow-routing-prompt.test.ts` cover
the semantic-consistency gate and the `exposure === 'chat'` vocabulary
scoping decision independently, including at the live Worker parsing
boundary (not just the comparison layer).

`scripts/ai-learning/live-eval-report.test.ts` covers the CLI's own row
normalization and report-formatting glue logic (run via
`npx vite-node scripts/ai-learning/live-eval-report.test.ts` -- `scripts/**`
is excluded from the vitest project, matching
`scripts/ai-learning/score-eval.mjs`'s own established split).

## Consequences

- Two new pure, independently-testable modules in
  `agent/worker/ai-learning/`: `shadow-semantic-consistency.ts` and
  `live-routing-comparison.ts` -- neither imported by any production
  `/chat` code path.
- `shadow-routing-prompt.ts`'s `parseShadowRoutingOutput` gains one more
  rejection gate (semantic consistency), additive to its existing generic
  shape + vocabulary allowlist checks -- no behavior change for any
  already-consistent, already-valid Shadow output.
- `shadow-vocabulary.ts`'s allowlist is now narrower than before (excludes
  ui-only registry entries) -- since `AI_SHADOW_ENABLED=false` in
  production today and no shadow model is configured, this has zero
  observable production effect at merge time; it only changes what a
  FUTURE, explicitly enabled Shadow model would be permitted to predict.
- A new read-only CLI, `scripts/ai-learning/live-eval-report.ts`
  (`npm run ai-learning:live-eval-report -- <events.jsonl>`), for manually
  reviewing live comparison results once Shadow is eventually enabled and
  real `shadow_prediction` rows exist -- unusable/uninteresting against
  today's production data (no shadow rows exist yet), by design.
- No new migration. No new table. No production configuration change.
