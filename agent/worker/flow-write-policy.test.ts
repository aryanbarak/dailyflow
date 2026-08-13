import { describe, expect, it } from 'vitest'
import { defaultFlowWriteMode, parseDeterministicDueDate, parseTaskWriteIntent } from './flow-write-policy'

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

  it('defaults reversible task create/update to auto and unknown actions to ask', () => {
    expect(defaultFlowWriteMode('tasks', 'create')).toBe('auto')
    expect(defaultFlowWriteMode('tasks', 'update')).toBe('auto')
    expect(defaultFlowWriteMode('tasks', 'delete')).toBe('ask')
    expect(defaultFlowWriteMode('unknown', 'create')).toBe('ask')
  })
})
