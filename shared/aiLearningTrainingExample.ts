// ALF-0: the training-example contract -- deliberately a SEPARATE format
// from the gold evaluation fixture (ai/evals/intent-routing-v1/), per
// ADR-0020 Decision: evaluation data must never automatically become
// training data. See ai/training/README.md for the export/curation
// process this type feeds; this file only defines the shape and the one
// privacy gate every real-user example must pass before it can be
// exported for training.
//
// SHARED-MODULE CONSTRAINT: same as shared/aiLearning.ts -- plain data
// plus pure functions, importable by both the Worker and (in a future
// slice) the frontend, no framework/runtime-specific imports.

import {
  type AiLearningLabelConfidence,
  type AiLearningLanguage,
  type AiLearningTask,
  type IntentRoutingLearningPayloadV1,
  collectIntentRoutingLearningPayloadErrors,
  isAiLearningLabelConfidence,
  isAiLearningTask,
  AI_LEARNING_LANGUAGES,
} from './aiLearning'

// Where an example's input/expected-output pair came from. Only
// 'synthetic' examples may be exported for training with no further
// review -- every other source carries real user data or a real user
// decision and must pass an explicit privacy gate first (see
// isExportableForTraining below).
export const AI_TRAINING_EXAMPLE_SOURCES = ['synthetic', 'real_user', 'corrected', 'execution_verified'] as const
export type AiTrainingExampleSource = typeof AI_TRAINING_EXAMPLE_SOURCES[number]

export function isAiTrainingExampleSource(value: unknown): value is AiTrainingExampleSource {
  return typeof value === 'string' && (AI_TRAINING_EXAMPLE_SOURCES as readonly string[]).includes(value)
}

// 'unreviewed' is the mandatory default for anything derived from real
// user data (source !== 'synthetic') -- no automatic "all chats ->
// training" exporter exists or is planned in ALF-0 (ADR-0020 Decision);
// a human/process step must move an example to 'sanitized' or
// 'cleared_for_export' before it can leave this contract's boundary.
export const AI_TRAINING_PRIVACY_STATUSES = ['unreviewed', 'sanitized', 'cleared_for_export'] as const
export type AiTrainingPrivacyStatus = typeof AI_TRAINING_PRIVACY_STATUSES[number]

export function isAiTrainingPrivacyStatus(value: unknown): value is AiTrainingPrivacyStatus {
  return typeof value === 'string' && (AI_TRAINING_PRIVACY_STATUSES as readonly string[]).includes(value)
}

export interface AiTrainingExampleV1 {
  readonly exampleId: string
  readonly schemaVersion: 'training-example-v1'
  readonly learningTask: AiLearningTask
  readonly source: AiTrainingExampleSource
  readonly language: AiLearningLanguage
  readonly input: string
  readonly expectedOutput: IntentRoutingLearningPayloadV1
  readonly confidence: AiLearningLabelConfidence
  readonly privacyStatus: AiTrainingPrivacyStatus
  readonly createdAt: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function collectAiTrainingExampleErrors(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ['training example must be a plain object']
  }
  if (!isNonEmptyString(value.exampleId)) errors.push('exampleId must be a non-empty string')
  if (value.schemaVersion !== 'training-example-v1') {
    errors.push(`schemaVersion must be exactly "training-example-v1" (got ${JSON.stringify(value.schemaVersion)})`)
  }
  if (!isAiLearningTask(value.learningTask)) errors.push('learningTask must be a known AiLearningTask')
  if (!isAiTrainingExampleSource(value.source)) {
    errors.push(`source must be one of ${AI_TRAINING_EXAMPLE_SOURCES.join(', ')}`)
  }
  if (!(AI_LEARNING_LANGUAGES as readonly unknown[]).includes(value.language)) {
    errors.push(`language must be one of ${AI_LEARNING_LANGUAGES.join(', ')}`)
  }
  if (!isNonEmptyString(value.input)) errors.push('input must be a non-empty string')
  for (const error of collectIntentRoutingLearningPayloadErrors(value.expectedOutput)) {
    errors.push(`expectedOutput: ${error}`)
  }
  if (!isAiLearningLabelConfidence(value.confidence)) {
    errors.push('confidence must be a known AiLearningLabelConfidence')
  }
  if (!isAiTrainingPrivacyStatus(value.privacyStatus)) {
    errors.push(`privacyStatus must be one of ${AI_TRAINING_PRIVACY_STATUSES.join(', ')}`)
  }
  if (!isNonEmptyString(value.createdAt) || Number.isNaN(Date.parse(value.createdAt as string))) {
    errors.push('createdAt must be a valid ISO-8601 timestamp string')
  }
  return errors
}

export function isValidAiTrainingExample(value: unknown): value is AiTrainingExampleV1 {
  return collectAiTrainingExampleErrors(value).length === 0
}

// The one privacy gate this slice builds (ADR-0020 Decision: "personal
// secrets/profile data must not be baked into LoRA merely because they
// appeared in chat"; "for real-user examples, privacy status must be
// explicit before export"). 'synthetic' examples never touched real user
// data, so they pass unconditionally. Every other source requires an
// explicit human/process step to have already moved privacyStatus past
// 'unreviewed' -- this function does not do that step itself, it only
// refuses to treat an unreviewed example as export-ready. No exporter
// exists yet in ALF-0 that calls this against real data; it exists so a
// future exporter has one place to enforce the gate rather than each
// call site inventing its own check.
export function isExportableForTraining(example: AiTrainingExampleV1): boolean {
  if (example.source === 'synthetic') return true
  return example.privacyStatus === 'sanitized' || example.privacyStatus === 'cleared_for_export'
}
