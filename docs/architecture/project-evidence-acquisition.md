# SmartFlow ProjectEvidence Acquisition

Status: Canonical Architecture
Last updated: 2026-08-02
Scope: ProjectEvidence acquisition boundary only — architecture, not implementation

## 1. Purpose

This document defines the canonical architecture for how `ProjectEvidence`
enters SmartFlow.

[`project-domain.md`](project-domain.md) §6 already defines what
`ProjectEvidence` *is* — a traceable, provenance-carrying input into context
construction, not a conclusion — and already draws the line between
**evidence-source configuration** (durable, `ProjectRecord`-owned, delivered
in Slice 3) and **evidence observation** (the actual collected content,
undesigned until this document). This document is that missing layer. It
exists to bridge:

```text
ProjectRecord configuration (which evidence-source kinds are enabled)
-> evidence observations (what those sources actually contain)
-> ProjectContext derivation (project-domain.md's existing, unchanged job)
```

ProjectEvidence Acquisition owns **zero interpretation**. It collects,
validates, provenance-stamps, and durably stores observations. It never
decides what a fact means, never resolves a disagreement between two
observations, and never derives anything. Interpretation remains exactly
where `project-domain.md` §7 already puts it: `ProjectContextBuilder`.

This document is architecture only. No runtime code, schema, migration,
provider, adapter, or UI is introduced by it. It records what a future
implementation slice must follow, not something already built.

## 2. Scope

This document covers:

- the evidence-source enablement boundary (reading, never writing,
  `ProjectRecord.enabledEvidenceSourceKinds`);
- acquisition attempts (one bounded execution of the acquisition control
  plane against one source, for one project, at one point in time);
- Evidence Source Adapters (the extension boundary for reading one bounded
  kind of source);
- validation of evidence candidates before they become evidence;
- provenance stamping;
- normalization into the canonical `ProjectEvidence` shape;
- immutable evidence persistence;
- project isolation for every acquisition read and write;
- acquisition failure semantics;
- the boundary to the future Context Rebuild service.

This document explicitly excludes:

- context derivation (owned by `ProjectContextBuilder`, `project-domain.md`
  §7 — unchanged);
- conflict resolution (owned by `ProjectContextBuilder`, `project-domain.md`
  §15 — unchanged);
- LLM reasoning or extraction of any kind;
- execution of any kind (owned by the Execution Lifecycle, entirely separate
  per `project-domain.md` §11);
- provider writes (Acquisition is read-only against every source, always);
- scheduling, retries, and monitoring (future Smart Automation concern, §23);
- Project Workspace UI (§10's presentation row; no UI is designed here);
- Smart Automation implementation (named only at its boundary, §23).

## 3. General Evidence Direction

**`ProjectEvidence` is the first domain-specific specialization of a future
general Evidence architecture.**

`ADR-0006`'s Representation Model already states, at the whole-of-Aryan
level, that any future personal knowledge, memory, or decision-pattern
system must preserve provenance, correctability, and confidence-awareness.
Business, Personal, Learning, Health, Finance, and any other future domain
will eventually need their own evidence-backed representation, and it is
foreseeable that those domains will share structural properties with
`ProjectEvidence`: immutability, provenance, non-interpretive acquisition,
and domain isolation.

**This document does not define that general model.** It defines only the
Project domain's specialization. A future cross-domain Evidence architecture
must preserve, at minimum, the properties this document establishes for
Projects:

- provenance is mandatory, never optional;
- evidence is immutable; correction is superseding, never mutation;
- the source is authoritative for its own claim, never for interpreted
  truth;
- uncertainty is represented explicitly, never hidden;
- acquisition never interprets;
- domain isolation is structural, not just a query-time convention.

**No generic Evidence abstraction is created in implementation by this
document or by the next implementation slice.** Extracting a shared
cross-domain `Evidence` type is future work, contingent on a second domain
(Business, Personal, Learning, or another) actually needing evidence
acquisition, and requires its own architecture review at that time. Building
a generic abstraction now, before a second real consumer exists, would
violate this repository's stated preference for concrete precedent over
speculative generalization — the same reasoning `project-domain.md` §4
already applied when it defined `ProjectRecord` narrowly around the one
implemented project type rather than a speculative general "Entity" concept.

## 4. Core Principles

- **Acquisition owns zero interpretation.** It collects and stores; it does
  not decide what evidence means.
- **Evidence is a claim, not automatically truth.** An evidence item states
  what a source said; whether and how it becomes part of `ProjectContext` is
  `ProjectContextBuilder`'s job, unchanged from `project-domain.md` §6.
- **Provenance is mandatory.** No evidence item may exist without a
  retained origin, source reference, and collection time.
- **Immutable observations over mutable facts.** Once acquired, an evidence
  record never changes. Corrections and updates create new records.
- **Source configuration is not evidence.** `ProjectRecord`'s enabled-kinds
  list says what Acquisition is *permitted* to collect, not what has been
  collected.
- **Evidence is not context.** `ProjectContext` is derived, ephemeral,
  rebuildable output; `ProjectEvidence` is durable, immutable input.
- **Evidence is not execution authority.** No evidence item, by existing or
  by being collected, authorizes, approves, or triggers any execution.
- **LLM output is not evidence under current architecture.** Unchanged from
  `project-domain.md` §6: no exception exists today.
- **Conflicts are preserved, not silently resolved.** Acquisition stores
  disagreeing observations side by side; it never picks a winner.
- **Browser state is not canonical evidence.** Unchanged from
  `authority-model.md` and `representative-engine.md` §15.
- **Provider output is not automatically canonical truth.** A provider
  response is data to be validated and provenance-stamped, not truth by
  virtue of arriving from a provider.
- **Fail closed on malformed input.** A candidate that cannot be validated
  is rejected, never coerced into a best-effort record.
- **No partial acquisition may be represented as complete.** An attempt that
  could not fully complete must report a typed failure, never a silent
  partial success dressed as success.

## 5. Terminology

- **ProjectEvidence** — an immutable, timestamped, source-attributed,
  project-scoped record capturing what one Evidence Source Adapter observed
  from one bounded source, produced by one Acquisition Attempt. Defined
  fully in §6.
- **Evidence Candidate** — a transient, pre-persistence value produced by an
  Evidence Source Adapter. Not yet validated, not yet canonical evidence,
  and never visible outside the boundary of one Acquisition Attempt. Defined
  fully in §7.
- **Evidence Source Adapter** — the primary extension boundary of this
  architecture: a bounded, source-kind-specific implementation that reads
  exactly one kind of source, strictly read-only, and produces Evidence
  Candidates or a typed failure. Defined fully in §8.
- **Acquisition Attempt** — one bounded execution of the Acquisition Service
  against one adapter, for one enabled source kind, for one project, at one
  point in time.
- **Evidence Origin** — the categorical description of where a piece of
  evidence came from and the scope of authority that origin actually has
  (e.g. authoritative for "what the repository contained," never for
  external-world truth). Defined fully in §11.
- **Provenance** — the complete, retained record of an evidence item's
  origin, collection context, and lineage: source kind, reference, adapter
  identity and version, collection time, and supersession lineage where
  applicable.
- **Verification Method** — how, if at all, an evidence item's content was
  checked against its source at collection time (e.g. a deterministic file
  read versus an unverified third-party claim).
- **Confidence** — an optional, adapter- or origin-supplied estimate of
  correctness, present only where the origin makes it meaningful. Never a
  substitute for provenance.
- **Uncertainty** — the explicit representation of what is not known or not
  verified about an evidence item. The complement of confidence; mandatory
  to surface, never to hide, when material.
- **Supersession** — the explicit, traceable act of a newer evidence record
  replacing an older record's claim about the same fact, recorded as a
  reference from the new record to the old. Never a mutation of the old
  record.
- **Evidence Snapshot** — a specific, reproducible selection of evidence
  records for a project as of a given point, consumed by the future Context
  Rebuild service. Not owned or produced by Acquisition itself.
- **Current Evidence Set** — informally, the set of non-superseded evidence
  records for a project at a given moment. A convenience notion computed on
  read, not a stored or cached "truth" entity.
- **Acquisition Failure** — a typed, fail-closed outcome of an Acquisition
  Attempt that produced no usable evidence. Distinguished from a
  legitimately empty but successful attempt (a source with zero
  observations today is not the same as a failed read).
- **Context Rebuild** — the future, not-yet-built service named in
  `project-domain.md` §21 that selects an Evidence Snapshot and the current
  `ProjectRecord`, then invokes `ProjectContextBuilder`. Out of scope here
  except at the boundary defined in §22.

**Clarification on "Collector."** "Collector" is an informal, implementation
level synonym occasionally used for one Evidence Source Adapter in prior,
undocumented architecture discussion. It names a possible *mechanism*, not
the canonical ownership boundary. This document establishes **Evidence
Source Adapter** as the canonical term for that boundary; "collector" MAY
still appear informally to describe a concrete adapter implementation, but
it does not define architecture and MUST NOT be treated as a competing
boundary name in future documents or code.

## 6. ProjectEvidence

`ProjectEvidence` is:

- immutable — never edited in place, once persisted;
- timestamped — carries an injected, non-guessable collection time (§13);
- source-attributed — always traceable to exactly one Evidence Origin and
  one Evidence Source Adapter;
- project-scoped — always bound to exactly one `ProjectRecord` by ID (§20);
- provenance-aware — carries the full provenance model defined in §11;
- serializable — a plain, JSON-safe value, matching the discipline
  `ProjectContext` and `ProjectRecord` already follow;
- non-interpretive — states what a source said, never what it means;
- append-only by default — new observations are added, not merged into or
  overwritten on top of prior ones (§14).

`ProjectEvidence` is **not**:

- a validated conclusion (that is `ProjectContext`, `project-domain.md`
  §8);
- `ProjectContext` itself;
- model inference (forbidden as evidence today, `project-domain.md` §6);
- memory truth (conversational memory is never canonical evidence,
  `project-domain.md` §6);
- user consent or approval (evidence never carries or implies authority,
  `authority-model.md`);
- execution state (owned entirely by the Execution Lifecycle,
  `project-domain.md` §11);
- provider credential state (credentials remain Worker-owned,
  `authority-model.md`).

## 7. Evidence Candidate

An Evidence Candidate is the transient value an Evidence Source Adapter
produces before validation. Candidates:

- are not canonical evidence and must never be treated, displayed, or
  logged as trusted evidence before validation completes;
- must pass validation (bounded reference, whitelisted kind, complete
  provenance) before they can become a `ProjectEvidence` record;
- must never become visible to any consumer — including
  `ProjectContextBuilder` or Project Workspace — as evidence while still a
  candidate;
- may fail as part of a complete Acquisition Attempt, in which case the
  attempt reports a typed `Acquisition Failure` rather than persisting
  anything.

**Atomicity is an open decision, not silently resolved by this document.**
The reviewed design that preceded this document described two principles
that were never explicitly reconciled: (a) each candidate should be
validated independently, with invalid candidates rejected without failing
an otherwise-valid batch, which implies bounded per-item acceptance; and
(b) "no partial acquisition may be represented as complete," which pulls
toward atomic whole-attempt acceptance, particularly for sources where a
truncated read (e.g. a paginated provider fetch cut short by an error)
would be misleading if partially persisted. This document does not pick a
winner. It records both positions as still open (§25) and recommends, as a
*proposed*, not-yet-ratified direction, that atomicity be a property an
Evidence Source Adapter's contract **declares explicitly per adapter**
(so a credential-free document adapter can reasonably accept item-by-item,
while a paginated provider adapter can reasonably require whole-attempt
atomicity) rather than one global rule imposed on every adapter uniformly.

## 8. Evidence Source Adapter

The Evidence Source Adapter is the primary extension boundary of this
architecture. A "collector" is an implementation detail behind it, not the
boundary's identity (§5).

Conceptual contract:

```text
ProjectRecord
+ enabled source configuration
+ trusted execution context
+ explicit acquisition metadata
->
Evidence Acquisition Result (candidates, or a typed failure)
```

Every Evidence Source Adapter must:

- read exactly one bounded source kind;
- remain strictly read-only against the source — no adapter may write to,
  mutate, or otherwise change anything at the source;
- produce Evidence Candidates, never `ProjectEvidence` directly (validation
  and persistence happen in the Acquisition Service, §9, not inside the
  adapter);
- declare its own source identity and adapter version as part of every
  candidate's provenance;
- preserve provider- or source-specific references losslessly (e.g. a
  commit SHA, a document path, a provider record ID) rather than
  summarizing them away;
- return typed failures, never throw an untyped or silent exception;
- never resolve evidence conflicts (that is exclusively
  `ProjectContextBuilder`'s job, §18);
- never call `ProjectContextBuilder` (that is exclusively Context Rebuild's
  job, §22);
- never grant, imply, or reference execution authority;
- never expand a project's enabled source-kind configuration on its own —
  an adapter only acts within kinds the user has already enabled on
  `ProjectRecord`;
- never expose or persist provider credentials, tokens, or secrets in
  candidate content or metadata.

Future adapter examples (none implemented, none approved as concrete
implementations by this document):

- a repository document adapter (reads canonical in-repo documents —
  architecture docs, ADRs, roadmap, status);
- a repository-state adapter (reads verified repository facts, e.g. via the
  existing GitHub App integration);
- a verified integration adapter (reads a verified external-integration
  fact);
- an explicit user-submission adapter (accepts a structured, non-chat user
  statement);
- a manual import adapter (accepts a bounded, validated external file
  upload).

**This document does not approve Gmail, Calendar, Slack, or any other
provider as an implemented or currently-approved adapter.** Naming a future
adapter category is not authorization to build it.

## 9. Acquisition Service

The Acquisition Service is the SmartFlow-owned control plane surrounding
adapters — the layer that turns "an adapter can read a source" into "a
trusted, validated, provenance-stamped evidence record exists."

It owns:

- trusted user/project resolution (the same pattern `projectRecordService.ts`
  already establishes: identity resolved from the authenticated session,
  never from caller input);
- confirming the requested source kind is actually enabled on the target
  `ProjectRecord` before invoking any adapter;
- adapter selection for a given source kind;
- executing one Acquisition Attempt;
- validating candidates (bounded reference, whitelisted kind, complete
  provenance — fail closed, typed issues, mirroring
  `projectRecordValidation.ts`'s discipline);
- provenance stamping;
- coordinating persistence into the immutable evidence store;
- mapping every failure mode into a typed error (mirroring
  `projectRecordService.ts`'s `toProjectRecordError` pattern);
- audit correlation where a future audit surface requires it.

It does **not** own:

- scheduling (future Smart Automation concern, §23);
- retries (future Smart Automation concern, §23);
- background/asynchronous execution mechanics;
- conflict resolution (`ProjectContextBuilder`'s job, §18);
- context rebuilding (Context Rebuild's job, §22);
- execution policy (Execution Lifecycle's job, `project-domain.md` §11);
- provider credentials in the browser — any credentialed adapter runs
  Worker-side, never client-side, per `authority-model.md`.

## 10. Ownership Model

| Concern | Canonical owner |
| --- | --- |
| Enabled source configuration | `ProjectRecord` |
| Raw source content | Original source |
| Source reading mechanics | Evidence Source Adapter |
| Acquisition orchestration | ProjectEvidence Acquisition Service |
| Validation and provenance | ProjectEvidence Acquisition |
| Immutable evidence storage | ProjectEvidence repository boundary |
| Conflict detection | `ProjectContextBuilder` |
| Freshness selection | Context Rebuild |
| Scheduling and retries | Future Smart Automation |
| Execution authority | Execution Lifecycle |
| Presentation | Project Workspace |

No concern in this table has joint ownership. Exactly as
`project-domain.md` §5 states for `ProjectRecord` versus `ProjectContext`,
every row here resolves to exactly one owner.

## 11. Evidence Origin and Provenance Model

**This document does not use ordinal trust tiers** (no "Tier 1 / Tier 2 /
Tier 3" ranking). Trust is not a single number; it is the composite of
origin, provenance, verification method, confidence, and uncertainty,
evaluated together, never collapsed into one ordinal rank that would hide
which of those dimensions is actually doing the work.

Provenance fields, defined conceptually (no schema prescribed — see §13):

- **origin kind** — the categorical description of where the evidence came
  from (§12);
- **source kind** — the specific `ProjectSourceKind`-style enum value
  (already whitelisted at both the type and `ProjectRecord` configuration
  layer);
- **source reference** — a bounded pointer into the source (file path,
  commit SHA, provider record identifier — never an arbitrary trusted
  filesystem path, mirroring Slice 2A's existing constraint);
- **source version or snapshot identifier**, where the source has one (a
  commit SHA, a document revision) — omitted where the source has no
  natural versioning;
- **acquisition adapter** — which Evidence Source Adapter produced this
  record;
- **adapter version** — which version of that adapter ran;
- **collectedAt** — an injected, immutable acquisition-time timestamp;
- **authenticated project/user scope** — the project and owning user this
  evidence is bound to;
- **verification method** — how the content was checked against the source
  at collection time (e.g. deterministic file read vs. unverified
  third-party claim);
- **confidence**, where relevant to the origin;
- **uncertainty** — explicit, never hidden;
- **supersedesId**, where this record explicitly replaces a prior one.

Clarifications on authority scope — each origin is authoritative **only**
for the narrow claim it can actually make, never for external truth:

- An **explicit user statement** is authoritative only for the fact that
  the user asserted it — not necessarily for external-world truth. "Aryan
  said X" is a solid fact; "X is true" is not automatically implied.
- A **repository observation** is authoritative only for what the
  repository contained at the observed revision/time — not for whether
  that content remains current, or was ever correct in some external
  sense.
- A **provider observation** is authoritative only for what the provider
  returned at that time — not for whether the provider's own data was
  itself accurate or current.

This mirrors `execution-intent.md` §12's freshness discipline (a fact can
become stale without ever having been wrong) applied one layer down, to
evidence rather than to execution state.

## 12. Classification Model

A non-ordinal classification, orthogonal to the provenance fields in §11:

- **observed** — a source-as-is snapshot collected directly (e.g. a file's
  content at a point in time);
- **explicit-user-statement** — an explicit, structured user submission,
  never inferred from conversation;
- **imported** — a bounded, validated external ingestion (e.g. a future
  manual upload);
- **verified-provider-observation** — a fact returned by a verified
  external integration (e.g. a future GitHub-backed adapter);
- **canonical-document-observation** — a deterministic reading of an
  already-in-repo canonical document (architecture doc, ADR, roadmap,
  status document).

**Not valid `ProjectEvidence` categories today:**

- **LLM inferred** — forbidden; `project-domain.md` §6 permits no exception
  today, and none is created here;
- **generated** — same prohibition; "generated" content is Reasoning-layer
  output, not evidence;
- **derived** — belongs to `ProjectContext` (`project-domain.md` §8), never
  to `ProjectEvidence`; using "derived" as an evidence classification would
  violate the ownership split those two types already establish;
- **accepted execution result** — named as a *future*, not-yet-approved
  pathway in `project-domain.md` §11 and §19; requires its own future
  architecture before it can enter evidence at all;
- **rejected** — not a persisted evidence state. A candidate that fails
  validation is rejected *at acquisition time* and never becomes an
  evidence record; "rejected" describes an outcome of the Acquisition
  Attempt (§15), not a stored classification value.

## 13. Metadata Model

No database schema is prescribed. Conceptual fields only.

**Mandatory:**

- evidence ID;
- project ID;
- source kind;
- origin/classification (§11, §12);
- title;
- reference;
- collectedAt;
- adapter identity;
- adapter version;
- provenance data (verification method, at minimum — see §11).

**Optional:**

- source revision;
- confidence;
- uncertainty (recommended whenever confidence is present, but not forced
  onto origins where it is not meaningful — see §25's open item on exact
  representation);
- notes;
- supersedesId;
- acquisition attempt ID.

## 14. Immutability and Supersession

- Evidence records are immutable. No field may be edited in place after
  persistence.
- Corrections create new evidence records, never in-place edits.
- Updated observations (e.g. re-reading a source that changed) create new
  evidence records, never overwrite the prior one.
- Supersession is explicit and traceable — a new record's `supersedesId`
  points at the record it replaces; the old record is never deleted or
  mutated to reflect this.
- Prior records remain historical and queryable, not hidden by default
  (§16).
- No in-place mutation of any evidence field, ever.
- No silent last-write-wins — two disagreeing observations both survive
  unless one explicitly supersedes the other via `supersedesId`; nothing
  is overwritten by arrival order.

**Deletion/erasure remains an open governance decision** (§25), not
resolved by this document. If erasure is ever required (e.g. a user-
requested privacy erasure), it must preserve auditability and
reproducibility semantics without exposing the erased content — most
plausibly a tombstone marker rather than a row removal — but the exact
mechanism is not designed here.

## 15. Evidence Lifecycle

```text
ProjectRecord source configuration
-> adapter selection
-> source read (strictly read-only)
-> evidence candidates
-> validation
-> provenance stamping
-> immutable persistence
-> (later, separately) evidence snapshot selection
-> Context Rebuild
```

Invalid paths:

```text
malformed candidate
-> typed acquisition failure
-> no canonical evidence is persisted

unauthorized or disabled source kind
-> fail closed before any adapter runs
-> no acquisition attempt occurs

partial provider failure
-> typed failure
-> no false "complete" state is ever reported
```

## 16. Evidence State Model

Deliberately shallow — evidence is a fact-record, not a process, and does
not need `ExecutionIntent`-style lifecycle complexity (`execution-intent.md`
§14's `proposed`/`validated`/`approved`/... states have no equivalent
here).

Canonical stored state:

- **active observation** — the default state of every persisted record;
- **superseded observation** — **derived**, not stored: true if and only if
  some other record's `supersedesId` points at it. There is no mutable
  "status" column that flips;
- **possible future erased/tombstoned state** — named for continuity, not
  resolved (§14, §25).

No richer state machine is introduced.

## 17. Source Taxonomy

| Source kind | Status | Note |
| --- | --- | --- |
| Architecture document | Current type/configuration only | `architecture_document` kind already whitelisted on `ProjectRecord`; no acquisition exists |
| ADR | Current type/configuration only | `adr` kind already whitelisted; no acquisition exists |
| Roadmap document | Current type/configuration only | `roadmap_document` kind already whitelisted; no acquisition exists |
| Product direction document | Current type/configuration only | `product_direction_document` kind already whitelisted; no acquisition exists |
| Project status document | Current type/configuration only | `project_status_document` kind already whitelisted; no acquisition exists |
| Repository document | Current type/configuration only | `repository_document` kind already whitelisted; no acquisition exists |
| Verified repository state | Approved architecture direction, not implemented | `verified_repository_state` kind already whitelisted; plausibly backed by the existing GitHub App read-only integration, but no adapter exists |
| Verified integration evidence | Approved architecture direction, not implemented | `verified_integration_evidence` kind already whitelisted; no adapter exists |
| Explicit user submission | Approved in principle, mechanism undesigned | ADR-0006's Representation Model names "explicit user statements" as a category; not yet a `ProjectSourceKind` value, no submission mechanism designed |
| Manual import | Future, undesigned | Not a current `ProjectSourceKind` value; no mechanism designed |
| Workspace artifacts (tasks, calendar, habits, etc.) | Not approved — would require a new ADR | Not named in `project-domain.md` §6's evidence categories; `product-direction-v1.md` §10 keeps Tasks a separate domain, not absorbed into Projects |
| Accepted execution results | Future, explicitly not yet approved | `project-domain.md` §11 and §19 name this exact idea and explicitly state no validated process is defined or approved |
| LLM observations | Rejected | `project-domain.md` §6, verbatim: LLM output "MUST NOT enter ProjectEvidence" until an undefined future validated process exists |

This table does not overstate implementation: every "current type/
configuration only" row means the enum value and `ProjectRecord`
configuration exist (Slice 3); it does not mean any content has ever been
collected for that kind.

## 18. Conflict Model

- Acquisition stores conflicting claims independently — it never merges,
  deduplicates, or discards a disagreeing observation.
- Acquisition performs zero ranking or resolution of any kind.
- Array order cannot resolve conflicts — nothing about the order evidence
  was collected or listed determines which claim "wins."
- Latest timestamp cannot silently resolve conflicts — `collectedAt` being
  newer does not make a claim more true, only more recent.
- Confidence cannot silently override provenance — a high-confidence claim
  from a weak origin does not outrank a low-confidence claim from a strong
  origin without `ProjectContextBuilder`'s explicit, deterministic rule
  saying so.
- `ProjectContextBuilder` owns deterministic conflict surfacing, exactly as
  already implemented for objectives and milestones
  (`MULTIPLE_ACTIVE_OBJECTIVES`, `MULTIPLE_ACTIVE_MILESTONES`) and
  documented in `project-domain.md` §15 — unchanged by this document.
- Candidate recommendations (`CandidateProjectAction`) cannot authoritatively
  resolve evidence conflicts — a recommendation is still only a
  recommendation (`project-domain.md` §9).

## 19. Freshness Model

- `collectedAt` is immutable — fixed forever at the moment of persistence.
- Freshness is computed at consumption time, never stored as a field on the
  evidence record.
- Freshness is explicitly not a mutable field on `ProjectEvidence` — doing
  so would let it silently go stale, which `project-domain.md` §14 already
  forbids for `ProjectContext` and this document extends to evidence.
- Context Rebuild owns freshness policy (what counts as "fresh enough," and
  when to trigger re-acquisition) — Acquisition has no opinion on this.
- Stale evidence may remain historically valid — an old observation being
  stale does not make it false, only no longer necessarily current.
- Stale evidence must never be silently presented as current.
- Re-acquisition creates new evidence rather than mutating old evidence,
  consistent with §14's immutability rule.

## 20. Project Isolation

- Every `ProjectEvidence` item belongs to exactly one `ProjectRecord`.
- Evidence references `ProjectRecord` by ID, one-directional.
- `ProjectRecord` does not enumerate individual evidence records — adding,
  superseding, or (in the future) erasing evidence never requires a
  `ProjectRecord` write, and never perturbs its `version`-based optimistic
  concurrency (Slice 3).
- No cross-project evidence sharing is allowed in the initial architecture.
- Future sharing or deduplication (e.g. two projects referencing the same
  underlying repository) requires an explicit architecture decision — it is
  not authorized by naming it here.
- Repository overlap does not imply shared evidence authority — two
  `ProjectRecord`s bound to the same repository each acquire and own their
  own evidence independently.

**The no-cross-project-sharing rule is Newly Proposed, not yet canonical.**
`project-domain.md` does not itself resolve this question; it is a
recommendation carried forward from architecture review, consistent with
`representative-engine.md` §17's and `target-architecture.md` §23's existing
prohibition on cross-project context leakage, but it requires the same kind
of explicit ratification any other newly proposed position in this document
does (§25).

## 21. Security and Governance

Preserved, unchanged, from `authority-model.md` and `project-domain.md` §20,
applied directly to Acquisition:

- trusted authenticated user resolution — identity comes from the
  authenticated session, never from caller input, mirroring
  `projectRecordService.ts`'s existing pattern;
- owner/project isolation on every read and write (§20);
- least privilege — Acquisition holds no more access than the specific
  source kind it is reading requires;
- provider credentials remain outside browser control — any credentialed
  adapter runs Worker-side (`authority-model.md`);
- read-only source access, always — no adapter may mutate a source;
- no source mutation of any kind;
- no secret or token persistence in evidence content or metadata;
- no execution authority granted, implied, or created by any evidence
  record;
- no approval issuance of any kind;
- fail closed on ambiguous, malformed, or unverifiable input;
- typed errors throughout — no untyped or silent exceptions escape the
  Acquisition Service;
- safe reference/path validation on every source reference, mirroring
  Slice 2A's existing path-traversal fix;
- no cross-project leakage (§20);
- no model-generated authority — nothing an LLM produces can enter this
  pipeline as evidence or as authority (§4, §12).

## 22. Context Rebuild Boundary

**Acquisition:**

- reads sources;
- produces and stores evidence;
- never derives `ProjectContext`;
- never calls `ProjectContextBuilder`.

**Context Rebuild** (future, not built, out of scope here except at this
boundary):

- reads the current `ProjectRecord`;
- selects an evidence snapshot;
- evaluates freshness (§19);
- invokes `ProjectContextBuilder`;
- owns rebuild orchestration and cache semantics.

Context Rebuild must never fetch raw provider or source content directly —
it only ever reads already-acquired `ProjectEvidence`. This keeps exactly
one component (Acquisition) responsible for ever touching a raw source,
consistent with `target-architecture.md`'s stated goal of avoiding
duplicated responsibility.

## 23. Smart Automation Boundary

Smart Automation may later own, for acquisition specifically:

- scheduled acquisition;
- retries;
- durable checkpoints;
- webhook-triggered runs;
- monitoring-oriented orchestration around acquisition attempts.

Smart Automation must call SmartFlow-owned acquisition contracts (the
Acquisition Service's own interface, §9) — it is a *caller* that decides
*when* an attempt runs, never a re-implementation of what happens during
one.

It must not reimplement:

- validation;
- provenance;
- persistence rules;
- project isolation;
- evidence semantics of any kind.

This mirrors the existing, canonical
[SmartFlow to Smart Automation Boundary](smartflow-smart-automation-boundary.md)
principle that Smart Automation must not fabricate, broaden, or reinterpret
SmartFlow authority — applied here to evidence semantics specifically.

**No Smart Automation implementation is authorized by this document.**

## 24. Current Implementation Status

**This section is superseded — see [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md)
for current status.** It is corrected below only where 2026-08-07
reconciliation evidence (`docs/status/reconciliation-2026-08.md`) proved it
wrong; it is not being kept up to date going forward.

**Implemented today:**

- `ProjectSourceKind` type (`src/features/projects/projectContextTypes.ts`);
- `ProjectRecord.enabledEvidenceSourceKinds` configuration (Slice 3,
  `src/features/projects/projectRecordTypes.ts`);
- `ProjectContext` types and the deterministic `ProjectContextBuilder`
  (Slice 2A, `src/features/projects/projectContextBuilder.ts`);
- `ProjectRecord` persistence (Slice 3, committed and pushed to `main` —
  `cec2be9`);
- `ProjectEvidence` and `ProjectEvidenceObservation` persistence, atomic and
  immutable (Slice 4B / ADR-0007, committed to `main` — `9b40a4d`, `bc87a60`);
- the Repository Documents Adapter, a real, credential-free Evidence Source
  Adapter that performs actual source reading of allowlisted in-repo
  Markdown documents (committed to `main` — `bc87a60`; not wired into any
  production entry point — a tested, injectable library invoked only by the
  local Project Refresh CLI);
- evidence snapshots, via the deterministic `EvidenceSnapshot` builder
  (Context Rebuild Foundation, committed to `main` — `ae2a0d5`);
- Context Rebuild, via `rebuildProjectContext(projectId)` (same commit) —
  honestly partial: it returns `snapshot_ready_context_not_derivable` for
  every project today, since no deterministic evidence-to-structured-fact
  transformation exists yet (see §22 above, unchanged).

**Not implemented:**

- an acquisition service that orchestrates or selects among multiple
  Evidence Source Adapters;
- any provider-backed Evidence Source Adapter (GitHub API, Gmail, Calendar);
- manual upload;
- explicit user-statement submission;
- LLM promotion of any kind;
- execution-result evidence of any kind.

## 25. Open Decisions

Recorded without resolution — listing them here does not schedule or
authorize work on any of them:

- durable versus on-demand evidence storage;
- atomic whole-attempt versus bounded per-item acceptance (§7) — genuinely
  unsettled, not silently decided;
- deletion/erasure/tombstone policy (§14);
- cross-project deduplication or sharing (§20) — this document proposes
  "no sharing," marked Proposed, not yet canonical;
- exact reference format per source kind;
- where repository-document adapters physically execute (the browser
  cannot read the server's git checkout; this is a real implementation
  constraint, not resolved here);
- confidence/uncertainty representation mechanics (§13);
- whether classification is an explicit stored field or derived from origin
  alone (§12);
- interaction with `project-domain.md` §19's still-open one-versus-multiple
  repository-binding question;
- execution-result promotion into evidence (`project-domain.md` §11, §19);
- LLM-assisted evidence promotion (`project-domain.md` §6);
- explicit user-statement submission semantics (structure, UI, validation).

Where this document recommends a position (e.g. no cross-project sharing,
per-adapter-declared atomicity), that position is marked **Proposed**, not
canonical, and requires explicit ratification — consistent with how
`project-domain.md` §19 itself records open decisions without silently
resolving them.

## 26. Relationship to Project Domain

[`project-domain.md`](project-domain.md) remains the parent domain
architecture. It defines `ProjectRecord`, `ProjectContextBuilder`,
`ProjectContext`, Project Workspace's ownership boundary, and the
Project Domain's complete separation from the Execution Lifecycle — none of
which this document redefines.

This document specializes exactly one concept `project-domain.md` names but
does not fully design: `ProjectEvidence` (§6 there) and the acquisition
boundary that produces it. Where this document and `project-domain.md`
overlap (e.g. the evidence-may-disagree rule, §6/§15 there), this document
restates rather than replaces the parent rule.

This document must not, and does not, redefine `ProjectRecord`,
`ProjectContext`, Execution Lifecycle, or Project Workspace ownership.

## 27. Recommended Future Implementation Sequence

Roadmap guidance only — not current implementation, not authorized by this
document:

```text
1. ProjectEvidence domain types and validation
2. ProjectEvidence repository boundary
3. one credential-free repository-document adapter
4. acquisition service
5. evidence snapshot contract
6. Context Rebuild foundation
7. later provider-backed adapters
8. later Smart Automation orchestration
```

This sequence mirrors the layering already proven out in Slice 3
(`projectRecordTypes.ts` -> `projectRecordValidation.ts` ->
`projectRecordRepository.ts` -> `projectRecordService.ts`) and deliberately
starts with the credential-free adapter (step 3) before any Worker-hosted,
credentialed adapter, keeping the first implementation slice's blast radius
comparable to Slice 3's own scope.

## 28. Non-Goals

This document does not authorize or design:

- GitHub ingestion implementation;
- filesystem scanner implementation;
- Gmail integration;
- Calendar integration;
- Slack integration;
- LLM extraction of any kind;
- embeddings;
- vector database;
- provider SDKs;
- scheduling infrastructure;
- retry infrastructure;
- background workers;
- Context Rebuild implementation;
- Project Workspace UI;
- execution-result promotion into evidence;
- manual-upload UI;
- a cross-domain general Evidence implementation (§3).

## 29. Related Documents

- [Project Domain](project-domain.md)
- [Authority Model](authority-model.md)
- [Execution Intent](execution-intent.md)
- [Representative Engine](representative-engine.md)
- [Target Architecture](target-architecture.md)
- [Agent Orchestration](agent-orchestration.md)
- [SmartFlow to Smart Automation Boundary](smartflow-smart-automation-boundary.md)
- [ADR-0006: Canonical Product Identity](../decisions/adr/ADR-0006-canonical-product-identity.md)
- [Product Direction v1](../product/product-direction-v1.md)
- [PROJECT_STATUS.md](../../PROJECT_STATUS.md)
