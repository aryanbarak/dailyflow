# SmartFlow — Project Status

Last rebuilt from git/code evidence: 2026-08-07 (see
[`docs/status/reconciliation-2026-08.md`](docs/status/reconciliation-2026-08.md)
for the full evidence trail behind this rebuild — file-by-file commit
mapping, migration inventory, and a discrepancy table against the prior
version of this document).

## 0. Maintenance rule

**This file is the only status source for SmartFlow.** No other document —
including `docs/roadmap/*`, `docs/architecture/*`, and ADRs — should carry
its own "implemented/not implemented" status narration; they should link
here instead. This file must be regenerated or verified against git/code
reality at the end of every task that changes implementation status, not
narrated forward from memory. Every "Implemented" claim below carries a
commit hash or file path; a claim with neither is not verified and must not
appear here.

## 1. Identity

SmartFlow is Aryan's **Personal Digital Representative** — canonical product
identity per [ADR-0006](docs/decisions/adr/ADR-0006-canonical-product-identity.md)
(Accepted, 2026-08-01). Software Projects / Project Intelligence are the
current proving ground for this identity, not the full permanent identity;
voice, avatar, richer memory, and broader delegated operation remain future
work.

## 2. Verified implemented capabilities

### 2.1 Project Domain (verified in this reconciliation — see the inventory doc for full file/commit detail)

- **`ProjectContext` foundation** — deterministic, read-only, typed domain
  (`src/features/projects/projectContextTypes.ts`, `projectContextBuilder.ts`).
  Committed `6ab3613`.
- **`ProjectRecord`** — durable, owner-editable aggregate (create/read/list/
  update/archive, optimistic concurrency), RLS-protected `project_records`
  table. `src/features/projects/projectRecordService.ts`; migration
  `supabase/migrations/20260801000000_project_records.sql`. Committed `cec2be9`.
- **`ProjectEvidence` + `ProjectEvidenceObservation`** — durable, immutable,
  owner/project-scoped evidence with a mandatory consumable text payload,
  created atomically via the `SECURITY DEFINER` function
  `create_project_evidence_with_observation` (direct client `INSERT` on both
  tables is revoked). `src/features/projects/projectEvidenceService.ts`,
  `projectEvidenceObservationTypes.ts`; migrations
  `20260802000000_project_evidence.sql`, `20260803000000_project_evidence_observations.sql`.
  Committed `9b40a4d` / `fddceb0` / `bc87a60`. Governed by
  [ADR-0007](docs/decisions/adr/ADR-0007-projectevidence-observation-model.md) (Accepted).
- **Repository Documents Adapter** — the first real Evidence Source Adapter:
  reads one allowlisted, in-repo Markdown document at a time, real-path
  containment against symlink escape, SHA-256 content hashing.
  `src/features/projects/repositoryDocumentAdapter.ts`. Committed `bc87a60`.
  **Not wired into any production entry point** — invoked only by the local
  CLI (below); a tested, injectable library only.
- **Context Rebuild Foundation** — deterministic `EvidenceSnapshot`
  construction and `rebuildProjectContext(projectId)`.
  `src/features/projects/evidenceSnapshotBuilder.ts`, `contextRebuildService.ts`.
  Committed `ae2a0d5`. Honestly partial: see §3.
- **Project Brief** — deterministic, evidence-backed extraction of explicit
  labeled facts (phase, focus, milestones, decisions, risks) from
  `PROJECT_STATUS.md`, ADRs, roadmap, architecture, and product-direction
  documents. `src/features/projects/projectBriefService.ts` and five
  extractors. **Committed to `main` in `fa8e923`** (previously narrated
  elsewhere as "uncommitted" — see the reconciliation doc's discrepancy
  table, row 1).
- **Local Project Refresh CLI** — `npm run smartflow:refresh-project -- --project-id <uuid> --repo-root <path> [--json]`.
  `scripts/smartflow-refresh-project.ts`. Committed `8a3f5c5`, stability fix `05d77a1`.
- **Project creation CLI** — `npm run smartflow:create-project`, developer-only.
  `scripts/smartflow-create-project.ts`. Committed `3a96e09`.
- **Live persisted Project Brief read path** — `/projects/:projectId` reads
  an authenticated, owner-scoped `ProjectRecord`, runs Context Rebuild +
  Project Brief against already-persisted evidence.
  `src/pages/ProjectWorkspacePage.tsx`. Committed `8d791c3`, fixes `05d77a1`.
  Demo-only fixture remains at `/projects/demo/smartflow`.
- **Projects discoverability** — `/projects` index page listing the signed-in
  owner's `ProjectRecord`s; Sidebar/MobileNav "Projects" entry.
  `src/pages/ProjectsIndexPage.tsx`, `src/components/layout/Sidebar.tsx`.
  **Committed to `main` in `b16f18f`** (previously narrated elsewhere as
  "uncommitted" — see the reconciliation doc's discrepancy table, row 2).
- **Inferred Project Context Layer v1 (LLM-assisted Context Derivation)** —
  [ADR-0009](docs/decisions/adr/ADR-0009-inferred-project-context-layer.md)
  (Accepted)'s Tier 1 implementation. New `inferred_project_context_fields`/
  `inferred_context_derivation_runs` tables, owner-scoped RLS, all writes
  through two `SECURITY DEFINER` functions (`create_inferred_context_field`,
  `resolve_inferred_context_field`) with race-safe duplicate suppression
  (`get stacked diagnostics`-based, mirroring ADR-0007's own pattern) —
  `supabase/migrations/20260807000000_inferred_project_context_fields.sql`.
  New authenticated Worker route `POST /projects/context-derivation`
  (`agent/worker/context-derivation-endpoint.ts`) reading only persisted
  evidence, calling Gemini with structured output, deterministic
  per-candidate validation (drop-and-log, never coerce). New
  `src/features/projects/contextPrecedenceResolver.ts` enforces ADR-0009's
  precedence rule (evidence-extracted > user_confirmed/corrected > proposed)
  with every collision surfaced via the new `ProjectContext.precedenceConflicts`
  field, never silently resolved. `ProjectContextBuilder`/
  `contextRebuildService.ts` widened to consume inferred fields, producing
  the first-ever real `context_ready` result — see
  `src/features/projects/contextRebuildService.test.ts`'s "produces a REAL,
  non-fabricated ProjectContext" test. Independently reviewed under Tier 1
  (ADR-0008): [`docs/reviews/2026-08-inferred-context-layer-review.md`](docs/reviews/2026-08-inferred-context-layer-review.md)
  (4 MAJOR / 3 MINOR findings, all closed by remediation, re-reviewed —
  verdict "RE-REVIEW PASSED — CLEARED FOR MERGE DECISION").
- **Inference confirm/correct UI in Project Workspace (Tier 2)** — task 4;
  design note
  [`docs/architecture/notes/inference-review-ui-design-note.md`](docs/architecture/notes/inference-review-ui-design-note.md).
  New "Inferred understanding" section in `ProjectWorkspacePage.tsx`
  (`src/features/projects/components/InferredContextSection.tsx`), listing a
  project's `InferredProjectContextField` rows grouped by kind, always
  showing still-`proposed` candidates marked "Inferred -- unconfirmed"
  (ADR-0009 Q2), with per-field Confirm/Correct/Reject actions calling
  `resolve_inferred_context_field` through the existing service/repository
  (never editing a row in place; a correction inserts a new row, exactly as
  the backend already enforced). Client-side correction validation reuses
  the canonical `validateInferredFieldContent` — no duplicated rules. New
  derivation-trigger client
  (`src/features/projects/contextDerivationTriggerClient.ts`) calls
  `POST /projects/context-derivation` with the signed-in user's own session
  token. Also closes a real, in-scope gap found while wiring this up:
  `projectWorkspaceBrowserReadService.ts`'s browser factory had never passed
  the already-optional `inferredContextFieldRepository` dependency into
  `contextRebuildService.ts` (supported since task 3c) — a confirmed field
  could not previously have reached `context_ready` for the live page at
  all. Independent review may follow post-merge per ADR-0008's Tier 2 path.

### 2.2 Everything else — carried forward, not independently re-verified in this task

The claims below are unchanged from the prior version of this document and
were **not** the subject of this reconciliation's evidence work (which was
scoped to the Project Domain). They are believed accurate but should be
treated as due for their own verification pass, not as freshly checked.
`docs/architecture/current-architecture.md` is the maintained canonical
architecture-status reference for all of these and should be read for
current detail rather than this file:

- Deterministic Workspace pipeline (`src/features/workspace/`: signal,
  memory, interaction-feedback, decision-intelligence, personalization,
  priority, goal, planner, approval, workspace engines) — see
  `current-architecture.md` "Workspace Pipeline" and "Implemented Engines."
- Agent reasoning/execution pipeline (LLM proposal → deterministic
  validation → tool resolution → approval → execution → audit → reflection
  → response composition) — see `current-architecture.md` "Agent Pipeline."
- Read-only tools: `tasks.list`, `calendar.list_today`, `learning.get_progress`,
  `workspace.get_context`, `github.repositories.list/issues.list/epics.list/pulls.list/workflow_runs.list`.
- Write tools (verified fresh in this task, see §2.3 below):
  `tasks.complete`, `github.issues.comment`, `github.issues.update`,
  `github.files.update`.
- GitHub Read-only Integration V1 Slice 1 — live in production.
- AI response language resolution (`auto`/`en`/`de`/`fa`) and RTL/LTR handling.
- Unified Execution Intent Lifecycle Foundation Slice 1 (`26f342b`).

### 2.3 Write-tool reality (freshly verified in this task)

`src/features/agent/writeRuntime.ts:43-48` — `SUPPORTED_WRITE_TOOL_IDS` is
`["tasks.complete", "github.issues.comment", "github.issues.update",
"github.files.update"]`. `github.files.update` is **live**, governed by
[ADR-0005](docs/decisions/adr/ADR-0005-code-write-mutation-boundary.md)
(Accepted). `docs/roadmap/project-workspace-implementation-roadmap-v1.md:55`
contained a stale 3-tool claim, now marked historical by that document's own
top-of-file notice; `docs/architecture/current-architecture.md` was already
internally consistent and correct on tool count (§4 of the reconciliation
doc has full evidence).

## 3. Verified NOT implemented

Confirmed from code, not assumed (full detail in the reconciliation doc §6):

- Real `ProjectContext` derivation from evidence — **now partially resolved**
  by the Inferred Project Context Layer (§2.1): `rebuildProjectContext`
  returns a real `context_ready` result when at least one eligible
  `user_confirmed`/`user_corrected`/`proposed` inferred field exists for the
  project; it still returns `snapshot_ready_context_not_derivable` for a
  project with raw evidence text only and no inferred fields yet — no
  deterministic evidence-text-to-structured-fact transformation exists
  independent of the LLM-assisted path, and no semantic document parser is
  implemented.
- An orchestrated Evidence Acquisition Service (multi-adapter selection/coordination).
- Any provider-backed Evidence Source Adapter (GitHub API, Gmail, Calendar).
  Repository Documents Adapter is the only adapter and is document-only.
- An LLM anywhere in the ProjectEvidence or Project Brief path itself — the
  LLM-assisted path (§2.1) writes only to the separate, non-canonical
  `InferredProjectContextField` aggregate, never to `ProjectEvidence`,
  exactly as ADR-0009/`project-domain.md` §6 require.
- Browser-initiated repository refresh, or project creation/edit/archive
  from the browser.
- EPIC-08 Slices 4–5 (read-back verification, pull-request creation) —
  `githubFilesUpdateHandler.ts` checks only that the mutation response
  contains the expected fields; there is no independent re-read/compare.
- EPIC-09 (autonomous chaining, multi-file changes, automatic retry/merge) —
  no commits exist.
- Personal Memory — forward-looking term for future work (§5), not existing
  code.
- Conversation memory, semantic/vector memory, RAG.

## 4. Current blockers / open decisions

- **ProjectContext derivation gap — resolved for the LLM-extraction path.**
  The Inferred Project Context Layer v1 (§2.1) closes this for
  LLM-confirmed/corrected content; a semantic-document-parser path remains
  unbuilt and is not currently planned.
- **OPEN CONDITION: live-Supabase execution of
  `supabase/tests/inferred_project_context_fields.rls.test.ts` pending — run
  at first opportunity.** This gated test suite (skipped by default,
  `SMARTFLOW_RUN_LOCAL_SUPABASE=1`) has not yet been executed against a real
  local Supabase/PostgREST stack — attempted in this task, blocked because a
  sibling project (`ai-automation-agent`) occupies the default Supabase ports
  (54321/54322/54323/54324/54327); not stopped, per policy. The underlying
  `SECURITY DEFINER` function logic this suite exercises has been
  independently verified live twice via a disposable, non-Supabase Postgres
  17 container (raw SQL, including a genuine concurrent-race proof) — only
  the PostgREST/GoTrue integration layer remains unverified live.
- **Adapter execution-location decision** (open): where a repository-document
  adapter physically executes is unresolved
  (`docs/architecture/project-evidence-acquisition.md` §25) — the browser
  cannot read a server-side git checkout; today's adapter only runs via a
  local operator CLI.
- **Several other Slice-4A/4B-era open decisions remain unresolved** (durable
  vs. on-demand evidence storage, atomic vs. per-item acquisition
  acceptance, deletion/tombstone policy, cross-project evidence sharing,
  LLM-assisted evidence promotion) — see
  `docs/architecture/project-evidence-acquisition.md` §25 for the full list;
  none are silently decided.
- **Technical debt carried forward** (unchanged by this task, condensed from
  the prior version — see git history of this file for the original
  detailed writeups if needed):
  - Write execution is intentionally narrow; other registry write
    definitions are contract-only until a handler, policy path, tests, and
    safety review exist.
  - `/chat` has no `responseSchema`; deterministic rescues in
    `validateAgentIntentProposal` are load-bearing, not defensive slack.
  - `/chat` persists the internal reasoning prompt into `agent_chat_messages`
    instead of the user's actual message when used as a reasoning transport.
  - GitHub OAuth callback returns raw JSON instead of redirecting into the app.
  - No `tsc --noEmit` gate exists in either `package.json`; running it
    directly surfaces pre-existing type errors unrelated to recent work.
  - `github_connections.repository_names_cache`/`repository_names_cached_at`
    exist in the migration but not yet in the hand-maintained `types.ts`
    snapshot — next schema change should regenerate rather than add a second
    drift.
  - `agent/worker/context-derivation-endpoint.ts`'s per-kind content
    validation duplicates `inferredProjectContextFieldValidation.ts` (the
    Worker cannot import frontend modules) — kept manually in sync, guarded
    by `contextDerivationValidationEquivalence.test.ts`.
  - `create_inferred_context_field`'s evidence-linkage check is scoped to
    project+owner membership, not to the specific derivation run's own
    evidence snapshot (accepted, documented in the migration — the Worker's
    own candidate filtering already narrows correctly in the one production
    caller today).

## 5. Next agreed work (Product-Owner-approved sequence)

1. ~~Retroactive independent review of ProjectBrief and Project Workspace~~
   — **complete**: [`docs/reviews/2026-08-projectbrief-workspace-review.md`](docs/reviews/2026-08-projectbrief-workspace-review.md)
   (0 blockers, 1 major finding R-1, 3 minor; R-1 fixed in commit `7d63c76`).
2. ~~LLM-assisted Context Derivation v1~~ — **merged/complete.**
   [ADR-0009](docs/decisions/adr/ADR-0009-inferred-project-context-layer.md)
   (Accepted); Tier 1 implementation independently reviewed, remediated, and
   re-reviewed under ADR-0008 —
   [`docs/reviews/2026-08-inferred-context-layer-review.md`](docs/reviews/2026-08-inferred-context-layer-review.md)
   ("RE-REVIEW PASSED — CLEARED FOR MERGE DECISION"). See §2.1.
3. ~~Inference confirm/correct UI in Project Workspace (Tier 2)~~ —
   **merged/complete.** See §2.1. Independent review may follow post-merge
   per ADR-0008's Tier 2 path.
4. **Personal Memory v1 — in progress.**
   [ADR-0010](docs/decisions/adr/ADR-0010-personal-memory-layer.md)
   (Accepted 2026-08-08) defines `PersonalMemoryRecord` (six kinds:
   preference/goal/working_pattern/commitment/personal_fact/skill; health/
   relationships/emotional-state excluded from extraction), mirroring
   ADR-0009's `SECURITY DEFINER`/RLS/state-machine pattern with two
   person-layer differences: a day-one hard-delete erasure path (Q1), and a
   stricter consumption rule (Q5 — `proposed` records have zero
   consumption; only `user_confirmed`/`user_corrected` may influence any
   output). Per Q3, `user_context` writes are frozen (not migrated — the
   existing rows are test data with no value; an "absorb" migration is
   explicitly not planned). Per Q4, the legacy always-on background
   extraction (`ENABLE_AUTO_MEMORY_WRITE`) is replaced by an explicit
   user-trigger-only extraction path. Tier 1 implementation (task `5b`) is
   built and pending independent review before merge — see
   `docs/architecture/notes/personal-memory-v1-design-note.md` for the
   extraction-pipeline sketch and Phase-0 `user_context` inventory this
   ADR is grounded in.

Superseded/completed sprint milestones from the prior version of this
document have been removed rather than carried forward as history; git
history of this file remains the record of what was previously claimed and
when.
