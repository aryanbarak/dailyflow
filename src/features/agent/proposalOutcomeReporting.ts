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
// NAMES of populated target fields, never their contents.
//
// Task 41 (production bug fix): this function used to trust
// Object.keys(target) directly, on the assumption that "the proposal
// target object only ever carries the fields its own domain populated."
// That assumption was FALSE -- intentValidator.ts's normalizeTarget builds
// one flat superset object with every domain's fields always present (each
// individually undefined-or-a-value), and does not scope the result down
// by the proposal's own type. A model response that included stray
// out-of-domain fields (e.g. updateTitle/updateBody on a
// create_finance_transaction proposal) therefore leaked task/calendar/
// github-shaped field NAMES into finance rows in production
// (agent_proposal_outcomes evidence, task 41). This function is now the
// defensive backstop regardless of what normalizeTarget does upstream:
// it filters the target's own keys down to exactly the CURRENT proposal's
// domain vocabulary, sourced from the shared registry's own
// WRITE_DOMAIN_TARGET_FIELDS (github has no registry entry -- ADR-0013's
// "what stays hand-written" boundary -- so its own three write fields stay
// a literal list here, matching reasoning-endpoint.ts's TARGET_FIELDS).

import type { AgentIntentTarget, AgentIntentType } from "./reasoning/reasoningTypes";
import { WRITE_DOMAIN_TARGET_FIELDS } from "../../../shared/writeIntentRegistry";

export type ProposalOutcomeDomain = "tasks" | "calendar" | "finance" | "github";
export type ProposalOutcomeValue = "approved" | "rejected";
export type ProposalOutcomeRiskLevel = "none" | "low" | "medium" | "high";

// github write proposals (write_github_issue_comment/write_github_issue_update)
// have no shared-registry entry -- these three field names mirror
// reasoning-endpoint.ts's own TARGET_FIELDS github addition exactly.
// ENG-04: engineeringInstruction/engineeringTaskClass added (repo is shared).
const GITHUB_TARGET_FIELD_NAMES: readonly string[] = ["repo", "issueNumber", "commentBody", "updateTitle", "updateBody", "updateLabels", "engineeringInstruction", "engineeringTaskClass"];

function domainTargetFieldNames(domain: ProposalOutcomeDomain): readonly string[] {
  if (domain === "github") return GITHUB_TARGET_FIELD_NAMES;
  return WRITE_DOMAIN_TARGET_FIELDS[domain].map((field) => field.name);
}

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

// Only the KEYS are ever read here -- the values themselves (amounts,
// IBANs, titles, comment bodies, ...) are never touched, copied, or sent
// anywhere by this function. `domain` is required (not inferred from the
// target's own shape) precisely because the target's shape can no longer
// be trusted to already be domain-scoped -- see this file's header comment.
export function writeProposalTargetFields(target: AgentIntentTarget | undefined, domain: ProposalOutcomeDomain): string[] {
  if (!target) return [];
  const record = target as unknown as Record<string, unknown>;
  return domainTargetFieldNames(domain).filter((name) => record[name] !== undefined);
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
