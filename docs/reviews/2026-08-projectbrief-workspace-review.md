# Retroactive Independent Review — ProjectBrief, Project Workspace, Evidence Chain

**Status: DRAFT — uncommitted, for Product Owner reading.** This satisfies
the Tier 2 post-merge independent review that
[ADR-0008](../decisions/adr/ADR-0008-tiered-change-governance.md) calls for,
for the work identified in
[`docs/status/reconciliation-2026-08.md`](../status/reconciliation-2026-08.md)
as merged without it.

Reviewer: Claude Code, acting as independent reviewer (did not author the
code under review). Strictly read-only — no code, test, or migration was
modified while producing this report.

Date: 2026-08-07.

---

## Scope

Commits in scope (as instructed): `fa8e923`, `8d791c3`, `05d77a1`, `5a8d000`,
`3a96e09`, `b16f18f`.

Directly related earlier commits reviewed for context, since the
in-scope commits build on them and cannot be assessed in isolation:
`6ab3613` (`ProjectContext` foundation), `ae14be6` (`project-domain.md`),
`cec2be9` (`ProjectRecord`), `a8a462b` (evidence-acquisition architecture),
`9b40a4d` (`ProjectEvidence` foundation), `fddceb0`/`bc87a60` (ADR-0007
Observation Foundation + Repository Documents Adapter), `ae2a0d5` (Context
Rebuild Foundation).

Files read in full: `projectBriefService.ts`, `contextRebuildService.ts`,
`projectRecordRepository.ts`, `projectEvidenceRepository.ts`,
`projectEvidenceService.ts`, `localProjectRefreshService.ts`,
`scripts/smartflow-refresh-project.ts`, `scripts/smartflow-create-project.ts`,
`repositoryDocumentAdapter.ts`, `repositoryDocumentPathSecurity.ts`,
`repositoryDocumentFileReader.ts`, `projectWorkspaceReadService.ts`,
`projectWorkspaceBrowserReadService.ts`, `projectRecordBrowserReadService.ts`,
`supabaseConfig.ts`, `20260801000000_project_records.sql`,
`20260802000000_project_evidence.sql`,
`20260803000000_project_evidence_observations.sql`, plus targeted reads of
`ProjectWorkspacePage.tsx`, `ProjectsIndexPage.tsx`, `projectBriefAssembler.ts`,
`projectBriefAssembler.test.ts`, and grep-driven sweeps of the full
`src/features/projects/` directory for LLM imports, service-role usage, and
ownership-filter patterns.

**Explicitly NOT reviewed in this pass:**
- The five Project Brief extractor implementations
  (`projectBriefAdrExtractor.ts`, `projectBriefRoadmapExtractor.ts`,
  `projectBriefArchitectureExtractor.ts`,
  `projectBriefProductDirectionExtractor.ts`,
  `projectBriefProjectStatusExtractor.ts`) and
  `projectBriefMarkdownSections.ts` line-by-line — spot-checked via their
  file-header claims, tests, and the assembler's consumption of their output,
  not read in full. Their claimed behavior (bounded heading/label parsing,
  no free-form Markdown interpretation) is plausible from the assembler
  contract and tests but not independently traced statement-by-statement.
- `evidenceSnapshotBuilder.ts` and `contextRebuildProjectContextInput.ts` —
  read in the prior reconciliation task, not re-read line-by-line in this
  pass; relied on `contextRebuildService.ts`'s consumption of them plus
  their own file-header claims.
- `ProjectWorkspacePage.tsx` and `ProjectsIndexPage.tsx` — read selectively
  (data-fetch wiring, ownership-relevant render branches, the refresh-count
  labeling), not every line of these large presentation files.
- Full CI/build tooling, `agent/worker/*`, and anything outside
  `src/features/projects/`, `src/pages/Project*`, `scripts/smartflow-*`, and
  the three Project Domain migrations.
- Live execution against a real Supabase instance — RLS behavior was
  verified by reading the SQL, not by running it (see Finding R-3, and
  §F below).

## Method

For each checklist area (A–G in the task), read the actual implementation
and, where relevant, the actual migration SQL — not the implementer's own
comments or `PROJECT_STATUS.md`'s claims, which are treated as claims to
verify, not evidence. Every finding below cites `file:line`. Comments in the
code that assert a property (e.g. "never accepts an owner id from the
caller") were verified against the code around them, not taken at face
value — in several cases this review traced the call chain from browser/CLI
entry point down to the SQL to confirm the claim.

---

## Findings

| ID | Severity | File:Line | Description |
|---|---|---|---|
| R-1 | MAJOR | `scripts/smartflow-refresh-project.ts:101-102`, `scripts/smartflow-create-project.ts:146,148` | Neither local-write CLI has a local-vs-production safety gate. Both read `SMARTFLOW_SUPABASE_URL`/`SMARTFLOW_LOCAL_SUPABASE_URL` directly via `readRequiredEnv` and connect with whatever URL is present, with no check on whether that URL is a loopback/local address. Contrast `src/integrations/supabase/supabaseConfig.ts:42-89`, which requires an explicit `VITE_SMARTFLOW_SUPABASE_MODE` in dev and restricts local-QA mode to a strict loopback-only URL (`isLocalSupabaseUrl`, lines 15-32) — the exact discipline `2646f4b` ("fix(supabase): require explicit dev mode") established for the browser client. A developer who has `SMARTFLOW_SUPABASE_URL` set to production in their shell (plausible, since other tooling may use that variable name) would silently write real `ProjectRecord`/`ProjectEvidence` rows to production under their own real identity when running either CLI locally, with no confirmation prompt. |
| R-2 | MINOR | `src/pages/ProjectWorkspacePage.tsx:534-551` (`liveRefreshFor`), `src/features/projects/projectWorkspaceFixture.ts:4-29` (`ProjectWorkspaceRefreshStatus`) | The shared `createdCount`/`unchangedCount`/`failedCount` fields carry two different meanings depending on caller: for an actual local-refresh CLI run they mean documents created/unchanged/failed; for the live-read path (`liveRefreshFor`), they are repurposed to mean `includedEvidenceCount`/`excludedSupersededEvidenceCount`/`0`. Correctness of the displayed labels today depends entirely on the render component's `sample` branch choosing the right label text (`ProjectWorkspacePage.tsx:416,420`, tested and currently correct — see `ProjectWorkspacePage.test.tsx:97-98,131-134`). The type itself does not encode this distinction, so a future edit to the rendering component that drops or miscopies the `sample` conditional could silently mislabel live snapshot data ("3 unchanged") as if a refresh had actually run and found no changes. Not exploitable, not a security issue — a maintainability/naming risk. |
| R-3 | MINOR | `supabase/tests/project_evidence.rls.test.ts:16-17`, `supabase/tests/project_records.rls.test.ts:9-10` | RLS enforcement itself is only exercised by tests gated behind `SMARTFLOW_RUN_LOCAL_SUPABASE=1` (`describe.skip` otherwise), which is not set in the default `npm test` run this review's baseline used (1579 passed / 32 skipped). The application-layer ownership filters (`.eq("user_id", ownerId)`) are unit-tested against a mocked query builder (e.g. `projectRecordRepository.test.ts:127,154,165,180,236`), proving the *code constructs* the right filtered query, but the actual Postgres-enforced cross-owner denial is not exercised by the standard regression suite — only by a live Supabase instance that must be manually started. This is consistent with this codebase's existing convention for every other RLS-backed table (not unique to this feature), and is transparently disclosed in `PROJECT_STATUS.md`, not hidden — noted here per the task's explicit instruction to record test-coverage gaps. |
| R-4 | MINOR | `src/features/projects/repositoryDocumentAdapter.ts:225-236` | The adapter's own pre-check for "unchanged" content compares against only the single most-recently-`collectedAt` prior evidence row for the same `sourceKind`/`reference` (`.sort(...)[0]`). This is explicitly documented as an optimization only, with the atomic RPC's content-hash fingerprint as the actual correctness guarantee (comment at lines 209-224, and this is independently confirmed true by reading the migration's `unique_violation` handler) — so this is not a correctness defect, only worth noting that the in-memory pre-check itself does no ownership/project re-validation beyond what already happened earlier in the same call (it operates on `evidenceService.listByProject(projectId)`'s already-scoped result) — confirmed safe, listed here only because the review checklist asked for CLI/adapter allowlist-discipline observations and this is the only place duplicate-detection logic lives outside the RPC. |

No BLOCKER-severity finding. No evidence of an active, exploitable exposure
of production data or secrets was found — R-1 is a real gap but requires a
developer's own environment to already be misconfigured; it is not
remotely triggerable and does not use elevated (service-role) credentials.

## Conformance inventory

| Canonical rule | Area | Verdict |
|---|---|---|
| ADR-0007: atomic evidence+observation creation, no orphan row possible | `20260803000000_project_evidence_observations.sql:219-327` (single Postgres transaction; any failure after the evidence INSERT rolls back the whole function call) | CONFORMS |
| ADR-0007: `SECURITY DEFINER` function pins `search_path` and resolves owner from `auth.uid()`, never a parameter | `20260803000000_project_evidence_observations.sql:159-160,176` | CONFORMS |
| ADR-0007: duplicate identity is content-hash-based, not `collectedAt`-based | `projectEvidenceRepository.ts:142-171` (`computeCandidateFingerprint` excludes `collectedAt`); test proof at `projectEvidenceRepository.test.ts:168-181` | CONFORMS |
| ADR-0007: no update path on `ProjectEvidence`/`ProjectEvidenceObservation` | `projectEvidenceRepository.ts` interface (lines 183-192, no `update` method); migration grants (no `update`/`insert` for `authenticated` outside the RPC) | CONFORMS |
| ADR-0007: supersession via `supersedesId`, not a mutable status column | `projectEvidenceService.ts:140-161`; schema has no status/superseded column on `project_evidence` | CONFORMS |
| `project-domain.md` §8/§10: Context Rebuild reads only persisted evidence, never a live source or provider | `contextRebuildService.ts:1-16` (boundary comment) and full method body (lines 135-235) — no adapter/fs/network import anywhere in the file | CONFORMS |
| `project-domain.md` §10: Workspace UI does not derive canonical facts or mutate `ProjectContext` | `ProjectWorkspacePage.tsx:553-567` (`modelFromReadyResult` is a pure passthrough mapping) | CONFORMS |
| `project-evidence-acquisition.md` §16/§21: adapter allowlist is a fixed, explicit map, least-privilege | `repositoryDocumentPathSecurity.ts:66-73` (six fixed entries, no recursive scan) | CONFORMS |
| `project-evidence-acquisition.md` §21: path traversal / symlink escape rejected via real-path containment, not string-prefix | `repositoryDocumentFileReader.ts:61-80` | CONFORMS |
| No LLM anywhere in the evidence/brief/workspace path | Grep sweep of `src/features/projects/` for LLM/worker/Gemini imports — none found (only negative-claim comments and boundary tests) | CONFORMS |
| Determinism: identical evidence input produces an identical `ProjectBrief` | `projectBriefAssembler.test.ts:60` (explicit test), and `projectBriefAssembler.ts` has no `Date.now()`/`Math.random()` call | CONFORMS |
| Five brief fields (limitations, technicalDebt, nonGoals, deferredItems, outOfScope) remain distinct through to the UI | `ProjectWorkspacePage.tsx:375-380` (five separate `ItemList` renders, five separate `brief.<field>` reads) | CONFORMS |
| Non-disclosure: "not found" and "owned by someone else" are indistinguishable | `projectRecordRepository.ts:124-136` (single `.eq("id",...).eq("user_id",...)` query, `null` either way); `contextRebuildService.ts:150-155`; RPC lines 185-193 | CONFORMS |
| CLI resolves owner from a real authenticated session, never accepts one as an argument, never uses service-role | `scripts/smartflow-refresh-project.ts:119-127`, `scripts/smartflow-create-project.ts:161-169` (`anonKey` + user `accessToken`, `client.auth.getUser(accessToken)`) | CONFORMS |
| CLI local-vs-production safety gate matching `supabaseConfig.ts`'s discipline | — | **FINDING R-1** |

## Test-coverage gaps

- **R-3 above**: RLS/cross-owner denial is proven only by gated, manually-run
  live-Supabase tests, not the default suite.
- No test found that exercises the CLI's env-var resolution against a
  production-shaped URL to confirm it is (or isn't) accepted — consistent
  with there being no gate to test (R-1).
- The five Project Brief extractors were not individually traced in this
  review (see "Explicitly NOT reviewed" above); their own test files exist
  and were not read for completeness in this pass — a gap in this review's
  depth, not a confirmed gap in the code's own test coverage.
- No dedicated test found asserting that `ProjectWorkspaceRefreshStatus`'s
  reused count fields cannot be mislabeled if the `sample` branch is later
  removed (R-2) — the current tests assert today's correct output, not the
  coupling that makes it fragile.

## CLI / service-role exposure assessment

**No service-role usage found anywhere in `src/features/projects/` or
`scripts/smartflow-*.ts`.** Both CLIs construct their Supabase client with
the anon key plus a user-supplied bearer access token
(`scripts/smartflow-refresh-project.ts:119-122`,
`scripts/smartflow-create-project.ts:161-164`) and resolve the owner via
`client.auth.getUser(accessToken)` — a real user identity, fully subject to
RLS. No `SERVICE_ROLE`/`SUPABASE_SERVICE` string appears in any tracked file
under these paths (confirmed by repo-wide grep); `.env*` files are
git-ignored and not tracked (confirmed via `git ls-files`).

The real exposure is **not** a credential leak — it is the **absence of a
target-environment safety gate** (R-1): nothing stops either CLI from being
pointed at production by an ordinary misconfigured environment variable, and
unlike the browser client, nothing warns or requires explicit confirmation
when that happens. Given this is a `N=1`, manually-invoked, developer-only
tool today, the practical risk is bounded (self-inflicted data pollution
under the developer's own account, not a cross-user breach), but it is real
and inexpensive to close.

## Verdict

**REVIEW PASSED — NO BLOCKERS**

One MAJOR finding (R-1) and three MINOR findings (R-2, R-3, R-4). No
security invariant, RLS/ownership boundary, or Accepted-ADR rule was found
violated. The ownership/RLS chain (checklist area A) and evidence discipline
(area B) are the two highest-priority areas per the task instructions, and
both are solid: ownership is resolved from a trusted auth boundary at every
layer, RLS policies and the `SECURITY DEFINER` function are correctly
scoped and pin `search_path`, and the content-hash-based duplicate-identity
fix ADR-0007 mandated is verifiably in the code, not just claimed.
