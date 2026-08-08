# Personal Memory Review UI — Design Note (Draft)

Tier 2 under [ADR-0008](../../decisions/adr/ADR-0008-tiered-change-governance.md):
short design note + full tests, commit at end if fully green; independent
review may follow post-merge. Implements the confirm/correct/reject/delete
surface [ADR-0010](../../decisions/adr/ADR-0010-personal-memory-layer.md)
and its own Consequences section named as a separate, later task — this is
that task (`6`).

## Placement decision

**Combined "Memory" surface in Settings, legacy tab body unchanged.**
`PersonalMemorySection` (new) is composed *above* the existing
`AiMemoryTab` content inside the same `'ai-memory'` Settings tab — no new
tab, no new `Tab` id, no new `TranslationKey`, `AiMemoryTab.tsx` itself is
**not modified at all**.

Why, over the alternatives:

- `InferredContextSection.tsx`'s own placement (inside `ProjectWorkspacePage`)
  does not transfer: `PersonalMemoryRecord` has no project dimension
  (ADR-0010 Decision §1 — "user-scoped, no project dimension"), so there is
  no per-project workspace page to attach it to. The natural home is
  wherever the user already manages their own personal-memory-adjacent
  settings, which is `AiMemoryTab`'s existing home in `SettingsPage.tsx`.
- A brand-new tab was considered and rejected as the larger change:
  `SettingsPage.tsx`'s tab bar labels are the one place this feature area
  uses i18n (`TranslationKey`/`useT()`) even though the tab *bodies*
  (`AiMemoryTab.tsx` itself) have none — adding a tab would mean adding a
  new translation key across the existing locale set for no functional
  reason, which the task brief explicitly asks to avoid ("do not introduce
  ... i18n where the surrounding surface has none").
- Editing `AiMemoryTab.tsx` in place (e.g. rendering `PersonalMemorySection`
  from inside it) was considered and rejected: that file is a Tier-1-adjacent
  surface already independently reviewed and re-reviewed twice in the
  Personal Memory Layer v1 review trail
  (`docs/reviews/2026-08-personal-memory-layer-review.md`), with its own
  10-test suite already green. Composing the two components at the
  `SettingsPage.tsx` call site — a one-line change — achieves the same
  visual result ("legacy below") without touching that already-reviewed
  file's contents, imports, or test surface at all.
- The 5a design note's own "Review-UI concept" sketch speculated this
  section "would fully replace `AiMemoryTab.tsx`" once Q3 was answered.
  That speculation is now superseded by the actual, accepted Q3 resolution
  (SUPERSEDE, amended in task `5c`): "existing rows remain
  readable/deletable via the existing `AiMemoryTab` until consumers
  migrate" — the PO's own resolution keeps the legacy tab reachable, not
  replaced. This note follows the accepted resolution, not the earlier
  speculative sketch.

Net change to `SettingsPage.tsx`: the `'ai-memory'` entry in `TAB_CONTENT`
changes from `<AiMemoryTab />` to `<><PersonalMemorySection ... /><AiMemoryTab
/></>` (exact props below). No other line of that file changes.

## Surfaces

**List, grouped by kind, newest first within each kind** (six kinds, fixed
order matching `PERSONAL_MEMORY_RECORD_KINDS`: preference, goal,
working_pattern, commitment, personal_fact, skill — mirrors
`inferredContextFieldPresentation.ts`'s `INFERRED_CONTEXT_FIELD_KIND_ORDER`
convention exactly, one dimension over).

**Status disambiguation** — identical rule to
`inferredContextFieldPresentation.ts`'s own disambiguation table, because
`resolve_personal_memory_record` has the identical transition shape one
layer up: `status` alone is ambiguous for "confirmed" (a plain confirm
keeps `source: model` on the *same* row; a correction inserts a *new*
`source: user` row that also carries `status: user_confirmed`). Disambiguate
on `(status, source, supersedesId)`, never on `status` alone:

| `status` | `source` | `supersedesId` | Display status | Shown by default? |
|---|---|---|---|---|
| `proposed` | `model` | — | **Proposed** | yes |
| `user_confirmed` | `model` | — | **Confirmed** | yes |
| `user_confirmed` | `user` | set | **Corrected** | yes |
| `user_rejected` | any | — | **Rejected** | **no — behind "Show rejected"** |
| `user_corrected` | `model` | — | *(the pre-correction original)* | **no — never as its own list entry** |
| `superseded` | any | — | *(unreachable in v1 — no automatic supersession, per ADR-0010 Implementation Notes)* | no |

Every status label is **text**, never colour-only (repo accessibility
convention, already established for `AiMemoryTab`'s "AI-written, unreviewed"
badge). Each of **Proposed** and **Rejected** carries one extra line of
plain-language copy, not just a label:

- Proposed: *"Not used anywhere until you confirm it."* — makes ADR-0010 Q5's
  zero-consumption guarantee visible to the user, not merely true in code.
  This UI is the **only** surface where a `proposed` record is ever shown;
  no consumer is wired in this task (see Non-goals).
- Rejected (only visible behind the toggle): *"Still prevents this same fact
  from being suggested again."* — makes the Q1/Q5-derived duplicate-
  suppression-survives-rejection rule visible, so a rejected row's continued
  existence in the list (once the toggle is on) isn't mysterious.

**Rejected records are hidden by default**, behind an explicit "Show
rejected" toggle button in the section header (not a route param, not a
separate page — a local, in-memory toggle, since there is no batching or
persistence concern here). When shown, rejected records display no
Confirm/Correct/Reject actions (they are not `proposed`, so
`resolve_personal_memory_record` would reject any of those three with
`RECORD_NOT_PROPOSED` — the UI does not offer an action the backend would
refuse) — only **Delete**, per Q1.

**The pre-correction original is never its own list entry.** Per the table
above, a `status: user_corrected` row (still `source: model`) is excluded
from the default-visible set entirely, exactly like `superseded`/
`user_rejected` in the *project* layer's own UI — but unlike that layer,
this UI adds a **history affordance**: the *correction* record's card
carries a small "View original" disclosure toggle that, when opened, shows
the pre-correction content read-only, clearly labeled ("Superseded by your
correction") — never as if it were current user content, never with any
action button. This is new relative to `InferredContextSection.tsx` (which
has no equivalent affordance at all — a corrected field's original is just
gone from the UI, full stop) because Q1 makes "what did I originally say
before I corrected it" a legitimate, answerable question for personal data
in a way the project layer never asked the PO to decide.

**Per-record actions:**

- **Confirm / Correct / Reject** — shown only for `proposed` records,
  identical mechanics to `InferredContextSection.tsx`: Confirm and Reject
  are single-click, single-call; Correct opens an inline form (below,
  pre-filled) and submits via the same `resolve` call with `action:
  "correct"`.
- **Delete** — shown on **every** visible record regardless of status
  (Q1: "hard delete of any record at any status, no exceptions"). Uses the
  repo's existing destructive-action confirmation pattern
  (`@/components/ui/alert-dialog`'s `AlertDialog`, as already used by
  `FinancePage.tsx`/`TasksPage.tsx`/`CalendarPage.tsx`/`DocumentsPage.tsx` —
  never a bare `window.confirm`). The confirmation copy states plainly, in
  two sentences: deletion is permanent, and the same fact may be
  re-extracted and re-proposed by a future extraction run, because deleting
  a record also removes the fingerprint that would otherwise have
  suppressed that re-proposal ("forget" removes the memory *and* the
  suppression — ADR-0010 Q1's own accepted trade-off, restated in plain
  language for the person clicking the button).

**Extraction trigger.** A button ("Check for new personal memory") calls
`POST /personal-memory/extraction` via a new
`personalMemoryExtractionTriggerClient.ts` (mirrors
`contextDerivationTriggerClient.ts` exactly: user's own session token,
never a service key). States: idle → in-progress (button disabled, spinner,
label changes to "Checking…") → result. A `422 NO_SOURCE_MATERIAL` response
renders as an honest, human sentence ("Not enough recent activity to extract
from yet — chat with SmartFlow or generate a briefing first."), not a raw
error. A successful run renders a one-line summary ("Extraction complete:
N accepted, M dropped.") and refreshes the list. No other error code gets
special copy beyond the server's own message, mirroring
`derivationErrorMessage`'s fallback behavior exactly.

**Correction flow.** A per-kind form, pre-filled from the record's current
content, built the same way `InferredContextSection.tsx`'s `CorrectionForm`
is: a declared field-schema table
(`PERSONAL_MEMORY_FORM_SCHEMAS`, new, mirroring `INFERRED_FIELD_FORM_SCHEMAS`)
drives both the rendered inputs and the form-values ↔ content conversion.
Client-side validation reuses `validatePersonalMemoryContent` — the
canonical validator this whole layer already depends on — never a
duplicated rule. Submission calls `service.resolve({ recordId, action:
"correct", correctedContent })`; on success the corrected record (a new
`source: user` row) replaces the display entry, exactly as
`resolve_personal_memory_record` itself replaces it server-side.

## Q1/Q5 fidelity, stated explicitly

- **Q1 ("forget means forget"):** Delete is available at every status shown
  in this UI (proposed, confirmed, corrected, and — behind the toggle —
  rejected), never gated on status, and its confirmation copy names the
  re-extraction trade-off honestly rather than implying deletion is either
  softer or more permanent than it actually is.
- **Q5 (zero consumption):** this UI is the **only** place a `proposed`
  `PersonalMemoryRecord` is ever rendered anywhere in the product. No
  briefing, chat context, suggestion, or tutor surface reads this table —
  unchanged by this task (see Non-goals) and independently grep-verifiable
  after implementation exactly as it was after task `5b`/`5c`. The
  in-UI copy on `proposed` records ("Not used anywhere until you confirm
  it") makes this guarantee visible, not only true.

## Non-goals (explicitly out of scope for this task)

- No consumer wiring of any kind — confirmed/corrected records still feed
  nothing (chat, briefings, suggestions, tutor). Wiring a consumer is a
  future, separately-decided task.
- No bulk actions (bulk confirm/reject/delete).
- No auto-confirmation of any record, at any confidence level — mirrors
  ADR-0009's own explicit rejection of confidence-driven auto-confirmation.
- No change to any RPC, migration, schema, or the canonical/duplicated
  validators — this task is presentation-layer only.
- No `explicit_user_statement` capture surface (still schema-ready, still
  deferred — ADR-0010 §2.b).
- No localization beyond this surface's existing convention (none, per
  `AiMemoryTab.tsx`'s own file).
