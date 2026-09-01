// ALF-1A (ADR-0021): server-owned, fail-closed configuration for live
// learning capture and shadow routing prediction. See
// docs/decisions/adr/ADR-0021-live-learning-capture-and-shadow-runtime.md.
//
// FAIL-CLOSED, ALWAYS: every one of `resolveLiveCaptureConfig`'s decisions
// defaults to OFF/disabled unless every required value is present and
// well-formed. There is no "best guess" behavior anywhere in this module --
// an absent, empty, or malformed value never falls back to an inferred or
// hardcoded default. This is deliberate per ADR-0020/ADR-0021: a shadow
// model's provenance (which provider, which model, which version) must
// always be exactly what was configured, never guessed. In particular:
//   - a missing/malformed AI_SHADOW_MODEL_ID/AI_SHADOW_MODEL_VERSION never
//     falls back to the production text-generation model or its version --
//     that would corrupt model-specific evaluation provenance (ADR-0020
//     Decision 11: base model remains UNDECIDED; ADR-0021 Decision: the
//     Workers AI production Chat model is NOT automatically the shadow
//     model).
//   - shadow is force-disabled whenever capture itself is disabled -- there
//     is no case where a shadow prediction runs but has nowhere valid to be
//     persisted.

import type { Env } from '../types'
import type { AiLearningLanguage } from '../../../shared/aiLearning'

export interface ShadowCaptureConfig {
  readonly providerId: string
  readonly modelId: string
  readonly modelVersion: string
  // 0 (never sample) to 1 (always sample), inclusive.
  readonly sampleRate: number
}

export interface LiveCaptureConfig {
  readonly captureEnabled: boolean
  // null means shadow prediction is disabled -- either explicitly, or
  // because captureEnabled is false, or because any required shadow field
  // was missing/malformed.
  readonly shadow: ShadowCaptureConfig | null
}

function isEnabledFlag(value: string | undefined): boolean {
  // Exact-match only ('true', lowercase) -- no truthy-string coercion
  // ('1', 'yes', 'TRUE', ' true ' all fail closed to disabled). A
  // malformed flag must never accidentally enable a live-capture path.
  return value === 'true'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseSampleRate(value: string | undefined): number | null {
  // `Number('')` is 0, not NaN -- an empty/whitespace-only string must not
  // silently parse as a valid rate of 0.
  if (!isNonEmptyString(value)) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed < 0 || parsed > 1) return null
  return parsed
}

// Never throws. Every field is independently fail-closed -- a malformed
// value for ONE shadow field (e.g. an out-of-range sample rate) disables
// shadow entirely, it never partially applies the rest.
export function resolveLiveCaptureConfig(env: Env): LiveCaptureConfig {
  const captureEnabled = isEnabledFlag(env.AI_LEARNING_CAPTURE_ENABLED)

  if (!captureEnabled) {
    return { captureEnabled: false, shadow: null }
  }

  const shadowFlagEnabled = isEnabledFlag(env.AI_SHADOW_ENABLED)
  const providerId = env.AI_SHADOW_PROVIDER
  const modelId = env.AI_SHADOW_MODEL_ID
  const modelVersion = env.AI_SHADOW_MODEL_VERSION
  const sampleRate = parseSampleRate(env.AI_SHADOW_SAMPLE_RATE)

  if (
    !shadowFlagEnabled ||
    !isNonEmptyString(providerId) ||
    !isNonEmptyString(modelId) ||
    !isNonEmptyString(modelVersion) ||
    sampleRate === null
  ) {
    return { captureEnabled: true, shadow: null }
  }

  return {
    captureEnabled: true,
    shadow: {
      providerId: providerId.trim(),
      modelId: modelId.trim(),
      modelVersion: modelVersion.trim(),
      sampleRate,
    },
  }
}

// Fallback used ONLY when no server-known language for the turn resolves
// to one of the ledger's own three real languages ('en'/'de'/'fa') -- e.g.
// a future caller that hasn't resolved a user language yet. Kept as its
// own tiny function (not a magic literal repeated at call sites) so every
// caller expresses the same fail-closed default the same way.
export function toAiLearningLanguage(language: string | undefined): AiLearningLanguage {
  if (language === 'en' || language === 'de' || language === 'fa') return language
  return 'unknown'
}
