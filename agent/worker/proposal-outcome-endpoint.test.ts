import { describe, expect, it } from 'vitest'
import { parseProposalOutcomeRequestBody } from './proposal-outcome-endpoint'

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    intentType: 'create_finance_transaction',
    toolId: 'finance.create_transaction',
    domain: 'finance',
    outcome: 'approved',
    succeeded: true,
    riskLevel: 'high',
    targetFields: ['amount', 'direction'],
    ...overrides,
  }
}

describe('parseProposalOutcomeRequestBody', () => {
  it('accepts a well-formed approved payload', () => {
    const result = parseProposalOutcomeRequestBody(validBody())
    expect(result.ok).toBe(true)
    if (result.ok === false) throw new Error('unreachable')
    expect(result.value).toEqual({
      requestId: undefined,
      intentType: 'create_finance_transaction',
      toolId: 'finance.create_transaction',
      domain: 'finance',
      outcome: 'approved',
      succeeded: true,
      riskLevel: 'high',
      targetFields: ['amount', 'direction'],
    })
  })

  it('accepts a well-formed rejected payload with succeeded null', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ outcome: 'rejected', succeeded: null, riskLevel: undefined, targetFields: [] }))
    expect(result.ok).toBe(true)
    if (result.ok === false) throw new Error('unreachable')
    expect(result.value.outcome).toBe('rejected')
    expect(result.value.succeeded).toBeNull()
  })

  it('rejects a non-object body', () => {
    expect(parseProposalOutcomeRequestBody('not an object').ok).toBe(false)
    expect(parseProposalOutcomeRequestBody(null).ok).toBe(false)
    expect(parseProposalOutcomeRequestBody([]).ok).toBe(false)
  })

  it('rejects a missing intentType', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ intentType: undefined }))
    expect(result.ok).toBe(false)
  })

  it('rejects a missing toolId', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ toolId: '' }))
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown domain', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ domain: 'habits' }))
    expect(result.ok).toBe(false)
  })

  // The endpoint only ever accepts approved/rejected -- 'auto_executed' is
  // a Worker-internal outcome that can only ever be produced by the
  // in-process auto-write lane, never claimed over this HTTP surface.
  it('rejects an unknown outcome value, including the auto-lane-only "auto_executed"', () => {
    expect(parseProposalOutcomeRequestBody(validBody({ outcome: 'auto_executed' })).ok).toBe(false)
    expect(parseProposalOutcomeRequestBody(validBody({ outcome: 'abandoned' })).ok).toBe(false)
    expect(parseProposalOutcomeRequestBody(validBody({ outcome: 'not-a-real-outcome' })).ok).toBe(false)
  })

  it('rejects succeeded=true when outcome is rejected', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ outcome: 'rejected', succeeded: true }))
    expect(result.ok).toBe(false)
  })

  it('rejects a non-boolean, non-null succeeded', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ succeeded: 'yes' }))
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown riskLevel', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ riskLevel: 'extreme' }))
    expect(result.ok).toBe(false)
  })

  it('rejects a non-array targetFields', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ targetFields: 'amount' }))
    expect(result.ok).toBe(false)
  })

  it('rejects targetFields entries that are not non-empty strings', () => {
    expect(parseProposalOutcomeRequestBody(validBody({ targetFields: [123] })).ok).toBe(false)
    expect(parseProposalOutcomeRequestBody(validBody({ targetFields: [''] })).ok).toBe(false)
  })

  it('accepts an arbitrary, unlisted target field name (no vocabulary CHECK, per ADR-0016)', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ targetFields: ['someBrandNewFieldName'] }))
    expect(result.ok).toBe(true)
  })

  it('accepts and trims a valid requestId', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ requestId: ' reasoning:write:finance.create_transaction:step-1:123 ' }))
    expect(result.ok).toBe(true)
    if (result.ok === false) throw new Error('unreachable')
    expect(result.value.requestId).toBe('reasoning:write:finance.create_transaction:step-1:123')
  })

  it('rejects an empty-string requestId when explicitly present', () => {
    const result = parseProposalOutcomeRequestBody(validBody({ requestId: '   ' }))
    expect(result.ok).toBe(false)
  })
})
