import { describe, expect, it } from 'vitest'
import {
  WRITE_DOMAIN_TARGET_FIELDS,
  WRITE_INTENT_TARGET_FIELD_NAMES,
  findWriteIntentDescriptor,
  findWriteIntentDescriptorByToolId,
  writeIntentRegistry,
  type WriteIntentPreviewLabels,
  type WriteIntentType,
} from './writeIntentRegistry'

// Task 30: the full label set every previewLines hook is called with in
// production (see ChatPage.tsx's own previewLabels object) -- task/calendar
// entries only read title/due/notes/start/end/none; finance reads
// amount/direction/date/category/description/iban. A single shared fixture
// so a future domain's own labels don't need yet another hand-copied object
// literal per test.
const PREVIEW_LABELS_FIXTURE: WriteIntentPreviewLabels = {
  title: 'Title',
  due: 'Due',
  notes: 'Notes',
  start: 'Start',
  end: 'End',
  none: 'None',
  amount: 'Amount',
  direction: 'Direction',
  date: 'Date',
  category: 'Category',
  description: 'Description',
  iban: 'IBAN',
}

// Task 23: the exact set of write intents this registry is authoritative
// for today (tasks + calendar only, per the task's own scope). A future
// domain grows this list -- and this test's own membership assertions --
// as its ONE required registry-side edit; see
// docs/architecture/adding-a-write-domain.md.
const EXPECTED_INTENT_TYPES: readonly WriteIntentType[] = [
  'create_task',
  'update_task',
  'create_calendar_event',
  'update_calendar_event',
  'create_finance_transaction',
  'import_bank_statement',
]

describe('writeIntentRegistry completeness (task 23)', () => {
  it('has exactly the expected write intents, no more, no fewer', () => {
    expect(writeIntentRegistry.map((entry) => entry.intentType)).toEqual(EXPECTED_INTENT_TYPES)
  })

  it('every AgentIntentType write value has exactly one registry entry, and vice versa', () => {
    for (const intentType of EXPECTED_INTENT_TYPES) {
      const matches = writeIntentRegistry.filter((entry) => entry.intentType === intentType)
      expect(matches, `expected exactly one registry entry for ${intentType}`).toHaveLength(1)
    }
    for (const entry of writeIntentRegistry) {
      expect(EXPECTED_INTENT_TYPES, `registry entry ${entry.intentType} is not a known write intent type`).toContain(entry.intentType)
    }
  })

  it.each(writeIntentRegistry.map((entry) => [entry.intentType, entry] as const))(
    '%s has every required descriptor field populated',
    (_intentType, entry) => {
      expect(entry.intentType).toBeTruthy()
      expect(['tasks', 'calendar', 'finance']).toContain(entry.domain)
      expect(['create', 'update']).toContain(entry.action)
      expect(entry.toolId).toBeTruthy()
      expect(entry.capability).toBeTruthy()
      expect(['chat', 'ui-only']).toContain(entry.exposure)
      expect(entry.undoKind).toBeTruthy()
      expect(typeof entry.reversible).toBe('boolean')
      expect(entry.successSummary).toBeTruthy()
      expect(entry.i18n.titleKey).toBeTruthy()
      expect(entry.i18n.descriptionKey).toBeTruthy()
      expect(entry.i18n.approvalReasonKey).toBeTruthy()
      expect(typeof entry.descriptionTitle).toBe('function')
      expect(typeof entry.previewLines).toBe('function')
      expect(typeof entry.buildHandlerInput).toBe('function')
      // create entries need at least one required target field to gate on;
      // update entries need a targetIdField to resolve an existing record.
      // Exactly one of the two applies -- matches every current entry's
      // pre-refactor behaviour (create had a bespoke field check and no
      // existing-record id; update had an existing-record id and no bespoke
      // field check).
      if (entry.action === 'create') {
        expect(entry.createRequiredTargetFields?.length ?? 0).toBeGreaterThan(0);
        expect(entry.targetIdField).toBeUndefined()
      } else {
        expect(entry.targetIdField).toBeTruthy()
        expect(entry.createRequiredTargetFields).toBeUndefined()
      }
      // Task 36b, ADR-0013 Slice 0: promptInstruction is optional (see the
      // registry interface's own comment for why create_task/update_task
      // don't have one) -- but wherever it IS present, it must be real text,
      // never an accidentally-set empty string.
      if (entry.promptInstruction !== undefined) {
        expect(entry.promptInstruction.trim().length).toBeGreaterThan(0)
      }
    },
  )

  // Task 36b, ADR-0013 Slice 0: locks in which entries were actually
  // backfilled (calendar + finance, sourced verbatim from
  // reasoningPrompt.ts's existing per-intent prose) versus left unset
  // (tasks, which has no equivalent existing prose to move) -- so a future
  // edit that silently drops or adds promptInstruction on the wrong entry
  // fails here, not only via the generic non-empty check above.
  it('promptInstruction is backfilled for calendar and finance entries, left unset for tasks and import_bank_statement', () => {
    const withInstruction = writeIntentRegistry
      .filter((entry) => entry.promptInstruction !== undefined)
      .map((entry) => entry.intentType)
    expect(withInstruction).toEqual(['create_calendar_event', 'update_calendar_event', 'create_finance_transaction'])

    const withoutInstruction = writeIntentRegistry
      .filter((entry) => entry.promptInstruction === undefined)
      .map((entry) => entry.intentType)
    // Task 45c, ADR-0017: import_bank_statement deliberately has no
    // promptInstruction -- see its own registry-entry comment for why this
    // is one of several deliberate layers keeping it out of chat, not an
    // oversight to backfill later.
    expect(withoutInstruction).toEqual(['create_task', 'update_task', 'import_bank_statement'])
  })

  it('every entry resolves by its own toolId', () => {
    for (const entry of writeIntentRegistry) {
      expect(findWriteIntentDescriptorByToolId(entry.toolId)).toBe(entry)
      expect(findWriteIntentDescriptor(entry.intentType)).toBe(entry)
    }
  })

  // Task 45c PART B (Ruling 2, PO): locks in exactly which entries are
  // chat-exposed versus ui-only, the same "name the exact expected set, not
  // just a shape check" discipline EXPECTED_INTENT_TYPES above already
  // applies to registry membership -- a future entry silently defaulting to
  // the wrong exposure fails here, not only in production behavior.
  it('exposure is chat for every pre-45c entry, ui-only only for import_bank_statement', () => {
    const chatExposed = writeIntentRegistry.filter((entry) => entry.exposure === 'chat').map((entry) => entry.intentType)
    expect(chatExposed).toEqual(['create_task', 'update_task', 'create_calendar_event', 'update_calendar_event', 'create_finance_transaction'])

    const uiOnly = writeIntentRegistry.filter((entry) => entry.exposure === 'ui-only').map((entry) => entry.intentType)
    expect(uiOnly).toEqual(['import_bank_statement'])
  })

  it('every entry undoKind is one of the registry intent types (undo bookkeeping never names an unknown kind)', () => {
    for (const entry of writeIntentRegistry) {
      expect(EXPECTED_INTENT_TYPES).toContain(entry.undoKind)
    }
  })

  it('unknown intent/toolId lookups return undefined, not a false match', () => {
    expect(findWriteIntentDescriptor('inspect_tasks')).toBeUndefined()
    expect(findWriteIntentDescriptor('not_a_real_intent')).toBeUndefined()
    expect(findWriteIntentDescriptorByToolId('tasks.complete')).toBeUndefined()
    expect(findWriteIntentDescriptorByToolId('not.a.real.tool')).toBeUndefined()
  })

  it('WRITE_INTENT_TARGET_FIELD_NAMES is exactly the domain-grouped union (tasks fields then calendar fields), matching the pre-refactor schema field order', () => {
    expect(WRITE_INTENT_TARGET_FIELD_NAMES).toEqual([
      'taskId', 'taskReference', 'taskTitleHint', 'title', 'notes', 'dueDate',
      'eventTitle', 'eventReference', 'eventId', 'start', 'end',
      'amount', 'currency', 'direction', 'transactionDate', 'category', 'description', 'iban', 'batchId',
    ])
  })

  it('every domain in WRITE_DOMAIN_TARGET_FIELDS is used by at least one registry entry', () => {
    const domainsInRegistry = new Set(writeIntentRegistry.map((entry) => entry.domain))
    for (const domain of Object.keys(WRITE_DOMAIN_TARGET_FIELDS)) {
      expect(domainsInRegistry.has(domain as keyof typeof WRITE_DOMAIN_TARGET_FIELDS)).toBe(true)
    }
  })

  describe('ported hook behaviour spot-checks (guard against silent drift during future edits)', () => {
    it('create_task.buildHandlerInput matches the pre-refactor {userId, title, notes, dueDate} shape', () => {
      const entry = findWriteIntentDescriptor('create_task')!
      expect(entry.buildHandlerInput({ actorId: 'user-1', target: { title: 'Buy milk', notes: 'skim', dueDate: '2026-08-20' } }))
        .toEqual({ userId: 'user-1', title: 'Buy milk', notes: 'skim', dueDate: '2026-08-20' })
      expect(entry.buildHandlerInput({ actorId: 'user-1', target: {} }).dueDate).toBeNull()
    })

    it('update_calendar_event.buildHandlerInput omits fields the target never mentioned (partial update semantics)', () => {
      const entry = findWriteIntentDescriptor('update_calendar_event')!
      expect(entry.buildHandlerInput({ actorId: 'user-1', targetId: 'event-1', target: { eventTitle: 'Standup' } }))
        .toEqual({ userId: 'user-1', eventId: 'event-1', title: 'Standup' })
    })

    it('update_task.previewLines shows "none" for an explicit null dueDate, and omits the due line entirely when dueDate was never mentioned', () => {
      const entry = findWriteIntentDescriptor('update_task')!
      const labels = { ...PREVIEW_LABELS_FIXTURE }
      expect(entry.previewLines({ dueDate: null }, labels).filter(Boolean)).toEqual(['Due: None'])
      expect(entry.previewLines({}, labels).filter(Boolean)).toEqual([])
    })

    // PREVIEW-01: calendar start/end are UTC ISO instants. Production
    // evidence: the proposal preview showed "Start: 2026-09-05T10:00:00.000Z"
    // to a user who asked for 12:00 local -- correct instant, unreadable
    // display. When the caller passes labels.formatDateTime the lines use
    // it; without one (Worker-side/legacy callers) the value stays VERBATIM.
    it('PREVIEW-01: create_calendar_event.previewLines renders start/end through labels.formatDateTime when provided', () => {
      const entry = findWriteIntentDescriptor('create_calendar_event')!
      const labels = { ...PREVIEW_LABELS_FIXTURE, formatDateTime: (iso: string) => `LOCAL(${iso})` }
      expect(entry.previewLines({ eventTitle: 'Dentist', start: '2026-09-05T10:00:00.000Z', end: '2026-09-05T11:00:00.000Z' }, labels).filter(Boolean)).toEqual([
        'Title: Dentist',
        'Start: LOCAL(2026-09-05T10:00:00.000Z)',
        'End: LOCAL(2026-09-05T11:00:00.000Z)',
      ])
    })

    it('PREVIEW-01: without labels.formatDateTime the calendar start/end values stay verbatim (Worker/legacy callers unchanged)', () => {
      const entry = findWriteIntentDescriptor('create_calendar_event')!
      const labels = { ...PREVIEW_LABELS_FIXTURE }
      expect(entry.previewLines({ eventTitle: 'Dentist', start: '2026-09-05T10:00:00.000Z' }, labels).filter(Boolean)).toEqual([
        'Title: Dentist',
        'Start: 2026-09-05T10:00:00.000Z',
      ])
    })

    it('PREVIEW-01: update_calendar_event.previewLines formats start/end the same way, and only formats lines that exist', () => {
      const entry = findWriteIntentDescriptor('update_calendar_event')!
      const labels = { ...PREVIEW_LABELS_FIXTURE, formatDateTime: (iso: string) => `LOCAL(${iso})` }
      expect(entry.previewLines({ start: '2026-09-05T10:00:00.000Z' }, labels).filter(Boolean)).toEqual([
        'Start: LOCAL(2026-09-05T10:00:00.000Z)',
      ])
    })

    it('PREVIEW-01: the formatter never sees the title -- only start/end instants are routed through it', () => {
      const entry = findWriteIntentDescriptor('create_calendar_event')!
      const seen: string[] = []
      const labels = { ...PREVIEW_LABELS_FIXTURE, formatDateTime: (iso: string) => { seen.push(iso); return iso } }
      entry.previewLines({ eventTitle: 'Dentist', start: '2026-09-05T10:00:00.000Z', end: '2026-09-05T11:00:00.000Z' }, labels)
      expect(seen).toEqual(['2026-09-05T10:00:00.000Z', '2026-09-05T11:00:00.000Z'])
    })

    it('create_finance_transaction.buildHandlerInput maps direction to type, never persists iban, and defaults category to null when unmentioned', () => {
      const entry = findWriteIntentDescriptor('create_finance_transaction')!
      expect(entry.buildHandlerInput({
        actorId: 'user-1',
        target: { amount: '45.50', direction: 'expense', transactionDate: '2026-08-20', category: 'Groceries', description: 'weekly shop', iban: 'DE89370400440532013000' },
      })).toEqual({ userId: 'user-1', type: 'expense', amount: '45.50', category: 'Groceries', date: '2026-08-20', notes: 'weekly shop' })
      expect(entry.buildHandlerInput({ actorId: 'user-1', target: { amount: '10', direction: 'income', transactionDate: '2026-08-20' } }).category).toBe('Flow AI')
    })

    it('create_finance_transaction.previewLines flags an IBAN as sensitive and never omits it silently', () => {
      const entry = findWriteIntentDescriptor('create_finance_transaction')!
      const labels = { ...PREVIEW_LABELS_FIXTURE }
      const lines = entry.previewLines({ amount: '45.50', currency: 'EUR', direction: 'expense', iban: 'DE89370400440532013000' }, labels).filter(Boolean)
      expect(lines.some((line) => line?.includes('sensitive'))).toBe(true)
    })

    // Task 30: production evidence -- the finance approval card rendered
    // "Title: 45 EUR", "Title: expense" (two lines both labeled Title,
    // since amount and direction both reused labels.title), "Due:
    // 2026-08-17" (labels.due, task/calendar's own vocabulary), "Notes:
    // مواد غذایی" (labels.notes, reused for category too). This is the
    // guard that catches a regression back to that bug: it fails loudly
    // (not silently truncates/mislabels) if previewLines ever again reuses
    // the task/calendar label set instead of its own.
    it('create_finance_transaction.previewLines uses finance-specific labels, never the task/calendar Title/Due/Notes vocabulary', () => {
      const entry = findWriteIntentDescriptor('create_finance_transaction')!
      const labels = { ...PREVIEW_LABELS_FIXTURE }
      const lines = entry.previewLines(
        {
          amount: '45',
          currency: 'EUR',
          direction: 'expense',
          transactionDate: '2026-08-17',
          category: 'Groceries',
          description: 'weekly shop',
        },
        labels,
      ).filter((line): line is string => Boolean(line))

      expect(lines.some((line) => line.startsWith(`${labels.amount}:`))).toBe(true)
      expect(lines.some((line) => line.startsWith(`${labels.direction}:`))).toBe(true)
      expect(lines.some((line) => line.startsWith(`${labels.date}:`))).toBe(true)
      expect(lines.some((line) => line.startsWith(`${labels.category}:`))).toBe(true)
      expect(lines.some((line) => line.startsWith(`${labels.description}:`))).toBe(true)
      // The exact regression: amount AND direction both used to render as
      // "Title: ...", so there were two "Title:"-prefixed lines and the
      // date line read "Due: ..." instead of "Date: ...".
      expect(lines.filter((line) => line.startsWith(`${labels.title}:`))).toHaveLength(0)
      expect(lines.some((line) => line.startsWith(`${labels.due}:`))).toBe(false)
      expect(lines.some((line) => line.startsWith(`${labels.notes}:`))).toBe(false)
    })

    it('create_finance_transaction.previewLines bidi-isolates the amount and date tokens (same LRI/PDI mechanism as 4995b29)', () => {
      const entry = findWriteIntentDescriptor('create_finance_transaction')!
      const labels = { ...PREVIEW_LABELS_FIXTURE }
      const lines = entry.previewLines(
        { amount: '45', currency: 'EUR', direction: 'expense', transactionDate: '2026-08-17' },
        labels,
      ).filter((line): line is string => Boolean(line))
      const amountLine = lines.find((line) => line.startsWith(`${labels.amount}:`))
      const dateLine = lines.find((line) => line.startsWith(`${labels.date}:`))
      expect(amountLine).toContain('⁦')
      expect(amountLine).toContain('⁩')
      expect(dateLine).toContain('⁦')
      expect(dateLine).toContain('⁩')
    })

    // Task 45c, ADR-0017: import_bank_statement's hooks exist only for
    // registry-interface completeness (see its own entry comment) -- this
    // pins that they are deliberately minimal/inert, not accidentally so.
    it('import_bank_statement.previewLines always returns an empty array (the real preview is buildBatchImportPreview, not this generic hook)', () => {
      const entry = findWriteIntentDescriptor('import_bank_statement')!
      const labels = { ...PREVIEW_LABELS_FIXTURE }
      expect(entry.previewLines({ batchId: 'batch-1' }, labels)).toEqual([])
      expect(entry.previewLines(undefined, labels)).toEqual([])
    })

    it('import_bank_statement.buildHandlerInput only ever carries userId and batchId', () => {
      const entry = findWriteIntentDescriptor('import_bank_statement')!
      expect(entry.buildHandlerInput({ actorId: 'user-1', target: { batchId: 'batch-1' } }))
        .toEqual({ userId: 'user-1', batchId: 'batch-1' })
    })

    it('import_bank_statement has no promptInstruction (deliberate -- see the entry\'s own comment on why this is one layer among several)', () => {
      const entry = findWriteIntentDescriptor('import_bank_statement')!
      expect(entry.promptInstruction).toBeUndefined()
    })
  })
})
