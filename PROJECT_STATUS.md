# SmartFlow - Project Status

Last updated: 2026-08-03

---

## 1. Executive Summary

**Product identity (2026-08-01):** the Product Owner approved **Personal
Digital Representative** as SmartFlow's canonical product identity, recorded
in [ADR-0006: Canonical Product Identity](docs/decisions/adr/ADR-0006-canonical-product-identity.md)
(Accepted). This is compatible with, and does not replace, the long-term
Personal Life Operating System vision already stated in
`docs/product/product-direction-v1.md`. Software Projects / Project
Intelligence remain the current proving ground for this identity, not the
full permanent identity. Digital Co-Founder was evaluated and is explicitly
not the canonical identity. Voice representation, a visual avatar, richer
personal knowledge/memory modelling, decision-pattern modelling,
digital-avatar generation, voice cloning, and broader delegated operation
remain future/planned capabilities only and are not claimed as implemented
today. This was a documentation-only governance update: no code, migration,
UI, or integration changed, and Slice 3 has not begun as part of it.

SmartFlow has moved beyond a static productivity dashboard. It is now an AI
Personal Operating System with a deterministic workspace pipeline, explicit
agent safety boundaries, read-only execution, bounded approval-gated write
execution, reflection, context synthesis, and deterministic response
composition.

The current system remains intentionally bounded. It does not perform
autonomous execution, does not run hidden tool chains, does not let the LLM
approve or execute actions, and does not expose internal policy, audit, memory,
or engine metadata to users.

Software Project Context Foundation (Slice 2A) is complete, committed, and
pushed to `main` (`6ab3613`): a deterministic, typed, read-only domain
foundation (`src/features/projects/`) for representing a Software Project's
identity, objective, milestones, accepted decisions, capability status,
risks, canonical sources, and non-authoritative candidate next actions. This
slice adds no execution authority: it is purely representational, validated
input to normalized output, with no LLM, no tool execution, and no
browser-storage authority anywhere in the pipeline.

Slice 2B (Project Record and Project Context Architecture Consolidation) --
an architecture-only review reconciling Slice 2A's implemented `ProjectContext`
domain with the separate Project Workspace Implementation Roadmap's
not-yet-built "Project entity" -- was reviewed and accepted. No code changed
for Slice 2B.

Slice 2B.1 -- the canonical Project Domain architecture document,
[`docs/architecture/project-domain.md`](docs/architecture/project-domain.md),
defining `ProjectRecord`, `ProjectEvidence`, `ProjectContextBuilder`,
`ProjectContext`, and Project Workspace ownership boundaries and their
separation from the Execution Lifecycle -- is complete, committed, and
pushed to `main` (`ae14be6`).

Slice 3 -- the durable, owner-editable `ProjectRecord` aggregate root -- is
complete, independently reviewed (two confirmed blockers found and fixed:
a concurrency/archive-race gap in the optimistic-concurrency update path,
and an uncaught-exception path from hostile input getters), and committed
and pushed to `main` (`cec2be9`). See §2 for full scope.

Slice 4A -- the canonical
[`docs/architecture/project-evidence-acquisition.md`](docs/architecture/project-evidence-acquisition.md)
architecture document, defining the Evidence Source Adapter boundary,
acquisition-attempt lifecycle, provenance/classification model, and the
boundary to the future Context Rebuild service and to Smart Automation --
is complete, committed, and pushed to `main` (`a8a462b`).

Slice 4B -- ProjectEvidence Foundation: the durable, immutable, owner- and
project-scoped persistence and validation half of the Slice 4A architecture --
is complete, independently reviewed (one confirmed blocker found and fixed:
the INSERT RLS policy's supersession subquery did not validate ownership/
project match, and a follow-up SQL name-resolution defect in the first fix
attempt was itself caught by a second, empirically-verified re-review before
being corrected), and committed to `main` (`9b40a4d`).

An independent review of the (at the time) uncommitted Repository Documents
Adapter found that `ProjectEvidence` persisted identity, provenance, and a
content hash, but no consumable observation payload -- a gap that would leave
a future Context Rebuild with no lawful way to read what was actually
observed, since it may never fetch the original source directly
(`project-evidence-acquisition.md` section 22). The Product Owner approved
the resolution in
[`ADR-0007: ProjectEvidence Observation Model`](docs/decisions/adr/ADR-0007-projectevidence-observation-model.md)
(Accepted).

**ProjectEvidence Observation Foundation (ADR-0007) is complete, independently
reviewed, and committed to `main`** (`fddceb0` docs, `bc87a60` implementation):
a separate, immutable `ProjectEvidenceObservation` aggregate, 1:1 with
`ProjectEvidence`, owning the consumable text payload; `ProjectEvidence`
and its `ProjectEvidenceObservation` are created atomically via a single
`SECURITY DEFINER` Postgres function (`create_project_evidence_with_observation`)
-- direct client `INSERT` on either table is revoked, so no path can create
a "hash-only" evidence row without its observation. Duplicate identity is
based on content hash rather than `collectedAt`, closing the concurrency gap
the independent review found in Slice 4B's original fingerprint formula. The
independent review found two confirmed blockers in the RPC's exception
handling (an unscoped `unique_violation` catch that could have misreported an
unrelated constraint conflict as a benign duplicate, and a conflict-lookup
path that did not fail closed when the colliding row or its observation
could not actually be found) -- both were fixed, verified against a real,
disposable PostgreSQL 17 container (constraint-scoped handling and both
fail-closed paths reproduced directly), and re-reviewed before being
approved and committed. The Repository Documents Adapter is updated to
persist the exact normalized text it reads and to record Git revision in a
structured field instead of free-text `notes`.

**Context Rebuild Foundation is complete, independently reviewed, and
committed to `main` (`ae2a0d5`):** the deterministic evidence-snapshot and
freshness infrastructure named as future work in
`project-evidence-acquisition.md` section 22. It is honestly partial by
design -- see §2 for exactly what it can and cannot produce today, and why.

**Project Brief Foundation is now implemented, uncommitted:** a
deterministic, evidence-backed `ProjectBrief` built entirely from an
already-selected `EvidenceSnapshot` via the existing Context Rebuild
Foundation -- see §2 for the full scope, its five small document extractors,
and what it explicitly does not attempt. Current focus: none of this has
been committed yet. The next step is independent review. Still not begun:
an acquisition service that orchestrates multiple adapters, any
provider-backed adapter, LLM extraction, general Markdown/document
understanding, Project Workspace UI, and Smart Automation.

Unified Execution Intent Lifecycle Foundation Slice 1 is complete, committed,
and pushed to `main` (`26f342b`): canonical execution-intent contracts,
deterministic canonicalization, lifecycle transition helpers, server-owned
exact approval-binding validation, and trusted actor/scope resolution for
`tasks.complete` and GitHub read-only tools are all in place. Lifecycle state
itself remains in-memory and single-process; durable, restart-safe
persistence and distributed concurrency remain deferred (see Technical Debt
and Slice 2A non-goals below).

GitHub Read-only Integration V1 Slice 1 is complete and live in production: a
natural-language GitHub repository request now resolves to the
`inspect_github_repositories` intent, routes through explicit user Run, and
returns a real repository list from the connected GitHub App installation.
Broader integration expansion (additional providers, Gmail, Calendar) remains
deferred.

Documentation focus: SmartFlow documentation structure has been standardized,
the SmartFlow ChatGPT Project has been established, and repository
documentation governance now defines how canonical context, architecture,
roadmap, ADRs, implementation status and assistant knowledge relate to each
other. The canonical current architecture is
`docs/architecture/current-architecture.md`. Future architecture documents
remain planned, not complete.

---

## 2. Current Project Phase

Current phase: Slice 4B -- ProjectEvidence Foundation, building on a
completed deterministic AI Personal Operating System foundation, a
completed trusted execution-intent lifecycle (Slice 1), a completed
Software Project Context Foundation (Slice 2A), an accepted architecture
consolidation review (Slice 2B), the canonical Project Domain architecture
document (Slice 2B.1,
[`docs/architecture/project-domain.md`](docs/architecture/project-domain.md)),
the completed, independently reviewed `ProjectRecord` Foundation (Slice 3),
and the canonical ProjectEvidence Acquisition architecture (Slice 4A,
[`docs/architecture/project-evidence-acquisition.md`](docs/architecture/project-evidence-acquisition.md)).

Slice 2A scope (complete): a deterministic, typed, read-only Software Project
Context domain (`src/features/projects/`) -- `SoftwareProject`,
`ProjectContext`, `ProjectObjective`, `ProjectMilestone`, `ProjectDecision`,
`ProjectCapability`, `ProjectRisk`, `ProjectSource`, and
`CandidateProjectAction` -- plus a deterministic builder
(`buildProjectContext`) that validates structured input and normalizes it
into an immutable, JSON-safe `ProjectContext`. Only the Software Project
project type is implemented; Learning Project and Personal Project remain
named-but-not-implemented per `docs/product/product-direction-v1.md`.

Slice 2B (complete, architecture-only): an independent review reconciling
Slice 2A's implemented `ProjectContext` domain with the separate Project
Workspace Implementation Roadmap's not-yet-built "Project entity," producing
an accepted ownership model (`ProjectRecord` / `ProjectEvidence` /
`ProjectContextBuilder` / `ProjectContext` / Project Workspace / Execution
Lifecycle) with no code changes.

Slice 2B.1 scope (complete): the canonical architecture document
[`docs/architecture/project-domain.md`](docs/architecture/project-domain.md),
defining `ProjectRecord`, `ProjectEvidence`, `ProjectContextBuilder`,
`ProjectContext`, and Project Workspace ownership boundaries. Committed and
pushed to `main` (`ae14be6`).

Non-goals shared by Slice 2A, 2B, and 2B.1 (explicitly not built): persisted
`ProjectRecord`, Project Dashboard or any UI, new navigation, new
GitHub/Gmail/Calendar permissions or write expansion, Smart Automation,
autonomous execution, durable execution persistence, scheduling/retries,
distributed locks or claims, multi-project orchestration, LLM-based context
extraction, automatic document ingestion, embeddings/vector storage, or
conversational memory as canonical truth. None of this work increases
SmartFlow's execution authority in any way.

Slice 3 scope (complete, committed, and pushed to `main` -- `cec2be9`,
after independent review found and confirmed fixed two blockers: a
concurrency/archive-race gap where `updateConfig`'s conditional update did
not require `status = active` alongside `id`/`user_id`/`version`, allowing
an update to race past a concurrent archive; and an uncaught-exception path
where `create()`/`update()` called their validators without guarding
against a throwing/accessor input, letting a hostile getter escape as a raw
untyped error instead of a typed `ProjectRecordError`. Both are fixed with
passing regression tests, and a final re-review confirmed both resolved
with no new blocking findings): the durable, owner-editable `ProjectRecord`
aggregate root defined by
[`docs/architecture/project-domain.md`](docs/architecture/project-domain.md)
section 5 -- `src/features/projects/projectRecordTypes.ts`,
`projectRecordValidation.ts`, `projectRecordRepository.ts`, and
`projectRecordService.ts` -- backed by a new owner-scoped, RLS-protected
`project_records` Supabase table
(`supabase/migrations/20260801000000_project_records.sql`). Supports create,
read, list, update, and archive for the Software Project type only, with
optimistic-concurrency version checks, a closed `active`/`archived`
lifecycle, provider-extensible repository-binding *configuration* (not
connection status or credentials), and evidence-source-kind *configuration*
(not evidence acquisition). The trusted authenticated owner is resolved from
the Supabase Auth session inside the service layer itself, never accepted
from caller input. 82 new tests across six files
(`projectRecordValidation.test.ts`: 23, `projectRecordService.test.ts`: 25,
`projectRecordRepository.test.ts`: 16, `projectRecordBoundaries.test.ts`: 5,
`supabase/tests/project_records.test.ts`: 8,
`supabase/tests/project_records.rls.test.ts`: 5, gated and skipped by default
against a live local Supabase instance, exactly like the existing GitHub RLS
tests) pass locally; the full existing suite (1107 passed, 10 skipped, 1117
total) continues to pass unchanged; `npm run typecheck`, `npm run lint`, and
`npm run build` all pass with no new or regressed issues. Explicitly not built in this slice:
`ProjectContext` rebuild service, `ProjectEvidence` acquisition, Project
Workspace UI, hard delete, record restore/reactivation, GitHub/Gmail/Calendar
expansion, and Smart Automation -- unchanged from the shared non-goals above.
`ProjectRecord` remains outside execution authority: it carries no approval
state, execution intent, runtime result, or provider credential, and no
execution intent yet references a `projectId` anywhere in the codebase.

Slice 4A scope (complete, documentation only, committed and pushed to
`main` -- `a8a462b`): the canonical architecture document
[`docs/architecture/project-evidence-acquisition.md`](docs/architecture/project-evidence-acquisition.md),
defining how `ProjectEvidence` (named but not designed by
`project-domain.md` §6) enters SmartFlow -- the Evidence Source Adapter
boundary, acquisition-attempt lifecycle, provenance/classification model
(explicitly non-ordinal, no "Tier 1/2/3" ranking), immutability and
supersession rules, project isolation, and the boundary to a future
Context Rebuild service and to Smart Automation. `ProjectEvidence` is
recorded as the first domain-specific specialization of a future general
Evidence architecture, not the final cross-domain model. Several positions
in the document (no cross-project evidence sharing, per-adapter-declared
acquisition atomicity, durable append-only storage) are recorded as
Proposed, not yet Product-Owner-ratified canonical decisions -- consistent
with how `project-domain.md` §19 itself records open decisions without
silently resolving them.

Slice 4B scope (complete, independently reviewed, committed to `main` --
`9b40a4d`): the durable, immutable, owner- and project-scoped `ProjectEvidence`
persistence and validation half of the Slice 4A architecture --
`src/features/projects/projectEvidenceTypes.ts`,
`projectEvidenceValidation.ts`, `projectEvidenceRepository.ts`, and
`projectEvidenceService.ts` -- backed by a new owner- and project-scoped,
RLS-protected `project_evidence` Supabase table
(`supabase/migrations/20260802000000_project_evidence.sql`). Supports
create, read-by-id, and list-by-project only; there is no update operation
anywhere in this domain, its validation, its repository, or its service --
a correction or newer observation is always a new record, optionally
linked to the one it replaces via `supersedesId`, which is validated to
exist, belong to the same owner, and belong to the same project (a
cross-project or nonexistent reference is rejected with the identical
error, never distinguishing the two). Every evidence record is validated
via full descriptor-based scanning for accessor/getter properties, cycles,
class instances, and unsafe keys before any field is read -- a direct,
deliberate correction of the narrower validation approach Slice 3 shipped
with, which is what let a hostile getter escape as an uncaught exception
until an independent review caught and fixed it. Source references are
validated per source kind (a path-segment rule for document-like kinds, a
different bounded-string rule for provider-like kinds), not by one
permissive global regex. Accidental duplicate submission of the exact same
evidence candidate is prevented by a SHA-256 fingerprint over the
canonical immutable fields (project, source kind, reference, collection
time, adapter identity/version), enforced by a unique database constraint;
a legitimate re-observation at a different time is never blocked. Evidence
creation is rejected for an archived project and for a source kind not
enabled on the project's configuration; reads remain unrestricted by
project lifecycle state. The trusted authenticated owner is resolved from
the Supabase Auth session inside the service layer itself, exactly like
`projectRecordService.ts`, never accepted from caller input. New tests
covering domain/validation, create, read/list, persistence/RLS, and
execution/acquisition/authority boundaries pass locally
(`npx vitest run src/features/projects/projectEvidence supabase/tests/project_evidence`);
the full existing suite continues to pass unchanged (`npm test`);
`npm run typecheck`, `npm run lint`, and `npm run build` all pass with no
new or regressed issues. Explicitly not built in this slice: any Evidence
Source Adapter, an acquisition service that reads a real source, evidence
snapshot selection, `ProjectContext` rebuild, Project Workspace UI, hard
delete/erasure/tombstoning, scheduling, retries, and Smart Automation --
unchanged from the Slice 4A non-goals. `ProjectEvidence` remains outside
execution authority: it carries no approval state, execution intent,
runtime result, provider credential, or mutable freshness/trust-tier
field, and it never calls `ProjectContextBuilder`, an Evidence Source
Adapter, policy, approval, execution, Smart Automation, or an LLM.

ProjectEvidence Observation Foundation scope (complete, independently
reviewed, committed to `main` --
[`ADR-0007`](docs/decisions/adr/ADR-0007-projectevidence-observation-model.md)):
a new, separate, immutable `project_evidence_observations` table
(`supabase/migrations/20260803000000_project_evidence_observations.sql`),
1:1 with `project_evidence` via a unique `evidence_id` plus a composite
foreign key `(evidence_id, project_id, user_id) references project_evidence
(id, project_id, user_id)` that declaratively pins owner/project consistency
at the schema level, not just in application code. Text payload only in
this implementation: `text_content` (bounded, 512 KiB ceiling matching the
adapter's own read ceiling, `byte_length = octet_length(text_content)`
enforced by a `CHECK` constraint so the two can never diverge), `mime_type`
(closed to `text/markdown`/`text/plain`), `content_hash` (lowercase 64-hex
`CHECK`), and an optional, structured `git_revision` (40-hex `CHECK`,
replacing the prior `notes`-embedded `git-revision:<sha>` convention).
`ProjectEvidence` and its `ProjectEvidenceObservation` are created
atomically by a new `SECURITY DEFINER` Postgres function,
`create_project_evidence_with_observation` -- a single function invocation
is one Postgres transaction, so a failure inserting the observation rolls
back the evidence row too, and vice versa; direct client `INSERT` on both
`project_evidence` and `project_evidence_observations` is now revoked, so
the function is the only path capable of creating either row (no path can
create a "hash-only" evidence row without its observation anymore). The
function replicates every ownership/project/archive/enabled-kind/
supersession check the removed INSERT policies used to perform, resolved
from `auth.uid()` inside the function body, never from a parameter.
Duplicate identity is now based on content hash
(`project`, `sourceKind`, `reference`, `contentHash`, `adapterIdentity`,
`adapterVersion`) instead of `collectedAt` -- a real, if narrow, breaking
change to Slice 4B's original fingerprint formula, made because the
independent review of the Repository Documents Adapter found that formula
let two concurrent acquisitions of byte-identical content both succeed. No
existing row's stored fingerprint value needed to change (old- and
new-formula values coexist safely under the same unique index). This
correction was verified empirically against a disposable PostgreSQL
container built solely for this review (not the project's own Supabase
instance, which remains unavailable in this environment): the transaction's
atomicity, its rollback-on-failure behavior, its graceful
`{ outcome: "unchanged" }` handling of a fingerprint collision, and -- using
two genuinely concurrent client connections -- that identical concurrent
creates produce exactly one `"created"` and one `"unchanged"` outcome and
exactly one stored pair, never two. A follow-up independent review then
found two confirmed blockers in the RPC's `unique_violation` handler: it
treated every unique-constraint violation on the `project_evidence` insert
as the intended fingerprint collision (never checking `GET STACKED
DIAGNOSTICS ... CONSTRAINT_NAME`), and its conflict-lookup path did not fail
closed if the colliding row -- or its paired observation -- could not
actually be found, both of which could have misreported an unrelated
integrity failure as a benign "unchanged" outcome. Both were fixed
(constraint-name scoping plus two explicit fail-closed guards,
`EVIDENCE_CONFLICT_LOOKUP_FAILED` and `EVIDENCE_MISSING_OBSERVATION`) and
re-verified against a second disposable PostgreSQL 17 container: an
unrelated unique conflict now re-raises as a real error, a missing colliding
row now fails closed, a missing paired observation now fails closed, and a
genuine duplicate still returns the complete original pair.
`projectEvidenceService.create(...)`
now returns `{ outcome, evidence, observation }`; `getById`/`listByProject`
return the evidence/observation pair together. New tests covering the
observation domain/validation, atomic persistence semantics (via a fake
repository mirroring the real transaction's observable behavior),
content-hash-based duplicate identity, and updated migration/boundary
statics pass locally (`npx vitest run src/features/projects/projectEvidence
supabase/tests/project_evidence`); the full existing suite continues to
pass (`npm test`); `npm run typecheck`, `npm run lint`, and `npm run build`
all pass with no new or regressed issues. The gated live RLS/RPC test
(`supabase/tests/project_evidence.rls.test.ts`) was rewritten for the new
RPC-based flow but was **not executed** against a live Supabase instance in
this environment -- stated explicitly rather than claimed. Explicitly not
built in this slice: structured JSON payload, object storage, binary/
multimodal evidence, payload erasure/redaction, Context Rebuild, Project
Workspace UI, and Smart Automation -- all remain deferred per `ADR-0007`.

Repository Documents Adapter scope (complete, independently reviewed,
committed to `main`): the first real, credential-free Evidence Source
Adapter (`docs/architecture/project-evidence-acquisition.md` section 8) --
`src/features/projects/repositoryDocumentPathSecurity.ts` (pure,
deterministic allowlist and path-security rules, no I/O),
`repositoryDocumentFileReader.ts` (the only module that touches the real
filesystem: `fs.realpath`-based symlink-containment verification, bounded
UTF-8 reading, SHA-256 content hashing, and an optional local Git-revision
lookup that reads `.git/HEAD` and refs directly rather than shelling out),
`repositoryDocumentAdapterTypes.ts`, and `repositoryDocumentAdapter.ts`
(orchestration via `createRepositoryDocumentAdapter().ingestRepositoryDocument(...)`).
Reads only an explicit, fixed allowlist -- `README.md`, `PROJECT_STATUS.md`,
and any Markdown file under `docs/architecture/`, `docs/decisions/adr/`,
`docs/product/`, or `docs/roadmap/` -- each mapped to exactly one
`ProjectSourceKind`; every other path, extension, or source kind fails
closed, including `.git/`, `node_modules/`, absolute paths, UNC paths,
Windows drive prefixes, backslashes, percent-encoding, and `.`/`..`
segments. The trusted repository root is a required, injected dependency
(`RepositoryRootResolver`) with no default and no production singleton in
this slice -- `project-evidence-acquisition.md` section 25's still-open
question of where a repository-document adapter physically executes is not
resolved here, only given the smallest testable seam. Every acquisition
performs the trusted owner/project/archive/enabled-kind checks (mirroring
`projectEvidenceService.ts`'s own checks) before any filesystem access, then
validates the path, resolves it via real-path containment inside the
repository root (never string-prefix comparison alone), reads bounded UTF-8
content (512 KiB ceiling, never truncated), and now passes the exact
normalized UTF-8 text, its MIME type, and any Git revision to
`projectEvidenceService.create(...)` as the mandatory observation payload
(ADR-0007) -- it never writes through `projectEvidenceRepository.ts`
directly. The adapter's own `listByProject`-based duplicate pre-check
remains only as an optimization; correctness now comes from the atomic
transaction's own content-hash-based fingerprint, including under
concurrent acquisition the pre-check cannot see. Classification is always
`canonical_document_observation`; `title` is deliberately the exact
relative path, never parsed from document content, since this adapter
performs acquisition only and does not interpret meaning. Updated tests
covering the allowlist/path-security rules, the filesystem reader
(temp-directory-backed, including a symlink-escape check), the
orchestration flow (auth/project/archive/enabled-kind ordering,
duplicate/no-change semantics, Git-revision behavior), and execution/UI/
LLM/Smart-Automation/child-process/repository-write boundaries pass locally
(`npx vitest run src/features/projects/repositoryDocument`); the full
existing suite continues to pass unchanged (`npm test`); `npm run
typecheck`, `npm run lint`, and `npm run build` all pass with no new or
regressed issues. Explicitly not built in this slice: an acquisition
service that orchestrates multiple adapters or selects among them, any
provider-backed adapter, evidence snapshot selection, `ProjectContext`
rebuild, Project Workspace UI, GitHub API ingestion, LLM extraction,
embeddings, scheduling, retries, and Smart Automation. This adapter remains
outside execution authority: it never calls `ProjectContextBuilder`, never
writes to the repository, never shells out, and never grants, implies, or
derives execution authority from document content. It is not wired into
any production entry point -- no production code path currently invokes it;
it exists as a tested, injectable library only.

Context Rebuild Foundation scope (complete, independently reviewed,
committed to `main` (`ae2a0d5`) -- `project-evidence-acquisition.md`
section 22):
`src/features/projects/evidenceSnapshotTypes.ts` and
`evidenceSnapshotBuilder.ts` (a deterministic, reproducible
`EvidenceSnapshot` from an already owner/project-scoped
`ProjectEvidence`+`ProjectEvidenceObservation` pair list -- stable sort order
by source kind, then reference, then `collectedAt`, then evidence id as a
final tie-breaker; explicit supersession exclusion that records *why* an
item was excluded rather than silently dropping it; per-item structural
re-validation of the observation payload as defense in depth; and a
deterministic SHA-256 snapshot identity hash over project id, `ProjectRecord`
version, ordered evidence ids/content hashes/supersession references, and a
schema version -- deliberately excluding `collectedAt`, the same
content-identity lesson ADR-0007 already applied to `candidate_fingerprint`),
`contextRebuildTypes.ts` (typed errors and the `RebuildProjectContextResult`
contract), `contextRebuildProjectContextInput.ts` (a pure mapping from a
snapshot to `ProjectContextInput`'s mechanically-derivable fields --
`project` identity and `sources`, both lossless, non-interpretive carries of
already-recorded provenance), and `contextRebuildService.ts`
(`rebuildProjectContext(projectId)`: trusted owner resolution before any
read, one owned *active* `ProjectRecord`, evidence read via the existing
`projectEvidenceRepository`, snapshot construction, then a single explicit
capability gate). **Honest capability finding, not a limitation hidden in
prose:** `ProjectContextBuilder` (`projectContextBuilder.ts`) requires
pre-structured `objectives`, `milestones`, `decisions`, `capabilities`,
`risks`, and `candidateActions` -- each with real semantic fields (`status`,
`summary`/`title`, `sourceIds`) -- not raw text. Every evidence classification
persisted today carries only raw observed text; there is no deterministic
transformation from that text into those structured entities without either
an LLM (forbidden, `project-domain.md` section 6) or a semantic document
parser (not implemented, deliberately -- fragile regex-based Markdown
parsing was rejected as a way to manufacture a claim of completion). This
implementation therefore does not fake a successful rebuild: `evidence`
classification, source kind, and payload text all flow correctly through a
real, tested pipeline, but `rebuildProjectContext` returns
`{ status: "snapshot_ready_context_not_derivable", project, snapshot,
rebuildMetadata, reasonCode, reason }` for every project today, never a
fabricated context with empty `objectives`/`milestones`/etc. presented as if
they had been genuinely evaluated and found absent. The `context_ready` path
(`{ status: "context_ready", project, snapshot, context, rebuildMetadata }`)
is real, not stubbed -- `canDeriveProjectContextFromSnapshot`, the single
explicit gate, is injectable for testing and is proven end to end
(`contextRebuildService.test.ts` exercises the real service method through
it; `contextRebuildProjectContextInput.test.ts` proves the mapper's output
is genuinely accepted by the real `buildProjectContext`, and that a
malformed mapping surfaces as a typed builder validation failure) -- a
future slice that adds a real deterministic evidence-to-fact transformation
changes only that one function. Freshness metadata
(`projectRecordVersion`, `snapshotCreatedAt`, `newestEvidenceCollectedAt`,
`includedEvidenceCount`, `excludedSupersededEvidenceCount`, `snapshotHash`,
`status`) is computed at rebuild time and never persisted or cached. This
slice is read-only end to end: no evidence, observation, or `ProjectRecord`
write of any kind, no filesystem/GitHub/Gmail/Calendar/Slack/LLM/Smart-
Automation import, and `ProjectContext` is never persisted -- every result is
in-memory only. New tests covering snapshot determinism (ordering,
supersession, fail-closed malformed/unsupported-classification handling,
hash identity including the `collectedAt`-exclusion proof), the
mapper/builder integration boundary, the full service contract (auth,
ownership, archived-project rejection, freshness metadata, the honest
not-derivable outcome, and the injected context-ready path), and execution/
UI/LLM/adapter/write boundaries pass locally (`npx vitest run
src/features/projects/evidenceSnapshotBuilder.test.ts
src/features/projects/contextRebuild*`); the full existing suite continues
to pass unchanged (`npm test`); `npm run typecheck`, `npm run lint`, and
`npm run build` all pass with no new or regressed issues. Explicitly not
built in this slice: any actual `ProjectContext` production from real
evidence (blocked on the honest gap above), an acquisition service, any
provider-backed adapter, LLM extraction, a semantic document parser, Project
Brief, Project Workspace UI, `ProjectContext` persistence/caching, and Smart
Automation.

Project Brief Foundation scope (implemented, uncommitted, pending
independent review): the first deterministic, evidence-backed
`ProjectBrief`, built entirely from an already-selected `EvidenceSnapshot`
(via the existing Context Rebuild Foundation -- this slice adds no owner
resolution, project loading, or evidence reading of its own) --
`projectBriefTypes.ts` (the `ProjectBrief` model: `currentPhase`/
`currentFocus` as an explicit known/unknown/conflicted value, evidence-backed
`completedMilestones`/`openDecisions`/`acceptedDecisions`/`knownRisks`,
typed `extractionWarnings`, and `sourceReferences` -- every item carries a
`BriefProvenance`, no item exists without one), `projectBriefMarkdownSections.ts`
(a bounded heading/bullet/labeled-sentence parser -- not a general Markdown
parser: no free-form prose interpretation, no nested-list resolution), five
small, explicit extractors (`projectBriefProjectStatusExtractor.ts`,
`projectBriefAdrExtractor.ts`, `projectBriefRoadmapExtractor.ts`,
`projectBriefArchitectureExtractor.ts`,
`projectBriefProductDirectionExtractor.ts` -- each a pure function of one
evidence-backed document, recognizing only an explicit heading-name
allowlist and a small number of literal labels/markers, e.g. `"Current
phase:"`, `"Next action:"`, `"[in progress]"`), `projectBriefAssembler.ts`
(deterministic ordering never dependent on source array order, single-value
conflict detection for `currentPhase`/`currentFocus` across multiple
evidence items, cross-field conflict detection between a completed
milestone and a same-named deferred/out-of-scope item only, and a
fail-closed `NO_SUPPORTED_CONTENT` result rather than an empty "successful"
brief when no evidence produced anything extractable), and
`projectBriefService.ts` (`buildProjectBrief(projectId)`, delegating owner
resolution and snapshot construction entirely to
`contextRebuildService.rebuildProjectContext`, mapping every failure into a
typed, non-disclosing `ProjectBriefError`).

An independent architecture review found two blockers, both fixed in this
same uncommitted slice: (1) ADR "Consequences" bullets were routed
unconditionally into `explicitNextActions`, treating section membership
alone as proof of an action, when a consequence can be a scope/boundary
statement rather than an action (ADR-0007's own real Consequences section
has exactly this case) -- fixed by adding a distinct `decisionConsequences`
field holding every Consequences bullet verbatim, and narrowing
`explicitNextActions` to only the bullets (in PROJECT_STATUS.md's Next
Sprint section or an ADR's Consequences section) that additionally carry
the literal, per-item `"Next action:"` label; (2) the single `limitations`
field silently merged five distinct source concepts (architecture/product
non-goals, roadmap deferred items, roadmap/architecture out-of-scope items,
and PROJECT_STATUS.md's Technical Debt) that the source documents never
state are equivalent -- fixed by splitting into five distinct fields,
`limitations` (now genuinely narrow: only an explicit "Limitations"/"Known
Limitations" heading, which no currently-committed canonical document
uses yet -- a real, tested capability that is honestly dormant in practice
today), `technicalDebt`, `nonGoals`, `deferredItems`, and `outOfScope`,
each populated only by the one heading name that literally denotes it.
Milestone-conflict detection was narrowed to match: only `deferredItems`
and `outOfScope` are checked against `completedMilestones` for a same-named
contradiction; `nonGoals`, `limitations`, and `technicalDebt` are never
treated as conflict partners, since a scope decision or a technical-debt
note is not a claim about a specific item's completion status.

`repository_document` evidence is unsupported by default in this slice
(ignored with a typed warning), per its own explicit "only where the
format is explicitly supported" rule -- no per-reference allowlisting
(e.g. README.md specifically) is implemented. Explicitly not built: any
general Markdown/document understanding, AI-generated advice or ranking,
semantic risk inference, mission/positioning/proving-ground extraction from
product-direction documents, architecture invariants/ownership-boundary
extraction, Project Workspace UI, `ProjectBrief` persistence or caching,
and background generation. Tests cover the shared markdown-section parser,
each extractor (including malformed/missing/duplicate-heading,
non-accepted/superseded-ADR behavior, and -- per the architecture-review
fix -- that a Consequences boundary statement never becomes a next action
and that non-goals/limitations/technical-debt never become milestone
conflicts), the assembler (contract, determinism, conflict detection,
honesty), the service (trusted delegation, every mapped error code,
no-supported-content, and a full successful build), and execution/UI/
LLM/adapter/write boundaries -- 91 tests across 9 test files, all passing
locally, with the full existing suite (`npm test`) unchanged.

Engineering posture:

- deterministic validation remains authoritative,
- LLM output is proposal-only,
- planning never executes,
- approval is not execution,
- explicit user action is required before runtime execution,
- read-only execution remains the default safe path,
- project context is representational only and is not runtime authority,
- bounded writes are limited to explicitly supported, approval-gated tools,
- runtime results are authoritative during response synthesis,
- Dashboard remains presentation-focused.

---

## 3. Completed Milestones

Completed workspace and UI milestones:

- Living Workspace
- Welcome Workspace
- Living Hero
- Flow AI Right Rail
- Sidebar Orb Identity
- Continue Learning
- Learning Memory
- Smart Academy integration
- Smart Academy ecosystem navigation
- Responsive workspace
- Responsive/mobile layout improvements
- Nested scroll removal

Completed workspace and agent architecture milestones:

- Workspace Engine V1
- Signal Engine V1
- Memory Engine V1
- Workspace Interaction Tracking V1
- Interaction Feedback Engine V1
- Decision Intelligence V1
- Personalization Engine V1
- Priority Engine V1
- Goal Engine V1
- Planner Engine V1
- Approval Model V1
- Approval Interaction Boundary V1
- Tool Registry V1
- Tool Resolver V1
- Execution Policy V1
- Execution Engine V1
- Execution Audit V1
- Read-only Runtime Boundary V1
- Write Runtime Boundary V1
- Reflection Engine V1
- Reflection Integration V1
- Reflection UI V1
- LLM Reasoning Layer V1
- Multilingual reasoning-domain correction
- Response Composer V1
- Context Synthesis V1
- Unified Execution Intent Lifecycle Foundation Slice 1: canonical
  execution-intent contracts, deterministic canonicalization with standard
  SHA-256, lifecycle transition helpers, server-owned exact approval-binding
  validation, defensive authority-record copying/freezing, trusted application
  actor/scope resolution for `tasks.complete` approval and Run, strict
  JSON-compatible canonical value validation, visible approval failure
  handling, duplicate approval-submit interaction coverage, and
  read-runtime lifecycle metadata for `github.repositories.list`
- GitHub Read-only Integration: all four tools (`github.repositories.list`,
  `github.issues.list`, `github.pulls.list`, `github.workflow_runs.list`) live
  in production — natural-language request -> intent -> explicit Run works
  end to end for each
- `/chat` reasoning mode (`mode:"reasoning"`): schema-enforced
  (`responseSchema`, temperature 0), same contract as `/agent/reason`, skips
  the conversational persona and `agent_chat_messages` persistence
- ChatPage's reasoning-routing heuristic (`shouldUseReasoningForMessage`)
  inverted from a domain-keyword allowlist to a denylist + possessive-based
  gate, so a phrasing naming a tool it wasn't explicitly taught no longer
  silently falls through to plain chat
- Tool-level evidence disambiguation is table-driven
  (`TOOL_EVIDENCE_PATTERNS`): one table drives per-domain tool
  disambiguation instead of a one-off function per domain
- Connected GitHub repository inventory now feeds the reasoning prompt
  (`safeContext.githubRepositoryInventory`) so a name that matches a
  connected repo is treated as GitHub evidence even when it could otherwise
  read as a different domain (e.g. a learning topic)
- Multi-candidate disambiguation cards: a genuinely ambiguous request (2-3
  specific read-only intents) can render one validated proposal card per
  candidate instead of a single generic clarification prompt
- Software Project Context Foundation Slice 2A: deterministic, typed,
  read-only `ProjectContext` domain (`src/features/projects/`) -- committed
  and pushed to `main` (`6ab3613`) after independent review confirmed all
  identified blockers (shared-reference input mutation, malformed
  collection-entry crashes, repository path traversal, and a
  getter/setter-accessor crash found during re-review) were resolved with
  passing regression coverage
- Slice 2B — Project Record and Project Context Architecture Consolidation:
  architecture-only review reconciling Slice 2A's `ProjectContext` domain
  with the Project Workspace roadmap's not-yet-built "Project entity";
  accepted ownership model established.
  The canonical Project Domain document is being produced
  as Slice 2B.1 and remains pending architecture review.

Completed validation milestone:

- Agent Response UX Validation V1: authenticated controlled browser integration
  completed with 15/15 PASS rows, and the separate authenticated local
  real-worker reasoning matrix completed with 8/8 PASS rows through real Gemini.

---

## 4. Living Workspace Architecture

The Living Workspace is generated through `src/features/workspace/`.

Current deterministic Workspace pipeline:

```text
useWorkspace()
-> signalEngine()
-> memoryEngine()
-> interactionFeedbackEngine()
-> decisionIntelligenceEngine()
-> personalizationEngine()
-> priorityEngine()
-> goalEngine()
-> plannerEngine()
-> approvalEngine()
-> workspaceEngine()
-> Dashboard
```

Execution Audit remains outside the workspace generation pipeline. It observes
actual execution only.

Decision Intelligence V1 is deterministic, input-only, and read-only. It uses
validated reflection evidence and bounded interaction feedback to produce a
domain-level decision profile. It weakly influences medium/low ordering only,
never overrides urgent signals or onboarding, does not mutate memory, and does
not execute or initiate autonomous behavior.

The Dashboard is primarily a presentation surface for a typed Workspace object.
Workspace decision-making belongs in the workspace engines, not in
`Dashboard.tsx`.

---

## 5. Agent Reasoning and Execution Architecture

Current agent reasoning and execution pipeline:

```text
User Message
-> AI Response Language Resolution
-> LLM Reasoning Layer
-> Structured Intent Proposal
-> Deterministic Intent Validator
-> Tool Resolver
-> Approval Model / Approval Interaction
-> explicit user action
-> Read-only Runtime or Write Runtime
-> Execution Policy
-> Execution Engine / explicit handler
-> Execution Audit
-> Reflection Engine
-> Reflection Integration
-> safe Memory Evidence
-> Context Synthesis
-> Response Composer
-> Chat UI
```

The LLM Reasoning Layer supports these intents:

- `inspect_tasks`
- `inspect_calendar`
- `inspect_learning`
- `inspect_workspace`
- `inspect_github_repositories`
- `inspect_github_issues`
- `inspect_github_pull_requests`
- `inspect_github_workflow_runs`
- `complete_task`
- `ask_clarification`
- `unsupported`

Intent-to-tool mappings:

- `inspect_tasks` -> `tasks.list`
- `inspect_calendar` -> `calendar.list_today`
- `inspect_learning` -> `learning.get_progress`
- `inspect_workspace` -> `workspace.get_context`
- `inspect_github_repositories` -> `github.repositories.list`
- `inspect_github_issues` -> `github.issues.list`
- `inspect_github_pull_requests` -> `github.pulls.list`
- `inspect_github_workflow_runs` -> `github.workflow_runs.list`
- `complete_task` -> `tasks.complete`

`ask_clarification` can carry a `candidates` array in the raw model output when
a message is genuinely ambiguous between 2-3 of the intents above (as opposed
to missing information, which stays a plain clarification with no
candidates). `resolveDisambiguationCandidates` (`intentValidator.ts`)
independently revalidates each raw candidate, dedupes on the resolved
`toolId`, and caps at 3 survivors. The validated result carries these as
`AgentReasoningResult.disambiguationCandidates`, present only for a genuine
multi-way ambiguity — absent for a normal confident proposal, a plain
missing-information clarification, and a disambiguation that collapsed to a
single survivor (returned as a normal top-level result instead).

Security boundary:

- the LLM proposes only,
- deterministic validation always runs,
- the LLM cannot execute,
- the LLM cannot approve,
- the LLM cannot supply authenticated user identity,
- the LLM cannot invent arbitrary executable tools,
- unsupported and mixed requests fail closed,
- ambiguous task targets require clarification,
- read and write actions still require explicit user interaction.

Multilingual domain correction is bounded. Task markers override generic
`today` / `heute` / `امروز` markers. Strong task, calendar, learning,
workspace, and GitHub evidence is bounded; conflicting strong evidence asks
for clarification. This is not a general semantic classifier.

---

## 6. Execution Capabilities

Supported read-only executable tools:

- `tasks.list`
- `calendar.list_today`
- `learning.get_progress`
- `workspace.get_context`
- `github.repositories.list`
- `github.issues.list`
- `github.epics.list`
- `github.pulls.list`
- `github.workflow_runs.list`

Supported write executable tools:

- `tasks.complete`
- `github.issues.comment`
- `github.issues.update`
- `github.files.update`

Write execution guarantees:

- `tasks.complete` routes through the canonical execution-intent lifecycle
  foundation before handler execution. The production approval action
  resolves the authenticated actor from the trusted Supabase auth boundary,
  resolves authoritative scope outside UI authority, canonicalizes the intent,
  evaluates policy, stores immutable authority records, and returns only an
  opaque approval reference before Run is enabled. Run resolves the current
  actor through the same trusted authority boundary, revalidates authoritative
  scope, and requires that pre-existing server-owned exact intent approval
  reference; legacy
  step/tool/target approval remains UI-compatible but is not sufficient to
  execute the pilot.
- Client-facing approval state carries only a display-safe execution-intent
  approval reference for the pilot; authoritative canonical intent and approval
  binding records are held in the in-memory, single-process runtime lifecycle
  registry and are defensively copied/frozen at storage and retrieval
  boundaries. Browser storage no longer owns lifecycle actor authority;
  unsupported, unsafe, or cyclic canonical values fail closed before hashing or
  storage; approval failures remain visible to the user; duplicate approval
  submits are covered by DOM interaction tests; the approval failure mapper no
  longer expands the component module's public API. Durable lifecycle persistence,
  restart-safe claims, distributed concurrency, durable audit, retries,
  scheduling, Gmail expansion, GitHub expansion, Smart Automation, and all-tool
  migration remain deferred.
- Duplicate protection for the pilot is keyed by canonical intent ID before
  handler invocation. A claimed intent is single-attempt for this slice; retry
  requires a newly approved intent.
- exact step, tool, and target approval binding is required,
- approval and execution are separate user actions,
- authenticated user identity is injected by the runtime,
- task completion is state-idempotent and requires post-write verification,
- GitHub issue writes require verified GitHub App access, bounded inputs,
  rate limiting, and `agent_write_log` audit records,
- `github.files.update` is high risk and requires a server-verifiable
  `agent_code_proposal_approvals` record before mutation,
- no automatic retry,
- no chained execution,
- no autonomous execution,
- no registry-only write tool is executable without a registered handler and
  explicit runtime support.

Execution handlers are explicit. They remain framework-independent and must not
import React hooks, UI components, route components, Supabase clients in UI
surfaces, or LLM logic.

---

## 7. AI Language and Response Composition

SmartFlow separates interface language from AI response language.

Supported AI response language values:

- `auto`
- `en`
- `de`
- `fa`

Resolution rules:

- fixed response language wins,
- `auto` follows the latest user message,
- unclear detection falls back safely,
- response RTL/LTR applies to AI response content only,
- interface direction remains independent.

TasksPage AI and Flow AI Chat have been browser-validated in English, German,
and Persian.

Response Composer V1 is a deterministic presentation layer that runs after
verified runtime and reflection output. It supports the current bounded tools,
creates a headline, summary, bounded details, and optional safe suggestion. It
does not call another LLM, does not inspect raw handler payloads, does not alter
runtime results, does not expose policy/audit/request IDs/raw JSON/internal
metadata, and preserves the resolved response language.

Context Synthesis V1 composes bounded meaning before final response rendering:

```text
Verified Runtime Result
+ bounded Workspace snapshot
+ safe Reflection summary
+ bounded Decision profile
-> Context Synthesis
-> Response Composer
-> Chat UI
```

Supported synthesis domains:

- tasks
- calendar
- learning
- workspace
- github

Write execution receives only verified safe response facts and currently no
broad cross-context synthesis.

Context synthesis safeguards:

- runtime result is authoritative,
- contradictions suppress synthesis rather than guessing,
- supporting facts are bounded,
- suggestions are optional and non-executing,
- no personality, emotional, mastery, motivation, importance, or future-action
  inference,
- Decision Intelligence may only produce neutral continuity wording under
  sufficient evidence,
- no raw memory, audit, policy, prompt, private note, document body, user ID, or
  Supabase structure is consumed or exposed.

---

## 8. Validated User-Visible Flows

Validated read-only flow:

```text
Natural-language request
-> interpreted intent card
-> explicit Run
-> verified result
-> reflection
-> optional local memory evidence
-> synthesized and composed natural response
```

Validated write flow:

```text
Exact task-completion request
-> resolved exact task
-> Review
-> Approve
-> no execution yet
-> separate Complete Task action
-> policy
-> idempotent mutation
-> persisted-state verification
-> audit
-> reflection
-> safe response
-> task refresh
```

Guarantees:

- no action runs on render,
- no action runs on approval alone,
- no hidden approve-and-run path exists,
- ambiguous targets are never guessed.

Latest confirmed validation (re-run 2026-07-26; counts below are what that run
actually reported, not carried forward from the prior update):

- GitHub Worker tests (`agent/worker/github-integration.test.ts`): 71 passed
- GitHub migration/type-structure tests
  (`supabase/tests/github_read_only_connections.test.ts`): 4 passed
- GitHub frontend client/UI tests (`src/features/integrations/github/*`, 7
  files): 34 passed
- GitHub focused suite (Worker + migration/type-structure + frontend
  client/UI): 109 passed
- GitHub live local Supabase RLS/lifecycle tests
  (`supabase/tests/github_read_only_connections.rls.test.ts`): 5 exist, gated
  and skipped by default in this run; not independently re-run against a live
  local Supabase stack this session, so "5 passed" there is not re-confirmed
  (see note below)
- Workspace tests (`src/features/workspace/**`, 11 files): 75 passed
  (unchanged from prior update)
- ChatPage tests (`src/pages/ChatPage.test.tsx`): 26 passed
- Full default test suite: 621 passed, 5 skipped, 626 total (54 test files
  passed, 1 skipped)
- Production build: passed (`npm run build` succeeded 2026-07-26)

Not reconfirmed this update — flagged rather than guessed:

- "Agent tests: 262 passed" (prior update): no single command or file-set
  in the repo defines exactly which tests this counted, and reconstructing
  it from directory scope alone produced two different numbers (239 for
  `src/features/agent/**` excluding `reasoning/`, 326 including it), neither
  matching 262. Removed rather than replaced with a guess.
- "TypeScript: passed" / "Worker TypeScript: passed" (prior update): there is
  no `tsc`/typecheck script in `package.json` (root or `agent/worker`) that
  this could refer to. Running `npx tsc --noEmit -p tsconfig.app.json`
  directly surfaces pre-existing errors in `SettingsPage.tsx`,
  `TutorAppPage.tsx`, and `TutorPage.tsx` — unrelated to this session's
  reasoning/disambiguation changes, but not something this update can call
  "passed" without knowing what the original claim was checked against.
  Removed rather than replaced with a guess.

Existing non-failing build warnings:

- large chunk warning
- empty `vendor-pdfjs` chunk warning

Live browser validation completed before the current ARUX matrix:

- TasksPage answers correctly in Persian, German, and English,
- Flow AI correctly resolves baseline task requests in Persian, German, and
  English,
- calendar distinction remains correct,
- explicit execution remains required,
- no false English-only capability response remains.

Current Agent Response UX Validation V1 status:

- deterministic response and intent tests pass,
- bounded authentication smoke passes against local Supabase,
- canonical ARUX evidence exists at
  `docs/testing/evidence/agent-response-ux-validation-v1.json`,
- Controlled Authenticated Browser Integration: `PASS` (15/15 rows),
- ARUX-11 verifies the already-complete task as an idempotent no-op without a
  duplicate mutation,
- ARUX-13 and ARUX-15 preserve Persian RTL flow while isolated Latin content
  computes as LTR,
- ARUX-14 keeps proposal, composed answer, and runtime summary in German,
- the controlled matrix used intercepted deterministic proposals,
- deterministic browser stubs are not treated as proof of real LLM intent
  recognition, worker transport, or real multilingual reasoning behavior,
- the separate local real-worker matrix is `PASS` (8/8), with canonical evidence
  at `docs/testing/evidence/real-worker-arux-matrix-v1.json`,
- every accepted real-worker row used one real Gemini request through local
  `/agent/reason`, local Supabase Auth, deterministic validation, and resolver
  output,
- the real-worker matrix granted no approval, executed no tool, persisted no
  reasoning request, and contacted no production service,
- neither matrix is production deployment validation.

---

## 9. Technical Debt

- Write execution is intentionally narrow: `tasks.complete`, GitHub issue
  comment/update, and bounded GitHub file update are the only supported write
  tools. Other registry write definitions remain contract-only unless a
  handler, policy path, tests, and safety review make them executable.
- Conversation memory is not yet implemented.
- Semantic memory, vector memory, and RAG are not active.
- Right-rail learning/recommendation content still includes static placeholders.
- Some interaction events are only captured where the UI genuinely exposes them.
- Learn AI and chat-related storage still need pruning policies.
- Error tracking is not centralized.
- Supabase generated types now include the GitHub connection tables; future
  schema changes must continue using the canonical generation workflow.
  `github_connections.repository_names_cache` and `repository_names_cached_at`
  (added for reasoning-context repository-inventory disambiguation) are the
  first drift against this: the migration exists, `types.ts` was deliberately
  not hand-patched to add them (the prior hand-patched snapshot caused real
  bugs), so `Database["public"]["Tables"]["github_connections"]` is stale
  until the next canonical regeneration against a migrated database. Neither
  the Worker nor the frontend client currently import that generated shape
  for `github_connections`, so nothing depends on it today, but the next
  schema change should regenerate rather than adding a second undocumented
  drift on top of this one.
- Some older UI strings still need i18n/RTL polish.
- Production build still reports large Vite chunks.
- GitHub Read-only Integration V1 Slice 1 has passed clean local migration
  replay, canonical type refresh, two-user RLS/lifecycle tests, and a local
  authenticated Worker lifecycle smoke. A pre-registration hardening pass found
  and fixed three concrete blockers that the validations above depend on: the
  migration did not grant `service_role` any privilege on either new table
  (the Worker's own connection-lifecycle writes would have failed against a
  real database), the committed `types.ts` was a stale, hand-patched snapshot
  missing dozens of real tables predating this Slice, and five TypeScript
  regressions surfaced once the correct types were restored (a
  `WorkspaceSignalDomain`/`WorkspacePlanDomain` mismatch in two agent files, an
  unnarrowed `GitHubConnectionStatus` access, and two test-mock typing gaps).
  All are now fixed and independently re-verified. GitHub App registration,
  authenticated real-provider QA, and live production validation are complete:
  a natural-language GitHub repository request now resolves to the
  `inspect_github_repositories` intent, routes through explicit user Run, and
  returns a real repository list end to end in production.
- `/chat` has no `responseSchema`; the deterministic rescues in
  `validateAgentIntentProposal` (normalizing an unrecognized `type` via domain
  evidence, defaulting a non-literal `confidence` instead of treating it as
  low) exist *because* nothing at the API level constrains Gemini's `/chat`
  output to the intent schema, unlike the schema-enforced `/agent/reason`
  endpoint. These rescues are load-bearing, not defensive slack: removing them
  would silently break every `/chat`-routed intent proposal whenever Gemini
  drifts from the literal schema in prose, which it does routinely under
  `/chat`'s casual system persona and temperature 0.7.
- `/chat` persists the full reasoning prompt (safe context JSON plus
  instructions) into `agent_chat_messages` when used as a reasoning
  transport, instead of the user's actual message. Any feature that reads
  chat history — session titles, conversation memory, audit, chat export —
  will see the internal prompt text instead of what the user asked, and safe
  context data ends up stored in a table not designed to hold it.
- The GitHub OAuth callback returns raw JSON instead of redirecting back to
  SmartFlow, so a real user completing the GitHub OAuth flow lands on a bare
  JSON response instead of the app, reading as a broken integration and
  requiring manual navigation back.
- `handleSetup` does not read `setup_action`, so the setup phase cannot
  distinguish a fresh install from an update or a pending-approval request.
  `handleCallback`'s `setup_action === "request"` check is the only place
  that distinction is enforced today, and only when the callback is reached
  at all.
- The German task-domain evidence pattern in `intentValidator.ts`
  (`getStrongReadDomainEvidence`) matches bare `offen`/`offene`/`offenen`
  without requiring `Aufgabe` attached, unlike the stricter English task
  phrase requirement. This collides with any German GitHub phrasing that
  also uses "offene" — e.g. `"Zeige meine offenen Issues."` or `"Zeige meine
  offenen Pull-Requests."` — which now also carries github domain evidence,
  so both domains match and the deterministic validator returns
  `ask_clarification` instead of resolving directly, even though the message
  is unambiguous to a human reader. Worked around in tests by dropping
  "offen(e/en)" from German test phrasing rather than fixing the underlying
  regex, since narrowing it is a separate, broader change affecting the
  existing tasks intent, not scoped to the GitHub tools work that surfaced
  it.
- Persian possessive detection in `shouldUseReasoningForMessage`
  (`hasPersianPossessiveMarker`, `ChatPage.tsx`) only matches possession
  marked by "های" + suffix or a suffix after a ZWNJ. A bare enclitic suffix
  with no separator (`کارم`, `دستم`) is deliberately not matched, because
  those same letters are also ordinary word endings and a regex over the
  message text alone cannot tell them apart without a real morphological
  analyzer. This misses informal spoken-register Persian possessives
  (`کارم چیه؟`) — a real, known gap, not a hidden one. If the connected-repo
  inventory approach (see above) extends to give the model real context
  about what entities exist, that is the more promising path to close this,
  not a longer suffix list.
- The local real-worker reasoning validation flow
  (`docs/testing/local-real-worker-reasoning-v1.md`) requires a real Gemini
  credential in `agent/worker/.dev.vars` (git-ignored). Deleting that file and
  rotating/revoking the credential afterward is a manual step the validator
  must remember to do — there is no automated teardown, so a skipped manual
  step leaves a live credential on disk.
- `resolveDisambiguationCandidates`'s toolId-collision dedup (`intentValidator.ts`)
  keeps the first candidate in the model's returned array order. The kept
  candidate's `toolId` and card title/description are deterministic
  (map-derived from `type`, not model text), so which duplicate survives never
  changes what the card says it will do or what tool it runs. Its
  `reasons[0]` sub-text, however, is genuine model output, so on a collision
  the justification text shown can differ between runs depending on which
  duplicate the model happened to list first. Harmless, but noted so it isn't
  rediscovered as a "bug" later.
- There is no typecheck script in either `package.json` (root or
  `agent/worker`) and `npm run build` uses `vite build`, which does not type-
  check the way `tsc --noEmit` does — so no gate in this repo currently
  catches a real type error before it ships. Running
  `npx tsc --noEmit -p tsconfig.app.json` directly surfaces 108 existing
  errors across 40 files today, worst offenders `familyHubService.ts` (15),
  `approvalInteraction.test.ts` (13), `SettingsPage.tsx` (8), and
  `ChatPage.test.tsx` (7). Confirmed pre-existing, not introduced by this
  session: the exact same 108 errors (same file, same message, only shifted
  line numbers from this session's own insertions) were already present at
  `e4c671e`, the commit immediately before this session's changes. These
  errors have been invisible simply because nothing runs the check, not
  because the code is actually sound — the missing gate is the real gap;
  the 108 errors are its symptom.
- The "Agent tests: 262 passed" figure that used to appear in §8 mapped to no
  reproducible command — it was a stale hand-maintained count from a bucket
  definition that no longer exists (reconstructing it from directory scope
  gave two different numbers, neither matching 262). It was dropped rather
  than replaced with a guess. Per-bucket test counts in this doc generally
  aren't reproducible today; either give each one a defining command (a
  named `npm test -- <path>` invocation) or drop it in favor of the
  full-suite total, which `npm test` always reproduces exactly.

---

## 10. Next Sprint

Current next milestone: independent review of **Project Brief
Foundation**. Slice 4B (`ProjectEvidence` domain, validation, repository,
service, `9b40a4d`), ProjectEvidence Observation Foundation (ADR-0007,
`fddceb0`/`bc87a60`), the Repository Documents Adapter, and Context Rebuild
Foundation (`ae2a0d5`) are all complete, independently reviewed, and
committed to `main`. Context Rebuild honestly does not yet produce a real
`ProjectContext` from evidence: `ProjectContextBuilder` requires
pre-structured objectives/milestones/decisions/capabilities/risks/candidate
actions that no deterministic transformation from raw evidence text can
currently produce without an LLM or a semantic document parser -- see §2's
Context Rebuild paragraph for the full honest-capability finding, unchanged
by this slice. Project Brief Foundation is a separate, narrower answer to
that same gap: not a general document-understanding capability, but a
deterministic extraction of explicit, labeled facts from a small set of
canonical document shapes (PROJECT_STATUS.md, ADRs, roadmap, architecture,
and product-direction documents) into a typed, evidence-traceable
`ProjectBrief` -- implemented, **uncommitted**, pending independent review;
see §2's new Project Brief Foundation paragraph. No acquisition service
that orchestrates multiple adapters, no LLM extraction, no general
Markdown/document understanding, and no UI implementation have begun.
Project Dashboard, navigation, and any UI remain the separate Project
Workspace Implementation Roadmap
(`docs/roadmap/project-workspace-implementation-roadmap-v1.md`). Gmail,
GitHub expansion, and Smart Automation remain deferred, unchanged by this
work.

Also outstanding: production proposal-boundary readiness review.
GitHub Read-only Integration V1 Slice 1 is complete and live; remaining
GitHub-related work (OAuth callback redirect, `handleSetup` `setup_action`
handling) is tracked under Technical Debt rather than as a blocking
milestone.

Recommended selection criteria:

- preserve explicit approval and execution boundaries,
- do not expand write tools without a separate safety review,
- keep runtime facts authoritative in final responses,
- keep browser QA mandatory for user-visible agent behavior,
- disclose proposal source and worker transport in every evidence row.
- retain fail-closed local/production configuration separation before any
  deployment validation.

---

## 11. Long-Term Roadmap

Possible future milestones, not implemented:

- manual multi-step plan execution
- conversation memory
- semantic memory
- vector/RAG memory
- additional approved write tools
- calendar write
- task creation
- document/email agent capabilities
- autonomous execution
- live AI-generated recommendations
- real multi-session conversation memory
