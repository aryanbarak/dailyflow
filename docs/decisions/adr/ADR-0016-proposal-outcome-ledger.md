# ADR-0016: Proposal Outcome Ledger

- **Status:** Proposed.
- **Date:** 2026-08-21
- **Decision Makers:** Product Owner (Aryan Barakzai) - decision; Claude Code - drafting.
- **Supersedes:** None
- **Superseded by:** None

## Context

SmartFlow keeps no record of how its own write proposals fared. It cannot
answer "of the last 100 write proposals, how many did the user approve
unchanged, reject, or never act on?" Without that record, any future
decision to loosen a write policy (e.g. lifting finance's ask-clamp,
ADR-0012) is a guess, and the planned Noticing feature's judgment layer has
nothing to learn from.

Task 39's investigation found the write path is actually two independent
systems: a legacy deterministic `/chat` path that auto-executes tasks/
calendar writes entirely server-side under a user's standing 'auto'
permission (no proposal ever shown), and an LLM-based "overlay" path that
always requires an explicit approve/reject decision (finance and GitHub
writes exclusively; tasks/calendar only when the user has set 'ask'). A
ledger instrumented on only one side would be structurally biased -- exactly
the tasks/calendar-vs-finance asymmetry task 30 already surfaced as a
production bug in a different part of this system.

### The write path, traced end to end

**System 1 -- the legacy deterministic `/chat` path**
(`agent/worker/index.ts` + `flow-write-policy.ts`): regex/pattern-based
intent extraction (`assembleTaskWriteIntent`, `assembleCalendarWriteIntent`,
`assembleFinanceWriteIntent`) runs on every chat turn. If
`resolveServerFlowWriteMode` resolves `'auto'` for the domain+action, the
Worker executes the write itself, server-side, with no proposal ever shown
to the user (`executeAutoTaskWrite` / `executeAutoCalendarWrite` /
`executeAutoFinanceWrite`, all funneling through the single shared
`respondToWriteExecution`). Tasks and calendar create/update default to
`'auto'`. This path never touches the frontend's `writeRuntime.ts` at all.

**System 2 -- the LLM-based "overlay" path** (`reasonAboutUserMessage` ->
`/agent/reason` -> `reasoningPrompt.ts`/`reasoningOrchestrator.ts` ->
`ChatPage.tsx`'s `reasoningProposal` state -> `StepApprovalDialog.tsx` /
one-click confirm card -> `approvalInteraction.ts` -> `writeRuntime.ts`'s
`runWriteTool`): always produces a `status: 'pending'` approval requiring an
explicit user decision, regardless of the domain's auto/ask setting.
Finance (hard-clamped to `'ask'`) and both GitHub write tools (no `'auto'`
concept exists for GitHub at all) always take this path; tasks/calendar
only take it when the user has overridden their permission to `'ask'`.

`resolveChatTurnOutcome` runs both lanes concurrently each turn and
suppresses the overlay proposal when the conversation lane already
auto-executed the same write, so a given turn never double-executes -- but
this confirms tasks/calendar overwhelmingly resolve through System 1
(Worker, invisible to the frontend); finance and GitHub writes exclusively
resolve through System 2 (frontend-gated). Any ledger that only instruments
one side is structurally biased before a single row is written.

### Observable terminal states

- **approved-as-proposed** -- observable (`handleConfirmAndRunWrite` or
  `StepApprovalDialog`'s Approve -> `handleRunWriteProposal`, both ->
  `runWriteTool`).
- **approved-after-user-edit** -- **not observable**. `StepApprovalDialog.tsx`
  renders a read-only preview and diagnostic rows only; there is no
  editable field anywhere in the approval UI. This state cannot occur in
  the current product.
- **rejected** -- observable (`StepApprovalDialog`'s Reject button ->
  `rejectWorkspaceStep`, no write ever attempted).
- **abandoned** -- happens, but nothing marks it today. `reasoningProposal`
  state is unconditionally overwritten by the next turn's proposal, so an
  unresolved pending proposal simply vanishes with zero event. A second,
  narrower shape also exists: `StepApprovalDialog`'s Approve button only
  sets `runStatus: 'approved'` -- actually running the write is a separate
  `handleRunWriteProposal` call, so a user can approve via the dialog and
  never click Run. Both shapes need deliberate future instrumentation;
  there is no free signal to hook today -- see Decision item 8 for the
  options considered and the PO's call.

Auto-executed writes have no reject/abandon concept at all -- by
definition, `'auto'` mode means the user's standing permission *is* the
authorization; the only terminal states there are `executed` / `failed`
(already visible in `respondToWriteExecution`'s `execution.status`).

## Decision

1. Add `public.agent_proposal_outcomes`, written only by the Worker via
   `service_role`, readable by its owning user only (RLS `auth.uid() =
   user_id`) -- the same trust model already established by
   `agent_write_log` (EPIC-07) and `agent_code_proposal_approvals`
   (EPIC-08).
2. Record the proposal's SHAPE, not its content: intent type, tool id,
   domain, which of the two write systems produced it (`write_mode`:
   auto/ask), the outcome (auto_executed/approved/rejected), the tool's
   risk level, whether the underlying write succeeded, and which target
   fields were populated (field NAMES only, never values). No proposal
   target VALUES (amounts, IBANs, titles, comment bodies, repo/issue
   identifiers) and no message text are stored. `target_fields` is a plain
   `text[]` with no database CHECK against a known vocabulary -- see item 6.
3. Both write systems record through the same Worker-side function, so
   neither can produce an outcome invisible to the other: the auto-execute
   path (`respondToWriteExecution`, the single shared choke point for
   tasks/calendar/finance auto-writes) calls it in-process; the ask-lane
   path (frontend `approvalInteraction.ts`/`writeRuntime.ts`) reports
   through a new authenticated Worker endpoint that calls the identical
   function -- see item 7 for the named mechanism. Neither the auto-write
   path nor the ask-lane path can produce a write outcome the ledger's
   recording function doesn't see, because both are required to go through
   it -- there is no third path that mutates tasks/calendar/finance/github
   data today.
4. **Retention: keep indefinitely** (PO decision, task 39). Matches
   `agent_write_log`'s existing behavior (no cleanup mechanism today).
   Revisitable once real row volume exists to reason about; not blocking
   this ADR.
5. `approved-after-user-edit` is deliberately excluded from the `outcome`
   CHECK constraint: no UI in this codebase currently allows editing a
   proposal before approving it, so the state cannot occur. If edit
   capability ships later, this constraint gets widened then -- the same
   discipline `flow_write_undo_records.kind` already uses (see migrations
   `20260815000000`, `20260817000000`) rather than reserving a dead enum
   value now.
6. **Recording principle: fire-and-forget, never a write-blocking step**
   (task 39-amend). Recording an outcome must NEVER block, delay past a
   negligible margin, or fail the user's actual write. The ledger insert is
   not part of any write's transaction and is not on its success path --
   it happens after the write's own outcome is already final, is not
   awaited by anything the user is waiting on, and its own failure is only
   ever logged, never surfaced as a write failure or retried in a way that
   could delay the next turn. A user's task, event, comment, or transaction
   must be exactly as reliable after this ADR as before it. This is also
   why `target_fields` (item 2) has no database CHECK: a rejected insert
   because of an unrecognized field name would be a ledger concern
   overriding this principle, which is backwards -- see the migration
   file's own header comment for the fuller reasoning (this doubles as
   ADR-0013's registry-duplication lesson: a hand-maintained vocabulary
   belongs in code the registry can reach, not in a database constraint no
   test can guard).
7. **Named mechanism for the ask-lane's frontend recording:** a new Worker
   HTTP endpoint, `POST /agent/proposal-outcome`, authenticated the same
   way `/chat` and `/agent/reason` already are (`Authorization: Bearer
   <supabase access token>`). The frontend calls it once per ask-lane
   proposal outcome -- after `rejectWorkspaceStep` resolves, and after
   `runWriteTool` resolves following an approval -- passing only the
   shape-only fields it already has in hand (intent type, tool id, domain,
   outcome, risk level, target field names, and whether the write
   succeeded). `user_id` is never trusted from the request body -- the
   Worker derives it from the authenticated token, the same convention
   every other endpoint in this codebase already follows. The endpoint
   validates and forwards to the identical internal recording function
   `respondToWriteExecution` calls in-process for the auto-write path, so
   there is exactly one function that ever writes a row, regardless of
   which system observed the outcome. Per item 6, the frontend's call to
   this endpoint is fire-and-forget from the caller's perspective too --
   the write has already completed (or already been rejected) by the time
   this call is made, so nothing about the user's write waits on it.
8. **Abandoned detection: no complete mechanism exists, so 'abandoned' is
   dropped from v1's `outcome` values** (task 39-amend, PO decision). Task
   39's own investigation found the only reliable, always-fires hook is one
   specific case: `ChatPage.tsx`'s `reasoningProposal` state is
   unconditionally overwritten by the next turn's proposal
   (`setReasoningProposal(outcome.reasoningStates)`), so a proposal still
   `'pending'` (or approved-but-not-yet-run -- see the Context section's
   second abandonment shape) at that instant could be detected and recorded
   as abandoned right before being overwritten. That hook does NOT catch a
   closed tab, a backgrounded app, or the user navigating to a different
   in-app route without sending another message -- there is no server-side
   residue today for the Worker to reconcile against (no "a proposal was
   shown" event is ever recorded), so those cases are invisible with no
   clean fix available in this slice. Three options were presented to the
   PO: (a) drop `'abandoned'` from v1 entirely; (b) keep it, populated only
   by the one clean hook, explicitly documented as a lower bound rather
   than a true count; (c) build full detection (a `'shown'` event plus
   Worker-side periodic reconciliation marking stale un-decided proposals
   abandoned after a timeout) as its own follow-up task. **The PO chose
   (a)** -- v1's `outcome` CHECK constraint is `('auto_executed', 'approved',
   'rejected')` only. This can be widened later (same discipline as items 5
   and this ADR's ENUM-vs-CHECK reasoning) once a real detection mechanism
   exists, rather than shipping a column a reader cannot tell is
   under-counting.

## What This ADR Deliberately Does NOT Do

- **Grants no new write authority.** No policy, permission default, or
  approval requirement changes. Every write still requires exactly the
  same authorization it required before this ADR.
- **Changes no user-visible behavior.** The user sees nothing new; no UI
  reads from this table yet.
- **Does not implement the recording logic.** This ADR and its
  accompanying migration are design and schema only. The Worker-side
  recording function and its call sites (both the in-process auto-write
  hook and the new frontend-facing endpoint) are explicitly out of scope
  for task 39 and land in a follow-up.
- **Does not build Noticing.** This ledger is a prerequisite Noticing can
  later read; it is not Noticing itself, and nothing here commits to
  Noticing's design.

## Alternatives Considered

**Instrument only the frontend (`writeRuntime.ts`).** Rejected: this would
silently miss every auto-mode task/calendar write, which is the majority of
task/calendar writes today (auto is the default for both). This is exactly
the kind of one-sided instrumentation that produced task 30's bug in a
different subsystem -- present here again if not deliberately avoided.

**Instrument only the Worker's auto-write path.** Rejected: this would miss
every ask-lane outcome entirely -- finance and GitHub writes, which are
100% ask-lane, would never appear in the ledger at all, making it useless
for exactly the "should we loosen finance's clamp" question the Context
section poses.

**Store the full proposal target payload for richer future analysis.**
Rejected per this task's explicit instruction to default to shape over
values. A financial amount, an IBAN, a task title, or a GitHub comment body
are all personal data with no analytical need to be duplicated into a
long-lived ledger when their presence/absence (not their content) is what
a policy-loosening decision actually needs.

**Use a native Postgres ENUM type for `outcome`/`domain`/etc.** Rejected in
favor of `text` + CHECK constraint, matching every other constrained-value
column already in this codebase (`agent_write_log.status`,
`flow_write_undo_records.kind`, `agent_code_proposal_approvals.risk_level`).
This codebase has already hit ENUM's poor extensibility pain once (the two
`widen_flow_write_undo_kinds` migrations); CHECK constraints widen with a
plain `alter table ... drop constraint / add constraint`.

**Roll up to monthly aggregates after N months (retention option 3).**
Considered and not chosen for now: preserves long-term trend signal while
minimizing how long individual-decision data persists, but requires a
second table and a cron job neither this ADR nor task 39 builds. Revisit
if/when indefinite retention's row volume becomes a real cost.

**Constrain `target_fields` to a known field-name vocabulary via a database
CHECK constraint.** This was actually shipped in an earlier draft of the
migration and reverted (task 39-amend). Rejected on reconsideration: a
CHECK constraint enumerating field names is itself a hand-maintained copy
of "what fields exist," living in the one place (the database) no
typecheck or registry-loop test can ever guard -- precisely the failure
class ADR-0013's five slices already spent effort eliminating from this
same write system. Concretely, it would mean a new write domain's field
names are *rejected by the database* the moment application code starts
sending them, until someone remembers to also alter this constraint --
adding back exactly the kind of synchronized-edit-across-N-places risk
ADR-0013 exists to prevent. The column stays a plain `text[]`; any
validation against `shared/writeIntentRegistry.ts`'s vocabulary belongs in
the Worker's recording code (item 6), where a loop test can guard it.

**Build full 'abandoned' detection now (a `'shown'` event plus periodic
Worker-side reconciliation).** Considered as option (c) in Decision item 8.
Rejected for this slice, not permanently: it would give accurate
abandonment tracking (including tab-close/navigate-away, which the one
clean in-app hook cannot see), but requires recording a new "proposal was
shown" event on every overlay-lane proposal (not just decided ones) plus a
timeout-based sweep, which is meaningfully more scope than this
foundational ledger slice, and really its own follow-up task with its own
design questions (what timeout, does a sweep run as a cron or lazily on
next read, etc.).

## Consequences

- One new table, additive only -- no existing table or RLS policy changes.
- The Worker gains one new authenticated endpoint, `POST
  /agent/proposal-outcome` (a follow-up task, not this one) that the
  frontend calls once per ask-lane proposal outcome, fire-and-forget.
- Any future write-domain addition to `shared/writeIntentRegistry.ts` must
  also widen `agent_proposal_outcomes`'s `domain` CHECK constraint --
  `target_fields` needs no schema change (it is intentionally
  unconstrained, item 6), so a new domain's field names need only be added
  to the Worker's own recording-code validation, not to this migration.
- `outcome` ships as `('auto_executed', 'approved', 'rejected')` only --
  `'abandoned'` is absent from v1 by explicit PO decision (item 8) and
  requires a follow-up (either the partial hook or full detection,
  Alternatives Considered) plus a widened CHECK constraint before it can be
  added.
- No behavior, no authority, no user-visible surface changes as a result
  of this ADR landing on its own. The recording mechanism itself (item 6's
  fire-and-forget principle) is designed so that even once implemented, a
  ledger-write failure can never become a user-visible write failure.
- Retention is indefinite by explicit PO decision; no cleanup job exists
  and none is implied by this ADR.

## Related ADRs

- [ADR-0004: Write Boundaries for SmartFlow GitHub Integration](ADR-0004-write-boundaries.md)
- [ADR-0005: Code-Write Mutation Boundary](ADR-0005-code-write-mutation-boundary.md)
- [ADR-0012: Write Capability Layer v1](ADR-0012-write-capability-layer.md)
- [ADR-0013: Write Intent Registry v2](ADR-0013-write-intent-registry-v2.md)
