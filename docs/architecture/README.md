# SmartFlow Architecture

This folder contains architecture documents for SmartFlow. It includes current
implementation context, approved integration designs, conceptual architecture,
and historical baselines.

SmartFlow's canonical product identity — Personal Digital Representative — is
recorded in [ADR-0006: Canonical Product Identity](../decisions/adr/ADR-0006-canonical-product-identity.md)
(Accepted). The architecture sequence below is compatible with, and was
already serving, that identity before it was formally named.

## Current Implementation

- [current-architecture.md](current-architecture.md) - canonical current implementation architecture.
- [authority-model.md](authority-model.md) - canonical authority model governing observation, reasoning, approval, execution, audit, and delegation boundaries.
- [execution-intent.md](execution-intent.md) - canonical execution intent model governing exact executable meaning, approval binding, policy binding, freshness, replay, and audit correlation.
- [smartflow-smart-automation-boundary.md](smartflow-smart-automation-boundary.md) - canonical boundary between SmartFlow and Smart Automation responsibility, authority, intent, execution, credentials, policy, approval, result, and audit ownership.
- [target-architecture.md](target-architecture.md) - canonical target architecture defining SmartFlow's intended layered end-state, direct/delegated execution model, state and memory boundaries, audit, persistence, observability, and evolution constraints.
- [representative-engine.md](representative-engine.md) - canonical target contract for bounded, explainable workspace and project representation, prioritization, recommendation, provenance, and context assembly.
- [project-domain.md](project-domain.md) - canonical Project Domain architecture defining ProjectRecord, ProjectEvidence, ProjectContextBuilder, ProjectContext, and Project Workspace ownership boundaries, and their complete separation from the Execution Lifecycle.
- [project-evidence-acquisition.md](project-evidence-acquisition.md) - canonical architecture for how ProjectEvidence enters SmartFlow: Evidence Source Adapters, acquisition attempts, provenance, immutable evidence persistence, and the boundary to the future Context Rebuild service and to Smart Automation.
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
8. `project-evidence-acquisition.md`
9. `agent-orchestration.md`

`project-domain.md` is placed after `representative-engine.md` because it is
a concrete domain instantiation of the general workspace/project
representation contract that document already defines (provenance,
freshness, project isolation), and before `agent-orchestration.md` because
that document's future orchestration work may consume Project Domain output
the same way it may consume Representative Engine output, and must not
bypass either.

`project-evidence-acquisition.md` is placed directly after `project-domain.md`
because it specializes exactly one concept that document names but does not
fully design (`ProjectEvidence`, `project-domain.md` §6) and must be read as
that document's direct continuation, not as an independent domain. It is
placed before `agent-orchestration.md` for the same reason `project-domain.md`
is: a future orchestrator may consume evidence-backed `ProjectContext` output
and must not bypass the acquisition boundary that produced the evidence
behind it.

Future canonical architecture documents require architecture discussion and,
where needed, an ADR.

## Rules

- Architecture documents describe system design, boundaries, and consequences.
- Significant architectural decisions require an ADR in [../decisions/adr/](../decisions/adr/).
- Future architecture must be labeled Planned or Conceptual until implemented or formally approved.
- Architecture must lead implementation. Runtime code and implementation prompts
  should follow approved architecture rather than becoming the source of truth.
