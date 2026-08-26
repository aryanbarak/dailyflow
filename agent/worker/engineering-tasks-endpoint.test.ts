import { describe, it, expect, vi } from 'vitest'
import { handleEngineeringTasksRequest, type Fetcher } from './engineering-tasks-endpoint'
import type { Env } from './types'

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_KEY: 'service-key',
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-model',
    AI: {} as Ai,
    ENGINEERING_TASKS_COMPANION_TOKEN: 'companion-secret',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('handleEngineeringTasksRequest: routing', () => {
  it('returns null for unrelated paths', async () => {
    const fetcher = vi.fn<Fetcher>()
    const req = new Request('https://worker.example/chat', { method: 'POST' })
    const result = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(result).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('POST /engineering-tasks (create)', () => {
  it('rejects a request with no Supabase bearer token', async () => {
    const fetcher = vi.fn<Fetcher>()
    const req = new Request('https://worker.example/engineering-tasks', {
      method: 'POST',
      body: JSON.stringify({ repo: 'aryanbarak/smartflow', instruction: 'do it', taskClass: 'docs_fix' }),
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a body missing required fields', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse({ id: 'user-1' }))
    const req = new Request('https://worker.example/engineering-tasks', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
      body: JSON.stringify({ repo: 'aryanbarak/smartflow' }),
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(400)
  })

  it('creates a pending row for a valid, authenticated request', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1' })) // auth check
      .mockResolvedValueOnce(jsonResponse([{ id: 'task-1', status: 'pending' }], 201)) // insert

    const req = new Request('https://worker.example/engineering-tasks', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
      body: JSON.stringify({ repo: 'aryanbarak/smartflow', instruction: 'add a comment', taskClass: 'docs_fix' }),
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(201)
    const body = await res!.json() as Record<string, unknown>
    expect(body).toEqual({ id: 'task-1', status: 'pending' })

    // Second call is the insert -- verify it went to the right table with the right shape.
    const [insertUrl, insertInit] = fetcher.mock.calls[1]
    expect(String(insertUrl)).toContain('/rest/v1/engineering_tasks')
    expect(JSON.parse(String(insertInit?.body))).toEqual([
      { user_id: 'user-1', repo: 'aryanbarak/smartflow', instruction: 'add a comment', task_class: 'docs_fix' },
    ])
  })
})

describe('GET /engineering-tasks/pending (companion claim)', () => {
  it('rejects a request with a missing/wrong companion token', async () => {
    const fetcher = vi.fn<Fetcher>()
    const req = new Request('https://worker.example/engineering-tasks/pending', {
      method: 'GET',
      headers: { 'X-Companion-Token': 'wrong' },
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns task: null when nothing is pending', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse([]))
    const req = new Request('https://worker.example/engineering-tasks/pending', {
      method: 'GET',
      headers: { 'X-Companion-Token': 'companion-secret' },
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(200)
    expect(await res!.json()).toEqual({ task: null })
  })

  it('calls the atomic claim RPC and returns the claimed task', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      jsonResponse([{ id: 'task-1', repo: 'aryanbarak/smartflow', instruction: 'do it', task_class: 'docs_fix' }]),
    )
    const req = new Request('https://worker.example/engineering-tasks/pending?claimedBy=companion-A', {
      method: 'GET',
      headers: { 'X-Companion-Token': 'companion-secret' },
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(200)
    expect(await res!.json()).toEqual({
      task: { id: 'task-1', repo: 'aryanbarak/smartflow', instruction: 'do it', taskClass: 'docs_fix' },
    })
    const [rpcUrl, rpcInit] = fetcher.mock.calls[0]
    expect(String(rpcUrl)).toContain('/rest/v1/rpc/claim_pending_engineering_task')
    expect(JSON.parse(String(rpcInit?.body))).toEqual({ p_claimed_by: 'companion-A' })
  })

  it('fails closed with 503 when the companion token is not configured', async () => {
    const fetcher = vi.fn<Fetcher>()
    const req = new Request('https://worker.example/engineering-tasks/pending', { method: 'GET' })
    const res = await handleEngineeringTasksRequest(req, makeEnv({ ENGINEERING_TASKS_COMPANION_TOKEN: undefined }), { fetcher })
    expect(res?.status).toBe(503)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('POST /engineering-tasks/:id/report', () => {
  it('rejects without the companion token', async () => {
    const fetcher = vi.fn<Fetcher>()
    const req = new Request('https://worker.example/engineering-tasks/task-1/report', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(401)
  })

  it('marks the task completed on ok: true and returns 200', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse([{ id: 'task-1' }]))
    const req = new Request('https://worker.example/engineering-tasks/task-1/report', {
      method: 'POST',
      headers: { 'X-Companion-Token': 'companion-secret' },
      body: JSON.stringify({ ok: true, selfReport: { ok: true }, verified: { hasCommits: true }, disagreement: { disagreement: false }, branchName: 'eng-04-x' }),
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(200)
    expect(await res!.json()).toEqual({ id: 'task-1', status: 'completed' })
    const [updateUrl, updateInit] = fetcher.mock.calls[0]
    expect(String(updateUrl)).toContain('status=eq.claimed')
    expect(JSON.parse(String(updateInit?.body)).status).toBe('completed')
  })

  it('fails closed (409) when reporting on a task that is not in claimed status (e.g. duplicate report)', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse([]))
    const req = new Request('https://worker.example/engineering-tasks/task-1/report', {
      method: 'POST',
      headers: { 'X-Companion-Token': 'companion-secret' },
      body: JSON.stringify({ ok: true }),
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(409)
  })
})

describe('GET /engineering-tasks/:id (status polling)', () => {
  it('requires Supabase auth', async () => {
    const fetcher = vi.fn<Fetcher>()
    const req = new Request('https://worker.example/engineering-tasks/task-1', { method: 'GET' })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(401)
  })

  it('returns 404 when the task does not belong to the caller (owner-scoped query)', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1' }))
      .mockResolvedValueOnce(jsonResponse([]))
    const req = new Request('https://worker.example/engineering-tasks/task-1', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(404)
    const [selectUrl] = fetcher.mock.calls[1]
    expect(String(selectUrl)).toContain('user_id=eq.user-1')
  })

  it('returns the verified result for a completed task', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1' }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'task-1',
            status: 'completed',
            repo: 'aryanbarak/smartflow',
            branch_name: 'eng-04-x',
            verified_result: { hasCommits: true },
            disagreement: { disagreement: false },
            error_message: null,
            created_at: '2026-08-26T00:00:00Z',
            completed_at: '2026-08-26T00:01:00Z',
          },
        ]),
      )
    const req = new Request('https://worker.example/engineering-tasks/task-1', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    expect(res?.status).toBe(200)
    const body = await res!.json() as Record<string, unknown>
    expect(body.status).toBe('completed')
    expect(body.verifiedResult).toEqual({ hasCommits: true })
  })

  it('reports waitingForCompanion honestly for a pending task older than the stale threshold (offline-companion case)', async () => {
    const oldCreatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 minutes ago
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1' }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'task-1', status: 'pending', repo: 'r', created_at: oldCreatedAt }]))
    const req = new Request('https://worker.example/engineering-tasks/task-1', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    const body = await res!.json() as Record<string, unknown>
    expect(body.waitingForCompanion).toBe(true)
    expect(body.stuckInProgress).toBe(false)
  })

  it('does not flag a freshly-created pending task as waiting for the companion', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1' }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'task-1', status: 'pending', repo: 'r', created_at: new Date().toISOString() }]))
    const req = new Request('https://worker.example/engineering-tasks/task-1', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    const body = await res!.json() as Record<string, unknown>
    expect(body.waitingForCompanion).toBe(false)
  })

  it('reports stuckInProgress for a claimed task with no report long past the claimed-stale threshold', async () => {
    const oldClaimedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString() // 20 minutes ago
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1' }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'task-1', status: 'claimed', repo: 'r', claimed_at: oldClaimedAt }]))
    const req = new Request('https://worker.example/engineering-tasks/task-1', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    })
    const res = await handleEngineeringTasksRequest(req, makeEnv(), { fetcher })
    const body = await res!.json() as Record<string, unknown>
    expect(body.stuckInProgress).toBe(true)
  })
})
