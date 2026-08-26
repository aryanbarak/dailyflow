# ENG-06c — Re-diagnosis, CORRECTED by live tail evidence

Status: investigation, read-only. No application code changed.
Date: 2026-08-26. Worker: `dailyflow-agent-worker`, live version `05e5b933`.

> **v2 (2026-08-26T19:26Z) — this note's original verdict was WRONG and has been
> replaced.** A live `wrangler tail` capture refuted it. The original claimed the
> timeout theory was disproved and PR #177 could not have fixed anything. The
> captured evidence shows the opposite: **PR #177 was correct and necessary**, and
> there was never a provider outage. The superseded reasoning is kept in §9 for
> the record. §§1-2 (the code-path analysis) remain valid and are what made the
> captured evidence interpretable.

## Captured evidence (the thing that was missing)

Two consecutive real turns, same session, both lanes, verbatim from the tail:

**Turn 1 — 2026-08-26T19:26:29Z**

```
POST /chat  -> 200   wallTime 14493 ms
  [Chat] reasoning mode finishReason: MAX_TOKENS text length: 243
  [Chat] userId=ccee34b2-… sessionId=f5aa835b-… mode=reasoning reply=243 chars

POST /chat  -> 200   wallTime 5001 ms
  [Chat] sending 5 turns to Gemini
  [Chat] finishReason: stop text length: 272
  [Chat] userId=ccee34b2-… sessionId=f5aa835b-… language=en history=4 turns reply=272 chars
```

**Turn 2 — 2026-08-26T19:27:11Z**

```
POST /chat  -> 200   wallTime 5113 ms
  [Chat] reasoning mode finishReason: STOP text length: 296
  [Chat] userId=ccee34b2-… sessionId=f5aa835b-… mode=reasoning reply=296 chars

POST /chat  -> 200   wallTime 7485 ms
  [Chat] sending 7 turns to Gemini
  [Chat] finishReason: stop text length: 309
  [Chat] userId=ccee34b2-… sessionId=f5aa835b-… language=en history=6 turns reply=309 chars
```

Across the whole capture: **0 responses with status 503, 0 `PROVIDER_UNAVAILABLE`,
0 `[Chat] Reasoning mode provider error:` lines, no HTTP 429.** Every Gemini call
returned 200.

## Corrected verdict

1. **There is no provider outage.** Gemini answered 200 on every call. The
   429/quota hypothesis, the ADR-0018 Decision-5 "structured fails closed while
   text has a fallback" story, and the inference from the botched API-key secrets
   are all **refuted as the cause of this bug**. (The key exposure was real and
   worth cleaning up, but it was unrelated.)

2. **The "1–2 seconds" premise was mistaken.** Measured Worker wall times were
   **5.0s, 14.5s, 5.1s, 7.5s**. Nothing observed was close to 1–2s. Every
   conclusion in the original v1 verdict rested on that premise.

3. **PR #177 was right, and was necessary.** Turn 1's reasoning call took
   **14 493 ms**. The old ceiling was 10 000 ms, so that call **would have been
   aborted client-side**, producing exactly the `providerUnavailable` →
   "temporarily unavailable" symptom ENG-06 originally described. Under the new
   20 000 ms ceiling it completed. **ENG-06's original diagnosis was correct.**

4. **A second, independent bug is now the live blocker.** Turn 1's reasoning
   response came back with `finishReason: MAX_TOKENS` and only **243 chars** of
   text — a truncated, unparseable proposal. This is precisely the latent defect
   filed in v1 §7 item 1, now confirmed in production.

## Root cause of the remaining failure: MAX_TOKENS truncation

`callGeminiReasoning` (`index.ts:1453-1464`) requests:

```ts
schema: buildReasoningResponseSchema(),
maxOutputTokens: 2048,
temperature: 0,
// note: no providerOptions -> no thinkingConfig
```

and then:

```ts
console.log('[Chat] reasoning mode finishReason:', result.rawFinishReason ?? result.finishReason, 'text length:', result.rawText.length)
if (!result.rawText) throw new Error(...)   // <-- only checks EMPTY, never MAX_TOKENS
return result.rawText.trim()
```

The deployed path **logs `finishReason` but never acts on it**, so a truncated
response is returned to the client as if it were whole. The local endpoint does
guard this (`reasoning-endpoint.ts:620`, `if (result.finishReason !== 'stop') throw`)
— the deployed path is the one missing the check.

Downstream, 243 chars of truncated JSON has no closing brace, so
`extractJson`'s `/\{[\s\S]*\}/` finds no match → `parseLlmIntentJson` returns
`{ok:false}` → `fallbackRawProposal` → `ask_clarification`. **No approval card** —
the same user-visible dead end as before, now reached by a different route.

### Why it truncates at all (243 chars out of a 2048-token budget)

`gemini-3.6-flash` (adopted 2026-08-23, `89ab218` MIG-01b) is a thinking model, and
thinking tokens are charged against `maxOutputTokens`. The reasoning call sets no
`thinkingConfig` — `GeminiStructuredGenerationProvider` supports the option
(`options.thinkingConfig`, line ~83) but `callGeminiReasoning` passes no
`providerOptions` at all. So the model spends the 2048-token budget thinking and
truncates the visible JSON. This also explains the **14.5s** outlier: long thinking
is slow. It is intermittent — turn 2 finished `STOP` in 5.1s — which fits a
budget that is *sometimes* exhausted, and explains why this reproduces
inconsistently.

**This is a hypothesis about the mechanism, not a captured fact** — the tail logs
`finishReason` and length but not the response body, so the thinking-token
explanation is inferred from the model family and the 243-chars-with-MAX_TOKENS
shape. Confirming it requires either logging `usageMetadata`
(`GeminiStructuredGenerationProvider` already extracts `promptTokens`/`responseTokens`
but the reasoning path discards them) or a direct probe.

## Recommended fixes (not implemented — reporting only)

1. **Raise `maxOutputTokens`** for the reasoning call well above 2048, and/or set
   `thinkingConfig` to bound the thinking budget so the JSON always fits. This is
   the actual fix for the current symptom.
2. **Check `finishReason` in the deployed path**, mirroring
   `reasoning-endpoint.ts:620`. A truncated response should be an honest, distinct
   failure — never silently forwarded as a complete proposal.
3. **Log `usageMetadata`** on the reasoning path so token exhaustion is visible in
   the tail instead of inferred.
4. Keep PR #177's 20s ceiling. Turn 1 proves it is load-bearing.

## Item 4 — still partially outstanding

The tail gives `finishReason` and text length but **not the response body**, so the
verbatim Gemini content still has not been captured. Getting it needs a temporary
log of `result.rawText` on the reasoning path (bounded/redacted), or capture from
the browser devtools Network tab on the client side — the client receives the full
`{reply}` body.

## Still-valid findings from v1

- **§1-2 code-path analysis** — the mapping from failure mode to user-visible
  outcome is unchanged and is what allowed this capture to be read correctly:
  429/5xx → "temporarily unavailable"; 400/403/404 → clarification; MAX_TOKENS /
  malformed / validator rejection → clarification. The observed
  MAX_TOKENS-with-200 lands in the clarification bucket, exactly as predicted.
- **Item 3 disproved** — a validator rejection still cannot produce the
  "unavailable" message; the marker has one setter and short-circuits before
  validation.
- **§5** — the chat-lane and overlay-lane "unavailable" strings are byte-identical
  in en/de/fa. Worth differentiating regardless.
- **§7 item 2 — partially wrong, corrected in ENG-06d.**
  `requestLooksLikeEngineeringTask` (`intentValidator.ts:538-543`) does match
  English and Persian but not German — that part holds. But v1's claim that this
  means "a correct `propose_engineering_task` from the model is overwritten by
  evidence-based read normalization" is **wrong**: `propose_engineering_task` is
  in `CONFIRMED_WRITE_INTENT_TYPES`, and `normalizeReadIntentFromEvidence`
  returns any member of that set unchanged (`intentValidator.ts:730-732`), in any
  language. The real, narrower impact is on the **promotion** path — when the
  model *hedges* with `ask_clarification`, the phrase gate is what rescues it
  into `propose_engineering_task`, and German requests never got that rescue.
  Caught by writing the test: the v1-implied negative case passed against
  unfixed code, which is what exposed the bad claim.
- **The secret cleanup** — two malformed `GEMINI_API_KEYAQ.Ab8RN6…` secrets held
  live key material in their *names*; both deleted 2026-08-26 (13 → 11 secrets,
  `GEMINI_API_KEY` intact). Rotation in Google AI Studio is still the real
  remediation. Unrelated to this bug, but correct to have done.

## §9 — Superseded v1 verdict (kept for the record)

v1 concluded: *"The timeout theory is wrong, and PR #177 cannot have fixed this
bug… the observed failure is a fast, honest, upstream provider failure on the
Gemini structured-generation call."* It reasoned from the PO-reported 1–2s
latency to eliminate the timeout, then eliminated transport failures (both lanes
share a URL) to leave only a 503/`PROVIDER_UNAVAILABLE`, and proposed
Gemini 429 + ADR-0018 Decision 5 as the mechanism.

**Why it was wrong:** the 1–2s premise was unverified and false. The chain of
elimination was sound *given* that premise, which is exactly why it produced a
confident wrong answer instead of an uncertain one. The lesson is the same one
ENG-06c was raised to apply: measure before re-diagnosing. v1 replaced one
unmeasured theory with another and, unlike ENG-06, was also wrong.
