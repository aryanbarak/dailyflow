// CORE-W3 (2026-09-06): the journal assistant route -- auth, validation,
// model call, RLS-scoped persistence, and the unsaved-reply degradation.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./providers/createProviders', () => ({
  createProviders: vi.fn(),
}))

import { createProviders } from './providers/createProviders'
import {
  buildJournalAssistantSystemInstruction,
  handleJournalAssistantRequest,
  parseJournalAssistantBody,
} from './journal-assistant-endpoint'
import { ProviderUnavailableError } from './provider-errors'
import type { Env } from './types'

const env = {
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_ANON_KEY: 'anon-key',
} as unknown as Env

const generateText = vi.fn()
const logger = { info: vi.fn(), error: vi.fn() }

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    instruction: 'خلاصه این هفته را بنویس',
    entryDate: '2026-09-06',
    entryContent: 'امروز روز خوبی بود.',
    ...overrides,
  }
}

function request(body: unknown, token = 'user-jwt') {
  return new Request('https://worker.example/journal/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

/** fetcher stub: auth endpoint + journal_ai_notes insert. */
function makeFetcher(options: { authOk?: boolean; insertOk?: boolean } = {}) {
  const { authOk = true, insertOk = true } = options
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/auth/v1/user')) {
      return authOk
        ? new Response(JSON.stringify({ id: 'user-1' }), { status: 200 })
        : new Response('nope', { status: 401 })
    }
    if (url.includes('/rest/v1/journal_ai_notes')) {
      return insertOk
        ? new Response(
            JSON.stringify([{ id: 'note-1', instruction: 'x', reply: 'y', created_at: '2026-09-06T10:00:00Z' }]),
            { status: 201 },
          )
        : new Response('rls says no', { status: 403 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createProviders).mockReturnValue({
    text: { id: 'gemini', generateText },
  } as unknown as ReturnType<typeof createProviders>)
  generateText.mockResolvedValue({ text: 'پاسخ دستیار', finishReason: 'stop' })
})

describe('parseJournalAssistantBody', () => {
  it('accepts a well-formed body and trims the instruction', () => {
    expect(parseJournalAssistantBody(validBody({ instruction: '  do it  ' }))).toEqual({
      instruction: 'do it',
      entryDate: '2026-09-06',
      entryContent: 'امروز روز خوبی بود.',
    })
  })

  it('rejects missing/empty instruction, bad dates, oversized fields, and non-objects', () => {
    expect(parseJournalAssistantBody(validBody({ instruction: '' }))).toBeNull()
    expect(parseJournalAssistantBody(validBody({ instruction: 'x'.repeat(501) }))).toBeNull()
    expect(parseJournalAssistantBody(validBody({ entryDate: '06.09.2026' }))).toBeNull()
    expect(parseJournalAssistantBody(validBody({ entryContent: 'x'.repeat(20001) }))).toBeNull()
    expect(parseJournalAssistantBody(null)).toBeNull()
  })
})

describe('handleJournalAssistantRequest', () => {
  it('returns null for unrelated paths', async () => {
    const req = new Request('https://worker.example/chat', { method: 'POST' })
    expect(await handleJournalAssistantRequest(req, env, { fetcher: makeFetcher(), logger })).toBeNull()
  })

  it('401s without a valid Supabase session', async () => {
    const response = await handleJournalAssistantRequest(request(validBody()), env, {
      fetcher: makeFetcher({ authOk: false }),
      logger,
    })
    expect(response?.status).toBe(401)
  })

  it('400s on an invalid body', async () => {
    const response = await handleJournalAssistantRequest(request({ nope: true }), env, {
      fetcher: makeFetcher(),
      logger,
    })
    expect(response?.status).toBe(400)
  })

  it('runs the instruction against the entry and persists the note as the user', async () => {
    const fetcher = makeFetcher()
    const response = await handleJournalAssistantRequest(request(validBody()), env, { fetcher, logger })
    expect(response?.status).toBe(200)
    const body = (await response?.json()) as { note: { id: string; reply: string } }
    expect(body.note).toMatchObject({ id: 'note-1', reply: 'y' })

    const promptText = (generateText.mock.calls[0][0] as { system: string; turns: Array<{ content: string }> })
    expect(promptText.system).toBe(buildJournalAssistantSystemInstruction())
    expect(promptText.turns[0].content).toContain('امروز روز خوبی بود.')
    expect(promptText.turns[0].content).toContain('خلاصه این هفته را بنویس')

    const insertCall = vi
      .mocked(fetcher as unknown as ReturnType<typeof vi.fn>)
      .mock.calls.find(([input]) => String(input).includes('journal_ai_notes'))
    const init = insertCall?.[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-jwt')
  })

  it('maps a down provider to 503 without persisting anything', async () => {
    generateText.mockRejectedValueOnce(new ProviderUnavailableError('gemini', 503, 'down'))
    const fetcher = makeFetcher()
    const response = await handleJournalAssistantRequest(request(validBody()), env, { fetcher, logger })
    expect(response?.status).toBe(503)
    const insertCalls = vi
      .mocked(fetcher as unknown as ReturnType<typeof vi.fn>)
      .mock.calls.filter(([input]) => String(input).includes('journal_ai_notes'))
    expect(insertCalls).toHaveLength(0)
  })

  it('a failed persist still returns the generated reply, flagged unsaved', async () => {
    const response = await handleJournalAssistantRequest(request(validBody()), env, {
      fetcher: makeFetcher({ insertOk: false }),
      logger,
    })
    expect(response?.status).toBe(200)
    const body = (await response?.json()) as { note: { id: null; reply: string }; persisted: boolean }
    expect(body.persisted).toBe(false)
    expect(body.note.id).toBeNull()
    expect(body.note.reply).toBe('پاسخ دستیار')
  })
})
