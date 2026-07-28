# EPIC-08 - Write Code - Design v1

**Version:** 1.0
**Status:** Implementation-ready design
**Date:** 2026-07-28
**Scope:** Controlled code changes for one GitHub software project. This document does not modify production code, tests, database schema, or deployment configuration.

## 1. Status and Scope

EPIC-08 extends SmartFlow from a project assistant that reads GitHub state and performs narrow issue writes into a controlled code-change assistant. The supported flow is:

```text
User request -> bounded plan -> code proposal -> validation -> diff preview
-> explicit approval -> execution -> verification -> audit
```

The first implementation target is GitHub-backed source content. Local filesystem mutation is outside this epic. Every code change is a single, explicit proposal and requires an approval bound to the exact step, tool, target, base revision, and proposed content.

## 2. Current Implementation Reality

The repository already contains a deterministic read pipeline and a separate write boundary.

| Area | Current reality | EPIC-08 implication |
|---|---|---|
| Planner | `src/features/workspace/plannerEngine.ts` produces typed workspace plan steps. | Extend step mapping only where required; do not create a code planner. |
| Approval | `src/features/agent/approvalInteraction.ts` validates step, target, tool, scope, and risk. `StepApprovalDialog.tsx` presents the existing review interaction. | Add code-specific preview data while retaining exact-step approval. |
| Execution Policy | `src/features/agent/executionPolicy.ts` checks tool, domain, capability, target, approval, risk, and scope. | Register code tools with explicit mappings and stricter code restrictions. |
| Read execution | `src/features/agent/executionEngine.ts` intentionally accepts only read-only handlers. | Do not route code mutation through this engine. |
| Write Runtime | `src/features/agent/writeRuntime.ts` is the mutation boundary. It enforces supported tool IDs, authentication, policy, approval, duplicate request protection, timeout handling, verification, and audit correlation. | Extend this existing runtime for code tools. |
| Write handlers | `src/features/agent/writeHandlers.ts` registers `tasks.complete`, `github.issues.comment`, and `github.issues.update`. | Add code handlers only after their contracts are defined. |
| Audit | `src/features/agent/executionAudit.ts` stores sanitized browser-tab-local records, capped at 200. `ExecutionAuditRecord` is typed in `executionAuditTypes.ts`. | Preserve the existing audit record and add bounded code metadata; durable GitHub mutation logging remains a Worker concern. |
| Tool Registry | `src/features/agent/toolRegistry.ts` validates immutable tool definitions from `src/features/agent/tools`. | Code tools must be explicit, disabled until implemented, and have bounded schemas. |
| GitHub client | `src/features/integrations/github/` has clients for repositories, issues, pulls, workflow runs, issue comments, and issue updates. | No source-file, branch, commit, or content verification client exists. |
| GitHub Worker | `agent/worker/github-integration.ts` exposes authenticated, origin-checked routes for connection, reads, and two issue writes. It validates repository access, applies a five-write/hour limit, and writes `agent_write_log` before mutation. | New file/branch/commit routes and audit parameters are required. |
| Typed results | `AgentWriteToolExecutionResult` and `WriteRuntimeResult` already distinguish success, invalid input, verification failure, timeout, and failure. | Reuse these result types and extend only where code evidence is necessary. |

## 3. EPIC-08 Goals

- Propose a bounded change to one existing text file in one connected GitHub repository.
- Show the exact proposed diff before execution.
- Require explicit approval for the exact proposal.
- Execute only through the existing write runtime and authenticated GitHub Worker boundary.
- Mutate a non-default branch and create one commit, never the default branch directly.
- Read the resulting file back and verify content plus resulting commit identity.
- Record the lifecycle in the existing execution audit and the Worker durable write log.
- Keep behaviour deterministic, reviewable, and manually initiated.

## 4. Non-Goals

- Autonomous chaining, autonomous planning loops, or background coding.
- Silent retry, automatic merge, or automatic pull-request approval.
- Direct commits to the default branch.
- Unrestricted shell execution, arbitrary command execution, or local workspace mutation.
- Multi-file proposals in EPIC-08 MVP.
- File creation, deletion, rename, binary files, or oversized files in the first mutation slice.
- A general IDE, code editor, provider abstraction, or EPIC-09 autonomy capability.

## 5. Existing Systems Reused

The implementation must use `plannerEngine.ts`, `approvalInteraction.ts`, `executionPolicy.ts`, `writeRuntime.ts`, `executionAudit.ts`, `toolRegistry.ts`, existing GitHub authentication, `agent/worker/github-integration.ts`, and the existing integration-client pattern. No parallel approval, execution, audit, or GitHub authentication system is permitted.

## 6. Capability Gap Analysis

| Candidate capability | Status | Decision |
|---|---|---|
| Read an existing text file | Missing | Add an authenticated bounded GitHub contents read route and client. |
| Generate exact diff | Missing | Add deterministic diff generation from the fetched base content and proposed content. |
| Edit one existing file | Missing | EPIC-08 capability; only after preview and approval. |
| Create a file | Missing | Deferred until existing-file edit is proven. |
| Multi-file edit | Missing and higher risk | Out of EPIC-08 MVP; one file per proposal. |
| Branch creation | Missing | Required for mutation slice, not Slice 1. |
| Commit creation | Missing | Required for mutation slice, not Slice 1. |
| Pull request creation | Missing | Not required for MVP; deferred. |
| Result read-back | Missing for source files | Required verification step. |
| Durable code-write audit | Existing pattern only for issue writes | Extend `agent_write_log` usage for code mutation; do not invent a third audit store. |

The candidate MVP is therefore **accepted as the EPIC-08 target but rejected as Slice 1**. Branch creation and commit creation do not belong in Slice 1 because the repository has no source-content contract, diff authority, stale-base contract, or code-specific approval payload yet.

## 7. Final MVP Definition

The EPIC-08 MVP is one `github.files.update` proposal:

- one repository selected from the verified GitHub installation;
- one existing UTF-8 text file;
- one bounded replacement or complete-content proposal;
- one exact unified diff generated from the fetched base blob;
- one approval bound to the file path, base blob SHA, proposed content digest, and step ID;
- one branch created from the recorded default-branch head;
- one commit containing that file change on the non-default branch;
- one read-back of the committed file;
- verification of content digest and commit SHA;
- one terminal success or failure result and corresponding audit records.

The MVP does not create a pull request. A later, separately approved capability may create a PR from the resulting branch.

## 8. End-to-End Lifecycle

1. The user requests a bounded code change.
2. The Planner produces one GitHub code-change step with one repository and one file target.
3. A deterministic proposal builder reads the existing file and records its blob SHA, branch, content digest, and proposed content.
4. A deterministic validator rejects unsupported paths, encodings, sizes, and content shapes.
5. The diff generator produces the exact preview from fetched base content to proposed content.
6. The approval UI displays target, branch, base revision, diff, risk, and expected effect.
7. The user explicitly approves that exact step.
8. The write runtime revalidates authentication, tool mapping, approval, expiry, target, and proposal digest.
9. The Worker revalidates repository access and the current branch base before mutation.
10. The Worker creates a generated branch and one commit using the GitHub API.
11. The Worker reads the committed file and commit metadata back.
12. SmartFlow verifies content digest and commit identity, then emits the typed result and audit records.

## 9. Proposal Contract

The code proposal must contain:

- `repo`: canonical `owner/name`;
- `path`: normalized repository-relative POSIX path;
- `baseBranch`: the recorded default branch, never a caller-selected protected branch;
- `baseCommitSha`: the commit checked before proposal creation;
- `baseBlobSha`: the exact file blob SHA read for the proposal;
- `baseContentDigest`: SHA-256 of normalized UTF-8 content;
- `proposedContent`: bounded UTF-8 text;
- `proposedContentDigest`: SHA-256 of proposed content;
- `diff`: deterministic unified diff generated by SmartFlow;
- `operationCount`: always `1`;
- `requestId` and `stepId`.

The LLM may suggest intent and content, but it is never authoritative for repository identity, revision, diff, branch, or authorization fields. The deterministic builder and validator own those values.

## 10. Approval Boundary

Approval is required and is valid only for the exact `stepId`, `toolId`, repository, path, base blob SHA, proposed-content digest, and risk level. Approval scope is `single_step`. Approval is not execution. Closing, rejecting, rerendering, or reopening the dialog does not mutate anything.

Approval expires after **15 minutes** or when the current base blob SHA differs from the proposal, whichever comes first. Expired approval becomes non-executable and requires a fresh proposal and diff.

## 11. Execution Boundary

Code mutation must be represented by a registered write tool and executed through `runWriteTool` in `writeRuntime.ts`. The handler must be authenticated, explicitly supported, `mode: "write"`, externally effectful, approval-required, and verified. The Worker remains the only component allowed to use the GitHub installation token.

One request authorizes exactly one file mutation and one commit. No automatic retry occurs after a provider response, timeout, or uncertain outcome. A repeated `requestId` is rejected by the existing duplicate-request boundary.

## 12. GitHub Mutation Model

Mutation is GitHub-backed, not local. The Worker must:

1. authenticate the user and load the verified connection;
2. verify repository access through the installation token;
3. resolve and validate the default branch;
4. compare the current base commit/blob with the proposal;
5. create a generated branch from the current default-branch head;
6. create exactly one file commit on that branch;
7. return branch name, commit SHA, path, and bounded response metadata;
8. read the file and commit back for verification.

Branch ownership belongs to SmartFlow for the mutation operation. The generated name is deterministic from a safe request identifier, for example `smartflow/epic-08/<short-request-id>`, with length and character limits. A collision must fail closed; it must not overwrite or reuse an existing branch.

The default branch is never mutated. Direct commit is permitted only on the generated non-default branch. Pull-request creation is a later action and is not part of the MVP.

## 13. Diff and Stale-Base Model

The fetched base content is the sole diff input. SmartFlow, not the LLM and not a client-supplied patch, is the diff authority. The UI displays the exact generated diff and the file path.

Execution fails closed with `STALE_BASE` if the current file blob SHA, base commit SHA, or normalized base-content digest differs from the proposal. The system must not silently rebase, regenerate, or retry. The user must request or approve a new proposal.

## 14. Verification Model

Mutation is successful only when all checks pass:

- GitHub returns a valid branch and commit identity;
- the committed path matches the proposal;
- read-back content is valid UTF-8 and has the proposed-content digest;
- read-back file blob SHA is consistent with the committed content;
- returned commit SHA is valid and matches the mutation response;
- the resulting branch is not the default branch.

Any failed check produces `verification_failed`, even if GitHub reports a successful mutation. Verification must never claim success from an unverified provider response.

## 15. Audit Requirements

The existing in-memory `ExecutionAuditRecord` records `started` and one terminal status with sanitized metadata, request ID, step ID, tool ID, policy version, approval status, risk, and duration. Code metadata may include repository, path, branch, base SHA, commit SHA, verification status, and bounded diff statistics; it must not include secrets, tokens, raw authorization headers, or unbounded file content.

The Worker extends the existing `agent_write_log` lifecycle: insert `pending` before the GitHub mutation, then update to `executed` or `failed`. The durable row must include the user, tool, repository, path, branch, base revision, request correlation, and bounded response metadata. Raw file content and full diffs are not stored in the durable audit log.

## 16. Failure, Retry, and Rollback Rules

- Validation, policy, approval, authentication, stale-base, protected-path, size, and encoding failures occur before mutation.
- A provider error after no confirmed mutation is terminal for the request; no automatic retry is allowed.
- A timeout or network interruption after the mutation may be uncertain. The system reports failure or uncertain verification and does not repeat the commit automatically.
- If branch creation succeeds but commit creation fails, the branch is left for inspection and is recorded as a failed partial operation. SmartFlow does not silently delete it.
- If commit succeeds but verification fails, the branch and commit remain; the result is `verification_failed` and the user must inspect or request a new action.
- Rollback is a new, separately proposed and separately approved change. No automatic revert is performed.

## 17. Security Restrictions

- Only verified GitHub App installations and repositories accessible to that installation are allowed.
- No local filesystem paths, absolute paths, path traversal, URL paths, or encoded traversal are accepted.
- Paths are repository-relative POSIX paths and are normalized before validation.
- Protected paths are denied by default: `.env*`, credentials, private keys, certificates, token files, lockfile-independent secrets, `.git/**`, and repository administration files. The first implementation also denies workflow files and generated deployment configuration.
- Binary content, non-UTF-8 content, and files over **128 KiB** are rejected in the MVP.
- One file and one commit per proposal; `operationCount` must equal `1`.
- Maximum proposed content is **128 KiB** and maximum diff is **256 KiB**.
- The existing five GitHub writes per hour per user remains the shared ceiling; code writes consume the same budget as issue writes.
- Secrets never enter browser audit metadata, prompts, logs, or returned error details.

## 18. UX Requirements

The approval review must show the repository, file path, source branch, generated target branch, base revision, exact diff, operation count, risk, reversibility boundary, and expected verification. The primary action is explicit `Run`; preview and approval are separate from execution. Success must show commit identity and verification status. Failure must distinguish rejected, stale, denied, provider failure, partial mutation, and verification failure without exposing raw provider internals.

## 19. Implementation Slices

### Slice 1 - Read, Propose, Diff, and Approval Preview

- **Objective:** establish the smallest useful code-change vertical path without mutation.
- **Capability:** read one existing UTF-8 text file, build one bounded proposal, generate the exact diff, detect stale base, and render an approval-ready preview.
- **Affected systems:** GitHub Worker read routing, GitHub integration client pattern, tool definition, proposal/validation types, approval presentation, tests.
- **New types/handlers:** `github.files.read` read contract; code proposal and diff types; deterministic file validator; no mutation handler.
- **Safety boundary:** no branch, commit, or file mutation; one file; protected paths and size/encoding limits enforced.
- **Tests:** Worker route/auth/path/size/encoding tests; deterministic diff tests; stale-base tests; proposal validation tests; approval binding tests; no-mutation assertion.
- **Completion:** a real file can be fetched and displayed as an exact diff attached to a single-step approval contract, and all invalid/stale inputs fail closed.

### Slice 2 - Code Approval and Write-Runtime Contract

- **Objective:** connect the code proposal to the existing approval and write runtime without enabling provider mutation yet.
- **Capability:** code-specific approval expiry, digest binding, policy mapping, typed blocked results, and audit correlation.
- **Affected systems:** `approvalInteraction.ts`, `executionPolicy.ts`, `writeRuntime.ts`, `executionAuditTypes.ts`, approval UI.
- **New types/handlers:** code proposal target and approval-preview contract; disabled code write tool definition until handler support exists.
- **Safety boundary:** an approval cannot execute a stale, changed, expired, mismatched, or multi-file proposal.
- **Tests:** expiry, digest mismatch, stale base, step/tool/path mismatch, scope escalation, duplicate request, and no-handler denial tests.
- **Completion:** the runtime accepts and correctly blocks code-shaped requests deterministically, with no GitHub mutation.

### Slice 3 - Non-Default Branch and Single Commit Mutation

- **Objective:** execute one approved existing-file edit through GitHub.
- **Capability:** create a collision-safe generated branch and one commit containing the approved file content.
- **Affected systems:** `writeRuntime.ts`, `writeHandlers.ts`, GitHub tool registry, GitHub client, Worker routes, durable write log.
- **New types/handlers:** `github.files.update` write handler and authenticated Worker branch/content/commit route(s).
- **Safety boundary:** revalidate repository access and stale base immediately before mutation; never mutate default branch; no retry.
- **Tests:** branch naming/collision, default-branch denial, commit payload, authentication, rate limit, stale race, durable pending/executed/failed logging, partial failure.
- **Completion:** one approved proposal produces one commit on a new non-default branch or a clear terminal failure.

### Slice 4 - Read-Back Verification and Evidence

- **Objective:** prove the committed result rather than trusting the mutation response.
- **Capability:** read file and commit metadata back and compare content digest, blob identity, path, branch, and commit SHA.
- **Affected systems:** code handler result types, Worker response, `writeRuntime.ts`, audit metadata, result presenter.
- **New types/handlers:** verified code mutation result and bounded evidence shape.
- **Safety boundary:** provider success without matching evidence is `verification_failed`.
- **Tests:** successful verification, altered content, wrong path, wrong branch, missing commit identity, timeout/uncertain outcome.
- **Completion:** success is impossible without all required verification checks.

### Slice 5 - Portfolio-Quality History and Optional Pull Request Action

- **Objective:** expose completed code-change evidence and, only if separately approved, propose PR creation.
- **Capability:** readable history over existing audit evidence; optional one-branch-to-one-PR proposal.
- **Affected systems:** project workspace composition, history/evidence presentation, GitHub pull request integration if approved.
- **New types/handlers:** bounded history projection; PR write tool only if product scope is later accepted.
- **Safety boundary:** no merge, no automatic review approval, no autonomous follow-up.
- **Tests:** history filtering, redaction, evidence rendering, PR approval/branch binding if implemented.
- **Completion:** users can inspect what changed and why; PR creation remains independently gated.

## 20. Slice 1 Specification

Slice 1 is intentionally mutation-free. It should implement one real path:

1. User selects or names one connected repository and one existing text file.
2. A bounded authenticated read fetches file content, blob SHA, and current branch commit.
3. The proposal builder accepts one proposed text content and computes content digests.
4. The validator rejects path traversal, protected paths, binary/non-UTF-8 content, oversized content, and more than one target.
5. The deterministic diff generator produces the preview.
6. The proposal is attached to one existing approval interaction with exact step/tool/target/digest binding.
7. The UI displays the diff and expected effect, but `Run` returns a deliberately blocked/not-yet-supported result because Slice 1 has no mutation handler.

Slice 1 must not create a branch, commit, audit a mutation, or alter GitHub state. Its value is proving the proposal and trust boundary before any irreversible external effect exists.

## 21. Testing Strategy

Testing follows the repository's existing Vitest style and Worker unit-test patterns. Each slice requires focused unit tests for validators, policy mappings, handlers, client request construction, Worker route behavior, and audit redaction. Integration tests must use dependency-injected fetchers and synthetic GitHub responses. No test may require a real production GitHub installation or real mutation. The full existing test suite and build remain regression gates after implementation slices.

## 22. Deferred EPIC-09 Work

EPIC-09 owns autonomous chaining, multiple dependent actions, unrestricted or broader execution, background operation, multi-provider coding intelligence, broad multi-file changes, automatic retries, automatic PR/merge workflows, and any policy that acts without a fresh user approval for each external effect.

## 23. Definition of Done

- The design is implemented only through existing Planner, Approval, Write Runtime, Policy, GitHub Worker, Verification, and Audit boundaries.
- One existing text file is the only MVP mutation target.
- Every mutation has an exact diff and explicit approval.
- Default branches are never directly mutated.
- One proposal produces at most one file mutation and one commit.
- Stale proposals, expired approvals, protected paths, binary/oversized files, and uncertain outcomes fail closed.
- Read-back verification proves content and commit identity.
- Browser and durable audit records are bounded and redacted.
- No autonomous chaining, silent retry, automatic merge, or unrestricted shell execution exists.
- Focused tests and the existing regression gates pass.

## 24. Remaining Open Decisions

None. The document deliberately chooses one-file existing-file edits, GitHub-backed mutation, generated non-default branches, direct single commit without PR creation, 15-minute approval expiry, one operation per proposal, deterministic SmartFlow-owned diffs, stale-base rejection, read-back verification, no automatic retry, preserved partial branches, fresh-proposal rollback, protected-path denial, and strict text/size limits.

## References

- [`docs/product/product-direction-v1.md`](../product/product-direction-v1.md)
- [`docs/design/ux/ux-architecture-v1.md`](../design/ux/ux-architecture-v1.md)
- [`docs/design/ux/project-workspace-wireframe-spec-v1.md`](../design/ux/project-workspace-wireframe-spec-v1.md)
- [`docs/roadmap/project-workspace-implementation-roadmap-v1.md`](project-workspace-implementation-roadmap-v1.md)
- [`docs/adr/ADR-0004-write-boundaries.md`](../adr/ADR-0004-write-boundaries.md)
- `src/features/workspace/plannerEngine.ts`
- `src/features/agent/approvalInteraction.ts`
- `src/features/agent/executionPolicy.ts`
- `src/features/agent/executionEngine.ts`
- `src/features/agent/writeRuntime.ts`
- `src/features/agent/writeHandlers.ts`
- `src/features/agent/executionAudit.ts`
- `src/features/agent/executionAuditTypes.ts`
- `src/features/agent/toolRegistry.ts`
- `src/features/agent/executionTypes.ts`
- `agent/worker/github-integration.ts`
