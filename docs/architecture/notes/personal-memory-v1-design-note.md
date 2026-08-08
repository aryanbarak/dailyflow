# Personal Memory v1 — design note

**Status:** Draft, non-binding. Sketches shape for the Product Owner's
review of [ADR-0010](../decisions/adr/ADR-0010-personal-memory-layer.md);
resolves nothing ADR-0010 itself reserves to the Product Owner.

## Phase-0 inventory summary (evidence for ADR-0010's Problem Statement)

**`user_context` actual schema**
(`supabase/migrations/20260605000004_user_context.sql`,
`20260616120000_user_context_allow_agent_source.sql`):

```
user_context(
  id uuid pk, user_id uuid fk, key text, value text,
  source text check in ('manual','auto','ai','agent'),
  created_at, updated_at
)
unique(user_id, key)
rls: "Users manage own context" using/with check (auth.uid() = user_id)
grant: ALL to authenticated (no SECURITY DEFINER gate)
```

One row per `(user_id, key)` — a write **overwrites**, no history, no
status, no confidence, no linkage to the chat turn or briefing a
`source='agent'` row came from.

**Row-source breakdown (from code, not runtime data — no query access in
this task):**

| Write path | Mechanism | `source` written | Gating |
|---|---|---|---|
| `aiMemoryService.set()` (Settings UI, manual edit) | browser, RLS | `manual` | none beyond RLS |
| `aiMemoryService.autoDetectAndSave()` (journal/habit/finance averages) | browser, RLS | `auto` | none beyond RLS |
| `extractAndSaveMemory()` (briefing extraction, Gemini) | Worker, service-role | `agent` | `ENABLE_AUTO_MEMORY_WRITE = true`, unconditional |
| `extractAndSaveMemoryFromChat()` (chat-turn extraction, Gemini) | Worker, service-role, background (`ctx.waitUntil`) | `agent` | `ENABLE_AUTO_MEMORY_WRITE = true`, unconditional |

**Consumers (repo-wide grep, `agent/worker` + `src`):**

| Consumer | Read mechanism | Purpose |
|---|---|---|
| `agent/worker/context-builder.ts` `fetchUserMemory` | Worker, service-role REST | injected into `/chat` system prompt |
| `agent/worker/prompt-builder.ts` `buildExtractionPrompt`/`buildChatExtractionPrompt` | via `ctx.memory` / passed-in `MemoryEntry[]` | shown to the extraction model itself, to avoid re-extracting the same fact |
| `src/features/ai-memory/aiMemoryService.ts` `getAsPromptContext()` | browser, RLS | injected into Learn AI tutor prompt (`src/hooks/useLearnAI.ts`) — a second, independent consumer of the same table |
| `src/features/ai-memory/AiMemoryTab.tsx` (Settings) | browser, RLS | the only existing user-facing review/edit/delete surface |
| `src/pages/SettingsPage.tsx` | browser, RLS (count only) | a "memory count" stat, not a review surface |

**Two independently maintained key lists** — a concrete, cited gap:
`EXTRACTABLE_KEYS` (`prompt-builder.ts`, what the model may write) and
`MEMORY_KEYS` (`aiMemoryService.ts`, what the Settings UI shows) are not the
same list. `preferred_name` is extractable but has no UI row at all.

**The one concrete "model inference silently became user truth" instance
found:** `AiMemoryTab.tsx`'s `MemoryRow` badge only recognizes
`source === 'auto'` or `source === 'manual'`; a `source: 'agent'` row
renders with no badge, visually identical to a plain user-typed value.

## Extraction pipeline shape (sketch, not decided)

```
[chat turn or briefing generated]
        |  (v1: an explicit user trigger, not automatic — ADR-0010 §3)
        v
[Worker: POST /personal-memory/extract-ish route]
  - authenticate with the user's own JWT (not service-role)
  - read eligible source material (recent chat turns / latest briefing,
    scope TBD by Q4)
  - call Gemini with a typed response schema (kind + content, mirroring
    context-derivation-endpoint.ts's shape)
  - validate each candidate against the canonical per-kind TS validator
    (new inferredPersonalMemoryValidation-equivalent module)
  - reject sensitive-category content even if the model proposes it
    (defense in depth beyond the system prompt's own instruction)
        v
[create_personal_memory_record RPC]
  - SECURITY DEFINER, search_path pinned, auth.uid()-resolved owner
  - duplicate suppression (fingerprint, incl. against rejected rows)
  - status: proposed
        v
[review UI — see below] -> confirm / correct / reject
        v
[confirmed/corrected records available to context synthesis, per Q5's
 eventual answer]
```

This mirrors `agent/worker/context-derivation-endpoint.ts`'s existing
shape closely enough that the same route module structure, error-code
conventions (401/404/409/422/502/503), and run-metadata pattern
(`inferred_context_derivation_runs`-equivalent) should be reusable almost
directly — a future implementation task should read that file as its
primary template, not design a new shape from scratch.

## Review-UI concept (sketch, not built — future Tier 2 task)

Reuses the interaction pattern already proven in
`src/features/projects/components/InferredContextSection.tsx` almost
directly:

- A "What SmartFlow has learned about you" section (Settings, or a new
  dedicated page) listing `PersonalMemoryRecord` rows grouped by `kind`
  instead of by project-context field kind.
- The same status/source disambiguation the project-layer UI already had
  to solve (a plain confirm keeps the model row's own status; a correction
  inserts a new `source: user` row) applies identically here — no new
  disambiguation rule needs inventing.
- Confirm / Correct / Reject actions, one record at a time, no batching —
  same discipline.
- **New, not present in the project-layer UI:** a permanent, always-visible
  **Delete** action available on a record of *any* status (not just
  `proposed`) — because ADR-0010 §2.a requires erasure to work regardless
  of status, unlike the project layer, which has no such requirement today.
- This section would fully replace `AiMemoryTab.tsx` once
  ADR-0010 Q3 (relationship to `user_context`) is answered and
  implemented — not before, and not automatically implied by this note.

## What this note deliberately does not do

It does not decide Q1-Q5. It does not propose a migration script. It does
not propose a schema (that is ADR-0010 §1's job, at the decision level, not
this note's). It exists only so the Product Owner can see the current
system's actual shape and a plausible implementation sketch side by side
with the ADR's proposals, before deciding anything.
