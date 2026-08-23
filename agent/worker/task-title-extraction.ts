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
// INC-01: the fetch call is wrapped with provider-errors.ts's
// fetchGeminiOrThrow so a 429/5xx/network failure throws the classifiable
// ProviderUnavailableError instead of an indistinguishable plain Error --
// see that module's own header comment for why resolveCreateTaskTitle
// needs to tell those apart.

import { fetchGeminiOrThrow } from './provider-errors'

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

export function buildTaskTitleResponseSchema() {
  return {
    type: 'OBJECT',
    required: ['title'],
    properties: {
      title: { type: 'STRING' },
    },
  }
}

export interface TaskTitleEnv {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

const MAX_OUTPUT_TOKENS_TASK_TITLE = 128

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
  const modelUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL ?? '')}:generateContent`)
  modelUrl.searchParams.set('key', env.GEMINI_API_KEY ?? '')

  const response = await fetchGeminiOrThrow(fetcher, modelUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildTaskTitleSystemInstruction() }] },
      contents: [{ role: 'user', parts: [{ text: buildTaskTitlePrompt(requestText) }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS_TASK_TITLE,
        temperature: 0,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: buildTaskTitleResponseSchema(),
      },
    }),
  }, 'Task title model request')

  const data = await response.json() as {
    candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown }> } }>
  }
  const candidate = data.candidates?.[0]
  if (!candidate) throw new Error('Task title model returned no candidate.')
  if (candidate.finishReason !== undefined && candidate.finishReason !== 'STOP') {
    throw new Error(`Task title model response did not finish safely (finishReason=${String(candidate.finishReason)}).`)
  }
  const text = candidate.content?.parts?.[0]?.text
  if (typeof text !== 'string' || !text.trim()) throw new Error('Task title model returned no content.')

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
