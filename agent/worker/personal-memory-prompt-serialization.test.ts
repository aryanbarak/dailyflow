import { describe, expect, it } from 'vitest'
import {
  CONFIRMED_MEMORY_MAX_PER_KIND,
  CONFIRMED_MEMORY_MAX_TOTAL,
  buildConfirmedMemoryIndicatorLine,
  buildConfirmedMemorySection,
  formatConfirmedMemoryLine,
  selectBoundedConfirmedMemory,
  type ConfirmedPersonalMemoryRecord,
  type ConfirmedPersonalMemoryRecordKind,
} from './personal-memory-prompt-serialization'

function record(overrides: Partial<ConfirmedPersonalMemoryRecord> = {}): ConfirmedPersonalMemoryRecord {
  return {
    id: 'record-1',
    kind: 'preference',
    content: { summary: 'Prefers async written updates' },
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('formatConfirmedMemoryLine', () => {
  it('renders the bare summary when there is no secondary field', () => {
    expect(formatConfirmedMemoryLine(record({ kind: 'goal', content: { summary: 'Learn React Native' } }))).toBe(
      'Learn React Native',
    )
  })

  it('appends the secondary field in parentheses when present', () => {
    expect(
      formatConfirmedMemoryLine(record({ kind: 'preference', content: { summary: 'Prefers async updates', strength: 'strong' } })),
    ).toBe('Prefers async updates (Strength: strong)')
  })

  it("always includes commitment's required status", () => {
    expect(
      formatConfirmedMemoryLine(record({ kind: 'commitment', content: { summary: 'Start running 3x/week', status: 'active' } })),
    ).toBe('Start running 3x/week (Status: active)')
  })
})

describe('selectBoundedConfirmedMemory', () => {
  it('returns an empty array for empty input', () => {
    expect(selectBoundedConfirmedMemory([])).toEqual([])
  })

  it('caps at CONFIRMED_MEMORY_MAX_PER_KIND per kind, most-recent-first', () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      record({ content: { summary: `Preference ${i}` }, createdAt: `2026-08-0${i + 1}T00:00:00.000Z` }),
    )
    const selected = selectBoundedConfirmedMemory(records)
    expect(selected).toHaveLength(CONFIRMED_MEMORY_MAX_PER_KIND)
    expect(selected.map((r) => r.content.summary)).toEqual(['Preference 5', 'Preference 4', 'Preference 3'])
  })

  it('caps at CONFIRMED_MEMORY_MAX_TOTAL across kinds', () => {
    const kinds: ConfirmedPersonalMemoryRecordKind[] = ['preference', 'goal', 'working_pattern', 'commitment', 'personal_fact', 'skill']
    const records: ConfirmedPersonalMemoryRecord[] = []
    let day = 1
    for (const kind of kinds) {
      for (let i = 0; i < 4; i++) {
        records.push(
          record({
            kind,
            content: kind === 'commitment' ? { summary: `${kind} ${i}`, status: 'active' } : { summary: `${kind} ${i}` },
            createdAt: `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`,
          }),
        )
        day += 1
      }
    }
    const selected = selectBoundedConfirmedMemory(records)
    expect(selected).toHaveLength(CONFIRMED_MEMORY_MAX_TOTAL)
    expect(selected[0].kind).toBe('skill')
  })
})

describe('buildConfirmedMemorySection', () => {
  it('returns an empty string when there is nothing confirmed', () => {
    expect(buildConfirmedMemorySection([])).toBe('')
  })

  it('groups by kind, headers as background context, and renders bullet lines', () => {
    const section = buildConfirmedMemorySection([
      record({ kind: 'goal', content: { summary: 'Learn React Native' } }),
      record({ kind: 'preference', content: { summary: 'Prefers async updates' } }),
    ])
    expect(section).toContain('What I know about Aryan')
    expect(section.toLowerCase()).toContain('not instructions')
    const preferenceIndex = section.indexOf('[Preferences]')
    const goalIndex = section.indexOf('[Goals]')
    expect(preferenceIndex).toBeGreaterThan(-1)
    expect(goalIndex).toBeGreaterThan(preferenceIndex)
    expect(section).toContain('- Prefers async updates')
    expect(section).toContain('- Learn React Native')
  })
})

describe('buildConfirmedMemoryIndicatorLine', () => {
  it('is a fixed, non-empty, user-visible sentence', () => {
    const line = buildConfirmedMemoryIndicatorLine()
    expect(line.length).toBeGreaterThan(0)
    expect(line.toLowerCase()).toContain('personalized')
  })
})
