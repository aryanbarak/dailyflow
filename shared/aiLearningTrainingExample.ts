// ALF-0: the training-example contract -- deliberately a SEPARATE format
// from the gold evaluation fixture (ai/evals/intent-routing-v1/), per
// ADR-0020 Decision: evaluation data must never automatically become
// training data. See ai/training/README.md for the export/curation
// process this type feeds; this file defines the shape and the gates
// every example must pass before it can be exported for training --
// PRIVACY (real-user data must be sanitized/cleared first) and, SEPARATELY,
// QUALITY/TRUTH (a model/teacher-generated candidate label is never
// training-exportable, for any source, synthetic included -- see
// isExportableForTraining's own header comment below).
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
  AI_LEARNING_LABEL_CONFIDENCES,
  AI_LEARNING_LANGUAGES,
} from './aiLearning'

// Where an example's input/expected-output pair came from. 'synthetic'
// examples skip the PRIVACY review below (no real user data involved) but
// still must meet the QUALITY/TRUTH confidence gate like every other
// source -- every non-synthetic source additionally carries real user
// data or a real user decision and must pass the privacy gate too (see
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
  // ARCHITECTURAL REVIEW CORRECTION (round 3): a training example's own
  // `language` field must match what it is teaching the model to output
  // (`expectedOutput.language`) -- an example categorized as German while
  // its expected output says language='fa' is internally inconsistent
  // and must never validate, regardless of how the two fields were
  // populated.
  if (isRecord(value.expectedOutput) && value.language !== value.expectedOutput.language) {
    errors.push(`language (${JSON.stringify(value.language)}) must match expectedOutput.language (${JSON.stringify(value.expectedOutput.language)}) -- an example cannot be categorized as one language while teaching the model to output another`)
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
  // ARCHITECTURAL REVIEW CORRECTION (round 4): AiTrainingExampleV1 is a
  // CLOSED top-level shape, mirroring shared/aiLearning.ts's own
  // IntentRoutingLearningPayloadV1 closed-schema correction exactly --
  // exactly the ten declared keys are ever allowed, and any other
  // top-level key (a stray access_token, a rawMetadata blob, an
  // arbitrary nested object under an unrecognized key) is rejected. A
  // malformed/leaky example with an extra field was previously accepted
  // as long as its ten known fields all validated -- isExportableForTraining
  // calls collectAiTrainingExampleErrors first, so this also closes the
  // same class of gap there: an example carrying credentials or untracked
  // metadata can never become training-exportable merely because its
  // known fields happened to be well-formed.
  const allowedKeys = new Set([
    'exampleId',
    'schemaVersion',
    'learningTask',
    'source',
    'language',
    'input',
    'expectedOutput',
    'confidence',
    'privacyStatus',
    'createdAt',
  ])
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`training example must not contain an unrecognized field "${key}" (AiTrainingExampleV1 is a closed shape -- only ${Array.from(allowedKeys).join(', ')} are allowed)`)
    }
  }
  return errors
}

export function isValidAiTrainingExample(value: unknown): value is AiTrainingExampleV1 {
  return collectAiTrainingExampleErrors(value).length === 0
}

// ARCHITECTURAL REVIEW CORRECTION (round 3): confidence rank, derived
// from AI_LEARNING_LABEL_CONFIDENCES' own declared order (candidate <
// validated < user_confirmed < execution_verified) -- a single source of
// truth, never a second hand-maintained ordering that could drift from
// shared/aiLearning.ts's own.
const CONFIDENCE_RANK: Record<AiLearningLabelConfidence, number> = Object.fromEntries(
  AI_LEARNING_LABEL_CONFIDENCES.map((confidence, index) => [confidence, index] as const),
) as Record<AiLearningLabelConfidence, number>

// The QUALITY/TRUTH gate (ADR-0020: a model prediction is never truth),
// SEPARATE from and in addition to the privacy gate below.
// `source: 'synthetic'` means "no real-user data, so no privacy review is
// required" -- it does NOT mean "automatically trusted ground truth."
// A model/teacher-generated candidate label (confidence: 'candidate')
// can never satisfy any source's minimum here, so it can never become
// training-exportable no matter how the example was sourced.
// 'execution_verified' as a SOURCE requires 'execution_verified'
// confidence specifically -- since that is already the strongest tier,
// this is effectively an exact-match requirement (a weaker confidence on
// an execution_verified-sourced example means the outcome verification
// itself did not actually happen, which is internally inconsistent and
// must not be trusted regardless of source label).
const SOURCE_MINIMUM_CONFIDENCE: Record<AiTrainingExampleSource, AiLearningLabelConfidence> = {
  synthetic: 'validated',
  real_user: 'validated',
  corrected: 'user_confirmed',
  execution_verified: 'execution_verified',
}

// Combines THREE independent gates, all of which must pass:
//   1. STRUCTURAL VALIDITY -- the full AiTrainingExampleV1 contract
//      (collectAiTrainingExampleErrors/isValidAiTrainingExample), so a
//      malformed runtime object can never become exportable merely
//      because a caller bypassed TypeScript's static typing. Accepts
//      `unknown`, not a pre-typed AiTrainingExampleV1, precisely so a
//      caller cannot skip this step by asserting a type.
//   2. PRIVACY (ADR-0020: "personal secrets/profile data must not be
//      baked into LoRA merely because they appeared in chat"; "for
//      real-user examples, privacy status must be explicit before
//      export"). 'synthetic' examples never touched real user data, so
//      this gate is skipped for them entirely. Every other source
//      requires an explicit human/process step to have already moved
//      privacyStatus past 'unreviewed'.
//   3. QUALITY/TRUTH (SOURCE_MINIMUM_CONFIDENCE above) -- applies to
//      EVERY source, 'synthetic' included. Confidence is compared by
//      RANK ONLY; nothing here ever silently upgrades a weaker
//      confidence to satisfy a stronger requirement.
// No exporter exists yet in ALF-0 that calls this against real data; it
// exists so a future exporter has one place to enforce every gate rather
// than each call site inventing (and potentially forgetting) its own.
export function isExportableForTraining(value: unknown): value is AiTrainingExampleV1 {
  if (!isValidAiTrainingExample(value)) return false

  if (value.source !== 'synthetic') {
    if (value.privacyStatus !== 'sanitized' && value.privacyStatus !== 'cleared_for_export') {
      return false
    }
  }

  const requiredMinimum = SOURCE_MINIMUM_CONFIDENCE[value.source]
  return CONFIDENCE_RANK[value.confidence] >= CONFIDENCE_RANK[requiredMinimum]
}
