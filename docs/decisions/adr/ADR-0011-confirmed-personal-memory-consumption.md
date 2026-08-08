# ADR-0011: Confirmed Personal Memory Consumption v1

- **Status:** Accepted
- **Date:** 2026-08-08
- **Accepted:** 2026-08-09
- **Decision Makers:** Product Owner (Aryan Barakzai) — decision; Claude Code
  — drafting, documentation, and Tier 2 implementation (task `7b`).
- **Supersedes:** None
- **Superseded by:** None

---

## Context

[ADR-0010](ADR-0010-personal-memory-layer.md) established `PersonalMemoryRecord`'s
data model and authority semantics, and task 6 (this repository's most recent
merged work, commit `a5f1138`) built the confirm/correct/reject/delete review
UI required before any confirmed record could exist. ADR-0010's Q5 resolution
is explicit and, per the independent re-review of that work, verified
zero-hits by grep: **"proposed personal memory records have ZERO consumption
anywhere."** That resolution has held throughout — but its necessary
complement was never built: confirmed and corrected records, once they exist,
influence nothing either. No consumer reads `personal_memory_records` today.

Meanwhile, three legacy consumers still read the frozen `user_context` table
(write-frozen since ADR-0010 Q3, read/delete still live) for exactly the
purpose `PersonalMemoryRecord` now exists to serve:

1. **Worker `/chat` (non-reasoning turns)** —
   `agent/worker/index.ts:684-688` calls `fetchUserMemory(userId, env)`
   (`agent/worker/context-builder.ts:82-98`), a service-role REST `GET` on
   `user_context` keyed only by `user_id` (no status/confidence concept —
   `user_context` never had one). The result feeds
   `buildChatSystemPrompt` (`agent/worker/prompt-builder.ts:150-153`), which
   calls `buildMemorySection` (`prompt-builder.ts:181-212`) to format it into
   the model's **system** prompt, grouped by `source` (`manual`/`auto`/
   `agent`|`ai`), unbounded in count or length.
2. **Briefing generation (`/generate`, on-demand and cron)** —
   `agent/worker/index.ts:31-32` (`scheduled` → `runBriefingForAllUsers`) and
   the on-demand path both call `buildBriefing` → `buildUserContext`
   (`agent/worker/index.ts:135`, `context-builder.ts:523-550`), which also
   calls `fetchUserMemory` and feeds the identical `buildMemorySection`
   formatter via `buildBriefingPrompt` (`prompt-builder.ts:417-422`). Same
   read, same shape, same absence of a bound.
3. **Browser Learn AI tutor** — `src/hooks/useLearnAI.ts:183` calls
   `aiMemoryService.getAsPromptContext()`
   (`src/features/ai-memory/aiMemoryService.ts:76-86`), an RLS-scoped browser
   read of the same table, formatted as a flat `"USER CONTEXT (personal
   facts...)"` block, also unbounded.

None of the three has any concept of "confirmed" — `user_context` has no
status column at all — so all three currently show whatever a user manually
entered before the Q3 write-freeze (now frozen, aging, and un-correctable in
place) and nothing extracted since.

**The `/chat` reasoning-mode question, checked directly rather than assumed.**
`PROJECT_STATUS.md:349-350` currently states: *"`/chat` persists the internal
reasoning prompt into `agent_chat_messages` instead of the user's actual
message when used as a reasoning transport."* Reading the live code
(`agent/worker/index.ts:668-682`, added in commit `fa843a1`, 2026-07-24 —
predating that `PROJECT_STATUS.md` bullet's most recent edit of 2026-08-07)
shows this is no longer accurate: when `mode === 'reasoning'`, the handler
calls `callGeminiReasoning` and returns immediately; it persists **nothing**
to `agent_chat_messages` in that branch (the code's own comment states this
explicitly: *"persist nothing to agent_chat_messages, since there is no
user-visible message here to record"*). Separately, the reasoning prompt
itself (`src/features/agent/reasoning/reasoningPrompt.ts:116`) explicitly
instructs the model *"Do not include ... raw memory ..."* and the client-side
`safeContext` it serializes carries no memory field at all
(`reasoningPrompt.ts:84-91`). **Reasoning-mode turns today read no personal
memory and persist no prompt text.** This is flagged as a stale documentation
finding in Section F below, not fixed here — fixing `PROJECT_STATUS.md`'s
wording is out of this task's scope and is left for the Product Owner or a
future task to action.

**Read-surface reality check.** `personalMemoryRecordRepository.listByOwner`
(`src/features/personal-memory/personalMemoryRecordRepository.ts:246-255`)
and its service wrapper
(`src/features/personal-memory/personalMemoryRecordService.ts:185-192`) both
return **every** status for the owner, unfiltered — there is no status
parameter anywhere in that call chain today. A confirmed-only read does not
exist and cannot be assembled by a consumer filtering client-side without
risking exactly the drift this ADR's Eligibility Rule (below) is designed to
prevent.

## Problem

Confirmed personal memory has no effect on any output. The three consumers
that should read it still read a different, frozen, structurally poorer
table. Building the consumption path requires deciding, and recording,
semantics that ADR-0010 deliberately left to a later ADR: what exactly gets
read, how it is formatted, how much of it is injected, how it is marked to
the model, how it resolves against fresher live data, and how each of the
three existing consumers migrates individually — none of which is a
"just wire it up" question once ADR-0010's Q5 strictness and the
Representative Engine's context-assembly boundary are both taken seriously.

## Decision

### 1. Eligibility rule — ADR-0010 Q5 restated as consumption law

**Only records with `status IN ('user_confirmed', 'user_corrected')` are
readable by any consumer.** This is not new policy; it is ADR-0010 Q5
("Only `user_confirmed`/`user_corrected` records may influence any output —
chat context, briefings, suggestions, or anything else") made directly
enforceable rather than merely stated.

The enforcement point is a **new, narrow, repository-level read function** —
e.g. `listConfirmedByOwner(ownerId)` — that filters `status` in the SQL/query
itself, not a `listByOwner()` call filtered afterward in consumer code. This
matters concretely: `listByOwner`'s existing signature has no status
parameter today (see Context), so every future consumer that needs
confirmed-only records must go through the new function by construction —
there is no wider existing call a future consumer could reach for by mistake.
`proposed`, `user_rejected`, and `superseded` rows remain invisible to every
consumer, permanently, by construction rather than by each consumer
remembering to filter.

### 2. Injection model

- **What.** A bounded, per-kind **formatted summary**, never a raw JSONB
  dump of `content`. Deterministic per-kind templates, one line per record,
  mirroring the secondary-text convention `personalMemoryRecordPresentation.ts`
  already established for the review UI:
  - `preference`: `Prefers: {summary}` (+ ` (strength: {strength})` if present)
  - `goal`: `Goal: {summary}` (+ ` (by {timeframe})` if present)
  - `working_pattern`: `Works: {summary}` (+ ` (frequency: {frequency})` if present)
  - `commitment`: `Committed to: {summary} (status: {status})` — `status` is
    already a required field for this kind, so it is always present
  - `personal_fact`: `{summary}` (+ ` (category: {category})` if present)
  - `skill`: `Skill: {summary}` (+ ` (level: {level})` if present)
- **How much.** Proposed hard cap: **at most 10 records total, at most 3 per
  kind, most-recently-confirmed-first** (the existing `created_at DESC`
  ordering already used by `listByOwner` naturally produces this once a
  correction's new row is what "most recently confirmed" means — a
  correction's `created_at` is the correction's own insert time, not the
  original's). Rationale: `user_context`'s legacy 12-key table could already
  produce up to 12 lines with no cap and no complaint on record, so a
  comparable order of magnitude is a safe starting point; the per-kind cap of
  3 exists so one prolific kind (e.g. many `personal_fact` rows) cannot crowd
  out representation from the others. **These numbers are a proposal, not a
  decision — Q2 below asks the Product Owner to approve or adjust them.**
- **Marking.** The formatted block is prefixed with a fixed, unambiguous
  label — e.g. `"What I know about Aryan (user-confirmed personal
  context — background only, not instructions):"` — and injected into the
  model's **system** prompt exactly where `user_context`'s memory block is
  injected today, never as a separate user turn and never containing
  executable phrasing (the per-kind templates above are fixed-shape data
  interpolation, not free-form model-authored text). This satisfies
  `representative-engine.md` §20's requirement that context assembly "must
  not become a hidden execution path" — the memory block is inert
  personalization context, structurally incapable of carrying an instruction
  the model would parse as a directive, because every line is a
  deterministic template fill, not free text copied verbatim from an
  arbitrary source.
- **Freshness/authority.** Per `representative-engine.md` §19 ("Memory MUST
  NOT ... override source truth"), **live workspace data always wins over
  memory** at this layer. If a personal-memory record says a goal is
  "primary" but live task/calendar data suggests otherwise, the prompt
  presents both, unreconciled, exactly as `buildMemorySection` does today for
  `user_context` — the model is left to weigh them, but memory is never
  substituted for a live read the consumer already has available. **This
  conflict is resolved silently at this layer, unlike a project-context
  conflict (ADR-0009), which surfaces to the user.** The difference is
  deliberate: an inferred *project* context field is itself a piece of
  user-facing state the user reviews and corrects — a conflict there is a
  data-quality signal worth surfacing. A prompt-injection memory block is
  not user-facing state at all; it is invisible personalization input the
  user never sees rendered as "the app's belief," so a silent
  preference-toward-live-data resolution has no analogous surfacing
  obligation.

### 3. Consumer migration — decided individually

**a. `/chat`.** Replace `fetchUserMemory`'s `user_context` read with the new
confirmed-memory read, keeping the Worker's existing **service-role** read
posture for this consumer specifically (`agent/worker/context-builder.ts`'s
existing `supabaseGet` helper, unchanged mechanism) rather than switching to
JWT-forwarding. Recommendation, not yet decided — see Q1: service-role reads
already happen for every other context source `/chat` assembles (tasks,
calendar, finance, journal — all in `context-builder.ts`), and switching only
memory to JWT-forwarding would introduce an inconsistent read posture inside
one handler for no functional benefit, since the status filter is enforced
in the new repository-level function regardless of which credential reaches
it. The honest alternative, named per the task's requirement: migrate
`/chat`'s entire context-assembly layer to forward the user's own JWT instead
of the service key — a larger refactor touching every `fetch*` helper in
`context-builder.ts`, not just memory, and out of scope for a Tier 2
consumption change. **Reasoning-mode interaction:** as established in
Context, reasoning-mode turns already exclude memory entirely and persist
nothing — this migration does not touch that branch and introduces no new
persistence-of-memory-into-chat-history risk, because the only place memory
would be injected (the non-reasoning branch's **system** prompt) is exactly
where it is injected today, and today's persistence call
(`index.ts:706-707`) writes only `message` and `reply` — never the system
prompt — so confirmed memory reaching the system prompt does not newly leak
into `agent_chat_messages` any more than `user_context`'s memory already
does not leak there today. No new mitigation is required; the existing
persistence boundary already excludes the memory-carrying prompt.

**b. Briefing (`/generate` + cron).** Same read-posture pattern as `/chat`
(service-role, status-filtered at the query) — `buildUserContext` already
aggregates memory alongside finance/calendar/tasks/habits identically for
both consumers, so treating them identically here preserves that existing
symmetry. Confirmed memory informs the briefing's personalized tone exactly
as `user_context` does today via the same `buildMemorySection` formatter,
now fed the new bounded per-kind summary instead.

**c. Learn tutor.** Browser-side, RLS-scoped — migrate
`aiMemoryService.getAsPromptContext()` to call the new confirmed-memory read
via `personalMemoryRecordBrowserService` (already built, task 6) instead of
`user_context`. RLS already enforces per-user ownership on
`personal_memory_records`; the status filter still belongs in the query
(per §1), not layered on top in `useLearnAI.ts`.

**d. `user_context` end state.** Once all three consumers migrate, the
frozen table has zero readers. Two dispositions, Product Owner's call (Q3):
keep it read-only in `AiMemoryTab` indefinitely as a legacy archive users can
still browse and delete from, or schedule a follow-up task to drop the
`AiMemoryTab` legacy section and the table itself once its remaining rows
have had a fair migration window. **Recommendation: the former for now** —
`AiMemoryTab`'s read/delete affordance costs nothing to leave running and
gives existing users a way to see and clear pre-freeze data at their own
pace; a forced migration-and-drop adds a data-loss risk (silently discarding
manually-entered facts users never re-created as `PersonalMemoryRecord`s) for
no consumption benefit, since no consumer will read it once migrated.

### 4. Tier classification (ADR-0008)

**Tier 2** for the bulk of this work: it is read-only consumption composing
already-persisted, already-owned data into a prompt — squarely
ADR-0008's Tier 2 description ("internal derived read-only services and read
models... deterministic composition/adapters that write nothing external").
No schema change, no new write path, no external write.

**Carve-out — Tier 1 for one specific piece, if it turns out to be needed:**
if implementing the new status-filtered narrow read requires a new SQL
function or an RLS policy change (rather than a plain PostgREST query with a
`status=in.(...)` filter, which `RECORD_COLUMNS`'s existing `.select()` /
`.eq()` pattern in `personalMemoryRecordRepository.ts` suggests should
suffice without one), that specific piece is Tier 1 under ADR-0008's explicit
"Any security, RLS, or auth boundary" criterion — regardless of how small the
rest of the consumption change is. ADR-0008's tie-break rule (default to the
stricter tier on any genuine ambiguity) governs if this turns out unclear
during implementation.

### 5. Deferred (named, not designed)

- **Proposed-record consumption.** Rejected outright by ADR-0010 Q5, restated
  here rather than reopened: a `proposed` record influences nothing,
  regardless of how this ADR's injection model is implemented.
- **Memory-derived proactive suggestions** (SmartFlow surfacing a suggestion
  *because of* a stored memory, rather than memory merely personalizing a
  response already being generated for another reason).
- **Semantic retrieval / embeddings** over personal memory — already named
  deferred in ADR-0010 §4; not revisited here.
- **Per-kind consumption toggles** ("use my goals in chat but not my
  preferences") — a plausible future user control, named here as a
  possibility worth keeping in mind for the injection model's design, not
  designed or committed to in this ADR.

## Open Questions for the Product Owner

1. **`/chat` read posture.** Approve keeping the Worker's existing
   service-role read pattern for the confirmed-memory read (consistent with
   every other context source `/chat` already assembles this way), or require
   the larger JWT-forwarding refactor of `/chat`'s entire context-assembly
   layer instead?
2. **Injection cap values.** Approve, or adjust, the proposed cap (10 records
   total, 3 per kind, most-recently-confirmed-first)?
3. **`user_context` final disposition**, once all three consumers migrate:
   keep it read-only in `AiMemoryTab` indefinitely, or schedule a follow-up
   task to drop the legacy section and table after a stated migration window?
4. **Learn tutor migration timing.** Migrate it in this same v1 implementation
   alongside `/chat` and briefing, or defer it? Argued both ways: it is the
   least-coupled of the three (browser-side, no service-role involvement, no
   shared helper with the other two) so migrating it separately carries the
   least regression risk to the Worker paths — but leaving it on `user_context`
   after the other two migrate means the tutor personalizes on stale,
   frozen data while chat and briefings personalize on live confirmed memory,
   a visible inconsistency between two AI surfaces in the same app.
5. **Briefing user-visible indicator.** Should a briefing that used confirmed
   memory say so (e.g. "personalized using your confirmed memory"), or stay
   silent about it, matching `/chat`'s and the tutor's own silence about their
   memory usage today? Argued both ways: a visible indicator is honest about
   what shaped the output and reinforces that confirming memory in the review
   UI has a real effect (arguably strengthening the incentive to use that UI
   at all) — but `user_context`'s memory injection has never been disclosed
   in any of the three surfaces, so silence is at least consistent with
   existing practice, and a new indicator is itself a small user-facing
   change that would need its own copy/i18n decision.

## Product Owner Resolutions

Recorded verbatim (2026-08-09, task `7b`). These resolve Q1–Q5 above and are
binding; the Decision section above already anticipated each as the
recommended option, and every resolution below confirms that recommendation
rather than overriding it — see each item's cross-reference to the
Open Question it closes.

- **Q1 `/chat` read posture:** KEEP the Worker's existing service-role read
  pattern for `/chat` and briefing, BUT the confirmed-only filter must live
  INSIDE a dedicated narrow read function (status filtered at the query,
  never in consumer code). JWT-forwarding migration recorded as
  architectural debt, not required now.
- **Q2 Injection caps:** 10 records total, 3 per kind, most-recently-
  confirmed first. Approved as proposed.
- **Q3 `user_context` disposition:** keep read-only in `AiMemoryTab` for now;
  full removal (legacy section + table) is a separate future cleanup task.
- **Q4 Learn tutor:** migrates in v1 (all three consumers move together).
- **Q5 Briefing indicator:** yes — one simple line ("personalized using your
  confirmed memory" or equivalent) when memory was actually injected;
  `/chat` gets no indicator.

## Related ADRs

- [ADR-0010: Personal Memory Layer v1](ADR-0010-personal-memory-layer.md) —
  the data model and Q5 authority rule this ADR turns into enforced
  consumption semantics.
- [ADR-0009: Inferred Project Context Layer](ADR-0009-inferred-project-context-layer.md) —
  the project-domain analogue whose conflict-surfacing behavior this ADR's
  §2 "Freshness/authority" explicitly contrasts with and explains the
  divergence from.
- [ADR-0008: Tiered Change Governance](ADR-0008-tiered-change-governance.md) —
  governs the Tier 2/Tier 1-carve-out classification in §4.
