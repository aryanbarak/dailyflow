import { describe, expect, it } from 'vitest'
import {
  SHADOW_ROUTING_MAX_OUTPUT_TOKENS,
  SHADOW_ROUTING_SYSTEM_PROMPT,
  SHADOW_ROUTING_TEMPERATURE,
  buildShadowRoutingUserTurn,
  parseShadowRoutingOutput,
} from './shadow-routing-prompt'

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
