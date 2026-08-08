# Inference confirm/correct UI in Project Workspace -- design note

**Status:** Draft
**Task:** `4` (Tier 2 under ADR-0008; full independent review may follow post-merge)

## Scope

Adds a read/write UI surface over the already-implemented, already-reviewed
ADR-0009 persistence layer (`inferredProjectContextFieldService.ts` /
`...Repository.ts`, the `create_inferred_context_field` /
`resolve_inferred_context_field` SECURITY DEFINER functions). This note does
not revisit, and this task does not touch, the derivation pipeline, the
precedence resolver, the migration, or any RPC contract.

## Surfaces

1. **"Inferred understanding" section** in `ProjectWorkspacePage`, rendered
   only for a live (non-fixture) project, listing this project's
   `InferredProjectContextField` rows grouped by `kind`.
2. **Derivation trigger control** -- a button that calls the Worker's
   `POST /projects/context-derivation` with the signed-in user's own JWT.
3. **Per-field actions** on a still-`proposed` row: Confirm / Correct /
   Reject.

## What is actually visible by default (status/source disambiguation)

Reading `resolve_inferred_context_field`'s own transition rules
(`supabase/migrations/20260807000000_inferred_project_context_fields.sql`)
precisely, rather than only the ADR's prose, matters here:

- `confirm` flips the *same* row's `status` to `user_confirmed`; `source`
  stays `model`.
- `reject` flips the same row's `status` to `user_rejected`; `source` stays
  `model`.
- `correct` flips the *original* row's `status` to `user_corrected` (never
  touches its `content`) and inserts a **new** row with `source: 'user'`,
  `status: 'user_confirmed'`, `supersedesId` pointing at the original.

So a row with `status: 'user_confirmed'` is ambiguous by status alone -- it
is either a plain confirmation (`source: 'model'`) or a correction's new row
(`source: 'user'`, `supersedesId` set). The UI disambiguates on
`(status, source, supersedesId)`, not on `status` alone:

| status | source | supersedesId | Default-view label |
|---|---|---|---|
| `proposed` | `model` | -- | "Inferred -- unconfirmed" (actionable) |
| `user_confirmed` | `model` | -- | "Confirmed" |
| `user_confirmed` | `user` | set | "Corrected" |
| `user_corrected` | `model` | -- | hidden (the original, pre-correction row -- never shown as user content) |
| `user_rejected` | `model` | -- | hidden (still suppresses duplicates server-side; ADR-0009 Q1/Q5) |
| `superseded` | `model` | -- | hidden (auto-superseded by a newer run, objective/milestone only) |

No hide-toggle for `proposed` rows, per ADR-0009's Product Owner resolution
Q2. Actions (Confirm/Correct/Reject) render only for `status === 'proposed'`
rows -- the server's own `FIELD_NOT_PROPOSED` rejects every other status, so
the UI reflects that boundary rather than attempting an action a resolved
field cannot take.

## State marking

Text-based, not colour-only (`representative-engine.md` section 15 /
existing accessibility convention in this codebase, e.g.
`ProjectWorkspacePage.tsx`'s `StateBadge`): every card carries an explicit
label ("Inferred -- unconfirmed" / "Confirmed" / "Corrected"), never a bare
colour swatch.

## Correction flow

Opens a per-kind form pre-filled with the model's current `content`. Each
kind's field set (declared once, shared between display formatting and the
form) mirrors `inferredProjectContextFieldTypes.ts`'s per-kind content
shape exactly -- no field the type doesn't already have. Submit validates
client-side with the *same* canonical validator
(`validateInferredFieldContent` from `inferredProjectContextFieldValidation.ts`)
before calling `service.resolve({ fieldId, action: "correct",
correctedContent })`; the server remains authoritative and re-validates
independently. On success, the new user row replaces the display entry (the
list is re-read); the original model row is never rendered again as if it
were the user's content (it now has `status: 'user_corrected'`, filtered per
the table above).

## Data flow

- **Reads**: a new browser service factory,
  `inferredProjectContextFieldBrowserService.ts`, mirrors
  `projectWorkspaceBrowserReadService.ts`'s existing factory shape exactly
  (real Supabase client, `resolveOwnerId` via `client.auth.getUser()`,
  `createInferredProjectContextFieldService`). `InferredContextSection` owns
  its own fetch of `listByProject(projectId)` -- it does not share a fetch
  with `ProjectWorkspacePage`'s own Project Brief read, since the two are
  independent read paths over independent data.
- **Mutations**: `confirm` / `reject` / `correct` each call
  `service.resolve(...)` -- one field, one call, no batching, no optimistic
  write (server truth only, per Phase 2 instructions).
- **Derivation trigger**: a new client module,
  `contextDerivationTriggerClient.ts`, POSTs to
  `${VITE_AGENT_WORKER_URL}/projects/context-derivation` with an
  `Authorization: Bearer <session token>` header sourced from
  `supabase.auth.getSession()` -- the same pattern
  `documentAiService.ts`'s `getAuthHeaders()` already uses for another
  authenticated Worker route.
- **Refresh-after-mutation**: after any resolve action or a completed
  derivation run, `InferredContextSection` re-reads its own field list AND
  invokes a caller-supplied `onContextChanged()` callback so
  `ProjectWorkspacePage`'s own Project Brief/context read re-runs too --
  otherwise a newly confirmed field would not visibly reach `context_ready`
  in the same session. This closes a real, in-scope gap: today
  `projectWorkspaceBrowserReadService.ts`'s `createContextRebuildService`
  call omits the already-existing, already-optional
  `inferredContextFieldRepository` dependency `contextRebuildService.ts`
  has supported since task `3c` -- wiring it in is the "smallest addition
  within this task's scope" the task brief allows (no schema/RPC change; an
  existing optional dependency slot on an existing factory).

## Composition boundary (kept deliberately narrow)

`ProjectWorkspaceView` (the pure, prop-driven, already-tested presentational
component) gains one new **optional** prop, `inferredContextSection?:
ReactNode`, rendered as a plain slot inside the primary column. It performs
no fetching of its own and defaults to rendering nothing, so every existing
`ProjectWorkspacePage.test.tsx` assertion against the fixture-driven view is
unaffected. Only the default-exported, already-live-data-fetching
`ProjectWorkspacePage` route component (which the existing test suite does
not exercise at all -- it only renders `ProjectWorkspaceView` directly)
constructs and passes the real `<InferredContextSection>` element, gated to
`result.status === "ready"` (a real, live project). The fixture/demo page
never mounts it.

## Failure posture

Typed errors are surfaced as their own honest text, not swallowed into a
generic "something went wrong": `NO_ELIGIBLE_EVIDENCE` (422, zero active
evidence) renders as "This project has no evidence yet -- add evidence
before deriving context," pointing at ingestion rather than retrying
silently. `PROJECT_ARCHIVED` (409) disables the derivation trigger with a
visible reason rather than only failing after a click. Every other
transport/service error renders its own message; none are retried
automatically.

## Explicit non-goals (unchanged from the task brief)

No bulk actions, no auto-confirmation, no scheduling, no changes to the
derivation pipeline / RPCs / schema / precedence logic, no localization
(this page has no existing i18n wiring -- `ProjectWorkspacePage.tsx` uses
plain literal strings throughout, unlike `i18n`-wired components such as
`StepApprovalDialog.tsx`; this task follows the page's own existing
convention rather than introducing a new one).
