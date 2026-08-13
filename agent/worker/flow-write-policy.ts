import type { Env, Language } from './types'
import { supabaseGet } from './context-builder'

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

type UndoEntry =
  | { kind: 'create_task'; userId: string; taskId: string; expiresAt: string }
  | { kind: 'update_task'; userId: string; taskId: string; previous: Pick<TaskRow, 'title' | 'notes' | 'due_date' | 'completed'>; expiresAt: string }

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

async function persistUndoRecord(env: Env, entry: UndoEntry, undoId: string) {
  const payload = entry.kind === 'update_task' ? { previous: entry.previous } : {}
  await supabaseWriteNoContent(env, 'POST', 'flow_write_undo_records', {
    id: undoUuid(undoId),
    user_id: entry.userId,
    kind: entry.kind,
    task_id: entry.taskId,
    payload,
    expires_at: entry.expiresAt,
  })
}

interface UndoRecordRow {
  id: string
  user_id: string
  kind: 'create_task' | 'update_task'
  task_id: string
  payload: { previous?: Pick<TaskRow, 'title' | 'notes' | 'due_date' | 'completed'> } | null
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
  const previous = row.payload?.previous
  if (!previous) return null
  return { kind: 'update_task', userId, taskId: row.task_id, previous, expiresAt: row.expires_at }
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

function extractTaskTitle(message: string) {
  const normalized = normalizeDigits(message)
  const quoted = message.match(/["'Â«â€œ](.+?)["'Â»â€]/)?.[1]?.trim()
  if (quoted) return boundText(quoted, 80)

  const persianSubject = normalized.match(/\u06a9\u0647\s+(.+?)\s+(?:\u062f\u0627\u0631\u0645|\u062f\u0627\u0631\u06cc|\u062f\u0627\u0631\u062f|\u0628\u0627\u0634\u0647)(?:[.ØŒ,]|$)/)
  if (persianSubject?.[1]) return boundText(removeDateAndTimePhrases(persianSubject[1]), 80)

  const englishSubject = normalized.match(/\b(?:that|because)\s+i\s+(?:have|need to|need)\s+(.+?)(?:[.,]|$)/i)
  if (englishSubject?.[1]) return boundText(removeDateAndTimePhrases(englishSubject[1]), 80)

  const germanSubject = normalized.match(/\b(?:dass|weil)\s+ich\s+(.+?)\s+(?:habe|machen muss|muss)(?:[.,]|$)/i)
  if (germanSubject?.[1]) return boundText(removeDateAndTimePhrases(germanSubject[1]), 80)

  return boundText(removeDateAndTimePhrases(
    normalized
      .replace(/\b(create|add|set up|task|todo|erstelle|aufgabe|hinzuf[Ã¼u]gen)\b/gi, ' ')
      .replace(/(?:\u06cc\u06a9|\u06a9|ÛŒÙ‡)?\s*(?:\u062a\u0633\u06a9|\u0648\u0638\u06cc\u0641\u0647|\u06a9\u0627\u0631).{0,12}?(?:\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646)/g, ' '),
  ), 80)
}

function createTaskNotes(message: string, timeOfDay?: string) {
  const lines = [`Original request: ${message}`]
  if (timeOfDay) lines.push(`Time mentioned: ${timeOfDay}`)
  return lines.join('\n')
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

export function parseTaskWriteIntent(message: string, now: Date, timeZone: string): ParsedTaskWriteIntent | null {
  const create = /\b(create|add|set up|erstelle|hinzuf[Ã¼u]gen)\b.{0,50}\b(task|todo|aufgabe)\b/i.test(message) ||
    /(?:ÛŒÚ©|ÙŠÙ‡|ÛŒÙ‡)?\s*(?:ØªØ³Ú©|ÙˆØ¸ÛŒÙÙ‡|Ú©Ø§Ø±).{0,50}(?:Ø¨Ø³Ø§Ø²|Ø§ÛŒØ¬Ø§Ø¯ Ú©Ù†|Ø§Ø¶Ø§ÙÙ‡ Ú©Ù†)/i.test(message)
  const cleanPersianCreate = /(?:\u06cc\u06a9|\u06a9|\u06cc\u0647)?\s*(?:\u062a\u0633\u06a9|\u0648\u0638\u06cc\u0641\u0647|\u06a9\u0627\u0631).{0,50}(?:\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646)/i.test(message)
  const update = /\b(update|edit|change|reschedule|aktualisiere|bearbeite|verschiebe)\b.{0,60}\b(task|todo|aufgabe)\b/i.test(message)
  if (!create && !cleanPersianCreate && !update) return null

  const date = parseDeterministicDueDate(message, now, timeZone)
  const timeOfDay = parseDeterministicTimeOfDay(message)
  const quoted = message.match(/["'Â«â€œ](.+?)["'Â»â€]/)?.[1]?.trim()
  if (create || cleanPersianCreate) {
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

export async function executeAutoTaskWrite(input: {
  env: Env
  userId: string
  language: Language
  intent: ParsedTaskWriteIntent
  now: Date
}): Promise<{ status: 'executed'; reply: string; undoId: string; undoExpiresAt: string } | { status: 'clarify'; reply: string } | { status: 'failed'; reply: string } | { status: 'not_found' }> {
  const { env, userId, intent, language, now } = input
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

export async function undoAutoTaskWrite(env: Env, userId: string, undoId: string, now: Date): Promise<boolean> {
  const entry = await consumeUndoRecord(env, userId, undoId, now)
  if (!entry || entry.userId !== userId) return false
  if (entry.kind === 'create_task') {
    await supabaseWriteReturning<TaskRow[]>(env, 'DELETE', `tasks?id=eq.${esc(entry.taskId)}&user_id=eq.${esc(userId)}&select=id`)
    return true
  }
  await supabaseWriteReturning<TaskRow[]>(env, 'PATCH', `tasks?id=eq.${esc(entry.taskId)}&user_id=eq.${esc(userId)}&select=id`, {
    title: entry.previous.title,
    notes: entry.previous.notes,
    due_date: entry.previous.due_date,
    completed: entry.previous.completed,
  })
  return true
}
