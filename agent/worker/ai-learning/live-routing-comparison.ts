// ALF-1B (ADR-0022): a deterministic, read-only, PROVIDER-NEUTRAL live
// evaluation comparison layer for production_label vs shadow_prediction
// intent-routing-v1 events. See
// docs/decisions/adr/ADR-0022-live-routing-evaluation-and-comparison-semantics.md
// for the full decision record this module implements.
//
// ZERO RUNTIME AUTHORITY: nothing in this module is ever imported by
// agent/worker/index.ts, agent/worker/flow-write-policy.ts, or any other
// production /chat code path. A comparison result can never affect the
// Chat response, routing, FAST/LEGACY lane selection, tool choice/
// arguments, approval, policy, permissions, execution intent/lifecycle,
// retries/fallback, Memory, GitHub, or files -- there is no code path
// from this module back into any of those systems, structurally, because
// nothing outside this module (and its own tests, and the read-only
// scripts/ai-learning/live-eval-report.ts CLI) ever imports it.
//
// NO ONLINE LEARNING. NO WEIGHT UPDATES. NO MODEL-GENERATED VALUE EVER
// BECOMES TRUTH. `production_label` is read as authoritative for every
// scored field; `shadow_prediction` is read as a candidate to compare
// against it, never the reverse -- see buildComparison below, which has
// no code path that could substitute a shadow value for the production
// value it is being scored against. ALF-1B correction 2 additionally
// re-validates each side's own eventKind/producerType/labelConfidence
// against shared/aiLearning.ts's canonical governance table (see
// isValidLiveLearningEnvelope below) -- a row cannot become production
// truth, or a scored candidate, merely by an export/replay path
// mislabeling which side it claims to be.
//
// PURE FUNCTIONS, NO I/O, NO DATABASE ACCESS. This module only transforms
// an in-memory array of already-fetched/already-exported ledger rows
// (LiveLearningEventRecord) into a report -- fetching or exporting those
// rows from Supabase is entirely the CALLER's concern (see
// scripts/ai-learning/live-eval-report.ts for the read-only CLI consumer
// that does that part). NO DATABASE PERSISTENCE OF THE COMPARISON RESULT
// EITHER -- ALF-1B computes comparisons on demand from ledger events; it
// does not write a new table or a new ledger event kind.
//
// PRIVACY: LiveLearningEventRecord below is deliberately narrower than
// the full ai_learning_events row shape -- no raw user message field
// exists anywhere in this module's types, because the ledger itself never
// stores one (ADR-0020). source_hash is allowed through unchanged
// (already a one-way fingerprint, never the text itself). Every error/
// anomaly this module reports is a fixed, bounded, enum-shaped reason
// string -- never a stringified value drawn from a payload.

import {
  AI_LEARNING_TASK_SCHEMA_VERSIONS,
  collectIntentRoutingLearningPayloadErrors,
  eventKindSemantics,
  isAiLearningLabelConfidence,
  isAiLearningProducerType,
  type IntentRoutingLearningPayloadV1,
} from '../../../shared/aiLearning'
import { isAllowedShadowIntentType, isAllowedShadowToolId } from './shadow-vocabulary'
import { isSemanticallyConsistentRoutingPayload } from './shadow-semantic-consistency'

// The only learning task/schema this module ever compares -- derived from
// shared/aiLearning.ts's own canonical learningTask -> schemaVersion
// mapping (ALF-1B correction 2, item 2), never a second, independently
// hand-typed literal.
const ROUTING_LEARNING_TASK = 'intent_routing_v1' as const
const ROUTING_SCHEMA_VERSION = AI_LEARNING_TASK_SCHEMA_VERSIONS[ROUTING_LEARNING_TASK]

// ---------------------------------------------------------------------
// Input: the read-only ledger-row shape this module consumes. Deliberately
// NOT the full learning-ledger.ts AiLearningEventRow (that type is
// Worker-internal, unexported) -- this is the public, minimal read
// contract for ALF-1B specifically, naming only the columns this module's
// logic actually needs.
// ---------------------------------------------------------------------
export interface LiveLearningEventRecord {
  readonly id: string
  readonly userId: string
  readonly sourceMessageId: string | null
  readonly correlationId: string
  readonly learningTask: string
  readonly schemaVersion: string
  readonly eventKind: string
  // ALF-1B correction 2, item 1: carried through so this module can
  // re-validate the SAME producerType/labelConfidence governance boundary
  // shared/aiLearning.ts's collectAiLearningEventInputErrors enforces at
  // write time -- "a model prediction is never truth" is meaningless if a
  // malformed export could relabel a shadow_prediction row's producerType
  // as 'deterministic_policy' and have it silently accepted as production
  // truth by this read-side layer.
  readonly producerType: string
  readonly labelConfidence: string | null
  readonly providerId: string | null
  readonly modelId: string | null
  readonly modelVersion: string | null
  readonly sourceHash: string | null
  readonly payload: Record<string, unknown>
}

// ---------------------------------------------------------------------
// Masking (LOCKED for ALF-1B -- see ADR-0022's own note on why these two,
// and only these two, fields are masked).
// ---------------------------------------------------------------------
export const LIVE_ROUTING_SCORED_FIELDS = [
  'interactionClass',
  'domain',
  'intentType',
  'toolId',
  'requiresClarification',
] as const
export type LiveRoutingScoredField = typeof LIVE_ROUTING_SCORED_FIELDS[number]

export const LIVE_ROUTING_MASKED_FIELDS = ['language', 'requiresApproval'] as const
export type LiveRoutingMaskedField = typeof LIVE_ROUTING_MASKED_FIELDS[number]

// ---------------------------------------------------------------------
// Output contract: LiveRoutingComparisonV1. Pure data -- no raw text, no
// secrets, no auth state, no policy credentials.
// ---------------------------------------------------------------------
export const LIVE_ROUTING_COMPARISON_SCHEMA_VERSION = 'live-routing-comparison-v1' as const

export interface LiveRoutingFieldResult {
  readonly field: LiveRoutingScoredField
  readonly match: boolean
  // Recorded for transparency (never raw text -- these are always one of
  // the small closed-enum values IntentRoutingLearningPayloadV1 itself
  // allows for this field, or a boolean, or undefined for an omitted
  // optional field).
  readonly productionValue: string | boolean | undefined
  readonly shadowValue: string | boolean | undefined
}

export interface LiveRoutingComparisonV1 {
  readonly schemaVersion: typeof LIVE_ROUTING_COMPARISON_SCHEMA_VERSION
  readonly sourceMessageId: string
  readonly productionEventId: string
  readonly shadowEventId: string
  readonly learningTask: string
  readonly routingSchemaVersion: string
  readonly providerId: string
  readonly modelId: string
  readonly modelVersion: string
  readonly comparedFields: readonly LiveRoutingScoredField[]
  readonly maskedFields: readonly LiveRoutingMaskedField[]
  readonly fieldResults: Readonly<Record<LiveRoutingScoredField, LiveRoutingFieldResult>>
  readonly exactRoutingMatch: boolean
}

// ---------------------------------------------------------------------
// Optional-field comparison semantics (LOCKED for ALF-1B). Applies
// uniformly to every scored field -- for interactionClass/domain/
// requiresClarification (always present on a structurally valid payload)
// only the "both present" branch is ever reachable; intentType/toolId are
// genuinely optional, so all three branches matter for them.
// ---------------------------------------------------------------------
function scoredFieldMatches(productionValue: unknown, shadowValue: unknown): boolean {
  const productionPresent = productionValue !== undefined
  const shadowPresent = shadowValue !== undefined
  if (!productionPresent && !shadowPresent) return true
  if (productionPresent !== shadowPresent) return false
  return productionValue === shadowValue
}

function asScoredValue(value: unknown): string | boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value
  // Never reachable for a structurally-valid IntentRoutingLearningPayloadV1
  // (every scored field is string|boolean|undefined) -- defensive only.
  return undefined
}

// ---------------------------------------------------------------------
// Pairing key. Pairs ONLY on these five fields -- never on text,
// timestamp proximity, "latest event," or model output content. Callers
// MUST only call this on a record whose sourceMessageId is already known
// non-empty (see the sourceMessageId pre-pass in compareLiveRoutingEvents
// below, ALF-1B correction 2, item 3) -- this function no longer has a
// "return null for missing sourceMessageId" escape hatch, so a missing
// sourceMessageId is never silently absorbed into pairing at all.
// ---------------------------------------------------------------------
function pairingKey(record: LiveLearningEventRecord & { sourceMessageId: string }): string {
  return [record.userId, record.sourceMessageId, record.correlationId, record.learningTask, record.schemaVersion].join('\x00')
}

function modelKey(record: LiveLearningEventRecord): string {
  return [record.providerId ?? '', record.modelId ?? '', record.modelVersion ?? ''].join('\x00')
}

// ---------------------------------------------------------------------
// Envelope validity (ALF-1B correction 2, items 1 + 2): everything about a
// record OUTSIDE its payload that must hold for it to be eligible for
// comparison at all. Reuses shared/aiLearning.ts's own canonical
// eventKind -> (producerType, labelConfidence) table (via
// eventKindSemantics) and its learningTask -> schemaVersion table (via
// AI_LEARNING_TASK_SCHEMA_VERSIONS) -- the SAME governance boundary
// enforced at write time, never a second, independently maintained,
// potentially-contradictory copy.
//
// A malformed row such as (eventKind='production_label',
// producerType='shadow_model', labelConfidence='candidate') fails here --
// it can NEVER become production truth merely by an export/replay path
// claiming eventKind='production_label'; the producerType/labelConfidence
// pair is cross-checked against what THAT eventKind is canonically
// allowed to carry. The mirror case (eventKind='shadow_prediction',
// producerType='deterministic_policy', labelConfidence='validated') fails
// closed the same way.
// ---------------------------------------------------------------------
function isValidLiveLearningEnvelope(
  record: LiveLearningEventRecord,
  expectedEventKind: 'production_label' | 'shadow_prediction',
): record is LiveLearningEventRecord & { sourceMessageId: string } {
  if (record.eventKind !== expectedEventKind) return false
  if (!record.sourceMessageId) return false
  if (record.learningTask !== ROUTING_LEARNING_TASK) return false
  if (record.schemaVersion !== ROUTING_SCHEMA_VERSION) return false

  if (!isAiLearningProducerType(record.producerType)) return false
  const semantics = eventKindSemantics(expectedEventKind)
  if (record.producerType !== semantics.producerType) return false
  if (record.labelConfidence !== null && !isAiLearningLabelConfidence(record.labelConfidence)) return false
  if ((record.labelConfidence ?? null) !== semantics.labelConfidence) return false

  // Model provenance is required, not optional, for a candidate
  // prediction (mirrors shared/aiLearning.ts's own
  // collectAiLearningEventInputErrors write-time check) -- never
  // normalize a missing provider/model/version to an eligible
  // empty-string model slice (ALF-1B correction 2, item 2).
  if (expectedEventKind === 'shadow_prediction') {
    if (!record.providerId || !record.modelId || !record.modelVersion) return false
  }

  return true
}

// ---------------------------------------------------------------------
// Payload validity for comparison purposes: generic shared-contract shape
// PLUS the same Shadow-only vocabulary allowlist and semantic-consistency
// gate the live Worker path already enforces at write time (defense in
// depth -- this re-validates rather than trusting a row was written after
// those gates existed; see ADR-0022's own note). Applied to BOTH sides:
// production_label is authoritative truth, but a malformed/inconsistent
// production_label is never silently trusted as ground truth either -- it
// is excluded and reported, not scored against. Note this only checks the
// PAYLOAD's own schemaVersion (via collectIntentRoutingLearningPayloadErrors,
// which requires it to be exactly 'intent-routing-v1'); the record's
// top-level schemaVersion is checked separately by
// isValidLiveLearningEnvelope above -- since both are independently
// pinned to the SAME canonical literal, a top-level/payload schema
// disagreement can never pass both checks (item 2's consistency
// requirement).
// ---------------------------------------------------------------------
function isValidRoutingPayloadForComparison(payload: unknown): payload is IntentRoutingLearningPayloadV1 {
  if (collectIntentRoutingLearningPayloadErrors(payload).length > 0) return false
  const typed = payload as IntentRoutingLearningPayloadV1
  if (typed.intentType !== undefined && !isAllowedShadowIntentType(typed.intentType)) return false
  if (typed.toolId !== undefined && !isAllowedShadowToolId(typed.toolId)) return false
  if (!isSemanticallyConsistentRoutingPayload(typed)) return false
  return true
}

// Combines envelope validity (this file, item 1 + 2) with payload
// validity (above) -- a record must pass BOTH to be eligible for
// comparison. Kept as two separate functions (rather than one merged
// check) so each concern stays independently testable and each failure
// reason stays legible in review, even though callers only ever need the
// combined answer.
function isValidForComparison(
  record: LiveLearningEventRecord,
  expectedEventKind: 'production_label' | 'shadow_prediction',
): record is LiveLearningEventRecord & { sourceMessageId: string } {
  if (!isValidLiveLearningEnvelope(record, expectedEventKind)) return false
  return isValidRoutingPayloadForComparison(record.payload)
}

function buildComparison(
  production: LiveLearningEventRecord & { sourceMessageId: string },
  shadow: LiveLearningEventRecord & { sourceMessageId: string },
): LiveRoutingComparisonV1 {
  const productionPayload = production.payload as unknown as IntentRoutingLearningPayloadV1
  const shadowPayload = shadow.payload as unknown as IntentRoutingLearningPayloadV1

  const fieldResults = {} as Record<LiveRoutingScoredField, LiveRoutingFieldResult>
  let allMatch = true
  for (const field of LIVE_ROUTING_SCORED_FIELDS) {
    const productionValue = asScoredValue(productionPayload[field])
    const shadowValue = asScoredValue(shadowPayload[field])
    const match = scoredFieldMatches(productionValue, shadowValue)
    if (!match) allMatch = false
    fieldResults[field] = { field, match, productionValue, shadowValue }
  }

  return {
    schemaVersion: LIVE_ROUTING_COMPARISON_SCHEMA_VERSION,
    sourceMessageId: production.sourceMessageId,
    productionEventId: production.id,
    shadowEventId: shadow.id,
    learningTask: production.learningTask,
    routingSchemaVersion: production.schemaVersion,
    // Non-null/non-empty by construction -- isValidForComparison's
    // shadow_prediction branch already rejected any row missing
    // providerId/modelId/modelVersion, so a comparison can never carry an
    // empty-string model slice (ALF-1B correction 2, item 2). The `?? ''`
    // fallback below is unreachable in practice; it exists only because
    // LiveLearningEventRecord's own field type is `string | null` and TypeScript
    // cannot see the validity check that already ran in the caller.
    providerId: shadow.providerId ?? '',
    modelId: shadow.modelId ?? '',
    modelVersion: shadow.modelVersion ?? '',
    comparedFields: LIVE_ROUTING_SCORED_FIELDS,
    maskedFields: LIVE_ROUTING_MASKED_FIELDS,
    fieldResults,
    exactRoutingMatch: allMatch,
  }
}

// ---------------------------------------------------------------------
// The full report shape returned by compareLiveRoutingEvents.
// ---------------------------------------------------------------------
export interface LiveRoutingEvalReport {
  readonly schemaVersion: typeof LIVE_ROUTING_COMPARISON_SCHEMA_VERSION
  readonly totalProductionLabels: number
  readonly totalShadowPredictions: number
  readonly eligiblePairs: number
  readonly missingProductionSide: number
  readonly missingShadowSide: number
  readonly ambiguousProductionGroups: number
  readonly ambiguousShadowModelSlices: number
  readonly invalidProductionLabelCount: number
  readonly invalidShadowPredictionCount: number
  readonly invalidOrIncompatiblePairs: number
  readonly exactRoutingAccuracy: number
  readonly fieldAccuracy: Readonly<Record<LiveRoutingScoredField, number>>
  readonly maskedFields: readonly LiveRoutingMaskedField[]
  readonly maskedFieldNote: string
  readonly comparisons: readonly LiveRoutingComparisonV1[]
}

type PairableRecord = LiveLearningEventRecord & { sourceMessageId: string }

// One group's production-side outcome (ALF-1B correction 2, item 4 pulled
// this out of the main loop body to keep each concern independently
// readable/testable). 'row' is the only status a comparison can ever be
// built against.
type ProductionResolution =
  | { readonly status: 'missing' }
  | { readonly status: 'ambiguous' }
  | { readonly status: 'invalid' }
  | { readonly status: 'row'; readonly row: PairableRecord }

function resolveProductionRow(productionRows: readonly PairableRecord[]): ProductionResolution {
  if (productionRows.length === 0) return { status: 'missing' }
  if (productionRows.length > 1) return { status: 'ambiguous' }
  if (!isValidForComparison(productionRows[0], 'production_label')) return { status: 'invalid' }
  return { status: 'row', row: productionRows[0] }
}

// One shadow model-slice's outcome, evaluated independently of the
// group's production-side outcome (item 4's core fix -- a Shadow
// prediction's own validity/ambiguity is never contingent on production
// also being clean).
//
// ALF-1B correction 3: callers MUST only pass rows that have ALREADY
// passed isValidLiveLearningEnvelope('shadow_prediction') -- see
// compareLiveRoutingEvents below, which partitions envelope-invalid rows
// out (each counted individually as 'invalid') BEFORE grouping by
// (providerId, modelId, modelVersion) at all. Grouping envelope-invalid
// rows by modelKey first was the bug this correction fixes: modelKey
// normalizes a missing providerId/modelId/modelVersion to '' rather than
// rejecting it, so two DIFFERENT malformed rows (e.g. both
// providerId=null, same modelId/modelVersion) could collide into the
// SAME synthetic key and be misclassified as one ambiguous model slice
// -- an envelope-invalid row has no legitimate model identity to be
// "ambiguous" about at all; it is simply invalid, once per row. Ambiguity
// (this function's own job) is therefore only ever evaluated AFTER that
// partition, among rows that are already known to carry real provenance.
type ShadowSliceResolution =
  | { readonly status: 'ambiguous' }
  | { readonly status: 'invalid' }
  | { readonly status: 'row'; readonly row: PairableRecord }

function resolveShadowSlice(envelopeValidModelRows: readonly PairableRecord[]): ShadowSliceResolution {
  if (envelopeValidModelRows.length > 1) {
    // A GENUINE duplicate for an identical, already-provenance-valid
    // model slice -- never arbitrarily resolved, even if one of the
    // duplicates happens to also have a semantically valid payload and
    // another does not (test D in live-routing-comparison.test.ts): the
    // whole slice stays ambiguous and excluded, exactly like the
    // production-side M-case duplicate handling.
    return { status: 'ambiguous' }
  }
  const row = envelopeValidModelRows[0]
  if (!isValidRoutingPayloadForComparison(row.payload)) return { status: 'invalid' }
  return { status: 'row', row }
}

// Never throws. Pure: the SAME input array always produces the SAME
// output, deterministically -- no randomness, no clock, no "latest wins."
export function compareLiveRoutingEvents(events: readonly LiveLearningEventRecord[]): LiveRoutingEvalReport {
  const productionEvents = events.filter((e) => e.eventKind === 'production_label')
  const shadowEvents = events.filter((e) => e.eventKind === 'shadow_prediction')

  let missingProductionSide = 0
  let missingShadowSide = 0
  let ambiguousProductionGroups = 0
  let ambiguousShadowModelSlices = 0
  let invalidProductionLabelCount = 0
  let invalidShadowPredictionCount = 0
  const comparisons: LiveRoutingComparisonV1[] = []

  // ALF-1B correction 2, item 3: a production_label/shadow_prediction row
  // with a missing/empty sourceMessageId makes exact pairing structurally
  // impossible -- reported here as invalid/unpairable, never silently
  // dropped from consideration the way the pre-correction pairingKey===
  // null branch used to. Only records that survive this pass (guaranteed
  // non-empty sourceMessageId) are ever handed to pairingKey below.
  const pairable: PairableRecord[] = []
  for (const record of events) {
    if (record.eventKind !== 'production_label' && record.eventKind !== 'shadow_prediction') continue
    if (!record.sourceMessageId) {
      if (record.eventKind === 'production_label') invalidProductionLabelCount += 1
      else invalidShadowPredictionCount += 1
      continue
    }
    pairable.push(record as PairableRecord)
  }

  const groups = new Map<string, PairableRecord[]>()
  for (const record of pairable) {
    const key = pairingKey(record)
    const bucket = groups.get(key)
    if (bucket) bucket.push(record)
    else groups.set(key, [record])
  }

  for (const groupRecords of groups.values()) {
    const productionRows = groupRecords.filter((r) => r.eventKind === 'production_label')
    const shadowRows = groupRecords.filter((r) => r.eventKind === 'shadow_prediction')

    // --- Production side: unchanged group-level gating semantics from
    // before this correction -- missingProductionSide/ambiguousProductionGroups
    // remain a fact about the GROUP as a whole ("is there a single clean
    // authoritative label for this turn").
    const production = resolveProductionRow(productionRows)
    if (production.status === 'missing') {
      // Only meaningful if there IS a shadow row to be missing a
      // production counterpart for.
      if (shadowRows.length > 0) missingProductionSide += 1
    } else if (production.status === 'ambiguous') {
      // M (ALF-1B): never pick one arbitrarily ("latest," first-seen, or
      // otherwise) -- production is supposed to be a single authoritative
      // truth per turn; more than one row for the same pairing key is an
      // ambiguity to REPORT, never silently resolved.
      ambiguousProductionGroups += 1
    } else if (production.status === 'invalid') {
      invalidProductionLabelCount += 1
    }
    const productionRow = production.status === 'row' ? production.row : undefined

    // --- Shadow side (ALF-1B correction 2, item 4): every shadow
    // model-slice in this group is resolved/counted INDEPENDENTLY of the
    // production-side outcome just computed above -- a malformed or
    // semantically-invalid Shadow prediction is invalid on its own
    // terms, never hidden behind (or contingent on) production also
    // being missing/duplicate/invalid for the same turn. Only whether a
    // comparison gets BUILT depends on production also being clean; the
    // invalid/ambiguous COUNTS below do not.
    if (shadowRows.length === 0) {
      // Preserves the original semantics: "missing shadow side" is only
      // a meaningful signal when production for this turn is otherwise
      // usable. If production is ALSO missing/ambiguous/invalid, that is
      // already fully accounted for by the production-side counters
      // above, and does not additionally need a "no shadow either" note.
      if (productionRow) missingShadowSide += 1
      continue
    }

    // ALF-1B correction 3: validate Shadow ENVELOPE/provenance for every
    // row BEFORE any modelKey grouping -- grouping first was the bug this
    // correction fixes. modelKey normalizes a missing providerId/modelId/
    // modelVersion to '' rather than rejecting it, so two DIFFERENT
    // envelope-invalid rows (e.g. both providerId=null, same modelId/
    // modelVersion) could previously collide into the SAME synthetic key
    // and get misclassified as one ambiguous model slice instead of two
    // independently invalid rows -- an envelope-invalid row has no
    // legitimate model identity to be "ambiguous" about at all. Each
    // envelope-invalid row is therefore counted here, individually,
    // BEFORE grouping; only envelope-VALID rows (guaranteed non-empty
    // providerId/modelId/modelVersion) ever reach modelKey/byModel below.
    const envelopeValidShadowRows: PairableRecord[] = []
    for (const row of shadowRows) {
      if (isValidLiveLearningEnvelope(row, 'shadow_prediction')) {
        envelopeValidShadowRows.push(row)
      } else {
        invalidShadowPredictionCount += 1
      }
    }

    // N (ALF-1B): group by (providerId, modelId, modelVersion) -- a
    // different model producing a prediction for the same turn is a
    // genuinely distinct, independently-scored observation (matches
    // ADR-0021 Decision 11's own idempotency-key provenance rule), never
    // collapsed into "pick one." A GENUINE duplicate for the identical
    // model slice (should not occur given the ledger's own idempotency
    // constraint, but exported/replayed data could still contain one) is
    // its own, separate ambiguity, reported and excluded, never picked --
    // see resolveShadowSlice's own comment on why payload validity for a
    // duplicate slice is never even checked (an ambiguous slice is
    // excluded outright, never resolved by picking whichever duplicate's
    // payload happens to look valid).
    const byModel = new Map<string, PairableRecord[]>()
    for (const row of envelopeValidShadowRows) {
      const key = modelKey(row)
      const bucket = byModel.get(key)
      if (bucket) bucket.push(row)
      else byModel.set(key, [row])
    }

    for (const modelRows of byModel.values()) {
      const shadow = resolveShadowSlice(modelRows)
      if (shadow.status === 'ambiguous') {
        ambiguousShadowModelSlices += 1
        continue
      }
      if (shadow.status === 'invalid') {
        invalidShadowPredictionCount += 1
        continue
      }
      if (productionRow) {
        comparisons.push(buildComparison(productionRow, shadow.row))
      }
      // else: a genuinely VALID shadow prediction with no clean
      // production counterpart in this group. Not itself invalid, so NOT
      // added to invalidShadowPredictionCount -- the group's own
      // production-side problem was already recorded exactly once by the
      // production-side counters above. No comparison is produced (a
      // comparison, by definition, requires a valid production label to
      // score against -- see Decision item 1: production is truth).
    }
  }

  const eligiblePairs = comparisons.length
  const rate = (n: number) => (eligiblePairs === 0 ? 0 : n / eligiblePairs)

  const fieldAccuracy = {} as Record<LiveRoutingScoredField, number>
  for (const field of LIVE_ROUTING_SCORED_FIELDS) {
    const matches = comparisons.filter((c) => c.fieldResults[field].match).length
    fieldAccuracy[field] = rate(matches)
  }
  const exactMatches = comparisons.filter((c) => c.exactRoutingMatch).length

  return {
    schemaVersion: LIVE_ROUTING_COMPARISON_SCHEMA_VERSION,
    totalProductionLabels: productionEvents.length,
    totalShadowPredictions: shadowEvents.length,
    eligiblePairs,
    missingProductionSide,
    missingShadowSide,
    ambiguousProductionGroups,
    ambiguousShadowModelSlices,
    invalidProductionLabelCount,
    invalidShadowPredictionCount,
    invalidOrIncompatiblePairs: ambiguousProductionGroups + ambiguousShadowModelSlices + invalidProductionLabelCount + invalidShadowPredictionCount,
    exactRoutingAccuracy: rate(exactMatches),
    fieldAccuracy,
    maskedFields: LIVE_ROUTING_MASKED_FIELDS,
    maskedFieldNote: 'language and requiresApproval are masked -- never scored, never counted in any accuracy denominator. See ADR-0022.',
    comparisons,
  }
}
