# Provider-contract smoke script

`scripts/provider-contract-smoke.ts` makes three minimal, REAL calls against
the live Gemini API and prints PASS/FAIL for each. It exists because this
project has now hit two real-API contract breaks that unit tests (which
mock the provider) cannot catch by construction:

- Task 14: a schema shape the provider silently started rejecting.
- Task 16-fix: `text-embedding-004` was retired (shut down Jan 2026) and
  started returning 404 with zero advance warning.

## When to run it

Run it manually, once, **before deploying** any change that touches:

- A Gemini model name/version string (`GEMINI_MODEL`, the embedding model
  constant, etc.).
- A `responseSchema` passed to `generateContent` (extraction or
  derivation).
- The request shape sent to `embedContent` (e.g. `outputDimensionality`).

It is **not** run in CI -- it costs real API quota and depends on live
provider behavior, so it stays a manual pre-deploy gate, the same way task
14's own live verification did.

## Running it

```bash
GEMINI_API_KEY=<key from .dev.vars, never echoed> npx vite-node scripts/provider-contract-smoke.ts
```

Never pass the key as a bare CLI argument in a shared shell, and never
paste `.dev.vars` output through `cat`/`echo` where it could land in a
transcript or log -- source it into an environment variable in-memory
instead.

The script imports the real `buildExtractionResponseSchema`,
`buildDerivationResponseSchema`, and their matching prompt/system-
instruction builders directly from `agent/worker/personal-memory-
extraction-endpoint.ts` and `agent/worker/context-derivation-endpoint.ts`
-- it tests the actual shapes those Workers send, not a hand-maintained
copy that could drift out of sync.
