// ALF-1B: a Shadow-specific deterministic semantic CONSISTENCY gate.
//
// shadow-vocabulary.ts's allowlist only checks whether an intentType/
// toolId is individually a known value -- it says nothing about whether
// domain+intentType+toolId+interactionClass are actually a COHERENT
// combination. A model could return every individual field as a known,
// audited value while still combining them into an IMPOSSIBLE routing
// outcome, e.g. domain="tasks" with intentType="create_calendar_event"
// and toolId="calendar.create_event" (each field individually legal, the
// COMBINATION never real). This module closes that gap.
//
// Derived from shared/writeIntentRegistry.ts wherever possible (never a
// hand-duplicated copy of write semantics) -- see WRITE_INTENT_SEMANTICS
// below. Scoped to exposure==='chat' entries only, matching
// shadow-vocabulary.ts's own ALF-1B decision (a ui-only intent is already
// excluded at the allowlist gate; excluding it here too keeps both gates
// consistent with each other rather than one being stricter than the
// other for the same reason).
//
// Non-write (read/unsupported) semantics have no registry to derive from
// -- shared/writeIntentRegistry.ts only describes WRITE intents by design
// (see its own header comment). NON_WRITE_INTENT_SEMANTICS below is an
// explicit, reviewed mapping audited against
// ai/evals/intent-routing-v1/cases.jsonl's own gold case data (the exact
// domain/interactionClass each non-write intentType category actually
// carries there) -- never invented independently of that fixture. Parity
// with the fixture is guarded by this module's own test.
//
// PURE, DETERMINISTIC, NO I/O. Used both by shadow-routing-prompt.ts (to
// reject an impossible combination at the earliest possible point, before
// a shadow_prediction row is ever persisted) and by
// live-routing-comparison.ts (ALF-1B's own comparison layer, as a
// defensive re-check against already-persisted ledger data, including
// rows written before this gate existed).
//
// Does NOT weaken shared/aiLearning.ts's generic contract. This is an
// ADDITIONAL, narrower check layered on top -- callers run
// collectIntentRoutingLearningPayloadErrors (generic shape) and, for
// Shadow specifically, the vocabulary allowlist (individual-value
// membership) BEFORE this function; this function only ever answers "do
// the fields that ARE present, given they're each individually legal,
// combine into something that could ever actually happen."

import { writeIntentRegistry } from '../../../shared/writeIntentRegistry'
import type { AiLearningDomain, AiLearningInteractionClass } from '../../../shared/aiLearning'

interface RoutingIntentSemantics {
  readonly domain: AiLearningDomain
  readonly interactionClass: AiLearningInteractionClass
  // Present for write intents (every write intent has exactly one real
  // toolId); absent for non-write intents (a read/conversation/
  // unsupported turn never legitimately carries a toolId at all).
  readonly toolId?: string
}

// Audited against ai/evals/intent-routing-v1/cases.jsonl's own gold case
// data -- every category's actual (domain, interactionClass) pairing, not
// invented here. See this module's own test for the fixture-parity guard.
const NON_WRITE_INTENT_SEMANTICS: Readonly<Record<string, RoutingIntentSemantics>> = {
  read_tasks: { domain: 'tasks', interactionClass: 'read' },
  read_calendar: { domain: 'calendar', interactionClass: 'read' },
  read_finance_summary: { domain: 'finance', interactionClass: 'read' },
  read_github: { domain: 'github', interactionClass: 'read' },
  unsupported_request: { domain: 'none', interactionClass: 'conversation' },
}

// Derived, not duplicated -- see this module's own header comment on why
// exposure==='chat' is the correct scope.
const WRITE_INTENT_SEMANTICS: Readonly<Record<string, RoutingIntentSemantics>> = Object.fromEntries(
  writeIntentRegistry
    .filter((entry) => entry.exposure === 'chat')
    .map((entry) => [entry.intentType, { domain: entry.domain, interactionClass: 'write' as const, toolId: entry.toolId }]),
)

const ROUTING_INTENT_SEMANTICS: Readonly<Record<string, RoutingIntentSemantics>> = {
  ...WRITE_INTENT_SEMANTICS,
  ...NON_WRITE_INTENT_SEMANTICS,
}

export function isKnownRoutingIntentType(intentType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ROUTING_INTENT_SEMANTICS, intentType)
}

// ALF-1B correction 1, item 3: a CLOSED set of legitimate
// (interactionClass, domain) pairs for a payload that names NO intentType
// at all. Auditing every "no intentType" case actually present in
// ai/evals/intent-routing-v1/cases.jsonl turns up exactly these two
// combinations -- ordinary conversation naming no domain, and an
// unresolved clarification naming no domain yet. 'read' and 'write'
// NEVER appear without an intentType anywhere in that fixture (a read or
// write turn always names what it is reading/writing), so this
// deliberately does NOT invent a broader allowance for them. Parity with
// the fixture is guarded by this module's own test -- if a future fixture
// case introduces a genuinely new intentless combination, that test fails
// until this list is deliberately, visibly updated to match.
const INTENTLESS_INTERACTION_DOMAIN_PAIRS: ReadonlyArray<readonly [AiLearningInteractionClass, AiLearningDomain]> = [
  ['conversation', 'none'],
  ['clarification', 'unknown'],
]

function isAllowedIntentlessCombination(interactionClass: AiLearningInteractionClass, domain: AiLearningDomain): boolean {
  return INTENTLESS_INTERACTION_DOMAIN_PAIRS.some(([ic, d]) => ic === interactionClass && d === domain)
}

export interface RoutingConsistencyInput {
  readonly domain: AiLearningDomain
  readonly interactionClass: AiLearningInteractionClass
  readonly intentType?: string
  readonly toolId?: string
}

// Never throws. Returns false for ANY combination this codebase does not
// recognize as a real, coherent routing outcome.
export function isSemanticallyConsistentRoutingPayload(payload: RoutingConsistencyInput): boolean {
  const { domain, interactionClass, intentType, toolId } = payload

  // A toolId with no governing intentType has no coherent semantics --
  // every real toolId belongs to exactly one intentType (the registry's
  // own 1:1 pairing).
  if (toolId !== undefined && intentType === undefined) {
    return false
  }

  // No intentType at all -- only the closed, fixture-audited set of
  // (interactionClass, domain) pairs above is a recognized intentless
  // combination (ALF-1B correction 1, item 3). Anything else -- e.g.
  // 'conversation' paired with an unrelated domain like 'tasks', or a
  // bare 'read'/'write' with no intentType at all -- is rejected here,
  // not left to the generic shared contract (which has no opinion on
  // domain/interactionClass coherence at all).
  if (intentType === undefined) {
    return isAllowedIntentlessCombination(interactionClass, domain)
  }

  const expected = ROUTING_INTENT_SEMANTICS[intentType]
  if (!expected) {
    // Unrecognized intentType -- not this gate's job to say why (the
    // vocabulary allowlist already rejects this for Shadow output); a
    // caller that reaches this function without already checking the
    // allowlist (e.g. live-routing-comparison.ts re-validating raw ledger
    // data) still gets a safe, closed-world answer: unknown is never
    // consistent.
    return false
  }

  if (domain !== expected.domain) return false
  if (interactionClass !== expected.interactionClass) return false

  if (expected.toolId !== undefined) {
    // Write intent: a PRESENT toolId must match exactly. An OMITTED
    // toolId is not itself treated as inconsistent here -- completeness
    // (whether a write intent SHOULD have supplied a toolId) is the
    // optional-field comparison's own concern, not a semantic
    // impossibility this gate exists to catch.
    if (toolId !== undefined && toolId !== expected.toolId) return false
  } else if (toolId !== undefined) {
    // Non-write intent: a toolId is never legitimate at all.
    return false
  }

  return true
}
