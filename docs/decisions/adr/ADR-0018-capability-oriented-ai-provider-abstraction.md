# ADR-0018: Capability-Oriented AI Provider Abstraction

- **Status:** Accepted
- **Date:** 2026-08-22
- **Accepted:** 2026-08-22 — PO approved 2026-08-22: all five open questions answered yes.
- **Decision Makers:** Product Owner (decision), Coordinator/Architect (Claude — drafting), Claude Code (implementation)
- **Supersedes:** None
- **Superseded by:** None
- **Related:** ADR-0006 (replaceable mechanisms), ADR-0008 (tiered governance), ADR-0011 §5 (deferred semantic retrieval), ADR-0017 (two-view registry), `docs/architecture/notes/provider-coupling-audit-v1.md` (PA-01), `pdr-evolution-plan-v1.1.md` Stage 0 Track C

---

## Context

### Why now

1. **ADR-0006 already decided this; it was never executed.** ADR-0006 lists Gemini, Cloudflare, and Supabase as *replaceable mechanisms* whose replacement must not change SmartFlow's semantics. PA-01 (2026-08-22) confirmed from code that every AI call in `agent/worker/` is a direct `fetch()` to `generativelanguage.googleapis.com` with Gemini-shaped request envelopes — 17 call sites, zero abstraction. ADR-0006's commitment is currently not true of the code.

2. **Incident 2026-08-22 — provider credit depletion.** Gemini returned `429 RESOURCE_EXHAUSTED` for every call. Every AI-dependent surface (chat, reasoning, suggestions, briefing, memory extraction, embeddings) failed simultaneously. Until INC-01 (`1da24e0`) the failure was additionally *misreported* as a fabricated clarification question. No persisted record of the outage exists. One billing event silenced the entire product, and the product could not say so honestly.

3. **Evolution Plan Stage 0, Track C** names provider abstraction as the first architectural step toward AI independence, *before* any Local AI Lab result, *before* any router, and explicitly *without* a "Local-First" promise the current architecture cannot keep.

### What PA-01 established (confirmed from code)

| Capability | Call sites | Seam realism |
|---|---|---|
| **Text generation** (prose out) | 4 — briefing, `/chat` mode=chat, `/documents/analyze`, PDF transcription | Clean. All reduce to `system + turns + maxTokens/temperature → string`. Only `thinkingConfig` is provider-specific. |
| **Structured generation** (one JSON object matching a schema) | 8 — `/agent/reason`, `/chat` mode=reasoning, 4× suggestions, derivation, memory extraction, task title | Realistic at the call boundary. **Schema authoring is the hard part**: four independent hand-written builders in Gemini's `{type:'OBJECT', properties:{…}}` dialect. The `intentValidator` rescue logic is mostly generic and must stay. |
| **Embedding** | 2 — document chunks (persisted, `vector(768)`), memory overlap dedup (transient) | Not a zero-behavior-change seam. `gemini-embedding-001` at `outputDimensionality: 768` requires client-side L2-normalization; 768 is a persisted column width. A different model is a migration, not a config swap. |
| External (`api.barakzai.cloud`) | Learn tutor (unused), OCR (needed), photos, translate, TTS | Separately deployed legacy Worker (`workers/ai-worker-recovered/`), JS, no tests. |

PA-02 (`d1b421b`) already unified the three Worker-side JSON parsers into `modelJsonParsing.ts` and the two embedding constant sets into `embeddingConfig.ts`. This ADR builds on that; it does not redo it.

### What PA-01 could not decide (PO decisions recorded here)

- **D8 — Scope.** `api.barakzai.cloud` is legacy. PO confirmed: Learn tutor has no remaining users; OCR is the only route still needed and will be migrated into `agent/worker/` behind the seam defined here as a later slice. This ADR covers `agent/worker/` only.
- **D9 — Fallback policy.** The legacy Worker degrades Gemini 2.5 → 2.0 → Workers AI llama. `agent/worker/` has no fallback. Neither stance was ever written down. This ADR makes fallback a **per-capability property**, not a global switch (see Decision 5).
- **D10 — "Zero-cross-import convention."** Investigated in PA-02: not a rule, a misapplied comment. Sibling imports within `agent/worker/` are routine. No exception needed.

---

## Decision

### 1. Three capability contracts, not one `AIProvider`

`agent/worker/` gains a `providers/` module defining exactly three interfaces:

```ts
interface TextGenerationProvider {
  readonly id: string;                       // e.g. 'gemini'
  generateText(req: TextGenerationRequest): Promise<TextGenerationResult>;
}

interface StructuredGenerationProvider {
  readonly id: string;
  generateStructured<T>(req: StructuredGenerationRequest): Promise<StructuredGenerationResult>;
  // Result carries the raw text; parsing/validation stays in SmartFlow code
  // (modelJsonParsing.ts + the existing validators). The provider never
  // returns a "typed" object it claims is valid.
}

interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;               // 768 today — a contract, not a default
  readonly normalizesOutput: boolean;        // false for gemini-embedding-001 @768
  embed(texts: string[]): Promise<EmbeddingResult>;
}
```

**Why three and not one:** the three have different failure semantics, different fallback rules (Decision 5), different test strategies, and — for embeddings — different persistence consequences. One `AIProvider` with `supportsX` flags would hide exactly the differences that matter. **Why not more than three:** PA-01 found no fourth shape in `agent/worker/`. Adding capabilities (e.g. vision, audio) requires a new ADR, not an interface extension.

### 2. Request/result shapes are SmartFlow-owned and provider-neutral

- `ChatMessage { role: 'user'|'assistant', content }` (`types.ts:116-125`) is already neutral and is reused.
- System instruction is a field on the request, not a turn. The Gemini adapter maps it to `system_instruction`; an OpenAI-style adapter would map it to a `system` turn.
- Provider-specific knobs (`thinkingConfig`, safety settings, AI Gateway routing) live in an opaque `providerOptions?: Record<string, unknown>` on the request that only the matching adapter reads. Non-matching adapters ignore it. This is the one deliberate escape hatch; it must not grow into a second API.
- `maxOutputTokens` remains per-call. PA-01 noted these constants are tuned to Gemini's token accounting; re-tuning is a consequence of any future provider swap, not of this ADR.

### 3. Structured output: neutral schema subset → adapter translation

The four schema builders (`buildReasoningResponseSchema`, `buildDerivationResponseSchema`, `buildExtractionResponseSchema`, `buildTaskTitleResponseSchema`) are rewritten to emit a **minimal JSON-Schema subset** owned by SmartFlow:

`object`, `string`, `number`, `boolean`, `array` (of the above), `enum` (string), `required`, `maxItems`, `minItems` (Amendments, 2026-08-23), `description`. Nothing else. If a builder needs more, that is a new decision.

`GeminiStructuredGenerationProvider` translates this subset into Gemini's `responseSchema` dialect at call time. **Proof of zero behavior change:** `shared/reasoning-response-schema.snapshot.json` is extended to cover all four builders' *Gemini-translated* output; the snapshot must be byte-identical before and after the refactor. This is the same discipline as `provider-contract-smoke` — a provider-visible artifact, diffed.

Rescue/normalization logic in `intentValidator.ts`, `normalizeProposal`, and the `finishReason !== 'STOP'` checks is **not moved and not weakened**. It guards against model output, which exists regardless of provider. The provider boundary sits *below* it.

### 4. Embeddings: interface now, implementation change later

`EmbeddingProvider` is defined and `GeminiEmbeddingProvider` wraps the existing `embeddingConfig.ts` logic (including mandatory L2-normalization, with `normalizesOutput: false`). **No second embedding provider is implemented under this ADR.** Changing the embedding model is Evolution Plan Stage 2 work, gated by the retrieval benchmark, and will require its own ADR covering index migration (one index vs two, re-embed strategy, `vector(N)` DDL).

A runtime assertion is added: at Worker startup (or first use), `provider.dimensions` must equal `EMBEDDING_DIMENSIONS`; mismatch fails closed with a logged configuration error. PA-02's static test covers the migration; this covers the running binary.

### 5. Fallback is a per-capability policy, decided here, implemented later

| Capability | On provider failure (network / 429 / 5xx) | Rationale |
|---|---|---|
| Text generation | **May** degrade to a weaker/alternate provider in a future slice. Not implemented in this ADR. | A slightly worse briefing beats no briefing. Output is prose the user reads and judges. |
| Structured generation | **Fail closed.** Return `PROVIDER_UNAVAILABLE` (INC-01). Never substitute a weaker model. | Output feeds approval cards and write proposals. A weaker model's proposal arrives with the same apparent authority. Degradation here is a safety regression, not a UX regression. |
| Embedding | **Fail closed.** No fallback is meaningful — a different model is a different vector space. | Mixing spaces in one index silently corrupts retrieval. |

The legacy Worker's "always degrade" behavior is therefore **not** adopted wholesale; it is adopted for text generation only, and only when a second `TextGenerationProvider` exists.

### 6. Provider failures are distinct, typed, and persisted

`ProviderUnavailableError` (INC-01, `provider-errors.ts`) becomes the single classification for network/429/5xx across all three capabilities. This ADR adds the missing piece the incident exposed: **every `ProviderUnavailableError` is persisted** — minimum `{capability, provider_id, http_status, occurred_at, request_id}` — in a new `provider_failure_events` table (service-role only, RLS default-deny like `finance_import_batches`, retention: 30 days via scheduled cleanup in the existing `0 6 * * *` cron). No prompt content, no response bodies, no secrets.

Rationale: today's outage left no trace. A representative that cannot report its own outages cannot be trusted to report anything else.

### 7. Scope boundary: `agent/worker/` only; legacy Worker retires route-by-route

`workers/ai-worker-recovered/` is declared **legacy**. It receives no abstraction work. The retirement order, each as its own slice with PO approval:

1. **OCR** (`/ocr`) — the only route PO still uses. Re-implemented in `agent/worker/` as a `TextGenerationProvider` consumer (PDF → text) behind the seam.
2. Photos / translate / TTS / music — PO decides per route: migrate or drop.
3. When no route remains in use: delete the directory and the Cloudflare Worker; update `PROVENANCE.md` to record retirement.

`BankImportTool.tsx` (`/import-bank`, PDF+Gemini) is already scheduled for retirement under ADR-0017; it is not re-scoped here.

### 8. Governance amendments (ADR-0008)

Recorded here because they were decided in the same working session and affect how this ADR is implemented:

- **Branch commits.** Claude Code may commit and push to branches other than `main`. `main` changes only via pull request, `ci` green, and PO merge. (Established CI-01, PR #157; ruleset `main` active, bypass list empty.)
- **No amend/force-push after a PR is open.** New commits only, so review history stays linear.
- **Production deploy path.** Frontend: only `deploy-cloudflare-pages.yml` (test-gated). Cloudflare Git integration is preview-only; automatic production deployments disabled (2026-08-22). Worker: manual `wrangler deploy` after `provider-contract-smoke` 5/5 — unchanged.
- **"Environment-only failure" is not a valid label without a clean-environment run.** CI is that environment. (Three such mislabels surfaced in CI-01: port-dependent tests, `.env`-dependent tests, order-dependent test.)

---

## Consequences

### Positive
- ADR-0006's "replaceable mechanism" claim becomes true for AI providers, capability by capability.
- Fallback policy is explicit and safety-aware instead of accidental.
- Provider outages are visible after the fact.
- Tests move from mocking `generativelanguage.googleapis.com` URLs to mocking a three-method interface; the 6 fetch-level test files shrink.
- The Local AI Lab (Evolution Plan Stage 2) has a concrete target: implement `EmbeddingProvider` / `TextGenerationProvider` for Ollama *if* the benchmark passes.

### Negative / costs
- Four schema builders are rewritten; regression risk is real and is bounded only by the snapshot discipline in Decision 3.
- `providerOptions` is an escape hatch. It will be tempting to put provider-specific behavior there instead of in the interface. Reviewers must push back.
- One new table and one cron job for failure events — small, but it is infrastructure.
- No user-visible feature ships from this ADR. This is foundation.

### Explicitly not decided here
- Which second provider (if any) is added, or when.
- Any router / model selection policy (Evolution Plan Stage 4, future ADR).
- Any change to the embedding model or `vector(768)`.
- Offline / local runtime (Evolution Plan Stage 3, future ADR).
- Whether `ProviderFailureTaxonomy` duplication (document-memory ↔ context-derivation) is unified — it should be, inside slice S1, as it is part of the provider error contract.

---

## Implementation Plan (slices; each a PR; each test-gated)

| Slice | Content | Behavior change | Gate |
|---|---|---|---|
| **S0** | `providers/` module: three interfaces, request/result types, `ProviderUnavailableError` reuse, `provider_failure_events` migration (authored, not applied) | none | `npm test`; migration structure test |
| **S1** | `GeminiTextGenerationProvider`; 4 text call sites migrated; unify `ProviderFailureTaxonomy`; persist failure events | none (proven by existing endpoint tests) | `npm test`; smoke 5/5 before deploy |
| **S2** | Neutral schema subset + `GeminiStructuredGenerationProvider`; 8 structured call sites migrated; snapshot extended to 4 builders | none (proven by byte-identical snapshot) | snapshot diff empty; `npm test`; smoke 5/5 |
| **S3** | `GeminiEmbeddingProvider` wrapping `embeddingConfig.ts`; 2 embedding call sites; startup dimension assertion | none | `npm test`; smoke embedding check |
| **S4** | Test migration: 6 fetch-level test files → interface mocks; `provider-contract-smoke` re-pointed at the adapters (stays Gemini-specific by design) | none | full suite green in CI |
| **S5** | OCR route migrated from legacy Worker (first retirement step) | new route in `agent/worker/`; old route kept until PO confirms | PO manual test |

S0–S3 are Tier-2 (code + authored migration). Applying the `provider_failure_events` migration and each Worker deploy are Tier-1 ("برو").

---

## Open questions for PO at review

1. Accept per-capability fallback policy as written (Decision 5)?
2. Accept `provider_failure_events` with 30-day retention (Decision 6), or prefer log-only for now?
3. Accept OCR as the first legacy-retirement slice (Decision 7), or defer all legacy work?
4. Accept the four governance amendments (Decision 8) as ADR-0008 addenda?
5. Slice ordering: S1 (text) before S2 (structured) is lowest-risk-first. Any reason to reorder?

---

## Supersession and Change Control

Changes to the set of capabilities, to the fallback policy table, or to the scope boundary require a superseding or amending ADR with PO approval. Adding a second provider implementation for an existing capability does **not** require a new ADR if it conforms to the interface and passes the capability's contract tests; it does require a PO-approved slice.

## Amendments (2026-08-23, S2)

**`minItems` added to the neutral schema subset (Decision 3).** Discovered during S2 Phase A (baseline snapshot of all four builders' current `responseSchema` output, generated from the real, unmodified builders): 3 of the 4 real builders use `minItems` today, not the 1-of-4 the original Decision 3 text anticipated —

- `buildReasoningResponseSchema`: `reasons` (`minItems: 1, maxItems: 3`), `candidates` (`minItems: 2, maxItems: 6`), `candidates[].reasons` (`minItems: 1, maxItems: 3`)
- `buildDerivationResponseSchema`: `sourceEvidenceIds` (`minItems: 1, maxItems: 20`)
- `buildExtractionResponseSchema`: `provenanceSourceRefIds` (`minItems: 1, maxItems: 20`)
- `buildTaskTitleResponseSchema`: none (already subset-compliant)

Decision 3's own zero-behavior-change proof is a byte-identical snapshot round-trip through the neutral schema and back through Gemini translation. A subset without `minItems` cannot reconstruct it — the round-tripped schema would silently lose a real, currently-enforced provider-side constraint (bounded-but-nonempty arrays), which is a behavior change, not a refactor. Widening the subset by one primitive (rather than dropping the constraint, or blocking S2 entirely for a full ADR review) was decided inline during S2 implementation and approved by the coordinator before any builder was touched — see the S2 report for the full options considered. `neutralSchema.ts`/`geminiSchemaTranslation.ts` implement it as a direct passthrough, identical in shape to `maxItems`.

**`integer` modifier added to the neutral `number` schema (Decision 3).** Same discovery pass as `minItems` above: Gemini's dialect distinguishes `type: "INTEGER"` from `type: "NUMBER"` as two different wire values, and two real fields (`buildReasoningResponseSchema`'s `target.issueNumber`, `buildDerivationResponseSchema`'s `content.order`) are `INTEGER` today. The ADR's subset names only "number" as a primitive, with no separate "integer" type, so `NeutralNumberSchema` gains an `integer?: boolean` modifier (absent/false → Gemini `NUMBER`, true → Gemini `INTEGER`) rather than introducing a second top-level type name. Same rationale and approval as the `minItems` amendment above.

**`<T>` dropped from `StructuredGenerationProvider.generateStructured` (Decision 1).** The S0 interface text carried a `<T>` type parameter as a call-site type hint, but `StructuredGenerationResult` never actually carries a T-typed value — it is always just `rawText`, per Decision 1's own "the provider never returns a 'typed' object it claims is valid" comment. `<T>` had nothing to bind to. Dropped in S2 once `GeminiStructuredGenerationProvider` and its real call sites existed to confirm this.

**Optional `usage` field added to `StructuredGenerationResult` (Decision 1).** Discovered migrating real call sites in S2 Phase C: `context-derivation-endpoint.ts` and `personal-memory-extraction-endpoint.ts` both persist Gemini's `usageMetadata` (`promptTokenCount`/`candidatesTokenCount`) into real `inferred_context_derivation_runs`/`personal_memory_extraction_runs` columns for cost/usage tracking — a real, currently-live behavior the original `{ rawText, finishReason }` contract had no field for. Dropping it would have been a genuine, undocumented regression to usage accounting, not a refactor. `usage?: { promptTokens?: number; responseTokens?: number }` is additive and provider-populated, the same shape of amendment as S1's `ProviderUnavailableError.status`/`.body`. Approved by the coordinator before either call site was migrated.

**Optional `rawFinishReason` field added to `StructuredGenerationResult` (Decision 1/3).** Same discovery pass as `usage` above, same two call sites: both persist the PROVIDER'S OWN finishReason string (`"MAX_TOKENS"`, `"SAFETY"`) verbatim into a `failure_reason` column and diagnostic logs — existing tests (`context-derivation-endpoint.test.ts`, `personal-memory-extraction-endpoint.test.ts`) assert on the literal string, not just the taxonomy code. Decision 3's neutral `'stop'|'length'|'other'` enum deliberately collapses this detail away for the field everything else dispatches on; `rawFinishReason?: string` is a second, optional, provider-populated field carrying the untranslated value for callers that also want it. Same additive shape and same approval as `usage`.

*Honesty note (ties to INC-01):* the neutral enum exists so call sites don't have to special-case Gemini's exact vocabulary — but a lossy abstraction that silently drops the provider's own diagnostic wording is the same failure shape INC-01 fixed for outright provider errors: real signal from the provider gets laundered into a vaguer SmartFlow-owned category before it reaches a log or a DB column, and something a human needed to see (`"SAFETY"` vs `"MAX_TOKENS"` vs `"RECITATION"`) is gone. `rawFinishReason` keeps that raw signal available at the one layer (the adapter boundary) that actually has it, without forcing every caller to widen the neutral enum just to stay honest about what the provider said.

**S3 implemented as specified — no `EmbeddingProvider` interface amendment needed.** `id`/`model`/`dimensions`/`normalizesOutput`/`embed` are used exactly as S0 defined them; `GeminiEmbeddingProvider` wraps `embeddingConfig.ts` unchanged and the Decision 4 dimension assertion (`assertEmbeddingDimensions`) is implemented as this section already anticipated ("at Worker startup (or first use)"). One implementation-level (not interface-level) judgment call, disclosed in the S3 report rather than amended here since it changes no type: `EmbeddingDimensionMismatchError` is deliberately NOT swallowed by `personal-memory-extraction-endpoint.ts`'s own best-effort overlap-dedup fallback (which returns `null` for every other embedding failure) — a config bug degrading silently into "no suggestion found" would hide exactly the kind of problem Decision 4 exists to surface.

## Amendments (2026-08-24, S1b)

**Second `TextGenerationProvider` (`workers-ai`) added — no new ADR, per this ADR's own Supersession and Change Control clause.** `providers/workers-ai/WorkersAITextGenerationProvider.ts` implements `TextGenerationProvider` exactly as S0/S1 defined it, conforms to the interface unchanged (no amendment to `TextGenerationRequest`/`TextGenerationResult` was needed), and passes the capability's contract tests (`WorkersAITextGenerationProvider.test.ts`, 18 tests) — the Supersession clause's own conditions for "does not require a superseding/amending ADR, does require a PO-approved slice." Selected via `createProviders(env).text` reading a new `AI_TEXT_PROVIDER` env var (`'gemini'` default | `'workers-ai'`), per-worker-deployment config, not per-request — Decision 5's fallback-policy table is unaffected: this is provider *selection*, not a fallback chain (that remains the separate, later S1c slice this ADR's own Implementation Plan anticipated as "may degrade to a weaker/alternate provider in a future slice"). Structured generation and embeddings are unaffected — both stay Gemini-only, fail-closed, exactly as Decision 5 already requires.

Model chosen: `@cf/google/gemma-4-26b-a4b-it` (see `providers/workers-ai/WorkersAITextGenerationProvider.ts`'s own header comment and PROJECT_STATUS.md's S1b entry for the full diagnosis/rationale — recommendation only, PO has not yet verified real Dari/Farsi output quality against a live deploy).

**`AttachmentsUnsupportedError` — a new, typed error, not an interface amendment.** `TextGenerationProvider.generateText` has no attachment-capability field in its contract (Decision 2's `providerOptions` escape hatch already covers provider-specific request shape); a text-only provider signals its own limitation by throwing this typed error (`.code === 'ATTACHMENTS_UNSUPPORTED'`) rather than the interface growing a capability-negotiation field. The two call sites that always/mostly carry an attachment (`transcribePdf`, `/documents/analyze`) additionally pin themselves to Gemini via a new `createProviders` option (`{ pinTextProvider: 'gemini' }`) so they never depend on this rejection path in the first place; `/chat`'s optional image attachment was deliberately left un-pinned (disclosed in PROJECT_STATUS.md, not silently decided) and does rely on it.

**Failure classification: every Workers AI binding error maps to `ProviderUnavailableError`, with no `ProviderRequestError` analogue.** `provider-errors.ts`'s existing 429/5xx-vs-other split (Decision 6) is HTTP-status-shaped; `env.AI.run()` is an RPC-style binding call, not a `fetch()` — a failure throws with no HTTP response and so no status to classify by. Rather than inventing a distinction with nothing to base it on, every binding error is treated as provider-unavailable, uniformly, disclosed here as a deliberate scope simplification specific to this provider's transport, not a gap in Decision 6 itself. `provider_failure_events.http_status` was already nullable (`20260823000000_provider_failure_events.sql`, no `not null`) — no migration amendment was needed to persist this.
