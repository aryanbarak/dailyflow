import { describe, expect, it } from 'vitest'
import {
  assembleTaskWriteIntent,
  cleanTitleEdges,
  defaultFlowWriteMode,
  extractOriginalRequestText,
  isTitleSubstantiallyTheMessage,
  parseDeterministicDueDate,
  parseDeterministicTimeOfDay,
  parseTaskWriteIntent,
  resolveCreateTaskTitle,
  validateCandidateTitle,
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
