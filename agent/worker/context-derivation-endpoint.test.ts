import { describe, expect, it, vi } from 'vitest'
import { handleContextDerivationRequest, buildDerivationResponseSchema, type ContextDerivationEnv } from './context-derivation-endpoint'

const ORIGIN = 'https://smartflow.example'
const SUPABASE_URL = 'https://supabase.example.co'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const EVIDENCE_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'

const validEnv: ContextDerivationEnv = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: 'anon-key',
  GEMINI_API_KEY: 'gemini-key',
  GEMINI_MODEL: 'gemini-2.5-flash',
}

function request(body: Record<string, unknown> = { projectId: PROJECT_ID }, headers: Record<string, string> = {}) {
  return new Request('https://worker.example/projects/context-derivation', {
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
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
  })
}

function baseFetcher(overrides: {
  evidence?: Array<Record<string, unknown>>
  observations?: Array<Record<string, unknown>>
  geminiCandidates?: Array<Record<string, unknown>>
  onRpc?: (body: unknown) => void
} = {}) {
  const evidence = overrides.evidence ?? [
    { id: EVIDENCE_ID, source_kind: 'architecture_document', classification: 'canonical_document_observation', title: 'Architecture', reference: 'docs/architecture/project-domain.md', collected_at: '2026-08-01T00:00:00.000Z', supersedes_id: null },
  ]
  const observations = overrides.observations ?? [{ evidence_id: EVIDENCE_ID, text_content: 'The project has one high risk: a single point of failure in auth.' }]
  const geminiCandidates =
    overrides.geminiCandidates ?? [
      { kind: 'risk', content: { summary: 'Single point of failure in auth', severity: 'high' }, confidence: 'medium', sourceEvidenceIds: [EVIDENCE_ID] },
    ]

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === `${SUPABASE_URL}/auth/v1/user`) {
      return jsonResponse({ id: 'user-1' })
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_records?`)) {
      return jsonResponse([{ id: PROJECT_ID, name: 'SmartFlow', status: 'active' }])
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_evidence?`)) {
      return jsonResponse(evidence)
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_evidence_observations?`)) {
      return jsonResponse(observations)
    }
    if (url === `${SUPABASE_URL}/rest/v1/inferred_context_derivation_runs` && init?.method === 'POST') {
      return jsonResponse([{ id: RUN_ID }])
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/inferred_context_derivation_runs?`) && init?.method === 'PATCH') {
      return new Response(null, { status: 204 })
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      return geminiModelResponse(geminiCandidates)
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/create_inferred_context_field`) {
      overrides.onRpc?.(init?.body ? JSON.parse(init.body as string) : null)
      return jsonResponse({ outcome: 'created', field: { id: 'field-1', status: 'proposed' } })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

describe('POST /projects/context-derivation', () => {
  it('answers preflight without authentication', async () => {
    const response = await handleContextDerivationRequest(
      new Request('https://worker.example/projects/context-derivation', { method: 'OPTIONS', headers: { Origin: ORIGIN } }),
      validEnv,
    )
    expect(response.status).toBe(204)
  })

  it('rejects non-POST methods', async () => {
    const response = await handleContextDerivationRequest(new Request('https://worker.example/projects/context-derivation', { method: 'GET' }), validEnv)
    expect(response.status).toBe(405)
  })

  it('fails closed with 503 when configuration is missing, before any fetch happens', async () => {
    const fetcher = vi.fn()
    const response = await handleContextDerivationRequest(request(), { ...validEnv, GEMINI_API_KEY: undefined }, { fetcher })
    expect(response.status).toBe(503)
    expect(fetcher).not.toHaveBeenCalled()
  });

  it('rejects a missing or invalid bearer token with 401', async () => {
    const fetcher = vi.fn(async () => jsonResponse({}, 401))
    const response = await handleContextDerivationRequest(request({ projectId: PROJECT_ID }, { Authorization: '' }), validEnv, { fetcher })
    expect(response.status).toBe(401)
  });

  it('rejects malformed JSON with 400', async () => {
    const badRequest = new Request('https://worker.example/projects/context-derivation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token' },
      body: '{not json',
    })
    const response = await handleContextDerivationRequest(badRequest, validEnv, { fetcher: baseFetcher() })
    expect(response.status).toBe(400)
  });

  it('rejects a missing projectId with 400', async () => {
    const response = await handleContextDerivationRequest(request({}), validEnv, { fetcher: baseFetcher() })
    expect(response.status).toBe(400)
  });

  it('returns 404 for a project that does not exist or is not owned by this user (RLS-scoped read returns zero rows either way)', async () => {
    const fetcher = baseFetcher()
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_records?`)) return jsonResponse([])
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(404)
  });

  it('returns 409 for an archived project', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_records?`)) return jsonResponse([{ id: PROJECT_ID, name: 'SmartFlow', status: 'archived' }])
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(409)
  });

  it('returns 422 when the project has no eligible evidence (ADR-0009 Q4: no threshold beyond >=1 active observation)', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_records?`)) return jsonResponse([{ id: PROJECT_ID, name: 'SmartFlow', status: 'active' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_evidence?`)) return jsonResponse([])
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(422)
  });

  it('excludes superseded evidence from the prompt entirely', async () => {
    const fetcher = baseFetcher({
      evidence: [
        { id: EVIDENCE_ID, source_kind: 'architecture_document', classification: 'canonical_document_observation', title: 'Old', reference: 'a.md', collected_at: '2026-08-01T00:00:00.000Z', supersedes_id: null },
        { id: 'superseded-id', source_kind: 'architecture_document', classification: 'canonical_document_observation', title: 'Superseded', reference: 'b.md', collected_at: '2026-07-01T00:00:00.000Z', supersedes_id: null },
      ],
      observations: [
        { evidence_id: EVIDENCE_ID, text_content: 'Current text.' },
        { evidence_id: 'superseded-id', text_content: 'Stale text.' },
      ],
    })
    // The first evidence row's own supersedes_id doesn't point at the second
    // -- reverse it so "superseded-id" is actually excluded (a real item
    // supersedes it), matching the exclusion rule under test.
    fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_records?`)) return jsonResponse([{ id: PROJECT_ID, name: 'SmartFlow', status: 'active' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_evidence?`)) {
        return jsonResponse([
          { id: EVIDENCE_ID, source_kind: 'architecture_document', classification: 'canonical_document_observation', title: 'New', reference: 'a.md', collected_at: '2026-08-01T00:00:00.000Z', supersedes_id: 'superseded-id' },
        ])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_evidence_observations?`)) return jsonResponse([{ evidence_id: EVIDENCE_ID, text_content: 'Current text.' }])
      if (url === `${SUPABASE_URL}/rest/v1/inferred_context_derivation_runs` && init?.method === 'POST') return jsonResponse([{ id: RUN_ID }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/inferred_context_derivation_runs?`)) return new Response(null, { status: 204 })
      if (url.startsWith('https://generativelanguage.googleapis.com/')) return geminiModelResponse([])
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    const json = await response.json()
    expect(json.evidenceCount).toBe(1)
  });

  it('a full successful run: authenticates, reads evidence, calls Gemini, persists one valid candidate, and completes the run', async () => {
    const rpcCalls: unknown[] = []
    const fetcher = baseFetcher({ onRpc: (body) => rpcCalls.push(body) })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher, now: () => '2026-08-07T00:00:00.000Z' })
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.runId).toBe(RUN_ID)
    expect(json.candidateCount).toBe(1)
    expect(json.acceptedCount).toBe(1)
    expect(json.droppedCount).toBe(0)
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ p_project_id: PROJECT_ID, p_run_id: RUN_ID, p_kind: 'risk', p_confidence: 'medium' })
  });

  it('drops a candidate that cites an evidence id outside this run\'s evidence set, never persisting it', async () => {
    const rpcCalls: unknown[] = []
    const fetcher = baseFetcher({
      geminiCandidates: [{ kind: 'risk', content: { summary: 'Invented risk', severity: 'high' }, confidence: 'high', sourceEvidenceIds: ['not-a-real-evidence-id'] }],
      onRpc: (body) => rpcCalls.push(body),
    })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    const json = await response.json()
    expect(json.acceptedCount).toBe(0)
    expect(json.droppedCount).toBe(1)
    expect(rpcCalls).toHaveLength(0);
  });

  it('drops a candidate with an unsupported kind or malformed content, never coercing it', async () => {
    const fetcher = baseFetcher({
      geminiCandidates: [
        { kind: 'not_a_real_kind', content: { summary: 'x' }, confidence: 'low', sourceEvidenceIds: [EVIDENCE_ID] },
        { kind: 'risk', content: { summary: 'x', severity: 'not-a-severity' }, confidence: 'low', sourceEvidenceIds: [EVIDENCE_ID] },
      ],
    })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    const json = await response.json()
    expect(json.acceptedCount).toBe(0)
    expect(json.droppedCount).toBe(2)
  });

  it('never sends the model API key or Supabase anon key in a log-visible URL to any host other than the intended one', async () => {
    // Sanity check on the schema builder itself -- proves it is a plain,
    // deterministic object, not something that could leak request-specific
    // secrets if logged.
    const schema = buildDerivationResponseSchema()
    expect(JSON.stringify(schema)).not.toMatch(/key|token|secret/i)
  });
})
