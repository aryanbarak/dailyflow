# SmartFlow Product Direction v1

**Version:** 1.1
**Status:** Approved — Product Owner decisions incorporated 2026-07-27
**Date:** 2026-07-27 (revised)
**Scope:** Product definition only. No UX architecture, no wireframes, no implementation.

---

## 1. Purpose of This Document

EPIC-07 is complete, validated, and deployed. EPIC-08 and EPIC-09 are paused under a
feature freeze. This checkpoint is used to define the next product direction before any
further engine, UX, or execution work resumes.

This document is the single source of truth for that direction. It does not replace
[`docs/design/vision/SMARTFLOW_PRODUCT_BIBLE.md`](../design/vision/SMARTFLOW_PRODUCT_BIBLE.md)
(brand, tone, motion philosophy) or [`docs/roadmap/product-roadmap.md`](../roadmap/product-roadmap.md)
(version-based feature sequencing). It sits above both: it decides what the product *is*
for its next phase, so that the Bible's identity language and the Roadmap's feature
sequencing can be re-checked against it rather than silently reinterpreted.

No existing document owned this content, so this is a new document. `docs/product/` is
approved by the Product Owner as the canonical location for product-direction
documentation, even though it is not yet listed in
[`DOCUMENTATION_STANDARD_V1.0.md`](../standards/DOCUMENTATION_STANDARD_V1.0.md)'s folder
structure. Updating that standard, and the related index drift it surfaced, is recorded as
bounded follow-up work rather than done here — see §18.

This revision incorporates a set of Product Owner decisions dated 2026-07-27 that resolve
most of the open questions the first version of this document raised. Where a decision
below states current-phase scope, it is deliberately narrower than SmartFlow's long-term
vision (§2) — narrower scope now is not a reduced ambition, it is a sequencing choice.

---

## 2. Product Mission

**Long-term vision (unchanged).** SmartFlow remains a Personal Life Operating System: an
AI-powered product that reduces cognitive load by letting Flow AI understand, organize,
and guide the user's whole life, not only their work.

**Current product phase.** Software projects are the primary proving ground through which
the complete loop — **Observe → Understand → Act → Verify** — is implemented and
validated end-to-end. This is a focused product phase, not a permanent rejection of the
broader Life OS vision and not a full product rename. The technical foundation built
through EPIC-01–EPIC-07 — deterministic workspace pipeline, agent reasoning with explicit
approval, bounded execution, audit — was built and validated primarily against
work-shaped problems (tasks, GitHub, planning). This phase formalizes that as the
intentional starting point rather than an accident of sequencing, and defers extending the
same trust model to the rest of life until the loop is proven here first.

---

## 3. Product Identity

SmartFlow remains one product with one AI identity, Flow AI, as defined by
[ADR-0002](../decisions/ADR/ADR-0002%20—%20Flow%20AI%20Presence%20Architecture.md) and the
Product Bible. Nothing in this phase changes the Orb, the presence model, or the "AI
first, calm technology" philosophy.

What changes is *emphasis*, not the product's name or long-term identity. Where the
Product Bible and Roadmap describe SmartFlow as already spanning tasks, calendar,
documents, finance, family, photos, and music in parallel, this phase treats **Projects**
as the product's primary proving ground and the place where the next increment of trust
(understanding → approval → controlled execution → verified evidence) is earned first.
Other modules continue to exist and are not being removed, frozen, or deprioritized in
maintenance terms — but they are not where new product-defining work happens next.

### Projects as an Extensible Domain

**Projects** is the product-level domain name — this does not change and does not
compete with any parallel domain. Within it, a **Project** has a type, and the current
phase defines exactly one:

- **Software Project** — the concrete, in-scope project type for this phase: a project
  backed by a real repository, roadmap, and GitHub-tracked work (§9–§10).
- **Learning Project** — a possible future type (e.g., a Smart Academy course or
  self-directed learning goal modeled as a project). Not in scope now.
- **Personal Project** — a possible future type (e.g., a non-software life project — a
  move, a renovation, a personal goal). Not in scope now.

Only Software Project is built or validated in this phase. The other two are named here
so that the Software Project data model and UX are not accidentally designed in a way that
forecloses them later.

The existing generic "Projects" module concept in
[`06_module_philosophy.md`](../design/system/06_module_philosophy.md) (goals, milestones,
progress, knowledge, meetings, files) predates this taxonomy and was written before a
Project *type* existed as a concept. It is not superseded today, and no document is
rewritten as part of this decision — but it must later be aligned with this extensible
Project/type model rather than treated as a separate, competing definition of "Projects."
This alignment is recorded as deferred product follow-up work (§17), not resolved here.

---

## 4. Primary Target User

The primary target user for this phase is the user already validated by EPIC-06/07: an
individual technical user (developer or technical operator) who owns or contributes to
real repositories, tracks work through GitHub Issues/Epics, and wants a single place to
see project state, understand what matters now, and act on it without leaving that place
to check five other tools.

This is narrower than the Product Bible's eventual "everyone managing their whole life"
user. That remains the long-term audience; it is not who the next phase is designed for
first.

---

## 5. Core User Problems

1. Project state is scattered across the repository, GitHub Issues/Epics, roadmap
   documents, and the user's own memory of what they decided last.
2. There is no single place that answers "what is this project's current objective, and
   what should happen next" without manually re-deriving it each time.
3. Recent changes and decisions are not visibly connected to the roadmap or the next
   action — context has to be rebuilt from git history and conversation memory.
4. Acting on a recommendation (comment, update, eventually code/PR changes) requires
   trusting that the action is safe, reviewable, and reversible — a problem SmartFlow's
   agent safety architecture already solves at the tool level, but not yet at the level of
   a coherent project view.

---

## 6. Core Value Proposition

SmartFlow turns a project into something Flow AI actively understands and helps operate,
inside the same approval and audit boundaries already proven for tasks and GitHub in
EPIC-06/07: **Observe → Understand → Act → Verify**, with the user always in control of
the Act step.

---

## 7. Product Scope (This Phase)

**In scope:**

- Projects as a first-class product domain, sitting alongside (not replacing) Home,
  Tasks, Learning, Assistant, and Connections.
- **Software Project** as the one concrete Project type built and validated this phase.
- A Software Project's product-level composition: repository state, roadmap, current
  objective, next actions, recent changes, documentation, project context, assistant
  recommendations, approval, controlled execution, verification and evidence.
- GitHub as the one fully supported Project connection (§10).
- The relationship between this domain and the existing engines/approval/execution/audit
  architecture (§12).
- The canonical EPIC-06–EPIC-09 classification (§13).

**Out of scope for this phase** (not decided or designed here): UX architecture, page
layout, navigation design, wireframes, a detailed implementation plan, and any
EPIC-08/EPIC-09 implementation work.

**Deferred future scope** (named for continuity, not designed or scheduled now):

- Learning Project and Personal Project as additional Project types (§3).
- Aligning the pre-existing generic "Projects" module concept with the Project/type model
  (§3, §17).
- Additional Connections providers beyond GitHub — email, calendar, other code hosts (§10).
- EPIC-09's full bounded-autonomy definition (§13, §16).

---

## 8. Explicit Non-Goals

- This is not a decision to abandon or shrink the Life Operating System mission.
- This is not a decision to merge Smart Academy's learning product into SmartFlow (§11).
- This is not a decision about specific UI, navigation, or page structure.
- This is not a decision to expand write/execution scope beyond what ADR-0004 already
  bounds. EPIC-08/EPIC-09 remain frozen; nothing here authorizes resuming them.
- This is not a claim that EPIC-01–EPIC-05's foundation needs rework. It is treated as
  correct and load-bearing throughout this document.

---

## 9. Why Project Becomes a First-Class Product Domain

Three reasons, all derived from what is already true in the codebase rather than asserted
new:

1. **The safety architecture is already project-shaped.** Tool Registry, Execution
   Policy, the approval dialog, and Execution Audit (see
   [ADR-0004](../adr/ADR-0004-write-boundaries.md)) were built and validated against
   GitHub repository/issue operations — inherently project data. Extending them to more
   life domains before proving the full Observe→Understand→Act→Verify loop on the domain
   they already fit best would spend new UX and engineering effort before the existing
   investment is fully realized.
2. **A project is where "understanding" is cheapest to verify.** Repository state,
   issues, and roadmap documents are externally checkable facts. This makes the Verify
   step concrete (did the comment post, did the issue update match the diff shown) in a
   way that health or finance recommendations are not yet ready for.
3. **It directly follows EPIC-06/07, not around them.** Read-only GitHub integration and
   Write-Light are both project-domain work already shipped. Naming Project a first-class
   domain formalizes what the last two epics already built toward, rather than opening a
   new, unvalidated surface.

---

## 10. Relationship Between Home, Projects, Tasks, Learning, Assistant, Connections

Described at product-responsibility level only — no layout, navigation, or page design is
decided here.

- **Home** — the entry surface. Continues the existing Living Workspace/Dashboard
  responsibility: a live, prepared overview of what matters right now, across whatever
  domains are active for the user (including Projects). It does not own project-specific
  detail.
- **Projects** — the new domain defined in this document. Owns project-level state,
  objective, next actions, recommendations, approval, and verified execution history for
  a given project. A project may reference GitHub repository state, but Projects is the
  product owner of that experience, not GitHub integration in isolation.
- **Tasks** — remains the existing task-management domain (list, prioritize, complete).
  A project's "next actions" may surface or relate to tasks, but Tasks is not absorbed
  into Projects; it remains its own domain with its own existing write path
  (`tasks.complete`).
- **Learning** — remains Smart Academy's domain boundary as already established (§11).
  SmartFlow may reference a learning objective from within a project's context, but does
  not own or reimplement the learning experience.
- **Assistant** — Flow AI's conversational surface (`ChatPage`/reasoning layer). Remains
  the shared interaction layer other domains propose actions through; it does not gain
  new authority beyond what Execution Policy already grants per tool.
- **Connections** — a provider-neutral product domain: the home for verified external
  integrations in general, not a GitHub-specific concept. **GitHub is the only fully
  supported Project connection in the current phase**, via the existing App-installation
  flow. Email, calendar, and other providers are possible future integrations but are
  explicitly out of scope for this phase (§7). Projects consumes Connections' verified
  state; Connections does not itself become a per-project view.

None of these domains gain new execution authority from this document. Any new tool,
write path, or execution capability still requires its own ADR, per ADR-0001 and the
precedent set by ADR-0004.

---

## 11. Relationship Between SmartFlow and Smart Academy

Unchanged by this phase, and explicitly reaffirmed: Smart Academy remains an independent
learning product. SmartFlow may understand and manage a Smart Academy *project* (e.g.,
tracking its repository, roadmap, and next actions as a Project entity, the same way it
would for any other repository), but it must not absorb the Smart Academy learning
experience, its content, or its codebase into SmartFlow's own product surface. This
mirrors the existing deliberate separation already stated in
[`CLAUDE.md`](../../CLAUDE.md) between the agent core and Learn AI.

---

## 12. Relationship to the Existing Architecture

This phase does not modify, replace, or re-derive any existing engine or safety boundary.
The Workspace Pipeline, Signal Engine, Memory Engine, Interaction Feedback, Personalization
Engine, Priority Engine, Goal Engine, Planner Engine, Approval Model, Tool Registry,
Execution Policy, Execution Engine, and Execution Audit — as documented in
[`PROJECT_STATUS.md`](../../PROJECT_STATUS.md) §4–§6 and
[`01-architecture-baseline.md`](../architecture/01-architecture-baseline.md) — remain the
technical foundation. A Project domain is a new product-level composition of what these
engines and the GitHub integration ([`github-read-only-integration-v1.md`](../architecture/github-read-only-integration-v1.md),
[ADR-0004](../adr/ADR-0004-write-boundaries.md)) already produce; it is not a new engine,
and it does not require re-litigating deterministic validation, the LLM-proposes/user-
approves boundary, or the audit trail. Any UX Architecture work that follows this document
must consume these systems as-is, not redesign them.

---

## 13. Relationship to the Existing Roadmap

These are now the **canonical** EPIC-06–EPIC-09 names and classifications at the product
level, as decided by the Product Owner, establishing their relationship to the existing
roadmap and to this document's Project domain. The repository's prior documentation did
not previously define this numbering consistently — `ADR-0004` and `githubTools.ts`
comments named EPIC-07 explicitly but only gestured at EPIC-08/09, and GitHub Issues in
this repo use a separate, unnumbered Epic-label scheme entirely (Dashboard, AI Assistant,
Tasks, Calendar, etc.). That inconsistency is acknowledged, not silently corrected; no
GitHub Issue is modified by this document.

- **EPIC-06 — Roadmap / GitHub read integration.** *Completed foundation.* Live in
  production per `PROJECT_STATUS.md` §3 — all four read-only tools
  (`github.repositories.list/issues.list/pulls.list/workflow_runs.list`) resolve end to
  end. This is the evidentiary base the Project domain's "Observe" step draws on directly.
- **EPIC-07 — Write Light.** *Completed foundation.* Confirmed by this checkpoint and
  ADR-0004. Establishes the approval→preview→execute→audit pattern for a second write tool
  beyond `tasks.complete`. This is the pattern the Project domain's "Act" step reuses, not
  replaces.
- **EPIC-08 — Write Code.** *Frozen; requires re-scoping as a controlled Project-domain
  Act capability.* Its prior framing (new issues, file/code/PR operations, scoped to
  GitHub in isolation) is superseded by this direction: EPIC-08's capabilities belong
  inside the Software Project's "Act" step, scoped against that project's own approval and
  verification model, rather than as a freestanding GitHub write expansion. It stays
  frozen until re-scoped this way, per ADR-0004's existing requirement for a new ADR
  before any implementation.
- **EPIC-09 — Agent Autonomy.** *Frozen; requires a later bounded-autonomy definition.*
  EPIC-09 does **not** mean unrestricted autonomous operation. Whatever it eventually
  authorizes must remain constrained by the same boundaries already governing every write
  tool today: approval boundaries, execution policy, tool permissions, audit,
  verification, and user control (§12, §14). This document fixes EPIC-09's name and its
  non-negotiable constraints; it does not scope its content, timeline, or owner — that
  remains deferred future work (§16).

---

## 14. Product Boundaries

SmartFlow, in this phase and for the foreseeable future, is explicitly **not**:

- An IDE replacement. It does not edit code in a general-purpose way or replace the
  developer's editor.
- A GitHub replacement. It consumes and, in narrowly approved ways, writes to GitHub; it
  does not replace GitHub's own UI, review tools, or permission model.
- A fully autonomous coding agent. Every write remains proposal → deterministic validation
  → explicit user approval → single execution → audit, per ADR-0004. No milestone in this
  document changes that, including whatever EPIC-09 — Agent Autonomy eventually authorizes
  (§13): it must operate inside these same boundaries, not around them.
- An unlimited life-management platform in this phase. The Life OS mission is long-term
  and unchanged (§2), but this phase does not expand new product surface into health,
  finance, family, or similar domains.

---

## 15. Success Criteria for the Next Product Phase

This phase (product definition) succeeds when:

- The Product Owner decisions in this revision are reflected consistently throughout the
  document (done as of this revision).
- The remaining open items in §16 have an owner and are not silently forgotten.
- The deferred follow-up work in §17 and §18 is tracked, even though none of it blocks the
  next step.
- A follow-on UX Architecture effort can begin from this document — scoped to the Software
  Project current phase — without needing to re-derive product scope, non-goals, or domain
  boundaries from scratch.

Success for the *product* itself (post-implementation, out of scope for this document but
stated for continuity) will ultimately be measured by whether a user's project understanding,
approval, and verified action genuinely reduce the manual work of tracking a project's
state — not by feature count.

---

## 16. Open Product Decisions

Genuinely unresolved items only — everything else the first version of this document
raised has been decided by the Product Owner and is reflected in the sections above.

1. **Ownership and timing for EPIC-09's full bounded-autonomy definition.** §13 fixes
   EPIC-09's name ("Agent Autonomy") and its non-negotiable constraints, but not its
   content, owner, or timeline. Someone must be assigned to scope it before it can move
   from "frozen" to "planned."
2. **Sequencing of the Software Project "Act" step against EPIC-08's re-scoping ADR.**
   UX Architecture could plausibly begin on Observe/Understand/Verify for the Software
   Project type before the EPIC-08 re-scoping ADR (§13) is accepted, deferring Act-step
   design until that ADR lands — or it could wait for the ADR first. This document does
   not decide that sequencing.

---

## 17. Product Follow-up Work (Deferred, Not Blocking)

Named for continuity so they are not rediscovered later as if new, and explicitly not
scheduled or resolved by this document:

1. **Align the legacy generic "Projects" concept with the Project/type taxonomy.**
   [`06_module_philosophy.md`](../design/system/06_module_philosophy.md)'s existing
   "Projects" module (goals, milestones, progress, knowledge, meetings, files) predates
   the Software Project / Learning Project / Personal Project taxonomy (§3) and is not
   rewritten here. It must be reconciled with that taxonomy before both are designed in
   UX Architecture, but no owner or timing is set yet.
2. **Additional Connections providers.** Email, calendar, and other code hosts remain
   possible future integrations (§10) but are not evaluated, scoped, or scheduled in this
   phase.

---

## 18. Documentation Alignment Follow-up (Deferred, Not Blocking)

Pure documentation-structure housekeeping, identified during research for this document
and explicitly deferred rather than fixed here, per the Product Owner's instruction not to
expand this task's scope:

1. **Documentation Standard does not list `docs/product/`.**
   `DOCUMENTATION_STANDARD_V1.0.md`'s folder structure should be updated now that
   `docs/product/` is approved as canonical (§1).
2. **`ADR_INDEX.md` does not list ADR-0004.** The index should be updated to include it.
3. **ADR-0004 is filed at a nonstandard path.** `ADR-0004-write-boundaries.md` lives at
   `docs/adr/` (lowercase, singular) instead of `docs/decisions/ADR/`, as ADR-0001
   prescribes. This document links to ADR-0004 at its actual current path; a future
   change should either move the file or update the standard to reflect where ADRs
   referencing write boundaries actually live.
4. **Empty duplicate roadmap file.** `docs/design/vision/07_product_roadmap.md` is empty
   while `docs/roadmap/product-roadmap.md` holds the real, current roadmap content. It
   should be deleted or consolidated as routine documentation maintenance.

---

## References

- [`SMARTFLOW_PRODUCT_BIBLE.md`](../design/vision/SMARTFLOW_PRODUCT_BIBLE.md)
- [`docs/roadmap/product-roadmap.md`](../roadmap/product-roadmap.md)
- [`docs/design/system/06_module_philosophy.md`](../design/system/06_module_philosophy.md)
- [`docs/architecture/01-architecture-baseline.md`](../architecture/01-architecture-baseline.md)
- [`docs/architecture/github-read-only-integration-v1.md`](../architecture/github-read-only-integration-v1.md)
- [`docs/adr/ADR-0004-write-boundaries.md`](../adr/ADR-0004-write-boundaries.md)
- [`docs/decisions/ADR/ADR-0001-architecture-decision-record-policy.md`](../decisions/ADR/ADR-0001-architecture-decision-record-policy.md)
- [`docs/decisions/ADR/ADR-0002 — Flow AI Presence Architecture.md`](../decisions/ADR/ADR-0002%20—%20Flow%20AI%20Presence%20Architecture.md)
- [`docs/decisions/ADR/ADR-0003-agent-reason-local-qa-only.md`](../decisions/ADR/ADR-0003-agent-reason-local-qa-only.md)
- [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md)
- [`CLAUDE.md`](../../CLAUDE.md)
