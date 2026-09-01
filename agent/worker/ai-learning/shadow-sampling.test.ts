import { describe, expect, it } from 'vitest'
import { isSampledForShadow } from './shadow-sampling'

// H. rate 0 -> no shadow call.
describe('isSampledForShadow', () => {
  it('H: rate 0 always returns false, regardless of sourceMessageId', () => {
    for (const id of ['a', 'b', crypto.randomUUID(), crypto.randomUUID(), '']) {
      expect(isSampledForShadow(id, 0)).toBe(false)
    }
  })

  it('rate 1 always returns true, regardless of sourceMessageId', () => {
    for (const id of ['a', 'b', crypto.randomUUID(), crypto.randomUUID(), '']) {
      expect(isSampledForShadow(id, 1)).toBe(true)
    }
  })

  it('a negative or >1 rate behaves like the nearest boundary (never/always) rather than throwing', () => {
    expect(isSampledForShadow('id', -0.5)).toBe(false)
    expect(isSampledForShadow('id', 1.5)).toBe(true)
    expect(isSampledForShadow('id', 2)).toBe(true)
  })

  // I. deterministic fractional sampling -> stable result for same sourceMessageId.
  it('I: the same sourceMessageId + rate always produces the same decision, called repeatedly', () => {
    const id = crypto.randomUUID()
    const rate = 0.42
    const first = isSampledForShadow(id, rate)
    for (let i = 0; i < 20; i++) {
      expect(isSampledForShadow(id, rate)).toBe(first)
    }
  })

  it('a fractional rate produces both true and false outcomes across many distinct ids (not degenerate)', () => {
    const rate = 0.5
    const outcomes = new Set<boolean>()
    for (let i = 0; i < 200; i++) {
      outcomes.add(isSampledForShadow(`source-message-${i}`, rate))
    }
    expect(outcomes.size).toBe(2)
  })

  it('roughly matches the configured rate across a large sample (statistical sanity check, generous tolerance)', () => {
    const rate = 0.3
    let sampledCount = 0
    const total = 2000
    for (let i = 0; i < total; i++) {
      if (isSampledForShadow(`msg-${i}`, rate)) sampledCount += 1
    }
    const observedRate = sampledCount / total
    expect(observedRate).toBeGreaterThan(rate - 0.08)
    expect(observedRate).toBeLessThan(rate + 0.08)
  })

  it('different sourceMessageIds at the same fractional rate can independently sample in or out', () => {
    const rate = 0.5
    const idA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const idB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    // Not asserting a specific direction (that would be brittle against
    // hash implementation changes) -- only that the function runs
    // deterministically per id without crashing or conflating the two.
    const resultA1 = isSampledForShadow(idA, rate)
    const resultA2 = isSampledForShadow(idA, rate)
    const resultB1 = isSampledForShadow(idB, rate)
    expect(resultA1).toBe(resultA2)
    expect(typeof resultB1).toBe('boolean')
  })
})
