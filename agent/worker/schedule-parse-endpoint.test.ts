// CORE-W5 (2026-09-06): the schedule-parse route -- auth, validation,
// structured model call, the extra server-side RRULE re-validation layer,
// and the error taxonomy.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./providers/createProviders', () => ({
  createProviders: vi.fn(),
}))

import { createProviders } from './providers/createProviders'
import {
  buildScheduleParseSystemInstruction,
  handleScheduleParseRequest,
  parseScheduleParseBody,
  validateModelResult,
} from './schedule-parse-endpoint'
import { ProviderUnavailableError } from './provider-errors'
import type { Env } from './types'

const env = {
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_ANON_KEY: 'anon-key',
} as unknown as Env

const generateStructured = vi.fn()
const logger = { info: vi.fn(), error: vi.fn() }

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    text: 'every Monday at 9am',
    currentTime: '2026-09-06T12:00:00.000Z',
    timeZone: 'Europe/Berlin',
    lang: 'en',
    granularity: 'datetime',
    ...overrides,
  }
}

function request(body: unknown, token = 'user-jwt') {
  return new Request('https://worker.example/schedule/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

function makeFetcher(authOk = true) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/auth/v1/user')) {
      return authOk
        ? new Response(JSON.stringify({ id: 'user-1' }), { status: 200 })
        : new Response('nope', { status: 401 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createProviders).mockReturnValue({
    structured: { id: 'gemini', generateStructured },
  } as unknown as ReturnType<typeof createProviders>)
})

describe('parseScheduleParseBody', () => {
  it('accepts a well-formed body and trims text', () => {
    expect(parseScheduleParseBody(validBody({ text: '  every Monday  ' }))).toEqual({
      text: 'every Monday',
      currentTime: '2026-09-06T12:00:00.000Z',
      timeZone: 'Europe/Berlin',
      lang: 'en',
      granularity: 'datetime',
    })
  })

  it('rejects missing/empty text, oversized text, bad currentTime, bad lang/granularity, and non-objects', () => {
    expect(parseScheduleParseBody(validBody({ text: '' }))).toBeNull()
    expect(parseScheduleParseBody(validBody({ text: 'x'.repeat(201) }))).toBeNull()
    expect(parseScheduleParseBody(validBody({ currentTime: 'not a date' }))).toBeNull()
    expect(parseScheduleParseBody(validBody({ timeZone: '' }))).toBeNull()
    expect(parseScheduleParseBody(validBody({ lang: 'fr' }))).toBeNull()
    expect(parseScheduleParseBody(validBody({ granularity: 'week' }))).toBeNull()
    expect(parseScheduleParseBody(null)).toBeNull()
  })
})

describe('validateModelResult', () => {
  it('accepts a recurring result with an rrule', () => {
    expect(validateModelResult({ kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO', label: 'Every Monday' })).toEqual({
      kind: 'recurring',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      label: 'Every Monday',
    })
  })

  it('rejects a recurring result missing rrule', () => {
    expect(validateModelResult({ kind: 'recurring', label: 'Every Monday' })).toBeNull()
  })

  it('accepts a one_time result with a valid startTime', () => {
    expect(validateModelResult({ kind: 'one_time', startTime: '2026-09-10T15:00:00.000Z', label: 'Sep 10' })).toEqual({
      kind: 'one_time',
      startTime: '2026-09-10T15:00:00.000Z',
      label: 'Sep 10',
    })
  })

  it('rejects a one_time result with an unparseable startTime', () => {
    expect(validateModelResult({ kind: 'one_time', startTime: 'whenever', label: 'x' })).toBeNull()
  })

  it('accepts a none result', () => {
    expect(validateModelResult({ kind: 'none', label: '' })).toEqual({ kind: 'none', label: '' })
  })

  it('rejects an unknown kind, a missing label, or a non-object', () => {
    expect(validateModelResult({ kind: 'other', label: 'x' })).toBeNull()
    expect(validateModelResult({ kind: 'none' })).toBeNull()
    expect(validateModelResult(null)).toBeNull()
  })
})

describe('buildScheduleParseSystemInstruction', () => {
  it('constrains the date-only granularity to never mention a specific time', () => {
    expect(buildScheduleParseSystemInstruction('date')).toMatch(/never include BYHOUR/)
  })

  it('the datetime granularity carries no such constraint', () => {
    expect(buildScheduleParseSystemInstruction('datetime')).not.toMatch(/never include BYHOUR/)
  })
})

describe('handleScheduleParseRequest', () => {
  it('returns null for unrelated paths', async () => {
    const req = new Request('https://worker.example/chat', { method: 'POST' })
    expect(await handleScheduleParseRequest(req, env, { fetcher: makeFetcher(), logger })).toBeNull()
  })

  it('401s without a valid Supabase session', async () => {
    const response = await handleScheduleParseRequest(request(validBody()), env, { fetcher: makeFetcher(false), logger })
    expect(response?.status).toBe(401)
  })

  it('400s on an invalid body', async () => {
    const response = await handleScheduleParseRequest(request({ nope: true }), env, { fetcher: makeFetcher(), logger })
    expect(response?.status).toBe(400)
  })

  it('parses a recurring phrase into a valid rrule', async () => {
    generateStructured.mockResolvedValue({
      rawText: JSON.stringify({ kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0', label: 'Every Monday at 9 AM' }),
      finishReason: 'stop',
    })
    const response = await handleScheduleParseRequest(request(validBody()), env, { fetcher: makeFetcher(), logger })
    expect(response?.status).toBe(200)
    const body = (await response?.json()) as { result: { kind: string; rrule: string } }
    expect(body.result).toEqual({ kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0', label: 'Every Monday at 9 AM' })
  })

  it('rejects a syntactically invalid rrule from the model, instead of forwarding it -- the extra validation layer beyond parseModelJsonObject', async () => {
    generateStructured.mockResolvedValue({
      rawText: JSON.stringify({ kind: 'recurring', rrule: 'this is not a valid rrule', label: 'Whenever' }),
      finishReason: 'stop',
    })
    const response = await handleScheduleParseRequest(request(validBody()), env, { fetcher: makeFetcher(), logger })
    expect(response?.status).toBe(502)
    const body = (await response?.json()) as { error: { code: string } }
    expect(body.error.code).toBe('MODEL_OUTPUT_UNUSABLE')
  })

  it('502s when the model output is not valid JSON', async () => {
    generateStructured.mockResolvedValue({ rawText: 'not json at all', finishReason: 'stop' })
    const response = await handleScheduleParseRequest(request(validBody()), env, { fetcher: makeFetcher(), logger })
    expect(response?.status).toBe(502)
  })

  it('502s when finishReason is not stop', async () => {
    generateStructured.mockResolvedValue({ rawText: '{}', finishReason: 'length' })
    const response = await handleScheduleParseRequest(request(validBody()), env, { fetcher: makeFetcher(), logger })
    expect(response?.status).toBe(502)
  })

  it('maps a down provider to 503', async () => {
    generateStructured.mockRejectedValueOnce(new ProviderUnavailableError('gemini', 503, 'down'))
    const response = await handleScheduleParseRequest(request(validBody()), env, { fetcher: makeFetcher(), logger })
    expect(response?.status).toBe(503)
  })
})
