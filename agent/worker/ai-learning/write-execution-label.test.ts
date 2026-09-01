import { describe, expect, it } from 'vitest'
import { requiresClarificationForWriteExecutionStatus } from './write-execution-label'

// Item 5 regression: provider_unavailable must never be captured as a
// clarification outcome -- only 'clarify' is a real production
// clarification request.
describe('requiresClarificationForWriteExecutionStatus', () => {
  it('clarify -> true', () => {
    expect(requiresClarificationForWriteExecutionStatus('clarify')).toBe(true)
  })

  it('provider_unavailable -> false (never a clarification outcome)', () => {
    expect(requiresClarificationForWriteExecutionStatus('provider_unavailable')).toBe(false)
  })

  it('executed -> false', () => {
    expect(requiresClarificationForWriteExecutionStatus('executed')).toBe(false)
  })

  it('failed -> false', () => {
    expect(requiresClarificationForWriteExecutionStatus('failed')).toBe(false)
  })
})
