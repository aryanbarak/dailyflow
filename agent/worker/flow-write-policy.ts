import type { Env, Language } from './types'
import { supabaseGet } from './context-builder'
import { callGeminiForTaskTitle } from './task-title-extraction'
import { ProviderUnavailableError } from './provider-errors'
import { findWriteIntentDescriptor, writeIntentRegistry, type WriteIntentType } from '../../shared/writeIntentRegistry'
import { parseFinanceDirection } from '../../shared/financeDirection'
import type { ParsedBankRow } from '../../shared/bankStatementParser'
import { resolveSchedulingDomain } from '../../shared/schedulingDomain'

export type FlowWriteMode = 'auto' | 'ask' | 'off'
export type FlowWriteAction = 'create' | 'update' | 'delete'

export interface ParsedTaskWriteIntent {
  kind: 'create_task' | 'update_task'
  title?: string
  taskReference?: string
  notes?: string
  dueDate?: string | null
  timeOfDay?: string
  dateClarificationNeeded?: boolean
  // Task 21-fix6: set only when `title` came from an explicit user
  // correction ("name the task X" / parseTitleCorrection below), never
  // from pattern-derived subject extraction. resolveCreateTaskTitle below
  // must never overwrite an explicit correction with a model guess.
  titleSource?: 'correction'
  // Chat V2 Slice 2A: an already-resolved task id, from a caller that
  // already knows exactly which row it means (agent-tool-execution.ts's
  // approval-driven update path) -- distinct from taskReference's
  // fuzzy-match-by-title resolution, which exists for the OLDER, still-live
  // server-side NL flow (a chat message naming a task by description, never
  // an id). When present, executeAutoTaskWrite's update branch below uses
  // this directly and does not consult taskReference at all.
  targetId?: string
}

// Task 22: PO decision -- tasks have no time-of-day column, so any write
// request carrying a specific time is routed here instead (see
// detectWriteDomainSignal below). Mirrors ParsedTaskWriteIntent's shape
// deliberately (title/notes/titleSource/dateClarificationNeeded fields are
// identical in spirit) so the shared primitives (title validation, date
// parsing) apply unchanged -- startDate/startTime/endTime replace
// dueDate/timeOfDay because a calendar event structurally needs a time
// range, not just a day.
export interface ParsedCalendarWriteIntent {
  kind: 'create_calendar_event' | 'update_calendar_event'
  title?: string
  eventReference?: string
  notes?: string
  startDate?: string | null
  startTime?: string
  endTime?: string
  dateClarificationNeeded?: boolean
  titleSource?: 'correction'
  // Chat V2 Slice 2A: same purpose as ParsedTaskWriteIntent.targetId above
  // -- an already-resolved event id, used directly instead of
  // eventReference's fuzzy-match-by-title resolution.
  targetId?: string
}

export interface RecentChatTurn {
  role: string
  content: string
  // Task 22-fix (C1 off-by-one): when the message this turn holds contains
  // its OWN relative date term ("فردا"/"tomorrow"), that term must resolve
  // against the instant the turn was actually sent, not the current
  // request's `now` -- otherwise re-scanning history from a LATER
  // continuation (e.g. an affirmative "yes" sent after local midnight has
  // passed) silently shifts "tomorrow" forward a day relative to what the
  // user meant when they typed it. Optional so existing tests/callers that
  // don't have it keep working (falls back to `now`, today's -- imperfect
  // but no-worse-than-before -- behaviour).
  createdAt?: string
}

interface TaskRow {
  id: string
  user_id: string
  title: string
  notes: string | null
  due_date: string | null
  completed: boolean
  completed_at?: string | null
  created_at: string
  updated_at: string
}

interface AlarmRow {
  id: string
  source_id: string
  trigger_at: string
}

// Task 22 -- mirrors calendarService.ts's own DB row shape exactly (see
// src/features/calendar/calendarService.ts's DbRow) so a Worker-written
// row round-trips through the same frontend read path unchanged: `date`/
// `start_time`/`end_time` are plain text, not timestamps, and hold the
// UTC-instant digits of a genuine timezone-resolved instant (see
// zonedDateTimeToUtcIso below) -- never a naive local wall-clock string.
interface CalendarEventRow {
  id: string
  user_id: string
  title: string
  date: string
  start_time: string | null
  end_time: string | null
  location: string | null
  description: string | null
  color: string | null
  type: string | null
  all_day: boolean
  created_at: string
  updated_at: string
}

// Task 28 -- mirrors financeService.ts's own insert row shape (frontend).
// Create-only (no update_finance_transaction intent exists), so this row
// type only ever needs to support the create branch's undo (a plain
// DELETE), the same shape create_task/create_calendar_event already use.
interface FinanceTransactionRow {
  id: string
  user_id: string
  type: 'income' | 'expense'
  amount: number
  category: string
  date: string
  notes: string | null
  created_at: string
  updated_at: string
}

export type UndoEntry =
  | { kind: 'create_task'; userId: string; taskId: string; expiresAt: string }
  | { kind: 'update_task'; userId: string; taskId: string; previous: Pick<TaskRow, 'title' | 'notes' | 'due_date' | 'completed'>; expiresAt: string }
  | { kind: 'create_calendar_event'; userId: string; eventId: string; expiresAt: string }
  | { kind: 'update_calendar_event'; userId: string; eventId: string; previous: Pick<CalendarEventRow, 'title' | 'date' | 'start_time' | 'end_time' | 'description'>; expiresAt: string }
  | { kind: 'create_finance_transaction'; userId: string; transactionId: string; expiresAt: string }
  // Task 45c, ADR-0017: one undo record reverses an ENTIRE batch import --
  // transactionIds holds every row the batch inserted, not a single id.
  // Unlike every other kind above (whose single id fits the reused
  // `task_id` column directly, see undoRecordId below), the full list lives
  // in `payload` (the same JSONB column update_task/update_calendar_event
  // already use for their `previous` snapshot) since a text column cannot
  // hold an array.
  | { kind: 'import_bank_statement'; userId: string; transactionIds: string[]; expiresAt: string }

// Task 22-fix2 (D1 structural lesson), now task 23 registry-driven: the
// single, authoritative runtime list of undo-persisting kinds -- every
// ADR-0012 write intent that calls persistUndoRecord below MUST be added
// to the shared writeIntentRegistry (its `undoKind` field) AND to the
// flow_write_undo_records_kind_check constraint in a migration (see
// supabase/migrations/20260815000000_widen_flow_write_undo_kinds.sql's own
// header comment for the same reminder from the migration's side). Deriving
// this from the registry (rather than a hand-maintained literal array, as
// before task 23) means a new registry entry's undo kind is automatically
// picked up here with no separate edit. The type-level line right below
// this constant still fails to COMPILE if UndoEntry ever gains/loses a kind
// the registry doesn't also declare; a runtime test in
// flow-write-policy.test.ts separately cross-checks this exact array
// against the values actually allowed by the migration file's CHECK
// constraint, so a mismatch between CODE and the DATABASE is caught at
// test time -- not as a production 23514 (task 22-fix2's own root cause).
export const UNDO_KIND_VALUES: readonly WriteIntentType[] = writeIntentRegistry.map((entry) => entry.undoKind)
// Compile-time bidirectional equality check: `_typesMatch` can only be typed
// `true` if UndoEntry['kind'] and the UNDO_KIND_VALUES union are IDENTICAL
// sets -- if a future kind is added to one but not the other, `IsExactly<...>`
// resolves to `false` and this assignment fails to compile (`Type 'true' is
// not assignable to type 'false'`), catching the drift at build time.
type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _typesMatch: IsExactly<UndoEntry['kind'], typeof UNDO_KIND_VALUES[number]> = true

export const FLOW_WRITE_UNDO_WINDOW_MS = 10 * 60 * 1000

// Chat V2 Slice 2A: exported (unchanged otherwise) so
// agent/worker/agent-tool-execution.ts can reuse the exact same
// service-role REST helpers this file already uses for every other write,
// rather than defining a second copy.
export function esc(value: string) {
  return encodeURIComponent(value)
}

// Task 45c: body widened to also accept an array -- a single PostgREST POST
// with a JSON array body inserts every element in ONE Postgres statement
// (atomic by construction, no manual transaction wrapping needed), which is
// exactly what executeBatchFinanceImport below relies on for its
// all-or-nothing insert. Every existing call site still passes a single
// object and is unaffected.
export async function supabaseWriteReturning<T>(env: Env, method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: Record<string, unknown> | Record<string, unknown>[]): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Accept': 'application/json',
      'Prefer': 'return=representation',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`Supabase write failed (${method} ${path}): ${await res.text()}`)
  return res.json()
}

export async function supabaseWriteNoContent(env: Env, method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: Record<string, unknown> | Record<string, unknown>[]): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Accept': 'application/json',
      'Prefer': 'return=minimal',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`Supabase write failed (${method} ${path}): ${await res.text()}`)
}

function undoUuid(undoId: string) {
  return undoId.startsWith('undo:') ? undoId.slice('undo:'.length) : undoId
}

function undoExpiresAt(now: Date) {
  return new Date(now.getTime() + FLOW_WRITE_UNDO_WINDOW_MS).toISOString()
}

// Task 22: `task_id` is reused as-is for a calendar event's id -- verified
// against the migration (supabase/migrations/20260813010000_flow_write_
// permissions.sql) that this column carries no foreign-key constraint to
// `tasks`, only `not null`, so it is safely a generic "the row this undo
// entry is about" id slot regardless of kind. Not renamed, to avoid an
// unnecessary migration + touching every existing call site.
// Task 45c: task_id has no real single-id meaning for a batch -- the first
// inserted transaction id is used purely to satisfy the column's NOT NULL
// constraint (same "generic id slot" convention this function's own
// pre-existing comment already documents); the record's actual reversal
// data (the FULL id list) lives in `payload`, read back by consumeUndoRecord
// below, never from this column.
function undoRecordId(entry: UndoEntry): string {
  if (entry.kind === 'create_task' || entry.kind === 'update_task') return entry.taskId
  if (entry.kind === 'create_finance_transaction') return entry.transactionId
  if (entry.kind === 'import_bank_statement') return entry.transactionIds[0] ?? ''
  return entry.eventId
}

async function persistUndoRecord(env: Env, entry: UndoEntry, undoId: string) {
  const payload = entry.kind === 'update_task' || entry.kind === 'update_calendar_event'
    ? { previous: entry.previous }
    : entry.kind === 'import_bank_statement'
      ? { transactionIds: entry.transactionIds }
      : {}
  await supabaseWriteNoContent(env, 'POST', 'flow_write_undo_records', {
    id: undoUuid(undoId),
    user_id: entry.userId,
    kind: entry.kind,
    task_id: undoRecordId(entry),
    payload,
    expires_at: entry.expiresAt,
  })
}

// Chat V2 Slice 2A, section F: an optional, best-effort, additive
// correlation from a successful undo record back to the agent_tool_executions
// row that produced it. Never changes flow_write_undo_records' own undo
// semantics (kind/task_id/payload/expires_at/consumed_at all untouched) --
// this is purely a nullable pointer for a future tool-card UI to join
// through, not a new lifecycle field on this table. Best-effort: a failure
// here must never affect the write or the undo record itself, which have
// already succeeded by the time this runs -- mirrors this file's existing
// fail-safe posture for secondary writes (e.g. provider failure-event
// persistence).
export async function correlateUndoRecordWithExecution(env: Env, undoId: string, executionId: string): Promise<void> {
  try {
    await supabaseWriteNoContent(env, 'PATCH', `flow_write_undo_records?id=eq.${esc(undoUuid(undoId))}`, {
      execution_id: executionId,
    })
  } catch {
    // Best-effort only -- see this function's own comment.
  }
}

interface UndoRecordRow {
  id: string
  user_id: string
  kind: 'create_task' | 'update_task' | 'create_calendar_event' | 'update_calendar_event' | 'create_finance_transaction' | 'import_bank_statement'
  task_id: string
  payload: {
    previous?:
      | Pick<TaskRow, 'title' | 'notes' | 'due_date' | 'completed'>
      | Pick<CalendarEventRow, 'title' | 'date' | 'start_time' | 'end_time' | 'description'>
    transactionIds?: string[]
  } | null
  expires_at: string
  consumed_at: string | null
}

async function consumeUndoRecord(env: Env, userId: string, undoId: string, now: Date): Promise<UndoEntry | null> {
  const id = undoUuid(undoId)
  const rows = await supabaseGet<UndoRecordRow[]>(
    env,
    `flow_write_undo_records?id=eq.${esc(id)}&user_id=eq.${esc(userId)}&consumed_at=is.null&select=id,user_id,kind,task_id,payload,expires_at,consumed_at&limit=1`,
  ).catch(() => [])
  const row = rows[0]
  if (!row || row.expires_at < now.toISOString()) return null

  await supabaseWriteNoContent(env, 'PATCH', `flow_write_undo_records?id=eq.${esc(id)}&user_id=eq.${esc(userId)}&consumed_at=is.null`, {
    consumed_at: now.toISOString(),
  })

  if (row.kind === 'create_task') return { kind: 'create_task', userId, taskId: row.task_id, expiresAt: row.expires_at }
  if (row.kind === 'create_calendar_event') return { kind: 'create_calendar_event', userId, eventId: row.task_id, expiresAt: row.expires_at }
  if (row.kind === 'create_finance_transaction') return { kind: 'create_finance_transaction', userId, transactionId: row.task_id, expiresAt: row.expires_at }
  if (row.kind === 'import_bank_statement') {
    const transactionIds = row.payload?.transactionIds
    if (!transactionIds || transactionIds.length === 0) return null
    return { kind: 'import_bank_statement', userId, transactionIds, expiresAt: row.expires_at }
  }
  if (row.kind === 'update_task') {
    const previous = row.payload?.previous as Pick<TaskRow, 'title' | 'notes' | 'due_date' | 'completed'> | undefined
    if (!previous) return null
    return { kind: 'update_task', userId, taskId: row.task_id, previous, expiresAt: row.expires_at }
  }
  const previous = row.payload?.previous as Pick<CalendarEventRow, 'title' | 'date' | 'start_time' | 'end_time' | 'description'> | undefined
  if (!previous) return null
  return { kind: 'update_calendar_event', userId, eventId: row.task_id, previous, expiresAt: row.expires_at }
}

// INC-02 (GitHub #188) TEMPORARY CLAMP -- tasks/calendar
// create+update return 'ask' here, not 'auto'.
//
// WHY: a client-side timeout abandons the browser's wait but does not
// cancel the request (no AbortController anywhere on this path), so the
// Worker runs to completion and PERFORMS THE WRITE while the user is told
// the turn timed out. 'auto' is what makes that silent: no approval card
// means nothing for the user to notice not happening. Clamping to 'ask'
// does not fix the abandoned-write race -- it removes the unattended
// execution that makes the race invisible.
//
// WHY HERE and not a flow_write_permissions row: that table is EMPTY in
// production (zero rows, verified 2026-08-27), so this function governs
// 100% of real write behaviour. Clamping in code writes zero rows, is
// key-agnostic, and survives ADR-0019's re-key to (user_id, intent_type,
// mode) untouched -- whereas clamp rows written under the old key would
// hand that migration a data migration it does not currently need.
//
// EXIT CONDITION -- this clamp is retired when ENG-07 (GitHub #185) has
// landed BOTH halves: Part A's abort plumbing (the request is actually
// cancelled) and Part B's recovery surface (an abandoned write becomes
// discoverable). Prevention alone is not enough -- a write can complete
// microseconds before the disconnect is noticed, so some abandoned writes
// will always land and must be findable. When both ship, this returns to
// 'auto'.
//
// The branch below is kept rather than deleted, even though every path
// now returns 'ask', so retiring the clamp is one word rather than a
// reconstruction. Do not "simplify" it away.
//
// MUST STAY IDENTICAL to its twin (ADR-0019 Known Hazard 1). Changing one
// and not the other makes Settings display a policy the Worker does not
// enforce. Pinned by src/features/agent/flowWriteDefaultParity.test.ts.
//
// Twin: src/features/agent/flowWritePermissions.ts's
// defaultFlowWritePermissionMode.
export function defaultFlowWriteMode(domain: string, action: string): FlowWriteMode {
  if (action === 'delete') return 'ask'
  if (domain === 'finance') return 'ask'
  // INC-02 clamp: was 'auto'.
  if ((domain === 'tasks' || domain === 'calendar') && (action === 'create' || action === 'update')) return 'ask'
  return 'ask'
}

export async function resolveServerFlowWriteMode(env: Env, userId: string, domain: string, action: FlowWriteAction): Promise<FlowWriteMode> {
  let rows: Array<{ mode: string }>
  try {
    rows = await supabaseGet<Array<{ mode: string }>>(
      env,
      `flow_write_permissions?user_id=eq.${esc(userId)}&domain=eq.${esc(domain)}&action=eq.${esc(action)}&select=mode&limit=1`,
    )
  } catch {
    return 'ask'
  }
  const mode = rows[0]?.mode
  const resolved = mode === 'auto' || mode === 'ask' || mode === 'off' ? mode : defaultFlowWriteMode(domain, action)
  // Task 28: ADR-0012 lists "finance writes: ask" under DEFAULT policy --
  // by itself that only governs the no-row case (defaultFlowWriteMode
  // above), not a row a client explicitly wrote requesting 'auto'. Finance
  // never auto-executing is a stronger, non-negotiable guarantee for this
  // domain specifically (money, unlike a task's due date or a calendar
  // slot) -- this clamp is defense in depth beyond the browser layer, which
  // ADR-0012 already treats as preference input only, never execution
  // authority: even a maliciously or accidentally stored ('finance',
  // 'create', 'auto') row can never reach the auto-execute branch below.
  if (domain === 'finance' && resolved === 'auto') return 'ask'
  return resolved
}

function dateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value
      return acc
    }, {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

const WEEKDAY: Record<string, number> = {
  sunday: 0, sun: 0, sonntag: 0,
  monday: 1, mon: 1, montag: 1,
  tuesday: 2, tue: 2, dienstag: 2,
  wednesday: 3, wed: 3, mittwoch: 3,
  thursday: 4, thu: 4, donnerstag: 4,
  friday: 5, fri: 5, freitag: 5,
  saturday: 6, sat: 6, samstag: 6,
}

const PERSIAN_WEEKDAY: Array<[RegExp, number]> = [
  [/\u06cc\u06a9\u0634\u0646\u0628\u0647/, 0],
  [/\u062f\u0648\u0634\u0646\u0628\u0647/, 1],
  [/\u0633\u0647[\u200c\s-]?\u0634\u0646\u0628\u0647/, 2],
  [/\u0686\u0647\u0627\u0631\u0634\u0646\u0628\u0647/, 3],
  [/\u067e\u0646\u062c\u0634\u0646\u0628\u0647/, 4],
  [/\u062c\u0645\u0639\u0647/, 5],
  [/\u0634\u0646\u0628\u0647/, 6],
]

function normalizeDigits(value: string) {
  return value
    .replace(/[\u06F0-\u06F9]/g, ch => String(ch.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, ch => String(ch.charCodeAt(0) - 0x0660))
}

function boundText(value: string, max: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized
}

// Task 22: exported -- reused directly for calendar event start/end
// resolution (executeAutoCalendarWrite below), not just task alarms.
export function zonedDateTimeToUtcIso(dateKeyValue: string, timeOfDay: string, timeZone: string) {
  const [year, month, day] = dateKeyValue.split('-').map(Number)
  const [hour, minute] = timeOfDay.split(':').map(Number)
  const desiredUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0)
  const guess = new Date(desiredUtcMs)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(guess).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})
  const actualAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second ?? '0'),
  )
  return new Date(desiredUtcMs - (actualAsUtcMs - desiredUtcMs)).toISOString()
}

// Task 22-fix3: the exact inverse of zonedDateTimeToUtcIso -- given a genuine
// UTC instant (what calendar_events.date/start_time actually store, sliced
// from a real UTC ISO instant, same convention as calendarService.ts's
// toInsertRow on the frontend) and the SAME timeZone the deterministic
// parser resolved the request with, returns the wall-clock date/time a user
// in that zone would actually see. Confirmation-line builders must call this
// before displaying a persisted event's date/start_time -- reading those
// columns raw (as executeAutoCalendarWrite did before this fix) silently
// displays UTC, not local time.
export function utcInstantToZonedDateAndTime(utcIso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcIso)).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export function parseDeterministicTimeOfDay(message: string): string | undefined {
  const text = normalizeDigits(message.toLowerCase())
  const persian = text.match(/\u0633\u0627\u0639\u062a\s+([01]?[0-9]|2[0-3])(?::([0-5][0-9]))?\s*(\u0635\u0628\u062d|\u0639\u0635\u0631|\u0628\u0639\u062f\s+\u0627\u0632\s+\u0638\u0647\u0631|\u0634\u0628)?/)
  const latin = text.match(/\b(?:at|um)\s+([01]?[0-9]|2[0-3])(?::([0-5][0-9]))?\s*(am|pm|uhr)?\b/)
  const compact = text.match(/\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/)
  const match = persian ?? latin ?? compact
  if (!match) return undefined
  let hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  const suffix = match[3]
  if ((suffix === 'pm' || suffix === '\u0639\u0635\u0631' || suffix === '\u0628\u0639\u062f \u0627\u0632 \u0638\u0647\u0631' || suffix === '\u0634\u0628') && hour < 12) hour += 12
  if ((suffix === 'am' || suffix === '\u0635\u0628\u062d') && hour === 12) hour = 0
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

const RANGE_CONNECTOR = /\bto\b|\buntil\b|\btill\b|\bbis\b|\u062a\u0627/i

/**
 * Task 22: a calendar event's end time, kept intentionally thin -- reuses
 * parseDeterministicTimeOfDay (unchanged) TWICE rather than inventing a
 * new range grammar. Finds a start time, then looks for a connector word
 * ("to"/"until"/"bis"/"\u062a\u0627") and re-parses the text after it as a second
 * time -- first as-is (covers "13:00 to 15:00" and "...bis 15 Uhr", which
 * already satisfy parseDeterministicTimeOfDay's own patterns), then with
 * an injected "at " cue (covers a bare hour like "...to 3pm"). No range
 * found -- or a genuinely unparseable one -- degrades to a single start
 * time; executeAutoCalendarWrite defaults the missing end to +1 hour.
 * Exported for direct unit testing.
 */
export function parseDeterministicTimeRange(message: string): { start?: string; end?: string } {
  const start = parseDeterministicTimeOfDay(message)
  if (!start) return {}
  const connectorIndex = message.search(RANGE_CONNECTOR)
  if (connectorIndex === -1) return { start }
  const tail = message.slice(connectorIndex).replace(RANGE_CONNECTOR, ' ')
  const end = parseDeterministicTimeOfDay(tail) ?? parseDeterministicTimeOfDay(`at ${tail}`)
  return end && end !== start ? { start, end } : { start }
}

function removeDateAndTimePhrases(value: string) {
  return normalizeDigits(value)
    .replace(/\b(?:for|due|on|at)\b\s*(?:today|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|[0-9]{4}[-/.][0-9]{1,2}[-/.][0-9]{1,2})?/gi, ' ')
    .replace(/\b(?:at|um)\s+[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm|uhr)?\b/gi, ' ')
    .replace(/\b[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm|uhr)\b/gi, ' ')
    .replace(/\b(?:heute|morgen|Ã¼bermorgen|uebermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|um)\b\s*(?:[0-9]{1,2}(?::[0-9]{2})?\s*(?:uhr)?)?/gi, ' ')
    .replace(/\b(?:in\s+[0-9]{1,2}\s+days?|in\s+[0-9]{1,2}\s+tagen?)\b/gi, ' ')
    .replace(/\u0628\u0631\u0627\u06cc\s+(?:\u0627\u0645\u0631\u0648\u0632|\u0641\u0631\u062f\u0627|\u067e\u0633(?:\u200c|\s)?\u0641\u0631\u062f\u0627|\u062c\u0645\u0639\u0647|\u0634\u0646\u0628\u0647|\u06cc\u06a9\u0634\u0646\u0628\u0647|\u062f\u0648\u0634\u0646\u0628\u0647|\u0633\u0647[\u200c\s-]?\u0634\u0646\u0628\u0647|\u0686\u0647\u0627\u0631\u0634\u0646\u0628\u0647|\u067e\u0646\u062c\u0634\u0646\u0628\u0647|[0-9]{4}[-/.][0-9]{1,2}[-/.][0-9]{1,2})/g, ' ')
    .replace(/\u0627\u0644\u0628\u062a\u0647\s+\u0633\u0627\u0639\u062a\s+[0-9]{1,2}(?::[0-9]{2})?\s*(?:\u0635\u0628\u062d|\u0639\u0635\u0631|\u0628\u0639\u062f\s+\u0627\u0632\s+\u0638\u0647\u0631|\u0634\u0628)?/g, ' ')
    .replace(/\u0633\u0627\u0639\u062a\s+[0-9]{1,2}(?::[0-9]{2})?\s*(?:\u0635\u0628\u062d|\u0639\u0635\u0631|\u0628\u0639\u062f\s+\u0627\u0632\s+\u0638\u0647\u0631|\u0634\u0628)?/g, ' ')
}

// Task 21-fix6: LAST-RESORT FALLBACK ONLY. Title extraction is now the
// model's job (see task-title-extraction.ts + resolveCreateTaskTitle
// below) -- this pattern-matching function only runs when the model call
// fails or its title is rejected by validateCandidateTitle. Every one of
// these patterns exists because an earlier task added it for one leaked
// phrasing and the next production message broke it again (colon-prefix,
// Persian "که...دارم", English "because I have", German "dass ich...
// habe"). DO NOT add another pattern here for a new phrasing -- fix the
// model prompt (buildTaskTitleSystemInstruction) or the validation rules
// instead. This function is kept only as a safety net for when there is
// no model available at all.
function extractTaskTitle(message: string) {
  const normalized = normalizeDigits(message)
  const quoted = message.match(/["'Â«â€œ](.+?)["'Â»â€]/)?.[1]?.trim()
  if (quoted) return boundText(quoted, 80)

  const prefixTitle = normalized.match(/^\s*([^:：\n]{3,80})\s*[:：]\s*(?=.{0,80}(?:\b(?:create|add|set up|task|todo)\b|\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646))/i)
  if (prefixTitle?.[1]) return boundText(removeDateAndTimePhrases(prefixTitle[1]), 80)

  const persianSubject = normalized.match(/\u06a9\u0647\s+(.+?)\s+(?:\u062f\u0627\u0631\u0645|\u062f\u0627\u0631\u06cc|\u062f\u0627\u0631\u062f|\u0628\u0627\u0634\u0647)(?:[.ØŒ,]|$)/)
  if (persianSubject?.[1]) return boundText(removeDateAndTimePhrases(persianSubject[1]), 80)

  const englishSubject = normalized.match(/\b(?:that|because)\s+i\s+(?:have|need to|need)\s+(.+?)(?:[.,]|$)/i)
  if (englishSubject?.[1]) return boundText(removeDateAndTimePhrases(englishSubject[1]), 80)

  const germanSubject = normalized.match(/\b(?:dass|weil)\s+ich\s+(.+?)\s+(?:habe|machen muss|muss)(?:[.,]|$)/i)
  if (germanSubject?.[1]) return boundText(removeDateAndTimePhrases(germanSubject[1]), 80)

  const fallback = removeDateAndTimePhrases(
    normalized
      .replace(/\b(create|add|set up|task|todo|erstelle|aufgabe|hinzuf[Ã¼u]gen)\b/gi, ' ')
      .replace(/(?:\u06cc\u06a9|\u06a9|ÛŒÙ‡)?\s*(?:\u062a\u0633\u06a9|\u0648\u0638\u06cc\u0641\u0647|\u06a9\u0627\u0631).{0,12}?(?:\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646)/g, ' ')
      .replace(/\b(?:\u06cc\u06a9|\u06a9)\b|\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646|[،,.]/g, ' '),
  )
  const cleanFallback = fallback.replace(/\s+/g, ' ').trim()
  return cleanFallback.length >= 3 ? boundText(cleanFallback, 80) : undefined
}

function createTaskNotes(message: string, timeOfDay?: string) {
  const lines = [`Original request: ${message}`]
  if (timeOfDay) lines.push(`Time mentioned: ${timeOfDay}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Task 21-fix6 -- title validation. The model proposes a title (or the
// pattern fallback above does, as a last resort); this is the
// deterministic gate that decides whether to trust it, mirroring how
// parseDeterministicDueDate/parseDeterministicTimeOfDay already decide
// dates and times deterministically rather than trusting free text
// verbatim. Never derives a title itself -- only cleans, bounds, and
// rejects.
// ---------------------------------------------------------------------------

const MAX_MODEL_TITLE_LENGTH = 60

// TITLE-01 Defect A: a Persian/English framing preposition that introduces
// a title's real subject rather than being part of it -- "به نام X" plays
// the exact same syntactic role as English "called X"/"named X". Left in a
// candidate, it collides with the real subject the same way a leftover
// "task:" prefix would (see extractTaskTitle's own colon-prefix handling
// above) -- e.g. a request "create a task named X" leaking as "named X"
// rather than "X". Applied inside cleanTitleEdges, the ONE gate both the
// pattern-fallback candidate (extractTaskTitle's own output, via
// resolveCreateTitle's patternFallback) and the model's own candidate
// (validateCandidateTitle runs on modelTitle too, before resolveCreateTitle
// ever falls back to the pattern) pass through -- one fix covers both
// paths, per the task's own defense-in-depth instruction, instead of two
// implementations that could drift apart. Bounded prefix list (task
// instruction: no full NLP, not general title-framing detection) -- extend
// only for a new, confirmed production leak of the same class, same
// discipline as extractTaskTitle's own DO-NOT-add-a-pattern comment.
// Accepted, disclosed tradeoff: a genuine title that happens to START with
// one of these words as real subject content (e.g. "Named entity
// recognition project") would also be stripped -- same class of narrow
// risk this file already accepts for its other bounded lists.
const TITLE_FRAMING_PREFIX = /^(?:به\s*نام|به\s*اسم|با\s*نام|با\s*عنوان|تحت\s*عنوان|called|named|titled|with\s+the\s+name)\s+/i

/**
 * Strips stray leading/trailing punctuation and digit fragments -- e.g. a
 * leftover "؟۰۰" or ": " artifact at the edge of an otherwise-good title --
 * and a leading title-framing preposition (TITLE-01 Defect A; see
 * TITLE_FRAMING_PREFIX above). Exported for direct unit testing.
 */
export function cleanTitleEdges(value: string): string {
  const edgeCleaned = normalizeDigits(value)
    .trim()
    .replace(/^[\s:：\-–—.,،؟?]+/, '')
    .replace(/[\s:：\-–—.,،؟?]+[0-9]*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return edgeCleaned.replace(TITLE_FRAMING_PREFIX, '').trim()
}

/**
 * True when `title` is substantially a restatement of `rawMessage` rather
 * than a short subject line -- e.g. the model (or a pattern match) handed
 * back the whole sentence. Word-set based: nearly every word in the title
 * must come from the raw message (matchRatio) AND the title must cover a
 * large share of the raw message's own word count (coverageRatio) -- a
 * short genuine subject ("ترمین داکتر فامیلی") is built entirely from
 * words in the raw message too, but covers only a small fraction of it.
 * Exported for direct unit testing.
 */
export function isTitleSubstantiallyTheMessage(title: string, rawMessage: string): boolean {
  const words = (value: string) => normalizeDigits(value.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const titleWords = words(title)
  const rawWords = words(rawMessage)
  if (titleWords.length === 0 || rawWords.length === 0) return false
  const rawWordSet = new Set(rawWords)
  const matched = titleWords.filter(word => rawWordSet.has(word)).length
  const matchRatio = matched / titleWords.length
  const coverageRatio = titleWords.length / rawWords.length
  return matchRatio >= 0.9 && coverageRatio >= 0.6
}

// TITLE-01 Defect B: a candidate that is itself a response-language
// steering instruction -- not real task content -- must never reach the
// database as a task title. Diagnosis: this class of garbage leaks in when
// an internal-use instruction preamble
// (src/features/ai/responseLanguage.ts's getAiResponseLanguageInstruction;
// the leading clauses are duplicated here in BOUNDED form only -- the
// Worker cannot import frontend modules, the same constraint documented
// elsewhere in this codebase, e.g. personal-memory-prompt-serialization.ts)
// gets concatenated ahead of a user's real message -- TasksPage.tsx's
// "ask about my tasks" widget (buildTaskAssistantRequestBody) is the
// confirmed call site: it is the one place in the frontend that folds this
// instruction INTO the `message` field via withAiResponseLanguageInstruction,
// rather than sending it as its own separate responseLanguageInstruction
// body field the way every other call site does (AgentBriefingCard,
// WeeklyBriefingPage, HabitsPage, FinancePage, CalendarPage, ChatPage,
// reasoningPrompt.ts). That combined message reaches this same deterministic
// auto-write pipeline (POST /chat, mode defaults to 'chat' when unset --
// index.ts:1026), and detectWriteDomainSignal/parseTaskWriteIntent
// legitimately matched a create-task trigger somewhere in the REAL
// question portion of that combined string (confirmed: the visible
// instruction text alone matches none of this file's create/update
// triggers). The bug is specifically in TITLE EXTRACTION: extractTaskTitle's
// fallback + boundText's 80-char, START-anchored truncation consumes the
// whole title budget on the leading instruction/context boilerplate before
// ever reaching the real subject -- reproducibly landing mid-sentence
// around "...and technical" for the fa instruction text, matching the
// exact production title. Fixing the trigger regex itself would not help
// (the match is on real content, not the visible instruction text) --
// this is a title-quality problem, so it belongs at this gate, same as
// every other rejection reason below. Bounded leading-phrase list, same
// principle and same accepted tradeoff as TITLE_FRAMING_PREFIX above --
// not general instruction detection. (A structural fix at the true root --
// TasksPage.tsx should send responseLanguageInstruction as its own field
// like every other call site, not fold it into `message` -- is out of this
// ticket's deterministic-layer scope; flagged in PROJECT_STATUS.md as a
// recommended follow-up, not silently left unfixed.)
const INSTRUCTION_LEADING_PATTERN = /^(?:به\s*زبان\s+\S+\s+پاسخ\s*بده|پاسخ\s*بده|respond\s+in\s+|reply\s+in\s+|antworte\s+auf\s+)/i

/**
 * True when `title` opens with a known response-language-instruction
 * leading phrase rather than real task content (TITLE-01 Defect B; see
 * INSTRUCTION_LEADING_PATTERN above). Exported for direct unit testing.
 */
export function looksLikeInstructionFragment(title: string): boolean {
  return INSTRUCTION_LEADING_PATTERN.test(title)
}

/**
 * The single gate every candidate title -- model-proposed or pattern-
 * fallback -- must pass before it can reach the database. Rejects (returns
 * undefined) when the candidate is empty, too long for a subject line,
 * substantially the whole user message, or itself a response-language
 * instruction fragment; never truncates or rewrites a candidate into
 * something the model/pattern never actually said. Exported for direct
 * unit testing.
 */
export function validateCandidateTitle(candidate: string | undefined, rawMessage: string, maxLength = MAX_MODEL_TITLE_LENGTH): string | undefined {
  if (!candidate) return undefined
  const cleaned = cleanTitleEdges(candidate)
  if (!cleaned) return undefined
  if (cleaned.length > maxLength) return undefined
  if (isTitleSubstantiallyTheMessage(cleaned, rawMessage)) return undefined
  if (looksLikeInstructionFragment(cleaned)) return undefined
  return cleaned
}

/**
 * Pulls the running "Original request: ..." text back out of
 * createTaskNotes' own output (see above) so a multi-turn continuation
 * ("yes, create it") still gives the model the actual subject-bearing
 * message rather than the confirmation itself. Falls back to the raw
 * current message when notes carries nothing usable.
 */
export function extractOriginalRequestText(notes: string | undefined, fallbackMessage: string): string {
  if (!notes) return fallbackMessage
  const match = notes.match(/^Original request: ([\s\S]*?)(?:\nTime mentioned:|$)/)
  const text = match?.[1]?.trim()
  return text || fallbackMessage
}

/**
 * Task 22: generalized out of resolveCreateTaskTitle -- asks the model for
 * a short subject line, validates it, and falls back to the deterministic
 * pattern extractor's own (also-validated) result only if the model call
 * fails or its title is rejected. Takes only the minimal {title?, notes?}
 * shape both ParsedTaskWriteIntent and ParsedCalendarWriteIntent satisfy,
 * so one implementation serves both domains -- genuine reuse, not a
 * parallel copy. Never called for an explicit user title correction
 * (titleSource === 'correction') -- that title is exact user intent, not
 * something to re-derive.
 */
export async function resolveCreateTitle(
  env: Env,
  intent: { title?: string; notes?: string },
  rawMessage: string,
  callModel: (requestText: string, env: Env) => Promise<string> = callGeminiForTaskTitle,
): Promise<string | undefined> {
  const requestText = extractOriginalRequestText(intent.notes, rawMessage)
  // 80, not the model's 60: extractTaskTitle already bounds (and
  // gracefully "..."-truncates) its own output to 80 chars -- this is
  // still a safety net (empty/overlap check), not a re-truncation.
  const patternFallback = validateCandidateTitle(intent.title, requestText, 80)
  try {
    const modelTitle = await callModel(requestText, env)
    const validated = validateCandidateTitle(modelTitle, requestText)
    if (validated) return validated
  } catch (err) {
    console.error('[Title] model title extraction failed, falling back to pattern extraction:', (err as Error).message)
    // INC-01: a provider failure (429/5xx/network) with NO pattern-
    // extractable fallback either must never silently collapse into an
    // ordinary "no title found" outcome -- that is exactly what made a
    // Gemini outage indistinguishable from a genuine ask_clarification
    // upstream (executeAutoTaskWrite's own `!intent.title` branch), so the
    // assistant appeared to be asking a question when it never got a
    // chance to answer at all. Only escalate when BOTH conditions hold: if
    // pattern extraction found something, degrade silently as before (the
    // write still succeeds without the model's help) -- and if the model
    // call failed for a non-provider reason (malformed JSON, missing
    // field, a non-STOP finish -- the model DID answer, just unusably),
    // this stays ordinary fallback behavior too.
    if (err instanceof ProviderUnavailableError && !patternFallback) {
      throw err
    }
  }
  return patternFallback
}

/** Task 21-fix6 name/signature kept for existing call sites -- thin wrapper over resolveCreateTitle. */
export async function resolveCreateTaskTitle(
  env: Env,
  intent: ParsedTaskWriteIntent,
  rawMessage: string,
  callModel: (requestText: string, env: Env) => Promise<string> = callGeminiForTaskTitle,
): Promise<string | undefined> {
  return resolveCreateTitle(env, intent, rawMessage, callModel)
}

/** Task 22: calendar-event sibling of resolveCreateTaskTitle -- same validator, same model call. */
export async function resolveCreateEventTitle(
  env: Env,
  intent: ParsedCalendarWriteIntent,
  rawMessage: string,
  callModel: (requestText: string, env: Env) => Promise<string> = callGeminiForTaskTitle,
): Promise<string | undefined> {
  return resolveCreateTitle(env, intent, rawMessage, callModel)
}

async function createTaskAlarmIfNeeded(env: Env, userId: string, task: TaskRow, timeOfDay: string | undefined, timeZone: string) {
  if (!task.due_date || !timeOfDay) return undefined
  const triggerAt = zonedDateTimeToUtcIso(task.due_date, timeOfDay, timeZone)
  const rows = await supabaseWriteReturning<AlarmRow[]>(env, 'POST', 'alarms?select=id,source_id,trigger_at', {
    user_id: userId,
    source_type: 'task',
    source_id: task.id,
    source_title: task.title,
    trigger_at: triggerAt,
    remind_before_minutes: 0,
    is_fired: false,
    is_dismissed: false,
  })
  return rows[0]
}

export function parseDeterministicDueDate(message: string, now: Date, timeZone: string): { value?: string | null; clarificationNeeded: boolean } {
  const text = normalizeDigits(message.toLowerCase())
  if (/\b(no due date|without due date|kein(?:e[nr]?)? termin)\b|\u0628\u062f\u0648\u0646\s+(?:\u0645\u0648\u0639\u062f|\u062a\u0627\u0631\u06cc\u062e)/i.test(text)) return { value: null, clarificationNeeded: false }
  if (text.includes('day after tomorrow') || text.includes('Ã¼bermorgen') || text.includes('übermorgen') || text.includes('uebermorgen') || /\u067e\u0633(?:\u200c|\s)?\u0641\u0631\u062f\u0627/.test(text)) {
    return { value: dateKey(addDays(now, 2), timeZone), clarificationNeeded: false }
  }
  if (/\b(today|heute)\b|\u0627\u0645\u0631\u0648\u0632/.test(text)) return { value: dateKey(now, timeZone), clarificationNeeded: false }
  if (/\b(tomorrow|morgen)\b|\u0641\u0631\u062f\u0627/.test(text)) return { value: dateKey(addDays(now, 1), timeZone), clarificationNeeded: false }
  const cleanInDays = text.match(/\bin\s+([1-9][0-9]?)\s+days?\b|\bin\s+([1-9][0-9]?)\s+tagen?\b|(?:\u062a\u0627|\u062f\u0631)\s+([0-9]{1,2})\s+\u0631\u0648\u0632/)
  if (cleanInDays) {
    const raw = cleanInDays[1] ?? cleanInDays[2] ?? cleanInDays[3]
    return { value: dateKey(addDays(now, Number(raw)), timeZone), clarificationNeeded: false }
  }
  if (/\b(no due date|without due date|kein(?:e[nr]?)? termin|Ø¨Ø¯ÙˆÙ† (?:Ù…ÙˆØ¹Ø¯|ØªØ§Ø±ÛŒØ®))\b/i.test(message)) return { value: null, clarificationNeeded: false }
  if (text.includes('day after tomorrow') || text.includes('Ã¼bermorgen') || text.includes('übermorgen') || text.includes('uebermorgen') || /Ù¾Ø³(?:â€Œ|\s)?ÙØ±Ø¯Ø§/.test(text)) {
    return { value: dateKey(addDays(now, 2), timeZone), clarificationNeeded: false }
  }
  if (/\b(today|heute)\b|Ø§Ù…Ø±ÙˆØ²/.test(text)) return { value: dateKey(now, timeZone), clarificationNeeded: false }
  if (/\b(tomorrow|morgen)\b|ÙØ±Ø¯Ø§/.test(text)) return { value: dateKey(addDays(now, 1), timeZone), clarificationNeeded: false }

  const inDays = text.match(/\bin\s+([1-9][0-9]?)\s+days?\b|\bin\s+([1-9][0-9]?)\s+tagen?\b|(?:ØªØ§|Ø¯Ø±)\s+([Û°-Û¹0-9]{1,2})\s+Ø±ÙˆØ²/)
  if (inDays) {
    const raw = inDays[1] ?? inDays[2] ?? inDays[3]
    const normalized = raw.replace(/[Û°-Û¹]/g, ch => String('Û°Û±Û²Û³Û´ÛµÛ¶Û·Û¸Û¹'.indexOf(ch)))
    return { value: dateKey(addDays(now, Number(normalized)), timeZone), clarificationNeeded: false }
  }

  const iso = text.match(/\b(20[0-9]{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12][0-9]|3[01])\b/)
  if (iso) return { value: `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`, clarificationNeeded: false }

  const weekdayKey = Object.keys(WEEKDAY).find(key => new RegExp(`\\b${key}\\b`, 'i').test(text))
  const persianWeekday = PERSIAN_WEEKDAY.find(([pattern]) => pattern.test(text))
  const target = weekdayKey ? WEEKDAY[weekdayKey] : persianWeekday?.[1]
  if (target !== undefined) {
    const utcDay = now.getUTCDay()
    const delta = ((target - utcDay + 7) % 7) || 7
    return { value: dateKey(addDays(now, delta), timeZone), clarificationNeeded: false }
  }

  if (/\b(due|deadline|fÃ¤llig)\b|\u0645\u0648\u0639\u062f|\u062a\u0627\u0631\u06cc\u062e/i.test(text)) return { clarificationNeeded: true }
  if (/\b(due|deadline|fÃ¤llig|Ù…ÙˆØ¹Ø¯|ØªØ§Ø±ÛŒØ®)\b/i.test(message)) return { clarificationNeeded: true }
  return { clarificationNeeded: false }
}

// ---------------------------------------------------------------------------
// Task 22 -- task vs. calendar routing. The product rule (PO decision):
// a request naming a calendar concept (event/appointment/meeting) is
// calendar business regardless of whether a time was given; a request
// naming only a task, if it ALSO carries a resolved time-of-day, is
// still routed to calendar because tasks have no time-of-day column to
// hold it in -- that is "today's behaviour" (a date with no time stays a
// task) plus the one PO-mandated exception (a time forces calendar). Both
// noun classes matching in the same message is treated as genuinely
// ambiguous (e.g. "task for the meeting") and asks once rather than
// guessing; see index.ts for the one-question, no-loop handling.
// ---------------------------------------------------------------------------

function isCalendarWriteTrigger(message: string): boolean {
  const createCal = /\b(create|add|set up|schedule|erstelle|hinzuf[üu]gen)\b.{0,50}\b(event|appointment|meeting|termin|kalender)\b/i.test(message) ||
    /(?:یک|ک|یه)?\s*(?:رویداد|جلسه|قرار|ملاقات).{0,50}(?:بساز|ایجاد کن|اضافه کن)/i.test(message)
  const updateCal = /\b(update|edit|change|reschedule|move|aktualisiere|bearbeite|verschiebe)\b.{0,60}\b(event|appointment|meeting|termin|kalender)\b/i.test(message) ||
    /(?:رویداد|جلسه|قرار|ملاقات).{0,60}(?:به‌روزرسانی کن|ویرایش کن|جابجا کن|تغییر بده)/i.test(message)
  return createCal || updateCal
}

// Slice 2B.1 -- LOCKED DOMAIN RULE: explicit domain noun wins before
// temporal inference. A standalone, freshly-written predicate (not
// extracted from parseTaskWriteIntent's own create/cleanPersianCreate/
// cleanMixedPersianCreate/update variables above, to avoid any risk of
// touching that function's existing regex literals) matching the exact
// same semantic trigger: an explicit "task"/"todo"/"aufgabe"/"تسک"/
// "وظیفه"/"کار" noun paired with a create/update verb. Used by
// resolvesToCalendarDomain/detectWriteDomainSignal below to tell "the
// user actually named a task" apart from "no task noun at all, but this
// reads like a bare personal schedule statement" (isImplicitScheduleStatement)
// -- only the former must ASK instead of silently reclassifying into
// calendar when a time is present; the latter (no noun to contradict) is
// unaffected, unchanged product behavior. Mirrors
// src/features/agent/reasoning/intentValidator.ts's own
// requestLooksLikeTaskCreate/requestLooksLikeTaskUpdate (independent,
// hand-written copies on each side, same convention as every other
// domain-detection regex pair in this codebase).
function isExplicitTaskWriteTrigger(message: string): boolean {
  const create = /\b(create|add|set up|erstelle|hinzuf[üu]gen)\b.{0,50}\b(task|todo|aufgabe)\b/i.test(message) ||
    /(?:یک|ک|یه)?\s*(?:تسک|وظیفه|کار).{0,50}(?:بساز|ایجاد کن|اضافه کن)/i.test(message) ||
    /(?:یک|ک|یه)?\s*(?:task|todo).{0,50}(?:بساز|ایجاد کن|اضافه کن)/i.test(message)
  // Blocker 2/parity correction (#202): the FA alternative was missing
  // entirely for UPDATE (only CREATE had one, above). Slice 2B.1.1: also
  // added "بگذار" ("set/put/schedule") -- the acceptance case "تسک تماس با
  // احمد را فردا ساعت ۱۰ بگذار" names an EXISTING task and reschedules it,
  // but uses neither a create verb nor "به‌روزرسانی کن"/"ویرایش کن"/
  // "تغییر بده" -- still noun-gated (تسک/وظیفه/کار within 60 chars), same
  // discipline as every other verb here. Mirrors
  // src/features/agent/reasoning/intentValidator.ts's own
  // requestLooksLikeTaskUpdate FA pattern.
  //
  // "بگذار" is overloaded, though: "نام تسک را X بگذار" ("name the task
  // X") is parseTitleCorrection's OWN idiom (a rename, not a reschedule)
  // -- excluded via the same guard below so a title-correction message
  // is never misread as reschedule-with-time evidence.
  // Slice 2B.1.1 parity fix: "move" was missing from the EN verb list --
  // the client's requestLooksLikeTaskUpdate already had it (a genuine,
  // pre-existing client/Worker parity gap, surfaced by acceptance matrix
  // item 4, "Move the task 'Call Ahmad' to tomorrow at 10").
  const update = (/\b(update|edit|change|move|reschedule|aktualisiere|bearbeite|verschiebe)\b.{0,60}\b(task|todo|aufgabe)\b/i.test(message) ||
    /(?:تسک|وظیفه|کار).{0,60}(?:به‌روزرسانی کن|ویرایش کن|تغییر بده|بگذار)/i.test(message)) &&
    !parseTitleCorrection(message)
  return create || update
}

// Slice 2B.1.1 -- PO decision SUPERSEDES the Slice 2B.1 "LOCKED DOMAIN
// RULE" (ask when an explicit task noun carries a time). A concrete
// time-of-day is scheduling intent; Tasks have no time-of-day column, so
// the requested time is now PRESERVED by routing to Calendar instead of
// discarding it or asking the user to resolve an internal schema detail
// they never should have needed to know about. The final precedence rule
// -- explicit calendar noun OR a concrete clock time wins -- now lives
// once in shared/schedulingDomain.ts, consumed by both this file and
// src/features/agent/reasoning/intentValidator.ts, so it cannot drift
// between the two runtimes independently again (see that shared module's
// own header comment). Only a task write with NO explicit noun at all
// (the implicit personal-statement branch inside parseTaskWriteIntent,
// e.g. "I have a dentist appointment tomorrow at 3pm") still resolves via
// its own separate, pre-existing tiebreaker below -- unaffected by this
// change, and unaffected by shared/schedulingDomain.ts (there is no
// explicit noun for it to evaluate).
function resolvesToCalendarDomain(message: string, now: Date, timeZone: string): boolean {
  if (isCalendarWriteTrigger(message)) return true
  if (isExplicitTaskWriteTrigger(message)) {
    return resolveSchedulingDomain({
      explicitCalendarTrigger: false,
      explicitTaskTrigger: true,
      hasConcreteTime: Boolean(parseDeterministicTimeOfDay(message)),
    }).kind === 'calendar'
  }
  return parseTaskWriteIntent(message, now, timeZone) !== null && Boolean(parseDeterministicTimeOfDay(message))
}

export type WriteDomainSignal = 'task' | 'calendar' | 'finance' | 'ambiguous' | 'none'

/**
 * The single deterministic routing decision -- see file header above.
 * Task 28: finance is a third, independent signal in the same
 * conflict-detection scheme -- when it doesn't fire (the common case for
 * any pre-existing task/calendar message), behaviour is byte-identical to
 * before this task, satisfying task 23's own "zero behaviour change for
 * existing domains" constraint. Exported for direct unit testing.
 *
 * Slice 2B.1.1: the 'task_time_ambiguous' signal from Slice 2B.1 is
 * RETIRED -- explicit task noun + concrete time no longer produces a
 * signal the caller must ask about; resolvesToCalendarDomain above now
 * resolves it directly to 'calendar', preserving the requested time.
 */
export function detectWriteDomainSignal(message: string, now: Date, timeZone: string): WriteDomainSignal {
  const taskTrigger = parseTaskWriteIntent(message, now, timeZone) !== null
  const calendarTrigger = isCalendarWriteTrigger(message)
  const financeTrigger = isFinanceWriteTrigger(message)
  const triggerCount = [taskTrigger, calendarTrigger, financeTrigger].filter(Boolean).length
  if (triggerCount === 0) return 'none'
  if (triggerCount > 1) return 'ambiguous'
  if (financeTrigger) return 'finance'
  return resolvesToCalendarDomain(message, now, timeZone) ? 'calendar' : 'task'
}

/**
 * A continuation message ("yes", "بله بساز", a title correction) carries
 * no domain wording of its own -- assembleTaskWriteIntent/
 * assembleCalendarWriteIntent each resolve it by scanning history for the
 * ORIGINAL triggering message. Routing must follow that same original
 * message, not the continuation text, or a time-bearing original request
 * would fall back to the task pipeline just because its "yes" reply
 * doesn't repeat the word "event". Mirrors assembleTaskWriteIntent's own
 * history-scan window (last 6 user messages) so the two stay consistent.
 * Exported for direct unit testing.
 */
// Task 22-fix (C1 off-by-one): resolves a historical turn's OWN relative
// date terms against the instant IT was sent, not the current turn's `now`
// -- see RecentChatTurn.createdAt above for why.
function turnNow(turn: RecentChatTurn, fallbackNow: Date): Date {
  if (!turn.createdAt) return fallbackNow
  const parsed = new Date(turn.createdAt)
  return Number.isNaN(parsed.getTime()) ? fallbackNow : parsed
}

export function detectContinuationDomain(recentTurns: RecentChatTurn[], now: Date, timeZone: string): 'task' | 'calendar' | 'finance' | null {
  const recentUserTurns = recentTurns
    .filter(turn => turn.role === 'user')
    .slice(-6)
    .reverse()
  for (const turn of recentUserTurns) {
    const signal = detectWriteDomainSignal(turn.content, turnNow(turn, now), timeZone)
    if (signal === 'task' || signal === 'calendar' || signal === 'finance') return signal
  }
  return null
}

// Task 22-fix (C1/C2 production root cause): a bare personal statement --
// "I have a family doctor appointment tomorrow at 13:00" -- carries the
// exact same write intent as an explicit imperative ("create a task") but
// without one. extractTaskTitle's own subject patterns below
// (persianSubject/englishSubject/germanSubject) already anticipated this
// phrasing for TITLE extraction, but nothing upstream ever recognized it as
// a WRITE TRIGGER -- so a message phrased this way never reached ANY of
// parseDeterministicDueDate/parseDeterministicTimeOfDay/
// resolveServerFlowWriteMode at all: it fell straight through to the plain
// model-generated chat reply, which is why the model's own untethered (and
// wrong) date survived to the user, AND why no writePolicy was ever
// returned in the response (so the frontend's approval overlay, which only
// suppresses itself when the server explicitly says auto/off, was never
// suppressed either -- production showed "Approval required" not because
// the auto default failed to apply, but because this code path never ran
// at all). Gated by a resolved date/time signal (a date phrase, a
// clarification-needed "due"/"moved" keyword, or a resolved time-of-day) so
// an unrelated first-person sentence never trips this, and by NOT looking
// like a read/list question (looksLikeSubjectChange, defined below --
// `function` hoisting makes the forward reference safe).
function isImplicitScheduleStatement(message: string): boolean {
  if (looksLikeSubjectChange(message)) return false
  const text = normalizeDigits(message)
  return /دارم/.test(text) ||                                    // "دارم" (I have)
    /\bi\s+(?:have|need to|need)\b/i.test(text) ||                // "I have"/"I need"
    /\b(?:dass|weil)?\s*ich\s+(?:habe|muss)\b/i.test(text)        // "ich habe"/"ich muss"
}

function hasResolvedDateOrTimeSignal(message: string, now: Date, timeZone: string): boolean {
  if (parseDeterministicTimeOfDay(message)) return true
  const date = parseDeterministicDueDate(message, now, timeZone)
  return date.value !== undefined || date.clarificationNeeded
}

export function parseTaskWriteIntent(message: string, now: Date, timeZone: string): ParsedTaskWriteIntent | null {
  const create = /\b(create|add|set up|erstelle|hinzuf[Ã¼u]gen)\b.{0,50}\b(task|todo|aufgabe)\b/i.test(message) ||
    /(?:ÛŒÚ©|ÙŠÙ‡|ÛŒÙ‡)?\s*(?:ØªØ³Ú©|ÙˆØ¸ÛŒÙÙ‡|Ú©Ø§Ø±).{0,50}(?:Ø¨Ø³Ø§Ø²|Ø§ÛŒØ¬Ø§Ø¯ Ú©Ù†|Ø§Ø¶Ø§ÙÙ‡ Ú©Ù†)/i.test(message)
  const cleanPersianCreate = /(?:\u06cc\u06a9|\u06a9|\u06cc\u0647)?\s*(?:\u062a\u0633\u06a9|\u0648\u0638\u06cc\u0641\u0647|\u06a9\u0627\u0631).{0,50}(?:\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646)/i.test(message)
  const cleanMixedPersianCreate = /(?:\u06cc\u06a9|\u06a9|\u06cc\u0647)?\s*(?:task|todo).{0,50}(?:\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646)/i.test(message)
  // Slice 2B.1 correction (Blocker 2/parity coverage): parseTaskWriteIntent had NO
  // Persian UPDATE recognition at all (only cleanPersianCreate/cleanMixedPersianCreate
  // above cover FA create; the corrupted create/update variables further up this
  // function are pre-existing, out-of-scope mojibake) -- an FA update-worded task
  // message returned null here entirely, never even reaching
  // isExplicitTaskWriteTrigger own (now-fixed) FA update check. Freshly written,
  // clean escapes mirroring cleanPersianCreate own style. Slice 2B.1.1:
  // the بگذار alternative is also parseTitleCorrection's OWN idiom
  // (نام تسک را X بگذار, a rename) -- guarded out below so a
  // title-correction message is never misread as reschedule-with-time
  // evidence here (it is still handled, correctly, by
  // assembleTaskWriteIntent's own parseTitleCorrection-driven merge path).
  const cleanPersianUpdate = /(?:\u06cc\u06a9|\u06a9|\u06cc\u0647)?\s*(?:\u062a\u0633\u06a9|\u0648\u0638\u06cc\u0641\u0647|\u06a9\u0627\u0631).{0,60}(?:\u0628\u0647\u200c\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc\s+\u06a9\u0646|\u0648\u06cc\u0631\u0627\u06cc\u0634\s+\u06a9\u0646|\u062a\u063a\u06cc\u06cc\u0631\s+\u0628\u062f\u0647|\u0628\u06af\u0630\u0627\u0631)/i.test(message) &&
    !parseTitleCorrection(message)
  // Slice 2B.1.1 parity fix: "move" was missing here too (same gap as
  // isExplicitTaskWriteTrigger's own EN update list) -- without it,
  // "Move the task 'Call Ahmad' to tomorrow at 10" never even registered
  // as a task write at all (taskTrigger stayed false).
  const update = /\b(update|edit|change|move|reschedule|aktualisiere|bearbeite|verschiebe)\b.{0,60}\b(task|todo|aufgabe)\b/i.test(message)
  const implicitCreate = !create && !cleanPersianCreate && !cleanMixedPersianCreate && !update && !cleanPersianUpdate &&
    isImplicitScheduleStatement(message) && hasResolvedDateOrTimeSignal(message, now, timeZone)
  if (!create && !cleanPersianCreate && !cleanMixedPersianCreate && !update && !cleanPersianUpdate && !implicitCreate) return null

  const date = parseDeterministicDueDate(message, now, timeZone)
  const timeOfDay = parseDeterministicTimeOfDay(message)
  const quoted = message.match(/["'Â«â€œ](.+?)["'Â»â€]/)?.[1]?.trim()
  if (create || cleanPersianCreate || cleanMixedPersianCreate || implicitCreate) {
    const title = extractTaskTitle(message)
    return { kind: 'create_task', title: title || undefined, notes: createTaskNotes(message, timeOfDay), dueDate: date.value, timeOfDay, dateClarificationNeeded: date.clarificationNeeded }
  }
  return { kind: 'update_task', taskReference: quoted, dueDate: date.value, timeOfDay, dateClarificationNeeded: date.clarificationNeeded }
}

// Task 22-fix3: a date/time token (digits, dashes, colons, a space -- no
// strong letter in either script) carries no directional strength of its
// own under the bidi algorithm (UAX#9), so a Persian confirmation line can
// visually reorder its internal groups ("16-08-2026 13:00" reading as
// scrambled or reversed) even though the string itself is correct left to
// right. src/lib/bidiText.tsx (the frontend's shared bidi utility, used by
// every markdown-rendered surface) deliberately does NOT isolate bare
// digit/punctuation runs -- see that file's own R2 comment -- so a plain
// numeric token like this one is exactly the case it leaves untouched.
// Worker replies are plain text (no React tree to hand a <bdi> to), so this
// wraps the token in the same underlying mechanism <bdi> itself uses --
// U+2066 LEFT-TO-RIGHT ISOLATE / U+2069 POP DIRECTIONAL ISOLATE -- directly
// in the string, guaranteeing one canonical left-to-right reading order
// regardless of the surrounding paragraph's direction.
const LRI = '⁦'
const PDI = '⁩'
function isolateForBidi(token: string): string {
  return `${LRI}${token}${PDI}`
}

function confirmation(language: Language, kind: 'create_task' | 'update_task', title: string, dueDate: string | null | undefined, timeOfDay?: string) {
  const due = dueDate ? ` — due ${isolateForBidi(dueDate)}` : ''
  const time = timeOfDay ? ` — time mentioned ${isolateForBidi(timeOfDay)}` : ''
  if (language === 'de') return `✓ Aufgabe ${kind === 'create_task' ? 'erstellt' : 'aktualisiert'}: ${title}${due}${time}`
  if (language === 'fa') return `✓ وظیفه ${kind === 'create_task' ? 'ایجاد شد' : 'به‌روزرسانی شد'}: ${title}${due}${time}`
  return `✓ Task ${kind === 'create_task' ? 'created' : 'updated'}: ${title}${due}${time}`
}

function isAffirmativeWriteContinuation(message: string) {
  const text = normalizeDigits(message.toLowerCase())
  return /\b(yes|yeah|yep|do it|create it|confirm|confirmed|please do|go ahead)\b/i.test(text) ||
    /\b(ja|mach|erstellen|bestatige|bestätige)\b/i.test(text) ||
    /\u0628\u0644\u06cc|\u0628\u0644\u0647|\u0622\u0631\u0647|\u062a\u0627\u06cc\u06cc\u062f|\u062a\u0623\u06cc\u06cc\u062f|\u0628\u0633\u0627\u0632/.test(text)
}

function looksLikeSubjectChange(message: string) {
  const text = normalizeDigits(message.toLowerCase())
  return /\b(show|list|what|summarize|calendar|learning|progress|github|finance|weather)\b/i.test(text) ||
    /\b(zeige|liste|kalender|lernen|fortschritt|finanzen)\b/i.test(text) ||
    /\u067e\u06cc\u0634\u0631\u0641\u062a|\u06cc\u0627\u062f\u06af\u06cc\u0631\u06cc|\u062a\u0642\u0648\u06cc\u0645|\u0645\u0627\u0644\u06cc|\u0644\u06cc\u0633\u062a|\u0646\u0634\u0627\u0646/.test(text)
}

function parseTitleCorrection(message: string) {
  const normalized = normalizeDigits(message)
  const persian = normalized.match(/(?:\u0646\u0627\u0645\s+(?:\u062a\u0633\u06a9|\u0648\u0638\u06cc\u0641\u0647|task)\s+\u0631\u0627|\u0627\u0633\u0645\s+(?:\u062a\u0633\u06a9|\u0648\u0638\u06cc\u0641\u0647|task)\s+\u0631\u0627)\s+(.+?)\s+(?:\u0628\u06af\u0630\u0627\u0631|\u0628\u0630\u0627\u0631|باشد|\u0628\u0627\u0634\u062f|کن|\u06a9\u0646)(?:\s|[.،,]|$)/)
  if (persian?.[1]) return boundText(removeDateAndTimePhrases(persian[1]), 80)
  const english = normalized.match(/\b(?:name|title)\s+(?:the\s+)?(?:task|todo)\s+(.+?)(?:\s+and\b|[.,]|$)/i)
  if (english?.[1]) return boundText(removeDateAndTimePhrases(english[1]), 80)
  const german = normalized.match(/\b(?:nenne|titel)\s+(?:die\s+)?aufgabe\s+(.+?)(?:\s+und\b|[.,]|$)/i)
  if (german?.[1]) return boundText(removeDateAndTimePhrases(german[1]), 80)
  return undefined
}

function mergeTaskIntent(base: ParsedTaskWriteIntent, message: string, now: Date, timeZone: string): ParsedTaskWriteIntent {
  const correctionTitle = parseTitleCorrection(message)
  const direct = parseTaskWriteIntent(message, now, timeZone)
  const timeOfDay = parseDeterministicTimeOfDay(message) ?? direct?.timeOfDay ?? base.timeOfDay
  const dueDate = direct?.dueDate !== undefined ? direct.dueDate : base.dueDate
  return {
    ...base,
    title: correctionTitle ?? direct?.title ?? base.title,
    titleSource: correctionTitle ? 'correction' : (direct?.title ? undefined : base.titleSource),
    notes: createTaskNotes(`${base.notes ?? ''}\n${message}`.trim(), timeOfDay),
    dueDate,
    timeOfDay,
    dateClarificationNeeded: direct?.dateClarificationNeeded ?? base.dateClarificationNeeded,
  }
}

export function assembleTaskWriteIntent(message: string, recentTurns: RecentChatTurn[], now: Date, timeZone: string): ParsedTaskWriteIntent | null {
  const direct = parseTaskWriteIntent(message, now, timeZone)
  if (direct) return direct
  if (looksLikeSubjectChange(message)) return null
  if (!isAffirmativeWriteContinuation(message) && !parseTitleCorrection(message)) return null
  if (recentTurns.slice(-4).some(turn => turn.role === 'assistant' && /✓ .*(Task created|Task updated|Aufgabe .*erstellt|Aufgabe .*aktualisiert|\u0648\u0638\u06cc\u0641\u0647 .*(?:\u0627\u06cc\u062c\u0627\u062f \u0634\u062f|\u0628\u0647\u200c\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc \u0634\u062f))/.test(turn.content))) {
    return null
  }

  const recentUserTurns = recentTurns
    .filter(turn => turn.role === 'user')
    .slice(-6)
    .reverse()
  const previous = recentUserTurns
    .map(turn => parseTaskWriteIntent(turn.content, turnNow(turn, now), timeZone))
    .find((intent): intent is ParsedTaskWriteIntent => Boolean(intent && intent.kind === 'create_task'))
  return previous ? mergeTaskIntent(previous, message, now, timeZone) : null
}

// ---------------------------------------------------------------------------
// Task 22 -- calendar event intent parsing. Mirrors parseTaskWriteIntent/
// mergeTaskIntent/assembleTaskWriteIntent structurally (same multi-turn
// pending-intent mechanism: isAffirmativeWriteContinuation,
// looksLikeSubjectChange, parseTitleCorrection, and the "don't reassemble
// after a server confirmation" guard are all reused unchanged) -- kept as
// a parallel pipeline rather than folded into the task one because the
// target shape genuinely differs (a time range, not a due date only).
// ---------------------------------------------------------------------------

/**
 * Only ever called after detectWriteDomainSignal has already decided
 * 'calendar' -- its own gate (resolvesToCalendarDomain) mirrors that
 * decision exactly, so it is also safe to call standalone (e.g. when
 * assembleCalendarWriteIntent below re-parses OLDER history messages one
 * at a time, where the live routing decision for THIS turn doesn't apply).
 * Exported for direct unit testing.
 */
export function parseCalendarWriteIntent(message: string, now: Date, timeZone: string): ParsedCalendarWriteIntent | null {
  if (!resolvesToCalendarDomain(message, now, timeZone)) return null
  // Slice 2B.1.1: an explicit CALENDAR noun (event/appointment/meeting/...)
  // is required for update_calendar_event -- a message that reaches this
  // function only because an explicit TASK noun carried a concrete time
  // (resolvesToCalendarDomain's new scheduling-domain rule, see
  // shared/schedulingDomain.ts) must NEVER be treated as an update to an
  // existing calendar event, even if it also contains an update-shaped
  // verb like "move"/"reschedule"/"بگذار" -- that would bridge a TASK
  // reference into an EVENT lookup, exactly what this slice forbids
  // ("NEVER update_calendar_event from task identity"). It always
  // produces a brand-new event instead; the referenced task, if any, is
  // resolved and left untouched entirely by the caller
  // (index.ts)/intentValidator.ts, never here.
  const isExplicitTaskRoutedHere = !isCalendarWriteTrigger(message) && isExplicitTaskWriteTrigger(message)
  const isUpdate = !isExplicitTaskRoutedHere && (
    /\b(update|edit|change|reschedule|move|aktualisiere|bearbeite|verschiebe)\b/i.test(message) ||
    /(?:به‌روزرسانی کن|ویرایش کن|جابجا کن|تغییر بده)/.test(message)
  )

  const date = parseDeterministicDueDate(message, now, timeZone)
  const { start, end } = parseDeterministicTimeRange(message)
  const quoted = message.match(/["'«“](.+?)["'»”]/)?.[1]?.trim()

  if (!isUpdate) {
    // Slice 2B.1.1: prefer an explicitly quoted title ("Move the task
    // 'Call Ahmad' to tomorrow at 10") over the generic fallback
    // extraction -- extractTaskTitle's stripping regexes are tuned for
    // CREATE-shaped task phrasing and do not reliably clean an
    // update/reschedule-shaped one. Either way this is only ever the
    // LAST-RESORT pattern fallback: resolveCreateEventTitle (index.ts)
    // still asks the model for the real title first, same as every other
    // create_calendar_event/create_task path.
    const title = quoted || extractTaskTitle(message)
    return {
      kind: 'create_calendar_event',
      title: title || undefined,
      notes: createTaskNotes(message, start),
      startDate: date.value,
      startTime: start,
      endTime: end,
      dateClarificationNeeded: date.clarificationNeeded,
    }
  }
  return {
    kind: 'update_calendar_event',
    eventReference: quoted,
    startDate: date.value,
    startTime: start,
    endTime: end,
    dateClarificationNeeded: date.clarificationNeeded,
  }
}

function mergeCalendarIntent(base: ParsedCalendarWriteIntent, message: string, now: Date, timeZone: string): ParsedCalendarWriteIntent {
  const correctionTitle = parseTitleCorrection(message)
  const direct = parseCalendarWriteIntent(message, now, timeZone)
  const { start, end } = parseDeterministicTimeRange(message)
  const startTime = start ?? direct?.startTime ?? base.startTime
  const endTime = end ?? direct?.endTime ?? base.endTime
  const startDate = direct?.startDate !== undefined ? direct.startDate : base.startDate
  return {
    ...base,
    title: correctionTitle ?? direct?.title ?? base.title,
    titleSource: correctionTitle ? 'correction' : (direct?.title ? undefined : base.titleSource),
    notes: createTaskNotes(`${base.notes ?? ''}\n${message}`.trim(), startTime),
    startDate,
    startTime,
    endTime,
    dateClarificationNeeded: direct?.dateClarificationNeeded ?? base.dateClarificationNeeded,
  }
}

export function assembleCalendarWriteIntent(message: string, recentTurns: RecentChatTurn[], now: Date, timeZone: string): ParsedCalendarWriteIntent | null {
  const direct = parseCalendarWriteIntent(message, now, timeZone)
  if (direct) return direct
  if (looksLikeSubjectChange(message)) return null
  if (!isAffirmativeWriteContinuation(message) && !parseTitleCorrection(message)) return null
  if (recentTurns.slice(-4).some(turn => turn.role === 'assistant' && /✓ .*(Event created|Event updated|Ereignis .*erstellt|Ereignis .*aktualisiert|رویداد .*(?:ایجاد شد|به‌روزرسانی شد))/.test(turn.content))) {
    return null
  }

  const recentUserTurns = recentTurns
    .filter(turn => turn.role === 'user')
    .slice(-6)
    .reverse()
  const previous = recentUserTurns
    .map(turn => parseCalendarWriteIntent(turn.content, turnNow(turn, now), timeZone))
    .find((intent): intent is ParsedCalendarWriteIntent => Boolean(intent && intent.kind === 'create_calendar_event'))
  return previous ? mergeCalendarIntent(previous, message, now, timeZone) : null
}

// ---------------------------------------------------------------------------
// Task 28 -- finance write slice. Create-only (no update_finance_transaction
// intent exists, so there is no merge/correction pipeline to mirror from
// task/calendar) -- deliberately simpler than the two triads above for that
// reason, not an oversight. Every value below is re-derived deterministically
// from the raw message; nothing here is ever asked of, or trusted from, a
// model (ADR-0012's own boundary, doubly true for money).
// ---------------------------------------------------------------------------

function isFinanceWriteTrigger(message: string): boolean {
  return /\b(log|record|add|create)\b.{0,40}\b(expense|income|transaction|payment)\b/i.test(message) ||
    /\b(i\s+)?(spent|paid|bought)\b.{0,40}\b(on|for|euro|eur|€|\d)/i.test(message) ||
    // Bank-transfer phrasing ("pay"/"send" + an amount or an IBAN-shaped
    // token) is finance-write evidence too -- the IBAN rule below only
    // ever matters once a message is already routed here.
    /\b(pay|send|transfer)\b.{0,40}\b(euro|eur|€|\d|[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,30})/i.test(message) ||
    /\b(erfasse|buche|trage)\b.{0,40}\b(ausgabe|einnahme|transaktion|zahlung)\b/i.test(message) ||
    // Task 41 (production bug): "مبلغ ۲۵ یورو در بخش مواد غذایی اضافه کن"
    // ("add an amount of 25 euros in the groceries category") produced NO
    // proposal -- this noun/verb pair regex already listed "اضافه کن"
    // among its verbs, but required one of هزینه/درآمد/تراکنش/پرداخت
    // (expense/income/transaction/payment) as the paired noun, and that
    // exact message says "مبلغ" (amount) instead of any of those four. Added
    // "مبلغ" to the noun group (it is unambiguously a monetary-amount word,
    // not shared with any task/calendar vocabulary -- see task 41's cross-
    // domain-leak tests for the same non-collision discipline applied to
    // target_fields). Also added "وارد کن" (enter) and "بزن" (colloquial
    // "put/log it") to the verb group per the task's own explicit request
    // for equivalents -- both stay gated behind the same finance-noun
    // proximity requirement as every existing verb here, so a generic "بزن"
    // elsewhere (it is heavily overloaded in colloquial Persian) still only
    // ever counts as finance-write evidence when paired with a finance noun
    // within 40 characters, exactly like "اضافه کن" already was.
    /(هزینه|درآمد|تراکنش|پرداخت|مبلغ).{0,40}(ثبت کن|اضافه کن|وارد کن|بزن|بساز|ثبت شود)/.test(message)
}

// Task 42: extracted to shared/financeDirection.ts (both this file's own
// copy and intentValidator.ts's parseDeterministicDirection were hand
// duplicates -- see that shared module's own header comment for why and
// task 41-verify's diagnosis for how the drift risk was found).

// Task 28: matches an amount+optional-currency token in Farsi (Arabic-indic
// digits, normalized via normalizeDigits already used by the date parsers
// above), German (comma-decimal, "45,50"), and English (dot-decimal,
// "45.50") conventions, plus thousands-grouped forms in either the Arabic
// separator ٬ (U+066C) or the Latin '.'/',' -- disambiguated by treating
// whichever of '.'/',' appears LAST in the matched token as the decimal
// separator (the convention both German "1.234,56" and English "1,234.56"
// agree on: the final separator is always the decimal one), and a trailing
// 3-digit group after that as a thousands group, not a fraction, so
// "1.234" (no further split) still resolves to 1234, not 1.234.
const EURO_CURRENCY_PATTERN = /€|\beur\b|euro|یورو/i
const AMOUNT_TOKEN_PATTERN = /[0-9]{1,3}(?:[.,٬][0-9]{3})+(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?/

function parseDeterministicAmount(message: string): { amount?: number; currency?: string } {
  const text = normalizeDigits(message)
  const match = text.match(AMOUNT_TOKEN_PATTERN)
  if (!match) return {}
  const raw = match[0]
  const decimalIndex = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'))
  let normalized: string
  if (decimalIndex === -1) {
    normalized = raw.replace(/٬/g, '')
  } else {
    const integerPart = raw.slice(0, decimalIndex).replace(/[.,٬]/g, '')
    const fractionPart = raw.slice(decimalIndex + 1)
    normalized = fractionPart.length === 3 ? `${integerPart}${fractionPart}` : `${integerPart}.${fractionPart}`
  }
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) return {}
  return { amount, currency: EURO_CURRENCY_PATTERN.test(text) ? 'EUR' : undefined }
}

// Task 28: IBAN-shaped token detection -- either compact ("DE893704...") or
// human space-grouped in 4s ("DE89 3704 0044 0532 0130 00"). "IBAN-shaped"
// per this task's own wording, not a guarantee of a syntactically perfect
// IBAN -- the mod-97 check below (isValidIban) is what actually decides
// valid/invalid; this pattern only decides whether there is anything to
// validate at all.
const IBAN_GROUPED_PATTERN = /\b[A-Za-z]{2}[0-9]{2}(?:\s[A-Za-z0-9]{4}){2,7}(?:\s[A-Za-z0-9]{1,4})?\b/
const IBAN_COMPACT_PATTERN = /\b[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,30}\b/

function findIbanCandidate(message: string): string | undefined {
  return message.match(IBAN_GROUPED_PATTERN)?.[0] ?? message.match(IBAN_COMPACT_PATTERN)?.[0]
}

function normalizeIbanCandidate(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

// Task 28: ISO 7064 MOD 97-10, the standard IBAN checksum -- move the first
// 4 characters (country code + check digits) to the end, convert letters to
// numbers (A=10 ... Z=35), and the resulting numeric string must be
// congruent to 1 mod 97. BigInt is required, not optional: a 30-odd digit
// numeric string is well past Number's safe-integer precision, and a
// precision-lossy mod here would silently accept some invalid IBANs and
// reject some valid ones -- exactly the "silent drop" this task's own
// requirement rules out.
export function isValidIban(candidate: string): boolean {
  const iban = normalizeIbanCandidate(candidate)
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55))
  try {
    return BigInt(numeric) % 97n === 1n
  } catch {
    return false
  }
}

export interface ParsedFinanceWriteIntent {
  kind: 'create_finance_transaction'
  amount?: number
  currency?: string
  direction?: 'income' | 'expense'
  transactionDate?: string
  description?: string
  iban?: string
  ibanValid?: boolean
  amountClarificationNeeded: boolean
}

// Task 40, ADR-0016 Slice 2: derives the proposal-outcome ledger's
// target_fields (which fields were POPULATED, never their content) from
// each parsed intent. `kind`/`titleSource`/`dateClarificationNeeded`/
// `ibanValid`/`amountClarificationNeeded` are control-flow signals, not
// target content, and are deliberately excluded -- only the fields a user's
// message could actually populate are listed here. Each function returns
// field NAMES only; callers must never pass the intent object itself (or
// any of its values) to the recording function.
const TASK_INTENT_TARGET_FIELD_KEYS = ['title', 'taskReference', 'notes', 'dueDate', 'timeOfDay'] as const

// Task 41: `title`/`notes` here used to be the OUTPUT names too, not just
// the internal ParsedCalendarWriteIntent property names -- but 'title' and
// 'notes' are exactly TASK's own registry field names (WRITE_DOMAIN_TARGET_
// FIELDS.tasks), not calendar's ('eventTitle'; calendar has no registry
// notes/description field at all). A calendar auto-write's ledger row
// therefore reported field names that look, by their string alone, like a
// TASK field had been populated -- the same class of cross-domain
// ambiguity as the production bug this task fixes, just latent rather
// than yet observed. Each entry below maps the parsed intent's own
// property to the OUTPUT name actually recorded: 'title' -> registry's
// 'eventTitle'; 'notes' -> 'eventDescription' (invented, not a registry
// name, since the registry doesn't model this field for calendar at all --
// chosen to collide with neither tasks' 'notes'/'title' nor finance's
// 'description'). eventReference/startDate/startTime/endTime already don't
// collide with any other domain's registry vocabulary and pass through
// unchanged; startDate/startTime/endTime have no single-field registry
// equivalent (the registry's flat 'start'/'end' are whole ISO instants,
// the deterministic parser stores date and time-of-day separately).
const CALENDAR_INTENT_TARGET_FIELD_MAP: ReadonlyArray<{ property: keyof ParsedCalendarWriteIntent; outputName: string }> = [
  { property: 'title', outputName: 'eventTitle' },
  { property: 'eventReference', outputName: 'eventReference' },
  { property: 'notes', outputName: 'eventDescription' },
  { property: 'startDate', outputName: 'startDate' },
  { property: 'startTime', outputName: 'startTime' },
  { property: 'endTime', outputName: 'endTime' },
]

const FINANCE_INTENT_TARGET_FIELD_KEYS = ['amount', 'currency', 'direction', 'transactionDate', 'description', 'iban'] as const

export function taskIntentTargetFields(intent: ParsedTaskWriteIntent): string[] {
  return TASK_INTENT_TARGET_FIELD_KEYS.filter((key) => intent[key] !== undefined)
}

export function calendarIntentTargetFields(intent: ParsedCalendarWriteIntent): string[] {
  return CALENDAR_INTENT_TARGET_FIELD_MAP
    .filter(({ property }) => intent[property] !== undefined)
    .map(({ outputName }) => outputName)
}

export function financeIntentTargetFields(intent: ParsedFinanceWriteIntent): string[] {
  return FINANCE_INTENT_TARGET_FIELD_KEYS.filter((key) => intent[key] !== undefined)
}

// Task 40: intentType/toolId for the proposal-outcome ledger, derived from
// the shared registry rather than hand-mapped here a second time (ADR-0013
// discipline). `kind` already matches WriteIntentType exactly for all three
// domains, so this is a direct registry lookup, not a translation table.
export function writeIntentOutcomeIdentity(kind: WriteIntentType): { intentType: WriteIntentType; toolId: string } | null {
  const entry = findWriteIntentDescriptor(kind)
  if (!entry) return null
  return { intentType: entry.intentType, toolId: entry.toolId }
}

/**
 * Exported for direct unit testing. Only ever returns null when the
 * message carries no finance-write trigger at all -- an absent amount or
 * direction on an otherwise-triggering message still returns a descriptor
 * (with `amountClarificationNeeded`/no `direction`), so the caller can ask
 * a specific clarifying question instead of silently dropping the request.
 */
export function parseFinanceWriteIntent(message: string, now: Date, timeZone: string): ParsedFinanceWriteIntent | null {
  if (!isFinanceWriteTrigger(message)) return null
  const ibanCandidate = findIbanCandidate(message)
  const iban = ibanCandidate ? normalizeIbanCandidate(ibanCandidate) : undefined
  const ibanValid = iban ? isValidIban(iban) : undefined
  // The IBAN's own digits must never leak into the amount parse below --
  // masked out first, not merely hoped to not match.
  const messageForAmount = ibanCandidate ? message.replace(ibanCandidate, ' ') : message
  const { amount, currency } = parseDeterministicAmount(messageForAmount)
  const direction = parseFinanceDirection(message)
  const date = parseDeterministicDueDate(message, now, timeZone)
  // Task 28: unlike a task's dueDate or a calendar event's start, an
  // unmentioned transaction date defaults to today rather than asking --
  // "log a 45 euro expense" is already a complete, well-formed request
  // without a date phrase, the same tolerance create_task already has for
  // an absent dueDate.
  const transactionDate = date.value ?? dateKey(now, timeZone)
  return {
    kind: 'create_finance_transaction',
    amount,
    currency,
    direction,
    transactionDate,
    description: boundText(message, 500),
    iban,
    ibanValid,
    amountClarificationNeeded: amount === undefined,
  }
}

export function assembleFinanceWriteIntent(message: string, recentTurns: RecentChatTurn[], now: Date, timeZone: string): ParsedFinanceWriteIntent | null {
  const direct = parseFinanceWriteIntent(message, now, timeZone)
  if (direct) return direct
  if (looksLikeSubjectChange(message)) return null
  if (!isAffirmativeWriteContinuation(message)) return null
  if (recentTurns.slice(-4).some(turn => turn.role === 'assistant' && /✓ .*(Transaction recorded|Transaktion erfasst|تراکنش ثبت شد)/.test(turn.content))) {
    return null
  }
  const recentUserTurns = recentTurns
    .filter(turn => turn.role === 'user')
    .slice(-6)
    .reverse()
  return recentUserTurns
    .map(turn => parseFinanceWriteIntent(turn.content, turnNow(turn, now), timeZone))
    .find((intent): intent is ParsedFinanceWriteIntent => Boolean(intent)) ?? null
}

// ---------------------------------------------------------------------------
// Task 22-fix2 (D2/D3): undo is part of the definition of an 'auto' write
// under ADR-0012 -- a write that executed but has no undo record is a
// silent policy violation, not a degraded-but-acceptable outcome. Both
// execution branches below already run the primary write BEFORE
// persistUndoRecord (D3 finding: true for tasks and calendar, create and
// update, unchanged by this fix -- true "undo-first" ordering would need a
// two-phase reserve/confirm flow for creates, since the undo record for a
// create needs the row's own freshly-generated id; out of scope for this
// fix). Given that ordering, the chosen semantics are: if persistUndoRecord
// fails, attempt a compensating rollback of the just-made write so nothing
// is left silently executed-without-undo, then report a clean 'failed'
// status through the SAME path clarify/not_found already use --
// respondToWriteExecution in index.ts turns any of these into a proper
// JSON reply, never a bare unhandled exception (which is what previously
// surfaced to the user as "Failed to send" with no reply at all -- this
// task's own production evidence). If the rollback itself also fails
// (a genuine double-fault), the write may be orphaned without undo; that
// case is logged as CRITICAL server-side and reported honestly to the user
// as "please verify manually" rather than a flat, possibly-false "failed."
// ---------------------------------------------------------------------------

// INC-01: distinct from FAILED_WRITE_REPLY below -- 'failed' means a write
// was actually attempted and something went wrong persisting it; this is
// for when the write was never attempted at all because the AI provider
// itself could not be reached to resolve a title. Exported so index.ts's
// task/calendar auto-write dispatch (the only place that catches
// resolveCreateTitle's ProviderUnavailableError) can build the same,
// consistently-worded reply for both domains.
export const PROVIDER_UNAVAILABLE_WRITE_REPLY: Record<Language, string> = {
  en: 'The AI assistant is temporarily unavailable, so I could not finish setting this up automatically. Please try again in a moment.',
  de: 'Der KI-Assistent ist vorübergehend nicht verfügbar, daher konnte ich das nicht automatisch fertigstellen. Bitte versuche es gleich noch einmal.',
  fa: 'دستیار هوش مصنوعی موقتاً در دسترس نیست، بنابراین نتوانستم این کار را به‌طور خودکار تکمیل کنم. لطفاً کمی بعد دوباره امتحان کنید.',
}

const FAILED_WRITE_REPLY: Record<Language, { retry: string; verify: string }> = {
  en: {
    retry: "I couldn't complete that action. Please try again.",
    verify: "I couldn't confirm that action finished — please check your tasks/calendar to be sure.",
  },
  de: {
    retry: 'Diese Aktion konnte ich nicht abschließen. Bitte versuche es erneut.',
    verify: 'Ich konnte nicht bestätigen, dass diese Aktion abgeschlossen wurde — bitte überprüfe deine Aufgaben/deinen Kalender.',
  },
  fa: {
    retry: 'نتوانستم این کار را انجام بدهم. لطفاً دوباره امتحان کن.',
    verify: 'نتوانستم تأیید کنم که این کار انجام شده — لطفاً تسک‌ها/تقویم خود را بررسی کن.',
  },
}

/**
 * Attempts to persist the undo record for a just-executed auto write.
 * Returns `null` on success (caller proceeds to build the normal 'executed'
 * response). On failure, attempts `rollback` (a caller-supplied compensating
 * action reversing the write that was just made) and returns a 'failed'
 * status either way -- the reply differs depending on whether the rollback
 * itself could be trusted to have succeeded, so the user is never told a
 * flatly false story in either direction.
 */
async function persistUndoOrRollback(
  env: Env,
  entry: UndoEntry,
  undoId: string,
  language: Language,
  rollback: () => Promise<void>,
): Promise<{ status: 'failed'; reply: string } | null> {
  try {
    await persistUndoRecord(env, entry, undoId)
    return null
  } catch (err) {
    console.error(`[FlowWrite] undo-persist failed for kind=${entry.kind}, attempting compensating rollback:`, (err as Error).message)
    try {
      await rollback()
      console.warn(`[FlowWrite] compensating rollback succeeded for kind=${entry.kind} -- the write was NOT retained (undo could not be recorded)`)
      return { status: 'failed', reply: FAILED_WRITE_REPLY[language].retry }
    } catch (rollbackErr) {
      console.error(`[FlowWrite] CRITICAL: compensating rollback ALSO failed for kind=${entry.kind} -- write may be orphaned without an undo record:`, (rollbackErr as Error).message)
      return { status: 'failed', reply: FAILED_WRITE_REPLY[language].verify }
    }
  }
}

export async function executeAutoTaskWrite(input: {
  env: Env
  userId: string
  language: Language
  intent: ParsedTaskWriteIntent
  now: Date
  timeZone: string
}): Promise<
  // BLOCKER 3 CORRECTION: title/notes/dueDate carry the row's ACTUAL,
  // just-persisted values (from the write's own `select=` representation,
  // not an echo of the request) -- present for every 'executed' result, not
  // only update, so a caller never has to special-case create vs update to
  // build a truthful result. See agent-tool-execution.ts's own consumption
  // of this for why: a handler must never claim a field was applied merely
  // because it was requested.
  | { status: 'executed'; reply: string; undoId: string; undoExpiresAt: string; id: string; title: string; notes: string | null; dueDate: string | null }
  | { status: 'clarify'; reply: string }
  | { status: 'failed'; reply: string }
  | { status: 'not_found' }
> {
  const { env, userId, intent, language, now, timeZone } = input
  if (intent.dateClarificationNeeded) return { status: 'clarify', reply: 'Which exact due date should I use?' }
  if (intent.kind === 'create_task') {
    if (!intent.title) return { status: 'clarify', reply: 'What should the task be called?' }
    const rows = await supabaseWriteReturning<TaskRow[]>(env, 'POST', 'tasks?select=id,user_id,title,notes,due_date,completed,created_at,updated_at', {
      user_id: userId,
      title: intent.title,
      notes: intent.notes ?? null,
      due_date: intent.dueDate ?? null,
      completed: false,
    })
    const task = rows[0]
    if (!task?.id) return { status: 'failed', reply: 'I could not verify that the task was created.' }
    const alarm = await createTaskAlarmIfNeeded(env, userId, task, intent.timeOfDay, timeZone)
    const undoId = `undo:${crypto.randomUUID()}`
    const expiresAt = undoExpiresAt(now)
    const undoFailure = await persistUndoOrRollback(env, { kind: 'create_task', userId, taskId: task.id, expiresAt }, undoId, language, async () => {
      await supabaseWriteNoContent(env, 'DELETE', `tasks?id=eq.${esc(task.id)}&user_id=eq.${esc(userId)}`)
      if (alarm?.id) await supabaseWriteNoContent(env, 'DELETE', `alarms?id=eq.${esc(alarm.id)}&user_id=eq.${esc(userId)}`)
    })
    if (undoFailure) return undoFailure
    return { status: 'executed', reply: confirmation(language, 'create_task', task.title, task.due_date, intent.timeOfDay), undoId, undoExpiresAt: expiresAt, id: task.id, title: task.title, notes: task.notes, dueDate: task.due_date }
  }

  // Chat V2 Slice 2A: a caller that already knows the exact row (the
  // approval-driven path in agent-tool-execution.ts) supplies targetId
  // directly, skipping fuzzy title-reference matching entirely -- that
  // matching exists for the OLDER server-side NL flow (a message naming a
  // task by description, never an id) and stays completely unchanged for
  // every existing caller, none of which ever sets targetId.
  let before: TaskRow | undefined
  if (intent.targetId) {
    const rows = await supabaseGet<TaskRow[]>(env, `tasks?id=eq.${esc(intent.targetId)}&user_id=eq.${esc(userId)}&select=id,user_id,title,notes,due_date,completed,created_at,updated_at&limit=1`)
    before = rows[0]
    if (!before) return { status: 'not_found' }
  } else {
    const tasks = await supabaseGet<TaskRow[]>(env, `tasks?user_id=eq.${esc(userId)}&completed=eq.false&select=id,user_id,title,notes,due_date,completed,created_at,updated_at`)
    const ref = intent.taskReference?.toLowerCase()
    const matches = ref ? tasks.filter(task => task.title.toLowerCase().includes(ref) || ref.includes(task.title.toLowerCase())) : []
    if (matches.length !== 1) return { status: matches.length > 1 ? 'clarify' : 'not_found', reply: 'Which exact task should I update?' }
    before = matches[0]
  }
  // BLOCKER 3 CORRECTION: the original PATCH body here only ever sent
  // due_date, silently ignoring intent.title/intent.notes -- a real,
  // pre-existing bug in this update path (undetected in production because
  // the OLDER server-side NL flow this function was originally written for
  // never produced a title/notes change on an update intent; Chat V2 Slice
  // 2A's approval-driven update path, which DOES let a user edit
  // title/notes, inherited the gap unchanged). title/notes are now included
  // whenever the intent actually specifies them; due_date keeps its exact
  // original semantics (preserved when not specified).
  const rows = await supabaseWriteReturning<TaskRow[]>(env, 'PATCH', `tasks?id=eq.${esc(before.id)}&user_id=eq.${esc(userId)}&select=id,user_id,title,notes,due_date,completed,created_at,updated_at`, {
    ...(intent.title !== undefined ? { title: intent.title } : {}),
    ...(intent.notes !== undefined ? { notes: intent.notes } : {}),
    due_date: intent.dueDate === undefined ? before.due_date : intent.dueDate,
  })
  const updated = rows[0]
  if (!updated?.id) return { status: 'failed', reply: 'I could not verify that the task was updated.' }
  const undoId = `undo:${crypto.randomUUID()}`
  const expiresAt = undoExpiresAt(now)
  const undoFailure = await persistUndoOrRollback(
    env,
    { kind: 'update_task', userId, taskId: before.id, previous: { title: before.title, notes: before.notes, due_date: before.due_date, completed: before.completed }, expiresAt },
    undoId,
    language,
    // BLOCKER 3 CORRECTION: this compensating rollback (used only when
    // PERSISTING the undo record itself fails -- see persistUndoOrRollback)
    // used to restore only due_date, silently leaving a just-applied
    // title/notes change in place with no undo record to reverse it later.
    // Restores the full snapshot now, matching undoAutoWrite's own
    // (unaffected, already-correct) full-field restore for the ordinary
    // user-initiated Undo path below.
    async () => {
      await supabaseWriteNoContent(env, 'PATCH', `tasks?id=eq.${esc(before.id)}&user_id=eq.${esc(userId)}`, { title: before.title, notes: before.notes, due_date: before.due_date })
    },
  )
  if (undoFailure) return undoFailure
  return { status: 'executed', reply: confirmation(language, 'update_task', updated.title, updated.due_date, intent.timeOfDay), undoId, undoExpiresAt: expiresAt, id: updated.id, title: updated.title, notes: updated.notes, dueDate: updated.due_date }
}

function confirmationForCalendar(
  language: Language,
  kind: 'create_calendar_event' | 'update_calendar_event',
  title: string,
  startDate: string | null | undefined,
  startTime: string | undefined,
) {
  const when = startDate && startTime ? ` — ${isolateForBidi(`${startDate} ${startTime}`)}` : startDate ? ` — ${isolateForBidi(startDate)}` : ''
  if (language === 'de') return `✓ Ereignis ${kind === 'create_calendar_event' ? 'erstellt' : 'aktualisiert'}: ${title}${when}`
  if (language === 'fa') return `✓ رویداد ${kind === 'create_calendar_event' ? 'ایجاد شد' : 'به‌روزرسانی شد'}: ${title}${when}`
  return `✓ Event ${kind === 'create_calendar_event' ? 'created' : 'updated'}: ${title}${when}`
}

// Task 28: mirrors confirmationForCalendar's bidi-isolation treatment
// exactly (task 22-fix3, commit 4995b29) -- the amount+date token is a bare
// digit/punctuation run with no bidi strength of its own (UAX#9), so it is
// wrapped in the same U+2066 LRI / U+2069 PDI isolate the calendar/task
// confirmations already use, applied consistently rather than introduced
// as a one-off for this domain.
function confirmationForFinance(language: Language, direction: 'income' | 'expense', amount: number, currency: string | undefined, transactionDate: string): string {
  const amountLabel = `${amount.toFixed(2)}${currency ? ` ${currency}` : ''}`
  const when = ` — ${isolateForBidi(`${amountLabel} ${transactionDate}`)}`
  if (language === 'de') return `✓ Transaktion erfasst: ${direction === 'income' ? 'Einnahme' : 'Ausgabe'}${when}`
  if (language === 'fa') return `✓ تراکنش ثبت شد: ${direction === 'income' ? 'درآمد' : 'هزینه'}${when}`
  return `✓ Transaction recorded: ${direction === 'income' ? 'income' : 'expense'}${when}`
}

async function createCalendarEventAlarmIfNeeded(env: Env, userId: string, event: CalendarEventRow, startUtcIso: string) {
  const rows = await supabaseWriteReturning<AlarmRow[]>(env, 'POST', 'alarms?select=id,source_id,trigger_at', {
    user_id: userId,
    source_type: 'calendar_event',
    source_id: event.id,
    source_title: event.title,
    trigger_at: startUtcIso,
    remind_before_minutes: 0,
    is_fired: false,
    is_dismissed: false,
  })
  return rows[0]
}

const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000
const CALENDAR_EVENT_SELECT = 'id,user_id,title,date,start_time,end_time,location,description,color,type,all_day,created_at,updated_at'

/**
 * Task 22: mirrors executeAutoTaskWrite's shape exactly (clarify/failed/
 * not_found/executed statuses, undo persistence, confirmation line). The
 * date/start_time/end_time columns it writes are built the same way
 * calendarService.ts's toInsertRow does client-side (slice a genuine UTC
 * ISO instant into date/HH:MM text) -- see zonedDateTimeToUtcIso above --
 * just resolved via the request's own IANA timeZone instead of a
 * browser's implicit local one, so an event created here reads back
 * identically through the real calendar UI.
 */
export async function executeAutoCalendarWrite(input: {
  env: Env
  userId: string
  language: Language
  intent: ParsedCalendarWriteIntent
  now: Date
  timeZone: string
}): Promise<
  // BLOCKER 3 CORRECTION: title/notes/dateTimeStart/dateTimeEnd carry the
  // row's ACTUAL, just-persisted values (converted back to UTC ISO instants
  // via the same timeZone the request itself resolved with, matching the
  // external argument shape), not an echo of the request -- see
  // executeAutoTaskWrite's own comment on this same correction.
  | { status: 'executed'; reply: string; undoId: string; undoExpiresAt: string; id: string; title: string; notes: string | null; dateTimeStart: string; dateTimeEnd: string }
  | { status: 'clarify'; reply: string }
  | { status: 'failed'; reply: string }
  | { status: 'not_found' }
> {
  const { env, userId, intent, language, now, timeZone } = input
  if (intent.dateClarificationNeeded) return { status: 'clarify', reply: 'Which exact date should I use?' }
  if (intent.kind === 'create_calendar_event') {
    if (!intent.title) return { status: 'clarify', reply: 'What should the event be called?' }
    if (!intent.startDate || !intent.startTime) return { status: 'clarify', reply: 'What date and time should the event be at?' }
    const startUtcIso = zonedDateTimeToUtcIso(intent.startDate, intent.startTime, timeZone)
    const endUtcIso = intent.endTime
      ? zonedDateTimeToUtcIso(intent.startDate, intent.endTime, timeZone)
      : new Date(new Date(startUtcIso).getTime() + DEFAULT_EVENT_DURATION_MS).toISOString()
    const rows = await supabaseWriteReturning<CalendarEventRow[]>(env, 'POST', `calendar_events?select=${CALENDAR_EVENT_SELECT}`, {
      user_id: userId,
      title: intent.title,
      date: startUtcIso.slice(0, 10),
      start_time: startUtcIso.slice(11, 16),
      end_time: endUtcIso.slice(11, 16),
      location: null,
      description: intent.notes ?? null,
      color: null,
      type: null,
      all_day: false,
    })
    const event = rows[0]
    if (!event?.id) return { status: 'failed', reply: 'I could not verify that the event was created.' }
    const alarm = await createCalendarEventAlarmIfNeeded(env, userId, event, startUtcIso)
    const undoId = `undo:${crypto.randomUUID()}`
    const expiresAt = undoExpiresAt(now)
    const undoFailure = await persistUndoOrRollback(env, { kind: 'create_calendar_event', userId, eventId: event.id, expiresAt }, undoId, language, async () => {
      await supabaseWriteNoContent(env, 'DELETE', `calendar_events?id=eq.${esc(event.id)}&user_id=eq.${esc(userId)}`)
      if (alarm?.id) await supabaseWriteNoContent(env, 'DELETE', `alarms?id=eq.${esc(alarm.id)}&user_id=eq.${esc(userId)}`)
    })
    if (undoFailure) return undoFailure
    // Task 22-fix3: event.date/event.start_time are the persisted columns,
    // sliced from a genuine UTC instant (same convention as
    // calendarService.ts's toInsertRow on the frontend) -- displaying them
    // raw silently shows UTC. Convert back to the SAME timeZone the
    // deterministic parser resolved this request with before building the
    // confirmation line.
    const localWhen = utcInstantToZonedDateAndTime(`${event.date}T${event.start_time ?? '00:00'}:00.000Z`, timeZone)
    return {
      status: 'executed',
      reply: confirmationForCalendar(language, 'create_calendar_event', event.title, localWhen.date, localWhen.time),
      undoId,
      undoExpiresAt: expiresAt,
      id: event.id,
      title: event.title,
      notes: event.description,
      // date/start_time/end_time are stored as a NAIVE SLICE of a UTC
      // instant (see this function's own header comment) -- NOT local wall
      // clock values -- so reconstructing the UTC ISO instant here is a
      // literal string join, not a zonedDateTimeToUtcIso conversion (that
      // would incorrectly treat them as local-timeZone values a second
      // time).
      dateTimeStart: `${event.date}T${event.start_time ?? '00:00'}:00.000Z`,
      dateTimeEnd: `${event.date}T${event.end_time ?? event.start_time ?? '00:00'}:00.000Z`,
    }
  }

  // Chat V2 Slice 2A: same targetId escape hatch as executeAutoTaskWrite's
  // update branch above -- see its comment.
  let before: CalendarEventRow | undefined
  if (intent.targetId) {
    const rows = await supabaseGet<CalendarEventRow[]>(env, `calendar_events?id=eq.${esc(intent.targetId)}&user_id=eq.${esc(userId)}&select=${CALENDAR_EVENT_SELECT}&limit=1`)
    before = rows[0]
    if (!before) return { status: 'not_found' }
  } else {
    const events = await supabaseGet<CalendarEventRow[]>(env, `calendar_events?user_id=eq.${esc(userId)}&select=${CALENDAR_EVENT_SELECT}`)
    const ref = intent.eventReference?.toLowerCase()
    const matches = ref ? events.filter(event => event.title.toLowerCase().includes(ref) || ref.includes(event.title.toLowerCase())) : []
    if (matches.length !== 1) return { status: matches.length > 1 ? 'clarify' : 'not_found', reply: 'Which exact event should I update?' }
    before = matches[0]
  }
  // BLOCKER 3 CORRECTION: this patch body used to ignore intent.title and
  // intent.notes entirely (a real, pre-existing bug -- see
  // executeAutoTaskWrite's own comment on the identical class of bug in its
  // update branch), and could only ever change end_time together WITH
  // start_time, never independently (an "update just the end time" request
  // silently did nothing). title/notes(description) are now applied
  // whenever specified; end_time is now computed on its own, so it applies
  // whether or not start_time also changed.
  const patch: Record<string, unknown> = {}
  if (intent.title !== undefined) patch.title = intent.title
  if (intent.notes !== undefined) patch.description = intent.notes
  if (intent.startDate !== undefined && intent.startDate !== null) patch.date = intent.startDate
  if (intent.startTime) {
    const dateForTime = intent.startDate ?? before.date
    const startUtcIso = zonedDateTimeToUtcIso(dateForTime, intent.startTime, timeZone)
    patch.date = startUtcIso.slice(0, 10)
    patch.start_time = startUtcIso.slice(11, 16)
  }
  if (intent.endTime) {
    const dateForEndTime = intent.startDate ?? before.date
    patch.end_time = zonedDateTimeToUtcIso(dateForEndTime, intent.endTime, timeZone).slice(11, 16)
  }
  const rows = await supabaseWriteReturning<CalendarEventRow[]>(env, 'PATCH', `calendar_events?id=eq.${esc(before.id)}&user_id=eq.${esc(userId)}&select=${CALENDAR_EVENT_SELECT}`, patch)
  const updated = rows[0]
  if (!updated?.id) return { status: 'failed', reply: 'I could not verify that the event was updated.' }
  const undoId = `undo:${crypto.randomUUID()}`
  const expiresAt = undoExpiresAt(now)
  const undoFailure = await persistUndoOrRollback(
    env,
    {
      kind: 'update_calendar_event',
      userId,
      eventId: before.id,
      previous: { title: before.title, date: before.date, start_time: before.start_time, end_time: before.end_time, description: before.description },
      expiresAt,
    },
    undoId,
    language,
    async () => {
      await supabaseWriteNoContent(env, 'PATCH', `calendar_events?id=eq.${esc(before.id)}&user_id=eq.${esc(userId)}`, {
        title: before.title, date: before.date, start_time: before.start_time, end_time: before.end_time, description: before.description,
      })
    },
  )
  if (undoFailure) return undoFailure
  // Task 22-fix3: same conversion as the create branch above -- see its comment.
  const localWhen = utcInstantToZonedDateAndTime(`${updated.date}T${updated.start_time ?? '00:00'}:00.000Z`, timeZone)
  return {
    status: 'executed',
    reply: confirmationForCalendar(language, 'update_calendar_event', updated.title, localWhen.date, localWhen.time),
    undoId,
    undoExpiresAt: expiresAt,
    id: updated.id,
    title: updated.title,
    notes: updated.description,
    dateTimeStart: `${updated.date}T${updated.start_time ?? '00:00'}:00.000Z`,
    dateTimeEnd: `${updated.date}T${updated.end_time ?? updated.start_time ?? '00:00'}:00.000Z`,
  }
}

/**
 * Task 28: mirrors executeAutoTaskWrite/executeAutoCalendarWrite's shape
 * (clarify/failed/executed statuses, undo persistence, confirmation line).
 * Create-only, so there is no not_found/matching branch to mirror --
 * every code path either produces a well-formed insert or asks a specific
 * clarifying question. In production this is only ever reachable through a
 * direct unit-test call: resolveServerFlowWriteMode hard-clamps the
 * 'finance' domain to never resolve 'auto' (see its own comment), so
 * index.ts's `mode === 'auto'` dispatch branch never calls this function
 * for a real request today. Built anyway, mirroring the existing triads
 * exactly, per this task's own instruction -- see the task 28 report for
 * this disclosed as a finding, not a bug.
 */
export async function executeAutoFinanceWrite(input: {
  env: Env
  userId: string
  language: Language
  intent: ParsedFinanceWriteIntent
  now: Date
}): Promise<{ status: 'executed'; reply: string; undoId: string; undoExpiresAt: string } | { status: 'clarify'; reply: string } | { status: 'failed'; reply: string }> {
  const { env, userId, intent, language, now } = input
  if (intent.iban && intent.ibanValid === false) {
    return { status: 'clarify', reply: 'That IBAN does not look valid. Please double-check it and try again.' }
  }
  if (intent.amountClarificationNeeded || intent.amount === undefined) {
    return { status: 'clarify', reply: 'How much was the transaction for?' }
  }
  if (!intent.direction) {
    return { status: 'clarify', reply: 'Was that income or an expense?' }
  }
  const transactionDate = intent.transactionDate ?? dateKey(now, 'UTC')
  const rows = await supabaseWriteReturning<FinanceTransactionRow[]>(env, 'POST', 'finance_transactions?select=id,user_id,type,amount,category,date,notes,created_at,updated_at', {
    user_id: userId,
    type: intent.direction,
    amount: intent.amount,
    // No dedicated category parser (out of this task's stated scope) --
    // same fallback the shared registry's buildHandlerInput uses for the
    // ask-approved path, kept identical across both write paths on purpose.
    category: 'Flow AI',
    date: transactionDate,
    notes: intent.description ?? null,
  })
  const transaction = rows[0]
  if (!transaction?.id) return { status: 'failed', reply: 'I could not verify that the transaction was recorded.' }
  const undoId = `undo:${crypto.randomUUID()}`
  const expiresAt = undoExpiresAt(now)
  const undoFailure = await persistUndoOrRollback(env, { kind: 'create_finance_transaction', userId, transactionId: transaction.id, expiresAt }, undoId, language, async () => {
    await supabaseWriteNoContent(env, 'DELETE', `finance_transactions?id=eq.${esc(transaction.id)}&user_id=eq.${esc(userId)}`)
  })
  if (undoFailure) return undoFailure
  return {
    status: 'executed',
    reply: confirmationForFinance(language, transaction.type, transaction.amount, intent.currency, transactionDate),
    undoId,
    undoExpiresAt: expiresAt,
  }
}

/**
 * Task 22: renamed from undoAutoTaskWrite (only call site was index.ts,
 * updated there too) -- now dispatches on the persisted kind to undo
 * either a task or calendar_events write, since the undo record itself
 * (not the caller) is what determines which domain to act on.
 */
export async function undoAutoWrite(env: Env, userId: string, undoId: string, now: Date): Promise<boolean> {
  const entry = await consumeUndoRecord(env, userId, undoId, now)
  if (!entry || entry.userId !== userId) return false
  if (entry.kind === 'create_task') {
    await supabaseWriteReturning<TaskRow[]>(env, 'DELETE', `tasks?id=eq.${esc(entry.taskId)}&user_id=eq.${esc(userId)}&select=id`)
    return true
  }
  if (entry.kind === 'update_task') {
    await supabaseWriteReturning<TaskRow[]>(env, 'PATCH', `tasks?id=eq.${esc(entry.taskId)}&user_id=eq.${esc(userId)}&select=id`, {
      title: entry.previous.title,
      notes: entry.previous.notes,
      due_date: entry.previous.due_date,
      completed: entry.previous.completed,
    })
    return true
  }
  if (entry.kind === 'create_calendar_event') {
    await supabaseWriteReturning<CalendarEventRow[]>(env, 'DELETE', `calendar_events?id=eq.${esc(entry.eventId)}&user_id=eq.${esc(userId)}&select=id`)
    return true
  }
  if (entry.kind === 'create_finance_transaction') {
    await supabaseWriteReturning<FinanceTransactionRow[]>(env, 'DELETE', `finance_transactions?id=eq.${esc(entry.transactionId)}&user_id=eq.${esc(userId)}&select=id`)
    return true
  }
  if (entry.kind === 'import_bank_statement') {
    // Task 45c: one bulk DELETE reverses the whole batch -- PostgREST's
    // `id=in.(...)` filter is a single Postgres statement, atomic the same
    // way the original bulk INSERT was (executeBatchFinanceImport below).
    // finance_import_rows' bookkeeping rows are cleaned up in the SAME
    // undo call so an undone import doesn't leave orphaned duplicate-hash
    // entries that would silently block a legitimate re-import of the same
    // statement.
    const idList = entry.transactionIds.map(esc).join(',')
    await supabaseWriteReturning<FinanceTransactionRow[]>(env, 'DELETE', `finance_transactions?id=in.(${idList})&user_id=eq.${esc(userId)}&select=id`)
    await supabaseWriteNoContent(env, 'DELETE', `finance_import_rows?transaction_id=in.(${idList})&user_id=eq.${esc(userId)}`)
    return true
  }
  await supabaseWriteReturning<CalendarEventRow[]>(env, 'PATCH', `calendar_events?id=eq.${esc(entry.eventId)}&user_id=eq.${esc(userId)}&select=id`, {
    title: entry.previous.title,
    date: entry.previous.date,
    start_time: entry.previous.start_time,
    end_time: entry.previous.end_time,
    description: entry.previous.description,
  })
  return true
}

// ---------------------------------------------------------------------------
// Task 45c, ADR-0017 -- bank-statement batch import. Deliberately NOT a
// parse<Domain>WriteIntent/assemble<Domain>WriteIntent/execute<Domain>Auto-
// Write triad like task/calendar/finance above: there is no free-text
// intent to resolve here at all (see shared/writeIntentRegistry.ts's own
// import_bank_statement entry comment, and intentValidator.ts's explicit
// guard, for why this is UI-only and never chat-resolved). What this
// section DOES share with the triads above is everything downstream of
// "an intent is already decided": the same service_role Supabase I/O
// helpers, the same persist-first undo pattern (persistUndoOrRollback), and
// the same registry-derived undo-kind bookkeeping.
// ---------------------------------------------------------------------------

interface FinanceImportRowRecord {
  row_hash: string
}

/**
 * Looks up which of `rowHashes` already exist in finance_import_rows for
 * this user -- i.e. which parsed rows are duplicates of an already-imported
 * statement row. Runs fresh on every call (both /finance/import-batch/preview
 * and /finance/import-batch/commit call this independently); nothing about
 * a duplicate decision is ever cached or trusted from a prior call. Returns
 * an empty set (not an error) for an empty input, since there is nothing to
 * look up.
 */
export async function checkDuplicateRows(env: Env, userId: string, rowHashes: readonly string[]): Promise<Set<string>> {
  if (rowHashes.length === 0) return new Set()
  const hashList = rowHashes.map(esc).join(',')
  const rows = await supabaseGet<FinanceImportRowRecord[]>(
    env,
    `finance_import_rows?user_id=eq.${esc(userId)}&row_hash=in.(${hashList})&select=row_hash`,
  ).catch(() => [] as FinanceImportRowRecord[])
  return new Set(rows.map((row) => row.row_hash))
}

// Task 45c PART B (Ruling 3, PO): the duplicate-exclusion decision made at
// preview time must be LOCKED, not re-derived at commit time. Re-deriving
// independently (the task 45c PART A draft's original design: both
// endpoints re-parse the same file bytes and re-run checkDuplicateRows
// from scratch) would let the approved-vs-executed row set silently
// diverge from unrelated DB activity between the two calls -- exactly the
// "what was approved is not what runs" gap Ruling 1 already rules out for
// mid-batch failure, just from a different cause. finance_import_batches
// is a short-lived staging table: preview persists the post-quarantine,
// post-duplicate-exclusion row set (exactly what selectImportableRows
// already computes) under a server-issued batchId; commit loads that EXACT
// set by batchId instead of re-parsing or re-excluding anything. batchId is
// the same opaque value shared/writeIntentRegistry.ts's import_bank_-
// statement entry already documents as the tool's only target field --
// "an opaque server-issued reference to an already Worker-parsed, already
// Worker-validated batch" -- this table is what makes that description
// literally true rather than aspirational.
//
// This is a distinct window from FLOW_WRITE_UNDO_WINDOW_MS above: that one
// bounds how long an EXECUTED write stays undoable; this one bounds how
// long an APPROVED-BUT-NOT-YET-EXECUTED batch stays commitable. 30 minutes
// is generous review time without leaving stale batches around indefinitely.
export const IMPORT_BATCH_APPROVAL_WINDOW_MS = 30 * 60 * 1000

interface FinanceImportBatchRow {
  id: string
  rows: ParsedBankRow[]
  expires_at: string
  consumed_at: string | null
}

/**
 * Persists the LOCKED, already-decided importable row set from a preview
 * call, returning the batchId the client will later pass to
 * loadImportBatch at commit time. Called once per /finance/import-batch/
 * preview request that has at least one importable row -- see this file's
 * own header comment on this section for why the set must be locked here
 * rather than recomputed later.
 */
export async function persistImportBatch(
  env: Env,
  userId: string,
  rows: readonly ParsedBankRow[],
  now: Date,
): Promise<{ batchId: string; expiresAt: string }> {
  const batchId = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + IMPORT_BATCH_APPROVAL_WINDOW_MS).toISOString()
  await supabaseWriteNoContent(env, 'POST', 'finance_import_batches', {
    id: batchId,
    user_id: userId,
    rows: rows as unknown as Record<string, unknown>,
    expires_at: expiresAt,
  })
  return { batchId, expiresAt }
}

/**
 * Loads the locked row set for a previously-issued batchId, or null if it
 * does not exist for this user, has already been consumed (a prior commit
 * attempt succeeded, or hit a duplicate collision -- see
 * markImportBatchConsumed's call sites), or has expired. Never re-derives
 * or filters the row set -- what is returned is byte-for-byte what
 * persistImportBatch stored.
 */
export async function loadImportBatch(
  env: Env,
  userId: string,
  batchId: string,
  now: Date,
): Promise<{ rows: ParsedBankRow[] } | null> {
  const result = await supabaseGet<FinanceImportBatchRow[]>(
    env,
    `finance_import_batches?id=eq.${esc(batchId)}&user_id=eq.${esc(userId)}&select=id,rows,expires_at,consumed_at&limit=1`,
  ).catch(() => [] as FinanceImportBatchRow[])
  const row = result[0]
  if (!row) return null
  if (row.consumed_at) return null
  if (row.expires_at < now.toISOString()) return null
  return { rows: row.rows }
}

/**
 * Marks a batch as consumed so it can never be committed again. Called
 * from two DISTINCT terminal outcomes, deliberately not from a transient
 * infrastructure failure (Ruling 1: "the same proposal retryable" means a
 * failed executeBatchFinanceImport call must leave the batch commitable
 * again with the same batchId):
 *   1. executeBatchFinanceImport returned status 'executed' -- the batch
 *      was spent on a real write; committing it again would double-import.
 *   2. A duplicate collision was found at commit time (see
 *      handleFinanceImportBatchCommit) -- the locked row set is now stale
 *      (something else imported an overlapping row since preview), so
 *      retrying with the SAME locked set would just collide again; the
 *      correct recovery is a fresh preview, not a retry.
 */
export async function markImportBatchConsumed(env: Env, batchId: string, now: Date): Promise<void> {
  await supabaseWriteNoContent(env, 'PATCH', `finance_import_batches?id=eq.${esc(batchId)}`, {
    consumed_at: now.toISOString(),
  })
}

export interface BatchImportExecutionResult {
  status: 'executed'
  insertedCount: number
  transactionIds: string[]
  undoId: string
  undoExpiresAt: string
}

export interface BatchImportExecutionFailure {
  status: 'failed'
  reply: string
}

/**
 * Inserts every row in `rows` as one PostgREST bulk POST (a single Postgres
 * statement -- atomic by construction: either all rows land or none do,
 * never a partial batch). Persists ONE undo record covering the whole
 * batch (persist-first, same compensating-rollback semantics as every
 * other domain's own execute*AutoWrite above -- if the undo record itself
 * fails to persist, the just-inserted rows AND their finance_import_rows
 * bookkeeping rows are rolled back and this reports 'failed' honestly,
 * never a false success). Caller (the /finance/import-batch/commit HTTP
 * handler) is responsible for recording the agent_proposal_outcomes ledger
 * row -- that is a reporting concern, not an execution concern, and stays
 * out of this function per ADR-0016's fire-and-forget principle (a ledger
 * write must never gate or be gated by the actual write).
 */
export async function executeBatchFinanceImport(
  env: Env,
  userId: string,
  rows: readonly ParsedBankRow[],
  now: Date,
): Promise<BatchImportExecutionResult | BatchImportExecutionFailure> {
  if (rows.length === 0) {
    return { status: 'failed', reply: 'No importable rows in this batch.' }
  }

  let insertedRows: FinanceTransactionRow[]
  try {
    insertedRows = await supabaseWriteReturning<FinanceTransactionRow[]>(
      env,
      'POST',
      'finance_transactions?select=id,user_id,type,amount,category,date,notes,created_at,updated_at',
      rows.map((row) => ({
        user_id: userId,
        type: row.direction,
        amount: row.amount,
        // No dedicated category parser for CAMT rows (out of Slice 1/2's
        // stated scope, same fallback convention every other finance write
        // path in this file already uses) -- "CSV mit Kategorien" rows keep
        // their own Kategorie value when present.
        category: row.category ?? 'Bank Import',
        date: row.date,
        notes: row.purpose || null,
      })),
    )
  } catch (err) {
    // Nothing to roll back -- this is the FIRST write in the chain, so a
    // failure here means nothing was inserted at all. Caught explicitly
    // (unlike letting it propagate) so the HTTP handler can report a clean
    // 502 instead of an unhandled worker exception -- ADR-0012's "execution
    // failure is reported honestly" rule applies to infrastructure faults
    // too, not just domain-level rejections.
    console.error('[BankImport] bulk finance_transactions insert failed:', (err as Error).message)
    return { status: 'failed', reply: 'Could not record the transactions.' }
  }

  const transactionIds = insertedRows.map((row) => row.id).filter(Boolean)
  if (transactionIds.length !== rows.length) {
    // PostgREST returned fewer rows than were sent -- treat as a failed
    // insert rather than silently accepting a partial result; nothing was
    // meant to be undone here since a genuine partial bulk insert should
    // not be possible (see this function's own header comment), so this
    // branch exists only to fail loudly if that assumption is ever wrong,
    // not to compensate for it.
    return { status: 'failed', reply: 'Could not verify that all transactions were recorded.' }
  }

  const importBatchId = crypto.randomUUID()
  const bookkeepingRows = rows.map((row, i) => ({
    user_id: userId,
    row_hash: row.rowHash,
    transaction_id: transactionIds[i],
    batch_id: importBatchId,
  }))

  const undoId = `undo:${crypto.randomUUID()}`
  const expiresAt = new Date(now.getTime() + FLOW_WRITE_UNDO_WINDOW_MS).toISOString()
  const rollbackInsertedRows = async () => {
    const idList = transactionIds.map(esc).join(',')
    await supabaseWriteNoContent(env, 'DELETE', `finance_transactions?id=in.(${idList})&user_id=eq.${esc(userId)}`)
  }

  try {
    await supabaseWriteNoContent(env, 'POST', 'finance_import_rows', bookkeepingRows)
  } catch (err) {
    console.error('[BankImport] finance_import_rows bookkeeping insert failed, rolling back the batch:', (err as Error).message)
    try {
      await rollbackInsertedRows()
    } catch (rollbackErr) {
      console.error('[BankImport] CRITICAL: compensating rollback ALSO failed after a bookkeeping-insert failure -- transactions may be orphaned:', (rollbackErr as Error).message)
    }
    return { status: 'failed', reply: 'Could not record the import; no transactions were kept.' }
  }

  const undoFailure = await persistUndoOrRollback(
    env,
    { kind: 'import_bank_statement', userId, transactionIds, expiresAt },
    undoId,
    'en',
    async () => {
      await rollbackInsertedRows()
      const idList = transactionIds.map(esc).join(',')
      await supabaseWriteNoContent(env, 'DELETE', `finance_import_rows?transaction_id=in.(${idList})&user_id=eq.${esc(userId)}`)
    },
  )
  if (undoFailure) return { status: 'failed', reply: undoFailure.reply }

  return {
    status: 'executed',
    insertedCount: transactionIds.length,
    transactionIds,
    undoId,
    undoExpiresAt: expiresAt,
  }
}
