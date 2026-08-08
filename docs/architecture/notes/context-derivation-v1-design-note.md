# Context Derivation v1 — Design Note

**Status: Draft.** This is a supporting sketch for
[ADR-0009: Inferred Project Context Layer](../../decisions/adr/ADR-0009-inferred-project-context-layer.md)
(Proposed). It is **not** a canonical architecture document and carries no
authority of its own — everything binding lives in ADR-0009 itself. This
note exists only to make ADR-0009's data model and authority decisions
concrete enough to evaluate; the pipeline shape and Worker route sketched
below are illustrative, non-binding, and subject to change during actual
implementation (a separate, Tier 1, ADR-0008-gated task).

---

## Purpose

Sketch how a derivation run would move from "a project has persisted
evidence" to "a project has candidate `InferredProjectContextField` rows
waiting for user review" — without deciding anything ADR-0009 itself
leaves open.

## Non-binding pipeline shape

```text
Trigger (manual "Derive context" action; never automatic per ADR-0009 §4)
  -> resolve trusted owner + active ProjectRecord
     (identical trusted-owner-resolution convention as
      contextRebuildService.ts / projectEvidenceService.ts)
  -> read existing EvidenceSnapshot
     (reuses evidenceSnapshotBuilder.ts -- no new evidence read path;
      ADR-0009 §3's "reads only already-persisted evidence" boundary)
  -> build one prompt per contextFieldKind (or one combined prompt --
     undecided; a real implementation choice, not an ADR-0009 concern)
  -> call Gemini from the Worker
     (same access pattern as existing Worker Gemini consumers --
      chat, suggestions, document analysis, briefings, memory extraction)
  -> deterministically validate raw model output against the
     per-contextFieldKind typed schema
  -> valid candidates: persist as InferredProjectContextField rows,
     status="proposed", source="model", provenance.sourceEvidenceIds
     populated from the EvidenceSnapshot items actually included in the
     prompt (never empty -- ADR-0009's "invalid by construction" rule)
  -> invalid/malformed candidates: dropped and logged, never persisted,
     never coerced into a best-effort shape (ADR-0009 §3)
  -> run completes; UI (out of scope for this note) surfaces new
     "proposed" fields per ADR-0009's open question #2
```

## Rough Worker route posture (illustrative only)

A plausible new authenticated Worker route,
`POST /projects/:projectId/context-derivation`, following this repo's
existing Worker route conventions (`current-architecture.md`'s "Current
Worker routes" list: authenticated, JSON in/out, Supabase JWT boundary). It
would:

- require the same Supabase Auth boundary every other authenticated Worker
  route already requires (no new auth mechanism);
- resolve the owner and active `ProjectRecord` before reading anything, per
  ADR-0009's inherited trusted-owner convention;
- call Gemini using the Worker's existing Gemini access, not a new provider
  integration;
- write through a `SECURITY DEFINER` function analogous to
  `create_project_evidence_with_observation`, never a bare table insert from
  the Worker's own Supabase client identity.

None of the above is decided by ADR-0009 or this note. The actual route
name, request/response shape, prompt structure, per-`contextFieldKind`
schema definitions, and whether one run covers all `contextFieldKind`s or
one at a time are all implementation decisions for the separate Tier 1 task
that would follow ADR-0009's acceptance.

## Precedence and conflict surfacing (added post-implementation, review finding F1)

ADR-0009 Decision section 2 states a precedence rule between candidate
`ProjectContext` elements: explicit evidence-extracted facts outrank
`user_confirmed`/`user_corrected` inferred fields, which outrank still-
`proposed` inferred fields, and any conflict "surface[s], never silently
resolve[s]" (`project-domain.md` section 15). The Tier 1 implementation
(task `3b`) initially concatenated every eligible candidate with no
ordering at all -- flagged as review finding F1 (MAJOR) in
`docs/reviews/2026-08-inferred-context-layer-review.md`. This section
documents the fix (task `3c`), implemented in
`src/features/projects/contextPrecedenceResolver.ts`.

**"Same slot" -- the deterministic, per-kind collision rule actually
implemented:**

- `objective`, `milestone`: two candidates collide only when BOTH have
  status `"active"` -- the one single-slot invariant this domain already
  enforces (`MULTIPLE_ACTIVE_OBJECTIVES`/`MULTIPLE_ACTIVE_MILESTONES`).
  Any other status groups by normalized (trimmed, casefolded) `summary`/
  `title` instead, so two independent historical entries (e.g. two
  different completed milestones) never collide with each other.
- `decision`, `capability`: slot = normalized `title`. There is no
  "at most one active" concept for these kinds; two entries collide only
  when their title matches exactly after normalization.
- `risk`, `candidate_action`: slot = normalized `summary`, by the identical
  rule.

This is deliberately conservative -- exact-text match only, never semantic
similarity, which would require an LLM judgment call this module must not
make.

**Resolution:** within a colliding slot, the element(s) at the single
highest-ranked tier present win. Exactly one winner at that tier displaces
every strictly-lower-tier candidate in that slot (removed from the built
`ProjectContext`'s arrays, `reason: "higher_tier_precedence"`). More than
one candidate at that same top tier is a genuine, irreconcilable same-tier
conflict -- every one of them is kept, never arbitrarily narrowed to one
(`reason: "same_tier_conflict"`). Either way, a
`ProjectContextPrecedenceConflict` record is added to the built
`ProjectContext`'s new `precedenceConflicts` array (always present, empty
when no collision occurred) -- this is the "surfaced, never silent"
mechanism: a consumer can see exactly what won, what was superseded, and
whether a same-tier disagreement remains unresolved, without having to
infer any of it from array order.

## What this note deliberately does not attempt

- A concrete prompt.
- A concrete per-`contextFieldKind` JSON schema.
- A migration or table DDL (Tier 1 implementation work, not this task).
- Any UI sketch (ADR-0009's open question #2 is unresolved; sketching a UI
  ahead of that answer would prejudge it).
- Cost/latency estimates (ADR-0009's open question #3 is unresolved).
