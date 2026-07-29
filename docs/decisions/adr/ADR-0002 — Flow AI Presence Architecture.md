ADR-0002 — Flow AI Presence Architecture

Status: Accepted

Date: 2026-07-08

Owners: Product Owner, Architecture

Context

The SmartFlow Product Bible defines Flow AI as the operating intelligence of the application.

Flow AI is not a chatbot, assistant widget, decorative animation, or static logo.

The product philosophy states that:

Flow AI prepares the workspace.
Flow AI creates the workspace.
Flow AI remains present while the user works.

During Sprint 1, the Launch Experience and Workspace Birth were implemented successfully. However, one architectural question remained unresolved:

Where should Flow AI exist after the workspace has been created?

A single static location could not satisfy all product requirements.

Problem

If the Orb disappears after Launch:

Flow AI feels temporary.
The launch becomes only an intro animation.
The workspace loses its creator.

If the Orb only replaces the application logo:

Flow AI becomes branding rather than intelligence.
The Dashboard loses its active AI presence.

If the Orb only exists inside the Flow AI panel:

Flow AI disappears from all other modules.
The application loses its persistent identity.

The product requires:

continuous AI presence
a clear visual identity
context-aware interaction
consistency across all modules

without creating multiple independent AI identities.

Options Considered
Option A — Launch Orb disappears
Launch

↓

Workspace

↓

No Orb
Pros
Simplest implementation
Cons
Breaks the Product Bible
AI feels temporary
Workspace loses its creator

Rejected

Option B — Orb becomes Sidebar logo
Launch

↓

Sidebar Orb
Pros
Persistent identity
Visible everywhere
Cons
Feels like branding
Dashboard AI becomes weak

Rejected

Option C — Orb lives only inside Flow AI panel
Launch

↓

Flow AI Card
Pros
Strong Dashboard presence
Cons
AI disappears outside Dashboard
No global identity

Rejected

Option D — One AI, Multiple Manifestations
Birth Orb

↓

Presence Orb

↓

Intelligence Orb

Different manifestations.

Same identity.

Pros
Continuous AI presence
Strong global identity
Strong contextual intelligence
Scales naturally across modules
Fully aligned with the Product Bible

Accepted

Decision

Flow AI has one identity with three manifestations.

These manifestations are not separate AI instances.

They represent the same Flow AI in different contexts.

1. Birth Orb

Purpose:

Create the workspace.

Lifecycle:

Center

↓

Top Center

↓

Creates Workspace

↓

Transitions

Characteristics:

Cinematic
Largest Orb
Source of creation
Exists only during Launch Experience
2. Presence Orb

Purpose:

Represent the continuous presence of Flow AI.

Location:

Sidebar application identity.

Characteristics:

Always visible
Calm breathing
Gentle ambient pulse
Never disappears
Reacts subtly to navigation and AI activity

This Orb replaces the traditional static application logo.

3. Intelligence Orb

Purpose:

Represent active AI interaction.

Primary location:

Flow AI panel.

Characteristics:

Larger than Presence Orb
Displays AI thinking state
Supports conversation
Presents suggestions and recommendations
Can temporarily expand during AI operations
Interaction Model

The visual experience follows this sequence:

Birth Orb

↓

Creates Workspace

↓

Settles into Presence Orb

↓

Projects Intelligence Orb

The user must always perceive these as the same Flow AI.

No visual duplication should suggest multiple independent AI entities.

Navigation Behaviour

When navigating between modules:

Presence Orb

↓

Subtle pulse

↓

Ambient light ripple

↓

Next workspace awakens

Modules should feel prepared by Flow AI.

No cinematic replay should occur after the initial Launch Experience.

AI Activity Behaviour

When Flow AI becomes active:

Presence Orb:

Idle

↓

Pulse

↓

Reasoning

↓

Idle

Intelligence Orb:

Reasoning

↓

Suggestion

↓

Conversation

↓

Ready

Both manifestations represent the same AI state.

Architectural Principles

Flow AI is the product hero.

The workspace is created by Flow AI.

The workspace remains connected to Flow AI.

Every module should feel prepared by Flow AI.

The Orb is not decoration.

The Orb communicates presence.

Motion communicates intention.

Animation must never exist without meaning.

Consequences
Positive
Consistent AI identity across the product
Continuous sense of presence
Clear separation between branding and intelligence
Scalable architecture for future modules
Strong alignment with the Product Bible
Trade-offs
Additional coordination between Launch Experience, Sidebar, and Flow AI panel
Shared AI state must drive multiple visual manifestations consistently
Motion choreography requires careful synchronization to preserve the illusion of a single living intelligence
Out of Scope

This ADR does not define:

Conversation UX
AI backend architecture
Prompt orchestration
LLM provider integration
Memory system
Agent implementation

These topics will be covered by separate ADRs.

Related Documents
docs/design/vision/SMARTFLOW_PRODUCT_BIBLE.md
docs/design/experience/01_smartflow_experience.md
docs/design/experience/02_living_workspace.md
docs/design/experience/03_flow_ai_personality.md
docs/design/system/06_module_philosophy.md