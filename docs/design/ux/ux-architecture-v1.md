# SmartFlow UX Architecture v1

**Version:** 1.1
**Status:** Draft — Product Owner UX decisions incorporated 2026-07-28, pending final
review and commit
**Date:** 2026-07-28 (revised)
**Derives from:** [`docs/product/product-direction-v1.md`](../../product/product-direction-v1.md) (v1.1, Approved)
**Scope:** Experience architecture only. No visual design, no components, no wireframes,
no implementation.

---

## 1. Purpose

This document defines SmartFlow's user experience architecture: how users move through
the product, what each domain is responsible for, how navigation is organized
conceptually, and how the core interaction loop plays out. It is the bridge between
product decisions and everything that will eventually be built:

```
Product Direction
      ↓
UX Architecture   (this document)
      ↓
Wireframes        (future, not started)
      ↓
Implementation     (future, not started)
```

Every decision here is derived from
[`product-direction-v1.md`](../../product/product-direction-v1.md); none of it
redefines product strategy, and none of it commits to a visual language, a component,
a layout, or a technology. Where product direction leaves something open, this document
either states the architectural principle that constrains the future answer or names the
question as open (§17) — it does not guess a visual answer.

---

## 2. UX Principles

Derived directly from product direction, not asserted new:

- **Projects first.** Software Projects are this phase's proving ground for the whole
  product (Product Direction §2, §9). Every other principle below is subordinate to
  making the Project experience trustworthy before expanding elsewhere.
- **Observe → Understand → Act → Verify is the shape of every meaningful flow.** Not a
  slogan — a structural expectation. If a flow cannot show what was observed, what Flow AI
  understood, what it proposes to do, and how the user can verify the outcome, it is not
  finished (§12).
- **Assistant supports; it does not decide.** Flow AI proposes, explains, and recommends.
  The user approves. This mirrors the existing safety architecture (Product Direction §12)
  precisely — UX must not create an impression of autonomy the underlying system does not
  grant.
- **Evidence over assumption.** Anything Flow AI states about a project should be traced
  to an observable fact (repository state, an issue, a roadmap document) rather than
  inferred tone or guesswork. This is what makes Verify possible at all (Product Direction
  §9.2).
- **Human approval where required.** Every write remains proposal → validation → explicit
  approval → single execution → audit (ADR-0004; Product Direction §12, §14). No
  experience pattern may shortcut, batch, or imply this away.
- **Progressive disclosure.** Show the current objective and next action first; let detail
  (full repository state, full history, full roadmap) be reached deliberately, not dumped
  at once. Consistent with the existing "one primary focus" philosophy in
  [`02_living_workspace.md`](../experience/02_living_workspace.md).
- **Consistency across domains.** A user who understands how to observe, approve, and
  verify inside one Project should not have to relearn the pattern inside Tasks or
  Connections.
- **Low cognitive load.** Every domain answers one question. When a domain tries to
  answer more than one, it has grown past its responsibility (§3).
- **Accessibility first.** Not a later pass — a constraint on every principle above
  (§14).

---

## 3. Information Architecture

Six primary domains, matching Product Direction §10 exactly. No domain here is new,
renamed, or reinterpreted relative to that document.

### Home

- **Purpose:** the entry surface — a live, prepared overview of what matters right now.
- **Responsibilities:** surface what deserves attention across whatever domains are
  active for the user, including Projects.
- **Belongs here:** cross-domain summary, "what should I look at now."
- **Does not belong here:** project-specific detail, task management, any domain's full
  working view.
- **Relationship to other domains:** a summarizing surface over all of them; owns none of
  their data or actions.

### Projects

- **Purpose:** understand and operate a Software Project through Observe → Understand →
  Act → Verify.
- **Responsibilities:** project-level state, objective, next actions, recommendations,
  approval, and verified execution history (Product Direction §10).
- **Belongs here:** repository state, roadmap, objective, recent activity, documentation,
  assistant recommendations scoped to the project, approval, execution, evidence.
- **Does not belong here:** the task list as a whole (Tasks owns that), the learning
  experience (Learning owns that), general GitHub account management (Connections owns
  that).
- **Relationship to other domains:** the domain everything else in this phase is judged
  against (§6, §7).

### Tasks

- **Purpose:** manage discrete units of work.
- **Responsibilities:** list, prioritize, complete tasks; own the existing write path.
- **Belongs here:** the task list, task state, task completion.
- **Does not belong here:** project narrative or roadmap — a task referenced from a
  project is still owned by Tasks (§8).
- **Relationship to other domains:** a project's "next actions" may surface or relate to
  tasks without Tasks being absorbed into Projects.

### Learning

- **Purpose:** the boundary marker for Smart Academy's independent learning experience.
- **Responsibilities:** hold the reference point where SmartFlow acknowledges a learning
  objective exists; nothing more.
- **Belongs here:** links, references, and status pointers into Smart Academy.
- **Does not belong here:** the learning experience itself, its content, or its
  interaction model (§9).
- **Relationship to other domains:** a project may reference a learning objective; it does
  not host it.

### Assistant

- **Purpose:** the shared conversational surface for Flow AI.
- **Responsibilities:** understand context, propose actions, explain reasoning; never
  execute or approve on its own (§10).
- **Belongs here:** conversation, proposals, explanations, clarification.
- **Does not belong here:** silent execution, hidden decision-making, domain-specific data
  storage.
- **Relationship to other domains:** every domain may propose actions through Assistant;
  none of them gain new authority by doing so.

### Connections

- **Purpose:** the provider-neutral home for verified external integrations.
- **Responsibilities:** hold connection state and verification status; GitHub is the only
  fully supported Project connection this phase (Product Direction §7, §10).
- **Belongs here:** connection status, verification, provider account identity.
- **Does not belong here:** project-specific data — Connections supplies verified access;
  Projects is what interprets it.
- **Relationship to other domains:** Projects consumes Connections' verified state;
  Connections does not become a per-project view.

---

## 4. Navigation Architecture

Principles only — no chrome, layout, or visual placement is decided here.

### Primary Navigation and Flow AI Presence (resolved)

Primary Navigation and Flow AI Presence are two structurally separate concepts. This is a
resolved UX decision, not an open question:

- **Primary Navigation** represents the stable product structure: the means by which a
  user moves between Home, Projects, Tasks, Learning, Assistant, and Connections (§3). It
  is structural chrome, not an Assistant surface.
- **Flow AI Presence** — the persistent manifestation already established in
  [ADR-0002](../../decisions/adr/ADR-0002%20—%20Flow%20AI%20Presence%20Architecture.md) —
  represents contextual Assistant access, support, proposals, and awareness. This document
  does not redesign Presence; it fixes how navigation must relate to it.
- **Flow AI Presence must not own or replace Primary Navigation.** Presence is not an
  alternate or implicit way to switch domains, and Primary Navigation is not a container
  for Presence.
- **Primary Navigation must remain usable and understandable independently of Assistant's
  availability, state, or visibility.** If Flow AI is thinking, offline, silent, or
  visually absent, every domain in §3 must still be reachable exactly as before. Domain
  switching must never depend on Assistant's state.

How Presence and Primary Navigation are visually arranged relative to each other (e.g.,
adjacent, layered, or in entirely separate chrome) remains a wireframe-level decision —
what is resolved here is that they are two things, not one, and neither substitutes for
the other.

- **Secondary navigation** — moving within a domain (e.g., between a Project's Overview,
  Roadmap, and Activity — see §7). Must be discoverable from inside the domain, not from
  primary navigation.
- **Contextual navigation** — actions and shortcuts that only make sense given current
  state (e.g., "resolve this project's pending approval," offered from Assistant or from
  the Project Workspace itself). Must never be the only path to a capability — it
  accelerates, it does not gate.
- **Desktop navigation** — can afford to keep primary and secondary navigation
  simultaneously visible, given more available space.
- **Mobile navigation** — primary navigation must remain reachable in one step; secondary
  navigation may need to collapse behind an explicit entry point rather than stay
  persistently visible. Contextual navigation should favor the single most relevant
  action rather than presenting the full set mobile has no room for.
- **Future navigation expansion** — adding a domain (e.g., a future Personal Project type,
  §16) must not require restructuring primary navigation's shape, only adding to it.

---

## 5. Home Experience

- **Purpose:** answer "what matters right now" across everything the user has active,
  continuing the existing Living Workspace responsibility
  ([`02_living_workspace.md`](../experience/02_living_workspace.md)).
- **What users should immediately understand:** what needs their attention first, and
  which domain it belongs to.
- **What should be visible:** a small number of prioritized items — including, when
  relevant, a Project's pending approval or current objective — never a full listing of
  every domain's contents.
- **What should stay hidden:** full project detail, full task lists, full connection
  management — Home points, it does not contain.
- **Relationship to Projects:** Home may surface that a Project needs attention; it never
  substitutes for entering the Project itself to observe, approve, or verify.

### Needs Attention Surface (resolved)

Home supports a small, conditional "Needs Attention" surface. This is a resolved UX
decision, not an open question, and it is valid immediately — it does not wait for
multi-project usage to become common.

- **Appears only when a genuine actionable exception exists** — for example: a pending
  approval, a failed execution, a disconnected connection, stale project context, an
  overdue important task, or an incomplete verification. Each of these is something the
  user must act on, not merely something that happened.
- **Does not appear at all when there is no actionable exception.** An empty or fully
  healthy state means the surface is absent, not shown empty — Home does not manufacture
  something to display.
- **Must not become a general activity feed.** It surfaces exceptions, not a log of
  everything that occurred.
- **Must not be permanently visible.** Its presence is itself a signal; a Needs Attention
  surface that is always on screen has stopped meaning anything.
- **Must not duplicate Projects or Tasks.** It points at the exception and where to
  resolve it; it does not reproduce a project's Overview or a task's detail.
- **Must not become a dense dashboard.** It stays small and exception-scoped even as the
  number of projects and tasks grows — it is a pointer, consistent with Home's existing
  "points, does not contain" responsibility above, not a second summarizing surface
  competing with it.

---

## 6. Projects Experience

The core chapter. Everything below describes responsibility, not layout.

- **Project List** — the set of Software Projects the user has. Responsible for showing
  which projects exist and which currently need attention; not responsible for any single
  project's detail.
- **Project Overview** — the first thing seen on entering a specific project: current
  objective, what changed recently, and what (if anything) is awaiting the user's
  approval. Responsible for orientation, not for exhaustive history.
- **Project Workspace** — the full conceptual environment for a single project (§7).
- **Repository context** — the verified, connected state of the project's repository
  (Product Direction §9, §12): what exists, not raw file contents or diffs beyond what a
  specific approval preview requires.
- **Objectives** — what the project is currently trying to accomplish, in the user's or
  Flow AI's own words, not auto-derived from raw activity alone.
- **Roadmap** — the project's own planning documents and milestones, referenced, not
  duplicated.
- **Recent activity** — a concise, operational summary of only the most relevant recent
  changes: recent issue activity, execution results, approvals, verification outcomes, and
  important status changes, sourced from repository and issue state already available
  through the existing read integration (EPIC-06). It supports quick understanding of
  "what changed," not exhaustive review — that is History's responsibility (§7).
- **Health** — a synthesized signal of whether the project is progressing, stalled, or
  needs attention; must be traceable back to evidence, not a mood.
- **Documentation** — links into the project's own documentation, not a copy of it.
- **Assistant context** — what Flow AI currently understands about this specific project,
  scoped so it never leaks one project's data into another's conversation.
- **Evidence** — the concrete facts backing any recommendation or health signal; must be
  inspectable, per the "evidence over assumption" principle (§2).
- **Approval** — the explicit, per-action user decision point required before any write
  (ADR-0004; Product Direction §12). Never implicit, never batched, never skippable.
- **Execution** — the single, audited act of carrying out an approved action. Today this
  is Write Light only (`github.issues.comment`, `github.issues.update`) plus `tasks.list`
  triggering `tasks.complete`; anything resembling code or PR changes is EPIC-08, frozen
  pending re-scoping (Product Direction §13) — this document does not design for it as if
  it were available.
- **Verification** — showing, after execution, that the approved action actually happened
  as previewed (e.g., the comment now exists, the issue now reflects the update). This is
  what closes the loop back to Observe (§12).

---

## 7. Project Workspace Architecture

The conceptual sections a Project Workspace is composed of. This is a responsibility map,
not a layout — it does not say what is a panel, a tab, a card, or a page.

- **Overview** — orientation: objective, recent change, anything awaiting approval.
- **Objectives** — the project's current goal(s), kept distinct from the roadmap's full
  plan.
- **Current Focus** — the single most relevant next step, echoing Home's "one primary
  focus" discipline (§2, §5) at the project level.
- **Recent Activity** — the concise, operational summary referenced in §6, directly
  available inside the Project Workspace for the first release (resolved, not open).
- **Assistant** — the project-scoped conversational surface; the same Assistant domain
  (§3), entered with this project's context already loaded.
- **Execution** — where an approved action actually runs, and only there.
- **Evidence** — the facts a recommendation or health signal traces back to.
- **History** — a deeper secondary destination, distinct from Recent Activity in kind, not
  only in length: it holds the more complete timeline that supports later investigation,
  traceability, and audit review — execution audit, approval history, verification
  history, and significant project changes. For the first Project Workspace release,
  History is a secondary deeper view reached deliberately from the Workspace, not
  presented alongside Recent Activity by default (resolved, not open). Recent Activity
  must never grow into a duplicate of History; if an item needs investigation rather than
  quick understanding, it belongs in History, not in an expanded Recent Activity.
- **Health** — the synthesized progress/stall/attention signal (§6).
- **Connections** — this project's own view into its verified provider state (GitHub
  today), not a redirection into the Connections domain's own management surface.
- **Approval** — the decision point itself, reachable from wherever a proposal surfaces
  (Overview, Assistant, or Execution), not confined to one conceptual corner.

None of these sections implies a screen count, a navigation depth, or a visual hierarchy;
that is wireframe work (§16 out of scope).

---

## 8. Tasks

```
Projects
   ↓
 Tasks
```

A Software Project's "next actions" may surface tasks, and a task may reference the
project it came from, but Tasks retains full ownership of task state, prioritization, and
completion (Product Direction §10). Projects does not gain a second, competing task list;
it reflects Tasks' data, it does not duplicate or replace it. Where a Project Overview
shows an outstanding task, that display is a reference, and the task's actual state lives,
and is edited, only in Tasks.

---

## 9. Learning

SmartFlow may reference a Smart Academy learning objective from within a project's context
(e.g., a Software Project whose objective involves a course), but Smart Academy's learning
experience, content, and codebase remain independent (Product Direction §11). This is not
a UX limitation to work around — it is a deliberate boundary. Absorbing Smart Academy's
interaction model into SmartFlow's own Learning domain would require SmartFlow to own
pedagogy, content sequencing, and a second product's user experience, none of which this
phase's Software-Project-first mission calls for. The Learning domain in SmartFlow's own
navigation is therefore a pointer, not a container.

---

## 10. Assistant

- **Responsibilities:** hold conversation, understand context, propose actions, explain
  reasoning behind a recommendation. Nothing more.
- **Context awareness:** Assistant draws on whatever a domain has made available to it —
  a project's evidence, a task's state — but does not retain cross-project context beyond
  what the user is currently working in.
- **Project awareness:** entering Assistant from inside a Project Workspace should carry
  that project's context in; entering it generally (from Home) should not presume any
  single project.
- **What Assistant must never do:** execute an action without explicit user approval;
  imply an action already happened when it has only been proposed; chain multiple actions
  together without a separate approval for each; surface another user's or another
  project's data.
- **Approval boundaries:** identical to the boundaries already established for every write
  tool (ADR-0004): proposal → deterministic validation → explicit approval → single
  execution → audit. Assistant's UX must make this sequence visible, not compress it for
  the sake of feeling more capable.
- **Trust model:** Assistant earns trust by being verifiably correct about what it
  observed and honest about what it cannot yet do (e.g., code/PR changes, per EPIC-08's
  frozen status) — not by appearing more autonomous than the system underneath it.
- **Relationship to Flow AI Presence:** Presence (ADR-0002) is a contextual manifestation
  of Assistant — access, support, proposals, and awareness available from wherever the
  user is. The Assistant domain in Primary Navigation (§3, §4) is the same underlying
  capability entered as a full conversational surface. They are one Assistant with two
  entry points, not two competing assistants — and neither entry point is or replaces
  Primary Navigation itself (§4).

**Deferred documentation-alignment note (not resolved in this revision).**
[`04_flow_ai_conversation.md`](../experience/04_flow_ai_conversation.md) describes a
"Multi-step Thinking" aspiration ("anticipate the next logical step") and an "AI
Initiative" that may begin conversations proactively. This UX Architecture remains
authoritative that Assistant anticipation produces proposals only, that proposals do not
authorize chained execution, and that approval, execution policy, verification, and user
control all remain intact regardless of how proactively Assistant speaks. The tension this
creates with the older document's wording is recorded as deferred documentation-alignment
work — `04_flow_ai_conversation.md` itself is not modified by this task.

---

## 11. Connections

- **GitHub** — the current, fully supported provider for a Software Project's repository
  connection (Product Direction §7, §10). Owns connection status, verification, and
  account identity; a Project consumes this state rather than managing it directly.
- **Future examples (not in scope this phase):** email, calendar, drive/document
  providers. Named so the Connections domain's shape is not designed in a way that
  presumes GitHub is its only possible member.
- **Provider-neutral philosophy:** Connections is a domain about *verified external
  access* in general. Its responsibilities (status, verification, identity) must not be
  described or built in GitHub-specific terms even while GitHub is the only implementation
  today.

---

## 12. Observe → Understand → Act → Verify

The primary UX flow for this phase, applied at the Project level (Product Direction §2,
§6, §9):

1. **Observe** — the user or Flow AI looks at what is actually true: repository state,
   issues, roadmap, recent activity. Sourced from already-validated read integration
   (EPIC-06). Nothing is proposed yet.
2. **Understand** — Flow AI synthesizes what Observe surfaced into an objective, a health
   signal, or a recommendation, always traceable back to the evidence behind it (§2, §6).
   Nothing is executed yet.
3. **Act** — the user reviews an explicit proposal (a comment, an issue update, or —once
   re-scoped— a broader project action) and approves it. Execution is a single, audited
   step that only happens after approval (ADR-0004).
4. **Verify** — the outcome is checked against what was previewed, and folded back into
   what the project's state now Observably is — closing the loop rather than ending it.

Users move between these stages by looking, not by following a fixed script: a user might
enter at Verify (checking on something they approved earlier), loop from Understand back
to Observe (asking "why do you think that"), or stop after Understand without ever
reaching Act. The architecture must support entering and leaving at any stage; it must
never force a user through Act to reach information that belongs at Observe or Understand.

---

## 13. User States

- **Loading** — Flow AI is retrieving evidence; the UX must distinguish this from Empty
  rather than briefly showing nothing.
- **Empty** — a domain or project genuinely has nothing yet (e.g., a newly connected
  repository with no tracked activity). Per existing philosophy
  ([`02_living_workspace.md`](../experience/02_living_workspace.md)), empty must explain
  what happened and what to do next — never a blank space.
  **RTL** — direction is independent of the AI response language and applies per the
  existing resolution rules (Product Direction §12; `PROJECT_STATUS.md` §7).
- **Fresh** — evidence was just retrieved and is current; recommendations may be shown
  with full confidence.
- **Stale** — evidence exists but is old enough that Flow AI should say so rather than
  presenting it as current — consistent with "evidence over assumption" (§2).
- **Offline** — no connection to retrieve evidence; previously retrieved evidence may
  still be shown, explicitly labeled as not current, but no new proposal or approval may
  be initiated.
- **Partial** — some evidence loaded, some did not (e.g., repository state present, issue
  list failed); the UX must show what is missing rather than silently omitting it.
- **Error** — evidence retrieval or execution failed; must be explained in terms of what
  happened and what the user can do, never a bare failure with no next step, and must
  never be presented as if it were a successful Verify.

---

## 14. Accessibility

- **Keyboard** — every action reachable through primary, secondary, and contextual
  navigation (§4), every approval, and every proposal must be operable without a pointing
  device.
- **Screen reader** — evidence, recommendations, and approval previews must be exposed as
  meaningful content, not implied by visual arrangement alone — critical given how much of
  this experience is Flow AI explaining *why*, not just showing *what*.
- **Reduced motion** — Flow AI's presence and state changes (ADR-0002) must remain
  legible without relying on motion to carry meaning that has no static equivalent.
- **RTL** — response direction already resolves independently of interface direction
  (`PROJECT_STATUS.md` §7); this UX architecture does not change that rule and must keep
  every domain consistent with it.
- **Localization** — English, German, and Persian are already validated at the response
  layer; domain responsibilities described here (§3) must remain language-neutral so
  localization is not blocked by an accidental English-only assumption in a domain's
  design.
- **Responsive behavior** — primary navigation must remain reachable at every viewport
  (§4); progressive disclosure (§2) is the mechanism for adapting density, not hiding
  capability.

---

## 15. Future UX Expansion

Named for continuity with Product Direction's deferred scope (§7, §16), not designed here:

- **Learning Project and Personal Project** as additional Project types alongside Software
  Project (Product Direction §3) — would extend Projects' domain responsibilities (§3)
  without changing its shape.
- **Additional Connections providers** — email, calendar, other code hosts (§11) — would
  extend Connections without requiring a new domain.
- **EPIC-09 (Agent Autonomy)**, once bounded-autonomy is defined (Product Direction §13) —
  would extend what Assistant may propose and what Act may cover, strictly inside the
  approval/audit boundaries already described in §10 and §12, never outside them.
- **Aligning the legacy generic "Projects" module concept**
  ([`06_module_philosophy.md`](../../design/system/06_module_philosophy.md)) with the
  Software/Learning/Personal Project taxonomy (Product Direction §17) — would affect how
  future project types are described, not how Software Project works today.

---

## 16. Out of Scope

This document intentionally excludes:

- Wireframes and screen designs
- Component library or component naming
- Design tokens, color, typography, or motion specification
- Visual design of any kind
- Implementation details or technology choices
- Animation design (motion philosophy remains owned by
  [`SMARTFLOW_PRODUCT_BIBLE.md`](../vision/SMARTFLOW_PRODUCT_BIBLE.md) and
  [`02_living_workspace.md`](../experience/02_living_workspace.md))
- Page-level layout or navigation chrome placement
- Any EPIC-08 or EPIC-09 implementation work (both remain frozen per Product Direction §13)

---

## 17. Open UX Questions

The three questions raised in the previous revision — Primary Navigation's relationship to
Flow AI Presence, the Recent Activity/History split for a first release, and whether Home
needs a "needs attention" surface before multi-project usage is common — have all been
resolved by Product Owner decision (§4, §5, §7) and are no longer open.

No genuinely unresolved UX questions remain at this time. New ones may surface once
wireframe work begins to test these architectural decisions against an actual layout; this
section will be reopened then rather than speculatively populated now.

---

## References

- [`docs/product/product-direction-v1.md`](../../product/product-direction-v1.md)
- [`docs/design/vision/SMARTFLOW_PRODUCT_BIBLE.md`](../vision/SMARTFLOW_PRODUCT_BIBLE.md)
- [`docs/design/experience/01_smartflow_experience.md`](../experience/01_smartflow_experience.md)
- [`docs/design/experience/02_living_workspace.md`](../experience/02_living_workspace.md)
- [`docs/design/experience/03_flow_ai_personality.md`](../experience/03_flow_ai_personality.md)
- [`docs/design/experience/04_flow_ai_conversation.md`](../experience/04_flow_ai_conversation.md)
- [`docs/design/system/06_module_philosophy.md`](../system/06_module_philosophy.md)
- [`docs/decisions/adr/ADR-0002 — Flow AI Presence Architecture.md`](../../decisions/adr/ADR-0002%20—%20Flow%20AI%20Presence%20Architecture.md)
- [`docs/decisions/adr/ADR-0004-write-boundaries.md`](../../decisions/adr/ADR-0004-write-boundaries.md)
- [`PROJECT_STATUS.md`](../../../PROJECT_STATUS.md)
