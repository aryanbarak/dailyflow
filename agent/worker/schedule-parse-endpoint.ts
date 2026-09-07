// CORE-W5 (2026-09-06, CORE audit item ۱-۴): natural-language scheduling
// -> a real RFC 5545 RRULE.
//
// POST /schedule/parse takes a short free-text phrase (e.g. "every Monday
// at 9am", "tomorrow at 3pm") plus the client's current time/timezone and
// returns a structured classification: recurring (an RRULE string),
// one_time (a resolved ISO datetime), or none (no scheduling text at
// all). Quick preset chips (both one-time and recurring) are computed
// entirely client-side (src/features/scheduling/scheduleQuickPicks.ts)
// and never reach this endpoint -- only genuine free text does.
//
// Auth follows journal-assistant-endpoint.ts's pattern exactly (a valid
// Supabase bearer token; module-local authenticateUser copy, per this
// codebase's convention). Because the output is JSON-shaped rather than
// free prose, generation follows personal-memory-extraction-endpoint.ts's
// stronger convention instead: structured generation against a hand-
// authored schema, a finishReason check, and parseModelJsonObject --
// with one validation layer beyond even that: the model's own RRULE
// string is re-parsed with the real `rrule` library server-side before
// ever being returned, so a syntactically broken rule is rejected here
// rather than silently handed to the client (CORE's own equivalent
// endpoint trusts JSON.parse output with no such check at all).

import { RRule } from 'rrule'
import type { Env } from './types'
import { createProviders } from './providers/createProviders'
import { ProviderRequestError, ProviderUnavailableError } from './provider-errors'
import { parseModelJsonObject, ModelJsonParseError } from './modelJsonParsing'
import type { NeutralObjectSchema } from './providers/schema/neutralSchema'

const ROUTE_PATH = '/schedule/parse'

export const SCHEDULE_TEXT_MAX_CHARS = 200
const LABEL_MAX_CHARS = 100
const MAX_OUTPUT_TOKENS = 512

type Granularity = 'date' | 'datetime'
type Lang = 'en' | 'de' | 'fa'
const LANGS = new Set<Lang>(['en', 'de', 'fa'])

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function jsonResponse(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

function errorResponse(code: string, message: string, status: number, origin: string): Response {
  return jsonResponse({ error: { code, message } }, status, origin)
}

/** Own small copy, per module convention (see header). */
async function authenticateUser(
  request: Request,
  env: Env,
  fetcher: typeof fetch,
): Promise<{ userId: string } | null> {
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) return null
  const jwt = authorization.slice(7)
  const response = await fetcher(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY },
  })
  if (!response.ok) return null
  const user = (await response.json()) as { id?: unknown }
  if (typeof user.id !== 'string' || !user.id) return null
  return { userId: user.id }
}

interface ParsedRequest {
  text: string
  currentTime: string
  timeZone: string
  lang: Lang
  granularity: Granularity
}

export function parseScheduleParseBody(body: unknown): ParsedRequest | null {
  if (typeof body !== 'object' || body === null) return null
  const { text, currentTime, timeZone, lang, granularity } = body as Record<string, unknown>
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > SCHEDULE_TEXT_MAX_CHARS) return null
  if (typeof currentTime !== 'string' || Number.isNaN(Date.parse(currentTime))) return null
  if (typeof timeZone !== 'string' || timeZone.trim().length === 0) return null
  if (typeof lang !== 'string' || !LANGS.has(lang as Lang)) return null
  if (granularity !== 'date' && granularity !== 'datetime') return null
  return { text: text.trim(), currentTime, timeZone, lang: lang as Lang, granularity }
}

export interface ScheduleParseResult {
  kind: 'recurring' | 'one_time' | 'none'
  rrule?: string
  startTime?: string
  label: string
}

/** Hand-rolled, per-field -- never coerced, invalid shapes are dropped (matches personal-memory-extraction-endpoint.ts's convention). */
export function validateModelResult(raw: unknown): ScheduleParseResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { kind, rrule, startTime, label } = raw as Record<string, unknown>
  if (typeof label !== 'string' || label.length > LABEL_MAX_CHARS) return null
  const trimmedLabel = label.trim()

  if (kind === 'recurring') {
    if (trimmedLabel.length === 0) return null
    if (typeof rrule !== 'string' || rrule.trim().length === 0) return null
    return { kind: 'recurring', rrule: rrule.trim(), label: trimmedLabel }
  }
  if (kind === 'one_time') {
    if (trimmedLabel.length === 0) return null
    if (typeof startTime !== 'string' || Number.isNaN(Date.parse(startTime))) return null
    return { kind: 'one_time', startTime, label: trimmedLabel }
  }
  if (kind === 'none') {
    // "none" legitimately carries an empty label -- the system prompt asks
    // for exactly that when the text has no scheduling information.
    return { kind: 'none', label: trimmedLabel }
  }
  return null
}

export function buildScheduleParseSystemInstruction(granularity: Granularity): string {
  const timeConstraint =
    granularity === 'date'
      ? 'This schedule is for a task that only has a DATE, no time of day at all -- never include BYHOUR, BYMINUTE, or any specific clock time in the rrule or the label, even if the text mentions one.'
      : 'This schedule is for a calendar event that has both a date and a specific time.'
  return [
    'You parse a short natural-language scheduling phrase into a structured classification.',
    'Classify as "recurring" (repeats on a pattern -- "every Monday", "daily", "each weekday"), "one_time" (a single specific moment -- "tomorrow at 3pm", "next Friday", "in an hour"), or "none" (the text carries no scheduling information at all).',
    'For "recurring": produce a valid RFC 5545 RRULE string (just the property list, e.g. "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0" -- never include the "RRULE:" prefix or a DTSTART line).',
    'For "one_time": resolve the exact ISO 8601 datetime the text describes, relative to the given current time and timezone.',
    timeConstraint,
    'Always include a short label (max 10 words) describing the schedule for display, written in the requested language.',
    'If the text has no scheduling information, return kind "none" with an empty label.',
  ].join(' ')
}

function buildResponseSchema(): NeutralObjectSchema {
  return {
    type: 'object',
    required: ['kind', 'label'],
    properties: {
      kind: { type: 'string', enum: ['recurring', 'one_time', 'none'] },
      rrule: { type: 'string' },
      startTime: { type: 'string' },
      label: { type: 'string' },
    },
  }
}

export interface ScheduleParseDependencies {
  fetcher: typeof fetch
  logger: Pick<Console, 'info' | 'error'>
}

export async function handleScheduleParseRequest(
  request: Request,
  env: Env,
  dependencies: Partial<ScheduleParseDependencies> = {},
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== ROUTE_PATH) return null

  const origin = request.headers.get('Origin') ?? ''
  const fetcher = dependencies.fetcher ?? fetch
  const logger = dependencies.logger ?? console

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported.', 405, origin)
  }

  const auth = await authenticateUser(request, env, fetcher)
  if (!auth) {
    return errorResponse('UNAUTHORIZED', 'A valid session is required.', 401, origin)
  }

  let parsed: ParsedRequest | null = null
  try {
    parsed = parseScheduleParseBody(await request.json())
  } catch {
    parsed = null
  }
  if (!parsed) {
    return errorResponse('INVALID_REQUEST', 'text, currentTime, timeZone, lang, and granularity are required.', 400, origin)
  }

  let result: ScheduleParseResult
  try {
    const generated = await createProviders(env, fetcher).structured.generateStructured({
      system: buildScheduleParseSystemInstruction(parsed.granularity),
      turns: [
        {
          role: 'user',
          content: `Current time: ${parsed.currentTime} (timezone: ${parsed.timeZone})\nRespond in this language: ${parsed.lang}\n\nText to parse:\n${parsed.text}`,
        },
      ],
      schema: buildResponseSchema(),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.1,
    })

    if (generated.finishReason !== 'stop') {
      return errorResponse('MODEL_OUTPUT_UNUSABLE', 'The model did not return a usable result. Please try again.', 502, origin)
    }

    const candidate = validateModelResult(parseModelJsonObject(generated.rawText))
    if (!candidate) {
      return errorResponse('MODEL_OUTPUT_UNUSABLE', 'The model did not return a usable result. Please try again.', 502, origin)
    }
    result = candidate
  } catch (error) {
    if (error instanceof ModelJsonParseError) {
      return errorResponse('MODEL_OUTPUT_UNUSABLE', 'The model did not return a usable result. Please try again.', 502, origin)
    }
    if (error instanceof ProviderUnavailableError) {
      return errorResponse('PROVIDER_UNAVAILABLE', 'The AI model is temporarily unavailable. Please try again in a moment.', 503, origin)
    }
    if (error instanceof ProviderRequestError) {
      return errorResponse('PROVIDER_REQUEST_REJECTED', 'The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your text.', 502, origin)
    }
    logger.error?.(`[ScheduleParse] model call failed: ${(error as Error).message}`)
    return errorResponse('REQUEST_FAILED', 'Something went wrong while parsing the schedule.', 500, origin)
  }

  // One more validation layer beyond personal-memory-extraction's own
  // convention: re-parse the model's OWN rrule string with the real
  // library before ever trusting it downstream. CORE's equivalent server
  // code trusts JSON.parse output blindly with no such check.
  if (result.kind === 'recurring') {
    try {
      RRule.fromString(result.rrule as string)
    } catch {
      return errorResponse('MODEL_OUTPUT_UNUSABLE', 'The model produced an invalid recurrence rule. Please try rephrasing.', 502, origin)
    }
  }

  return jsonResponse({ result }, 200, origin)
}
