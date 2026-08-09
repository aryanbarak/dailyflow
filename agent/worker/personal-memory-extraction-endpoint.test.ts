import { describe, expect, it, vi } from 'vitest'
import { handlePersonalMemoryExtractionRequest, normalizeCandidate, type PersonalMemoryExtractionEnv } from './personal-memory-extraction-endpoint'

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
  geminiCandidates?: Array<Record<string, unknown>>
  onRpc?: (body: unknown) => void
} = {}) {
  const chatMessages = overrides.chatMessages ?? [{ id: CHAT_ID, content: 'I prefer async written updates over calls.' }]
  const briefings = overrides.briefings ?? [{ id: BRIEFING_ID, content: 'You are learning React Native this month.' }]
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

  it('returns 502 when the model call fails, and marks the run failed', async () => {
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
    expect(patchCalls).toEqual([{ completed_at: expect.any(String), outcome: 'failed', failure_reason: 'MODEL_CALL_FAILED' }])
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
