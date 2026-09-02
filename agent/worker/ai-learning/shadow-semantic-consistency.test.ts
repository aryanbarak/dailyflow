import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isKnownRoutingIntentType, isSemanticallyConsistentRoutingPayload } from './shadow-semantic-consistency'
import { writeIntentRegistry } from '../../../shared/writeIntentRegistry'

describe('isSemanticallyConsistentRoutingPayload', () => {
  // H (ALF-1B): impossible domain/intentType/toolId combinations rejected.
  it('H: domain=tasks + intentType=create_calendar_event + toolId=calendar.create_event is rejected (wrong domain for that intent)', () => {
    expect(isSemanticallyConsistentRoutingPayload({
      domain: 'tasks',
      interactionClass: 'write',
      intentType: 'create_calendar_event',
      toolId: 'calendar.create_event',
    })).toBe(false)
  })

  it('H: domain=finance + intentType=create_task + toolId=tasks.create is rejected (wrong domain for that intent)', () => {
    expect(isSemanticallyConsistentRoutingPayload({
      domain: 'finance',
      interactionClass: 'write',
      intentType: 'create_task',
      toolId: 'tasks.create',
    })).toBe(false)
  })

  it('rejects a correct domain paired with a toolId belonging to a DIFFERENT intent', () => {
    expect(isSemanticallyConsistentRoutingPayload({
      domain: 'tasks',
      interactionClass: 'write',
      intentType: 'create_task',
      toolId: 'calendar.create_event',
    })).toBe(false)
  })

  it('rejects a write intent labeled with a non-write interactionClass', () => {
    expect(isSemanticallyConsistentRoutingPayload({
      domain: 'tasks',
      interactionClass: 'read',
      intentType: 'create_task',
      toolId: 'tasks.create',
    })).toBe(false)
  })

  it('rejects a non-write intent carrying any toolId at all', () => {
    expect(isSemanticallyConsistentRoutingPayload({
      domain: 'tasks',
      interactionClass: 'read',
      intentType: 'read_tasks',
      toolId: 'tasks.create',
    })).toBe(false)
  })

  it('rejects a toolId present with no intentType at all', () => {
    expect(isSemanticallyConsistentRoutingPayload({
      domain: 'tasks',
      interactionClass: 'write',
      toolId: 'tasks.create',
    })).toBe(false)
  })

  it('rejects an unrecognized intentType outright', () => {
    expect(isSemanticallyConsistentRoutingPayload({
      domain: 'tasks',
      interactionClass: 'write',
      intentType: 'delete_everything',
    })).toBe(false)
  })

  it('accepts every real, chat-exposed (domain, intentType, toolId, "write") combination from the registry', () => {
    for (const entry of writeIntentRegistry.filter((e) => e.exposure === 'chat')) {
      expect(isSemanticallyConsistentRoutingPayload({
        domain: entry.domain,
        interactionClass: 'write',
        intentType: entry.intentType,
        toolId: entry.toolId,
      }), `intentType=${entry.intentType}`).toBe(true)
    }
  })

  it('accepts a write intent with toolId omitted (incompleteness, not a semantic impossibility)', () => {
    expect(isSemanticallyConsistentRoutingPayload({
      domain: 'tasks',
      interactionClass: 'write',
      intentType: 'create_task',
    })).toBe(true)
  })

  it('rejects a ui-only registry intent even with an otherwise-correct domain/toolId', () => {
    const importEntry = writeIntentRegistry.find((e) => e.intentType === 'import_bank_statement')
    expect(importEntry).toBeDefined()
    expect(isSemanticallyConsistentRoutingPayload({
      domain: importEntry!.domain,
      interactionClass: 'write',
      intentType: importEntry!.intentType,
      toolId: importEntry!.toolId,
    })).toBe(false)
  })

  it('accepts every audited non-write (domain, intentType, "no toolId") combination', () => {
    const nonWriteCases: Array<{ intentType: string; domain: string; interactionClass: string }> = [
      { intentType: 'read_tasks', domain: 'tasks', interactionClass: 'read' },
      { intentType: 'read_calendar', domain: 'calendar', interactionClass: 'read' },
      { intentType: 'read_finance_summary', domain: 'finance', interactionClass: 'read' },
      { intentType: 'read_github', domain: 'github', interactionClass: 'read' },
      { intentType: 'unsupported_request', domain: 'none', interactionClass: 'conversation' },
    ]
    for (const c of nonWriteCases) {
      expect(isSemanticallyConsistentRoutingPayload({
        domain: c.domain as never,
        interactionClass: c.interactionClass as never,
        intentType: c.intentType,
      }), `intentType=${c.intentType}`).toBe(true)
    }
  })

  // ALF-1B correction 1, item 3: a payload with no intentType at all is
  // consistent ONLY for the closed, fixture-audited set of
  // (interactionClass, domain) pairs -- not for every combination.
  it('a payload with no intentType is consistent for the two audited intentless combinations', () => {
    expect(isSemanticallyConsistentRoutingPayload({ domain: 'none', interactionClass: 'conversation' })).toBe(true)
    expect(isSemanticallyConsistentRoutingPayload({ domain: 'unknown', interactionClass: 'clarification' })).toBe(true)
  })

  it('rejects unaudited intentless combinations, e.g. conversation paired with an unrelated domain', () => {
    expect(isSemanticallyConsistentRoutingPayload({ domain: 'tasks', interactionClass: 'conversation' })).toBe(false)
    expect(isSemanticallyConsistentRoutingPayload({ domain: 'calendar', interactionClass: 'conversation' })).toBe(false)
    expect(isSemanticallyConsistentRoutingPayload({ domain: 'unknown', interactionClass: 'conversation' })).toBe(false)
  })

  it('rejects a bare read or write interactionClass with no intentType at all -- neither appears intentless in the fixture', () => {
    expect(isSemanticallyConsistentRoutingPayload({ domain: 'tasks', interactionClass: 'read' })).toBe(false)
    expect(isSemanticallyConsistentRoutingPayload({ domain: 'calendar', interactionClass: 'write' })).toBe(false)
  })

  it('rejects clarification paired with a domain other than unknown, and conversation paired with a domain other than none', () => {
    expect(isSemanticallyConsistentRoutingPayload({ domain: 'tasks', interactionClass: 'clarification' })).toBe(false)
    expect(isSemanticallyConsistentRoutingPayload({ domain: 'none', interactionClass: 'clarification' })).toBe(false)
  })

  // Parity guard: every non-write intentType/domain/interactionClass this
  // module hardcodes must match ai/evals/intent-routing-v1/cases.jsonl's
  // own gold case data exactly -- never drift from the audited fixture.
  it('non-write semantics match every case actually present in ai/evals/intent-routing-v1/cases.jsonl', () => {
    const fixturePath = join(__dirname, '../../../ai/evals/intent-routing-v1/cases.jsonl')
    const lines = readFileSync(fixturePath, 'utf8').split('\n').filter((line) => line.trim().length > 0)
    expect(lines.length).toBeGreaterThan(0)

    let checkedNonWriteCases = 0
    for (const line of lines) {
      const record = JSON.parse(line) as { expected: { domain: string; interactionClass: string; intentType?: string; toolId?: string } }
      const { intentType, domain, interactionClass, toolId } = record.expected
      if (!intentType || toolId) continue // write cases already covered by the registry-derived test above
      checkedNonWriteCases += 1
      expect(isSemanticallyConsistentRoutingPayload({ domain: domain as never, interactionClass: interactionClass as never, intentType }), `fixture intentType=${intentType}`).toBe(true)
    }
    expect(checkedNonWriteCases).toBeGreaterThan(0)
  })

  // Parity guard for the INTENTLESS case specifically: every case in the
  // fixture that names neither an intentType nor a toolId must fall into
  // exactly the closed two-pair set this module hardcodes -- if a future
  // fixture case introduces a genuinely new intentless (interactionClass,
  // domain) pair, this test fails until the mapping is deliberately
  // updated to match, rather than silently drifting.
  it('intentless semantics match every "no intentType" case actually present in the fixture', () => {
    const fixturePath = join(__dirname, '../../../ai/evals/intent-routing-v1/cases.jsonl')
    const lines = readFileSync(fixturePath, 'utf8').split('\n').filter((line) => line.trim().length > 0)

    let checkedIntentlessCases = 0
    for (const line of lines) {
      const record = JSON.parse(line) as { expected: { domain: string; interactionClass: string; intentType?: string } }
      const { intentType, domain, interactionClass } = record.expected
      if (intentType) continue
      checkedIntentlessCases += 1
      expect(
        isSemanticallyConsistentRoutingPayload({ domain: domain as never, interactionClass: interactionClass as never }),
        `fixture intentless combination (${interactionClass}, ${domain})`,
      ).toBe(true)
    }
    expect(checkedIntentlessCases).toBeGreaterThan(0)
  })
})

describe('isKnownRoutingIntentType', () => {
  it('true for every chat-exposed write intent and every audited non-write intent', () => {
    for (const entry of writeIntentRegistry.filter((e) => e.exposure === 'chat')) {
      expect(isKnownRoutingIntentType(entry.intentType)).toBe(true)
    }
    for (const intentType of ['read_tasks', 'read_calendar', 'read_finance_summary', 'read_github', 'unsupported_request']) {
      expect(isKnownRoutingIntentType(intentType)).toBe(true)
    }
  })

  it('false for a ui-only registry intent and for an unaudited value', () => {
    expect(isKnownRoutingIntentType('import_bank_statement')).toBe(false)
    expect(isKnownRoutingIntentType('totally_made_up')).toBe(false)
  })
})
