# ADR-0010: Personal Memory Layer v1

- **Status:** Accepted
- **Date:** 2026-08-08
- **Accepted:** 2026-08-08
- **Decision Makers:** Product Owner (Aryan Barakzai) — decision; Claude Code
  — drafting and documentation only.
- **Supersedes:** None
- **Superseded by:** None

---

## Context

[PROJECT_STATUS.md](../../../PROJECT_STATUS.md) §5 records Personal Memory v1
as the next Product-Owner-approved item, following the completed Inferred
Project Context Layer v1 ([ADR-0009](ADR-0009-inferred-project-context-layer.md))
and its confirm/correct UI. [ADR-0006](ADR-0006-canonical-product-identity.md)
names SmartFlow's canonical identity as Aryan's Personal Digital
Representative, whose mission is to build a "user-governed, evidence-backed,
provenance-aware, correctable, and confidence-aware understanding" of Aryan
— not only of his Software Projects, but of his knowledge, goals,
priorities, preferences, working style, and personal context generally.
ADR-0006's own "Knowledge and Memory Governance" section states the bar any
future personal memory system must clear (provenance, correctability,
confidence-awareness, fail-closed behavior) while explicitly disclaiming
that "no such system is claimed as implemented."

This ADR is that future system's **data model and authority semantics** —
not its implementation, which is deliberately deferred to a later,
separately-approved Tier 1 task (named `5b` by the coordinator; not started
by this ADR), exactly as ADR-0009 deferred its own implementation to task
`3b`.

## Problem

### What exists today (Phase-0 inventory, cited from the actual schema and code)

SmartFlow already has a person-level memory table, `user_context`
(`supabase/migrations/20260605000004_user_context.sql`,
`20260616120000_user_context_allow_agent_source.sql`), and it already shows
the exact failure mode ADR-0009 was created to prevent for projects —
concretely, not hypothetically:

- **Schema.** `user_context(id, user_id, key, value, source, created_at,
  updated_at)`, `UNIQUE(user_id, key)`. `source` is a flat, unstructured
  four-value `CHECK` (`manual`, `auto`, `ai`, `agent`) with no meaning beyond
  a label — no confidence, no state machine, no provenance beyond that one
  word, no linkage to the evidence (which chat turn, which briefing) a
  `source='agent'` row was extracted from. One row per `(user_id, key)`: a
  new extraction **overwrites** the previous value in place — there is no
  history, no superseded row, no way to see what the model said before a
  later run silently replaced it.
- **Write path has no `SECURITY DEFINER` gate at all.** Unlike
  `project_evidence`/`inferred_project_context_fields`, `authenticated`
  holds a direct `GRANT ALL` on `user_context`, gated only by a bare RLS
  policy (`auth.uid() = user_id`). Both the browser
  (`src/features/ai-memory/aiMemoryService.ts`, direct `.upsert()`/`.delete()`
  calls) and the Worker (`agent/worker/index.ts`, using
  `SUPABASE_SERVICE_KEY`, not the user's own JWT) write to this table by two
  entirely different mechanisms with no shared validation.
- **LLM-extracted facts already write to durable state with no user review,
  today, automatically, on every turn.** `agent/worker/index.ts`'s
  `ENABLE_AUTO_MEMORY_WRITE` constant is hardcoded `true`. Every chat reply
  (`extractAndSaveMemoryFromChat`, fired via `ctx.waitUntil` so it never
  blocks the response) and every generated briefing
  (`extractAndSaveMemory`) triggers a Gemini call whose output is
  upserted **directly** into `user_context` with `source: 'agent'` —
  no `proposed` state, no confirm step, no way for Aryan to see a candidate
  before it becomes what the AI "knows" about him. This is the exact
  "LLM output... persisting as de-facto truth" pattern this ADR's context
  names, and it is not a hypothetical: it is `agent/worker/index.ts:135` and
  `:706` running today.
- **The extraction allowlist does not already exclude sensitive
  categories.** `agent/worker/prompt-builder.ts`'s `EXTRACTABLE_KEYS`
  includes `family_note` and `health_note` alongside `preferred_name`,
  `goal_primary`, `goal_secondary`, `work_status`, `learning_note`, and three
  free-form `custom_*` slots — the model is explicitly prompted to extract
  "Family situation or context" and "Health habits or constraints" from
  chat turns and briefings. There is **no existing sensitive-category
  exclusion to extend** — this ADR's proposal to exclude such categories in
  §3.a is a new, tightened stance relative to current behavior, not a
  continuation of an existing discipline. This correction matters: this
  ADR must not understate how much current behavior it changes.
- **A manual review surface exists, but does not mark model-authored
  content as anything other than user-authored content.**
  `src/features/ai-memory/AiMemoryTab.tsx` (via `useAiMemory.ts` /
  `aiMemoryService.ts`) is a real, shipped Settings UI: it lists a fixed
  slot per key from `MEMORY_KEYS`, shows a text input pre-filled with the
  current value, and a "Auto" or "Manual" badge depending on `source`.
  Concretely, however:
  - `MemoryRow`'s badge logic (`AiMemoryTab.tsx:172-177`) only renders a
    badge for `source === 'auto'` or `source === 'manual'`. A
    `source: 'agent'` row (the LLM-extraction path) matches **neither**
    branch and renders with **no badge at all** — visually identical to an
    empty slot the user could type into, indistinguishable from the user's
    own words. This is the single most concrete instance of "model
    inference silently becoming user truth" this repository currently
    contains.
  - `MEMORY_KEYS` (the UI's own key list, `aiMemoryService.ts:13-26`) and
    `EXTRACTABLE_KEYS` (the extraction allowlist,
    `prompt-builder.ts:263-274`) are two **independently maintained**
    lists, not one. `EXTRACTABLE_KEYS` contains `preferred_name`, which
    `MEMORY_KEYS` does not — so a `preferred_name` fact the model extracts
    is written to `user_context` but has **no row in the Settings UI at
    all**; it is invisible to the user who is supposedly able to review it,
    reachable only via `aiMemoryService.getAsPromptContext()`'s injected
    prompt text or a raw database read.
  - Erasure already exists at the row level:
    `aiMemoryService.delete(key)` is a real, working hard delete
    (`DELETE ... WHERE user_id = ? AND key = ?`), already wired to a
    "Clear" button per row. This ADR's §3.a does not need to invent
    deletion from nothing — it needs to decide whether the *new* aggregate
    keeps this same simple guarantee.
- **Consumers.** `user_context` feeds at least three independent paths, by
  two different read mechanisms: the Worker's own `/chat` route
  (`context-builder.ts`'s `fetchUserMemory`, service-role REST read,
  injected into the chat system prompt), briefing generation
  (`buildUserContext` → `buildExtractionPrompt`'s `ctx.memory`), and the
  **browser-side** Learn AI tutor (`src/hooks/useLearnAI.ts:183`, calling
  `aiMemoryService.getAsPromptContext()` directly against Supabase with the
  user's own RLS-scoped session — a second, independent read path with no
  relationship to the Worker's service-role read). Any proposal in this ADR
  must account for all of these, not just the primary agent chat.
- **Chat retention is bounded and pruning, unlike `ProjectEvidence`.**
  `agent_chat_messages` (`20260615120000_create_agent_chat_messages.sql`,
  `20260616000000_agent_chat_messages_cap.sql`) is capped and pruned to the
  most recent 100 rows **per user** (not per session) on every insert. This
  matters directly for §3.b below: a provenance reference to a chat-turn id
  is not permanently stable the way a reference to an immutable
  `project_evidence` row is — the referenced row can later be pruned out
  from under a memory record that cites it.
- **No prior reconciliation claim exists to correct.**
  `docs/status/reconciliation-2026-08.md` does not mention `user_context` —
  this capability was out of that reconciliation's Project-Domain scope
  (consistent with PROJECT_STATUS.md §2.2's disclaimer that non-Project-
  Domain capabilities are "carried forward, not independently re-verified").
  This ADR's Phase-0 inventory above is therefore the first citation-backed
  account of `user_context`'s actual behavior.

### Why this is the same problem ADR-0009 solved, one layer up

`representative-engine.md` §15-§16 (state categories; provenance/freshness)
and ADR-0006's Knowledge and Memory Governance section already state the
bar. `user_context` as it exists today fails it in exactly the way
`InferredProjectContextField` was built to prevent for projects: LLM output
writes directly to durable, consumed state, with no `proposed` status, no
confirm/correct/reject lifecycle, and (per the `AiMemoryTab` badge gap
above) no reliable visual distinction from user-authored truth once it
lands. This ADR proposes extending the proven ADR-0009 pattern from the
project dimension to the person dimension, with the person-level
differences made explicit in §3.

## Decision (proposed — see "Open Questions" for what remains reserved to the Product Owner)

### 1. New aggregate: `PersonalMemoryRecord` (working name)

Better names considered and rejected: `UserMemoryFact` (reads as a plain
key/value fact, understating the confirm/correct lifecycle);
`InferredPersonalContextField` (mechanically consistent with ADR-0009's
`InferredProjectContextField`, but "personal context field" undersells
that an `explicit_user_statement` record was never inferred at all — see
provenance below). `PersonalMemoryRecord` is proposed as the clearest name
for a record that may be either inferred or explicitly stated, always about
the person, never about a project.

- **User-scoped, no project dimension.** `ownerId` only — no `projectId`.
  This is the person-level analogue of `InferredProjectContextField`, not a
  per-project record; it must never be joined to, or gated by, any specific
  `ProjectRecord`.
- **`kind` — a small, closed v1 taxonomy**, deliberately narrower than
  `EXTRACTABLE_KEYS`'s current ten free-standing keys and its three
  unstructured `custom_*` slots:
  - `preference` — a stated like/dislike/working preference (e.g.
    "prefers async written updates over calls"). Justification: directly
    useful for personalization (`representative-engine.md` §18); already
    informally captured today, never structured.
  - `goal` — a personal-scope goal, distinct from a `ProjectObjective`
    (which is project-scoped and evidence-linked under `project-domain.md`
    §8). Justification: `goal_primary`/`goal_secondary` already exist in
    `EXTRACTABLE_KEYS`/`MEMORY_KEYS` today — this is a structuring of an
    existing, already-valued capability, not a new one.
  - `working_pattern` — a recurring behavioral pattern relevant to
    personalization (e.g. "reviews PRs in the morning," "prefers short
    daily check-ins"). Justification: names what `work_status` and the
    deterministic `mood_pattern`/`habit_pattern`/`finance_pattern` rows
    were already informally approximating, now typed and provenance-
    carrying instead of a bare string.
  - `commitment` — something Aryan has stated he intends to do or has
    committed to, distinct from a `ProjectMilestone` (project-scoped) or a
    task (execution-scoped, owned by `writeRuntime.ts`). Justification:
    "I'm going to start running three times a week" is personal-scope
    intent that is not a task and not a project artifact, but is exactly
    the kind of durable fact ADR-0006's mission names ("working style,"
    "decision patterns").
  - `personal_fact` — a stable, low-inference personal fact the user
    stated or the model can extract with high confidence and no sensitive
    content (e.g. preferred name, timezone, work status in the general
    sense already extracted today). Justification: `preferred_name` and
    `work_status` already exist in the current allowlist; this kind is
    their structured home.
  - `skill` — a stated skill, competency, or learning focus (e.g.
    "learning React Native," "IHK Fachinformatiker exam completed").
    Justification: `learning_note` already exists in the current
    allowlist and directly supports the Learn AI tutor consumer identified
    in the Phase-0 inventory.

  **Deliberately EXCLUDED from v1** (the extraction allowlist for a future
  Worker implementation MUST refuse these even if present in source
  material, regardless of the six kinds above):
  - **Health** (`health_note`'s current allowlist entry is proposed for
    removal, not migration). Justification: health information is a
    special category of personal data under most data-protection regimes;
    an unreviewed, auto-written, auto-injected-into-every-prompt record
    about health is the single highest-risk category `user_context`
    currently touches, and removing it is a strict tightening this ADR
    should make explicitly, not silently drop.
  - **Relationships / family** (`family_note`'s current allowlist entry is
    proposed for removal). Justification: identical reasoning — third-party
    personal data about people who never consented to SmartFlow processing
    it, extracted from a single chat message with no verification.
  - **Emotional state.** Justification: `mood_pattern` remains as a
    deterministic, non-LLM, non-`PersonalMemoryRecord` computation
    (`aiMemoryService.autoDetectAndSave`'s existing journal-average logic)
    — it is explicitly out of scope for this ADR's LLM-extraction path, not
    banned outright, because it is already a bounded, auditable, non-
    inferred computation, not free-text model output about feelings.
  - Financial specifics, exact dates/amounts, and anything the current
    `buildExtractionPrompt`/`buildChatExtractionPrompt` system prompts
    already correctly instruct the model not to extract — this ADR
    inherits that existing, correct restriction, it does not relax it.

  This exclusion list is itself an open question for the Product Owner
  (Q2) — it is a recommendation, not a foregone conclusion, since it
  proposes removing capability (`health_note`, `family_note`) that exists
  and is used today.

- **Typed content payload per `kind`**, deterministically validated —
  mirroring `inferredProjectContextFieldValidation.ts`'s discipline exactly:
  a plain object shape per kind, bounded string lengths, closed enums where
  applicable, rejected (not coerced) on any unknown field or malformed
  value.
- **`provenance.sourceKind`** — `chat_turn` | `briefing` |
  `explicit_user_statement` — plus **non-empty** `sourceReferenceIds` (an
  inference with no source linkage is invalid by construction, identical to
  ADR-0009 Decision §1's evidence-linkage rule) — **except** for
  `explicit_user_statement`, where the "source" is the statement itself
  (see §3.b — reference-only recommendation and its chat-retention caveat
  above).
- **`modelIdentity` + `extractionVersion`** — populated for
  model-authored rows; both `null` for `source: 'user'` rows (an explicit
  statement or a correction was not produced by a model run), mirroring
  ADR-0009's `source='user'` rows never carrying a `runId`.
- **`confidence`** — the same closed `low | medium | high` scale ADR-0009
  Decision §1 already established, for the same reason (a numeric
  self-reported confidence is not a calibrated probability) — cited, not
  restated.
- **State machine** — `proposed → user_confirmed | user_corrected |
  user_rejected | superseded`, with the identical invariants ADR-0009
  Decision §1 already established: a correction is always a new
  `source='user'` row, the original model row is never mutated, and
  automatic supersession applies only against still-`proposed` rows from a
  newer run for the same person + kind + logical slot (cited, not
  restated — see ADR-0009's own Decision §1 and Implementation Notes for
  the full mechanism this ADR reuses without modification).
- **RLS / `SECURITY DEFINER` posture** mirrors
  `inferred_project_context_fields` exactly: owner-scoped `SELECT` only for
  `authenticated`; all writes through `SECURITY DEFINER` functions with
  `search_path` pinned and ownership resolved from `auth.uid()` inside the
  function body; no direct client `INSERT`/`UPDATE`/`DELETE` on the table.
  This is a deliberate, explicit break from `user_context`'s current bare-
  RLS-`GRANT ALL` posture (see Problem above) — the Phase-0 inventory shows
  exactly why that posture is inadequate for a table an LLM writes to
  automatically.

### 2. Differences from the project layer

#### 2.a Erasure from day one

Unlike ADR-0009 Q1 (deferred), personal data requires an explicit deletion
path in v1 — this is not optional the way it was for project-scoped
inferences, because `user_context` already grants Aryan a working hard
delete today (`aiMemoryService.delete`) and a personal-memory system that
regresses that capability would be a step backward, not forward.

**Options:**

1. **User-initiated hard delete of any record, any status, no exceptions.**
   The record and its row disappear entirely — matches today's
   `aiMemoryService.delete` behavior exactly.
2. Soft delete (tombstone) — the record is marked deleted but the row
   persists for audit. Rejected as the default for personal data: keeping a
   "deleted" health/relationship-adjacent fact around, even tombstoned,
   contradicts the point of deleting it, and Aryan has no way today to
   distinguish "gone" from "hidden but retained" without reading this ADR.
3. Deletion with a mandatory retention window (e.g. soft-delete for N days,
   then hard-purge) — rejected for v1 as unnecessary complexity; no
   business or legal requirement for a grace period has been identified,
   and it re-introduces exactly the "retained without a clear reason" risk
   option 2 has.

**What happens to duplicate-suppression when a record is deleted?**
ADR-0009 Q1/Q5 retains `user_rejected` rows specifically so a rejected
model candidate cannot silently reappear on the next run. Personal-memory
deletion is proposed to work differently, honestly presented as a
trade-off rather than hidden:

- **Recommendation: suppression dies with the record.** Deletion means
  "forget," not "remember that I told you to forget" — a hard delete that
  still leaves a fingerprint behind to suppress future re-extraction is not
  really a delete; it is a delete that keeps working in the background.
- **Trade-off, stated plainly:** if Aryan deletes a `health_note`-style fact
  (hypothetically, before such a kind would be re-added by a future
  decision) and the same fact is later re-stated in another chat message,
  the extraction pipeline has no memory of having been told to forget it
  and may propose it again as a fresh `proposed` record. This is the
  necessary cost of a real delete; the alternative (retaining a
  suppression fingerprint after deletion) quietly reintroduces exactly the
  kind of "we kept something about the deletion" behavior a user asking to
  forget something would not expect.

**Does deleting a confirmed record that already influenced a derived
output require re-derivation marking?** Proposed: **no re-derivation
marking in v1.** A past briefing or chat response that already used a
now-deleted fact is not retroactively edited or flagged — `agent_briefings`
and `agent_chat_messages` are historical records of what was said, not live
views of current memory, and rewriting history to reflect a later deletion
is out of scope and arguably undesirable (it would mean SmartFlow silently
edits its own past outputs). Only **future** consumption stops seeing the
deleted record.

**This is presented as options + a recommendation; the choice is reserved
to the Product Owner (Q1).**

#### 2.b Evidence source boundary

Chat is the richest source and the most sensitive. Proposed v1 scope:

- **Sources feeding extraction:** the existing briefing-generation and
  chat-turn extraction paths (`extractAndSaveMemory`,
  `extractAndSaveMemoryFromChat`), migrated to write
  `PersonalMemoryRecord` `proposed` rows through the new discipline instead
  of upserting `user_context` in place. Explicit user statements
  (`source: explicit_user_statement`) are named as a v1 kind in the data
  model (§1) but their own capture surface (a dedicated "tell SmartFlow
  something about yourself" UI, as opposed to a byproduct of a chat
  message) is **out of scope for this ADR's implementation task** — exactly
  as ADR-0009 named the confirm/correct UI as its own separate task.
- **Opt-in posture:** proposed **opt-in per source is deferred, not
  decided here** — see Open Question Q4. The current system extracts from
  both briefing and chat with no opt-in at all (`ENABLE_AUTO_MEMORY_WRITE =
  true`, unconditional); this ADR's §4 already proposes replacing
  always-on background extraction with an explicit user trigger (which is
  itself a step toward user control), but whether the trigger should be
  further scoped per-source (e.g. "extract from this chat" vs. "extract
  from my last briefing" as separate user actions) is left open rather than
  decided, since it is a UX decision more than an architecture one.
- **Raw chat text in provenance: reference-only, not quoted.**
  Recommendation: `sourceReferenceIds` cites `agent_chat_messages.id`
  values; the record's own typed `content` holds only the extracted,
  validated fact, never a copy of the raw message. Content stays in
  `agent_chat_messages` under its own existing retention (100 messages per
  user, pruned on insert — see Phase-0 inventory). **Caveat that must be
  named, not hidden:** because `agent_chat_messages` prunes, a
  `sourceReferenceIds` citation is not permanently resolvable the way an
  evidence-linked `project_evidence` reference is — a personal-memory
  record can outlive the chat turn it cites. This is an accepted
  consequence of reference-only provenance for a bounded-retention source,
  not a defect to fix in this ADR; a future consumer that needs to resolve
  a citation must tolerate "source message no longer available," exactly
  as `representative-engine.md` §16 already requires stale/missing
  provenance to lower confidence or require clarification rather than fail
  silently.

#### 2.c Relationship to `user_context`

Three options, presented honestly with consequences for the Phase-0
consumers found above:

1. **Absorb** — migrate existing `user_context` rows into
   `PersonalMemoryRecord` with a `source: legacy` provenance marker (or
   equivalent), then retire `user_context`. Consequence: every consumer
   (`fetchUserMemory` in the Worker, `aiMemoryService.getAsPromptContext()`
   in the browser, the Learn AI tutor, `AiMemoryTab.tsx`) must be rewritten
   against the new read surface in the same change, since there is nothing
   left to read from the old table. Highest short-term migration cost,
   cleanest end state.
2. **Coexist** — the new layer runs alongside `user_context`; existing
   consumers keep reading `user_context` unchanged; new, reviewed content
   flows only through `PersonalMemoryRecord` until each consumer migrates
   on its own schedule. Consequence: for a transitional period, two
   memory systems exist with different trust levels and no single place
   that represents "what SmartFlow currently believes about Aryan" —
   `representative-engine.md` §17's isolation model is not violated (both
   remain user-scoped), but a future reader must know to check both.
3. **Supersede** — freeze `user_context` writes (stop
   `extractAndSaveMemory`/`extractAndSaveMemoryFromChat`/
   `aiMemoryService.autoDetectAndSave` from writing new rows), leave
   existing rows readable in place for continuity, and route all NEW
   memory exclusively through `PersonalMemoryRecord`. Consequence: existing
   consumers keep working unchanged against old data (no migration
   required to ship), but Aryan now has two places his personal memory
   lives — an old, frozen one and a new, growing one — until a later,
   separate task absorbs the frozen table or the product accepts it as
   permanent legacy read-only history.

**Recommendation: option 3 (supersede), with option 1 (absorb) named as
the natural follow-up once the new layer has proven itself.** Justification:
option 1's all-at-once consumer rewrite is exactly the kind of scope
creep a Tier 1 implementation task (5b) should avoid taking on alongside a
new schema and RPC surface; option 2's indefinite dual-system state has no
natural end point and directly risks the confusion `representative-engine.md`
§15 tries to prevent (unclear which state category is "the" current answer).
Option 3 stops the bleeding (no more unreviewed LLM writes) immediately
upon implementation, without forcing every consumer to change in the same
task. **Decision reserved to the Product Owner (Q3).**

#### 2.d Consumption boundary

Proposed, mirroring ADR-0009 Decision §2's precedence spirit exactly:

- Context synthesis, briefings, and suggestions may consume
  `user_confirmed`/`user_corrected` records freely, as user-declared state
  (`representative-engine.md` §15's highest trust tier available at this
  layer).
- `proposed` (unconfirmed) records may be consumed **only** with a visible
  inferred/unconfirmed marker carried through to every consumer — the
  identical widening ADR-0009 Decision §2 required of `ProjectContext`,
  applied here to whatever future "personal context" read surface consumes
  this data.
- **Never execution authority, at any status** — restated because it is
  ADR-0009's single most important sentence, applied one layer up: no
  `PersonalMemoryRecord`, at any status, is ever read by `writeRuntime.ts`,
  `executionPolicy.ts`, or any approval path.
- **Never cross-user** — restated from `representative-engine.md` §17,
  which already forbids this unconditionally; this ADR adds no new
  cross-user surface.
- **`memoryEngine`'s local, bounded workspace memory
  (`current-architecture.md`'s Workspace Pipeline) remains separate and
  unchanged** — this ADR does not touch it, does not feed it, and does not
  ask it to feed this new layer. The two memory systems answer different
  questions (workspace-signal continuity for today's dashboard vs.
  durable, reviewable personal fact storage) and this ADR does not propose
  merging them.

Whether **proposed** (unconfirmed) personal memories may influence
briefings/suggestions at all — even with marking — or whether personal
memory should require confirmation before **any** consumption (stricter
than the project layer) is **not resolved above**; it is Open Question Q5,
argued both ways there, because personal data's sensitivity plausibly
justifies a stricter bar than ADR-0009 set for project data.

### 3. Extraction run boundaries

Mirroring ADR-0009 Decision §3 and the Context Derivation Worker route's own
posture (`agent/worker/context-derivation-endpoint.ts`), cited rather than
redesigned:

- **Server-side (Worker), the requesting user's own JWT end-to-end** —
  never `SUPABASE_SERVICE_KEY` for the write path, a deliberate break from
  today's `extractAndSaveMemory`/`extractAndSaveMemoryFromChat`, which use
  the service key throughout. This is the same `auth.uid()`-resolution
  requirement ADR-0009's `create_inferred_context_field` already depends
  on, applied here.
- **Deterministic validation before persistence** — a typed, per-`kind`
  schema, exactly as `inferredProjectContextFieldValidation.ts` already
  does for projects; invalid output is dropped and logged, never coerced.
- **Duplicate suppression, including against rejected rows** — the
  identical ADR-0009 Q1/Q5 logic, reused rather than reinvented, subject to
  §2.a's "suppression dies with the record" rule for deleted rows
  specifically (deletion is a stronger operation than rejection and clears
  the fingerprint; rejection alone still suppresses, unchanged from
  ADR-0009's pattern).
- **Minimal run metadata** — call/token counts persisted per run, mirroring
  ADR-0009 Q3's resolution exactly.
- **Explicit user trigger only in v1.** This is a deliberate change from
  today's behavior, not a continuation of it: `ENABLE_AUTO_MEMORY_WRITE` is
  currently `true` and unconditional on every chat turn and every briefing
  (see Phase-0 inventory). This ADR proposes that a future implementation
  require an explicit user action ("review what SmartFlow could learn from
  this conversation," or similar) before any extraction run against chat
  or briefing content — automatic background extraction on every turn is
  named as **deferred**, not decided against forever, and belongs near
  Smart Automation's future lane (`project-evidence-acquisition.md` and
  `project-domain.md` already name that lane for the analogous project-side
  question).

### 4. Deferred (named, not resolved)

- Embeddings / semantic retrieval over personal memory.
- Automatic extraction scheduling (see §3 above — explicitly deferred, not
  rejected).
- Decision-pattern modelling — already named as deferred in ADR-0006's own
  "Deferred Capabilities" list; this ADR does not revisit that.
- **Relationship to a future Smart Personas concept.** One paragraph, no
  design: SmartFlow's `PersonalMemoryRecord` layer holds *working memory
  about* Aryan for representation purposes inside SmartFlow — it is not,
  and this ADR does not propose it become, a canonical identity store.
  Should a future "Smart Personas" capability emerge as a distinct,
  cross-product identity layer, canonical ownership of Aryan's identity
  data would be that future lane's decision to make, not a retroactive
  claim this ADR stakes now. This boundary is named so a future reader does
  not mistake this ADR for having decided that question.

### 5. Open questions for the Product Owner

1. **Q1 — Erasure semantics.** Approve, among §2.a's three options, (1)
   user-initiated hard delete of any record regardless of status with
   suppression dying with the record (recommended), (2) soft delete /
   tombstone, or (3) delete with a mandatory retention window. Also confirm:
   no re-derivation marking for past outputs that used a now-deleted record
   (recommended), or require one.
2. **Q2 — v1 kind taxonomy.** Approve, trim, or extend the proposed six
   kinds (`preference`, `goal`, `working_pattern`, `commitment`,
   `personal_fact`, `skill`) in §1, and approve, trim, or extend the
   proposed sensitive-category exclusions (health, relationships/family,
   emotional state) — noting explicitly that `health_note` and
   `family_note` are **currently live, extracted, and used** capabilities
   this recommendation would remove, not merely decline to add.
3. **Q3 — Relationship to `user_context`.** Approve one of §2.c's three
   options: absorb, coexist, or supersede (recommended: supersede, with
   absorb as a named future follow-up).
4. **Q4 — Extraction sources and opt-in posture.** Confirm §2.b's proposed
   v1 sources (briefing + chat extraction paths, migrated; explicit user
   statements named as a kind but their capture UI out of scope for the
   implementation task) and decide whether extraction should be opt-in per
   source (e.g. a per-source toggle) or governed only by the single
   explicit-trigger requirement in §3 with no finer-grained opt-in for v1.
5. **Q5 — Consumption strictness for unconfirmed records.** Two positions,
   argued both ways:
   - **A (mirrors ADR-0009):** `proposed` personal memories may influence
     briefings/suggestions, provided the inferred/unconfirmed marker is
     preserved through to the consumer (§2.d) — treats personal memory
     with the same trust discipline already proven for project memory, and
     avoids a second, inconsistent rule for what "marked as unconfirmed"
     is allowed to do.
   - **B (stricter than ADR-0009):** personal memory must reach
     `user_confirmed`/`user_corrected` before **any** consumption, even
     marked — because personal facts (goals, working patterns, commitments)
     are more directly and immediately personalization-shaping than a
     project risk or milestone candidate is, and a wrong unconfirmed guess
     about *Aryan himself* surfacing in a briefing carries a different,
     more personal kind of harm than a wrong guess about a project's
     milestone status. The cost is that a freshly extracted, plausible,
     still-unreviewed fact contributes nothing until Aryan actively visits
     a review surface — slower value, safer default.

   No recommendation is made between A and B in this draft; both are
   presented for the Product Owner's own judgment, since the trade-off is
   values-based (speed/richness of personalization vs. default caution
   about unreviewed personal claims), not an architectural correctness
   question this ADR can resolve on the project-layer precedent alone.

## Product Owner Resolutions

Recorded verbatim as decided on 2026-08-08, resolving the five open
questions above. These resolutions are part of this Accepted decision, not
a separate future ADR.

- **Q1 Erasure:** hard delete of any record at any status; duplicate-
  suppression dies with the record ("forget" means forget); no
  re-derivation marking; accepted trade-off: a deleted fact may be
  re-extracted and re-proposed later.
- **Q2 Taxonomy:** the six kinds approved (preference, goal,
  working_pattern, commitment, personal_fact, skill). health /
  relationships / emotional-state EXCLUDED from extraction — the PO
  explicitly accepts that live `health_note`/`family_note` extraction
  capability is removed.
- **Q3 `user_context`:** SUPERSEDE — freeze all new writes to
  `user_context`; the new layer is the only write path. Existing
  `user_context` rows are test data with no value; the "absorb" migration
  follow-up is therefore **not planned** (recorded so future work does not
  assume a pending migration). Existing rows remain readable/deletable via
  the existing `AiMemoryTab` until consumers migrate.
- **Q4 Sources:** briefing + chat extraction, EXPLICIT USER TRIGGER ONLY.
  Always-on background extraction (`ENABLE_AUTO_MEMORY_WRITE`) is disabled
  by this decision. Automatic extraction may return only via a future
  recorded decision.
- **Q5 Consumption:** STRICTER THAN ADR-0009 — proposed personal memory
  records have ZERO consumption. Only `user_confirmed` / `user_corrected`
  records may influence any output (chat context, briefings, suggestions,
  tutor). No "marked but consumed" tier for personal memory.

## Consequences

- A new table + migration + `SECURITY DEFINER` RPCs (`create_personal_memory_record`,
  `resolve_personal_memory_record`, and `delete_personal_memory_record`,
  mirroring ADR-0009's two-function pattern plus a new erasure function per
  Q1) is required before any implementation — **Tier 1 under ADR-0008**,
  requiring its own independent review before merge, exactly as ADR-0009's
  implementation (task `3b`) did. That implementation work (task `5b`) is
  authorized to build but stays uncommitted pending independent review,
  exactly as ADR-0009's task `3b` did.
- The existing briefing and chat memory-extraction paths
  (`extractAndSaveMemory`, `extractAndSaveMemoryFromChat` in
  `agent/worker/index.ts`) are disabled by task `5b` per Q4 — `user_context`
  writes are frozen per Q3, not migrated (the "absorb" follow-up is
  explicitly not planned).
- A confirm/correct review UI for `PersonalMemoryRecord`, reusing the
  interaction pattern already proven in
  `src/features/projects/components/InferredContextSection.tsx`, is a
  separate, later Tier 2 task — not started or scoped by this ADR, exactly
  as ADR-0009 separated its own confirm/correct UI into task `4`.
- `PROJECT_STATUS.md` §5 will need updating upon acceptance to record this
  ADR's Accepted status and to sequence the Tier 1 schema/migration work it
  authorizes as the next concrete step.
- No existing table, RLS policy, or write path changes as a result of this
  ADR alone — it defines a new aggregate and proposes a plan for
  `user_context`'s future, it does not itself modify `user_context`,
  `agent_chat_messages`, `chat_sessions`, or any other existing table.

## Related ADRs

- [ADR-0006: Canonical Product Identity](ADR-0006-canonical-product-identity.md)
  — the mission this layer serves, and the "no such system is claimed as
  implemented" bar this ADR proposes clearing.
- [ADR-0007: ProjectEvidence Observation Model](ADR-0007-projectevidence-observation-model.md)
  — the atomic, immutable, `SECURITY DEFINER`-gated aggregate pattern both
  ADR-0009 and this ADR mirror.
- [ADR-0009: Inferred Project Context Layer](ADR-0009-inferred-project-context-layer.md)
  — the proven pattern this ADR extends from project to person, cited
  throughout rather than restated.
- [ADR-0008: Tiered Change Governance](ADR-0008-tiered-change-governance.md)
  — governs the review tier of this ADR's eventual implementation (Tier 1)
  and its confirm/correct UI (Tier 2).
