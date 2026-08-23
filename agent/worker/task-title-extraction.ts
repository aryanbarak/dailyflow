// SmartFlow -- Task 21-fix6: title as a first-class model field.
//
// Production evidence showed the chat auto-write path deriving task
// titles purely by regex pattern-matching on the raw message (see
// flow-write-policy.ts's extractTaskTitle), and every attempt to patch a
// new leaked phrasing just broke on the next one. This module asks the
// model directly for a short subject line instead -- mirroring the
// prompt/schema/system-instruction builder pattern already used by
// personal-memory-extraction-endpoint.ts and context-derivation-
// endpoint.ts (and exercised the same way by scripts/provider-contract-
// smoke.ts).
//
// flow-write-policy.ts's resolveCreateTaskTitle is what actually decides
// whether to trust this model's output -- this module only asks the
// question and returns whatever the model said, unvalidated.
//
// INC-01 / ADR-0018 S2: the call goes through
// createProviders(env).structured (GeminiStructuredGenerationProvider),
// which wraps provider-errors.ts's fetchGeminiOrThrow internally -- a
// 429/5xx/network failure still throws the classifiable
// ProviderUnavailableError instead of an indistinguishable plain Error,
// see that module's own header comment for why resolveCreateTaskTitle
// needs to tell those apart.

import { createProviders } from './providers/createProviders'
import type { NeutralObjectSchema } from './providers/schema/neutralSchema'

export function buildTaskTitleSystemInstruction(): string {
  return [
    'Return exactly one JSON object with a single field "title" and no prose -- no markdown code fences, no explanation before or after the object.',
    'The title must be a SHORT subject line for a to-do task -- a few words naming WHAT the task is about, never a restatement of the user\'s full sentence.',
    'Strip greetings, command phrasing ("create a task", "add a todo", "erstelle eine Aufgabe", "بساز", "ایجاد کن"), and any date or time mentioned -- those are handled separately and must not appear in the title.',
    'Write the title in the same language the user wrote their request in -- do not translate it.',
    'If the request genuinely has no identifiable subject beyond the command itself, return an empty string for "title" rather than guessing.',
  ].join(' ')
}

export function buildTaskTitlePrompt(requestText: string): string {
  return `User's task request:\n\n${requestText}`
}

// ADR-0018 S2 Phase B: emits the neutral schema subset now, not Gemini's
// dialect -- see providers/schema/neutralSchema.ts's own header comment.
export function buildTaskTitleResponseSchema(): NeutralObjectSchema {
  return {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
    },
  }
}

// ADR-0018 S2: widened to satisfy GeminiProviderEnv (ProviderFailureEnv's
// SUPABASE_URL/SUPABASE_SERVICE_KEY, for the adapter's own Decision 6
// failure-event persistence) -- every real caller passes the full worker
// `Env`, which already has both.
export interface TaskTitleEnv {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
}

// MIG-01b: 128 -> 2048. This is the "simplest real schema" case probed by
// scripts/gemini-36-probe.ts's P5 (buildTaskTitleResponseSchema) -- the
// schema dialect itself was confirmed unchanged (200 on gemini-3.6-flash),
// but thinking now consumes output budget, so 128 is no longer enough
// headroom even for a one-field response.
const MAX_OUTPUT_TOKENS_TASK_TITLE = 2048

/**
 * Makes exactly one schema-enforced model call and returns the raw
 * "title" string it produced -- unvalidated. Throws on any failure
 * (network, non-STOP finish, malformed JSON, missing field); the caller
 * (flow-write-policy.ts's resolveCreateTaskTitle) is responsible for
 * catching that and falling back to pattern extraction.
 */
export async function callGeminiForTaskTitle(
  requestText: string,
  env: TaskTitleEnv,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  // ADR-0018 S2: migrated to the StructuredGenerationProvider adapter.
  // Two narrow, deliberate, UNTESTED normalizations from routing through
  // the adapter's neutral finishReason mapping (no existing fixture --
  // here or in flow-write-policy.test.ts/index.test.ts's own
  // taskTitleResult mock -- ever omits finishReason or omits the
  // candidate entirely; every real Gemini response includes both when a
  // candidate is returned):
  //   1. A response with NO candidate at all now produces the SAME error
  //      message as a present-but-not-STOP candidate ("did not finish
  //      safely (finishReason=other)") -- the adapter's own
  //      mapFinishReason collapses "no candidate" into 'other', so the two
  //      cases are no longer distinguished by message text. Both still
  //      throw, which is all resolveCreateTaskTitle's catch cares about.
  //   2. A candidate with finishReason OMITTED (not simply absent-because-
  //      no-candidate, but present with no finishReason field) used to be
  //      treated as acceptable by this function's own check
  //      (`!== undefined && !== 'STOP'`); the adapter maps a missing
  //      finishReason to 'other', which this function now treats as
  //      unsafe. Stricter, not looser -- and not reachable by any real
  //      Gemini response, which always sets finishReason on a returned
  //      candidate.
  const result = await createProviders(env, fetcher).structured.generateStructured({
    system: buildTaskTitleSystemInstruction(),
    turns: [{ role: 'user', content: buildTaskTitlePrompt(requestText) }],
    schema: buildTaskTitleResponseSchema(),
    maxOutputTokens: MAX_OUTPUT_TOKENS_TASK_TITLE,
    temperature: 0,
  })

  if (result.finishReason !== 'stop') {
    throw new Error(`Task title model response did not finish safely (finishReason=${result.finishReason}).`)
  }
  const text = result.rawText
  if (!text.trim()) throw new Error('Task title model returned no content.')

  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch (parseError) {
    throw new Error(`Task title model response was not valid JSON (${(parseError as Error).message}).`)
  }
  const title = (parsed as { title?: unknown })?.title
  if (typeof title !== 'string') throw new Error('Task title model response missing a title field.')
  return title
}
