// ALF-1A (ADR-0021): the minimal routing-only shadow prompt and its
// output parser. Section 6's exact requirements: ask for exactly the
// ALF-0 IntentRoutingLearningPayloadV1 contract, no prose, no
// chain-of-thought, no tool execution, no credentials, no database
// context. Deterministic/bounded generation (temperature 0, small bounded
// max output tokens) is the CALLER's responsibility (the provider
// adapter) -- this module only builds the instruction text and parses the
// result.

import {
  collectIntentRoutingLearningPayloadErrors,
  type IntentRoutingLearningPayloadV1,
} from '../../../shared/aiLearning'
import { isAllowedShadowIntentType, isAllowedShadowToolId } from './shadow-vocabulary'

// Bounded on purpose (matches "small bounded max output tokens" -- see
// the Workers AI adapter's own use of this).
export const SHADOW_ROUTING_MAX_OUTPUT_TOKENS = 200
export const SHADOW_ROUTING_TEMPERATURE = 0

// No prose, no chain-of-thought, no tool execution, no credentials, no
// database context -- literally nothing beyond "here is the exact JSON
// shape, output only that." Field descriptions are the shared contract's
// own enum values, not narrative explanation.
export const SHADOW_ROUTING_SYSTEM_PROMPT = `You are a routing classifier for a personal assistant app. Given exactly one user message, output ONLY a single JSON object with this exact shape and nothing else -- no explanation, no markdown code fences, no extra text before or after the JSON:

{
  "schemaVersion": "intent-routing-v1",
  "language": "en" | "de" | "fa" | "unknown",
  "interactionClass": "conversation" | "read" | "write" | "clarification",
  "domain": "tasks" | "calendar" | "finance" | "github" | "workspace" | "learning" | "memory" | "documents" | "none" | "unknown",
  "intentType": "<omit this key if not applicable>",
  "toolId": "<omit this key if not applicable>",
  "requiresClarification": true | false,
  "requiresApproval": true | false
}

Rules:
- Output ONLY the JSON object. No prose, no reasoning, no code fences.
- Do not call any tool. Do not attempt to execute any action.
- "domain": "tasks" or "calendar" for a write only when the message clearly asks to create/update a task or calendar event; a concrete clock time on an otherwise task-shaped write means domain "calendar".
- A message that only asks a question or reads existing information is "interactionClass": "read", never "write".
- Ordinary conversation with no actionable request is "interactionClass": "conversation", "domain": "none".
- If the request is genuinely ambiguous between two domains, use "interactionClass": "clarification", "domain": "unknown", "requiresClarification": true.`

export function buildShadowRoutingUserTurn(message: string): string {
  return message
}

export type ShadowRoutingOutputParseFailureReason = 'not_valid_json' | 'schema_invalid'

export type ShadowRoutingOutputParseResult =
  | { ok: true; payload: IntentRoutingLearningPayloadV1 }
  | { ok: false; reason: ShadowRoutingOutputParseFailureReason }

// Strips a leading/trailing markdown code fence (```json ... ``` or
// ``` ... ```) if the model added one despite the system prompt's explicit
// instruction not to -- models frequently do this regardless of
// instruction, so this is a defensive normalization step, not a
// contradiction of "no markdown fences" (that rule constrains the PROMPT,
// this function tolerates the model anyway).
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenceMatch ? fenceMatch[1].trim() : trimmed
}

// Never throws. Parses raw model output text and runs it through the
// SAME canonical shared ALF-0 validator every other event in this codebase
// uses (shared/aiLearning.ts's collectIntentRoutingLearningPayloadErrors)
// -- there is no separate, weaker acceptance rule for shadow output's
// STRUCTURE. A SECOND, Shadow-only gate follows (ALF-1A correction round
// 2, item 1): intentType/toolId are freeform at the generic contract
// level, which is not safe enough for a model that has just seen the raw
// user message -- see shadow-vocabulary.ts's own header comment for why
// this lives here, as an allowlist, rather than loosely trusting any
// non-empty string the model returns.
export function parseShadowRoutingOutput(rawText: string): ShadowRoutingOutputParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(rawText))
  } catch {
    return { ok: false, reason: 'not_valid_json' }
  }
  const errors = collectIntentRoutingLearningPayloadErrors(parsed)
  if (errors.length > 0) return { ok: false, reason: 'schema_invalid' }
  const payload = parsed as IntentRoutingLearningPayloadV1
  if (payload.intentType !== undefined && !isAllowedShadowIntentType(payload.intentType)) {
    return { ok: false, reason: 'schema_invalid' }
  }
  if (payload.toolId !== undefined && !isAllowedShadowToolId(payload.toolId)) {
    return { ok: false, reason: 'schema_invalid' }
  }
  return { ok: true, payload }
}
