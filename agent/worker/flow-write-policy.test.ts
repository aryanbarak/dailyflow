import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  assembleCalendarWriteIntent,
  assembleFinanceWriteIntent,
  assembleTaskWriteIntent,
  cleanTitleEdges,
  defaultFlowWriteMode,
  detectContinuationDomain,
  detectWriteDomainSignal,
  executeAutoFinanceWrite,
  extractOriginalRequestText,
  isTitleSubstantiallyTheMessage,
  isValidIban,
  parseCalendarWriteIntent,
  parseDeterministicDueDate,
  parseDeterministicTimeOfDay,
  parseDeterministicTimeRange,
  parseFinanceWriteIntent,
  parseTaskWriteIntent,
  resolveCreateEventTitle,
  resolveCreateTaskTitle,
  resolveServerFlowWriteMode,
  undoAutoWrite,
  UNDO_KIND_VALUES,
  utcInstantToZonedDateAndTime,
  validateCandidateTitle,
  zonedDateTimeToUtcIso,
  type ParsedCalendarWriteIntent,
  type ParsedFinanceWriteIntent,
  type ParsedTaskWriteIntent,
} from './flow-write-policy'
import { writeIntentRegistry } from '../../shared/writeIntentRegistry'
import type { Env } from './types'

const NOW = new Date('2026-08-13T10:00:00.000Z')
const TZ = 'Europe/Berlin'

describe('flow write policy and deterministic dates', () => {
  it.each([
    ['today', '2026-08-13'],
    ['tomorrow', '2026-08-14'],
    ['day after tomorrow', '2026-08-15'],
    ['in 3 days', '2026-08-16'],
    ['heute', '2026-08-13'],
    ['morgen', '2026-08-14'],
    ['übermorgen', '2026-08-15'],
    ['in 4 Tagen', '2026-08-17'],
    ['امروز', '2026-08-13'],
    ['فردا', '2026-08-14'],
    ['پس فردا', '2026-08-15'],
    ['در ۵ روز', '2026-08-18'],
    ['\u0627\u0645\u0631\u0648\u0632', '2026-08-13'],
    ['\u0641\u0631\u062f\u0627', '2026-08-14'],
    ['\u067e\u0633 \u0641\u0631\u062f\u0627', '2026-08-15'],
    ['\u062f\u0631 \u06f5 \u0631\u0648\u0632', '2026-08-18'],
    ['\u062c\u0645\u0639\u0647', '2026-08-14'],
    ['\u06f2\u06f0\u06f2\u06f6-\u06f0\u06f9-\u06f0\u06f1', '2026-09-01'],
    ['2026-09-01', '2026-09-01'],
  ])('parses %s', (phrase, expected) => {
    expect(parseDeterministicDueDate(`Create task ${phrase}`, NOW, TZ)).toEqual({
      value: expected,
      clarificationNeeded: false,
    })
  })

  it('asks clarification when a due-date cue is present but not parseable', () => {
    expect(parseDeterministicDueDate('Create task due sometime soon', NOW, TZ)).toEqual({
      clarificationNeeded: true,
    })
  })

  it('extracts a Persian create-task request with tomorrow deterministically', () => {
    expect(parseTaskWriteIntent('یک تسک «تمرین SQL» برای فردا بساز', NOW, TZ)).toMatchObject({
      kind: 'create_task',
      title: 'تمرین SQL',
      dueDate: '2026-08-14',
    })
  })

  it.each([
    ['\u06a9 \u062a\u0633\u06a9 \u0628\u0631\u0627\u06cc \u0641\u0631\u062f\u0627 \u0628\u0633\u0627\u0632 \u06a9\u0647 \u0646\u0648\u0628\u062a \u062f\u06a9\u062a\u0631 \u0641\u0627\u0645\u06cc\u0644\u06cc \u062f\u0627\u0631\u0645. \u0627\u0644\u0628\u062a\u0647 \u0633\u0627\u0639\u062a \u06f1\u06f1 \u0635\u0628\u062d', '\u0646\u0648\u0628\u062a \u062f\u06a9\u062a\u0631 \u0641\u0627\u0645\u06cc\u0644\u06cc', '11:00'],
    ['Create a task for tomorrow because I have a family doctor appointment at 11am.', 'a family doctor appointment', '11:00'],
    ['Erstelle eine Aufgabe fuer morgen, dass ich einen Arzttermin um 14:30 Uhr habe.', 'einen Arzttermin', '14:30'],
    ['Create a task for tomorrow because I have a very long appointment title that keeps going and going and should be bounded before it becomes a full paragraph.', 'a very long appointment title that keeps going and going and should be bounde...', undefined],
  ])('extracts a bounded subject title and preserves original request in notes: %s', (message, title, timeOfDay) => {
    expect(parseTaskWriteIntent(message, NOW, TZ)).toMatchObject({
      kind: 'create_task',
      title,
      dueDate: '2026-08-14',
      timeOfDay,
    })
    expect(parseTaskWriteIntent(message, NOW, TZ)?.notes).toContain(message)
  })

  it.each([
    ['at 11am', '11:00'],
    ['at 23:15', '23:15'],
    ['um 7:05 Uhr', '07:05'],
    ['\u0633\u0627\u0639\u062a \u06f1\u06f1 \u0635\u0628\u062d', '11:00'],
    ['\u0633\u0627\u0639\u062a \u06f3 \u0639\u0635\u0631', '15:00'],
  ])('parses time of day %s', (phrase, expected) => {
    expect(parseDeterministicTimeOfDay(phrase)).toBe(expected)
  })

  it('keeps a command-only mixed Persian task request under-specified instead of inventing a title', () => {
    expect(parseTaskWriteIntent('\u06cc\u06a9 task \u0628\u0631\u0627\u06cc \u0641\u0631\u062f\u0627 \u0628\u0633\u0627\u0632\u060c \u0633\u0627\u0639\u062a \u06f1\u06f6:\u06f0\u06f0', NOW, TZ)).toMatchObject({
      kind: 'create_task',
      title: undefined,
      dueDate: '2026-08-14',
      timeOfDay: '16:00',
    })
  })

  it('extracts a leading Persian title prefix before the create-task command', () => {
    expect(parseTaskWriteIntent('\u062a\u0631\u0645\u06cc\u0646 \u062f\u0627\u06a9\u062a\u0631 \u0641\u0627\u0645\u06cc\u0644\u06cc: \u0628\u0631\u0627\u06cc\u0645 \u06cc\u06a9 \u062a\u0633\u06a9 \u0628\u0631\u0627\u06cc \u0641\u0631\u062f\u0627 \u0628\u0633\u0627\u0632 \u0628\u0647 \u0633\u0627\u0639\u062a \u06f1\u06f3', NOW, TZ)).toMatchObject({
      kind: 'create_task',
      title: '\u062a\u0631\u0645\u06cc\u0646 \u062f\u0627\u06a9\u062a\u0631 \u0641\u0627\u0645\u06cc\u0644\u06cc',
      dueDate: '2026-08-14',
      timeOfDay: '13:00',
    })
  })

  it('assembles a pending write across a Persian title-correction turn', () => {
    const intent = assembleTaskWriteIntent(
      '\u0646\u0627\u0645 \u062a\u0633\u06a9 \u0631\u0627 \u062a\u0631\u0645\u06cc\u0646 \u062f\u0627\u06a9\u062a\u0631 \u0641\u0627\u0645\u06cc\u0644\u06cc \u0628\u06af\u0630\u0627\u0631 \u0648 \u0628\u0642\u06cc\u0647 \u062f\u0631\u0633\u062a \u0627\u0633\u062a',
      [{ role: 'user', content: '\u06cc\u06a9 task \u0628\u0631\u0627\u06cc \u0641\u0631\u062f\u0627 \u0628\u0633\u0627\u0632\u060c \u0633\u0627\u0639\u062a \u06f1\u06f6:\u06f0\u06f0' }],
      NOW,
      TZ,
    )
    expect(intent).toMatchObject({
      kind: 'create_task',
      title: '\u062a\u0631\u0645\u06cc\u0646 \u062f\u0627\u06a9\u062a\u0631 \u0641\u0627\u0645\u06cc\u0644\u06cc',
      dueDate: '2026-08-14',
      timeOfDay: '16:00',
    })
  })

  it('executes an affirmative continuation against the last complete pending write and discards subject changes', () => {
    const history = [{ role: 'user', content: '\u06cc\u06a9 \u062a\u0633\u06a9 \u0628\u0631\u0627\u06cc \u0641\u0631\u062f\u0627 \u0628\u0633\u0627\u0632 \u06a9\u0647 \u0646\u0648\u0628\u062a \u062f\u06a9\u062a\u0631 \u0641\u0627\u0645\u06cc\u0644\u06cc \u062f\u0627\u0631\u0645. \u0627\u0644\u0628\u062a\u0647 \u0633\u0627\u0639\u062a \u06f1\u06f1 \u0635\u0628\u062d' }]
    expect(assembleTaskWriteIntent('\u0628\u0644\u06cc \u0628\u0633\u0627\u0632', history, NOW, TZ)).toMatchObject({
      title: '\u0646\u0648\u0628\u062a \u062f\u06a9\u062a\u0631 \u0641\u0627\u0645\u06cc\u0644\u06cc',
      dueDate: '2026-08-14',
      timeOfDay: '11:00',
    })
    expect(assembleTaskWriteIntent('\u067e\u06cc\u0634\u0631\u0641\u062a \u06cc\u0627\u062f\u06af\u06cc\u0631\u06cc \u0645\u0646 \u0631\u0627 \u0646\u0634\u0627\u0646 \u0628\u062f\u0647', history, NOW, TZ)).toBeNull()
  })

  it('does not reassemble an already-executed task after a server confirmation', () => {
    const history = [
      { role: 'user', content: '\u06cc\u06a9 \u062a\u0633\u06a9 \u0628\u0631\u0627\u06cc \u0641\u0631\u062f\u0627 \u0628\u0633\u0627\u0632 \u06a9\u0647 \u0646\u0648\u0628\u062a \u062f\u06a9\u062a\u0631 \u062f\u0627\u0631\u0645' },
      { role: 'assistant', content: '\u2713 Task created: \u0646\u0648\u0628\u062a \u062f\u06a9\u062a\u0631 \u2014 due 2026-08-14' },
    ]
    expect(assembleTaskWriteIntent('\u0628\u0644\u06cc \u0628\u0633\u0627\u0632', history, NOW, TZ)).toBeNull()
  })

  it('defaults reversible task create/update to auto and unknown actions to ask', () => {
    expect(defaultFlowWriteMode('tasks', 'create')).toBe('auto')
    expect(defaultFlowWriteMode('tasks', 'update')).toBe('auto')
    expect(defaultFlowWriteMode('tasks', 'delete')).toBe('ask')
    expect(defaultFlowWriteMode('unknown', 'create')).toBe('ask')
  })
})

// Task 21-fix6: title is now a first-class model field, validated (never
// derived) by the functions below. extractTaskTitle's pattern-matching
// stays exactly as tested above -- it is the last-resort fallback these
// tests exercise via a failing/rejected model call, never the primary path.
describe('task title validation and model resolution (task 21-fix6)', () => {
  const FAKE_ENV = {
    SUPABASE_URL: 'https://supa.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'service',
    GEMINI_API_KEY: 'key', GEMINI_MODEL: 'gemini-2.5-flash', AI: {} as unknown as Env['AI'],
  } as Env

  const PRODUCTION_MESSAGE = 'ترمین داکتر فامیلی : برایم یک تسک برای فردا بساز به ساعت ۱۳:۰۰'
  const PRODUCTION_TITLE = 'ترمین داکتر فامیلی'

  function baseIntent(overrides: Partial<ParsedTaskWriteIntent> = {}): ParsedTaskWriteIntent {
    return { kind: 'create_task', notes: `Original request: ${PRODUCTION_MESSAGE}`, ...overrides }
  }

  describe('cleanTitleEdges', () => {
    it('strips a leading colon artifact', () => {
      expect(cleanTitleEdges(': Doctor appointment')).toBe('Doctor appointment')
    })

    it('strips a trailing stray punctuation + digit fragment (the production leak pattern)', () => {
      expect(cleanTitleEdges('Doctor appointment ؟۰۰')).toBe('Doctor appointment')
    })

    it('collapses surrounding whitespace', () => {
      expect(cleanTitleEdges('   Doctor appointment   ')).toBe('Doctor appointment')
    })

    it('leaves a clean title untouched', () => {
      expect(cleanTitleEdges(PRODUCTION_TITLE)).toBe(PRODUCTION_TITLE)
    })
  })

  describe('isTitleSubstantiallyTheMessage', () => {
    it('is false for a short subject drawn from a long message', () => {
      expect(isTitleSubstantiallyTheMessage(PRODUCTION_TITLE, PRODUCTION_MESSAGE)).toBe(false)
    })

    it('is true when the candidate is the whole message', () => {
      expect(isTitleSubstantiallyTheMessage(PRODUCTION_MESSAGE, PRODUCTION_MESSAGE)).toBe(true)
    })
  })

  describe('validateCandidateTitle', () => {
    it('rejects undefined and empty candidates', () => {
      expect(validateCandidateTitle(undefined, PRODUCTION_MESSAGE)).toBeUndefined()
      expect(validateCandidateTitle('   ', PRODUCTION_MESSAGE)).toBeUndefined()
      expect(validateCandidateTitle(':::', PRODUCTION_MESSAGE)).toBeUndefined()
    })

    it('rejects a candidate longer than the subject-line bound', () => {
      const long = 'a'.repeat(61)
      expect(validateCandidateTitle(long, 'unrelated raw message with different words entirely')).toBeUndefined()
    })

    it('rejects a candidate that is substantially the whole raw message, via the overlap check specifically (not the length cap)', () => {
      const shortMessage = 'Add a task: renew my passport'
      expect(shortMessage.length).toBeLessThan(60)
      expect(validateCandidateTitle(shortMessage, shortMessage)).toBeUndefined()
    })

    it('accepts and cleans a genuine short subject', () => {
      expect(validateCandidateTitle(`${PRODUCTION_TITLE} ؟۰۰`, PRODUCTION_MESSAGE)).toBe(PRODUCTION_TITLE)
    })
  })

  describe('extractOriginalRequestText', () => {
    it('pulls the original request out of createTaskNotes-shaped notes', () => {
      expect(extractOriginalRequestText(`Original request: ${PRODUCTION_MESSAGE}\nTime mentioned: 13:00`, 'fallback')).toBe(PRODUCTION_MESSAGE)
    })

    it('falls back to the raw message when notes is missing', () => {
      expect(extractOriginalRequestText(undefined, 'fallback message')).toBe('fallback message')
    })
  })

  describe('resolveCreateTaskTitle', () => {
    it('the exact production-evidence message resolves to the clean subject via the model', async () => {
      const intent = baseIntent({ title: undefined })
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, PRODUCTION_MESSAGE, async () => PRODUCTION_TITLE)
      expect(title).toBe(PRODUCTION_TITLE)
    })

    it('the earlier Persian "because I have a doctor appointment" phrasing resolves via the model', async () => {
      const message = 'یک تسک برای فردا بساز که نوبت دکتر فامیلی دارم. البته ساعت ۱۱ صبح'
      const expected = 'نوبت دکتر فامیلی'
      const intent = baseIntent({ notes: `Original request: ${message}`, title: undefined })
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, message, async () => expected)
      expect(title).toBe(expected)
    })

    it('an EN phrasing resolves via the model', async () => {
      const message = 'Create a task for tomorrow because I have a family doctor appointment at 11am.'
      const intent = baseIntent({ notes: `Original request: ${message}`, title: undefined })
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, message, async () => 'family doctor appointment')
      expect(title).toBe('family doctor appointment')
    })

    it('a DE phrasing resolves via the model', async () => {
      const message = 'Erstelle eine Aufgabe fuer morgen, dass ich einen Arzttermin um 14:30 Uhr habe.'
      const intent = baseIntent({ notes: `Original request: ${message}`, title: undefined })
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, message, async () => 'Arzttermin')
      expect(title).toBe('Arzttermin')
    })

    it('falls back to the validated pattern-extracted title when the model call fails', async () => {
      const intent = baseIntent({ title: PRODUCTION_TITLE })
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, PRODUCTION_MESSAGE, async () => { throw new Error('provider unavailable') })
      expect(title).toBe(PRODUCTION_TITLE)
    })

    it('falls back to the pattern title when the model returns the whole sentence (overlap rejection)', async () => {
      const intent = baseIntent({ title: PRODUCTION_TITLE })
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, PRODUCTION_MESSAGE, async () => PRODUCTION_MESSAGE)
      expect(title).toBe(PRODUCTION_TITLE)
    })

    it('resolves to undefined (triggering a targeted clarify question upstream) when neither the model nor the pattern fallback finds a subject', async () => {
      const message = 'Create a task for tomorrow at 13:00'
      const intent = baseIntent({ notes: `Original request: ${message}`, title: undefined })
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, message, async () => '')
      expect(title).toBeUndefined()
    })
  })
})

// Task 22: calendar write slice + task/event routing. PO decision: tasks
// stay day-level (no time-of-day column); a request carrying a specific
// time is calendar business instead. detectWriteDomainSignal is the
// single deterministic routing decision this whole slice hangs off of.
describe('task 22: calendar write slice + task/event routing', () => {
  describe('detectWriteDomainSignal (the routing rule)', () => {
    it.each([
      ['EN, task noun + time -> calendar', 'Add a task for next Tuesday at 9', 'calendar'],
      ['EN, task noun, date only -> task (unchanged)', 'Create a task for tomorrow', 'task'],
      ['DE, task noun + time -> calendar', 'Erstelle eine Aufgabe fuer morgen um 15 Uhr', 'calendar'],
      ['DE, task noun, date only -> task (unchanged)', 'Erstelle eine Aufgabe fuer morgen', 'task'],
      ['FA, task noun + time (Persian digits, 12h) -> calendar', 'یک تسک برای فردا بساز که نوبت دکتر فامیلی دارم. ساعت ۱۳ عصر', 'calendar'],
      ['FA, task noun, date only -> task (unchanged)', 'یک تسک برای فردا بساز که نوبت دکتر فامیلی دارم', 'task'],
      ['EN, explicit event noun, no time -> calendar (explicit wording wins)', 'Create an event for tomorrow', 'calendar'],
      ['FA, explicit calendar noun + time -> calendar', 'یک جلسه برای فردا بساز، ساعت ۱۰', 'calendar'],
      ['mixed task+calendar nouns -> ambiguous', 'Create a task for the meeting tomorrow', 'ambiguous'],
      ['no create/update trigger at all -> none', 'What is the weather tomorrow?', 'none'],
      ['bare date+time phrase with no verb/noun trigger -> none (not a write command)', 'فردا ساعت ۱۳ نوبت دکتر', 'none'],
    ])('%s', (_label, message, expected) => {
      expect(detectWriteDomainSignal(message, NOW, TZ)).toBe(expected)
    })

    it('24h compact time also forces calendar routing', () => {
      expect(detectWriteDomainSignal('Create a task for tomorrow at 16:00', NOW, TZ)).toBe('calendar')
    })
  })

  describe('detectContinuationDomain (multi-turn routing)', () => {
    it('follows the ORIGINAL triggering message\'s domain, not the continuation reply', () => {
      const history = [{ role: 'user', content: 'Add a task for next Tuesday at 9' }]
      expect(detectContinuationDomain(history, NOW, TZ)).toBe('calendar')
    })

    it('stays task when the original message never carried a time', () => {
      const history = [{ role: 'user', content: 'Create a task for tomorrow' }]
      expect(detectContinuationDomain(history, NOW, TZ)).toBe('task')
    })

    it('returns null when no recent message carries a resolvable domain', () => {
      const history = [{ role: 'user', content: 'What is the weather tomorrow?' }]
      expect(detectContinuationDomain(history, NOW, TZ)).toBeNull()
    })
  })

  describe('parseDeterministicTimeRange', () => {
    it('parses a single time with no range', () => {
      expect(parseDeterministicTimeRange('at 14:00')).toEqual({ start: '14:00' })
    })

    it('parses "from X to Y" (colon format)', () => {
      expect(parseDeterministicTimeRange('from 13:00 to 15:00')).toEqual({ start: '13:00', end: '15:00' })
    })

    it('parses "von X bis Y Uhr"', () => {
      expect(parseDeterministicTimeRange('von 13:00 bis 15:00 Uhr')).toEqual({ start: '13:00', end: '15:00' })
    })

    it('parses a bare-hour English range ("to 3pm") -- start time still needs a recognized prefix ("at"/"um"/Persian "ساعت"), same as parseDeterministicTimeOfDay always required', () => {
      expect(parseDeterministicTimeRange('at 1pm to 3pm')).toEqual({ start: '13:00', end: '15:00' })
    })

    it('returns no result at all when no time is present', () => {
      expect(parseDeterministicTimeRange('tomorrow')).toEqual({})
    })
  })

  describe('parseCalendarWriteIntent', () => {
    it('the exact production-evidence message resolves to a create_calendar_event intent with a real start time (not stranded in notes)', () => {
      const message = 'ترمین داکتر فامیلی : برایم یک تسک برای فردا بساز به ساعت ۱۳:۰۰'
      expect(parseCalendarWriteIntent(message, NOW, TZ)).toMatchObject({
        kind: 'create_calendar_event',
        startDate: '2026-08-14',
        startTime: '13:00',
      })
    })

    it('an EN phrasing with a time resolves to a create_calendar_event intent', () => {
      const message = 'Create a task for tomorrow because I have a family doctor appointment at 11am.'
      expect(parseCalendarWriteIntent(message, NOW, TZ)).toMatchObject({
        kind: 'create_calendar_event',
        startDate: '2026-08-14',
        startTime: '11:00',
      })
    })

    it('a date-only message (no time) is not calendar business', () => {
      expect(parseCalendarWriteIntent('Create a task for tomorrow', NOW, TZ)).toBeNull()
    })

    it('parses an update_calendar_event intent from an explicit event-update phrasing', () => {
      const message = 'Update the "Team sync" meeting to 15:00'
      expect(parseCalendarWriteIntent(message, NOW, TZ)).toMatchObject({
        kind: 'update_calendar_event',
        eventReference: 'Team sync',
        startTime: '15:00',
      })
    })
  })

  describe('zonedDateTimeToUtcIso -> calendarService.toInsertRow slice composition (regression test for the timezone resolution)', () => {
    it('produces the exact date/start_time/end_time strings calendarService.ts would independently produce for the same wall-clock intent', () => {
      // Mirrors CalendarFormDialog.tsx's buildDateTime(): new Date(y,m,d,h,mi).toISOString()
      // -- a genuine local-time-to-UTC conversion -- just resolved via an
      // explicit IANA zone (Europe/Berlin) instead of the browser's implicit
      // local one. 13:00 CEST (UTC+2) in August -> 11:00 UTC.
      const startUtcIso = zonedDateTimeToUtcIso('2026-08-14', '13:00', TZ)
      expect(startUtcIso).toBe('2026-08-14T11:00:00.000Z')
      // calendarService.ts's toInsertRow: date = slice(0,10), start_time = slice(11,16).
      expect(startUtcIso.slice(0, 10)).toBe('2026-08-14')
      expect(startUtcIso.slice(11, 16)).toBe('11:00')
    })
  })

  describe('task 22-fix3: utcInstantToZonedDateAndTime -- the confirmation-line timezone fix', () => {
    it('the exact production evidence: a persisted 2026-08-16T11:00:00.000Z instant reads back as 13:00 in Europe/Berlin, not 11:00', () => {
      expect(utcInstantToZonedDateAndTime('2026-08-16T11:00:00.000Z', TZ)).toEqual({ date: '2026-08-16', time: '13:00' })
    })

    it('is the exact inverse of zonedDateTimeToUtcIso for the same wall-clock intent', () => {
      const utcIso = zonedDateTimeToUtcIso('2026-08-14', '13:00', TZ)
      expect(utcInstantToZonedDateAndTime(utcIso, TZ)).toEqual({ date: '2026-08-14', time: '13:00' })
    })

    it('converts correctly for a non-DST zone offset too (winter, UTC+1)', () => {
      const utcIso = zonedDateTimeToUtcIso('2026-01-14', '13:00', TZ)
      expect(utcIso).toBe('2026-01-14T12:00:00.000Z')
      expect(utcInstantToZonedDateAndTime(utcIso, TZ)).toEqual({ date: '2026-01-14', time: '13:00' })
    })
  })

  describe('resolveCreateEventTitle', () => {
    const FAKE_ENV = {
      SUPABASE_URL: 'https://supa.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'service',
      GEMINI_API_KEY: 'key', GEMINI_MODEL: 'gemini-2.5-flash', AI: {} as unknown as Env['AI'],
    } as Env

    it('uses the model title when it validates (same validator as resolveCreateTaskTitle)', async () => {
      const message = 'Create a task for tomorrow because I have a family doctor appointment at 11am.'
      const intent: ParsedCalendarWriteIntent = { kind: 'create_calendar_event', notes: `Original request: ${message}` }
      const title = await resolveCreateEventTitle(FAKE_ENV, intent, message, async () => 'Family doctor appointment')
      expect(title).toBe('Family doctor appointment')
    })
  })

  describe('assembleCalendarWriteIntent (multi-turn pending-intent mechanism, mirrors assembleTaskWriteIntent)', () => {
    it('assembles a pending calendar write across a title-correction turn', () => {
      const intent = assembleCalendarWriteIntent(
        'نام تسک را ترمین داکتر فامیلی بگذار و بقیه درست است',
        [{ role: 'user', content: 'یک task برای فردا بساز، ساعت ۱۶:۰۰' }],
        NOW,
        TZ,
      )
      expect(intent).toMatchObject({
        kind: 'create_calendar_event',
        title: 'ترمین داکتر فامیلی',
        startDate: '2026-08-14',
        startTime: '16:00',
      })
    })

    it('does not reassemble an already-executed event after a server confirmation', () => {
      const history = [
        { role: 'user', content: 'Add a task for tomorrow at 9am because I have a family doctor appointment' },
        { role: 'assistant', content: '✓ Event created: family doctor appointment — 2026-08-14 09:00' },
      ]
      expect(assembleCalendarWriteIntent('yes create it', history, NOW, TZ)).toBeNull()
    })
  })
})

describe('task 22-fix: implicit schedule statements (C1/C2 production root cause)', () => {
  describe('detectWriteDomainSignal / parseTaskWriteIntent recognize an implicit personal statement (no imperative verb)', () => {
    it('the exact production-evidence string ("...ترمین داکتر فامیلی دارم") routes to calendar', () => {
      const message = 'فردا ساعت ۱۳:۰۰ ترمین داکتر فامیلی دارم'
      expect(detectWriteDomainSignal(message, NOW, TZ)).toBe('calendar')
    })

    it('the exact production-evidence string resolves via parseCalendarWriteIntent with a real, deterministic start time -- never the model\'s own guess', () => {
      const message = 'فردا ساعت ۱۳:۰۰ ترمین داکتر فامیلی دارم'
      expect(parseCalendarWriteIntent(message, NOW, TZ)).toMatchObject({
        kind: 'create_calendar_event',
        startDate: '2026-08-14',
        startTime: '13:00',
      })
    })

    it('an EN implicit statement ("I have a dentist appointment tomorrow at 3pm") routes to calendar', () => {
      const message = 'I have a dentist appointment tomorrow at 3pm'
      expect(detectWriteDomainSignal(message, NOW, TZ)).toBe('calendar')
      expect(parseCalendarWriteIntent(message, NOW, TZ)).toMatchObject({
        kind: 'create_calendar_event',
        startDate: '2026-08-14',
        startTime: '15:00',
      })
    })

    it('a DE implicit statement ("Ich habe morgen um 15 Uhr einen Arzttermin") routes to calendar', () => {
      const message = 'Ich habe morgen um 15 Uhr einen Arzttermin'
      expect(detectWriteDomainSignal(message, NOW, TZ)).toBe('calendar')
    })

    it('an implicit statement with a DATE but no TIME routes to task, not calendar (unchanged routing rule)', () => {
      const message = 'فردا ترمین داکتر فامیلی دارم'
      expect(detectWriteDomainSignal(message, NOW, TZ)).toBe('task')
      expect(parseTaskWriteIntent(message, NOW, TZ)).toMatchObject({ kind: 'create_task', dueDate: '2026-08-14' })
    })

    it('false-positive bound: "دارم"/"I have" with NO resolvable date or time signal at all does not trigger a write', () => {
      expect(detectWriteDomainSignal('من یک گربه دارم', NOW, TZ)).toBe('none')
      expect(detectWriteDomainSignal('I have a headache', NOW, TZ)).toBe('none')
    })

    it('false-positive bound: a read/list question is never treated as an implicit write, even with a date+time', () => {
      expect(detectWriteDomainSignal('What do I have tomorrow at 3pm?', NOW, TZ)).toBe('none')
      expect(detectWriteDomainSignal('فردا ساعت ۱۳ چه چیزی در تقویم دارم؟ لیست کن', NOW, TZ)).toBe('none')
    })

    it('an explicit imperative message is unaffected (still routes exactly as before)', () => {
      expect(detectWriteDomainSignal('Create a task for tomorrow', NOW, TZ)).toBe('task')
      expect(detectWriteDomainSignal('Create an event for tomorrow', NOW, TZ)).toBe('calendar')
    })
  })

  describe('multi-turn reassembly resolves a relative date against the ORIGINAL message\'s own timestamp, not a later continuation\'s (off-by-one production evidence)', () => {
    // Base instant chosen so Europe/Berlin has already crossed local
    // midnight relative to it (2026-08-14T22:11Z UTC == 2026-08-15T00:11
    // CEST) -- reproduces the exact production timestamp shape ("today" per
    // the reasoning-step id) while keeping the ORIGINAL message's own
    // createdAt genuinely in the Berlin-local evening of 2026-08-14.
    const ORIGINAL_SENT_AT = '2026-08-14T20:00:00.000Z' // 22:00 CEST, still Aug 14 locally
    const CONTINUATION_NOW = new Date('2026-08-14T22:11:00.000Z') // 00:11 CEST, already Aug 15 locally

    it('assembleTaskWriteIntent: "فردا" in the ORIGINAL message anchors to the original send time, not the later continuation\'s', () => {
      const history = [
        { role: 'user', content: 'یک تسک برای فردا بساز', createdAt: ORIGINAL_SENT_AT },
      ]
      const intent = assembleTaskWriteIntent('بله', history, CONTINUATION_NOW, TZ)
      // "فردا" relative to 2026-08-14 (the original message's own local day)
      // is 2026-08-15 -- NOT 2026-08-16, which is what re-deriving "فردا"
      // from CONTINUATION_NOW's already-rolled-over local day would give.
      expect(intent).toMatchObject({ kind: 'create_task', dueDate: '2026-08-15' })
    })

    it('assembleCalendarWriteIntent: same anchoring for a calendar-shaped original message', () => {
      const history = [
        { role: 'user', content: 'یک رویداد برای فردا بساز، ساعت ۱۰', createdAt: ORIGINAL_SENT_AT },
      ]
      const intent = assembleCalendarWriteIntent('بله', history, CONTINUATION_NOW, TZ)
      expect(intent).toMatchObject({ kind: 'create_calendar_event', startDate: '2026-08-15', startTime: '10:00' })
    })

    it('detectContinuationDomain also anchors to the original turn\'s own timestamp', () => {
      const history = [
        { role: 'user', content: 'Add a task for tomorrow at 9am', createdAt: ORIGINAL_SENT_AT },
      ]
      expect(detectContinuationDomain(history, CONTINUATION_NOW, TZ)).toBe('calendar')
    })

    it('falls back to the current `now` when a turn has no createdAt (backward compatible, no worse than before)', () => {
      const history = [{ role: 'user', content: 'یک تسک برای فردا بساز' }]
      const intent = assembleTaskWriteIntent('بله', history, CONTINUATION_NOW, TZ)
      // No createdAt -> resolved against CONTINUATION_NOW's own local day (2026-08-15) + 1.
      expect(intent).toMatchObject({ kind: 'create_task', dueDate: '2026-08-16' })
    })
  })
})

describe('task 22-fix2 (D1), now task 23 registry-driven: UNDO_KIND_VALUES cross-checked against the migration file', () => {
  // Production root cause: the flow_write_undo_records_kind_check
  // constraint was written (21-fix2) when only task kinds existed, and
  // task 22 added calendar UndoEntry kinds in CODE without ever getting the
  // widening migration APPLIED -- a mismatch between what the code tries to
  // persist and what the database allows, caught only in production as a
  // 23514. This test closes that gap generally: it reads the actual
  // migration file's CHECK constraint and asserts it allows EXACTLY the
  // same kinds UNDO_KIND_VALUES (the single source of truth persistUndoRecord's
  // callers are built from -- see flow-write-policy.ts's own comment there)
  // declares. A future kind added to one side without the other now fails
  // a test, not a production write.
  //
  // Task 23: UNDO_KIND_VALUES is no longer a hand-maintained literal array
  // -- it's derived from the shared writeIntentRegistry's own `undoKind`
  // field (see flow-write-policy.ts's own comment on the export). This
  // whole describe block therefore already cross-checks the REGISTRY
  // against the migration transitively; the assertion below makes that
  // explicit rather than relying on it being merely true by construction.
  const migrationPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    // Task 28: repointed to the latest widening migration (finance's
    // create_finance_transaction kind) -- each time this CHECK constraint
    // is widened via a new migration, this path must move to that new
    // file, the same way it presumably moved here from an earlier task
    // 21/22 file when THIS migration was introduced. The 20260815 file
    // remains in the repo as migration history; it is not re-applied on
    // top of this one, this one's own `drop constraint if exists` +
    // `add constraint` fully re-specifies the complete allowed set standalone.
    '../../supabase/migrations/20260817000000_widen_flow_write_undo_kinds_finance.sql',
  )

  it('UNDO_KIND_VALUES is exactly the shared registry\'s own undoKind values, in registry order', () => {
    expect([...UNDO_KIND_VALUES]).toEqual(writeIntentRegistry.map((entry) => entry.undoKind))
  })

  it('the widening migration exists and its CHECK constraint allows exactly the kinds UNDO_KIND_VALUES declares', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const match = sql.match(/add constraint flow_write_undo_records_kind_check\s+check \(kind in \(([^)]+)\)\)/)
    expect(match, 'migration must (re)define flow_write_undo_records_kind_check with a `kind in (...)` clause').toBeTruthy()
    const allowedInMigration = match![1]
      .split(',')
      .map(entry => entry.trim().replace(/^'(.*)'$/, '$1'))
      .sort()
    const allowedInCode = [...UNDO_KIND_VALUES].sort()
    expect(allowedInMigration).toEqual(allowedInCode)
  })

  it('the migration drops the constraint before re-adding it (idempotent replay -- safe to run against a database that already has an older, narrower version)', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/drop constraint if exists flow_write_undo_records_kind_check/)
  })

  it('UNDO_KIND_VALUES itself matches every kind persistUndoOrRollback is actually called with in this file (belt-and-suspenders: catches a future call site that forgets to extend the list, independent of the migration file check above)', () => {
    const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './flow-write-policy.ts')
    const source = readFileSync(sourcePath, 'utf8')
    const kindsUsedAtCallSites = new Set<string>()
    for (const match of source.matchAll(/persistUndoOrRollback\(\s*env,\s*\{\s*kind:\s*'([a-z_]+)'/g)) {
      kindsUsedAtCallSites.add(match[1])
    }
    // Guard the guard: fail loudly if the source ever stops matching this
    // regex shape entirely (e.g. a refactor changes call-site formatting)
    // rather than silently passing with an empty set.
    expect(kindsUsedAtCallSites.size).toBeGreaterThan(0)
    expect([...kindsUsedAtCallSites].sort()).toEqual([...UNDO_KIND_VALUES].sort())
  })
})

describe('task 28: finance write slice', () => {
  const FINANCE_NOW = new Date('2026-08-17T10:00:00.000Z')

  describe('parseFinanceWriteIntent -- deterministic amount/currency/direction/date parsing', () => {
    it('parses a Farsi amount with the یورو currency token', () => {
      const intent = parseFinanceWriteIntent('یک هزینه ۴۵ یورو ثبت کن', FINANCE_NOW, TZ)
      expect(intent).toMatchObject({ amount: 45, currency: 'EUR', direction: 'expense', amountClarificationNeeded: false })
    })

    it('parses a German comma-decimal amount with the € symbol', () => {
      const intent = parseFinanceWriteIntent('Erfasse eine Ausgabe von 45,50 € für Lebensmittel', FINANCE_NOW, TZ)
      expect(intent).toMatchObject({ amount: 45.5, currency: 'EUR', direction: 'expense' })
    })

    it('parses an English dot-decimal amount and an income direction', () => {
      const intent = parseFinanceWriteIntent('Log an income of 1234.56 EUR', FINANCE_NOW, TZ)
      expect(intent).toMatchObject({ amount: 1234.56, currency: 'EUR', direction: 'income' })
    })

    it('disambiguates German thousands-grouped form (1.234,56) from English (1,234.56) -- both resolve to the same value', () => {
      expect(parseFinanceWriteIntent('Erfasse eine Ausgabe von 1.234,56 €', FINANCE_NOW, TZ)?.amount).toBe(1234.56)
      expect(parseFinanceWriteIntent('Log an expense of 1,234.56 EUR', FINANCE_NOW, TZ)?.amount).toBe(1234.56)
    })

    it('parses a Farsi thousands separator (٬) with no decimal fraction', () => {
      expect(parseFinanceWriteIntent('یک هزینه ۱٬۲۳۴ یورو ثبت کن', FINANCE_NOW, TZ)?.amount).toBe(1234)
    })

    it('a finance-shaped message with no parseable amount is a typed clarification-needed, never a guess (e.g. a zero or omitted amount)', () => {
      const intent = parseFinanceWriteIntent('Log an expense please', FINANCE_NOW, TZ)
      expect(intent).toMatchObject({ amount: undefined, amountClarificationNeeded: true })
    })

    it('a message with no finance-write trigger at all returns null, not a clarification', () => {
      expect(parseFinanceWriteIntent('What is my current balance?', FINANCE_NOW, TZ)).toBeNull()
    })

    it('defaults the transaction date to today when the message names no date, rather than asking', () => {
      const intent = parseFinanceWriteIntent('Log an expense of 20 EUR', FINANCE_NOW, TZ)
      expect(intent?.transactionDate).toBe('2026-08-17')
    })

    it('resolves an explicit date phrase ("yesterday"-equivalent day names are out of scope; tomorrow is in scope) via the shared deterministic date parser', () => {
      const intent = parseFinanceWriteIntent('Log an expense of 20 EUR for tomorrow', FINANCE_NOW, TZ)
      expect(intent?.transactionDate).toBe('2026-08-18')
    })

    it('description is a bounded passthrough of the raw message, not an extraction', () => {
      const message = 'Log an expense of 20 EUR for groceries'
      expect(parseFinanceWriteIntent(message, FINANCE_NOW, TZ)?.description).toBe(message)
    })

    it('an IBAN token in the message never leaks into the amount parse', () => {
      const intent = parseFinanceWriteIntent('Log a payment of 45 EUR to DE89 3704 0044 0532 0130 00', FINANCE_NOW, TZ)
      expect(intent?.amount).toBe(45)
      expect(intent?.iban).toBe('DE89370400440532013000')
    })
  })

  describe('IBAN validation -- ISO 7064 MOD 97-10, deterministic in code', () => {
    it('accepts the canonical valid example IBAN (Deutsche Bundesbank), compact or space-grouped', () => {
      expect(isValidIban('DE89370400440532013000')).toBe(true)
      expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true)
    })

    it('rejects an IBAN with an invalid checksum digit -- never a silent pass', () => {
      expect(isValidIban('DE89370400440532013001')).toBe(false)
    })

    it('rejects a non-IBAN-shaped string outright', () => {
      expect(isValidIban('not an iban')).toBe(false)
      expect(isValidIban('12345')).toBe(false)
    })

    it('parseFinanceWriteIntent surfaces both the candidate and its validity, never silently dropping an invalid one', () => {
      const valid = parseFinanceWriteIntent('Pay 45 EUR to DE89370400440532013000', FINANCE_NOW, TZ)
      expect(valid).toMatchObject({ iban: 'DE89370400440532013000', ibanValid: true })
      const invalid = parseFinanceWriteIntent('Pay 45 EUR to DE89370400440532013001', FINANCE_NOW, TZ)
      expect(invalid).toMatchObject({ iban: 'DE89370400440532013001', ibanValid: false })
    })
  })

  describe('detectWriteDomainSignal / detectContinuationDomain -- finance as a third independent signal', () => {
    it('a finance-only trigger resolves to \'finance\'', () => {
      expect(detectWriteDomainSignal('Log an expense of 20 EUR', FINANCE_NOW, TZ)).toBe('finance')
    })

    it('a message matching both a task trigger and a finance trigger is ambiguous, not guessed', () => {
      expect(detectWriteDomainSignal('Create a task to log an expense of 20 EUR', FINANCE_NOW, TZ)).toBe('ambiguous')
    })

    it('existing task/calendar-only routing is completely unaffected (task 23\'s zero-behaviour-change constraint)', () => {
      expect(detectWriteDomainSignal('Create a task to buy milk', FINANCE_NOW, TZ)).toBe('task')
      expect(detectWriteDomainSignal('Schedule a meeting tomorrow at 13:00', FINANCE_NOW, TZ)).toBe('calendar')
    })

    it('an affirmative continuation after a finance-triggering message resolves the continuation domain to \'finance\'', () => {
      const history = [{ role: 'user', content: 'Log an expense of 20 EUR' }]
      expect(detectContinuationDomain(history, FINANCE_NOW, TZ)).toBe('finance')
    })
  })

  describe('assembleFinanceWriteIntent -- multi-turn continuation, mirroring assembleTaskWriteIntent\'s shape', () => {
    it('resolves a bare affirmative reply against the ORIGINAL triggering message', () => {
      const history = [{ role: 'user', content: 'Log an expense of 45 EUR for groceries' }]
      const intent = assembleFinanceWriteIntent('yes', history, FINANCE_NOW, TZ)
      expect(intent).toMatchObject({ amount: 45, direction: 'expense' })
    })

    it('does not re-assemble after the server already confirmed the write in this conversation', () => {
      const history = [
        { role: 'user', content: 'Log an expense of 45 EUR' },
        { role: 'assistant', content: '✓ Transaction recorded: expense — 45.00 EUR 2026-08-17' },
      ]
      expect(assembleFinanceWriteIntent('yes', history, FINANCE_NOW, TZ)).toBeNull()
    })
  })

  function mockEnv(): Env {
    return {
      SUPABASE_URL: 'https://supa.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'service',
      GEMINI_API_KEY: 'key', GEMINI_MODEL: 'gemini-2.5-flash', AI: {} as unknown as Env['AI'],
    } as Env
  }

  describe('resolveServerFlowWriteMode -- server-side hard clamp: finance never resolves \'auto\', even on an explicit client-stored row', () => {
    it('returns \'ask\' even when the stored permission row explicitly requests \'auto\' for (finance, create)', async () => {
      const originalFetch = global.fetch
      global.fetch = (async () => new Response(JSON.stringify([{ mode: 'auto' }]), { status: 200 })) as typeof fetch
      try {
        const mode = await resolveServerFlowWriteMode(mockEnv(), 'user-1', 'finance', 'create')
        expect(mode).toBe('ask')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('the same stored \'auto\' row for (tasks, create) is honoured unchanged (the clamp is finance-specific, not a general auto ban)', async () => {
      const originalFetch = global.fetch
      global.fetch = (async () => new Response(JSON.stringify([{ mode: 'auto' }]), { status: 200 })) as typeof fetch
      try {
        const mode = await resolveServerFlowWriteMode(mockEnv(), 'user-1', 'tasks', 'create')
        expect(mode).toBe('auto')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('defaultFlowWriteMode itself (no stored row) is already \'ask\' for finance -- the clamp above is defense in depth beyond this default', () => {
      expect(defaultFlowWriteMode('finance', 'create')).toBe('ask')
    })
  })

  describe('executeAutoFinanceWrite + undoAutoWrite -- persist-first undo round trip, mirroring the calendar/task triads', () => {
    interface Call { method: string; url: string; body?: unknown }

    function mockSupabaseSequence(responses: Array<{ status: number; body: unknown }>) {
      const calls: Call[] = []
      let i = 0
      const fetchMock = (async (url: string, init?: RequestInit) => {
        calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
        const response = responses[Math.min(i, responses.length - 1)]
        i += 1
        return new Response(JSON.stringify(response.body), { status: response.status })
      }) as typeof fetch
      return { fetchMock, calls }
    }

    const VALID_INTENT: ParsedFinanceWriteIntent = {
      kind: 'create_finance_transaction',
      amount: 45.5,
      currency: 'EUR',
      direction: 'expense',
      transactionDate: '2026-08-17',
      description: 'groceries',
      amountClarificationNeeded: false,
    }

    it('an invalid IBAN produces a typed clarify rejection and never reaches the insert (no silent drop, no silent proceed)', async () => {
      const { fetchMock, calls } = mockSupabaseSequence([{ status: 200, body: [] }])
      const originalFetch = global.fetch
      global.fetch = fetchMock
      try {
        const result = await executeAutoFinanceWrite({
          env: mockEnv(), userId: 'user-1', language: 'en', now: FINANCE_NOW,
          intent: { ...VALID_INTENT, iban: 'DE89370400440532013001', ibanValid: false },
        })
        expect(result.status).toBe('clarify')
        expect(calls.length).toBe(0)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('a missing amount asks a specific clarifying question rather than inserting a zero/guessed amount', async () => {
      const result = await executeAutoFinanceWrite({
        env: mockEnv(), userId: 'user-1', language: 'en', now: FINANCE_NOW,
        intent: { ...VALID_INTENT, amount: undefined, amountClarificationNeeded: true },
      })
      expect(result).toMatchObject({ status: 'clarify' })
    })

    it('executes the insert, persists an undo record BEFORE returning, and the confirmation echoes the local amount/date -- then undoAutoWrite deletes the row', async () => {
      const transactionRow = { id: 'txn-1', user_id: 'user-1', type: 'expense', amount: 45.5, category: 'Flow AI', date: '2026-08-17', notes: 'groceries', created_at: FINANCE_NOW.toISOString(), updated_at: FINANCE_NOW.toISOString() }
      const { fetchMock, calls } = mockSupabaseSequence([
        { status: 200, body: [transactionRow] }, // POST finance_transactions
        { status: 200, body: null },              // POST flow_write_undo_records (no-content response body ignored)
      ])
      const originalFetch = global.fetch
      global.fetch = fetchMock
      try {
        const result = await executeAutoFinanceWrite({ env: mockEnv(), userId: 'user-1', language: 'en', now: FINANCE_NOW, intent: VALID_INTENT })
        expect(result.status).toBe('executed')
        if (result.status !== 'executed') throw new Error('unreachable')
        expect(result.reply).toContain('45.50')
        expect(result.reply).toContain('EUR')
        expect(result.reply).toContain('2026-08-17')

        // Undo persisted BEFORE the confirmation was returned (calls[1] is the flow_write_undo_records POST).
        expect(calls[1].method).toBe('POST')
        expect(String(calls[1].url)).toContain('flow_write_undo_records')
        expect((calls[1].body as { kind: string }).kind).toBe('create_finance_transaction')
      } finally {
        global.fetch = originalFetch
      }

      // Now the undo round trip: consumeUndoRecord's GET (finds the record) + PATCH (marks consumed), then the DELETE.
      const undoRow = { id: 'undo-id-1', user_id: 'user-1', kind: 'create_finance_transaction', task_id: 'txn-1', payload: {}, expires_at: new Date(FINANCE_NOW.getTime() + 60_000).toISOString(), consumed_at: null }
      const { fetchMock: undoFetchMock, calls: undoCalls } = mockSupabaseSequence([
        { status: 200, body: [undoRow] }, // GET flow_write_undo_records
        { status: 200, body: null },      // PATCH consumed_at
        { status: 200, body: [{ id: 'txn-1' }] }, // DELETE finance_transactions
      ])
      const originalFetch2 = global.fetch
      global.fetch = undoFetchMock
      try {
        const undone = await undoAutoWrite(mockEnv(), 'user-1', 'undo:undo-id-1', FINANCE_NOW)
        expect(undone).toBe(true)
        const deleteCall = undoCalls.find((call) => call.method === 'DELETE')
        expect(deleteCall).toBeTruthy()
        expect(String(deleteCall!.url)).toContain('finance_transactions')
        expect(String(deleteCall!.url)).toContain('txn-1')
      } finally {
        global.fetch = originalFetch2
      }
    })

    it('confirmation bidi: the amount+date token is isolated with U+2066 LRI / U+2069 PDI, the same mechanism task 22-fix3 (4995b29) uses for calendar/task', async () => {
      const transactionRow = { id: 'txn-2', user_id: 'user-1', type: 'income', amount: 1234.56, category: 'Flow AI', date: '2026-08-17', notes: null, created_at: FINANCE_NOW.toISOString(), updated_at: FINANCE_NOW.toISOString() }
      const { fetchMock } = mockSupabaseSequence([{ status: 200, body: [transactionRow] }, { status: 200, body: null }])
      const originalFetch = global.fetch
      global.fetch = fetchMock
      try {
        const result = await executeAutoFinanceWrite({ env: mockEnv(), userId: 'user-1', language: 'fa', now: FINANCE_NOW, intent: { ...VALID_INTENT, amount: 1234.56, direction: 'income' } })
        expect(result.status).toBe('executed')
        if (result.status !== 'executed') throw new Error('unreachable')
        expect(result.reply).toContain('⁦')
        expect(result.reply).toContain('⁩')
        expect(result.reply).toContain('درآمد')
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})
