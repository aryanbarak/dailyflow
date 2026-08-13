# ADR-0012: Write Capability Layer v1

- **Status:** Accepted
- **Date:** 2026-08-13
- **Decision Makers:** Product Owner (Aryan Barakzai) - decision; Claude Code - drafting and Tier 1 migration authoring.
- **Supersedes:** None
- **Superseded by:** None

---

## Context

ADR-0004 established that SmartFlow writes require deterministic validation,
approval, execution, verification, and audit. That boundary remains correct,
but it only describes per-action approval at the moment the action is shown.
The product now needs a user-configurable pre-authorization layer for low-risk,
reversible writes that users commonly expect Flow AI to perform without a
second click, starting with task create/update.

## Decision

SmartFlow adds a write capability layer with three parts:

1. Extend `AgentIntentType` and the structured-output schema so write intents
   for already-supported domains can be expressed. Slice 1 wires only
   `create_task` and `update_task`.
2. Store user pre-authorization policy per `(domain, action)` with mode
   `auto`, `ask`, or `off`, evaluated by trusted runtime code. Browser state is
   preference input only; it is never execution authority.
3. When an `auto` write executes, the runtime must append a deterministic,
   app-authored post-execution confirmation line and produce the same audit
   record class as a manually approved write.

Default policy:

- `tasks.create`, `tasks.update`, `calendar.create`, and `calendar.update`:
  `auto`, only if reversible and undoable.
- Any delete: `ask`.
- Finance writes: `ask`.
- Any new or unknown domain/action: `ask` fail-closed.

Non-negotiable rules:

- Irreversible operations never default to `auto`.
- "Done", "created", "updated", or equivalent completion claims are allowed
  only after a real successful execution in the current turn.
- Task 20's completion-claim guard is not weakened.
- Execution failure is reported honestly, without success copy.
- Undo is part of the definition of `auto`; if no undo path exists, the action
  cannot be auto-executed.
- Policy evaluation is never browser-bypassable.
- No Unicode bidi-control characters are required or requested for this layer.

## Relationship to ADR-0004

This ADR changes **when** the user authorizes a supported write. It does not
change **whether** the user authorizes it. `auto` means the user already chose
that policy in Settings for a reversible domain/action pair; `ask` preserves
ADR-0004's explicit proposal approval flow; `off` blocks the write.

## Consequences

- User settings need a durable, owner-scoped table for write permission modes.
- Missing rows are resolved conservatively in code using the defaults above.
- Auto execution must be coupled to verified write handlers and undo metadata.
- New write domains/actions must fail closed until explicitly classified.
- The first implementation slice is intentionally narrow: task create/update
  only. Calendar, finance, document deletion, and GitHub write behavior are not
  broadened by this ADR's implementation slice.

## Accepted Risk

The accepted risk is that a model may misread a user's request and a reversible
task create/update could execute without a stop-click when the user has left
that capability in `auto`.

Mitigations:

- Only deterministic validated write intents can reach execution.
- Unknown domains/actions fail closed.
- Auto is limited to undoable operations.
- The confirmation line is app-authored from the execution result, not model
  prose.
- Audit records are produced for successful and failed auto executions.
- `ask` and `off` remain available per capability in Settings.

## Related ADRs

- [ADR-0004: Write Boundaries for SmartFlow GitHub Integration](ADR-0004-write-boundaries.md)
- [ADR-0008: Tiered Change Governance](ADR-0008-tiered-change-governance.md)
- [ADR-0010: Personal Memory Layer v1](ADR-0010-personal-memory-layer.md)
- [ADR-0011: Confirmed Personal Memory Consumption v1](ADR-0011-confirmed-personal-memory-consumption.md)
