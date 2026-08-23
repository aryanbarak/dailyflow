# ADR-0008: Tiered Change Governance

- **Status:** Accepted
- **Date:** 2026-08-07
- **Accepted:** 2026-08-07
- **Decision Makers:** Product Owner (Aryan Barakzai) — decision; Claude Code —
  drafting and documentation only
- **Supersedes:** None
- **Superseded by:** None

---

## Context

ADR-0001 established a single uniform process: an ADR is required for any
decision affecting architecture, infrastructure, security, backend/API
design, or long-term maintainability, and "implementation must not start
before the relevant ADR is Accepted." In practice, SmartFlow's actual review
discipline has always been finer-grained than that: some slices (e.g.
`ProjectRecord` Foundation, Slice 4B `ProjectEvidence`) explicitly went
through an independent review before being recorded as complete, while
others were recorded as "implemented" the moment code existed, with review
deferred to a later, separate step.

The concrete incident that motivates this ADR: **Project Brief Foundation**
(`src/features/projects/projectBriefService.ts` and its five extractors) was
committed to `main` in `fa8e923` while `PROJECT_STATUS.md` still described
it as "implemented, uncommitted, pending independent review" — a status that
was true when written and then never corrected after the commit landed.
Around the same time, **Sprint 1 Deliverable 4** (Projects discoverability:
`src/pages/ProjectsIndexPage.tsx`, the Sidebar entry) was committed and
merged to `main` in `b16f18f` and integrated into a live route, while
`PROJECT_STATUS.md` described it as "implemented, uncommitted." Neither of
these was a security incident or a wrong decision — both slices' own commits
carry evidence of real, careful engineering (see
`docs/status/reconciliation-2026-08.md`). The problem is process-shaped, not
outcome-shaped: work that ADR-0001's own text says should not start before
an Accepted ADR, and that this project's own convention has been to
independently review before calling "complete," merged to `main` without
that review having visibly happened, and the status document kept saying
"pending review" for entries that were, by git evidence, already merged.
This is evidence that the uniform, one-size-fits-all process was being
bypassed in practice for lower-risk, internal, read-only work — not because
anyone decided to skip it, but because the process itself does not
distinguish a durable persistence/RLS boundary (rightly slow and reviewed)
from a pure read-only derived-data composition (treated the same way in
theory, but not in observed practice).

A process that is bypassed in practice for an entire class of work is worse
than a process that formally permits a faster path for that class of work:
the former has no visibility and no accountability for the gap; the latter
at least makes the fast path an explicit, inspectable decision.

## Problem

Without a tiered process:

- Low-risk, read-only, internally-scoped work is either slowed to the same
  review bar as a schema/security change (discouraging small, frequent
  slices), or the bar is quietly not applied (as happened here), with no
  record of which occurred.
- There is no documented, agreed line between "this needs an ADR and review
  before merge" and "this needs tests and a status update after merge."
- Localization/RTL validation is treated identically for a security-boundary
  UI change and a pure internal refactor, with no stated reason either way.
- The gap between "recorded as pending review" and "merged to main" can grow
  indefinitely with nothing forcing it to close, exactly as happened with
  Project Brief Foundation and Sprint 1 Deliverable 4.

## Options Considered

| Option | Description | Reason not chosen |
|--------|-------------|-------------------|
| Keep ADR-0001's uniform process for everything | One process, one bar, no exceptions | Already shown not to hold in practice for low-risk work (see Context); produces either bottlenecks or silent bypass, not a real choice between them |
| Informal, undocumented judgment call per slice | Let each task's implementer decide what level of review it needs | No traceability, no consistency, no way to tell in six months whether a given slice's process was a considered choice or an oversight — the same failure mode as the incident this ADR responds to |
| Tiered governance, explicitly scoped by risk | Three tiers, defined by concrete criteria (external effect, schema/security boundary, durable-truth promotion vs. internal read-only composition), with an explicit tie-break-up rule | **Chosen** — keeps the full ADR-0001 process for the changes that actually carry irreversible or security-relevant risk, while giving low-risk internal work an explicit, inspectable fast path instead of an unspoken one |

## Decision

This ADR proposes three governance tiers. It does not weaken ADR-0001's
process for anything currently in Tier 1 below — it only makes explicit that
not everything is Tier 1, and defines a tie-break rule that defaults to the
stricter tier whenever a change's classification is unclear.

### Tier 1 — full current process (ADR-0001, unchanged)

Design/ADR required, and independent review must happen **before merge**.
Applies to:

- Any write that reaches an external system (GitHub mutation, future
  Gmail/Calendar/provider writes).
- Any new or changed write tool, or any change to approval authority
  (`SUPPORTED_WRITE_TOOL_IDS`, the Tool Registry's write definitions,
  `writeRuntime.ts`, `executionPolicy.ts`, approval-binding logic).
- Any schema or migration change (`supabase/migrations/`).
- Any security, RLS, or auth boundary (RLS policies, `SECURITY DEFINER`
  functions, Supabase Auth/session handling, secret handling).
- Provider strategy (which external provider is used, how, and under what
  credential model).
- Anything touching Smart Automation or Smart Personas ownership boundaries.
- Durable user-truth semantics — including any promotion of inferred or
  derived content (an LLM extraction, a Project Brief field, an evidence
  observation) toward canonical, authoritative state.

### Tier 2 — short design note + full tests; review may follow merge

A short design note in the PR/task description, and the full test suite
passing, are required before merge. Independent review may happen **after**
merge, within a stated window (recommended default: before the next Tier 1
or Tier 2 change in the same module, and no later than 5 working days).
Applies to:

- Internal derived read-only services and read models (e.g. `ProjectBrief`-
  class work: deterministic extraction/composition over already-persisted,
  already-owned data).
- New read tools.
- Deterministic composition/adapters that write nothing external (e.g. the
  Repository Documents Adapter's read side, `EvidenceSnapshot` construction).

### Tier 3 — tests + status update only

Full tests passing and a `PROJECT_STATUS.md` update are required; no design
note, no independent review. Applies to:

- UI over existing data (no new data path, no new authority).
- Documentation.
- Refactors that change no behavior and no boundary.

### Tie-break rule

If a change's tier is genuinely ambiguous — it plausibly fits two tiers, or
a reviewer and implementer disagree — it is treated as the **stricter**
(lower-numbered) tier until the Product Owner explicitly reclassifies it.
Silence or uncertainty never resolves toward the faster path.

### Security invariants are never tiered away

Tier 2 and Tier 3 classification governs *when* review happens and *how
much* design documentation precedes merge. It never exempts a change from:

- Security invariants (authority boundaries, approval-gating, execution
  policy).
- RLS enforcement.
- Secret handling.
- Fail-closed behavior on any ambiguous, malformed, or unauthorized input.

A Tier 2 or Tier 3 change that would touch any of the above is, by
definition, not Tier 2 or Tier 3 — see the tie-break rule.

### Localization/RTL validation

For Tier 1 changes that are user-facing/UI-facing, the existing per-slice
English/German/Persian and RTL validation (`PROJECT_STATUS.md` §7–§8
historically, per-slice in QA strategy) remains a per-slice gate, unchanged.
For Tier 2 and Tier 3 work, localization/RTL validation becomes a periodic
pass (recommended: at each Tier 1 UI milestone, not per Tier 2/3 slice)
rather than a gate on every individual slice — most Tier 2/3 work is
internal or read-model work with no new user-facing surface to validate.

## Implementation Notes

Added 2026-08-08 (task `5c`, governance addendum F4), per a direct Product
Owner instruction issued during that session. Additive only — it codifies a
rule about how this ADR (and every other Accepted ADR) is to be treated
going forward; it does not reword, weaken, or reopen anything in the
Decision or Consequences sections above.

**Dissent rule (Product Owner, 2026-08-08).** Accepted status means a
decision is current and binding — not beyond criticism. Any agent
(coordinator, implementer, reviewer) who identifies a problem in an
Accepted decision — this ADR or any other — must record the concern for
the Product Owner: state it plainly, with the specific decision text and
the specific problem, in whatever surface the agent is already reporting
through (a task's final report, a review document, `PROJECT_STATUS.md`,
or a new ADR's own Context section proposing reconsideration). Until a new
decision is recorded resolving that concern, **the current decision
stands** and continues to govern all work, exactly as ADR-0001 and this
ADR's own tiering already require.

**The boundary this rule draws, stated explicitly:** dissent is mandatory
to *record* — silently complying with a decision an agent believes is
wrong, without ever surfacing that belief, is itself a process failure
this rule exists to prevent — but recording dissent is never a license to
*deviate* from the current decision while it stands. An agent may not
substitute its own judgment for the Product Owner's recorded decision, on
the theory that its dissent was noted; noting the concern and continuing
to follow the decision are both required, not alternatives to choose
between. This mirrors, one layer up, the same discipline ADR-0009/ADR-0010
already apply to model output: a proposal may be recorded and surfaced,
but it does not become authoritative, and does not override existing
authoritative state, merely by having been raised.

## Consequences

- Project Brief Foundation and Sprint 1 Deliverable 4 (the incident in
  Context) would both classify as **Tier 2** under this ADR — internal,
  read-only, derived-data composition with no external write and no schema/
  security boundary — meaning their actual process (implement, test, defer
  review) was closer to appropriate than ADR-0001's uniform text implied;
  the retroactive independent review already scheduled as next agreed work
  (`PROJECT_STATUS.md` §5) satisfies this ADR's Tier 2 post-merge review
  requirement for both, once accepted.
- The following existing documents state or assume the uniform ADR-0001
  process and would need updating if this ADR is Accepted (not edited by
  this task — listed here per the coordinator's explicit instruction to
  record, not implement, this consequence):
  - `docs/roadmap/project-workspace-implementation-roadmap-v1.md` §12 (QA
    Strategy) — currently states a single regression/testing bar with no
    tiering.
  - `docs/governance/github-workflow.md` — currently describes one
    Ready → In Progress → Review → Done flow with no tier distinction.
- No existing Tier 1 change's process changes. This ADR narrows nothing
  about schema, security, RLS, provider, or external-write review — it only
  makes explicit, for the first time, that a class of internal read-only
  work was already, in practice, not going through that full process.
- This ADR was Accepted by the Product Owner on 2026-08-07. From this date,
  the tiered process in this ADR governs new work; it does not retroactively
  reclassify or reopen anything merged before acceptance beyond what
  "Next agreed work" (`PROJECT_STATUS.md` §5) already schedules.

## Amendments (2026-08-22)

Four governance items decided in the same working session as ADR-0018
("Capability-Oriented AI Provider Abstraction") are recorded here as
amendments to this ADR's process. See ADR-0018 §8 ("Governance amendments")
for the full text and rationale — not restated here, to avoid two copies of
the same rule drifting apart:

1. Branch commits.
2. No amend/force-push after a PR is open.
3. Production deploy path.
4. "Environment-only failure" is not a valid label without a clean-environment run.

## Related ADRs

- [ADR-0001: Architecture Decision Record Policy](ADR-0001-architecture-decision-record-policy.md) — the uniform process this ADR proposes tiering, not replacing.
- [ADR-0004: Write Boundaries](ADR-0004-write-boundaries.md), [ADR-0005: EPIC-08 Code Write Mutation Boundary](ADR-0005-code-write-mutation-boundary.md) — examples of the Tier 1 external-write review this ADR leaves fully intact.
- [ADR-0007: ProjectEvidence Observation Model](ADR-0007-projectevidence-observation-model.md) — an example of Tier 1 durable-truth-semantics review this ADR leaves fully intact.
