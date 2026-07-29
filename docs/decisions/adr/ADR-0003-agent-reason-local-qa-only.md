# ADR-0003: /agent/reason Remains Local-QA-Only

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision Makers:** Product Owner, Software Architect
- **Supersedes:** None
- **Superseded by:** None

---

## Context

The `/agent/reason` endpoint implements structured LLM reasoning (intent proposal → deterministic validation → tool resolution). It was validated via the Real-Worker ARUX Matrix (8/8 PASS) using local Supabase and real Gemini, exercising local Supabase Auth, non-intercepted Worker transport, and the deterministic validator/resolver path.

A decision was needed: promote `/agent/reason` to a production reasoning path, or keep it local-QA-only for the current sprint.

---

## Problem

`/agent/reason` is fully routable on any deployed Worker — `agent/worker/index.ts` dispatches to it before any other route, unconditionally. It is currently only *usable* because `reasoning-endpoint.ts` enforces its own fail-closed configuration gate (`SMARTFLOW_WORKER_MODE=local-qa` plus a loopback `SUPABASE_URL`). Without an explicit decision, it would be ambiguous whether this endpoint is expected to serve production traffic, and under what conditions that would be safe.

---

## Options Considered

| Option | Description | Reason not chosen |
|---|---|---|
| Promote to production | Add a production-scoped transport mode and point real user traffic at `/agent/reason` | Requires a coordinated change across four independent fail-closed guards (Worker `SUPABASE_URL` loopback check, Worker CORS loopback allowlist, frontend transport loopback check, absence of a production-scoped auth/rate-limit policy) plus new abuse controls — out of scope for a review-only sprint |
| Keep local-QA-only (chosen) | Leave `/agent/reason` gated exactly as validated; production continues on the existing `/chat` endpoint | **Chosen** — zero regression risk, no new production surface, matches the current sprint's scope |

---

## Decision

`/agent/reason` remains **local-QA-only** for now. Production continues to use the existing `/chat` endpoint (stable, in active use).

This holds for four independent, deliberate reasons, each of which is mutually exclusive with production traffic on its own:

1. **Worker `SUPABASE_URL` loopback check** — `resolveLocalReasoningConfig` rejects any non-loopback `SUPABASE_URL`, which includes the real hosted Supabase project. This is the hard technical block: setting `SMARTFLOW_WORKER_MODE=local-qa` on the production Worker alone would not enable the endpoint, since the loopback check on `SUPABASE_URL` would still fail closed.
2. **Worker CORS allowlist** — `localReasoningCorsHeaders()` only ever returns `Access-Control-Allow-Origin` for loopback origins, so a browser at `https://barakzai.cloud` would have the response blocked client-side regardless of server-side behavior.
3. **Frontend transport loopback check** — `resolveAgentReasoningTransport`'s `local-real-worker` and `deterministic-browser-stub` modes both hard-require a loopback `VITE_AGENT_REASONING_WORKER_URL`. The only mode permitted to target a real HTTPS URL today (`stateful-chat`) talks to `/chat`, not `/agent/reason`.
4. **No production-scoped mode exists.** There is no auth/rate-limiting policy defined for this route outside `local-qa`, and none of the Worker's existing routes (`/chat`, `/generate`) have explicit abuse controls either — a gap that would need addressing before any of them, `/agent/reason` included, safely serves unauthenticated-cost-bearing traffic at scale.

The frontend already defaults to `stateful-chat` → `/chat` in every configured environment — `VITE_AGENT_REASONING_MODE` is unset in `.env`, `.env.local`, `.env.production`, and `.env.example`. This decision therefore changes nothing user-facing; it formalizes behavior that is already the default.

Sprint 1 is a production-readiness **review** of the proposal boundary, not a feature launch — promoting `/agent/reason` is explicitly out of scope for it.

---

## Consequences

**Benefits:**
- Production reasoning stays on `/chat` — no regression, no new production risk.
- The four fail-closed guards remain untouched and continue to do their job.
- The ARUX real-worker evidence (8/8 PASS) remains valid as **local validation only** — it was never claimed as production validation, and this decision keeps that claim boundary intact.

**Trade-offs:**
- `/agent/reason` stays routable but unusable outside `local-qa` (returns `503 LOCAL_CONFIGURATION_INVALID` otherwise) — dead code path in production until a future decision changes this.
- A future "production reasoning" milestone must address all four guards above, plus abuse controls, as a coordinated change rather than a single flag flip.

---

## Related ADRs

None yet. A future ADR should supersede this one if/when a "promote `/agent/reason` to production" milestone is scoped and accepted.
