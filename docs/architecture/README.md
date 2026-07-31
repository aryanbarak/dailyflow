# SmartFlow Architecture

This folder contains architecture documents for SmartFlow. It includes current
implementation context, approved integration designs, conceptual architecture,
and historical baselines.

## Current Implementation

- [current-architecture.md](current-architecture.md) - canonical current implementation architecture.
- [authority-model.md](authority-model.md) - canonical authority model governing observation, reasoning, approval, execution, audit, and delegation boundaries.
- [execution-intent.md](execution-intent.md) - canonical execution intent model governing exact executable meaning, approval binding, policy binding, freshness, replay, and audit correlation.
- [smartflow-smart-automation-boundary.md](smartflow-smart-automation-boundary.md) - canonical boundary between SmartFlow and Smart Automation responsibility, authority, intent, execution, credentials, policy, approval, result, and audit ownership.
- [target-architecture.md](target-architecture.md) - canonical target architecture defining SmartFlow's intended layered end-state, direct/delegated execution model, state and memory boundaries, audit, persistence, observability, and evolution constraints.
- [representative-engine.md](representative-engine.md) - canonical target contract for bounded, explainable workspace and project representation, prioritization, recommendation, provenance, and context assembly.
- [project-domain.md](project-domain.md) - canonical Project Domain architecture defining ProjectRecord, ProjectEvidence, ProjectContextBuilder, ProjectContext, and Project Workspace ownership boundaries, and their complete separation from the Execution Lifecycle.
- [agent-orchestration.md](agent-orchestration.md) - canonical target contract for bounded orchestration of reasoning, planning, proposal, intent, policy, approval, execution ownership, verification, audit, and explanation.
- [../PROJECT_STATUS.md](../../PROJECT_STATUS.md) - current project status and implementation notes.
- [Generated architecture knowledge](../../.knowledge/docs/02_architecture.md) - generated current architecture context when present.

## Approved Integration References

- [github-read-only-integration-v1.md](github-read-only-integration-v1.md) - bounded GitHub App read-only integration architecture for Slice 1.

## Historical / Baseline

- [01-architecture-baseline.md](01-architecture-baseline.md) - draft early stabilization baseline from 2026-07-06. This is not labeled current architecture.

## Canonical Architecture Sequence

The canonical architecture sequence is complete:

1. `current-architecture.md`
2. `authority-model.md`
3. `execution-intent.md`
4. `smartflow-smart-automation-boundary.md`
5. `target-architecture.md`
6. `representative-engine.md`
7. `project-domain.md`
8. `agent-orchestration.md`

`project-domain.md` is placed after `representative-engine.md` because it is
a concrete domain instantiation of the general workspace/project
representation contract that document already defines (provenance,
freshness, project isolation), and before `agent-orchestration.md` because
that document's future orchestration work may consume Project Domain output
the same way it may consume Representative Engine output, and must not
bypass either.

Future canonical architecture documents require architecture discussion and,
where needed, an ADR.

## Rules

- Architecture documents describe system design, boundaries, and consequences.
- Significant architectural decisions require an ADR in [../decisions/adr/](../decisions/adr/).
- Future architecture must be labeled Planned or Conceptual until implemented or formally approved.
- Architecture must lead implementation. Runtime code and implementation prompts
  should follow approved architecture rather than becoming the source of truth.
