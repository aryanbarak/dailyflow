import { describe, expect, it } from 'vitest'
import { resolveLiveCaptureConfig, toAiLearningLanguage } from './live-capture-config'
import type { Env } from '../types'

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_KEY: 'service-key',
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-2.5-flash',
    AI: {} as unknown as Env['AI'],
    ...overrides,
  }
}

function enabledShadowEnv(overrides: Partial<Env> = {}): Env {
  return baseEnv({
    AI_LEARNING_CAPTURE_ENABLED: 'true',
    AI_SHADOW_ENABLED: 'true',
    AI_SHADOW_PROVIDER: 'workers-ai',
    AI_SHADOW_MODEL_ID: '@cf/some-org/some-shadow-model',
    AI_SHADOW_MODEL_VERSION: '2026-09-01',
    AI_SHADOW_SAMPLE_RATE: '1',
    ...overrides,
  })
}

describe('resolveLiveCaptureConfig -- fail-closed by default', () => {
  it('everything absent -> capture disabled, shadow disabled', () => {
    expect(resolveLiveCaptureConfig(baseEnv())).toEqual({ captureEnabled: false, shadow: null })
  })

  it('an unrecognized capture-flag string does not enable capture (no truthy-string coercion)', () => {
    for (const value of ['1', 'yes', 'TRUE', ' true ', 'True', 'enabled']) {
      expect(resolveLiveCaptureConfig(baseEnv({ AI_LEARNING_CAPTURE_ENABLED: value })).captureEnabled, `value=${JSON.stringify(value)}`).toBe(false)
    }
  })

  it('capture enabled, shadow flag absent -> capture on, shadow off', () => {
    const config = resolveLiveCaptureConfig(baseEnv({ AI_LEARNING_CAPTURE_ENABLED: 'true' }))
    expect(config).toEqual({ captureEnabled: true, shadow: null })
  })

  it('a fully valid shadow config resolves', () => {
    const config = resolveLiveCaptureConfig(enabledShadowEnv())
    expect(config).toEqual({
      captureEnabled: true,
      shadow: {
        providerId: 'workers-ai',
        modelId: '@cf/some-org/some-shadow-model',
        modelVersion: '2026-09-01',
        sampleRate: 1,
      },
    })
  })

  // Section 2 / ADR-0021: shadow must never fire when capture itself is
  // disabled -- there is nowhere valid to persist a shadow_prediction
  // event without capture.
  it('capture disabled forces shadow off even when every shadow field is otherwise valid', () => {
    const config = resolveLiveCaptureConfig(enabledShadowEnv({ AI_LEARNING_CAPTURE_ENABLED: 'false' }))
    expect(config).toEqual({ captureEnabled: false, shadow: null })
  })

  it('missing providerId disables shadow only, capture stays enabled', () => {
    const config = resolveLiveCaptureConfig({ ...enabledShadowEnv(), AI_SHADOW_PROVIDER: undefined })
    expect(config.captureEnabled).toBe(true)
    expect(config.shadow).toBeNull()
  })

  // R. missing modelVersion -> shadow disabled/fail closed.
  it('R: missing modelVersion disables shadow (fail closed), never falls back to a guessed version', () => {
    const config = resolveLiveCaptureConfig({ ...enabledShadowEnv(), AI_SHADOW_MODEL_VERSION: undefined })
    expect(config.shadow).toBeNull()
  })

  it('missing modelId disables shadow, never falls back to the production text-generation model', () => {
    const config = resolveLiveCaptureConfig({ ...enabledShadowEnv(), AI_SHADOW_MODEL_ID: undefined })
    expect(config.shadow).toBeNull()
  })

  it('an empty-string (whitespace-only) provider/model/version disables shadow', () => {
    expect(resolveLiveCaptureConfig({ ...enabledShadowEnv(), AI_SHADOW_PROVIDER: '   ' }).shadow).toBeNull()
    expect(resolveLiveCaptureConfig({ ...enabledShadowEnv(), AI_SHADOW_MODEL_ID: '' }).shadow).toBeNull()
    expect(resolveLiveCaptureConfig({ ...enabledShadowEnv(), AI_SHADOW_MODEL_VERSION: '' }).shadow).toBeNull()
  })

  it('an out-of-range or non-numeric sample rate disables shadow', () => {
    for (const rate of ['-0.1', '1.1', '2', 'not-a-number', '', 'NaN']) {
      expect(resolveLiveCaptureConfig({ ...enabledShadowEnv(), AI_SHADOW_SAMPLE_RATE: rate }).shadow, `rate=${JSON.stringify(rate)}`).toBeNull()
    }
  })

  it('a boundary sample rate of exactly 0 or 1 is valid', () => {
    expect(resolveLiveCaptureConfig({ ...enabledShadowEnv(), AI_SHADOW_SAMPLE_RATE: '0' }).shadow?.sampleRate).toBe(0)
    expect(resolveLiveCaptureConfig({ ...enabledShadowEnv(), AI_SHADOW_SAMPLE_RATE: '1' }).shadow?.sampleRate).toBe(1)
  })

  it('never infers a shadow provider/model from AI_TEXT_PROVIDER or any other production config', () => {
    const config = resolveLiveCaptureConfig(baseEnv({
      AI_LEARNING_CAPTURE_ENABLED: 'true',
      AI_SHADOW_ENABLED: 'true',
      AI_TEXT_PROVIDER: 'gemini',
      GEMINI_MODEL: 'gemini-2.5-flash',
      // AI_SHADOW_PROVIDER/MODEL_ID/MODEL_VERSION deliberately absent.
    }))
    expect(config.shadow).toBeNull()
  })
})

describe('toAiLearningLanguage', () => {
  it('passes through the three real ledger languages', () => {
    expect(toAiLearningLanguage('en')).toBe('en')
    expect(toAiLearningLanguage('de')).toBe('de')
    expect(toAiLearningLanguage('fa')).toBe('fa')
  })

  it('falls back to "unknown" for anything else, including undefined', () => {
    expect(toAiLearningLanguage(undefined)).toBe('unknown')
    expect(toAiLearningLanguage('fr')).toBe('unknown')
    expect(toAiLearningLanguage('')).toBe('unknown')
  })
})
