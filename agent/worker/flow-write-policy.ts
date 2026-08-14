import type { Env, Language } from './types'
import { supabaseGet } from './context-builder'
import { callGeminiForTaskTitle } from './task-title-extraction'

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

type UndoEntry =
  | { kind: 'create_task'; userId: string; taskId: string; expiresAt: string }
  | { kind: 'update_task'; userId: string; taskId: string; previous: Pick<TaskRow, 'title' | 'notes' | 'due_date' | 'completed'>; expiresAt: string }
  | { kind: 'create_calendar_event'; userId: string; eventId: string; expiresAt: string }
  | { kind: 'update_calendar_event'; userId: string; eventId: string; previous: Pick<CalendarEventRow, 'title' | 'date' | 'start_time' | 'end_time' | 'description'>; expiresAt: string }

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
  return entry.kind === 'create_task' || entry.kind === 'update_task' ? entry.taskId : entry.eventId
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
  kind: 'create_task' | 'update_task' | 'create_calendar_event' | 'update_calendar_event'
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
  return mode === 'auto' || mode === 'ask' || mode === 'off' ? mode : defaultFlowWriteMode(domain, action)
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

export type WriteDomainSignal = 'task' | 'calendar' | 'ambiguous' | 'none'

/**
 * The single deterministic routing decision -- see file header above.
 * Exported for direct unit testing.
 */
export function detectWriteDomainSignal(message: string, now: Date, timeZone: string): WriteDomainSignal {
  const taskTrigger = parseTaskWriteIntent(message, now, timeZone) !== null
  const calendarTrigger = isCalendarWriteTrigger(message)
  if (!taskTrigger && !calendarTrigger) return 'none'
  if (taskTrigger && calendarTrigger) return 'ambiguous'
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
export function detectContinuationDomain(recentTurns: RecentChatTurn[], now: Date, timeZone: string): 'task' | 'calendar' | null {
  const recentUserMessages = recentTurns
    .filter(turn => turn.role === 'user')
    .map(turn => turn.content)
    .slice(-6)
    .reverse()
  for (const content of recentUserMessages) {
    const signal = detectWriteDomainSignal(content, now, timeZone)
    if (signal === 'task' || signal === 'calendar') return signal
  }
  return null
}

export function parseTaskWriteIntent(message: string, now: Date, timeZone: string): ParsedTaskWriteIntent | null {
  const create = /\b(create|add|set up|erstelle|hinzuf[Ã¼u]gen)\b.{0,50}\b(task|todo|aufgabe)\b/i.test(message) ||
    /(?:ÛŒÚ©|ÙŠÙ‡|ÛŒÙ‡)?\s*(?:ØªØ³Ú©|ÙˆØ¸ÛŒÙÙ‡|Ú©Ø§Ø±).{0,50}(?:Ø¨Ø³Ø§Ø²|Ø§ÛŒØ¬Ø§Ø¯ Ú©Ù†|Ø§Ø¶Ø§ÙÙ‡ Ú©Ù†)/i.test(message)
  const cleanPersianCreate = /(?:\u06cc\u06a9|\u06a9|\u06cc\u0647)?\s*(?:\u062a\u0633\u06a9|\u0648\u0638\u06cc\u0641\u0647|\u06a9\u0627\u0631).{0,50}(?:\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646)/i.test(message)
  const cleanMixedPersianCreate = /(?:\u06cc\u06a9|\u06a9|\u06cc\u0647)?\s*(?:task|todo).{0,50}(?:\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646)/i.test(message)
  const update = /\b(update|edit|change|reschedule|aktualisiere|bearbeite|verschiebe)\b.{0,60}\b(task|todo|aufgabe)\b/i.test(message)
  if (!create && !cleanPersianCreate && !cleanMixedPersianCreate && !update) return null

  const date = parseDeterministicDueDate(message, now, timeZone)
  const timeOfDay = parseDeterministicTimeOfDay(message)
  const quoted = message.match(/["'Â«â€œ](.+?)["'Â»â€]/)?.[1]?.trim()
  if (create || cleanPersianCreate || cleanMixedPersianCreate) {
    const title = extractTaskTitle(message)
    return { kind: 'create_task', title: title || undefined, notes: createTaskNotes(message, timeOfDay), dueDate: date.value, timeOfDay, dateClarificationNeeded: date.clarificationNeeded }
  }
  return { kind: 'update_task', taskReference: quoted, dueDate: date.value, timeOfDay, dateClarificationNeeded: date.clarificationNeeded }
}

function confirmation(language: Language, kind: 'create_task' | 'update_task', title: string, dueDate: string | null | undefined, timeOfDay?: string) {
  const due = dueDate ? ` — due ${dueDate}` : ''
  const time = timeOfDay ? ` — time mentioned ${timeOfDay}` : ''
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

  const recentUserMessages = recentTurns
    .filter(turn => turn.role === 'user')
    .map(turn => turn.content)
    .slice(-6)
    .reverse()
  const previous = recentUserMessages
    .map(content => parseTaskWriteIntent(content, now, timeZone))
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

  const recentUserMessages = recentTurns
    .filter(turn => turn.role === 'user')
    .map(turn => turn.content)
    .slice(-6)
    .reverse()
  const previous = recentUserMessages
    .map(content => parseCalendarWriteIntent(content, now, timeZone))
    .find((intent): intent is ParsedCalendarWriteIntent => Boolean(intent && intent.kind === 'create_calendar_event'))
  return previous ? mergeCalendarIntent(previous, message, now, timeZone) : null
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
    await createTaskAlarmIfNeeded(env, userId, task, intent.timeOfDay, timeZone)
    const undoId = `undo:${crypto.randomUUID()}`
    const expiresAt = undoExpiresAt(now)
    await persistUndoRecord(env, { kind: 'create_task', userId, taskId: task.id, expiresAt }, undoId)
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
  await persistUndoRecord(env, { kind: 'update_task', userId, taskId: before.id, previous: { title: before.title, notes: before.notes, due_date: before.due_date, completed: before.completed }, expiresAt }, undoId)
  return { status: 'executed', reply: confirmation(language, 'update_task', updated.title, updated.due_date, intent.timeOfDay), undoId, undoExpiresAt: expiresAt }
}

function confirmationForCalendar(
  language: Language,
  kind: 'create_calendar_event' | 'update_calendar_event',
  title: string,
  startDate: string | null | undefined,
  startTime: string | undefined,
) {
  const when = startDate && startTime ? ` — ${startDate} ${startTime}` : startDate ? ` — ${startDate}` : ''
  if (language === 'de') return `✓ Ereignis ${kind === 'create_calendar_event' ? 'erstellt' : 'aktualisiert'}: ${title}${when}`
  if (language === 'fa') return `✓ رویداد ${kind === 'create_calendar_event' ? 'ایجاد شد' : 'به‌روزرسانی شد'}: ${title}${when}`
  return `✓ Event ${kind === 'create_calendar_event' ? 'created' : 'updated'}: ${title}${when}`
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
    await createCalendarEventAlarmIfNeeded(env, userId, event, startUtcIso)
    const undoId = `undo:${crypto.randomUUID()}`
    const expiresAt = undoExpiresAt(now)
    await persistUndoRecord(env, { kind: 'create_calendar_event', userId, eventId: event.id, expiresAt }, undoId)
    return { status: 'executed', reply: confirmationForCalendar(language, 'create_calendar_event', event.title, event.date, event.start_time ?? undefined), undoId, undoExpiresAt: expiresAt }
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
  await persistUndoRecord(env, {
    kind: 'update_calendar_event',
    userId,
    eventId: before.id,
    previous: { title: before.title, date: before.date, start_time: before.start_time, end_time: before.end_time, description: before.description },
    expiresAt,
  }, undoId)
  return { status: 'executed', reply: confirmationForCalendar(language, 'update_calendar_event', updated.title, updated.date, updated.start_time ?? undefined), undoId, undoExpiresAt: expiresAt }
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
  await supabaseWriteReturning<CalendarEventRow[]>(env, 'PATCH', `calendar_events?id=eq.${esc(entry.eventId)}&user_id=eq.${esc(userId)}&select=id`, {
    title: entry.previous.title,
    date: entry.previous.date,
    start_time: entry.previous.start_time,
    end_time: entry.previous.end_time,
    description: entry.previous.description,
  })
  return true
}
