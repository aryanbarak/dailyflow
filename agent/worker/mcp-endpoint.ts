// CORE-W3 (2026-09-06, CORE audit item ۲-۳): SmartFlow as an MCP server.
//
// POST /mcp implements the Model Context Protocol's Streamable HTTP
// transport in its simplest legal form: every request is a single
// JSON-RPC message answered with application/json (the spec explicitly
// allows a server to respond with plain JSON instead of an SSE stream),
// no server-initiated streams, no session state -- so Claude Desktop,
// Claude Code, Cursor, etc. can connect with just a URL + bearer token.
// Deliberately hand-rolled (~no SDK): the official TS SDK's transports
// assume Node streams, and three tools don't justify the dependency on a
// Cloudflare Worker.
//
// Auth: `Authorization: Bearer sfp_...` -- the SHA-256 hex of the
// presented token is looked up in api_tokens (migration 20260906190000,
// revoked_at is null). The plaintext never touches storage; possession is
// the credential (same shape as ENGINEERING_TASKS_COMPANION_TOKEN).
// All data access is then service-role but scoped to the token's user_id.
//
// Tools (v1, deliberately small): memory_about_user (persona + confirmed
// personal memory), tasks_list, task_create. The task_create tool is the
// only write, and it creates exactly the same row shape the Telegram
// capture channel does.

import type { Env } from './types'
import { fetchConfirmedPersonalMemory, fetchUserPersona, supabaseGet, supabasePatch, supabasePost } from './context-builder'

const ROUTE_PATH = '/mcp'

const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

export const MCP_SERVER_INFO = { name: 'smartflow-mcp', version: '0.1.0' }

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result }
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface ApiTokenRow {
  id: string
  user_id: string
}

async function authenticateToken(request: Request, env: Env): Promise<ApiTokenRow | null> {
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return null
  const token = authorization.slice(7).trim()
  if (token.length === 0) return null
  const hash = await sha256Hex(token)
  const rows = await supabaseGet<ApiTokenRow[]>(
    env,
    `api_tokens?token_hash=eq.${hash}&revoked_at=is.null&select=id,user_id&limit=1`,
  )
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: 'memory_about_user',
    description:
      "The user's persona document (their own words about who they are and how assistants should work with them) plus their confirmed personal-memory facts. Call this before answering anything that depends on who the user is, their goals, preferences, or working patterns.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tasks_list',
    description: "The user's SmartFlow tasks, open ones first. Use includeCompleted to also see finished tasks.",
    inputSchema: {
      type: 'object',
      properties: {
        includeCompleted: { type: 'boolean', description: 'Also include completed tasks (default false).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'task_create',
    description: 'Create one task in SmartFlow. Only do this when the user explicitly asks for a task or reminder to be captured.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title.', maxLength: 200 },
        notes: { type: 'string', description: 'Optional details.', maxLength: 2000 },
        dueDate: { type: 'string', description: 'Optional due date, YYYY-MM-DD.', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
]

function textContent(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError }
}

interface TaskRow {
  id: string
  title: string
  notes: string | null
  due_date: string | null
  completed: boolean
}

async function runMemoryAboutUser(userId: string, env: Env) {
  const [persona, confirmed] = await Promise.all([
    fetchUserPersona(userId, env),
    fetchConfirmedPersonalMemory(userId, env),
  ])
  const sections: string[] = []
  if (persona) {
    sections.push(`## Persona (written by the user)\n\n${persona}`)
  }
  if (confirmed.length > 0) {
    const lines = confirmed.map((record) => {
      const summary = typeof record.content?.summary === 'string' ? record.content.summary : JSON.stringify(record.content)
      return `- [${record.kind}] ${summary}`
    })
    sections.push(`## Confirmed personal memory\n\n${lines.join('\n')}`)
  }
  if (sections.length === 0) {
    return textContent('No persona or confirmed personal memory is stored for this user yet.')
  }
  return textContent(sections.join('\n\n'))
}

async function runTasksList(userId: string, args: Record<string, unknown>, env: Env) {
  const includeCompleted = args.includeCompleted === true
  const completedFilter = includeCompleted ? '' : '&completed=eq.false'
  const rows = await supabaseGet<TaskRow[]>(
    env,
    `tasks?user_id=eq.${userId}${completedFilter}&select=id,title,notes,due_date,completed&order=completed.asc,due_date.asc.nullslast,created_at.desc&limit=50`,
  )
  if (rows.length === 0) return textContent(includeCompleted ? 'No tasks at all.' : 'No open tasks.')
  const lines = rows.map((task) => {
    const status = task.completed ? '[x]' : '[ ]'
    const due = task.due_date ? ` (due ${task.due_date})` : ''
    const notes = task.notes ? ` -- ${task.notes}` : ''
    return `${status} ${task.title}${due}${notes}`
  })
  return textContent(lines.join('\n'))
}

async function runTaskCreate(userId: string, args: Record<string, unknown>, env: Env) {
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (title.length === 0 || title.length > 200) {
    return textContent('task_create requires a non-empty title of at most 200 characters.', true)
  }
  const notes = typeof args.notes === 'string' && args.notes.trim().length > 0 ? args.notes.trim().slice(0, 2000) : null
  const dueDate = typeof args.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.dueDate) ? args.dueDate : null
  await supabasePost(env, 'tasks', {
    user_id: userId,
    title,
    notes,
    due_date: dueDate,
    completed: false,
  })
  return textContent(`Created task: ${title}${dueDate ? ` (due ${dueDate})` : ''}`)
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export async function handleMcpRequest(
  request: Request,
  env: Env,
  dependencies: { logger?: Pick<Console, 'error'> } = {},
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== ROUTE_PATH) return null
  const logger = dependencies.logger ?? console

  // No SSE stream is offered; a GET must be 405 per the Streamable HTTP
  // spec for servers that only answer POSTs.
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let tokenRow: ApiTokenRow | null = null
  try {
    tokenRow = await authenticateToken(request, env)
  } catch (error) {
    logger.error?.(`[MCP] token lookup failed: ${(error as Error).message}`)
    return json({ error: 'Authentication unavailable' }, 503)
  }
  if (!tokenRow) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="mcp"' },
    })
  }

  let message: JsonRpcRequest
  try {
    const body = (await request.json()) as unknown
    if (Array.isArray(body)) {
      // Batches were removed in protocol 2025-06-18; keep v1 simple.
      return json(rpcError(null, -32600, 'Batch requests are not supported.'), 400)
    }
    message = body as JsonRpcRequest
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400)
  }

  if (typeof message?.method !== 'string') {
    return json(rpcError(message?.id ?? null, -32600, 'Invalid request'), 400)
  }

  const isNotification = message.id === undefined || message.id === null

  // Best-effort usage stamp -- never blocks or fails the request.
  try {
    await supabasePatch(env, `api_tokens?id=eq.${tokenRow.id}`, { last_used_at: new Date().toISOString() })
  } catch {
    /* usage stamping is advisory */
  }

  try {
    switch (message.method) {
      case 'initialize': {
        const requested = message.params?.protocolVersion
        const protocolVersion =
          typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : DEFAULT_PROTOCOL_VERSION
        return json(
          rpcResult(message.id ?? null, {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: MCP_SERVER_INFO,
            instructions:
              'SmartFlow personal workspace. Call memory_about_user before answering anything that depends on who the user is; create tasks only on an explicit request.',
          }),
        )
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return new Response(null, { status: 202 })
      case 'ping':
        return json(rpcResult(message.id ?? null, {}))
      case 'tools/list':
        return json(rpcResult(message.id ?? null, { tools: TOOL_DEFINITIONS }))
      case 'tools/call': {
        const name = message.params?.name
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>
        let result: ReturnType<typeof textContent>
        if (name === 'memory_about_user') {
          result = await runMemoryAboutUser(tokenRow.user_id, env)
        } else if (name === 'tasks_list') {
          result = await runTasksList(tokenRow.user_id, args, env)
        } else if (name === 'task_create') {
          result = await runTaskCreate(tokenRow.user_id, args, env)
        } else {
          return json(rpcError(message.id ?? null, -32602, `Unknown tool: ${String(name)}`))
        }
        return json(rpcResult(message.id ?? null, result))
      }
      default:
        if (isNotification) return new Response(null, { status: 202 })
        return json(rpcError(message.id ?? null, -32601, `Method not found: ${message.method}`))
    }
  } catch (error) {
    logger.error?.(`[MCP] ${message.method} failed: ${(error as Error).message}`)
    if (isNotification) return new Response(null, { status: 202 })
    return json(rpcError(message.id ?? null, -32603, 'Internal error'))
  }
}
