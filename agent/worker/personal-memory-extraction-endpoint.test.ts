import { describe, expect, it, vi } from 'vitest'
import {
  buildExtractionResponseSchema,
  buildExtractionSystemInstruction,
  batchDocumentSource,
  cosineSimilarity,
  handlePersonalMemoryExtractionRequest,
  normalizeCandidate,
  normalizeOverlapSubjectText,
  OVERLAP_EMBEDDING_THRESHOLD,
  type PersonalMemoryExtractionEnv,
  type SourceItemForPrompt,
} from './personal-memory-extraction-endpoint'

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
  documentType?: string | null
  geminiCandidates?: Array<Record<string, unknown>>
  existingRecordsForOverlap?: Array<Record<string, unknown>>
  embeddingValuesByText?: Record<string, number[]>
  onRpc?: (body: unknown) => void
  onGenerateContentCall?: (body: unknown) => void
} = {}) {
  const chatMessages = overrides.chatMessages ?? [{ id: CHAT_ID, content: 'I prefer async written updates over calls.' }]
  const briefings = overrides.briefings ?? [{ id: BRIEFING_ID, content: 'You are learning React Native this month.' }]
  const documentChunks = overrides.documentChunks ?? []
  const documentType = overrides.documentType === undefined ? null : overrides.documentType
  const existingRecordsForOverlap = overrides.existingRecordsForOverlap ?? []
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
    // Task 18, A3: readDocumentType's own lookup (best-effort -- see its
    // header comment), distinct from the document_chunks branch above.
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/documents?`) && url.includes('select=type')) {
      return jsonResponse([{ type: documentType }])
    }
    // Task 18, B1: readExistingRecordsForOverlapCheck's own lookup.
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_records?`) && url.includes('select=id,kind,content,status')) {
      return jsonResponse(existingRecordsForOverlap)
    }
    if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
      assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
      return jsonResponse([{ id: RUN_ID }])
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') return new Response(null, { status: 204 })
    // Task 18, B1: embedContent calls for the overlap-check fallback -- a
    // deterministic, test-scripted vector per input text (so a test can
    // control which pairs "match"), always via a REAL 768-length,
    // already-unit-length response shape (embedTextForOverlap L2-normalizes
    // it again itself, so any non-zero vector works).
    if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent')) {
      const body = init?.body ? (JSON.parse(init.body as string) as { content: { parts: Array<{ text: string }> } }) : null
      const text = body?.content.parts[0]?.text ?? ''
      const scripted = overrides.embeddingValuesByText?.[text]
      const values = scripted ?? Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0))
      return jsonResponse({ embedding: { values } })
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      overrides.onGenerateContentCall?.(init?.body ? JSON.parse(init.body as string) : null)
      return geminiModelResponse(geminiCandidates)
    }
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

  // MIG-01b: the task 12 fix this replaced (gemini-2.5-flash spending
  // output tokens on internal thinking by default) required
  // thinkingConfig:{thinkingBudget:0}; gemini-3.6-flash returns 400
  // INVALID_ARGUMENT on that same field (scripts/gemini-36-probe.ts's P3
  // finding), so it is no longer sent at all -- this test now asserts its
  // absence at the wire level instead of its presence.
  it('MIG-01b: does NOT send thinkingConfig on the Gemini call -- gemini-3.6-flash rejects it (400 INVALID_ARGUMENT)', async () => {
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
    expect(sentBody?.generationConfig?.thinkingConfig).toBeUndefined()
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

  // Task 18, A3: end-to-end proof that the document's OWN type reaches the
  // actual generateContent request's system_instruction -- not just a unit
  // test of buildExtractionSystemInstruction in isolation.
  it("task 18: a document-sourced run looks up the document's type and includes it in the system_instruction sent to Gemini", async () => {
    const onGenerateContentCall = vi.fn()
    const fetcher = baseFetcher({
      documentChunks: [{ id: CHUNK_ID, content: 'Primary bank is Sparkasse Holstein.' }],
      documentType: 'financial',
      geminiCandidates: [
        { kind: 'personal_fact', content: { summary: 'Primary bank is Sparkasse Holstein', category: 'general' }, confidence: 'high', provenanceSourceKind: 'document', provenanceSourceRefIds: [CHUNK_ID] },
      ],
      onGenerateContentCall,
    })
    const response = await handlePersonalMemoryExtractionRequest(request({ documentId: DOCUMENT_ID }), validEnv, { fetcher })
    expect(response.status).toBe(200)

    expect(fetcher.mock.calls.some(([input]) => String(input).includes(`documents?id=eq.${DOCUMENT_ID}&select=type`))).toBe(true)
    expect(onGenerateContentCall).toHaveBeenCalledWith(
      expect.objectContaining({
        system_instruction: { parts: [{ text: expect.stringContaining('financial statement') }] },
      }),
    )
  })

  it('task 18: a document with no type set gets the base system_instruction, unchanged', async () => {
    const onGenerateContentCall = vi.fn()
    const fetcher = baseFetcher({
      documentChunks: [{ id: CHUNK_ID, content: 'Some resume-shaped text.' }],
      documentType: null,
      onGenerateContentCall,
    })
    await handlePersonalMemoryExtractionRequest(request({ documentId: DOCUMENT_ID }), validEnv, { fetcher })

    const [[sentBody]] = onGenerateContentCall.mock.calls as [[{ system_instruction: { parts: Array<{ text: string }> } }]]
    expect(sentBody.system_instruction.parts[0].text).not.toContain('financial statement')
    expect(sentBody.system_instruction.parts[0].text).toBe(buildExtractionSystemInstruction())
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

  // -------------------------------------------------------------------------
  // Task 16-fix2 -- production evidence (wrangler tail) showed document-
  // sourced runs hitting finishReason=MAX_TOKENS: FIX 1 raises the output
  // budget, FIX 2 batches document chunks (2-3 per model call, size-based)
  // instead of sending the whole document in one call, and FIX 3 makes a
  // single failed batch a partial success (EXTRACTION_PARTIAL) rather than
  // failing the whole run. The chat/briefing path is unchanged throughout
  // -- the 32 tests above (none touched) are the regression guard for that.
  // -------------------------------------------------------------------------
  const CHUNK_ID_1 = '55555555-5555-4555-8555-555555555501'
  const CHUNK_ID_2 = '55555555-5555-4555-8555-555555555502'
  const CHUNK_ID_3 = '55555555-5555-4555-8555-555555555503'
  const CHUNK_ID_4 = '55555555-5555-4555-8555-555555555504'
  const CHUNK_ID_5 = '55555555-5555-4555-8555-555555555505'

  // Five 2500-char chunks: two fit in one batch (5000 <= 6000 chars), a
  // third would push it to 7500 (> 6000), so this fixture deterministically
  // yields three batches of [2, 2, 1] under batchDocumentSource's real
  // defaults (MAX_DOCUMENT_CHUNKS_PER_BATCH=3, MAX_DOCUMENT_BATCH_CHARS=6000).
  const FIVE_CHUNKS_TWO_TWO_ONE = [
    { id: CHUNK_ID_1, content: 'A'.repeat(2500) },
    { id: CHUNK_ID_2, content: 'B'.repeat(2500) },
    { id: CHUNK_ID_3, content: 'C'.repeat(2500) },
    { id: CHUNK_ID_4, content: 'D'.repeat(2500) },
    { id: CHUNK_ID_5, content: 'E'.repeat(2500) },
  ]

  function documentCandidate(chunkId: string, summary: string) {
    return {
      kind: 'skill',
      content: { summary, level: 'advanced' },
      confidence: 'medium',
      provenanceSourceKind: 'document',
      provenanceSourceRefIds: [chunkId],
    }
  }

  /**
   * A document-sourced fetcher where each successive generateContent call
   * (i.e. each batch) gets its own scripted response from `perCallResponses`,
   * cycling if there are more calls than entries. Everything else mirrors
   * baseFetcher exactly.
   */
  function batchAwareFetcher(overrides: {
    documentChunks: Array<Record<string, unknown>>
    perCallResponses: Array<() => Response>
    existingRecordsForOverlap?: Array<Record<string, unknown>>
    onRpc?: (body: unknown) => void
    onGenerateContentCall?: (body: unknown) => void
  }) {
    let callIndex = 0
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/document_chunks?`)) return jsonResponse(overrides.documentChunks)
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/documents?`) && url.includes('select=type')) return jsonResponse([{ type: null }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_records?`) && url.includes('select=id,kind,content,status')) {
        return jsonResponse(overrides.existingRecordsForOverlap ?? [])
      }
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
        assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
        return jsonResponse([{ id: RUN_ID }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') return new Response(null, { status: 204 })
      // Task 18, B1: embedContent is a DISTINCT endpoint from generateContent
      // -- must not be swallowed by the generic generateContent branch below
      // (perCallResponses/callIndex is for batched generateContent calls
      // only). Returns a fixed non-matching vector -- these batch/FIX-1-3
      // tests aren't testing overlap detection itself (see the dedicated
      // "B1 overlap detection" describe block for that).
      if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent')) {
        return jsonResponse({ embedding: { values: Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)) } })
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        overrides.onGenerateContentCall?.(init?.body ? JSON.parse(init.body as string) : null)
        const responder = overrides.perCallResponses[callIndex % overrides.perCallResponses.length]
        callIndex += 1
        return responder()
      }
      if (url === `${SUPABASE_URL}/rest/v1/rpc/create_personal_memory_record`) {
        overrides.onRpc?.(init?.body ? JSON.parse(init.body as string) : null)
        return jsonResponse({ outcome: 'created', field: { id: 'record-1', status: 'proposed' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
  }

  describe('batchDocumentSource (FIX 2: batching split logic)', () => {
    it('splits 5 chunks into batches of [2, 2, 1] under the real size/count defaults', () => {
      const source: SourceItemForPrompt[] = FIVE_CHUNKS_TWO_TWO_ONE.map((c) => ({ id: c.id, provenanceSourceKind: 'document', text: c.content }))
      const batches = batchDocumentSource(source)
      expect(batches.map((b) => b.length)).toEqual([2, 2, 1])
      expect(batches[0].map((i) => i.id)).toEqual([CHUNK_ID_1, CHUNK_ID_2])
      expect(batches[1].map((i) => i.id)).toEqual([CHUNK_ID_3, CHUNK_ID_4])
      expect(batches[2].map((i) => i.id)).toEqual([CHUNK_ID_5])
    })

    it('caps a batch at 3 items even when char budget would allow more (count-based limit)', () => {
      const source: SourceItemForPrompt[] = Array.from({ length: 7 }, (_, i) => ({ id: `chunk-${i}`, provenanceSourceKind: 'document' as const, text: 'short' }))
      const batches = batchDocumentSource(source)
      expect(batches.map((b) => b.length)).toEqual([3, 3, 1])
    })

    it('gives a single oversized chunk its own batch rather than dropping or splitting it', () => {
      const source: SourceItemForPrompt[] = [
        { id: 'huge', provenanceSourceKind: 'document', text: 'x'.repeat(9000) },
        { id: 'small', provenanceSourceKind: 'document', text: 'y'.repeat(100) },
      ]
      const batches = batchDocumentSource(source)
      expect(batches).toEqual([[source[0]], [source[1]]])
    })

    it('returns an empty array for empty source (defensive; the route handler never actually calls it with empty source -- NO_SOURCE_MATERIAL short-circuits first)', () => {
      expect(batchDocumentSource([])).toEqual([])
    })
  })

  it('FIX 1: the extraction call requests the raised output budget (4096) on every batch, sized for MAX_CANDIDATES_PER_RUN=12 full candidates', async () => {
    const sentBodies: Array<{ generationConfig?: { maxOutputTokens?: number } }> = []
    const fetcher = batchAwareFetcher({
      documentChunks: FIVE_CHUNKS_TWO_TWO_ONE,
      perCallResponses: [() => geminiModelResponse([documentCandidate(CHUNK_ID_1, 'Skill A')])],
      onGenerateContentCall: (body) => sentBodies.push(body as { generationConfig?: { maxOutputTokens?: number } }),
    })
    const response = await handlePersonalMemoryExtractionRequest(request({ documentId: DOCUMENT_ID }), validEnv, { fetcher })
    expect(response.status).toBe(200)
    expect(sentBodies.length).toBe(3) // one per batch (2+2+1 chunks)
    for (const body of sentBodies) expect(body.generationConfig?.maxOutputTokens).toBe(4096)
  })

  it('FIX 2 + task-14 invariant: raw candidates are merged across all batches BEFORE the MAX_CANDIDATES_PER_RUN=12 cap is applied once, to the merged total', async () => {
    const onRpc = vi.fn()
    const fiveCandidatesPerBatch = () => geminiModelResponse(Array.from({ length: 5 }, (_, i) => documentCandidate(CHUNK_ID_1, `Skill ${i}`)))
    const fetcher = batchAwareFetcher({
      documentChunks: FIVE_CHUNKS_TWO_TWO_ONE,
      perCallResponses: [fiveCandidatesPerBatch],
      onRpc,
    })
    const response = await handlePersonalMemoryExtractionRequest(request({ documentId: DOCUMENT_ID }), validEnv, { fetcher })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { candidateCount: number; acceptedCount: number; outcome: string }
    // 3 batches x 5 candidates = 15 raw, capped to 12 -- not 15, and not
    // capped per-batch (which would have produced fewer than 12).
    expect(body.candidateCount).toBe(12)
    expect(body.acceptedCount).toBe(12)
    expect(body.outcome).toBe('completed') // no batch failed, so no partial signal
    expect(onRpc).toHaveBeenCalledTimes(12)
  })

  it('FIX 3: one failing batch (provider 500) does not fail the run -- successful batches\' candidates are persisted and the response reports EXTRACTION_PARTIAL with counts', async () => {
    const onRpc = vi.fn()
    const fetcher = batchAwareFetcher({
      documentChunks: FIVE_CHUNKS_TWO_TWO_ONE,
      perCallResponses: [
        () => geminiModelResponse([documentCandidate(CHUNK_ID_1, 'Skill from batch 1'), documentCandidate(CHUNK_ID_1, 'Another skill from batch 1')]),
        () => jsonResponse({}, 500), // batch 2 (chunks 3-4) fails
        () => geminiModelResponse([documentCandidate(CHUNK_ID_5, 'Skill from batch 3'), documentCandidate(CHUNK_ID_5, 'Another skill from batch 3')]),
      ],
      onRpc,
    })
    const response = await handlePersonalMemoryExtractionRequest(request({ documentId: DOCUMENT_ID }), validEnv, { fetcher })
    expect(response.status).toBe(200) // partial success is still a 200, never all-or-nothing
    const body = (await response.json()) as {
      outcome: string
      code?: string
      batchesTotal?: number
      batchesSucceeded?: number
      batchesFailed?: number
      acceptedCount: number
      candidateCount: number
    }
    expect(body.outcome).toBe('partial')
    expect(body.code).toBe('EXTRACTION_PARTIAL')
    expect(body.batchesTotal).toBe(3)
    expect(body.batchesSucceeded).toBe(2)
    expect(body.batchesFailed).toBe(1)
    expect(body.candidateCount).toBe(4) // 2 + 2 from the two successful batches, the failed batch contributes 0
    expect(body.acceptedCount).toBe(4)
    expect(onRpc).toHaveBeenCalledTimes(4) // successful batches' candidates WERE persisted, despite batch 2's failure
  })

  it('FIX 3 (exact production signature): a MAX_TOKENS finishReason on a single batch fails only that batch -- the other batches\' candidates still get persisted and EXTRACTION_PARTIAL is reported', async () => {
    const onRpc = vi.fn()
    const fetcher = batchAwareFetcher({
      documentChunks: FIVE_CHUNKS_TWO_TWO_ONE,
      perCallResponses: [
        () => geminiModelResponse([documentCandidate(CHUNK_ID_1, 'Skill from batch 1')]),
        () => geminiModelResponse([documentCandidate(CHUNK_ID_3, 'Skill from batch 2')]),
        // batch 3 (chunk 5) is truncated -- the diagnosed production bug's exact signature.
        () => jsonResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"candidates":[{"kind":"skil' }] } }] }),
      ],
      onRpc,
    })
    const response = await handlePersonalMemoryExtractionRequest(request({ documentId: DOCUMENT_ID }), validEnv, { fetcher })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { outcome: string; batchesSucceeded: number; batchesFailed: number; acceptedCount: number }
    expect(body.outcome).toBe('partial')
    expect(body.batchesSucceeded).toBe(2)
    expect(body.batchesFailed).toBe(1)
    expect(body.acceptedCount).toBe(2)
    expect(onRpc).toHaveBeenCalledTimes(2)
  })

  it('FIX 3: when EVERY batch fails, the run fails exactly like the pre-existing all-or-nothing chat/briefing path (502, task-14 taxonomy, run marked failed) -- a budget/batching fix does not weaken this', async () => {
    const patchCalls: unknown[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/document_chunks?`)) return jsonResponse(FIVE_CHUNKS_TWO_TWO_ONE)
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') {
        assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
        return jsonResponse([{ id: RUN_ID }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') {
        patchCalls.push(init.body ? JSON.parse(init.body as string) : null)
        return new Response(null, { status: 204 })
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) return jsonResponse({ error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } }, 503)
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handlePersonalMemoryExtractionRequest(request({ documentId: DOCUMENT_ID }), validEnv, { fetcher })
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(patchCalls).toHaveLength(1)
    expect(patchCalls[0]).toMatchObject({ outcome: 'failed' })
  })

  it('the chat/briefing path is completely unaffected by batching -- exactly one generateContent call for the whole run, never multiple, regardless of MAX_DOCUMENT_CHUNKS_PER_BATCH', async () => {
    let generateContentCalls = 0
    const inner = baseFetcher()
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://generativelanguage.googleapis.com/')) generateContentCalls += 1
      return inner(input, init)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher }) // no documentId -- chat/briefing path
    expect(response.status).toBe(200)
    expect(generateContentCalls).toBe(1)
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

  // Task 18, A3 HARD SENSITIVITY RULE: dropped regardless of kind or
  // documentType -- this is the deterministic guarantee, not the prompt.
  it('DROPS a candidate whose summary contains a realistic German IBAN shape (spaced, as commonly printed)', () => {
    const result = normalizeCandidate(
      { kind: 'personal_fact', content: { summary: 'IBAN is DE89 3704 0044 0532 0130 00', category: 'general' }, confidence: 'medium', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      refIdKinds,
    )
    expect(result).toBeNull()
  })

  it('DROPS a candidate whose summary contains an unspaced IBAN-shaped run', () => {
    const result = normalizeCandidate(
      { kind: 'personal_fact', content: { summary: 'IBAN DE89370400440532013000', category: 'general' }, confidence: 'medium', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      refIdKinds,
    )
    expect(result).toBeNull()
  })

  it('DROPS a candidate whose summary contains a plain long digit run (account/card number shape)', () => {
    const result = normalizeCandidate(
      { kind: 'personal_fact', content: { summary: 'Account number 1234567890123456 on file', category: 'general' }, confidence: 'medium', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      refIdKinds,
    )
    expect(result).toBeNull()
  })

  it('accepts a genuinely stable financial fact with no identifier in it', () => {
    const result = normalizeCandidate(
      { kind: 'personal_fact', content: { summary: 'Primary bank is Sparkasse Holstein', category: 'general' }, confidence: 'medium', provenanceSourceKind: 'document', provenanceSourceRefIds: [CHAT_ID] },
      new Map([[CHAT_ID, 'document']]),
    )
    expect(result).not.toBeNull()
  })
})

describe('buildExtractionSystemInstruction (task 18, A3 type-aware guidance)', () => {
  it('the base instruction (no documentType) is unchanged from before task 18', () => {
    const instruction = buildExtractionSystemInstruction()
    expect(instruction).not.toContain('financial statement')
    expect(instruction).toContain('You extract durable, long-term personal facts')
  })

  it("documentType='financial' appends the never-a-transaction/balance/identifier guidance", () => {
    const instruction = buildExtractionSystemInstruction('financial')
    expect(instruction).toContain('financial statement')
    expect(instruction).toContain('NEVER a specific transaction, balance, running total, account number, IBAN, card number')
  })

  it("documentType='resume'/'personal'/'business' each append their own type-specific line", () => {
    expect(buildExtractionSystemInstruction('resume')).toContain('résumé/CV')
    expect(buildExtractionSystemInstruction('personal')).toContain('personal document')
    expect(buildExtractionSystemInstruction('business')).toContain('business document')
  })

  it('an unrecognized or null documentType falls back to the base instruction unchanged', () => {
    expect(buildExtractionSystemInstruction(null)).toBe(buildExtractionSystemInstruction())
    expect(buildExtractionSystemInstruction('unknown-type')).toBe(buildExtractionSystemInstruction())
  })
})

describe('normalizeOverlapSubjectText (task 18, B1)', () => {
  it('is case-insensitive and whitespace-insensitive', () => {
    expect(normalizeOverlapSubjectText('TypeScript')).toBe(normalizeOverlapSubjectText('  typescript  '))
  })

  it('collapses internal repeated whitespace', () => {
    expect(normalizeOverlapSubjectText('IT   Specialist')).toBe(normalizeOverlapSubjectText('IT Specialist'))
  })

  it('is diacritics-insensitive', () => {
    expect(normalizeOverlapSubjectText('Über uns')).toBe(normalizeOverlapSubjectText('Uber uns'))
  })

  it('genuinely different subjects normalize to different strings', () => {
    expect(normalizeOverlapSubjectText('TypeScript')).not.toBe(normalizeOverlapSubjectText('JavaScript'))
  })
})

describe('cosineSimilarity (task 18, B1)', () => {
  it('is 1 for identical unit vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10)
  })

  it('is 0 for orthogonal unit vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10)
  })

  it('is -1 for opposite unit vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 10)
  })
})

// -------------------------------------------------------------------------
// Task 18, B1 -- propose-time overlap detection, end to end through the
// real route handler. THRESHOLD (0.83) and its calibration story are
// documented on OVERLAP_EMBEDDING_THRESHOLD's own declaration -- these
// tests exercise the DETECTION WIRING (deterministic-first,
// embedding-fallback-second, passed through to create_personal_memory_record
// as p_possible_update_of_id), not the threshold's real-world numeric
// justification (that's the report's own probe data, backed by real Gemini
// calls, not fake fixture vectors).
// -------------------------------------------------------------------------
describe('B1 overlap detection (task 18)', () => {
  const EXISTING_ID = '77777777-7777-4777-8777-777777777777'

  it('deterministic match: same kind + normalized-equal summary is found WITHOUT ever calling the embedding endpoint', async () => {
    const onRpc = vi.fn()
    const fetcher = baseFetcher({
      existingRecordsForOverlap: [{ id: EXISTING_ID, kind: 'skill', content: { summary: 'TypeScript', level: 'intermediate' }, status: 'user_confirmed' }],
      geminiCandidates: [
        { kind: 'skill', content: { summary: 'TypeScript', level: 'advanced' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      ],
      onRpc,
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    expect(onRpc).toHaveBeenCalledWith(expect.objectContaining({ p_possible_update_of_id: EXISTING_ID }))
    expect(fetcher.mock.calls.some(([input]) => String(input).includes(':embedContent'))).toBe(false)
  })

  it('case/whitespace-only differences still deterministically match (no embedding call)', async () => {
    const onRpc = vi.fn()
    const fetcher = baseFetcher({
      existingRecordsForOverlap: [{ id: EXISTING_ID, kind: 'personal_fact', content: { summary: '  IT Specialist for Application Development (IHK)  ' }, status: 'user_confirmed' }],
      geminiCandidates: [
        { kind: 'personal_fact', content: { summary: 'it specialist for application development (ihk)' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      ],
      onRpc,
    })
    await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(onRpc).toHaveBeenCalledWith(expect.objectContaining({ p_possible_update_of_id: EXISTING_ID }))
    expect(fetcher.mock.calls.some(([input]) => String(input).includes(':embedContent'))).toBe(false)
  })

  it('embedding fallback: cross-language paraphrase (no deterministic match) clears the threshold and is found', async () => {
    const onRpc = vi.fn()
    const candidateText = 'Fachinformatiker für Anwendungsentwicklung (IHK)'
    const existingText = 'IT Specialist for Application Development (IHK)'
    const fetcher = baseFetcher({
      existingRecordsForOverlap: [{ id: EXISTING_ID, kind: 'personal_fact', content: { summary: existingText }, status: 'user_confirmed' }],
      geminiCandidates: [
        { kind: 'personal_fact', content: { summary: candidateText }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      ],
      // Scripted vectors: candidate and existing text are nearly parallel
      // (clears 0.83) -- this test proves the WIRING (fallback triggers,
      // score compared, id passed through), not the real model's actual
      // score for this pair (see the report's own real-call probe data).
      embeddingValuesByText: {
        [candidateText]: [1, 0, 0, ...Array(765).fill(0)],
        [existingText]: [0.95, Math.sqrt(1 - 0.95 * 0.95), 0, ...Array(765).fill(0)],
      },
      onRpc,
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    expect(fetcher.mock.calls.some(([input]) => String(input).includes(':embedContent'))).toBe(true)
    expect(onRpc).toHaveBeenCalledWith(expect.objectContaining({ p_possible_update_of_id: EXISTING_ID }))
  })

  it('NON-match: a genuinely different subject of the same kind clears neither the deterministic nor the embedding bar -- p_possible_update_of_id is null', async () => {
    const onRpc = vi.fn()
    const candidateText = 'JavaScript'
    const existingText = 'TypeScript'
    const fetcher = baseFetcher({
      existingRecordsForOverlap: [{ id: EXISTING_ID, kind: 'skill', content: { summary: existingText }, status: 'user_confirmed' }],
      geminiCandidates: [
        { kind: 'skill', content: { summary: candidateText }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      ],
      // Scripted vectors well below the 0.83 threshold (orthogonal).
      embeddingValuesByText: {
        [candidateText]: [1, 0, 0, ...Array(765).fill(0)],
        [existingText]: [0, 1, 0, ...Array(765).fill(0)],
      },
      onRpc,
    })
    await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(onRpc).toHaveBeenCalledWith(expect.objectContaining({ p_possible_update_of_id: null }))
  })

  it('a same-text existing record of a DIFFERENT kind is never considered a match', async () => {
    const onRpc = vi.fn()
    const fetcher = baseFetcher({
      existingRecordsForOverlap: [{ id: EXISTING_ID, kind: 'goal', content: { summary: 'TypeScript' }, status: 'user_confirmed' }],
      geminiCandidates: [
        { kind: 'skill', content: { summary: 'TypeScript', level: 'advanced' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      ],
      onRpc,
    })
    await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(onRpc).toHaveBeenCalledWith(expect.objectContaining({ p_possible_update_of_id: null }))
    // Different kind means sameKind.length === 0 -- returns before ever
    // reaching the embedding fallback.
    expect(fetcher.mock.calls.some(([input]) => String(input).includes(':embedContent'))).toBe(false)
  })

  it('the existing-records read is scoped to the actual kinds present among this run\'s valid candidates, and excludes superseded/rejected statuses in the query itself', async () => {
    const fetcher = baseFetcher({
      geminiCandidates: [
        { kind: 'skill', content: { summary: 'TypeScript' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] },
      ],
    })
    await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    const overlapReadCall = fetcher.mock.calls.find(([input]) => String(input).includes('personal_memory_records?') && String(input).includes('select=id,kind,content,status'))
    expect(overlapReadCall).toBeDefined()
    const url = String(overlapReadCall![0])
    expect(url).toContain('kind=in.(skill)')
    expect(url).toContain('status=in.(proposed,user_confirmed,user_corrected)')
    expect(url).not.toContain('superseded')
    expect(url).not.toContain('rejected')
  })

  it('an overlap-check read failure degrades to no suggestion, never fails the run', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages?`)) return jsonResponse([{ id: CHAT_ID, content: 'x' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_briefings?`)) return jsonResponse([])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_records?`)) return new Response('boom', { status: 500 })
      if (url === `${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs` && init?.method === 'POST') return jsonResponse([{ id: RUN_ID }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/personal_memory_extraction_runs?`) && init?.method === 'PATCH') return new Response(null, { status: 204 })
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        return geminiModelResponse([{ kind: 'skill', content: { summary: 'TypeScript' }, confidence: 'high', provenanceSourceKind: 'chat_turn', provenanceSourceRefIds: [CHAT_ID] }])
      }
      if (url === `${SUPABASE_URL}/rest/v1/rpc/create_personal_memory_record`) return jsonResponse({ outcome: 'created', field: { id: 'record-1', status: 'proposed' } })
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handlePersonalMemoryExtractionRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { acceptedCount: number }
    expect(body.acceptedCount).toBe(1)
  })

  it('OVERLAP_EMBEDDING_THRESHOLD is 0.83 (see this constant\'s own declaration for the empirical calibration story)', () => {
    expect(OVERLAP_EMBEDDING_THRESHOLD).toBe(0.83)
  })
})
