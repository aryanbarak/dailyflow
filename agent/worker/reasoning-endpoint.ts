import { WRITE_INTENT_TARGET_FIELD_NAMES, writeIntentRegistry } from '../../shared/writeIntentRegistry'

const LOCAL_WORKER_MODE = 'local-qa'
const MAX_BODY_BYTES = 32 * 1024
const MAX_PROMPT_LENGTH = 24_000
const MAX_REQUEST_ID_LENGTH = 128
const MAX_SHORT_TEXT_LENGTH = 240

export const RESPONSE_LANGUAGES = new Set(['auto', 'en', 'de', 'fa'])
const PROPOSAL_LANGUAGES = ['en', 'de', 'fa'] as const
// Task 23: the four write-domain values (create_task/update_task/
// create_calendar_event/update_calendar_event) are spliced in from the
// shared registry, in its own array order, reproducing the exact position
// and sequence the pre-refactor literal list had (between complete_task and
// write_github_issue_comment) -- required for provider-contract-smoke's
// byte-identical schema check. Every other value here is a read intent,
// GitHub write, or terminal state that isn't part of this task's scope
// (tasks + calendar only) and stays a plain literal.
export const SUPPORTED_INTENT_VALUES = [
  'inspect_tasks',
  'inspect_calendar',
  'inspect_learning',
  'inspect_workspace',
  'inspect_github_repositories',
  'inspect_github_issues',
  'inspect_github_epics',
  'inspect_github_pull_requests',
  'inspect_github_workflow_runs',
  'complete_task',
  ...writeIntentRegistry.map((entry) => entry.intentType),
  'write_github_issue_comment',
  'write_github_issue_update',
  'ask_clarification',
  'unsupported',
] as const
const SUPPORTED_CONFIDENCE_VALUES = ['low', 'medium', 'high'] as const
const SUPPORTED_DOMAIN_VALUES = ['tasks', 'calendar', 'learning', 'workspace', 'github'] as const
const SUPPORTED_INTENTS = new Set<string>(SUPPORTED_INTENT_VALUES)
const SUPPORTED_CONFIDENCE = new Set<string>(SUPPORTED_CONFIDENCE_VALUES)
const SUPPORTED_DOMAINS = new Set<string>(SUPPORTED_DOMAIN_VALUES)
const REQUEST_FIELDS = new Set(['requestId', 'reasoningPrompt', 'responseLanguage'])
const PROPOSAL_FIELDS = new Set([
  'type',
  'confidence',
  'requestedDomain',
  'target',
  'clarificationQuestion',
  'reasons',
  'language',
  'candidates',
])
const TARGET_FIELDS = new Set([
  // Task 23: task + calendar field names come from the shared registry, in
  // its domain-grouped order (see WRITE_INTENT_TARGET_FIELD_NAMES's own
  // comment) -- reproduces the exact pre-refactor field list/order.
  ...WRITE_INTENT_TARGET_FIELD_NAMES,
  // EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
  'repo', 'issueNumber', 'commentBody', 'updateTitle', 'updateBody', 'updateLabels',
])
const MAX_UPDATE_LABELS = 20
const CANDIDATE_FIELDS = new Set(['type', 'reasons'])
// Defensive schema ceiling only -- distinct from the frontend validator's
// policy cap (3), which is what actually decides how many cards a user
// sees. This just stops normalizeProposal from doing unbounded work if
// Gemini returns something pathological; it is not the disambiguation limit.
const MAX_SCHEMA_CANDIDATES = 6

export interface LocalReasoningEnv {
  SMARTFLOW_WORKER_MODE?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

export interface LocalReasoningConfig {
  mode: typeof LOCAL_WORKER_MODE
  supabaseUrl: string
  supabaseAnonKey: string
  geminiApiKey?: string
  geminiModel?: string
}

export interface LocalReasoningDependencies {
  fetcher?: typeof fetch
  now?: () => number
  logger?: Pick<Console, 'info'>
}

interface ReasoningRequest {
  requestId: string
  reasoningPrompt: string
  responseLanguage: 'auto' | 'en' | 'de' | 'fa'
}

export type ReasoningResponseLanguage = ReasoningRequest['responseLanguage']

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response }

function jsonResponse(
  body: unknown,
  status: number,
  origin: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...localReasoningCorsHeaders(origin),
    },
  })
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  origin: string,
): Response {
  return jsonResponse({ error: { code, message } }, status, origin)
}

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const loopbackHost =
      url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '[::1]'

    return (
      url.protocol === 'http:' &&
      loopbackHost &&
      !url.username &&
      !url.password &&
      (url.pathname === '' || url.pathname === '/') &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

export function resolveLocalReasoningConfig(
  env: LocalReasoningEnv,
  options: { requireGemini?: boolean } = {},
): LocalReasoningConfig {
  if (env.SMARTFLOW_WORKER_MODE !== LOCAL_WORKER_MODE) {
    throw new Error('The local reasoning endpoint requires SMARTFLOW_WORKER_MODE=local-qa.')
  }

  const supabaseUrl = env.SUPABASE_URL?.trim() ?? ''
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim() ?? ''
  const geminiApiKey = env.GEMINI_API_KEY?.trim() ?? ''
  const geminiModel = env.GEMINI_MODEL?.trim() ?? ''

  if (!supabaseUrl) throw new Error('SUPABASE_URL is required in local-qa mode.')
  if (!isLoopbackUrl(supabaseUrl)) {
    throw new Error('SUPABASE_URL must be a credential-free loopback HTTP URL in local-qa mode.')
  }
  if (!supabaseAnonKey) throw new Error('SUPABASE_ANON_KEY is required in local-qa mode.')
  if (options.requireGemini && !geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required at the local model-call boundary.')
  }
  if (options.requireGemini && !geminiModel) {
    throw new Error('GEMINI_MODEL is required at the local model-call boundary.')
  }

  return {
    mode: LOCAL_WORKER_MODE,
    supabaseUrl,
    supabaseAnonKey,
    geminiApiKey: geminiApiKey || undefined,
    geminiModel: geminiModel || undefined,
  }
}

export function localReasoningCorsHeaders(origin: string): Record<string, string> {
  let allowedOrigin = ''
  try {
    const url = new URL(origin)
    if (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') &&
      !url.username &&
      !url.password
    ) {
      allowedOrigin = origin
    }
  } catch {
    allowedOrigin = ''
  }

  return {
    ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  }
}

async function validateRequest(
  request: Request,
  origin: string,
): Promise<ValidationResult<ReasoningRequest>> {
  const contentType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    return {
      ok: false,
      response: errorResponse('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.', 415, origin),
    }
  }

  const declaredLength = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse('REQUEST_TOO_LARGE', 'Reasoning request is too large.', 413, origin),
    }
  }

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse('REQUEST_TOO_LARGE', 'Reasoning request is too large.', 413, origin),
    }
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return {
      ok: false,
      response: errorResponse('INVALID_JSON', 'Request body must contain valid JSON.', 400, origin),
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: errorResponse('INVALID_REQUEST', 'Request body must be an object.', 400, origin),
    }
  }

  const record = body as Record<string, unknown>
  const unknownFields = Object.keys(record).filter((key) => !REQUEST_FIELDS.has(key))
  if (unknownFields.length > 0) {
    return {
      ok: false,
      response: errorResponse('UNKNOWN_FIELDS', 'Request contains unsupported fields.', 400, origin),
    }
  }

  const requestId = typeof record.requestId === 'string' ? record.requestId.trim() : ''
  const reasoningPrompt = typeof record.reasoningPrompt === 'string' ? record.reasoningPrompt.trim() : ''
  const responseLanguage = typeof record.responseLanguage === 'string'
    ? record.responseLanguage.trim()
    : ''

  if (
    !requestId ||
    requestId.length > MAX_REQUEST_ID_LENGTH ||
    !/^[A-Za-z0-9._:-]+$/.test(requestId)
  ) {
    return {
      ok: false,
      response: errorResponse('INVALID_REQUEST_ID', 'requestId is invalid.', 400, origin),
    }
  }
  if (!reasoningPrompt || reasoningPrompt.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      response: errorResponse('INVALID_REASONING_PROMPT', 'reasoningPrompt is missing or too large.', 400, origin),
    }
  }
  if (!RESPONSE_LANGUAGES.has(responseLanguage)) {
    return {
      ok: false,
      response: errorResponse('INVALID_RESPONSE_LANGUAGE', 'responseLanguage must be auto, en, de, or fa.', 400, origin),
    }
  }

  return {
    ok: true,
    value: {
      requestId,
      reasoningPrompt,
      responseLanguage: responseLanguage as ReasoningRequest['responseLanguage'],
    },
  }
}

function extractJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error('Model response must be exactly one JSON object.')
  }
  return JSON.parse(trimmed)
}

function boundedString(value: unknown, maxLength = MAX_SHORT_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim().slice(0, maxLength)
  return result || undefined
}

function boundedPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function boundedStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems)
  return items.length > 0 ? items : undefined
}

function normalizeProposal(raw: unknown, responseLanguage: ReasoningRequest['responseLanguage']) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Model proposal must be an object.')
  }

  const record = raw as Record<string, unknown>
  if (Object.keys(record).some((key) => !PROPOSAL_FIELDS.has(key))) {
    throw new Error('Model proposal contained unexpected fields.')
  }

  const type = boundedString(record.type, 48)
  const confidence = boundedString(record.confidence, 16)
  if (!type || !SUPPORTED_INTENTS.has(type)) throw new Error('Unsupported model intent.')
  if (!confidence || !SUPPORTED_CONFIDENCE.has(confidence)) throw new Error('Invalid model confidence.')

  const proposal: Record<string, unknown> = { type, confidence }
  const requestedDomain = boundedString(record.requestedDomain, 32)
  if (record.requestedDomain !== undefined && (!requestedDomain || !SUPPORTED_DOMAINS.has(requestedDomain))) {
    throw new Error('Invalid requested domain.')
  }
  if (requestedDomain) {
    proposal.requestedDomain = requestedDomain
  }

  if (record.target !== undefined) {
    if (!record.target || typeof record.target !== 'object' || Array.isArray(record.target)) {
      throw new Error('Invalid proposal target.')
    }
    const rawTarget = record.target as Record<string, unknown>
    if (Object.keys(rawTarget).some((key) => !TARGET_FIELDS.has(key))) {
      throw new Error('Model target contained unexpected fields.')
    }
    const target = {
      taskId: boundedString(rawTarget.taskId, 128),
      taskReference: boundedString(rawTarget.taskReference),
      taskTitleHint: boundedString(rawTarget.taskTitleHint),
      title: boundedString(rawTarget.title),
      notes: boundedString(rawTarget.notes, 2000),
      dueDate: boundedString(rawTarget.dueDate, 32),
      // Task 22 (calendar write slice).
      eventTitle: boundedString(rawTarget.eventTitle),
      eventReference: boundedString(rawTarget.eventReference),
      eventId: boundedString(rawTarget.eventId, 128),
      start: boundedString(rawTarget.start, 64),
      end: boundedString(rawTarget.end, 64),
      // EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
      repo: boundedString(rawTarget.repo, 200),
      issueNumber: boundedPositiveInteger(rawTarget.issueNumber),
      commentBody: boundedString(rawTarget.commentBody, 10_000),
      updateTitle: boundedString(rawTarget.updateTitle, 200),
      updateBody: boundedString(rawTarget.updateBody, 10_000),
      updateLabels: boundedStringArray(rawTarget.updateLabels, MAX_UPDATE_LABELS, 100),
    }
    if (Object.values(target).some((value) => value !== undefined)) proposal.target = target
  }

  const clarificationQuestion = boundedString(record.clarificationQuestion, 500)
  if (record.clarificationQuestion !== undefined && !clarificationQuestion) {
    throw new Error('Invalid clarification question.')
  }
  if (clarificationQuestion) proposal.clarificationQuestion = clarificationQuestion

  if (!Array.isArray(record.reasons) || record.reasons.length < 1 || record.reasons.length > 3) {
    throw new Error('Model proposal must contain one to three reasons.')
  }
  const reasons = record.reasons.map((reason) => boundedString(reason))
  if (reasons.some((reason) => !reason)) throw new Error('Invalid proposal reason.')
  proposal.reasons = reasons

  const modelLanguage = boundedString(record.language, 8)
  if (!modelLanguage || !PROPOSAL_LANGUAGES.includes(modelLanguage as typeof PROPOSAL_LANGUAGES[number])) {
    throw new Error('Invalid proposal language.')
  }
  if (responseLanguage !== 'auto') {
    proposal.language = responseLanguage
  } else {
    proposal.language = modelLanguage
  }

  // Disambiguation candidates are optional and only meaningful alongside
  // type "ask_clarification" -- the frontend validator is what actually
  // decides how many are shown (validate -> dedup -> cap); this only bounds
  // the raw shape so a malformed or oversized response fails closed here
  // rather than reaching that logic at all.
  if (record.candidates !== undefined) {
    if (!Array.isArray(record.candidates) || record.candidates.length === 0) {
      throw new Error('Model candidates must be a non-empty array.')
    }
    if (record.candidates.length > MAX_SCHEMA_CANDIDATES) {
      throw new Error('Model returned too many candidates.')
    }
    const candidates = record.candidates.map((rawCandidate) => {
      if (!rawCandidate || typeof rawCandidate !== 'object' || Array.isArray(rawCandidate)) {
        throw new Error('Model candidate must be an object.')
      }
      const candidateRecord = rawCandidate as Record<string, unknown>
      if (Object.keys(candidateRecord).some((key) => !CANDIDATE_FIELDS.has(key))) {
        throw new Error('Model candidate contained unexpected fields.')
      }
      const candidateType = boundedString(candidateRecord.type, 48)
      if (!candidateType || !SUPPORTED_INTENTS.has(candidateType)) {
        throw new Error('Unsupported candidate intent.')
      }
      if (
        !Array.isArray(candidateRecord.reasons) ||
        candidateRecord.reasons.length < 1 ||
        candidateRecord.reasons.length > 3
      ) {
        throw new Error('Model candidate must contain one to three reasons.')
      }
      const candidateReasons = candidateRecord.reasons.map((reason) => boundedString(reason))
      if (candidateReasons.some((reason) => !reason)) throw new Error('Invalid candidate reason.')
      return { type: candidateType, reasons: candidateReasons }
    })
    proposal.candidates = candidates
  }

  return proposal
}

function languageInstruction(language: ReasoningRequest['responseLanguage']): string {
  if (language === 'en') return 'Write user-facing clarification and reason fields in English.'
  if (language === 'de') return 'Write user-facing clarification and reason fields in German.'
  if (language === 'fa') return 'Write user-facing clarification and reason fields in Persian.'
  return 'Use the language of the latest user message for user-facing clarification and reason fields.'
}

async function authenticate(
  request: Request,
  config: LocalReasoningConfig,
  fetcher: typeof fetch,
): Promise<boolean> {
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) return false

  const authUrl = new URL('/auth/v1/user', config.supabaseUrl)
  const response = await fetcher(authUrl.toString(), {
    headers: {
      'Authorization': authorization,
      'apikey': config.supabaseAnonKey,
    },
  })
  if (!response.ok) return false

  const user = await response.json() as { id?: unknown }
  return typeof user.id === 'string' && user.id.length > 0
}

export function buildReasoningSystemInstruction(responseLanguage: ReasoningResponseLanguage): string {
  return [
    'Return exactly one JSON intent proposal and no prose.',
    'Use only the schema fields type, confidence, requestedDomain, target, clarificationQuestion, reasons, candidates, and language.',
    'The type field must use one supported SmartFlow intent from the supplied prompt.',
    'You never execute, approve, authorize, or claim completion of an action.',
    languageInstruction(responseLanguage),
  ].join(' ')
}

export function buildReasoningResponseSchema() {
  return {
    type: 'OBJECT',
    required: ['type', 'confidence', 'reasons', 'language'],
    properties: {
      type: { type: 'STRING', enum: [...SUPPORTED_INTENT_VALUES] },
      confidence: { type: 'STRING', enum: [...SUPPORTED_CONFIDENCE_VALUES] },
      requestedDomain: { type: 'STRING', enum: [...SUPPORTED_DOMAIN_VALUES] },
      target: {
        type: 'OBJECT',
        properties: {
          // Task 23: task + calendar target fields, in the shared
          // registry's domain-grouped order -- see
          // WRITE_INTENT_TARGET_FIELD_NAMES's own comment for why order
          // must be preserved exactly (provider-contract-smoke).
          ...Object.fromEntries(WRITE_INTENT_TARGET_FIELD_NAMES.map((name) => [name, { type: 'STRING' }])),
          // EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
          repo: { type: 'STRING' },
          issueNumber: { type: 'INTEGER' },
          commentBody: { type: 'STRING' },
          updateTitle: { type: 'STRING' },
          updateBody: { type: 'STRING' },
          updateLabels: { type: 'ARRAY', items: { type: 'STRING' } },
        },
      },
      clarificationQuestion: { type: 'STRING' },
      reasons: {
        type: 'ARRAY',
        minItems: 1,
        maxItems: 3,
        items: { type: 'STRING' },
      },
      // Optional. Only meaningful alongside type "ask_clarification" -- a
      // specific set of 2-3 candidate tools the model is torn between, each
      // independently re-validated by the frontend deterministic validator.
      // This is a disambiguation hint, never a trust path: it does not add
      // a toolId field, and the validator still derives each candidate's
      // actual tool from its own type via the same deterministic map used
      // for a single confident proposal.
      candidates: {
        type: 'ARRAY',
        minItems: 2,
        maxItems: 6,
        items: {
          type: 'OBJECT',
          required: ['type', 'reasons'],
          properties: {
            type: { type: 'STRING', enum: [...SUPPORTED_INTENT_VALUES] },
            reasons: {
              type: 'ARRAY',
              minItems: 1,
              maxItems: 3,
              items: { type: 'STRING' },
            },
          },
        },
      },
      language: { type: 'STRING', enum: [...PROPOSAL_LANGUAGES] },
    },
  }
}

async function callGeminiOnce(
  input: ReasoningRequest,
  config: LocalReasoningConfig,
  fetcher: typeof fetch,
): Promise<unknown> {
  const modelUrl = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel ?? '')}:generateContent`,
  )
  modelUrl.searchParams.set('key', config.geminiApiKey ?? '')

  const response = await fetcher(modelUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: buildReasoningSystemInstruction(input.responseLanguage) }],
      },
      contents: [{ role: 'user', parts: [{ text: input.reasoningPrompt }] }],
      generationConfig: {
        maxOutputTokens: 768,
        temperature: 0,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: buildReasoningResponseSchema(),
      },
    }),
  })

  if (!response.ok) throw new Error(`Model request failed with status ${response.status}.`)
  const data = await response.json() as {
    candidates?: Array<{
      finishReason?: unknown
      content?: { parts?: Array<{ text?: unknown }> }
    }>
  }
  const candidate = data.candidates?.[0]
  if (!candidate) throw new Error('Model returned no candidate.')
  if (candidate.finishReason !== undefined && candidate.finishReason !== 'STOP') {
    throw new Error('Model response did not finish safely.')
  }
  const text = candidate.content?.parts?.[0]?.text
  if (typeof text !== 'string' || !text.trim()) throw new Error('Model returned no proposal content.')
  return extractJsonObject(text)
}

export async function handleLocalReasoningRequest(
  request: Request,
  env: LocalReasoningEnv,
  dependencies: LocalReasoningDependencies = {},
): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: localReasoningCorsHeaders(origin) })
  }
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported.', 405, origin)
  }

  let config: LocalReasoningConfig
  try {
    config = resolveLocalReasoningConfig(env)
  } catch (error) {
    return errorResponse('LOCAL_CONFIGURATION_INVALID', (error as Error).message, 503, origin)
  }

  const fetcher = dependencies.fetcher ?? globalThis.fetch
  let authenticated = false
  try {
    authenticated = await authenticate(request, config, fetcher)
  } catch {
    authenticated = false
  }
  if (!authenticated) {
    return errorResponse('UNAUTHORIZED', 'A valid local Supabase bearer token is required.', 401, origin)
  }

  const validation = await validateRequest(request, origin)
  if (validation.ok === false) return validation.response

  try {
    config = resolveLocalReasoningConfig(env, { requireGemini: true })
  } catch (error) {
    return errorResponse('MODEL_CONFIGURATION_MISSING', (error as Error).message, 503, origin)
  }

  const startedAt = (dependencies.now ?? Date.now)()
  try {
    const rawProposal = await callGeminiOnce(validation.value, config, fetcher)
    const proposal = normalizeProposal(rawProposal, validation.value.responseLanguage)
    const durationMs = Math.max(0, (dependencies.now ?? Date.now)() - startedAt)
    dependencies.logger?.info(
      `[LocalReasoning] requestId=${validation.value.requestId} status=ok durationMs=${durationMs} outcome=${String(proposal.type)} responseLength=${JSON.stringify(proposal).length}`,
    )
    return jsonResponse({
      requestId: validation.value.requestId,
      proposal,
      responseLanguage: validation.value.responseLanguage,
    }, 200, origin)
  } catch {
    const durationMs = Math.max(0, (dependencies.now ?? Date.now)() - startedAt)
    dependencies.logger?.info(
      `[LocalReasoning] requestId=${validation.value.requestId} status=failed durationMs=${durationMs} outcome=invalid_model_response responseLength=0`,
    )
    return errorResponse('MODEL_RESPONSE_INVALID', 'The model did not return a safe structured proposal.', 502, origin)
  }
}
