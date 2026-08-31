// Chat V2 Slice 2A -- server-owned tool execution lifecycle.
//
// WHY THIS EXISTS: the existing post-approval write path (every
// tasks.create/update/complete, calendar.create_event/update_event
// handler under src/features/agent/handlers/) writes directly from the
// browser to Supabase, authorized only by RLS + the user's own JWT.
// Whatever the browser CLAIMS happened (success, failure, what it wrote)
// is the only record Chat has -- there is no server-owned confirmation.
// This module is the fix: the browser's Approve action now calls through
// to this Worker, which durably records the intent BEFORE approving it,
// re-verifies server policy at approval time, atomically claims the
// execution (so a duplicated/replayed request cannot execute twice), and
// only then calls this codebase's OWN existing, already-tested
// executeAutoTaskWrite/executeAutoCalendarWrite functions (previously dead
// code in production, since INC-02 clamps every real write to 'ask' and
// nothing ever called them with mode==='auto' -- this module is their
// first live caller). tasks.complete has no equivalent existing Worker
// function (task completion has always been a plain client-side status
// flip), so this module adds one small, narrowly-scoped executeTaskComplete
// alongside them, rather than leaving tasks.complete on a parallel path.
//
// LIFECYCLE (agent_tool_executions.status):
//   approval_pending -> approved -> executing -> succeeded | failed
//                     -> denied (policy off / expired at approval time)
//                     -> expired (approval window elapsed)
// Every transition below is a CONDITIONAL PostgREST PATCH
// (`...&status=eq.<expected>`), which Postgres executes as a single
// UPDATE ... WHERE ... RETURNING statement -- exactly one concurrent
// caller can ever see 0 rows affected mean "someone already moved this
// row," which is the database-backed atomicity decision D of this slice's
// spec asked for, with no custom RPC/stored procedure needed.
//
// TWO-PHASE BY DESIGN (decision 3: "the Worker must not execute an `ask`
// write merely because a client sends an execution request"): `request`
// only ever creates a durable approval_pending row (or, for policy
// mode==='auto', proceeds straight through -- see handleAgentToolExecutionRequest).
// `approve` is a genuinely separate call that can only ever advance a row
// that already exists in exactly the right state; it accepts NOTHING but
// an executionId, so there is no argument value anywhere in the approve
// request body a caller could tamper with -- every value that actually
// executes was fixed durably at request time and is only ever READ back
// from the stored row, never re-trusted from a second request. This is
// intentionally a stronger guarantee than hash-comparing resent arguments.

import type { Env, Language } from './types'
import { supabaseGet } from './context-builder'
import {
  correlateUndoRecordWithExecution,
  esc,
  executeAutoCalendarWrite,
  executeAutoTaskWrite,
  resolveServerFlowWriteMode,
  supabaseWriteNoContent,
  supabaseWriteReturning,
  utcInstantToZonedDateAndTime,
  type ParsedCalendarWriteIntent,
  type ParsedTaskWriteIntent,
} from './flow-write-policy'
import { computeToolExecutionCanonicalHash, toolExecutionIntentId } from '../../shared/executionCanonicalization'

export const SUPPORTED_EXECUTION_TOOL_IDS = [
  'tasks.create',
  'tasks.update',
  'tasks.complete',
  'calendar.create_event',
  'calendar.update_event',
] as const

export type SupportedExecutionToolId = typeof SUPPORTED_EXECUTION_TOOL_IDS[number]
export type ExecutionDomain = 'tasks' | 'calendar'
export type ExecutionAction = 'create' | 'update' | 'complete'
export type ExecutionLifecycleStatus =
  | 'approval_pending'
  | 'approved'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'denied'
  | 'expired'
  | 'revoked'

// decision 10: an approval_pending row this stale is treated as expired
// rather than silently honored -- matches this codebase's existing
// posture (FLOW_WRITE_UNDO_WINDOW_MS in flow-write-policy.ts) of bounding
// how long a pending, not-yet-confirmed state may be acted on.
export const EXECUTION_APPROVAL_WINDOW_MS = 15 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSupportedToolId(value: unknown): value is SupportedExecutionToolId {
  return typeof value === 'string' && (SUPPORTED_EXECUTION_TOOL_IDS as readonly string[]).includes(value)
}

function resolveDomainAndAction(toolId: SupportedExecutionToolId): { domain: ExecutionDomain; action: ExecutionAction } {
  if (toolId === 'tasks.create') return { domain: 'tasks', action: 'create' }
  if (toolId === 'tasks.update') return { domain: 'tasks', action: 'update' }
  if (toolId === 'tasks.complete') return { domain: 'tasks', action: 'complete' }
  if (toolId === 'calendar.create_event') return { domain: 'calendar', action: 'create' }
  return { domain: 'calendar', action: 'update' }
}

interface AgentToolExecutionRow {
  id: string
  user_id: string
  session_id: string | null
  chat_message_id: string | null
  request_id: string
  tool_id: string
  domain: ExecutionDomain
  action: ExecutionAction
  intent_id: string
  canonical_hash: string
  normalized_arguments: Record<string, unknown>
  time_zone: string | null
  language: Language
  status: ExecutionLifecycleStatus
  created_at: string
  approval_requested_at: string | null
  approved_at: string | null
  execution_started_at: string | null
  completed_at: string | null
  target_type: string | null
  target_id: string | null
  error_code: string | null
}

const ROW_SELECT = 'id,user_id,session_id,chat_message_id,request_id,tool_id,domain,action,intent_id,canonical_hash,normalized_arguments,time_zone,language,status,created_at,approval_requested_at,approved_at,execution_started_at,completed_at,target_type,target_id,error_code'

function json(body: unknown, status = 200, origin = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

// Mirrors index.ts's own requireAuth exactly (real Supabase JWT
// verification via /auth/v1/user) -- duplicated rather than imported,
// same convention every other Worker sub-module (github-integration.ts,
// reasoning-endpoint.ts) already follows, since index.ts exports none of
// its route handlers' internals for sibling files to import.
async function requireAuthenticatedUser(request: Request, env: Env): Promise<{ userId: string | null; error: string | null }> {
  const auth = request.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return { userId: null, error: 'Missing authorization token' }
  const token = auth.slice(7)
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': env.SUPABASE_ANON_KEY },
  })
  if (!res.ok) return { userId: null, error: 'Unauthorized' }
  const user = await res.json() as { id?: string }
  if (!user?.id) return { userId: null, error: 'Invalid token' }
  return { userId: user.id, error: null }
}

interface ParsedRequestBody {
  toolId: SupportedExecutionToolId
  targetId?: string
  normalizedArguments: Record<string, unknown>
  requestId: string
  sessionId?: string
  chatMessageId?: string
  timeZone: string
  language: Language
}

function parseRequestBody(body: unknown): { ok: true; value: ParsedRequestBody } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'MALFORMED_ARGUMENTS' }
  if (!isSupportedToolId(body.toolId)) return { ok: false, error: 'UNSUPPORTED_TOOL' }
  if (typeof body.requestId !== 'string' || !body.requestId.trim()) return { ok: false, error: 'MALFORMED_ARGUMENTS' }
  if (typeof body.timeZone !== 'string' || !body.timeZone.trim()) return { ok: false, error: 'MALFORMED_ARGUMENTS' }
  if (!isRecord(body.arguments)) return { ok: false, error: 'MALFORMED_ARGUMENTS' }
  if (body.targetId !== undefined && (typeof body.targetId !== 'string' || !body.targetId.trim())) {
    return { ok: false, error: 'MALFORMED_ARGUMENTS' }
  }
  const language: Language = body.language === 'de' || body.language === 'fa' ? body.language : 'en'
  return {
    ok: true,
    value: {
      toolId: body.toolId,
      targetId: typeof body.targetId === 'string' ? body.targetId.trim() : undefined,
      normalizedArguments: body.arguments,
      requestId: body.requestId.trim(),
      sessionId: typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : undefined,
      chatMessageId: typeof body.chatMessageId === 'string' && body.chatMessageId.trim() ? body.chatMessageId.trim() : undefined,
      timeZone: body.timeZone.trim(),
      language,
    },
  }
}

// BLOCKER B CORRECTION: idempotency is scoped to the per-attempt
// (user_id, request_id) pair (agent_tool_executions_user_request_unique),
// never to the permanent semantic intent hash alone -- see the migration's
// own comment on that constraint. Looking this up by intent_id (the
// original, incorrect design) would have made a legitimate SECOND
// occurrence of the same semantic action collapse onto the first one
// forever.
async function findExecutionByRequestId(env: Env, userId: string, requestId: string): Promise<AgentToolExecutionRow | undefined> {
  const rows = await supabaseGet<AgentToolExecutionRow[]>(
    env,
    `agent_tool_executions?user_id=eq.${esc(userId)}&request_id=eq.${esc(requestId)}&select=${ROW_SELECT}&limit=1`,
  ).catch(() => [])
  return rows[0]
}

async function loadExecutionRow(env: Env, executionId: string): Promise<AgentToolExecutionRow | undefined> {
  const rows = await supabaseGet<AgentToolExecutionRow[]>(
    env,
    `agent_tool_executions?id=eq.${esc(executionId)}&select=${ROW_SELECT}&limit=1`,
  ).catch(() => [])
  return rows[0]
}

// The one atomic, database-backed conditional transition every lifecycle
// move in this module goes through. Returns false (never throws) when the
// row is not currently in `fromStatus` -- indistinguishable, by design,
// between "does not exist," "owned by someone else" (already filtered out
// by the caller's own id+user_id predicate before this is ever reached),
// and "a concurrent request already won this exact transition."
async function transitionStatus(
  env: Env,
  executionId: string,
  fromStatus: ExecutionLifecycleStatus,
  toStatus: ExecutionLifecycleStatus,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const rows = await supabaseWriteReturning<Array<{ id: string }>>(
    env,
    'PATCH',
    `agent_tool_executions?id=eq.${esc(executionId)}&status=eq.${esc(fromStatus)}&select=id`,
    { status: toStatus, ...patch },
  )
  return rows.length === 1
}

interface ExecutionOutcome {
  status: 'executed' | 'clarify' | 'failed' | 'not_found'
  reply: string
  undoId?: string
  targetType?: string
  targetId?: string
  completedAt?: string
}

function buildTaskIntent(toolId: SupportedExecutionToolId, args: Record<string, unknown>, targetId: string | null): ParsedTaskWriteIntent {
  const title = typeof args.title === 'string' ? args.title : undefined
  const notes = typeof args.notes === 'string' ? args.notes : undefined
  const dueDate = args.dueDate === null ? null : typeof args.dueDate === 'string' ? args.dueDate : undefined
  if (toolId === 'tasks.create') return { kind: 'create_task', title, notes, dueDate }
  return { kind: 'update_task', title, notes, dueDate, targetId: targetId ?? undefined }
}

// calendarCreateEventHandler.ts/calendarUpdateEventHandler.ts (and
// src/features/calendar/calendarService.ts's toInsertRow underneath them)
// pass a genuine UTC ISO instant (dateTimeStart/dateTimeEnd, e.g.
// "2026-05-23T12:30:00.000Z") and persist its date/time components via a
// NAIVE SLICE -- no IANA-zone conversion (calendarService.ts's own comment:
// "ISO UTC string"; toInsertRow: `date: input.dateTimeStart.slice(0,10)`,
// `start_time: input.dateTimeStart.slice(11,16)`). executeAutoCalendarWrite
// instead expects LOCAL wall-clock startDate/startTime and converts them
// back to UTC itself via zonedDateTimeToUtcIso (built for the OLDER
// server-side NL flow, where the parser only ever produces local values).
// utcInstantToZonedDateAndTime is zonedDateTimeToUtcIso's exact inverse
// (see its own comment) -- converting the UTC instant to local here, then
// letting executeAutoCalendarWrite convert that same local value back to
// UTC with the SAME time zone, reconstructs the identical original UTC
// instant, so the final persisted date/start_time/end_time are BYTE
// IDENTICAL to what the direct naive-slice write would have stored -- with
// the added correctness that the confirmation reply text (also built from
// this same time zone) displays the user's actual local time instead of
// raw UTC.
function buildCalendarIntent(
  toolId: SupportedExecutionToolId,
  args: Record<string, unknown>,
  targetId: string | null,
  timeZone: string,
): ParsedCalendarWriteIntent {
  const title = typeof args.title === 'string' ? args.title : undefined
  const notes = typeof args.notes === 'string' ? args.notes : undefined
  const dateTimeStart = typeof args.dateTimeStart === 'string' ? args.dateTimeStart : undefined
  const dateTimeEnd = typeof args.dateTimeEnd === 'string' ? args.dateTimeEnd : undefined
  const startLocal = dateTimeStart ? utcInstantToZonedDateAndTime(dateTimeStart, timeZone) : undefined
  const endLocal = dateTimeEnd ? utcInstantToZonedDateAndTime(dateTimeEnd, timeZone) : undefined
  const startDate = startLocal?.date
  const startTime = startLocal?.time
  const endTime = endLocal?.time
  if (toolId === 'calendar.create_event') return { kind: 'create_calendar_event', title, notes, startDate, startTime, endTime }
  return { kind: 'update_calendar_event', title, notes, startDate, startTime, endTime, targetId: targetId ?? undefined }
}

// tasks.complete has no pre-existing Worker execution function -- task
// completion has always been a plain, direct browser-to-Supabase status
// flip (src/features/tasks/tasksService.ts's completeTask). Unlike
// create/update (real NL parsing, date resolution, alarms), completion is
// a single-column UPDATE with no parsing to duplicate -- reusing nothing
// existing here is a disclosed gap (per this slice's section E), not an
// oversight, and this function is deliberately as small as the operation
// it performs.
async function executeTaskComplete(env: Env, userId: string, taskId: string, now: Date): Promise<ExecutionOutcome> {
  if (!taskId) return { status: 'not_found', reply: 'Which exact task should I complete?' }
  const rows = await supabaseWriteReturning<Array<{ id: string; title: string; completed: boolean; completed_at: string | null }>>(
    env,
    'PATCH',
    `tasks?id=eq.${esc(taskId)}&user_id=eq.${esc(userId)}&select=id,title,completed,completed_at`,
    { completed: true, completed_at: now.toISOString() },
  )
  const task = rows[0]
  if (!task?.id) return { status: 'not_found', reply: 'I could not find that task.' }
  return { status: 'executed', reply: `✓ Task completed: ${task.title}`, targetType: 'task', targetId: task.id, completedAt: task.completed_at ?? now.toISOString() }
}

async function executeByToolId(env: Env, userId: string, row: AgentToolExecutionRow, now: Date): Promise<ExecutionOutcome> {
  const timeZone = row.time_zone ?? 'UTC'
  const language = row.language

  if (row.tool_id === 'tasks.create' || row.tool_id === 'tasks.update') {
    const intent = buildTaskIntent(row.tool_id, row.normalized_arguments, row.target_id)
    const result = await executeAutoTaskWrite({ env, userId, language, intent, now, timeZone })
    if (result.status === 'executed') return { status: 'executed', reply: result.reply, undoId: result.undoId, targetType: 'task', targetId: result.id }
    // 'not_found' (only reachable via the targetId lookup this slice added)
    // carries no reply of its own -- see flow-write-policy.ts's own comment
    // on why that variant has always been reply-less.
    return { status: result.status, reply: result.status === 'not_found' ? 'I could not find that task.' : result.reply }
  }

  if (row.tool_id === 'calendar.create_event' || row.tool_id === 'calendar.update_event') {
    const intent = buildCalendarIntent(row.tool_id, row.normalized_arguments, row.target_id, timeZone)
    const result = await executeAutoCalendarWrite({ env, userId, language, intent, now, timeZone })
    if (result.status === 'executed') return { status: 'executed', reply: result.reply, undoId: result.undoId, targetType: 'calendar_event', targetId: result.id }
    return { status: result.status, reply: result.status === 'not_found' ? 'I could not find that event.' : result.reply }
  }

  // tasks.complete
  return executeTaskComplete(env, userId, row.target_id ?? '', now)
}

function errorCodeForOutcome(outcome: ExecutionOutcome): string {
  if (outcome.status === 'clarify') return 'CLARIFICATION_NEEDED'
  if (outcome.status === 'not_found') return 'TARGET_NOT_FOUND'
  return 'EXECUTION_FAILED'
}

interface ApprovalResult {
  httpStatus: number
  body: Record<string, unknown>
}

// The single shared core for both the mode==='auto' immediate-execution
// path (handleAgentToolExecutionRequest) and the mode==='ask' explicit
// approve call (handleAgentToolExecutionApprove) -- identical policy
// re-check, identical atomic transitions, identical execution dispatch,
// so there is exactly one place either path can diverge from decision 10's
// fail-closed list, not two to keep in sync.
async function approveAndExecute(env: Env, userId: string, executionId: string, now: Date): Promise<ApprovalResult> {
  const row = await loadExecutionRow(env, executionId)
  if (!row) return { httpStatus: 404, body: { error: 'UNKNOWN_EXECUTION_ID' } }
  if (row.user_id !== userId) return { httpStatus: 403, body: { error: 'ACTOR_MISMATCH' } }

  if (row.status === 'approval_pending') {
    const requestedAtMs = row.approval_requested_at ? new Date(row.approval_requested_at).getTime() : 0
    if (now.getTime() - requestedAtMs > EXECUTION_APPROVAL_WINDOW_MS) {
      await transitionStatus(env, executionId, 'approval_pending', 'expired', {})
      return { httpStatus: 410, body: { error: 'INTENT_EXPIRED', status: 'expired' } }
    }

    // decision 10 / test 9: server policy is re-evaluated fresh here, not
    // trusted from request time -- a stored flow_write_permissions row (or
    // an admin action) could have flipped a domain/action to 'off' in the
    // interval between request and approve. tasks.complete has no
    // resolveServerFlowWriteMode concept (it has never had an 'auto'/'off'
    // distinction -- approval is unconditional, matching its existing
    // client-side ExecutionIntent lifecycle, untouched by this slice) so
    // this check is skipped for it, not defaulted to some invented policy.
    if (row.action !== 'complete') {
      const mode = await resolveServerFlowWriteMode(env, userId, row.domain, row.action)
      if (mode === 'off') {
        await transitionStatus(env, executionId, 'approval_pending', 'denied', {})
        return { httpStatus: 403, body: { error: 'POLICY_DENIED', status: 'denied' } }
      }
    }

    const approved = await transitionStatus(env, executionId, 'approval_pending', 'approved', { approved_at: now.toISOString() })
    if (!approved) return { httpStatus: 409, body: { error: 'WRONG_LIFECYCLE_STATE' } }
  } else if (row.status !== 'approved') {
    // Already executing/succeeded/failed/denied/expired/revoked: decision 9,
    // one approval authorizes exactly one immutable action -- never a
    // second execution attempt for the same row, regardless of why the
    // caller thinks another attempt is warranted.
    return { httpStatus: 409, body: { error: 'DUPLICATE_EXECUTION', status: row.status } }
  }

  const claimed = await transitionStatus(env, executionId, 'approved', 'executing', { execution_started_at: now.toISOString() })
  if (!claimed) {
    // Lost the race to a concurrent duplicate call -- test 7's "one write
    // maximum" guarantee. The winner proceeds below; this caller stops here.
    return { httpStatus: 409, body: { error: 'DUPLICATE_EXECUTION' } }
  }

  const outcome = await executeByToolId(env, userId, row, now)

  if (outcome.status === 'executed') {
    await transitionStatus(env, executionId, 'executing', 'succeeded', {
      completed_at: now.toISOString(),
      target_type: outcome.targetType ?? null,
      target_id: outcome.targetId ?? row.target_id ?? null,
    })
    if (outcome.undoId) await correlateUndoRecordWithExecution(env, outcome.undoId, executionId)
    return {
      httpStatus: 200,
      body: {
        status: 'succeeded',
        reply: outcome.reply,
        undoId: outcome.undoId,
        targetId: outcome.targetId ?? row.target_id ?? undefined,
        completedAt: outcome.completedAt,
      },
    }
  }

  const errorCode = errorCodeForOutcome(outcome)
  await transitionStatus(env, executionId, 'executing', 'failed', { completed_at: now.toISOString(), error_code: errorCode })
  return { httpStatus: 200, body: { status: 'failed', reply: outcome.reply, errorCode } }
}

export async function handleAgentToolExecutionRequest(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''
  const { userId, error: authError } = await requireAuthenticatedUser(request, env)
  if (authError || !userId) return json({ error: authError ?? 'Unauthorized' }, 401, origin)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin)
  }

  const parsed = parseRequestBody(body)
  if (!parsed.ok) return json({ error: parsed.error }, 400, origin)
  const { toolId, targetId, normalizedArguments, requestId, sessionId, chatMessageId, timeZone, language } = parsed.value
  const { domain, action } = resolveDomainAndAction(toolId)

  // decision 10: a domain/action combination this endpoint does not
  // recognize -- defense in depth beyond isSupportedToolId, which already
  // rejects anything outside SUPPORTED_EXECUTION_TOOL_IDS before this point.
  if (!(['tasks', 'calendar'] as const).includes(domain)) return json({ error: 'UNSUPPORTED_TOOL' }, 400, origin)

  // tasks.complete: no off/auto policy concept exists for it (see
  // approveAndExecute's own comment) -- it always requires the explicit
  // approve step, same as it always has via its existing client-side
  // ExecutionIntent ceremony, untouched by this slice.
  const mode = action === 'complete' ? 'ask' : await resolveServerFlowWriteMode(env, userId, domain, action)
  if (mode === 'off') return json({ error: 'POLICY_DENIED', status: 'denied' }, 403, origin)

  const canonicalHash = await computeToolExecutionCanonicalHash({
    actorId: userId,
    toolId,
    domain,
    action,
    normalizedArguments,
    targetId,
  })
  const intentId = toolExecutionIntentId(canonicalHash)
  const now = new Date()

  let row: AgentToolExecutionRow | undefined
  try {
    const rows = await supabaseWriteReturning<AgentToolExecutionRow[]>(env, 'POST', `agent_tool_executions?select=${ROW_SELECT}`, {
      user_id: userId,
      session_id: sessionId ?? null,
      chat_message_id: chatMessageId ?? null,
      request_id: requestId,
      tool_id: toolId,
      domain,
      action,
      intent_id: intentId,
      canonical_hash: canonicalHash,
      normalized_arguments: normalizedArguments,
      time_zone: timeZone,
      language,
      target_id: targetId ?? null,
      status: 'approval_pending',
      approval_requested_at: now.toISOString(),
    })
    row = rows[0]
  } catch {
    // agent_tool_executions_user_request_unique: this exact (userId,
    // requestId) attempt already has a row. BLOCKER B requires telling two
    // cases apart, not collapsing them:
    //   A. genuine retry of the identical request (same canonical hash) --
    //      return the EXISTING row idempotently, so retrying an unanswered
    //      network call never double-creates or double-executes.
    //   B. request-id SUBSTITUTION (same requestId, a DIFFERENT canonical
    //      hash) -- a caller reusing an old, already-bound requestId
    //      against new arguments to try to inherit its approval. Fail
    //      closed: never reuse the existing row, never create a second one
    //      under the same requestId.
    const existing = await findExecutionByRequestId(env, userId, requestId)
    if (!existing) return json({ error: 'REQUEST_FAILED' }, 500, origin)
    if (existing.canonical_hash !== canonicalHash) {
      return json({ error: 'REQUEST_ID_CONFLICT' }, 409, origin)
    }
    row = existing
  }
  if (!row) return json({ error: 'REQUEST_FAILED' }, 500, origin)

  if (mode === 'auto') {
    const result = await approveAndExecute(env, userId, row.id, now)
    return json(result.body, result.httpStatus, origin)
  }

  return json({ executionId: row.id, status: row.status }, 200, origin)
}

export async function handleAgentToolExecutionApprove(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''
  const { userId, error: authError } = await requireAuthenticatedUser(request, env)
  if (authError || !userId) return json({ error: authError ?? 'Unauthorized' }, 401, origin)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin)
  }

  // Deliberately the ONLY field this endpoint reads from the request body
  // -- see this module's own header comment on why the approve call never
  // re-accepts argument values.
  if (!isRecord(body) || typeof body.executionId !== 'string' || !body.executionId.trim()) {
    return json({ error: 'MALFORMED_ARGUMENTS' }, 400, origin)
  }

  const result = await approveAndExecute(env, userId, body.executionId.trim(), new Date())
  return json(result.body, result.httpStatus, origin)
}
