// CORE-W3 (2026-09-06): the MCP endpoint -- bearer auth via hashed
// api_tokens, JSON-RPC lifecycle, and the three v1 tools.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./context-builder', () => ({
  supabaseGet: vi.fn(),
  supabasePost: vi.fn(),
  supabasePatch: vi.fn(),
  fetchConfirmedPersonalMemory: vi.fn(),
  fetchUserPersona: vi.fn(),
}))

import {
  fetchConfirmedPersonalMemory,
  fetchUserPersona,
  supabaseGet,
  supabasePatch,
  supabasePost,
} from './context-builder'
import { handleMcpRequest, sha256Hex, MCP_SERVER_INFO } from './mcp-endpoint'
import type { Env } from './types'

const env = {} as Env
const logger = { error: vi.fn() }

const mockedGet = vi.mocked(supabaseGet)
const mockedPost = vi.mocked(supabasePost)
const mockedPatch = vi.mocked(supabasePatch)
const mockedMemory = vi.mocked(fetchConfirmedPersonalMemory)
const mockedPersona = vi.mocked(fetchUserPersona)

function rpc(body: unknown, token = 'sfp_secret') {
  return new Request('https://worker.example/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

/** First supabaseGet call is always the token lookup. */
function authValid() {
  mockedGet.mockResolvedValueOnce([{ id: 'tok-1', user_id: 'user-1' }])
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPatch.mockResolvedValue(undefined)
  mockedPost.mockResolvedValue(undefined)
  mockedMemory.mockResolvedValue([])
  mockedPersona.mockResolvedValue(null)
})

describe('sha256Hex', () => {
  it('produces the known SHA-256 of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('handleMcpRequest', () => {
  it('returns null for unrelated paths and 405 for GET', async () => {
    expect(await handleMcpRequest(new Request('https://worker.example/chat', { method: 'POST' }), env, { logger })).toBeNull()
    const get = await handleMcpRequest(new Request('https://worker.example/mcp', { method: 'GET' }), env, { logger })
    expect(get?.status).toBe(405)
  })

  it('401s with WWW-Authenticate when the token is missing, unknown, or revoked', async () => {
    mockedGet.mockResolvedValueOnce([]) // hash lookup finds nothing
    const response = await handleMcpRequest(rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }), env, { logger })
    expect(response?.status).toBe(401)
    expect(response?.headers.get('WWW-Authenticate')).toContain('Bearer')
    // The lookup query carries the sha256 of the presented token and the
    // revocation filter.
    const path = mockedGet.mock.calls[0][1] as string
    expect(path).toContain(await sha256Hex('sfp_secret'))
    expect(path).toContain('revoked_at=is.null')
  })

  it('initialize negotiates a supported protocol version and advertises tools', async () => {
    authValid()
    const response = await handleMcpRequest(
      rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }),
      env,
      { logger },
    )
    const body = (await response?.json()) as { result: { protocolVersion: string; serverInfo: unknown; capabilities: unknown } }
    expect(body.result.protocolVersion).toBe('2025-03-26')
    expect(body.result.serverInfo).toEqual(MCP_SERVER_INFO)
    expect(body.result.capabilities).toEqual({ tools: {} })
  })

  it('notifications/initialized is accepted with 202 and no body', async () => {
    authValid()
    const response = await handleMcpRequest(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), env, { logger })
    expect(response?.status).toBe(202)
  })

  it('tools/list returns the three v1 tools', async () => {
    authValid()
    const response = await handleMcpRequest(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), env, { logger })
    const body = (await response?.json()) as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((tool) => tool.name)).toEqual(['memory_about_user', 'tasks_list', 'task_create'])
  })

  it('memory_about_user combines persona and confirmed memory as markdown', async () => {
    authValid()
    mockedPersona.mockResolvedValueOnce('## Preferences\nShort answers.')
    mockedMemory.mockResolvedValueOnce([
      { kind: 'goal', content: { summary: 'Finish the IHK exam' }, createdAt: '2026-09-01' },
    ] as never)
    const response = await handleMcpRequest(
      rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_about_user', arguments: {} } }),
      env,
      { logger },
    )
    const body = (await response?.json()) as { result: { content: Array<{ text: string }> } }
    expect(body.result.content[0].text).toContain('Short answers.')
    expect(body.result.content[0].text).toContain('[goal] Finish the IHK exam')
  })

  it('tasks_list formats open tasks and scopes the query to the token user', async () => {
    authValid()
    mockedGet.mockResolvedValueOnce([
      { id: 't1', title: 'Buy milk', notes: null, due_date: '2026-09-07', completed: false },
    ])
    const response = await handleMcpRequest(
      rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tasks_list', arguments: {} } }),
      env,
      { logger },
    )
    const body = (await response?.json()) as { result: { content: Array<{ text: string }> } }
    expect(body.result.content[0].text).toBe('[ ] Buy milk (due 2026-09-07)')
    const taskQuery = mockedGet.mock.calls[1][1] as string
    expect(taskQuery).toContain('user_id=eq.user-1')
    expect(taskQuery).toContain('completed=eq.false')
  })

  it('task_create inserts for the token user and confirms', async () => {
    authValid()
    const response = await handleMcpRequest(
      rpc({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'task_create', arguments: { title: 'Call the doctor', dueDate: '2026-09-08' } },
      }),
      env,
      { logger },
    )
    const body = (await response?.json()) as { result: { content: Array<{ text: string }>; isError: boolean } }
    expect(body.result.isError).toBe(false)
    expect(mockedPost).toHaveBeenCalledWith(env, 'tasks', {
      user_id: 'user-1',
      title: 'Call the doctor',
      notes: null,
      due_date: '2026-09-08',
      completed: false,
    })
  })

  it('task_create without a title is a tool-level error, not a crash', async () => {
    authValid()
    const response = await handleMcpRequest(
      rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'task_create', arguments: {} } }),
      env,
      { logger },
    )
    const body = (await response?.json()) as { result: { isError: boolean } }
    expect(body.result.isError).toBe(true)
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('unknown methods and unknown tools map to JSON-RPC errors', async () => {
    authValid()
    const unknownMethod = await handleMcpRequest(rpc({ jsonrpc: '2.0', id: 7, method: 'resources/list' }), env, { logger })
    expect(((await unknownMethod?.json()) as { error: { code: number } }).error.code).toBe(-32601)

    authValid()
    const unknownTool = await handleMcpRequest(
      rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope', arguments: {} } }),
      env,
      { logger },
    )
    expect(((await unknownTool?.json()) as { error: { code: number } }).error.code).toBe(-32602)
  })

  it('batch requests are rejected (2025-06-18 removed them)', async () => {
    authValid()
    const response = await handleMcpRequest(rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }]), env, { logger })
    expect(response?.status).toBe(400)
  })
})
