// ALF-0: SmartFlow AI Learning Foundation -- shared, framework-free
// contracts for the append-only learning ledger (ai_learning_events),
// the shadow-model/production learning-payload shape, and the model
// asset manifest that will eventually describe a trained LoRA adapter.
//
// See docs/decisions/adr/ADR-0020-ai-learning-foundation-and-shadow-model-governance.md
// for the full decision record this file implements. Short version of the
// invariants that shape every type below:
//
//   - A model prediction is NEVER truth. `AiLearningLabelConfidence`
//     exists specifically so a consumer can tell a raw model guess
//     ('candidate') apart from a deterministically validated SmartFlow
//     decision ('validated'), an explicit user confirmation/correction
//     ('user_confirmed'), or a verified execution outcome
//     ('execution_verified') -- see ADR-0020 Decision 2.
//   - This module has ZERO runtime authority. Nothing here approves an
//     action, executes a tool, changes policy, or alters a user-visible
//     response -- it only describes data shapes and validates them.
//   - This module is imported by BOTH the Cloudflare Worker
//     (agent/worker/ai-learning/learning-ledger.ts, via a relative path)
//     and, in a future slice, the frontend -- same SHARED-MODULE
//     CONSTRAINT already documented in shared/writeIntentRegistry.ts and
//     shared/executionCanonicalization.ts: no Supabase client, no React,
//     no DOM, no worker-only bindings. Plain data plus pure functions
//     only.
//   - Authenticated identity (auth tokens, session secrets, raw
//     credentials) never belongs in a model-facing payload. userId lives
//     as its own top-level ledger column (see the migration), never
//     inside `payload`.

// ---------------------------------------------------------------------
// Section 1: learning task registry
// ---------------------------------------------------------------------

// Which learning problem an event/example/eval-case belongs to. Only one
// task exists in ALF-0 -- intent routing (read vs write vs clarification,
// which domain, which tool). Deliberately an array-derived union (matches
// SUPPORTED_EXECUTION_TOOL_IDS's convention in
// agent/worker/agent-tool-execution.ts) so a future second task is one
// array entry, not a hand-synced set of literal unions across files.
export const AI_LEARNING_TASKS = ['intent_routing_v1'] as const
export type AiLearningTask = typeof AI_LEARNING_TASKS[number]

export function isAiLearningTask(value: unknown): value is AiLearningTask {
  return typeof value === 'string' && (AI_LEARNING_TASKS as readonly string[]).includes(value)
}

// ARCHITECTURAL REVIEW CORRECTION: the single authoritative
// learningTask -> schemaVersion mapping. Before this correction, a
// registered learningTask paired with an UNREGISTERED schemaVersion
// (e.g. 'intent_routing_v1' + 'intent-routing-v2') fell through to the
// generic "payload must be a plain object" check in
// collectAiLearningEventInputErrors -- a validation bypass, since that
// generic check accepts an arbitrary object (rawText, credentials,
// anything) as long as `learningTask` itself was spelled correctly. This
// table closes that gap: a registered learningTask has EXACTLY ONE valid
// schemaVersion, and any other schemaVersion paired with it is rejected
// outright -- there is no generic/untyped payload route for a registered
// task. ALF-0 has no second registered task, so today this table has one
// entry; a future intent-routing-v2 (or a second learning task entirely)
// is added here deliberately, as its own reviewed contract change, never
// something a caller can silently opt into by supplying an
// unrecognized-but-plausible-looking schemaVersion string.
export const AI_LEARNING_TASK_SCHEMA_VERSIONS: Record<AiLearningTask, string> = {
  intent_routing_v1: 'intent-routing-v1',
}

// ---------------------------------------------------------------------
// Section 2: ledger event kinds, producers, and label confidence
// ---------------------------------------------------------------------

// One correlationId strings together a whole turn's worth of events, in
// this order over time, as they become known (append-only -- see the
// migration's own header comment for why this is never an UPDATE):
//   turn_observed -> production_label -> shadow_prediction ->
//   user_feedback -> execution_outcome
// Not every event kind fires for every turn (e.g. a turn with no
// shadow-model call yet has no shadow_prediction row), but the kinds that
// do fire always fire in this relative order.
export const AI_LEARNING_EVENT_KINDS = [
  'turn_observed',
  'production_label',
  'shadow_prediction',
  'user_feedback',
  'execution_outcome',
] as const
export type AiLearningEventKind = typeof AI_LEARNING_EVENT_KINDS[number]

export function isAiLearningEventKind(value: unknown): value is AiLearningEventKind {
  return typeof value === 'string' && (AI_LEARNING_EVENT_KINDS as readonly string[]).includes(value)
}

// Who/what produced this event's payload. Deliberately separate from
// event_kind: e.g. a 'user_feedback' event is always produced by 'user',
// but 'turn_observed' could in principle be produced by either
// 'deterministic_policy' (SmartFlow's own existing routing code observing
// itself) or, later, 'user' for an explicitly logged correction turn.
export const AI_LEARNING_PRODUCER_TYPES = [
  'deterministic_policy',
  'shadow_model',
  'user',
  'execution_verifier',
] as const
export type AiLearningProducerType = typeof AI_LEARNING_PRODUCER_TYPES[number]

export function isAiLearningProducerType(value: unknown): value is AiLearningProducerType {
  return typeof value === 'string' && (AI_LEARNING_PRODUCER_TYPES as readonly string[]).includes(value)
}

// How much a given label is worth trusting as ground truth. Strictly
// increasing trust, left to right -- 'candidate' is a raw, unverified
// model guess (shadow_prediction events only); 'validated' is SmartFlow's
// own deterministic decision (production_label events -- deterministic
// code, not a model, decided this); 'user_confirmed' is an explicit user
// approval/correction (user_feedback events); 'execution_verified' is the
// strongest -- the action was actually carried out and its real-world
// outcome observed (execution_outcome events). Gemini or any other
// shadow-model output alone can NEVER reach 'validated' or above -- see
// ADR-0020 Decision 3.
export const AI_LEARNING_LABEL_CONFIDENCES = [
  'candidate',
  'validated',
  'user_confirmed',
  'execution_verified',
] as const
export type AiLearningLabelConfidence = typeof AI_LEARNING_LABEL_CONFIDENCES[number]

export function isAiLearningLabelConfidence(value: unknown): value is AiLearningLabelConfidence {
  return typeof value === 'string' && (AI_LEARNING_LABEL_CONFIDENCES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------
// Section 3: intent-routing-v1 payload shape
// ---------------------------------------------------------------------

export const AI_LEARNING_LANGUAGES = ['en', 'de', 'fa', 'unknown'] as const
export type AiLearningLanguage = typeof AI_LEARNING_LANGUAGES[number]

export const AI_LEARNING_INTERACTION_CLASSES = ['conversation', 'read', 'write', 'clarification'] as const
export type AiLearningInteractionClass = typeof AI_LEARNING_INTERACTION_CLASSES[number]

// Deliberately broader than shared/writeIntentRegistry.ts's
// WriteIntentDomain ('tasks' | 'calendar' | 'finance' only, because that
// registry only describes domains with an actual write path today). This
// contract also needs to label READ-only and out-of-scope turns
// (github/workspace/learning/memory/documents reads, ordinary
// conversation, unsupported requests), which is why 'none' and 'unknown'
// exist alongside every current and near-future domain noun.
export const AI_LEARNING_DOMAINS = [
  'tasks',
  'calendar',
  'finance',
  'github',
  'workspace',
  'learning',
  'memory',
  'documents',
  'none',
  'unknown',
] as const
export type AiLearningDomain = typeof AI_LEARNING_DOMAINS[number]

// schemaVersion is a string literal on the type (not just documentation)
// so a future 'intent-routing-v2' payload is a distinct, non-interchangeable
// type -- a consumer that only handles v1 fails to compile against a v2
// value rather than silently misreading it.
export interface IntentRoutingLearningPayloadV1 {
  readonly schemaVersion: 'intent-routing-v1'
  readonly language: AiLearningLanguage
  readonly interactionClass: AiLearningInteractionClass
  readonly domain: AiLearningDomain
  // Freeform on purpose: this contract does not hard-couple to
  // shared/writeIntentRegistry.ts's closed WriteIntentType union, since
  // this payload also needs to name read-only/out-of-scope intents
  // (e.g. 'read_tasks', 'unsupported_request') that registry has no
  // concept of. A write turn's intentType SHOULD match a real
  // WriteIntentType string when domain is tasks/calendar/finance --
  // enforced by the eval fixture and its scorer, not by this type.
  readonly intentType?: string
  // Same freeform reasoning as intentType. When set for a write turn in
  // tasks/calendar, SHOULD match a real WriteIntentToolId
  // (shared/writeIntentRegistry.ts) or SupportedExecutionToolId
  // (agent/worker/agent-tool-execution.ts).
  readonly toolId?: string
  readonly requiresClarification: boolean
  readonly requiresApproval: boolean
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Returns the validated payload narrowed to the type, or `null` -- never
// throws. Callers that need to know WHY validation failed should use
// collectIntentRoutingLearningPayloadErrors below; this function exists
// for the common "do I have a usable payload or not" call site.
export function isIntentRoutingLearningPayloadV1(value: unknown): value is IntentRoutingLearningPayloadV1 {
  return collectIntentRoutingLearningPayloadErrors(value).length === 0
}

// Enumerates every problem with `value` as an IntentRoutingLearningPayloadV1
// (empty array means valid). Used by learning-ledger.ts's construction path
// (reject-with-reason, never silently drop a field) and by shared/
// aiLearning.test.ts to assert each enum is actually enforced, not just
// declared.
export function collectIntentRoutingLearningPayloadErrors(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ['payload must be a plain object']
  }
  if (value.schemaVersion !== 'intent-routing-v1') {
    errors.push(`schemaVersion must be exactly "intent-routing-v1" (got ${JSON.stringify(value.schemaVersion)})`)
  }
  if (!(AI_LEARNING_LANGUAGES as readonly unknown[]).includes(value.language)) {
    errors.push(`language must be one of ${AI_LEARNING_LANGUAGES.join(', ')} (got ${JSON.stringify(value.language)})`)
  }
  if (!(AI_LEARNING_INTERACTION_CLASSES as readonly unknown[]).includes(value.interactionClass)) {
    errors.push(`interactionClass must be one of ${AI_LEARNING_INTERACTION_CLASSES.join(', ')} (got ${JSON.stringify(value.interactionClass)})`)
  }
  if (!(AI_LEARNING_DOMAINS as readonly unknown[]).includes(value.domain)) {
    errors.push(`domain must be one of ${AI_LEARNING_DOMAINS.join(', ')} (got ${JSON.stringify(value.domain)})`)
  }
  if (value.intentType !== undefined && !isNonEmptyString(value.intentType)) {
    errors.push('intentType, when present, must be a non-empty string')
  }
  if (value.toolId !== undefined && !isNonEmptyString(value.toolId)) {
    errors.push('toolId, when present, must be a non-empty string')
  }
  if (typeof value.requiresClarification !== 'boolean') {
    errors.push('requiresClarification must be a boolean')
  }
  if (typeof value.requiresApproval !== 'boolean') {
    errors.push('requiresApproval must be a boolean')
  }
  // CLOSED SHAPE (architectural review correction): a blacklist of a few
  // named secret-shaped keys is insufficient -- it lets ANY other unknown
  // field through uninspected (rawText, message, content, nested
  // arbitrary metadata, a future secret-shaped key nobody thought to
  // blacklist yet). IntentRoutingLearningPayloadV1 instead declares
  // itself CLOSED: exactly the eight keys above are ever allowed, and any
  // other top-level key -- whether it looks like a credential or not --
  // is rejected. This is what actually backs ADR-0020's "no authenticated
  // identity or secrets in a model-facing payload" claim; a fixed
  // allowlist can never silently start admitting a new field the way a
  // blacklist can.
  const allowedKeys = new Set([
    'schemaVersion',
    'language',
    'interactionClass',
    'domain',
    'intentType',
    'toolId',
    'requiresClarification',
    'requiresApproval',
  ])
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`payload must not contain an unrecognized field "${key}" (IntentRoutingLearningPayloadV1 is a closed shape -- only ${Array.from(allowedKeys).join(', ')} are allowed)`)
    }
  }
  return errors
}

// ---------------------------------------------------------------------
// Section 4: append-only ledger event envelope (mirrors the
// ai_learning_events migration's columns 1:1 -- see
// supabase/migrations/*_ai_learning_events.sql)
// ---------------------------------------------------------------------

export interface AiLearningEventInput {
  readonly userId: string
  readonly sessionId?: string | null
  readonly sourceMessageId?: string | null
  // Groups every event kind belonging to one observed turn together (see
  // Section 2's ordering comment). Caller-supplied, not generated here --
  // the first event for a turn mints it (typically a uuid), every later
  // event for the same turn reuses it verbatim.
  readonly correlationId: string
  // Caller-supplied, deterministic per (attempt, not per semantic
  // content) -- see learning-ledger.ts's own header for why this must be
  // deterministic rather than randomly generated per call, matching
  // agent_tool_executions' (user_id, request_id) idempotency convention
  // in agent/worker/agent-tool-execution.ts.
  readonly idempotencyKey: string
  readonly learningTask: AiLearningTask
  readonly schemaVersion: string
  readonly eventKind: AiLearningEventKind
  readonly producerType: AiLearningProducerType
  readonly providerId?: string | null
  readonly modelId?: string | null
  readonly modelVersion?: string | null
  readonly labelConfidence?: AiLearningLabelConfidence | null
  readonly sourceHash?: string | null
  readonly payload: Record<string, unknown>
}

// ARCHITECTURAL REVIEW CORRECTION: the canonical, CLOSED
// eventKind -> (producerType, labelConfidence) mapping for ALF-0's only
// learning task. "A model prediction is never truth" (ADR-0020) is
// enforced HERE, not just documented: a shadow_prediction event can never
// carry 'validated'/'user_confirmed'/'execution_verified' confidence
// because shadow_prediction's only legal producerType/labelConfidence
// pair is (shadow_model, candidate) -- no combination of eventKind/
// producerType/labelConfidence values outside this table's five rows
// passes validation, so a shadow model's output cannot become training
// truth merely by malformed or careless construction code claiming a
// different producerType/labelConfidence for the same eventKind (that
// combination simply isn't one of the five valid rows). A future second
// learning task with genuinely different semantics gets its own mapping
// entry, not a loosening of this one.
const EVENT_KIND_SEMANTICS: Record<AiLearningEventKind, { producerType: AiLearningProducerType; labelConfidence: AiLearningLabelConfidence | null }> = {
  turn_observed: { producerType: 'deterministic_policy', labelConfidence: null },
  production_label: { producerType: 'deterministic_policy', labelConfidence: 'validated' },
  shadow_prediction: { producerType: 'shadow_model', labelConfidence: 'candidate' },
  user_feedback: { producerType: 'user', labelConfidence: 'user_confirmed' },
  execution_outcome: { producerType: 'execution_verifier', labelConfidence: 'execution_verified' },
}

export function collectAiLearningEventInputErrors(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ['event input must be a plain object']
  }
  if (!isNonEmptyString(value.userId)) errors.push('userId must be a non-empty string')
  if (value.sessionId !== undefined && value.sessionId !== null && !isNonEmptyString(value.sessionId)) {
    errors.push('sessionId, when present, must be a non-empty string or null')
  }
  if (value.sourceMessageId !== undefined && value.sourceMessageId !== null && !isNonEmptyString(value.sourceMessageId)) {
    errors.push('sourceMessageId, when present, must be a non-empty string or null')
  }
  if (!isNonEmptyString(value.correlationId)) errors.push('correlationId must be a non-empty string')
  if (!isNonEmptyString(value.idempotencyKey)) errors.push('idempotencyKey must be a non-empty string')
  if (!isAiLearningTask(value.learningTask)) errors.push(`learningTask must be one of ${AI_LEARNING_TASKS.join(', ')}`)
  if (!isNonEmptyString(value.schemaVersion)) errors.push('schemaVersion must be a non-empty string')
  if (!isAiLearningEventKind(value.eventKind)) errors.push(`eventKind must be one of ${AI_LEARNING_EVENT_KINDS.join(', ')}`)
  if (!isAiLearningProducerType(value.producerType)) errors.push(`producerType must be one of ${AI_LEARNING_PRODUCER_TYPES.join(', ')}`)
  if (value.providerId !== undefined && value.providerId !== null && !isNonEmptyString(value.providerId)) {
    errors.push('providerId, when present, must be a non-empty string or null')
  }
  if (value.modelId !== undefined && value.modelId !== null && !isNonEmptyString(value.modelId)) {
    errors.push('modelId, when present, must be a non-empty string or null')
  }
  if (value.modelVersion !== undefined && value.modelVersion !== null && !isNonEmptyString(value.modelVersion)) {
    errors.push('modelVersion, when present, must be a non-empty string or null')
  }
  if (
    value.labelConfidence !== undefined &&
    value.labelConfidence !== null &&
    !isAiLearningLabelConfidence(value.labelConfidence)
  ) {
    errors.push(`labelConfidence, when present, must be one of ${AI_LEARNING_LABEL_CONFIDENCES.join(', ')} or null`)
  }
  if (value.sourceHash !== undefined && value.sourceHash !== null && !isNonEmptyString(value.sourceHash)) {
    errors.push('sourceHash, when present, must be a non-empty string or null')
  }

  // ARCHITECTURAL REVIEW CORRECTION: eventKind/producerType/labelConfidence
  // cross-check against EVENT_KIND_SEMANTICS above -- only meaningful once
  // eventKind and producerType are each individually valid enum values
  // (their own errors are already reported above otherwise).
  if (isAiLearningEventKind(value.eventKind) && isAiLearningProducerType(value.producerType)) {
    const semantics = EVENT_KIND_SEMANTICS[value.eventKind]
    if (value.producerType !== semantics.producerType) {
      errors.push(`producerType for eventKind "${value.eventKind}" must be "${semantics.producerType}" (got ${JSON.stringify(value.producerType)}) -- see EVENT_KIND_SEMANTICS`)
    }
    const normalizedConfidence = value.labelConfidence ?? null
    if (normalizedConfidence !== semantics.labelConfidence) {
      errors.push(`labelConfidence for eventKind "${value.eventKind}" must be ${JSON.stringify(semantics.labelConfidence)} (got ${JSON.stringify(normalizedConfidence)}) -- a shadow model's prediction can never carry a confidence stronger than 'candidate' (ADR-0020: a model prediction is never truth)`)
    }

    // shadow_prediction rows must be traceable to the exact model that
    // produced them -- "a shadow prediction can never become training
    // truth" is only meaningful if a reader can also tell WHICH model
    // produced a given candidate prediction.
    if (value.eventKind === 'shadow_prediction') {
      if (!isNonEmptyString(value.providerId)) errors.push('providerId must be a non-empty string for a shadow_prediction event (model provenance is required, not optional, for a candidate prediction)')
      if (!isNonEmptyString(value.modelId)) errors.push('modelId must be a non-empty string for a shadow_prediction event (model provenance is required, not optional, for a candidate prediction)')
      if (!isNonEmptyString(value.modelVersion)) errors.push('modelVersion must be a non-empty string for a shadow_prediction event (model provenance is required, not optional, for a candidate prediction)')
    }
  }

  // ARCHITECTURAL REVIEW CORRECTION (round 2): a registered learningTask
  // has EXACTLY ONE valid schemaVersion (AI_LEARNING_TASK_SCHEMA_VERSIONS
  // above). Before this correction, a caller could supply
  // learningTask='intent_routing_v1' with an UNREGISTERED schemaVersion
  // (e.g. 'intent-routing-v2') and fall through to a generic "payload
  // must be a plain object" check that accepted an arbitrary object --
  // rawText, credentials, anything -- as long as learningTask itself was
  // spelled correctly. That fallback route is now GONE ENTIRELY: there is
  // no generic/untyped payload validation path for any learningTask,
  // registered or not.
  if (isAiLearningTask(value.learningTask)) {
    const requiredSchemaVersion = AI_LEARNING_TASK_SCHEMA_VERSIONS[value.learningTask]
    if (value.schemaVersion !== requiredSchemaVersion) {
      errors.push(`schemaVersion for learningTask "${value.learningTask}" must be exactly ${JSON.stringify(requiredSchemaVersion)} (got ${JSON.stringify(value.schemaVersion)}) -- see AI_LEARNING_TASK_SCHEMA_VERSIONS; there is no generic/untyped payload route for a registered task`)
    } else if (value.learningTask === 'intent_routing_v1') {
      for (const error of collectIntentRoutingLearningPayloadErrors(value.payload)) {
        errors.push(`payload: ${error}`)
      }
    }
    // A future second registered task adds its own
    // `else if (value.learningTask === '...')` branch with its own
    // dedicated payload validator here -- never a generic fallback.
  }
  // else: learningTask is itself not a registered AiLearningTask, already
  // reported by the `!isAiLearningTask(value.learningTask)` check above.
  // No payload validation route exists for an unrecognized task either --
  // an invalid learningTask never earns payload a free pass via a
  // generic "is a plain object" fallback.

  return errors
}

export function isValidAiLearningEventInput(value: unknown): value is AiLearningEventInput {
  return collectAiLearningEventInputErrors(value).length === 0
}

// ---------------------------------------------------------------------
// Section 5: AI model asset manifest
// ---------------------------------------------------------------------

// Describes exactly which model produced (or will produce) a prediction,
// with the base-model dependency explicit even when an adapter is
// present -- an adapter manifest with no baseModelId/exactBaseRevision is
// invalid by construction (see collectAiModelManifestErrors), because an
// adapter trained against base model revision A silently applied to
// revision B is exactly the kind of drift ADR-0020 exists to prevent.
export interface AiModelManifest {
  readonly providerId: string
  readonly baseModelId: string
  // Exact revision/commit/snapshot of the base model, when the provider
  // exposes one. Optional because not every provider surfaces a pinnable
  // revision (e.g. a hosted API model id that itself floats) -- but any
  // manifest that also sets adapterId SHOULD set this, since an adapter's
  // whole value proposition depends on the base it was trained against
  // staying identified.
  readonly exactBaseRevision?: string
  readonly adapterId?: string
  readonly adapterVersion?: string
  readonly trainingDatasetVersion?: string
  readonly evalSuiteVersion: string
  readonly promptContractVersion: string
  readonly createdAt: string
}

export function collectAiModelManifestErrors(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ['manifest must be a plain object']
  }
  if (!isNonEmptyString(value.providerId)) errors.push('providerId must be a non-empty string')
  if (!isNonEmptyString(value.baseModelId)) errors.push('baseModelId must be a non-empty string')
  if (value.exactBaseRevision !== undefined && !isNonEmptyString(value.exactBaseRevision)) {
    errors.push('exactBaseRevision, when present, must be a non-empty string')
  }
  if (value.adapterId !== undefined && !isNonEmptyString(value.adapterId)) {
    errors.push('adapterId, when present, must be a non-empty string')
  }
  if (value.adapterVersion !== undefined && !isNonEmptyString(value.adapterVersion)) {
    errors.push('adapterVersion, when present, must be a non-empty string')
  }
  // An adapter without its base pinned cannot be safely applied to
  // anything -- see this interface's own header comment.
  if (value.adapterId !== undefined && value.exactBaseRevision === undefined) {
    errors.push('a manifest with adapterId set must also set exactBaseRevision (an adapter\'s base dependency must be explicit)')
  }
  if (value.trainingDatasetVersion !== undefined && !isNonEmptyString(value.trainingDatasetVersion)) {
    errors.push('trainingDatasetVersion, when present, must be a non-empty string')
  }
  if (!isNonEmptyString(value.evalSuiteVersion)) errors.push('evalSuiteVersion must be a non-empty string')
  if (!isNonEmptyString(value.promptContractVersion)) errors.push('promptContractVersion must be a non-empty string')
  if (!isNonEmptyString(value.createdAt) || Number.isNaN(Date.parse(value.createdAt as string))) {
    errors.push('createdAt must be a valid ISO-8601 timestamp string')
  }
  return errors
}

export function isValidAiModelManifest(value: unknown): value is AiModelManifest {
  return collectAiModelManifestErrors(value).length === 0
}
