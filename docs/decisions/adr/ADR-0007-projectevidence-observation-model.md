# ADR-0007: ProjectEvidence Observation Model

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision Makers:** Product Owner (decision). Claude Code: drafting and documentation support only, per ADR-0001's "Implementation Lead (Claude)" role — not decision authority.
- **Supersedes:** None
- **Superseded by:** None

---

## Context

`ProjectEvidence` (Slice 4B, `docs/architecture/project-evidence-acquisition.md`) persists evidence identity and acquisition provenance, including a mandatory SHA-256 content hash. The uncommitted Repository Documents Adapter — the first real Evidence Source Adapter — surfaced a gap in an independent review: a content hash proves byte-identity to a party who already holds a candidate copy of the observed bytes, but it does not itself preserve any consumable representation of what was observed. `project-evidence-acquisition.md` §22 forbids the future Context Rebuild service from ever fetching the original repository or provider source directly. Given only identity, provenance, and a hash, Context Rebuild would have no lawful way to obtain the substance of a "canonical document observation" at all.

A narrow architecture review (this session, read-only, no code changes) evaluated the payload question in isolation and recommended a small, extensible Observation Model rather than either of the two tempting extremes: a single unbounded content column, or a full multimodal artifact platform. This ADR records the Product Owner's decision on that narrow question only.

## Decision

`ProjectEvidence` keeps exactly its current responsibility: evidence identity and acquisition provenance. A new, separate, immutable `ProjectEvidenceObservation` aggregate, in a 1:1 relationship with `ProjectEvidence`, owns the consumable observation payload. The first implementation supports **text payload only**. `ProjectEvidence` and its `ProjectEvidenceObservation` must be created atomically, in a real database transaction boundary. Duplicate identity for this model is based on content identity/hash, never on `collectedAt`. Structured payload, object storage, binary/multimodal evidence, the final inline-size threshold, and erasure/redaction remain explicitly deferred and unresolved by this decision.

## Observation Ownership

`ProjectEvidence` owns, unchanged from Slice 4B:

- stable evidence identity;
- project/owner scope;
- source kind;
- reference;
- acquisition provenance (adapter identity/version, collection time, verification metadata);
- supersession linkage (`supersedesId`).

`ProjectEvidenceObservation` is a new, separate aggregate:

- 1:1 with `ProjectEvidence`;
- owns the consumable observation payload;
- immutable — no update path, ever;
- owner/project-scoped, identically to `ProjectEvidence`;
- **is not** `ProjectContext` — it carries what was observed, not what it means;
- **is not** interpretation — Acquisition and this aggregate perform zero interpretation, unchanged from `project-evidence-acquisition.md` §4;
- **is not** execution authority — no evidence payload grants, implies, or derives execution authority;
- **is not** memory truth — conversational memory remains categorically outside this model, unchanged from `project-domain.md` §6.

## Initial Text Payload Scope

The first implementation of `ProjectEvidenceObservation` supports only:

- a bounded UTF-8 text field for the observed content;
- MIME type;
- byte length;
- content hash (SHA-256, the same standard already used for `ProjectEvidence.sourceRevision`);
- an optional, structured Git revision field (a typed column, not free text — correcting the `notes`-embedded convention used experimentally in the uncommitted Repository Documents Adapter diff).

This implementation explicitly does **not** implement structured JSON payload, binary artifact storage, or object storage. Those remain deferred (see "Deferred Decisions").

## Atomic Persistence

`ProjectEvidence` and `ProjectEvidenceObservation` must succeed or fail together. Two independent, sequential client-side inserts are not an acceptable implementation — a failure between the two calls must never leave an evidence record without its observation, or an observation without its evidence record. Implementation must use a real database transaction boundary (a Postgres function/RPC invoked as a single call, or a repository-layer equivalent that provides the same atomicity guarantee), not application-level try/catch across two separate round trips.

## Duplicate Identity

Content identity/hash participates in duplicate detection for this model. `collectedAt` must not define duplicate identity — a wall-clock timestamp difference alone must never allow two rows carrying identical observed content, for the same project/source/reference, to both be treated as distinct evidence. Unchanged content may be treated as unchanged (no new record required). Changed content at the same reference creates new evidence. Copied content at different references remains distinct evidence, even when the content hash is identical.

## Context Rebuild Contract

The future Context Rebuild service:

- **may** read `ProjectEvidence` and its `ProjectEvidenceObservation`;
- **may** read SmartFlow-owned, already-persisted payload;
- **may not** fetch the original repository file directly;
- **may not** call a provider API directly;
- **may not** infer or derive execution authority from any evidence payload.

This restates, and does not weaken, `project-evidence-acquisition.md` §22.

## Security and Immutability

Observation payload is private project data. Owner/project isolation is mandatory, mirroring `ProjectEvidence`'s existing RLS model exactly. There is no update path. There is no generic delete path in the initial implementation — erasure remains a separately deferred decision (§25 of `project-evidence-acquisition.md`, unchanged by this ADR). No client-supplied owner authority is accepted; ownership is resolved from the trusted authentication boundary, exactly as `projectEvidenceService.ts` already does for `ProjectEvidence` itself. No credentials or tokens should be persisted in payload content by design — unchanged from `project-evidence-acquisition.md` §21. Content validation and size limits are required at the point of acquisition, not only at persistence.

## Consequences

- The next implementation slice ("ProjectEvidence Observation Foundation") may proceed against this decision without further Product Owner sign-off on the payload-ownership, atomicity, and duplicate-identity questions specifically.
- The existing `project_evidence` candidate-fingerprint semantics (currently keyed in part on `collectedAt`) must be corrected to be content-hash-based as part of that same slice — this is a breaking change to already-committed Slice 4B behavior and must be implemented and reviewed as one, not silently folded into an unrelated change.
- The uncommitted Repository Documents Adapter diff remains blocked on this decision: it must be updated to populate `ProjectEvidenceObservation`'s text payload once that aggregate exists, and its `notes`-embedded Git revision convention must be replaced by the structured field named above.
- No object storage, binary adapter, or Context Rebuild implementation is authorized by this ADR.

## Deferred Decisions

Recorded without resolution — listing them here does not schedule or authorize work on any of them:

- structured JSON payload;
- object storage;
- binary/PDF/image/audio/video artifacts;
- the final inline-size threshold;
- payload erasure/redaction;
- tombstones;
- 1:many observation cardinality;
- cross-project observation sharing;
- multimodal processing;
- OCR/transcription;
- Context Rebuild implementation itself.

## Non-Goals

This ADR does not:

- redesign the whole `ProjectEvidence` Acquisition architecture (`project-evidence-acquisition.md` remains canonical and unchanged, except as this ADR narrowly extends its payload model);
- authorize any code, migration, or UI change — it is a documentation-only decision record;
- resolve any item listed under "Deferred Decisions";
- change `ProjectRecord`, `ProjectContext`, `ProjectContextBuilder`, Execution Lifecycle, or Project Workspace semantics;
- approve Context Rebuild, Project Brief, or Smart Automation work of any kind.

## Supersession and Change Control

Per [ADR-0001](ADR-0001-architecture-decision-record-policy.md): this ADR's number is permanent, it represents current architecture only while Accepted, and a changed decision requires a new ADR that marks this one Superseded — it must not be edited in place.

## Related Documents

- [ADR-0001: Architecture Decision Record Policy](ADR-0001-architecture-decision-record-policy.md)
- [ADR-0006: Canonical Product Identity](ADR-0006-canonical-product-identity.md)
- [Project Domain](../../architecture/project-domain.md)
- [ProjectEvidence Acquisition](../../architecture/project-evidence-acquisition.md)
- [PROJECT_STATUS.md](../../../PROJECT_STATUS.md)
