// ALF-0: offline scorer for the intent-routing-v1 gold evaluation fixture
// (ai/evals/intent-routing-v1/cases.jsonl). See
// docs/decisions/adr/ADR-0020-ai-learning-foundation-and-shadow-model-governance.md
// Decision item 10 for the governance this implements: this is the
// permanent benchmark used to compare a base model, LoRA v0.1, LoRA v0.2,
// etc. against the SAME fixed gold standard.
//
// NO EXTERNAL API CALL. NO MODEL INFERENCE. This script only compares two
// already-produced JSONL files (gold vs. a prediction file some other
// process generated) -- it never calls a provider itself.
//
// WHY PLAIN JS, NOT AN IMPORT OF shared/aiLearning.ts's enums: this
// script runs via plain `node`, matching scripts/local-qa-seed.mjs's own
// convention (no vite-node/ts-node transpilation step for scripts that
// don't need one) -- see this directory's own README for why. Importing
// a .ts file directly here would require a build step this script
// deliberately avoids. The enum vocabularies below are a small,
// deliberate duplication of shared/aiLearning.ts's own lists, guarded by
// this script's own test (score-eval.test.mjs) rather than a shared
// import.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const VALID_LANGUAGES = new Set(['en', 'de', 'fa', 'unknown'])
const VALID_INTERACTION_CLASSES = new Set(['conversation', 'read', 'write', 'clarification'])
const VALID_DOMAINS = new Set([
  'tasks', 'calendar', 'finance', 'github', 'workspace', 'learning', 'memory', 'documents', 'none', 'unknown',
])
// ARCHITECTURAL REVIEW CORRECTION (round 2): the exact closed key set --
// mirrors shared/aiLearning.ts's IntentRoutingLearningPayloadV1 allowlist
// exactly (same 8 keys, same order). This benchmark must never call a
// prediction "valid" that the canonical shared contract would reject --
// see the parity test in score-eval.test.mjs guarding this list against
// drift from shared/aiLearning.ts's own allowlist.
export const ALLOWED_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'language',
  'interactionClass',
  'domain',
  'intentType',
  'toolId',
  'requiresClarification',
  'requiresApproval',
])

export function parseJsonl(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

export function loadJsonlFile(path) {
  return parseJsonl(readFileSync(path, 'utf8'))
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

// Structural validity of a `predicted` (or `expected`) payload -- mirrors
// shared/aiLearning.ts's collectIntentRoutingLearningPayloadErrors, kept
// intentionally minimal since this script only needs to decide "usable
// for scoring" vs. "invalid," not produce the same error-message detail
// the shared TS module does. CLOSED SHAPE: any key outside
// ALLOWED_PAYLOAD_KEYS is rejected -- the benchmark must never call
// something "valid" that the canonical shared contract would reject.
export function isValidRoutingPayload(payload) {
  if (!isPlainObject(payload)) return false
  for (const key of Object.keys(payload)) {
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) return false
  }
  if (payload.schemaVersion !== 'intent-routing-v1') return false
  if (!VALID_LANGUAGES.has(payload.language)) return false
  if (!VALID_INTERACTION_CLASSES.has(payload.interactionClass)) return false
  if (!VALID_DOMAINS.has(payload.domain)) return false
  if (payload.intentType !== undefined && !isNonEmptyString(payload.intentType)) return false
  if (payload.toolId !== undefined && !isNonEmptyString(payload.toolId)) return false
  if (typeof payload.requiresClarification !== 'boolean') return false
  if (typeof payload.requiresApproval !== 'boolean') return false
  return true
}

function fieldsMatch(expected, predicted, field) {
  return (expected[field] ?? undefined) === (predicted[field] ?? undefined)
}

// ARCHITECTURAL REVIEW CORRECTION: `language` was missing from this list
// -- a model predicting language=en for every FA/DE case could previously
// still register as an "exact match" on every other field. `language` is
// part of IntentRoutingLearningPayloadV1 exactly like domain/
// interactionClass/etc.; there is no reason "exact" should exclude it.
function isExactMatch(expected, predicted) {
  return (
    fieldsMatch(expected, predicted, 'language') &&
    fieldsMatch(expected, predicted, 'domain') &&
    fieldsMatch(expected, predicted, 'interactionClass') &&
    fieldsMatch(expected, predicted, 'intentType') &&
    fieldsMatch(expected, predicted, 'toolId') &&
    fieldsMatch(expected, predicted, 'requiresClarification') &&
    fieldsMatch(expected, predicted, 'requiresApproval')
  )
}

// Scores `predictionRecords` (each `{ caseId, predicted }`) against
// `goldCases` (each `{ caseId, language, expected, ... }`, i.e. the
// ai/evals/intent-routing-v1/cases.jsonl shape). Pure function, no I/O --
// loadJsonlFile above is the only file-reading code in this module.
export function scoreEval(goldCases, predictionRecords) {
  const predictionsByCaseId = new Map()
  for (const record of predictionRecords) {
    if (isPlainObject(record) && typeof record.caseId === 'string') {
      predictionsByCaseId.set(record.caseId, record)
    }
  }

  const languages = new Set(goldCases.map((c) => c.language))
  const perLanguage = {}
  for (const language of languages) {
    perLanguage[language] = { total: 0, exactMatches: 0 }
  }

  let invalidPredictionCount = 0
  let intentMatches = 0
  let domainMatches = 0
  let toolMatches = 0
  let clarificationMatches = 0
  let approvalMatches = 0
  let languageMatches = 0
  let exactMatches = 0

  for (const goldCase of goldCases) {
    const expected = goldCase.expected
    const predictionRecord = predictionsByCaseId.get(goldCase.caseId)
    const predicted = predictionRecord?.predicted

    perLanguage[goldCase.language].total += 1

    if (!predictionRecord || !isValidRoutingPayload(predicted)) {
      // An invalid or missing prediction is never counted as correct for
      // any metric below -- it is tallied here and nowhere else.
      invalidPredictionCount += 1
      continue
    }

    if (fieldsMatch(expected, predicted, 'intentType')) intentMatches += 1
    if (fieldsMatch(expected, predicted, 'domain')) domainMatches += 1
    if (fieldsMatch(expected, predicted, 'toolId')) toolMatches += 1
    if (fieldsMatch(expected, predicted, 'requiresClarification')) clarificationMatches += 1
    if (fieldsMatch(expected, predicted, 'requiresApproval')) approvalMatches += 1
    if (fieldsMatch(expected, predicted, 'language')) languageMatches += 1
    if (isExactMatch(expected, predicted)) {
      exactMatches += 1
      perLanguage[goldCase.language].exactMatches += 1
    }
  }

  const total = goldCases.length
  const rate = (n) => (total === 0 ? 0 : n / total)

  const perLanguageAccuracy = {}
  for (const [language, counts] of Object.entries(perLanguage)) {
    perLanguageAccuracy[language] = counts.total === 0 ? 0 : counts.exactMatches / counts.total
  }

  return {
    totalCases: total,
    invalidPredictionCount,
    intentAccuracy: rate(intentMatches),
    domainAccuracy: rate(domainMatches),
    toolAccuracy: rate(toolMatches),
    clarificationAccuracy: rate(clarificationMatches),
    approvalAccuracy: rate(approvalMatches),
    // Whether the predicted `language` field itself matched the gold
    // case's language -- distinct from perLanguageAccuracy below, which
    // is routing exact-match accuracy BUCKETED BY gold language, not a
    // measure of whether the model got the language field right.
    languageAccuracy: rate(languageMatches),
    exactMatchAccuracy: rate(exactMatches),
    // Routing exact-match accuracy (isExactMatch, which itself now
    // includes language -- see that function's own comment), bucketed by
    // each gold case's OWN language. A model predicting the wrong
    // language for an FA case no longer counts as an exact match in the
    // fa bucket, or anywhere else.
    perLanguageAccuracy,
  }
}

function parseArgs(argv) {
  if (argv.length < 2) {
    throw new Error('Usage: node scripts/ai-learning/score-eval.mjs <gold.jsonl> <predictions.jsonl>')
  }
  return { goldPath: argv[0], predictionsPath: argv[1] }
}

async function main() {
  const { goldPath, predictionsPath } = parseArgs(process.argv.slice(2))
  const goldCases = loadJsonlFile(goldPath)
  const predictionRecords = loadJsonlFile(predictionsPath)
  const metrics = scoreEval(goldCases, predictionRecords)
  console.log(JSON.stringify(metrics, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
