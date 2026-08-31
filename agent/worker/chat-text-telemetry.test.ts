// Chat V2 Slice 1 -- pins the text-lane telemetry contract: exact line
// shape, the no-content security invariant, and the expected-primary /
// fallback derivations that mirror createProviders' own selection rules.
import { describe, expect, it } from 'vitest'
import {
  formatChatTextTelemetryLine,
  resolveExpectedPrimaryProviderId,
  resolveFallbackUsed,
  type ChatTextTelemetry,
} from './chat-text-telemetry'

const FULL: ChatTextTelemetry = {
  requestId: 'e7a6cbb2-8a53-4a3e-9c3e-2f4c86b1a001',
  lane: 'fast',
  providerId: 'gemini',
  model: 'gemini-3.6-flash',
  elapsedMs: 1234,
  finishReason: 'stop',
  promptTokens: 812,
  responseTokens: 96,
  fallbackUsed: false,
}

describe('formatChatTextTelemetryLine', () => {
  it('emits every field in one greppable line', () => {
    expect(formatChatTextTelemetryLine(FULL)).toBe(
      '[ChatTextLane] requestId=e7a6cbb2-8a53-4a3e-9c3e-2f4c86b1a001 lane=fast provider=gemini model=gemini-3.6-flash elapsedMs=1234 finishReason=stop promptTokens=812 responseTokens=96 fallbackUsed=false',
    )
  })

  it("renders absent optionals as unknown/n[/]a instead of dropping the keys (so a grep for a key always hits)", () => {
    const line = formatChatTextTelemetryLine({
      requestId: 'id-1',
      lane: 'legacy',
      elapsedMs: 42,
      finishReason: 'other',
      fallbackUsed: 'unknown',
    })
    expect(line).toBe(
      '[ChatTextLane] requestId=id-1 lane=legacy provider=unknown model=unknown elapsedMs=42 finishReason=other promptTokens=n/a responseTokens=n/a fallbackUsed=unknown',
    )
  })

  it('carries no free-text field -- the security contract is structural (exact-line assertions above), and the type has no slot for message content', () => {
    // Belt-and-braces on top of the exact-string assertions: every emitted
    // key is from the fixed allowlist; nothing else can appear.
    const line = formatChatTextTelemetryLine(FULL)
    const keys = [...line.matchAll(/(\w+)=/g)].map((m) => m[1])
    expect(keys).toEqual([
      'requestId',
      'lane',
      'provider',
      'model',
      'elapsedMs',
      'finishReason',
      'promptTokens',
      'responseTokens',
      'fallbackUsed',
    ])
  })
})

describe('resolveExpectedPrimaryProviderId (mirrors buildTextProvider selection)', () => {
  it('follows AI_TEXT_PROVIDER when nothing pins or prefers', () => {
    expect(resolveExpectedPrimaryProviderId({})).toBe('gemini')
    expect(resolveExpectedPrimaryProviderId({ AI_TEXT_PROVIDER: 'workers-ai' })).toBe('workers-ai')
    expect(resolveExpectedPrimaryProviderId({ AI_TEXT_PROVIDER: 'Workers-AI' })).toBe('gemini')
  })

  it('pin/prefer force gemini regardless of AI_TEXT_PROVIDER', () => {
    expect(resolveExpectedPrimaryProviderId({ AI_TEXT_PROVIDER: 'workers-ai' }, { pinnedToGemini: true })).toBe('gemini')
    expect(resolveExpectedPrimaryProviderId({ AI_TEXT_PROVIDER: 'workers-ai' }, { preferGemini: true })).toBe('gemini')
  })
})

describe('resolveFallbackUsed', () => {
  it("reports 'unknown' when the answering adapter stamped no providerId", () => {
    expect(resolveFallbackUsed(undefined, 'gemini')).toBe('unknown')
  })

  it('reports false when the expected primary answered', () => {
    expect(resolveFallbackUsed('gemini', 'gemini')).toBe(false)
    expect(resolveFallbackUsed('workers-ai', 'workers-ai')).toBe(false)
  })

  it('reports true when a different provider answered than the expected primary (the fallback chain fired)', () => {
    expect(resolveFallbackUsed('workers-ai', 'gemini')).toBe(true)
    expect(resolveFallbackUsed('gemini', 'workers-ai')).toBe(true)
  })
})
