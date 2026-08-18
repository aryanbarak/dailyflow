# SmartFlow — Project Status

Last rebuilt from git/code evidence: 2026-08-07 (see
[`docs/status/reconciliation-2026-08.md`](docs/status/reconciliation-2026-08.md)
for the full evidence trail behind this rebuild — file-by-file commit
mapping, migration inventory, and a discrepancy table against the prior
version of this document).

## 0. Maintenance rule

**This file is the only status source for SmartFlow.** No other document —
including `docs/roadmap/*`, `docs/architecture/*`, and ADRs — should carry
its own "implemented/not implemented" status narration; they should link
here instead. This file must be regenerated or verified against git/code
reality at the end of every task that changes implementation status, not
narrated forward from memory. Every "Implemented" claim below carries a
commit hash or file path; a claim with neither is not verified and must not
appear here.

## 1. Identity

SmartFlow is Aryan's **Personal Digital Representative** — canonical product
identity per [ADR-0006](docs/decisions/adr/ADR-0006-canonical-product-identity.md)
(Accepted, 2026-08-01). Software Projects / Project Intelligence are the
current proving ground for this identity, not the full permanent identity;
voice, avatar, richer memory, and broader delegated operation remain future
work.

## 2. Verified implemented capabilities

### 2.1 Project Domain (verified in this reconciliation — see the inventory doc for full file/commit detail)

- **`ProjectContext` foundation** — deterministic, read-only, typed domain
  (`src/features/projects/projectContextTypes.ts`, `projectContextBuilder.ts`).
  Committed `6ab3613`.
- **`ProjectRecord`** — durable, owner-editable aggregate (create/read/list/
  update/archive, optimistic concurrency), RLS-protected `project_records`
  table. `src/features/projects/projectRecordService.ts`; migration
  `supabase/migrations/20260801000000_project_records.sql`. Committed `cec2be9`.
- **`ProjectEvidence` + `ProjectEvidenceObservation`** — durable, immutable,
  owner/project-scoped evidence with a mandatory consumable text payload,
  created atomically via the `SECURITY DEFINER` function
  `create_project_evidence_with_observation` (direct client `INSERT` on both
  tables is revoked). `src/features/projects/projectEvidenceService.ts`,
  `projectEvidenceObservationTypes.ts`; migrations
  `20260802000000_project_evidence.sql`, `20260803000000_project_evidence_observations.sql`.
  Committed `9b40a4d` / `fddceb0` / `bc87a60`. Governed by
  [ADR-0007](docs/decisions/adr/ADR-0007-projectevidence-observation-model.md) (Accepted).
- **Repository Documents Adapter** — the first real Evidence Source Adapter:
  reads one allowlisted, in-repo Markdown document at a time, real-path
  containment against symlink escape, SHA-256 content hashing.
  `src/features/projects/repositoryDocumentAdapter.ts`. Committed `bc87a60`.
  **Not wired into any production entry point** — invoked only by the local
  CLI (below); a tested, injectable library only.
- **Context Rebuild Foundation** — deterministic `EvidenceSnapshot`
  construction and `rebuildProjectContext(projectId)`.
  `src/features/projects/evidenceSnapshotBuilder.ts`, `contextRebuildService.ts`.
  Committed `ae2a0d5`. Honestly partial: see §3.
- **Project Brief** — deterministic, evidence-backed extraction of explicit
  labeled facts (phase, focus, milestones, decisions, risks) from
  `PROJECT_STATUS.md`, ADRs, roadmap, architecture, and product-direction
  documents. `src/features/projects/projectBriefService.ts` and five
  extractors. **Committed to `main` in `fa8e923`** (previously narrated
  elsewhere as "uncommitted" — see the reconciliation doc's discrepancy
  table, row 1).
- **Local Project Refresh CLI** — `npm run smartflow:refresh-project -- --project-id <uuid> --repo-root <path> [--json]`.
  `scripts/smartflow-refresh-project.ts`. Committed `8a3f5c5`, stability fix `05d77a1`.
- **Project creation CLI** — `npm run smartflow:create-project`, developer-only.
  `scripts/smartflow-create-project.ts`. Committed `3a96e09`.
- **Live persisted Project Brief read path** — `/projects/:projectId` reads
  an authenticated, owner-scoped `ProjectRecord`, runs Context Rebuild +
  Project Brief against already-persisted evidence.
  `src/pages/ProjectWorkspacePage.tsx`. Committed `8d791c3`, fixes `05d77a1`.
  Demo-only fixture remains at `/projects/demo/smartflow`.
- **Projects discoverability** — `/projects` index page listing the signed-in
  owner's `ProjectRecord`s; Sidebar/MobileNav "Projects" entry.
  `src/pages/ProjectsIndexPage.tsx`, `src/components/layout/Sidebar.tsx`.
  **Committed to `main` in `b16f18f`** (previously narrated elsewhere as
  "uncommitted" — see the reconciliation doc's discrepancy table, row 2).
- **Inferred Project Context Layer v1 (LLM-assisted Context Derivation)** —
  [ADR-0009](docs/decisions/adr/ADR-0009-inferred-project-context-layer.md)
  (Accepted)'s Tier 1 implementation. New `inferred_project_context_fields`/
  `inferred_context_derivation_runs` tables, owner-scoped RLS, all writes
  through two `SECURITY DEFINER` functions (`create_inferred_context_field`,
  `resolve_inferred_context_field`) with race-safe duplicate suppression
  (`get stacked diagnostics`-based, mirroring ADR-0007's own pattern) —
  `supabase/migrations/20260807000000_inferred_project_context_fields.sql`.
  New authenticated Worker route `POST /projects/context-derivation`
  (`agent/worker/context-derivation-endpoint.ts`) reading only persisted
  evidence, calling Gemini with structured output, deterministic
  per-candidate validation (drop-and-log, never coerce). New
  `src/features/projects/contextPrecedenceResolver.ts` enforces ADR-0009's
  precedence rule (evidence-extracted > user_confirmed/corrected > proposed)
  with every collision surfaced via the new `ProjectContext.precedenceConflicts`
  field, never silently resolved. `ProjectContextBuilder`/
  `contextRebuildService.ts` widened to consume inferred fields, producing
  the first-ever real `context_ready` result — see
  `src/features/projects/contextRebuildService.test.ts`'s "produces a REAL,
  non-fabricated ProjectContext" test. Independently reviewed under Tier 1
  (ADR-0008): [`docs/reviews/2026-08-inferred-context-layer-review.md`](docs/reviews/2026-08-inferred-context-layer-review.md)
  (4 MAJOR / 3 MINOR findings, all closed by remediation, re-reviewed —
  verdict "RE-REVIEW PASSED — CLEARED FOR MERGE DECISION").
- **Inference confirm/correct UI in Project Workspace (Tier 2)** — task 4;
  design note
  [`docs/architecture/notes/inference-review-ui-design-note.md`](docs/architecture/notes/inference-review-ui-design-note.md).
  New "Inferred understanding" section in `ProjectWorkspacePage.tsx`
  (`src/features/projects/components/InferredContextSection.tsx`), listing a
  project's `InferredProjectContextField` rows grouped by kind, always
  showing still-`proposed` candidates marked "Inferred -- unconfirmed"
  (ADR-0009 Q2), with per-field Confirm/Correct/Reject actions calling
  `resolve_inferred_context_field` through the existing service/repository
  (never editing a row in place; a correction inserts a new row, exactly as
  the backend already enforced). Client-side correction validation reuses
  the canonical `validateInferredFieldContent` — no duplicated rules. New
  derivation-trigger client
  (`src/features/projects/contextDerivationTriggerClient.ts`) calls
  `POST /projects/context-derivation` with the signed-in user's own session
  token. Also closes a real, in-scope gap found while wiring this up:
  `projectWorkspaceBrowserReadService.ts`'s browser factory had never passed
  the already-optional `inferredContextFieldRepository` dependency into
  `contextRebuildService.ts` (supported since task 3c) — a confirmed field
  could not previously have reached `context_ready` for the live page at
  all. Independent review may follow post-merge per ADR-0008's Tier 2 path.

### 2.2 Everything else — carried forward, not independently re-verified in this task

The claims below are unchanged from the prior version of this document and
were **not** the subject of this reconciliation's evidence work (which was
scoped to the Project Domain). They are believed accurate but should be
treated as due for their own verification pass, not as freshly checked.
`docs/architecture/current-architecture.md` is the maintained canonical
architecture-status reference for all of these and should be read for
current detail rather than this file:

- Deterministic Workspace pipeline (`src/features/workspace/`: signal,
  memory, interaction-feedback, decision-intelligence, personalization,
  priority, goal, planner, approval, workspace engines) — see
  `current-architecture.md` "Workspace Pipeline" and "Implemented Engines."
- Agent reasoning/execution pipeline (LLM proposal → deterministic
  validation → tool resolution → approval → execution → audit → reflection
  → response composition) — see `current-architecture.md` "Agent Pipeline."
- Read-only tools: `tasks.list`, `calendar.list_today`, `learning.get_progress`,
  `workspace.get_context`, `github.repositories.list/issues.list/epics.list/pulls.list/workflow_runs.list`.
- Write tools (verified fresh in this task, see §2.3 below):
  `tasks.complete`, `github.issues.comment`, `github.issues.update`,
  `github.files.update`.
- GitHub Read-only Integration V1 Slice 1 — live in production.
- AI response language resolution (`auto`/`en`/`de`/`fa`) and RTL/LTR handling.
- Unified Execution Intent Lifecycle Foundation Slice 1 (`26f342b`).

### 2.3 Write-tool reality (freshly verified in this task)

`src/features/agent/writeRuntime.ts:43-48` — `SUPPORTED_WRITE_TOOL_IDS` is
`["tasks.complete", "github.issues.comment", "github.issues.update",
"github.files.update"]`. `github.files.update` is **live**, governed by
[ADR-0005](docs/decisions/adr/ADR-0005-code-write-mutation-boundary.md)
(Accepted). `docs/roadmap/project-workspace-implementation-roadmap-v1.md:55`
contained a stale 3-tool claim, now marked historical by that document's own
top-of-file notice; `docs/architecture/current-architecture.md` was already
internally consistent and correct on tool count (§4 of the reconciliation
doc has full evidence).

### 2.4 Personal Memory Domain (this task)

- **Personal Memory Layer v1** —
  [ADR-0010](docs/decisions/adr/ADR-0010-personal-memory-layer.md)
  (Accepted)'s Tier 1 implementation. New `personal_memory_records`/
  `personal_memory_extraction_runs` tables, owner-scoped RLS (no project
  dimension), all writes through three `SECURITY DEFINER` functions
  (`create_personal_memory_record`, `resolve_personal_memory_record`,
  `delete_personal_memory_record` — the last has no ADR-0009 analogue: a
  day-one, unconditional hard-delete erasure path per Q1) with race-safe
  duplicate suppression built in from the start —
  `supabase/migrations/20260808000000_personal_memory_records.sql`. New
  authenticated Worker route `POST /personal-memory/extraction`
  (`agent/worker/personal-memory-extraction-endpoint.ts`), explicit-user-
  trigger only per Q4 — `ENABLE_AUTO_MEMORY_WRITE` in `agent/worker/index.ts`
  is now `false`, and both legacy always-on extraction call sites
  (`extractAndSaveMemory`/`extractAndSaveMemoryFromChat`) are confirmed dead.
  Deterministic per-candidate validation with a curated sensitive-content
  heuristic (health/relationships/emotional-state excluded per Q2, in both
  the canonical TS validator and the Worker's kept-in-sync duplicate).
  `proposed` records have zero consumption anywhere per Q5 — independently
  grep-verified twice, nothing in this codebase reads
  `personal_memory_records` outside its own module and tests.
- **`user_context` write-freeze — COMPLETE** (Q3, amended). Per the
  Product Owner's amendment recorded in ADR-0010's Implementation Notes,
  every write path to the legacy `user_context` table is now closed, not
  only the two Worker extraction functions: `aiMemoryService.set`/
  `autoDetectAndSave` are removed (not merely unreachable), the automatic
  `autoDetectAndSave()` call `AppLayout.tsx` fired 5 seconds after every
  app load is removed, and `AiMemoryTab.tsx`'s per-row edit affordances and
  its "Auto-detect" button are disabled with visible, text-based
  explanations (not colour-only). Read and delete remain fully functional.
  Manual personal facts return later as `explicit_user_statement`
  `PersonalMemoryRecord`s via the upcoming review UI, not by resuming
  `user_context` writes.
- **Agent-authored-content marking fix** — `AiMemoryTab.tsx`'s `MemoryRow`
  previously rendered a `source='agent'`/`'ai'` row (LLM-extracted, never
  reviewed) with no badge at all, indistinguishable from the user's own
  words — the concrete gap ADR-0010's Problem section names. Fixed with a
  text-based "AI-written, unreviewed" badge; `aiMemoryService.ts`'s
  `MemorySource` type widened to match the existing DB `CHECK` constraint.
- **Governance: ADR-0008 dissent rule.** A Product Owner instruction,
  codified as an additive Implementation Notes section in
  [ADR-0008](docs/decisions/adr/ADR-0008-tiered-change-governance.md):
  any agent that identifies a problem in an Accepted decision must record
  the concern for the Product Owner; the current decision stands until a
  new one is recorded. Dissent is mandatory to record, never a license to
  deviate from the current decision while it stands. ADR-0008's own
  Decision/Consequences text is unchanged.
- **Independent review trail** —
  [`docs/reviews/2026-08-personal-memory-layer-review.md`](docs/reviews/2026-08-personal-memory-layer-review.md):
  initial Tier 1 review (2 MAJOR / 2 MINOR findings), remediation (task
  `5c`) including the complete `user_context` write-freeze above and an
  expanded sensitive-content pattern list, then a delta re-review verdict
  of "RE-REVIEW PASSED — CLEARED FOR MERGE DECISION" / "MERGE AS-IS".
  Design note:
  [`docs/architecture/notes/personal-memory-v1-design-note.md`](docs/architecture/notes/personal-memory-v1-design-note.md).
- **Personal memory review UI (confirm/correct/reject/delete) — Tier 2**
  (task `6`). `src/features/personal-memory/components/PersonalMemorySection.tsx`,
  composed above the existing `AiMemoryTab` inside `SettingsPage.tsx`'s
  `'ai-memory'` tab (one-line change there; `AiMemoryTab.tsx` itself not
  modified — design note explains the placement decision). Lists
  `PersonalMemoryRecord`s grouped by kind, newest first, with text-based
  status marking (Proposed/Confirmed/Corrected/Rejected — never colour-
  only); `proposed` records carry visible copy stating Q5's zero-
  consumption guarantee ("Not used anywhere until you confirm it");
  rejected records hidden by default behind a "Show rejected" toggle, with
  copy naming the Q1/Q5 duplicate-suppression-survives-rejection rule; the
  pre-correction original is never its own list entry, reachable only via
  a "View original" history affordance on its correction. Confirm/Correct/
  Reject call `resolve_personal_memory_record` via the existing service
  (correction form reuses the canonical `validatePersonalMemoryContent`,
  never a duplicated rule); Delete is available at every visible status
  (ADR-0010 Q1) via the repo's standard `AlertDialog` confirmation pattern,
  with copy stating plainly that deletion is permanent and the same fact
  may later be re-extracted. A "Check for new personal memory" button
  calls the extraction endpoint via a new
  `personalMemoryExtractionTriggerClient.ts` (mirrors
  `contextDerivationTriggerClient.ts`); a 422 `NO_SOURCE_MATERIAL` response
  renders as a human sentence, not a raw error. No consumer wired — this UI
  is the only surface where a `proposed` record is ever rendered anywhere
  in the product, independently grep-verified after implementation.
  Design note:
  [`docs/architecture/notes/personal-memory-review-ui-design-note.md`](docs/architecture/notes/personal-memory-review-ui-design-note.md).
- **Production schema alignment — COMPLETE (task `8c`, 2026-08-09).** Both
  Tier-1-reviewed migrations
  (`20260807000000_inferred_project_context_fields.sql`,
  `20260808000000_personal_memory_records.sql`) are now applied to
  production (`taqxwnlwllbywaklwyno`). Tasks `8` (403/wrong-org link) and
  `8b` (identity-gate false negative from unauthenticated RLS-blocked
  probes) both correctly stopped short of writing anything; task `8c`
  resolved the identity question via Product Owner evidence the CLI
  cannot see (browser Network tab, dashboard), then baselined the 47
  pre-existing migrations via `supabase migration repair` (history
  bookkeeping only, no SQL executed) before pushing the two new ones. Full
  evidence in §4.
- **UI copy fixes — complete (task `8`, Tier 3).** `AiMemoryTab.tsx`'s
  ADR-jargon strings replaced with user-facing effect language: the freeze
  notice no longer cites "ADR-0010 Q3" (now: "Auto-detection is disabled
  here. New memories are managed in the Personal memory section above.",
  and equivalent wording on the disabled input's title and the explanatory
  paragraph); "This memory is injected into every AI conversation." softened
  to "These legacy entries may be used to personalize AI responses." No
  behavior change; no test assertions referenced the old strings, so none
  needed updating.
- **Confirmed personal memory consumption v1 — complete (task `7b`, Tier 2).**
  [ADR-0011](docs/decisions/adr/ADR-0011-confirmed-personal-memory-consumption.md)
  (Accepted) implemented per its Product Owner Resolutions (Q1–Q5). New
  status-filtered read enforcement point:
  `personalMemoryRecordRepository.ts`'s `listConfirmedByOwner` (browser) and
  `context-builder.ts`'s `fetchConfirmedPersonalMemory` (Worker) — both
  filter `status IN (user_confirmed, user_corrected)` in the query itself,
  never in consumer code. Shared cap/formatting logic
  (10 records total, 3 per kind, most-recently-confirmed-first) exists as
  two intentionally-duplicated, equivalence-tested copies
  (`src/features/personal-memory/personalMemoryPromptSerialization.ts` and
  `agent/worker/personal-memory-prompt-serialization.ts`) — the Worker
  cannot import frontend modules, the same constraint already documented for
  the extraction endpoint's duplicated validator. All three legacy
  `user_context` readers migrated: `/chat` (system prompt), briefing
  (`/generate` + cron, user prompt, plus a deterministic Q5 indicator line
  appended only when ≥1 record was injected), and the Learn tutor
  (`useLearnAI.ts`, RLS-scoped browser read). Reasoning-mode `/chat` turns
  remain memory-free, unchanged (`reasoningPrompt.ts` already excluded
  memory; verified still true). `fetchUserMemory`/`buildMemorySection`
  (the old `user_context`-shaped formatters) deleted as genuinely dead code
  once both live call sites migrated; `user_context`'s only remaining reader
  is `AiMemoryTab` (Q3 disposition — kept read-only, no removal task
  scheduled yet). `aiMemoryService.getAsPromptContext` deleted (zero
  remaining callers after the tutor migration). Design note:
  [`docs/architecture/notes/memory-consumption-v1-design-note.md`](docs/architecture/notes/memory-consumption-v1-design-note.md).

### 2.5 Conversation Quality v1 (task `9`, Tier 2)

- **Conversation-first intent boundary — Slice 1.** Product Owner decision:
  an intent/tool card is shown ONLY on an explicit action signal; ambiguous
  signals get a conversational answer plus an optional deterministic
  trailing offer, never a card, never auto-run.
  `src/pages/ChatPage.tsx`'s binary `shouldUseReasoningForMessage` becomes a
  thin wrapper over a new `classifyMessageIntentSignal` three-way gate
  (`explicit`/`ambiguous`/`conversational`), built as two narrow, additive
  carve-outs on top of the existing, unchanged binary logic — not a
  from-scratch rewrite and not a domain-evidence-gated narrowing (which
  would have broken ordinary explicit requests like "Show me my
  repositories"; see the design note for why that approach was rejected).
  All 30 pre-existing `shouldUseReasoningForMessage` test expectations pass
  unchanged; 13 new tests added. Two recorded language-heuristic bugs fixed
  properly: German bare "offen"/"offene"/"offenen" no longer false-positives
  the `tasks` domain without an accompanying task/issue/PR noun nearby
  (`intentValidator.ts`'s `getStrongReadDomainEvidence`, now exported); the
  Persian possessive detector gains the standalone words
  خودم/خودت/خودش/... alongside `من` (safe, whole-word addition — the
  deeper bare-suffix gap the existing code comment already disclosed as
  unsafe to close via regex is left open, on purpose, not silently
  "fixed"). The trailing offer (`getAmbiguousOfferHint`/
  `getAmbiguousOfferText`) is a fixed, per-response-language string
  appended client-side after the plain-chat reply returns — never model-
  generated, never sent to the model as an instruction.
- **Tutor topic liberation — Slice 2.** `LearnAIMode` widened from a closed
  4-value union to a free-form string (`src/features/learn-ai/types.ts`);
  no schema change (`learn_ai_messages.mode` was already a plain
  `text not null` column). The four legacy values remain as
  `LEARN_AI_SUGGESTED_TOPICS` suggestion chips; `LearnAIPage.tsx` and
  `SettingsPage.tsx`'s "Default topic (optional)" both gained a free-text
  input alongside the chips, calling the same `setMode`/state update the
  chips already call. Confirmed-memory context in the tutor prompt
  (`getConfirmedMemoryPromptContext`, wired in task `7b`) verified still
  reaches `askLearnAI`'s request body as its own field — **the receiving
  server (`https://api.barakzai.cloud/analyze`) has no source in this
  repository**, so how that field is used server-side could not be
  verified or "strengthened" from here; disclosed rather than glossed over.
  Design note:
  [`docs/architecture/notes/conversation-quality-v1-design-note.md`](docs/architecture/notes/conversation-quality-v1-design-note.md).

### 2.6 Micro Breaks — Slice 1 (tasks MB-02/MB-02b)

- **Classic Pong gameplay, no persistence.**
  [ADR-0014](docs/decisions/adr/ADR-0014-micro-breaks-architecture-boundary.md)
  (Accepted). `src/features/micro-breaks/`: a pure delta-time physics engine
  (`engine/pongEngine.ts` — dt clamp/substep, wall/paddle collision,
  contact-point→angle mapping, progressive speed with a hard cap,
  degenerate-angle prevention, fixed 90s timer), a visibility-aware rAF loop
  (`engine/useVisibilityAwareGameLoop.ts` — pauses on tab-hidden, resets the
  previous-timestamp reference on resume), a Canvas renderer
  (`components/PongCanvas.tsx` — single rAF, no per-frame React state), and a
  bespoke a11y-complete overlay (`components/MicroBreakOverlay.tsx` — Esc,
  focus trap/restore, scroll-lock, `role="dialog"`). Orb visual tokens
  (`orbTokens.ts`) are shared between the existing DOM pointer-follower and
  the new canvas renderer per ADR-0014 §5. Entry points: a small
  command-palette launcher in `Sidebar.tsx` and a MobileNav icon. i18n
  en/de/fa throughout, RTL-safe via the existing `bidiText.tsx` pattern.
  Committed `549482c`.
- **MB-02b production incident fix.** A color-format bug
  (`hsl(<hex-value> / alpha)` — `--flow-*` tokens are hex, not HSL
  components; `CanvasGradient.addColorStop` throws on invalid CSS, unlike
  `ctx.fillStyle`, which silently no-ops) crashed the renderer on frame one
  in production (smartaryn.com) with no error boundary anywhere in the app,
  taking down the entire page — not just the game — and leaving Esc
  non-functional (its own listener effect never got the chance to run before
  the unmount cascade). Fixed by a new format-agnostic color normalizer
  (`colorNormalization.ts` — hex/rgb/hsl → `rgba()`, with an alpha/brightness
  visibility floor and safe fallback for unparseable input) and a
  render-exception guard in `PongCanvas.tsx` (`draw()` now catches and routes
  to an in-overlay `'error'` phase in `MicroBreakOverlay.tsx`, with full
  teardown identical to a normal exit — see ADR-0014 §3's post-MB-02b
  amendment). Reproduced and verified in a real browser (jsdom stubs canvas
  2D entirely, so it could not have caught this) via a new
  `import.meta.env.DEV`-gated harness route
  (`/__dev/micro-breaks-harness`, `MicroBreaksDevHarness.tsx`) and a new
  Playwright real-browser smoke layer (`playwright.config.ts`, `e2e/`).
  Committed `8053408`.
- **Pending gates before Slice 3** (Supabase persistence — ADR-0014 §6/§12,
  explicit PO "برو" required per its Tier-1 classification): the duration
  preset SET (60/90/120s) must be frozen (still true as of Slice 2 — see
  below), and the paddle-miss rule (floor-bounce, no lives — ADR-0014 §7)
  must be frozen before the score/session schema is designed around it.
  Neither gate is about to be touched casually; both are named explicitly so
  Slice 3 doesn't start against a still-moving target.
- **Backlog (not yet scheduled, recorded so it isn't lost):**
  1. **App-wide error boundary — high priority.** MB-02b's fix stops this
     *specific* draw exception from ever reaching React's reconciler, but
     `App.tsx` has no error boundary anywhere; any other future uncaught
     render/effect exception elsewhere in the app would still take the whole
     page down the same way. Recorded as a real hardening gap, not designed
     here (out of MB-02b's "smallest change" scope).
  2. Measured (not analytical/viewport-center) game-start position for the
     orb handoff — Slice 1's `viewportCenter()` assumption breaks under
     safe-areas/orientation; scheduled for Slice 2's mobile/PWA acceptance
     work (ADR-0014 §4), not yet done as of this entry.
  3. e2e-vs-production-database isolation before Slice 3: the new Playwright
     harness currently runs against the real production Supabase project
     (`VITE_SMARTFLOW_SUPABASE_MODE=production`, same anon key already public
     in the client bundle) because Micro Breaks itself never calls Supabase —
     that stops being safe the moment Slice 3 adds real writes, and needs a
     resolved local/staging target before then.
  4. `SmartflowPointerFollower`'s pointer-lerp (`current += (target -
     current) * 0.085`) is frame-rate-dependent, not delta-time-based —
     pre-existing (task 17h), unrelated to Micro Breaks' own delta-time
     engine, noticed only because the two now sit side by side.
  5. `colorNormalization.ts`'s `MIN_VISIBLE_ALPHA`/`MIN_VISIBLE_BRIGHTNESS`
     floors are untested against an actual dark `--flow-*` token — none of
     today's palette needs them; worth a look if a dark orb color is ever
     added.
  6. Old git stashes in this working tree have not been reviewed/triaged.
  7. Orb-click entry (making the pointer-events:none orb itself clickable) —
     explicitly backlog per ADR-0014 §10, needs its own core-only hit-target
     design.

## 3. Verified NOT implemented

Confirmed from code, not assumed (full detail in the reconciliation doc §6):

- Real `ProjectContext` derivation from evidence — **now partially resolved**
  by the Inferred Project Context Layer (§2.1): `rebuildProjectContext`
  returns a real `context_ready` result when at least one eligible
  `user_confirmed`/`user_corrected`/`proposed` inferred field exists for the
  project; it still returns `snapshot_ready_context_not_derivable` for a
  project with raw evidence text only and no inferred fields yet — no
  deterministic evidence-text-to-structured-fact transformation exists
  independent of the LLM-assisted path, and no semantic document parser is
  implemented.
- An orchestrated Evidence Acquisition Service (multi-adapter selection/coordination).
- Any provider-backed Evidence Source Adapter (GitHub API, Gmail, Calendar).
  Repository Documents Adapter is the only adapter and is document-only.
- An LLM anywhere in the ProjectEvidence or Project Brief path itself — the
  LLM-assisted path (§2.1) writes only to the separate, non-canonical
  `InferredProjectContextField` aggregate, never to `ProjectEvidence`,
  exactly as ADR-0009/`project-domain.md` §6 require.
- Browser-initiated repository refresh, or project creation/edit/archive
  from the browser.
- EPIC-08 Slices 4–5 (read-back verification, pull-request creation) —
  `githubFilesUpdateHandler.ts` checks only that the mutation response
  contains the expected fields; there is no independent re-read/compare.
- EPIC-09 (autonomous chaining, multi-file changes, automatic retry/merge) —
  no commits exist.
- **`explicit_user_statement` capture surface.** Manual personal-fact entry
  (as a properly-provenanced `PersonalMemoryRecord`, replacing the old
  `user_context` manual-entry UI per ADR-0010 Q3) still has no capture
  surface — unaffected by task `7b`'s consumption work, which only wired
  existing confirmed/corrected records into prompts, not a new write path.
- Memory-derived proactive suggestions, semantic/vector retrieval over
  personal memory, per-kind consumption toggles — all named as deferred in
  [ADR-0011](docs/decisions/adr/ADR-0011-confirmed-personal-memory-consumption.md)
  §5, not designed.
- Conversation memory, semantic/vector memory, RAG.

## 4. Current blockers / open decisions

- **RESOLVED: production schema now aligned through `20260808000000` on
  `taqxwnlwllbywaklwyno` (task `8c`, 2026-08-09).** Full story, in order:
  - Task `8b`'s identity-gate "zero rows in every table" finding was a
    **false negative**, not evidence of an empty/wrong database: those
    probes used the anon key with no user JWT, and every one of those
    tables has an owner-scoped RLS policy — an unauthenticated request
    correctly returns `Content-Range: */0` regardless of how much real
    data exists, because RLS hides all of it from a caller with no
    `auth.uid()`. The Product Owner separately confirmed identity via the
    browser's own Network tab (`barakzai.cloud` calling
    `taqxwnlwllbywaklwyno.supabase.co`, HTTP 200 auth) and the dashboard
    (31 MB, 3 MAU) — evidence a probe cannot fake. **Lesson recorded:**
    production identity/data checks against RLS-protected tables must be
    structure-based (schema introspection) or auth-bypassing
    (service-role), never row-count probes with an unauthenticated key —
    a zero count there proves RLS works, not that the database is empty.
  - Structural spot-check (read-only, this time via the PostgREST OpenAPI
    schema document — table/column/RPC existence, not row data): all
    ADR-0004/0005/0007-era objects confirmed present
    (`agent_write_log`, `agent_code_proposal_approvals`, `project_records`,
    `project_evidence`, `project_evidence_observations`,
    `github_connections`, and ADR-0007's `create_project_evidence_with_
    observation` SECURITY DEFINER function) — 45 tables total before this
    task's push. `inferred_project_context_fields` and
    `personal_memory_records` correctly absent. One unrelated, non-blocking
    anomaly noted: `ai_news_items` (a table `20260619140000_drop_ai_news_
    items.sql` should have removed) is still present — production's schema
    history isn't a perfectly clean replay of every migration in order, but
    this doesn't affect either target migration and wasn't investigated
    further.
  - Both target migrations re-confirmed purely additive (own new tables'
    `ALTER ... ENABLE ROW LEVEL SECURITY` and idempotent `DROP POLICY IF
    EXISTS` only — no existing object touched) before proceeding.
  - Baselined via `supabase migration repair --status applied` for exactly
    the 47 pre-existing migration versions (executes no SQL against the
    user schema — history bookkeeping only). Verified via
    `supabase migration list`: 47 remote-matched, 2 pending
    (`20260807000000`, `20260808000000`) — exactly as expected, nothing
    more.
  - `supabase db push` applied both. Post-push structural verification
    (OpenAPI schema + RLS-enforcement probes): table count 45 → 49 (both
    record tables + both run tables); columns match the migration files
    exactly; all 5 new `SECURITY DEFINER` functions present
    (`create_inferred_context_field`, `resolve_inferred_context_field`,
    `create_personal_memory_record`, `resolve_personal_memory_record`,
    `delete_personal_memory_record` — no `delete_inferred_context_field`,
    correctly, since ADR-0009 has no delete-RPC analogue to ADR-0010 Q1);
    an anon-key, no-JWT read against all four new tables returns HTTP 200
    with an empty array (RLS active and correctly owner-scoping, not
    erroring and not open). `supabase migration list` post-push: all 49
    local versions now remote-matched, zero drift.
  - The stale `dailyflow` link (ref `ljthmdhvjlsnizpjqxic`, org
    `nrihbopynxqupitjkkka`, HTTP 403) remains unexplained historical
    context — plausibly an old/abandoned project from before this account's
    current organization, never actually production. Not investigated
    further; no action needed since the identity question is now closed.
- **ProjectContext derivation gap — resolved for the LLM-extraction path.**
  The Inferred Project Context Layer v1 (§2.1) closes this for
  LLM-confirmed/corrected content; a semantic-document-parser path remains
  unbuilt and is not currently planned.
- **OPEN CONDITION: live-Supabase execution of BOTH gated RLS suites
  pending — run at first opportunity.**
  `supabase/tests/inferred_project_context_fields.rls.test.ts` and
  `supabase/tests/personal_memory_records.rls.test.ts` (both skipped by
  default, `SMARTFLOW_RUN_LOCAL_SUPABASE=1`) have not yet been executed
  against a real local Supabase/PostgREST stack — attempted again in tasks
  `5d` and `8`, blocked for the same reason each time it has been attempted:
  a sibling project (`ai-automation-agent`) occupies the default Supabase
  ports (54321/54322/54323/54324/54327); not stopped, per policy;
  `supabase/config.toml` not edited (verified via `git status` after each
  attempt). The underlying `SECURITY DEFINER` function logic the
  project-context suite exercises has been independently verified live
  twice via a disposable, non-Supabase Postgres 17 container (raw SQL,
  including a genuine concurrent-race proof); the personal-memory suite's
  equivalent logic (erasure-clears-suppression, race-safe duplicate
  handling) has been verified only by careful code reading, not by any
  live execution, disposable-container or otherwise — only the
  PostgREST/GoTrue integration layer remains unverified live for both.
- **Adapter execution-location decision** (open): where a repository-document
  adapter physically executes is unresolved
  (`docs/architecture/project-evidence-acquisition.md` §25) — the browser
  cannot read a server-side git checkout; today's adapter only runs via a
  local operator CLI.
- **Several other Slice-4A/4B-era open decisions remain unresolved** (durable
  vs. on-demand evidence storage, atomic vs. per-item acquisition
  acceptance, deletion/tombstone policy, cross-project evidence sharing,
  LLM-assisted evidence promotion) — see
  `docs/architecture/project-evidence-acquisition.md` §25 for the full list;
  none are silently decided.
- **Known limitations carried forward from the Personal Memory Layer v1
  review trail** (task `5d`, see §2.4):
  1. The sensitive-content heuristic (`SENSITIVE_CONTENT_PATTERNS` in
     `personalMemoryRecordValidation.ts` and its Worker duplicate) is a
     curated keyword filter, not a semantic classifier. Three fresh
     adversarial misses were found and disclosed during re-review:
     `stepson` (no word boundary before "son"), `MRI scan`, and `physical
     exam`. Queued for the next touch of the validator, not a merge
     blocker — the governing safety layers are Q5 (a `proposed` record has
     zero consumption until confirmed) and Q1 (unconditional hard delete).
  2. `agent/worker/index.ts`'s `extractAndSaveMemory`/
     `extractAndSaveMemoryFromChat` still contain dead `user_context`
     `on_conflict` POST bodies, confirmed unreachable (`ENABLE_AUTO_MEMORY_
     WRITE = false`, no other call site exists) — a MINOR dead-code-removal
     item for a future touch of this file, not a live risk.
  3. `20260807000000_inferred_project_context_fields.sql`'s
     `content_fingerprint` column comment overclaims that the hash covers
     `project_id` (the actual hash is `(kind, content)` only, matching
     `computeInferredFieldContentFingerprint`'s real signature) — not a
     security issue (the partial unique index adds `project_id` as a
     separate index column regardless), and this committed migration was
     deliberately left untouched per this task's scope; queued for a
     future docs-only pass.
- **Stale-doc correction (task `7b`, ADR-0008 dissent rule).** This section
  previously claimed "`/chat` persists the internal reasoning prompt into
  `agent_chat_messages` instead of the user's actual message when used as a
  reasoning transport." Reading the live code
  (`agent/worker/index.ts`'s `mode === 'reasoning'` early return, added by
  commit `fa843a1` on 2026-07-24 — before this claim's own last edit date of
  2026-08-07) shows this is no longer true: that branch persists nothing to
  `agent_chat_messages` at all, and its own code comment says so explicitly.
  Removed rather than left inaccurate, per ADR-0008's dissent rule
  ("stale docs get fixed, not preserved" once a concrete contradiction is
  found and evidenced) — first flagged as a contradiction in ADR-0011's own
  Context section (task `7a`), corrected here.
- **Technical debt carried forward** (unchanged by this task, condensed from
  the prior version — see git history of this file for the original
  detailed writeups if needed):
  - Write execution is intentionally narrow; other registry write
    definitions are contract-only until a handler, policy path, tests, and
    safety review exist.
  - `/chat` has no `responseSchema`; deterministic rescues in
    `validateAgentIntentProposal` are load-bearing, not defensive slack.
  - GitHub OAuth callback returns raw JSON instead of redirecting into the app.
  - No `tsc --noEmit` gate exists in either `package.json`; running it
    directly surfaces pre-existing type errors unrelated to recent work.
  - `github_connections.repository_names_cache`/`repository_names_cached_at`
    exist in the migration but not yet in the hand-maintained `types.ts`
    snapshot — next schema change should regenerate rather than add a second
    drift.
  - `agent/worker/context-derivation-endpoint.ts`'s per-kind content
    validation duplicates `inferredProjectContextFieldValidation.ts` (the
    Worker cannot import frontend modules) — kept manually in sync, guarded
    by `contextDerivationValidationEquivalence.test.ts`.
  - `create_inferred_context_field`'s evidence-linkage check is scoped to
    project+owner membership, not to the specific derivation run's own
    evidence snapshot (accepted, documented in the migration — the Worker's
    own candidate filtering already narrows correctly in the one production
    caller today).

### Design debt register (Product Owner's video review, task `8`)

1. Flat 13-item sidebar navigation does not reflect the Personal Digital
   Representative identity ([ADR-0006](docs/decisions/adr/ADR-0006-canonical-product-identity.md))
   — a future two-level information architecture is the likely direction,
   not designed here.
2. Internal-jargon leakage into user-facing copy (ADR numbers/section
   references surfacing in UI strings) — partially fixed this task
   (`AiMemoryTab.tsx`, §2.4); a periodic sweep for the same pattern
   elsewhere in the app is still needed.
3. Zero-heavy empty states and a repeated stats-card formula across pages —
   cosmetic, revisit at the next dedicated polish pass, not currently
   blocking anything.
4. PWA service-worker update strategy (task `8c`): a stale cached
   service worker caused Chrome/Edge to diverge on which build a user saw
   after a deploy; the SW should self-refresh (e.g. `skipWaiting` +
   `clients.claim()`, or a user-visible "update available" prompt) rather
   than silently persisting an old cache — not designed here.

## 5. Next agreed work (Product-Owner-approved sequence)

1. ~~Retroactive independent review of ProjectBrief and Project Workspace~~
   — **complete**: [`docs/reviews/2026-08-projectbrief-workspace-review.md`](docs/reviews/2026-08-projectbrief-workspace-review.md)
   (0 blockers, 1 major finding R-1, 3 minor; R-1 fixed in commit `7d63c76`).
2. ~~LLM-assisted Context Derivation v1~~ — **merged/complete.**
   [ADR-0009](docs/decisions/adr/ADR-0009-inferred-project-context-layer.md)
   (Accepted); Tier 1 implementation independently reviewed, remediated, and
   re-reviewed under ADR-0008 —
   [`docs/reviews/2026-08-inferred-context-layer-review.md`](docs/reviews/2026-08-inferred-context-layer-review.md)
   ("RE-REVIEW PASSED — CLEARED FOR MERGE DECISION"). See §2.1.
3. ~~Inference confirm/correct UI in Project Workspace (Tier 2)~~ —
   **merged/complete.** See §2.1. Independent review may follow post-merge
   per ADR-0008's Tier 2 path.
4. ~~Personal Memory v1~~ — **merged/complete.**
   [ADR-0010](docs/decisions/adr/ADR-0010-personal-memory-layer.md)
   (Accepted); Tier 1 implementation independently reviewed, remediated
   (complete `user_context` write-freeze per the Q3 amendment; expanded
   sensitive-content coverage), and delta re-reviewed under ADR-0008 —
   [`docs/reviews/2026-08-personal-memory-layer-review.md`](docs/reviews/2026-08-personal-memory-layer-review.md)
   ("RE-REVIEW PASSED — CLEARED FOR MERGE DECISION"). Also codifies the
   ADR-0008 dissent rule (§2.4). See §2.4 for full detail.
5. ~~Personal memory review UI (confirm/correct/reject/delete) — Tier 2~~ —
   **complete.** See §2.4. Reused the interaction pattern already proven in
   `src/features/projects/components/InferredContextSection.tsx`. No
   consumer wired (§3) — that remains a separate, future, Product-Owner-
   sequenced decision.
6. ~~Confirmed personal memory consumption v1 — Tier 2~~ — **complete.**
   [ADR-0011](docs/decisions/adr/ADR-0011-confirmed-personal-memory-consumption.md)
   (Accepted); all three legacy `user_context` consumers (`/chat`, briefing,
   Learn tutor) migrated to a status-filtered confirmed-memory read. See
   §2.4.
7. ~~Conversation Quality v1: conversation-first intent boundary + tutor
   topic liberation — Tier 2~~ — **complete.** See §2.5. Design note:
   [`docs/architecture/notes/conversation-quality-v1-design-note.md`](docs/architecture/notes/conversation-quality-v1-design-note.md).
   Independent review may follow post-merge per ADR-0008's Tier 2 path.

8. ~~Micro Breaks Slice 1 (Classic Pong gameplay + entry points, no
   persistence) + MB-02b production-incident fix~~ — **merged/complete.**
   [ADR-0014](docs/decisions/adr/ADR-0014-micro-breaks-architecture-boundary.md)
   (Accepted, amended post-MB-02b). See §2.6.
9. Micro Breaks Slice 2 (combo, sensory final wave, duration-preset Settings
   UI, mobile/PWA acceptance, bounded polish) — **next**, per ADR-0014 §12
   sequencing. No persistence in this slice either; Slice 3 (Supabase) stays
   gated behind the §2.6 pending gates and an explicit PO "برو".

Superseded/completed sprint milestones from the prior version of this
document have been removed rather than carried forward as history; git
history of this file remains the record of what was previously claimed and
when.
