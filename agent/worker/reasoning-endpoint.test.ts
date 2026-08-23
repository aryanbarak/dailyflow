import { describe, expect, it, vi } from 'vitest'
import {
  buildReasoningResponseSchema,
  handleLocalReasoningRequest,
  resolveLocalReasoningConfig,
  type LocalReasoningEnv,
} from './reasoning-endpoint'
import { writeIntentRegistry } from '../../shared/writeIntentRegistry'
// ADR-0018 S4: the model call (callGeminiOnce, S2) is mocked at the
// STRUCTURED_GEN interface now, not Gemini's wire format -- Gemini's own
// envelope (responseMimeType/responseSchema always present, URL/key,
// finishReason mapping) is GeminiStructuredGenerationProvider.test.ts's
// coverage; the EXACT translated schema shape for this endpoint's own
// buildReasoningResponseSchema is shared/reasoningResponseSchema.purity
// .test.ts's byte-identical snapshot proof (ADR-0018 S2). This file only
// asserts what THIS endpoint does with a StructuredGenerationResult --
// status codes, proposal validation, the fail-closed paths.
import { StubStructuredGenerationProvider, stubProviders } from './providers/testing/stubProviders'
import type { Providers } from './providers/createProviders'
import type { StructuredGenerationRequest, StructuredGenerationResult } from './providers/types'

let currentProviders: Providers = stubProviders()
vi.mock('./providers/createProviders', () => ({
  createProviders: () => currentProviders,
}))

const origin = 'http://127.0.0.1:8080'
const validEnv: LocalReasoningEnv = {
  SMARTFLOW_WORKER_MODE: 'local-qa',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'local-anon-key',
  GEMINI_API_KEY: 'local-model-key',
  GEMINI_MODEL: 'gemini-2.5-flash',
}

function reasoningRequest(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Request('http://127.0.0.1:8787/agent/reason', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer local-user-token',
      'Origin': origin,
      ...headers,
    },
    body: JSON.stringify({
      requestId: 'reasoning:test-1',
      reasoningPrompt: 'Return JSON for an inspect_tasks proposal.',
      responseLanguage: 'en',
      ...body,
    }),
  })
}

/** The StructuredGenerationResult a real GeminiStructuredGenerationProvider would hand back on a successful reasoning call. */
function structuredResultFor(proposal: Record<string, unknown> = {}): StructuredGenerationResult {
  return {
    rawText: JSON.stringify({
      type: 'inspect_tasks',
      confidence: 'high',
      requestedDomain: 'tasks',
      reasons: ['The request asks to inspect active tasks.'],
      language: 'en',
      ...proposal,
    }),
    finishReason: 'stop',
  }
}

/** Configures the structured-gen stub for a successful model call AND returns an auth-only fetcher -- callGeminiOnce (S2) no longer reaches fetch at all, so the only real HTTP call left in this endpoint's happy path is Supabase Auth. */
function setupSuccessfulRun(proposal: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  currentProviders = stubProviders({ structured: new StubStructuredGenerationProvider(() => structuredResultFor(proposal)) })
  return authOnlyFetcher()
}

function authOnlyFetcher() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === 'http://127.0.0.1:54321/auth/v1/user') {
      return new Response(JSON.stringify({ id: 'local-user-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

// Task 36c, ADR-0013 Slice 2: a loop guard alongside the derivation itself
// (SUPPORTED_DOMAIN_VALUES now splices writeIntentRegistry.map(e =>
// e.domain), deduped) -- same it.each(writeIntentRegistry...) pattern task
// 29-fix/task 36b established elsewhere. Calls buildReasoningResponseSchema
// directly rather than going through the full HTTP handler, since this is
// checking the schema's own shape, not request handling. Unaffected by the
// S4 migration -- no fetch/provider involved.
describe('buildReasoningResponseSchema requestedDomain enum (task 36c)', () => {
  it.each(writeIntentRegistry.map((entry) => entry.domain))(
    'includes registry domain %s',
    (domain) => {
      const schema = buildReasoningResponseSchema()
      expect(schema.properties.requestedDomain.enum).toContain(domain)
    },
  )
})

describe('local reasoning configuration', () => {
  it('accepts only explicit complete local configuration', () => {
    expect(resolveLocalReasoningConfig(validEnv, { requireGemini: true })).toMatchObject({
      mode: 'local-qa',
      supabaseUrl: 'http://127.0.0.1:54321',
      supabaseAnonKey: 'local-anon-key',
      geminiModel: 'gemini-2.5-flash',
    })
  })

  it.each([
    ['missing mode', { ...validEnv, SMARTFLOW_WORKER_MODE: undefined }],
    ['missing Supabase URL', { ...validEnv, SUPABASE_URL: undefined }],
    ['missing anon key', { ...validEnv, SUPABASE_ANON_KEY: undefined }],
    ['non-loopback URL', { ...validEnv, SUPABASE_URL: 'https://example.supabase.co' }],
    ['deceptive localhost', { ...validEnv, SUPABASE_URL: 'http://localhost.example.com:54321' }],
    ['embedded username', { ...validEnv, SUPABASE_URL: 'http://user@127.0.0.1:54321' }],
    ['embedded password', { ...validEnv, SUPABASE_URL: 'http://user:pass@127.0.0.1:54321' }],
    ['path', { ...validEnv, SUPABASE_URL: 'http://127.0.0.1:54321/rest/v1' }],
    ['query', { ...validEnv, SUPABASE_URL: 'http://127.0.0.1:54321?x=1' }],
    ['hash', { ...validEnv, SUPABASE_URL: 'http://127.0.0.1:54321#x' }],
    ['malformed URL', { ...validEnv, SUPABASE_URL: 'not-a-url' }],
  ])('rejects %s without production fallback', (_label, env) => {
    expect(() => resolveLocalReasoningConfig(env)).toThrow()
  })

  it('requires the model credential only at the model-call boundary', () => {
    const env = { ...validEnv, GEMINI_API_KEY: undefined }
    expect(() => resolveLocalReasoningConfig(env)).not.toThrow()
    expect(() => resolveLocalReasoningConfig(env, { requireGemini: true })).toThrow(/GEMINI_API_KEY/)
  })
})

describe('POST /agent/reason', () => {
  it('answers local preflight without authentication or model execution', async () => {
    const response = await handleLocalReasoningRequest(new Request(
      'http://127.0.0.1:8787/agent/reason',
      { method: 'OPTIONS', headers: { Origin: origin } },
    ), {})

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
  })

  it('rejects wrong methods', async () => {
    const response = await handleLocalReasoningRequest(new Request(
      'http://127.0.0.1:8787/agent/reason',
      { method: 'GET', headers: { Origin: origin } },
    ), validEnv)

    expect(response.status).toBe(405)
  })

  it('rejects missing and invalid bearer tokens', async () => {
    const noAuth = reasoningRequest({}, { Authorization: '' })
    const noAuthResponse = await handleLocalReasoningRequest(noAuth, validEnv)
    expect(noAuthResponse.status).toBe(401)

    const fetcher = vi.fn(async () => new Response('{}', { status: 401 }))
    const invalidResponse = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(invalidResponse.status).toBe(401)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['wrong content type', reasoningRequest({}, { 'Content-Type': 'text/plain' }), 415],
    ['invalid response language', reasoningRequest({ responseLanguage: 'fr' }), 400],
    ['unknown security field', reasoningRequest({ userId: 'forged-user' }), 400],
    ['oversized prompt', reasoningRequest({ reasoningPrompt: 'x'.repeat(24_001) }), 400],
  ])('rejects %s', async (_label, request, status) => {
    const fetcher = setupSuccessfulRun()
    const response = await handleLocalReasoningRequest(request, validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(response.status).toBe(status)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed JSON', async () => {
    const request = new Request('http://127.0.0.1:8787/agent/reason', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer local-user-token',
        'Origin': origin,
      },
      body: '{bad-json',
    })
    const fetcher = setupSuccessfulRun()
    const response = await handleLocalReasoningRequest(request, validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(400)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not require a service-role key and makes one auth call plus one model request -- the model request never touches fetch (goes through the StructuredGenerationProvider interface) and carries this endpoint\'s own real schema builder output', async () => {
    let capturedRequest: StructuredGenerationRequest | null = null
    currentProviders = stubProviders({
      structured: new StubStructuredGenerationProvider((req) => {
        capturedRequest = req
        return structuredResultFor()
      }),
    })
    const fetcher = authOnlyFetcher()
    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125),
      logger: { info: vi.fn() },
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1) // Supabase Auth only
    expect(body).toMatchObject({
      requestId: 'reasoning:test-1',
      responseLanguage: 'en',
      proposal: {
        type: 'inspect_tasks',
        confidence: 'high',
        requestedDomain: 'tasks',
        language: 'en',
      },
    })
    const proposal = body.proposal as Record<string, unknown>
    expect(proposal).not.toHaveProperty('toolId')
    expect(proposal).not.toHaveProperty('requiresApproval')
    expect(proposal).not.toHaveProperty('userId')

    // Gemini's own translated wire schema (responseSchema shape,
    // responseMimeType) is GeminiStructuredGenerationProvider.test.ts's
    // envelope coverage plus shared/reasoningResponseSchema.purity.test.ts's
    // byte-identical snapshot proof (ADR-0018 S2) -- this instead proves
    // the CALL SITE passes the real, unmodified schema builder output.
    const req = capturedRequest as StructuredGenerationRequest | null
    expect(req?.schema).toEqual(buildReasoningResponseSchema())
    expect(req?.maxOutputTokens).toBe(2048)
    expect(req?.temperature).toBe(0)
  })

  it('sends the bearer token only to local Supabase Auth -- never into the model request', async () => {
    let capturedRequest: StructuredGenerationRequest | null = null
    currentProviders = stubProviders({
      structured: new StubStructuredGenerationProvider((req) => {
        capturedRequest = req
        return structuredResultFor()
      }),
    })
    const fetcher = authOnlyFetcher()
    await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    const authInit = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(authInit.headers).toMatchObject({ Authorization: 'Bearer local-user-token' })
    const serializedModelRequest = JSON.stringify(capturedRequest)
    expect(serializedModelRequest).not.toContain('local-user-token')
    expect(serializedModelRequest).not.toContain('local-anon-key')
  })

  it('fails before model execution when the Gemini key is absent', async () => {
    const fetcher = setupSuccessfulRun()
    const response = await handleLocalReasoningRequest(
      reasoningRequest(),
      { ...validEnv, GEMINI_API_KEY: undefined },
      { fetcher: fetcher as unknown as typeof fetch },
    )

    expect(response.status).toBe(503)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails closed on malformed or unknown model output', async () => {
    const fetcher = setupSuccessfulRun({ type: 'delete_everything' })
    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(502)
  })

  it('accepts a well-formed disambiguation candidates array', async () => {
    const fetcher = setupSuccessfulRun({
      type: 'ask_clarification',
      candidates: [
        { type: 'inspect_github_issues', reasons: ['Message names a connected repository.'] },
        { type: 'inspect_github_pull_requests', reasons: ['Could also mean open pull requests.'] },
      ],
    })
    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.proposal).toMatchObject({
      type: 'ask_clarification',
      candidates: [
        { type: 'inspect_github_issues', reasons: ['Message names a connected repository.'] },
        { type: 'inspect_github_pull_requests', reasons: ['Could also mean open pull requests.'] },
      ],
    })
  })

  it.each([
    ['unsupported candidate type', { candidates: [{ type: 'delete_everything', reasons: ['x'] }] }],
    ['candidate with an extra field', { candidates: [{ type: 'inspect_github_issues', reasons: ['x'], toolId: 'github.issues.list' }] }],
    ['candidate with no reasons', { candidates: [{ type: 'inspect_github_issues', reasons: [] }] }],
    ['empty candidates array', { candidates: [] }],
    ['too many candidates', { candidates: Array.from({ length: 7 }, () => ({ type: 'inspect_github_issues', reasons: ['x'] })) }],
  ])('fails closed on %s', async (_label, override) => {
    const fetcher = setupSuccessfulRun(override)
    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(502)
  })

  // Task PA-02: parseModelJsonObject (agent/worker/modelJsonParsing.ts) now
  // strips a wrapping ```json fence before the shape check, so the
  // "Markdown-fenced JSON" case below no longer fails AT JSON-PARSING --
  // it parses successfully to `{"type":"inspect_tasks"}`, then fails
  // normalizeProposal's schema validation instead (missing the required
  // `confidence`/`reasons` fields). Still 502, still no retry -- this is
  // exactly the "small, intentional" behavior change PA-02 describes: the
  // endpoint becomes fence-tolerant, but a fenced-yet-otherwise-incomplete
  // proposal still fails closed, just one step later than before.
  it.each([
    ['malformed JSON', '{bad-json', 'stop' as const],
    ['Markdown-fenced JSON', '```json\n{"type":"inspect_tasks"}\n```', 'stop' as const],
    ['truncated JSON', '{"type":"inspect_tasks"', 'length' as const],
  ])('fails closed on %s without retry', async (_label, rawText, finishReason) => {
    currentProviders = stubProviders({ structured: new StubStructuredGenerationProvider(() => ({ rawText, finishReason })) })
    const fetcher = authOnlyFetcher()

    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(502)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  // Task PA-02: the actual positive proof of the intentional behavior
  // change -- unlike the "Markdown-fenced JSON" case above (which is
  // fenced but otherwise INCOMPLETE, so it still fails, just later), this
  // proposal is fenced AND complete, so it now succeeds end-to-end. Before
  // this task, no fenced response -- complete or not -- could ever reach
  // normalizeProposal at all.
  it('succeeds on a markdown-fenced, otherwise-complete proposal (parseModelJsonObject strips the fence)', async () => {
    const proposal = { type: 'inspect_tasks', confidence: 'high', requestedDomain: 'tasks', reasons: ['The request asks to inspect active tasks.'], language: 'en' }
    currentProviders = stubProviders({
      structured: new StubStructuredGenerationProvider(() => ({
        rawText: '```json\n' + JSON.stringify(proposal) + '\n```',
        finishReason: 'stop',
      })),
    })
    const fetcher = authOnlyFetcher()

    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })
    const body = await response.json() as { proposal: { type: string } }

    expect(response.status).toBe(200)
    expect(body.proposal.type).toBe('inspect_tasks')
  })

  it.each([
    ['empty candidates', '', 'stop' as const],
    ['empty content', '', 'stop' as const],
    ['blocked response', '', 'other' as const],
  ])('fails closed on %s', async (_label, rawText, finishReason) => {
    currentProviders = stubProviders({ structured: new StubStructuredGenerationProvider(() => ({ rawText, finishReason })) })
    const fetcher = authOnlyFetcher()

    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(502)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['tool authority', { toolId: 'tasks.list' }],
    ['approval authority', { requiresApproval: true }],
    // Task 36c, ADR-0013 Slice 2: this case used to be 'finance' -- that
    // stopped being a meaningful "unsupported domain" fixture the moment
    // SUPPORTED_DOMAIN_VALUES started deriving 'finance' from the registry
    // (ADR-0013's Context item 5 -- finance was always meant to be
    // supported here, just latently missing). 'shopping' is a real
    // SmartFlow feature domain (src/features/shopping/) with no write-
    // intent registry entry, so it keeps testing the same thing this case
    // always tested -- an actually-unsupported domain is rejected.
    ['unsupported domain', { requestedDomain: 'shopping' }],
    ['unexpected field', { arbitraryPayload: { execute: true } }],
  ])('rejects %s in model output', async (_label, extraField) => {
    const fetcher = setupSuccessfulRun(extraField)
    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(502)
  })

  it('keeps unsupported as a bounded proposal', async () => {
    const fetcher = setupSuccessfulRun({
      type: 'unsupported',
      reasons: ['The requested operation is not supported.'],
    })
    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })
    const body = await response.json() as { proposal: Record<string, unknown> }

    expect(response.status).toBe(200)
    expect(body.proposal.type).toBe('unsupported')
  })

  it.each(['en', 'de', 'fa', 'auto'])('honors response language %s', async (language) => {
    const proposalLanguage = language === 'auto' ? 'en' : language
    const fetcher = setupSuccessfulRun({ language: proposalLanguage })
    const response = await handleLocalReasoningRequest(
      reasoningRequest({ responseLanguage: language }),
      validEnv,
      { fetcher: fetcher as unknown as typeof fetch },
    )
    const body = await response.json() as {
      responseLanguage: string
      proposal: Record<string, unknown>
    }

    expect(response.status).toBe(200)
    expect(body.responseLanguage).toBe(language)
    expect(body.proposal.language).toBe(proposalLanguage)
  })
})
