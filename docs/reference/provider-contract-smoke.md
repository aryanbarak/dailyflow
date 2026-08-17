# Provider-contract smoke script

`scripts/provider-contract-smoke.ts` makes five minimal, REAL calls against
the live Gemini API and prints PASS/FAIL for each. It exists because this
project has now hit two real-API contract breaks that unit tests (which
mock the provider) cannot catch by construction:

- Task 14: a schema shape the provider silently started rejecting.
- Task 16-fix: `text-embedding-004` was retired (shut down Jan 2026) and
  started returning 404 with zero advance warning.

The fifth contract (task 28b) covers `buildReasoningResponseSchema` from
`agent/worker/reasoning-endpoint.ts` -- the schema used by the write-intent
reasoning endpoint, which the other four contracts never touched. It
asserts the model's proposed `type` is one of `SUPPORTED_INTENT_VALUES`,
imported live from the same module (not a hand-copied list), so a future
write domain added to the shared registry is automatically covered here
too.

## When to run it

Run it manually, once, **before deploying** any change that touches:

- A Gemini model name/version string (`GEMINI_MODEL`, the embedding model
  constant, etc.).
- A `responseSchema` passed to `generateContent` (extraction, derivation,
  or reasoning).
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

### Running it safely

Set `GEMINI_API_KEY` for the current process only, then run the script in
that same session -- for example, in PowerShell:

```powershell
$env:GEMINI_API_KEY = "<paste key here>"
npx vite-node scripts/provider-contract-smoke.ts
```

**Never `source`/`cat`/`echo` `agent/worker/.dev.vars` or any other secrets
file to get the key.** That file also holds `GITHUB_APP_PRIVATE_KEY`, a
multi-line PEM -- `source`-ing the whole file has fed that key's lines into
a shell as literal commands before, echoing most of the private key into
the transcript (that key was rotated afterward). The script itself now
refuses to run with a clear message when `GEMINI_API_KEY` is unset, so
there is never a reason to reach for the secrets file directly.

The script imports the real `buildExtractionResponseSchema`,
`buildDerivationResponseSchema`, `buildTaskTitleResponseSchema`, and
`buildReasoningResponseSchema`, plus their matching prompt/system-
instruction builders, directly from `agent/worker/personal-memory-
extraction-endpoint.ts`, `agent/worker/context-derivation-endpoint.ts`,
`agent/worker/task-title-extraction.ts`, and `agent/worker/reasoning-
endpoint.ts` -- it tests the actual shapes those Workers send, not a
hand-maintained copy that could drift out of sync.
