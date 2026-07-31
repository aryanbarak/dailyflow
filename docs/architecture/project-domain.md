# SmartFlow Project Domain

Status: Canonical Architecture
Last updated: 2026-07-31
Scope: Project Domain representation and ownership model only

## 1. Purpose

SmartFlow's current product phase uses Software Projects as the primary
proving ground for the complete loop: **Observe -> Understand -> Act ->
Verify** (`docs/product/product-direction-v1.md` §2, §9). Before that loop can
be built out further, SmartFlow needs one canonical, explicit answer to a
question that used to be answered implicitly and inconsistently across code,
roadmap prose, and product documents: what exactly is a "Project," who owns
which fact about it, and where does project representation end and execution
authority begin.

This document exists because two things were true at the same time going into
this milestone: Slice 2A had already implemented a deterministic, typed,
read-only `ProjectContext` domain (`src/features/projects/`), and the
separate Project Workspace Implementation Roadmap had already scoped a
not-yet-built "Project entity" using looser, pre-existing language. Without an
explicit canonical model, the next implementation slice risked building a
second, incompatible Project concept alongside the first one. This document is
that canonical model, produced from the Slice 2B architecture consolidation
review and now recorded as SmartFlow's standing architecture reference for the
Project Domain.

This document defines **project representation and ownership** -- identity,
configuration, evidence, derived context, and presentation. It does **not**
define or grant execution authority. Execution authority remains entirely
governed by [Authority Model](authority-model.md) and
[Execution Intent](execution-intent.md), unchanged by anything in this
document.

## 2. Scope

This document covers:

- project identity,
- project configuration,
- project evidence,
- derived project context,
- project presentation (Project Workspace, at the ownership-boundary level
  only),
- context freshness and rebuild semantics,
- the relationship between the Project Domain and the Execution Lifecycle.

This document explicitly does **not** cover:

- execution policy,
- approval authority,
- runtime execution,
- integration expansion (GitHub, Gmail, Calendar, or any other provider),
- UI design details (layout, components, styling, navigation structure),
- persistence implementation details (schema, migrations, storage engine),
- LLM extraction or reasoning mechanics,
- Smart Automation workflows.

Where this document must reference any of the above to state a boundary (for
example, "execution state lives in the Execution Lifecycle, not here"), it
does so only to draw the boundary, not to design the excluded area.

## 3. Core principles

Project Domain-specific principles, established by this document:

- **Canonical evidence over conversational memory.** A project's understood
  state derives from traceable evidence (documents, verified repository
  observations, verified integration observations), never from conversation
  history treated as fact.
- **Validated state over inferred state.** `ProjectContext` fields are
  produced by deterministic validation and normalization, not by silently
  trusting whatever an evidence source or an LLM asserts.
- **Recommendation is not decision.** A `CandidateProjectAction` is advisory
  only (see §9).
- **Decision is not approval.** A `ProjectDecision` recorded in evidence is a
  project fact, not a grant of execution authority.
- **Approval is not execution.** Unchanged from the existing Authority Model;
  restated here because project-scoped execution requests pass through the
  same rule.
- **Project context is not runtime authority.** `ProjectContext` describes
  what is understood about a project. It never authorizes an action.
- **Derived context is not editable state.** `ProjectContext` cannot be
  hand-edited; the only way to change it is to change its inputs
  (`ProjectRecord` and/or `ProjectEvidence`) and rebuild.
- **Persistence is not authority.** `ProjectRecord` being durable and
  user-editable does not grant it, or anything built from it, execution
  authority. Persistence is a storage property; authority is a permission
  property, and the two are independent, exactly as
  [Authority Model](authority-model.md) already establishes for the system as
  a whole.

Existing SmartFlow security principles, preserved unchanged and restated here
because they apply directly to the Project Domain:

- **Server-owned policy** -- execution policy for any project-scoped action
  remains server/deterministic-code-owned, never Project Domain-owned.
- **Least privilege** -- the Project Domain holds no credentials and no
  execution capability of its own.
- **Fail closed** -- malformed, ambiguous, or conflicting project input or
  evidence must not silently produce a usable `ProjectContext`.
- **Explicit approval** -- unchanged; a project's existence or configuration
  never substitutes for approval of any execution request that targets it.
- **Execution audit** -- unchanged; project-scoped execution is still audited
  exactly as any other execution is, by the Execution Lifecycle, not by the
  Project Domain.
- **Immutable execution intent** -- unchanged; nothing in the Project Domain
  weakens intent immutability once an execution intent references a project.
- **Provider abstraction** -- a project's repository binding names a
  provider-scoped resource but does not itself become a provider client or
  hold provider credentials.

## 4. Terminology

- **Project Domain** -- the architectural area defined by this document:
  `ProjectRecord`, `ProjectEvidence`, `ProjectContextBuilder`, `ProjectContext`,
  and the ownership boundary of Project Workspace. Does not include the
  Execution Lifecycle.
- **Software Project** -- the one Project *type* implemented in the current
  product phase (`product-direction-v1.md` §3), backed by a repository,
  roadmap, and GitHub-tracked work. `Learning Project` and `Personal Project`
  are named future types, not implemented.
- **ProjectRecord** -- the durable, user-editable aggregate root for a
  project's identity and configuration. Defined in §5.
- **ProjectEvidence** -- a traceable, provenance-carrying input into context
  construction. Defined in §6.
- **ProjectContextBuilder** -- the pure, deterministic function that derives
  `ProjectContext` from `ProjectRecord` and `ProjectEvidence`. Defined in §7.
- **ProjectContext** -- the derived, read-only, normalized representation of a
  project at build time. Defined in §8.
- **Project Workspace** -- the presentation and interaction layer that
  displays `ProjectRecord` and `ProjectContext` and submits explicit edits to
  `ProjectRecord`. Defined in §10.
- **CandidateProjectAction** -- a non-authoritative recommendation surfaced
  within `ProjectContext`. Defined in §9.
- **Project execution scope** -- the bounded reference (e.g. a project ID, a
  repository binding) an `ExecutionIntent` may carry to identify which project
  an execution request concerns. Owned by the Execution Lifecycle, not by the
  Project Domain; the Project Domain only supplies the identity being
  referenced.
- **Project lifecycle** -- `ProjectRecord`'s own state (e.g. active,
  archived) -- a configuration field the user edits, distinct in every sense
  from execution lifecycle state.
- **Context freshness** -- whether a given `ProjectContext` is known to have
  been built from the current `ProjectRecord` version and current evidence
  snapshot. Defined in §14.
- **Context rebuild** -- re-running `ProjectContextBuilder` against current
  inputs to produce a new `ProjectContext`, discarding rather than patching
  the prior one. Defined in §13-§14.

**On the term "Project state":** this term MUST NOT be used unqualified
anywhere in SmartFlow documentation or code going forward. It is ambiguous by
construction -- it does not say whether it means durable, user-owned
configuration or ephemeral, derived interpretation. Every future use must
resolve to one of:

- **ProjectRecord state** -- durable identity/configuration, or
- **ProjectContext-derived state** -- ephemeral, derived, read-only
  interpretation.

Existing documents that use "project state" or "project/workspace state"
loosely (for example, `target-architecture.md` §5's layer name) are not
rewritten by this document, but this document's terminology governs new
usage and SHOULD be used to disambiguate those older references when they are
next revised (see §18).

## 5. ProjectRecord

`ProjectRecord` is the durable aggregate root for a project's identity and
configuration.

`ProjectRecord` owns:

- stable project ID,
- project type (e.g. `software_project`),
- project name,
- ownership (which user/account the project belongs to),
- project lifecycle (active, archived),
- repository bindings,
- enabled evidence-source configuration (which sources are allowed to feed
  future context builds),
- editable project metadata,
- explicit user configuration.

`ProjectRecord` must **not** own:

- derived current objective,
- derived milestones,
- accepted decisions extracted from evidence,
- implemented capabilities,
- inferred risks,
- candidate next actions,
- approval state,
- execution state,
- runtime result,
- LLM-generated conclusions.

**`ProjectRecord` is editable. `ProjectContext` is not.** This is the single
most load-bearing distinction in this document: every field in the source-of-
truth matrix (§12) resolves to exactly one of these two owners, and no field
is jointly owned by both.

This document does not prescribe a database schema, storage engine, or
migration for `ProjectRecord`. Persistence strategy is explicitly deferred
(§19, §21).

## 6. ProjectEvidence

`ProjectEvidence` is a traceable input into context construction --
verifiable, provenance-carrying facts about a project, not conclusions about
it.

Conceptual categories of evidence MAY include:

- canonical architecture documents,
- project status documents,
- roadmaps,
- ADRs,
- verified repository observations,
- verified integration observations,
- explicit user-authored project records,
- future validated external evidence.

Rules governing evidence:

- Evidence may disagree. Two evidence items are allowed to imply different
  facts about the same project.
- Evidence is not automatically interpreted truth. An evidence item states
  what a source says; whether and how it becomes part of `ProjectContext` is
  `ProjectContextBuilder`'s job (§7), not the evidence item's own claim.
- Each evidence item must retain provenance (source kind, title, reference,
  and where applicable a retrieval timestamp) -- exactly the shape Slice 2A's
  `ProjectSource` type already carries.
- Conversational memory is not canonical evidence. Chat history, however
  durable, does not qualify as a `ProjectEvidence` item merely by existing.
- LLM output is not canonical evidence unless converted through an explicit
  validated process defined in a future architecture. No such process is
  defined or approved by this document; until one exists, LLM output MUST NOT
  enter `ProjectEvidence`.

This document distinguishes two related but separate concepts that are easy to
conflate:

- **Evidence source configuration** -- which kinds of evidence are enabled
  for a project, and where they should be looked for. This is durable
  configuration and belongs to `ProjectRecord` (§5).
- **Evidence observation or snapshot** -- the actual evidence content
  collected per that configuration at a point in time. This is what
  `ProjectContextBuilder` consumes (§7). Whether observations are persisted
  durably or re-fetched on demand is an open decision (§19), not resolved
  here.

## 7. ProjectContextBuilder

`ProjectContextBuilder` is a pure, deterministic transformation.

Conceptual contract:

```text
ProjectRecord
+
ProjectEvidence
+
explicit build metadata (e.g. injected generation timestamp)
->
ProjectContextBuildResult
```

Required properties:

- pure -- no observable side effects beyond its return value,
- deterministic -- the same inputs always produce the same output,
- fail closed -- malformed or unsafe input produces a typed failure, never a
  thrown exception and never a best-effort partial result,
- no persistence side effects,
- no LLM calls,
- no tool execution,
- no approval issuance,
- no browser authority,
- no provider credentials,
- no hidden global state,
- no random identifiers,
- injected time where required (the builder never reads the system clock
  itself),
- typed validation failures,
- immutable output,
- source traceability (every derived fact should be attributable to the
  evidence that produced it),
- conflict detection (§15).

The current Slice 2A implementation (`buildProjectContext` in
`src/features/projects/projectContextBuilder.ts`) is the concrete foundation
this contract is derived from and is evidence that the contract is
achievable, not a specification frozen at today's exact function signatures,
error codes, or internal helper structure. Future implementation work MAY
extend or refactor the concrete builder as long as every property listed
above continues to hold.

## 8. ProjectContext

`ProjectContext` is:

- derived,
- read-only,
- normalized,
- immutable,
- evidence-backed,
- rebuildable,
- ephemeral by default.

It MAY contain:

- current objective,
- active milestone,
- completed milestones,
- planned or deferred milestones,
- accepted decisions,
- implemented capabilities,
- planned or deferred capabilities,
- known risks,
- canonical source references,
- candidate next actions,
- generation metadata,
- freshness metadata.

It MUST NOT contain:

- credentials,
- provider clients,
- executable handlers,
- approval authority,
- execution state,
- mutable user configuration,
- browser-controlled identity,
- raw conversational memory,
- hidden LLM state.

`ProjectContext` cannot be edited directly. There is no operation that takes a
`ProjectContext` and a change and produces a new `ProjectContext` -- the only
way to change it is to change its inputs (`ProjectRecord` and/or
`ProjectEvidence`) and rebuild via `ProjectContextBuilder` (§13-§14).

## 9. CandidateProjectAction

`CandidateProjectAction` is a recommendation only, appearing as part of
`ProjectContext`'s output.

It must remain structurally and semantically separate from:

- `ProjectDecision` (an accepted or proposed project decision recorded as
  evidence-backed project fact),
- `ExecutionIntent`,
- Approval,
- an execution attempt.

Canonical transition boundary:

```text
CandidateProjectAction
-> explicit user or system selection
-> new execution proposal
-> normal Execution Intent lifecycle (validation, policy, approval, execution, audit)
```

A `CandidateProjectAction` never executes by itself, never gains approval by
being displayed, and never becomes an `ExecutionIntent` automatically. Exactly
as Slice 2A's type already enforces structurally (`kind:
"candidate_action"`, `authority: "non_authoritative"`), nothing in the
Project Domain ever promotes a candidate action into decision or execution
authority.

## 10. Project Workspace

Project Workspace is a presentation and interaction layer over the Project
Domain.

It displays:

```text
ProjectRecord
+
ProjectContext
```

It MAY submit explicit edits to `ProjectRecord` through validated commands.

It MUST NOT:

- mutate `ProjectContext`,
- create execution authority,
- independently derive canonical facts (any derived fact Project Workspace
  shows must trace to `ProjectContext`, not be computed ad hoc in the
  presentation layer).

It MAY display:

- project identity,
- current objective,
- milestones,
- capabilities,
- risks,
- evidence,
- candidate next actions,
- approval and execution information sourced from the separate Execution
  Lifecycle.

Displaying execution or approval state does not make Project Workspace the
owner of that state -- ownership remains with the Execution Lifecycle (§11)
regardless of where the state is rendered. This mirrors the existing
Representative Engine rule that the Experience Layer "MUST NOT turn
presentation state into authority"
([representative-engine.md](representative-engine.md) §6).

## 11. Execution boundary

The Project Domain and the Execution Lifecycle are completely separate.

Project Domain owns:

- project identity,
- project configuration,
- project evidence,
- derived project context.

Execution Lifecycle owns (unchanged from
[Execution Intent](execution-intent.md) and
[Authority Model](authority-model.md)):

- execution proposal,
- canonical execution intent,
- policy decision,
- approval binding,
- execution attempt,
- runtime result,
- audit truth.

Allowed relationship:

```text
ExecutionIntent references projectId or project scope.
```

Forbidden relationships:

```text
ProjectContext authorizes execution.
ProjectRecord stores approval authority.
CandidateProjectAction becomes execution without canonicalization.
Execution result mutates ProjectContext directly.
```

Execution evidence (for example, a verified outcome of a completed,
approved, audited execution) MAY later become new `ProjectEvidence` through a
separate validated process -- for example, an executed and verified GitHub
issue update becoming a future "verified repository observation" evidence
item. That process is not defined or approved as implemented by this
document; it is named here only so it is not silently reinvented later
without acknowledging this boundary (§19, §21).

## 12. Source-of-truth matrix

| Field | Canonical owner | Derived | Editable | Persisted |
| --- | --- | ---: | ---: | ---: |
| Project ID | ProjectRecord | No | No | Yes |
| Project name | ProjectRecord | No | Yes | Yes |
| Project type | ProjectRecord | No | Creation-only or restricted | Yes |
| Project lifecycle | ProjectRecord | No | Yes | Yes |
| Repository binding | ProjectRecord | No | Yes | Yes |
| Enabled evidence sources | ProjectRecord | No | Yes | Yes |
| Current objective | ProjectContext | Yes | No | Rebuildable |
| Milestones | ProjectContext | Yes | No | Rebuildable |
| Accepted decisions | ProjectContext | Yes | No | Rebuildable |
| Capabilities | ProjectContext | Yes | No | Rebuildable |
| Risks | ProjectContext | Yes | No | Rebuildable |
| Candidate actions | ProjectContext | Yes | No | Rebuildable |
| Context generation metadata | ProjectContextBuilder output | Yes | No | Optional cache metadata |
| Approval state | Execution Lifecycle | No | Transition-controlled | Yes |
| Execution state | Execution Lifecycle | No | No | Yes |
| Runtime result | Execution Lifecycle | No | No | Yes |

Repository connection status deserves one clarifying note: it MAY be an
*observed* value (is this binding currently reachable/authorized right now)
that is correlated with, but not the same field as, the repository identity
configured on `ProjectRecord` (owner/name). The identity is durable
configuration; the live connection status is an observation layered on top of
it, sourced from the existing GitHub connection machinery, not stored as
part of the identity field itself.

## 13. Lifecycle

```text
Project creation
-> ProjectRecord
   Authoritative: ProjectRecord. Nothing else exists yet.

ProjectRecord
+ enabled evidence source configuration
-> ProjectEvidence collection
   Authoritative: each evidence source, for its own claim only.

ProjectRecord
+ ProjectEvidence
-> ProjectContextBuilder
-> ProjectContext
   Authoritative: ProjectContextBuilder's deterministic rules.

ProjectRecord
+ ProjectContext
-> Project Workspace
   Authoritative: nothing new -- pure presentation over the two upstream facts.

Explicit user configuration change
-> ProjectRecord update
-> current ProjectContext becomes stale
-> rebuild
   Authoritative: the user's explicit edit action (into ProjectRecord),
   then ProjectContextBuilder again for the rebuild.

Candidate action selection
-> execution proposal
-> ExecutionIntent lifecycle
   Authoritative: the Execution Lifecycle from this point on -- the Project
   Domain's authority ends at "candidate action selected."
```

## 14. Context freshness and staleness

A `ProjectContext` is **fresh** only when it is known to have been built from:

- the current `ProjectRecord` version,
- the current evidence snapshot,
- the declared builder version.

A `ProjectContext` becomes **stale** the instant any of those three inputs
changes after it was built. This is fact-based staleness, the same pattern
[Execution Intent](execution-intent.md) §12 already uses for execution intent
staleness, applied one layer down to project representation.

Rules:

- Stale context must not be silently shown as current.
- Stale cached context may be displayed only with an explicit freshness
  marker (e.g. a build timestamp and/or source-snapshot reference) -- never
  presented as equivalent to a fresh build. This follows
  [representative-engine.md](representative-engine.md) §16's provenance/
  freshness rules for derived material.
- Rebuild failure returns a typed failure (`{ valid: false, errors }`,
  matching Slice 2A's existing `ProjectContextBuildResult` shape), never a
  thrown exception.
- Rebuild failure must not silently promote a stale context to "current"
  status. If a rebuild fails, the caller has a stale context (explicitly
  marked) or no context -- never a silently-revalidated one.
- No partial context is authoritative. `ProjectContextBuilder` either
  produces a complete, valid `ProjectContext` or a typed failure; there is no
  third, partially-assembled state that counts as current.
- Current context MAY be cached for performance or continuity, but a cache is
  not a source of truth -- it is a stored copy of a specific prior build.
- A cached context SHOULD be reproducible from its recorded inputs (the same
  `ProjectRecord` version and evidence snapshot fed through
  `ProjectContextBuilder` again should reproduce it). A cached value that
  cannot be reproduced this way is drift, not a valid cache.

This document does not require or design a persistence implementation for
caching, snapshots, or rebuild triggering (§2, §19).

## 15. Conflict model

Evidence may disagree (§6). This section defines how that disagreement is
treated, not how it is resolved by fiat.

Rules:

- Evidence disagreement must not be silently resolved by array order (e.g.
  "whichever source happened to load first wins"). This is the same
  principle already enforced by Slice 2A's `compareValidationIssues` and
  duplicate/active-count checks, which are sorted and counted, not
  order-dependent.
- Deterministic builder rules must surface conflicts rather than silently
  picking one interpretation.
- Fields requiring exactly one canonical value (for example, at most one
  active objective, at most one active milestone) must fail validation or
  emit explicit conflict state when evidence implies more than one candidate
  -- exactly as Slice 2A's `MULTIPLE_ACTIVE_OBJECTIVES` and
  `MULTIPLE_ACTIVE_MILESTONES` error codes already do for their respective
  fields.
- Candidate recommendations (`CandidateProjectAction`) may mention a conflict
  in their rationale but cannot resolve it authoritatively -- a
  recommendation is still only a recommendation (§3, §9).
- LLM ranking cannot silently replace evidence conflict resolution. If an LLM
  is ever used to help surface or explain a conflict, the conflict's
  existence and resolution must still be governed by deterministic builder
  rules, not by trusting the LLM's ranking as the resolution itself.
- Accepted decisions must be supported by accepted-decision evidence (a
  `ProjectSource`-backed `ProjectDecision` with status `accepted`), not by
  suggestion text or candidate-action rationale.

## 16. Aggregate roots

```text
ProjectRecord is the Project Domain aggregate root.
ExecutionIntent is the Execution Domain aggregate root.
ProjectContext is a derived aggregate representation, not a writable aggregate root.
```

SmartFlow's existing canonical documents do not use "aggregate root" as a
formally defined term elsewhere; this document introduces it narrowly, scoped
to expressing the ownership distinction above, and does not imply any
particular persistence pattern (event sourcing, ORM aggregate boundaries, or
otherwise) beyond that distinction.

## 17. Relationship to Slice 2A

**Implemented** (verified directly against
`src/features/projects/` as committed):

- `SoftwareProject` representation (`projectContextTypes.ts`),
- typed `ProjectContext` (`projectContextTypes.ts`),
- deterministic `ProjectContextBuilder` (`buildProjectContext` in
  `projectContextBuilder.ts`),
- immutable, normalized output (deep-frozen, clone-before-freeze pipeline),
- evidence references (`ProjectSource`),
- candidate-action non-authority (`CandidateProjectAction`'s structural
  discriminants),
- a SmartFlow-as-Software-Project fixture
  (`smartflowProjectContextFixture.ts`), hand-authored from canonical
  documents, not a live sync with the repository.

**Not implemented:**

- persisted `ProjectRecord` (today, the `project` field of
  `ProjectContextInput` is hand-authored in the fixture, not stored or
  editable anywhere),
- durable `ProjectEvidence` (today, `sources` is likewise hand-authored in
  the fixture),
- a context rebuild service,
- Project Workspace,
- any UI,
- multi-project orchestration,
- LLM extraction into evidence,
- automatic repository ingestion,
- broader integration expansion.

`SoftwareProject` as it exists today is a **type definition and a
hand-authored fixture value**, not a persisted `ProjectRecord`. This
document does not claim otherwise, and no future document should either
without a persistence implementation actually landing first.

## 18. Project Workspace roadmap reconciliation

The Project Workspace Implementation Roadmap
(`docs/roadmap/project-workspace-implementation-roadmap-v1.md`) is a planning
document, not canonical architecture, unless a future repository status
change says otherwise. Its sequencing (S1-S12, milestones M1-M5) is not
automatically approved or re-approved by this document.

The approved interpretation, for when that roadmap is next revised or acted
on:

- the roadmap's "Project Entity" (its S1) becomes `ProjectRecord`, as defined
  in §5 of this document -- not a separately re-invented schema;
- the roadmap's objective/milestone/decision/capability/risk display comes
  from `ProjectContext` (§8), not from independent derivation inside
  Workspace screens;
- the roadmap's "Health," "Current Focus," and "Recent Activity" areas are
  derived Workspace views -- compositions consuming `ProjectContext` (and,
  where the builder does not yet produce a needed field such as Health,
  extending the builder rather than deriving that fact independently inside
  the presentation layer);
- Project Workspace edits `ProjectRecord` only (§10);
- Project Workspace consumes `ProjectContext` (§10);
- execution/approval views inside Project Workspace consume Execution
  Lifecycle state, and doing so does not transfer ownership of that state to
  Project Workspace or the Project Domain (§11);
- this document does not automatically approve the roadmap's slice ordering
  (S1-S12) -- that ordering was sound as reviewed during the Slice 2B
  consolidation, but re-approval of sequencing is a roadmap-governance
  action, not a side effect of this architecture document;
- future roadmap updates must use this document's canonical terminology
  (`ProjectRecord`, `ProjectEvidence`, `ProjectContext`, not an undifferentiated
  "Project entity" or "project state").

## 19. Open decisions

Recorded without resolution:

- One repository versus multiple repository bindings per `ProjectRecord`.
- Durable versus on-demand `ProjectEvidence` (whether evidence observations
  themselves are persisted or re-fetched on each build).
- Whether project Health belongs inside `ProjectContext` as a new field, or
  as a sibling derived type consumed alongside it.
- Persistence strategy for `ProjectRecord` (storage engine, schema, migration
  approach).
- Caching strategy for `ProjectContext` (whether/how a build is cached, for
  how long, and how invalidation is triggered).
- Ownership and timing of reconciling the legacy generic "Projects" module
  concept (`docs/design/system/06_module_philosophy.md`) with the Software
  Project / Learning Project / Personal Project taxonomy -- already flagged
  as deferred, non-blocking follow-up in
  `docs/product/product-direction-v1.md` §17 and the Project Workspace
  roadmap §15; still unresolved here.
- How verified execution results become validated `ProjectEvidence` (§11).
- How LLM-generated observations may ever enter evidence through a future,
  explicitly validated process (§6).

These are open decisions, not planned implementation. Listing them here does
not schedule or authorize work on any of them.

## 20. Security and governance

Reasserted, unchanged from existing canonical documents, and applicable
directly to the Project Domain:

- Project configuration is not execution authority.
- Persistence is not execution authority.
- Context is not execution authority.
- Candidate action is not execution intent.
- Workspace UI is not authority.
- Browser state is not canonical project truth.
- Provider data requires validation and provenance before it may inform
  `ProjectContext`.
- Project isolation must prevent cross-project context leakage, consistent
  with [representative-engine.md](representative-engine.md) §17's project
  and user isolation model.
- Project-scoped execution must still pass the normal Execution Lifecycle
  (validation, policy, approval, execution, audit) in full -- referencing a
  project in an `ExecutionIntent` shortens nothing in that lifecycle.

## 21. Recommended future implementation sequence

Recommendation only -- not current implementation, not authorized by this
document:

```text
ProjectRecord persistence
-> ProjectEvidence acquisition
-> Context rebuild service
-> Project Workspace integration
-> Project Dashboard
-> additional derived project views
-> assistant project awareness
```

This sequence is roadmap guidance for future milestones. It does not
authorize, schedule, or begin any of these implementation steps.

## Explicitly Out of Scope

This document does not design or implement:

- database schema or migrations for `ProjectRecord` or `ProjectEvidence`,
- a context rebuild service implementation,
- Project Workspace UI or navigation,
- execution policy, approval, or runtime mechanics (see
  [Authority Model](authority-model.md), [Execution Intent](execution-intent.md)),
- Smart Automation workflows or the SmartFlow/Smart Automation boundary (see
  [smartflow-smart-automation-boundary.md](smartflow-smart-automation-boundary.md)),
- GitHub, Gmail, or Calendar integration expansion,
- LLM extraction or reasoning mechanics,
- multi-project orchestration,
- Learning Project or Personal Project types.

## Related Documents

- [Current Architecture](current-architecture.md)
- [Authority Model](authority-model.md)
- [Execution Intent](execution-intent.md)
- [SmartFlow to Smart Automation Boundary](smartflow-smart-automation-boundary.md)
- [Target Architecture](target-architecture.md)
- [Representative Engine](representative-engine.md)
- [Product Direction v1](../product/product-direction-v1.md)
- [Project Workspace Implementation Roadmap v1](../roadmap/project-workspace-implementation-roadmap-v1.md)
- [PROJECT_STATUS.md](../../PROJECT_STATUS.md)
