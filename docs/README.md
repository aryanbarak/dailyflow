# SmartFlow Documentation

This is the top-level entry point for SmartFlow project documentation.

Repository documentation is the complete source of record, including current
material, planned work, historical context, working notes, and evidence.
The SmartFlow ChatGPT Project should use only the canonical decision context
listed below.

## Canonical Project Context

Use this minimal set when updating the SmartFlow ChatGPT Project knowledge.

- Repository/project overview: [../README.md](../README.md)
- Product vision: [design/vision/SMARTFLOW_PRODUCT_BIBLE.md](design/vision/SMARTFLOW_PRODUCT_BIBLE.md)
- Product direction: [product/product-direction-v1.md](product/product-direction-v1.md)
- Current project status: [../PROJECT_STATUS.md](../PROJECT_STATUS.md)
- Current architecture: planned documentation; current implementation context is partly tracked in [../PROJECT_STATUS.md](../PROJECT_STATUS.md)
- Target architecture: planned documentation
- Roadmap: [roadmap/product-roadmap.md](roadmap/product-roadmap.md)
- ADR index: [decisions/adr/README.md](decisions/adr/README.md)
- Representative Engine architecture: planned documentation
- Agent Orchestration architecture: planned documentation
- Authority Model: planned documentation
- SmartFlow-Smart Automation boundary: planned documentation
- GitHub read-only integration architecture: [architecture/github-read-only-integration-v1.md](architecture/github-read-only-integration-v1.md)

Rule: repository documentation is complete documentation and history; ChatGPT
Project knowledge is canonical decision context only.

## Documentation Structure

- [overview/](overview/) - high-level project overview material.
- [product/](product/) - product direction and approved product framing.
- [architecture/](architecture/) - technical architecture, baselines, integrations, and historical architecture context.
- [decisions/](decisions/) - ADRs and non-architectural decision logs.
- [design/](design/) - product bible, UX architecture, visual system, experience docs, and design artifacts.
- [ai/](ai/) - AI-specific notes and architecture context.
- [roadmap/](roadmap/) - product and implementation planning.
- [governance/](governance/) - process and workflow governance.
- [standards/](standards/) - documentation and knowledge standards.
- [testing/](testing/) - QA plans, validation notes, and evidence.
- [reference/](reference/) - supporting lookup material and external references.
- [templates/](templates/) - reusable documentation templates.

## Knowledge vs Reference

No dedicated `docs/knowledge/` folder exists yet. If created later,
`knowledge/` should hold SmartFlow's canonical concepts, vocabulary, context
model, and representative knowledge architecture. `reference/` remains for
external systems, APIs, commands, and lookup material.

## State Labels

Documentation should clearly label material as one of: Implemented, Current,
Approved, Planned, Conceptual, Historical, Superseded, or Draft.

Personal Digital Representative is SmartFlow's Accepted canonical product
identity as of [ADR-0006](decisions/adr/ADR-0006-canonical-product-identity.md)
(2026-08-01) — it is no longer an open future concept. The *identity decision*
is Accepted; the underlying capabilities (rich personal knowledge/memory,
decision-pattern modelling, broader delegated operation, voice/avatar
presentation) remain future concepts and, like Representative Engine, broad
agent orchestration, or delegated Smart Automation execution, must not be
presented as implemented unless a current canonical document and the
implementation both prove that state.

## Documentation Principles

- Every document has a single canonical location.
- Major folders use `README.md` as their index.
- Avoid parallel index conventions such as `*_INDEX.md`.
- ADRs live in [decisions/adr/](decisions/adr/).
- Decision logs live in [decisions/decision-logs/](decisions/decision-logs/).
- Major architectural changes require an ADR.
- Standards take precedence over informal notes.
- Documentation should evolve together with the codebase.
