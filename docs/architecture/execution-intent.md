# SmartFlow Execution Intent

Status: Canonical Architecture
Last updated: 2026-07-30
Scope: execution intent specification only

## 1. Purpose

Execution Intent defines the exact action SmartFlow is allowed to execute.

It answers:

> What exactly are the user, deterministic validation, execution policy,
> approval system, runtime, Worker, and audit system agreeing to execute?

SmartFlow requires a canonical Execution Intent model because execution must
not depend on vague language, mutable proposals, UI labels, or provider
responses. Execution Intent prevents:

- approval ambiguity,
- argument mutation after approval,
- stale proposals,
- replay of previous approval,
- scope expansion,
- tool substitution,
- identity mismatch,
- target mismatch,
- hidden execution,
- audit mismatch.

Execution Intent does not implement a new runtime type. It defines the
architecture that current and future execution mechanisms MUST satisfy.

## 2. Relationship to the Authority Model

Execution Intent derives from [Authority Model](authority-model.md).

Authority answers who may act. Execution Intent answers what exact action may
be acted upon.

The authority split is:

- The LLM MAY propose intent.
- Deterministic systems MUST validate intent.
- Policy MUST evaluate intent.
- The user MAY approve intent when approval is required.
- Runtime MUST execute only the approved intent.
- Audit MUST record actual runtime execution against the intent.

Authority and intent MUST remain distinct. An actor with authority to propose
does not have authority to approve. An actor with authority to approve does not
bypass policy. A provider response does not redefine the approved intent.

## 3. Execution Intent Definition

Execution Intent is the canonical, deterministic, bounded description of one
permitted execution action.

A valid Execution Intent SHOULD contain enough immutable information to
determine:

- acting user,
- authenticated runtime identity,
- tool or capability,
- action type,
- target resource,
- arguments,
- expected effect,
- risk level,
- approval requirement,
- policy facts,
- freshness or expiry,
- replay protection,
- idempotency identity,
- proposal or base-state binding where applicable,
- relevant preconditions,
- relevant limits.

### Universal intent fields

Universal intent fields are architectural facts that apply to any execution:

- `intentId` or equivalent stable identity,
- `userId` or authenticated user binding,
- `toolId` or capability ID,
- `actionType`,
- `target`,
- normalized arguments,
- expected effect,
- risk level,
- approval requirement,
- policy version or policy evaluation context,
- creation time or validation time,
- expiration or freshness rules where required,
- idempotency or claim identity where required.

### Tool-specific intent fields

Tool-specific fields MAY exist only when required by the tool boundary.

Examples:

- `tasks.complete`: task ID and expected completion effect.
- `github.issues.comment`: repo, issue number, exact comment body.
- `github.issues.update`: repo, issue number, exact title/body/label changes.
- `github.files.update`: repo, path, proposal ID, proposed content, base commit,
  base blob, proposed-content digest, risk, expiry, and one-time approval claim.

### Execution-derived runtime fields

These are not part of intent until runtime derives them:

- actual provider response,
- terminal status,
- execution duration,
- runtime error code,
- generated audit ID,
- provider commit URL or provider result URL,
- verification result.

### Result fields that are not intent

Execution result, audit record, provider response, user-facing summary, and
reflection are not Execution Intent. They MAY reference intent identity, but
they MUST NOT redefine it.

## 4. Intent Lifecycle

The lifecycle is:

```text
User request or system signal
-> reasoning or planning
-> candidate proposal
-> deterministic normalization
-> intent construction
-> validation
-> policy evaluation
-> approval requirement determination
-> user approval, when required
-> freshness and integrity revalidation
-> execution claim
-> provider operation
-> verification
-> audit and terminal result
```

Allowed transformations:

- User request MAY be transformed into a candidate proposal.
- Candidate proposal MAY be normalized by deterministic validation.
- Normalized candidate MAY be transformed into canonical intent.
- Policy MAY enrich intent evaluation with risk, scope, and allow/deny status.
- Approval MAY bind a user decision to exact intent facts.
- Runtime MAY derive execution status and verified result.
- Audit MAY derive sanitized metadata from runtime truth.

Prohibited transformations:

- Approved semantic meaning MUST NOT mutate.
- Tool ID MUST NOT change after approval.
- Target MUST NOT expand after approval.
- Arguments MUST NOT semantically change after approval.
- Risk MUST NOT be lowered after approval.
- Provider response MUST NOT rewrite intent.
- Audit MUST NOT invent intent after execution.

## 5. Candidate Proposal vs Canonical Intent

Natural-language request:

- user or system language,
- ambiguous until validated,
- not executable.

LLM proposal:

- model-generated structured or textual suggestion,
- untrusted until deterministic validation,
- not executable.

Planner action:

- proposed step in a plan,
- may identify domain, action type, and route,
- not executable by itself.

Normalized candidate:

- deterministic interpretation of a proposal,
- may map to a supported intent type and tool,
- still not approved execution.

Canonical Execution Intent:

- validated, bounded, deterministic action description,
- contains exact tool, target, normalized arguments, user binding, risk, and
  policy-relevant facts.

Approved Execution Intent:

- canonical intent plus explicit user approval where required,
- approval is bound to exact immutable facts.

Claimed execution:

- runtime or Worker has claimed the approved intent for execution.
- claim semantics prevent duplicate or replay where implemented.

Provider operation:

- external API request constructed from approved intent.
- provider operation is not the intent itself.

Execution result:

- terminal runtime outcome.
- result does not redefine the original intent.

An LLM proposal MUST NOT automatically become executable intent. Canonical
intent MUST be produced or validated through deterministic logic. Security-
relevant facts SHOULD be server-owned when provider mutation or high-risk
execution is involved.

## 6. Intent Identity

Execution Intent identity binds the action to stable facts.

Architectural identity MAY use:

- stable tool or capability ID,
- normalized arguments,
- user binding,
- target binding,
- base state,
- proposal digest,
- expiry,
- nonce or one-time approval identity,
- idempotency key,
- deterministic hash or identifier.

This document does not mandate one hashing algorithm for all tools.

Current implementation evidence:

- GitHub code proposal approval computes a proposal ID from repo, path, base
  blob SHA, base commit SHA, and proposed-content digest.
- The Worker recomputes and verifies the proposal ID before recording approval.
- The Worker stores base state, digest, risk, expiry, and consumed status in
  `agent_code_proposal_approvals`.

Identifier distinctions:

- Intent ID identifies the semantic execution action.
- Approval ID identifies a user approval record.
- Execution ID or request ID identifies one runtime attempt.
- Audit ID identifies an audit record.
- Provider request ID identifies a provider-side operation if available.
- Idempotency key identifies duplicate handling for an execution attempt.

These identifiers MUST NOT be treated as interchangeable unless an architecture
or implementation explicitly defines that equivalence.

## 7. Intent Scope

Execution Intent MUST be bounded to:

- one tool or capability,
- one action,
- one authenticated user,
- one target scope,
- one bounded argument set,
- one risk classification,
- one approval decision,
- one execution lifecycle.

Batching or multi-action execution requires either:

- multiple separate intents, each with its own policy and approval binding, or
- a future parent orchestration intent with explicit child-intent semantics.

This document does not design composite, autonomous, or orchestration-level
intent.

## 8. Intent Immutability

After approval is granted, these facts MUST be immutable:

- tool ID,
- action type,
- target,
- normalized arguments,
- risk,
- expected effect,
- user binding,
- repository or provider binding,
- proposal digest,
- base revision where applicable,
- expiry,
- safety constraints.

Cosmetic UI text MAY change only when it does not alter approved meaning. Any
semantic change MUST create a new intent and, where approval is required, a new
approval.

## 9. Approval Binding

User approval means consent to the exact Execution Intent.

Approval MUST NOT bind only to:

- a general goal,
- a conversation,
- a tool category,
- a provider,
- a button,
- a natural-language summary,
- a mutable proposal.

Approval binding requirements:

- authenticated user,
- exact intent identity,
- risk level,
- target,
- arguments or digest,
- expiry where required,
- one-time or bounded reuse where required,
- server-verifiable proof for high-risk/provider mutation where required,
- revocation, rejection, staleness, or invalidation rules.

Approval differs from authorization and policy:

- Approval is user consent.
- Policy is deterministic authorization.
- Runtime execution is the actual attempt.

Approval alone MUST NOT execute. Approval MUST NOT bypass policy.

## 10. Policy Binding

Policy MUST evaluate canonical, normalized facts.

Policy MUST NOT trust:

- LLM-declared permission,
- client-declared risk,
- client-declared ownership,
- client-declared approval,
- provider-declared authority,
- mutable UI state.

Policy evaluation includes:

- supported tool IDs,
- handler availability,
- policy allow/deny result,
- risk classification,
- approval requirement,
- runtime identity,
- provider connection state where applicable,
- target restrictions,
- protected paths,
- bounded limits.

Unknown, incomplete, malformed, unsupported, stale, or unverifiable intent MUST
fail closed.

## 11. Execution Binding

Runtime MUST bind execution to approved intent.

The execution runtime MUST:

- accept only supported canonical intent,
- revalidate relevant facts immediately before execution,
- prevent tool substitution,
- prevent argument mutation,
- prevent target expansion,
- enforce idempotency or claim semantics where required,
- use server-owned credentials for server-owned operations,
- record actual runtime outcome,
- distinguish pre-execution rejection from provider failure,
- distinguish successful provider response from verified completion.

Provider calls MUST NOT redefine the approved action. Provider success MUST be
classified and, where possible, verified before becoming runtime truth.

## 12. Freshness and Staleness

An intent becomes stale when a fact required for safe execution is no longer
true or cannot be verified.

Staleness examples:

- approval expired,
- base commit changed,
- file blob changed,
- issue state changed in a way that invalidates target assumptions,
- user identity changed,
- provider connection changed,
- policy changed,
- capability disabled,
- target no longer exists,
- repository permissions changed,
- risk classification changed.

Required response:

- Expired approval MUST reject execution and require a new approval.
- Changed base state MUST reject execution when base state is part of intent.
- Changed user identity MUST reject execution.
- Disabled capability MUST reject execution.
- Missing target MUST reject execution.
- Provider permission loss MUST reject execution.
- Safe retry MAY occur only when it revalidates policy, freshness, and approval.

Current implementation evidence:

- `github.files.update` revalidates approval expiry, repo/path binding, content
  digest, risk, current branch commit, and file blob before mutation.
- General write runtime supports duplicate request ID blocking in-memory.
- Not every current write tool has the same freshness model as code file
  update.

## 13. Replay and Idempotency

Replay prevention blocks reuse of an approval or intent beyond its allowed
lifecycle.

Duplicate prevention blocks repeated handling of the same runtime request.

Idempotency makes repeated equivalent operations safe or no-op where designed.

Retry is a new attempt after failure or uncertainty.

Recovery is explicit handling of partial or failed execution.

Exactly-once claim means one claimant wins the right to use an approval or
intent.

Provider-side duplicate behavior is provider-specific and MUST NOT be treated
as SmartFlow approval validity.

Rules:

- Idempotency does not prove approval validity.
- A consumed or terminal approval MUST NOT silently authorize a new semantic
  action.
- Retry MUST NOT silently create a new semantic action.
- Recovery MUST preserve audit and approval history.

Current implementation evidence:

- `tasks.complete` is state-idempotent.
- Write runtime tracks completed request IDs in-memory for duplicate blocking.
- GitHub code proposal approval uses `consumed_at` conditional update as a
  single-use claim.
- A partial GitHub file mutation consumes approval and does not automatically
  retry.

## 14. Cancellation, Revocation, and Expiry

Conceptual lifecycle states:

- `proposed`,
- `validated`,
- `policy-approved`,
- `awaiting-approval`,
- `approved`,
- `rejected`,
- `revoked`,
- `expired`,
- `stale`,
- `claimed`,
- `executing`,
- `terminal`.

Current implementation uses some, but not all, of these states explicitly.
They are architectural lifecycle concepts, not a new state machine.

Cancellation:

- User MAY cancel before approval by abandoning or rejecting the pending action.
- Runtime MAY stop before provider mutation if validation, policy, approval, or
  freshness fails.

Revocation:

- Revocation invalidates previously granted authority before execution.
- Provider connection revocation invalidates provider operations.
- Current high-risk approval consumption prevents reuse, but a generalized
  revocation system is not implemented.

Expiry:

- Expiry is time-based invalidation.
- Expired intent or approval MUST NOT execute.

Staleness:

- Staleness is fact-based invalidation.
- Stale intent MUST require revalidation and may require new approval.

After irreversible provider action starts, cancellation may no longer be able
to undo effects. Recovery must be explicit and audited.

## 15. Intent Verification

Before execution, SmartFlow MUST verify:

- structural validity,
- authenticated identity,
- supported tool or capability,
- exact target,
- normalized arguments,
- policy allow result,
- approval binding where required,
- freshness,
- target constraints.

During execution, SmartFlow MUST verify:

- correct handler,
- correct provider route,
- correct credentials,
- bounded request body,
- no tool substitution,
- no target expansion.

After execution, SmartFlow SHOULD verify:

- provider response classification,
- actual effect where verifiable,
- terminal status,
- audit correlation,
- partial failure handling.

Provider success alone may not prove the expected effect in every integration.
Runtime MUST distinguish a provider response from a verified result.

## 16. Audit Relationship

Audit MUST record execution against intent without granting authority.

Audit SHOULD include:

- intent identity or correlated request identity,
- user binding where safe,
- tool,
- target metadata,
- risk,
- approval status,
- execution claim,
- timestamps,
- provider,
- terminal status,
- sanitized result metadata,
- error classification,
- retry or recovery relationship,
- correlation identifiers.

Audit MUST represent runtime truth. Audit MUST NOT contain unnecessary secrets
or unrestricted sensitive payloads. Audit records do not authorize replay.

Current implementation evidence:

- frontend execution audit records are sanitized and bounded,
- some frontend audit records are in-memory,
- GitHub writes create durable `agent_write_log` rows,
- GitHub file update inserts pending audit before consuming approval.

## 17. Tool-Specific Intent Examples

These examples are conceptual and non-secret. They are not universal schemas.

### `tasks.complete`

User-approved action: mark one task complete.

Bounded target: one task ID owned by the authenticated user context.

Immutable facts:

- tool ID `tasks.complete`,
- action type `complete`,
- target task ID,
- approval step ID and tool ID,
- risk `medium`,
- expected effect: task becomes completed.

Required validation:

- tool is supported,
- step/action/domain match,
- approval is exact and approved,
- handler input is valid,
- authenticated user identity exists.

Stale or rejection conditions:

- wrong tool,
- wrong step,
- missing target,
- missing approval,
- insufficient approval,
- missing handler,
- task not found or inaccessible.

Audit relationship: runtime records started and terminal audit records. State
idempotency may report an already completed task without duplicate mutation.

### `github.issues.comment`

User-approved action: add one exact comment to one existing GitHub issue.

Bounded target: repo and issue number.

Immutable facts:

- tool ID `github.issues.comment`,
- repo,
- issue number,
- exact comment body,
- approval step/tool binding,
- risk `medium`,
- expected effect: one comment created.

Required validation:

- authenticated SmartFlow user,
- verified GitHub App connection,
- repository access,
- bounded repo/issue/comment fields,
- write rate limit,
- exact approval,
- Worker route input validation.

Stale or rejection conditions:

- invalid repo or issue,
- missing comment body,
- missing connection,
- lost repository access,
- rate limit exceeded,
- provider rejection.

Audit relationship: Worker writes `agent_write_log` before mutation and updates
it after provider outcome.

### `github.issues.update`

User-approved action: update title, body, or labels for one existing GitHub
issue.

Bounded target: repo and issue number.

Immutable facts:

- tool ID `github.issues.update`,
- repo,
- issue number,
- exact title/body/label changes,
- approval step/tool binding,
- risk `medium`,
- expected effect: issue metadata updated.

Required validation:

- at least one bounded update field,
- repository access,
- label bounds,
- exact approval,
- write rate limit,
- Worker route validation.

Stale or rejection conditions:

- no update fields,
- invalid labels,
- repository access loss,
- provider rejection,
- rate limit exceeded.

Audit relationship: Worker writes `agent_write_log` before mutation and updates
it after provider outcome.

### `github.files.update`

User-approved action: update exactly one existing text file by creating one
non-default branch and one commit.

Bounded target: repo and repository-relative path.

Immutable facts:

- tool ID `github.files.update`,
- repo,
- path,
- proposed content,
- proposal ID,
- base blob SHA,
- base commit SHA,
- proposed-content digest,
- risk `high`,
- approval expiry,
- one-time approval claim,
- expected effect: one branch and one commit, no PR or merge.

Required validation:

- server-verifiable approval record,
- recomputed proposal ID,
- recomputed content digest,
- current base commit and blob match approved base,
- risk is sufficient,
- approval is unconsumed and unexpired,
- protected paths are denied,
- content is bounded text,
- repository access is verified.

Stale or rejection conditions:

- approval missing, expired, consumed, or mismatched,
- repo/path mismatch,
- content digest mismatch,
- base commit or blob changed,
- protected path,
- file too large or invalid content,
- branch collision,
- provider rejection.

Audit relationship: Worker inserts a pending `agent_write_log` row before
claiming approval, consumes approval atomically, and records executed, failed,
or partial mutation outcome.

## 18. Read Intent vs Write Intent

Read actions also have Execution Intent.

Read intent still requires:

- authenticated identity where required,
- supported capability or tool,
- policy evaluation,
- bounded target or query,
- handler availability,
- bounded output,
- fail-closed behavior when unsupported or unauthorized.

Write intent usually requires stronger controls:

- exact approval,
- risk classification,
- immutable arguments,
- freshness checks,
- idempotency or claim semantics,
- durable audit for provider mutation,
- server-owned credentials.

Not every read requires user approval. Read intent MUST still fail closed when
the tool is unsupported, unauthorized, disabled, or unmapped.

## 19. Current Implementation Mapping

| Element | Status | Current evidence |
| --- | --- | --- |
| Unified `ExecutionIntent` runtime type | Conceptual only | No single runtime type currently exists. |
| Tool IDs | Implemented | Tool registry and runtime use stable IDs. |
| Planner actions | Implemented | Workspace planner creates proposed steps. |
| Deterministic proposal validation | Implemented | Reasoning validator normalizes/rejects model proposals. |
| Execution policy | Implemented | `evaluateExecutionPolicy` checks tool, mapping, risk, scope, target, approval. |
| Approval state | Implemented | Workspace approval model and write runtime approvals exist. |
| Risk levels | Implemented | Tool and approval risk levels are enforced. |
| Write handlers | Implemented for supported writes | `tasks.complete`, GitHub issue comment/update, GitHub file update. |
| GitHub code proposal ID | Implemented | Computed from repo, path, base blob, base commit, proposed-content digest. |
| Proposal digest and base-state validation | Implemented for file update | Worker derives and revalidates before mutation. |
| Expiry | Implemented for GitHub file approval | Approval records include `expires_at`. |
| One-time claim | Implemented for GitHub file approval | Conditional consumed-at update. |
| Duplicate request blocking | Partially implemented | Write runtime tracks completed request IDs in-memory. |
| Durable audit | Partially implemented | GitHub writes use `agent_write_log`; frontend audit is in-memory. |
| Read intent audit | Partially implemented | Current execution audit is in-memory. |
| Composite intent | Future work | Not designed here. |
| Delegated or scheduled intent | Future work | Not implemented. |

Current implementation distributes intent facts across existing components
rather than materializing one canonical object. This is acceptable for the
current system, but future execution expansion SHOULD converge on an explicit
intent artifact.

## 20. Authority and Intent Invariants

- An LLM proposal is not executable intent.
- Intent MUST be bound to an authenticated user.
- Intent MUST identify one supported capability or tool.
- Intent MUST include a bounded target where execution requires a target.
- Intent MUST include normalized arguments.
- Approval MUST bind to exact immutable intent.
- Policy MUST evaluate server-validated facts.
- Client-declared authority MUST NOT be trusted.
- Client-declared risk MUST NOT be trusted for high-risk provider mutation.
- Tool substitution after approval is forbidden.
- Semantic argument mutation after approval is forbidden.
- Target expansion after approval is forbidden.
- Stale intent MUST NOT execute.
- Unknown intent MUST fail closed.
- Unsupported intent MUST fail closed.
- Provider responses MUST NOT expand authority.
- Registry presence alone does not create executable intent.
- Audit records MUST correlate with actual execution.
- Audit records do not authorize replay.
- Retry MUST NOT silently create a new semantic action.
- A changed base state may invalidate an approved intent.
- Secrets MUST NOT be embedded in intent or audit payloads.
- Runtime credentials remain server-owned.
- A terminal or consumed approval MUST NOT authorize a new semantic action.
- Result summaries MUST NOT redefine approved intent.

## 21. Current vs Future Execution Intent

### Current

Current architecture includes:

- bounded tool invocation,
- deterministic proposal validation,
- deterministic policy,
- explicit approval for writes,
- risk levels,
- GitHub code proposal IDs,
- GitHub code approval expiry,
- stale-base validation for file update,
- one-time claim semantics for code proposal approval,
- provider execution through Worker routes,
- audit correlation through runtime audit and GitHub write logs.

Current architecture does not include:

- one unified `ExecutionIntent` runtime type,
- composite intent,
- delegated intent,
- scheduled intent,
- autonomous intent generation,
- orchestration-level intent.

### Future

Future architecture MAY define:

- unified `ExecutionIntent` type,
- composite intent,
- delegated intent,
- scheduled intent,
- Smart Automation intent exchange,
- autonomous intent generation,
- orchestration-level intent,
- richer revocation,
- durable distributed execution state.

Future systems MUST preserve this document's invariants unless this document is
formally amended.

## 22. Relationship to Later Documents

SmartFlow to Smart Automation Boundary MUST use Execution Intent as the unit of
what may cross the boundary. It MUST NOT allow natural-language requests,
planner prose, provider responses, or mutable proposals to act as execution
authority.

Target Architecture MUST preserve exact intent binding, policy evaluation,
approval binding, runtime truth, and audit correlation.

Representative Engine MUST NOT infer delegated authority from user goals alone.
Any delegated authority MUST be represented as explicit, bounded intent with
revocation and recovery rules.

Agent Orchestration MUST NOT bypass intent construction. Multi-step work MUST
either produce multiple approved intents or a future composite intent model with
explicit child-intent boundaries.

## Explicitly Out of Scope

This document does not design or implement:

- SmartFlow to Smart Automation protocol,
- Smart Automation execution,
- Target Architecture,
- Representative Engine,
- Agent Orchestration,
- multi-agent coordination,
- autonomous execution,
- semantic memory,
- scheduling infrastructure,
- workflow orchestration,
- new database tables,
- new runtime types,
- new API routes,
- UI approval redesign,
- tool implementation,
- provider integration changes.

## Related Documents

- [Current Architecture](current-architecture.md)
- [Authority Model](authority-model.md)
- [ADR-0003: Local Agent Reasoning Endpoint Boundary](../decisions/adr/ADR-0003-agent-reason-local-qa-only.md)
- [ADR-0004: Write Boundaries](../decisions/adr/ADR-0004-write-boundaries.md)
- [ADR-0005: Code Write Mutation Boundary](../decisions/adr/ADR-0005-code-write-mutation-boundary.md)
