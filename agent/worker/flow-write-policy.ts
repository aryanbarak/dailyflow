import type { Env, Language } from './types'
import { supabaseGet } from './context-builder'
import { callGeminiForTaskTitle } from './task-title-extraction'
import { findWriteIntentDescriptor, writeIntentRegistry, type WriteIntentType } from '../../shared/writeIntentRegistry'

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

function esc(value: string) {
  return encodeURIComponent(value)
}

async function supabaseWriteReturning<T>(env: Env, method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<T> {
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

async function supabaseWriteNoContent(env: Env, method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<void> {
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
function undoRecordId(entry: UndoEntry): string {
  if (entry.kind === 'create_task' || entry.kind === 'update_task') return entry.taskId
  if (entry.kind === 'create_finance_transaction') return entry.transactionId
  return entry.eventId
}

async function persistUndoRecord(env: Env, entry: UndoEntry, undoId: string) {
  const payload = entry.kind === 'update_task' || entry.kind === 'update_calendar_event' ? { previous: entry.previous } : {}
  await supabaseWriteNoContent(env, 'POST', 'flow_write_undo_records', {
    id: undoUuid(undoId),
    user_id: entry.userId,
    kind: entry.kind,
    task_id: undoRecordId(entry),
    payload,
    expires_at: entry.expiresAt,
  })
}

interface UndoRecordRow {
  id: string
  user_id: string
  kind: 'create_task' | 'update_task' | 'create_calendar_event' | 'update_calendar_event' | 'create_finance_transaction'
  task_id: string
  payload: {
    previous?:
      | Pick<TaskRow, 'title' | 'notes' | 'due_date' | 'completed'>
      | Pick<CalendarEventRow, 'title' | 'date' | 'start_time' | 'end_time' | 'description'>
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
  if (row.kind === 'update_task') {
    const previous = row.payload?.previous as Pick<TaskRow, 'title' | 'notes' | 'due_date' | 'completed'> | undefined
    if (!previous) return null
    return { kind: 'update_task', userId, taskId: row.task_id, previous, expiresAt: row.expires_at }
  }
  const previous = row.payload?.previous as Pick<CalendarEventRow, 'title' | 'date' | 'start_time' | 'end_time' | 'description'> | undefined
  if (!previous) return null
  return { kind: 'update_calendar_event', userId, eventId: row.task_id, previous, expiresAt: row.expires_at }
}

export function defaultFlowWriteMode(domain: string, action: string): FlowWriteMode {
  if (action === 'delete') return 'ask'
  if (domain === 'finance') return 'ask'
  if ((domain === 'tasks' || domain === 'calendar') && (action === 'create' || action === 'update')) return 'auto'
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

/**
 * Strips stray leading/trailing punctuation and digit fragments -- e.g. a
 * leftover "؟۰۰" or ": " artifact at the edge of an otherwise-good title.
 * Exported for direct unit testing.
 */
export function cleanTitleEdges(value: string): string {
  return normalizeDigits(value)
    .trim()
    .replace(/^[\s:：\-–—.,،؟?]+/, '')
    .replace(/[\s:：\-–—.,،؟?]+[0-9]*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
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

/**
 * The single gate every candidate title -- model-proposed or pattern-
 * fallback -- must pass before it can reach the database. Rejects (returns
 * undefined) when the candidate is empty, too long for a subject line, or
 * substantially the whole user message; never truncates or rewrites a
 * candidate into something the model/pattern never actually said.
 * Exported for direct unit testing.
 */
export function validateCandidateTitle(candidate: string | undefined, rawMessage: string, maxLength = MAX_MODEL_TITLE_LENGTH): string | undefined {
  if (!candidate) return undefined
  const cleaned = cleanTitleEdges(candidate)
  if (!cleaned) return undefined
  if (cleaned.length > maxLength) return undefined
  if (isTitleSubstantiallyTheMessage(cleaned, rawMessage)) return undefined
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

function resolvesToCalendarDomain(message: string, now: Date, timeZone: string): boolean {
  if (isCalendarWriteTrigger(message)) return true
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
  const update = /\b(update|edit|change|reschedule|aktualisiere|bearbeite|verschiebe)\b.{0,60}\b(task|todo|aufgabe)\b/i.test(message)
  const implicitCreate = !create && !cleanPersianCreate && !cleanMixedPersianCreate && !update &&
    isImplicitScheduleStatement(message) && hasResolvedDateOrTimeSignal(message, now, timeZone)
  if (!create && !cleanPersianCreate && !cleanMixedPersianCreate && !update && !implicitCreate) return null

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
  const isUpdate = /\b(update|edit|change|reschedule|move|aktualisiere|bearbeite|verschiebe)\b/i.test(message) ||
    /(?:به‌روزرسانی کن|ویرایش کن|جابجا کن|تغییر بده)/.test(message)

  const date = parseDeterministicDueDate(message, now, timeZone)
  const { start, end } = parseDeterministicTimeRange(message)
  const quoted = message.match(/["'«“](.+?)["'»”]/)?.[1]?.trim()

  if (!isUpdate) {
    const title = extractTaskTitle(message)
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

function parseFinanceDirection(message: string): 'income' | 'expense' | undefined {
  const text = message.toLowerCase()
  // "got paid"/"received a payment" is income; a bare "pay"/"paid"/"send"/
  // "transfer" (no "got"/"received" framing) is money going out, the
  // common case for a single-user app recording the user's OWN transactions.
  if (/\bgot paid\b/.test(text) || /\b(income|earned|received|salary)\b/.test(text) || /\b(einnahme|erhalten|gehalt)\b/.test(text) || /درآمد|دریافت|حقوق/.test(message)) return 'income'
  if (/\b(expense|spent|paid|pay|bought|cost|send|sent|transfer)\b/.test(text) || /\b(ausgabe|bezahlt|zahle|gekauft|kosten|sende|überweise)\b/.test(text) || /هزینه|خرید|پرداخت|بفرست/.test(message)) return 'expense'
  return undefined
}

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
}): Promise<{ status: 'executed'; reply: string; undoId: string; undoExpiresAt: string } | { status: 'clarify'; reply: string } | { status: 'failed'; reply: string } | { status: 'not_found' }> {
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
    return { status: 'executed', reply: confirmation(language, 'create_task', task.title, task.due_date, intent.timeOfDay), undoId, undoExpiresAt: expiresAt }
  }

  const tasks = await supabaseGet<TaskRow[]>(env, `tasks?user_id=eq.${esc(userId)}&completed=eq.false&select=id,user_id,title,notes,due_date,completed,created_at,updated_at`)
  const ref = intent.taskReference?.toLowerCase()
  const matches = ref ? tasks.filter(task => task.title.toLowerCase().includes(ref) || ref.includes(task.title.toLowerCase())) : []
  if (matches.length !== 1) return { status: matches.length > 1 ? 'clarify' : 'not_found', reply: 'Which exact task should I update?' }
  const before = matches[0]
  const rows = await supabaseWriteReturning<TaskRow[]>(env, 'PATCH', `tasks?id=eq.${esc(before.id)}&user_id=eq.${esc(userId)}&select=id,user_id,title,notes,due_date,completed,created_at,updated_at`, {
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
    async () => {
      await supabaseWriteNoContent(env, 'PATCH', `tasks?id=eq.${esc(before.id)}&user_id=eq.${esc(userId)}`, { due_date: before.due_date })
    },
  )
  if (undoFailure) return undoFailure
  return { status: 'executed', reply: confirmation(language, 'update_task', updated.title, updated.due_date, intent.timeOfDay), undoId, undoExpiresAt: expiresAt }
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
}): Promise<{ status: 'executed'; reply: string; undoId: string; undoExpiresAt: string } | { status: 'clarify'; reply: string } | { status: 'failed'; reply: string } | { status: 'not_found' }> {
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
    return { status: 'executed', reply: confirmationForCalendar(language, 'create_calendar_event', event.title, localWhen.date, localWhen.time), undoId, undoExpiresAt: expiresAt }
  }

  const events = await supabaseGet<CalendarEventRow[]>(env, `calendar_events?user_id=eq.${esc(userId)}&select=${CALENDAR_EVENT_SELECT}`)
  const ref = intent.eventReference?.toLowerCase()
  const matches = ref ? events.filter(event => event.title.toLowerCase().includes(ref) || ref.includes(event.title.toLowerCase())) : []
  if (matches.length !== 1) return { status: matches.length > 1 ? 'clarify' : 'not_found', reply: 'Which exact event should I update?' }
  const before = matches[0]
  const patch: Record<string, unknown> = {}
  if (intent.startDate !== undefined && intent.startDate !== null) patch.date = intent.startDate
  if (intent.startTime) {
    const dateForTime = intent.startDate ?? before.date
    const startUtcIso = zonedDateTimeToUtcIso(dateForTime, intent.startTime, timeZone)
    patch.date = startUtcIso.slice(0, 10)
    patch.start_time = startUtcIso.slice(11, 16)
    if (intent.endTime) patch.end_time = zonedDateTimeToUtcIso(dateForTime, intent.endTime, timeZone).slice(11, 16)
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
  return { status: 'executed', reply: confirmationForCalendar(language, 'update_calendar_event', updated.title, localWhen.date, localWhen.time), undoId, undoExpiresAt: expiresAt }
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
  await supabaseWriteReturning<CalendarEventRow[]>(env, 'PATCH', `calendar_events?id=eq.${esc(entry.eventId)}&user_id=eq.${esc(userId)}&select=id`, {
    title: entry.previous.title,
    date: entry.previous.date,
    start_time: entry.previous.start_time,
    end_time: entry.previous.end_time,
    description: entry.previous.description,
  })
  return true
}
