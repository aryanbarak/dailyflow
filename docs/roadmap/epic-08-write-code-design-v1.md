# EPIC-08 — Write Code — Product and Technical Design v1

**Version:** 1.0
**Status:** Draft — for Product Owner and Architecture review
**Date:** 2026-07-28
**Derives from:**
[`docs/product/product-direction-v1.md`](../product/product-direction-v1.md) (v1.1,
Approved),
[`docs/design/ux/ux-architecture-v1.md`](../design/ux/ux-architecture-v1.md) (v1.1,
Draft),
[`docs/design/ux/project-workspace-wireframe-spec-v1.md`](../design/ux/project-workspace-wireframe-spec-v1.md)
(v1.1, Draft),
[`docs/design/ux/project-workspace-low-fidelity-wireframes-v1.md`](../design/ux/project-workspace-low-fidelity-wireframes-v1.md)
(v1.0, Draft),
[`docs/roadmap/project-workspace-implementation-roadmap-v1.md`](project-workspace-implementation-roadmap-v1.md)
(v1.0, Draft), and
[`docs/adr/ADR-0004-write-boundaries.md`](../adr/ADR-0004-write-boundaries.md) (Accepted)
**Scope:** Product and technical scope definition for EPIC-08 (Write Code) only. Does not
implement anything, does not modify code, schema, routes, or components, and does not
itself constitute the new ADR that [ADR-0004](../adr/ADR-0004-write-boundaries.md) and
[Product Direction §13](../product/product-direction-v1.md) require before any EPIC-08
implementation may begin. This document is the design work that ADR is expected to draw
on.

---

## 1. Purpose

Product Direction §13 declared EPIC-08 ("Write Code") frozen and in need of re-scoping:
its prior framing — new issues, file/code/PR operations, scoped to GitHub in isolation —
is superseded. EPIC-08's capabilities now belong inside the Software Project's **Act**
step (Observe → Understand → Act → Verify), scoped against that project's own approval
and verification model, rather than as a freestanding GitHub write expansion. It stays
frozen until re-scoped this way, and ADR-0004 already states that EPIC-08 "requires a new
ADR before any implementation."

This document performs that re-scoping at the product and technical-design level. It
answers what EPIC-08 is for, what capabilities it should and should not include, how it
uses the Project Workspace's existing Observe/Reason/Proposal/Approval/Execution/
Verification shape, and how it plugs into systems that already exist — Planner, Approval,
Execution, Execution Audit, Workspace, GitHub, Assistant — without redesigning any of
them. It does not decide implementation order, schema, or UI; that is later work, gated
on the ADR this document is intended to inform.

The goal, stated plainly: transform SmartFlow from a project assistant that can only
*read* a repository and make narrow, GitHub-metadata writes (EPIC-07, per ADR-0004) into
one that can propose and — after explicit approval — make actual code changes, under the
same trust boundaries already proven for tasks and GitHub writes.

---

## 2. Goals

- Extend the Act step of Observe → Understand → Act → Verify (Product Direction §6;
  UX Architecture §12; Wireframe Spec §11) to cover real file and code changes, not only
  issue comments and metadata edits.
- Close the gap Product Direction §5 names directly: "Acting on a recommendation (comment,
  update, eventually code/PR changes) requires trusting that the action is safe,
  reviewable, and reversible" — for the code/PR case specifically.
- Reuse the write pipeline ADR-0004 already established and validated for EPIC-07
  (LLM proposes → deterministic validator sanitizes → preview → explicit approval →
  single execution → durable audit) rather than inventing a second write mechanism.
- Give the user a way to go from "Flow AI, make this change" to a real, reviewed,
  approved, auditable code change without leaving SmartFlow for the mechanical part of
  authoring a diff and opening a pull request.
- Keep every new capability inside the existing safety architecture — Tool Registry,
  Execution Policy, Approval Model, Execution Engine, Execution Audit (Product Direction
  §9, §12) — as new tool definitions and new compositions, not new engines.

---

## 3. Non-goals

- **Not a redesign of Approval.** `approvalInteraction.ts` / `StepApprovalDialog.tsx`'s
  proposal → validate → preview → approve → execute sequence is reused as-is, only
  extended to carry code-shaped previews (diffs) instead of, or alongside, text previews.
- **Not a redesign of Execution.** `executionEngine.ts`, `executionPolicy.ts`,
  `writeRuntime.ts` are reused as-is; EPIC-08 adds tool IDs to
  `SUPPORTED_WRITE_TOOL_IDS`, it does not change how execution is dispatched or audited.
- **Not autonomy.** Every write remains explicitly user-approved, single-action,
  single-approval, no automatic retry, no chaining — identical in kind to ADR-0004's
  existing hard limits. EPIC-09 (Agent Autonomy), whatever it eventually authorizes, must
  still operate inside these same boundaries (Product Direction §13) — nothing in this
  document brings any part of that forward.
- **Not an IDE replacement.** SmartFlow does not become a general-purpose code editor; it
  proposes bounded, reviewable changes, not open-ended editing sessions (Product Direction
  §14).
- **Not a GitHub replacement.** Merge decisions, code review, branch protection
  configuration, and CI/CD remain GitHub's own responsibility; SmartFlow proposes changes
  *to* GitHub, it does not replace GitHub's own tooling (Product Direction §14).
- **Not the ADR.** This document is design input. ADR-0004's requirement for a new,
  dedicated ADR before any EPIC-08 implementation still stands; nothing here authorizes
  writing code.
- **Not a decision to build all of §5's candidate capabilities.** Each is evaluated on
  its own merits below — inclusion in the candidate list is not inclusion in scope.

---

## 4. User Problems Solved

1. **The Act step stops short of the work that actually matters for a Software Project.**
   EPIC-07 lets Flow AI comment on or update an issue; it cannot yet act on the thing the
   issue is usually about — a code change. The user still has to leave SmartFlow, open an
   editor, and do the mechanical part themselves even after Flow AI has correctly
   understood what needs to change.
2. **Small, well-understood changes carry disproportionate context-switching cost.** A
   one-line fix, a config update, or a small new file often does not need a full IDE
   session — it needs a proposal the user can read, trust, and approve in place, the same
   way they already do for an issue comment.
3. **"Eventually code/PR changes" (Product Direction §5) is currently unmet.** The product
   direction names this as one of the four core user problems Projects exists to solve;
   EPIC-08 is the increment that actually closes it, rather than leaving it permanently
   aspirational.
4. **Trust in an AI-authored change is currently all-or-nothing outside SmartFlow.** A
   user asking any general-purpose coding assistant to "just make the change" typically
   gets either a diff they must manually apply themselves, or a tool that pushes without a
   reviewable, audited approval step. EPIC-08's contribution is not "AI writes code" —
   that already exists elsewhere — it is doing so inside SmartFlow's already-proven
   observe/propose/approve/execute/verify boundary, with a durable audit trail
   (`agent_write_log`) tied to the same project the change concerns.

---

## 5. Product Capabilities

Each candidate the roadmap named is evaluated independently — none are assumed final.
Verdicts use three outcomes: **In scope** (EPIC-08 should build this), **Reframed** (the
underlying need is in scope, but not in the form named), or **Deferred to EPIC-09** (out
of EPIC-08; requires the bounded-autonomy work Product Direction §13/§16 has not yet
scoped).

### 5.1 Create files
**Verdict: In scope.** A new file (a config file, a small module, a doc file) is a bounded,
single-target change with a natural preview: the full proposed file content. This is the
most straightforward extension of the existing write pattern — closest in shape to
`github.issues.update`'s "propose new content for a known target," except the target does
not yet exist.

### 5.2 Edit files
**Verdict: In scope.** The central capability. An edit to an existing file has a natural,
already-familiar preview format (a unified diff) and a natural verification check (re-read
the file after execution and confirm it matches what was previewed). This is the
capability that closes User Problem 1.

### 5.3 Rename
**Verdict: Reframed — modeled as a move, not a separate capability.** A rename is a move
where the new path is in the same directory. Building it as a distinct capability from
Move would duplicate validation and preview logic for no product benefit; both are one
tool (§5.4) parameterized by old and new path.

### 5.4 Move
**Verdict: In scope, as the same tool as Rename.** Preview shows old path → new path
explicitly (Wireframe Spec §12's "Expected effect" requirement is a direct fit: a path
diff is exactly as previewable as a content diff). Content is not required to change for a
move to be valid, but if the proposal also edits content, that must be shown as a separate,
explicit diff — never folded silently into "moved."

### 5.5 Delete
**Verdict: In scope, but as its own, higher-scrutiny capability — not folded into Edit.**
Deletion is the one candidate capability whose reversibility is qualitatively different
from the others: an edit or create is trivially reversible by a follow-up proposal, but a
delete removes content the user may not be able to accurately reconstruct from memory.
Two things follow, both binding on the approval and safety models below (§8, §9):
- The approval preview must show the full current file content being removed, not just
  its path — the user is approving the loss of that specific content, not a label.
- Risk/reversibility (Wireframe Spec §12) must state plainly that reversibility depends on
  git history existing for the file (true for any tracked file with prior commits, not
  guaranteed for a file created and deleted within the same session before any commit
  lands).

### 5.6 Multi-file changes
**Verdict: Deferred to EPIC-09, with a bounded exception.** ADR-0004's hard limit — "no
bulk writes — each tool call accepts exactly one issue/comment target" — is a direct,
intentional constraint on blast radius, and it generalizes directly to code: a single
approval must not be able to authorize changes across many files at once, since that
collapses "review this specific change" into "review this basket of changes," which is
exactly the batching Wireframe Spec §12 rules out for approvals in general ("independence
between proposals... never as a batch"). EPIC-08 therefore keeps the existing one-target
rule: **one file per proposal, one proposal per approval.**

The bounded exception: a single logical change that inherently touches more than one file
(e.g., a rename that also requires updating an import elsewhere) is common enough that
requiring the user to separately discover and approve every downstream file is worse for
trust, not better — the user cannot evaluate a rename's safety without seeing what
references it. This document does not resolve that tension; it is named as an **open
product decision** for the ADR to settle, with two candidate resolutions to choose
between, not decide here: (a) keep strict one-file-per-proposal and accept that
multi-file-coupled changes must be proposed as separate, sequential, individually-approved
steps; or (b) allow a proposal to name a small, explicit, bounded set of files (not an
open-ended count) with every file's diff shown in full, still as a single audited unit.
True open-ended, unbounded multi-file changes remain out of scope regardless of which way
this resolves.

### 5.7 Diff preview
**Verdict: In scope — this is the mandatory preview mechanism for Edit, Move, and Delete.**
Directly required by ADR-0004 ("preview shown to user in the approval dialog... the exact
title/body/label diff") and Wireframe Spec §12 ("Expected effect... shown as a preview
where the content allows it"). Not a separate capability from Edit/Create/Move/Delete — it
is how each of those satisfies the existing mandatory-preview requirement.

### 5.8 Patch preview
**Verdict: Reframed — folded into Diff preview.** A "patch" (a applyable diff artifact) and
a "diff preview" (a human-reviewable rendering of the same change) are the same underlying
data shown two ways. EPIC-08 needs exactly one preview mechanism, not two; keeping the
patch as an internal execution detail (what actually gets applied) while the diff is what
the user reviews avoids introducing a second, parallel preview concept.

### 5.9 Commit proposal
**Verdict: In scope, reframed as a branch + commit + pull request proposal — never a
direct commit to the project's default/protected branch.** ADR-0004 explicitly named "any
file/code/PR operations" as EPIC-08 territory and out of EPIC-07 scope; this is where that
territory is defined. A "commit proposal" is not free-standing — SmartFlow does not
directly commit to a branch a human is also working on. Execution instead: create a new
branch scoped to this change, commit the approved diff to it, and open a pull request via
GitHub's existing API (reusing the same verified installation-token flow EPIC-06/07
already validated). The user reviews and approves *this*, not a raw git operation; GitHub's
own review/merge process remains authoritative over whether the change ultimately lands.
This is consistent with Product Direction §14: SmartFlow is not a GitHub replacement, and
does not perform merges.

### 5.10 Rollback proposal
**Verdict: Reframed — not a distinct capability; rollback is a fresh proposal like any
other.** ADR-0004 already establishes that retry after failure "requires a fresh proposal
and a fresh approval — never an automatic retry." The same principle extends cleanly to
undoing a completed change: proposing a revert is exactly a new Edit/Delete/PR proposal
targeting the same file(s), reviewed and approved the same way as any other change, not a
privileged or automatic capability. A "rollback" button that skipped proposal/approval
would itself be a second write mechanism, which is exactly what EPIC-08 must not
introduce. No dedicated rollback tool is built; the existing proposal path already covers
it.

### 5.11 Capability summary

| Capability | Verdict |
|---|---|
| Create files | In scope |
| Edit files | In scope |
| Rename | In scope, as Move |
| Move | In scope |
| Delete | In scope, higher scrutiny |
| Multi-file changes | Deferred to EPIC-09, one open exception for the ADR to decide |
| Diff preview | In scope — the mandatory preview mechanism |
| Patch preview | Folded into Diff preview |
| Commit proposal | In scope, reframed as branch + commit + PR, never direct-to-protected-branch |
| Rollback proposal | Reframed — an ordinary fresh proposal, no dedicated tool |

---

## 6. User Workflow

```
Observe
  ↓
Reason
  ↓
Proposal
  ↓
Approval
  ↓
Execution
  ↓
Verification
```

- **Observe.** Flow AI (or the user) looks at already-validated project state: repository
  content, issues, roadmap position, recent activity — the same Observe step already
  defined for the Project Workspace (Wireframe Spec §11). Nothing about EPIC-08 changes
  what Observe means; a code change proposal must still be grounded in real, current
  repository state, not assumed content.
- **Reason.** Flow AI synthesizes what a change should be and why, traceable back to
  Evidence (Wireframe Spec §14) exactly as Understand already requires for any
  recommendation. For EPIC-08 specifically, "reasoning" additionally includes reading the
  actual current file content being changed — a proposal cannot be generated against
  stale or assumed file state.
- **Proposal.** Flow AI produces a specific, named action with a deterministic-validator-
  sanitized target (repository, path, and the exact diff or new content) — never raw,
  unvalidated LLM output reaching the Worker, identical in kind to ADR-0004's existing
  validator step for GitHub writes.
- **Approval.** The user reviews the proposal in full per §9 below and explicitly
  approves, rejects, defers, or cancels it — one proposal at a time, never batched
  (Wireframe Spec §12).
- **Execution.** A single, audited execution: create branch → commit → open PR (§5.9), or
  the equivalent single-file operation. No automatic retry (§12 below).
  **Note on scope naming:** "Execution" here is the same concept the Wireframe
  Specification and Execution Engine already use elsewhere in the Workspace — this
  section's structure (Observe/Reason/Proposal/Approval/Execution/Verification) is
  EPIC-08's own naming for how that same underlying Observe → Understand → Act → Verify
  loop applies specifically to a code-change proposal; it is not a second, competing
  workflow model.
- **Verification.** The PR's actual state is re-read via a read tool and compared against
  what was previewed at Approval, closing the loop back to Observe (§11 below).

---

## 7. Relationship to Existing Systems

- **Planner.** `plannerEngine.ts`/`priorityEngine.ts`/`goalEngine.ts` are unchanged.
  EPIC-08 gives the planner a new *kind* of candidate next-step to surface (a code change
  worth proposing), not a new engine. Whether a code-change candidate becomes a project's
  Current Focus follows the same singular, explainable selection already defined
  (Wireframe Spec §8) — EPIC-08 does not grant code proposals any priority precedence
  over other candidates.
- **Approval.** `approvalInteraction.ts` and `StepApprovalDialog.tsx` are reused unchanged
  in mechanism. EPIC-08's only requirement on Approval is presentational: the dialog must
  be able to render a diff (or new-file content, or a path change) as its preview, the way
  it already renders a comment body or a title/label diff for EPIC-07's tools — the same
  generalization ADR-0004 already made explicit ("generalized to carry a per-tool
  preview").
- **Execution.** `executionEngine.ts`, `executionPolicy.ts`, and `writeRuntime.ts`'s
  `SUPPORTED_WRITE_TOOL_IDS` allowlist are reused unchanged in mechanism. EPIC-08 adds new
  tool IDs to that allowlist (e.g., a file-write tool and a pull-request-creation tool);
  it does not add a second dispatch path.
- **Execution Audit.** Both existing layers — the in-memory, browser-tab-local
  `executionAudit.ts` and the durable, Supabase-backed `agent_write_log` — are reused, not
  replaced. `agent_write_log`'s existing columns (`tool_id`, `parameters`,
  `github_response`) already generalize to a file-write or PR-creation tool call without
  schema redesign in principle; whether new columns are needed for diff storage is an
  implementation-level question for the ADR/engineering task that follows this document,
  not decided here.
- **Workspace.** The Project Workspace consumes EPIC-08 exactly as it already consumes
  EPIC-07's write tools: a code-change proposal appears in Approval Review (Wireframe
  Spec §12), its outcome in Execution Result (§13), and its confirmation in Evidence &
  Verification (§14) — no new screen is required (§13 of this document confirms this).
- **GitHub.** EPIC-08 extends the existing, already-verified GitHub App installation
  flow — the same installation token used for the four read tools and two EPIC-07 write
  tools — with new capability scopes (contents write, pull request creation). It does not
  introduce a second GitHub connection or authentication path.
- **Assistant.** Per UX Architecture §10, Assistant "earns trust by being verifiably
  correct about what it observed and honest about what it cannot yet do (e.g., code/PR
  changes, per EPIC-08's frozen status)." Once EPIC-08 is unfrozen (post-ADR), that
  specific honesty boundary changes for code/PR proposals — Assistant may now propose
  them — but every other boundary in UX Architecture §10 (no execution without approval,
  no implied completion, no chaining, no cross-project data) is unchanged and binding on
  EPIC-08 exactly as on every other write tool.

---

## 8. Safety Model

### What is allowed

- Proposing a single-file create, edit, move/rename, or delete, or a single bounded
  create-branch-commit-PR sequence representing one such change (§5.6's open exception
  aside), always with a deterministic-validator-sanitized target and content.
- Opening a pull request against the connected repository via the existing verified
  installation.
- Re-reading the repository (via existing or extended read tools) to verify an executed
  change, before and after execution.

### What is never allowed

- **No direct write to a protected/default branch.** Every code change lands via a new
  branch and a pull request; SmartFlow never commits directly to `main` (or whatever
  branch the repository's default is), regardless of user role or approval — this is a
  hard limit, not a configurable option, mirroring ADR-0004's own posture that hard limits
  are "enforced in code... not aspirational."
- **No merge.** SmartFlow opens pull requests; it does not merge them. Merge remains a
  GitHub-native decision, consistent with Product Direction §14 ("not a GitHub
  replacement").
- **No force-push, no branch deletion, no repository-level operations** (settings,
  webhooks, collaborators, branch protection rules).
- **No arbitrary code execution.** SmartFlow proposes and writes file content; it does not
  run build tooling, tests, or scripts as part of executing a proposal. (Whether a proposal
  can be *informed* by CI results already visible via `github.workflow_runs.list` is an
  Observe-step question, not an Execution-step capability — this stays a read, not a new
  write.)
- **No bulk writes beyond §5.6's single bounded exception**, which itself remains an open
  decision for the ADR, not a default allowance.
- **No LLM-authored writes reaching the Worker unvalidated.** The deterministic validator
  sanitizes every parameter — repository, branch name, file path(s), diff/content — before
  anything executes, identical in principle to ADR-0004's existing validator step.
- **No silent side effects.** Opening a PR is very likely to trigger the repository's own
  CI. This must be disclosed as part of "Execution scope" in the approval preview
  (Wireframe Spec §12: "what this action... cannot do"), not left implicit.
- **No path traversal or out-of-repository writes.** The validator must confirm every
  proposed path resolves inside the target repository's own tree before execution — this
  is the code-write analogue of ADR-0004's existing repository/label validation against
  the live GitHub state.
- **No writing to files outside the user's own connected, permission-verified
  repository**, mirroring ADR-0004's existing installation-access check
  (`GET /repos/{owner}/{repo}` before any mutation).

---

## 9. Approval Model

### What requires approval

Every code-write action, without exception: every create, edit, move/rename, delete, and
every branch-commit-PR sequence. There is no "trivial change" exemption — a one-character
edit requires the same explicit approval as a new file, consistent with Wireframe Spec
§12's "before a user may approve any single action, without exception."

The full required-before-approval content, applying Wireframe Spec §12 to a code change
specifically:

- **Proposed action** — in plain terms ("create a new file at `src/x.ts`," "edit
  `README.md`," "open a pull request titled …"), never a raw tool identifier.
- **Target** — the exact file path(s) and repository.
- **Reason** — the evidence this was proposed from (§7's Planner relationship).
- **Expected effect** — the full diff (or full new-file content, or old-path → new-path),
  never truncated or summarized in place of the real content.
- **Execution scope** — explicitly states this creates a branch and opens a PR; it does
  not merge, does not push to the default branch, and may trigger the repository's CI.
- **Approval status** — pending/approved/rejected/deferred/cancelled, per proposal.
- **Risk or reversibility** — stated per §5.5 for deletes specifically; for create/edit/
  move, reversibility is "propose a follow-up change" (§5.10), stated plainly rather than
  implied.

### Can approvals be grouped?

**No.** This is not a new decision — it is ADR-0004's existing hard limit ("no bulk
writes... each tool call accepts exactly one issue/comment target") and Wireframe Spec
§12's existing rule ("no action here decides more than one proposal at once") applied to
code. A user approving five file edits must make five explicit approval decisions, each
individually reviewable, exactly as they would for five separate GitHub issue updates
today. §5.6 names the one place this document leaves open — a single proposal spanning a
small, explicit, bounded set of files for one logically-coupled change — but even that
resolution, if adopted, is still one proposal with one approval, not multiple proposals
approved together.

### Can they expire?

**Open decision, with a specific safety requirement that holds regardless of how it is
resolved.** No existing write tool (EPIC-07 or `tasks.complete`) currently expires a
pending proposal — Wireframe Spec §12 defines Defer as "remains pending and visible... until
it is approved, rejected, or cancelled," with no time-based expiry. EPIC-08 could
reasonably inherit that as-is.

However, code proposals have a failure mode text-metadata proposals do not: **the target
file can change between when a diff was proposed and when the user approves it** — a
second commit could land on the same file in the interim (from the user directly, from
another tool, or from another approved SmartFlow proposal). Two resolutions are available
to the ADR; this document does not choose between them, but states the requirement either
must satisfy: **execution must never apply a diff to a file whose current content no
longer matches what was diffed at proposal time.** Concretely, that means either (a) the
validator re-reads the target file immediately before execution and fails closed —
rejecting execution and requiring a fresh proposal — if the content has drifted, or (b)
proposals are treated as expiring the moment the underlying file changes, surfaced to the
user as "this proposal is stale, a fresh one is needed" rather than silently executed
against outdated content. Either way, this extends ADR-0004's existing "no automatic
retry" principle to "no stale execution" — an execution proceeding against content the
user never actually saw would be a real approval-boundary violation, not a cosmetic one.

---

## 10. Execution Model

Execution reuses the existing single-action, single-approval dispatch (`writeRuntime.ts`,
`executionEngine.ts`) with new tool IDs added to `SUPPORTED_WRITE_TOOL_IDS`:

1. On explicit approval (`status === 'approved'`, identical gate to every existing write
   tool), the Worker re-validates the target and, per §9's freshness requirement, the
   current file content.
2. The Worker creates a new branch scoped to this change (naming convention is an
   implementation detail, not decided here).
3. The Worker commits the approved diff/content/path-change to that branch using the
   existing verified installation token.
4. The Worker opens a pull request against the repository's default branch, using the
   proposal's reason as the PR description context.
5. The result (branch name, commit SHA, PR URL/number) is logged to `agent_write_log`
   before being reported back to the user, exactly as ADR-0004 already requires writes to
   be logged from the Worker using the service role before execution completes.
6. Execution happens exactly once per approval. No automatic retry — a failure (§12)
   requires a fresh proposal, identical to every existing write tool's behavior today.

Rate limiting extends ADR-0004's existing "max 5 writes per hour per user" posture to
cover the new tool IDs under the same `agent_write_log`-row-counting mechanism; whether
code writes share the existing 5/hour budget or need their own bound (a PR is a heavier
action than a comment) is an open decision for the ADR, not resolved here.

---

## 11. Verification Model

Extends the existing Evidence & Verification model (Wireframe Spec §14) without
redefining its four distinctions:

- **Action result** — what the execution step reported (branch created, commit made, PR
  opened) — a claim, not yet confirmation.
- **Evidence** — the pull request's actual current state, re-read via a read tool
  (extending the existing `github.pulls.list`-style pattern, or a new equivalent read
  covering PR diff content) after execution.
- **Verification status** — whether the re-read PR state matches what was previewed at
  approval: same target file(s), same resulting content. This is what closes Act back to
  Observe (Wireframe Spec §11) for a code change specifically.
- **Unresolved uncertainty** — if the post-execution read cannot be completed (e.g., the
  connection is unavailable at the moment of checking), this must be stated explicitly as
  its own condition, never silently presented as verified or as failed, identical to the
  existing rule.

A code change additionally distinguishes two claims that must not be collapsed: "the PR
was opened" (execution succeeded) is not the same claim as "the PR contains exactly the
diff the user approved" (verified) — the latter requires the re-read, the former does not
prove it.

---

## 12. Failure Model

- **Execution failure.** If branch creation, commit, or PR creation fails (permissions,
  conflict, API error), the failure is reported in the same terms Wireframe Spec §13
  already requires: status, the action as approved, the target, and a plain-terms
  explanation of what failed and why. No partial state is left silently unexplained.
- **Partial success.** Code-write execution introduces a real partial-success case
  text-metadata writes did not have: a branch could be created and committed to, but PR
  creation could fail. This must be surfaced as its own distinct state — not reported as a
  clean failure (the branch/commit still exist and are potentially visible in the
  repository) and not reported as success (no PR exists for the user to review or merge).
  The Execution Result screen (Wireframe Spec §13) must be able to represent "partially
  completed, here is exactly what did and did not happen" rather than forcing a binary
  succeeded/failed label onto a case that is neither.
- **Rollback.** No automatic rollback of a partially-completed execution. Per §5.10, if a
  partial or unwanted state needs to be undone, that is a fresh, explicit proposal (e.g.,
  "delete the orphaned branch," itself an approved action) — not an automatic compensating
  action taken without approval, which would itself violate the no-autonomy boundary (§3).
- **Retry.** Identical to every existing write tool: retry requires a fresh proposal and a
  fresh approval, never an automatic retry (ADR-0004). This applies equally to full
  failures and partial successes.

---

## 13. User Experience

No new screens. EPIC-08 is a new *kind* of content flowing through the seven Workspace
destinations the Wireframe Specification already defines (§5) — Approval Review,
Execution Result, and Evidence & Verification specifically — not a reason to add an
eighth.

### Desktop

- Approval Review renders a diff (or new-file content, or path change) as the "Expected
  effect" preview, with room for a genuinely readable diff view given desktop's available
  width.
- Execution Result and Evidence & Verification surface the PR link and its state alongside
  the same required fields already defined for every other write tool.

### Mobile

- Per Wireframe Spec §18 ("Approval safety... must never be abbreviated to fit less
  space"), a diff preview on a constrained device must remain fully inspectable — likely
  requiring its own full-step view rather than an inline expansion, and internal scrolling
  for a long diff rather than truncation. A diff that cannot be read in full on mobile
  must not be approvable on mobile; it is not acceptable to abbreviate the very information
  Wireframe Spec §12 makes mandatory.
- Large diffs are a genuine mobile risk (§14) — this document does not resolve the
  presentation mechanism (collapse-by-file, expand-on-demand, etc.), only the constraint
  that content must never be omitted, only progressively disclosed (Wireframe Spec §18).

---

## 14. Risks

**Product/trust**

- A diff too large to meaningfully review invites rubber-stamp approval, which
  undermines the entire approval boundary's purpose even though the mechanism is
  technically intact. Bounding proposal size (one file, per §5.6) mitigates but does not
  eliminate this.
- Opening a pull request is very likely to trigger the repository's CI/CD as a side
  effect. If this is not disclosed clearly in the approval preview (§8), the user is
  approving a broader effect than they were shown.

**Technical**

- Diff staleness between proposal and approval (§9) is a real, code-specific failure mode
  with no existing analogue in EPIC-07's text-metadata writes; it must be solved, not
  assumed away.
- Partial success (branch/commit exist, PR does not) is a new state the existing
  Execution Result model (built for atomic success/fail outcomes) must be able to
  represent without forcing a false binary (§12).
- Path validation must be robust against path traversal and writes intended for outside
  the repository tree — a stricter validation surface than anything EPIC-07 required.

**Security**

- A file-write tool is a materially larger attack surface than a comment/label-update
  tool if the deterministic validator has any gap — file content could carry secrets, or a
  path could target a sensitive file (e.g., CI configuration, secrets files) inside the
  repository. The validator's scope must explicitly account for this, not merely reuse
  EPIC-07's issue/label validation logic unchanged.

**Scope discipline**

- The clearest risk to this epic succeeding as scoped is quiet expansion: multi-file
  changes, autonomous merge, or autonomous retry each individually look like small,
  reasonable extensions once file-writing exists at all. §15 exists specifically to name
  these so they are recognized as deferred, not rediscovered as "obviously fine to add
  while we're in here."

---

## 15. Deferred Features

Everything reserved for EPIC-09 (Agent Autonomy) or otherwise explicitly out of this
epic's scope:

- **Open-ended multi-file changes.** §5.6's bounded exception (a small, explicit,
  enumerated file set for one coupled change) is the only multi-file allowance even
  proposed here, and it remains an open decision, not a default. Arbitrary-scope,
  repository-wide, or refactor-scale changes are EPIC-09 territory at the earliest, once
  bounded autonomy is actually defined (Product Direction §13, §16).
- **Autonomous merge.** SmartFlow opens pull requests; it never merges them, in this epic
  or any currently-scoped future one, absent a dedicated future decision this document
  does not make.
- **Autonomous retry or self-correction.** If execution or verification fails, SmartFlow
  does not automatically attempt a different approach — every retry is a fresh, separately
  approved proposal (§12).
- **Autonomous chaining.** A code-change proposal never triggers a second proposal
  automatically (e.g., "and also update the tests") — each is its own Reason → Proposal →
  Approval cycle (§6), consistent with the Assistant boundary already established (UX
  Architecture §10).
- **Running build tooling, tests, or scripts as part of execution.** Execution writes file
  content and opens a PR; it does not invoke the repository's own tooling.
- **Any capability for Learning Project or Personal Project types.** Software Project
  remains the only Project type in scope anywhere in the current phase (Product Direction
  §3); EPIC-08 does not anticipate the others.
- **Any provider beyond GitHub.** Consistent with every other document in this set —
  GitHub remains the only implemented Project connection (Product Direction §7, §10).
- **Schema, migration, and tool-implementation design.** This document does not decide
  `agent_write_log` column changes, new tool ID names, or Worker code structure — that is
  engineering work for after the required ADR (§1).

---

## 16. Success Criteria

This design succeeds when:

- A dedicated ADR can be written directly from this document's decisions (§5, §8, §9, §12)
  without needing to re-derive product scope or re-litigate whether a capability belongs
  in EPIC-08 versus EPIC-09.
- Every capability candidate the roadmap named has an explicit, justified verdict (§5) —
  none silently assumed in or out.
- The open decisions this document deliberately does not resolve (§5.6's bounded
  multi-file exception, §9's proposal-freshness mechanism, §10's rate-limit sizing) are
  named clearly enough that the ADR can resolve them without rediscovering the tradeoff
  from scratch.
- Nothing in this document requires modifying the Approval Model, Execution Engine, or
  Execution Audit in kind — every new capability is additive tool definitions and
  compositions consumed by those existing systems, consistent with the constraint this
  task was given.
- EPIC-09 (Agent Autonomy) remains exactly as frozen and unscoped as it was before this
  document, with a clearly named boundary (§15) between what EPIC-08 does and what would
  require EPIC-09 instead.

Success for the *capability itself* (post-implementation, out of scope for this document
but stated for continuity): a user can ask Flow AI to make a real, small code change, see
exactly what it proposes, approve it once, and see a real, verified pull request — without
that trust boundary ever being thinner than the one already proven for `tasks.complete`
and EPIC-07's GitHub writes.

---

## References

- [`docs/product/product-direction-v1.md`](../product/product-direction-v1.md)
- [`docs/design/ux/ux-architecture-v1.md`](../design/ux/ux-architecture-v1.md)
- [`docs/design/ux/project-workspace-wireframe-spec-v1.md`](../design/ux/project-workspace-wireframe-spec-v1.md)
- [`docs/design/ux/project-workspace-low-fidelity-wireframes-v1.md`](../design/ux/project-workspace-low-fidelity-wireframes-v1.md)
- [`docs/roadmap/project-workspace-implementation-roadmap-v1.md`](project-workspace-implementation-roadmap-v1.md)
- [`docs/adr/ADR-0004-write-boundaries.md`](../adr/ADR-0004-write-boundaries.md)
- [`docs/decisions/ADR/ADR-0001-architecture-decision-record-policy.md`](../decisions/ADR/ADR-0001-architecture-decision-record-policy.md)
- [`PROJECT_STATUS.md`](../../PROJECT_STATUS.md)
- [`CLAUDE.md`](../../CLAUDE.md)
