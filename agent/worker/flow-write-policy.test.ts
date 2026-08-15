import { describe, expect, it } from 'vitest'
import {
  assembleCalendarWriteIntent,
  assembleTaskWriteIntent,
  cleanTitleEdges,
  defaultFlowWriteMode,
  detectContinuationDomain,
  detectWriteDomainSignal,
  extractOriginalRequestText,
  isTitleSubstantiallyTheMessage,
  parseCalendarWriteIntent,
  parseDeterministicDueDate,
  parseDeterministicTimeOfDay,
  parseDeterministicTimeRange,
  parseTaskWriteIntent,
  resolveCreateEventTitle,
  resolveCreateTaskTitle,
  validateCandidateTitle,
  zonedDateTimeToUtcIso,
  type ParsedCalendarWriteIntent,
  type ParsedTaskWriteIntent,
} from './flow-write-policy'
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
