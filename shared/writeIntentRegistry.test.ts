import { describe, expect, it } from 'vitest'
import {
  WRITE_DOMAIN_TARGET_FIELDS,
  WRITE_INTENT_TARGET_FIELD_NAMES,
  findWriteIntentDescriptor,
  findWriteIntentDescriptorByToolId,
  writeIntentRegistry,
  type WriteIntentType,
} from './writeIntentRegistry'

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
    },
  )

  it('every entry resolves by its own toolId', () => {
    for (const entry of writeIntentRegistry) {
      expect(findWriteIntentDescriptorByToolId(entry.toolId)).toBe(entry)
      expect(findWriteIntentDescriptor(entry.intentType)).toBe(entry)
    }
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
      'amount', 'currency', 'direction', 'transactionDate', 'category', 'description', 'iban',
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
      const labels = { title: 'Title', due: 'Due', notes: 'Notes', start: 'Start', end: 'End', none: 'None' }
      expect(entry.previewLines({ dueDate: null }, labels).filter(Boolean)).toEqual(['Due: None'])
      expect(entry.previewLines({}, labels).filter(Boolean)).toEqual([])
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
      const labels = { title: 'Title', due: 'Due', notes: 'Notes', start: 'Start', end: 'End', none: 'None' }
      const lines = entry.previewLines({ amount: '45.50', currency: 'EUR', direction: 'expense', iban: 'DE89370400440532013000' }, labels).filter(Boolean)
      expect(lines.some((line) => line?.includes('sensitive'))).toBe(true)
    })
  })
})
