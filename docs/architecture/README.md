# SmartFlow Architecture

This folder contains architecture documents for SmartFlow. It includes current
implementation context, approved integration designs, conceptual architecture,
and historical baselines.

## Current Implementation

- [current-architecture.md](current-architecture.md) - canonical current implementation architecture.
- [authority-model.md](authority-model.md) - canonical authority model governing observation, reasoning, approval, execution, audit, and delegation boundaries.
- [../PROJECT_STATUS.md](../../PROJECT_STATUS.md) - current project status and implementation notes.
- [Generated architecture knowledge](../../.knowledge/docs/02_architecture.md) - generated current architecture context when present.

## Approved Integration References

- [github-read-only-integration-v1.md](github-read-only-integration-v1.md) - bounded GitHub App read-only integration architecture for Slice 1.

## Historical / Baseline

- [01-architecture-baseline.md](01-architecture-baseline.md) - draft early stabilization baseline from 2026-07-06. This is not labeled current architecture.

## Remaining Planned Canonical Architecture

Future canonical architecture documents must be created in this order because
each document depends on the current architecture baseline, the authority model,
and the one before it:

- `execution-intent.md`
- `smartflow-smart-automation-boundary.md`
- `target-architecture.md`
- `representative-engine.md`
- `agent-orchestration.md`

`current-architecture.md` and `authority-model.md` are the baseline for the
remaining planned architecture documents. Do not create the remaining planned
files until their content has been established through architecture discussion
and, where needed, an ADR.

## Rules

- Architecture documents describe system design, boundaries, and consequences.
- Significant architectural decisions require an ADR in [../decisions/adr/](../decisions/adr/).
- Future architecture must be labeled Planned or Conceptual until implemented or formally approved.
- Architecture must lead implementation. Runtime code and implementation prompts
  should follow approved architecture rather than becoming the source of truth.
