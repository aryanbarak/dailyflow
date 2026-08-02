# Project Workspace — Implementation Roadmap v1

**Version:** 1.0
**Status:** Draft — for Product Owner and Architecture review
**Date:** 2026-07-28
**Derives from:**
[`docs/product/product-direction-v1.md`](../product/product-direction-v1.md) (v1.1,
Approved),
[`docs/design/ux/ux-architecture-v1.md`](../design/ux/ux-architecture-v1.md) (v1.1,
Draft),
[`docs/design/ux/project-workspace-wireframe-spec-v1.md`](../design/ux/project-workspace-wireframe-spec-v1.md)
(v1.1, Draft), and
[`docs/design/ux/project-workspace-low-fidelity-wireframes-v1.md`](../design/ux/project-workspace-low-fidelity-wireframes-v1.md)
(v1.0, Draft)
**Scope:** Implementation and migration planning only. No code, no schema, no routes, no
components, no visual design.

**Terminology note (added post Slice 2B/2B.1, not a rewrite of this roadmap):** this
document's "Project entity" (§2, §4, §6 S1, §9) is superseded in name only by
`ProjectRecord`, and "Project" used as a bare, undifferentiated noun elsewhere in this
document should be read as either `ProjectRecord` (identity/configuration) or
`ProjectContext` (derived state), per the canonical ownership model in
[`docs/architecture/project-domain.md`](../architecture/project-domain.md). This roadmap's
sequencing and slice content are not otherwise changed by that document; see its §18 for
the full reconciliation.

---

## 1. Purpose

The four canonical documents above define what the Project Workspace is, how it is
structured, and what each screen must contain. None of them says how the existing
SmartFlow codebase gets there. This roadmap closes that gap: it inventories what already
exists and is reusable, maps every approved Workspace area onto that existing system,
and sequences the remaining work into small, independently testable slices.

This is **not** a feature roadmap in the sense of `docs/roadmap/product-roadmap.md` — it
does not propose new capability beyond what the four canonical documents already
approved. It is a migration plan: how the current, already-shipped SmartFlow evolves
safely into that approved design, reusing what works and adding only what is missing.

---

## 2. Current Implementation State

Verified directly against the repository (`src/features/`, `src/pages/`, `src/App.tsx`),
not assumed from documentation alone:

| System | Where it lives | State |
|---|---|---|
| **Workspace Pipeline** | `src/features/workspace/` — `signalEngine.ts`, `memoryEngine.ts`, `interactionFeedbackEngine.ts`, `decisionIntelligenceEngine.ts`, `personalizationEngine.ts`, `priorityEngine.ts`, `goalEngine.ts`, `plannerEngine.ts`, `approvalEngine.ts`, `workspaceEngine.ts`, `useWorkspace.ts` | Fully implemented, tested, and in production per `PROJECT_STATUS.md` §4. |
| **Planner / Priority / Goal engines** | `plannerEngine.ts`, `priorityEngine.ts`, `goalEngine.ts` | Implemented; already produce a prioritized plan from workspace signals. |
| **Decision Intelligence** | `decisionIntelligenceEngine.ts` | Implemented: deterministic, input-only, read-only domain-level profiling — the closest existing pattern to a "Health" signal. |
| **Approval Model** | `src/features/agent/approvalInteraction.ts`, `src/features/workspace/components/StepApprovalDialog.tsx` | Implemented and shipped for `tasks.complete` and the two GitHub write tools. |
| **Execution** | `src/features/agent/executionEngine.ts`, `executionPolicy.ts`, `writeRuntime.ts`, `writeHandlers.ts` | Implemented; `SUPPORTED_WRITE_TOOL_IDS` currently covers `tasks.complete`, `github.issues.comment`, `github.issues.update` (ADR-0004). |
| **Audit** | `src/features/agent/executionAudit.ts` (in-memory, browser-tab-local, capped at 200) plus the durable `agent_write_log` Supabase table (ADR-0004) | Implemented; two complementary layers already exist — no third audit mechanism is needed. |
| **GitHub integration** | `agent/worker/github-integration.ts`, `src/features/integrations/github/*`, `src/features/agent/tools/githubTools.ts` | Implemented and live: four read tools (`github.repositories.list/issues.list/pulls.list/workflow_runs.list`) and two write tools (`github.issues.comment/update`), one connection per SmartFlow user. |
| **Dashboard (Home)** | `src/pages/Dashboard.tsx` | Implemented; presentation-only over a typed Workspace object, per `PROJECT_STATUS.md` §4 — no "Needs Attention" surface yet. |
| **Existing navigation** | `src/App.tsx` (routes), `src/components/layout/Sidebar.tsx`, `src/components/layout/MobileNav.tsx` | Implemented: a flat list of domain routes (`/`, `/chat`, `/tasks`, `/calendar`, `/habits`, `/journal`, `/finance`, `/family`, `/documents`, `/photos`, `/music`, `/settings`, plus Smart Academy's `/tutor/*`). No `/projects` route exists. |
| **Assistant** | `src/pages/ChatPage.tsx`, `src/features/agent/reasoning/*`, `contextSynthesis.ts`, `responseComposer.ts` | Implemented and live — the full reasoning → validation → resolution → execution → audit → response pipeline described in `PROJECT_STATUS.md` §5. |
| **Connections UI** | `src/features/integrations/github/GitHubIntegrationCard.tsx`, rendered inside `SettingsPage.tsx` | Implemented, but as a tab inside Settings, not yet a first-class Connections domain. |
| **"Project" as an entity** | — | Does not exist. Nothing today models a Project distinct from a connected GitHub repository. This is the one genuinely new domain concept this roadmap introduces. |

**Nothing here needs to be rewritten.** The Project Workspace is, almost entirely, a new
*composition* over systems that already work — not a replacement for any of them.

---

## 3. Migration Principles

- **Preserve working systems.** The Workspace Pipeline, Approval Model, Execution Engine,
  and Execution Audit are not touched in kind — only extended in scope, exactly as
  `CLAUDE.md`'s own architecture rules already require ("reuse existing services/functions
  before creating new ones... prefer extending the existing architecture over
  rebuilding").
- **Incremental delivery.** Every slice (§6) ships independently and adds a destination or
  a fact source without requiring any other slice to exist first, beyond its stated
  dependencies.
- **Backward compatibility.** Every existing route, page, and tool keeps working
  unchanged throughout; the Project Workspace is additive navigation and screens, not a
  replacement for Dashboard, Tasks, or Chat.
- **Feature slices, not phases.** Each slice in §6 is small enough to review and test on
  its own, per `CLAUDE.md`'s "make small, reviewable changes" rule.
- **Independent testability.** Every slice has its own completion criteria (§6) and its
  own test additions (§12) — no slice depends on a later slice's tests to be considered
  done.
- **Reversible changes.** Each slice is additive (a new composition, a new screen, a new
  navigation entry) rather than a destructive edit to an existing system, so any slice can
  be rolled back without affecting the systems it reused.
- **Documentation before implementation.** This roadmap itself follows that rule — it
  exists precisely so that no slice below starts without the four canonical documents
  already settled.

---

## 4. Architecture Mapping

Every Project Workspace area (Wireframe Spec §5–§17) mapped to its actual implementation
state.

| Workspace area | State | Reused from |
|---|---|---|
| Project entity (identity, objective, repository binding) | **New implementation required** | — (the one new domain concept, §9) |
| Project List / Project Overview | **New implementation required** | Presentation pattern reused from `Dashboard.tsx` (typed object → presentation, no business logic in the page) |
| Current Focus | **Partially exists** | `plannerEngine.ts`, `priorityEngine.ts`, `goalEngine.ts` already compute a prioritized plan; needs project-scoped adaptation, not a new engine |
| Recent Activity | **Partially exists** | Existing read tools (`github.issues.list`, `pulls.list`, `workflow_runs.list`) and `executionAudit.ts`; needs a new bounded, importance-filtered composition (§9 of the Wireframe Spec) |
| Health | **New implementation required** (composition), reusing an existing pattern | `decisionIntelligenceEngine.ts`'s deterministic, read-only, input-only style |
| Connections (project-scoped view) | **Partially exists** | `githubConnectionClient.ts`, `GitHubIntegrationCard.tsx` — the underlying connection is fully implemented; only a project-scoped presentation of it is new |
| Approval (multiple independent pending proposals) | **Partially exists** | `approvalInteraction.ts`, `StepApprovalDialog.tsx` review one proposal per interaction today; needs extension to list and independently resolve several at once, not a new approval mechanism |
| Execution | **Already exists** | `executionEngine.ts`, `executionPolicy.ts`, `writeRuntime.ts` — used as-is |
| Evidence & Verification | **Partially exists** | The underlying facts (read-tool output, audit records) already exist; the explicit four-way distinction (Wireframe Spec §14) as its own destination is new composition, not new data collection |
| History | **Partially exists** | `executionAudit.ts` and `agent_write_log` already hold everything History needs; a chronological, filterable read surface over them is new |
| Assistant (project-scoped context) | **Already exists**, needs new wiring | `ChatPage.tsx`, `contextSynthesis.ts`, reasoning pipeline — reused unchanged in kind; only project-context injection is new |
| Navigation (Projects as a Primary Navigation domain) | **New implementation required** | `Sidebar.tsx` / `MobileNav.tsx`'s existing route-array pattern, extended with one more entry |
| Home Needs Attention | **New implementation required** | Composition over each project's Health signal (once it exists) |

No area requires a new engine, a new safety mechanism, or a parallel execution/approval
system — every "new implementation" row above is a composition or a screen, never a
second Approval Model or a second Execution Engine.

---

## 5. Dependency Graph

Expressed as ordered layers — each layer depends only on layers above it, so no cycle is
possible.

```
Layer 0 (existing, unchanged)
  Workspace Pipeline · Planner/Priority/Goal engines · Decision Intelligence ·
  Approval Model · Execution Engine · Execution Audit · GitHub integration (read + write) ·
  Dashboard · existing navigation · Assistant/reasoning pipeline

        |
        v
Layer 1
  Project entity (S1)

        |
        v
Layer 2
  Project List / Project Overview, read-only (S2)

        |
        v
Layer 3
  Navigation integration — /projects route, Sidebar/MobileNav entry (S3)

        |
        v
Layer 4 (each depends on Layer 1-3, not on each other)
  Recent Activity (S4)  ·  Current Focus (S6)  ·  Connection Status/Details (S7)

        |
        v
Layer 5
  Health (S5) — depends on Recent Activity (S4) and Connection Status (S7)

        |
        v
Layer 6
  Approval Review, multi-proposal (S8) — depends on Project entity (S1) only,
  reuses existing Approval Model directly

        |
        v
Layer 7
  Execution Result / Evidence & Verification (S9) — depends on Approval Review (S8)
  and existing Execution Engine/Audit (Layer 0)

        |
        v
Layer 8
  History (S10) — depends on Execution Result existing (S9) as its primary event source

        |
        v
Layer 9 (each depends on Layer 4-8's facts existing, not on each other)
  Assistant project-context integration (S11)  ·  Home Needs Attention (S12) —
  depends on Health (S5) across whichever projects exist
```

No layer depends on a layer below it — the graph is acyclic by construction.

---

## 6. Feature Slices

Twelve slices, each independently testable.

**S1 — Project Entity**
*Objective:* introduce "Project" as a first-class, minimally persisted concept: a name,
an objective, and a binding to the existing single GitHub connection's repository
selection.
*Affected areas:* Project entity only (no UI).
*Dependencies:* none (Layer 0 only).
*Expected outcome:* a Project can be created and referenced by identifier; nothing reads
or writes to it yet.
*Completion criteria:* a Project record can be created, retrieved, and listed
programmatically; no schema or migration design is decided in this roadmap — that is a
separate, later engineering task.

*Status note (Slice 3, 2026-08-01):* the identity/configuration half of S1 —
create, read, list, update, and archive — is implemented as `ProjectRecord`
(`src/features/projects/projectRecordService.ts`), backed by the
`project_records` migration, per
[`docs/architecture/project-domain.md`](../architecture/project-domain.md)
section 5 and `PROJECT_STATUS.md`. S1's "objective" field is
`ProjectContext`-derived state (project-domain.md section 8), not
`ProjectRecord` configuration, and remains unbuilt — Project List/Overview UI
(S2) and a `ProjectContext` rebuild service both remain separate,
not-yet-scheduled work.

*Status note (Slice 4A, 2026-08-02):* the canonical architecture for how
evidence would eventually back a `ProjectContext` rebuild is now recorded in
[`docs/architecture/project-evidence-acquisition.md`](../architecture/project-evidence-acquisition.md)
(documentation only, pending review) — no evidence acquisition, adapter, or
`ProjectContext` rebuild service exists yet; this roadmap's S2 still depends
on that not-yet-scheduled work.

*Status note (Slice 4B, 2026-08-02):* the durable `ProjectEvidence`
persistence and validation half of that architecture is implemented
(`src/features/projects/projectEvidenceService.ts`, pending independent
review) — there is still no Evidence Source Adapter, no acquisition
service that reads a real source, and no `ProjectContext` rebuild service;
this roadmap's S2 remains unaffected and still depends on that not-yet-
scheduled work.

**S2 — Project List / Project Overview (read-only)**
*Objective:* render the list of Projects and, on selecting one, a read-only Overview:
identity/context (Wireframe Spec §7), connection status (via existing
`githubConnectionClient`), and a placeholder for Current Focus.
*Affected areas:* new frontend screens only.
*Dependencies:* S1.
*Expected outcome:* a user can see their Projects and open one to a real, if minimal,
Overview screen.
*Completion criteria:* Project List and Project Overview render from real Project and
connection data; no write action exists yet.

**S3 — Navigation Integration**
*Objective:* add Projects as a Primary Navigation domain (UX Architecture §4): a
`/projects` route and Sidebar/MobileNav entries, structurally separate from Flow AI
Presence exactly as already resolved.
*Affected areas:* `src/App.tsx`, `Sidebar.tsx`, `MobileNav.tsx`.
*Dependencies:* S2 (a real destination must exist before it is linked to).
*Expected outcome:* Projects is reachable like any other domain, on both desktop and
mobile.
*Completion criteria:* the route and both navigation surfaces work; existing routes and
nav entries are unchanged.

**S4 — Recent Activity Composition**
*Objective:* compose the concise, importance-filtered Recent Activity feed (Wireframe
Spec §9) for one project from the existing read tools and Execution Audit, applying the
shared importance definition.
*Affected areas:* a new composition function; no new tools, no new engine.
*Dependencies:* S1 (project → repository binding).
*Expected outcome:* Recent Activity shows real, bounded, important-only events for a
project.
*Completion criteria:* only events meeting the shared importance definition appear;
routine/background events are excluded; each item links to its Evidence.

**S5 — Health Signal**
*Objective:* a new, deterministic, read-only Health composition, following the Decision
Intelligence Engine's existing pattern (input-only, no mutation), decomposing connection
health, freshness, blocked work, failed execution, incomplete verification, and overdue
important tasks into one signal.
*Affected areas:* a new composition, styled after `decisionIntelligenceEngine.ts`; no
changes to that engine itself.
*Dependencies:* S4 (Recent Activity's facts), S7 (Connection status).
*Expected outcome:* a real, decomposable Health signal per project.
*Completion criteria:* Health is never a bare score — every state traces to a specific,
inspectable signal; absent when nothing is wrong, present and specific when something is.

**S6 — Current Focus**
*Objective:* adapt the existing Planner/Priority/Goal engines' output to project scope,
surfacing the single most relevant next step (Wireframe Spec §8).
*Affected areas:* a project-scoped adapter over existing engines; no changes to
`plannerEngine.ts`/`priorityEngine.ts`/`goalEngine.ts` themselves.
*Dependencies:* S1.
*Expected outcome:* Current Focus reflects a real, singular, explainable next step.
*Completion criteria:* exactly one Current Focus is shown per project; "why this?"
answers from real planner/priority output, not placeholder text.

**S7 — Connection Status / Details (project-scoped)**
*Objective:* a project-scoped view into the existing single GitHub connection (Wireframe
Spec §16), reusing `githubConnectionClient.ts` and the `GitHubIntegrationCard` pattern.
*Affected areas:* new frontend screen; no changes to the connection architecture itself.
*Dependencies:* S1.
*Expected outcome:* the six connection conditions (connected, disconnected, permission
problem, stale, partially available, recovery path) are visible per project.
*Completion criteria:* all six conditions render correctly against the existing
connection's real states; the recovery path correctly points into the Connections/Settings
surface.

**S8 — Approval Review (multiple independent proposals)**
*Objective:* extend the existing Approval Model to list and independently review several
pending proposals for one project at once (Wireframe Spec §12), reusing
`approvalInteraction.ts` and `StepApprovalDialog.tsx`'s underlying logic rather than
building a parallel approval mechanism.
*Affected areas:* a new list-and-detail presentation over the existing approval flow; the
existing single-proposal approval path for `tasks.complete` and the two GitHub write tools
is unchanged.
*Dependencies:* S1.
*Expected outcome:* a project can have more than one pending proposal, each independently
approved, rejected, deferred, or cancelled.
*Completion criteria:* no control approves or rejects more than one proposal at once;
every required field (Wireframe Spec §12) is present per proposal; approving one proposal
does not block reviewing another.

**S9 — Execution Result / Evidence & Verification**
*Objective:* surface the existing Execution Engine's output and a verification check
(comparing the action result against freshly re-read state via the existing read tools)
in the two dedicated screens (Wireframe Spec §13–§14).
*Affected areas:* new frontend screens consuming existing execution/read output; no
changes to `executionEngine.ts`, `executionPolicy.ts`, or `writeRuntime.ts`.
*Dependencies:* S8 (an approved proposal must exist to show a result).
*Expected outcome:* every executed action shows status, restated action, target, result,
and a distinct verification status, never collapsing "reported" and "confirmed" into one.
*Completion criteria:* "Verified" and "Incomplete" render as genuinely distinct states; no
automatic retry path exists anywhere in this slice, consistent with ADR-0004.

**S10 — History**
*Objective:* a chronological, filterable read surface over `executionAudit.ts` and
`agent_write_log`, scoped to one project (Wireframe Spec §5, §9).
*Affected areas:* new frontend screen and a read-side query/composition; no changes to
either audit mechanism.
*Dependencies:* S9 (same underlying events, now also readable historically).
*Expected outcome:* a complete, investigable timeline distinct from Recent Activity.
*Completion criteria:* History never duplicates Recent Activity's concise framing; every
row traces to its own Evidence; the two existing audit sources (in-memory and durable) are
both represented without a third mechanism being introduced.

**S11 — Assistant Project-Context Integration**
*Objective:* when Assistant is entered from inside a Project Workspace, carry that
project's Overview/Objectives/Current Focus/Evidence into the existing reasoning pipeline
(`contextSynthesis.ts`, the reasoning prompt) as additional safe context — no new tools,
no new execution authority.
*Affected areas:* context-building only; `ChatPage.tsx` and the reasoning pipeline's
tool/approval/execution boundaries are unchanged.
*Dependencies:* S2, S4, S5, S6 (the facts to inject must already exist).
*Expected outcome:* a suggestion made inside a Project Workspace is genuinely
project-aware without Assistant gaining new capability.
*Completion criteria:* Assistant's boundaries (never execute without approval, never
imply completion, never chain) hold exactly as before; the only observable change is
better-informed suggestions.

**S12 — Home Needs Attention**
*Objective:* a small, conditional cross-project rollup on `Dashboard.tsx`, built from each
Project's Health signal (S5), shown only when at least one genuine actionable exception
exists (UX Architecture §5).
*Affected areas:* an addition to `Dashboard.tsx`'s presentation layer; the Workspace
Pipeline itself is not modified.
*Dependencies:* S5, across however many projects a user has.
*Expected outcome:* Home surfaces real, actionable, project-sourced exceptions, or nothing
at all when none exist.
*Completion criteria:* the surface is absent (not empty) when there is no actionable
exception; it never duplicates a specific project's own Overview or Health detail.

---

## 7. Recommended Implementation Order

S1 → S2 → S3 → {S4, S6, S7} → S5 → S8 → S9 → S10 → {S11, S12}, matching the dependency
graph in §5.

- **Entity before screens (S1 → S2):** nothing can be shown before something exists to
  show.
- **Screens before navigation (S2 → S3):** a navigation entry is never added to point at
  an empty page — this mirrors the existing codebase's own pattern of pages preceding nav
  entries.
- **Independent read-side facts before their synthesis (S4/S6/S7 before S5):** Health is a
  composition over Recent Activity and Connection state; it cannot be meaningfully built
  first.
- **Understand before Act (the read slices before S8–S9):** this ordering is not
  arbitrary — it mirrors Observe → Understand → Act → Verify itself. A user should never
  be asked to approve something inside a Workspace that cannot yet show them why.
- **Act before its own audit trail (S9 before S10):** History has nothing to display until
  Execution Result exists to populate it.
- **Cross-cutting integrations last (S11, S12):** Assistant's project-awareness and Home's
  rollup both depend on facts (Health, Current Focus, Recent Activity) that must already
  be real, not placeholder, or they would need to be redone once those facts land.

---

## 8. Frontend Work

- **Reusable as-is:** `Dashboard.tsx`'s presentation-only pattern (typed data in, no
  business logic in the page); `GitHubIntegrationCard.tsx` and `githubConnectionClient.ts`
  (consumed, not modified); `StepApprovalDialog.tsx`'s underlying approve/reject/defer
  interaction logic; `ChatPage.tsx` and the full reasoning pipeline; the existing
  `Sidebar.tsx`/`MobileNav.tsx` route-array pattern.
- **Needing extension (not rewrite):** the Approval interaction layer, to present a list of
  independent proposals instead of assuming exactly one (S8); `Dashboard.tsx`, to add the
  Needs Attention composition (S12) alongside its existing content, not in place of it.
- **New screens:** Project List, Project Overview / Main Workspace, Approval Review (list
  variant), Execution Result, Evidence & Verification, History, Connection Status/Details
  — the same eight destinations named in the Wireframe Specification and Low-Fidelity
  Wireframes.
- **Navigation changes:** one new Primary Navigation entry ("Projects") and one new route
  family (`/projects`, `/projects/:id`, plus its secondary destinations); no existing route
  changes.

Nothing above is decided at the component, styling, or implementation-technology level —
that remains for an implementation task following this roadmap, consistent with this
document's scope.

---

## 9. Domain Evolution

Conceptual additions only — no schema, no migration:

- **Project** — a new concept: a name, a current objective, and a binding to an existing
  verified connection's repository. This is the one genuinely new domain concept.
- **Recent Activity item**, **Health signal**, **Evidence reference** — new *compositions*
  over existing data (read-tool output, execution audit), not new stored entities in their
  own right; whether any of them eventually needs its own persisted representation is an
  implementation decision for later, not a domain concept this roadmap is introducing.
- **Pending Proposal (as a first-class, listable thing)** — conceptually, today's Approval
  Model already has a proposal; what's new is treating a project's pending proposals as a
  collection to be listed, not a change to what a proposal *is*.

No new domain concept introduced here requires SmartFlow's user, task, or connection
concepts to change.

---

## 10. GitHub Integration Evolution

- **Existing (unchanged):** the verified GitHub App connection flow, the four read tools,
  and the two Write Light tools (`github.issues.comment`, `github.issues.update`), exactly
  as shipped and documented in
  [`github-read-only-integration-v1.md`](../architecture/github-read-only-integration-v1.md)
  and [ADR-0004](../decisions/adr/ADR-0004-write-boundaries.md).
- **Enhancement (this roadmap):** binding an existing connection's repository to a Project
  entity (S1); a project-scoped presentation of that same connection's status (S7);
  Recent Activity, Health, and History composing over the same four read tools and the
  same execution/audit records, scoped to one project at a time (S4, S5, S10).
- **Future (explicitly not this roadmap):** EPIC-08 (Write Code) capability, once
  re-scoped and given its own ADR as a controlled Project-domain Act capability (Product
  Direction §13); any provider beyond GitHub (§15).

GitHub remains the only implemented provider throughout every slice in §6.

---

## 11. Approval & Execution Integration

The Project Workspace is a **consumer** of the existing Approval Model, Execution Engine,
and Execution Audit — none of the three is redesigned:

- **Approval:** Approval Review (S8) presents proposals through the same
  proposal → deterministic-validation → explicit-approval sequence already enforced by
  `approvalInteraction.ts` and `writeRuntime.ts`'s `SUPPORTED_WRITE_TOOL_IDS` allowlist.
  This roadmap adds no new write tool ID beyond the three already approved
  (`tasks.complete`, `github.issues.comment`, `github.issues.update`).
- **Execution:** Execution Result (S9) reads `executionEngine.ts`'s output as-is. No
  slice in §6 adds automatic retry, batching, or chaining — every execution remains
  single-action, single-approval, exactly as ADR-0004 requires.
- **Audit:** History (S10) reads `executionAudit.ts` (in-memory) and `agent_write_log`
  (durable) as they already exist. No third audit mechanism is introduced, and neither
  existing one is modified to accommodate the Project Workspace — the Workspace adapts to
  them, not the reverse.

---

## 12. QA Strategy

- **Per-slice testing:** each slice in §6 ships with its own tests, following the
  repository's existing co-located `*.test.ts`/`*.test.tsx` pattern — no slice is
  considered done without them (§6 completion criteria).
- **Regression baseline:** the full existing test suite (621+ tests per
  `PROJECT_STATUS.md` §8) must continue passing after every slice; a slice that requires
  changing an existing test's expected behavior needs explicit justification, not a
  silent update.
- **New composition logic gets new tests:** Recent Activity's importance filtering (S4),
  Health's decomposition (S5), and Current Focus's adaptation (S6) each need dedicated
  test coverage proving they apply the shared importance definition and existing
  engine output correctly, not just that they render.
- **Approval safety tests:** S8 specifically needs tests proving no control can approve or
  reject more than one proposal at once, and that approving one proposal does not block
  reviewing another (Wireframe Spec §12, §17).
- **Accessibility checks:** per the Wireframe Specification §20 and the Low-Fidelity
  Wireframes' per-screen accessibility notes — keyboard reachability, status
  announcements, and text-based (never colour-only) state communication for every new
  screen.
- **Localization/RTL regression:** every new screen is checked against the same
  English/German/Persian and RTL validation already established for TasksPage and Flow AI
  Chat (`PROJECT_STATUS.md` §7–§8) — no new screen ships English-only.
- **No new live-provider QA required:** GitHub App registration and authenticated
  real-provider QA are already complete (`PROJECT_STATUS.md` §3); this roadmap's slices
  reuse that connection, they do not re-establish it.

---

## 13. Rollout Strategy

Gradual, additive, never big-bang:

- S1–S2 can exist and be tested without being linked from anywhere in the product —
  `/projects` need not be navigable until S3 deliberately adds it.
- Every existing route, page, and tool (Dashboard, Tasks, Calendar, Chat, Settings, and
  every other current domain) continues to function unmodified through every slice —
  nothing in this roadmap replaces an existing surface, it only adds a new one alongside.
- Each milestone (§16) is independently shippable: a user could, in principle, have
  Project Foundation (M1) available while Approval/Execution/History (M3–M4) are still in
  progress, and lose nothing they already had.
- Feature-level gating (if the team chooses to hide `/projects` behind a flag before S3,
  or stage Health/Current Focus behind their own flags) is an implementation decision left
  to whoever executes this roadmap — not decided here, but explicitly compatible with the
  slice boundaries above.

---

## 14. Risks

**Technical**

- Introducing "Project" as a genuinely new entity (S1) is the one piece of this roadmap
  without a direct existing analogue — most risk in this roadmap concentrates here, not in
  the composition work that follows it.
- Reusing `decisionIntelligenceEngine.ts`'s pattern for Health (S5) without copying its
  code wholesale requires care to keep both truly deterministic and read-only; a Health
  composition that accidentally mutates state would violate the same principle the
  existing engine is built on.
- Multiple independent pending approvals (S8) increase the surface where a bug could
  accidentally let one decision affect another; this is exactly what §12's dedicated
  safety tests exist to catch before it ships.

**UX**

- The Health vs. Home's Needs Attention terminology distinction (Wireframe Spec §15,
  carried into the Low-Fidelity Wireframes §11) must survive into implementation copy and
  code naming — a developer who names a project-scoped component "NeedsAttention" risks
  quietly re-introducing the exact confusion those two documents deliberately avoided.
- Mobile approval safety (Wireframe Spec §18) — every required Approval Review field must
  still appear in full on a constrained device; a rushed implementation could be tempted
  to abbreviate this for space.

**Migration**

- The existing single-connection-per-user GitHub model must map cleanly onto
  potentially-multiple Projects per user; S1's binding design needs to accommodate a user
  eventually having more than one Project against the same connection without treating the
  connection itself as project-specific.
- `SettingsPage.tsx`'s existing Integrations tab (`GitHubIntegrationCard`) must keep
  working exactly as-is while a project-scoped Connection view (S7) is added alongside it
  — the two must not silently diverge in what they report about the same connection.

**Documentation**

- Four canonical documents plus this roadmap must be kept mutually consistent as
  implementation proceeds; a slice that discovers a genuine gap in one of them should
  update that document explicitly (through its own review process) rather than have
  implementation quietly drift from what was approved.
- The already-recorded documentation-alignment follow-ups from Product Direction §17–§18
  were resolved by the documentation-structure cleanup: ADRs now live under
  `docs/decisions/adr/`, ADR-0004 is listed in the ADR README, and the empty duplicate
  roadmap placeholder was removed.

---

## 15. Explicitly Deferred

Not scheduled by this roadmap, named so they are not silently reconsidered mid-slice:

- **EPIC-09 (Agent Autonomy)** — remains frozen; no slice in §6 moves toward it.
- **Unrestricted execution** — every execution path touched by this roadmap remains
  single-action, single-approval; nothing here introduces a path that executes without an
  explicit, per-action approval.
- **Autonomous chaining** — no slice allows one executed action to trigger another without
  its own separate proposal and approval.
- **Provider expansion** — email, calendar, other code hosts (Product Direction §7, §17;
  Wireframe Spec §16) remain future work; GitHub is the only provider any slice in §6
  touches.
- **EPIC-08 (Write Code)** — remains frozen pending its own re-scoping ADR (Product
  Direction §13); no slice here adds file, code, or PR write capability.
- **Learning Project / Personal Project types** — Software Project is the only Project
  type any slice implements (Product Direction §3).
- **Aligning the legacy generic "Projects" module concept** (`06_module_philosophy.md`)
  with the new Project taxonomy — a documentation task, not an implementation one, and not
  in scope here.

---

## 16. Milestones

- **M1 — Project Foundation (Read-Only):** S1, S2, S3. A user can see their Projects and
  open one to a real Overview, reachable through Primary Navigation.
- **M2 — Understanding:** S4, S5, S6, S7. Recent Activity, Health, Current Focus, and
  Connection status are all real inside the Workspace.
- **M3 — Controlled Action:** S8, S9. Multiple independent proposals can be reviewed and
  approved; results and their verification are visible.
- **M4 — Traceability:** S10. The full project history is available and distinct from
  Recent Activity.
- **M5 — Integration:** S11, S12. Assistant is project-aware from inside the Workspace;
  Home surfaces genuine cross-project exceptions.

---

## 17. Definition of Done (per Milestone)

- **M1:** S1–S3's completion criteria (§6) all met; the full regression suite passes;
  `/projects` is reachable from both desktop and mobile navigation; no existing route or
  page changed behavior.
- **M2:** S4–S7's completion criteria met; Health is demonstrably decomposable (never a
  bare score) against real project data; Current Focus is demonstrably singular per
  project; accessibility and localization checks (§12) pass for all four new
  screens/compositions.
- **M3:** S8–S9's completion criteria met, including the dedicated multi-approval safety
  tests (§12, §14); Evidence & Verification demonstrably distinguishes "Verified" from
  "Incomplete" in real data, not only in test fixtures.
- **M4:** S10's completion criteria met; History is demonstrably distinct from Recent
  Activity against the same underlying data (no duplication); both existing audit sources
  are represented.
- **M5:** S11–S12's completion criteria met; Assistant's existing safety boundaries
  (proposal-only, no chaining) are re-verified unchanged; Home's Needs Attention is
  demonstrably absent when no project has an actionable exception.

---

## 18. Success Criteria

This roadmap succeeds when:

- A user can move through Observe → Understand → Act → Verify for a real, connected
  Software Project entirely inside the new Workspace, using only capability that already
  existed before this roadmap (Write Light plus `tasks.complete`) — no new write authority
  is introduced anywhere in §6.
- Every existing domain (Dashboard, Tasks, Calendar, Chat, Settings, and the rest) is
  demonstrably unaffected — the same regression suite that passed before M1 still passes
  after M5.
- The Approval Model, Execution Engine, and Execution Audit are unmodified in kind — only
  consumed more broadly, per §11.
- EPIC-08 and EPIC-09 remain exactly as frozen as they were before this roadmap began.

---

## 19. Out of Scope

- Any database schema or migration design (a later, separate engineering task — §9).
- Any visual design, component, or styling decision (the four canonical UX documents'
  own out-of-scope boundaries carry forward unchanged here).
- Any EPIC-08 or EPIC-09 implementation.
- Any provider beyond GitHub.
- Any change to `docs/product/product-direction-v1.md`,
  `docs/design/ux/ux-architecture-v1.md`, or either wireframe document — this roadmap
  treats all four as approved and unmodified.

---

## 20. Future Extensions

Named for continuity with the canonical documents' own deferred scope, not designed here:

- Learning Project and Personal Project types, once scoped (Product Direction §3).
- Additional Connections providers — email, calendar, other code hosts (Product Direction
  §7; Wireframe Spec §16).
- EPIC-09's bounded-autonomy definition, once owned and scoped (Product Direction §13,
  §16) — strictly inside the same approval/execution/audit boundaries this roadmap
  preserves throughout, never around them.
- Re-scoping EPIC-08 as a controlled Project-domain Act capability, once its own ADR
  exists.
- Aligning the legacy generic "Projects" module concept with the Software/Learning/
  Personal Project taxonomy (a documentation task, tracked separately).

---

## References

- [`docs/product/product-direction-v1.md`](../product/product-direction-v1.md)
- [`docs/design/ux/ux-architecture-v1.md`](../design/ux/ux-architecture-v1.md)
- [`docs/design/ux/project-workspace-wireframe-spec-v1.md`](../design/ux/project-workspace-wireframe-spec-v1.md)
- [`docs/design/ux/project-workspace-low-fidelity-wireframes-v1.md`](../design/ux/project-workspace-low-fidelity-wireframes-v1.md)
- [`docs/architecture/github-read-only-integration-v1.md`](../architecture/github-read-only-integration-v1.md)
- [`docs/decisions/adr/ADR-0004-write-boundaries.md`](../decisions/adr/ADR-0004-write-boundaries.md)
- [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md)
- [`CLAUDE.md`](../../CLAUDE.md)
