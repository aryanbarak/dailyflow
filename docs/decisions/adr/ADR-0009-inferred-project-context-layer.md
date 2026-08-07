# ADR-0009: Inferred Project Context Layer

- **Status:** Accepted
- **Date:** 2026-08-07
- **Accepted:** 2026-08-07
- **Decision Makers:** Product Owner (Aryan Barakzai) — decision; Claude Code —
  drafting and documentation only.
- **Supersedes:** None
- **Superseded by:** None

---

## Context

`PROJECT_STATUS.md` §5 records the Product-Owner-approved next-work
sequence: retroactive ProjectBrief/Workspace review, then **LLM-assisted
Context Derivation v1**, then Personal Memory v1. This ADR is the design
decision that must exist before Context Derivation v1 can start, per
[ADR-0001](ADR-0001-architecture-decision-record-policy.md)'s "implementation
must not start before the relevant ADR is Accepted" and
[ADR-0008](ADR-0008-tiered-change-governance.md)'s Tier 1 classification for
"durable user-truth semantics (including any promotion of inferred content
toward canonical state)" — exactly this ADR's subject.

The gap this ADR closes already has a name in the canonical architecture,
not a new one invented here. `contextRebuildService.ts`'s
`canDeriveProjectContextFromSnapshot` always returns `false` today because
`ProjectContextBuilder` requires pre-structured objectives, milestones,
decisions, capabilities, risks, and candidate actions
([`project-domain.md`](../../architecture/project-domain.md) §7-§8), and no
deterministic transformation from raw evidence text into that structure
exists. `project-domain.md` §6 names the LLM option and its condition
explicitly:

> "LLM output is not canonical evidence unless converted through an explicit
> validated process defined in a future architecture. No such process is
> defined or approved by this document; until one exists, LLM output MUST
> NOT enter `ProjectEvidence`."

This ADR is that future architecture's **data model and authority
semantics** — not its implementation, which is deliberately deferred to a
later, separately-approved Tier 1 task (named `3b` by the coordinator; not
started by this ADR).

This ADR is grounded in, and must not contradict, the following existing
canonical rules:

- [`representative-engine.md`](../../architecture/representative-engine.md)
  §9 (reasoning is advisory, must preserve the distinction between
  deterministic fact, source fact, LLM interpretation, inferred state, and
  missing/uncertain state), §15 (Authoritative / Derived / Inferred / Cached
  / User-declared state categories — derived, inferred, cached, and
  user-declared state must never silently become authoritative), §16
  (provenance and freshness must be preserved and shown when material).
- [`project-domain.md`](../../architecture/project-domain.md) §6
  (`ProjectEvidence` is a traceable input, not a conclusion; LLM output is
  barred from it absent this ADR), §8 (`ProjectContext` "MUST NOT contain...
  hidden LLM state"), §9 (`CandidateProjectAction` is `authority:
  "non_authoritative"` and never self-promotes to execution or decision
  authority — the same non-promotion discipline this ADR applies one layer
  earlier), §14 (fact-based freshness/staleness, no silent revalidation),
  §15 (evidence disagreement must surface as conflict, never be resolved by
  array order or by trusting an LLM's ranking).
- [`project-evidence-acquisition.md`](../../architecture/project-evidence-acquisition.md)
  §22 (Context Rebuild reads only already-persisted evidence, never a live
  source or provider — this ADR's derivation run inherits that same
  boundary).
- [`ADR-0007`](ADR-0007-projectevidence-observation-model.md) (the atomic,
  immutable, evidence-observation pattern this ADR's new aggregate mirrors
  one layer up).
- [`target-architecture.md`](../../architecture/target-architecture.md) §10
  (Reasoning Layer: AI reasoning "MUST NOT... treat assumptions as runtime
  facts"; outputs "remain proposals until deterministic systems validate
  them").

## Problem

Without this ADR, "LLM-assisted Context Derivation v1" cannot start without
inventing, mid-implementation, exactly the rules ADR-0001/ADR-0008 require
to be decided first: what aggregate holds LLM-derived structured candidates,
how it relates to `ProjectEvidence` and `ProjectContext`, what authority it
carries (none, by every canonical rule above), and how a user reviews,
confirms, or corrects it. Deciding these mid-implementation is exactly the
failure mode this project's governance documents exist to prevent.

## Options Considered

| Option | Description | Reason not chosen |
|---|---|---|
| Feed LLM output directly into `ProjectContextBuilder`'s input, ephemeral only | No persistence; treat each derivation as a one-shot, unrecorded transformation | Violates `project-domain.md` §8 (`ProjectContext` "MUST NOT contain... hidden LLM state") and `representative-engine.md` §15/§16 (inferred state must carry provenance and must not silently become authoritative) — no durable record of what the model said, no correction trail, no way to confirm or reject anything |
| Treat LLM output as `ProjectEvidence` | Persist model output through the existing `ProjectEvidence`/`ProjectEvidenceObservation` pipeline | Directly forbidden by `project-domain.md` §6 as quoted above — `ProjectEvidence` is provenance of a source, not a conclusion about one; conflating the two corrupts the evidence/conclusion distinction the whole Project Domain is built on |
| New aggregate, `InferredProjectContextField` (chosen) | A separate, explicitly non-canonical, per-field aggregate for LLM-derived candidates, mandatorily evidence-linked, with an explicit confirm/correct/reject lifecycle | **Chosen** — this is the "explicit validated process" `project-domain.md` §6 names as the precondition for LLM output to matter at all, without conflating evidence and conclusion, and without granting the LLM any authority `CandidateProjectAction`-class recommendations don't already have (§9) |

## Decision

### 1. New aggregate: `InferredProjectContextField`

The working name is kept: it names exactly what the record is — one
candidate value for one of `ProjectContext`'s named fields
(`project-domain.md` §8: objective, milestone, decision, risk, capability,
candidate action), never a whole context, never evidence.

Fields:

- `id` — server-generated, immutable.
- `projectId`, `ownerId` — RLS scoping posture identical to
  `project_evidence`/`project_evidence_observations`: owner-scoped `SELECT`
  only for `authenticated`; all writes through a `SECURITY DEFINER` function
  with `search_path` pinned and ownership resolved from `auth.uid()` inside
  the function body, exactly as
  [`create_project_evidence_with_observation`](../../../supabase/migrations/20260803000000_project_evidence_observations.sql)
  already does. No direct client `INSERT`/`UPDATE` on this table.
- `contextFieldKind` — one of `objective`, `milestone`, `decision`, `risk`,
  `capability`, `candidate_action` — which `ProjectContext` field this
  candidate feeds. Closed enum, matching `project-domain.md` §8's own field
  list; not an open string.
- `content` — a structured payload, typed and deterministically validated
  per `contextFieldKind` (a `milestone` candidate has a different validated
  shape than a `risk` candidate) — never free text, never validated by the
  model's own claim of correctness.
- `provenance.sourceEvidenceIds` — a non-empty array of existing
  `ProjectEvidence` ids the derivation actually read. **An inference with no
  evidence linkage is invalid by construction** — enforced the same way
  `ADR-0007`'s function enforces "no orphan evidence row," as a database
  constraint the write path cannot bypass, not merely an application-layer
  check.
- `derivationRunId`, `modelIdentity`, `derivationVersion` (prompt/schema
  version) — which run, which model, which prompt/schema version produced
  this candidate. Never used to imply the model is a trusted identity — only
  to make a bad run auditable and reproducible.
- `confidence` — closed three-value scale: `low` | `medium` | `high`. **Not
  a free float.** Rationale: an LLM's self-reported numeric confidence is not
  a calibrated probability, and treating it as one (averaging it, thresholding
  it, doing arithmetic on it) fabricates a rigor the number does not have.
  `representative-engine.md` §16 speaks of confidence only qualitatively
  ("lower confidence," never a numeric threshold), and a closed enum is
  deterministically validatable exactly like this codebase's existing closed
  `CHECK` constraints (`payload_kind`, `mime_type` on
  `project_evidence_observations`).
- `status` — state machine (below).
- `source` — `model` | `user`. A `model` row is the LLM's original,
  unmodified output — immutable forever, exactly like `ProjectEvidence`. A
  `user` row is a user-authored correction (see below) — also immutable once
  created.
- `supersedesFieldId` — nullable, self-referencing. Set on a `user`-sourced
  correction to point back at the `model`-sourced field it corrects, and set
  by a newer derivation run on a `proposed` field it supersedes (see the
  state machine).

**State machine:**

```text
proposed
  -> user_confirmed      (user accepts the model's content verbatim)
  -> user_corrected      (user's correction is a NEW row, source=user,
                          supersedesFieldId = this row's id; THIS row's own
                          status becomes user_corrected -- it is never
                          edited in place)
  -> user_rejected       (user declines the candidate; no new row required)
  -> superseded          (a newer derivation run produced a fresher
                          candidate for the same project + contextFieldKind
                          + logical slot -- see the rule below)
```

Immutability posture mirrors ADR-0007 exactly: there is no `UPDATE` path on
`content`, `provenance`, `confidence`, or any other field a model or a prior
user action already wrote. `status` transitions and `supersedesFieldId`
linkage are the only mutations, and only through the same
`SECURITY DEFINER` pattern — never a bare client `UPDATE`. A correction is
always a new record, never a mutation, exactly as `ADR-0007` already
established for `ProjectEvidence` corrections one layer down.

**Automatic supersession is narrow, on purpose:** only a field still in
`proposed` status may be automatically marked `superseded` by a newer
derivation run. A `user_confirmed` or `user_corrected` field is user-declared
state (`representative-engine.md` §15) and is never silently overridden by a
new derivation — a newer run that disagrees with an already-confirmed field
must surface as a conflict (`project-domain.md` §15), never silently replace
it. This is the same principle §15 already applies to evidence disagreement,
applied one layer up to inferred candidates.

Explicit user-authored `ProjectContext` content with no prior model
inference at all (a user typing in a risk directly, say) is a related but
separate feature — `project-domain.md` §6 already names "explicit
user-authored project records" as its own evidence category — and is **out
of scope for this ADR**, which only covers corrections to an existing
model-authored candidate.

### 2. Authority semantics

This is the heart of the ADR.

- Inferred fields are **never** canonical truth, at any status. A
  `user_confirmed` or `user_corrected` field becomes **user-declared state**
  per `representative-engine.md` §15 — the highest trust tier available in
  this layer — but even user-declared state never becomes **execution
  authority**. Nothing in this ADR touches
  [`authority-model.md`](../../architecture/authority-model.md) or
  [`execution-intent.md`](../../architecture/execution-intent.md); no
  `InferredProjectContextField`, at any status, is ever read by
  `writeRuntime.ts`, `executionPolicy.ts`, or any approval path.
- `ProjectContextBuilder` **MAY** consume `user_confirmed` and
  `user_corrected` fields as structured input for the corresponding
  `ProjectContext` field, finally making a real, non-`snapshot_ready_
  context_not_derivable` `ProjectContext` derivable from evidence for the
  first time. It **MAY** also consume `proposed` (unconfirmed) fields, but
  only if the resulting `ProjectContext` field visibly carries an inferred/
  unconfirmed marker through to every consumer — this is a real widening of
  `ProjectContext`'s own shape (see Consequences), required by
  `project-domain.md` §8's freshness/provenance discipline and
  `representative-engine.md` §16, not an implementation detail to leave
  unspecified.
- **Precedence when more than one candidate exists for the same field:**
  explicit evidence-extracted facts (`ProjectBrief`-class deterministic
  extraction, when it exists for the same fact) outrank `user_confirmed`/
  `user_corrected` inferred fields, which outrank `proposed` (unconfirmed)
  inferred fields. Conflicts between tiers, or between two same-tier
  candidates, **surface, never silently resolve** — the identical rule
  `project-domain.md` §15 already states for evidence disagreement, applied
  to this layer.
- Nothing in this layer touches approval or execution paths, full stop —
  restated because it is the single most important sentence in this ADR.

### 3. Derivation run boundaries

- A derivation run reads **only** already-persisted
  `ProjectEvidence`/`ProjectEvidenceObservation` pairs — never a raw source,
  never a provider API directly — the identical boundary
  `project-evidence-acquisition.md` §22 already states for Context Rebuild
  ("Context Rebuild may only read already-persisted `ProjectRecord` and
  `ProjectEvidence`/`ProjectEvidenceObservation`. It never re-reads a
  repository file, never calls a provider API..."). This ADR does not loosen
  that boundary; a derivation run is a sibling read path under the identical
  rule, not an exception to it.
- A derivation run executes **server-side**, in the Cloudflare Worker, where
  Gemini access already lives (`current-architecture.md`'s Current
  Integrations table: "Gemini | Implemented | Worker uses Gemini for chat,
  suggestions, document analysis, briefings, memory extraction, and
  reasoning proposals"). It is one more Worker-side Gemini consumer among
  several already documented, not a new access pattern.
- Model output is deterministically validated against the typed,
  per-`contextFieldKind` schema **before** persistence. Invalid output
  (malformed JSON, wrong shape, missing required field, a `contextFieldKind`
  the schema doesn't recognize) is **dropped and logged, never coerced** —
  the same fail-closed discipline `projectEvidenceValidation.ts` and
  `projectBriefAssembler.ts`'s `NO_SUPPORTED_CONTENT` path already apply
  throughout this codebase. A run that produces nothing valid persists
  nothing and reports that honestly, exactly like Context Rebuild's own
  `snapshot_ready_context_not_derivable` outcome.

### 4. Deferred (named, not resolved by this ADR)

- Embeddings/RAG.
- Cross-project inference.
- Automatic re-derivation scheduling — named in `project-evidence-
  acquisition.md` and `project-domain.md` as a future Smart Automation lane,
  not decided here.
- **Confidence-driven auto-confirmation is explicitly rejected for v1** — no
  confidence value, however high, ever moves a field out of `proposed`
  without an explicit user action. This is stated as a rejection, not merely
  an omission, because it is the single most likely shortcut a future
  implementer might be tempted to add.
- Multi-provider routing.

## Open questions for the Product Owner

1. **Retention/erasure of rejected inferences.** Does a `user_rejected`
   field stay forever (a complete audit trail of every model mistake) or
   does it become eligible for deletion/erasure after some period? This ADR
   takes no position; `project-evidence-acquisition.md` §14/§25 already
   leaves the analogous question open for `ProjectEvidence` itself.
2. **Do unconfirmed (`proposed`) inferences appear in the Workspace UI by
   default, or only behind an explicit toggle?** This ADR permits
   `ProjectContextBuilder` to consume them (Decision §2) but does not decide
   whether the UI should surface them by default — a real UX/trust decision,
   not an architecture one.
3. **Per-derivation-run cost visibility.** Should the Workspace UI or
   `PROJECT_STATUS.md` surface Gemini token/cost usage per run, per project,
   or not at all? Not addressed by any existing canonical document.
4. **Minimum evidence threshold before a derivation run is attempted.**
   Should a project with only one or two evidence items even be eligible
   for derivation, or is there a floor (e.g., requiring `PROJECT_STATUS.md`-
   class evidence plus at least one other kind) below which a run should
   refuse to start rather than produce low-value candidates?
5. **Are `user_rejected` fields usable as future prompt-improvement
   signal** (e.g., "the model got this wrong for this project shape"), or
   must they be treated as private/purge-only data with no analytical reuse?
   This has privacy implications not addressed by any existing document.

## Product Owner Resolutions

Recorded verbatim as decided on 2026-08-07, resolving the five open
questions above. These resolutions are part of this Accepted decision, not
a separate future ADR.

- **Q1 Rejected inferences:** RETAINED in v1; used for duplicate-suppression.
  Erasure/deletion policy is explicitly joined to the already-deferred
  evidence-layer erasure/tombstone decision
  (`project-evidence-acquisition.md` §25) — one future policy for both
  layers, not two.
- **Q2 Unconfirmed (proposed) inferences ARE shown in the Workspace UI by
  default**, always clearly marked as inferred/unconfirmed
  (`representative-engine.md` §15 marking discipline). No hide-toggle
  required for v1. (The UI itself is not built as part of this ADR's
  implementation task.)
- **Q3 Per-derivation-run cost visibility:** minimal — persist call/token
  counts as run metadata, surfaced in the run result. No cost dashboard.
- **Q4 Minimum evidence threshold:** none beyond "snapshot has ≥1 active
  observation"; otherwise typed failure. Structural validation, not input
  counting, controls quality.
- **Q5 Rejected fields:** duplicate-suppression ONLY. No analytical /
  prompt-improvement reuse in v1. Future revisiting allowed via a new
  decision record.

## Consequences

- A new Supabase table and migration for `InferredProjectContextField` (and
  its `SECURITY DEFINER` write function) is required before any
  implementation — this is **Tier 1 under ADR-0008** (schema/migration
  change; durable user-truth semantics via the promotion of `user_confirmed`/
  `user_corrected` state into `ProjectContextBuilder` input), requiring its
  own design/ADR-level review before merge, not merely this ADR. That
  implementation work (named `3b` by the coordinator) is not started by this
  ADR and requires its own Product Owner approval to begin.
- `ProjectContextBuilder`'s input contract widens to optionally accept
  `user_confirmed`/`user_corrected`/(visibly-marked) `proposed` inferred
  fields per `ProjectContext` field, alongside the fields it already accepts
  from `ProjectContextInput`. The exact shape of that widening is
  implementation work, not decided here.
- `PROJECT_STATUS.md` §5 will need updating upon acceptance to record this
  ADR's Accepted status and to sequence the Tier 1 schema/migration work it
  authorizes as the next concrete step toward Context Derivation v1.
- No existing table, RLS policy, or write path changes as a result of this
  ADR alone — it defines a new aggregate, not a modification to
  `ProjectRecord`, `ProjectEvidence`, or `ProjectEvidenceObservation`.

## Related ADRs

- [ADR-0007: ProjectEvidence Observation Model](ADR-0007-projectevidence-observation-model.md) — the atomic, immutable, `SECURITY DEFINER`-gated aggregate pattern this ADR mirrors one layer up.
- [ADR-0008: Tiered Change Governance](ADR-0008-tiered-change-governance.md) — governs the review tier of this ADR's eventual implementation (Tier 1).
