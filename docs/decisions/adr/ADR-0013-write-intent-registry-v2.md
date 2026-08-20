# ADR-0013: Write Intent Registry v2 — Closing the Post-Task-23 Duplication Gaps

- **Status:** Accepted (2026-08-21). Slice 5 (the `reasoningPrompt.ts`
  generation change, task 36f) landed and its mandatory empirical replay gate
  (see Consequences) was run and reviewed: 6/6 test inputs (Farsi finance,
  Farsi calendar, Farsi task, the task-vs-calendar disambiguation trap, a
  GitHub read request, and a genuinely unsupported delete request) resolved
  to the identical `type` under the old, hand-written prompt and the new,
  registry-generated one, via real Gemini API calls. Two minor, non-blocking
  differences were observed and are recorded here rather than silently
  dropped: the optional `requestedDomain` field was present in one prompt's
  response and absent in the other's for two of the six cases (stochastic
  variance from the reworded prompt text, not a `type` mismatch), and one
  response's raw JSON was pretty-printed rather than single-line. Neither
  affects any consumer, since both are valid JSON parsed identically and
  `requestedDomain` is optional at every downstream boundary.
- **Date:** 2026-08-18 (Slices 0-1 drafted); Slice 5 accepted 2026-08-21.
- **Decision Makers:** Product Owner (Aryan Barakzai) - decision; Claude Code - drafting.
- **Supersedes:** None
- **Superseded by:** None
- **Amendment (task 36f Part A):** this ADR's Decision item 3 justified
  leaving `ChatPage.tsx`'s exhaustive switches hand-written (item 2) on the
  grounds that "TypeScript's exhaustiveness checking already catches a
  missing case there." Task 36e had already shown this repo's tsconfig
  (`strict: false`, no `noImplicitReturns`) does not enforce switch
  exhaustiveness in general. Task 36f Part A checked the two specific
  `ChatPage.tsx` switches this ADR's justification refers to, empirically
  (removed a case, ran `tsc`, restored):
  - `isSupportedActionableProposalType` **does** catch a missing case — it
    ends its switch with an explicit `const exhaustiveCheck: never = type`
    assignment, which is a structural type error independent of `strict` or
    `noImplicitReturns`. The justification holds for this switch.
  - `intentTitleKey` does **not** — it ends with a plain `default: return
    'agent_intent_title_unsupported'`, which silently absorbs a missing case
    with zero compile error, the same shape of gap task 30 exploited in
    `writeRuntime.ts` before Slice 4. The "typecheck already catches this"
    justification does **not** hold for `intentTitleKey`.
  This is a real, live gap, not merely a hypothetical one, and it is
  recorded here as a **follow-up rather than silently left standing**:
  either add an explicit `never`-check to `intentTitleKey` (mirroring
  `isSupportedActionableProposalType`, cheap and localized), or accept the
  gap explicitly with a runtime guard test in the style of task 36e's
  registry-parity loop. Out of scope for task 36f itself (ChatPage.tsx's
  switches are explicitly excluded from this ADR's derived set per Decision
  item 3 and "What This ADR Does NOT Cover") — tracked here so a future
  registry entry added without a matching `intentTitleKey` case does not
  repeat task 30's failure mode silently.

---

## Context

Task 23 introduced `shared/writeIntentRegistry.ts` as the single source of
truth for SmartFlow's AI-agent write intents, replacing roughly ten
independently hand-maintained copies of "what write domains are supported."
Two production incidents (task 22-fix, task 22-fix2) motivated that refactor.

Since task 23, five further hand-maintained copies of the same underlying
information have been found, independent of the registry:

1. `reasoningTypes.ts` — `AgentIntentDomain` and a `toolId` literal union
   re-type the registry's `WriteIntentDomain`/`WriteIntentToolId` inline
   (caught by typecheck at task 28, not by any registry-completeness test).
2. `ChatPage.tsx` — two exhaustive switches and a domain ternary (task 28;
   kept hand-written by explicit decision, see Decision below).
3. `agent/worker/index.test.ts` — a hardcoded schema-enum copy used as a test
   expectation (task 28; the identical pattern already caused a gap at task 22).
4. `reasoningPrompt.ts` — a hand-written intent list, an intent-to-tool
   mapping, and an "unsupported requests" exclusion line, all sent verbatim to
   the reasoning model. Missed at task 29: the exclusion line still claimed
   `"finance mutations"` were unsupported after finance shipped, and this
   **broke production** — the model told users finance requests were
   unsupported.
5. `SUPPORTED_DOMAIN_VALUES` in `reasoning-endpoint.ts` — missing `'finance'`,
   currently inert (feeds only an optional, unused-for-finance schema field).
6. `writeRuntime.ts` — `expectedCapabilityForToolId`/`expectedStepShapeForToolId`
   switches. Their registry-covered branches already return registry-sourced
   values, but the case labels themselves are still hand-added per domain.
   This class of gap **broke production** at task 30.

That is three production-affecting or production-adjacent incidents (task
22-fix/22-fix2 pre-registry, task 29, task 30) in roughly one week of
calendar time on this feature area.

## Decision

Adopt a conservative, scoped v2 (Option A):

1. **Derive, don't just guard**, items 1, 4, 5, and 6 from
   `shared/writeIntentRegistry.ts`:
   - Item 1: compose `AgentIntentDomain`/the validation-result `toolId` union
     from the registry's already-exported `WriteIntentDomain`/`WriteIntentToolId`,
     the same way `AgentIntentType` already composes `WriteIntentType`.
   - Item 5: derive `SUPPORTED_DOMAIN_VALUES`'s write-domain members from
     `writeIntentRegistry.map(e => e.domain)`.
   - Item 6: collapse the two switches' five per-toolId cases into one
     generic `findWriteIntentDescriptorByToolId(toolId)` lookup, retaining
     explicit cases only for the four non-registry tool ids.
   - Item 4: add one new descriptor field, `promptInstruction?: string`,
     carrying each intent's domain-specific target-field guidance. Use it,
     together with the already-existing `intentType`/`toolId` fields, to
     generate the prompt's "Supported intents" list and "Allowed mappings"
     list. Rewrite the "Unsupported requests" line to reference the generated
     supported list rather than maintain a second, independent exclusion
     enumeration — this directly removes the two-lists-can-disagree shape
     that caused the task 29 production break. Cross-domain disambiguation
     prose (e.g. the task-vs-calendar time-of-day rule) stays hand-written;
     it is not per-intent data. The field is optional, not required:
     `create_task`/`update_task` have no existing prose in `reasoningPrompt.ts`
     to move verbatim (the model currently infers task fields from the
     schema alone), and inventing new model-facing text for them,
     unreviewed and untested via this ADR's own empirical-replay gate, is
     explicitly out of scope for the slices that add this field.
2. **Add a guard test, not a derivation**, for item 3: extend
   `agent/worker/index.test.ts` with an `it.each(writeIntentRegistry...)` loop
   (mirroring task 29-fix's own pattern) asserting every registry intent type
   appears in the schema's enum, alongside — not replacing — the existing
   hand-written literal array, since replacing it would make the test
   tautological against already-registry-derived production code.
3. **Item 2 (ChatPage.tsx's exhaustive switches) stays hand-written**, by
   explicit product decision: TypeScript's exhaustiveness checking already
   catches a missing case there, and those switches contain genuine
   per-domain UI/business logic (not a uniform registry lookup repeated per
   case, unlike item 6's switches before this ADR).
4. Add loop-based (`it.each(writeIntentRegistry.map(...))`) guard tests for
   every derived point (1, 4, 5, 6), following the task 29-fix pattern, so a
   future domain added to the registry without a corresponding downstream
   update fails a test on day one rather than shipping silently stale.

## Alternatives Considered

**Fully generate `reasoningPrompt.ts`'s instructional paragraphs per
descriptor** (a required `promptInstruction` field assembled wholesale for
every intent, replacing all hand-written paragraphs, not just the two
mechanical list fragments). Rejected for this ADR's scope: the current
hand-written paragraphs contain cross-domain references (calendar's rule
explicitly reasons about task's own vocabulary; finance's rule references
ADR-0012's write-permission defaults) that a per-descriptor snippet, authored
in isolation at registration time, cannot structurally contain. This
repository's own history shows such cross-domain confusion was previously
fixed only by hand-tuned prose, not a schema. Fully generating prompt text
risks silently regressing model behavior in a way no unit test in this
codebase would catch — a real product risk, not merely an engineering
preference, and out of proportion to the narrow drift risk (two purely
mechanical list fragments) that actually caused the task 29 incident.

**Leave item 6 hand-written, like item 2.** Considered, since both are
exhaustive switches TypeScript already partially guards. Rejected because the
two are not equivalent: item 6's registry-covered switch branches are already
uniform one-line lookups with no per-case logic (added by task 23, confirmed
on inspection), the textbook signal that a switch should be a lookup; item
2's branches contain genuine per-domain UI logic that cannot be collapsed
without either losing type safety or becoming a new hand-maintained data
field, defeating the purpose.

**Do nothing (accept the current cost as final).** Rejected: items 4 and 6
have each already caused a production incident from the same underlying
"hand-copied value drifted" shape task 23 was originally meant to eliminate;
leaving them unfixed accepts a known-recurring bug class. Three
production-affecting incidents in one week is the justification on its own —
see Consequences for why this is NOT sold as a duplication-count win.

## Consequences

- **Touch-point count is not reduced — do not claim otherwise.**
  `docs/architecture/adding-a-write-domain.md` (task 23's own documentation)
  already states task 23's acceptance bar for a new domain as roughly four
  touch points: one registry entry, one write handler, one undo-kind
  migration line, and translations. This v2 adds a fifth expectation — a
  `promptInstruction` value on the registry entry, where applicable — so the
  touch-point count does not improve; if anything it grows by one. **The
  value this ADR delivers is a change in FAILURE MODE, not a reduction in
  duplication**: today, a missed touch point is discovered by a user hitting
  broken behavior in production (task 29, task 30, and pre-registry task
  22-fix/22-fix2 all shipped this way); after this ADR, the loop-based guard
  tests in Decision item 4 make the same class of miss fail a test on day
  one, before it ships. Three production incidents in roughly a week justify
  this change in failure mode on their own; it should not be presented to
  stakeholders as "duplication eliminated," because it is not.
- Slice 2 (deriving `SUPPORTED_DOMAIN_VALUES`) changes
  `buildReasoningResponseSchema()`'s actual output — `SUPPORTED_DOMAIN_VALUES`
  feeds the schema's `requestedDomain.enum` property directly
  (`reasoning-endpoint.ts`). This **will** fail
  `shared/reasoningResponseSchema.purity.test.ts` (task 28b's snapshot pin,
  which deliberately fails on any schema change by design). Slice 2's
  validation gate must include a **deliberate snapshot regeneration** (not an
  accidental one committed to silence a failing test) with the diff justified
  in that slice's own report, plus a full **5/5 `provider-contract-smoke`**
  run (`scripts/provider-contract-smoke.ts`, live Gemini calls) against the
  regenerated schema before any deploy — the same discipline
  `docs/reference/provider-contract-smoke.md` already requires for any
  `responseSchema` change, which this is.
- Slice 5's validation gate is not "manual/exploratory pass optional if time
  allows" — it is a **mandatory empirical replay**: the same method task 29's
  own fix was verified with, real Gemini calls comparing the old prompt
  against the new generated prompt on the set of previously-documented
  tricky/regression phrasings (e.g. the task-vs-calendar time-of-day cases,
  the finance-vs-unsupported case that broke production). Slice 5 does not
  land without this replay having been run and its results reviewed — none
  of the loop-based guard tests in Decision item 4 can substitute for it,
  since they check text presence, not model behavior.
- `WriteIntentDescriptor` gains one new optional field (`promptInstruction`).
- `promptInstruction` was made optional rather than required, per an explicit
  PO decision at Slice 0 (task 36b): `create_task`/`update_task` have no
  existing prose in `reasoningPrompt.ts` to move verbatim, and authoring new,
  unreviewed model-facing text to fill a required field was rejected rather
  than done silently. The compensating day-one guard is the registry-
  completeness test (`shared/writeIntentRegistry.test.ts`) that locks in
  exactly which entries carry the field (calendar create/update, finance
  create) and which don't (both task entries) — a future edit that silently
  adds or drops it on the wrong entry fails there.
- `writeRuntime.ts`'s two switches change shape (lookup-first, switch for the
  remainder); this needs care to preserve or replace the TypeScript
  exhaustiveness guarantee the current all-cases switch provides — flagged as
  an implementation-time risk, with a runtime loop guard test as the backstop
  either way.
- `reasoningPrompt.ts`'s "Unsupported requests" line changes wording (from an
  enumerated exclusion list to a reference against the generated supported
  list) — this is a deliberate, one-time prompt text change and is covered by
  Slice 5's mandatory empirical replay above, not treated as a mechanical
  refactor.
- Items explicitly and permanently out of this ADR's scope, per PO direction
  at task-36 kickoff: the duplicate `GITHUB_ALLOWED_ORIGINS` allow-list (a
  CORS concern, unrelated to intent registration) and the English-prefix
  language-detection mechanism (tracked separately).

## What This ADR Does NOT Cover

- The write handler, undo-kind migration, translation values, and Worker-side
  resolution triad a new domain still needs — unchanged by this ADR, per
  `docs/architecture/adding-a-write-domain.md`.
- Any change to write-precedence ordering or free-text intent-detection
  regexes — both remain deliberately hand-written, per task 23's own original
  scope boundary, which this ADR does not revisit.
- `ChatPage.tsx`'s exhaustive switches (item 2) — explicitly staying
  hand-written; not part of this ADR's derived set.
- Any change to `GITHUB_ALLOWED_ORIGINS` or the language-detection mechanism.
- The actual code implementation beyond Slices 0-1 (this ADR's own drafting
  task also implemented those two under separate task instructions) —
  Slices 2-5 land independently, each under its own validation gate as
  described in Consequences.

## Related ADRs

- [ADR-0004: Write Boundaries for SmartFlow GitHub Integration](ADR-0004-write-boundaries.md)
- [ADR-0012: Write Capability Layer v1](ADR-0012-write-capability-layer.md)
