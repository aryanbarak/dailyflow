// CORE-W6 (2026-09-07, ADR-0023 SS2): recall-log instrumentation for the
// Worker's two confirmed-memory consumers. Covers fetchConfirmedPersonalMemory
// now selecting `id` (needed to log anything at all) and logPersonalMemoryRecall's
// best-effort write behavior.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchConfirmedPersonalMemory, logPersonalMemoryRecall } from './context-builder'
import type { Env } from './types'

const env = {
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_SERVICE_KEY: 'service-key',
} as unknown as Env

async function withFetch<T>(fetchMock: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = global.fetch
  global.fetch = fetchMock
  try {
    return await fn()
  } finally {
    global.fetch = original
  }
}

describe('fetchConfirmedPersonalMemory', () => {
  it('selects id alongside kind/content/created_at, and maps it onto the result', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      return new Response(
        JSON.stringify([{ id: 'record-1', kind: 'preference', content: { summary: 'x' }, created_at: '2026-09-01T00:00:00.000Z' }]),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const result = await withFetch(fetchMock, () => fetchConfirmedPersonalMemory('user-1', env))

    expect(calls[0]).toContain('select=id,kind,content,created_at')
    expect(result).toEqual([{ id: 'record-1', kind: 'preference', content: { summary: 'x' }, createdAt: '2026-09-01T00:00:00.000Z' }])
  })
})

describe('logPersonalMemoryRecall', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes one row per record id, all sharing the same recall_batch_id, for the given consumer', async () => {
    const posted: Record<string, unknown>[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/rest/v1/personal_memory_recall_log')) {
        posted.push(...(JSON.parse(String(init?.body)) as Record<string, unknown>[]))
        return new Response(null, { status: 201 })
      }
      throw new Error(`Unhandled fetch in test: ${url}`)
    }) as unknown as typeof fetch

    await withFetch(fetchMock, () => logPersonalMemoryRecall(env, 'user-1', 'chat', ['record-1', 'record-2']))

    expect(posted).toHaveLength(2)
    expect(posted[0]).toMatchObject({ user_id: 'user-1', record_id: 'record-1', consumer: 'chat' })
    expect(posted[1]).toMatchObject({ user_id: 'user-1', record_id: 'record-2', consumer: 'chat' })
    expect(posted[0].recall_batch_id).toBe(posted[1].recall_batch_id)
  })

  it('is a no-op when there are no record ids to log -- never fires a request', async () => {
    const fetchMock = vi.fn()
    await withFetch(fetchMock as unknown as typeof fetch, () => logPersonalMemoryRecall(env, 'user-1', 'briefing', []))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a write failure -- never throws, matching fetchUserPersona\'s best-effort posture in this file', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => new Response('server error', { status: 500 })) as unknown as typeof fetch

    await expect(withFetch(fetchMock, () => logPersonalMemoryRecall(env, 'user-1', 'chat', ['record-1']))).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
