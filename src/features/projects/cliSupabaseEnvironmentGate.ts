// R-1 remediation (docs/reviews/2026-08-projectbrief-workspace-review.md):
// both project-ingestion CLIs (scripts/smartflow-refresh-project.ts,
// scripts/smartflow-create-project.ts) must fail closed, before any Supabase
// client is constructed, unless the resolved target is verifiably local --
// mirroring src/integrations/supabase/supabaseConfig.ts's existing dev-mode
// discipline for the browser client (isLocalSupabaseUrl, reused directly
// here, not reimplemented) rather than inventing a second loopback check.
//
// An env-var-only override would defeat the purpose: a misconfigured env var
// is exactly R-1's failure mode. The one escape hatch is an explicit
// --allow-production flag PLUS an interactive confirmation that echoes the
// resolved host and requires the operator to type it back exactly -- never a
// bare y/n, which could be scripted or piped past without a human reading it.
//
// This module is pure decision logic plus one I/O boundary
// (defaultConfirmProductionTarget); tests inject a fake confirm function so
// the gate's branching is fully covered without a real terminal or a live
// Supabase instance, matching this repo's existing dependency-injection
// convention for I/O boundaries. Lives here (not scripts/) so its
// co-located *.test.ts is discovered by the default `npm test` run --
// vite.config.ts's vitest `test.exclude` excludes scripts/** entirely.

import { isLocalSupabaseUrl } from "../../integrations/supabase/supabaseConfig";

export type CliSupabaseTargetFailureReason =
  | "INVALID_SUPABASE_URL"
  | "NOT_LOCAL_TARGET"
  | "PRODUCTION_NOT_CONFIRMED";

export type CliSupabaseTargetGateResult =
  | { readonly ok: true; readonly host: string; readonly local: boolean }
  | { readonly ok: false; readonly host?: string; readonly reason: CliSupabaseTargetFailureReason };

export interface CliSupabaseTargetGateOptions {
  readonly allowProduction: boolean;
  /** Injected for tests. Never called when the target is local, or when allowProduction is false. Defaults to a real interactive stdin prompt. */
  readonly confirmProductionTarget?: (host: string) => Promise<boolean>;
}

/**
 * Parses only the resolved URL's host, never the full URL -- a full URL
 * could carry embedded credentials or a query string, and this value may end
 * up in an error message. Returns null for a malformed URL rather than
 * throwing: the caller has already read this string from a required env
 * var, so a parse failure here is user configuration, not a programming
 * error.
 */
function resolveHost(supabaseUrl: string): string | null {
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return null;
  }
}

async function defaultConfirmProductionTarget(host: string): Promise<boolean> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      `Refusing to proceed silently: the resolved Supabase target is NOT local (${host}).\n` +
        `Type the host exactly to confirm you intend to write to this target, or anything else to abort: `,
    );
    return answer.trim() === host;
  } finally {
    rl.close();
  }
}

/**
 * Resolves and gates a CLI's Supabase target. Call this once, after the
 * Supabase URL env var has been read and before constructing any Supabase
 * client -- an ok:false result must short-circuit the CLI immediately, with
 * no client, read, or write ever attempted.
 */
export async function resolveCliSupabaseTarget(
  supabaseUrl: string,
  options: CliSupabaseTargetGateOptions,
): Promise<CliSupabaseTargetGateResult> {
  const host = resolveHost(supabaseUrl);
  if (host === null) {
    return { ok: false, reason: "INVALID_SUPABASE_URL" };
  }
  if (isLocalSupabaseUrl(supabaseUrl)) {
    return { ok: true, host, local: true };
  }
  if (!options.allowProduction) {
    return { ok: false, host, reason: "NOT_LOCAL_TARGET" };
  }
  const confirm = options.confirmProductionTarget ?? defaultConfirmProductionTarget;
  const confirmed = await confirm(host);
  if (!confirmed) {
    return { ok: false, host, reason: "PRODUCTION_NOT_CONFIRMED" };
  }
  return { ok: true, host, local: false };
}

/** Shared failure-message text so both CLIs report the gate identically. Never includes a key or token -- only ever given a resolved host. */
export function describeCliSupabaseTargetFailure(result: { reason: CliSupabaseTargetFailureReason; host?: string }): string {
  if (result.reason === "INVALID_SUPABASE_URL") {
    return "SMARTFLOW_SUPABASE_URL (or SMARTFLOW_LOCAL_SUPABASE_URL) is not a valid URL.";
  }
  if (result.reason === "NOT_LOCAL_TARGET") {
    return `Refusing to target non-local Supabase host "${result.host}" without --allow-production.`;
  }
  return `Target host "${result.host}" was not confirmed; aborting without writing.`;
}
