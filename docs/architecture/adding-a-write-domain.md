# Adding a write domain

Task 23 collapsed the ~10 places a new AI-agent write domain used to require
touching into one shared registry: `shared/writeIntentRegistry.ts`. It is
imported by both the Cloudflare Worker (`agent/worker/*`) and the frontend
(`src/*`) — the one module those two independently-deployed runtimes share.

Before task 23, adding a domain meant synchronized edits to: `AgentIntentType`,
five separate lists in `intentValidator.ts`, a duplicated schema copy in the
Worker (`reasoning-endpoint.ts`), per-toolId switches in `writeRuntime.ts`,
several derivation points in `ChatPage.tsx`, `flowWritePermissions.ts`'s
capability list, and the undo-kind CHECK constraint. Two production bugs
(task 22-fix, task 22-fix2) shipped from missing exactly one of those places.

## What a new domain needs now

**Acceptance bar: ~1 registry entry + 1 handler + 1 undo-kind migration line + translations.**

1. **One entry in `shared/writeIntentRegistry.ts`'s `writeIntentRegistry` array**
   per intent (usually two: create + update), each a `WriteIntentDescriptor`
   with:
   - `intentType`, `domain`, `action`, `toolId`, `capability`, `undoKind`
   - `targetIdField` (update only) or `createRequiredTargetFields` (create only)
   - `reversible`, `successSummary`
   - `i18n.titleKey` / `i18n.descriptionKey` / `i18n.approvalReasonKey`
   - `descriptionTitle`, `previewLines`, `buildHandlerInput` — small, pure
     functions; see the existing four entries for the shape. Reuse the
     domain's own deterministic parsers (date/time resolution etc.) inside
     these hooks the same way `create_calendar_event`/`update_calendar_event`
     do today — do not duplicate parsing logic into the registry itself.
   - If the new domain's fields aren't already in `WRITE_DOMAIN_TARGET_FIELDS`,
     add a domain key there (field name + schema type) — this is what
     the Gemini structured-output schema and the Worker's request-shape
     allow-list both read from.

   This one array update automatically flows into: `AgentIntentType`
   (frontend), `supportedIntentTypes` / `CONFIRMED_WRITE_INTENT_TYPES` /
   `intentToolMap` / `domainByIntent` (`intentValidator.ts`),
   `SUPPORTED_INTENT_VALUES` / the Gemini `responseSchema` target properties
   (`reasoning-endpoint.ts`), `SUPPORTED_WRITE_TOOL_IDS` /
   `expectedCapabilityForToolId` / `expectedStepShapeForToolId` /
   `writeTargetIsValid` / `buildHandlerInput` / `safeSummaryFor`
   (`writeRuntime.ts`), `stepForReasoning` / `approvalForReasoningStep` /
   `WRITE_PROPOSAL_TYPES` / `intentTitleKey` (`ChatPage.tsx`),
   `WIRED_FLOW_WRITE_CAPABILITIES` (`flowWritePermissions.ts`), and
   `UNDO_KIND_VALUES` (`flow-write-policy.ts`).

2. **One write handler** (frontend): `src/features/agent/handlers/<domain><Action>Handler.ts`,
   registered in `writeHandlers.ts`'s `registeredWriteHandlers` array — same
   as every existing handler. Not derivable from the registry (see below).

3. **One undo-kind migration line**: widen
   `flow_write_undo_records_kind_check`'s `kind in (...)` list to include the
   new `undoKind` value(s), in the same PR as the registry entry — the
   `flow-write-policy.test.ts` cross-check (task 22-fix2, now registry-driven)
   fails the build if the registry and the migration disagree, so this is
   caught locally rather than as a production `23514`.

4. **Translations**: the i18n key VALUES for `titleKey`/`descriptionKey`/
   `approvalReasonKey` (and any `agent_intent_preview_*` labels the new
   entry's `previewLines` hook needs) in `src/i18n/index.ts`, en/de/fa.

5. **Worker-side resolution** (unchanged shape, still hand-written — see
   below): a `parse<Domain>WriteIntent`/`assemble<Domain>WriteIntent`/
   `execute<Domain>AutoWrite` triad in `flow-write-policy.ts`, mirroring the
   existing `task`/`calendar` triads, plus wiring the new domain into
   `index.ts`'s dispatch (`resolvedDomain === '<domain>' ? assemble... : ...`).

## What stays hand-written, and why

The registry owns **registration** metadata — what does an already-decided
intent need. It deliberately does **not** own **intent resolution** — turning
free text into a decided intent in the first place:

- **Free-text detection regexes** (`requestLooksLikeTaskCreate` and its
  siblings in `intentValidator.ts`; `parseTaskWriteIntent`/
  `parseCalendarWriteIntent`'s trigger patterns in `flow-write-policy.ts`).
  These are genuinely per-domain natural-language patterns, not data a
  generic table can safely express.
- **Write-precedence ordering** (`intentValidator.ts`'s `baseType` ternary
  chain; `flow-write-policy.ts`'s `detectWriteDomainSignal`). This is a
  priority-ranked cascade spanning ALL intents together — read, write, and
  GitHub — with specific, documented ordering decisions (e.g. calendar
  evaluated before task; completion before either). Collapsing this into
  generic per-registry-entry iteration would risk silently reordering
  priority for a genuinely ambiguous message, which is exactly the kind of
  behaviour change task 23's own hard constraint (zero behaviour change)
  ruled out.
- **The Worker's execution triads** (`parse*WriteIntent`/`assemble*WriteIntent`/
  `execute*AutoWrite`, and the two-way dispatch ternary in `index.ts`). The
  Worker remains the authority for policy and resolution (task 23's own
  constraint) — these functions contain real Supabase I/O and domain-specific
  row shapes (`TaskRow` vs `CalendarEventRow`), not registrable data.
- **The undo payload's `previous`-value shape** (`UndoEntry`'s discriminated
  union in `flow-write-policy.ts`). Each domain's rollback snapshot mirrors
  that domain's own DB columns (e.g. task's `due_date`/`completed` vs
  calendar's `date`/`start_time`/`end_time`) — the registry only owns the
  `undoKind` *string*, not this payload shape.
- **The older, separate `AgentToolDefinition` catalog**
  (`src/features/agent/tools/*.ts`, `toolRegistry.ts`) — a richer,
  documentation-oriented tool catalog (examples, constraints, risk levels)
  predating this task, used by `toolRegistry.test.ts` and tool discovery.
  `writeRuntime.ts`'s `capability` check still cross-references it
  (`tool.capability !== expectedCapabilityForToolId(...)`); the registry's
  own `capability` field is kept in sync with it as data, not merged into it.

## Verifying a new entry

- `npx vitest run shared/writeIntentRegistry.test.ts` — registry-completeness
  checks (every entry has every required field; every write intent has
  exactly one entry and vice versa).
- `npx vitest run agent/worker/flow-write-policy.test.ts` — the undo-kind
  migration cross-check.
- `npm run provider-contract-smoke`-adjacent schema check: the Gemini
  `responseSchema`'s `target.properties`/`SUPPORTED_INTENT_VALUES` must still
  include every field/type your new fields declare — covered by
  `agent/worker/reasoning-endpoint.test.ts`.
