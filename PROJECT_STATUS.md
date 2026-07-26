# SmartFlow - Project Status

Last updated: 2026-07-26

---

## 1. Executive Summary

SmartFlow has moved beyond a static productivity dashboard. It is now an AI
Personal Operating System with a deterministic workspace pipeline, explicit
agent safety boundaries, read-only execution, one approved write vertical slice,
reflection, context synthesis, and deterministic response composition.

The current system remains intentionally bounded. It does not perform
autonomous execution, does not run hidden tool chains, does not let the LLM
approve or execute actions, and does not expose internal policy, audit, memory,
or engine metadata to users.

Current focus: production-readiness review of the proposal boundary after
completing both controlled browser integration and local real-worker reasoning
validation. GitHub Read-only Integration V1 Slice 1 is complete and live in
production: a natural-language GitHub repository request now resolves to the
`inspect_github_repositories` intent, routes through explicit user Run, and
returns a real repository list from the connected GitHub App installation.

---

## 2. Current Project Phase

Current phase: deterministic AI Personal Operating System foundation complete;
safe agent response and execution infrastructure in validation.

Engineering posture:

- deterministic validation remains authoritative,
- LLM output is proposal-only,
- planning never executes,
- approval is not execution,
- explicit user action is required before runtime execution,
- read-only execution remains the default safe path,
- `tasks.complete` is the only enabled write tool,
- runtime results are authoritative during response synthesis,
- Dashboard remains presentation-focused.

---

## 3. Completed Milestones

Completed workspace and UI milestones:

- Living Workspace
- Welcome Workspace
- Living Hero
- Flow AI Right Rail
- Sidebar Orb Identity
- Continue Learning
- Learning Memory
- Smart Academy integration
- Smart Academy ecosystem navigation
- Responsive workspace
- Responsive/mobile layout improvements
- Nested scroll removal

Completed workspace and agent architecture milestones:

- Workspace Engine V1
- Signal Engine V1
- Memory Engine V1
- Workspace Interaction Tracking V1
- Interaction Feedback Engine V1
- Decision Intelligence V1
- Personalization Engine V1
- Priority Engine V1
- Goal Engine V1
- Planner Engine V1
- Approval Model V1
- Approval Interaction Boundary V1
- Tool Registry V1
- Tool Resolver V1
- Execution Policy V1
- Execution Engine V1
- Execution Audit V1
- Read-only Runtime Boundary V1
- Write Runtime Boundary V1
- Reflection Engine V1
- Reflection Integration V1
- Reflection UI V1
- LLM Reasoning Layer V1
- Multilingual reasoning-domain correction
- Response Composer V1
- Context Synthesis V1
- GitHub Read-only Integration: all four tools (`github.repositories.list`,
  `github.issues.list`, `github.pulls.list`, `github.workflow_runs.list`) live
  in production — natural-language request -> intent -> explicit Run works
  end to end for each
- `/chat` reasoning mode (`mode:"reasoning"`): schema-enforced
  (`responseSchema`, temperature 0), same contract as `/agent/reason`, skips
  the conversational persona and `agent_chat_messages` persistence
- ChatPage's reasoning-routing heuristic (`shouldUseReasoningForMessage`)
  inverted from a domain-keyword allowlist to a denylist + possessive-based
  gate, so a phrasing naming a tool it wasn't explicitly taught no longer
  silently falls through to plain chat
- Tool-level evidence disambiguation is table-driven
  (`TOOL_EVIDENCE_PATTERNS`): one table drives per-domain tool
  disambiguation instead of a one-off function per domain
- Connected GitHub repository inventory now feeds the reasoning prompt
  (`safeContext.githubRepositoryInventory`) so a name that matches a
  connected repo is treated as GitHub evidence even when it could otherwise
  read as a different domain (e.g. a learning topic)
- Multi-candidate disambiguation cards: a genuinely ambiguous request (2-3
  specific read-only intents) can render one validated proposal card per
  candidate instead of a single generic clarification prompt

Completed validation milestone:

- Agent Response UX Validation V1: authenticated controlled browser integration
  completed with 15/15 PASS rows, and the separate authenticated local
  real-worker reasoning matrix completed with 8/8 PASS rows through real Gemini.

---

## 4. Living Workspace Architecture

The Living Workspace is generated through `src/features/workspace/`.

Current deterministic Workspace pipeline:

```text
useWorkspace()
-> signalEngine()
-> memoryEngine()
-> interactionFeedbackEngine()
-> decisionIntelligenceEngine()
-> personalizationEngine()
-> priorityEngine()
-> goalEngine()
-> plannerEngine()
-> approvalEngine()
-> workspaceEngine()
-> Dashboard
```

Execution Audit remains outside the workspace generation pipeline. It observes
actual execution only.

Decision Intelligence V1 is deterministic, input-only, and read-only. It uses
validated reflection evidence and bounded interaction feedback to produce a
domain-level decision profile. It weakly influences medium/low ordering only,
never overrides urgent signals or onboarding, does not mutate memory, and does
not execute or initiate autonomous behavior.

The Dashboard is primarily a presentation surface for a typed Workspace object.
Workspace decision-making belongs in the workspace engines, not in
`Dashboard.tsx`.

---

## 5. Agent Reasoning and Execution Architecture

Current agent reasoning and execution pipeline:

```text
User Message
-> AI Response Language Resolution
-> LLM Reasoning Layer
-> Structured Intent Proposal
-> Deterministic Intent Validator
-> Tool Resolver
-> Approval Model / Approval Interaction
-> explicit user action
-> Read-only Runtime or Write Runtime
-> Execution Policy
-> Execution Engine / explicit handler
-> Execution Audit
-> Reflection Engine
-> Reflection Integration
-> safe Memory Evidence
-> Context Synthesis
-> Response Composer
-> Chat UI
```

The LLM Reasoning Layer supports these intents:

- `inspect_tasks`
- `inspect_calendar`
- `inspect_learning`
- `inspect_workspace`
- `inspect_github_repositories`
- `inspect_github_issues`
- `inspect_github_pull_requests`
- `inspect_github_workflow_runs`
- `complete_task`
- `ask_clarification`
- `unsupported`

Intent-to-tool mappings:

- `inspect_tasks` -> `tasks.list`
- `inspect_calendar` -> `calendar.list_today`
- `inspect_learning` -> `learning.get_progress`
- `inspect_workspace` -> `workspace.get_context`
- `inspect_github_repositories` -> `github.repositories.list`
- `inspect_github_issues` -> `github.issues.list`
- `inspect_github_pull_requests` -> `github.pulls.list`
- `inspect_github_workflow_runs` -> `github.workflow_runs.list`
- `complete_task` -> `tasks.complete`

`ask_clarification` can carry a `candidates` array in the raw model output when
a message is genuinely ambiguous between 2-3 of the intents above (as opposed
to missing information, which stays a plain clarification with no
candidates). `resolveDisambiguationCandidates` (`intentValidator.ts`)
independently revalidates each raw candidate, dedupes on the resolved
`toolId`, and caps at 3 survivors. The validated result carries these as
`AgentReasoningResult.disambiguationCandidates`, present only for a genuine
multi-way ambiguity — absent for a normal confident proposal, a plain
missing-information clarification, and a disambiguation that collapsed to a
single survivor (returned as a normal top-level result instead).

Security boundary:

- the LLM proposes only,
- deterministic validation always runs,
- the LLM cannot execute,
- the LLM cannot approve,
- the LLM cannot supply authenticated user identity,
- the LLM cannot invent arbitrary executable tools,
- unsupported and mixed requests fail closed,
- ambiguous task targets require clarification,
- read and write actions still require explicit user interaction.

Multilingual domain correction is bounded. Task markers override generic
`today` / `heute` / `امروز` markers. Strong task, calendar, learning,
workspace, and GitHub evidence is bounded; conflicting strong evidence asks
for clarification. This is not a general semantic classifier.

---

## 6. Execution Capabilities

Supported read-only executable tools:

- `tasks.list`
- `calendar.list_today`
- `learning.get_progress`
- `workspace.get_context`
- `github.repositories.list`
- `github.issues.list`
- `github.pulls.list`
- `github.workflow_runs.list`

Supported write executable tools:

- `tasks.complete` only

Write execution guarantees for `tasks.complete`:

- exact step, tool, and target approval binding is required,
- approval and execution are separate user actions,
- authenticated user identity is injected by the runtime,
- task completion is state-idempotent,
- post-write verification is required,
- no automatic retry,
- no chained execution,
- no autonomous execution,
- no other write tool is enabled.

Execution handlers are explicit. They remain framework-independent and must not
import React hooks, UI components, route components, Supabase clients in UI
surfaces, or LLM logic.

---

## 7. AI Language and Response Composition

SmartFlow separates interface language from AI response language.

Supported AI response language values:

- `auto`
- `en`
- `de`
- `fa`

Resolution rules:

- fixed response language wins,
- `auto` follows the latest user message,
- unclear detection falls back safely,
- response RTL/LTR applies to AI response content only,
- interface direction remains independent.

TasksPage AI and Flow AI Chat have been browser-validated in English, German,
and Persian.

Response Composer V1 is a deterministic presentation layer that runs after
verified runtime and reflection output. It supports the six current tools,
creates a headline, summary, bounded details, and optional safe suggestion. It
does not call another LLM, does not inspect raw handler payloads, does not alter
runtime results, does not expose policy/audit/request IDs/raw JSON/internal
metadata, and preserves the resolved response language.

Context Synthesis V1 composes bounded meaning before final response rendering:

```text
Verified Runtime Result
+ bounded Workspace snapshot
+ safe Reflection summary
+ bounded Decision profile
-> Context Synthesis
-> Response Composer
-> Chat UI
```

Supported synthesis domains:

- tasks
- calendar
- learning
- workspace
- github

`tasks.complete` receives only verified safe response facts and currently no
broad cross-context synthesis.

Context synthesis safeguards:

- runtime result is authoritative,
- contradictions suppress synthesis rather than guessing,
- supporting facts are bounded,
- suggestions are optional and non-executing,
- no personality, emotional, mastery, motivation, importance, or future-action
  inference,
- Decision Intelligence may only produce neutral continuity wording under
  sufficient evidence,
- no raw memory, audit, policy, prompt, private note, document body, user ID, or
  Supabase structure is consumed or exposed.

---

## 8. Validated User-Visible Flows

Validated read-only flow:

```text
Natural-language request
-> interpreted intent card
-> explicit Run
-> verified result
-> reflection
-> optional local memory evidence
-> synthesized and composed natural response
```

Validated write flow:

```text
Exact task-completion request
-> resolved exact task
-> Review
-> Approve
-> no execution yet
-> separate Complete Task action
-> policy
-> idempotent mutation
-> persisted-state verification
-> audit
-> reflection
-> safe response
-> task refresh
```

Guarantees:

- no action runs on render,
- no action runs on approval alone,
- no hidden approve-and-run path exists,
- ambiguous targets are never guessed.

Latest confirmed validation (re-run 2026-07-26; counts below are what that run
actually reported, not carried forward from the prior update):

- GitHub Worker tests (`agent/worker/github-integration.test.ts`): 71 passed
- GitHub migration/type-structure tests
  (`supabase/tests/github_read_only_connections.test.ts`): 4 passed
- GitHub frontend client/UI tests (`src/features/integrations/github/*`, 7
  files): 34 passed
- GitHub focused suite (Worker + migration/type-structure + frontend
  client/UI): 109 passed
- GitHub live local Supabase RLS/lifecycle tests
  (`supabase/tests/github_read_only_connections.rls.test.ts`): 5 exist, gated
  and skipped by default in this run; not independently re-run against a live
  local Supabase stack this session, so "5 passed" there is not re-confirmed
  (see note below)
- Workspace tests (`src/features/workspace/**`, 11 files): 75 passed
  (unchanged from prior update)
- ChatPage tests (`src/pages/ChatPage.test.tsx`): 26 passed
- Full default test suite: 621 passed, 5 skipped, 626 total (54 test files
  passed, 1 skipped)
- Production build: passed (`npm run build` succeeded 2026-07-26)

Not reconfirmed this update — flagged rather than guessed:

- "Agent tests: 262 passed" (prior update): no single command or file-set
  in the repo defines exactly which tests this counted, and reconstructing
  it from directory scope alone produced two different numbers (239 for
  `src/features/agent/**` excluding `reasoning/`, 326 including it), neither
  matching 262. Removed rather than replaced with a guess.
- "TypeScript: passed" / "Worker TypeScript: passed" (prior update): there is
  no `tsc`/typecheck script in `package.json` (root or `agent/worker`) that
  this could refer to. Running `npx tsc --noEmit -p tsconfig.app.json`
  directly surfaces pre-existing errors in `SettingsPage.tsx`,
  `TutorAppPage.tsx`, and `TutorPage.tsx` — unrelated to this session's
  reasoning/disambiguation changes, but not something this update can call
  "passed" without knowing what the original claim was checked against.
  Removed rather than replaced with a guess.

Existing non-failing build warnings:

- large chunk warning
- empty `vendor-pdfjs` chunk warning

Live browser validation completed before the current ARUX matrix:

- TasksPage answers correctly in Persian, German, and English,
- Flow AI correctly resolves baseline task requests in Persian, German, and
  English,
- calendar distinction remains correct,
- explicit execution remains required,
- no false English-only capability response remains.

Current Agent Response UX Validation V1 status:

- deterministic response and intent tests pass,
- bounded authentication smoke passes against local Supabase,
- canonical ARUX evidence exists at
  `docs/testing/evidence/agent-response-ux-validation-v1.json`,
- Controlled Authenticated Browser Integration: `PASS` (15/15 rows),
- ARUX-11 verifies the already-complete task as an idempotent no-op without a
  duplicate mutation,
- ARUX-13 and ARUX-15 preserve Persian RTL flow while isolated Latin content
  computes as LTR,
- ARUX-14 keeps proposal, composed answer, and runtime summary in German,
- the controlled matrix used intercepted deterministic proposals,
- deterministic browser stubs are not treated as proof of real LLM intent
  recognition, worker transport, or real multilingual reasoning behavior,
- the separate local real-worker matrix is `PASS` (8/8), with canonical evidence
  at `docs/testing/evidence/real-worker-arux-matrix-v1.json`,
- every accepted real-worker row used one real Gemini request through local
  `/agent/reason`, local Supabase Auth, deterministic validation, and resolver
  output,
- the real-worker matrix granted no approval, executed no tool, persisted no
  reasoning request, and contacted no production service,
- neither matrix is production deployment validation.

---

## 9. Technical Debt

- `tasks.complete` is the only write slice; additional write tools require
  separate safety review.
- Conversation memory is not yet implemented.
- Semantic memory, vector memory, and RAG are not active.
- Right-rail learning/recommendation content still includes static placeholders.
- Some interaction events are only captured where the UI genuinely exposes them.
- Learn AI and chat-related storage still need pruning policies.
- Error tracking is not centralized.
- Supabase generated types now include the GitHub connection tables; future
  schema changes must continue using the canonical generation workflow.
  `github_connections.repository_names_cache` and `repository_names_cached_at`
  (added for reasoning-context repository-inventory disambiguation) are the
  first drift against this: the migration exists, `types.ts` was deliberately
  not hand-patched to add them (the prior hand-patched snapshot caused real
  bugs), so `Database["public"]["Tables"]["github_connections"]` is stale
  until the next canonical regeneration against a migrated database. Neither
  the Worker nor the frontend client currently import that generated shape
  for `github_connections`, so nothing depends on it today, but the next
  schema change should regenerate rather than adding a second undocumented
  drift on top of this one.
- Some older UI strings still need i18n/RTL polish.
- Production build still reports large Vite chunks.
- GitHub Read-only Integration V1 Slice 1 has passed clean local migration
  replay, canonical type refresh, two-user RLS/lifecycle tests, and a local
  authenticated Worker lifecycle smoke. A pre-registration hardening pass found
  and fixed three concrete blockers that the validations above depend on: the
  migration did not grant `service_role` any privilege on either new table
  (the Worker's own connection-lifecycle writes would have failed against a
  real database), the committed `types.ts` was a stale, hand-patched snapshot
  missing dozens of real tables predating this Slice, and five TypeScript
  regressions surfaced once the correct types were restored (a
  `WorkspaceSignalDomain`/`WorkspacePlanDomain` mismatch in two agent files, an
  unnarrowed `GitHubConnectionStatus` access, and two test-mock typing gaps).
  All are now fixed and independently re-verified. GitHub App registration,
  authenticated real-provider QA, and live production validation are complete:
  a natural-language GitHub repository request now resolves to the
  `inspect_github_repositories` intent, routes through explicit user Run, and
  returns a real repository list end to end in production.
- `/chat` has no `responseSchema`; the deterministic rescues in
  `validateAgentIntentProposal` (normalizing an unrecognized `type` via domain
  evidence, defaulting a non-literal `confidence` instead of treating it as
  low) exist *because* nothing at the API level constrains Gemini's `/chat`
  output to the intent schema, unlike the schema-enforced `/agent/reason`
  endpoint. These rescues are load-bearing, not defensive slack: removing them
  would silently break every `/chat`-routed intent proposal whenever Gemini
  drifts from the literal schema in prose, which it does routinely under
  `/chat`'s casual system persona and temperature 0.7.
- `/chat` persists the full reasoning prompt (safe context JSON plus
  instructions) into `agent_chat_messages` when used as a reasoning
  transport, instead of the user's actual message. Any feature that reads
  chat history — session titles, conversation memory, audit, chat export —
  will see the internal prompt text instead of what the user asked, and safe
  context data ends up stored in a table not designed to hold it.
- The GitHub OAuth callback returns raw JSON instead of redirecting back to
  SmartFlow, so a real user completing the GitHub OAuth flow lands on a bare
  JSON response instead of the app, reading as a broken integration and
  requiring manual navigation back.
- `handleSetup` does not read `setup_action`, so the setup phase cannot
  distinguish a fresh install from an update or a pending-approval request.
  `handleCallback`'s `setup_action === "request"` check is the only place
  that distinction is enforced today, and only when the callback is reached
  at all.
- The German task-domain evidence pattern in `intentValidator.ts`
  (`getStrongReadDomainEvidence`) matches bare `offen`/`offene`/`offenen`
  without requiring `Aufgabe` attached, unlike the stricter English task
  phrase requirement. This collides with any German GitHub phrasing that
  also uses "offene" — e.g. `"Zeige meine offenen Issues."` or `"Zeige meine
  offenen Pull-Requests."` — which now also carries github domain evidence,
  so both domains match and the deterministic validator returns
  `ask_clarification` instead of resolving directly, even though the message
  is unambiguous to a human reader. Worked around in tests by dropping
  "offen(e/en)" from German test phrasing rather than fixing the underlying
  regex, since narrowing it is a separate, broader change affecting the
  existing tasks intent, not scoped to the GitHub tools work that surfaced
  it.
- Persian possessive detection in `shouldUseReasoningForMessage`
  (`hasPersianPossessiveMarker`, `ChatPage.tsx`) only matches possession
  marked by "های" + suffix or a suffix after a ZWNJ. A bare enclitic suffix
  with no separator (`کارم`, `دستم`) is deliberately not matched, because
  those same letters are also ordinary word endings and a regex over the
  message text alone cannot tell them apart without a real morphological
  analyzer. This misses informal spoken-register Persian possessives
  (`کارم چیه؟`) — a real, known gap, not a hidden one. If the connected-repo
  inventory approach (see above) extends to give the model real context
  about what entities exist, that is the more promising path to close this,
  not a longer suffix list.
- The local real-worker reasoning validation flow
  (`docs/testing/local-real-worker-reasoning-v1.md`) requires a real Gemini
  credential in `agent/worker/.dev.vars` (git-ignored). Deleting that file and
  rotating/revoking the credential afterward is a manual step the validator
  must remember to do — there is no automated teardown, so a skipped manual
  step leaves a live credential on disk.
- `resolveDisambiguationCandidates`'s toolId-collision dedup (`intentValidator.ts`)
  keeps the first candidate in the model's returned array order. The kept
  candidate's `toolId` and card title/description are deterministic
  (map-derived from `type`, not model text), so which duplicate survives never
  changes what the card says it will do or what tool it runs. Its
  `reasons[0]` sub-text, however, is genuine model output, so on a collision
  the justification text shown can differ between runs depending on which
  duplicate the model happened to list first. Harmless, but noted so it isn't
  rediscovered as a "bug" later.

---

## 10. Next Sprint

Current next milestones: production proposal-boundary readiness review.
GitHub Read-only Integration V1 Slice 1 is complete and live; remaining
GitHub-related work (OAuth callback redirect, `handleSetup` `setup_action`
handling) is tracked under Technical Debt rather than as a blocking
milestone.

Recommended selection criteria:

- preserve explicit approval and execution boundaries,
- do not expand write tools without a separate safety review,
- keep runtime facts authoritative in final responses,
- keep browser QA mandatory for user-visible agent behavior,
- disclose proposal source and worker transport in every evidence row.
- retain fail-closed local/production configuration separation before any
  deployment validation.

---

## 11. Long-Term Roadmap

Possible future milestones, not implemented:

- manual multi-step plan execution
- conversation memory
- semantic memory
- vector/RAG memory
- additional approved write tools
- calendar write
- task creation
- document/email agent capabilities
- autonomous execution
- live AI-generated recommendations
- real multi-session conversation memory
