// ALF-0: the append-only write path for public.ai_learning_events. See
// ADR-0020 (docs/decisions/adr/ADR-0020-ai-learning-foundation-and-
// shadow-model-governance.md) and the migration's own header comment
// (supabase/migrations/20260901000000_ai_learning_events.sql) for the
// full design this module implements.
//
// NOT WIRED INTO /chat OR ANY OTHER PRODUCTION FLOW IN ALF-0. This module
// is exported and tested standalone; no call site in agent/worker/index.ts
// or flow-write-policy.ts invokes it yet. Runtime hookup (observing real
// turns) is explicitly future work -- see ADR-0020 Section 13 ("no runtime
// authority").
//
// FAILURE POSTURE (the contract a future caller can rely on):
//   - appendAiLearningEvent NEVER throws. Every failure mode -- invalid
//     input, a network error, a non-2xx Supabase response -- is caught
//     and returned as an { ok: false } result. A future Chat/Shadow Mode
//     caller can therefore always safely fire-and-forget this call
//     without a try/catch of its own, exactly like
//     proposal-outcome-recording.ts's recordProposalOutcome. Learning
//     failure must never become production failure.
//   - UNLIKE recordProposalOutcome (which returns void unconditionally,
//     by explicit ADR-0016 design, because no caller may act differently
//     on the answer), appendAiLearningEvent DOES report success/failure
//     back to its caller. The task's own instruction is explicit: "never
//     report a learning event as stored if persistence failed" -- a
//     future caller that itself wants to know (e.g. to decide whether to
//     retry, or to log a metric) is not lying to itself about whether the
//     row actually landed.
//   - append-only: this module has exactly one write primitive
//     (supabasePost, an HTTP POST) and never imports or calls
//     supabasePatch/supabaseWriteReturning('PATCH'/'DELETE', ...). A later
//     fact about the same observed turn is always a NEW row (same
//     correlation_id, new idempotency_key), never a mutation of an
//     earlier one.
//   - idempotent append: idempotency_key is caller-supplied and
//     deterministic (never generated here -- see
//     shared/aiLearning.ts's AiLearningEventInput.idempotencyKey comment).
//     A duplicate append (the same idempotency_key posted twice -- e.g. a
//     retried request after a network timeout whose first attempt actually
//     landed) hits the migration's `unique (idempotency_key)` constraint
//     and is treated as an idempotent no-op success (`{ ok: true,
//     duplicate: true }`), never as a failure a caller needs to react to.

import { supabasePost } from '../context-builder'
import type { Env } from '../types'
import {
  collectAiLearningEventInputErrors,
  type AiLearningEventInput,
} from '../../../shared/aiLearning'
import { sha256Hex } from '../../../shared/executionCanonicalization'

export interface AiLearningLedgerDependencies {
  logger?: Pick<Console, 'error'>
}

export type AppendAiLearningEventResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; error: 'INVALID_INPUT'; details: string[] }
  | { ok: false; error: 'PERSISTENCE_FAILED'; details: string }

// PostgREST surfaces the underlying Postgres error code in its JSON error
// body (e.g. `{"code":"23505","message":"duplicate key value violates
// unique constraint \"ai_learning_events_idempotency_key_key\""}`), and
// supabasePost's own error path (context-builder.ts) embeds that raw body
// text verbatim into the Error it throws -- so matching on the stable
// Postgres unique_violation code '23505' here is robust to the exact
// constraint name, matching agent-tool-execution.ts's own
// REQUEST_ID_CONFLICT reconciliation convention (comparing against the
// existing row) for the same class of problem, simplified here because
// ai_learning_events rows are immutable once appended -- there is nothing
// to reconcile a duplicate idempotency_key against beyond "it already
// exists," which is exactly what 23505 already tells us.
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505'

function isDuplicateIdempotencyKeyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(POSTGRES_UNIQUE_VIOLATION_CODE)
}

// Never throws. Returns a result describing exactly what happened --
// invalid input is rejected before any network call is attempted; a
// persistence failure is reported, never silently swallowed as success.
export async function appendAiLearningEvent(
  env: Env,
  input: AiLearningEventInput,
  deps: AiLearningLedgerDependencies = {},
): Promise<AppendAiLearningEventResult> {
  const logger = deps.logger ?? console

  const validationErrors = collectAiLearningEventInputErrors(input)
  if (validationErrors.length > 0) {
    logger.error('[AiLearningLedger] refused to append an invalid event:', validationErrors)
    return { ok: false, error: 'INVALID_INPUT', details: validationErrors }
  }

  try {
    await supabasePost(env, 'ai_learning_events', {
      user_id: input.userId,
      session_id: input.sessionId ?? null,
      source_message_id: input.sourceMessageId ?? null,
      correlation_id: input.correlationId,
      idempotency_key: input.idempotencyKey,
      learning_task: input.learningTask,
      schema_version: input.schemaVersion,
      event_kind: input.eventKind,
      producer_type: input.producerType,
      provider_id: input.providerId ?? null,
      model_id: input.modelId ?? null,
      model_version: input.modelVersion ?? null,
      label_confidence: input.labelConfidence ?? null,
      source_hash: input.sourceHash ?? null,
      payload: input.payload,
    })
    return { ok: true, duplicate: false }
  } catch (error) {
    if (isDuplicateIdempotencyKeyError(error)) {
      // Not an error worth logging: an idempotent retry landing on an
      // event that was already durably appended is the expected,
      // successful outcome of retrying after an ambiguous prior attempt.
      return { ok: true, duplicate: true }
    }
    const message = error instanceof Error ? error.message : String(error)
    logger.error('[AiLearningLedger] failed to append learning event (learning failure, not a production failure):', message)
    return { ok: false, error: 'PERSISTENCE_FAILED', details: message }
  }
}

// Deterministic fingerprint of transiently-received text (e.g. a chat
// message body passed to a future Shadow Mode inference call), stored
// instead of a second copy of the text itself -- see the migration's own
// RAW TEXT / PRIVACY header comment. Reuses shared/executionCanonicalization
// .ts's sha256Hex (same primitive agent_tool_executions' canonical hash
// already relies on) rather than a second hashing implementation.
export async function computeSourceHash(text: string): Promise<string> {
  return sha256Hex(text)
}
