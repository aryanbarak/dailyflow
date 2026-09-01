// ALF-0: the portable LoRA training-run CONFIG CONTRACT. Skeleton only --
// see ai/training/README.md for the full harness documentation and
// ADR-0020 Decision item 9. No training code in this repository reads or
// writes this shape yet; no training has run; no weights exist.
//
// PROVIDER-INDEPENDENT BY DESIGN: the intended stack is Hugging Face
// Transformers + PEFT/LoRA + TRL (or an equivalent SFT pipeline).
// Cloudflare (Workers AI) is an INFERENCE target a resulting adapter may
// later be uploaded to -- never the owner of this config. No
// Cloudflare-specific model identifier belongs on this type; baseModelId
// is a plain string precisely so it stays neutral.
//
// SHARED-MODULE CONSTRAINT: same as shared/aiLearning.ts -- plain data,
// no framework/runtime-specific imports.

export interface LoraTrainingConfig {
  readonly baseModelId: string
  readonly baseModelRevision: string
  readonly tokenizerId: string
  readonly chatTemplateId: string
  // A pinned set of shared/aiLearningTrainingExample.ts's AiTrainingExampleV1
  // rows -- e.g. an export identifier/version string, not the rows
  // themselves (this config describes a training RUN, not the dataset's
  // content).
  readonly trainingDatasetVersion: string
  readonly loraRank: number
  readonly loraAlpha: number
  readonly targetModules: readonly string[]
  readonly learningRate: number
  readonly epochs: number
  readonly seed: number
  readonly maxSequenceLength: number
  // Which version of ai/evals/intent-routing-v1/ (or a future task's own
  // eval fixture) the resulting adapter must be scored against before it
  // can be considered usable -- ADR-0020 Decision item 10.
  readonly evalSuiteVersion: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// No training code calls this yet -- it exists so a future harness has a
// single place to validate a config before starting a (real, GPU,
// out-of-repo) training run, the same "define the contract before the
// implementation exists" discipline the rest of ALF-0 follows.
export function collectLoraTrainingConfigErrors(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ['training config must be a plain object']
  }
  if (!isNonEmptyString(value.baseModelId)) errors.push('baseModelId must be a non-empty string')
  if (!isNonEmptyString(value.baseModelRevision)) errors.push('baseModelRevision must be a non-empty string')
  if (!isNonEmptyString(value.tokenizerId)) errors.push('tokenizerId must be a non-empty string')
  if (!isNonEmptyString(value.chatTemplateId)) errors.push('chatTemplateId must be a non-empty string')
  if (!isNonEmptyString(value.trainingDatasetVersion)) errors.push('trainingDatasetVersion must be a non-empty string')
  if (!isPositiveInteger(value.loraRank)) errors.push('loraRank must be a positive integer')
  if (!isPositiveFiniteNumber(value.loraAlpha)) errors.push('loraAlpha must be a positive number')
  if (!Array.isArray(value.targetModules) || value.targetModules.length === 0 || !value.targetModules.every((m) => isNonEmptyString(m))) {
    errors.push('targetModules must be a non-empty array of non-empty strings')
  }
  if (!isPositiveFiniteNumber(value.learningRate)) errors.push('learningRate must be a positive number')
  if (!isPositiveInteger(value.epochs)) errors.push('epochs must be a positive integer')
  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed)) errors.push('seed must be an integer')
  if (!isPositiveInteger(value.maxSequenceLength)) errors.push('maxSequenceLength must be a positive integer')
  if (!isNonEmptyString(value.evalSuiteVersion)) errors.push('evalSuiteVersion must be a non-empty string')
  return errors
}

export function isValidLoraTrainingConfig(value: unknown): value is LoraTrainingConfig {
  return collectLoraTrainingConfigErrors(value).length === 0
}
