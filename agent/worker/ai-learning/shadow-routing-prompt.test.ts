import { describe, expect, it } from 'vitest'
import {
  SHADOW_ROUTING_MAX_OUTPUT_TOKENS,
  SHADOW_ROUTING_SYSTEM_PROMPT,
  SHADOW_ROUTING_TEMPERATURE,
  buildShadowRoutingUserTurn,
  parseShadowRoutingOutput,
} from './shadow-routing-prompt'
import { SHADOW_ALLOWED_INTENT_TYPES, SHADOW_ALLOWED_TOOL_IDS } from './shadow-vocabulary'

const VALID_JSON = JSON.stringify({
  schemaVersion: 'intent-routing-v1',
  language: 'en',
  interactionClass: 'write',
  domain: 'calendar',
  intentType: 'create_calendar_event',
  toolId: 'calendar.create_event',
  requiresClarification: false,
  requiresApproval: true,
})

const RAW_MESSAGE = 'برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم -- SECRET_MARKER_DO_NOT_LEAK'

function payloadWith(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(VALID_JSON), ...overrides })
}

describe('shadow routing prompt (section 6: minimal, no prose, no chain-of-thought)', () => {
  it('the system prompt names exactly the eight IntentRoutingLearningPayloadV1 fields and no others', () => {
    for (const field of ['schemaVersion', 'language', 'interactionClass', 'domain', 'intentType', 'toolId', 'requiresClarification', 'requiresApproval']) {
      expect(SHADOW_ROUTING_SYSTEM_PROMPT).toContain(field)
    }
  })

  it('the system prompt explicitly forbids prose/reasoning/tool calls', () => {
    expect(SHADOW_ROUTING_SYSTEM_PROMPT.toLowerCase()).toContain('no prose')
    expect(SHADOW_ROUTING_SYSTEM_PROMPT.toLowerCase()).toContain('do not call any tool')
  })

  it('deterministic/bounded generation constants are set as required', () => {
    expect(SHADOW_ROUTING_TEMPERATURE).toBe(0)
    expect(SHADOW_ROUTING_MAX_OUTPUT_TOKENS).toBeGreaterThan(0)
    expect(SHADOW_ROUTING_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(512)
  })

  it('the user turn is the raw message text, unmodified (transient -- not persisted by this module)', () => {
    expect(buildShadowRoutingUserTurn('برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم')).toBe('برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم')
  })
})

describe('parseShadowRoutingOutput', () => {
  it('parses valid JSON matching the shared contract', () => {
    const result = parseShadowRoutingOutput(VALID_JSON)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.domain).toBe('calendar')
      expect(result.payload.intentType).toBe('create_calendar_event')
    }
  })

  it('tolerates a markdown code fence the model added despite instructions not to', () => {
    const fenced = '```json\n' + VALID_JSON + '\n```'
    const result = parseShadowRoutingOutput(fenced)
    expect(result.ok).toBe(true)
  })

  it('tolerates a bare code fence with no language tag', () => {
    const fenced = '```\n' + VALID_JSON + '\n```'
    expect(parseShadowRoutingOutput(fenced).ok).toBe(true)
  })

  // D. shadow model invalid JSON/schema -> no shadow row.
  it('D: not-valid-JSON text is rejected as not_valid_json, never throws', () => {
    expect(() => parseShadowRoutingOutput('this is not json at all')).not.toThrow()
    const result = parseShadowRoutingOutput('this is not json at all')
    expect(result).toEqual({ ok: false, reason: 'not_valid_json' })
  })

  it('D: valid JSON that does not satisfy the schema is rejected as schema_invalid', () => {
    const result = parseShadowRoutingOutput(JSON.stringify({ schemaVersion: 'intent-routing-v1', domain: 'bogus-domain' }))
    expect(result).toEqual({ ok: false, reason: 'schema_invalid' })
  })

  it('rejects an empty string', () => {
    expect(parseShadowRoutingOutput('').ok).toBe(false)
  })

  it('rejects JSON with an unrecognized extra field (closed-schema contract, per shared/aiLearning.ts)', () => {
    const withExtra = JSON.stringify({ ...JSON.parse(VALID_JSON), rawText: 'leaked message content' })
    const result = parseShadowRoutingOutput(withExtra)
    expect(result).toEqual({ ok: false, reason: 'schema_invalid' })
  })

  it('rejects a JSON array (valid JSON, wrong shape)', () => {
    expect(parseShadowRoutingOutput('[1,2,3]').ok).toBe(false)
  })

  it('rejects prose wrapped around otherwise-valid JSON (no partial extraction)', () => {
    const result = parseShadowRoutingOutput(`Here is my answer: ${VALID_JSON}`)
    expect(result.ok).toBe(false)
  })
})

// ALF-1A correction (round 2, item 1): the Shadow-only vocabulary gate --
// a raw-text echo or an unaudited invented value in intentType/toolId must
// be rejected even though the GENERIC shared contract (shared/aiLearning.ts)
// allows any non-empty string there.
describe('parseShadowRoutingOutput: shadow-only vocabulary gate (round 2, item 1)', () => {
  it('A: a model echoing the raw user message as intentType is rejected, never persisted', () => {
    const result = parseShadowRoutingOutput(payloadWith({ intentType: RAW_MESSAGE }))
    expect(result).toEqual({ ok: false, reason: 'schema_invalid' })
  })

  it('B: a model echoing the raw user message as toolId is rejected, never persisted', () => {
    const result = parseShadowRoutingOutput(payloadWith({ toolId: RAW_MESSAGE }))
    expect(result).toEqual({ ok: false, reason: 'schema_invalid' })
  })

  it('C: an unknown, arbitrary, plausible-looking intentType is rejected', () => {
    for (const bogus of ['create_reminder', 'delete_everything', 'schedule_meeting_v2', 'admin_override']) {
      expect(parseShadowRoutingOutput(payloadWith({ intentType: bogus }))).toEqual({ ok: false, reason: 'schema_invalid' })
    }
  })

  it('D: an unknown, arbitrary, plausible-looking toolId is rejected', () => {
    for (const bogus of ['tasks.delete', 'calendar.delete_event', 'system.run_shell', 'admin.override']) {
      expect(parseShadowRoutingOutput(payloadWith({ toolId: bogus }))).toEqual({ ok: false, reason: 'schema_invalid' })
    }
  })

  it('E: every audited write intentType/toolId from shared/writeIntentRegistry.ts is still accepted end-to-end', () => {
    for (const intentType of SHADOW_ALLOWED_INTENT_TYPES) {
      const result = parseShadowRoutingOutput(payloadWith({ intentType }))
      expect(result.ok, `intentType=${intentType}`).toBe(true)
    }
    for (const toolId of SHADOW_ALLOWED_TOOL_IDS) {
      const result = parseShadowRoutingOutput(payloadWith({ toolId }))
      expect(result.ok, `toolId=${toolId}`).toBe(true)
    }
  })

  it('an omitted intentType/toolId (e.g. a conversation/clarification turn) is still accepted -- the gate only constrains a PRESENT value', () => {
    const withoutEither = JSON.parse(VALID_JSON)
    delete withoutEither.intentType
    delete withoutEither.toolId
    const result = parseShadowRoutingOutput(JSON.stringify(withoutEither))
    expect(result.ok).toBe(true)
  })
})
