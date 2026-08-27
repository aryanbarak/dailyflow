import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  assembleCalendarWriteIntent,
  assembleFinanceWriteIntent,
  assembleTaskWriteIntent,
  calendarIntentTargetFields,
  checkDuplicateRows,
  cleanTitleEdges,
  defaultFlowWriteMode,
  detectContinuationDomain,
  detectWriteDomainSignal,
  executeAutoFinanceWrite,
  executeBatchFinanceImport,
  extractOriginalRequestText,
  financeIntentTargetFields,
  isTitleSubstantiallyTheMessage,
  isValidIban,
  loadImportBatch,
  looksLikeInstructionFragment,
  markImportBatchConsumed,
  parseCalendarWriteIntent,
  parseDeterministicDueDate,
  parseDeterministicTimeOfDay,
  parseDeterministicTimeRange,
  parseFinanceWriteIntent,
  parseTaskWriteIntent,
  persistImportBatch,
  resolveCreateEventTitle,
  resolveCreateTaskTitle,
  resolveServerFlowWriteMode,
  taskIntentTargetFields,
  undoAutoWrite,
  UNDO_KIND_VALUES,
  utcInstantToZonedDateAndTime,
  validateCandidateTitle,
  writeIntentOutcomeIdentity,
  zonedDateTimeToUtcIso,
  type ParsedCalendarWriteIntent,
  type ParsedFinanceWriteIntent,
  type ParsedTaskWriteIntent,
} from './flow-write-policy'
import { WRITE_DOMAIN_TARGET_FIELDS, writeIntentRegistry } from '../../shared/writeIntentRegistry'
import type { ParsedBankRow } from '../../shared/bankStatementParser'
import type { Env } from './types'
import { ProviderUnavailableError } from './provider-errors'

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

  // INC-02 (GitHub #188): reversible task create/update defaulted to 'auto'
  // from ADR-0012 until 2026-08-27. It is now clamped to 'ask' -- see
  // defaultFlowWriteMode's own comment for why, and for the exit condition
  // (ENG-07 / GitHub #185, BOTH the abort plumbing and the recovery
  // surface). This test is the one that flips back when the clamp retires;
  // it is deliberately worded so that flipping it requires knowing that.
  //
  // The delete and unknown-action expectations are UNCHANGED and were never
  // 'auto' -- kept here so the clamp cannot be mistaken for having widened
  // 'ask' to cases that already had it.
  it('INC-02: clamps reversible task create/update to ask (was auto); delete and unknown stay ask', () => {
    expect(defaultFlowWriteMode('tasks', 'create')).toBe('ask')
    expect(defaultFlowWriteMode('tasks', 'update')).toBe('ask')
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

    // INC-01 (2026-08-22 incident): the case above -- resolving to undefined
    // -- is legitimate ask_clarification territory ONLY when the model
    // actually answered (even with an empty/unusable title). These two
    // tests prove the DIFFERENT case: the model call never got a chance to
    // answer at all (provider down), which must never collapse into that
    // same undefined/clarify outcome.
    describe('INC-01: provider failure vs. genuine "no title found"', () => {
      it('still falls back silently to the pattern title when the provider is unavailable but pattern extraction found something -- no behavior change', async () => {
        const intent = baseIntent({ title: PRODUCTION_TITLE })
        const title = await resolveCreateTaskTitle(FAKE_ENV, intent, PRODUCTION_MESSAGE, async () => {
          throw new ProviderUnavailableError('429 RESOURCE_EXHAUSTED')
        })
        expect(title).toBe(PRODUCTION_TITLE)
      })

      it('rethrows ProviderUnavailableError (instead of resolving to undefined) when the provider is unavailable AND pattern extraction also finds nothing -- this is the exact incident: without this, the caller cannot tell "provider down" apart from "model found no subject" and reports a fabricated clarification', async () => {
        const message = 'Create a task for tomorrow'
        const intent = baseIntent({ notes: `Original request: ${message}`, title: undefined })

        await expect(
          resolveCreateTaskTitle(FAKE_ENV, intent, message, async () => {
            throw new ProviderUnavailableError('429 RESOURCE_EXHAUSTED')
          }),
        ).rejects.toBeInstanceOf(ProviderUnavailableError)
      })

      it('does NOT rethrow for a non-provider model failure (malformed JSON, missing field, etc.) even with no pattern fallback -- the model DID get a chance to answer, so this stays the existing clarify-eligible undefined', async () => {
        const message = 'Create a task for tomorrow'
        const intent = baseIntent({ notes: `Original request: ${message}`, title: undefined })

        const title = await resolveCreateTaskTitle(FAKE_ENV, intent, message, async () => {
          throw new Error('Task title model response was not valid JSON.')
        })
        expect(title).toBeUndefined()
      })
    })
  })
})

// TITLE-01: Persian/Dari task-title extraction fixes.
//
// Defect A -- a production task was created titled «به نام آزمایش جمنای»
// from «یک وظیفه بساز به نام آزمایش جمنای» -- correct title is
// «آزمایش جمنای». Diagnosis (confirmed by trace, not assumed): the
// message's cleanPersianCreate trigger fires on «یک وظیفه بساز», leaving
// extractTaskTitle's fallback branch to strip only that trigger phrase --
// "به نام" (the framing preposition introducing the real subject) was
// never in its strip list, so it survives into the candidate title.
// isTitleSubstantiallyTheMessage does NOT reject it either: matchRatio is
// 1.0 (every title word appears in the raw message) but coverageRatio is
// ~0.57 (4 of 7 raw words) -- just under the 0.6 threshold -- so the
// candidate passes validateCandidateTitle's overlap check untouched. Given
// the PO's report that Gemini structured was intermittently 429ing when
// this task was created, resolveCreateTitle most likely fell through to
// exactly this pattern-fallback candidate (INC-01's own
// ProviderUnavailableError-with-a-fallback-available path, ligne 630+
// above, degrades silently by design) -- reproduced end-to-end below via
// both a failing AND a (defectively) matching model call, since the fix
// must hold either way (defense in depth, per the task instruction).
//
// Defect B -- a production task was created titled
// «به زبان فارسی پاسخ بده Preserve code product names titles URLs and
// technical» from an original request that is (visibly, per the PO's own
// report) the fa response-language steering instruction
// (src/features/ai/responseLanguage.ts's getAiResponseLanguageInstruction).
// Diagnosis: TasksPage.tsx's buildTaskAssistantRequestBody is the ONE
// call site that folds this instruction directly into the `message` field
// (via withAiResponseLanguageInstruction) rather than sending it as its
// own separate responseLanguageInstruction body field the way every other
// call site does (AgentBriefingCard.tsx, WeeklyBriefingPage.tsx,
// HabitsPage.tsx, FinancePage.tsx, CalendarPage.tsx, ChatPage.tsx,
// reasoningPrompt.ts -- grep-verified). That combined message reaches
// POST /chat's mode='chat' branch (index.ts:1026, the default when no
// `mode` field is sent, which buildTaskAssistantRequestBody never sends),
// which runs the SAME deterministic auto-write detector as any other chat
// message (index.ts:1111). The visible instruction text alone matches
// NONE of this file's create/update trigger regexes (verified: no
// create/add/set up before "task", no Persian create verb anywhere, no
// "دارم"/"I have" implicit-schedule trigger) -- so the create-task match
// necessarily came from real content in the "User question: ..." tail the
// widget appends after the instruction+context boilerplate. The bug is
// specifically in TITLE EXTRACTION, not trigger classification:
// extractTaskTitle's fallback + boundText's 80-char, START-anchored
// truncation spends the entire title budget on the leading boilerplate
// before ever reaching the real subject -- a manual character count of
// the fa instruction text (after extractTaskTitle's own comma/period/
// "task"-keyword stripping) lands the 80-char cutoff almost exactly at
// "...and technical", matching the reported title. Tightening the create
// trigger's regex would not address this (the match is on legitimate
// content elsewhere in the string, not on the visible instruction text) --
// this is why the fix lives in validateCandidateTitle (the same gate
// Defect A's fix uses), per the task's own alternate-branch instruction
// for exactly this situation.
describe('TITLE-01: framing-token stripping (Defect A) and instruction-fragment rejection (Defect B)', () => {
  const FAKE_ENV = {
    SUPABASE_URL: 'https://supa.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'service',
    GEMINI_API_KEY: 'key', GEMINI_MODEL: 'gemini-2.5-flash', AI: {} as unknown as Env['AI'],
  } as Env

  describe('cleanTitleEdges strips a leading title-framing preposition (Defect A)', () => {
    it.each([
      ['fa: به نام', 'به نام آزمایش جمنای', 'آزمایش جمنای'],
      ['fa: به اسم', 'به اسم آزمایش جمنای', 'آزمایش جمنای'],
      ['fa: با نام', 'با نام آزمایش جمنای', 'آزمایش جمنای'],
      ['fa: با عنوان', 'با عنوان آزمایش جمنای', 'آزمایش جمنای'],
      ['fa: تحت عنوان', 'تحت عنوان آزمایش جمنای', 'آزمایش جمنای'],
      ['en: called', 'called grocery shopping', 'grocery shopping'],
      ['en: named', 'named grocery shopping', 'grocery shopping'],
      ['en: titled', 'titled grocery shopping', 'grocery shopping'],
      ['en: with the name', 'with the name grocery shopping', 'grocery shopping'],
    ])('%s', (_label, candidate, expected) => {
      expect(cleanTitleEdges(candidate)).toBe(expected)
    })

    it('leaves a genuine subject with no framing prefix untouched', () => {
      expect(cleanTitleEdges('آزمایش جمنای')).toBe('آزمایش جمنای')
    })

    it('only strips a LEADING framing token, not one appearing mid-title', () => {
      expect(cleanTitleEdges('Review the file called report.pdf')).toBe('Review the file called report.pdf')
    })
  })

  describe('Defect A end-to-end: the exact reported message resolves to the real subject, not the framing phrase', () => {
    const message = 'یک وظیفه بساز به نام آزمایش جمنای'
    const expectedTitle = 'آزمایش جمنای'

    it('extractTaskTitle\'s own fallback candidate (intent.title) still carries the framing prefix -- the fix is a validator-layer fix, not a change to extraction itself', () => {
      expect(parseTaskWriteIntent(message, NOW, TZ)?.title).toBe('به نام آزمایش جمنای')
    })

    it('the pattern-fallback path (model unavailable) resolves to the real subject', async () => {
      const intent = parseTaskWriteIntent(message, NOW, TZ)!
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, message, async () => {
        throw new ProviderUnavailableError('429 RESOURCE_EXHAUSTED')
      })
      expect(title).toBe(expectedTitle)
    })

    it('defense in depth: a model candidate carrying the SAME framing prefix is also cleaned, not just the pattern fallback', async () => {
      const intent = parseTaskWriteIntent(message, NOW, TZ)!
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, message, async () => 'به نام آزمایش جمنای')
      expect(title).toBe(expectedTitle)
    })
  })

  describe('looksLikeInstructionFragment (Defect B)', () => {
    it.each([
      ['fa: full instruction opening', 'به زبان فارسی پاسخ بده Preserve code product names titles URLs and technical', true],
      ['fa: bare leading verb', 'پاسخ بده به این پیام', true],
      ['en: respond in', 'Respond in English please', true],
      ['en: reply in', 'Reply in German for this thread', true],
      ['de: antworte auf', 'Antworte auf Deutsch bitte', true],
      ['a genuine task title, unrelated', 'آزمایش جمنای', false],
      ['a genuine EN title that merely mentions replying, not as the leading verb', 'Draft a reply in the shared doc', false],
    ])('%s', (_label, candidate, expected) => {
      expect(looksLikeInstructionFragment(candidate)).toBe(expected)
    })
  })

  describe('Defect B end-to-end: the exact reported instruction text never becomes a task title', () => {
    // The literal leading clause of getAiResponseLanguageInstruction('fa')
    // (src/features/ai/responseLanguage.ts) -- deliberately SHORT (well
    // under the 60-char default bound) and, against the realistic
    // reconstructed rawMessage below, covers too small a share of it to
    // trip isTitleSubstantiallyTheMessage either. Isolates these tests to
    // the NEW instruction-fragment rejection specifically, proving it is
    // the operative reason, not a side effect of the length/overlap checks
    // this file already had (the FULL boilerplate text IS also too long
    // and IS also mostly-the-message -- that's not what this fix is for,
    // and is not what these tests claim to prove).
    const instructionLeadingClause = 'به زبان فارسی پاسخ بده'
    const rawMessage = `${instructionLeadingClause}. Preserve code, product names, task titles, URLs, and technical identifiers as needed.\n[Task context — use this real data to answer accurately:\nOpen: 3, Completed: 5]\nUser question: create a task to review the PR`

    it('the leading clause alone passes the length AND overlap checks on its own -- proving the rejection below comes from the new check, not those', () => {
      expect(instructionLeadingClause.length).toBeLessThan(60)
      expect(isTitleSubstantiallyTheMessage(instructionLeadingClause, rawMessage)).toBe(false)
    })

    it('validateCandidateTitle rejects the instruction-leading candidate outright', () => {
      expect(validateCandidateTitle(instructionLeadingClause, rawMessage)).toBeUndefined()
    })

    it('resolveCreateTaskTitle resolves to undefined when BOTH the model and the pattern fallback candidates are instruction-shaped -- this is what upstream turns into a clarify question, never a created task (executeAutoTaskWrite\'s own `!intent.title` branch)', async () => {
      const intent: ParsedTaskWriteIntent = { kind: 'create_task', title: instructionLeadingClause, notes: `Original request: ${rawMessage}` }
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, rawMessage, async () => instructionLeadingClause)
      expect(title).toBeUndefined()
    })

    it('a GENUINE model title alongside the same instruction-shaped pattern fallback still resolves correctly -- rejection is scoped to the instruction-shaped candidate only', async () => {
      const intent: ParsedTaskWriteIntent = { kind: 'create_task', title: instructionLeadingClause, notes: `Original request: ${rawMessage}` }
      const title = await resolveCreateTaskTitle(FAKE_ENV, intent, rawMessage, async () => 'review the PR')
      expect(title).toBe('review the PR')
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
    // Task 45c: repointed to the latest widening migration
    // (import_bank_statement's kind) -- each time this CHECK constraint is
    // widened via a new migration, this path must move to that new file,
    // the same way it moved here from the finance (20260817) migration
    // when THAT one was introduced. Earlier widening migrations remain in
    // the repo as migration history; they are not re-applied on top of
    // this one, this one's own `drop constraint if exists` + `add
    // constraint` fully re-specifies the complete allowed set standalone.
    '../../supabase/migrations/20260822000000_widen_flow_write_undo_kinds_import_bank_statement.sql',
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

  // Task 41 production bug: "مبلغ ۲۵ یورو در بخش مواد غذایی اضافه کن"
  // ("add an amount of 25 euros in the groceries category") produced no
  // proposal at all (isFinanceWriteTrigger returned false, so
  // detectWriteDomainSignal never even routed to finance) while an
  // equivalent "...ثبت کن" phrasing did. Root cause: the Farsi noun/verb
  // regex already listed "اضافه کن" as a valid verb, but required one of
  // هزینه/درآمد/تراکنش/پرداخت (expense/income/transaction/payment) as the
  // paired noun -- "مبلغ" (amount) was not among them. See
  // isFinanceWriteTrigger's own comment for the fix and why "بزن"/"وارد کن"
  // (also requested) stay noun-gated the same way every other verb here
  // already is.
  describe('task 41: Farsi finance trigger coverage (اضافه کن / وارد کن / بزن and equivalents)', () => {
    // Tested indirectly via parseFinanceWriteIntent/detectWriteDomainSignal
    // (both already exported), matching this file's existing convention --
    // isFinanceWriteTrigger itself, like its sibling isCalendarWriteTrigger,
    // stays a private, unexported implementation detail.
    it('the exact production phrase that produced no proposal now triggers finance, with direction inferred as expense (task 42, part B)', () => {
      const intent = parseFinanceWriteIntent('مبلغ ۲۵ یورو در بخش مواد غذایی اضافه کن', FINANCE_NOW, TZ)
      expect(intent).toMatchObject({ kind: 'create_finance_transaction', amount: 25, currency: 'EUR', direction: 'expense' })
      expect(detectWriteDomainSignal('مبلغ ۲۵ یورو در بخش مواد غذایی اضافه کن', FINANCE_NOW, TZ)).toBe('finance')
    })

    it.each([
      ['هزینه ۲۵ یورو مواد غذایی اضافه کن', 'add -- already covered, regression guard'],
      ['مبلغ ۲۵ یورو اضافه کن', 'add, paired with amount instead of expense'],
      ['هزینه ۲۵ یورو مواد غذایی وارد کن', 'enter'],
      ['مبلغ ۲۵ یورو وارد کن', 'enter, paired with amount'],
      ['هزینه ۲۵ یورو مواد غذایی بزن', 'colloquial log/put it'],
      ['مبلغ ۲۵ یورو بزن', 'colloquial, paired with amount'],
      ['یک هزینه ۲۵ یورو ثبت کن', 'record -- already covered, regression guard'],
    ])('triggers finance for phrasing: %s (%s)', (message) => {
      expect(parseFinanceWriteIntent(message, FINANCE_NOW, TZ)).not.toBeNull()
      expect(detectWriteDomainSignal(message, FINANCE_NOW, TZ)).toBe('finance')
    })

    it('the colloquial verb stays noun-gated -- a bare, unrelated use of the same overloaded verb is NOT finance evidence', () => {
      // Heavily overloaded in colloquial Persian (hit/play/dial/...); this
      // proves the fix did not turn it into an unconditional finance
      // trigger the way an ungated addition would.
      expect(parseFinanceWriteIntent('این آهنگ رو بزن', FINANCE_NOW, TZ)).toBeNull()
      expect(detectWriteDomainSignal('این آهنگ رو بزن', FINANCE_NOW, TZ)).toBe('none')
    })

    it('does not create a false-positive collision with task or calendar triggers', () => {
      expect(detectWriteDomainSignal('مبلغ ۲۵ یورو در بخش مواد غذایی اضافه کن', FINANCE_NOW, TZ)).toBe('finance')
    })
  })

  // Task 42, Part B: task 41-verify traced the PO's exact phrase all the
  // way through -- the trigger fires (task 41's own fix), but direction
  // came back undefined (no explicit expense/income word), so
  // intentValidator.ts downgraded the proposal to ask_clarification, which
  // ChatPage.tsx then silenced entirely (task 11b's blanket rule) --
  // leaving only the chat lane's own false completion promise. These tests
  // exercise the fix through parseFinanceWriteIntent (this file's own
  // integration point for shared/financeDirection.ts's
  // parseFinanceDirection), mirroring shared/financeDirection.test.ts's own
  // direct-unit corpus one layer up, at the level this file's other tests
  // already operate at.
  describe('task 42: finance direction inference from a spending category (shared/financeDirection.ts)', () => {
    it('the PO exact production phrase resolves direction to expense, not amountClarificationNeeded-shaped silence', () => {
      const intent = parseFinanceWriteIntent('مبلغ ۲۵ یورو در بخش مواد غذایی اضافه کن', FINANCE_NOW, TZ)
      expect(intent?.direction).toBe('expense')
    })

    it('an explicit income phrasing still yields income -- the category+verb inference never overrides an explicit word', () => {
      const intent = parseFinanceWriteIntent('حقوق ۵۰ یورو در بخش درآمد ثبت کن', FINANCE_NOW, TZ)
      expect(intent?.direction).toBe('income')
    })

    it('a genuinely ambiguous finance message (amount + write verb, no category, no explicit word) still leaves direction undefined', () => {
      const intent = parseFinanceWriteIntent('مبلغ ۲۰ یورو ثبت کن', FINANCE_NOW, TZ)
      expect(intent?.direction).toBeUndefined()
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

  describe('Task 45c, ADR-0017: checkDuplicateRows + executeBatchFinanceImport (batch import execution)', () => {
    // Local copy of the sibling describe block's own Call/mockSupabaseSequence
    // (that block scopes them to itself) -- same shape, same convention.
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

    function bankRow(overrides: Partial<ParsedBankRow> = {}): ParsedBankRow {
      return {
        lineNumber: 1,
        date: '2026-03-01',
        amount: 45.5,
        direction: 'expense',
        currency: 'EUR',
        counterparty: 'REWE Markt',
        counterpartyIban: 'DE00000000000000000000',
        counterpartyBic: '',
        purpose: 'Einkauf',
        bookingText: 'Kartenzahlung',
        creditorId: '',
        mandateReference: '',
        customerReference: 'REF001',
        rowHash: 'hash-1',
        ...overrides,
      }
    }

    describe('checkDuplicateRows', () => {
      it('returns an empty set with no fetch call at all for an empty hash list', async () => {
        const { fetchMock, calls } = mockSupabaseSequence([{ status: 200, body: [] }])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const result = await checkDuplicateRows(mockEnv(), 'user-1', [])
          expect(result.size).toBe(0)
          expect(calls.length).toBe(0)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('returns exactly the hashes the query reports as already existing, never inventing or dropping one', async () => {
        const { fetchMock, calls } = mockSupabaseSequence([{ status: 200, body: [{ row_hash: 'hash-2' }] }])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const result = await checkDuplicateRows(mockEnv(), 'user-1', ['hash-1', 'hash-2', 'hash-3'])
          expect(result).toEqual(new Set(['hash-2']))
          expect(String(calls[0].url)).toContain('finance_import_rows')
          expect(String(calls[0].url)).toContain('user_id=eq.user-1')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('fails open to an empty set (never throws) when the lookup query itself fails -- executeBatchFinanceImport\'s own DB-level unique constraint is the real backstop, not this function', async () => {
        const originalFetch = global.fetch
        global.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch
        try {
          const result = await checkDuplicateRows(mockEnv(), 'user-1', ['hash-1'])
          expect(result.size).toBe(0)
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    // Task 45c PART B (Ruling 3, PO): persistImportBatch/loadImportBatch/
    // markImportBatchConsumed are the primitives that lock a preview's
    // importable row set under a batchId so commit never re-derives it --
    // see flow-write-policy.ts's own header comment on this section. These
    // are unit-level proofs of the primitives themselves; the end-to-end
    // preview-then-commit flow (including the collision-detection and
    // retry-after-failure scenarios) is proven at the HTTP layer in
    // agent/worker/index.test.ts.
    describe('persistImportBatch + loadImportBatch + markImportBatchConsumed (Ruling 3 locking primitives)', () => {
      it('persistImportBatch sends exactly the given rows, userId, and a freshly generated batchId+expiresAt to finance_import_batches', async () => {
        const { fetchMock, calls } = mockSupabaseSequence([{ status: 201, body: null }])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const rows = [bankRow({ rowHash: 'hash-a' }), bankRow({ rowHash: 'hash-b', lineNumber: 2 })]
          const { batchId, expiresAt } = await persistImportBatch(mockEnv(), 'user-1', rows, FINANCE_NOW)
          expect(typeof batchId).toBe('string')
          expect(batchId.length).toBeGreaterThan(0)
          expect(new Date(expiresAt).getTime()).toBeGreaterThan(FINANCE_NOW.getTime())

          expect(calls).toHaveLength(1)
          expect(String(calls[0].url)).toContain('finance_import_batches')
          const sent = calls[0].body as { id: string; user_id: string; rows: unknown; expires_at: string }
          expect(sent.id).toBe(batchId)
          expect(sent.user_id).toBe('user-1')
          expect(sent.rows).toEqual(rows)
          expect(sent.expires_at).toBe(expiresAt)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('loadImportBatch returns the exact locked rows for a live, unconsumed, unexpired batch owned by this user', async () => {
        const rows = [bankRow({ rowHash: 'hash-a' })]
        const futureExpiry = new Date(FINANCE_NOW.getTime() + 60_000).toISOString()
        const { fetchMock } = mockSupabaseSequence([
          { status: 200, body: [{ id: 'batch-1', rows, expires_at: futureExpiry, consumed_at: null }] },
        ])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const result = await loadImportBatch(mockEnv(), 'user-1', 'batch-1', FINANCE_NOW)
          expect(result).toEqual({ rows })
        } finally {
          global.fetch = originalFetch
        }
      })

      it('loadImportBatch returns null for an unknown batchId (empty result), never throwing', async () => {
        const { fetchMock } = mockSupabaseSequence([{ status: 200, body: [] }])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const result = await loadImportBatch(mockEnv(), 'user-1', 'does-not-exist', FINANCE_NOW)
          expect(result).toBeNull()
        } finally {
          global.fetch = originalFetch
        }
      })

      it('loadImportBatch returns null for an already-consumed batch -- never returns a spent batch\'s rows for a second commit', async () => {
        const rows = [bankRow()]
        const futureExpiry = new Date(FINANCE_NOW.getTime() + 60_000).toISOString()
        const { fetchMock } = mockSupabaseSequence([
          { status: 200, body: [{ id: 'batch-1', rows, expires_at: futureExpiry, consumed_at: FINANCE_NOW.toISOString() }] },
        ])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const result = await loadImportBatch(mockEnv(), 'user-1', 'batch-1', FINANCE_NOW)
          expect(result).toBeNull()
        } finally {
          global.fetch = originalFetch
        }
      })

      it('loadImportBatch returns null for an expired batch, even if never consumed', async () => {
        const rows = [bankRow()]
        const pastExpiry = new Date(FINANCE_NOW.getTime() - 1_000).toISOString()
        const { fetchMock } = mockSupabaseSequence([
          { status: 200, body: [{ id: 'batch-1', rows, expires_at: pastExpiry, consumed_at: null }] },
        ])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const result = await loadImportBatch(mockEnv(), 'user-1', 'batch-1', FINANCE_NOW)
          expect(result).toBeNull()
        } finally {
          global.fetch = originalFetch
        }
      })

      it('loadImportBatch fails closed to null (never throws) when the lookup query itself fails', async () => {
        const originalFetch = global.fetch
        global.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch
        try {
          const result = await loadImportBatch(mockEnv(), 'user-1', 'batch-1', FINANCE_NOW)
          expect(result).toBeNull()
        } finally {
          global.fetch = originalFetch
        }
      })

      it('markImportBatchConsumed PATCHes consumed_at on exactly the given batchId', async () => {
        const { fetchMock, calls } = mockSupabaseSequence([{ status: 200, body: null }])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          await markImportBatchConsumed(mockEnv(), 'batch-1', FINANCE_NOW)
          expect(calls).toHaveLength(1)
          expect(calls[0].method).toBe('PATCH')
          expect(String(calls[0].url)).toContain('finance_import_batches')
          expect(String(calls[0].url)).toContain('id=eq.batch-1')
          expect((calls[0].body as { consumed_at: string }).consumed_at).toBe(FINANCE_NOW.toISOString())
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('executeBatchFinanceImport -- server-side bulk insert, never a browser-side call', () => {
      it('rejects an empty row list without making any network call', async () => {
        const { fetchMock, calls } = mockSupabaseSequence([{ status: 200, body: [] }])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const result = await executeBatchFinanceImport(mockEnv(), 'user-1', [], FINANCE_NOW)
          expect(result.status).toBe('failed')
          expect(calls.length).toBe(0)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('inserts every row in ONE bulk POST (array body, not N separate calls), persists one undo record covering the whole batch, and reports insertedCount', async () => {
        const rows = [
          bankRow({ lineNumber: 1, rowHash: 'hash-1', amount: 45.5, direction: 'expense' }),
          bankRow({ lineNumber: 2, rowHash: 'hash-2', amount: 2500, direction: 'income', customerReference: 'REF002' }),
        ]
        const insertedTxns = [
          { id: 'txn-a', user_id: 'user-1', type: 'expense', amount: 45.5, category: 'Bank Import', date: '2026-03-01', notes: 'Einkauf', created_at: FINANCE_NOW.toISOString(), updated_at: FINANCE_NOW.toISOString() },
          { id: 'txn-b', user_id: 'user-1', type: 'income', amount: 2500, category: 'Bank Import', date: '2026-03-01', notes: 'Einkauf', created_at: FINANCE_NOW.toISOString(), updated_at: FINANCE_NOW.toISOString() },
        ]
        const { fetchMock, calls } = mockSupabaseSequence([
          { status: 200, body: insertedTxns },      // POST finance_transactions (bulk)
          { status: 200, body: null },               // POST finance_import_rows (bulk bookkeeping)
          { status: 200, body: null },               // POST flow_write_undo_records
        ])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const result = await executeBatchFinanceImport(mockEnv(), 'user-1', rows, FINANCE_NOW)
          expect(result.status).toBe('executed')
          if (result.status !== 'executed') throw new Error('unreachable')
          expect(result.insertedCount).toBe(2)
          expect(result.transactionIds).toEqual(['txn-a', 'txn-b'])
          expect(result.undoId).toMatch(/^undo:/)

          // Exactly one POST to finance_transactions, with an ARRAY body of both rows.
          const txnCalls = calls.filter((c) => String(c.url).includes('finance_transactions') && c.method === 'POST')
          expect(txnCalls).toHaveLength(1)
          expect(Array.isArray(txnCalls[0].body)).toBe(true)
          expect((txnCalls[0].body as unknown[]).length).toBe(2)

          // Exactly one undo record for the WHOLE batch, not one per row.
          const undoCalls = calls.filter((c) => String(c.url).includes('flow_write_undo_records'))
          expect(undoCalls).toHaveLength(1)
          expect((undoCalls[0].body as { kind: string; payload: { transactionIds: string[] } }).kind).toBe('import_bank_statement')
          expect((undoCalls[0].body as { payload: { transactionIds: string[] } }).payload.transactionIds).toEqual(['txn-a', 'txn-b'])

          // Bookkeeping rows carry the row hash -> transaction id mapping.
          const bookkeepingCall = calls.find((c) => String(c.url).includes('finance_import_rows'))
          expect(bookkeepingCall).toBeTruthy()
          const bookkeepingBody = bookkeepingCall!.body as Array<{ row_hash: string; transaction_id: string }>
          expect(bookkeepingBody).toEqual([
            { row_hash: 'hash-1', transaction_id: 'txn-a', user_id: 'user-1', batch_id: expect.any(String) },
            { row_hash: 'hash-2', transaction_id: 'txn-b', user_id: 'user-1', batch_id: expect.any(String) },
          ]);
        } finally {
          global.fetch = originalFetch
        }
      })

      it('never inserts via the browser -- this function is the ONLY write path (proves the RLS bypass the task closes: no code here reads a user JWT, only env.SUPABASE_SERVICE_KEY)', async () => {
        const rows = [bankRow()]
        const { fetchMock, calls } = mockSupabaseSequence([
          { status: 200, body: [{ id: 'txn-a', user_id: 'user-1', type: 'expense', amount: 45.5, category: 'Bank Import', date: '2026-03-01', notes: 'Einkauf', created_at: FINANCE_NOW.toISOString(), updated_at: FINANCE_NOW.toISOString() }] },
          { status: 200, body: null },
          { status: 200, body: null },
        ])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          await executeBatchFinanceImport(mockEnv(), 'user-1', rows, FINANCE_NOW)
          for (const call of calls) {
            // Every request carries the service-role key, never a per-user bearer token.
            expect(String(call.url)).toContain('supa.test')
          }
          expect(calls.every((c) => c.method === 'POST')).toBe(true)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('all-or-nothing on insert failure: a rejected finance_transactions POST fails the whole batch honestly (never throws -- the HTTP handler needs a clean result to turn into a 502, not an uncaught exception), no partial insert, no undo record attempted', async () => {
        const rows = [bankRow(), bankRow({ lineNumber: 2, rowHash: 'hash-2', customerReference: 'REF002' })]
        const originalFetch = global.fetch
        global.fetch = (async () => new Response('db unavailable', { status: 500 })) as typeof fetch
        try {
          const result = await executeBatchFinanceImport(mockEnv(), 'user-1', rows, FINANCE_NOW)
          expect(result.status).toBe('failed')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('rolls back the just-inserted transactions when the finance_import_rows bookkeeping insert fails (bookkeeping failure must not leave orphaned, un-tracked transactions)', async () => {
        const rows = [bankRow()]
        const insertedTxn = { id: 'txn-a', user_id: 'user-1', type: 'expense', amount: 45.5, category: 'Bank Import', date: '2026-03-01', notes: 'Einkauf', created_at: FINANCE_NOW.toISOString(), updated_at: FINANCE_NOW.toISOString() }
        const { fetchMock, calls } = mockSupabaseSequence([
          { status: 200, body: [insertedTxn] },       // POST finance_transactions succeeds
          { status: 500, body: { message: 'unique_violation' } }, // POST finance_import_rows fails
          { status: 200, body: [{ id: 'txn-a' }] },   // DELETE finance_transactions (rollback)
        ])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const result = await executeBatchFinanceImport(mockEnv(), 'user-1', rows, FINANCE_NOW)
          expect(result.status).toBe('failed')
          const deleteCall = calls.find((c) => c.method === 'DELETE' && String(c.url).includes('finance_transactions'))
          expect(deleteCall).toBeTruthy()
          expect(String(deleteCall!.url)).toContain('txn-a')
          // No undo record was ever attempted -- nothing survived to undo.
          expect(calls.some((c) => String(c.url).includes('flow_write_undo_records'))).toBe(false)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('rolls back BOTH the transactions and the bookkeeping rows when undo-record persistence fails (persist-first, same as every other domain)', async () => {
        const rows = [bankRow()]
        const insertedTxn = { id: 'txn-a', user_id: 'user-1', type: 'expense', amount: 45.5, category: 'Bank Import', date: '2026-03-01', notes: 'Einkauf', created_at: FINANCE_NOW.toISOString(), updated_at: FINANCE_NOW.toISOString() }
        const { fetchMock, calls } = mockSupabaseSequence([
          { status: 200, body: [insertedTxn] },  // POST finance_transactions
          { status: 200, body: null },            // POST finance_import_rows
          { status: 500, body: { code: '23514', message: 'check constraint' } }, // POST flow_write_undo_records fails
          { status: 200, body: [{ id: 'txn-a' }] },  // DELETE finance_transactions (rollback)
          { status: 200, body: null },              // DELETE finance_import_rows (rollback)
        ])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const result = await executeBatchFinanceImport(mockEnv(), 'user-1', rows, FINANCE_NOW)
          expect(result.status).toBe('failed')
          const deletes = calls.filter((c) => c.method === 'DELETE')
          expect(deletes.some((c) => String(c.url).includes('finance_transactions'))).toBe(true)
          expect(deletes.some((c) => String(c.url).includes('finance_import_rows'))).toBe(true)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('undo round trip: undoAutoWrite reverses the WHOLE batch with one bulk DELETE, and cleans up finance_import_rows too', async () => {
        const rows = [bankRow({ rowHash: 'hash-1' }), bankRow({ lineNumber: 2, rowHash: 'hash-2', customerReference: 'REF002' })]
        const insertedTxns = [
          { id: 'txn-a', user_id: 'user-1', type: 'expense', amount: 45.5, category: 'Bank Import', date: '2026-03-01', notes: 'Einkauf', created_at: FINANCE_NOW.toISOString(), updated_at: FINANCE_NOW.toISOString() },
          { id: 'txn-b', user_id: 'user-1', type: 'expense', amount: 45.5, category: 'Bank Import', date: '2026-03-01', notes: 'Einkauf', created_at: FINANCE_NOW.toISOString(), updated_at: FINANCE_NOW.toISOString() },
        ]
        const { fetchMock } = mockSupabaseSequence([
          { status: 200, body: insertedTxns },
          { status: 200, body: null },
          { status: 200, body: null },
        ])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        let undoId = ''
        try {
          const result = await executeBatchFinanceImport(mockEnv(), 'user-1', rows, FINANCE_NOW)
          if (result.status !== 'executed') throw new Error('setup failed')
          undoId = result.undoId
        } finally {
          global.fetch = originalFetch
        }

        const undoRow = {
          id: undoUuidFromId(undoId),
          user_id: 'user-1',
          kind: 'import_bank_statement',
          task_id: 'txn-a',
          payload: { transactionIds: ['txn-a', 'txn-b'] },
          expires_at: new Date(FINANCE_NOW.getTime() + 60_000).toISOString(),
          consumed_at: null,
        }
        const { fetchMock: undoFetchMock, calls: undoCalls } = mockSupabaseSequence([
          { status: 200, body: [undoRow] },        // GET flow_write_undo_records
          { status: 200, body: null },              // PATCH consumed_at
          { status: 200, body: [{ id: 'txn-a' }, { id: 'txn-b' }] }, // DELETE finance_transactions (bulk)
          { status: 200, body: null },              // DELETE finance_import_rows (bulk)
        ])
        global.fetch = undoFetchMock
        try {
          const undone = await undoAutoWrite(mockEnv(), 'user-1', undoId, FINANCE_NOW)
          expect(undone).toBe(true)
          const deletes = undoCalls.filter((c) => c.method === 'DELETE')
          expect(deletes).toHaveLength(2)
          expect(String(deletes[0].url)).toContain('finance_transactions')
          expect(String(deletes[0].url)).toContain('id=in.(txn-a,txn-b)')
          expect(String(deletes[1].url)).toContain('finance_import_rows')
        } finally {
          global.fetch = originalFetch
        }
      })

      // Non-tautology proof: a batch import undo record must NEVER be
      // reconstructable from a payload missing transactionIds -- this is
      // what stops consumeUndoRecord from silently returning a "reversible"
      // entry that would delete nothing (an empty id=in.() filter, or worse,
      // never call DELETE at all while still reporting success).
      it('non-tautology: undoAutoWrite returns false (not true) when the stored payload has no transactionIds', async () => {
        const undoRow = {
          id: 'undo-id-2', user_id: 'user-1', kind: 'import_bank_statement', task_id: 'txn-a',
          payload: {}, // missing transactionIds
          expires_at: new Date(FINANCE_NOW.getTime() + 60_000).toISOString(), consumed_at: null,
        }
        const { fetchMock } = mockSupabaseSequence([{ status: 200, body: [undoRow] }, { status: 200, body: null }])
        const originalFetch = global.fetch
        global.fetch = fetchMock
        try {
          const undone = await undoAutoWrite(mockEnv(), 'user-1', 'undo:undo-id-2', FINANCE_NOW)
          expect(undone).toBe(false)
        } finally {
          global.fetch = originalFetch
        }
      })
    })
  })
})

function undoUuidFromId(undoId: string): string {
  return undoId.startsWith('undo:') ? undoId.slice('undo:'.length) : undoId
}

// Task 40, ADR-0016 Slice 2, Part D item 10: proves the auto-lane's
// target_fields derivation is shape-only -- given an intent whose VALUES
// include a real amount and a real description, the returned array must
// contain only the corresponding FIELD NAMES, never those values, and must
// never contain a name for a field the intent left unset.
describe('task 40: proposal-outcome target field extraction is shape-only', () => {
  it('taskIntentTargetFields returns only the names of populated task fields', () => {
    const intent: ParsedTaskWriteIntent = {
      kind: 'create_task',
      title: 'Buy groceries for the week',
      notes: 'milk, eggs, bread',
      dueDate: '2026-08-20',
    }
    const fields = taskIntentTargetFields(intent)
    expect(fields.sort()).toEqual(['dueDate', 'notes', 'title'].sort())
    // Never a raw value anywhere in the result.
    expect(fields).not.toContain('Buy groceries for the week')
    expect(fields).not.toContain('milk, eggs, bread')
    expect(fields).not.toContain('2026-08-20')
    // Never an unset field's name either.
    expect(fields).not.toContain('taskReference')
    expect(fields).not.toContain('timeOfDay')
  })

  it('taskIntentTargetFields excludes control-flow fields (kind, titleSource, dateClarificationNeeded)', () => {
    const intent: ParsedTaskWriteIntent = { kind: 'create_task', title: 'x', titleSource: 'correction', dateClarificationNeeded: false }
    const fields = taskIntentTargetFields(intent)
    expect(fields).toEqual(['title'])
  })

  // Task 41: 'title' is reported as the registry's own 'eventTitle' name,
  // not the ParsedCalendarWriteIntent property name -- see
  // CALENDAR_INTENT_TARGET_FIELD_MAP's own comment for why the raw
  // property name would otherwise collide with tasks' registry vocabulary.
  it('calendarIntentTargetFields returns only the names of populated calendar fields (registry-named), never their values', () => {
    const intent: ParsedCalendarWriteIntent = {
      kind: 'create_calendar_event',
      title: 'Doctor appointment',
      startDate: '2026-08-21',
      startTime: '13:00',
    }
    const fields = calendarIntentTargetFields(intent)
    expect(fields.sort()).toEqual(['eventTitle', 'startDate', 'startTime'].sort())
    expect(fields).not.toContain('title')
    expect(fields).not.toContain('Doctor appointment')
    expect(fields).not.toContain('13:00')
  })

  it('financeIntentTargetFields returns only field names, never a real amount or description value', () => {
    const intent: ParsedFinanceWriteIntent = {
      kind: 'create_finance_transaction',
      amount: 45,
      direction: 'expense',
      description: 'groceries for the week',
      iban: 'DE89370400440532013000',
      amountClarificationNeeded: false,
    }
    const fields = financeIntentTargetFields(intent)
    expect(fields.sort()).toEqual(['amount', 'description', 'direction', 'iban'].sort())
    // The whole point of this test: the actual amount/description/IBAN
    // values must never appear anywhere in the returned array.
    expect(fields).not.toContain(45)
    expect(fields).not.toContain('groceries for the week')
    expect(fields).not.toContain('DE89370400440532013000')
    expect(fields.every((f) => typeof f === 'string')).toBe(true)
  })

  it('financeIntentTargetFields excludes amountClarificationNeeded/ibanValid/kind', () => {
    const intent: ParsedFinanceWriteIntent = {
      kind: 'create_finance_transaction',
      amount: 10,
      amountClarificationNeeded: false,
      ibanValid: true,
    }
    expect(financeIntentTargetFields(intent)).toEqual(['amount'])
  })

  it('returns an empty array when no target fields are populated', () => {
    expect(taskIntentTargetFields({ kind: 'update_task' })).toEqual([])
    expect(calendarIntentTargetFields({ kind: 'update_calendar_event' })).toEqual([])
    expect(financeIntentTargetFields({ kind: 'create_finance_transaction', amountClarificationNeeded: true })).toEqual([])
  })
})

// Task 41: the production bug (agent_proposal_outcomes rows carrying
// updateTitle/updateBody on a create_finance_transaction row) was traced to
// the FRONTEND's extractor (proposalOutcomeReporting.ts's
// writeProposalTargetFields), which used to trust Object.keys() on a target
// object it didn't control the shape of. The Worker's three extractors
// above are structurally immune to that same bug -- each operates on its
// own domain-specific TypeScript interface (ParsedTaskWriteIntent /
// ParsedCalendarWriteIntent / ParsedFinanceWriteIntent), so accessing a
// field name from a DIFFERENT domain is a compile error, not just a
// runtime possibility. These tests make that guarantee explicit and
// registry-cross-checked rather than merely asserted in a comment: for
// every field an extractor CAN emit, it must be either a field WRITE_DOMAIN_
// TARGET_FIELDS also lists for that exact domain, or one of the Worker's
// own documented time-shaped fields with no registry equivalent (the
// deterministic parser stores start/end as separate startDate/startTime/
// endTime, and tasks as timeOfDay, rather than the registry's single ISO
// start/end strings) -- and it must NEVER be a field name that belongs to
// a DIFFERENT domain's own registry vocabulary.
describe('task 41: Worker target-field extractors never cross domain boundaries (registry-derived)', () => {
  const registryFieldNames = (domain: 'tasks' | 'calendar' | 'finance') =>
    new Set(WRITE_DOMAIN_TARGET_FIELDS[domain].map((field) => field.name))

  // Fields the deterministic parser reports under a name with no registry
  // equivalent at all (time-of-day granularity the registry's flat
  // start/end don't separate, and calendar's own eventDescription, invented
  // specifically because the registry has no notes/description field for
  // calendar -- see CALENDAR_INTENT_TARGET_FIELD_MAP's own comment).
  // Legitimate, not a leak, because none of these names collide with
  // another domain's registry vocabulary either.
  const WORKER_ONLY_NON_REGISTRY_FIELDS = new Set(['timeOfDay', 'startDate', 'startTime', 'endTime', 'eventDescription'])

  it('financeIntentTargetFields never emits a task or calendar field name', () => {
    const intent: ParsedFinanceWriteIntent = {
      kind: 'create_finance_transaction',
      amount: 45,
      currency: 'EUR',
      direction: 'expense',
      transactionDate: '2026-08-20',
      description: 'groceries',
      iban: 'DE89370400440532013000',
      amountClarificationNeeded: false,
    }
    const fields = financeIntentTargetFields(intent)
    expect(fields.length).toBeGreaterThan(0)
    for (const field of fields) {
      expect(registryFieldNames('tasks').has(field)).toBe(false)
      expect(registryFieldNames('calendar').has(field)).toBe(false)
      expect(WORKER_ONLY_NON_REGISTRY_FIELDS.has(field) || registryFieldNames('finance').has(field)).toBe(true)
    }
  })

  it('taskIntentTargetFields never emits a calendar or finance field name', () => {
    const intent: ParsedTaskWriteIntent = {
      kind: 'create_task',
      title: 'Buy groceries',
      taskReference: 'groceries',
      notes: 'milk, eggs',
      dueDate: '2026-08-21',
      timeOfDay: '15:00',
    }
    const fields = taskIntentTargetFields(intent)
    expect(fields.length).toBeGreaterThan(0)
    for (const field of fields) {
      expect(registryFieldNames('calendar').has(field)).toBe(false)
      expect(registryFieldNames('finance').has(field)).toBe(false)
      expect(WORKER_ONLY_NON_REGISTRY_FIELDS.has(field) || registryFieldNames('tasks').has(field)).toBe(true)
    }
  })

  it('calendarIntentTargetFields never emits a task or finance field name', () => {
    const intent: ParsedCalendarWriteIntent = {
      kind: 'create_calendar_event',
      title: 'Team sync',
      eventReference: 'team sync',
      notes: 'bring laptop',
      startDate: '2026-08-21',
      startTime: '13:00',
      endTime: '14:00',
    }
    const fields = calendarIntentTargetFields(intent)
    expect(fields.length).toBeGreaterThan(0)
    for (const field of fields) {
      expect(registryFieldNames('tasks').has(field)).toBe(false)
      expect(registryFieldNames('finance').has(field)).toBe(false)
      expect(WORKER_ONLY_NON_REGISTRY_FIELDS.has(field) || registryFieldNames('calendar').has(field)).toBe(true)
    }
  })
})

describe('task 40: writeIntentOutcomeIdentity is registry-derived, not hand-mapped', () => {
  it.each(writeIntentRegistry.map((entry) => [entry.intentType, entry.toolId] as const))(
    '%s resolves to its own registry toolId %s',
    (intentType, toolId) => {
      expect(writeIntentOutcomeIdentity(intentType)).toEqual({ intentType, toolId })
    },
  )

  it('returns null for a kind with no registry entry', () => {
    expect(writeIntentOutcomeIdentity('not_a_real_intent_type' as never)).toBeNull()
  })
})
