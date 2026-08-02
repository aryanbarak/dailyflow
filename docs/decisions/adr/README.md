# Architecture Decision Records

This is the canonical ADR directory for SmartFlow.

ADRs document significant architectural decisions, their context, alternatives,
rationale, consequences, and implementation impact. ADR numbers are permanent
and must not be reused.

## Current ADRs

- [ADR-0000: Template](ADR-0000-template.md)
- [ADR-0001: Architecture Decision Record Policy](ADR-0001-architecture-decision-record-policy.md) - Accepted
- [ADR-0002: Flow AI Presence Architecture](ADR-0002%20—%20Flow%20AI%20Presence%20Architecture.md) - Accepted
- [ADR-0003: /agent/reason Remains Local-QA-Only](ADR-0003-agent-reason-local-qa-only.md) - Accepted
- [ADR-0004: Write Boundaries for SmartFlow GitHub Integration](ADR-0004-write-boundaries.md) - Accepted
- [ADR-0005: EPIC-08 Code Write Mutation Boundary](ADR-0005-code-write-mutation-boundary.md) - Accepted
- [ADR-0006: Canonical Product Identity](ADR-0006-canonical-product-identity.md) - Accepted
- [ADR-0007: ProjectEvidence Observation Model](ADR-0007-projectevidence-observation-model.md) - Accepted

## ADR vs Decision Log

Use an ADR for decisions that affect architecture, infrastructure, security,
backend/API design, data boundaries, AI architecture, deployment, or long-term
maintainability.

Use [decision logs](../decision-logs/) for product, process, UX, naming, or
organizational decisions that do not require a formal architecture record.

## Historical Path References

Canonical ADRs now live under `docs/decisions/adr/`. Some historical migration
comments may still reference the former `docs/adr/` location; those migrations
remain intentionally unchanged.

## Rules

- ADR numbers are permanent.
- ADRs must not be deleted.
- Do not renumber accepted ADRs.
- If a decision changes, create a new ADR and mark the older ADR Superseded.
- Only Accepted ADRs represent current architecture.
