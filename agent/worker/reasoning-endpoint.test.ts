import { describe, expect, it, vi } from 'vitest'
import {
  buildReasoningResponseSchema,
  handleLocalReasoningRequest,
  resolveLocalReasoningConfig,
  type LocalReasoningEnv,
} from './reasoning-endpoint'
import { writeIntentRegistry } from '../../shared/writeIntentRegistry'

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

function modelResponse(proposal: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    candidates: [{
      finishReason: 'STOP',
      content: {
        parts: [{
          text: JSON.stringify({
            type: 'inspect_tasks',
            confidence: 'high',
            requestedDomain: 'tasks',
            reasons: ['The request asks to inspect active tasks.'],
            language: 'en',
            ...proposal,
          }),
        }],
      },
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function successfulFetcher(proposal: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === 'http://127.0.0.1:54321/auth/v1/user') {
      return new Response(JSON.stringify({ id: 'local-user-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      return modelResponse(proposal)
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

// Task 36c, ADR-0013 Slice 2: a loop guard alongside the derivation itself
// (SUPPORTED_DOMAIN_VALUES now splices writeIntentRegistry.map(e =>
// e.domain), deduped) -- same it.each(writeIntentRegistry...) pattern task
// 29-fix/task 36b established elsewhere. Calls buildReasoningResponseSchema
// directly rather than going through the full HTTP handler, since this is
// checking the schema's own shape, not request handling.
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
    const fetcher = successfulFetcher()
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
    const fetcher = successfulFetcher()
    const response = await handleLocalReasoningRequest(request, validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(400)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not require a service-role key and makes one auth plus one model request', async () => {
    const fetcher = successfulFetcher()
    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125),
      logger: { info: vi.fn() },
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('generativelanguage')).length).toBe(1)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/rest/v1/'))).toBe(false)
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

    const modelInit = fetcher.mock.calls[1]?.[1] as RequestInit
    const modelBody = JSON.parse(String(modelInit.body)) as {
      generationConfig: {
        responseMimeType: string
        responseSchema: { properties: Record<string, unknown> }
      }
    }
    expect(modelBody.generationConfig.responseMimeType).toBe('application/json')
    expect(modelBody.generationConfig.responseSchema.properties).toHaveProperty('type')
    expect(modelBody.generationConfig.responseSchema.properties).not.toHaveProperty('toolId')
    const candidatesSchema = modelBody.generationConfig.responseSchema.properties.candidates as {
      items: { properties: Record<string, unknown> }
    }
    expect(modelBody.generationConfig.responseSchema.properties.candidates).toMatchObject({
      type: 'ARRAY',
      minItems: 2,
      maxItems: 6,
      items: {
        type: 'OBJECT',
        required: ['type', 'reasons'],
      },
    })
    expect(candidatesSchema.items.properties).not.toHaveProperty('toolId')
  })

  it('sends the bearer token only to local Supabase Auth', async () => {
    const fetcher = successfulFetcher()
    await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    const authInit = fetcher.mock.calls[0]?.[1] as RequestInit
    const modelInit = fetcher.mock.calls[1]?.[1] as RequestInit
    expect(authInit.headers).toMatchObject({ Authorization: 'Bearer local-user-token' })
    expect(JSON.stringify(modelInit)).not.toContain('local-user-token')
    expect(JSON.stringify(modelInit)).not.toContain('local-anon-key')
  })

  it('fails before model execution when the Gemini key is absent', async () => {
    const fetcher = successfulFetcher()
    const response = await handleLocalReasoningRequest(
      reasoningRequest(),
      { ...validEnv, GEMINI_API_KEY: undefined },
      { fetcher: fetcher as unknown as typeof fetch },
    )

    expect(response.status).toBe(503)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails closed on malformed or unknown model output', async () => {
    const malformedFetcher = successfulFetcher({ type: 'delete_everything' })
    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: malformedFetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(502)
  })

  it('accepts a well-formed disambiguation candidates array', async () => {
    const fetcher = successfulFetcher({
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
    const fetcher = successfulFetcher(override)
    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(502)
  })

  it.each([
    ['malformed JSON', '{bad-json', 'STOP'],
    ['Markdown-fenced JSON', '```json\n{"type":"inspect_tasks"}\n```', 'STOP'],
    ['truncated JSON', '{"type":"inspect_tasks"', 'MAX_TOKENS'],
  ])('fails closed on %s without retry', async (_label, text, finishReason) => {
    const fetcher = successfulFetcher()
    fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ id: 'local-user-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })).mockImplementationOnce(async () => new Response(JSON.stringify({
      candidates: [{ finishReason, content: { parts: [{ text }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(502)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['empty candidates', { candidates: [] }],
    ['empty content', { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }],
    ['blocked response', { candidates: [{ finishReason: 'SAFETY' }] }],
  ])('fails closed on %s', async (_label, providerBody) => {
    const fetcher = successfulFetcher()
    fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ id: 'local-user-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })).mockImplementationOnce(async () => new Response(JSON.stringify(providerBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(502)
    expect(fetcher).toHaveBeenCalledTimes(2)
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
    const fetcher = successfulFetcher(extraField)
    const response = await handleLocalReasoningRequest(reasoningRequest(), validEnv, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(response.status).toBe(502)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('keeps unsupported as a bounded proposal', async () => {
    const fetcher = successfulFetcher({
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
    const fetcher = successfulFetcher({ language: proposalLanguage })
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
