# scripts/

## gemini-36-probe.ts (MIG-01a)

Manual diagnostic only -- never wired into CI. Isolates which request shape
gemini-3.6-flash rejects (provider-contract-smoke.ts's four
structured-generation checks currently return 400 INVALID_ARGUMENT against
it, and its plain text-generation check finishes with finishReason=length)
by sending a sequence of minimal generateContent requests and printing the
outcome of each. Not a permanent fixture like provider-contract-smoke.ts --

**delete this script once MIG-01 (the actual gemini-3.6-flash migration)
lands.**

Run manually:

```
GEMINI_API_KEY=... GEMINI_MODEL=gemini-3.6-flash npx vite-node scripts/gemini-36-probe.ts
```
