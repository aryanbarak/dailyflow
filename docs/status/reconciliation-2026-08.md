# Reconciliation Inventory — 2026-08

**This is a one-time evidence snapshot, not a canonical living document.**
It was produced to rebuild `PROJECT_STATUS.md` from git/code evidence after
`PROJECT_STATUS.md` and three other documents were found to have drifted out
of sync with the repository (some claiming *less* than main actually
contains, none claiming more). Do not treat this file as current status —
read [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md) for that. This file will
not be updated again; it documents what was true as of the commit at the top
of this reconciliation task (`b16f18f`, 2026-08-06).

---

## 1. `src/features/projects/` — full file inventory

All commits below are on `main`. "Added" is the commit that first introduced
the file (`git log --follow --diff-filter=A`); "Last" is the most recent
commit that touched it as of this snapshot.

| File | Purpose | Added | Last touched |
|---|---|---|---|
| `projectContextTypes.ts` | `ProjectContext`/`ProjectContextInput` domain types — read-only Software Project representation | `6ab3613` | `6ab3613` |
| `projectContextBuilder.ts` | Deterministic builder: validated `ProjectContextInput` → normalized `ProjectContext` | `6ab3613` | `6ab3613` |
| `smartflowProjectContextFixture.ts` | SmartFlow-as-a-project fixture built from explicit structured inputs with source references | `6ab3613` | `6ab3613` |
| `projectRecordTypes.ts` | `ProjectRecord` types — durable, owner-editable aggregate root for project identity/config | `cec2be9` | `cec2be9` |
| `projectRecordValidation.ts` | Pure validation for `ProjectRecord` input | `cec2be9` | `cec2be9` |
| `projectRecordRepository.ts` | Persistence boundary interface + Supabase implementation for `ProjectRecord` | `cec2be9` | `8a3f5c5` |
| `projectRecordService.ts` | Orchestration: trusted-owner resolution, validation, persistence for `ProjectRecord` | `cec2be9` | `8a3f5c5` |
| `projectRecordBrowserReadService.ts` | Browser-side authenticated read wiring for the Projects index page | `b16f18f` | `b16f18f` |
| `projectEvidenceTypes.ts` | `ProjectEvidence` domain types (traceable, provenance-carrying observation) | `9b40a4d` | `bc87a60` |
| `projectEvidenceValidation.ts` | Pure validation for `ProjectEvidence` input (descriptor-based hostile-getter scanning) | `9b40a4d` | `bc87a60` |
| `projectEvidenceRepository.ts` | Persistence boundary interface + Supabase implementation for `ProjectEvidence`/observation pair | `9b40a4d` | `8a3f5c5` |
| `projectEvidenceService.ts` | Orchestration: trusted-owner resolution, validation, atomic evidence+observation create | `9b40a4d` | `8a3f5c5` |
| `projectEvidenceObservationTypes.ts` | `ProjectEvidenceObservation` types — immutable 1:1 payload aggregate (ADR-0007) | `bc87a60` | `bc87a60` |
| `projectEvidenceObservationValidation.ts` | Pure validation for the observation text payload | `bc87a60` | `bc87a60` |
| `repositoryDocumentPathSecurity.ts` | Pure allowlist/path-security rules, no I/O | `bc87a60` | `bc87a60` |
| `repositoryDocumentFileReader.ts` | Only module touching the real filesystem: realpath containment, bounded UTF-8 read, SHA-256 hash | `bc87a60` | `bc87a60` |
| `repositoryDocumentAdapterTypes.ts` | Shared types/typed failures for the Repository Documents Adapter | `bc87a60` | `bc87a60` |
| `repositoryDocumentAdapter.ts` | First real Evidence Source Adapter: reads one allowlisted in-repo Markdown doc → `ProjectEvidence` | `bc87a60` | `8a3f5c5` |
| `evidenceSnapshotTypes.ts` | `EvidenceSnapshot` types — reproducible evidence selection for a project as of a point in time | `ae2a0d5` | `ae2a0d5` |
| `evidenceSnapshotBuilder.ts` | Deterministic snapshot construction (stable ordering, supersession exclusion, SHA-256 identity hash) | `ae2a0d5` | `ae2a0d5` |
| `contextRebuildTypes.ts` | Typed contracts for the Context Rebuild service boundary | `ae2a0d5` | `ae2a0d5` |
| `contextRebuildProjectContextInput.ts` | Pure mapping: `EvidenceSnapshot` → `ProjectContextInput`'s mechanically-derivable fields only | `ae2a0d5` | `ae2a0d5` |
| `contextRebuildService.ts` | `rebuildProjectContext(projectId)` — returns `snapshot_ready_context_not_derivable` for every project today | `ae2a0d5` | `8a3f5c5` |
| `projectBriefTypes.ts` | `ProjectBrief` model types — evidence-backed, provenance-carrying summary | `fa8e923` | `fa8e923` |
| `projectBriefExtractorTypes.ts` | Shared extractor input/output contract | `fa8e923` | `fa8e923` |
| `projectBriefMarkdownSections.ts` | Bounded heading/bullet/labeled-sentence parser (not a general Markdown parser) | `fa8e923` | `fa8e923` |
| `projectBriefProjectStatusExtractor.ts` | Extracts phase/focus/milestones/etc. from a `project_status_document` evidence item | `fa8e923` | `fa8e923` |
| `projectBriefAdrExtractor.ts` | Extracts decision/status/consequences from an `adr` evidence item | `fa8e923` | `fa8e923` |
| `projectBriefRoadmapExtractor.ts` | Extracts deferred/out-of-scope/risks from a `roadmap_document` evidence item | `fa8e923` | `fa8e923` |
| `projectBriefArchitectureExtractor.ts` | Extracts open decisions/non-goals from an `architecture_document` evidence item | `fa8e923` | `fa8e923` |
| `projectBriefProductDirectionExtractor.ts` | Extracts non-goals from a `product_direction_document` evidence item | `fa8e923` | `fa8e923` |
| `projectBriefAssembler.ts` | Assembles extractor output into one validated `ProjectBrief`, deterministic ordering + conflict detection | `fa8e923` | `fa8e923` |
| `projectBriefServiceTypes.ts` | Typed error contract for the Project Brief service boundary | `fa8e923` | `fa8e923` |
| `projectBriefService.ts` | `buildProjectBrief(projectId)` — delegates to Context Rebuild, maps failures | `fa8e923` | `8a3f5c5` |
| `localProjectRefreshService.ts` | Local-operator refresh: repo-root injection, Repository Documents Adapter acquisition, evidence persistence, brief build | `8a3f5c5` | `3a96e09` |
| `projectWorkspaceReadService.ts` | Server/CLI-side orchestration for `/projects/:projectId`'s live read (record → evidence → snapshot → brief) | `8d791c3` | `8d791c3` |
| `projectWorkspaceBrowserReadService.ts` | Browser-side authenticated wiring of `projectWorkspaceReadService.ts` | `8d791c3` | `8d791c3` |
| `projectWorkspaceFixture.ts` | Demo-route fixture data + `ProjectWorkspaceRefreshStatus` type | `5a8d000` | `8d791c3` |
| `index.ts` | Package-level re-exports | `6ab3613` | `8a3f5c5` |

Every file above has a co-located `*.test.ts` file (69 test files total in
this directory as of this snapshot); test files are omitted from the table
above for brevity and follow the same added/last-touched commits as their
implementation file.

## 2. Project-related routes, pages, and CLI tools

| Route/tool | File | Commit(s) |
|---|---|---|
| `/projects` (index) | `src/pages/ProjectsIndexPage.tsx` | Added `b16f18f` |
| `/projects/:projectId` (live workspace) | `src/pages/ProjectWorkspacePage.tsx` | Added `5a8d000`; live persisted read wired `8d791c3`; stability fixes `05d77a1`; discoverability/usability pass `b16f18f` |
| `/projects/demo/smartflow` (explicit demo fixture route) | `src/pages/ProjectWorkspacePage.tsx` (`DemoProjectWorkspacePage`) | `5a8d000` |
| Sidebar/MobileNav "Projects" entry | `src/components/layout/Sidebar.tsx`, `src/components/layout/MobileNav.tsx` | `b16f18f` |
| `npm run smartflow:refresh-project -- --project-id <uuid> --repo-root <path> [--json]` | `scripts/smartflow-refresh-project.ts` | Added `8a3f5c5`; fix `05d77a1` |
| `npm run smartflow:create-project` | `scripts/smartflow-create-project.ts` | Added `3a96e09` (developer-only `ProjectRecord`-creation CLI) |

Confirmed from `src/App.tsx` (routes at lines 140–142): exactly these three
project routes exist. No other project-related page or route exists in
`src/pages/`.

## 3. Project Domain migrations

| Migration | Table(s) | RLS posture |
|---|---|---|
| `20260801000000_project_records.sql` | `project_records` | RLS enabled; owner-scoped `SELECT`/`INSERT`/`UPDATE` policies keyed on `auth.uid() = user_id`; no `DELETE` policy (archive-only lifecycle, no hard delete) |
| `20260802000000_project_evidence.sql` | `project_evidence` | RLS enabled; owner-scoped `SELECT`/`INSERT` policies; no `UPDATE`/`DELETE` policy (append-only; a correction is a new row via `supersedesId`) |
| `20260803000000_project_evidence_observations.sql` | `project_evidence_observations` | RLS enabled; owner-scoped `SELECT` policy only — direct client `INSERT` on this table **and** on `project_evidence` is revoked; the only write path for both tables is the `SECURITY DEFINER` function `create_project_evidence_with_observation`, which re-implements every ownership/project/archive/enabled-kind/supersession check itself rather than relying on RLS for inserts |

No other migration under `supabase/migrations/` references the Project
Domain.

## 4. Write-tool reality: `SUPPORTED_WRITE_TOOL_IDS` / `github.files.update`

**Verified answer: `github.files.update` is live today.**

`src/features/agent/writeRuntime.ts:43-48`:

```ts
export const SUPPORTED_WRITE_TOOL_IDS = Object.freeze([
  "tasks.complete",
  "github.issues.comment",
  "github.issues.update",
  "github.files.update",
] as const);
```

This is registered end to end: `src/features/agent/handlers/githubFilesUpdateHandler.ts`
implements the handler, `src/features/agent/tools/githubTools.ts` registers
the tool definition, and `docs/decisions/adr/ADR-0005-code-write-mutation-boundary.md`
is the Accepted ADR that authorized it (its own Consequences section had
said it "must not be added ... until the approval-recording route, the
mutation route, and the write handler all exist and are tested" — that
condition is now met; `agent_code_proposal_approvals`
(`supabase/migrations/20260728000000_agent_code_proposal_approvals.sql`)
exists and is wired into `codeProposalApprovalRecording.ts`).

`docs/architecture/current-architecture.md` is internally consistent and
already correct on this point — its "Agent Pipeline" section (lines
129–130), "Write executable tools" section (lines 511–520), and
"Implemented vs Planned Matrix" (line 654, "GitHub bounded file update |
Implemented") all correctly list `github.files.update`; no edit was needed
there for tool count. `docs/roadmap/project-workspace-implementation-roadmap-v1.md:55`
(its own "Current Implementation State" table, unrelated to
current-architecture.md) is the one place with the stale 3-tool claim —
covered by this task's roadmap-wide historical-status notice (§3 below)
rather than a line edit, since Step 3 of this task scoped roadmap-doc
changes to the top-of-file notice and the `*Status note*` markers, not
individual table-cell corrections. `PROJECT_STATUS.md` (§6, "Supported
write executable tools") already correctly lists all four tools.

**Not yet implemented (EPIC-08 Slices 4–5, confirmed from code):**
`githubFilesUpdateHandler.ts:112-113` only checks that the mutation
response itself contains `commitSha`/`blobSha`/`branch`/`commitUrl` — there
is no independent read-back call that re-fetches the file/commit and
compares digests, which is what EPIC-08 Slice 4 ("Read-Back Verification and
Evidence") specifies. No pull-request creation exists (Slice 5). No commit
in `git log` references either slice. EPIC-09 (autonomous chaining,
multi-file changes, automatic retry/merge) has no commits at all and is
correctly recorded as deferred everywhere it is mentioned.

## 5. Discrepancy table

Every row is a claim that contradicted git/code reality at the start of
this task. "Direction" shows whether the document under-claimed (said less
than main has) or over-claimed (said more than main has) relative to
reality.

| # | Document | Claim | Reality | Evidence | Direction |
|---|---|---|---|---|---|
| 1 | `PROJECT_STATUS.md` (pre-rebuild) §2 | "Project Brief Foundation is now implemented, uncommitted" / "pending independent review" | `projectBriefService.ts` and its extractors were committed in `fa8e923` (2026-08-04T00:40:11+02:00) and are on `main` | `git log fa8e923`; `git branch --contains fa8e923` includes `main` | Under-claims (main has more than the doc admits) |
| 2 | `PROJECT_STATUS.md` (pre-rebuild) §2 | "Sprint 1 Deliverable 4 ... is implemented, uncommitted" (Projects discoverability/index page) | Committed in `b16f18f` and merged to `main`, and integrated into a live route (`/projects`) and Sidebar entry | `git log b16f18f`; `src/App.tsx:140` | Under-claims |
| 3 | `docs/roadmap/project-workspace-implementation-roadmap-v1.md:55` | `SUPPORTED_WRITE_TOOL_IDS` "currently covers `tasks.complete`, `github.issues.comment`, `github.issues.update`" (3 tools) | 4 tools, including `github.files.update` | `src/features/agent/writeRuntime.ts:43-48`; `docs/architecture/current-architecture.md` lines 129-130/511-520/654 already correctly list 4 | Under-claims |
| 4 | `docs/architecture/current-architecture.md:639` | "The architecture currently has no complete target-architecture document." | `docs/architecture/target-architecture.md` exists, created in `970852d`, which landed *before* `current-architecture.md`'s own last edit (`1b8030e`) in the same documentation sequence | `git log --oneline --reverse 970852d~1..1b8030e`; same document's own matrix row "Target architecture \| Implemented" (line 657) | Under-claims (self-contradiction within the same document) |
| 6 | `docs/architecture/project-evidence-acquisition.md` §24 ("Current Implementation Status") | "Not implemented: `ProjectEvidence` persistence of any kind; an acquisition service; any Evidence Source Adapter; any actual source reading; evidence snapshots; Context Rebuild; any provider-backed evidence..." | `ProjectEvidence` persistence (`9b40a4d`), the Repository Documents Adapter (`bc87a60`, a real Evidence Source Adapter that performs actual source reading), evidence snapshots (`ae2a0d5`), and Context Rebuild (`ae2a0d5`) are all implemented, independently reviewed, and committed to `main` | `git log 9b40a4d bc87a60 ae2a0d5`; `src/features/projects/*` | Under-claims — this is the single largest drift found: §24's "Implemented today" list also omits all of the above |
| 7 | Coordinator-reported prior claim (not found verbatim in current `PROJECT_STATUS.md`, but consistent with the pattern above) | ProjectBrief "implemented, uncommitted, pending independent review" | Merged to `main` (`fa8e923`) and integrated into a live `/projects` UI (`8d791c3`, `05d77a1`, `5a8d000`, `b16f18f`) | Same as #1 | Under-claims |

No row found where a document claimed **more** capability than the code
actually has (no over-claiming discrepancy exists in the four documents
checked). This matters for Step 4 of this task: the tiered-governance ADR
is motivated by a process-bypass risk (work merging without the review the
process called for), not by a truthfulness problem in the eventual status
text — `PROJECT_STATUS.md` itself was scrupulously honest about
review/commit state at the moment each entry was written; it simply was
never updated again after the fact, which is a staleness problem, not a
fabrication problem.

## 6. What remains genuinely NOT implemented (verified from code)

Confirmed, not assumed:

- **Real `ProjectContext` derivation from evidence** — `contextRebuildService.ts`'s
  `rebuildProjectContext` returns `{ status: "snapshot_ready_context_not_derivable" }`
  for every project; `canDeriveProjectContextFromSnapshot` is the single
  gate and is not satisfied by any current code path. Confirmed by reading
  `contextRebuildService.ts` and its test file — the `context_ready` branch
  is only exercised in tests via an injected fake gate, never by production
  wiring.
- **An orchestrated Evidence Acquisition Service** — no module in
  `src/features/projects/` selects among or coordinates multiple Evidence
  Source Adapters. `repositoryDocumentAdapter.ts` is invoked directly and
  individually by `localProjectRefreshService.ts`; there is no adapter
  registry or selection logic.
- **Provider-backed adapters** — `repositoryDocumentAdapter.ts` is the only
  Evidence Source Adapter that exists. No GitHub-API-backed, Gmail-backed,
  or Calendar-backed adapter exists anywhere in `src/features/projects/`.
- **LLM anywhere in the evidence/brief path** — confirmed by reading every
  file in section 1's table: none imports a Gemini/LLM client or any module
  under `agent/worker/`. `projectBriefMarkdownSections.ts` is an explicit
  heading/label parser, not a semantic parser.
- **EPIC-08 remaining slices (4–5)** — confirmed in section 4 above:
  read-back verification and PR creation do not exist.
- **EPIC-09** — no commits, no code, confirmed via `git log --all` search
  for EPIC-09-related branches/commits (none found).
- **Repository Documents Adapter production wiring** — confirmed:
  `repositoryDocumentAdapter.ts` is called only from
  `localProjectRefreshService.ts` (a manual, operator-run CLI path via
  `scripts/smartflow-refresh-project.ts`), never from a browser-reachable
  or scheduled production entry point.
- **Browser-initiated refresh** — `ProjectWorkspacePage.tsx`'s "Reload data"
  action re-runs the existing persisted Supabase read only; it does not
  invoke `localProjectRefreshService.ts` or touch the filesystem.
- **Project creation/editing/archiving from the browser** — `ProjectsIndexPage.tsx`
  and `ProjectWorkspacePage.tsx` contain no create/edit/archive UI; the only
  way to create a `ProjectRecord` today is `scripts/smartflow-create-project.ts`.
- **Personal Memory / LLM-assisted Context Derivation** — no code anywhere
  in the repository implements either; both are forward-looking terms used
  by the Product Owner for sequencing next work, not existing capabilities.

All of the above match what the pre-rebuild `PROJECT_STATUS.md` itself
already claimed as not-implemented — this section found no additional
gaps beyond what section 5's discrepancy table already surfaces, only
confirmation that those claims hold.
