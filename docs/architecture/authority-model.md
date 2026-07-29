# SmartFlow Authority Model

Status: Canonical Architecture
Last updated: 2026-07-30
Scope: authority specification only

## Purpose

The Authority Model defines who or what is allowed to observe, reason, propose,
validate, approve, execute, verify, audit, delegate, reject, cancel, revoke, and
recover inside SmartFlow.

Authority is permission. Implementation is mechanism. A component MAY be
responsible for doing work only when this document grants that authority and the
current implementation enforces it.

This document governs every current and future execution capability. Later
architecture documents MUST NOT grant broader authority by implication. Any
future expansion MUST preserve the invariants in this document or explicitly
change this document through architecture review and, where required, an ADR.

## Core Principles

- Human authority is ultimate. The user is the only actor that MAY approve
  user-impacting execution.
- Proposal is not execution. A proposed action MUST NOT mutate state or contact
  external providers as a write.
- Reasoning is not authority. LLM output MAY suggest intent, but MUST NOT approve,
  authorize, execute, own credentials, or redefine policy.
- Validation is deterministic. SmartFlow MUST validate model output and user
  targets before policy or execution.
- Policy is mandatory. Execution MUST NOT occur unless execution policy allows
  the exact step, tool, target, scope, risk, and approval state.
- Approval is explicit and exact. Approval MUST bind to the exact step, tool,
  target, scope, and risk required for execution.
- Runtime truth is authoritative. Runtime and provider results, not proposals,
  determine whether execution succeeded.
- Server-owned authority protects secrets. Provider credentials, service-role
  access, and high-risk approval records MUST be owned by server-side code.
- Fail closed. Unknown intent, malformed input, missing approval, mismatched
  target, missing handler, stale state, or provider ambiguity MUST block
  execution.
- No hidden execution. SmartFlow MUST NOT run undisclosed tool chains, background
  mutations, or provider writes from reasoning alone.
- Audit follows execution reality. Audit records MUST reflect attempted runtime
  execution and MUST NOT be fabricated from model claims.
- Least privilege. Every actor gets only the minimum authority needed for its
  role.

## Authority Hierarchy

### Human User

Purpose: Own consent, goals, and final decision authority.

Authority:

- MAY request observation, reasoning, and proposals.
- MAY approve or reject an exact execution request.
- MAY cancel by not approving, rejecting, closing, or abandoning a pending
  execution interaction.
- MAY revoke external access through provider or account settings where the
  integration supports it.

Cannot do:

- MUST NOT bypass execution policy.
- MUST NOT cause SmartFlow to use credentials or tools that are not registered,
  policy-allowed, and implemented.
- MUST NOT fabricate server-owned approval records.

Depends on:

- SmartFlow UI to present accurate proposal and approval state.
- Execution policy and runtime to enforce boundaries even after user approval.

### SmartFlow

Purpose: Compose workspace context, validate intent, present proposals, enforce
boundaries, and route allowed execution.

Authority:

- MAY observe bounded user data available through implemented integrations.
- MAY reason deterministically over workspace state.
- MAY present proposals and approval requests.
- MAY validate LLM proposals and user targets.
- MAY reject unsupported, ambiguous, unsafe, or incomplete requests.
- MAY call execution runtime only for supported tools.

Cannot do:

- MUST NOT approve on behalf of the user.
- MUST NOT execute hidden or unsupported actions.
- MUST NOT treat LLM output as policy or runtime truth.

Depends on:

- User identity from authentication.
- Registered tools and deterministic policy.
- Worker and providers for server-owned integrations.

### LLM

Purpose: Generate bounded language and structured proposals.

Authority:

- MAY generate chat responses, suggestions, summaries, and structured intent
  proposals.
- MAY propose supported intents when prompted through approved reasoning paths.

Cannot do:

- MUST NOT execute tools.
- MUST NOT approve actions.
- MUST NOT own user identity.
- MUST NOT own credentials, secrets, service-role access, or provider tokens.
- MUST NOT define policy.
- MUST NOT invent tool IDs, user IDs, approval records, or execution results.

Depends on:

- Prompt constraints.
- Structured output schemas where implemented.
- Deterministic validation after model output.

### Deterministic Validation

Purpose: Convert untrusted proposals into accepted, clarified, or rejected
intent.

Authority:

- MAY normalize recognized proposals.
- MAY reject unknown, unsupported, malformed, mixed, or unsafe proposals.
- MAY require clarification.
- MAY derive tool mapping only from deterministic rules.

Cannot do:

- MUST NOT execute.
- MUST NOT approve.
- MUST NOT trust raw model fields that violate deterministic mapping.

Depends on:

- Current supported intent list.
- Tool registry and validation rules.

### Execution Policy

Purpose: Decide whether an exact execution request is allowed.

Authority:

- MAY allow execution only when all checks pass.
- MAY deny execution for missing tool, disabled tool, invalid mapping, missing
  target, missing approval, wrong approval, insufficient risk, insufficient
  scope, external effect, irreversibility, or unsupported capability.
- Owns the policy decision for runtime execution.

Cannot do:

- MUST NOT execute tools.
- MUST NOT create approval.
- MUST NOT override registered tool metadata.

Depends on:

- Step, tool definition, approval state, risk, scope, target, and current time.

### Approval System

Purpose: Represent explicit user consent for a specific proposed action.

Authority:

- MAY classify whether a proposed step requires approval.
- MAY record that an exact step is pending, approved, rejected, or not required.
- MAY carry risk, scope, target, reversibility, and external-effect metadata.

Cannot do:

- MUST NOT execute.
- MUST NOT approve without explicit user action.
- MUST NOT approve a different step, tool, or target than the one displayed.
- MUST NOT lower the effective risk required by policy.

Depends on:

- User action.
- Tool resolution and step metadata.
- Server-side approval storage for high-risk code write approval records.

### Execution Engine and Write Runtime

Purpose: Perform allowed tool execution and produce runtime truth.

Authority:

- MAY execute only registered, supported handlers after policy allows the exact
  request.
- MAY reject missing handlers, invalid input, duplicate requests, timeout,
  verification failure, or policy denial.
- MAY record audit data before and after execution.
- Owns runtime success or failure status.

Cannot do:

- MUST NOT execute when policy denies.
- MUST NOT execute unsupported tools.
- MUST NOT execute write tools through the read-only engine.
- MUST NOT retry automatically unless a future architecture grants retry
  authority.

Depends on:

- Execution policy.
- Tool registry.
- Handler registry.
- Authenticated runtime identity.
- Worker or provider clients for external effects.

### Worker

Purpose: Own server-side integration authority and secret-bearing operations.

Authority:

- MAY authenticate user requests through Supabase.
- MAY call Gemini, Supabase service-role endpoints, and GitHub provider APIs.
- MAY own provider credentials, GitHub App credentials, service-role keys, and
  server-side code proposal approval records.
- MAY enforce server-side write boundaries, rate limits, protected paths, stale
  base checks, and audit writes.

Cannot do:

- MUST NOT trust browser-supplied high-risk approval facts such as base blob,
  base commit, proposed-content digest, risk level, or expiry.
- MUST NOT expose secrets to the browser or LLM.
- MUST NOT mutate providers outside implemented routes and tool boundaries.

Depends on:

- Worker secrets and environment configuration.
- Supabase Auth.
- Provider APIs.
- Database tables for connection state, audit, and approvals.

### Provider and External API

Purpose: Perform external system operations after SmartFlow authorization.

Authority:

- MAY accept or reject API requests made by the Worker or authenticated client.
- MAY return provider state and mutation results.

Cannot do:

- MUST NOT redefine SmartFlow authority.
- MUST NOT turn an unauthorized SmartFlow request into an authorized one.
- MUST NOT be treated as approval source.

Depends on:

- Provider authentication and authorization.
- SmartFlow Worker request construction.

### Audit

Purpose: Record execution attempts, policy status, risk, approval status, and
sanitized runtime outcomes.

Authority:

- MAY record started, success, failure, policy-denied, verification-failed,
  timeout, and related runtime events.
- MAY sanitize identifiers and metadata.
- MAY redact sensitive fields.

Cannot do:

- MUST NOT approve.
- MUST NOT execute.
- MUST NOT contain secrets, tokens, authorization headers, or raw private data.
- MUST NOT be generated from model claims alone.

Depends on:

- Runtime execution lifecycle.
- Worker write-log persistence for GitHub writes.
- In-memory frontend audit for current read-only/runtime records.

### Persistence

Purpose: Store durable state, connection metadata, user data, chat data, write
logs, and server-owned approval records.

Authority:

- MAY persist data through RLS-protected user tables and service-role backend
  writes.
- MAY hold server-verifiable approval records for high-risk code writes.
- MAY hold provider connection metadata and audit rows.

Cannot do:

- MUST NOT itself approve or execute.
- MUST NOT allow client mutation of backend-only integration tables.

Depends on:

- Supabase Auth and RLS.
- Worker service-role access for backend-owned writes.

### Runtime

Purpose: Bind execution to the current authenticated environment and current
tool implementation.

Authority:

- MAY inject authenticated user identity.
- MAY provide current time and request identifiers.
- MAY determine actual handler result.

Cannot do:

- MUST NOT substitute a different user identity.
- MUST NOT treat stale proposals as current truth.
- MUST NOT bypass policy or approval.

Depends on:

- Authentication state.
- Current tool, handler, and policy code.

## Authority Matrix

Legend:

- `Owns`: has primary authority for the action.
- `May`: can participate but does not own final authority.
- `No`: has no authority for the action.
- `Record`: records what happened but does not authorize it.

| Action | User | SmartFlow | LLM | Policy | Approval | Execution Engine | Worker | Provider | Audit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Observe | Owns consent | May observe bounded context | May receive bounded prompt context | May check request context | No | May receive execution context | May fetch server context | May return provider state | Record |
| Reason | May request | Owns deterministic reasoning | May propose language/intent | No | No | No | May call model endpoints | No | No |
| Plan | May request | Owns deterministic plan proposal | May assist only where routed | No | No | No | No | No | No |
| Propose | May request | Owns presentation | May generate proposal | No | No | No | May return structured model proposal | No | No |
| Validate | No | Owns deterministic validation | No | May validate execution mapping | No | May validate input | May validate server request | May reject API request | Record |
| Approve | Owns | May present approval UI | No | No | Owns approval state after user action | No | May store server approval records | No | Record |
| Execute | May initiate after approval | May route supported request | No | Must allow first | No | Owns runtime execution | Owns server/provider execution | Performs external operation | Record |
| Retry | May request future retry | No current automatic retry authority | No | Must re-evaluate | Must re-approve when required | No automatic retry authority | No automatic retry authority | Provider retry is not SmartFlow authority | Record |
| Cancel | Owns pending consent cancellation | May stop local flow | No | No | May mark rejected/not approved | May stop before execution | May reject stale/consumed approval | No | Record when runtime reached |
| Verify | May inspect result | May present result | No | No | No | Owns runtime verification | May verify provider/server state | Returns state | Record |
| Persist | May create user data through approved flows | May request persistence | No | No | May persist approval state | May persist runtime records | Owns server writes | Owns provider state | Record |
| Audit | May inspect available audit views | May collect sanitized runtime facts | No | No | No | May append audit records | Owns durable GitHub write logs | No | Owns audit record shape |
| Respond | May receive response | Owns response composition | May generate chat text when routed | No | No | Supplies runtime truth | Supplies backend result | Supplies provider result | Supplies sanitized facts |

## Proposal Authority

LLMs generate proposals only.

LLMs MUST NOT:

- execute tools,
- approve actions,
- own identity,
- own policy,
- own credentials,
- choose hidden tools,
- claim completion before verified runtime success,
- provide user IDs,
- fabricate provider results,
- fabricate approval records,
- override deterministic validation.

Structured model output MAY reduce parsing ambiguity, but schema conformance is
not authority. The output remains untrusted until deterministic validation
accepts it.

## Decision Authority

Decision authority is split by phase:

- Validation owns whether a proposal can become a supported intent.
- Execution Policy owns whether an exact execution request is allowed.
- Approval owns whether the user has consented to the exact step, tool, target,
  risk, and scope.
- Runtime owns whether execution actually succeeded.
- Worker owns server-side provider and secret-bearing checks.

Conflict resolution:

- If LLM output conflicts with deterministic validation, validation wins.
- If approval conflicts with policy, policy wins.
- If provider response conflicts with runtime validation, runtime validation
  wins.
- If documentation conflicts with verified implementation, current architecture
  documents MUST record the inconsistency and prefer verified implementation
  until the documentation or implementation is corrected.

Failure:

- Unknown intent MUST fail closed.
- Missing exact target MUST fail closed.
- Missing approval MUST fail closed when approval is required.
- Mismatched approval MUST fail closed.
- Missing handler MUST fail closed.
- Stale code proposal approval MUST fail closed.
- Provider ambiguity MUST fail closed where the implementation cannot verify a
  safe result.

Retry:

- Current SmartFlow has no general automatic retry authority.
- A future retry capability MUST re-run validation and policy.
- A future retry capability MUST NOT reuse expired, consumed, stale, or
  mismatched approval.

Rejection:

- User rejection blocks execution.
- Policy rejection blocks execution.
- Runtime validation rejection blocks handler execution.
- Worker rejection blocks provider mutation.

## Execution Authority

Who starts execution:

- The user starts execution by explicit action after seeing the proposed action
  and any required approval surface.
- SmartFlow MAY route that request to runtime only when the tool is supported.

Who performs execution:

- The execution engine or write runtime performs local runtime execution.
- The Worker performs server-owned provider execution for implemented backend
  routes.
- Providers perform external mutations only after receiving authorized requests
  from the Worker or approved client path.

Who owns credentials:

- User identity comes from Supabase Auth.
- Service-role access and provider secrets are Worker-owned.
- The LLM MUST NOT receive or own credentials.
- Browser request fields MUST NOT be trusted as server credentials or
  server-owned approval facts.

Who talks to providers:

- The Worker owns GitHub provider write calls.
- The Worker owns Gemini calls.
- Frontend clients MAY call Worker routes with runtime authentication.

Who records results:

- Runtime records execution result and in-memory audit where implemented.
- Worker records durable GitHub write logs before and after provider mutation.
- Provider responses are validated and reduced before becoming user-facing
  runtime facts.

Who owns runtime truth:

- Runtime owns success, failure, timeout, verification failure, and policy-denied
  status.
- LLM text MUST NOT be treated as runtime truth.
- Provider responses MUST be validated before being treated as runtime truth.

## Audit Authority

Audit MUST record enough to reconstruct execution authority without exposing
secrets.

Current audit records include, where implemented:

- request ID,
- step ID,
- tool ID,
- status,
- policy status,
- risk level,
- approval status,
- approval scope,
- timing,
- sanitized error code,
- sanitized metadata,
- execution, policy, and audit versions.

GitHub write audit persistence includes:

- pending write-log row before provider mutation,
- executed or failed status after provider outcome,
- tool ID,
- bounded parameters,
- sanitized provider response where permitted.

Audit authority rules:

- Audit MUST be tied to runtime execution lifecycle.
- Audit MUST NOT approve execution.
- Audit MUST NOT be generated from LLM claims alone.
- Audit MUST redact or omit secrets, tokens, authorization headers, cookies,
  API keys, and raw private payloads.
- A consumed high-risk code approval MUST have an already-created pending audit
  row before mutation is attempted.

Operational limitation:

- Some current frontend audit records are in-memory rather than durable. Future
  durable audit expansion MUST preserve the same authority boundaries.

## Security Authority

Authentication:

- Supabase Auth owns user authentication.
- Worker routes MUST validate bearer tokens where implemented.
- Local reasoning MUST remain local-QA gated and loopback-only unless a future
  architecture changes that authority.

Authorization:

- Tool registry defines available tool contracts.
- Execution policy owns whether a concrete request is authorized to execute.
- Worker owns provider-specific authorization and repository access checks.

Approval:

- User approval is required for external-effect, write, irreversible, medium
  risk, and high-risk execution.
- Approval MUST bind to exact step and tool.
- High-risk code write approval MUST be server-verifiable and MUST NOT trust
  browser-supplied base or digest facts.

Execution:

- Execution MUST pass policy first.
- Execution MUST use registered handlers.
- Execution MUST validate handler input.
- Execution MUST fail closed on missing handler, unsupported tool, invalid input,
  stale state, insufficient risk, or insufficient scope.

Persistence:

- User-owned tables SHOULD remain protected by RLS.
- Backend-only integration tables MUST NOT grant client mutation authority.
- Service-role writes MUST be Worker-owned.

External providers:

- Provider credentials MUST be server-owned.
- Provider responses MUST be treated as data, not authority.
- Provider rejection MUST block the SmartFlow operation.

Runtime identity:

- Runtime identity MUST come from authenticated context.
- LLM output MUST NOT provide user identity.
- Request payloads MUST NOT be trusted to assert privileged identity.

Secrets:

- Secrets MUST remain outside prompts, audit metadata, browser-visible payloads,
  and user-facing responses.

Server ownership:

- Server-owned policy facts include provider credentials, service-role access,
  GitHub installation token minting, write logs, and code proposal approval
  records.

## Authority Invariants

These rules MUST NOT be violated:

- The LLM never executes tools.
- The LLM never approves actions.
- The LLM never owns credentials.
- The LLM never owns user identity.
- The LLM never owns policy.
- A proposal is never execution.
- Approval is never execution.
- Approval cannot be fabricated by model output.
- Approval cannot authorize a different step, tool, target, scope, or risk.
- Execution cannot occur without policy.
- Policy cannot be bypassed by UI, model output, provider response, or user
  request shape.
- Unknown intent fails closed.
- Unsupported action fails closed.
- Missing exact target fails closed when a target is required.
- Missing handler fails closed.
- Missing or insufficient approval fails closed.
- External-effect tools require explicit approved consent.
- Irreversible tools require explicit approved consent and sufficient risk.
- Runtime identity is authenticated and MUST NOT come from the LLM.
- Provider responses never redefine SmartFlow authority.
- Audit reflects runtime reality, not desired outcome.
- Secrets MUST NOT appear in prompts, audit metadata, or user-facing output.
- Worker-owned credentials MUST NOT move to the browser.
- Backend-only persistence MUST NOT be client-mutable.
- Registry-only tool definitions are not executable authority.
- Architecture documents override implementation assumptions; implementation
  that violates this document is architecture debt until corrected or this
  document is formally amended.

## Current vs Future Authority

### Implemented Authority

Implemented today:

- User may request and approve bounded actions.
- SmartFlow may observe bounded workspace data.
- SmartFlow may produce deterministic workspace goals and plans.
- LLM may generate bounded proposals and responses.
- Deterministic validation may accept, normalize, reject, or clarify proposals.
- Execution policy may allow or deny exact execution requests.
- Approval model may classify pending/not-required approval state.
- Read-only runtime may execute supported read-only tools.
- Write runtime may execute `tasks.complete`, `github.issues.comment`,
  `github.issues.update`, and `github.files.update` after approval and policy.
- Worker may own Gemini calls, GitHub integration, GitHub write boundaries,
  service-role database writes, write logs, and code proposal approval records.
- Audit may record sanitized runtime events.

### Planned Authority

Planned but not defined here:

- Execution Intent.
- SmartFlow to Smart Automation Boundary.
- Target Architecture.
- Representative Engine.
- Agent Orchestration.
- Delegation beyond the current user-approved execution model.
- Autonomous or scheduled execution authority.
- Durable audit expansion beyond current implementation.
- Additional write tools beyond the currently supported set.

Future documents MAY define these areas only if they preserve this Authority
Model or formally amend it.

## Relationship to Other Architecture Documents

- [Current Architecture](current-architecture.md) records what is implemented.
  This document governs what authority those implemented parts have.
- Execution Intent MUST define how intent is represented without granting the
  LLM approval or execution authority.
- SmartFlow to Smart Automation Boundary MUST define when automation begins, and
  MUST preserve the distinction between proposal, approval, and execution.
- Target Architecture MUST not broaden authority silently; every new authority
  grant MUST be explicit.
- Representative Engine MUST not claim user authority unless a future document
  defines exact delegation, revocation, and recovery boundaries.
- Agent Orchestration MUST not introduce hidden execution or implicit approval.

## Explicitly Out of Scope

This document does not design:

- Execution Intent.
- Representative Engine.
- Target Architecture.
- Autonomous AI.
- Semantic memory.
- Agent orchestration.
- Multi-agent coordination.
- Smart Automation execution.
- New write tools.
- New provider integrations.
- New user experience flows.

## Related Documents

- [Current Architecture](current-architecture.md)
- [ADR-0001: Architecture Decision Record Policy](../decisions/adr/ADR-0001-architecture-decision-record-policy.md)
- [ADR-0002: Flow AI Presence Architecture](../decisions/adr/ADR-0002%20—%20Flow%20AI%20Presence%20Architecture.md)
- [ADR-0003: Local Agent Reasoning Endpoint Boundary](../decisions/adr/ADR-0003-agent-reason-local-qa-only.md)
- [ADR-0004: Write Boundaries](../decisions/adr/ADR-0004-write-boundaries.md)
- [ADR-0005: Code Write Mutation Boundary](../decisions/adr/ADR-0005-code-write-mutation-boundary.md)
