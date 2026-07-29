# ADR-0004: Write Boundaries for SmartFlow GitHub Integration

## Status
Accepted

## Context
All GitHub tools so far (`github.repositories.list`, `github.issues.list`,
`github.epics.list`, `github.pulls.list`, `github.workflow_runs.list`) are
read-only. EPIC-07 introduces the first GitHub write operations. Without
explicit boundaries now, EPIC-08/09 will be harder to constrain safely.

SmartFlow already has one write tool, `tasks.complete`, and a working write
pipeline for it: `AgentWriteToolHandler` → `writeHandlers.ts` →
`writeRuntime.ts` (`SUPPORTED_WRITE_TOOL_IDS`) → an explicit approval dialog
(`StepApprovalDialog.tsx` / `WorkspaceStepApproval`) → execution. EPIC-07
extends that existing pipeline to two new write tools; it does not introduce
a second, parallel write mechanism. The read-only pipeline
(`toolResolver.ts`'s `executableReadOnlyToolIds`, `readOnlyRuntime.ts`) is
structurally incapable of running a write — it hard-rejects any tool where
`mode !== "read"` or `externalEffect` is true — and stays that way.

## Decision

### Permitted write operations (EPIC-07 only)
- `github.issues.comment` — add a comment to an existing issue
- `github.issues.update` — edit title/body/labels of an existing issue

### Explicitly out of scope for EPIC-07
- Creating new issues → EPIC-08
- Any file/code/PR operations → EPIC-08

### Mandatory write pipeline
LLM proposes → validator sanitizes (toolId + params: repo, issue number,
comment body / title / body / labels) → preview shown to user in the
approval dialog (the exact comment body, or the exact title/body/label
diff) → user explicitly clicks "Run" → execute once, no automatic retry.

This reuses the existing `tasks.complete` approval flow, generalized to
carry a per-tool preview and to resolve the tool from the proposal instead
of a hardcoded id.

### Audit trail
Every write operation is logged to Supabase **from the Worker**, using the
service role, before execution:

    table: agent_write_log
    columns: id, user_id, created_at, tool_id, parameters, status, github_response

`user_id` scopes every row to the user who requested it — see RLS below.
This is a durable, cross-session log distinct from the existing in-memory
`ExecutionAuditRecord` (`executionAudit.ts`, capped at 200 records,
browser-tab-local); it does not replace that mechanism, it exists because
that one has no durability or GitHub-response detail.

### Repository and label validation
- `repo` must resolve to a repository the verified GitHub App installation
  actually has access to (checked via a live `GET /repos/{owner}/{repo}`
  call using the installation token before any mutation).
- For `github.issues.update`, any `labels` supplied must be a subset of the
  repository's actual label set (`GET /repos/{owner}/{repo}/labels`,
  fetched fresh per request — SmartFlow does not cache a label catalog).

### Hard limits (all enforced in code as of this ADR, not aspirational)
- LLM never writes directly — the deterministic validator sanitizes toolId
  and every parameter before anything reaches the Worker.
- No write executes without explicit "Run" (approval dialog, `status ===
  'approved'` required by the existing write runtime).
- No bulk writes — each tool call accepts exactly one issue/comment target.
- Rate limit: max 5 writes per hour per user, enforced in the Worker by
  counting `agent_write_log` rows for that user in the trailing hour before
  executing; the 6th attempt is rejected with `429` before any GitHub call
  is made.

## Consequences
- EPIC-08 (Write Code) requires a new ADR before any implementation.
- `agent_write_log` must exist (migration applied) before either write tool
  can go live — the Worker fails closed if the insert fails.
- The preview step is mandatory UI — cannot be skipped. It lives in the
  approval dialog (`StepApprovalDialog.tsx`), not in the read-only result
  presenter, since it previews a pending action rather than displaying a
  completed read.
- `writeResolutionForStep` / `approvalForReasoningStep` (`ChatPage.tsx`),
  previously hardcoded to `tasks.complete`, are generalized to resolve from
  the proposal's own tool id — required for any future write tool, not just
  these two.
