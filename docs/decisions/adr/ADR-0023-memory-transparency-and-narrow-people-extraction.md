# ADR-0023: Memory Transparency Level v1 — Recall Logging, Range Deletion, and Narrow People Extraction

- **Status:** Accepted
- **Date:** 2026-09-07
- **Accepted:** 2026-09-07
- **Decision Makers:** Product Owner (Aryan Barakzai) — decision; Claude Code
  — drafting and Tier 1 implementation.
- **Supersedes:** None
- **Superseded by:** None
- **Amends:** [ADR-0010](ADR-0010-personal-memory-layer.md) §1 / Q2 — narrowly, per §4 below.
  ADR-0010's kind taxonomy and its exclusion of relationship/family extraction otherwise
  stand unchanged; this ADR does not reopen health or emotional-state exclusion, and does not
  add a seventh `kind` to `personal_memory_records`.

---

## Context

A CORE-porting audit ("ممیزی CORE برای اسمارت‌فلو", 2026-09-06) named item ۱-۶, "Memory
Transparency Level," as a gap between CORE's memory UI and SmartFlow's own
`PersonalMemoryRecord` layer (ADR-0010, ADR-0011). Four sub-surfaces were named: extraction/
ingestion visibility with retry, a recall log (when memory was actually read into a prompt),
range-based deletion gated by a typed confirmation, and an auto-derived people list with a
provenance graph. The Product Owner chose full parity on all four via two separate
`AskUserQuestion` exchanges — the second specifically after being told sub-surface 4 reopens
a privacy decision ADR-0010 Q2 explicitly closed (relationships/family were excluded from
extraction). Both times the answer was to proceed with the full CORE-parity version.

**Inventory of what already exists (cited from the actual schema and code, not assumed):**

- `personal_memory_extraction_runs` (`supabase/migrations/20260808000000_personal_memory_records.sql`)
  is a populated table — `started_at`, `completed_at`, `outcome`, `candidate_count`/
  `accepted_count`/`dropped_count`, `failure_reason` — with **no UI anywhere** reading it.
  Nothing in `src/features/personal-memory/` or `PersonalMemorySection.tsx` lists runs today.
- The confirmed-memory consumption path (`agent/worker/context-builder.ts`'s
  `fetchConfirmedPersonalMemory`, used by both `/chat` and briefing generation; and the
  browser-side Learn AI tutor via `getConfirmedMemoryPromptContext` →
  `browserPersonalMemoryRecordService.listConfirmed()`) is a flat, unbounded-by-query read:
  top-30-by-recency, then bounded to 10-total/3-per-kind by
  `personal-memory-prompt-serialization.ts`'s `selectBoundedConfirmedMemory`. **There is no
  query/search concept anywhere in this path to log** — "recall log" therefore means logging
  *that a bounded read happened and which records it selected*, not logging search queries,
  which do not exist in this architecture.
- The Learn AI tutor's memory consumption does **not** run inside `agent/worker` at all:
  `askLearnAI` (`src/features/learn-ai/aiService.ts`) posts directly to an external service,
  `https://api.barakzai.cloud/analyze`. Of the three memory-reading consumers, two (`/chat`,
  briefings) share one Worker-side function and are a real single choke point; the tutor is a
  genuinely separate, browser-side read with no shared code path to either of the other two.
- `delete_personal_memory_record` (same migration) accepts a single `p_record_id` only — no
  bulk/range-delete RPC exists for `personal_memory_records` anywhere in the migrations.
- `src/pages/SettingsPage.tsx`'s `DataTab` already contains the only typed-word-confirmation
  destructive-delete pattern in this codebase (`disabled={deleteInput !== 'DELETE'}`), for a
  *different, wider* deletion (`dataExportService.deleteAllUserData()` — deletes app data
  across several tables but **does not touch `personal_memory_records` today**, confirmed by
  reading the service).
- No `contacts`/`people`/`CRM`/`Contact` concept exists anywhere in `src/` or
  `supabase/migrations/` — there is nothing to build on and nothing to duplicate.
- The existing provenance model is single-hop only: `provenance_source_ref_ids` points to one
  of `chat_turn`/`briefing`/`document`/`explicit_user_statement`; `provenance_snapshot` is
  populated by a `BEFORE DELETE` trigger on `document_chunks`
  (`20260811010000_personal_memory_document_provenance.sql`) for the document case. No
  multi-hop entity graph exists anywhere in the data model.

## Problem

Four concrete gaps, each cited above: (1) extraction activity is invisible and has no retry
affordance beyond re-clicking the same trigger button blind; (2) a user has no way to see
*when* or *by which consumer* their confirmed memory was actually used, only that it
theoretically could be; (3) forgetting a whole time range or category of memory requires
deleting records one at a time, with no higher-friction confirmation matching the higher
blast radius; (4) there is no way to see which people are known to SmartFlow's memory of the
user, or to trace a memory record back to the document/conversation it came from, visually.

Sub-surface 4 additionally reopens a decision this repository already made once: ADR-0010 Q2
excluded relationship/family extraction as a privacy decision — "third-party personal data
about people who never consented to SmartFlow processing it, extracted from a single chat
message with no verification." A people list is relationship-adjacent by nature. This ADR
does not treat that concern as resolved by the Product Owner's scope choice alone; §4 below
states the specific, narrower thing being authorized and why it is considered acceptable
despite ADR-0010 Q2's reasoning, rather than silently reinterpreting that reasoning away.

## Decision

### 1. Extraction visibility + retry — no schema change

`personal_memory_extraction_runs` already carries everything needed. "Queue status" is
reinterpreted honestly for a synchronous system (extraction is a single Worker request/
response, not an async job queue): a run row with `completed_at IS NULL` past a reasonable
window is rendered **Interrupted** — distinct from `outcome = 'failed'` (a completed run that
observed a failure) and `outcome = 'completed'`. "Retry" is not a new capability: it is the
existing `triggerPersonalMemoryExtraction` client, already wired to `PersonalMemorySection`'s
"Check for new personal memory" button, invoked again from the new history view.

### 2. Recall log

New table `personal_memory_recall_log`, one row per `(recall event, record)` pair. It stores
**only `record_id`, as a real foreign key with `ON DELETE CASCADE` — never a text or content
snapshot of what was recalled.**

This is a deliberate trade-off, stated plainly rather than hidden: storing `content.summary`
at read time would silently defeat ADR-0010 Q1's "forget means forget" guarantee — a user who
hard-deletes a record would find its text still sitting in their own recall history
indefinitely. Making the log's only link to content a live foreign key means deleting the
underlying record automatically and structurally removes its citation row from
`personal_memory_recall_log`, via `ON DELETE CASCADE`, with no application code required to
keep the two in sync. The accepted consequence, stated precisely: a recall batch that cited
several records loses only the rows for the ones that are later deleted (a batch of 3 where 1
is deleted still shows the other 2); a batch whose *every* cited record has since been deleted
loses every one of its rows and so no longer appears in the log at all — not an
empty-but-present placeholder, but the batch's entire trace disappearing, exactly as if that
recall had never been recorded. This is intended, not a defect: a recall log must not
outlive the memory it recalled, all the way down to a batch's own visibility.

Write path is split by caller identity, following this repository's existing convention of
routing every write to this table family through validation rather than a bare grant:

- `/chat` and briefing generation (Worker-owned, service-role) write directly via the existing
  `supabasePost` helper, since the service role already fully trusts these two call sites.
- The Learn AI tutor (browser-owned, RLS-scoped, and — per the Context above — not part of
  `agent/worker` at all) writes through a new `SECURITY DEFINER` RPC,
  `log_personal_memory_recall(p_record_ids, p_consumer)`, which re-derives eligibility
  server-side (`auth.uid()` ownership, `status in ('user_confirmed','user_corrected')`) rather
  than trusting the caller, and rejects any `p_consumer` other than `'tutor'` — a browser
  caller has no legitimate way to produce a `'chat'` or `'briefing'` recall event, since those
  paths never run in the browser.

### 3. Range deletion, typed-confirmation-gated

New `SECURITY DEFINER` RPC, `delete_personal_memory_records_by_range(p_start, p_end,
p_kind default null)`. A real, hard `DELETE` — ADR-0010 Q1's rule is restated and preserved
exactly here: no soft-delete/tombstone variant is introduced for range deletion either, even
though the blast radius is larger than a single-record delete. Scoped strictly to
`personal_memory_records`: this RPC does not touch, and this ADR does not widen,
`dataExportService.deleteAllUserData()` — that remains the separate, existing, whole-app-data
wipe it already is.

The confirmation UX reuses the interaction shape already proven in `DataTab` (a button
disabled until a literal string is typed exactly), with a **different literal**, `DELETE
MEMORY` rather than bare `DELETE` — deliberately, so the two destructive dialogs in this
application are not interchangeable by muscle memory (a user who has trained themselves to
type `DELETE` for the whole-app wipe should not accidentally satisfy this narrower dialog's
gate without reading it).

### 4. People list — the scope amendment

This is the part of this ADR that most directly engages ADR-0010 Q2's earlier reasoning, and
is deliberately narrower than CORE's own people/CRM entity in every dimension that reasoning
named as a risk:

- **Name only. No role, relationship-type, or company field — ever.** The schema itself omits
  these columns; there is no field to leave empty. This is a stronger and more auditable
  guarantee than a validator that merely doesn't populate an optional column, because it
  cannot regress by a future oversight.
- **Source boundary identical to every other consumer of this layer**: only records already
  at `user_confirmed`/`user_corrected` status are eligible source material — the same
  boundary `listConfirmedByOwner`/`fetchConfirmedPersonalMemory` already enforce, re-verified
  a second time at the database layer inside the extraction RPC itself, never trusted from
  Worker-side code alone. A name can therefore only ever be derived from a fact the user has
  already actively reviewed and confirmed about themselves — never from raw, unreviewed chat
  or briefing text, and never from a still-`proposed` record (this is the same "zero
  consumption for `proposed`" rule ADR-0010 Q5 and ADR-0011 §1 already established for every
  other consumer, applied here rather than invented anew).
- **Manually triggered only**, mirroring ADR-0010 §3's "explicit user trigger only" rule for
  the same reason: no background/automatic extraction of names, ever.
- **Central safety argument — never consumed by any AI output.** A people-list entry is never
  injected into any prompt, by any consumer (`/chat`, briefings, or the tutor), under any
  circumstance. It exists solely as a read-only, user-owned, deletable transparency surface.
  This is what makes the narrower scope defensible against ADR-0010 Q2's original concern:
  that concern was about *unreviewed model inferences about third parties silently shaping
  SmartFlow's outputs*. A name extracted here shapes nothing — it is derived from content the
  user already confirmed was true and correct about their own life, and its only effect is
  that the user can see it listed and delete it. Because nothing ever *acts* on a people-list
  entry, there is no proposed/confirmed review lifecycle to design for people at all —
  visibility plus hard delete is the complete lifecycle, unlike `personal_memory_records`'
  full state machine.
- **Erasure**: hard delete, identical rule to everywhere else in this layer. A mention link
  disappears automatically via `ON DELETE CASCADE` if its source record is later deleted — the
  same "automatic via a live foreign key, not application code" pattern §2 already establishes
  for the recall log, applied one further layer.

This ADR does **not** conclude that ADR-0010 Q2's original reasoning was wrong. It concludes
that a narrower operation — deriving a bare name from content the user has already personally
confirmed, never re-surfacing that name in any AI-generated output, and keeping it as
transparently deletable as everything else in this layer — sits outside what that reasoning
was protecting against, which was specifically *unreviewed, third-party-affecting model
output silently becoming input to future outputs*.

### 5. Provenance graph

Scoped explicitly as a two-tier visual over the **existing** single-hop provenance links —
memory-record nodes on one side, their resolved source nodes (chat turn / briefing / document
chunk) on the other, connecting lines, click-to-navigate. This is deliberately **not** a
general multi-hop knowledge graph: no such relationships exist anywhere in this data model to
visualize, and the source audit document's own section ۶ ("don't chase this") names
CORE-style knowledge graphs specifically as not worth porting. The Product Owner chose full
parity anyway; the responsible reading of that choice, given what the data actually contains,
is to visualize the real single-hop links that exist rather than to construct a graph data
model that doesn't. No new graph/charting library dependency is introduced — a plain inline
SVG overlay over two flex-rendered columns is sufficient for this shape, consistent with this
repository's general preference against new dependencies absent clear justification (`rrule`,
added for the immediately preceding feature, remains this repository's only-ever new Worker
runtime dependency, and only after explicit bundling verification).

## Product Owner Resolutions

Recorded verbatim as decided on 2026-09-07, via two `AskUserQuestion` exchanges conducted
during planning:

- **Overall scope:** full CORE parity across all four sub-surfaces (extraction visibility,
  recall log, range deletion, people list + provenance graph) — chosen over a narrower
  "transparency only, drop the CRM" alternative.
- **People list, after being told of the ADR-0010 Q2 tension:** proceed with the full people
  list anyway ("همان CRM کامل CORE") — recorded here as the explicit authorization this ADR's
  §4 scope amendment relies on. §4's narrowing (name-only, never-consumed) is this ADR's own
  proposed shape for satisfying that authorization safely, not something separately put to
  and approved by the Product Owner clause-by-clause; if the Product Owner wants a wider
  people entity (role/relationship fields, or future consumption by AI outputs) than §4
  describes, that is a new, separate decision, not something this ADR is presumed to already
  cover.

## Consequences

- Tier 1 under [ADR-0008](ADR-0008-tiered-change-governance.md): a new migration (recall log
  table + RPC in this PR; range-delete RPC and people-list tables/RPCs authorized here, built
  in a follow-up PR) requires independent review before merge, per this repository's standing
  convention for schema/RPC-surface changes.
- No existing table's write posture changes. In particular, `dataExportService
  .deleteAllUserData()` and `personal_memory_records`' existing three RPCs
  (`create_personal_memory_record`, `resolve_personal_memory_record`,
  `delete_personal_memory_record`) are untouched — this ADR only adds new, narrower surfaces
  alongside them.
- `PersonalMemorySection.tsx` and the `'ai-memory'` Settings tab gain sibling components; this
  ADR does not propose rewriting the existing review UI.
- This PR ("CORE-W6") implements §1, §2, and §5. §3 (range deletion) and §4 (people list) are
  authorized by this ADR but implemented in a follow-up PR ("CORE-W7"), mirroring ADR-0010's
  own precedent of authorizing a decision's implementation as a separate, later task.

## Related ADRs

- [ADR-0010: Personal Memory Layer v1](ADR-0010-personal-memory-layer.md) — the data model,
  state machine, and erasure/consumption rules this ADR extends and, in §4 only, narrowly
  amends.
- [ADR-0011: Confirmed Personal Memory Consumption v1](ADR-0011-confirmed-personal-memory-consumption.md)
  — the consumption boundary (`user_confirmed`/`user_corrected` only, zero consumption for
  `proposed`) this ADR's recall log observes and whose source-eligibility rule §4's people
  extraction re-derives at the database layer.
- [ADR-0008: Tiered Change Governance](ADR-0008-tiered-change-governance.md) — governs the
  review tier of this ADR's implementation.
