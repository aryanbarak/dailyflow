# SmartFlow to Smart Automation Boundary

Status: Canonical Architecture
Last updated: 2026-07-30
Scope: boundary specification only

## 1. Purpose

This document defines the architecture boundary between SmartFlow and Smart
Automation.

SmartFlow and Smart Automation both use AI, integrations, policy, approval,
execution, and audit concepts. Without an explicit boundary, the systems could
duplicate authority, bypass policy, create approval ambiguity, hide execution,
leak credentials, disagree about runtime truth, execute duplicate workflows,
fragment audit history, create circular orchestration, delegate without bounds,
couple accidentally, or overlap product responsibility.

This boundary preserves [Authority Model](authority-model.md) and
[Execution Intent](execution-intent.md). It does not grant new runtime
capability, define an API, design a workflow catalog, or authorize Smart
Automation integration.

## 2. Scope

This document governs:

- responsibility ownership,
- authority crossing,
- intent transfer,
- execution delegation,
- identity,
- credentials,
- data exchange,
- audit correlation,
- failure responsibility,
- cancellation and retry responsibility,
- trust boundaries,
- lifecycle ownership.

This document does not govern:

- concrete transport,
- endpoint schema,
- message broker choice,
- n8n workflow design,
- UI design,
- deployment topology,
- future autonomous orchestration.

## 3. System Roles

### SmartFlow

SmartFlow is the project operating system and authority-bearing user-facing
system for project work.

SmartFlow owns:

- project context and workspace understanding,
- planning and recommendation presentation,
- project-level policy decisions for SmartFlow-originated work,
- user-facing approval for SmartFlow-originated execution,
- canonical intent origin for SmartFlow-originated work,
- interaction and explanation within project context,
- project-facing execution visibility.

SmartFlow MAY execute bounded operations directly when current architecture
implements the runtime, policy, approval, and audit path. Current GitHub writes
remain SmartFlow-owned.

### Smart Automation

Smart Automation is a separate automation platform and integration execution
system.

Smart Automation owns, where implemented:

- integration execution runtime,
- connector and provider adapter boundary,
- external system operational controls,
- workflow execution through its own runtime,
- scheduled or event-driven operation state,
- provider-specific execution history,
- capability policy and idempotency foundations.

Current verified Smart Automation implementation includes read-only Gmail
execution through direct and local n8n paths, server-owned capability policy,
automation run audit, approval metadata foundations, idempotency reservation,
Composio-backed Gmail connection handling, and disabled/unimplemented reserved
Gmail write capabilities.

## 4. Boundary Principles

- One authority owner MUST exist per decision.
- One execution owner MUST exist per provider operation.
- One canonical intent MUST identify each action.
- Credentials MUST remain with the executing system.
- Approval MUST NOT be delegated implicitly.
- Runtime truth originates where execution occurs.
- Audit MAY be correlated, but MUST NOT be fabricated.
- External providers MUST NOT define internal authority.
- Transport delivery MUST NOT create trust.
- Successful delivery MUST NOT equal successful execution.
- System availability MUST NOT grant authority.
- Integration capability MUST NOT grant permission.
- Delegation MUST be bounded, explicit, and revocable.

## 5. Responsibility Ownership Matrix

| Responsibility | SmartFlow | Smart Automation | Shared or correlated | Forbidden ownership |
| --- | --- | --- | --- | --- |
| User interaction | Owns SmartFlow project UX | Owns Smart Automation operator or integration UX | Cross-system status may be shown in context | Provider or LLM owns user consent |
| Project context | Owns | Does not own | May receive minimized context for delegated work | Broad project memory transfer by default |
| Workspace reasoning | Owns | Does not own | May consume typed results | Smart Automation decides project priority |
| Planning | Owns project plan proposals | May expose capability constraints | Typed capability facts may inform planning | Workflow runtime becomes project planner |
| Proposal generation | Owns SmartFlow proposals | Owns automation-specific proposals in its product | Proposals may reference capabilities | Proposal treated as execution |
| Intent construction | Owns SmartFlow-originated intent | Owns independently originated automation intent | Delegated intent may be correlated | Natural language as executable intent |
| Intent validation | Owns SmartFlow intent validation | Owns receiver-owned fact validation | Each validates owned facts | Blindly trusting remote intent fields |
| Policy evaluation | Owns project/user-facing policy | Owns integration/provider runtime policy | All required policies must allow | One allow overrides another deny |
| Risk classification | Owns SmartFlow action risk | Owns automation capability risk | Risk may be compared or mapped | Client-declared risk is authoritative |
| User approval | Owns SmartFlow-originated approval | May own future independent Smart Automation approvals | Approval references may be verified | OAuth, n8n active state, or LLM output as approval |
| Credential ownership | Owns SmartFlow secrets for SmartFlow execution | Owns automation/provider secrets for automation execution | Token references may be exchanged only by design | Shared raw secrets by default |
| Provider connection management | Owns SmartFlow provider connections | Owns Smart Automation provider connections | Connection status may be reported | Treating provider auth as user approval |
| Workflow orchestration | Does not own Smart Automation runtime workflows | Owns automation workflows | SmartFlow may request bounded work | Circular orchestration |
| Immediate execution | Owns implemented SmartFlow direct execution | Owns direct automation execution for its capabilities | One executor per intent | Duplicate executor fallback |
| Long-running execution | Future only unless implemented | Owns where automation runtime implements it | SmartFlow may track status | SmartFlow claims success before terminal result |
| Scheduling | Future project constraints only | Owns schedule triggers where implemented | Requires future authority rules | Indefinite execution from one-time approval |
| Retries | May retry transport only within intent validity | Owns execution-local retries where implemented | Retry relationship must be auditable | Retry creates new semantic action |
| Cancellation | May request cancellation | Owns whether runtime can cancel | Outcome must be reported | Delivery of cancel implies cancelled |
| Provider verification | Verifies SmartFlow-owned providers | Verifies automation-owned providers | Result facts may be shared | Provider response grants future authority |
| Project-state update | Owns | Does not own | Uses verified typed results | Automation mutates project truth without contract |
| Integration-state update | Does not own automation integration state | Owns | SmartFlow may display status | SmartFlow fabricates integration status |
| Audit creation | Owns SmartFlow runtime facts | Owns Smart Automation runtime facts | Correlation IDs join records | Either fabricates the other's facts |
| Cross-system audit correlation | Owns project-facing correlation | Owns execution-facing correlation | Shared correlation identity | Audit record authorizes replay |
| Result explanation | Owns project explanation | Owns execution result classification | Typed status precedes prose | Natural language overrides typed status |
| Notification | Owns project-context presentation | Owns operational event detection | Deduped correlated notifications | Notification treated as approval |
| Failure recovery | Owns SmartFlow-side recovery | Owns automation-side recovery | User-facing report may combine facts | Ambiguous owner for retry or recovery |

## 6. Authority Boundary

SmartFlow retains user-facing approval authority for SmartFlow-originated work.
Smart Automation MUST NOT fabricate user approval and MUST NOT infer authority
from receipt of a request alone.

SmartFlow MUST NOT treat Smart Automation capability, Composio connection
status, n8n availability, provider authentication, or connector availability as
automatic authorization. Neither system may broaden the other's authority.

Delegated execution authority MUST be bounded by canonical intent, policy,
identity, expiry, and approval where required. Authority local to each system
remains local:

- SmartFlow owns SmartFlow project context, project policy, SmartFlow-originated
  approval, and SmartFlow direct execution authority.
- Smart Automation owns its capability registry, provider runtime controls,
  connector credentials, execution-local policy, and runtime result truth for
  operations it executes.

## 7. Execution Intent Boundary

Execution Intent is the unit of possible cross-system delegation. A future
cross-system request SHOULD conceptually carry enough information to verify:

- intent identity,
- authenticated principal,
- originating system,
- capability,
- bounded target,
- normalized arguments or digest,
- risk,
- approval state or approval reference,
- expiry,
- idempotency identity,
- correlation identity,
- policy-relevant facts,
- verification requirements.

This is not a wire schema.

Natural-language requests MUST NOT be treated as executable cross-system
intent. Mutable UI state MUST NOT cross as authority. LLM output MUST NOT be
sufficient for execution. Receiving systems MUST revalidate the facts they own.
No receiver may silently expand scope. Material semantic changes require a new
intent and, where required, a new approval.

## 8. Trust Boundary

Neither system should blindly trust:

- client-provided identity,
- client-provided approval,
- client-provided risk,
- client-provided policy outcome,
- mutable natural-language summaries,
- provider claims about authority,
- transport-level success,
- unsigned or unverifiable request metadata.

Fact categories:

- Origin-owned facts are facts the sender owns, such as SmartFlow project
  context or SmartFlow approval decision.
- Receiver-owned facts are facts the executor owns, such as connector
  availability, credential state, runtime state, provider limits, and
  execution status.
- Independently verifiable facts are facts each side can verify against its own
  store or provider state.
- Non-authoritative descriptive data is explanatory context that MUST NOT grant
  authority.

Each system MUST verify the facts within its own authority domain.

## 9. Identity Boundary

Cross-system execution requires explicit identity binding for:

- end user,
- SmartFlow service identity,
- Smart Automation service identity,
- provider account identity,
- connector identity,
- runtime execution identity.

Service-to-service identity does not replace end-user binding. Provider account
identity MUST NOT be assumed to equal SmartFlow user identity. User mapping
MUST be deterministic and server-verified. Cross-user or cross-tenant execution
MUST fail closed. Identity context MUST NOT rely on UI state or LLM output.

This document does not design an authentication protocol.

## 10. Credential Boundary

The system performing provider execution MUST own and protect the credentials
required for that execution.

SmartFlow MUST NOT receive or persist Smart Automation provider secrets merely
to delegate execution. Smart Automation MUST NOT receive SmartFlow internal
secrets unrelated to delegated execution.

Secrets MUST NOT appear in:

- execution intent,
- approval payloads,
- audit payloads,
- logs,
- LLM prompts,
- cross-system result summaries.

Token exchange, credential references, or delegated identities MAY be defined
by future architecture, but raw secret sharing is not the default boundary.

## 11. Policy Boundary

SmartFlow owns project-level and user-facing execution policy for
SmartFlow-originated actions. Smart Automation owns integration-runtime and
provider-specific execution policy for operations it executes.

Both policy layers may be required. Neither system's allow result may override
the other system's deny result. Execution MUST occur only when all required
policy owners permit it. Unknown, unavailable, stale, or conflicting policy
state MUST fail closed.

Policy composition is conceptual here; this document does not design a policy
engine protocol.

## 12. Approval Boundary

SmartFlow generally owns user-facing approval for actions initiated from
SmartFlow. Smart Automation may own approval only for workflows originating
independently inside Smart Automation if a future model explicitly defines it.

For SmartFlow-originated delegation:

- approval MUST bind to exact canonical intent,
- Smart Automation MUST verify the approval reference or server-verifiable
  proof,
- approval MUST have bounded validity,
- consumed, expired, stale, revoked, or mismatched approval MUST fail,
- Smart Automation MUST NOT reword or reinterpret approved meaning,
- a general "automation connected" state is not approval,
- an OAuth grant is not approval,
- an active n8n workflow is not approval.

## 13. Execution Ownership

Each provider mutation has one execution owner.

If Smart Automation performs the provider operation, Smart Automation owns:

- runtime execution truth,
- provider request construction,
- provider credentials,
- provider response classification,
- execution-local retry and failure facts.

SmartFlow MUST NOT claim success before receiving verified terminal status.

If SmartFlow performs the provider operation directly, SmartFlow retains those
execution responsibilities. Smart Automation MUST NOT duplicate the same
action. The same intent MUST NOT be executed concurrently by both systems.

## 14. Immediate vs Workflow Execution

Immediate bounded execution is typically:

- a single action,
- short-lived,
- direct-response,
- handled by a deterministic handler,
- a narrow provider call.

Workflow execution is typically:

- multi-step,
- long-running,
- delayed,
- scheduled,
- event-driven,
- integration-heavy,
- dependent on retry or checkpoint state.

SmartFlow SHOULD retain execution when the operation is project-local,
short-lived, already implemented by SmartFlow, requires direct project-context
interaction, or has a narrow SmartFlow-owned provider boundary.

Smart Automation SHOULD own execution when the operation depends on integration
orchestration, provider connector state, scheduling, long-running workflow
state, external events, retry complexity, multi-provider coordination, or
automation operational observability.

## 15. Data Boundary

Only data necessary for the delegated action should cross.

Data that MAY cross when required:

- intent metadata,
- target identifiers,
- normalized arguments,
- approval reference,
- correlation identifiers,
- provider result metadata,
- sanitized errors,
- audit linkage.

Data that SHOULD NOT cross by default:

- full project memory,
- unrestricted conversation history,
- unrelated user data,
- internal prompts,
- secrets,
- provider tokens,
- entire repository contents,
- broad Gmail mailbox data,
- unbounded execution logs.

The system that owns execution owns retention of execution-local records. The
system that owns project context owns retention of project-facing context.

## 16. Result Boundary

Execution results returned to SmartFlow SHOULD conceptually distinguish:

- accepted,
- rejected,
- policy denied,
- approval invalid,
- stale,
- duplicate,
- claimed,
- running,
- succeeded,
- failed,
- timed out,
- cancelled,
- partially completed,
- verification unknown.

Transport success is not execution success. Provider success may not equal
verified effect. SmartFlow must present runtime truth without embellishment.
Natural-language explanations are secondary to typed result status. Result
messages do not grant future authority.

## 17. Audit Boundary

Each system records the runtime truth it directly owns.

SmartFlow audit may record:

- intent creation,
- policy result,
- approval,
- delegation request,
- received terminal result,
- project-facing outcome.

Smart Automation audit may record:

- request acceptance,
- runtime validation,
- execution claim,
- workflow state,
- provider operations,
- retries,
- terminal execution result.

Cross-system audit MUST use correlation identifiers. Neither system may
fabricate the other's runtime facts. Audit duplication should be avoided, but
correlated views are allowed. Audit data must remain sanitized. Audit records
do not authorize replay.

## 18. Failure Boundary

| Failure class | Authoritative owner | Retry owner | User-facing reporter | New intent or approval |
| --- | --- | --- | --- | --- |
| SmartFlow request construction failure | SmartFlow | SmartFlow | SmartFlow | Usually no, unless meaning changes |
| Intent validation failure | SmartFlow | SmartFlow after correction | SmartFlow | New or corrected intent required |
| SmartFlow policy denial | SmartFlow | None unless policy facts change | SmartFlow | New approval alone is insufficient |
| User rejection | SmartFlow approval system | User/SmartFlow may restart | SmartFlow | New approval required |
| Transport failure | Sending system for delivery | Sender within freshness bounds | SmartFlow for project-originated work | No if same intent remains valid |
| Smart Automation authentication failure | Smart Automation | Smart Automation or operator | SmartFlow may relay status | Usually no, unless identity changes |
| Smart Automation policy denial | Smart Automation | None unless policy facts change | SmartFlow may relay status | New approval may be required if denial was approval-related |
| Connector unavailable | Smart Automation | Smart Automation | SmartFlow may relay status | No if same intent remains fresh |
| Provider authentication failure | Executing system | Executing system after credential repair | Originating UX reports bounded status | Usually no, unless provider identity changes |
| Provider rejection | Executing system | Executing system where safe | Originating UX reports terminal status | Depends on semantic change |
| Timeout | Executing system for execution timeout | Executing system for execution retry | Originating UX reports uncertain state | No unless freshness/approval expires |
| Partial workflow failure | Smart Automation for automation workflows | Smart Automation | SmartFlow may relay project outcome | New intent required for new semantic action |
| Result-delivery failure | Delivering system | Delivering system | SmartFlow reports unknown/awaiting status | No unless execution state cannot be recovered |
| Audit persistence failure | System owning that audit | Owning system | Owning UX or correlated view | Execution authority is not granted by audit |

## 19. Retry and Idempotency Boundary

Cross-system retries MUST preserve the same semantic intent. Retry MUST NOT
silently create a new action. Transport retry and execution retry are
different. Idempotency keys must have defined ownership. Duplicate requests
must not create duplicate provider effects. Execution claims must be
authoritative within the executing system. A new semantic action requires a new
intent. Expired or revoked approval cannot be revived by retry. SmartFlow must
not re-submit indefinitely without terminal-state awareness.

SmartFlow retry responsibility ends when Smart Automation has accepted and
claimed execution. Smart Automation retry responsibility begins for
execution-local retry after claim, subject to its own policy, idempotency,
approval, and freshness rules.

## 20. Cancellation and Revocation Boundary

SmartFlow may request cancellation of delegated work. Smart Automation decides
whether execution can still be safely cancelled. Cancellation request delivery
does not guarantee cancellation. Irreversible provider effects cannot be undone
merely by cancelling the workflow.

Approval revocation before execution claim must prevent execution. Revocation
after provider mutation may only affect future steps. Terminal execution cannot
be retroactively made unexecuted. Audit must record cancellation and
revocation outcomes.

This document does not design a cancellation API.

## 21. Scheduling and Event Boundary

Future scheduled or event-driven execution must separate project intent from
automation runtime triggers.

SmartFlow may define user intent, project purpose, constraints, visibility, and
approval requirements. Smart Automation owns schedule triggers, event
listeners, workflow timing, and long-running operational state where those
capabilities are implemented.

Scheduled execution MUST NOT rely indefinitely on an old approval without an
explicit authority model. Recurring or event-triggered execution requires
future rules for duration of delegation, revocation, policy re-evaluation,
changing targets, provider state changes, per-run audit, per-run intent
identity, and bounded recurrence.

## 22. Notification Boundary

Smart Automation may detect operational events. SmartFlow may decide how those
events are presented within project context.

A notification is not:

- approval,
- execution authority,
- proof of success,
- proof of provider effect.

Duplicate notifications and conflicting statuses SHOULD be avoided through
correlation identifiers and typed result state.

## 23. Current Capability Mapping

### SmartFlow

| Capability | Status | Boundary mapping |
| --- | --- | --- |
| Project planning and proposals | Implemented | SmartFlow-owned. |
| Approval classification | Implemented | SmartFlow-owned for SmartFlow-originated work. |
| Execution policy | Implemented | SmartFlow-owned for SmartFlow runtime execution. |
| Read-only tool execution | Implemented | SmartFlow-owned. |
| `tasks.complete` write execution | Implemented | SmartFlow-owned direct execution. |
| GitHub issue comment/update | Implemented | SmartFlow-owned provider mutation through Worker. |
| GitHub bounded file update | Implemented | SmartFlow-owned high-risk provider mutation through Worker. |
| Execution audit | Partially implemented | SmartFlow-owned; GitHub write logs are durable, some frontend audit is in-memory. |
| Delegation to Smart Automation | Not implemented | Outside current runtime. |

### Smart Automation

| Capability | Status | Boundary mapping |
| --- | --- | --- |
| Gmail connection through Composio | Implemented | Smart Automation-owned connector boundary; Composio owns external OAuth token handling. |
| Gmail recent read | Implemented | Smart Automation-owned read-only capability. |
| Local n8n bridge for Gmail recent read | Implemented | Smart Automation-owned local workflow path for the same read-only capability. |
| Automation run audit | Implemented | Smart Automation-owned execution history for its capability. |
| Capability registry and policy | Implemented | Smart Automation-owned integration policy layer. |
| Idempotency reservation | Implemented | Smart Automation-owned duplicate control for automation executions. |
| Approval metadata tables/model | Foundation only | Present for future controls; current Gmail read requires no approval. |
| Gmail draft/send/archive/delete | Planned or blocked reserved capabilities | Disabled and unimplemented. |
| SmartFlow delegation endpoint | Not verified | No current SmartFlow-to-Smart Automation production delegation evidence found. |

## 24. Responsibility Examples

### Example A: GitHub issue comment initiated in SmartFlow

Current architecture keeps this inside SmartFlow. SmartFlow owns the project
interaction, exact intent, approval, policy, Worker route, GitHub App
verification, provider mutation, and durable write log. Smart Automation MUST
NOT duplicate this action unless a future migration explicitly changes
execution ownership.

### Example B: Read recent Gmail messages

A future SmartFlow integration could request a bounded Gmail recent-read
capability from Smart Automation. SmartFlow would own project purpose, user
context, and result presentation. Smart Automation would own Gmail connector
state, Composio execution, result normalization, policy, idempotency, and
execution audit. SmartFlow would not receive Gmail OAuth tokens.

### Example C: Scheduled Gmail-to-task workflow

A scheduled Gmail-to-task workflow primarily belongs to Smart Automation's
runtime because it is scheduled, event-oriented, integration-heavy, and needs
workflow state and retry controls. SmartFlow may own project intent,
visibility, and approval constraints for project task creation, but recurring
execution requires future authority, revocation, per-run intent, and per-run
audit rules.

### Example D: GitHub code mutation

Current controlled GitHub file mutation remains SmartFlow-owned. SmartFlow's
Worker derives and verifies server-owned approval facts, base state, digest,
risk, expiry, and write log state before provider mutation. Moving this to
Smart Automation would require an explicit future architecture decision and
must preserve canonical intent, approval binding, policy, identity, credentials,
freshness, and audit.

## 25. Prohibited Boundary Patterns

The following patterns are forbidden:

- sharing provider credentials between systems without necessity,
- sending raw natural language as executable authority,
- treating OAuth connection as action approval,
- allowing Smart Automation to broaden SmartFlow intent,
- allowing SmartFlow to fabricate Smart Automation success,
- executing the same intent in both systems,
- accepting client-declared risk,
- accepting unsigned or unverifiable approval claims,
- exposing secrets in intent, logs, audit, or LLM context,
- circular delegation,
- silent fallback from one executor to another,
- retrying a new semantic action under an old idempotency key,
- indefinite scheduled execution from one-time approval,
- shared mutable workflow state without ownership,
- merging audit and authority concepts,
- using provider response as permission for future operations.

## 26. Boundary Invariants

- SmartFlow remains the authority owner for SmartFlow-originated user approval.
- Smart Automation cannot fabricate or expand approval.
- One provider effect has one execution owner.
- One delegated action has one canonical intent.
- Both required policy layers must allow execution.
- Either system's deny result blocks execution.
- Credentials remain with the executing system.
- Transport success does not imply execution success.
- Provider success does not automatically imply verified effect.
- Neither system may fabricate the other's runtime truth.
- Audit records do not grant authority.
- Natural-language content is not executable authority.
- LLM output is not cross-system authorization.
- Cross-system identity must be server-verified.
- Cross-user or cross-tenant execution fails closed.
- Retry does not create new semantic authority.
- Material intent changes require a new intent.
- Unknown boundary state fails closed.
- No hidden fallback executor is allowed.
- Current absence of integration must not be documented as implemented delegation.

## 27. Current vs Future Boundary

### Current

Current verified reality:

- SmartFlow and Smart Automation are separate repositories and systems.
- No verified production delegation from SmartFlow to Smart Automation exists.
- SmartFlow performs its own GitHub execution.
- Smart Automation owns its Gmail, n8n, Composio, policy, audit, and
  idempotency foundations.
- Authority, approval, audit, and execution are currently local to each system.

### Future

Future architecture may define:

- service-to-service execution delegation,
- canonical intent exchange,
- correlated audit,
- scheduled execution,
- event-driven workflows,
- delegated cancellation,
- cross-system status updates,
- project-aware automation.

Those mechanisms are not designed here. Future integration must preserve this
boundary, the Authority Model, and Execution Intent unless those canonical
documents are formally amended.

## 28. Relationship to Later Documents

Target Architecture, Representative Engine, and Agent Orchestration MUST NOT:

- merge SmartFlow and Smart Automation without an explicit architecture
  decision,
- bypass the Authority Model,
- bypass Execution Intent,
- create shared ambiguous execution ownership,
- grant autonomous cross-system authority,
- redefine credential ownership casually,
- create circular orchestration.

Later documents may build on this boundary only by making authority, intent,
approval, policy, execution ownership, credentials, runtime truth, and audit
ownership explicit.

## Boundary Gaps

Verified current gaps or future requirements:

- No verified SmartFlow-to-Smart Automation production delegation exists.
- No canonical cross-system intent contract exists.
- No cross-system service authentication protocol is defined.
- No formal cross-system user mapping is defined.
- No cross-system approval verification contract is defined.
- No correlated cross-system audit identity is defined.
- No cross-system idempotency contract is defined.
- No cancellation protocol is defined.
- No result delivery contract is defined.
- No durable distributed execution state exists across both systems.
- Policy concepts exist in both systems and require future composition rules
  before delegation.
- Notification ownership is defined conceptually here but not implemented
  cross-system.

These are not defects merely because future integration is not implemented.
They are constraints that must be resolved before cross-system execution is
introduced.

## Explicitly Out of Scope

This document does not design or implement:

- service-to-service API,
- webhook schemas,
- message queues,
- RPC,
- authentication protocol,
- signing format,
- database changes,
- shared runtime types,
- cross-repository package,
- n8n workflows,
- Composio actions,
- Gmail write capabilities,
- UI integration,
- scheduling engine,
- autonomous execution,
- multi-agent coordination,
- Representative Engine,
- Agent Orchestration,
- Target Architecture,
- deployment changes.

## Related Documents

- [Current Architecture](current-architecture.md)
- [Authority Model](authority-model.md)
- [Execution Intent](execution-intent.md)
