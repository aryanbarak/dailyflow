import { describe, expect, it, vi } from 'vitest'
import { handleContextDerivationRequest, buildDerivationResponseSchema, type ContextDerivationEnv } from './context-derivation-endpoint'
import { ProviderRequestError } from './provider-errors'
// ADR-0018 S4: endpoint tests mock the STRUCTURED_GEN interface, not
// Gemini's wire format -- Gemini's own envelope (URL/key, generationConfig,
// role mapping, thinkingConfig conditionality, finishReason mapping) is
// tested in exactly one place now: GeminiStructuredGenerationProvider.test.ts.
// This file only asserts what THIS endpoint does with a
// StructuredGenerationResult (or a thrown provider error) -- status codes,
// DB writes, candidate filtering, the honest-failure taxonomy.
import { StubStructuredGenerationProvider, stubProviders } from './providers/testing/stubProviders'
import type { Providers } from './providers/createProviders'
import type { StructuredGenerationRequest, StructuredGenerationResult } from './providers/types'

let currentProviders: Providers = stubProviders()
vi.mock('./providers/createProviders', () => ({
  createProviders: () => currentProviders,
}))

const ORIGIN = 'https://smartflow.example'
const SUPABASE_URL = 'https://supabase.example.co'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const EVIDENCE_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const AUTHENTICATED_USER_ID = 'user-1'

// Task 10-fix regression guard: every column below is NOT NULL with no
// default/trigger on public.inferred_context_derivation_runs (see
// supabase/migrations/20260807000000_inferred_project_context_fields.sql,
// table definition -- id has default gen_random_uuid() and is excluded;
// candidate_count/accepted_count/dropped_count default to 0 and are also
// excluded). Task 10-diag found the identical insert-omission bug here as in
// personal-memory-extraction-endpoint.ts's own runs table: user_id was
// destructured out of authResult but never sent. This list is checked
// against the ACTUAL body the endpoint sends on every baseFetcher-mediated
// runs-table insert below, so dropping any of these fields again fails the
// moment any existing test exercises that insert -- not just a single
// dedicated test.
const REQUIRED_RUN_INSERT_FIELDS = ['user_id', 'project_id', 'model_identity', 'derivation_version', 'started_at'] as const

function assertRunInsertBodyIsComplete(body: unknown): void {
  const record = body as Record<string, unknown> | null
  const missing = REQUIRED_RUN_INSERT_FIELDS.filter((field) => record?.[field] === undefined || record?.[field] === null)
  if (missing.length > 0) {
    throw new Error(
      `inferred_context_derivation_runs insert is missing required NOT NULL field(s): ${missing.join(', ')}. ` +
        'See supabase/migrations/20260807000000_inferred_project_context_fields.sql for the table definition.',
    )
  }
}

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

/** The StructuredGenerationResult a real GeminiStructuredGenerationProvider would hand back on a successful derivation call -- rawText only, exactly what modelJsonParsing.ts (called inside the endpoint) actually consumes. */
function structuredResult(candidates: Array<Record<string, unknown>>): StructuredGenerationResult {
  return { rawText: JSON.stringify({ candidates }), finishReason: 'stop', usage: { promptTokens: 100, responseTokens: 50 } }
}

function structuredProviderFor(geminiCandidates: Array<Record<string, unknown>>): StubStructuredGenerationProvider {
  return new StubStructuredGenerationProvider(() => structuredResult(geminiCandidates))
}

function baseFetcher(overrides: {
  evidence?: Array<Record<string, unknown>>
  observations?: Array<Record<string, unknown>>
  onRpc?: (body: unknown) => void
} = {}) {
  const evidence = overrides.evidence ?? [
    { id: EVIDENCE_ID, source_kind: 'architecture_document', classification: 'canonical_document_observation', title: 'Architecture', reference: 'docs/architecture/project-domain.md', collected_at: '2026-08-01T00:00:00.000Z', supersedes_id: null },
  ]
  const observations = overrides.observations ?? [{ evidence_id: EVIDENCE_ID, text_content: 'The project has one high risk: a single point of failure in auth.' }]

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
      assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
      return jsonResponse([{ id: RUN_ID }])
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/inferred_context_derivation_runs?`) && init?.method === 'PATCH') {
      return new Response(null, { status: 204 })
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
    currentProviders = stubProviders({ structured: structuredProviderFor([]) })
    const fetcher = baseFetcher({
      evidence: [
        { id: EVIDENCE_ID, source_kind: 'architecture_document', classification: 'canonical_document_observation', title: 'New', reference: 'a.md', collected_at: '2026-08-01T00:00:00.000Z', supersedes_id: 'superseded-id' },
      ],
      observations: [{ evidence_id: EVIDENCE_ID, text_content: 'Current text.' }],
    })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    const json = await response.json()
    expect(json.evidenceCount).toBe(1)
  });

  it('a full successful run: authenticates, reads evidence, calls Gemini, persists one valid candidate, and completes the run', async () => {
    currentProviders = stubProviders({
      structured: structuredProviderFor([{ kind: 'risk', content: { summary: 'Single point of failure in auth', severity: 'high' }, confidence: 'medium', sourceEvidenceIds: [EVIDENCE_ID] }]),
    })
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

  // Task PA-02 (provider-coupling-audit-v1.md §4): this endpoint previously
  // had NO fence-stripping at all -- a markdown-fenced Gemini response
  // failed outright with MODEL_OUTPUT_UNUSABLE regardless of how complete
  // or well-formed the JSON inside the fence was. parseModelJsonObject
  // (agent/worker/modelJsonParsing.ts) now strips it, same as
  // personal-memory-extraction-endpoint.ts already did. This is the
  // positive proof of that intentional, small behavior change -- exercised
  // here via a StructuredGenerationResult.rawText that IS fenced, exactly
  // what the real adapter would hand back verbatim from Gemini.
  it('succeeds on a markdown-fenced derivation response (previously rejected outright with no fence-stripping)', async () => {
    const candidates = [{ kind: 'risk', content: { summary: 'Single point of failure in auth', severity: 'high' }, confidence: 'medium', sourceEvidenceIds: [EVIDENCE_ID] }]
    currentProviders = stubProviders({
      structured: new StubStructuredGenerationProvider(() => ({
        rawText: '```json\n' + JSON.stringify({ candidates }) + '\n```',
        finishReason: 'stop',
      })),
    })
    const fetcher = baseFetcher()
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher, now: () => '2026-08-07T00:00:00.000Z' })
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.candidateCount).toBe(1)
    expect(json.acceptedCount).toBe(1)
    expect(json.droppedCount).toBe(0)
  })

  it('REGRESSION GUARD (task 10-fix): the runs-table insert includes user_id equal to the authenticated user, plus every other NOT NULL column -- catches the task 10-diag bug (userId destructured but discarded, user_id never sent) if it is ever reintroduced', async () => {
    currentProviders = stubProviders({ structured: structuredProviderFor([]) })
    let insertBody: Record<string, unknown> | null = null
    const inner = baseFetcher()
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/rest/v1/inferred_context_derivation_runs` && init?.method === 'POST') {
        insertBody = init.body ? JSON.parse(init.body as string) : null
      }
      return inner(input, init)
    })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    expect(insertBody).not.toBeNull()
    for (const field of REQUIRED_RUN_INSERT_FIELDS) {
      expect(insertBody).toHaveProperty(field)
    }
    expect(insertBody?.user_id).toBe(AUTHENTICATED_USER_ID)
  })

  it('drops a candidate that cites an evidence id outside this run\'s evidence set, never persisting it', async () => {
    currentProviders = stubProviders({
      structured: structuredProviderFor([{ kind: 'risk', content: { summary: 'Invented risk', severity: 'high' }, confidence: 'high', sourceEvidenceIds: ['not-a-real-evidence-id'] }]),
    })
    const rpcCalls: unknown[] = []
    const fetcher = baseFetcher({ onRpc: (body) => rpcCalls.push(body) })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    const json = await response.json()
    expect(json.acceptedCount).toBe(0)
    expect(json.droppedCount).toBe(1)
    expect(rpcCalls).toHaveLength(0);
  });

  it('drops a candidate with an unsupported kind or malformed content, never coercing it', async () => {
    currentProviders = stubProviders({
      structured: structuredProviderFor([
        { kind: 'not_a_real_kind', content: { summary: 'x' }, confidence: 'low', sourceEvidenceIds: [EVIDENCE_ID] },
        { kind: 'risk', content: { summary: 'x', severity: 'not-a-severity' }, confidence: 'low', sourceEvidenceIds: [EVIDENCE_ID] },
      ]),
    })
    const fetcher = baseFetcher()
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    const json = await response.json()
    expect(json.acceptedCount).toBe(0)
    expect(json.droppedCount).toBe(2)
  });

  it('never sends the model API key or Supabase anon key in a log-visible URL to any host other than the intended one', async () => {
    // Sanity check on the schema builder itself -- proves it is a plain,
    // deterministic object, not something that could leak request-specific
    // secrets if logged. Not a Gemini wire-format assertion (this is the
    // NEUTRAL schema, pre-translation) and doesn't touch any provider --
    // unaffected by the S4 migration.
    const schema = buildDerivationResponseSchema()
    expect(JSON.stringify(schema)).not.toMatch(/key|token|secret/i)
  });

  it('task 14 fix: buildDerivationResponseSchema never sets maxItems on the outer candidates array -- regression lock for the same production-400 root cause diagnosed in personal-memory-extraction-endpoint.ts (identical schema shape, identical provider rejection)', () => {
    const schema = buildDerivationResponseSchema() as { properties: { candidates: { maxItems?: number; items: { properties: { sourceEvidenceIds: { minItems?: number; maxItems?: number } } } } } }
    expect(schema.properties.candidates.maxItems).toBeUndefined()
    expect(schema.properties.candidates.items.properties.sourceEvidenceIds.minItems).toBe(1)
    expect(schema.properties.candidates.items.properties.sourceEvidenceIds.maxItems).toBe(20)
  });

  it('task 14 fix: MAX_CANDIDATES_PER_RUN is still enforced in code even though the schema no longer bounds it', async () => {
    const manyCandidates = Array.from({ length: 15 }, (_, i) => ({
      kind: 'risk',
      content: { summary: `Risk number ${i}`, severity: 'high' },
      confidence: 'medium',
      sourceEvidenceIds: [EVIDENCE_ID],
    }))
    currentProviders = stubProviders({ structured: structuredProviderFor(manyCandidates) })
    const fetcher = baseFetcher()
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.candidateCount).toBe(12)
    expect(json.acceptedCount).toBe(12)
  });

  it('task 14 fix: a provider 4xx response is reported as PROVIDER_REQUEST_REJECTED with the provider\'s own (truncated) detail in the response body -- this route is owner-only (authenticateUser requires a valid bearer token)', async () => {
    currentProviders = stubProviders({
      structured: new StubStructuredGenerationProvider(() => {
        throw new ProviderRequestError(
          'Gemini structured generation error: {"error":{"code":400,"message":"The specified schema produces a constraint that has too many states for serving.","status":"INVALID_ARGUMENT"}}',
          400,
          '{"error":{"code":400,"message":"The specified schema produces a constraint that has too many states for serving.","status":"INVALID_ARGUMENT"}}',
        )
      }),
    })
    const fetcher = baseFetcher()
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: { code: string; providerStatus?: number; providerDetail?: string } }
    expect(body.error.code).toBe('PROVIDER_REQUEST_REJECTED')
    expect(body.error.providerStatus).toBe(400)
    expect(body.error.providerDetail).toMatch(/too many states for serving/i)
  });

  it('task 14 fix: REDACTION GUARD -- the provider API key and the full request URL/query-string never appear in any logged output', async () => {
    // The URL/key never even reach this endpoint's own code any more (the
    // adapter owns request construction internally, S2) -- so there is
    // nothing here for this test to accidentally leak. The wire-level
    // "the URL the adapter builds actually contains the key" fact is
    // GeminiStructuredGenerationProvider.test.ts's own "builds the URL from
    // GEMINI_MODEL/GEMINI_API_KEY" test, not this file's concern any more.
    currentProviders = stubProviders({
      structured: new StubStructuredGenerationProvider(() => {
        throw new ProviderRequestError(
          'Gemini structured generation error: {"error":{"code":400,"message":"The specified schema produces a constraint that has too many states for serving.","status":"INVALID_ARGUMENT"}}',
          400,
          '{"error":{"code":400,"message":"The specified schema produces a constraint that has too many states for serving.","status":"INVALID_ARGUMENT"}}',
        )
      }),
    })
    const logged: string[] = []
    const fakeLogger = { info: (..._args: unknown[]) => {}, error: (...args: unknown[]) => { logged.push(args.map(String).join(' ')) } }
    const fetcher = baseFetcher()
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher, logger: fakeLogger })
    expect(response.status).toBe(502)
    expect(logged.length).toBeGreaterThan(0)
    const fullLog = logged.join('\n')
    expect(fullLog).not.toContain('gemini-key')
    expect(fullLog).not.toContain('key=')
    expect(fullLog).not.toContain('generateContent?')
    expect(fullLog).toContain('generateContent')
  });

  // MIG-01b: the task R-3 fix this replaced (gemini-2.5-flash spending
  // output tokens on internal thinking by default) required
  // thinkingConfig:{thinkingBudget:0}; gemini-3.6-flash returns 400
  // INVALID_ARGUMENT on that same field, so it is no longer sent at all.
  // The WIRE-level fact ("the adapter never sends thinkingConfig unless
  // providerOptions asks for it") is GeminiStructuredGenerationProvider
  // .test.ts's own "includes generationConfig.thinkingConfig ONLY when..."
  // test -- this one instead asserts the CALL-SITE-level fact: this
  // endpoint's own request to the adapter never asks for it, which is what
  // actually matters for this endpoint to keep working against
  // gemini-3.6-flash.
  it('MIG-01b: never asks the provider for thinkingConfig -- gemini-3.6-flash rejects it (400 INVALID_ARGUMENT) if the adapter is ever asked to send it', async () => {
    let capturedRequest: StructuredGenerationRequest | null = null
    currentProviders = stubProviders({
      structured: new StubStructuredGenerationProvider((req) => {
        capturedRequest = req
        return structuredResult([])
      }),
    })
    const fetcher = baseFetcher()
    await handleContextDerivationRequest(request(), validEnv, { fetcher })
    expect((capturedRequest as StructuredGenerationRequest | null)?.providerOptions?.thinkingConfig).toBeUndefined()
  });

  it('task R-3 fixture: a MAX_TOKENS-truncated response is reported with that specific finishReason, mapped to MODEL_OUTPUT_UNUSABLE (2xx-but-unusable) rather than a provider error -- parity with personal-memory-extraction-endpoint.ts\'s identical task 12 fix', async () => {
    currentProviders = stubProviders({
      structured: new StubStructuredGenerationProvider(() => ({
        rawText: '{"candidates":[{"kind":"ri',
        finishReason: 'length',
        rawFinishReason: 'MAX_TOKENS',
      })),
    })
    const patchCalls: unknown[] = []
    const logged: string[] = []
    const fakeLogger = { info: (..._args: unknown[]) => {}, error: (...args: unknown[]) => { logged.push(args.map(String).join(' ')) } }
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${SUPABASE_URL}/auth/v1/user`) return jsonResponse({ id: 'user-1' })
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_records?`)) return jsonResponse([{ id: PROJECT_ID, name: 'SmartFlow', status: 'active' }])
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_evidence?`)) {
        return jsonResponse([{ id: EVIDENCE_ID, source_kind: 'architecture_document', classification: 'canonical_document_observation', title: 'Architecture', reference: 'docs/architecture/project-domain.md', collected_at: '2026-08-01T00:00:00.000Z', supersedes_id: null }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/project_evidence_observations?`)) return jsonResponse([{ evidence_id: EVIDENCE_ID, text_content: 'text' }])
      if (url === `${SUPABASE_URL}/rest/v1/inferred_context_derivation_runs` && init?.method === 'POST') {
        assertRunInsertBodyIsComplete(init.body ? JSON.parse(init.body as string) : null)
        return jsonResponse([{ id: RUN_ID }])
      }
      if (url.startsWith(`${SUPABASE_URL}/rest/v1/inferred_context_derivation_runs?`) && init?.method === 'PATCH') {
        patchCalls.push(init.body ? JSON.parse(init.body as string) : null)
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher, logger: fakeLogger })
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('MODEL_OUTPUT_UNUSABLE')
    const patch = patchCalls[0] as { failure_reason: string }
    expect(patch.failure_reason).toMatch(/did not finish safely/i)
    expect(patch.failure_reason).toMatch(/MAX_TOKENS/)
    // Redaction guard: this new finishReason log line must never leak the
    // provider API key, mirroring the existing REDACTION GUARD test below.
    expect(logged.length).toBeGreaterThan(0)
    const fullLog = logged.join('\n')
    expect(fullLog).not.toContain('gemini-key')
    expect(fullLog).not.toContain('key=')
    expect(fullLog).toMatch(/did not finish safely/i)
  });

  it('task R-3 fixture: a response blocked for safety (finishReason SAFETY) is reported as MODEL_OUTPUT_UNUSABLE, never a provider error -- the request itself succeeded', async () => {
    currentProviders = stubProviders({
      structured: new StubStructuredGenerationProvider(() => ({
        rawText: '',
        finishReason: 'other',
        rawFinishReason: 'SAFETY',
      })),
    })
    const fetcher = baseFetcher()
    const response = await handleContextDerivationRequest(request(), validEnv, { fetcher })
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('MODEL_OUTPUT_UNUSABLE')
  });
})
