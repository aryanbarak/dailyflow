# ADR-0005: EPIC-08 Code Write Mutation Boundary

## Status
Accepted

## Context
ADR-0004 established SmartFlow's first GitHub write pipeline (EPIC-07):
`AgentWriteToolHandler` → `writeHandlers.ts` → `writeRuntime.ts`
(`SUPPORTED_WRITE_TOOL_IDS`) → explicit approval → single execution, audited
both in-memory (`ExecutionAuditRecord`) and durably (`agent_write_log`). That
ADR permitted exactly two tools — `github.issues.comment` and
`github.issues.update` — and explicitly stated: **"EPIC-08 (Write Code)
requires a new ADR before any implementation."**

EPIC-08's design (`docs/roadmap/epic-08-write-code-design-v1.md`) was
implemented in slices. Slice 1 (read one file, build a deterministic
proposal, diff, and stale-base check) and Slice 2 (approval-binding contract:
`proposalId`, `baseBlobSha`, `baseCommitSha`, `proposedContentDigest`,
`expiresAt`; the `writeRuntime.ts` approval-risk comparison fix) introduced no
GitHub mutation capability — `github.files.update` was deliberately never
registered in the Tool Registry, `writeHandlers.ts`, or
`SUPPORTED_WRITE_TOOL_IDS`, so no new ADR was required for them.

Slice 3 introduces the first real GitHub mutation in EPIC-08: committing
changed content to one existing file. This is exactly the threshold ADR-0004
flagged. This ADR is that required decision. It does not amend, replace, or
contradict ADR-0004 — it extends the same pipeline model (propose →
validate → approve → execute once → audit) to one new, higher-risk tool, and
adds the one mechanism that pipeline did not previously need: a
server-verifiable approval record.

During Slice 3 planning, inspection found no server-side artifact anywhere
in the repository that records "this user approved this exact proposal."
`WorkspaceStepApproval` and its `codeProposalBinding` (Slice 2) exist only in
browser memory and `workspaceMemoryStorage.ts` (`window.localStorage`). No
Supabase migration defines an approvals table. For EPIC-07's two low-stakes
write tools this was an accepted gap. For a tool that commits arbitrary file
content to a repository, this ADR does not accept that gap — see Decision 7.

## Decision

### 1. Scope: the EPIC-08 code mutation boundary
This ADR authorizes exactly one new capability: `github.files.update`,
committing an approved content change to one existing text file, on one
newly created non-default branch, as one commit, using the GitHub Contents
API. It authorizes nothing else — no new-file creation, no deletion, no
multi-file changes, no pull request, no merge, no autonomous chaining, no
retry, and no rollback/undo mechanism. Pull request creation and read-back
verification evidence (design doc Slices 4–5) remain outside this ADR's
authorization and require their own decision when proposed.

### 2. Single existing text-file modification only
The mutated path must be the same repository-relative path already read by
`github.files.read` (Slice 1) and bound into the approved proposal.
`operationCount` must equal `1`, as already enforced by
`CodeFileProposal`/`codeProposalValidator.ts`. No tool in this ADR creates,
deletes, renames, or moves a file, and no tool touches more than one file
per request.

### 3. Non-default branch only
The repository's default branch is never a mutation target. This is
structural, not a runtime check layered on top of a general-purpose call:
the only branch-creation call this feature ever issues is
`POST /repos/{owner}/{repo}/git/refs` with a newly generated `refs/heads/...`
name; the code path never constructs a request that writes to
`refs/heads/<default>`. The Contents API commit call additionally asserts
its `branch` parameter is not the repository's default branch immediately
before sending it, as defense in depth.

### 4. Exactly one commit
One approved proposal produces at most one commit. The GitHub Contents API's
`PUT /repos/{owner}/{repo}/contents/{path}` performs the blob, tree, and
commit creation for that single file as one atomic provider-side operation.
SmartFlow does not construct blobs, trees, or commits manually via the
lower-level Git Data API — branch creation (Decision 3) is the one
unavoidable exception, since GitHub has no Contents-API equivalent for
creating a branch.

### 5. No automatic PR, merge, retry, rollback, or autonomy
None of these exist in this capability, and none are added by this ADR.
Every execution is exactly one attempt for exactly one approved request; a
failed or partial attempt is a terminal outcome for that request, not a
condition SmartFlow reacts to automatically (see Decision 13 and 15).

### 6. `github.files.update` risk level = high
`github.issues.comment` and `github.issues.update` are `riskLevel: "medium"`.
Committing content changes to a repository file is a stronger and less
easily reversible effect than a comment or a label edit, so
`github.files.update` is registered with `riskLevel: "high"`. Approval must
carry a risk level that is at least as high as the tool's registered risk —
`writeRuntime.ts`'s approval-risk comparison (corrected in Slice 2 from an
exact `=== "medium"` match to `compareRiskLevels(...) >= 0`) already
supports this without further change; this ADR is what puts a `"high"`-risk
tool behind it for the first time.

### 7. A server-verifiable approval artifact is required
**Browser-side approval alone is not treated as a security boundary by this
ADR**, and this ADR does not claim otherwise. A browser holding a valid
session token can call any Worker route directly, bypassing
`approvalInteraction.ts` and `writeRuntime.ts` entirely; for EPIC-07's two
tools that gap was accepted given the consequence of a comment or label
edit. For file mutation, this ADR requires the Worker itself to hold the
proof.

A new table, `agent_code_proposal_approvals`, records an approval decision
at the moment it happens, stamped by the Worker's own clock and identity
check — not by anything the browser asserts:

    columns: id, user_id, proposal_id, repo, path,
             base_blob_sha, base_commit_sha, proposed_content_digest,
             risk_level, approved_at, expires_at, consumed_at

Row-level security mirrors `agent_write_log`: only `service_role` (i.e. only
the Worker) may insert or update; `authenticated` users may `select` their
own rows.

**None of `repo`, `path`, `base_blob_sha`, `base_commit_sha`,
`proposed_content_digest`, or `risk_level` are persisted as browser-supplied
facts.** `POST /github/code-proposals/approve` accepts only `proposalId`,
`repo`, `path`, and the raw `proposedContent` text from the browser — it
does not accept `baseBlobSha`, `baseCommitSha`, `proposedContentDigest`, or
`riskLevel` as meaningful request fields at all, and ignores them if
present. Before inserting a row, the Worker itself:

1. validates `repo` and `path` (repository-identifier format, repository-
   relative path normalization, protected-path denylist — the same
   validators Decision 12 reuses for mutation);
2. verifies repository access via the installation token
   (`verifyRepositoryAccess`);
3. re-reads the current default-branch head commit and the target file
   directly from GitHub (`fetchBranchHeadCommit`, `fetchFileContent`) and
   derives `base_commit_sha` and `base_blob_sha` from that fresh read —
   never from a request field;
4. computes `proposed_content_digest` itself, from the request's raw
   `proposedContent`, using the same SHA-256 digest as
   `codeProposalBuilder.ts`'s `computeContentDigest` — never from a
   request field;
5. derives `risk_level` from `github.files.update`'s own registered
   `AgentToolDefinition.riskLevel` (`"high"`, Decision 6) — a fixed,
   Worker-side lookup, never a request field;
6. independently recomputes the proposal's content-addressed identifier
   from these five server-derived values, using the same formula as
   `computeProposalId`, and rejects with `PROPOSAL_ID_MISMATCH` if it does
   not match the client-supplied `proposalId` — corroborating the
   identifier rather than merely accepting it;
7. only then inserts the row, using exclusively the values derived in
   steps 1–6, plus `user_id`, `proposal_id`, `approved_at`, and
   `expires_at`.

If any of steps 1–4 fails (invalid path, protected path, repository not
accessible, file not found), the approval is not recorded at all — there is
no partially-recorded approval. The mutation route (Decision 10) still does
not accept `baseBlobSha`, `baseCommitSha`, or `riskLevel` as request fields
either, precisely so there is nothing for a browser-supplied value to lie
about for those fields at either endpoint.

**The Worker is the mutation trust boundary.** The browser is responsible
for UX only: presenting the diff, collecting the user's explicit "Run," and
calling the approval-recording endpoint. Every fact the mutation route acts
on is either recomputed by the Worker (content digest), looked up from the
Worker's own prior record (proposal identity, base SHAs, risk level, expiry),
or re-fetched live from GitHub (staleness, Decision 11).

### 8. Approval expiry: 15 minutes, enforced by the server's clock
`expires_at = approved_at + 15 minutes`, both computed by the Worker at
insert time. The mutation route rejects with `APPROVAL_EXPIRED` if the
Worker's own clock is past `expires_at` at consumption time. The browser's
clock and the browser-held `codeProposalBinding.expiresAt` (Slice 2) are
advisory UX only — the server value is authoritative.

### 9. Single-use approval consumption
An approval row is claimed exactly once, by an atomic conditional update
(`UPDATE ... SET consumed_at = now() WHERE id = ... AND consumed_at IS
NULL`, requiring exactly one row affected) — never by a plain read followed
by a separate write, which would leave a race window between two concurrent
requests for the same approval. This claim happens only after a pending
`agent_write_log` row already exists for the attempt (Decision 14) and only
after Decision 10 and Decision 11 have both already passed. A consumed
approval cannot be reused for a second mutation attempt, regardless of
whether that attempt then succeeds, fails cleanly, or fails partially.
Trying again after any outcome requires a new proposal and a new approval,
consistent with Decision 5's "no retry."

### 10. Server-side validation before any GitHub mutation call
Before any mutating GitHub call, the Worker validates, in this order, and
fails closed on the first violated check:

- **proposalId** — an `agent_code_proposal_approvals` row exists for this
  `(user_id, proposal_id)` and is not yet consumed
  (`APPROVAL_NOT_FOUND`).
- **repository and path** — the row's stored `repo`/`path` match the
  mutation request's (`APPROVAL_MISMATCH`).
- **proposed content digest** — the Worker recomputes the SHA-256 digest of
  the request's raw `proposedContent` and compares it to the row's stored
  `proposed_content_digest` (`CONTENT_MISMATCH`).
- **risk level** — the row's stored `risk_level` is at least the tool's
  registered minimum (`"high"`) (`RISK_INSUFFICIENT`); enforced again here
  as defense in depth even though it is also checked when the row is first
  recorded.
- **approval expiry** — the Worker's clock is not past the row's
  `expires_at` (`APPROVAL_EXPIRED`).

This phase is entirely local to SmartFlow's own data (the approval record);
it makes no GitHub call and must pass before Decision 11 begins.

### 11. Worker-side stale-base revalidation
Immediately before the mutating calls, and only after Decision 10 passes,
the Worker re-fetches the repository's current default-branch head commit
and the file's current blob SHA directly from GitHub — reusing Slice 1's
existing `fetchBranchHeadCommit` and `fetchFileContent` — and compares both
to the approval row's stored `base_commit_sha`/`base_blob_sha`. Any
mismatch fails closed with `STALE_BASE`. This check is independent of, and
strictly after, approval-binding validation: an approval can be genuine,
unexpired, and unconsumed, and still be stale because the file changed on
GitHub since it was approved. These are two different failure conditions
with two different causes and must not be collapsed into one check or one
error code.

The mutation itself is then exactly two sequential, non-atomic GitHub calls:
`POST /repos/{owner}/{repo}/git/refs` (create the branch from the
just-reverified default-branch head), then
`PUT /repos/{owner}/{repo}/contents/{path}` (create the commit on that
branch). **These two calls are not atomic with each other or with anything
else** — GitHub provides no combined "create branch and commit" operation.
The system must be designed for the second call failing after the first one
succeeds (Decision 13).

### 12. Protected paths, secrets, workflows, binary, and oversized files
No new rules are introduced. The mutation path reuses, unchanged, the exact
validation already implemented and tested in Slice 1/2: repository-relative
path normalization and traversal rejection, the protected-path denylist
(`.env*`, credentials, private keys, certificates, `.git/**`,
`.github/workflows/**`), binary/non-UTF-8 content rejection, and the 128 KiB
content size ceiling (`codeProposalValidator.ts` in the browser,
`isProtectedRepositoryPath`/`parseRepositoryRelativePath` in the Worker).
The mutation route's request-body transport limit is a separate, larger
constant sized for base64-encoded 128 KiB content plus JSON envelope
overhead — it bounds the HTTP request, not the file content, and does not
change the 128 KiB content ceiling itself.

### 13. Partial failure handling
If branch creation succeeds and the content commit then fails, the branch
is left in place — it is never automatically deleted — and the attempt is
recorded as a **failed** outcome using `agent_write_log`'s existing status
values (`'pending' → 'failed'`; no new status value and no migration change
to that table). The distinction between "nothing happened" and "a branch
exists with no commit on it" is carried in the existing free-form
`github_response` JSONB column (e.g. `{ partial: true, createdBranch,
reason }`), and in the in-memory `ExecutionAuditRecord`'s `errorCode`. A
first-class `'partial'` write-log status is a reasonable future hardening
step but is not required by, or decided by, this ADR.

### 14. Audit ordering and lifecycle
A single, strict order governs every mutation attempt, chosen specifically
so that **a consumed approval can never exist without a corresponding
pending `agent_write_log` row already on record**:

    validate approval (Decision 10)
      → stale-base revalidation (Decision 11)
      → insert pending agent_write_log row
      → atomically claim/consume the approval (Decision 9)
      → perform the GitHub mutation (branch create, then content commit)
      → update the agent_write_log row to 'executed' or 'failed'

The pending write-log row is inserted **before** the approval is consumed,
not after. This is the opposite of inserting the audit row only once a
mutation is already underway: if the approval were consumed first and the
write-log insert failed or was never reached, a single-use approval would
have been silently spent with no durable evidence it was ever attempted.
With this ordering, that state is unreachable — evidence exists before the
approval becomes unusable.

**If claiming the approval fails after the pending row was already
inserted** — either because a concurrent request already consumed the same
approval first (the conditional update affects zero rows), or because the
claim update itself errors — the Worker updates that same pending
`agent_write_log` row to `'failed'` (reusing the existing
`recordWriteFailure` handling already in place for EPIC-07) with a
distinguishing `errorCode` (`APPROVAL_ALREADY_CONSUMED` for a lost race,
`APPROVAL_CONSUMPTION_FAILED` for an infrastructure error), and makes no
GitHub call. No `agent_write_log` row is ever left permanently `'pending'`.
A lost race is not a partial mutation (Decision 13) — no branch was
created, since the mutation is never reached — and the underlying approval
is either now consumed by the other request or, on an infrastructure error
that never applied its update, still validly unconsumed and unexpired,
safely available for exactly one future attempt with no double-mutation
risk, since GitHub is only ever touched after a claim succeeds.

Two independent, already-established mechanisms are involved, in this
order relative to a mutation attempt:

1. Approval lifecycle (Decision 7–9): `recorded` → `consumed`, in
   `agent_code_proposal_approvals`.
2. Write lifecycle (unchanged from ADR-0004): `agent_write_log` row
   `'pending'` → `'executed'`/`'failed'`; `ExecutionAuditRecord` records
   `started` then one terminal status, sanitized and bounded exactly as for
   every other tool.

No mutation attempt occurs without both a pending-then-terminal
`agent_write_log` row and, once claimed, a consumed approval record;
neither mechanism replaces the other.

### 15. Rollback boundary
There is no automatic revert. Undoing an applied change is a new,
separately proposed, separately diffed, separately approved change, going
through the identical read → propose → approve → execute pipeline as any
other edit. This ADR does not introduce, and explicitly does not authorize,
any "undo" or "revert" code path.

### 16. No shell execution
All mutation happens exclusively through authenticated HTTPS calls from the
Worker to the GitHub REST API (`git/refs`, `contents`). No child process, no
shell invocation, and no local filesystem write of any kind is part of this
capability, in the Worker or anywhere else.

### 17. No EPIC-09 autonomy
This ADR authorizes exactly one user-initiated, individually approved
mutation per request. It does not authorize autonomous chaining, unattended
or scheduled execution, multi-step planning without a fresh approval per
external effect, or any broadening of scope beyond Decision 1 — all of
which remain explicitly deferred to EPIC-09, consistent with the design
doc's existing deferral (`docs/roadmap/epic-08-write-code-design-v1.md`,
"Deferred EPIC-09 Work").

## Consequences
- A new migration creating `agent_code_proposal_approvals` (Decision 7) must
  exist and be applied before `github.files.update` can be registered live;
  the Worker fails closed if that table or the insert fails, the same
  posture ADR-0004 already established for `agent_write_log`.
- `github.files.update` must not be added to `SUPPORTED_WRITE_TOOL_IDS`,
  the Tool Registry, or `writeHandlers.ts` until the approval-recording
  route, the mutation route, and the write handler all exist and are
  tested — this ADR authorizes the design, not a partially-wired
  intermediate state.
- `approvalInteraction.ts` remains a pure, synchronous function; the new
  network call that records an approval server-side is a separate,
  explicitly invoked step, not a change to that existing boundary.
- No existing tool's behavior, risk level, or audit shape changes. EPIC-07's
  two write tools and `tasks.complete` are unaffected by this ADR.
- This ADR does not authorize pull request creation, merge, automatic
  retry, or read-back verification evidence (design doc Slices 4–5); each
  remains a separate future decision.
- This ADR does not amend or supersede ADR-0004; it extends the same
  pipeline to one new, higher-risk tool and adds the one mechanism
  (Decision 7) that pipeline did not previously require.
