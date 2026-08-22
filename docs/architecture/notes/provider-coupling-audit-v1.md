# Provider Coupling Audit v1

**Date:** 2026-08-22
**Status:** Audit — read-only, no ADR decision made. This document maps current code; it does not propose an interface, an abstraction shape, or a migration plan.
**ADR numbering:** ADR-0017 (`docs/decisions/adr/ADR-0017-deterministic-bank-import-governance.md`) is the highest existing ADR. **ADR-0018** is the next free number for the eventual Provider Abstraction ADR.

All file paths are repo-relative to `C:/Projects/fiae-workspace/smartflow`. Every citation below was read directly from the file at the given line range during this audit (2026-08-22); none are copied from prior docs/ADRs without independent verification, and any place where a prior doc/ADR/migration comment disagrees with what the code actually does is called out explicitly.

---

## 1. Summary table

| Location | Capability | Coupling kind | Severity |
|---|---|---|---|
| `agent/worker/index.ts:1279` `callGemini` (briefing `/generate`) | [TEXT_GEN] | API | needs adapter |
| `agent/worker/index.ts:1348` `callGeminiChat` (`/chat`, mode="chat") | [TEXT_GEN] | API | needs adapter |
| `agent/worker/index.ts:1750` `/documents/analyze` | [TEXT_GEN] | API | needs adapter |
| `agent/worker/document-memory-extraction-endpoint.ts:257-263` `transcribePdf` | [TEXT_GEN] | API | needs adapter |
| `agent/worker/index.ts:293,400,522,627` (`/tasks`,`/calendar`,`/habits`,`/finance` suggestions) | [STRUCTURED_GEN] | API + schema | needs adapter |
| `agent/worker/index.ts:1396` `callGeminiReasoning` (`/chat`, mode="reasoning") | [STRUCTURED_GEN] | API + schema | needs adapter |
| `agent/worker/reasoning-endpoint.ts:575-618` `callGeminiOnce` (`/agent/reason`) | [STRUCTURED_GEN] | API + schema | needs adapter |
| `agent/worker/reasoning-endpoint.ts:513-573` `buildReasoningResponseSchema` | [STRUCTURED_GEN] | schema | needs adapter |
| `agent/worker/context-derivation-endpoint.ts:322-372,373-475` derivation call | [STRUCTURED_GEN] | API + schema | needs adapter |
| `agent/worker/personal-memory-extraction-endpoint.ts:435-492,531-642` extraction call | [STRUCTURED_GEN] | API + schema | needs adapter |
| `agent/worker/task-title-extraction.ts:31-101` title extraction | [STRUCTURED_GEN] | API + schema | needs adapter |
| `agent/worker/index.ts:1485,1587` `extractAndSaveMemory*` (dead code, `ENABLE_AUTO_MEMORY_WRITE=false`) | [STRUCTURED_GEN] | API + schema | cosmetic (unreachable) |
| `agent/worker/document-memory-extraction-endpoint.ts:42-43,435-482` `embedChunk` (`gemini-embedding-001`) | [EMBEDDING] | API + behavior | needs adapter |
| `agent/worker/personal-memory-extraction-endpoint.ts:994-1059` overlap dedup embedding | [EMBEDDING] | API + behavior | needs adapter |
| `supabase/migrations/20260811000000_document_chunks_pgvector.sql:92` `embedding vector(768) not null` | [EMBEDDING] | embedding | blocks abstraction |
| `agent/worker/personal-memory-extraction-endpoint.ts:514-517` `stripJsonFence` | [STRUCTURED_GEN] | behavior | needs adapter |
| `agent/worker/context-derivation-endpoint.ts:432-455` finishReason check (no fence-strip) | [STRUCTURED_GEN] | behavior | needs adapter (and internally inconsistent, see §3) |
| `agent/worker/reasoning-endpoint.ts:326-332` `extractJsonObject` (strict, no fence-strip) | [STRUCTURED_GEN] | behavior | needs adapter |
| `src/features/agent/reasoning/intentValidator.ts:894-913` unrecognized-confidence rescue | [STRUCTURED_GEN] | behavior | needs adapter |
| `src/features/agent/reasoning/intentValidator.ts:823-863` unrecognized-type → regex re-derivation | [STRUCTURED_GEN] | behavior | needs adapter |
| `src/features/agent/reasoning/intentValidator.ts:1002-1030` model-datetime override (calendar) | [STRUCTURED_GEN] | behavior | needs adapter (defense-in-depth, not Gemini-specific) |
| `src/features/agent/reasoning/intentValidator.ts:1039-1052` model-amount/IBAN override (finance) | [STRUCTURED_GEN] | behavior | needs adapter (defense-in-depth, not Gemini-specific) |
| `src/features/agent/reasoning/reasoningOrchestrator.ts:44-67` `fallbackRawProposal` | [STRUCTURED_GEN] | behavior | cosmetic (provider-agnostic fallback) |
| `src/features/agent/reasoning/llmReasoningService.ts:21-26` `extractJson` regex fence tolerance | [STRUCTURED_GEN] | behavior | needs adapter |
| `agent/worker/index.ts:293-320,400-427,522-547,627-653,1750-1758,1279-1293,1348-1363` `thinkingConfig: { thinkingBudget: 0 }` on every non-embedding call | [TEXT_GEN]/[STRUCTURED_GEN] | prompt/API | blocks abstraction (Gemini-2.5-specific quirk) |
| `workers/ai-worker-recovered/index.js:11-15,52-87` `AI_PROVIDERS` fallback list + Workers AI fallback | [TEXT_GEN] | API + behavior | needs adapter (already multi-provider in this one Worker) |
| `workers/ai-worker-recovered/index.js:465-508` `stripMarkdownFence` / `extractJsonObject` | [STRUCTURED_GEN] | behavior | needs adapter |
| `workers/ai-worker-recovered/index.js:928-931` `MAX_TOKENS` truncation handling | [STRUCTURED_GEN] | behavior | needs adapter |
| `src/features/learn-ai/aiService.ts:4,35-78` `askLearnAI` → `api.barakzai.cloud/analyze` | [OTHER] | API (external server, source recovered in-repo) | needs adapter |
| `src/hooks/usePhotos.ts:7,119-131` photo tagging → `api.barakzai.cloud/photos/analyze` | [OTHER] | API (external server) | needs adapter |
| `src/features/documents/documentAiService.ts` → `/documents/analyze` (same-repo Worker) | [TEXT_GEN] | API | needs adapter |
| `src/features/documents/components/PdfOcrTool.tsx`, `BankImportTool.tsx` → `/ocr`, `/import-bank` | [STRUCTURED_GEN]/[TEXT_GEN] | API (external server) | needs adapter |
| `agent/worker/types.ts:127-130` `ChatOptions.maxOutputTokens` | [TEXT_GEN] | type | cosmetic |
| `agent/worker/index.test.ts:40-41` `GeminiContentPart`/`GeminiContentEntry` (test-only) | [TEXT_GEN] | test/type | cosmetic |
| 12+ `agent/worker/*.test.ts` files mocking `generativelanguage.googleapis.com` directly | [TEXT_GEN]/[STRUCTURED_GEN]/[EMBEDDING] | test | needs adapter |
| `scripts/provider-contract-smoke.ts` (whole file) | [TEXT_GEN]/[STRUCTURED_GEN]/[EMBEDDING] | test | needs adapter |
| `supabase/config.toml` (4 lines, no `[api]` port block) | [OTHER] | — | needs adapter (informs D4, not provider-coupling per se) |

---

## 2. Scope 1 — Direct API calls

### In `agent/worker/` (the live Cloudflare Worker)

Every one of the following is a direct `fetch()` to `https://generativelanguage.googleapis.com/v1beta/models/...` — **confirmed from code**, one call site per line cited:

| Function | File:line | Endpoint suffix | Structured? |
|---|---|---|---|
| `handleTaskSuggestions` | `agent/worker/index.ts:293` | `:generateContent` | yes (schema, §3) |
| `handleCalendarSuggestions` | `agent/worker/index.ts:400` | `:generateContent` | yes |
| `handleHabitSuggestions` | `agent/worker/index.ts:522` | `:generateContent` | yes |
| `handleFinanceSuggestions` | `agent/worker/index.ts:627` | `:generateContent` | yes |
| `callGemini` (briefing, `/generate`) | `agent/worker/index.ts:1279` | `:generateContent` | no |
| `callGeminiChat` (`/chat`, mode="chat") | `agent/worker/index.ts:1348` | `:generateContent` | no |
| `callGeminiReasoning` (`/chat`, mode="reasoning") | `agent/worker/index.ts:1396` | `:generateContent` | yes |
| `extractAndSaveMemory` (dead code) | `agent/worker/index.ts:1485` | `:generateContent` | yes |
| `extractAndSaveMemoryFromChat` (dead code) | `agent/worker/index.ts:1587` | `:generateContent` | yes |
| `/documents/analyze` handler | `agent/worker/index.ts:1750` | `:generateContent` | no |
| `callGeminiForDerivation` | `agent/worker/context-derivation-endpoint.ts:379` | `:generateContent` | yes |
| `callGeminiForExtraction` | `agent/worker/personal-memory-extraction-endpoint.ts:538` | `:generateContent` | yes |
| `embedTextForOverlap` | `agent/worker/personal-memory-extraction-endpoint.ts:1034` | `:embedContent` | n/a (embedding) |
| `transcribePdf` | `agent/worker/document-memory-extraction-endpoint.ts:263` | `:generateContent` | no |
| `embedChunk` | `agent/worker/document-memory-extraction-endpoint.ts:441` | `:embedContent` | n/a (embedding) |
| `callGeminiForTaskTitle` | `agent/worker/task-title-extraction.ts:60` | `:generateContent` | yes |
| `callGeminiOnce` (`/agent/reason`) | `agent/worker/reasoning-endpoint.ts:581` | `:generateContent` | yes |

**Model strings** — confirmed from code:
- `agent/worker/worker-configuration.d.ts:5` declares the local dev binding default `GEMINI_MODEL: "gemini-2.5-flash"`.
- Every other call site above reads the model name from `env.GEMINI_MODEL` (an env var, no fallback default in production code) — the model string itself is never hard-coded in `agent/worker/index.ts`, `reasoning-endpoint.ts`, `context-derivation-endpoint.ts`, `personal-memory-extraction-endpoint.ts`, or `task-title-extraction.ts`. Test fixtures set it to `'gemini-2.5-flash'` (e.g. `agent/worker/index.test.ts:16`).
- The embedding model name **is** hard-coded, in two places: `agent/worker/document-memory-extraction-endpoint.ts:42` (`const EMBEDDING_MODEL = 'gemini-embedding-001'`) and `agent/worker/personal-memory-extraction-endpoint.ts:994` (`const OVERLAP_EMBEDDING_MODEL = 'gemini-embedding-001'`) — two independent copies of the same constant, not shared.
- `agent/worker/document-memory-extraction-endpoint.ts:42` carries a comment: `// text-embedding-004 was retired Jan 2026 (task 16-fix); successor model` — evidence this repo has already lived through one provider-side model retirement.

**No retry/fallback-to-another-model logic exists anywhere in `agent/worker/`** — confirmed from code. Every `callGemini*`/`embed*` function above makes exactly one HTTP call and either returns or throws; none of them loop over a list of model names or fall back to a different provider on failure. This is a real difference from the recovered older Worker (see below).

### In `workers/ai-worker-recovered/` (separate, older Cloudflare Worker — `dailyflow-ai-worker`)

This directory is the actual production script of a **different, separately-deployed Worker**, pulled read-only from the Cloudflare account via the REST API (see `workers/ai-worker-recovered/PROVENANCE.md:1-51` for the recovery method, SHA256, and the one intentional post-recovery edit). Per `workers/ai-worker-recovered/wrangler.toml:20-50`, it is routed on `api.barakzai.cloud` for `/analyze`, `/import-bank`, `/ocr`, `/photos/*`, `/search`, `/translate`, `/tts`, `/tts-azure` — this is the concrete server behind scope item 6 (§7).

Confirmed from code, `workers/ai-worker-recovered/index.js`:
- `:11` `GEMINI_DIRECT_BASE = "https://generativelanguage.googleapis.com/v1beta/models"`.
- `:12-15` `AI_PROVIDERS` is a hard-coded, ordered **fallback list**: `[{ name: "gemini-2.5-flash", model: "gemini-2.5-flash" }, { name: "gemini-2.0-flash", model: "gemini-2.0-flash" }]`. This is the "2.5 Flash, 2.0 Flash fallback" the audit brief anticipated — it exists, but only in this older Worker, not in `agent/worker/`.
- `:16-21` `geminiBase(env)` — if `env.CF_ACCOUNT_ID` and `env.CF_GATEWAY_NAME` are set, routes through `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/google-ai-studio/v1beta/models` (Cloudflare AI Gateway) instead of calling Google directly; otherwise falls back to the direct Gemini URL.
- `:52-87` `callGeminiWithFallback` — loops `AI_PROVIDERS` in order, retrying the next model on a network error or a `429`/`5xx` response (`:69-74`), and on exhausting the list falls through to `callWorkersAI` (`:23-50`), which calls Cloudflare's own `env.AI.run("@cf/meta/llama-3.1-8b-instruct", ...)` binding — a **genuine cross-provider fallback to a non-Gemini model**, already implemented in this one file, and already wrapping its Workers-AI response back into a fake Gemini-shaped `{ candidates: [...] }` envelope (`:44-49`) so every caller downstream stays unaware of which provider actually answered.
- Env var names referenced (not values): `GEMINI_API_KEY` (e.g. `:226`, `:419`, `:538`, `:844`), `CF_ACCOUNT_ID`, `CF_GATEWAY_NAME` (`:17`), `ELEVENLABS_API_KEY` (`:680`), `AZURE_TTS_KEY`, `AZURE_TTS_REGION` (`:726`), `DEEPL_API_KEY` (`:820`).

This confirms: the "provider fallback" pattern the audit brief hypothesized already exists in the codebase — just not in the currently-live `agent/worker/`, and it is itself a second, independent implementation with its own model list, its own JSON-extraction logic, and its own env vars.

### In the browser (`src/`)

**Confirmed from code: zero direct `fetch()` calls from browser code to `generativelanguage.googleapis.com`.** The grep in §Search Method below covered all of `src/` and found matches only in test files unrelated to direct Gemini calls (personal-memory/project-context test fixtures that assert on Worker-side behavior, not browser-side Gemini calls). All browser-side AI calls go through same-repo Cloudflare Workers (`agent/worker/` or the separately-deployed `dailyflow-ai-worker` at `api.barakzai.cloud`) — never directly to Google. This is a clean seam: **the browser never holds or sees `GEMINI_API_KEY`.**

---

## 3. Scope 2 — Structured output: `/agent/reason` vs `/chat`

This is directly provable from code, not inferred.

**`/agent/reason` (`agent/worker/reasoning-endpoint.ts`) is always schema-enforced.** `handleLocalReasoningRequest` (`:620-680`) calls `callGeminiOnce` (`:575-618`) unconditionally on every request; `callGeminiOnce`'s request body (`:585-601`) always sets `generationConfig.responseMimeType: 'application/json'`, `responseSchema: buildReasoningResponseSchema()` (`:596-598`), plus `thinkingConfig: { thinkingBudget: 0 }` and `temperature: 0`. There is no code path in this file that calls the model without a schema.

**`/chat` (`agent/worker/index.ts`) branches on the `mode` field of the request body, and only one branch is schema-enforced.** `handleChat` (`:993-1270`) reads `mode: 'reasoning' | 'chat'` from the body (`:1027`). At `:1052-1061`, when `mode === 'reasoning'`, it calls `callGeminiReasoning` (`:1390-1431`), whose request body (`:1400-1414`) sets the exact same `responseMimeType`/`responseSchema: buildReasoningResponseSchema()`/`thinkingConfig` triplet as `/agent/reason` — confirmed identical schema function, imported from `reasoning-endpoint.ts` (`agent/worker/index.ts:8`). The comment at `agent/worker/index.ts:1381-1389` states this directly: *"Schema-enforced like `/agent/reason`'s `callGeminiOnce`, so the model cannot return prose."*

But when `mode !== 'reasoning'` (the default / ordinary chat turn), `handleChat` falls through to `:1216`, calling `callGeminiChat` (`:1318-1379`) instead. That function's request body (`:1352-1361`) sets only `maxOutputTokens`, `temperature`, and `thinkingConfig` — **no `responseMimeType`, no `responseSchema`.** The model is free to return prose here, which is exactly the intent: ordinary chat replies are natural-language text, not a structured intent proposal.

So the frontend transport layer (`src/features/agent/reasoning/reasoningTransportConfig.ts:38-86`) determines *which* endpoint/shape a given caller uses:
- `mode: 'stateful-chat'` → POST `{workerUrl}/chat` with `{ message, session_id, responseLanguage, mode: "reasoning" }` (`llmReasoningService.ts:51-56`, transport `'stateful-chat'`) — this is the schema-enforced reasoning branch of `/chat` described above, used in production.
- `mode: 'local-real-worker'` / `'deterministic-browser-stub'` → POST `{workerUrl}/agent/reason` with `{ requestId, reasoningPrompt, responseLanguage }` (`llmReasoningService.ts:51-56`, transport `'structured-reasoning'`) — QA-only paths gated by `SMARTFLOW_WORKER_MODE=local-qa` (`reasoning-endpoint.ts:178-180`), never reachable in production per `agent/worker/reasoning-endpoint.ts`'s own `LOCAL_WORKER_MODE` gate and `docs/decisions/adr/ADR-0003-agent-reason-local-qa-only.md` (title alone confirms the intent; not independently re-verified beyond the gate check in code, which is the load-bearing part).

**Also schema-enforced** (confirmed from code, same `responseMimeType`+`responseSchema` pattern): the four `/*/suggestions` endpoints (`agent/worker/index.ts:301-317, 408-424, 530-546, 635-652`), the derivation endpoint (`context-derivation-endpoint.ts:390-402`), the personal-memory extraction endpoint (`personal-memory-extraction-endpoint.ts:549-565`), and the task-title endpoint (`task-title-extraction.ts:69-75`).

**Never schema-enforced** (confirmed from code): the briefing generator `callGemini` (`index.ts:1275-1313`, only `maxOutputTokens`/`temperature`/`thinkingConfig`), `/documents/analyze` (`index.ts:1749-1759`, only `temperature`/`maxOutputTokens`), and the PDF transcription call `transcribePdf` (`document-memory-extraction-endpoint.ts:270-277`, only `maxOutputTokens`/`temperature` — this one because the desired output IS free text, not JSON).

---

## 4. Scope 3 — Behavioral coupling (rescue/normalization logic)

This is the section with the most and the most consequential findings. Every rescue branch below is listed individually.

### `intentValidator.ts` (`src/features/agent/reasoning/intentValidator.ts`) — `validateAgentIntentProposal`

1. **Non-object rescue** (`:734-742`): if the parsed model output isn't a plain object, forces `ask_clarification` rather than crashing. Generic defensive coding, not Gemini-specific.
2. **Rejected-field rescue** (`:744-751`, using `hasRejectedFields` at `:198-207`): if the model's JSON contains `userId`/`user_id`/`actions`/`extraActions`/`toolIds`/`code`, forces `unsupported`. This compensates for a model inventing fields outside the schema's declared property set — Gemini's `responseSchema` with `additionalProperties` unset does not hard-reject extra keys the way some strict-schema APIs do, so this is a real, provider-behavior-shaped guard, not pure paranoia.
3. **`import_bank_statement` backstop** (`:779-786`): explicitly rejects this one intent type even though it is schema-derivable, because `reasoning-endpoint.ts`'s `SUPPORTED_INTENT_VALUES` (`:28-44`) already filters it out at the Gemini schema level (`exposure === 'chat'` filter, `reasoning-endpoint.ts:20-27`). The comment at `intentValidator.ts:755-778` calls this "the BACKSTOP for a malformed/bypassed model response... or this function being reused against some other input source entirely" — i.e. explicitly defense-in-depth against the schema constraint failing, not evidence the schema constraint is known to fail today.
4. **Unrecognized-type rescue** (`:788, 823-863`): `initialTypeSupported` check plus `normalizeReadIntentFromEvidence` (`:682-716`) — if the model returns a `type` outside `supportedIntentTypes`, the validator falls through to deterministic **regex evidence over the user's own raw message** (`getStrongReadDomainEvidence`, `:645-680`, and the tool-specific evidence tables at `:565-619`) to re-derive a type, rather than trusting the model's string verbatim. This is defense-in-depth against `responseSchema`'s `enum` constraint not being airtight, or the model choosing a value outside the enum despite the constraint (both are provider-quirk-shaped, though the code comment frames it generically as "not evidence of low confidence... an unusable value").
5. **Unrecognized-confidence rescue** (`:894-913`): `proposedConfidence` outside `{low, medium, high}` (e.g. Gemini "sending 0.9 instead of `\"high\"`" per the comment at `:894-896`) is treated as `"medium"` rather than rejected outright — an explicit, named Gemini-output-drift compensation.
6. **Model-datetime override, create** (`:1002-1030`): a model-proposed `start`/`end` for `create_calendar_event` is **always discarded** and re-derived deterministically from the raw user message via `parseDeterministicTimeRange`/`zonedDateTimeToUtcIso`. The comment (`:1002-1009`) states this exists because "production evidence showed the model's own guessed start date reaching the approval card verbatim (a full month off)" — a directly observed Gemini hallucination this code was written to neutralize.
7. **Model-datetime override, update** (`:1146-1166`): same override for `update_calendar_event`, with a fallback to the existing event's own date when the message only carries a new time-of-day.
8. **Model-amount/IBAN override** (`:1039-1052`): for `create_finance_transaction`, `target.amount`/`currency`/`direction`/`transactionDate`/`iban` are all re-derived deterministically from the raw message and **overwrite** whatever the model proposed — comment at `:1031-1038` explicitly parallels this to the calendar-datetime override as "the same 'never trust the model's own value' rule."
9. **IBAN mod-97 validation** (`:1196-1208`): an IBAN-shaped token that fails checksum validation is rejected with `ask_clarification`, never silently passed through or silently dropped.

Items 6-8 are framed by their own comments as a blanket "never trust a model-proposed value for this field" policy rather than a Gemini-specific parsing quirk — i.e. they would very plausibly be written the same way against any other structured-output-capable provider. They are listed here because they are model-output rescues, but their motivating evidence (the "full month off" date) was an observed Gemini failure specifically.

### `reasoning-endpoint.ts` — `normalizeProposal` (`:355-473`) and `extractJsonObject` (`:326-332`)

- `extractJsonObject` (`:326-332`) is **strict**: it throws unless the trimmed text starts with `{` and ends with `}` — **no markdown-fence stripping at all**. The `Task 21-fix6`-era comment on the sibling `task-title-extraction.ts` and the `personal-memory-extraction-endpoint.ts:507-513` comment both describe this exact function as "proven working" without fence-stripping, used as the justification for *not* adding fence-stripping to that other endpoint (see below) — but the reasoning is circular defensive engineering, not an empirically stronger claim: `responseMimeType: 'application/json'` is what actually prevents fences, per both comments.
- `normalizeProposal` (`:355-473`) is a whitelist-shaped normalizer: unknown top-level fields throw (`:361-363`), unknown `target` fields throw (`:384-386`), unknown `candidates[]` fields throw (`:451-453`), every string field is bounded via `boundedString`/`boundedStringArray` (`:334-353`), and `MAX_SCHEMA_CANDIDATES = 6` (`:93`) caps a pathological `candidates` array server-side, independent of the schema's own `maxItems: 6` (`:555`) — described in the code comment (`:89-93`) as "a defensive schema ceiling... not the disambiguation limit," i.e. redundant defense against the schema constraint being bypassed.

### `personal-memory-extraction-endpoint.ts` — `stripJsonFence` (`:514-517`) and `callGeminiForExtraction` (`:531-642`)

- `stripJsonFence` (`:514-517`) **does** strip a `\`\`\`json ... \`\`\`` or `\`\`\` ... \`\`\`` fence wrapping the entire response — the exact "JSON-fence-stripping step" the audit brief asked about. Its own comment (`:507-513`) frames it as "defensive hardening, not an observed divergence" and explicitly notes `reasoning-endpoint.ts`'s `extractJsonObject` does *not* do this. **This means the codebase currently has two different policies for the same provider quirk class, side by side**, justified only by "cheap and narrow... never touches content in the middle of an otherwise-bare object," not by any documented case where Gemini actually fenced a `responseMimeType: 'application/json'` reply.
- `finishReason !== 'STOP'` check (`:610-617`) — explicitly named as compensating for `finishReason: 'MAX_TOKENS'` (truncation), mirroring `reasoning-endpoint.ts`'s identical check (comment at `:605-606`: "mirrors reasoning-endpoint.ts's own finishReason check").
- `thinkingConfig: { thinkingBudget: 0 }` (`:563`, comment `:553-563`) — explicitly named as a Gemini-2.5-specific fix: *"gemini-2.5-flash spends output tokens on internal 'thinking' by default... which can exhaust maxOutputTokens before any JSON is emitted."* This is present on **every** non-embedding Gemini call in `agent/worker/` (verified: `index.ts:315,423,544,649,1290,1359,1410,1507,1609`; `context-derivation-endpoint.ts:401`; `personal-memory-extraction-endpoint.ts:563`; `task-title-extraction.ts:73`; `reasoning-endpoint.ts:597`) — a single, repeated, model-family-specific parameter with no equivalent concept in most other providers' APIs.
- Batched-extraction partial-failure handling (`runBatchedDocumentExtraction`, `:701-`) catches each batch's `ProviderCallError` independently rather than failing the whole run — general resilience engineering, not Gemini-specific.

### `context-derivation-endpoint.ts` — `callGeminiForDerivation` (`:373-475`)

Same `finishReason !== 'STOP'` check (`:448-455`), same `thinkingConfig` fix (`:401`) — but **no `stripJsonFence` call** (`:458-462` goes straight from `text.trim()` to the `startsWith('{')`/`endsWith('}')` check, no fence-stripping step at all). This is the third distinct policy in the codebase for the same underlying provider quirk: `reasoning-endpoint.ts` never strips fences, `personal-memory-extraction-endpoint.ts` strips fences defensively, `context-derivation-endpoint.ts` doesn't strip fences and has no comment explaining the omission. **Confirmed from code**: this is an actual inconsistency, not a documented, deliberate difference.

### `reasoningOrchestrator.ts` — `fallbackRawProposal` (`:44-67`)

If `parseLlmIntentJson` fails to find any JSON object at all in the raw model text, the orchestrator synthesizes a safe `ask_clarification` proposal client-side (`:44-67`) rather than surfacing an error. This is a total-parse-failure fallback, not specific to any particular malformation pattern — it would behave identically regardless of which provider produced the unparseable text.

### `llmReasoningService.ts` — `extractJson` (`:21-26`)

```
if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
const match = trimmed.match(/\{[\s\S]*\}/);
return match?.[0] ?? "";
```
This is a **more permissive** fence/preamble-tolerant extractor than either Worker-side `extractJsonObject`: it will find a JSON object anywhere in the string via `/\{[\s\S]*\}/`, including inside markdown fences or after prose. This runs client-side, on the *response* the browser gets back from `/chat`'s `reasoning` mode (§3) — i.e. it is a second, independent, more lenient JSON-extraction implementation sitting downstream of the Worker's own already-strict extraction, for the exact same payload.

### `workers/ai-worker-recovered/index.js` (older Worker — verified independently, not copied from prior findings)

- `stripMarkdownFence` (`:465-467`) + `findJsonEnd`/`extractJsonObject` (`:469-509`) — a brace-depth-aware JSON extractor (handles nested `{}` inside string values correctly, unlike a naive `indexOf('{')`/`lastIndexOf('}')`), used only for the `/ocr` summary step (`:631`). The `/import-bank` handler (`:932-951`) uses a **cruder** `indexOf('{')`/`lastIndexOf('}')` pair instead (`:936-939`) — a fourth distinct JSON-extraction implementation in the codebase.
- `MAX_TOKENS` truncation handling (`:928-931`): `/import-bank` explicitly detects `finishReason === 'MAX_TOKENS'` and returns a user-facing "too many transactions, try a shorter date range" error rather than attempting to parse a truncated JSON body — this **is** verified from current code, confirming the audit brief's expectation.

---

## 5. Scope 4 — Embeddings

**Model and dimension:** `gemini-embedding-001` requested at `outputDimensionality: 768` (its native output is 3072-dim) — confirmed at `document-memory-extraction-endpoint.ts:42-43,449` and `personal-memory-extraction-endpoint.ts:994-995,1041`.

**Client-side L2-normalization is required and enforced**, because — per the code comment at `document-memory-extraction-endpoint.ts:484-487` — "`gemini-embedding-001` at a non-default `outputDimensionality` is NOT unit-normalized by the provider (unlike its native 3072-dim output)... callers requesting a truncated dimensionality must normalize client-side." `l2Normalize` (`document-memory-extraction-endpoint.ts:488-`) does this, and `embedChunk` (`:476-480`) throws `MODEL_OUTPUT_UNUSABLE` if the resulting norm isn't within `EMBEDDING_NORM_EPSILON` of 1. `personal-memory-extraction-endpoint.ts` has an independent, duplicated copy of the same logic (`l2NormalizeOverlap`, referenced at `:1056-1059`; comment at `:1027` states it "Mirrors document-memory-extraction-endpoint.ts's own embedChunk (same model, same dimensionality, same client-side L2-normalization requirement) -- duplicated, not imported, per this file's own zero-cross-import convention"). This normalization requirement is a documented, provider-specific behavior of `gemini-embedding-001` at truncated output dimensionality — a different embedding provider/model would very plausibly not need this step, or would need a different one.

**Every place a vector dimension is hard-coded:**
- `supabase/migrations/20260811000000_document_chunks_pgvector.sql:92` — `document_chunks.embedding vector(768) not null`. This is the **only** persisted-embedding column found in `supabase/migrations/` (confirmed via `grep -r "vector(" supabase/migrations/`, one match, one file).
- The migration's own header comment (`:88-90`) says *"text-embedding-004, 768 dimensions... Gemini's stable embedding model"* — **this directly disagrees with the code**, which uses `gemini-embedding-001` (confirmed at `document-memory-extraction-endpoint.ts:42`, with that file's own comment explaining `text-embedding-004` was retired and `gemini-embedding-001` is its replacement). The migration comment was evidently not updated when the model was swapped; the migration's actual DDL (`vector(768)`) still matches current code because 768 was chosen as the requested `outputDimensionality` for the new model too, but the prose is stale. **Flagging this explicitly per this audit's instructions to note ADR/doc-vs-code disagreement.**
- `document-memory-extraction-endpoint.ts:43` and `personal-memory-extraction-endpoint.ts:995` each independently hard-code `768` as `EMBEDDING_DIMENSIONS`/`OVERLAP_EMBEDDING_DIMENSIONS` — two separate constants, not shared, both required to stay in sync with the one migration's `vector(768)` by convention only (no shared source of truth, no runtime check that they match).

**`personal_memory_records` does not persist any embedding.** Confirmed from `supabase/migrations/20260808000000_personal_memory_records.sql` (grepped for `embedding`, zero matches) — the embedding computed in `personal-memory-extraction-endpoint.ts`'s `embedTextForOverlap` (`:1028-1059`) is used transiently, in-process, only to score near-duplicate candidates against already-existing records before a write (`findPossibleUpdateTarget`, `:1105-`), then discarded. Only `document_chunks` has a stored, schema-level `vector(768)` column.

---

## 6. Scope 5 — Prompt coupling

- **`thinkingConfig: { thinkingBudget: 0 }`** — see §4. This is the single most pervasive Gemini-specific request parameter in the codebase: it appears on every non-embedding `generateContent` call in `agent/worker/`, and has no equivalent concept in a generic chat-completions API shape (no other major provider API models "thinking token budget" the same way).
- **`maxOutputTokens` hard-coded per call site**, varying by purpose: 768 for reasoning (`reasoning-endpoint.ts:594`), 256 for the four `/*/suggestions` endpoints, 1024/1500 for briefings (`index.ts:190`), 2048 for chat, 4096 for `/documents/analyze` and OCR summary rescue (`workers/ai-worker-recovered/index.js:618`), 8192 for PDF transcription (`document-memory-extraction-endpoint.ts:276`), 16384 for `/import-bank` (`workers/ai-worker-recovered/index.js:910`), 128 for task-title (`task-title-extraction.ts:70`), 512/256 for the dead-code memory extractors. These are tuned against Gemini's actual token accounting (which, per the `thinkingConfig` comment, spends some of this budget on internal reasoning by default) — a different provider's token economics could require re-tuning every one of these constants, not just a config swap.
- **`system_instruction` as a distinct top-level request field**, separate from `contents[]` — every call site (`agent/worker/index.ts:1283,1352,1401`, `reasoning-endpoint.ts:589`, `context-derivation-endpoint.ts`, `personal-memory-extraction-endpoint.ts:547`, `task-title-extraction.ts:67`) uses Gemini's `system_instruction: { parts: [{ text }] }` shape, distinct from a `role: 'system'` turn inside `contents[]`. `callGeminiChat` (`index.ts:1339-1343`) maps SmartFlow's own `assistant`/`user` roles to Gemini's `model`/`user` roles at the point of the API call — a real format seam, but one that's already isolated to that one mapping line.
- **Prompt text itself is not written in Gemini-specific vocabulary.** `reasoningPrompt.ts:112-177` (`buildReasoningPrompt`) says "Return JSON only" (`:122`) and lists supported intents/mappings in plain English/German/Persian — no reference to Gemini, no reference to any provider-specific formatting convention (no "use the function-calling API," no safety-setting language, no mention of `thinkingConfig` from within the prompt text itself). The prompt-level coupling is confined to the request envelope (`system_instruction`, `responseSchema`, `thinkingConfig`), not the prompt prose.
- **Safety settings**: no code in `agent/worker/` or `src/` was found configuring Gemini `safetySettings` explicitly (grepped for `safetySettings`, `HARM_`, zero matches in application code). The only safety-adjacent behavior is the generic `finishReason !== 'STOP'` check (§4), which treats any non-STOP finish (safety block, recitation block, truncation, or anything else) identically — undifferentiated, and therefore not itself a source of Gemini-specific coupling beyond the finishReason vocabulary (`STOP`, `MAX_TOKENS`, etc.) itself being Gemini's.

---

## 7. Scope 6 — External AI servers not fully auditable from this repo

**Important correction to the audit brief's framing:** `api.barakzai.cloud` is not a fully external, unauditable black box. Its actual production source has been recovered into this same repository at `workers/ai-worker-recovered/index.js` (see `PROVENANCE.md` for the recovery method and integrity hash), and its Gemini coupling is fully documented in §2 and §4 of this audit above. This is a **separately-deployed Cloudflare Worker** (`dailyflow-ai-worker`, per `wrangler.toml:12`), not part of the same deployment as `agent/worker/`, but it is not "not in this repo" in the sense the audit brief anticipated. What remains genuinely unauditable from here is only: (a) whatever has changed on the live deployment since the 2026-06-30 recovery snapshot plus the one documented 2026-08-16 CORS edit (no way to confirm from static source alone), and (b) any Cloudflare-side binding/secret configuration not visible in `wrangler.toml` (secrets are declared write-only, per `PROVENANCE.md:38-40`).

Frontend call sites that hit `api.barakzai.cloud` (confirmed from code, what SmartFlow sends/expects — the server's own internal implementation for these routes is documented above via the recovered source, not UNKNOWN):

| Caller | File:line | Route | Sends | Expects back |
|---|---|---|---|---|
| Learn AI tutor | `src/features/learn-ai/aiService.ts:4,41-77` | `POST /analyze` | `{ message, history, mode, language, responseLanguage, memoryContext, fileData }` | `{ answer: string }` |
| Photo AI tagging | `src/hooks/usePhotos.ts:7,119-131` | `POST /photos/analyze` | `{ key }` (R2 object key) | `{ tags?: string[] }` |
| Document translation | `src/features/documents/translationService.ts:1-38` | `POST /translate` | `{ text, sourceLang, targetLang }` | `{ translated, detected_source? }` |
| PDF OCR tool | `src/features/documents/components/PdfOcrTool.tsx:16` | `POST /ocr` | multipart file + language | `{ text, characters, summary }` |
| Bank statement import (older, non-batch path) | `src/features/finance/components/BankImportTool.tsx:13` | `POST /import-bank` | multipart PDF | `{ transactions[], account_holder, statement_period, ... }` |
| Music search | `src/pages/MusicPage.tsx:41` | `GET /search` | query string | `{ results: [...] }` (YouTube-shaped, not AI at all — included for completeness since it shares the host) |
| Azure TTS proxy | `src/hooks/useAzureTTS.ts:13-14` | `POST /tts-azure` | `{ text, lang }` | audio/mpeg stream |

Genuinely UNKNOWN (out of this repo, cannot be audited from here even with the recovered source): the *current live* Cloudflare-side secret values, any dashboard-only configuration changes made after the recovery snapshot, and Google's own Gemini backend behavior (obviously out of scope for any repo audit).

---

## 8. Scope 7 — Types

**Confirmed from code: no production TypeScript type or interface anywhere in `agent/worker/` or `src/` is named after or modeled on Gemini's response shape** (`candidates[].content.parts[].text`), and none was found leaking beyond the immediate API-call boundary into domain/agent code. Specifically:
- Every `data.candidates?.[0]?.content?.parts?.[0]?.text` access is done through an **inline, unexported, locally-scoped anonymous type** at the call site itself (e.g. `agent/worker/index.ts:1301` `data: any`; `reasoning-endpoint.ts:604-609`; `personal-memory-extraction-endpoint.ts:599-602`; `context-derivation-endpoint.ts:434-437`; `document-memory-extraction-endpoint.ts:301-303`) — none of these types are exported, named, or imported elsewhere.
- The only place a type named `Gemini*` exists at all is **test-only**: `agent/worker/index.test.ts:40-41` (`GeminiContentPart`, `GeminiContentEntry`), used to type-check mock fetch bodies in tests, never imported by production code.
- `agent/worker/types.ts:127-130` `ChatOptions { maxOutputTokens?, temperature? }` mirrors Gemini's `generationConfig` field names directly, and is exported from `types.ts` — but its only consumer is `callGeminiChat`'s own parameter (`index.ts:1322`), and its only caller (`handleChat`, `:1216`) always passes the default `{}`. It does not carry a live value across any domain boundary today; it is a latent seam, not an active leak. Severity: cosmetic.
- Domain-level types — `AgentIntentProposal`, `AgentReasoningSafeContext`, etc. (`src/features/agent/reasoning/reasoningTypes.ts`, not separately re-read in full here beyond what's used at cited call sites) — use SmartFlow's own vocabulary (`type`, `confidence`, `target`, `reasons`, `language`) matching the reasoning schema (`reasoning-endpoint.ts:513-573`), never Gemini's `candidates`/`parts` vocabulary. This is a genuinely clean seam.

---

## 9. Scope 8 — Tests

**Test files that mock Gemini directly** (grepped for `generativelanguage.googleapis.com` inside `*.test.ts`/`*.test.tsx`, confirmed from code — file list, not exhaustive line-by-line since the point is which files, not every mock call):
- `agent/worker/chat-attachment-context.test.ts`
- `agent/worker/context-derivation-endpoint.test.ts`
- `agent/worker/document-memory-extraction-endpoint.test.ts`
- `agent/worker/personal-memory-extraction-endpoint.test.ts`
- `agent/worker/index.test.ts`
- `agent/worker/reasoning-endpoint.test.ts`

All six mock at the **HTTP-fetch level** — they intercept `fetch()` calls whose URL starts with `https://generativelanguage.googleapis.com/` and return Gemini-response-shaped JSON (`{ candidates: [...] }`) or embedding-shaped JSON (`{ embedding: { values: [...] } }`). **These tests would need to change if the provider changed**: they assert on the exact request body shape sent (e.g. `index.test.ts:233,328-329,363-365` assert on `generationConfig.responseSchema.properties...`), which is Gemini's `generationConfig` vocabulary, not an abstraction-level contract.

**Tests that mock at a higher level and would likely survive a provider change** (not exhaustively re-read, but structurally distinguishable): `src/features/agent/reasoning/reasoningOrchestrator.test.ts` and `intentValidator`-adjacent tests operate on already-parsed `rawProposal` objects (plain JS objects shaped like the SmartFlow intent schema) rather than mocking `fetch`, per the `dependencies.callLlmReasoning` injection point (`reasoningOrchestrator.ts:69-72,84-88`) — these test the validator/orchestrator logic independent of transport. `src/features/agent/reasoning/llmReasoningService.test.ts` was not read in full during this audit; flagged as **not independently verified** rather than asserted either way.

**`scripts/provider-contract-smoke.ts`** (read in full, `:1-200`): a manual-only (never CI-wired, per its own header comment `:2-10` and `:47`) script that makes five real, live calls against the real Gemini API — `checkExtractionContract`, `checkDerivationContract`, `checkTaskTitleContract`, `checkReasoningContract` (all `generateContent` with the real schema builders imported directly from the Worker route files, `:57-60`), and `checkEmbeddingContract` (`embedContent` on `gemini-embedding-001`, `:160-181`). **It is explicitly, deliberately Gemini-specific, not capability-generic** — it hard-codes the endpoint host (`:74,163`), the embedding model name and dimension (`:64-65`), and asserts on Gemini's own response vocabulary (`candidates[].finishReason`, `embedding.values`, `:100-102,172-176`). Its own purpose statement (`:6-10`) is to catch "a provider silently retiring a model" — i.e. it exists precisely because this codebase has already been burned once by an undocumented Gemini-side model retirement (`text-embedding-004`, per the same comment and per `document-memory-extraction-endpoint.ts:42`).

---

## 10. Scope 9 — Local Supabase / e2e target (informs D4)

`supabase/config.toml` is 4 lines total (confirmed by reading the whole file):
```
project_id = "taqxwnlwllbywaklwyno"

[functions.api-keys]
verify_jwt = true
```
There is **no `[api]` port block at all** — confirmed from code (the whole file, not truncated). This means local `supabase start` uses the Supabase CLI's own built-in defaults for the 54321-54327 range; the specific ports are not declared anywhere in this repo's config, only referenced as literals in tests/docs (below).

**Read-only port check performed on this machine, right now** (`netstat -ano` filtered to `54321|54322|54323|54324|54325|54326|54327`): **no output** — nothing is currently listening on any port in that range on this machine, at the time of this audit. This is a live, momentary observation, not a guarantee about any other time. It sits in tension with `PROJECT_STATUS.md:625-627`, which documents (as of an earlier task) that "a sibling project (`ai-automation-agent`) occupies the default Supabase ports (54321/54322/54323/54324/54327); not stopped, per policy" — that prior occupancy is not present right now, but the doc's own framing ("per policy," i.e. this repo's rule is never to stop another project's ports to make room for its own tests) is the actual structural constraint, independent of what happens to be running at any given moment.

**Every file referencing these ports** (confirmed via repo-wide grep for `54321|54322|...|54327`):
- `agent/worker/.dev.vars.example:3` — `SUPABASE_URL=http://127.0.0.1:54321` (structure only; this is the example/template file, contains no secret values, safe to read — confirmed no `.dev.vars` itself was opened during this audit).
- `agent/worker/reasoning-endpoint.test.ts` (multiple lines, e.g. `:13,63,96,107-112`) — test fixtures and loopback-validation test cases, all hard-coding `127.0.0.1:54321`.
- `agent/worker/github-integration.test.ts:12` — same pattern.
- `src/integrations/supabase/supabaseConfig.test.ts` (multiple lines, `:51,57,65,71,79,84,90,95,111,119-124`) — extensive test coverage of the loopback-URL validation logic itself, using `54321` as the canonical example port throughout.
- `src/features/projects/cliSupabaseEnvironmentGate.test.ts:7-18,33-34` — CLI target-resolution tests, same port.
- `src/features/projects/createProjectCliActual.test.ts:89,96,138,144` and `src/features/projects/localProjectRefreshCliActual.test.ts:81` — CLI integration tests.
- `scripts/local-qa-seed.test.mjs:48,145` — seed-script loopback validation tests.
- `docs/testing/local-supabase-qa.md:11,25,34,60` and `docs/testing/local-real-worker-reasoning-v1.md:36,60,86` — QA runbooks instructing a human to point `VITE_SUPABASE_URL`/`SUPABASE_URL` at `127.0.0.1:54321`.
- `docs/reviews/2026-08-personal-memory-layer-review.md:74,132` — a prior review documenting the exact same port-54322 conflict as a standing, accepted-as-out-of-scope environment constraint across two separate review passes.
- `PROJECT_STATUS.md:625-627` — the canonical status-doc record of the constraint (quoted above).

**Two options, reported neutrally, based only on what was found above:**

**(a) Non-default local Supabase ports.** Would require: adding an `[api]` (and likely `[db]`, `[studio]`, `[inbucket]`/`[storage]`) block to `supabase/config.toml` with alternate port numbers (currently absent — this would be a net-new addition, not an edit to existing values); updating every hard-coded `127.0.0.1:54321` literal in the test files and docs listed above to the new port (at minimum `agent/worker/.dev.vars.example`, `agent/worker/reasoning-endpoint.test.ts`, `agent/worker/github-integration.test.ts`, `src/integrations/supabase/supabaseConfig.test.ts`, `src/features/projects/cliSupabaseEnvironmentGate.test.ts`, `scripts/local-qa-seed.test.mjs`, both `docs/testing/*.md` runbooks); and re-verifying the loopback-URL validators (`isLoopbackUrl` in `reasoning-endpoint.ts:152-172` and whatever `supabaseConfig.ts`'s own equivalent is) don't hard-code `54321` as part of their *validation* logic rather than just their *tests* (not independently re-checked in this audit — flagged as an open item below).

**(b) A dedicated staging Supabase project.** Would require: a real, hosted (non-local) Supabase project distinct from the one `project_id = "taqxwnlwllbywaklwyno"` in `supabase/config.toml:1` refers to; a decision about how migrations get applied to it (the `supabase/migrations/` directory as it stands assumes a single target); credentials management for a second project (new anon/service keys, distinct from local `.dev.vars`); and — since every loopback-URL validator found in this audit (`isLoopbackUrl`, `resolveLocalReasoningConfig`'s `SMARTFLOW_WORKER_MODE=local-qa` gate) is written specifically to *require* a `127.0.0.1`/`localhost` URL and *reject* anything else (`reasoning-endpoint.ts:152-172,178-190`) — those gates would need to be relaxed or bypassed for QA to ever reach a hosted staging project through the same `local-qa` code path, which is itself a real behavior change to security-relevant code, not just configuration.

Neither option is recommended here; this is reporting only, per this audit's scope.

---

## 11. Seams

For each capability tag: where an interface could sit with zero behavior change, or why zero-behavior-change isn't realistic there.

**[TEXT_GEN]** — Closest to a clean seam of the four. Every [TEXT_GEN] call site (`callGemini`, `callGeminiChat`, `/documents/analyze`, `transcribePdf`) already reduces to the same shape: system instruction (optional) + turn history + `maxOutputTokens`/`temperature` → a plain string. `ChatMessage { role: 'user'|'assistant', content }` (`types.ts:116-125`) is already provider-neutral (§8). The one real per-call variable is `thinkingConfig` (§6), which has no generic equivalent — an adapter would need to either drop it silently for non-Gemini providers or expose it as a Gemini-specific escape hatch. Zero-behavior-change is realistic here modulo that one parameter and modulo re-tuning every `maxOutputTokens` constant (§6) against a different provider's token accounting.

**[STRUCTURED_GEN]** — The audit brief expected this to be the hardest, because of Gemini-specific "rescue"/normalization logic. **Having read the code, this expectation only partly holds.** The *volume* of rescue logic is real and large (§4: at least 9 distinct branches in `intentValidator.ts` alone, plus 3 more Worker-side finishReason/fence-stripping variants that are themselves inconsistent with each other). But most of the individual rescues are framed by their own comments as generic "never trust a model's raw value" defense-in-depth (confidence, datetime, amount/IBAN) rather than as Gemini-specific parsing quirks — they would very plausibly be written almost identically against any other structured-output-capable provider. The genuinely Gemini-specific pieces are narrower: `responseSchema`'s JSON-Schema-like shape (`buildReasoningResponseSchema`, `buildDerivationResponseSchema`, `buildExtractionResponseSchema`, `buildTaskTitleResponseSchema` — four independent schema-builder functions, no shared schema DSL), `thinkingConfig`, and the `finishReason` vocabulary (`STOP`/`MAX_TOKENS`/etc.). A seam here would need to abstract "give me one JSON object matching this schema" as the interface, while the *schema authoring* itself (currently four separate hand-written `{ type: 'OBJECT', properties: {...} }` builders, each provider-shaped) is the part most resistant to zero-behavior-change abstraction — a different provider's structured-output feature (if it has one at all) will not necessarily accept the same schema dialect. The three-way inconsistency in fence-stripping policy (§4) is itself evidence this area has not been treated as a single seam even *within* the current one-provider codebase.

**[EMBEDDING]** — Not a clean seam. The `outputDimensionality: 768` request parameter, the requirement to L2-normalize client-side specifically because Gemini does *not* normalize truncated-dimension output (§5), and the hard-coded `vector(768)` column in `document_chunks` are all specific, documented behaviors of `gemini-embedding-001` at non-default dimensionality. A different embedding model would very plausibly have a different native dimensionality, a different (or absent) normalization requirement, and would require either a new migration to change the column type or a re-embed-and-migrate of every existing row — this is the one capability where "zero behavior change" is not realistic even at the interface-design level, only at the call-site level (the two duplicated `l2Normalize` implementations could at least be unified first).

**[OTHER]** (external servers, §7) — Not a seam candidate in the usual sense: the caller-side contracts (`{ answer }`, `{ tags }`, `{ translated }`, etc., §7 table) are already simple, JSON, provider-agnostic shapes from the *frontend's* point of view — the frontend never sees Gemini's response format directly for any of these, only `api.barakzai.cloud`'s own already-abstracted JSON. The coupling this audit found for these routes lives entirely on the *server* side (`workers/ai-worker-recovered/index.js`, §2/§4), which is a separately-deployed Worker outside `agent/worker/`'s own release process — any future abstraction work on `agent/worker/` would not automatically reach this one.

---

## 12. Open questions for the ADR

Genuinely not decidable from code alone — product/infra/process decisions:

1. Whether the D4 local-Supabase-port question (§10) should be resolved as (a) non-default ports or (b) a dedicated staging project, or left as-is (accept the standing conflict as a documented, known limitation) — this is an infra/tooling tradeoff, not something the code reveals a "correct" answer to.
2. Whether `workers/ai-worker-recovered` (the separately-deployed `dailyflow-ai-worker` at `api.barakzai.cloud`) is in scope for any future Provider Abstraction work at all, given it is a distinct deployment with its own release process, or whether abstraction work should be scoped to `agent/worker/` only and treat the older Worker as a to-be-retired/out-of-scope legacy surface — this is a product/roadmap decision, not visible from the code.
3. Whether the three-way inconsistency in Gemini-output-fence-handling (`reasoning-endpoint.ts` strips nothing, `personal-memory-extraction-endpoint.ts` strips defensively, `context-derivation-endpoint.ts` strips nothing with no comment) should be resolved by picking one policy now (independent of any provider-abstraction work) or left as something a future abstraction layer absorbs — a scoping/sequencing decision, not a factual one.
4. Whether the `AI_PROVIDERS` multi-model-fallback + Workers-AI cross-provider fallback pattern already implemented in `workers/ai-worker-recovered/index.js` (§2) reflects an intentional product stance ("degrade to a weaker model / a different provider rather than fail the request") that `agent/worker/` should also adopt, or whether its absence from `agent/worker/` is itself a deliberate simplification for the current single-provider era — not decidable from code, since both files were clearly written by the same team at different times without an explicit written rationale for the difference found in either file.
5. Whether the two independently-hard-coded `768`-dimension constants (`document-memory-extraction-endpoint.ts:43`, `personal-memory-extraction-endpoint.ts:995`) plus the migration's `vector(768)` should be unified into one source of truth as a prerequisite to any provider work, or whether that's folded into the provider-abstraction change itself — a sequencing decision.
6. Whether the stale "text-embedding-004" migration comment (§5) needs a doc-only fix now (out of this audit's own no-source-edits scope) independent of any ADR-0018 work — a housekeeping decision outside this audit's mandate to make, only to flag.

---

## Search method note (for reviewer confidence, not a finding)

This audit used `Grep`/`Read`/`Glob` directly against the working tree (not `git grep`, not cached search results) for: `gemini-`, `GEMINI_MODEL`, `GEMINI_API_KEY`, `generativelanguage.googleapis.com`, `responseSchema`, `responseMimeType`, `thinkingConfig`, `gemini-embedding`, `outputDimensionality`, `vector(`, `fence`, `MAX_TOKENS`, `finishReason`, `stripMarkdown`, `barakzai.cloud`, `GeminiResponse`, `candidates\[`, and the `5432*` port literals — each scoped to `agent/worker/`, `src/`, `workers/ai-worker-recovered/`, `supabase/migrations/`, and `scripts/` as appropriate to the scope item. Full files were read (not just grep excerpts) for every file this document cites specific line ranges from, to get exact, current line numbers rather than estimating from search snippets.
