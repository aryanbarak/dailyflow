import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordProposalOutcome } from './proposal-outcome-recording'
import type { Env } from './types'

const SUPABASE_URL = 'https://supa.test'

function testEnv(): Env {
  return {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_KEY: 'service-key',
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-2.5-flash',
    AI: {} as unknown as Env['AI'],
  }
}

function baseInput() {
  return {
    userId: 'user-1',
    intentType: 'create_finance_transaction',
    toolId: 'finance.create_transaction',
    domain: 'finance' as const,
    writeMode: 'ask' as const,
    outcome: 'approved' as const,
    succeeded: true,
    riskLevel: 'high' as const,
    targetFields: ['amount', 'direction'],
  }
}

describe('recordProposalOutcome', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the shape-only row to agent_proposal_outcomes via the service role', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(null, { status: 201 })
    }))

    await recordProposalOutcome(testEnv(), baseInput())

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${SUPABASE_URL}/rest/v1/agent_proposal_outcomes`)
    expect(calls[0].init?.method).toBe('POST')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.apikey).toBe('service-key')
    expect(headers.Authorization).toBe('Bearer service-key')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body).toEqual({
      user_id: 'user-1',
      request_id: null,
      intent_type: 'create_finance_transaction',
      tool_id: 'finance.create_transaction',
      domain: 'finance',
      write_mode: 'ask',
      outcome: 'approved',
      succeeded: true,
      risk_level: 'high',
      target_fields: ['amount', 'direction'],
    })
  })

  // ADR-0016 Decision item 6 / task 40 Part C: the fire-and-forget
  // guarantee proven directly at its source -- recordProposalOutcome must
  // NEVER throw or reject, no matter how the underlying insert fails.
  it('never throws when the underlying fetch rejects (fire-and-forget)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network exploded')
    }))
    const logger = { error: vi.fn() }

    await expect(recordProposalOutcome(testEnv(), baseInput(), { logger })).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('never throws when the underlying fetch resolves with a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 500 })))
    const logger = { error: vi.fn() }

    await expect(recordProposalOutcome(testEnv(), baseInput(), { logger })).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
