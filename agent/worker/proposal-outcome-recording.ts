// Task 40, ADR-0016 Slice 2: the single internal recording function BOTH
// write systems call -- the Worker's deterministic auto-write lane
// in-process (flow-write-policy.ts's respondToWriteExecution, via index.ts),
// and the frontend's ask-lane via the POST /agent/proposal-outcome HTTP
// handler below. Neither lane can produce an outcome invisible to the
// other because both are required to go through this one function -- see
// ADR-0016 Decision item 3.
//
// FIRE-AND-FORGET (ADR-0016 Decision item 6): recordProposalOutcome NEVER
// throws or rejects. A failed insert is logged and swallowed here, at the
// source, so every caller -- whether it awaits this call or not -- can
// never have it become a write failure. This is deliberately NOT "the
// caller's job to catch" -- centralizing it here means a future call site
// cannot forget to protect the write path.
//
// SHAPE, NOT VALUES: every field accepted here is intentionally shape-only
// (intent type, tool id, domain, outcome, risk level, which target fields
// were populated). Nothing that could carry a proposal's actual content
// (an amount, an IBAN, a title, a message) has any parameter here -- see
// each call site's own comment for how target field NAMES are derived
// without ever touching their values.

import { supabasePost } from './context-builder'
import type { Env } from './types'

export type ProposalOutcomeDomain = 'tasks' | 'calendar' | 'finance' | 'github'
export type ProposalOutcomeWriteMode = 'auto' | 'ask'
export type ProposalOutcomeValue = 'auto_executed' | 'approved' | 'rejected'
export type ProposalOutcomeRiskLevel = 'none' | 'low' | 'medium' | 'high'

export interface ProposalOutcomeInput {
  userId: string
  requestId?: string
  intentType: string
  toolId: string
  domain: ProposalOutcomeDomain
  writeMode: ProposalOutcomeWriteMode
  outcome: ProposalOutcomeValue
  // null for 'rejected' (nothing was attempted); true/false for
  // 'auto_executed'/'approved' -- mirrors the migration's own
  // succeeded-requires-attempt CHECK constraint, enforced again here at the
  // application layer so a caller gets an honest shape even before the
  // insert is attempted.
  succeeded: boolean | null
  riskLevel?: ProposalOutcomeRiskLevel | null
  targetFields: readonly string[]
}

export interface ProposalOutcomeRecordingDependencies {
  logger?: Pick<Console, 'error'>
}

// Never throws. Returns nothing -- callers that want to know whether the
// insert actually succeeded are asking the wrong question of this
// function; per ADR-0016 item 6, no caller is allowed to act differently
// based on that answer.
export async function recordProposalOutcome(
  env: Env,
  input: ProposalOutcomeInput,
  deps: ProposalOutcomeRecordingDependencies = {},
): Promise<void> {
  const logger = deps.logger ?? console
  try {
    await supabasePost(env, 'agent_proposal_outcomes', {
      user_id: input.userId,
      request_id: input.requestId ?? null,
      intent_type: input.intentType,
      tool_id: input.toolId,
      domain: input.domain,
      write_mode: input.writeMode,
      outcome: input.outcome,
      succeeded: input.succeeded,
      risk_level: input.riskLevel ?? null,
      target_fields: [...input.targetFields],
    })
  } catch (error) {
    logger.error('[ProposalOutcome] failed to record outcome (non-fatal, write already completed):', error)
  }
}
