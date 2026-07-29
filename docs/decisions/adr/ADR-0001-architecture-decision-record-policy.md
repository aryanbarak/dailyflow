# ADR-0001: Architecture Decision Record (ADR) Policy

- **Status:** Accepted
- **Date:** 2026-07-06
- **Decision Makers:** Product Owner, Software Architect
- **Supersedes:** None
- **Superseded by:** None

---

## Context

SmartFlow has grown into a large AI-powered Life Operating System with multiple modules, services, and deployment environments.

As the project expands, architectural decisions must remain consistent, documented, and traceable. Relying on chat history or personal memory is no longer sufficient.

To improve maintainability and reduce architectural drift, SmartFlow adopts Architecture Decision Records (ADRs) as the official method for documenting major technical decisions.

---

## Problem

Without a formal decision process:

- Architectural decisions become inconsistent.
- Documentation drifts over time.
- Previous decisions are forgotten or repeated.
- New contributors lack historical context.
- Large refactoring becomes difficult to justify.

---

## Options Considered

| Option | Description | Reason not chosen |
|--------|-------------|-------------------|
| Chat history only | Rely on Claude/ChatGPT conversation history | Not persistent, not searchable, lost between sessions |
| README only | Document decisions in README | Gets too long, no lifecycle management, no traceability |
| Wiki / Notion | External documentation tool | Adds dependency, disconnected from codebase |
| ADR system | Structured decision records in `docs/decisions/adr/` | **Chosen** — traceable, scalable, lives in the repo |

---

## Decision

SmartFlow will use Architecture Decision Records (ADRs) to document all significant architectural decisions.

An ADR is required whenever a decision affects the project's architecture, infrastructure, development workflow, security, or long-term maintainability.

Each ADR must be stored in:

```
docs/decisions/adr/
```

Each ADR follows this standard template:

```markdown
# ADR-XXXX: Title

- Status: Proposed | Accepted | Superseded | Deprecated
- Date: YYYY-MM-DD
- Decision Makers: ...
- Supersedes: ...
- Superseded by: ...

## Context
## Problem
## Options Considered
## Decision
## Consequences
## Related ADRs
```

---

## ADR Lifecycle

Every ADR must have one of the following statuses:

| Status | Meaning |
|--------|---------|
| **Proposed** | Under review, not yet implemented |
| **Accepted** | Current architecture — implementation must follow this ADR |
| **Superseded** | Replaced by a newer ADR (reference the new ADR) |
| **Deprecated** | No longer applicable, not replaced |

Only **Accepted** ADRs represent the current architecture.

---

## Numbering

ADRs use sequential four-digit numbering.

Examples:
- `ADR-0001`
- `ADR-0002`
- `ADR-0003`

Numbers are **never reused**, even if an ADR is deprecated or superseded.

File naming convention:
```
ADR-XXXX-short-title-in-kebab-case.md
```

---

## When is an ADR Required?

An ADR is required for decisions involving:

- Architecture and system design
- Backend and API design
- Database schema and migration workflow
- Security and authentication
- AI Worker architecture
- AI provider strategy
- Deployment and infrastructure
- Caching strategy
- Offline and PWA strategy
- State management
- Major third-party libraries
- Development workflow changes

Minor implementation details, bug fixes, and UI changes do **not** require an ADR.

---

## Ownership

| Role | Responsibility |
|------|---------------|
| Product Owner | Approves all architectural decisions |
| Software Architect | Prepares and reviews ADRs before implementation |
| Implementation Lead (Claude) | Implements according to accepted ADRs |

**Implementation must not start before the relevant ADR is Accepted.**

---

## Consequences

**Benefits:**
- Consistent architecture across the project lifetime
- Better project governance and decision traceability
- Easier onboarding for new contributors or AI assistants
- Clear historical record of why decisions were made
- Reduced technical debt from ad-hoc decisions
- Better long-term maintainability

**Trade-offs:**
- Slightly more documentation work before implementation
- Architectural decisions require review before proceeding
- ADRs must be kept up to date when decisions change

---

## Related ADRs

None — this is the founding ADR that defines the ADR process itself.
