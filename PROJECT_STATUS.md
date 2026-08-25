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

### 2.7 Orb Journey — full feature line (tasks MB-05 through MB-24) — SHIPPED

**Second Micro Breaks session type: an untimed room sequence, now with full
persistence.** [ADR-0015](docs/decisions/adr/ADR-0015-orb-journey-architecture.md)
(Accepted, extends ADR-0014; supersedes the earlier MB-04 "Survival mode"
plan outright). `src/features/orb-journey/`: a pure room state machine
(`roomEngine.ts`), a design-token-driven abstract room theme layer
(`roomTheme.ts`), and a separate canvas renderer (`JourneyCanvas.tsx`,
deliberately not a fork of `PongCanvas.tsx`, so Classic Pong has zero diff).
Entry: a session-type choice screen ("Quick Break" vs "Orb Journey" vs, once
a checkpoint exists, "Continue Journey") inside the existing bespoke overlay
(`MicroBreakOverlay.tsx`), reusing ADR-0014's a11y/exit/crash-fail-safe
machinery unchanged throughout. Started as MB-05's 2-room slice
(`cf438d9`) and grew through MB-24 into the following shipped state:

- **Three rooms, two theme families.** Room 1 and Room 2 use the Focus/Tasks
  abstract theme (checkmark-like forms, list lines — MB-05); Room 3 uses the
  Rhythm/Calendar theme (grid lines, horizontal bars — MB-13 `6e6fd0a`,
  ADR-0015 §12). All theming is design-token-only; zero reads from any real
  task/calendar/finance data path, preserving ADR-0014 §1's trust boundary.
  The "cleared" acknowledgement phase triggers after Room 3.
- **Drifting speed-orbs — reward/penalty roles with paddle-block
  interaction.** Introduced MB-08 (`c48b344`) as a temporary/timed
  Calm(reward)/Haste(penalty) multiplier; revised MB-10 (`338ac3d`, PO
  playtesting decision, ADR-0015 §11 final) to persistent (non-expiring)
  speed effects with the corrected mapping — reward = speed-up, penalty =
  speed-down — plus a new penalty-orb/paddle interaction (a safe block, no
  speed change) and a penalty applied on an uncaught bottom-miss. Role is
  always distinguishable by rim shape (smooth=reward, notched=penalty), not
  color alone.
- **Two-strike room-restart rule.** MB-18 (`26ccff7`, ADR-0015 §3 final,
  frozen before persistence work): a room's 1st floor miss re-serves the
  ball only — speed, combo progress, and active drifting orbs are all
  preserved, not a restart; a 2nd miss (without reaching the room's goal in
  between) triggers the original full room-local restart.
- **Fixed 500px play area** (`ADR-0015 §13`). A progressive play-area-growth
  mechanic was built and tuned across three rounds — MB-14 (`f55d059`,
  formula + room-transition resize), MB-15 (`6088569`, narrowed Room 1's
  baseline to a genuinely narrow 300px after PO browser feedback), MB-17
  (`a76cc1f`, fixed a real ball stretch-distortion bug the growth mechanic's
  canvas-buffer/CSS-size mismatch caused) — then retired entirely in MB-22
  (`4941d99`) after real multi-room playtesting showed room-to-room growth
  broke visual focus rather than reinforcing progression. Every Journey room
  now uses one fixed 500px width; progression is carried by theme, room-index
  difficulty, and drifting-orb spawn cadence instead.
- **Crash-guard coverage — render path and physics/VFX path.** The render-path
  guard shipped with MB-02b (`8053408`, Quick Break, catches a `draw()`
  exception and routes to an in-overlay `'error'` phase). MB-11 (`de64ff2`)
  closed a second, previously-uncovered gap: `onTick`'s physics and
  particle-detection logic sat outside that guard, so an uncaught exception
  there silently killed the rAF chain (paddle stayed responsive via its own
  listener; everything else froze, no error surfaced). Both draw and
  physics/VFX exceptions now route through one unified `crash()` path,
  backed by a permanent fuzz/soak regression test.
- **The 90s-freeze fix.** MB-12 (`bd22218`): Journey rooms had silently
  inherited Quick Break's fixed 90s `durationSeconds`, whose `'ended'`-state
  freeze is correct and load-bearing for Quick Break but was never meant to
  apply to Journey — after 90 continuous seconds of play, Journey silently
  froze with no exception thrown (MB-11's crash guard correctly didn't fire,
  since nothing crashed). Journey now gets an unbounded (`Infinity`)
  duration so the freeze condition is structurally unreachable.
- **Cursor-hidden gameplay (Quick Break + Journey).** MB-16 (`e1b6af0`): the
  native OS cursor is hidden inside the play area's canvas element for the
  full mount lifetime of both session types — the paddle is the only visual
  pointer. The choosing/error phases keep a normal cursor for button
  interaction.
- **Full Supabase persistence — checkpoint model, both migrations applied to
  production.** Designed in MB-19 (`40c93b6`, ADR-0015 §14): `journey_progress`
  (one updatable row per user — farthest room, best total score, RLS
  owner-only SELECT/INSERT/UPDATE/DELETE) and `journey_runs` (append-only
  session log, client-generated id for idempotent retry, RLS owner-only
  SELECT/INSERT/DELETE, no UPDATE policy) — migration and service layer
  written to disk only at that point, explicitly not applied. Wired into
  gameplay in MB-20 (`dcdce9e`): non-blocking room-completion and
  session-end writes covering all 4 exit paths, a localStorage offline queue
  with idempotent flush on load/online, and the additive "Continue Journey"
  entry point (starts at the first room of the stored farthest room, never
  mid-room physics state). Extended in MB-23 (`f86fe70`, ADR-0015 §14
  extension) with a `checkpoint_score` column, written in the same upsert as
  `farthest_room` on room-completion (not on score-only improvements, so an
  unearned score can't overwrite the checkpoint) — "Continue Journey" now
  restores both the correct room AND the correct score, not just the room.
  Both migrations (`supabase/migrations/20260820000000_journey_persistence.sql`,
  `supabase/migrations/20260820010000_journey_checkpoint_score.sql`) are
  applied to production (`taqxwnlwllbywaklwyno`) as of MB-24 — a
  database-only Tier-1 step with no corresponding code commit.

**Not yet confirmed by the Product Owner:** cross-device sync — "Continue
Journey" on a second device/session correctly showing both the stored room
AND score — has **not** been confirmed in a real two-device manual test.
This capability's status is **"shipped, pending final PO manual
confirmation,"** not "fully verified." Do not treat it as confirmed until
that manual pass happens.

**Retired/superseded design decisions (for a reader's clarity):**

- **Survival mode** (the pre-MB-05 "sixth Pong mode" plan) → fully replaced
  by Orb Journey as its own session type; ADR-0015 supersedes that plan
  outright rather than extending it.
- **Room 2's static breakable obstacle** (MB-07, `2917107`) → retired MB-09
  (`b1c1c1a`, PO decision after playtesting both mechanics together); Room 2
  is now drifting-orbs-only. The engine-level obstacle capability
  (`PongObstacleConfig`/`PongObstacleState`) is kept as unused infrastructure
  for a possible future room, not removed (ADR-0015 §10).
- **Progressive play-area growth** (MB-14) → retired MB-22 (`4941d99`); see
  the fixed-500px bullet above (ADR-0015 §13).

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

- **CI-01 (PR gate + test-gated deploy): authored on branch, not merged.**
  `.github/workflows/ci.yml` (new — typecheck/test/build on every PR and
  push to `main`, lint advisory via `continue-on-error` until LINT-01) and
  a 3-line `npm test` insertion into `deploy-cloudflare-pages.yml` (deploy
  can no longer run if tests fail), on branch `ci/ci-01-pr-gate`. Branch
  protection for `main` is not configurable from the repo — PO must enable
  "require CI" under GitHub → Settings → Branches. Worker deploy stays
  manual, untouched by this task.
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
  - **i18n leak (task 41, same family as task 33): "This action was
    rejected." renders in English inside a Farsi conversation.** Source:
    `ChatPage.tsx:1362`'s `t('agent_intent_rejected')` call. Not a missing
    translation — a real Farsi string exists
    (`src/i18n/index.ts:2911`, "این اقدام رد شد."). Root cause is a
    language-SOURCE mismatch: `useT()` (`src/i18n/index.ts`'s `t()`)
    resolves against the app's INTERFACE language setting
    (`useAppearance(s => s.language)`), not the current conversation's own
    `responseLanguage` (an independently auto-detected/selected per-message
    field on `AgentReasoningResult`) — so any user whose interface language
    differs from the language they are actually chatting in sees this one
    UI-chrome string in the wrong language, same as task 33's own leak
    class. Not fixed here (task 41's explicit scope was to note it, not
    resolve it) — likely needs either this specific call site to read
    `responseLanguage` instead of `useT()`'s interface language, or a
    broader pass identifying every other agent-intent-panel string with
    the same mismatch risk.
  - INC-01 follow-up: dedicated provider-unavailable lane in ChatPage
    overlay instead of reusing 'unsupported'; currently degrades silently
    on the mode:'reasoning' path.
  - **DATE-02 (not started): `buildPrompt`'s briefing-mode `today` line has
    the same class of bug DATE-01 just fixed for `/chat`.** Calls
    `new Date().toLocaleDateString(...)` directly inside the function
    (`agent/worker/prompt-builder.ts`'s `buildPrompt`) — no injected clock
    (untestable — no test asserts this line's content at all, confirmed by
    grep), and no `timeZone` applied (Workers runtime defaults to UTC, so
    a briefing generated late in the evening in the user's own zone can
    show the wrong calendar day). Same fix pattern as DATE-01: explicit
    `now`/`timeZone` parameters, timezone reused from wherever the
    briefing's own caller already resolves one (or `/chat`'s per-request
    resolution pattern, if briefing generation has no equivalent yet — not
    investigated as part of DATE-01, out of that slice's scope).

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
9. ~~Orb Journey (tasks MB-05 through MB-24): 3-room untimed session type,
   drifting speed-orbs, two-strike restart, crash-guard/freeze fixes,
   cursor-hidden gameplay, full Supabase persistence~~ — **shipped.** See
   §2.7 for the full arc and commit trail.
   [ADR-0015](docs/decisions/adr/ADR-0015-orb-journey-architecture.md)
   (Accepted). **One item still open:** cross-device "Continue Journey" sync
   is unconfirmed by the PO in a real two-device test (§2.7) — not a merge
   blocker, but not yet closeable as fully verified either.
10. Micro Breaks Slice 2 (combo, sensory final wave, duration-preset Settings
    UI, mobile/PWA acceptance, bounded polish) — still open, per ADR-0014
    §12 sequencing; not addressed by the Orb Journey work above, which
    proceeded as its own separate track (ADR-0015) rather than as this
    slice.
11. **Deterministic bank-statement import + batch write governance —
    committed `a557839`; not pushed/deployed; migrations not applied; smoke
    not run.**
    [ADR-0017](docs/decisions/adr/ADR-0017-deterministic-bank-import-governance.md)
    (Status: Proposed). Root cause (task 44): the PO could not import a
    Sparkasse statement — the PDF chat-attach path was blocked by an
    unrelated 10 MB client constant, and the CSV path's own hint described
    a schema no Sparkasse export actually produces. PO decision (task 45):
    deterministic parsing for money (model extraction rejected — a
    silently mis-read amount is worse than a failed import) plus bringing
    bulk financial writes under this codebase's write-governance model.
    - **Slice 1 (parser)** — pure, dependency-free CSV-CAMT V2 / "CSV mit
      Kategorien" parser, quarantine-with-threshold (20%) row validation
      (PO decision, amending the original fail-closed draft — see the
      ADR's own amendment). `shared/bankStatementParser.ts` +
      `shared/bankStatementParser.test.ts` (51 tests) +
      `shared/__fixtures__/bankStatements/*.csv`. Not yet imported by
      anything at this slice.
    - **Slice 2 (batch proposal + governance) — this task.** Makes the
      parser's output an approvable, executable write proposal under
      ADR-0012/0017. New write intent `import_bank_statement`
      (`shared/writeIntentRegistry.ts`), registry-wide new field
      `exposure: 'chat' | 'ui-only'` (this intent is the first `'ui-only'`
      entry — see the ADR's task-45c amendment for the "two-view registry"
      split this establishes for future domains). Server-side batch
      commit under `service_role` (`agent/worker/index.ts`'s
      `POST /finance/import-batch/preview` + `/commit`,
      `agent/worker/flow-write-policy.ts`'s `executeBatchFinanceImport` +
      the `finance_import_batches` locking primitives) — closes an
      RLS-bypass gap present even in today's existing single-transaction
      finance write. All-or-nothing execution; batch undo; one ledger row
      per batch via the existing `recordProposalOutcome` choke-point
      (ADR-0016) — rejection needed zero new code, reusing the existing
      `POST /agent/proposal-outcome` endpoint as-is. The old
      `BankImportTool.tsx` (PDF+Gemini path) is untouched and still the
      PO's live bridge — retiring it is a later, separate slice per the
      ADR, not done here.
    - **Verification:** target suites + full suite green (3480 passed, 76
      skipped, 2 pre-existing environment-only failures unrelated to this
      work); `npm run typecheck` passing against baseline; Gemini
      structured-output schema changed (enum narrowed to exclude the new
      `'ui-only'` intent) — snapshot regenerated and diff-inspected
      (`shared/reasoning-response-schema.snapshot.json`).
    - **NOT done — explicit gates before this can ship:**
      1. **Committed as `a557839` on `main`; not pushed or deployed yet**
         (pushed by the PO, not automatically).
      2. **Two migrations authored, NOT applied to any database:**
         `supabase/migrations/20260822000001_finance_import_rows.sql`,
         `supabase/migrations/20260822000002_finance_import_batches.sql`
         (plus an undo-kind CHECK-constraint widen,
         `20260822000000_widen_flow_write_undo_kinds_import_bank_statement.sql`).
         Requires `supabase db push` with explicit PO authorization, same
         policy as every other pending migration in this file.
      3. **`provider-contract-smoke` (5/5) not run.** No `GEMINI_API_KEY`
         available in the environment this was built in — required before
         deploy per this repo's own 28b policy (schema changes require a
         live smoke pass, not just the snapshot diff).
      4. **Retention/expiry for `finance_import_batches` is a named,
         deferred gap**, not implemented — see the ADR's own task-45c
         amendment for what's deferred and why it's accepted as low-severity
         for now.
      5. **No live-Supabase RLS test for `finance_import_batches` or its
         sibling `finance_import_rows`** — both are `service_role`-only
         tables (no `authenticated`/`anon` grant at all), so the
         `project_records.rls.test.ts`-style owner-isolation pattern
         doesn't apply the same way; a static migration-structure test
         exists for `finance_import_batches`
         (`supabase/tests/finance_import_batches.migration_structure.test.ts`)
         but `finance_import_rows` still has neither.
12. **Capability-oriented AI provider abstraction — S0 through S4 all
    merged to `main`** (S3+S4 landed together as PR #164, "S3+S4 combined,"
    a PO decision superseding the separate-PR plan S3/S4's own branches
    were authored under — no separate S3 PR was opened). **S1b (second
    TextGenerationProvider, Cloudflare Workers AI) — merged to `main` via
    PR #165** (this entry previously read "not merged"; stale — corrected
    per ADR-0008's dissent rule, `feat/s1b-workers-ai-text` merged
    `5182681`, confirmed from `git log`). **S1c (fallback text-generation
    chain) — authored on branch `feat/s1c-text-fallback`, PR opened, not yet
    merged — see its own entry below.**
    [ADR-0018](docs/decisions/adr/ADR-0018-capability-oriented-ai-provider-abstraction.md)
    (**Status: Accepted** — PO approved 2026-08-22, all five open questions
    answered yes). Follows directly from INC-01 (2026-08-22 Gemini 429
    outage, see §6): PA-01 confirmed every AI call in `agent/worker/` is a
    direct, unabstracted `fetch()` to `generativelanguage.googleapis.com`
    (17 call sites), so ADR-0006's "replaceable mechanism" claim for
    providers was not true of the code. Also amends ADR-0008 with four
    governance items decided the same session — see ADR-0008's own
    "Amendments (2026-08-22)" section.
    - **S0 — merged.** `agent/worker/providers/types.ts` defines the three
      capability contracts (`TextGenerationProvider`,
      `StructuredGenerationProvider`, `EmbeddingProvider`) per the ADR's
      Decision 1–2; `providers/index.ts` re-exports them plus
      `ProviderUnavailableError`. Type-level test:
      `providers/providerInterfaces.test.ts`.
    - **S1 (this slice) — `GeminiTextGenerationProvider` + failure
      persistence, zero behavior change for callers.**
      `providers/gemini/GeminiTextGenerationProvider.ts` implements
      `TextGenerationProvider`: URL/`system_instruction`/role-mapping/
      `generationConfig`, `thinkingConfig` passed through
      `providerOptions` only (never defaulted inside the adapter — a
      model-specific quirk must not become adapter policy),
      finishReason mapped to the neutral `'stop'|'length'|'other'` enum.
      `providers/createProviders.ts` is the one factory call sites use
      instead of importing the Gemini class directly. Migrated exactly the
      4 `[TEXT_GEN]` call sites (PA-01 §2): `index.ts`'s `callGemini`
      (briefing), `callGeminiChat` (`/chat` mode=chat),
      `handleDocumentAnalyze` (`/documents/analyze`), and
      `document-memory-extraction-endpoint.ts`'s `transcribePdf`.
      `ProviderFailureTaxonomy`/`ProviderCallError` unified into
      `providers/providerFailureTaxonomy.ts`, imported by
      `document-memory-extraction-endpoint.ts` and
      `context-derivation-endpoint.ts` (the duplicate in
      `personal-memory-extraction-endpoint.ts` is untouched — its own
      Gemini calls are all structured generation, S2 scope, not this
      slice's). `providers/failureEvents.ts`'s `recordProviderFailure` is
      fail-safe (any persistence error is caught, logged once with
      `console.warn`, swallowed — the caller's own request is never
      affected) and is called from the adapter's `ProviderUnavailableError`
      path with `capability: 'text_generation'`.
      Verification: all 4 migrated endpoints' EXISTING tests pass
      UNCHANGED (219 tests across `index.test.ts`,
      `document-memory-extraction-endpoint.test.ts`,
      `chat-attachment-context.test.ts`,
      `context-derivation-endpoint.test.ts` — the zero-behavior-change
      proof) plus new tests: `GeminiTextGenerationProvider.test.ts` (28),
      `failureEvents.test.ts` (5). Two of the four migrated call sites
      (briefing/`callGemini`, `/documents/analyze`) had **no prior test
      coverage at all** before this slice — flagged, not backfilled (out
      of this slice's explicit scope); their request shape is exercised
      indirectly via the adapter's own tests. Two narrow, deliberate,
      untested normalizations from unifying 4 hand-written fetches into
      one adapter: every turn now carries an explicit `role` (Gemini
      documents an omitted role as defaulting to `'user'` for a
      single-turn call — a no-op for the model), and a multimodal
      attachment part now always comes AFTER the text part (previously
      `transcribePdf` put it before) — part order within one Gemini
      `content` has no documented semantic meaning. `provider-contract-smoke.ts`
      gained a 6th check (`checkTextGenerationAdapterContract`) exercising
      the adapter's own real request/response round trip; existing 5
      checks unchanged.
    - **Migration — APPLIED to production 2026-08-23** (this entry
      previously read "authored, NOT applied"; stale, corrected):
      `supabase/migrations/20260823000000_provider_failure_events.sql` —
      columns per Decision 6 (`id`, `capability`, `provider_id`,
      `http_status`, `occurred_at`, `request_id`); RLS enabled, zero grants
      to `anon`/`authenticated`, `service_role` only — same pattern as
      `finance_import_batches`. Static structure test:
      `supabase/tests/provider_failure_events.migration_structure.test.ts`.
      The deploy-order note this entry previously carried ("apply the
      migration before deploying the S1 Worker") is now moot — the
      migration is applied, so `recordProviderFailure`'s fail-safe
      missing-table path is no longer the live state.
    - **DEPLOY ORDER (MIG-01b, 2026-08-23): deploy requires EITHER the old
      account recharged (`gemini-2.5-flash`, reached only via an
      explicitly env-pinned `GEMINI_MODEL` — `gemini-2.5-flash` is
      otherwise unavailable to new keys) OR a billing-enabled new key
      (`gemini-3.6-flash`, the default in `agent/worker/geminiModel.ts`
      and `wrangler.toml`).** Whichever it is, `provider-contract-smoke`
      must show 6/6 against that SAME model production will actually use
      — a 6/6 run against one model is not evidence for the other; see
      that script's own `GEMINI_MODEL`/`SMOKE_DELAY_MS` env vars.
    - **6/6 `provider-contract-smoke` checks are now required before Worker
      deploy** (was 5/5 through S0) — the new adapter check must pass
      alongside the five existing schema/model contracts.
    - **S2 (this slice) — neutral schema subset + `GeminiStructuredGenerationProvider`,
      zero behavior change for callers, proven by a byte-identical
      snapshot round-trip.**
      **Proof artifact:** `shared/reasoning-response-schema.snapshot.json`
      (pre-existing) plus three new siblings —
      `shared/derivation-response-schema.snapshot.json`,
      `shared/extraction-response-schema.snapshot.json`,
      `shared/task-title-response-schema.snapshot.json` — captured from the
      four real builders BEFORE the neutral-schema rewrite (Phase A). Their
      purity tests (`shared/reasoningResponseSchema.purity.test.ts`,
      `shared/structuredResponseSchemas.purity.test.ts`) now assert
      `translateNeutralSchema(builder())` against those SAME, untouched
      snapshots — 8/8 assertions pass, the round-trip is byte-identical
      including property order.
      `agent/worker/providers/schema/neutralSchema.ts` defines the subset;
      `providers/gemini/geminiSchemaTranslation.ts` translates it to
      Gemini's dialect. Four ADR-0018 amendments, all discovered migrating
      real call sites and all coordinator-approved before the relevant
      code was touched (full rationale in the ADR's own "Amendments
      (2026-08-23)" section): `minItems` and an `integer` modifier on the
      neutral `number` type (3 of 4 builders and 2 target fields needed
      them for the round-trip to stay byte-identical); `<T>` dropped from
      `generateStructured` (dead weight, nothing ever bound it);
      `StructuredGenerationResult` gained optional `usage` (prompt/response
      token counts — 2 real call sites persist these into DB columns) and
      `rawFinishReason` (the untranslated provider string — 2 real call
      sites persist "MAX_TOKENS"/"SAFETY" verbatim, which the neutral enum
      deliberately can't carry).
      Migrated all 9 real `[STRUCTURED_GEN]` raw-fetch call sites (PA-01
      §2's own audit lists them as 6 rows, one row covering the 4
      suggestion handlers together — flagged, not silently matched to a
      wrong "8" count): `index.ts`'s 4 suggestion handlers
      (`/tasks`,`/calendar`,`/habits`,`/finance`), `callGeminiReasoning`
      (`/chat` mode=reasoning), `reasoning-endpoint.ts`'s `callGeminiOnce`
      (`/agent/reason`), `context-derivation-endpoint.ts`'s
      `callGeminiForDerivation`, `personal-memory-extraction-endpoint.ts`'s
      `callGeminiForExtraction`, `task-title-extraction.ts`'s
      `callGeminiForTaskTitle`. `createProviders(env)` gains `{ structured }`.
      `personal-memory-extraction-endpoint.ts`'s own duplicate
      `ProviderFailureTaxonomy`/`ProviderCallError` (flagged as S2
      territory in S1's own report) unified with
      `providers/providerFailureTaxonomy.ts`. Failure path unchanged:
      `ProviderUnavailableError` → `recordProviderFailure` with
      `capability: 'structured_generation'`, fail closed (Decision 5, no
      fallback), existing 503 `PROVIDER_UNAVAILABLE` surfaces preserved
      (same class, re-thrown unchanged through the adapter).
      Verification: all existing endpoint tests pass UNCHANGED (they mock
      fetch at the Gemini URL — the adapter still hits it) plus new tests:
      `geminiSchemaTranslation.test.ts` (17),
      `GeminiStructuredGenerationProvider.test.ts` (35). Two genuinely new
      normalizations, both discovered via real test failures, not
      theoretical: (1) `GeminiStructuredGenerationProvider`'s own
      `mapFinishReason` maps an ABSENT finishReason to `'stop'`, not
      `'other'` (differs from the text adapter on this one point) — all
      four pre-S2 structured builders treated a missing finishReason as
      fine, never a rejection reason, and two real happy-path test fixtures
      (`context-derivation-endpoint.test.ts`,
      `personal-memory-extraction-endpoint.test.ts`) omit it entirely and
      expect success. (2) `provider-contract-smoke.ts` checks 1–4 now go
      through `GeminiStructuredGenerationProvider` directly instead of a
      hand-rolled fetch — same adapter every real call site uses via
      `createProviders()`; checks 5–6 (embedding, text-generation adapter)
      unchanged. `agent/worker/chatMessage.ts`: `ChatMessage` extracted
      from `types.ts` into its own leaf module (re-exported from
      `types.ts` unchanged) — `types.ts` also defines `Env`, whose
      `AI: Ai` field needs `@cloudflare/workers-types` (an `agent/worker`-only
      devDependency); once this slice's `createProviders()` imports
      reached `reasoning-endpoint.ts` (itself reachable from
      `src/features/agent/reasoning/reasoningIntentParity.test.ts`, one of
      four pre-existing `src/*.equivalence.test.ts` cross-implementation
      parity tests that deliberately import into `agent/worker/`), the
      root `npm run typecheck` gate broke on `Cannot find name 'Ai'` for
      the first time — fixed at the root cause, not worked around.
    - **S3 (this slice) — `GeminiEmbeddingProvider`, zero behavior change
      for callers, interface-only (no model change, no second provider, no
      vector/index change).**
      `providers/gemini/GeminiEmbeddingProvider.ts` implements
      `EmbeddingProvider` exactly as S0 defined it (no interface
      amendment needed — see the ADR's own "S3 implemented as specified"
      Amendments note): `model`/`dimensions`/`normalizesOutput` read
      straight from `embeddingConfig.ts`; `embed(texts)` maps to the
      EXISTING per-text `embedContent` call pattern (Gemini's batch
      endpoint deliberately not adopted — that would change failure
      granularity, not just transport); every returned vector is
      L2-normalized exactly once, inside the adapter (both real call
      sites' own local `l2Normalize` calls removed, not just their
      fetches). Decision 4's dimension assertion
      (`assertEmbeddingDimensions`) runs on first use, inside `embed()`,
      before any network call — throws `EmbeddingDimensionMismatchError`
      (a config bug, not a provider outage: never classified via
      `provider-errors.ts`, never passed to `recordProviderFailure`). The
      concrete Gemini adapter can never actually diverge (both its
      `dimensions` field and the assertion's comparison target read the
      same `EMBEDDING_DIMENSIONS` constant) — the assertion guards the
      INTERFACE contract for whichever provider is next, tested directly
      against a stub in `GeminiEmbeddingProvider.test.ts`.
      Migrated both real `[EMBEDDING]` call sites (PA-01 §4):
      `document-memory-extraction-endpoint.ts`'s `embedChunk` (persisted
      vectors — a dimension mismatch now surfaces as a distinct
      `EMBEDDING_CONFIGURATION_ERROR` 500, not this file's usual 502
      taxonomy) and `personal-memory-extraction-endpoint.ts`'s
      `embedTextForOverlap` (transient dedup — kept its existing
      best-effort "any problem degrades to `null`" contract for real
      provider failures, but does NOT swallow
      `EmbeddingDimensionMismatchError` the same way, since a config bug
      silently producing wrong-width comparisons is not the kind of thing
      that contract should hide; it still can't escalate past this
      route's existing, unrelated-to-S3 per-candidate
      `persistence_failed` catch to a top-level 500 — restructuring that
      catch was out of this interface-only slice's scope, flagged in the
      code and here rather than silently left ambiguous).
      `createProviders(env)` gains `{ embedding }`.
      Verification: all existing endpoint tests pass UNCHANGED (100 tests
      across both files) plus new tests: `GeminiEmbeddingProvider.test.ts`
      (23 — envelope, per-text batching, unit-norm output proven against a
      deliberately non-unit fixture, malformed-shape degradation,
      dimension-assertion both paths, failure classification, failure-event
      persistence including the "NOT recorded for a dimension mismatch"
      case) and `createProviders.test.ts` (2). `provider-contract-smoke.ts`
      check 5 (embedding) now goes through `GeminiEmbeddingProvider`
      directly, asserting unit-norm output as part of the contract, same
      principle as S2's checks 1–4; also stopped hand-duplicating
      `EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` and now imports both from
      `embeddingConfig.ts`. One disclosed test-coverage gap: the route-level
      "dimension mismatch → 500" wiring in
      `document-memory-extraction-endpoint.ts` is verified by code
      inspection and by the adapter-level assertion tests, not by a full
      end-to-end route test — the concrete single-provider setup makes
      that branch unreachable through real code today, and reaching it
      would require introducing module-mocking (`vi.mock`), a pattern not
      used anywhere else in `agent/worker/`'s tests.
    - **S4 (this slice) — test migration: fetch-level Gemini mocks →
      provider-interface mocks. TESTS ONLY, zero product-code changes.**
      Inventory: 6 test files mocked `generativelanguage.googleapis.com`
      directly — `document-memory-extraction-endpoint.test.ts` (text-gen +
      embedding), `chat-attachment-context.test.ts` (text-gen, reuses
      `transcribePdf`), `context-derivation-endpoint.test.ts`
      (structured-gen), `personal-memory-extraction-endpoint.test.ts`
      (structured-gen + embedding, including document-source batching),
      `reasoning-endpoint.test.ts` (structured-gen, local `/agent/reason`),
      `index.test.ts` (text-gen + structured-gen, ~15 unrelated describe
      blocks sharing one mega fetch-mock, of which only a handful actually
      touch Gemini). All 6 migrated. `providers/testing/stubProviders.ts`:
      one shared, deliberately dumb helper (`StubTextGenerationProvider`/
      `StubStructuredGenerationProvider`/`StubEmbeddingProvider`, each
      driven by a plain handler function) plus `stubProviders()`, used via
      `vi.mock('./providers/createProviders', ...)` + a per-test
      reassignable stub-set closure variable — the "createProviders/env
      seam" the task named: no product file needed a DI change, since
      `createProviders` was already the one factory every call site
      depends on.
      Envelope-assertion relocation (per the task's own rules): duplicates
      of adapter-level tests (URL/key construction, unconditional
      `responseMimeType`, thinkingConfig conditionality, part-order/count
      on an inlineData attachment) were deleted with a comment pointing at
      the adapter test that already covers them (`GeminiTextGenerationProvider
      .test.ts`, `GeminiStructuredGenerationProvider.test.ts`,
      `GeminiEmbeddingProvider.test.ts`); call-site-specific facts (this
      endpoint's own system prompt content, `maxOutputTokens`/`temperature`
      values, "does this call site ask for thinkingConfig") were kept,
      relocated to read the captured `TextGenerationRequest`/
      `StructuredGenerationRequest` directly instead of a reconstructed
      Gemini wire body. `index.test.ts`'s large hand-written
      reasoning-schema `type.enum` regression guard (deliberately redundant
      with a separate `it.each(writeIntentRegistry)` loop, per that test's
      own comment) was fully preserved, now reading the NEUTRAL schema
      straight off the captured request (enum values pass through
      translation unchanged, so the assertion paths barely changed).
      `provider-contract-smoke.ts` and `scripts/gemini-36-probe.ts`
      untouched — still the only place real Gemini wire calls happen
      outside adapter unit tests.
      Verification (coverage guardrail): every migrated file's test COUNT
      is unchanged — `document-memory-extraction-endpoint.test.ts` 33,
      `chat-attachment-context.test.ts` 17,
      `context-derivation-endpoint.test.ts` 23,
      `personal-memory-extraction-endpoint.test.ts` 67,
      `reasoning-endpoint.test.ts` 53, `index.test.ts` 100 (293 total,
      before and after). Full suite unaffected elsewhere. Diagnostic
      strict `tsc` on `agent/worker/`: 255 errors on S3's tip (before S4),
      246 after — a net IMPROVEMENT (9 pre-existing `vi.fn`/tuple-index
      false positives removed along with the raw-fetch-mock code that
      triggered them; zero new errors).
      **Known debt this slice does NOT touch (TESTS ONLY, no product
      code):** the dimension-mismatch escalation in the overlap-dedup path
      — `personal-memory-extraction-endpoint.ts`'s `embedTextForOverlap`
      (S3) still can't escalate a config-bug `EmbeddingDimensionMismatchError`
      past that route's existing per-candidate `persistence_failed` catch
      to a top-level 500; restructuring that catch remains out of scope
      for both S3 and S4.
    - **S5 (OCR migration) is the last ADR-0018 slice** — migrating
      `/ocr` from the legacy `workers/ai-worker-recovered/` Worker into
      `agent/worker/` as a `TextGenerationProvider` consumer behind the
      seam, per the ADR's own §7 legacy-retirement order. **Deferred by
      PO in favor of S1b** (below) — not started.
    - **S1b (this slice) — `WorkersAITextGenerationProvider`, second
      `TextGenerationProvider` via the Cloudflare Workers AI (`env.AI`)
      binding. No fallback chain (that is S1c, a separate later slice
      after real-world quality comparison); structured generation and
      embeddings stay Gemini-only, fail-closed (Decision 5), untouched.**
      Per Decision 5/the ADR's own Supersession rule — no new ADR needed,
      PO-approved slice.
      Diagnosis (work item 1): `workers/ai-worker-recovered/index.js`'s
      `callWorkersAI` (the only precedent) used
      `@cf/meta/llama-3.1-8b-instruct` as a Gemini FALLBACK, mapping
      `system_instruction`→a leading `{role:'system'}` message,
      `contents[]`→user/assistant turns, `generationConfig.maxOutputTokens`/
      `.temperature`→`max_tokens`/`temperature`. That exact model string is
      retired from the binding's own catalog as of this slice
      (`worker-configuration.d.ts`, `wrangler types`-generated
      2026-08-24, workerd@1.20260611.1) — only `-fp8`/`-awq` quantized
      variants of it remain. Model chosen instead:
      **`@cf/google/gemma-4-26b-a4b-it`** — newest Gemma generation on the
      binding, Mixture-of-Experts (26B total/~4B active, so latency/cost
      track a much smaller dense model), uses the binding's newer
      OpenAI-compatible Chat Completions shape (`finish_reason`/`usage`
      map directly onto the neutral contract) rather than the legacy
      bespoke one, and the Gemma family is documented as pretrained across
      140+ languages — the broadest multilingual net of any candidate
      reviewed, which matters most for Dari: an extremely low-resource
      language even among "supported multilingual" models, so breadth of
      pretraining is the best available bet, not a verified guarantee.
      German is well within any major candidate's coverage regardless.
      Alternate considered: `@cf/qwen/qwen3-30b-a3b-fp8` (also MoE; Qwen's
      own docs name Persian explicitly, a stronger specific claim than
      Gemma's general "140+ languages," but a narrower overall language
      list and the binding's bespoke completions shape for it, not Chat
      Completions). **Recommendation only, not yet PO-verified against
      real Dari/Farsi output** — PO should spot-check both languages
      against a live deploy; the model is a single named constant
      (`DEFAULT_WORKERS_AI_TEXT_MODEL`,
      `providers/workers-ai/WorkersAITextGenerationProvider.ts`), a
      one-line change if a different model is preferred.
      Diagnosis (work item 1b): `agent/worker/types.ts`'s `Env` already
      declared `AI: Ai` (pre-existing, unclear prior origin) but
      `wrangler.toml` had no `[ai]` binding block, so `env.AI` was
      `undefined` at runtime despite being typed as required — a real
      type/runtime mismatch predating this slice. Fixed: `[ai]\nbinding =
      "AI"` added to `wrangler.toml`, `worker-configuration.d.ts`
      regenerated via `npx wrangler types` (diff: two new fields on the
      generated ambient `Env`, nothing else).
      Implementation: `providers/workers-ai/WorkersAITextGenerationProvider.ts`
      implements `TextGenerationProvider`. Deliberately defines its own
      minimal structural types (`WorkersAIBinding`, a local chat-message/
      response shape) rather than referencing the ambient `Ai`/
      `ChatCompletionsOutput`/... types from `worker-configuration.d.ts`
      anywhere — see `chatMessage.ts`'s own header comment for the exact
      root-typecheck-gate incident (S2) this avoids: those ambient types
      need `@cloudflare/workers-types`, unavailable to the root project's
      `tsconfig.app.json`, and `createProviders.ts` (which this file feeds
      into) is transitively reachable from the root gate via four
      `src/*.equivalence.test.ts` files. Attachments: presence-only check
      on `providerOptions.inlineDataAttachment` (the same escape-hatch key
      the Gemini adapter reads) throws a new, typed
      `AttachmentsUnsupportedError` (`.code === 'ATTACHMENTS_UNSUPPORTED'`)
      — never silently drops one. Failure classification: the binding
      throws on any inference error with no HTTP response and so no
      status code — every binding error maps uniformly to
      `ProviderUnavailableError` (no `ProviderRequestError` analogue is
      possible without a status to classify by, disclosed as a
      deliberate simplification, not an oversight). `http_status` is
      passed as absent (→ `null`) to `recordProviderFailure`; checked the
      `20260823000000_provider_failure_events.sql` migration's own column
      (`http_status integer`, already nullable, no `not null`) — **no
      follow-up migration was needed**, the contingency the task named did
      not apply.
      Selection (work item 3): `createProviders(env, fetcher, options)`
      gained a third, optional `options.pinTextProvider?: 'gemini'`
      parameter and reads `env.AI_TEXT_PROVIDER` (`'gemini'` default |
      `'workers-ai'`) to choose `.text`'s concrete class — per-worker-
      deployment config (`wrangler.toml [vars]`), not per-request; only
      `.text` is selectable, `.structured`/`.embedding` stay Gemini-only
      regardless. `transcribePdf`
      (`document-memory-extraction-endpoint.ts`), `/documents/analyze`
      (`index.ts`'s `handleDocumentAnalyze`), and — as of the S1b
      follow-up below — `index.ts`'s `callGeminiChat` (`/chat` mode=chat,
      when it carries an image attachment) all pass
      `{ pinTextProvider: 'gemini' }` to stay on Gemini regardless of the
      deployment's `AI_TEXT_PROVIDER`. Every attachment-carrying call site
      is now pinned; none still depends on the generic
      attachments-unsupported rejection for correctness.
    - **S1b follow-up (this slice) — `/chat` image attachments pinned to
      Gemini too; explicit `AttachmentsUnsupportedError` handler added.**
      Closes the gap the S1b entry above flagged: `callGeminiChat` now
      passes `{ pinTextProvider: 'gemini' }` to `createProviders` whenever
      `imageAttachment` is set (`index.ts`), so an in-chat image
      attachment works regardless of `AI_TEXT_PROVIDER`, the same
      guarantee `transcribePdf`/`/documents/analyze` already had.
      `handleChat`'s mode=`chat` catch block gained an explicit
      `AttachmentsUnsupportedError` branch (checked before the existing
      `ProviderUnavailableError` branch) — a structural last resort now
      that pinning makes it unreachable through real code, but if it ever
      does fire, `/chat` returns the same honest-reply shape as
      `PROVIDER_UNAVAILABLE_CHAT_REPLY` (200, a bounded EN/DE/FA message,
      persisted as the turn) instead of falling through to the generic
      content-less 500. New tests in `index.test.ts` (102 total, was 100):
      one proves `AI_TEXT_PROVIDER: 'workers-ai'` + an image attachment
      still resolves via the Gemini pin (asserted by capturing
      `createProviders`'s own `options` argument through the existing
      `vi.mock` seam — the mock always returns the same stub set
      regardless of arguments, so this is the only way to prove the pin
      was actually REQUESTED, not just that the stub happened to succeed);
      the other forces `AttachmentsUnsupportedError` directly (overriding
      the stub after `installFetchMock`'s own default) and asserts the
      exact honest reply text, 200, not 500.
      A `TS2320` typecheck regression was caught and fixed during this
      slice: `CreateProvidersEnv`'s first draft `extends GeminiProviderEnv,
      Partial<WorkersAIProviderEnv>` — TS rejects two extended interfaces
      whose shared `ProviderFailureEnv` fields disagree on optionality
      (`Partial<>` makes them all optional). Fixed by declaring the new
      `AI?: WorkersAIBinding` field directly on `CreateProvidersEnv`
      instead of spreading in the whole partial interface.
      Smoke (work item 4): NOT added as an automated check —
      `env.AI` is a runtime Worker binding, unreachable from
      `vite-node`/`provider-contract-smoke.ts`'s process the way `fetch`
      is (Cloudflare's Workers AI binding does not exist outside an actual
      `workerd` runtime, local `wrangler dev` or deployed). Documented
      instead as a manual post-deploy check in that script's own header:
      run `npx wrangler dev`, temporarily set `AI_TEXT_PROVIDER =
      "workers-ai"` for a local request, and confirm a real `/chat`
      response; see the script header for the exact steps. Saying so
      plainly rather than faking a check that cannot exist outside a real
      Worker runtime.
      Tests (work item 5): `WorkersAITextGenerationProvider.test.ts` (18 —
      request mapping incl. system/role/max_tokens/temperature, text
      extraction incl. missing/null content, finishReason mapping table,
      attachments-rejection incl. "does NOT call env.AI.run", failure
      classification, failure-event persistence incl. fail-safe and the
      "not recorded for an attachments rejection" case) and 6 new
      `createProviders.test.ts` cases (default-to-gemini, typo-falls-back-
      to-gemini, workers-ai selection, `.structured`/`.embedding` stay
      Gemini under workers-ai selection, `pinTextProvider` override both
      with and without `AI_TEXT_PROVIDER: 'workers-ai'` set). All existing
      endpoint tests for the two pinned call sites pass UNCHANGED (pinning
      via `createProviders(..., { pinTextProvider: 'gemini' })` rather
      than direct `new GeminiTextGenerationProvider(...)` construction
      was a deliberate second design pass — the first, direct-construction
      draft bypassed S4's `vi.mock('./providers/createProviders', ...)`
      test seam entirely and broke 11 tests across `index.test.ts` and
      `document-memory-extraction-endpoint.test.ts`; reverted in favor of
      keeping pinning inside the factory, where S4's existing stub-provider
      mocks still intercept it transparently).
      Verification: `npx vitest run agent/worker` 855/855 passed (24 files);
      root `npx vitest run` 3697 passed/76 skipped/2 failed (same
      pre-existing `ChatPageHeader` flake S4 already documented, confirmed
      unrelated); root `npm run typecheck` clean (77 baseline-tracked
      errors remain, 80 were in the baseline — no new/regressed, matching
      S4's own baseline exactly); lint clean on every touched/created file
      (`index.ts`'s 11 pre-existing `no-explicit-any` errors, `git blame`-
      confirmed all from commits between 2026-06-14 and 2026-06-22, none on
      this slice's own one-hunk diff at line 1737).
    - **No smoke RUN performed for S1, S2, or S3** — `GEMINI_API_KEY`
      unavailable in this environment; the script's own guard exits with a
      non-zero status (as designed — the key is required) without
      attempting any network call each time, and import resolution of
      each slice's new adapter (`GeminiStructuredGenerationProvider` for
      S2, `GeminiEmbeddingProvider` for S3) succeeded (vite-node reached
      the guard, meaning the whole module graph resolved and transformed
      without error).
    - **S1c (fallback text-generation chain) — authored on branch
      `feat/s1c-text-fallback`, PR opened, not yet merged.** Implements
      ADR-0018 Decision 5's text-generation fallback (structured
      generation and embeddings are explicitly out of scope and untouched
      — Decision 5 keeps both fail-closed). New
      `providers/fallbackTextProvider.ts`: `FallbackTextGenerationProvider`
      wraps a primary/secondary `TextGenerationProvider` pair behind the
      same interface. Fires ONLY on `ProviderUnavailableError` — a model
      that answers (even badly: empty text, wrong language, a non-STOP
      finishReason) is never a trigger, that judgment stays at the call
      site per Decision 3, unchanged. One fallback attempt only — a second
      `ProviderUnavailableError` from the secondary propagates unchanged
      (no retry loop); every existing `err instanceof
      ProviderUnavailableError` → 503 `PROVIDER_UNAVAILABLE` catch in
      `index.ts` already handles this correctly with no changes needed
      there. `createProviders.ts` gains `AI_TEXT_FALLBACK` (`'on'` |
      absent/default off) — `'on'` wraps `.text` with primary/secondary
      ORDER taken from the existing `AI_TEXT_PROVIDER` selection (whichever
      it already selects is primary, the other of the two current
      `TextGenerationProvider`s is secondary); `.structured`/`.embedding`
      are constructed identically in both branches of `createProviders`,
      never passed through the new `buildTextProvider` helper at all.
      Attachment pinning (`{ pinTextProvider: 'gemini' }`) bypasses the
      wrapper entirely via an early return in `buildTextProvider`, before
      `AI_TEXT_FALLBACK` is even read — an attachment-carrying request
      always gets exactly one plain Gemini call.
      Failure-event persistence: the primary's own failure is already
      recorded by its own adapter's existing `recordProviderFailure` call
      (S1/S1b, unchanged). New `failureEvents.ts` export
      `recordFallbackSuccess` persists the DIFFERENT fact that the
      secondary then served the request — reuses the existing
      `provider_failure_events` table (per task instruction, table checked
      first): `provider_id` is the secondary's real, unmangled id (e.g.
      `'workers-ai'`), never a synthesized/mangled value; `http_status`
      stays `null` (not an HTTP outcome); `request_id`, when the caller
      has a real one, keeps only its original per-call meaning — same
      optional shape as `recordProviderFailure`'s own `request_id`.
      **Design correction (post-review, same slice, before merge):** the
      first cut disambiguated a fallback-success row from an ordinary
      failure row by repurposing `request_id` as a fixed sentinel string
      (`'fallback_success'`) — reviewed as the same mangled-identity
      problem the task explicitly forbids for `provider_id`, just moved to
      a different column. Fixed with a real, typed column instead: new
      migration `20260824000000_provider_failure_events_event_kind.sql`
      (**authored, NOT applied** — separate, additive `ALTER TABLE`
      against the already-applied `20260823000000` migration, which is
      immutable and untouched) adds `event_kind text not null default
      'failure' check (event_kind in ('failure', 'fallback_success'))`.
      `recordProviderFailure` never sets it (keeps the column's own
      default); `recordFallbackSuccess` sets it to `'fallback_success'`.
      `request_id` is no longer repurposed as a marker anywhere.
      **DEPLOY ORDER: the `event_kind` migration must be applied (PO
      "برو") BEFORE this Worker code is deployed.** Both
      `recordProviderFailure` and `recordFallbackSuccess` share the same
      fail-safe `insertProviderEvent` helper, so a missing `event_kind`
      column degrades to a swallowed `console.warn` (never a caller-
      visible failure) exactly like a missing table already does — proven
      by a dedicated test simulating the real Postgres "column does not
      exist" error (code `42703`), not just a generic persistence-failure
      case. Deploying into the known-missing-column state is still not
      the intended order, matching the existing `provider_failure_events`
      table's own deploy-order discipline.
      No "answered by backup model" annotation is shown to the user in
      this slice (task instruction) — `TextGenerationResult` carries no
      such field and none was added.
      `wrangler.toml`: `AI_TEXT_FALLBACK` documented and set to `"on"` for
      production (default is off; every other consumer of
      `createProviders` that doesn't set this var is unaffected).
      Tests: `fallbackTextProvider.test.ts` (6 — primary ok skips the
      wrapper entirely with no event recorded; primary unavailable ->
      secondary serves the request and the fallback-success event is
      recorded with the secondary's real id and `event_kind:
      'fallback_success'`; both fail -> the secondary's own
      `ProviderUnavailableError` propagates unchanged, no event, no third
      attempt; a non-`ProviderUnavailableError` from the primary
      propagates immediately without trying the secondary; a
      fallback-success persistence failure is swallowed the same fail-safe
      way `recordProviderFailure` already is; a missing-`event_kind`-
      column error specifically is swallowed the same way — the deploy-
      order guard). `createProviders.test.ts` gained 7 cases under
      `AI_TEXT_FALLBACK` (default off unwrapped; typo/off-value unwrapped;
      `'on'` wraps; order-from-`AI_TEXT_PROVIDER` both directions via the
      wrapper's own `.id`; pin bypasses the wrapper even with the flag on;
      `.structured`/`.embedding` stay the plain Gemini adapters and are
      structurally incapable of being the fallback wrapper — the
      "structured path never touches the fallback wrapper" guard the task
      asked for). `failureEvents.test.ts` gained 4 cases (`recordProviderFailure`
      never sends an `event_kind` key, keeping the column default;
      `recordFallbackSuccess`'s correct row shape incl. the unmangled
      `provider_id` and `event_kind: 'fallback_success'`; a real
      `request_id` is preserved, never overwritten; both functions'
      fail-safe swallow of the missing-column error).
      `provider_failure_events.migration_structure.test.ts` gained a
      second `describe` block reading the new migration file (table/column
      definition, the additive-not-edited guarantee against the applied
      migration, the `COMMENT ON COLUMN`).
      Verification: `npm test` 3727 passed/76 skipped/0 failed (full
      suite, all pre-existing suites unaffected); `npm run typecheck`
      clean on both targets (`src/`: 77 baseline-tracked errors remain, 80
      were in the baseline; `agent/worker/`: 88 remain, 88 were in the
      baseline — no new/regressed on either); `npx eslint` clean on every
      file this slice touched or created.

- **DATE-01** — `/chat` (mode=chat) now injects the current date, weekday,
  and time with timezone into `buildChatSystemPrompt` (neutral ISO-dated
  line, explicit injected `now`/`timeZone` parameters, timezone reused from
  the request's existing client-supplied `timeZone` field rather than a
  stored setting — `user_settings` has no timezone column) — fixes the
  model inventing a date or deflecting to "check your calendar"
  (`agent/worker/prompt-builder.ts`, `agent/worker/index.ts`).

- **TITLE-01** — Persian/Dari task-title extraction: two production
  defects, both fixed at the deterministic title-validation gate
  (`flow-write-policy.ts`'s `validateCandidateTitle`), not by touching
  trigger detection or `extractTaskTitle` itself.
  **Defect A** — a task created from «یک وظیفه بساز به نام آزمایش جمنای»
  was titled «به نام آزمایش جمنای» instead of «آزمایش جمنای». Diagnosed:
  `extractTaskTitle`'s fallback strips only the matched create-trigger
  phrase («یک وظیفه بساز»), not the Persian framing preposition «به نام»
  ("named"/"called") that follows it; `isTitleSubstantiallyTheMessage`
  doesn't catch it either (matchRatio 1.0 but coverageRatio ≈0.57, just
  under the 0.6 threshold). Given the PO's report that Gemini structured
  was intermittently 429ing when this task was created, the pattern
  fallback (not the model) most likely produced the stored title —
  reproduced end-to-end in the new tests via a `ProviderUnavailableError`
  model call. Fixed with a new `TITLE_FRAMING_PREFIX` bounded regex
  (Persian: «به نام», «به اسم», «با نام», «با عنوان», «تحت عنوان»; English:
  "called", "named", "titled", "with the name") applied inside
  `cleanTitleEdges` — the one gate BOTH the pattern-fallback candidate and
  the model's own candidate pass through in `resolveCreateTitle`, so one
  fix covers both paths (defense in depth, per task instruction) without
  two implementations that could drift.
  **Defect B** — a task titled «به زبان فارسی پاسخ بده Preserve code
  product names titles URLs and technical» was created from what the PO
  identified as `src/features/ai/responseLanguage.ts`'s
  `getAiResponseLanguageInstruction('fa')` steering text, not a real task
  request. Diagnosed (grep-verified, not assumed): `TasksPage.tsx`'s
  `buildTaskAssistantRequestBody` ("ask about my tasks" mini Q&A widget)
  is the ONE call site in the frontend that folds this instruction
  directly into the `message` field via `withAiResponseLanguageInstruction`
  — every other call site (`AgentBriefingCard.tsx`, `WeeklyBriefingPage.tsx`,
  `HabitsPage.tsx`, `FinancePage.tsx`, `CalendarPage.tsx`, `ChatPage.tsx`,
  `reasoningPrompt.ts`) sends it as its own separate
  `responseLanguageInstruction` body field, keeping `message` pure. That
  combined message reaches `POST /chat`'s `mode='chat'` branch (the
  default when no `mode` is sent, which this widget never sends), which
  runs the same deterministic auto-write detector as any other chat
  message. The visible instruction text alone matches NONE of this file's
  create/update trigger regexes (verified directly against every pattern)
  — so the create-task match came from real content in the "User
  question: ..." tail the widget appends after the instruction+context
  boilerplate; the actual bug is that `extractTaskTitle`'s fallback +
  `boundText`'s 80-char, START-anchored truncation spends the whole title
  budget on the leading boilerplate before ever reaching the real subject
  (a manual character count of the fa instruction text, after
  `extractTaskTitle`'s own comma/period/"task"-keyword stripping, lands
  the 80-char cutoff almost exactly at "...and technical", matching the
  reported title). Tightening the create-trigger regex would not have
  helped (the match is on legitimate content, not the visible instruction
  text) — per the task's own alternate-branch instruction for this exact
  situation, fixed with a new `looksLikeInstructionFragment` bounded
  leading-phrase check (Persian «به زبان … پاسخ بده», «پاسخ بده»; English
  "respond in", "reply in"; German "antworte auf") in
  `validateCandidateTitle`, which rejects the candidate outright —
  upstream this becomes `executeAutoTaskWrite`'s existing
  `!intent.title` → "What should the task be called?" clarify branch,
  never a created task.
  **Not fixed here (disclosed, out of this ticket's deterministic-layer
  scope):** the true root cause of Defect B is `TasksPage.tsx` baking the
  language instruction into `message` instead of sending it as its own
  `responseLanguageInstruction` field like every other call site — a
  one-line frontend fix that would additionally stop the auto-write
  detector from ever scanning this boilerplate at all. Recommended
  follow-up, not attempted in this ticket (scoped to the backend
  deterministic layer per the task instruction).
  **Defect B's existing production task row must be deleted manually by
  the Product Owner — no DB cleanup script was written or run as part of
  this fix**, per the task's own instruction.
  Tests: `flow-write-policy.test.ts` gained a new `TITLE-01` describe
  block — 9 `cleanTitleEdges` framing-prefix cases (5 fa + 4 en) plus 2
  edge cases (genuine subject untouched, mid-title occurrence not
  stripped); a 3-test Defect A end-to-end reproduction via
  `resolveCreateTaskTitle` (raw `parseTaskWriteIntent` output still
  carries the framing prefix — proving this is a validator-layer fix, not
  an extraction-layer one; pattern-fallback path resolves correctly;
  defense-in-depth model-path case also resolves correctly); 7
  `looksLikeInstructionFragment` cases (fa/en/de positive cases, 2
  negative cases including a title that merely mentions "reply" without
  it being the leading verb); a 4-test Defect B end-to-end reproduction
  (isolating the new check from the pre-existing length/overlap checks by
  using a short instruction-leading clause that passes both on its own;
  `validateCandidateTitle` rejects it; `resolveCreateTaskTitle` resolves
  to `undefined` when both the model and pattern-fallback candidates are
  instruction-shaped; a genuine model title alongside the same
  instruction-shaped pattern fallback still resolves correctly, proving
  the rejection is scoped to the bad candidate only). Stash-break-restore
  proof performed on the Defect A pattern-fallback-path test: with
  `flow-write-policy.ts`'s fix stashed (test file kept), the test failed
  with `expected 'به نام آزمایش جمنای' to be 'آزمایش جمنای'` — exactly the
  reported production defect; restoring the fix made it pass again.
  Verification: `npm test` 3752 passed/76 skipped/0 failed (full suite,
  including the full pre-existing `flow-write-policy.test.ts` suite — 205
  tests, zero regressions, all existing trigger-detection positive cases
  unchanged since this fix touches only `validateCandidateTitle`/
  `cleanTitleEdges`, not `parseTaskWriteIntent`/`detectWriteDomainSignal`);
  `npm run typecheck` clean on both targets (`src/`: 77 baseline-tracked
  errors remain, 80 were in the baseline; `agent/worker/`: 88 remain, 88
  were in the baseline — no new/regressed on either); `npx eslint` clean
  on both touched files.

Superseded/completed sprint milestones from the prior version of this
document have been removed rather than carried forward as history; git
history of this file remains the record of what was previously claimed and
when.

## 6. Incidents

- **2026-08-22 — Gemini provider outage (429 RESOURCE_EXHAUSTED) surfaced as a fabricated clarification.** Cause: Gemini API credits were depleted, so every provider call failed with 429; the auto-write title-resolution path (`flow-write-policy.ts`'s `resolveCreateTitle`) treated that failure the same as the model genuinely finding no subject, so `executeAutoTaskWrite` reported the exact same "What should the task be called?" ask as a real ambiguity. User-visible symptom: in `/chat`, a task-creation message got a fabricated clarifying question instead of an honest "AI unavailable," and a follow-up turn got the generic, content-less "Something went wrong on my end." Fix: `fix/inc-01-provider-failure-honesty` branch — `agent/worker/provider-errors.ts` classifies 429/5xx/network failures distinctly from the model answering with something unusable; both the auto-write path and `/chat`'s `mode: "reasoning"` now report a distinct `PROVIDER_UNAVAILABLE`/`provider_unavailable` outcome with an honest, bounded message (EN/DE/FA) instead.

- **2026-08-23 — Gemini model retirement/availability forced a migration off gemini-2.5-flash.** `gemini-2.0-flash` is fully retired; `gemini-2.5-flash` is unavailable to new API keys (the original account's own key still reaches it, but it cannot be provisioned again). `scripts/gemini-36-probe.ts` (MIG-01a) diagnosed the replacement, `gemini-3.6-flash`: `thinkingConfig:{thinkingBudget:0}` — the exact fix task 12/R-3/INC-01-era call sites relied on to stop thinking tokens from exhausting `maxOutputTokens` — is rejected outright with 400 INVALID_ARGUMENT (probe P3); the `responseSchema` dialect itself is unchanged (probe P5/P6, both 200). Fix: `feat/mig-01b-gemini-36` branch (MIG-01b) — single-source model resolution (`agent/worker/geminiModel.ts`, default `gemini-3.6-flash`), `thinkingConfig` removed from every call site (thinking is simply enabled now — accepted, since it only reaches gemini-2.5-flash via a deliberate env-pin and that model is being retired), and `maxOutputTokens` raised to a 2048 floor everywhere it was lower (thinking now spends output budget on every call). `wrangler.toml`'s `GEMINI_MODEL` var updated to `gemini-3.6-flash`.
