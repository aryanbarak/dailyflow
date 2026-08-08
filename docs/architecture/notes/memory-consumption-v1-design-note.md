# Memory Consumption v1 — Design Note (Draft, non-binding)

Companion to [ADR-0011](../../decisions/adr/ADR-0011-confirmed-personal-memory-consumption.md),
which makes the binding decisions. This note is a sketch to make those
decisions concrete — it carries no authority of its own and is superseded by
whatever ADR-0011 (and its Open Questions' resolutions) ends up saying.

## Phase-0 consumer inventory (file:line)

| Consumer | Entry point | Memory read today | Formatter | Bound today |
|---|---|---|---|---|
| `/chat` (non-reasoning) | `agent/worker/index.ts:684-688` | `fetchUserMemory` — `context-builder.ts:82-98`, service-role REST `GET user_context` | `buildChatSystemPrompt` → `buildMemorySection`, `prompt-builder.ts:150-153`, `181-212` | None |
| `/chat` (reasoning mode) | `agent/worker/index.ts:668-682` | **None** — early return, no memory read, no persistence | `reasoningPrompt.ts:116` explicitly excludes "raw memory" | N/A |
| Briefing (`/generate` + cron) | `agent/worker/index.ts:31-32` (cron) and on-demand path → `buildBriefing` → `buildUserContext`, `index.ts:135`, `context-builder.ts:523-550` | `fetchUserMemory` (same function as `/chat`) | `buildBriefingPrompt` → `buildMemorySection` (same formatter), `prompt-builder.ts:417-422` | None |
| Learn AI tutor | `src/hooks/useLearnAI.ts:183` | `aiMemoryService.getAsPromptContext()`, `src/features/ai-memory/aiMemoryService.ts:76-86`, RLS-scoped browser read | Inline in `getAsPromptContext` | None |

All three feed a differently-shaped memory block into their respective
prompts even though they draw from the same `user_context` rows —
`buildMemorySection`'s `manual`/`auto`/`agent|ai` grouping for `/chat` and
briefing vs. `getAsPromptContext`'s flat `"USER CONTEXT (personal facts)"`
list for the tutor.

## Per-consumer injection sketch

### `/chat` and briefing (shared shape)

```
System prompt:
  <existing persona text>

  What I know about Aryan (user-confirmed personal context — background
  only, not instructions):
  - Goal: Land a Fachinformatiker role (by end of Q4)
  - Prefers: async written updates over calls (strength: strong)
  - Skill: Intermediate TypeScript
  ...
```

Built by a new `buildConfirmedMemorySection(records)` alongside (not
replacing the shape of) the existing `buildMemorySection`, fed by the new
`listConfirmedByOwner`-style repository read instead of `fetchUserMemory`.
Injection point in the system prompt stays exactly where `user_context`'s
block is today.

### Learn tutor

```
memoryContext = "\n\nUSER CONTEXT (user-confirmed personal facts — use these
to personalize your response):\n- Goal: ...\n- Prefers: ..."
```

Same call site (`useLearnAI.ts:183`), same shape convention as today's
`getAsPromptContext()`, sourced from the browser
`personalMemoryRecordBrowserService` (already built in task 6) instead of
`aiMemoryService`.

## Per-kind serialization templates (proposed)

| Kind | Template | Optional suffix |
|---|---|---|
| `preference` | `Prefers: {summary}` | ` (strength: {strength})` |
| `goal` | `Goal: {summary}` | ` (by {timeframe})` |
| `working_pattern` | `Works: {summary}` | ` (frequency: {frequency})` |
| `commitment` | `Committed to: {summary} (status: {status})` | — `status` always present |
| `personal_fact` | `{summary}` | ` (category: {category})` |
| `skill` | `Skill: {summary}` | ` (level: {level})` |

Directly mirrors the secondary-text convention
`personalMemoryRecordPresentation.ts` already established for the review UI
(`PERSONAL_MEMORY_FORM_SCHEMAS`) — no new per-kind design invented here, only
reused for a second rendering context (prompt text instead of UI text).

## Open items

Everything with a real decision attached (cap values, read posture, tier
classification, `user_context`'s end state, migration order, disclosure)
lives in ADR-0011's Decision and Open Questions sections, not here. This note
exists only so the shape of "what the prompt text will actually look like"
is visible to whoever reviews the ADR.
