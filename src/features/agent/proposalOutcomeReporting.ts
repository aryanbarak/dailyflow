// Task 40, ADR-0016 Slice 2: the ask-lane's half of the proposal outcome
// ledger. Reports an 'approved' or 'rejected' outcome to the Worker's
// POST /agent/proposal-outcome (Decision item 7) AFTER the write it
// describes has already completed or already been rejected -- this module
// is never on the critical path of the write itself.
//
// FIRE-AND-FORGET (ADR-0016 Decision item 6): reportProposalOutcome NEVER
// throws or rejects, for the exact same reason the Worker's own
// recordProposalOutcome never does -- a network failure, an auth hiccup, or
// a 500 from the Worker must never become a write failure the user sees.
// Every error path here is caught and swallowed (logged to console.error
// only). Callers must not `await` this inside a user-facing critical path;
// it is safe to call without awaiting because it can never throw
// synchronously either.
//
// SHAPE, NOT VALUES: writeProposalTargetFields below returns only the
// NAMES of populated target fields, never their contents -- see its own
// comment for why a generic Object.keys derivation is safe here without a
// per-domain field list (mirrors the Worker's own domain-specific
// extraction in flow-write-policy.ts, which cannot reuse this function
// since the Worker never imports src/features/agent/*).

import type { AgentIntentTarget, AgentIntentType } from "./reasoning/reasoningTypes";

export type ProposalOutcomeDomain = "tasks" | "calendar" | "finance" | "github";
export type ProposalOutcomeValue = "approved" | "rejected";
export type ProposalOutcomeRiskLevel = "none" | "low" | "medium" | "high";

export interface ReportProposalOutcomeOptions {
  workerBaseUrl: string;
  getAccessToken(): Promise<string | undefined>;
  fetcher?: typeof fetch;
  logger?: Pick<Console, "error">;
}

export interface ReportProposalOutcomeInput {
  requestId?: string;
  intentType: AgentIntentType;
  toolId: string;
  domain: ProposalOutcomeDomain;
  outcome: ProposalOutcomeValue;
  succeeded: boolean | null;
  riskLevel?: ProposalOutcomeRiskLevel;
  targetFields: readonly string[];
}

// The proposal target object only ever carries the fields its own domain
// populated (AgentIntentTarget is a flat, all-optional interface shared
// across every write domain) -- so "which keys are actually present" is
// already exactly "which fields the user's request populated," with no
// need for a per-domain allow-list the way the Worker's own
// taskIntentTargetFields/calendarIntentTargetFields/financeIntentTargetFields
// need one (those read a narrower, domain-specific parsed-intent shape,
// not this flat proposal target). Only the KEYS are ever read here -- the
// values themselves (amounts, IBANs, titles, comment bodies, ...) are never
// touched, copied, or sent anywhere by this function.
export function writeProposalTargetFields(target: AgentIntentTarget | undefined): string[] {
  if (!target) return [];
  const record = target as unknown as Record<string, unknown>;
  return Object.keys(record).filter((key) => record[key] !== undefined);
}

function endpointUrl(workerBaseUrl: string): string | null {
  try {
    const base = new URL(workerBaseUrl);
    if (base.username || base.password) return null;
    base.pathname = `${base.pathname.replace(/\/$/, "")}/agent/proposal-outcome`;
    base.search = "";
    base.hash = "";
    return base.toString();
  } catch {
    return null;
  }
}

export async function reportProposalOutcome(
  options: ReportProposalOutcomeOptions,
  input: ReportProposalOutcomeInput,
): Promise<void> {
  const logger = options.logger ?? console;
  try {
    const url = endpointUrl(options.workerBaseUrl);
    if (!url) {
      logger.error("[ProposalOutcome] invalid workerBaseUrl, skipping report (non-fatal)");
      return;
    }
    const accessToken = await options.getAccessToken();
    if (!accessToken) {
      logger.error("[ProposalOutcome] no access token available, skipping report (non-fatal)");
      return;
    }
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: input.requestId,
        intentType: input.intentType,
        toolId: input.toolId,
        domain: input.domain,
        outcome: input.outcome,
        succeeded: input.succeeded,
        riskLevel: input.riskLevel,
        targetFields: [...input.targetFields],
      }),
    });
    if (!response.ok) {
      logger.error(`[ProposalOutcome] Worker responded ${response.status} (non-fatal, write already completed)`);
    }
  } catch (error) {
    logger.error("[ProposalOutcome] failed to report outcome (non-fatal, write already completed):", error);
  }
}
