# SmartFlow Architecture

This folder contains architecture documents for SmartFlow. It includes current
implementation context, approved integration designs, conceptual architecture,
and historical baselines.

## Current Implementation

- [../PROJECT_STATUS.md](../../PROJECT_STATUS.md) - current project status and implementation notes.
- [Generated architecture knowledge](../../.knowledge/docs/02_architecture.md) - generated current architecture context when present.

## Approved Integration References

- [github-read-only-integration-v1.md](github-read-only-integration-v1.md) - bounded GitHub App read-only integration architecture for Slice 1.

## Historical / Baseline

- [01-architecture-baseline.md](01-architecture-baseline.md) - draft early stabilization baseline from 2026-07-06. This is not labeled current architecture.

## Planned Canonical Architecture

The following canonical documents are planned and should be added only when
their content is established:

- `current-architecture.md`
- `target-architecture.md`
- `representative-engine.md`
- `agent-orchestration.md`
- `authority-model.md`
- `knowledge-model.md`
- `smartflow-smart-automation-boundary.md`

## Rules

- Architecture documents describe system design, boundaries, and consequences.
- Significant architectural decisions require an ADR in [../decisions/adr/](../decisions/adr/).
- Future architecture must be labeled Planned or Conceptual until implemented or formally approved.
