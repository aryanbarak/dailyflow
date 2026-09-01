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
//     shared/aiLearning.ts's AiLearningEventInput.idempotencyKey comment),
//     UNIQUE-SCOPED BY (user_id, idempotency_key) at the database level
//     (never idempotency_key alone -- see the migration's own IDEMPOTENCY
//     SCOPE header comment), so two different users may independently use
//     the identical idempotencyKey with no collision. A duplicate append
//     (the same (user_id, idempotency_key) posted twice -- e.g. a retried
//     request after a network timeout whose first attempt actually
//     landed) hits that composite unique constraint. ARCHITECTURAL REVIEW
//     CORRECTION: a 23505 is NEVER automatically treated as "duplicate
//     success" -- this module reads the existing row back
//     (findEventByUserAndIdempotencyKey) and compares every meaningful
//     immutable field against the request that just failed
//     (isSameEventContent). Only a genuine content match is reported as
//     `{ ok: true, duplicate: true }`; a same-key-different-content
//     conflict is reported as a distinct, bounded failure
//     (`IDEMPOTENCY_CONFLICT`) -- NEVER silently accepted, and the
//     existing row is NEVER overwritten (this module has no PATCH/PUT
//     primitive at all -- see the append-only bullet above). A 23505
//     that does not resolve to a matching (user_id, idempotency_key) row
//     (a generic/unrelated conflict, or the reconciliation read itself
//     failing) is reported as a plain PERSISTENCE_FAILED, never blindly
//     treated as a duplicate.

import { supabaseGet, supabasePost } from '../context-builder'
import type { Env } from '../types'
import {
  collectAiLearningEventInputErrors,
  type AiLearningEventInput,
} from '../../../shared/aiLearning'
import { sha256Hex, stableSerialize } from '../../../shared/executionCanonicalization'

export interface AiLearningLedgerDependencies {
  logger?: Pick<Console, 'error'>
}

export type AppendAiLearningEventResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; error: 'INVALID_INPUT'; details: string[] }
  | { ok: false; error: 'IDEMPOTENCY_CONFLICT'; details: string }
  | { ok: false; error: 'PERSISTENCE_FAILED'; details: string }

// PostgREST surfaces the underlying Postgres error code in its JSON error
// body (e.g. `{"code":"23505","message":"duplicate key value violates
// unique constraint \"ai_learning_events_user_idempotency_key_unique\""}`),
// and supabasePost's own error path (context-builder.ts) embeds that raw
// body text verbatim into the Error it throws -- so matching on the
// stable Postgres unique_violation code '23505' here is robust to the
// exact constraint name. This ONLY decides whether to attempt
// reconciliation (below) -- it does not by itself decide duplicate vs.
// conflict vs. failure.
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505'

function isUniqueViolationError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(POSTGRES_UNIQUE_VIOLATION_CODE)
}

// Mirrors the migration's column set exactly (see
// supabase/migrations/20260901000000_ai_learning_events.sql).
interface AiLearningEventRow {
  id: string
  user_id: string
  session_id: string | null
  source_message_id: string | null
  correlation_id: string
  idempotency_key: string
  learning_task: string
  schema_version: string
  event_kind: string
  producer_type: string
  provider_id: string | null
  model_id: string | null
  model_version: string | null
  label_confidence: string | null
  source_hash: string | null
  payload: Record<string, unknown>
}

const ROW_SELECT = 'id,user_id,session_id,source_message_id,correlation_id,idempotency_key,learning_task,schema_version,event_kind,producer_type,provider_id,model_id,model_version,label_confidence,source_hash,payload'

function esc(value: string): string {
  return encodeURIComponent(value)
}

async function findEventByUserAndIdempotencyKey(
  env: Env,
  userId: string,
  idempotencyKey: string,
): Promise<AiLearningEventRow | undefined> {
  const rows = await supabaseGet<AiLearningEventRow[]>(
    env,
    `ai_learning_events?user_id=eq.${esc(userId)}&idempotency_key=eq.${esc(idempotencyKey)}&select=${ROW_SELECT}`,
  )
  return rows[0]
}

// Compares every meaningful immutable field of an already-persisted row
// against the request that just hit the unique-conflict -- payload
// compared via stableSerialize (shared/executionCanonicalization.ts,
// the same key-sorted-JSON primitive agent_tool_executions' own
// canonical hash relies on) so key ORDER never causes a false conflict.
// `id` and `created_at` are deliberately excluded -- they are the two
// columns a fresh append could never supply in advance, not part of "is
// this the same requested event."
function isSameEventContent(existing: AiLearningEventRow, input: AiLearningEventInput): boolean {
  return (
    existing.user_id === input.userId &&
    (existing.session_id ?? null) === (input.sessionId ?? null) &&
    (existing.source_message_id ?? null) === (input.sourceMessageId ?? null) &&
    existing.correlation_id === input.correlationId &&
    existing.learning_task === input.learningTask &&
    existing.schema_version === input.schemaVersion &&
    existing.event_kind === input.eventKind &&
    existing.producer_type === input.producerType &&
    (existing.provider_id ?? null) === (input.providerId ?? null) &&
    (existing.model_id ?? null) === (input.modelId ?? null) &&
    (existing.model_version ?? null) === (input.modelVersion ?? null) &&
    (existing.label_confidence ?? null) === (input.labelConfidence ?? null) &&
    (existing.source_hash ?? null) === (input.sourceHash ?? null) &&
    stableSerialize(existing.payload) === stableSerialize(input.payload)
  )
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
    if (isUniqueViolationError(error)) {
      return await reconcileUniqueViolation(env, input, logger)
    }
    const message = error instanceof Error ? error.message : String(error)
    logger.error('[AiLearningLedger] failed to append learning event (learning failure, not a production failure):', message)
    return { ok: false, error: 'PERSISTENCE_FAILED', details: message }
  }
}

// Only ever called after a 23505 on the initial insert. Reads the row
// back by (user_id, idempotency_key) and decides which of three outcomes
// applies -- see this module's own header comment for the full contract.
// Never overwrites, never retries the insert.
async function reconcileUniqueViolation(
  env: Env,
  input: AiLearningEventInput,
  logger: Pick<Console, 'error'>,
): Promise<AppendAiLearningEventResult> {
  let existing: AiLearningEventRow | undefined
  try {
    existing = await findEventByUserAndIdempotencyKey(env, input.userId, input.idempotencyKey)
  } catch (readError) {
    const message = readError instanceof Error ? readError.message : String(readError)
    logger.error('[AiLearningLedger] a unique-conflict occurred but the reconciliation read itself failed -- reporting as a persistence failure, never as a blind duplicate:', message)
    return { ok: false, error: 'PERSISTENCE_FAILED', details: message }
  }

  if (!existing) {
    // A 23505 fired, but no row exists for this exact (user_id,
    // idempotency_key) -- a generic/unrelated unique-constraint conflict.
    // Never blindly treated as duplicate success.
    logger.error('[AiLearningLedger] received a unique-violation but found no matching (user_id, idempotency_key) row to reconcile against -- not treating as duplicate success:', input.idempotencyKey)
    return { ok: false, error: 'PERSISTENCE_FAILED', details: 'Unique-constraint conflict did not resolve to a matching (user_id, idempotency_key) row.' }
  }

  if (isSameEventContent(existing, input)) {
    // Not an error worth logging: an idempotent retry landing on an
    // event that was already durably appended, with identical content,
    // is the expected, successful outcome of retrying after an
    // ambiguous prior attempt.
    return { ok: true, duplicate: true }
  }

  logger.error('[AiLearningLedger] idempotency conflict: (user_id, idempotency_key) already exists with different content -- refusing to overwrite:', input.idempotencyKey)
  return {
    ok: false,
    error: 'IDEMPOTENCY_CONFLICT',
    details: `An event already exists for user "${input.userId}" with idempotencyKey "${input.idempotencyKey}" but different content. The existing row is never overwritten.`,
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
