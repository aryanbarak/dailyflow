import { describe, expect, it } from 'vitest'
import { defaultFlowWriteMode, parseDeterministicDueDate, parseDeterministicTimeOfDay, parseTaskWriteIntent } from './flow-write-policy'

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

  it('defaults reversible task create/update to auto and unknown actions to ask', () => {
    expect(defaultFlowWriteMode('tasks', 'create')).toBe('auto')
    expect(defaultFlowWriteMode('tasks', 'update')).toBe('auto')
    expect(defaultFlowWriteMode('tasks', 'delete')).toBe('ask')
    expect(defaultFlowWriteMode('unknown', 'create')).toBe('ask')
  })
})
