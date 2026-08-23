// SmartFlow -- MIG-01b: single source of truth for the Gemini model
// string. Every call site that builds a generateContent URL (the Worker's
// own route handlers, the GeminiTextGenerationProvider adapter, and the
// manual scripts/provider-contract-smoke.ts + scripts/gemini-36-probe.ts)
// resolves the model through resolveGeminiModel instead of reading
// env.GEMINI_MODEL / process.env.GEMINI_MODEL directly, so a future
// migration is a one-line change here, not a codebase-wide
// grep-and-replace.
//
// DEFAULT_GEMINI_MODEL is 'gemini-3.6-flash' as of MIG-01 (2026-08-23):
// gemini-2.0-flash is fully retired and gemini-2.5-flash is unavailable to
// new API keys (see PROJECT_STATUS.md Incidents #2 and
// scripts/gemini-36-probe.ts's findings). Every real Worker deployment
// still sets GEMINI_MODEL explicitly via wrangler.toml's [vars] -- this
// default only takes effect when GEMINI_MODEL is genuinely absent, e.g. a
// script run without GEMINI_MODEL set in its process.env, or the
// deliberate env-pin fallback path (see wrangler.toml's own comment) if a
// deploy needs to pin back to gemini-2.5-flash on a recharged legacy
// account.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'

export interface GeminiModelEnv {
  GEMINI_MODEL?: string
}

export function resolveGeminiModel(env: GeminiModelEnv): string {
  return env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
}
