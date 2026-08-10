import { describe, expect, it, vi } from 'vitest'
import { buildExtractionResponseSchema, handlePersonalMemoryExtractionRequest, normalizeCandidate, type PersonalMemoryExtractionEnv } from './personal-memory-extraction-endpoint'

const ORIGIN = 'https://smartflow.example'
const SUPABASE_URL = 'https://supabase.example.co'
const CHAT_ID = '22222222-2222-4222-8222-222222222222'
const BRIEFING_ID = '33333333-3333-4333-8333-333333333333'
const RUN_ID = '44444444-4444-4444-8444-444444444444'
const AUTHENTICATED_USER_ID = 'user-1'

// Task 10-fix regression guard: every column below is NOT NULL with no
// default/trigger on public.personal_memory_extraction_runs (see
// supabase/migrations/20260808000000_personal_memory_records.sql, table
// definition -- id has default gen_random_uuid() and is excluded;
// candidate_count/accepted_count/dropped_count default to 0 and are also
// excluded). Task 10-diag found the insert silently omitted user_id, which
// guarantees a Postgres not-null violation on every call in production. This
// list is checked against the ACTUAL body the endpoint sends on every
// baseFetcher-mediated runs-table insert below, so dropping any of these
// fields again fails the moment any existing test exercises that insert --
// not just a single dedicated test.
const REQUIRED_RUN_INSERT_FIELDS = ['user_id', 'model_identity', 'derivation_version', 'started_at'] as const

function assertRunInsertBodyIsComplete(body: unknown): void {
  const record = body as Record<string, unknown> | null
  const missing = REQUIRED_RUN_INSERT_FIELDS.filter((field) => record?.[field] === undefined || record?.[field] === null)
  if (missing.length > 0) {
    throw new Error(
      `personal_memory_extraction_runs insert is missing required NOT NULL field(s): ${missing.join(', ')}. ` +
        'See supabase/migrations/20260808000000_personal_memory_records.sql for the table definition.',
    )
  }
}

const validEnv: PersonalMemoryExtractionEnv = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: 'anon-key',
  GEMINI_API_KEY: 'gemini-key',
  GEMINI_MODEL: 'gemini-2.5-flash',
}

function request(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request('https://worker.example/personal-memory/extraction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token', Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function geminiModelResponse(candidates: Array<Record<string, unknown>>): Response {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ candidates }) }] } }],
    usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 30 },
  })
}

function baseFetcher(overrides: {
  chatMessages?: Array<Record<string, unknown>>
  briefings?: Array<Record<string, unknown>>
  documentChunks?: Array<Record<string, unknown>>
  geminiCandidates?: Array<Record<string, unknown>>
  onRpc?: (body: unknown) => void
} = {}) {
  const chatMessages = overrides.chatMessages ?? [{ id: CHAT_ID, content: 'I prefer async written updates over calls.' }]
  const briefings = overrides.briefings ?? [{ id: BRIEFING_ID, content: 'You are learning React Native this month.' }]
  const documentChunks = overrides.documentChunks ?? []
  const geminiCandidates =
    overrides.geminiCandidates ?? [
      {
        kind: 'preference',
        content: { summary: 'Prefers async written updates over calls' },
        confidence: 'medium',
        provenanceSourceKind: 'chat_turn',
        provenanceSourceRefIds: [CHAT_ID],
      },
    ]

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages?`)) return jsonResponse(chatMessages)
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_briefings?`)) return jsonResponse(briefings)
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/document_chunks?`)) return jsonResponse(documentChunks)
    if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
      assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
      return jsonResponse([{ id: RUN_ID }])
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') return new Response(null, { status: 204 })
    if (url.startsWith('https://generativelanguage.googleapis.com/')) return geminiModelResponse(geminiCandidates)
    if (url === `${SUPABASE_URL}/rest/v1/rpc/create_personal_memory_record`) {
      overrides.onRpc?.(init?.body ? JSON.parse(init.body as string) : null)
      return jsonResponse({ outcome: 'created', field: { id: 'record-1', status: 'proposed' } })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

describe('POST /personal-memory/extraction', () => {
  it('answers preflight without authentication', async () => {
    const response = await handlePersonalMemoryExtractionRequest(
      new Request('https://worker.example/personal-memory/extraction', { method: 'OPTIONS', headers: { Origin: ORIGIN } }),
      validEnv,
    )
    expect(response.status).toBe(204)
  })

  it('rejects non-POST methods', async () => {
    const response = await handlePersonalMemoryExtractionRequest(new Request('https://worker.example/personal-memory/extraction', { method: 'GET' }), validEnv)
    expect(response.status).toBe(405)
  })

  it('fails closed with 503 when configuration is missing, before any fetch happens', async () => {
    const fetcher = vi.fn()
    const response = await handlePersonalMemoryExtractionRequest(request(), { ...validEnv, GEMINI_API_KEY: undefined }, { fetcher })
    expect(response.status).toBe(503)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a missing or invalid bearer token with 401', async () => {
    const fetcher = vi.fn(async () => jsonResponse({}, 401))
    const response = await handlePersonalMemoryExtractionRequest(request({}, { Authorization: '' }), validEnv, { fetcher })
    expect(response.status).toBe(401)
  })

  it('rejects malformed JSON with 400', async () => {
    const badRequest = new Request('https://worker.example/personal-memory/extraction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token' },
      body: '{not json',
    })
    const response = await handlePersonalMemoryExtractionRequest(badRequest, validEnv, { fetcher: baseFetcher() })
    expect(response.status).toBe(400)
  })

  it('returns 422 when the user has no chat messages and no briefing (zero source material)', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages?`)) return jsonResponse([])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_briefings?`)) return jsonResponse([])
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(422)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NO_SOURCE_MATERIAL')
  })

  it('returns 502 when the model call fails, and marks the run failed with a bounded diagnostic reason (task 12: was the static string "MODEL_CALL_FAILED"; now the actual, bounded error detail, so the run record itself is diagnosable without a live wrangler tail session)', async () => {
    const patchCalls: unknown[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages?`)) return jsonResponse([{ id: CHAT_ID, content: 'hello' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_briefings?`)) return jsonResponse([])
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
        assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
        return jsonResponse([{ id: RUN_ID }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') {
        patchCalls.push(init.body ? JSON.parse(init.body as string) : null)
        return new Response(null, { status: 204 })
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) return jsonResponse({}, 500)
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(502)
    expect(patchCalls).toEqual([{ completed_at: expect.any(String), outcome: 'failed', failure_reason: 'Model request failed with status 500.' }])
  })

  it('task 12 fix: sends thinkingConfig: { thinkingBudget: 0 } on every Gemini call -- locks in the actual production fix (gemini-2.5-flash spends output tokens on internal thinking by default, which can exhaust maxOutputTokens before any JSON is emitted) at the wire level, not just via behavior', async () => {
    let sentBody: { generationConfig?: { thinkingConfig?: unknown } } | null = null
    const inner = baseFetcher()
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        sentBody = init?.body ? JSON.parse(init.body as string) : null
      }
      return inner(input, init)
    })
    await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(sentBody?.generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 0 })
  })

  it('task 12 fixture: a realistic Gemini response with Persian-language free-text content is accepted -- language of the summary is not itself a rejection reason', async () => {
    const fetcher = baseFetcher({
      geminiCandidates: [
        {
          kind: 'goal',
          content: {
            summary: 'می‌خواهد برای آزمون IHK آماده شود و به عنوان توسعه‌دهنده جونیور جاوا استخدام شود',
            timeframe: 'short_term',
          },
          confidence: 'medium',
          provenanceSourceKind: 'chat_turn',
          provenanceSourceRefIds: [CHAT_ID],
        },
      ],
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { acceptedCount: number; droppedCount: number }
    expect(body.acceptedCount).toBe(1)
    expect(body.droppedCount).toBe(0)
  })

  it('task 12 fixture: a Gemini response wrapped in a markdown ```json fence is still parsed (defensive hardening -- responseMimeType should prevent this, but is not solely relied upon)', async () => {
    const extractionPayload = JSON.stringify({
      candidates: [
        {
          kind: 'preference',
          content: { summary: 'Prefers async written updates over calls' },
          confidence: 'medium',
          provenanceSourceKind: 'chat_turn',
          provenanceSourceRefIds: [CHAT_ID],
        },
      ],
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages?`)) return jsonResponse([{ id: CHAT_ID, content: 'I prefer async updates.' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_briefings?`)) return jsonResponse([])
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
        assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
        return jsonResponse([{ id: RUN_ID }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') return new Response(null, { status: 204 })
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        return jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '```json\n' + extractionPayload + '\n```' }] } }] })
      }
      if (url === `${SUPABASE_URL}/rest/v1/rpc/create_personal_memory_record`) return jsonResponse({ outcome: 'created', field: { id: 'record-1', status: 'proposed' } })
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { acceptedCount: number }
    expect(body.acceptedCount).toBe(1)
  })

  it('task 12: a well-formed Gemini response with zero candidates is a calm success, never the MODEL_CALL_FAILED error -- this was already correct before this task, verified here explicitly', async () => {
    const fetcher = baseFetcher({ geminiCandidates: [] })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { candidateCount: number; acceptedCount: number; droppedCount: number }
    expect(body.candidateCount).toBe(0)
    expect(body.acceptedCount).toBe(0)
    expect(body.droppedCount).toBe(0)
  })

  it('task 12 fixture: garbage (non-JSON prose) model output produces a typed 502 failure whose persisted failure_reason includes the actual raw-output snippet, not a generic label', async () => {
    const patchCalls: unknown[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages?`)) return jsonResponse([{ id: CHAT_ID, content: 'hello' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_briefings?`)) return jsonResponse([])
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
        assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
        return jsonResponse([{ id: RUN_ID }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') {
        patchCalls.push(init.body ? JSON.parse(init.body as string) : null)
        return new Response(null, { status: 204 })
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        return jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Sorry, I cannot help with that request.' }] } }] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: { code: string } }
    // Task 14: a 2xx response whose output fails validation is
    // MODEL_OUTPUT_UNUSABLE, not the old generic MODEL_CALL_FAILED --
    // the model WAS successfully asked here, its output just wasn't usable.
    expect(body.error.code).toBe('MODEL_OUTPUT_UNUSABLE')
    expect(patchCalls).toHaveLength(1)
    const patch = patchCalls[0] as { failure_reason: string }
    expect(patch.failure_reason).toMatch(/exactly one JSON object/i)
    expect(patch.failure_reason).toMatch(/Sorry, I cannot help/i)
  })

  it('task 12 fixture: a MAX_TOKENS-truncated response is reported with that specific finishReason -- this is the diagnosed production bug\'s exact signature (thinking tokens exhausting the budget before any JSON is emitted)', async () => {
    const patchCalls: unknown[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages?`)) return jsonResponse([{ id: CHAT_ID, content: 'hello' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_briefings?`)) return jsonResponse([])
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
        assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
        return jsonResponse([{ id: RUN_ID }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') {
        patchCalls.push(init.body ? JSON.parse(init.body as string) : null)
        return new Response(null, { status: 204 })
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        return jsonResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"candidates":[{"kind":"pref' }] } }] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(502)
    const patch = patchCalls[0] as { failure_reason: string }
    expect(patch.failure_reason).toMatch(/did not finish safely/i)
    expect(patch.failure_reason).toMatch(/MAX_TOKENS/)
  })

  it('task 14 fix: buildExtractionResponseSchema never sets maxItems on the outer candidates array -- regression lock for the actual production 400 root cause (reproduced against the real provider outside this test suite, see task 14 report: this exact bound, nested with an already-bounded inner array, is what the provider rejects as "too many states for serving")', () => {
    const schema = buildExtractionResponseSchema() as { properties: { candidates: { maxItems?: number; items: { properties: { provenanceSourceRefIds: { minItems?: number; maxItems?: number } } } } } }
    expect(schema.properties.candidates.maxItems).toBeUndefined()
    // The inner array's own bounds are unaffected -- bisection confirmed
    // ONLY the outer bound is the problem, not this one.
    expect(schema.properties.candidates.items.properties.provenanceSourceRefIds.minItems).toBe(1)
    expect(schema.properties.candidates.items.properties.provenanceSourceRefIds.maxItems).toBe(20)
  })

  it('task 14 fix: MAX_CANDIDATES_PER_RUN is still enforced in code even though the schema no longer bounds it -- more than 12 raw candidates are capped, not passed through', async () => {
    const manyCandidates = Array.from({ length: 15 }, (_, i) => ({
      kind: 'preference',
      content: { summary: `Preference number ${i}` },
      confidence: 'medium',
      provenanceSourceKind: 'chat_turn',
      provenanceSourceRefIds: [CHAT_ID],
    }))
    const fetcher = baseFetcher({ geminiCandidates: manyCandidates })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { candidateCount: number; acceptedCount: number }
    expect(body.candidateCount).toBe(12)
    expect(body.acceptedCount).toBe(12)
  })

  it('task 14 fix: a provider 4xx response is reported as PROVIDER_REQUEST_REJECTED with the provider\'s own (truncated) detail in the response body -- this endpoint is owner-only (authenticateUser requires a valid bearer token), so exposing it here is safe', async () => {
    const patchCalls: unknown[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages?`)) return jsonResponse([{ id: CHAT_ID, content: 'hello' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_briefings?`)) return jsonResponse([])
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
        assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
        return jsonResponse([{ id: RUN_ID }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') {
        patchCalls.push(init.body ? JSON.parse(init.body as string) : null)
        return new Response(null, { status: 204 })
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        return jsonResponse(
          { error: { code: 400, message: 'The specified schema produces a constraint that has too many states for serving.', status: 'INVALID_ARGUMENT' } },
          400,
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: { code: string; providerStatus?: number; providerDetail?: string } }
    expect(body.error.code).toBe('PROVIDER_REQUEST_REJECTED')
    expect(body.error.providerStatus).toBe(400)
    expect(body.error.providerDetail).toMatch(/too many states for serving/i)
    const patch = patchCalls[0] as { failure_reason: string }
    expect(patch.failure_reason).toMatch(/Model request failed with status 400/)
  })

  it('task 14 fix: a provider 5xx response is reported as PROVIDER_UNAVAILABLE, distinct from a 4xx rejection', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages?`)) return jsonResponse([{ id: CHAT_ID, content: 'hello' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_briefings?`)) return jsonResponse([])
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
        assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
        return jsonResponse([{ id: RUN_ID }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') return new Response(null, { status: 204 })
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        return jsonResponse({ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }, 503)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: { code: string; providerStatus?: number } }
    expect(body.error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(body.error.providerStatus).toBe(503)
  })

  it('task 14 fix: REDACTION GUARD -- the provider API key and the full request URL/query-string never appear in any logged output, on a provider-rejected request', async () => {
    const logged: string[] = []
    const fakeLogger = { info: (..._args: unknown[]) => {}, error: (...args: unknown[]) => { logged.push(args.map(String).join(' ')) } }
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages?`)) return jsonResponse([{ id: CHAT_ID, content: 'hello' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_briefings?`)) return jsonResponse([])
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
        assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
        return jsonResponse([{ id: RUN_ID }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') return new Response(null, { status: 204 })
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        // Sanity check on the fixture itself: the key IS present in the
        // request URL the endpoint actually calls (validEnv.GEMINI_API_KEY
        // below) -- proving the redaction guard is about LOGGING, not about
        // the key being absent from the real request.
        expect(url).toContain('key=gemini-key')
        return jsonResponse({ error: { code: 400, message: 'The specified schema produces a constraint that has too many states for serving.', status: 'INVALID_ARGUMENT' } }, 400)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher, logger: fakeLogger })
    expect(response.status).toBe(502)
    expect(logged.length).toBeGreaterThan(0)
    const fullLog = logged.join('\n')
    expect(fullLog).not.toContain('gemini-key')
    expect(fullLog).not.toContain('key=')
    expect(fullLog).not.toContain('generateContent?')
    // The path itself (no query string) IS expected to be logged -- that's
    // the whole point of "log the path only".
    expect(fullLog).toContain('generateContent')
  })

  it('persists a valid candidate and reports acceptedCount=1', async () => {
    const rpcBodies: unknown[] = []
    const fetcher = baseFetcher({ onRpc: (body) => rpcBodies.push(body) })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { acceptedCount: number; droppedCount: number }
    expect(body.acceptedCount).toBe(1)
    expect(body.droppedCount).toBe(0)
    expect(rpcBodies).toEqual([
      expect.objectContaining({
        p_run_id: RUN_ID,
        p_kind: 'preference',
        p_provenance_source_kind: 'chat_turn',
        p_provenance_source_ref_ids: [CHAT_ID],
      }),
    ])
  })

  it('drops a candidate whose provenanceSourceRefIds cite an unknown id', async () => {
    const fetcher = baseFetcher({
      geminiCandidates: [
        { kind: 'preference', content: { summary: 'Fabricated fact' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: ['99999999-9999-4999-8999-999999999999'] },
      ],
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    const body = (await response.json()) as { acceptedCount: number; droppedCount: number }
    expect(body.acceptedCount).toBe(0)
    expect(body.droppedCount).toBe(1)
  })

  it('drops a candidate whose cited id belongs to a different provenanceSourceKind than claimed', async () => {
    const fetcher = baseFetcher({
      geminiCandidates: [
        // CHAT_ID is a chat_turn id, but this candidate claims 'briefing'.
        { kind: 'preference', content: { summary: 'Mismatched provenance kind' }, confidence: 'high', provenanceSourceKind: 'briefing', provenanceSourceRefIds: [CHAT_ID] },
      ],
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    const body = (await response.json()) as { acceptedCount: number; droppedCount: number }
    expect(body.acceptedCount).toBe(0)
    expect(body.droppedCount).toBe(1)
  })

  it('drops sensitive-category candidates (health/relationships/emotional-state) even when the model returns them, regardless of kind', async () => {
    const fetcher = baseFetcher({
      geminiCandidates: [
        { kind: 'personal_fact', content: { summary: 'Diagnosed with anxiety last year' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
        { kind: 'personal_fact', content: { summary: 'Has two kids in elementary school' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
        { kind: 'personal_fact', content: { summary: 'Feeling overwhelmed with work lately' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
        // Review finding MAJOR #2 -- the two exact proven bypass payloads.
        { kind: 'personal_fact', content: { summary: 'My daughter starts kindergarten this fall' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
        { kind: 'commitment', content: { summary: 'Annual checkup next month', status: 'active' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      ],
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    const body = (await response.json()) as { acceptedCount: number; droppedCount: number }
    expect(body.acceptedCount).toBe(0)
    expect(body.droppedCount).toBe(5)
  })

  it('REGRESSION GUARD (task 10-fix): the runs-table insert includes user_id equal to the authenticated user, plus every other NOT NULL column -- catches the task 10-diag bug (userId destructured but discarded, user_id never sent) if it is ever reintroduced', async () => {
    let insertBody: Record<string, unknown> | null = null
    const inner = baseFetcher()
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
        insertBody = init.body ? JSON.parse(init.body as string) : null
      }
      return inner(input, init)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    expect(insertBody).not.toBeNull()
    for (const field of REQUIRED_RUN_INSERT_FIELDS) {
      expect(insertBody).toHaveProperty(field)
    }
    expect(insertBody?.user_id).toBe(AUTHENTICATED_USER_ID)
  })

  it('accepts a legitimate personal_fact candidate that does not match the sensitive heuristic', async () => {
    const fetcher = baseFetcher({
      geminiCandidates: [
        { kind: 'personal_fact', content: { summary: 'Prefers to be called Aryan', category: 'identity' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      ],
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    const body = (await response.json()) as { acceptedCount: number; droppedCount: number }
    expect(body.acceptedCount).toBe(1)
    expect(body.droppedCount).toBe(0)
  })

  // -------------------------------------------------------------------------
  // Task 16 (Document-Sourced Memory, slice 1) -- B1: this route's source
  // material can also be a single document's chunks, when the request body
  // names a documentId. Every step downstream of source-gathering
  // (prompt/schema/Gemini call/normalization/persistence) is untouched and
  // already generic -- these tests exist to prove that branch specifically,
  // not to re-prove the shared logic above.
  // -------------------------------------------------------------------------
  const CHUNK_ID = '55555555-5555-4555-8555-555555555555'
  const DOCUMENT_ID = '66666666-6666-4666-8666-666666666666'

  it('task 16: reads document_chunks (not chat/briefing) when documentId is provided, and persists the candidate with document provenance', async () => {
    const onRpc = vi.fn()
    const fetcher = baseFetcher({
      documentChunks: [{ id: CHUNK_ID, content: 'Experience: Senior Engineer at Acme Corp, 2020-2026.' }],
      geminiCandidates: [
        {
          kind: 'skill',
          content: { summary: 'Senior software engineering experience', level: 'advanced' },
          confidence: 'high',
          provenanceSourceKind: 'document',
          provenanceSourceRefIds: [CHUNK_ID],
        },
      ],
      onRpc,
    })
    const response = await handlePersonalMemoryExtractionRequest(request({ documentId: DOCUMENT_ID }), validEnv, { fetcher })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { acceptedCount: number; sourceItemCount: number }
    expect(body.sourceItemCount).toBe(1)
    expect(body.acceptedCount).toBe(1)

    // Confirms chat/briefing were never read for a document-sourced run.
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('agent_chat_messages'))).toBe(false)
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('agent_briefings'))).toBe(false)
    expect(fetcher.mock.calls.some(([input]) => String(input).includes(`document_chunks?document_id=eq.${DOCUMENT_ID}`))).toBe(true)

    expect(onRpc).toHaveBeenCalledWith(
      expect.objectContaining({ p_provenance_source_kind: 'document', p_provenance_source_ref_ids: [CHUNK_ID] }),
    )
  })

  it('task 16: NO_SOURCE_MATERIAL with a document-specific message when the named document has no chunks', async () => {
    const fetcher = baseFetcher({ documentChunks: [] })
    const response = await handlePersonalMemoryExtractionRequest(request({ documentId: DOCUMENT_ID }), validEnv, { fetcher })
    expect(response.status).toBe(422)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('NO_SOURCE_MATERIAL')
    expect(body.error.message).toMatch(/extract it first/i)
  })

  it('task 16: rejects a non-string documentId with 400 before any source read', async () => {
    const fetcher = baseFetcher()
    const response = await handlePersonalMemoryExtractionRequest(request({ documentId: 12345 }), validEnv, { fetcher })
    expect(response.status).toBe(400)
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('document_chunks') || String(input).includes('agent_chat_messages'))).toBe(false)
  })

  it('task 16: a document-sourced candidate citing an unknown chunk id is dropped, never persisted', async () => {
    const onRpc = vi.fn()
    const fetcher = baseFetcher({
      documentChunks: [{ id: CHUNK_ID, content: 'Skills: TypeScript, Postgres.' }],
      geminiCandidates: [
        {
          kind: 'skill',
          content: { summary: 'Knows TypeScript', level: 'advanced' },
          confidence: 'medium',
          provenanceSourceKind: 'document',
          provenanceSourceRefIds: ['99999999-9999-4999-8999-999999999999'],
        },
      ],
      onRpc,
    })
    const response = await handlePersonalMemoryExtractionRequest(request({ documentId: DOCUMENT_ID }), validEnv, { fetcher })
    const body = (await response.json()) as { acceptedCount: number; droppedCount: number }
    expect(body.acceptedCount).toBe(0)
    expect(body.droppedCount).toBe(1)
    expect(onRpc).not.toHaveBeenCalled()
  })
})

describe('normalizeCandidate', () => {
  const refIdKinds = new Map<string, 'chat_turn' | 'briefing'>([[CHAT_ID, 'chat_turn'], [BRIEFING_ID, 'briefing']])

  it('accepts a well-formed commitment candidate with its required status field', () => {
    const result = normalizeCandidate(
      { kind: 'commitment', content: { summary: 'Start running 3x/week', status: 'active' }, confidence: 'medium', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      refIdKinds,
    )
    expect(result).toEqual({
      kind: 'commitment',
      content: { summary: 'Start running 3x/week', status: 'active' },
      confidence: 'medium',
      provenanceSourceKind: 'chat_turn',
      provenanceSourceRefIds: [CHAT_ID],
    })
  })

  it('rejects a commitment candidate missing its required status field', () => {
    const result = normalizeCandidate(
      { kind: 'commitment', content: { summary: 'Start running 3x/week' }, confidence: 'medium', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      refIdKinds,
    )
    expect(result).toBeNull()
  })

  it('rejects an unsupported kind', () => {
    const result = normalizeCandidate(
      { kind: 'health_note', content: { summary: 'x' }, confidence: 'low', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      refIdKinds,
    )
    expect(result).toBeNull()
  })

  it('rejects a candidate with an unrecognized content field', () => {
    const result = normalizeCandidate(
      { kind: 'preference', content: { summary: 'x', unexpectedField: 'y' }, confidence: 'low', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      refIdKinds,
    )
    expect(result).toBeNull()
  })
})
