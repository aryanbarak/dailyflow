// ALF-1A correction (round 2, item 1): the SHADOW-SPECIFIC closed
// vocabulary for `IntentRoutingLearningPayloadV1.intentType`/`toolId`.
//
// shared/aiLearning.ts deliberately keeps intentType/toolId FREEFORM
// (any non-empty string) at the generic contract level -- that is correct
// for the shared contract itself (see that file's own comment on why),
// but it is NOT sufficient for a live Shadow model that has just seen the
// raw user message: a malicious or confused model could echo that raw
// message straight into intentType or toolId and still pass the generic
// schema check. This module adds a SECOND, SHADOW-ONLY gate -- an
// ALLOWLIST, never a blacklist -- applied in
// shadow-routing-prompt.ts's parseShadowRoutingOutput AFTER generic
// validation, so a Shadow prediction can never carry an intentType/toolId
// this codebase doesn't already recognize as a real routing outcome.
//
// The generic shared contract itself is deliberately NOT narrowed --
// doing so would weaken every OTHER producer of this payload (the
// production-label path, a future non-Shadow producer) to solve a
// problem that is specific to "this value came from a model that also
// saw untrusted raw text," which only the Shadow boundary has.
//
// SOURCE OF TRUTH, audited against two places (never invented here):
//   - shared/writeIntentRegistry.ts's own `writeIntentRegistry` --
//     every real WriteIntentType/WriteIntentToolId this codebase can
//     actually execute or has proposed executing.
//   - ai/evals/intent-routing-v1/cases.jsonl (ALF-0's own gold eval
//     fixture) -- every non-write (read/unsupported) intentType this
//     codebase's own eval categories already audit. A domain with no
//     audited read intentType yet (workspace, learning, memory,
//     documents) simply has NO legitimate intentType value today -- a
//     Shadow prediction for such a turn must omit intentType entirely
//     (still allowed), never invent one.
// A future new write intent or a future audited read category is added
// to ITS OWN source of truth (writeIntentRegistry.ts or the eval fixture,
// each already its own reviewed artifact) and automatically flows through
// here -- this module deliberately holds no second, independently
// maintained copy of the write half of this vocabulary.
//
// ALF-1B DECISION (resolves a prior non-blocking concern, documented not
// silently changed): scoped to `exposure === 'chat'` registry entries
// ONLY. `writeIntentRegistry.ts`'s own `exposure` field distinguishes
// intents the reasoning/chat layer may ever propose ('chat') from intents
// that exist only for a UI-driven flow with no legitimate chat-message
// origin ('ui-only' -- today, only `import_bank_statement`, reachable
// solely via an already-server-validated file upload, see that registry
// entry's own header comment). A live Chat message can never legitimately
// route to a ui-only intent, so a Shadow model predicting one is never
// "a plausible answer the model happened to get wrong" -- it is
// necessarily wrong by construction, the same way an intentType the
// registry has never heard of is. Excluding ui-only entries here keeps
// that failure mode caught at the SAME allowlist gate as any other
// unaudited value, rather than silently accepted as a structurally legal
// (if never-actually-correct) prediction. See ADR-0022's own note on this
// decision, and shadow-vocabulary.test.ts's explicit coverage of it.

import { writeIntentRegistry, type WriteIntentToolId, type WriteIntentType } from '../../../shared/writeIntentRegistry'

// Non-write (read/unsupported) intentType vocabulary audited against
// ai/evals/intent-routing-v1/cases.jsonl's own eval categories --
// shared-module-test-guarded parity below (shadow-routing-prompt.test.ts)
// keeps this list from silently drifting out of sync with that fixture.
const SHADOW_ALLOWED_NON_WRITE_INTENT_TYPES = [
  'read_calendar',
  'read_finance_summary',
  'read_github',
  'read_tasks',
  'unsupported_request',
] as const

const CHAT_EXPOSED_ENTRIES = writeIntentRegistry.filter((entry) => entry.exposure === 'chat')
const WRITE_INTENT_TYPES: readonly WriteIntentType[] = CHAT_EXPOSED_ENTRIES.map((entry) => entry.intentType)
const WRITE_TOOL_IDS: readonly WriteIntentToolId[] = CHAT_EXPOSED_ENTRIES.map((entry) => entry.toolId)

export const SHADOW_ALLOWED_INTENT_TYPES: readonly string[] = [
  ...WRITE_INTENT_TYPES,
  ...SHADOW_ALLOWED_NON_WRITE_INTENT_TYPES,
]

// toolId vocabulary is write-only (a read/conversational/unsupported turn
// never names a toolId) -- entirely sourced from the registry, no second
// list to audit.
export const SHADOW_ALLOWED_TOOL_IDS: readonly string[] = [...WRITE_TOOL_IDS]

export function isAllowedShadowIntentType(value: string): boolean {
  return (SHADOW_ALLOWED_INTENT_TYPES as readonly string[]).includes(value)
}

export function isAllowedShadowToolId(value: string): boolean {
  return (SHADOW_ALLOWED_TOOL_IDS as readonly string[]).includes(value)
}
