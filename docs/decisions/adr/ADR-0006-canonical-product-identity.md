# ADR-0006: Canonical Product Identity

- **Status:** Accepted
- **Date:** 2026-08-01
- **Decision Makers:** Product Owner (decision), Software Architect / Claude Code (drafting and documentation only)
- **Supersedes:** None
- **Superseded by:** None

---

## Context

SmartFlow's repository already contains several identity-adjacent statements
spread across independent documents, none of which was ever the canonical
answer to "what is SmartFlow fundamentally": the Product Bible and roadmap
describe an aspirational "AI-powered Life Operating System" and "Digital Life
Companion"; `product-direction-v1.md` narrows the current phase to Software
Projects as a "proving ground" while explicitly stating that is not a
permanent identity; and `representative-engine.md` defines an internal
architectural boundary (not a product-facing name) for how SmartFlow
represents user and project context under bounded authority.

Two rounds of architecture-review analysis (an initial candidate evaluation
and an adversarial challenge pass) were conducted to surface and stress-test
candidate identities — Personal Digital Representative, Digital Co-Founder,
Decision and Coordination System, and Project Intelligence Platform — against
this repository's canonical architecture, product direction, and experience
documents. That analysis is background only. **It did not, and could not,
decide this question.** Per
[ADR-0001](ADR-0001-architecture-decision-record-policy.md), only the Product
Owner may approve a canonical decision, and no ADR may be Accepted on Claude
Code's own authority.

This ADR records that the Product Owner has now made that decision. It is an
explicit, final Product Owner decision, not a conclusion autonomously reached
or approved by Claude Code. Claude Code's role here is limited to drafting
and filing the record, per the "Implementation Lead (Claude)" / "Software
Architect" responsibilities already defined in ADR-0001's ownership table.

## Decision

**SmartFlow is Aryan's Personal Digital Representative.**

Its mission is to continuously develop a user-governed, evidence-backed,
provenance-aware, correctable, and confidence-aware understanding of Aryan's
knowledge, goals, priorities, preferences, working style, projects, business
activities, educational activities, personal context, and decision patterns.

It exists to advise, collaborate, coordinate, and perform explicitly approved
actions on Aryan's behalf.

This is now the canonical product identity. It is not an open hypothesis, and
it must not be reopened, re-litigated, or silently reinterpreted by future
documentation, code, or AI-assisted work without a new Product Owner decision
recorded in a superseding ADR (see "Supersession and Change Control" below).

## Canonical Product Identity

- **Name:** Personal Digital Representative.
- **Owner of this decision:** Product Owner (Aryan Barakzai), 2026-08-01.
- **Relationship to prior candidates:**
  - *Digital Co-Founder* — considered and **not** adopted as canonical
    identity (see Non-Goals).
  - *Decision and Coordination System* — not a product identity; it remains
    the accurate internal description of `agent-orchestration.md`'s
    orchestration layer, which serves this identity rather than competing
    with it.
  - *Project Intelligence Platform* / "Software Projects as proving ground"
    — remains valid as **current positioning**, not canonical identity (see
    "Current Proving Ground").
  - *Personal Life Operating System* / "Life Operating System" (Product
    Bible, roadmap, `product-direction-v1.md`) — remains valid **vision and
    mission** language, describing the eventual scope of what the
    Representative represents and helps operate, not a competing identity.

## Mission

SmartFlow exists to continuously build a user-governed, evidence-backed, and
correctable understanding of Aryan's:

- knowledge;
- goals;
- priorities;
- preferences;
- working style;
- projects;
- business activities;
- educational activities;
- personal context;
- decision patterns.

This mission generalizes, rather than replaces, the evidence/provenance
discipline `project-domain.md` already established for one domain (Software
Projects): canonical evidence over conversational memory, validated state
over inferred state, and derived context that is rebuildable but never
hand-edited. This ADR extends that discipline as the target model for *all*
domains this mission eventually covers, without claiming any of it is built
beyond what `project-domain.md` and `current-architecture.md` already
document as implemented.

## Product Roles

SmartFlow's intended roles, all bounded by the Authority Boundary below:

- **Trusted advisor** — explains, contextualizes, and surfaces what matters,
  consistent with `representative-engine.md`'s recommendation/explanation
  model.
- **Collaborator** — works alongside Aryan on projects and decisions; does
  not work *for* Aryan without his visibility and control.
- **Coordinator** — sequences reasoning, proposals, and (where implemented)
  execution across domains, consistent with `agent-orchestration.md`.
- **Bounded delegate** — may perform explicitly approved actions on Aryan's
  behalf, strictly within existing policy and approval boundaries; never
  independently.

## Representation Model

SmartFlow's representation of Aryan must distinguish, at all times:

- **Observed facts** — data collected from authorized sources (documents,
  repositories, integrations) as-is.
- **Explicit user statements** — what Aryan has directly told SmartFlow.
- **Accepted decisions** — evidence-backed decisions recorded as project or
  personal fact, exactly as `project-domain.md` §6 already defines for
  `ProjectDecision`.
- **Verified evidence** — provenance-carrying input that has been checked
  against its source, not merely asserted.
- **Derived conclusions** — deterministic computation from known inputs
  (e.g. `ProjectContextBuilder`-style derivation).
- **Model inference** — LLM-generated interpretation, always advisory.
- **Uncertainty** — explicitly represented, not hidden, wherever confidence
  is not high.

**Model inference never silently becomes canonical user truth.** This
restates, for the whole of Aryan's represented context, the same rule
`representative-engine.md` §9 and §23 already state for reasoning output
and `project-domain.md` §6 already states for evidence: LLM output remains
advisory until deterministic validation, explicit user confirmation, or
accepted-decision status elevates it — and even then, it is recorded as
what it is (a derived or user-confirmed fact), not silently promoted to
"observed fact."

Where the relevant capability exists, Aryan can inspect, correct, reject,
delete, or supersede learned representation. **This is an architectural
requirement, not a claim of current implementation.** Today, the only
concrete evidence of this pattern is Slice 2A's typed, read-only
`ProjectContext`/`ProjectEvidence` model (`src/features/projects/`), which
is hand-authored/fixture-based, not yet persisted, editable, or backed by a
real inspect/correct/delete UI. No durable, user-facing knowledge or memory
governance system exists yet beyond the bounded local workspace memory and
`user_context` extraction already documented in `current-architecture.md`.

## Authority Boundary

Aryan always retains final authority. This ADR changes no authority
semantics; it restates and binds the product identity to invariants
`authority-model.md` and `execution-intent.md` already establish as
non-negotiable:

- SmartFlow does not become Aryan.
- SmartFlow does not claim complete or perfect knowledge of Aryan.
- SmartFlow does not hold independent authority.
- SmartFlow does not approve actions on Aryan's behalf — approval is always
  Aryan's own act.
- SmartFlow does not act outside explicit governance and approval
  boundaries.
- SmartFlow does not treat model inference as verified user truth.
- Server-owned policy, least privilege, fail-closed behavior, explicit
  approval, execution audit, immutable execution intent, and provider
  abstraction (`authority-model.md`, `execution-intent.md`) remain unchanged
  and are strengthened, not weakened, by this identity: representation is
  now understood as existing *in service of* those boundaries, not as an
  alternative to them.
- Recommendation is not decision. Decision is not approval. Approval is not
  execution. Project context is not runtime authority. All unchanged from
  `project-domain.md` §3 and `authority-model.md`.

## Knowledge and Memory Governance

This identity requires that any future personal knowledge, memory, or
decision-pattern modelling system preserve:

- provenance for every represented fact (source, collection time, and
  category per the Representation Model above);
- correctability — Aryan must be able to challenge or correct what is
  represented, where that capability is built;
- confidence-awareness — uncertain or low-confidence representation must be
  shown as such, not asserted as fact, consistent with
  `representative-engine.md` §16's freshness/provenance rules;
- fail-closed behavior when provenance, freshness, or user identity is
  missing or ambiguous, consistent with `representative-engine.md` §25.

No such system is claimed as implemented by this ADR. This section defines
the bar any future implementation must clear, not a description of present
capability.

## Future Embodiment

SmartFlow's long-term presentation may include text, voice, a user-controlled
visual representation or avatar (of the Representative acting on Aryan's
behalf — not a replica or replacement of Aryan), and future presentation
technologies not yet named.

**Presentation does not grant identity, consent, approval, or execution
authority.** This mirrors the reasoning already Accepted in
[ADR-0002: Flow AI Presence Architecture](ADR-0002%20—%20Flow%20AI%20Presence%20Architecture.md),
which establishes that Flow AI's visual manifestations (Orb) communicate
presence without themselves being authority. This ADR extends the same
principle to any future presentation of the Personal Digital Representative
itself: a voice, an avatar, or any other future interface is a surface, not
a source of standing.

SmartFlow does not claim, and must never be described as achieving:

- perfect replication of Aryan;
- consciousness;
- independent personhood or legal identity;
- independent consent or independent authority;
- perfect prediction of Aryan.

Where a concept resembling a "digital twin" is discussed at all, it must be
strongly qualified and should default to the term **user-governed digital
representation** instead.

## Replaceable Mechanisms

Underlying AI models, providers, frameworks, runtimes, orchestration
mechanisms, storage systems, and presentation technologies are replaceable
mechanisms. None of them are this identity.

Aryan's representation, goals, context, provenance, governance, approval
rights, and authority remain **SmartFlow-owned semantics** — they must
survive any future replacement of the Gemini/Cloudflare/Supabase stack,
any future orchestration framework, and any future presentation layer,
exactly as `target-architecture.md` §26 already requires ("preserve
canonical identifiers," "avoid implicit migration of authority") for the
architecture generally.

## Current Proving Ground

Software Projects, and the Project Domain / Project Intelligence work
already underway (`project-domain.md`, EPIC-06/07, Slice 2A/2B/2B.1), remain
the current proving ground for this identity — **not the full permanent
identity itself**. This is unchanged from, and restates rather than
overrides, `product-direction-v1.md` §2-§3: "What changes is *emphasis*, not
the product's name or long-term identity." This ADR formalizes that the
identity being proven out through Software Projects is the Personal Digital
Representative identity defined here.

## Consequences

- Future architecture, product, and roadmap documents may treat "Personal
  Digital Representative" as the settled answer to "what is SmartFlow
  fundamentally" and must not silently substitute a different identity.
- `authority-model.md`, `execution-intent.md`, `representative-engine.md`,
  `project-domain.md`, `target-architecture.md`, and `agent-orchestration.md`
  require no changes — this ADR is compatible with all of them as written and
  strengthens their standing by naming the product-level identity they were
  already architecturally serving.
- Any future capability proposal can now be tested against this identity:
  does it improve SmartFlow's ability to faithfully represent Aryan and act
  only under his explicit, bounded authority? A proposal that requires
  unapproved autonomous action, or that represents or acts for someone other
  than the authenticated user, fails this test at the identity level, before
  it reaches Authority Model review.
- Documentation referencing older identity language ("Personal Life
  Operating System," "Digital Life Companion," "Digital Life Assistant")
  does not need to be rewritten; that language remains valid vision/mission
  and experience-layer framing, compatible with, not competing with, this
  ADR (see "Handle Stale Identity Language" reporting in the associated
  documentation-update task).

## Non-Goals

This ADR does not:

- adopt "Digital Co-Founder" as canonical identity, now or implicitly in the
  future, without a separate superseding ADR;
- grant SmartFlow independent authority, self-approval, or autonomous
  execution;
- claim SmartFlow currently implements personal knowledge modelling, memory,
  decision-pattern modelling, an avatar, voice representation, or voice
  cloning;
- change any Authority Model, Execution Intent, Representative Engine, or
  Project Domain semantics;
- authorize Slice 3, ProjectRecord persistence, Project Workspace UI, new AI
  providers, new integrations, or any runtime, schema, or UI change;
- claim perfect replication, consciousness, independent personhood, legal
  identity, independent consent, or perfect prediction of Aryan.

## Deferred Capabilities

Named for continuity, not scheduled or authorized by this ADR:

- richer personal knowledge and memory representation beyond current bounded
  workspace memory and `user_context` extraction;
- decision-pattern modelling;
- broader personal, business, and educational assistance beyond the current
  Software Project proving ground;
- stronger collaboration and coordination capability;
- voice representation;
- a visual avatar based on or representing Aryan's Representative;
- broader embodiment or presentation technologies;
- advanced personality modelling;
- any future concept resembling a digital twin, always subject to the
  qualifications in "Future Embodiment."

## Supersession and Change Control

Per [ADR-0001](ADR-0001-architecture-decision-record-policy.md): ADR numbers
are permanent, only Accepted ADRs represent current architecture, and a
changed decision requires a new ADR that marks this one Superseded — it must
not be edited in place or silently reinterpreted.

Future developers and AI systems must not reopen the "what is SmartFlow
fundamentally" question, propose a different canonical identity, or treat
identity as still an open hypothesis, without a new, explicit Product Owner
decision recorded in a superseding ADR.

## Related Documents

- [ADR-0001: Architecture Decision Record Policy](ADR-0001-architecture-decision-record-policy.md)
- [ADR-0002: Flow AI Presence Architecture](ADR-0002%20—%20Flow%20AI%20Presence%20Architecture.md)
- [Authority Model](../../architecture/authority-model.md)
- [Execution Intent](../../architecture/execution-intent.md)
- [Representative Engine](../../architecture/representative-engine.md)
- [Project Domain](../../architecture/project-domain.md)
- [Target Architecture](../../architecture/target-architecture.md)
- [Agent Orchestration](../../architecture/agent-orchestration.md)
- [Product Direction v1](../../product/product-direction-v1.md)
- [SmartFlow Product Bible](../../design/vision/SMARTFLOW_PRODUCT_BIBLE.md)
- [Product Roadmap](../../roadmap/product-roadmap.md)
- [PROJECT_STATUS.md](../../../PROJECT_STATUS.md)
