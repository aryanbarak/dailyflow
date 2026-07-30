# SmartFlow Current Architecture

Status: Current Implementation
Last updated: 2026-07-30
Scope: implemented architecture only

## Purpose

This document records SmartFlow as it is implemented in the repository today.
It is the canonical current-architecture reference for engineering, QA, and
assistant knowledge work.

This document does not define target architecture, future automation, or product
roadmap. Anything not implemented is labeled `Not Implemented`, `Partially
Implemented`, or `Operational Limitation`.

## System Overview

SmartFlow is implemented as a React and TypeScript personal operating workspace
with a deterministic workspace pipeline, a bounded agent pipeline, Supabase
persistence, and a Cloudflare Worker backend for AI, briefings, document
analysis, suggestions, chat, local reasoning QA, and GitHub integration.

The current architecture has four main execution areas:

| Area | Status | Responsibility |
| --- | --- | --- |
| React frontend | Implemented | User interface, deterministic workspace composition, local tool resolution, read/write runtime calls, Supabase client access. |
| Supabase | Implemented | Auth, relational persistence, storage metadata, RLS-protected user data, agent chat/session tables, GitHub connection records, write logs, code proposal approvals. |
| Cloudflare Worker | Implemented | Authenticated AI endpoints, scheduled briefings, Gemini calls, structured reasoning mode, GitHub App integration, GitHub write boundaries. |
| Agent tool/runtime layer | Partially Implemented | Registered read and write tools, deterministic tool resolution for read-only plan steps, execution policies, approval checks, audit records, and selected write handlers. |

SmartFlow currently proposes and assists. It is not an autonomous executor.
Execution boundaries are explicit, tool-specific, and approval-gated.

## Product Boundaries

Implemented boundaries:

- SmartFlow may inspect bounded user workspace context.
- SmartFlow may generate deterministic workspace signals, priorities, goals,
  plans, recommendations, approval metadata, and agent context.
- SmartFlow may call AI for chat, suggestions, summaries, document analysis,
  briefings, memory extraction, and structured reasoning proposals.
- SmartFlow may execute supported read-only tools.
- SmartFlow may execute only supported write tools after deterministic policy,
  approval, target, and handler validation.

Not implemented:

- No general autonomous agent loop.
- No background task executor that chooses and commits arbitrary actions.
- No unrestricted tool calling by the model.
- No model-trusted approval path.
- No general-purpose code editing outside the implemented GitHub file update
  boundary.
- No automatic migration, deployment, payment, email, calendar-write, finance
  write, document delete, or message-send execution path.

## Technology Stack

| Layer | Current implementation |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, React Router, Tailwind, shadcn/Radix-style UI primitives, TanStack Query, Zustand. |
| AI backend | Cloudflare Worker calling Gemini through the Generative Language API. |
| Persistence | Supabase Auth, Postgres, RLS, storage metadata, service-role Worker access for backend operations. |
| Documents | TipTap, PDF/document processing libraries, Supabase document records and storage bucket metadata. |
| Agent tests | Vitest for frontend and Worker packages. |
| Deployment | Vite build for frontend; Cloudflare Worker configured in `agent/worker/wrangler.toml`; Supabase migrations in `supabase/migrations/`. |

## Workspace Pipeline

The current workspace pipeline is implemented by `useWorkspace` and composes
data from tasks, calendar events, finance transactions, chat sessions, habits,
documents, and learning activity.

Pipeline order:

1. `signalEngine`
2. `memoryEngine`
3. `interactionFeedbackEngine`
4. `decisionIntelligenceEngine`
5. `personalizationEngine`
6. `priorityEngine`
7. `goalEngine`
8. `plannerEngine`
9. `toolResolver`
10. `approvalEngine`
11. `workspaceEngine`

The output is a `Workspace` object containing current-day metadata, signals,
hero content, suggested actions, daily story, recommendation reasons, signal
feed, decision profile, personalization model, goal, plan, tool resolutions,
approval model, agent context, welcome content, right rail content, and refresh
hooks.

Current constraints:

- Workspace planning is proposal-only.
- Workspace engines do not mutate tasks, calendar, finance, habits, documents,
  or learning data.
- Workspace memory is local and bounded.
- Personalization and decision intelligence are weak signals and cannot override
  high-severity current signals.

## Agent Pipeline

The current agent pipeline has separate proposal, validation, resolution,
approval, execution, and composition responsibilities.

Implemented flow:

1. Context is synthesized from workspace state and available domain data.
2. AI reasoning may produce a structured intent proposal.
3. Deterministic validation normalizes or rejects the proposal.
4. Tool resolution maps supported read-only plan steps to explicit tools.
5. Execution policy checks mode, risk, approval, scope, reversibility, external
   effect, and target constraints.
6. Read-only runtime executes supported read-only handlers.
7. Write runtime executes only supported write handlers after approval and
   tool-specific validation.
8. Response composition presents the result without treating model output as an
   authority boundary.

Current status:

- `Implemented`: Read-only runtime for supported workspace and GitHub inspection
  tools.
- `Implemented`: Write runtime for `tasks.complete`,
  `github.issues.comment`, `github.issues.update`, and `github.files.update`.
- `Partially Implemented`: The tool registry contains additional enabled write
  tools that do not have registered execution handlers.
- `Operational Limitation`: Tool Resolver V1 resolves only explicit read-only
  domain/action mappings. It does not resolve mutation actions from workspace
  plan steps.

## Implemented Engines

### Signal Engine

Status: `Implemented`

Purpose: Convert current user data into bounded workspace signals.

Inputs:

- Tasks
- Calendar events
- Finance transactions
- Learning activity
- Sparse-data/onboarding state

Outputs:

- Domain signals with severity and score.

Responsibilities:

- Surface current task, calendar, finance, learning, and low-data signals.
- Classify severity as high, medium, or low.

Known limitations:

- Signals are deterministic and rule-based.
- Signal coverage is limited to implemented domains.

### Memory Engine

Status: `Implemented`

Purpose: Maintain local workspace memory from recent interactions and current
signals.

Inputs:

- Previous workspace memory
- Current signals
- Latest chat session
- Learning activity
- Reflection evidence

Outputs:

- Updated workspace memory and memory insights.

Responsibilities:

- Track recent signal domains, chat context, learning context, and reflections.
- Keep bounded local lists.

Known limitations:

- This is local workspace memory, not a general durable AI memory system.

### Interaction Feedback Engine

Status: `Implemented`

Purpose: Derive weak engagement and avoidance signals from prior workspace
interactions.

Inputs:

- Recent workspace interaction events from memory.

Outputs:

- Domain engagement, avoided domains, action engagement, and confidence.

Responsibilities:

- Provide weak ordering hints to downstream engines.

Known limitations:

- It is advisory only and does not authorize action.

### Decision Intelligence Engine

Status: `Implemented`

Purpose: Build a deterministic decision profile from reflection evidence and
interaction feedback.

Inputs:

- Reflection evidence
- Interaction feedback

Outputs:

- Reliable domains, avoided domains, confidence, and low-data status.

Responsibilities:

- Use repeated evidence to weakly inform priorities and plans.
- Gate itself when data is insufficient.

Known limitations:

- It does not execute decisions.
- It cannot override urgent current signals.

### Personalization Engine

Status: `Implemented`

Purpose: Compute domain affinity from current data, signals, memory,
interactions, and decision profile.

Inputs:

- Current workspace data
- Signals
- Memory
- Interaction feedback
- Decision profile

Outputs:

- Domain affinity and confidence.

Responsibilities:

- Provide weak personalization hints for ordering and display.

Known limitations:

- Personalization is bounded and low authority.

### Priority Engine

Status: `Implemented`

Purpose: Rank current signals and select primary and secondary domains.

Inputs:

- Signals
- Memory insights
- Personalization
- Interaction feedback
- Decision profile

Outputs:

- Primary domain, secondary domains, ordered signal IDs, mission copy, reasons,
  and confidence.

Responsibilities:

- Keep high-severity current signals dominant.
- Use memory and personalization only as weak secondary factors.

Known limitations:

- It ranks current signals; it does not create tasks or execute actions.

### Goal Engine

Status: `Implemented`

Purpose: Generate one proposed daily workspace goal.

Inputs:

- Priority model
- Signals
- Memory insights
- Personalization
- Interaction feedback
- Decision profile

Outputs:

- Proposed goal with success criteria, effort, reasons, constraints, source
  signal IDs, and status.

Responsibilities:

- Generate bounded daily goals.
- Add explicit constraints including no autonomous execution and future approval
  requirements.

Known limitations:

- Goals are proposals only.
- Maximum effort is capped at 90 minutes.

### Planner Engine

Status: `Implemented`

Purpose: Convert the proposed goal into a bounded proposed plan.

Inputs:

- Goal
- Signals
- Decision profile

Outputs:

- Proposed plan with two to four steps, estimated minutes, constraints, reasons,
  and source goal.

Responsibilities:

- Produce domain-specific plan steps.
- Keep effort within allowed minute buckets.
- Mark approval-relevant steps for future execution.

Known limitations:

- Planner V1 proposes steps only.
- It does not modify workspace data.

### Tool Resolver

Status: `Implemented with limitations`

Purpose: Deterministically map supported read-only plan steps to registered
tools.

Inputs:

- Workspace plan step
- Registered tool definitions

Outputs:

- Tool resolution result with selected tool, status, candidates, required input,
  confidence, and reasons.

Responsibilities:

- Resolve explicit read-only mappings for tasks, calendar, learning, workspace,
  and GitHub inspection.
- Reject unsupported mutation actions.

Known limitations:

- It resolves only read-only tools.
- Mutation actions are intentionally unresolved by Tool Resolver V1.

### Approval Engine

Status: `Implemented`

Purpose: Classify proposed plan steps by approval need, risk, scope,
reversibility, and external effect.

Inputs:

- Proposed plan
- Tool resolutions

Outputs:

- Workspace approval model and per-step approvals.

Responsibilities:

- Mark view-only actions as not requiring approval.
- Mark focus, selection, continuation, planning, creation, update, completion,
  invitation, delete, send, pay, and share actions as approval-relevant based on
  risk.

Known limitations:

- It classifies; it does not approve or execute.

### Workspace Engine

Status: `Implemented`

Purpose: Compose the user-facing workspace model.

Inputs:

- Current user data
- Signals
- Priority model
- Goal
- Plan
- Tool resolutions
- Approval model
- Personalization
- Decision profile

Outputs:

- Complete `Workspace` view model.

Responsibilities:

- Build hero, suggested actions, daily story, recommendation reasons, signal
  feed, agent context, onboarding content, and right rail content.

Known limitations:

- Some right-rail learning examples are static display content.
- It is a view model composer, not an executor.

### Execution Policy and Runtime

Status: `Partially Implemented`

Purpose: Enforce execution boundaries for read and write tools.

Inputs:

- Tool definitions
- Plan step and tool resolution
- Approval data
- Handler registry
- Runtime request input

Outputs:

- Execution results or deterministic denial reasons.

Responsibilities:

- Reject unsupported, disabled, missing, mismatched, unapproved, irreversible,
  or unsafe execution attempts.
- Restrict read-only runtime to supported read tools.
- Restrict write runtime to supported write tools with registered handlers.

Known limitations:

- Some enabled write tools exist in the registry without runtime handlers.
- Read-only execution audit records are in-memory.
- Production durability depends on the specific handler and backend path.

## Current AI Capabilities

| Capability | Status | Notes |
| --- | --- | --- |
| Multi-turn chat | Implemented | `/chat` persists successful normal chat turns to `agent_chat_messages` and updates `chat_sessions`. |
| Structured reasoning proposal through `/chat` | Implemented | `/chat` with `mode: "reasoning"` uses a Gemini JSON response schema and does not persist that reasoning call to chat messages. |
| Local QA reasoning endpoint | Implemented | `/agent/reason` requires `SMARTFLOW_WORKER_MODE=local-qa`, loopback Supabase URL, Supabase bearer auth, and schema-enforced Gemini output. |
| Daily and weekly briefings | Implemented | Worker cron and `/generate` build context and persist `agent_briefings`. |
| Task/calendar/habit/finance suggestions | Implemented | Worker endpoints call Gemini with bounded snapshots and JSON schemas. |
| Document analysis | Implemented | `/documents/analyze` sends text or inline file data to Gemini and returns an answer. |
| Memory extraction | Implemented | Worker extracts allowed durable facts from briefings and chat turns into `user_context`. |
| Autonomous action selection and execution | Not Implemented | Model output is not a trust boundary and cannot approve itself. |

## Current Tool Registry

### Read-only executable tools

Status: `Implemented`

The read-only runtime supports:

- `tasks.list`
- `calendar.list_today`
- `learning.get_progress`
- `workspace.get_context`
- `github.repositories.list`
- `github.issues.list`
- `github.epics.list`
- `github.pulls.list`
- `github.workflow_runs.list`

The registry also defines `github.files.read` as an enabled read tool with a
handler, but Tool Resolver V1 does not include it in its explicit read-only
workspace-plan mappings.

### Write executable tools

Status: `Implemented with approval and policy gates`

The write runtime supports:

- `tasks.complete`
- `github.issues.comment`
- `github.issues.update`
- `github.files.update`

GitHub writes are bounded by user authentication, verified GitHub App
connection, repository/issue/path validation, rate limits, write logs, and
tool-specific approval requirements. `github.files.update` has high risk and
requires a server-verifiable code proposal approval record.

### Registered but not executable through current write runtime

Status: `Partially Implemented`

The registry contains enabled write tool definitions for:

- `tasks.create`
- `tasks.update`
- `calendar.create_event`
- `calendar.update_event`
- `habits.mark_complete`
- `documents.delete`
- `messages.send`
- `finance.create_transaction`

These are definitions only unless and until a registered handler and execution
path are added.

## Current Integrations

| Integration | Status | Implementation |
| --- | --- | --- |
| Supabase Auth | Implemented | Frontend and Worker authenticate user requests with Supabase JWTs. |
| Supabase Postgres | Implemented | User data, workspace domains, chat, briefings, GitHub connection records, write logs, and code proposal approvals. |
| Supabase Storage metadata | Implemented | Documents bucket and `documents` table support document workflows. |
| Gemini | Implemented | Worker uses Gemini for chat, suggestions, document analysis, briefings, memory extraction, and reasoning proposals. |
| GitHub App | Implemented | Worker supports GitHub connection flow, read inspection, issue writes, file reads, and bounded file update mutation. |
| Cloudflare Worker cron | Implemented | Daily scheduled briefing generation. |

## Security Model

Implemented controls:

- Supabase JWT authentication for user-facing Worker requests.
- Supabase RLS on user-owned tables.
- Worker service-role access for backend-only writes where needed.
- CORS allow-list for production origins and local development origins.
- Local reasoning endpoint restricted to local-QA mode and loopback Supabase.
- Gemini structured output schemas for reasoning and several suggestion flows.
- Deterministic proposal normalization and validation.
- Tool registry metadata for mode, risk, approval, reversibility, and external
  effect.
- Execution policy checks before runtime execution.
- Write handler allow-list.
- GitHub App installation verification.
- GitHub write rate limits.
- GitHub protected-path and file-size/content restrictions.
- Server-side code proposal approvals for high-risk file updates.
- `agent_write_log` persistence for GitHub writes.

Operational limitations:

- Some logs are console/in-memory rather than durable audit streams.
- The frontend registry may expose enabled tools that are not executable through
  current runtime handlers.
- Current architecture relies on correct Worker secret configuration.

## Deployment Architecture

Implemented deployment shape:

- Frontend builds with `vite build`.
- Worker source lives under `agent/worker/`.
- Worker entrypoint is `agent/worker/index.ts`.
- Worker is configured by `agent/worker/wrangler.toml`.
- Worker cron runs daily at `0 6 * * *`.
- Supabase migrations live under `supabase/migrations/`.

Current Worker routes include:

- `POST /chat`
- `POST /generate`
- `POST /tasks/suggestions`
- `POST /calendar/suggestions`
- `POST /habits/suggestions`
- `POST /finance/suggestions`
- `POST /documents/analyze`
- `POST /agent/reason` in local-QA mode
- GitHub integration routes handled by the GitHub integration router

## Persistence Layer

Implemented Supabase persistence includes:

- User profile and settings tables.
- Tasks, calendar events, finance transactions, habits, habit completions, and
  learning/chat-related tables.
- Documents table and document metadata columns.
- Agent briefings.
- User context memory.
- Agent chat messages and chat sessions.
- GitHub connections and connection attempts.
- GitHub repository inventory cache.
- Agent write log.
- Agent code proposal approvals.

Most user-owned tables are protected by RLS. Backend-only integration tables
grant mutation authority to the service role and only bounded read access to
authenticated users where appropriate.

## Operational Limitations

- The current codebase contains both mature and transitional modules.
- Some existing project-status text is stale relative to implementation: the
  runtime now supports GitHub issue writes and file updates in addition to
  `tasks.complete`.
- Some ADR path comments in runtime files still reference legacy paths.
- Tool Resolver V1 does not resolve mutation steps.
- Several enabled registry tools are not executable through the current write
  runtime.
- The GitHub file-update boundary is implemented, but it is intentionally narrow
  and high-risk.
- The architecture currently has no complete target-architecture document.

## Implemented vs Planned Matrix

| Area | Current status |
| --- | --- |
| Deterministic workspace pipeline | Implemented |
| Workspace memory and weak personalization | Implemented |
| Decision intelligence | Implemented |
| Goal and plan proposal | Implemented |
| Approval classification | Implemented |
| Read-only tool execution | Implemented |
| `tasks.complete` write execution | Implemented |
| GitHub repository, issue, epic, pull request, and workflow inspection | Implemented |
| GitHub issue comment/update writes | Implemented |
| GitHub bounded file update | Implemented |
| General task/calendar/habit/document/message/finance write execution | Not Implemented |
| Autonomous agent loop | Not Implemented |
| Target architecture | Implemented |
| Authority model canonical document | Implemented |
| Execution intent canonical document | Implemented |
| Smart automation boundary canonical document | Implemented |
| Representative engine canonical document | Implemented |
| Agent orchestration canonical document | Not Implemented |

## Related ADRs

- [ADR-0001: Architecture Decision Record Policy](../decisions/adr/ADR-0001-architecture-decision-record-policy.md)
- [ADR-0002: Flow AI Presence Architecture](../decisions/adr/ADR-0002%20—%20Flow%20AI%20Presence%20Architecture.md)
- [ADR-0003: Local Agent Reasoning Endpoint Boundary](../decisions/adr/ADR-0003-agent-reason-local-qa-only.md)
- [ADR-0004: Write Boundaries](../decisions/adr/ADR-0004-write-boundaries.md)
- [ADR-0005: Code Write Mutation Boundary](../decisions/adr/ADR-0005-code-write-mutation-boundary.md)

## Explicitly Not Implemented

- Autonomous execution without explicit approval.
- Model-authorized writes.
- Generic arbitrary tool execution.
- Browser, shell, package, migration, deployment, or git write execution by the
  SmartFlow agent.
- Payment execution.
- Email or external message sending.
- Calendar event creation/update execution.
- Finance transaction creation execution.
- Habit completion execution.
- Document deletion execution.
- General codebase modification outside the bounded GitHub file-update handler.
- Production-local `/agent/reason`; that endpoint is local-QA only.
