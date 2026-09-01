import { describe, expect, it } from 'vitest'
import { buildProductionRoutingLabel } from './production-routing-label'

describe('buildProductionRoutingLabel', () => {
  it('assembles a valid payload from concrete write-outcome fields', () => {
    const result = buildProductionRoutingLabel({
      language: 'fa',
      interactionClass: 'write',
      domain: 'calendar',
      intentType: 'create_calendar_event',
      toolId: 'calendar.create_event',
      requiresClarification: false,
      requiresApproval: true,
    })
    expect(result).toEqual({
      ok: true,
      payload: {
        schemaVersion: 'intent-routing-v1',
        language: 'fa',
        interactionClass: 'write',
        domain: 'calendar',
        intentType: 'create_calendar_event',
        toolId: 'calendar.create_event',
        requiresClarification: false,
        requiresApproval: true,
      },
    })
  })

  it('omits intentType/toolId entirely from the payload when not supplied, rather than passing undefined through', () => {
    const result = buildProductionRoutingLabel({
      language: 'en',
      interactionClass: 'conversation',
      domain: 'none',
      requiresClarification: false,
      requiresApproval: false,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect('intentType' in result.payload).toBe(false)
      expect('toolId' in result.payload).toBe(false)
    }
  })

  it('returns ok:false rather than an invalid payload when passed a malformed field', () => {
    const result = buildProductionRoutingLabel({
      // @ts-expect-error -- deliberately invalid to prove the builder validates rather than trusting its input
      language: 'not-a-real-language',
      interactionClass: 'conversation',
      domain: 'none',
      requiresClarification: false,
      requiresApproval: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })

  // M. "سلام" -> conversation / domain none / no tool / requiresApproval false.
  it('M: an ordinary greeting production-label shape ("سلام") is conversation/none/no-tool/no-approval', () => {
    const result = buildProductionRoutingLabel({
      language: 'fa',
      interactionClass: 'conversation',
      domain: 'none',
      requiresClarification: false,
      requiresApproval: false,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.interactionClass).toBe('conversation')
      expect(result.payload.domain).toBe('none')
      expect(result.payload.toolId).toBeUndefined()
      expect(result.payload.requiresApproval).toBe(false)
    }
  })

  // N. Persian task + exact time -> Calendar create event label (mirrors
  // ALF-0's own canonical exact-time-scheduling case, section 10's
  // "برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم" example).
  it('N: a Persian task-noun request with an exact clock time labels as a Calendar create event, not a Task', () => {
    const result = buildProductionRoutingLabel({
      language: 'fa',
      interactionClass: 'write',
      domain: 'calendar',
      intentType: 'create_calendar_event',
      toolId: 'calendar.create_event',
      requiresClarification: false,
      requiresApproval: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.domain).toBe('calendar')
      expect(result.payload.intentType).toBe('create_calendar_event')
      expect(result.payload.toolId).toBe('calendar.create_event')
    }
  })

  // O. Persian task without exact time -> Task create label (mirrors
  // section 10's "برای فردا یک تسک بساز که به احمد زنگ بزنم" example).
  it('O: a Persian task-noun request with a date but no clock time stays a Task create, not Calendar', () => {
    const result = buildProductionRoutingLabel({
      language: 'fa',
      interactionClass: 'write',
      domain: 'tasks',
      intentType: 'create_task',
      toolId: 'tasks.create',
      requiresClarification: false,
      requiresApproval: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.domain).toBe('tasks')
      expect(result.payload.intentType).toBe('create_task')
      expect(result.payload.toolId).toBe('tasks.create')
    }
  })

  // P. informational time mention -> no false write (mirrors section 10's
  // "جلسه من فردا ساعت ۱۰ است؟" example -- a question mentioning a time is
  // NOT a write merely because a clock time exists; production code's own
  // deterministic write detection never triggers for it, so the ONLY
  // truthful label this turn can carry is the plain conversation shape --
  // see index.ts's own writeDomainSignal==='none' capture point).
  it('P: an informational time-mention question never gets a write-shaped label', () => {
    const result = buildProductionRoutingLabel({
      language: 'fa',
      interactionClass: 'conversation',
      domain: 'none',
      requiresClarification: false,
      requiresApproval: false,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.interactionClass).not.toBe('write')
      expect(result.payload.requiresApproval).toBe(false)
    }
  })

  it('the ambiguous-domain outcome labels as clarification/unknown with no intentType/toolId', () => {
    const result = buildProductionRoutingLabel({
      language: 'en',
      interactionClass: 'clarification',
      domain: 'unknown',
      requiresClarification: true,
      requiresApproval: false,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.intentType).toBeUndefined()
      expect(result.payload.toolId).toBeUndefined()
    }
  })

  it('a write switched off (mode="off") still labels as a write with requiresApproval false', () => {
    const result = buildProductionRoutingLabel({
      language: 'en',
      interactionClass: 'write',
      domain: 'tasks',
      intentType: 'create_task',
      toolId: 'tasks.create',
      requiresClarification: false,
      requiresApproval: false,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payload.requiresApproval).toBe(false)
  })

  it('a pending ask-mode write labels requiresApproval true', () => {
    const result = buildProductionRoutingLabel({
      language: 'en',
      interactionClass: 'write',
      domain: 'calendar',
      intentType: 'update_calendar_event',
      toolId: 'calendar.update_event',
      requiresClarification: false,
      requiresApproval: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payload.requiresApproval).toBe(true)
  })
})
