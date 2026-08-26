# ENG-06f item 2 — Why do plain chat replies take 11–14s?

Status: investigation. **Deferred, not fixed** — the finding does not point to a
clear, scoped bug in this PR's scope. Date: 2026-08-26/27.

## Question

ENG-06e measured three consecutive plain-chat turns at **14 071 / 13 649 /
11 458 ms** for replies of only 173–188 characters. The leading theory was the
ADR-0018 S1c fallback chain: `AI_TEXT_PROVIDER=workers-ai` with
`AI_TEXT_FALLBACK=on` means Workers AI is the primary and Gemini the secondary,
so a failing primary would make *every* chat turn pay two sequential provider
calls.

## Finding 1 — the fallback theory is disproved for the measured window

`FallbackTextGenerationProvider.generateText` (`fallbackTextProvider.ts`) calls
`recordFallbackSuccess` on every successful fallback. That call reaches
`insertProviderEvent` (`failureEvents.ts`), whose failure path is a
`console.warn`:

```ts
console.warn(`[ProviderFailureEvents] failed to record ${logLabel} (non-fatal, ...):`, ...)
```

The ENG-06e capture contains, across all 15 records and all 3 chat turns:

- log levels: `{'log': 15}` — **zero `warn`, zero `error`**
- zero occurrences of `fallback`, `event_kind`, or `does not exist`
- zero exceptions

A fallback would have produced exactly one warn per chat turn (see Finding 2 for
why the insert is guaranteed to fail, and therefore guaranteed to warn). None
appeared. **The 11–14s is one provider call being slow, not two calls in
sequence.**

## Finding 2 — the table cannot answer this question anyway

The task asked to check `provider_failure_events` for `recordFallbackSuccess`
rows. Those rows **cannot exist**, independent of whether fallback happens:

| migration | status |
|---|---|
| `20260823000000_provider_failure_events.sql` | **applied** (PROJECT_STATUS.md) |
| `20260824000000_provider_failure_events_event_kind.sql` | **authored, NOT applied** |

`recordFallbackSuccess` sets `event_kind: 'fallback_success'`. Without that
column, every such insert returns Postgres `42703` (*column "event_kind" does not
exist*), which `insertProviderEvent` swallows into the `console.warn` above.

The S1c entry in PROJECT_STATUS.md states the requirement explicitly:

> **DEPLOY ORDER: the `event_kind` migration must be applied (PO "برو") BEFORE
> this Worker code is deployed.**

The S1c Worker code shipped 2026-08-24. The migration is still unapplied. **The
deploy-order requirement was inverted**, so ADR-0018 S1c's fallback-success
telemetry has been silently non-functional in production since it shipped — by
design it fails safe, so nothing broke and nothing complained.

Two consequences worth separating:

1. **For this investigation:** querying that table for `fallback_success` proves
   nothing either way. Finding 1's log-level evidence is what actually settles it.
2. **As its own item:** a designed-and-tested telemetry path is inert in
   production. Applying the migration is a Tier-1 PO action (ADR-0008), not
   something to fold into this PR.

## What is still unexplained

The latency itself. Facts, without a theory attached:

- 11–14s for a 173–188 char reply is slow for either provider.
- The same lane measured **5 001 ms and 7 485 ms** in the ENG-06c capture
  (19:26Z) versus 11 458–14 071 ms in ENG-06e (21:50Z) — a **2.8x swing** on
  comparable traffic about 2.5 hours apart. Whatever drives it varies over hours,
  which argues against a fixed structural cost (a second sequential call would
  show as a roughly constant additive penalty, not a 2.8x swing).
- The reasoning lane, on the same turns, was **faster** (8 514–12 297 ms) despite
  doing schema-enforced structured generation with ~4 000 prompt tokens.

That last point is the sharpest clue and the reason this is deferred rather than
guessed at: the *heavier* call is the *faster* one, so the cost is unlikely to be
model inference alone.

## Why the text lane cannot be diagnosed from logs today

ENG-06d added `usageMetadata` logging to the reasoning path only:

```
[Chat] reasoning mode finishReason: STOP text length: 251 promptTokens: 3994 thinkingTokens: 2664 responseTokens: 74 maxOutputTokens: 8192
```

The text lane logs only `finishReason` and `text length`:

```
[Chat] sending 1 turns to Gemini
[Chat] finishReason: stop text length: 173
```

So for the *slower* of the two lanes there is no token accounting, no provider
identity (`AI_TEXT_PROVIDER` makes "to Gemini" in that log line potentially
wrong), and no per-call timing. Reproducing ENG-06d's instrumentation on the text
path — provider id, prompt/output tokens, elapsed ms — is the obvious next step
and would likely answer this in one capture, the same way ENG-06d's logging
turned ENG-06e from inference into measurement.

## Recommendation

1. **Defer the latency fix.** No scoped bug identified; the cause is unknown and
   guessing is what produced ENG-06c's wrong answer.
2. **Instrument the text lane** (mirror ENG-06d's reasoning-path logging,
   including the resolved provider id — the hardcoded "to Gemini" string is
   misleading under `AI_TEXT_PROVIDER=workers-ai`). Small, self-contained, and
   the prerequisite for any real diagnosis.
3. **Apply the `event_kind` migration** (PO action) so S1c's fallback telemetry
   starts working, or consciously accept that it stays inert.
4. ENG-06f's own change — the `CHAT_REQUEST_TIMEOUT_MS` raise — is a **margin**
   fix, not a latency fix. It stops a slow-but-successful turn being reported as
   a failure; it does nothing about the turn being slow.

## Caveat on the whole ENG-06e→f chain

No failing chat turn was ever captured. ENG-06e measured a 94% near-miss
(14 071 ms against the old 15 000 ms ceiling), not a timeout. The chat-lane
timeout remains the best-supported explanation for the PO's reported failure —
it is the only producer of that exact message whose margin was observed to be
thin — but it is **inference from margin, not an observed failure**. The
`[UnavailableCause]` tags this PR adds exist precisely so the next occurrence
names its own lane instead of needing a fourth round of this.
