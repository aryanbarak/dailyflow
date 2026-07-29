# SmartFlow Project Workspace — Wireframe Specification v1

**Version:** 1.1
**Status:** Draft — Product Owner decisions incorporated 2026-07-28, pending final review
**Date:** 2026-07-28 (revised)
**Derives from:**
[`docs/product/product-direction-v1.md`](../../product/product-direction-v1.md) (v1.1,
Approved) and
[`docs/design/ux/ux-architecture-v1.md`](ux-architecture-v1.md) (v1.1, Draft)
**Scope:** Screen-level and information-hierarchy specification for the Software Project
Workspace only. No visual design, no components, no implementation.

---

## 1. Purpose

UX Architecture (§6–§7) defines the Project Workspace as a set of responsibilities:
Overview, Objectives, Current Focus, Recent Activity, Assistant, Execution, Evidence,
History, Health, Connections, Approval. It deliberately does not say what is a screen,
what is reached by one interaction, or what information a given destination requires to
do its job.

This document closes that gap. It sits between UX Architecture and future visual
wireframes:

```
Product Direction        (what the product is)
      ↓
UX Architecture           (how the product is structured)
      ↓
Project Workspace Spec    (this document — screens, hierarchy, required information)
      ↓
Low-fidelity wireframes    (future, not started)
      ↓
Implementation             (future, not started)
```

It answers "what must exist on which screen, in what priority, containing what
information" — not "what does it look like." Nothing here redefines product strategy or
UX Architecture; where either leaves a question genuinely open, this document says so
(§23) rather than deciding it by default.

---

## 2. Scope

This document covers **the Software Project Workspace only** — the experience for a
single, already-connected Software Project, as scoped by Product Direction §3 and §7 and
UX Architecture §6–§7.

**Outside this task:**

- The Project List (multiple projects) and Home — described only where the Workspace is
  entered from them (§4).
- Tasks, Learning, Connections, and Assistant as domains in their own right — described
  only at the boundary where they touch the Workspace (§8–§10, §16).
- Any Learning Project or Personal Project type — Software Project is the only type in
  scope (Product Direction §3).
- Any EPIC-08 (Write Code) or EPIC-09 (Agent Autonomy) capability — both remain frozen
  (Product Direction §13); this document does not design around them as if approved.
- Visual design, components, layout, and implementation of any kind.

---

## 3. Workspace Goals

Inside a Project Workspace, a user must be able to:

- Understand the project's current state without reconstructing it manually.
- Identify the current focus — the single most relevant next step.
- See what changed recently, and reach a fuller history when that is not enough.
- Identify blockers — anything stalling progress or requiring a decision.
- Understand Flow AI's suggested next actions, and why they were suggested.
- Review a proposed action in full before deciding on it.
- Approve, reject, or defer a controlled action explicitly.
- Inspect the result of an executed action.
- Inspect the evidence behind a claim, and confirm whether it has been verified.

These map directly onto Observe → Understand → Act → Verify (§11) and constrain every
screen defined below: a screen that does not serve one of these goals does not belong in
this specification.

---

## 4. Entry Points

Every entry point must land the user in a workspace state consistent with how much project
context they already had when they arrived.

- **From Home** — via the Project's entry in Home's summary or its Needs Attention
  surface (UX Architecture §5). Expected context: the user was told *why* the project
  needs attention (e.g., a pending approval); the Workspace should open already oriented
  toward that reason, not at a generic default.
- **From the Projects list** — a deliberate choice to open a specific project with no
  particular reason attached. Expected context: general orientation — Overview first,
  nothing pre-selected.
- **From Tasks** — via a task that references its originating project (UX Architecture
  §8). Expected context: the user came to understand the project behind a specific task;
  the Workspace should make it obvious how that task relates to Current Focus, without
  pretending Tasks' ownership of the task moved with them.
- **From Assistant** — a proposal or explanation surfaced in conversation that concerns a
  specific project. Expected context: whatever Flow AI just said should still be visible
  or one step away, not lost on arrival.
- **From Needs Attention** (Home) — identical in kind to the Home entry above, called out
  separately because it is exception-driven by definition (UX Architecture §5): the
  Workspace must open oriented toward the specific exception, not a general Overview.
- **Direct deep link** (e.g., returning to a bookmarked project, or a link shared outside
  SmartFlow) — no prior context can be assumed. Expected context: the same general
  orientation as the Projects-list entry.

No entry point skips Observe in favor of Act — even an entry driven by a pending approval
lands the user where they can see *why* before deciding (§11).

---

## 5. Workspace Screen Model

Screen-level structure only — no layout. Each destination below is described by
responsibility, not by whether it will ultimately be a page, a panel, or a step.

### Project Workspace (main screen)

- **Purpose:** the project's home base — orientation, current state, and the entry point
  to everything else.
- **Primary user question:** "What is this project's state, and what should I do now?"
- **Required information:** project identity and context (§7), Current Focus (§8), a
  concise Recent Activity summary (§9), Health (§15), Connections status (§16), and an
  indicator for any pending Approval.
- **Available actions:** open Recent Activity's full concise list, open History, open
  Evidence for a specific claim, open Approval Review if something is pending, open
  Execution Result for the most recent action, open Connections detail, enter Assistant
  with this project's context.
- **Must not appear here:** the full History timeline, a full Evidence/verification
  audit trail, raw repository content, or another project's data.

### Recent Activity — no separate deeper screen

Recent Activity is directly available on the main Workspace screen (UX Architecture §7)
as a concise, bounded list. It does not have its own "deeper" screen: going deeper than
Recent Activity means going to **History** (§9), not to an intermediate expanded Recent
Activity view. Introducing a separate destination here would duplicate History rather than
serve a distinct purpose, which UX Architecture explicitly rules out.

### History

- **Purpose:** the complete, investigable timeline for this project.
- **Primary user question:** "What has actually happened over time, and can I trace it?"
- **Required information:** execution audit, approval history, verification history, and
  significant project changes, in chronological order, each traceable back to its own
  Evidence.
- **Available actions:** filter or scan by kind (execution, approval, verification,
  status change); open the Evidence behind any entry.
- **Must not appear here:** a truncated "recent-only" view (that is Recent Activity's job,
  not History's) or an editable record — History is a read destination.

### Approval Review

- **Purpose:** the place every pending proposal for this project is reviewed and decided,
  independently of any other pending proposal. A project may have multiple pending
  approvals at the same time; each is reviewed and decided on its own.
- **Primary user question:** "Exactly what is being proposed, and should I allow it?" —
  asked once per pending proposal, never collectively.
- **Required information:** a list of every pending proposal for this project, each
  identified at a glance by its proposed action and target; and, for whichever one is
  being reviewed, everything specified in §12.
- **Available actions:** approve, reject, defer, or cancel a specific proposal (§12). No
  action here decides more than one proposal at once.
- **Must not appear here:** execution of the action itself (that only happens after
  approval, and is a separate step) or any bulk approve/reject affordance — independence
  between proposals (§12) means each is decided on its own merits, never as a batch.

### Execution Result

- **Purpose:** show what happened after an approved action ran.
- **Primary user question:** "Did it work, and what exactly happened?"
- **Required information:** everything specified in §13.
- **Available actions:** open the audit reference (History), open Evidence/Verification
  for the affected item, return to Overview, or address a related task.
- **Must not appear here:** a new, unrelated proposal — a result screen reports on one
  completed action, it does not originate the next one.

### Evidence & Verification

- **Purpose:** let the user inspect the facts behind any claim, health signal, or
  execution outcome, and see whether it has been verified.
- **Primary user question:** "What is this actually based on, and has it been confirmed?"
- **Required information:** everything specified in §14.
- **Available actions:** navigate back to whatever surfaced the claim (Overview, Health,
  Recent Activity, Execution Result).
- **Must not appear here:** a new recommendation or proposal — this destination reports
  facts, it does not add opinion.

### Connection Status / Details

- **Purpose:** this project's own view into its verified GitHub connection.
- **Primary user question:** "Is this project's connection healthy, and if not, what do I
  do?"
- **Required information:** everything specified in §16.
- **Available actions:** a recovery path pointing into the Connections domain.
- **Must not appear here:** provider setup or re-authorization flows themselves — those
  belong to the Connections domain (UX Architecture §11), not the Project Workspace.

No additional screens are introduced. Seven destinations (one main screen, six secondary)
cover every responsibility UX Architecture assigns to the Project Workspace.

---

## 6. Main Workspace Information Hierarchy

Three levels, applied to the eleven conceptual areas UX Architecture assigns to the
Workspace. This governs priority, not pixels.

| Area | Immediately visible | One deliberate interaction | Deep supporting detail |
|---|---|---|---|
| Overview | Current objective, most recent change, pending-approval flag | — | — |
| Objectives | The current objective only | The fuller objective set, if more than one is active | — |
| Current Focus | The single next step | Why it was chosen (§8) | Alternative/lower-priority candidates (§8) |
| Recent Activity | A short headline of the most relevant recent item | The full concise Recent Activity list (§9) | Full History (§5) |
| Assistant | A presence/availability indicator only | The Assistant surface, opened with project context (§10) | — (conversations are owned by the Assistant domain, not this Workspace, §10) |
| Execution | Whether something is currently executing, or just completed | Execution Result for that action (§13) | Full execution audit (History) |
| Evidence | Not shown as a headline — evidence supports, it does not lead | Evidence behind a specific claim, opened on demand (§14) | Full evidence/verification history (History) |
| History | Not visible at this level | An entry point into History | History itself |
| Health | One synthesized signal, always decomposable (§15) | The specific signals composing it | — |
| Connections | A connected / needs-attention indicator | Connection Status/Details (§16) | Recovery-path steps if disconnected |
| Approval | A pending-approval indicator/count | Approval Review (§12) | Approval history (History) |

Nothing in this table implies a screen count beyond §5, a navigation depth beyond UX
Architecture §4, or any visual arrangement.

---

## 7. Project Identity and Context

Present wherever the user is inside a given Project Workspace, regardless of which
destination (§5) they are on — this is identity, not a screen:

- **Project name** — the human-chosen label for the Software Project.
- **Repository identity** — which connected repository this project is backed by.
- **Connection state** — connected, needs attention, or disconnected, at a glance (full
  detail lives in §16).
- **Current objective** — the same objective shown in Overview (§6), so identity and
  state are never presented inconsistently across destinations.
- **Freshness / last synchronization** — when evidence was last retrieved, so "fresh" vs
  "stale" (§17) is never ambiguous.
- **Important project status** — anything that changes how the rest of the identity
  context should be read (e.g., archived repository, revoked access) — surfaced here
  first, because it reframes everything else on the screen.

---

## 8. Current Focus

**Purpose:** answer, in one place, "what is the single most valuable thing to look at or
do right now for this project" — the project-level instance of the "one primary focus"
principle (UX Architecture §2, §5).

**Relationship to other areas:**

- **Objectives** — Current Focus is always in service of an active objective; it is never
  presented as detached from what the project is trying to accomplish.
- **Roadmap** — Current Focus may reflect the next unreached roadmap milestone, but is not
  the roadmap itself; the roadmap is referenced, not restated (UX Architecture §6).
- **Tasks** — Current Focus may point at a task, but does not duplicate or manage it;
  Tasks retains ownership (UX Architecture §8, §16 of this spec's own §4 entry point).
- **Assistant suggestions** — a suggestion becomes a candidate for Current Focus once it
  is the most relevant thing to surface; it does not become Current Focus merely by being
  suggested.
- **Pending approvals** — a project may have several pending approvals at once (§12); if
  the single most urgent one is genuinely what is blocking progress, it is a strong
  candidate for Current Focus. Having multiple pending approvals does not create multiple
  Current Focuses — at most one is surfaced there, with the rest reachable through the
  Approval indicator and Approval Review's own list (§5, §12). A pending approval is not
  automatically promoted to Current Focus if something else is more urgent (e.g., a failed
  execution needing attention first).

**Multiple priorities or conflicts:** Current Focus remains singular at all times,
consistent with "one primary focus." Where more than one thing is genuinely competing for
attention, the runner-up candidates are available one interaction away (§6) rather than
shown simultaneously — the Workspace picks one and explains why, it does not present a
ranked list as the default view.

---

## 9. Recent Activity

### Shared Importance Definition

Recent Activity, Health (§15), and Home's Needs Attention (UX Architecture §5) all draw on
one shared definition of what counts as an important event, even though each applies its
own presentation rules on top of it. **An event is important when it affects
understanding, action, risk, trust, progress, or project state.**

Qualifying examples:

- Project status changed
- Current Focus changed (§8)
- An approval was created, approved, rejected, or deferred (§12)
- Execution succeeded or failed (§13)
- A connection became disconnected, restored, or permission-limited (§16)
- Verification status changed (§14)
- A blocker was created or resolved
- An important task became overdue, or was completed
- Stale context became fresh, or fresh context became stale (§17)

Not important by default:

- Routine refresh
- Background synchronization
- Ordinary memory update
- Low-value comment activity
- Repeated, unchanged status
- Technical polling events

- **Which events qualify:** any event meeting the shared importance definition above.
  Recent Activity does not invent its own narrower or broader definition.
- **How many types may be shown:** unbounded in kind (any qualifying event type may
  appear) but bounded in volume — Recent Activity remains a concise, operational summary,
  not a record of everything that happened; see "how it differs from History" below.
- **What every item requires:** what happened, when, which qualifying kind it is, and a
  path to the Evidence behind it (§14) — never a claim without a way to inspect it.
- **How it differs from History:** Recent Activity is a concise, operational summary for
  quick understanding, presenting only important events; History is the complete,
  investigable timeline for later traceability and audit, and may reasonably include
  lower-significance detail Recent Activity would never show (§5, §9 of UX Architecture).
  Recent Activity must never grow into a duplicate of History — if an item needs
  investigation rather than quick understanding, it belongs in History.
- **How the user reaches deeper context:** an explicit path from Recent Activity into
  History (§5), and, per item, a path into that item's own Evidence (§14). Exact item
  counts are not specified here — that is a wireframe-stage judgment, not an architectural
  one, provided the concise/bounded nature above is preserved.

---

## 10. Assistant Presence

Assistant appears within project context as a contextual manifestation of the same
Assistant domain reachable from Primary Navigation (UX Architecture §4, §10) — not as a
second assistant, and not as the owner of the Workspace.

- **Contextual awareness:** when entered from inside the Workspace, Assistant already has
  this project's Overview, Objectives, Current Focus, and Evidence available to it; it
  does not require the user to re-explain what project they mean.
- **Entry points:** the persistent Presence indicator available throughout the Workspace,
  and the full Assistant domain via Primary Navigation, entered with the same project
  context carried in if the user came from inside this Workspace (UX Architecture §10).
- **Proposal presentation:** a proposal is shown as a specific, named action with its
  reasoning attached — not executed inline, and not indistinguishable from a suggestion
  that is not yet actionable (see the transition below).
- **Explanation responsibilities:** every proposal and every Health or Current Focus
  judgment Assistant contributes to must be explainable back to Evidence (§14) on request
  — "why" is not optional.
- **Boundaries:** Assistant must never execute without explicit approval, never imply an
  action already happened when it has only been proposed, never chain actions without a
  separate approval for each, and never surface another project's or user's data (UX
  Architecture §10). The Workspace must not let Assistant's presence create an impression
  that it runs the Workspace — Assistant supports; it does not decide (UX Architecture
  §2).
- **Transition from suggestion to approval:** a suggestion (e.g., "you might want to
  update this issue") is conversational until the user chooses to act on it; only at that
  point does it become a proposal with the specific content Approval Review requires
  (§12). The Workspace must make this transition an explicit step, never an implicit one.
- **Conversation ownership:** conversations remain owned by the Assistant domain, not by
  the Project Workspace. A single conversation may reference one or more projects as
  context — it is not permanently bound to whichever project the user happened to be in
  when it started. The Workspace may expose relevant project-scoped conversation entry
  points or references (e.g., "continue the conversation about this project"), but it
  never claims ownership of the conversation itself, and nothing here forecloses a future
  conversation moving across multiple projects or drawing on broader personal context.

---

## 11. Observe → Understand → Act → Verify Mapping

| Stage | User question | Information required | Possible transitions | Trust / approval considerations |
|---|---|---|---|---|
| **Observe** | "What is actually true right now?" | Repository state, issues, roadmap position, recent activity (§9) — all already-validated read data (EPIC-06) | Into Understand (a synthesis forms), into History (deeper investigation), or exit the Workspace entirely | Nothing is proposed yet; nothing requires approval |
| **Understand** | "What does this mean, and what matters most?" | Current Focus (§8), Health (§15), any recommendation, all traceable to Evidence (§14) | Back to Observe (question the reasoning), into Act (a specific proposal), or exit without acting | Still no execution; trust is built by every claim being inspectable, not by confidence alone |
| **Act** | "Should this specific action happen?" | Everything Approval Review requires (§12) | Approve → Execution Result; reject or defer → back to Understand/Current Focus; cancel → no change | This is the only stage where user approval gates anything (ADR-0004) — single action, single approval, no batching |
| **Verify** | "Did it actually happen as described, and can I confirm it?" | Execution Result (§13) and Evidence/Verification status (§14) | Back to Observe (the project's state has changed) — closing the loop, not ending it | An unverifiable outcome must say so explicitly (§14), never be presented as confirmed when it is not |

Users may enter or leave at any stage (UX Architecture §12) — a user checking on
yesterday's approved action starts at Verify; a user just orienting themselves starts and
may stop at Understand. The Workspace must never force a path through Act to reach
information that belongs at Observe or Understand, and must never present the four stages
as sequential steps of a single guided process.

---

## 12. Approval Experience

A project may have multiple pending approvals at the same time (§5). Each is independent:
its own proposal, its own review, its own decision, never bundled with another's. The
following is required before a user may approve any single action, without exception:

- **Proposed action** — exactly what will be done, in plain terms (not a tool identifier).
- **Target** — the specific resource the action applies to (e.g., a specific issue).
- **Reason** — the evidence-backed justification (§14) for why this was proposed at all.
- **Expected effect** — what will change as a direct result, shown as a preview where the
  content allows it (e.g., the exact comment text, or the exact title/label diff).
- **Execution scope** — what this action is scoped to do and, just as importantly, what
  it cannot do (e.g., "this can comment on or update this issue; it cannot merge, delete,
  or modify anything else"), plus which project, repository, and connection it touches, so
  the user is never approving something ambiguous about reach.
- **Approval status** — pending, approved, rejected, deferred, or cancelled, for this
  specific proposal. With multiple independent pending approvals possible, status must
  always be legible per proposal, never implied by position in a list.
- **Risk or reversibility** — whether the action can be undone, and by what means, stated
  plainly rather than implied.

**Cancel, reject, and defer:**

- **Cancel** — the user abandons the review without deciding; nothing is recorded as a
  decision, and the proposal simply stops being presented.
- **Reject** — an explicit decision not to proceed, optionally with a reason; this may
  inform future Assistant suggestions but does not by itself change any project state.
- **Defer** — the user chooses not to decide now; the proposal remains pending and
  visible (via the Approval indicator, §6, and Home's Needs Attention, UX Architecture
  §5) until it is approved, rejected, or cancelled.

No path from this screen executes anything. Execution is a separate step that only
follows an explicit approval (ADR-0004).

---

## 13. Execution Result

Required after any approved action runs:

- **Status** — succeeded, failed, or (transiently) in progress (§17).
- **Action performed** — restated exactly as it was approved, not a generic confirmation.
- **Affected target** — the same target named during Approval (§12), so the user can
  confirm nothing shifted between approval and execution.
- **Result summary** — what actually happened, in plain terms.
- **Failure explanation** — if it failed, why, and what the user's next option is (retry
  requires a fresh proposal and a fresh approval — never an automatic retry, per
  ADR-0004).
- **Audit reference** — a path into History (§5) for this specific execution record.
- **Next available step** — return to Overview, inspect Evidence/Verification (§14), or
  address a related task (§8) — never a new, unrelated proposal originating from this
  screen (§5).

---

## 14. Evidence and Verification

Four distinct things, never collapsed into one:

- **Action result** — what the execution step itself reported happened (§13). This is a
  claim, not yet confirmation.
- **Evidence** — the underlying, inspectable facts a claim, health signal, or
  recommendation is based on (e.g., the actual current state of an issue).
- **Verification status** — whether the action result has been independently checked
  against current evidence and found to match. This is what closes Observe → Understand →
  Act → Verify back to Observe (§11).
- **Unresolved uncertainty** — when verification could not be completed (e.g., the
  connection was unavailable at the moment of checking). This must be stated explicitly as
  its own condition — **never** silently presented as if verification succeeded, and never
  silently presented as if it failed when it simply has not been confirmed yet.

---

## 15. Project Health

Health is a synthesized signal, but it is never an unexplained single score — it must
always be decomposable into the specific signals behind it, each traceable to Evidence
(§14). The signals it draws on are important events under the shared importance
definition (§9) — Health does not invent a separate standard for what matters.

**Conceptual signals that may contribute:**

- Connection health (§16)
- Context freshness (§7, §17)
- Blocked work (one or more pending approvals, a failed execution, a stalled objective)
- Failed execution (§13)
- Incomplete verification (§14)
- An overdue or newly-completed important task (referenced from Tasks, §8; "important"
  per the shared definition, §9)

**Health vs. Needs Attention:** Health is this Workspace's own, always-available,
project-scoped signal — it exists whenever the Workspace is open, healthy or not. Needs
Attention (UX Architecture §5) is Home's cross-project rollup of the same underlying
exceptions, shown only when at least one is genuinely actionable, and only at Home's
level. The two are not competing summaries of different things — Needs Attention surfaces
a subset of what Health already knows, at a different scope, only when action is actually
warranted.

---

## 16. Connections

The Project Workspace's own responsibility is limited to **this project's** GitHub
connection state — not provider setup, which belongs to the Connections domain (UX
Architecture §11).

- **Connected** — verified and current; nothing further required.
- **Disconnected** — the connection no longer exists; the Workspace states this plainly
  and offers the recovery path below.
- **Permission problem** — the connection exists but no longer has the access it needs
  (e.g., a repository was removed from the installation); distinguished from a full
  disconnect because the fix is different.
- **Stale** — connected, but evidence has not been refreshed recently enough to trust
  without saying so (§7, §17).
- **Partially available** — some connected capability works and some does not (e.g.,
  repository state is reachable but issue data is not); the Workspace must show what is
  and is not available rather than presenting a single connected/disconnected binary.
- **Recovery path** — in every non-connected case, a clear path into the Connections
  domain to resolve it. The Workspace surfaces the problem and points at the fix; it does
  not attempt to resolve the connection itself.

---

## 17. Workspace States

| State | Content | Allowed actions |
|---|---|---|
| **Loading** | An explicit indication that evidence is being retrieved — distinct from Empty | None yet; wait or leave |
| **Empty project** | A newly connected project with no tracked activity yet; explains what happened and what to do next (per existing empty-state philosophy) | Explore Connections/repository state directly; no Recent Activity or History to show yet |
| **Partially connected** | States plainly which capability is available and which is not (§16) | Whatever the available capability supports; recovery path for the rest |
| **Fresh** | Evidence retrieved recently; shown with full confidence | All normal actions |
| **Stale** | Evidence is old enough to flag; labeled as such rather than presented as current | All normal actions, with staleness disclosed on every affected claim |
| **Offline** | No connection to retrieve evidence; last-known evidence may be shown, explicitly labeled as not current | Viewing only — no new proposal or approval may be initiated |
| **Error** | Evidence retrieval or execution failed; explained in terms of what happened and what the user can do | Retry the retrieval, or leave; never presented as a successful Verify |
| **No actionable work** | Nothing currently needs the user's decision | Normal browsing of Overview/Recent Activity/History; no Approval indicator shown |
| **Pending approval** | The Approval indicator shows a count; one or more independent proposals are available for review (§12) | Enter Approval Review for any pending proposal, or defer any of them individually (each remains pending on its own) |
| **Execution in progress** | A specific approved action is running | Wait for that action; other independent pending approvals remain reviewable and may still be approved in the meantime, each producing its own separate execution and audit record — this state describes one action's execution, not a project-wide lock |
| **Execution succeeded** | Execution Result shown in full (§13) | Proceed to Verify-related actions, or return to Overview |
| **Execution failed** | Execution Result's failure explanation shown in full (§13) | A fresh proposal may be created and approved again; no automatic retry |
| **Verification incomplete** | Stated explicitly as its own condition (§14) | Retry verification if the underlying cause (e.g., connectivity) is resolved; never presented as confirmed |

---

## 18. Responsive Behaviour

Conceptual differences only — no breakpoints, pixels, or component layouts.

- **Information priority** — on constrained space, the "immediately visible" row of §6
  (Overview, Current Focus, Approval/Health indicators) must still be immediately visible;
  everything in "one deliberate interaction" or deeper may collapse behind an explicit
  step rather than staying on-screen.
- **Navigation depth** — consistent with UX Architecture §4: primary navigation stays
  reachable in one step regardless of device; secondary navigation (moving between
  Workspace destinations, §5) may need to collapse behind an explicit entry point on
  constrained space rather than remain persistently visible.
- **Progressive disclosure** — the mechanism for adapting to less space, not a reason to
  hide a capability entirely (UX Architecture §2, §14).
- **Approval safety** — Approval Review's required information (§12) must never be
  abbreviated to fit less space; on a constrained device it may need to become its own
  full step rather than an inline expansion, but nothing in §12 may be omitted or
  deferred to a "see more" the user might skip past.
- **Long histories** — History (§5) must be consumable in bounded chunks appropriate to
  the device, not an unbounded scroll dump, regardless of viewport.
- **Assistant access** — the Presence indicator (§10) must not consume enough space on a
  constrained device to make Primary Navigation harder to reach — the resolved separation
  between the two (UX Architecture §4) applies at every viewport.

---

## 19. RTL and Localisation

- **Reading order** — follows the resolved interface/response direction rules already in
  place (UX Architecture §14); this document does not change them.
- **Mixed RTL/LTR technical content** — repository names, issue identifiers, code, and
  paths remain left-to-right even inside right-to-left surrounding text, consistent with
  SmartFlow's existing validated behavior (isolated Latin/technical content computing as
  LTR within an RTL flow).
- **Repository names and issue identifiers** — treated as opaque technical tokens, never
  transliterated or reordered.
- **Code and paths** — same treatment; never wrapped mid-token in a way that would make
  them unreadable or unreproducible.
- **Timestamps** — locale-appropriate presentation, but never ambiguous about absolute
  time — this matters directly for Freshness (§7) and Execution Result (§13).
- **Action labels** — translated, but precision about the exact action (§12) takes
  priority over idiomatic phrasing — an Approval Review label must never become vaguer in
  translation than the English original.
- **Text expansion** — German text runs measurably longer than English; nothing in
  Approval Review, Execution Result, or the identity context (§7) may assume English-length
  labels fit every supported language.

---

## 20. Accessibility

- **Keyboard navigation** — every destination in §5, every action in §12–§13, and every
  Workspace state's available actions (§17) must be reachable and operable without a
  pointing device.
- **Screen readers** — Approval Review's required information (§12) and Execution Result's
  content (§13) must be exposed as structured, readable content — never implied by icon or
  color alone.
- **Focus order** — entering a secondary destination (§5) should move focus to that
  destination's primary content (e.g., the proposed action in Approval Review), not leave
  it stranded on whatever triggered the navigation.
- **Status announcements** — transitions between Workspace states (§17) — especially
  execution in progress → succeeded/failed, and verification incomplete — must be
  announced, not only shown visually.
- **Approval confirmation** — the act of approving must have an unambiguous, announced
  confirmation; it is the single most consequential action in the Workspace and must never
  rely on a bare icon or color change.
- **Error communication** — every error state (§17) explained in text, never by color
  alone.
- **Reduced motion** — consistent with UX Architecture §14: Flow AI's presence and any
  state transition must remain legible without relying on motion to carry meaning that has
  no static equivalent.

---

## 21. Low-Fidelity Wireframe Inventory

Minimal set — each wireframe covers one screen (§5) across the states (§17) that actually
change its content, rather than a separate wireframe per state.

1. **Project Workspace — Main (desktop baseline)**
   *Scenario:* a healthy, fresh, connected project with a clear Current Focus.
   *Purpose:* validate the main screen's information hierarchy (§6) at full width.
   *Required states:* Fresh; No actionable work.

2. **Project Workspace — Main (mobile baseline)**
   *Scenario:* the same healthy project, constrained space.
   *Purpose:* validate responsive information priority (§18) against the desktop
   baseline.
   *Required states:* Fresh; No actionable work.

3. **Project Workspace — Attention states**
   *Scenario:* a project with something wrong: a pending approval, a failed execution
   needing attention, stale evidence, or a newly connected empty project.
   *Purpose:* validate that Health, the Approval indicator, and Current Focus correctly
   reflect a non-default condition without becoming a dense dashboard.
   *Required states:* Pending approval; Stale; Empty project; Execution failed
   (as documented state variants of one screen).

4. **Approval Review**
   *Scenario:* one specific proposed action awaiting a decision, plus a project with more
   than one independent pending approval at once.
   *Purpose:* validate that every required item in §12 is present and legible for a
   single proposal, and that multiple independent pending proposals remain clearly
   separated rather than implying a batch decision.
   *Required states:* Single pending approval; multiple simultaneous pending approvals;
   reject/defer acknowledgment.

5. **Execution Result**
   *Scenario:* an approved action has just run.
   *Purpose:* validate §13's required content for both outcomes.
   *Required states:* Execution succeeded; Execution failed.

6. **Evidence & Verification**
   *Scenario:* inspecting the facts behind a specific claim or execution outcome.
   *Purpose:* validate that the four distinctions in §14 read as genuinely distinct, not
   as one undifferentiated block.
   *Required states:* Verified; Verification incomplete.

7. **History**
   *Scenario:* reviewing the full timeline for investigation or audit.
   *Purpose:* validate that History reads as materially deeper than Recent Activity, not
   a restatement of it.
   *Required states:* populated timeline; long-history pagination/chunking (§18).

8. **Connection Status / Details**
   *Scenario:* this project's GitHub connection needs attention.
   *Purpose:* validate that the six connection conditions in §16 are each distinguishable
   and each offer a clear recovery path.
   *Required states:* Disconnected; Permission problem; Partially available.

Eight wireframes cover the full screen model (§5) and every Workspace state (§17) that
materially changes a screen's content.

---

## 22. Out of Scope

Explicitly excluded from this specification:

- Final visual design of any kind
- Colours
- Typography decisions
- Design tokens
- Component APIs or component names
- React, or any other implementation technology
- Backend, database, or API design
- EPIC-08 (Write Code) implementation
- EPIC-09 (Agent Autonomy) implementation
- Unrestricted or chained execution of any kind — every Act step in this document remains
  single-action, single-approval (§11, §12)

---

## 23. Open Decisions

The three questions raised in the previous revision — whether multiple pending approvals
are allowed, what defines an "important" event, and how project-scoped Assistant
conversation is owned — have all been resolved by Product Owner decision (§5, §8, §9,
§12, §15, §17 for the first; §9, §15 for the second; §10 for the third).

No open decisions remain at this time. New ones may surface once low-fidelity wireframes
(§21) test these decisions against an actual screen; this section will be reopened then
rather than speculatively populated now.

---

## Consistency Review

No contradictions were found between this specification and
[`product-direction-v1.md`](../../product/product-direction-v1.md) or
[`ux-architecture-v1.md`](ux-architecture-v1.md) — every screen, hierarchy decision, and
boundary above traces to a specific section of one or both.

Two pre-existing tensions were noted in older experience documents during review, neither
of which this document resolves or overrides:

- [`02_living_workspace.md`](../experience/02_living_workspace.md) describes Home's
  original "Zone 1/2/3" and priority-tier model, written before Projects existed as a
  first-class domain or Needs Attention existed as a concept (UX Architecture §5). This
  document does not redesign Home; it only specifies how the Project Workspace is entered
  from it (§4). The older document's own alignment with the current Home definition
  remains the deferred documentation-alignment work already recorded in
  `ux-architecture-v1.md` §10 and `product-direction-v1.md` §17–§18, not something this
  task resolves.
- The already-recorded tension between
  [`04_flow_ai_conversation.md`](../experience/04_flow_ai_conversation.md)'s "Multi-step
  Thinking" / "AI Initiative" language and the approval-bounded execution model is carried
  forward unchanged here (§10, §11): Assistant's proposals in this Workspace remain
  single-step and approval-gated regardless of how proactively it may speak.

---

## References

- [`docs/product/product-direction-v1.md`](../../product/product-direction-v1.md)
- [`docs/design/ux/ux-architecture-v1.md`](ux-architecture-v1.md)
- [`docs/design/experience/02_living_workspace.md`](../experience/02_living_workspace.md)
- [`docs/design/experience/04_flow_ai_conversation.md`](../experience/04_flow_ai_conversation.md)
- [`docs/decisions/adr/ADR-0004-write-boundaries.md`](../../decisions/adr/ADR-0004-write-boundaries.md)
- [`docs/decisions/adr/ADR-0002 — Flow AI Presence Architecture.md`](../../decisions/adr/ADR-0002%20—%20Flow%20AI%20Presence%20Architecture.md)
- [`PROJECT_STATUS.md`](../../../PROJECT_STATUS.md)
