# SmartFlow GitHub Workflow

## Purpose

GitHub is the source of truth for planned work, implementation evidence, review, and completion status.

## Work hierarchy

Use this hierarchy for substantial work:

1. Epic
2. Feature or implementation issue
3. Pull request
4. Validation evidence
5. Follow-up issue when work remains

Do not use one issue as both a long-term roadmap and an implementation task.

## Issue readiness

An issue is Ready only when it contains:

- Context
- Problem
- Desired outcome
- Scope
- Out of scope
- Acceptance criteria
- Dependencies
- Validation plan
- Known risks

Large or ambiguous ideas remain in Inbox until they meet this standard.

## Project fields

The project board should use fields rather than duplicate labels:

- Status: Inbox, Ready, In Progress, Review, Blocked, Done
- Type: Epic, Feature, Task, Bug, Research, Debt
- Priority: P0, P1, P2, P3
- Area: Workspace, Agent, Memory, Integrations, UI, Backend, Infrastructure
- Horizon: Now, Next, Later
- Sprint: active sprint identifier
- Parent: related Epic

Status, priority, area, horizon, and sprint should not be repeated in issue bodies.

## Labels

Labels are reserved for exceptional cross-cutting signals:

- security
- breaking-change
- needs-decision
- blocked-external
- needs-qa
- documentation
- good-first-issue

Avoid status labels such as todo, in-progress, review, and done when Project Status exists.

## Pull requests

Every pull request must:

- link an issue using `Closes #123` or `Part of #123`
- explain scope and out-of-scope work
- report exact validation evidence
- disclose security, privacy, migration, RLS, and rollback impact when relevant
- link follow-up issues instead of leaving untracked TODOs

A pull request may merge with remaining work only when that work is explicitly tracked in a follow-up issue.

## Completion

Close an issue as completed only when:

- acceptance criteria are satisfied
- implementation is merged or otherwise recorded
- required validation passes
- documentation is current
- remaining work has separate issues

Close duplicate issues with the duplicate reason and retain the better-scoped canonical issue.

## Backlog horizons

- Now: current product objective and active implementation
- Next: credible work expected after Now
- Later: long-term roadmap ideas that should not crowd the operational board

For the current SmartFlow objective, Now should prioritize GitHub integration, email integration, memory, approval and execution, mobile access, and Smart Academy assistance.
