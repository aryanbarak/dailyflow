import { describe, expect, it } from 'vitest'
import type { Env } from './types'
import { handleAgentToolExecutionApprove, handleAgentToolExecutionRequest } from './agent-tool-execution'

function mockEnv(): Env {
  return {
    SUPABASE_URL: 'https://supa.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'service',
    GEMINI_API_KEY: 'key', GEMINI_MODEL: 'gemini-2.5-flash', AI: {} as unknown as Env['AI'],
  } as Env
}

const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'

function authRequest(path: string, body: unknown, userId: string | null = USER_ID) {
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { Authorization: `Bearer token-for-${userId}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

interface Row {
  id: string
  user_id: string
  domain: string
  action: string
  tool_id: string
  request_id: string
  intent_id: string
  canonical_hash: string
  normalized_arguments: Record<string, unknown>
  time_zone: string | null
  language: string
  target_id: string | null
  status: string
  approval_requested_at: string | null
  approved_at: string | null
  execution_started_at: string | null
  completed_at: string | null
  target_type: string | null
  error_code: string | null
}

// A small in-memory fake of agent_tool_executions that actually honors
// PostgREST's conditional-UPDATE semantics (`...&status=eq.X` only matches
// -- and only returns -- a row currently in status X), which is the exact
// mechanism the module under test relies on for atomic transitions. A
// static canned-response sequence cannot exercise the "duplicate request
// loses the race" tests below; this has to be genuinely stateful.
class FakeExecutionsTable {
  rows: Row[] = []
  private nextId = 1

  insert(fields: Partial<Row> & { user_id: string }): Row {
    const row: Row = {
      id: `exec-${this.nextId++}`,
      domain: '', action: '', tool_id: '', request_id: '', intent_id: '', canonical_hash: '',
      normalized_arguments: {}, time_zone: null, language: 'en', target_id: null,
      status: 'approval_pending', approval_requested_at: null, approved_at: null,
      execution_started_at: null, completed_at: null, target_type: null, error_code: null,
      ...fields,
    }
    // BLOCKER B CORRECTION: idempotency is scoped to (user_id, request_id),
    // not to intent_id/canonical_hash -- see the migration's own comment
    // (agent_tool_executions_user_request_unique) on why the intent hash
    // alone must never be the uniqueness key.
    const clash = this.rows.find((r) => r.user_id === row.user_id && r.request_id === row.request_id)
    if (clash) throw new Error('unique_violation on (user_id, request_id)')
    this.rows.push(row)
    return row
  }

  selectById(id: string): Row[] {
    const row = this.rows.find((r) => r.id === id)
    return row ? [row] : []
  }

  selectByRequestId(userId: string, requestId: string): Row[] {
    const row = this.rows.find((r) => r.user_id === userId && r.request_id === requestId)
    return row ? [row] : []
  }

  // BLOCKER 4 test support: statuses this table pretends it cannot durably
  // record -- conditionalUpdate still MATCHES the row (proving the
  // transition would otherwise have been valid) but returns no rows anyway,
  // simulating "the write to agent_tool_executions itself failed" after the
  // domain executor's own result was already known. This is a RELIABLE
  // negative -- a normal response that proves zero rows matched.
  blockTransitionTo = new Set<string>()

  // LIFECYCLE TRANSPORT CORRECTION test support: statuses whose lifecycle
  // PATCH request itself THROWS (simulates a network rejection or a lost
  // response) rather than resolving normally -- the genuinely ambiguous
  // case, unlike blockTransitionTo above. `commitBeforeThrow` controls
  // whether the underlying row is actually mutated before the throw: a
  // lost response is consistent with the database having committed before
  // the connection dropped (commitBeforeThrow) OR the request never having
  // reached it at all (the default) -- both are real possibilities, and
  // the tests below exercise both, proving a readback is what tells them
  // apart, never an assumption either way.
  throwTransitionTo = new Set<string>()
  commitBeforeThrow = new Set<string>()

  conditionalUpdate(id: string, expectedStatus: string, patch: Partial<Row>): Row[] {
    const row = this.rows.find((r) => r.id === id && r.status === expectedStatus)
    if (!row) return []
    if (patch.status && this.blockTransitionTo.has(patch.status)) return []
    if (patch.status && this.throwTransitionTo.has(patch.status)) {
      if (this.commitBeforeThrow.has(patch.status)) Object.assign(row, patch)
      throw new Error('simulated transport failure on lifecycle transition')
    }
    Object.assign(row, patch)
    return [row]
  }
}

interface Call { method: string; url: string; body?: unknown }

// Composable route table over the fake network boundary every path in the
// module under test crosses: /auth/v1/user (real JWT verification, mocked
// here to a simple userId-from-header stand-in), agent_tool_executions
// (backed by FakeExecutionsTable above), flow_write_permissions (policy),
// and the domain tables (tasks/calendar_events/flow_write_undo_records)
// that executeAutoTaskWrite/executeAutoCalendarWrite/executeTaskComplete
// themselves call.
function buildFetchMock(options: {
  table: FakeExecutionsTable
  policyMode?: 'auto' | 'ask' | 'off' | 'none-stored'
  taskRow?: { id: string; title: string; notes?: string | null; due_date: string | null }
  eventRow?: { id: string; title: string; date: string; start_time: string | null; end_time: string | null; description?: string | null }
  failDomainWrite?: boolean
  // BLOCKER 3 test support: throw instead of ever returning a Response for
  // a domain write -- simulates the domain executor itself throwing (e.g.
  // a network failure mid-write), the exact scenario BLOCKER 4's exception
  // boundary exists for.
  throwOnDomainWrite?: boolean
}) {
  const calls: Call[] = []
  const fetchMock = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const bodyText = init?.body ? String(init.body) : undefined
    calls.push({ method, url, body: bodyText ? JSON.parse(bodyText) : undefined })
    const u = new URL(url)

    if (u.pathname === '/auth/v1/user') {
      const auth = init?.headers && (init.headers as Record<string, string>).Authorization
      const token = typeof auth === 'string' ? auth.replace('Bearer token-for-', '') : ''
      if (!token) return new Response(null, { status: 401 })
      return new Response(JSON.stringify({ id: token }), { status: 200 })
    }

    if (u.pathname.startsWith('/rest/v1/agent_tool_executions')) {
      if (method === 'POST') {
        const parsed = JSON.parse(bodyText ?? '{}')
        try {
          const row = options.table.insert(parsed)
          return new Response(JSON.stringify([row]), { status: 201 })
        } catch {
          return new Response(JSON.stringify({ code: '23505', message: 'unique_violation' }), { status: 409 })
        }
      }
      if (method === 'GET') {
        // Boundary-anchored ([?&] before the key): "id=eq." would otherwise
        // false-match inside "user_id=eq." too, since it is a substring of it.
        const idMatch = /[?&]id=eq\.([^&]+)/.exec(u.search)
        const requestIdMatch = /[?&]request_id=eq\.([^&]+)/.exec(u.search)
        const userMatch = /[?&]user_id=eq\.([^&]+)/.exec(u.search)
        if (idMatch) return new Response(JSON.stringify(options.table.selectById(decodeURIComponent(idMatch[1]))), { status: 200 })
        if (requestIdMatch && userMatch) {
          return new Response(
            JSON.stringify(options.table.selectByRequestId(decodeURIComponent(userMatch[1]), decodeURIComponent(requestIdMatch[1]))),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (method === 'PATCH') {
        const idMatch = /[?&]id=eq\.([^&]+)/.exec(u.search)
        const statusMatch = /[?&]status=eq\.([^&]+)/.exec(u.search)
        const id = idMatch ? decodeURIComponent(idMatch[1]) : ''
        const expected = statusMatch ? decodeURIComponent(statusMatch[1]) : ''
        const patch = JSON.parse(bodyText ?? '{}')
        const rows = options.table.conditionalUpdate(id, expected, patch)
        return new Response(JSON.stringify(rows), { status: 200 })
      }
    }

    if (u.pathname.startsWith('/rest/v1/flow_write_permissions')) {
      if (options.policyMode && options.policyMode !== 'none-stored') {
        return new Response(JSON.stringify([{ mode: options.policyMode }]), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }

    if (u.pathname.startsWith('/rest/v1/tasks')) {
      if (method === 'POST' || method === 'PATCH') {
        if (options.throwOnDomainWrite) throw new Error('simulated network failure mid domain-write')
        if (options.failDomainWrite) return new Response(JSON.stringify([]), { status: 200 })
        const base = options.taskRow ?? { id: 'task-1', title: 'Untitled', notes: null, due_date: null }
        // BLOCKER 3 test support: merges the PATCH body onto the base row,
        // same as a real PATCH ... RETURNING would -- so a test can assert
        // both the exact wire-level payload (via `calls`) AND the
        // authoritative round-tripped response the handler actually
        // consumes, rather than a canned response that ignores the request.
        const patch = method === 'PATCH' ? (JSON.parse(bodyText ?? '{}') as Record<string, unknown>) : {}
        return new Response(
          JSON.stringify([{
            id: base.id, user_id: USER_ID,
            title: typeof patch.title === 'string' ? patch.title : base.title,
            notes: patch.notes !== undefined ? patch.notes : (base.notes ?? null),
            due_date: patch.due_date !== undefined ? patch.due_date : base.due_date,
            completed: method === 'PATCH' && u.search.includes('completed'),
            completed_at: null, created_at: '2026-08-31T10:00:00.000Z', updated_at: '2026-08-31T10:00:00.000Z',
          }]),
          { status: 200 },
        )
      }
      if (method === 'GET') {
        const row = options.taskRow ?? { id: 'task-1', title: 'Untitled', due_date: null }
        return new Response(JSON.stringify([{ id: row.id, user_id: USER_ID, title: row.title, notes: row.notes ?? null, due_date: row.due_date, completed: false, created_at: '2026-08-31T10:00:00.000Z', updated_at: '2026-08-31T10:00:00.000Z' }]), { status: 200 })
      }
    }

    if (u.pathname.startsWith('/rest/v1/calendar_events')) {
      if (options.throwOnDomainWrite && (method === 'POST' || method === 'PATCH')) throw new Error('simulated network failure mid domain-write')
      if (options.failDomainWrite && (method === 'POST' || method === 'PATCH')) return new Response(JSON.stringify([]), { status: 200 })
      const base = options.eventRow ?? { id: 'event-1', title: 'Untitled', date: '2026-09-01', start_time: '10:00', end_time: '11:00', description: null }
      // BLOCKER 3 test support: same PATCH-body-merge as tasks above.
      const patch = method === 'PATCH' ? (JSON.parse(bodyText ?? '{}') as Record<string, unknown>) : {}
      return new Response(
        JSON.stringify([{
          id: base.id, user_id: USER_ID,
          title: typeof patch.title === 'string' ? patch.title : base.title,
          date: typeof patch.date === 'string' ? patch.date : base.date,
          start_time: typeof patch.start_time === 'string' ? patch.start_time : base.start_time,
          end_time: typeof patch.end_time === 'string' ? patch.end_time : base.end_time,
          location: null,
          description: patch.description !== undefined ? patch.description : (base.description ?? null),
          color: null, type: null, all_day: false, created_at: '2026-08-31T10:00:00.000Z', updated_at: '2026-08-31T10:00:00.000Z',
        }]),
        { status: 200 },
      )
    }

    if (u.pathname.startsWith('/rest/v1/flow_write_undo_records')) {
      return new Response(method === 'GET' ? JSON.stringify([]) : null, { status: method === 'POST' ? 201 : 200 })
    }

    if (u.pathname.startsWith('/rest/v1/alarms')) {
      return new Response(JSON.stringify([{ id: 'alarm-1' }]), { status: 200 })
    }

    throw new Error(`Unhandled fetch in test: ${method} ${url}`)
  }) as typeof fetch
  return { fetchMock, calls }
}

async function withFetch<T>(fetchMock: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = global.fetch
  global.fetch = fetchMock
  try {
    return await fn()
  } finally {
    global.fetch = original
  }
}

const TASK_CREATE_REQUEST_BODY = {
  toolId: 'tasks.create',
  arguments: { title: 'Call Ahmad', dueDate: '2026-09-01' },
  requestId: 'req-1',
  timeZone: 'Europe/Berlin',
}

describe('Chat V2 Slice 2A -- server-owned tool execution lifecycle', () => {
  it('1. no approval -> no execution: a freshly requested (ask-mode) execution never runs the domain write', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
    expect(response.status).toBe(200)
    const body = await response.json() as { executionId: string; status: string }
    expect(body.status).toBe('approval_pending')
    expect(calls.some((c) => c.method === 'PATCH' || (c.method === 'POST' && c.url.includes('/tasks')))).toBe(false)
    expect(table.rows[0]?.status).toBe('approval_pending')
  })

  it('2. client "approved:true" alone cannot execute -- the approve endpoint ignores any body field except executionId', async () => {
    const table = new FakeExecutionsTable()
    table.insert({
      user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
      intent_id: 'intent:aaa', canonical_hash: 'aaa', normalized_arguments: { title: 'Call Ahmad' },
      time_zone: 'Europe/Berlin', status: 'approval_pending', approval_requested_at: new Date().toISOString(),
    })
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(
      authRequest('/agent/execution/approve', { executionId: table.rows[0].id, approved: true, arguments: { title: 'SOMETHING ELSE ENTIRELY' } }),
      mockEnv(),
    ))
    expect(response.status).toBe(200)
    const body = await response.json() as { status: string }
    expect(body.status).toBe('succeeded')
    // The row that actually executed still carries the ORIGINAL title, not
    // the "approved:true" call's smuggled arguments field -- proving that
    // field was never read.
    expect(table.rows[0].normalized_arguments.title).toBe('Call Ahmad')
  })

  it('3. wrong user -> denied (actor mismatch), even though the row genuinely exists', async () => {
    const table = new FakeExecutionsTable()
    table.insert({
      user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
      intent_id: 'intent:bbb', canonical_hash: 'bbb', normalized_arguments: { title: 'Call Ahmad' },
      status: 'approval_pending', approval_requested_at: new Date().toISOString(),
    })
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(
      authRequest('/agent/execution/approve', { executionId: table.rows[0].id }, OTHER_USER_ID),
      mockEnv(),
    ))
    expect(response.status).toBe(403)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('ACTOR_MISMATCH')
    expect(table.rows[0].status).toBe('approval_pending')
  })

  it('4. modified args after approval -> denied by construction: a request+approve round trip never re-reads arguments from the approve call at all', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const requestResponse = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
    const { executionId } = await requestResponse.json() as { executionId: string }

    const approveResponse = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(
      authRequest('/agent/execution/approve', { executionId, arguments: { title: 'TAMPERED TITLE' } }),
      mockEnv(),
    ))
    expect(approveResponse.status).toBe(200)
    expect(table.rows[0].normalized_arguments.title).toBe('Call Ahmad')
  })

  it('6. unknown execution id -> denied', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: 'exec-does-not-exist' }), mockEnv()))
    expect(response.status).toBe(404)
    expect((await response.json() as { error: string }).error).toBe('UNKNOWN_EXECUTION_ID')
  })

  it('7. duplicate/concurrent execute request -> at most one write: two approve calls racing on the same execution only ever produce one succeeded execution and one loser', async () => {
    const table = new FakeExecutionsTable()
    table.insert({
      user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
      intent_id: 'intent:ccc', canonical_hash: 'ccc', normalized_arguments: { title: 'Call Ahmad' },
      time_zone: 'Europe/Berlin', status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
    })
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const executionId = table.rows[0].id
    const [first, second] = await withFetch(fetchMock, () => Promise.all([
      handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId }), mockEnv()),
      handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId }), mockEnv()),
    ]))
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 409])
    expect(table.rows[0].status).toBe('succeeded')
  })

  it('re-approving an already-succeeded execution is rejected as a duplicate, not re-executed', async () => {
    const table = new FakeExecutionsTable()
    table.insert({
      user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
      intent_id: 'intent:ddd', canonical_hash: 'ddd', normalized_arguments: { title: 'Call Ahmad' },
      status: 'succeeded', target_id: 'task-1',
    })
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
    expect(response.status).toBe(409)
    expect((await response.json() as { error: string; status: string }).error).toBe('DUPLICATE_EXECUTION')
  })

  it('8. expired intent -> denied: an approval_pending row past the approval window is expired, not silently honored', async () => {
    const table = new FakeExecutionsTable()
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
    table.insert({
      user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
      intent_id: 'intent:eee', canonical_hash: 'eee', normalized_arguments: { title: 'Call Ahmad' },
      status: 'approval_pending', approval_requested_at: stale,
    })
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
    expect(response.status).toBe(410)
    expect((await response.json() as { error: string }).error).toBe('INTENT_EXPIRED')
    expect(table.rows[0].status).toBe('expired')
  })

  it('a row already revoked/expired/denied is rejected as a duplicate on a later approve attempt, never re-processed', async () => {
    const table = new FakeExecutionsTable()
    table.insert({
      user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
      intent_id: 'intent:fff', canonical_hash: 'fff', normalized_arguments: {}, status: 'revoked',
    })
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
    expect(response.status).toBe(409)
  })

  it('9. server policy ask/off is still enforced fresh at approve time, even if it was ask when the pending row was created', async () => {
    const table = new FakeExecutionsTable()
    table.insert({
      user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
      intent_id: 'intent:ggg', canonical_hash: 'ggg', normalized_arguments: { title: 'Call Ahmad' },
      time_zone: 'Europe/Berlin', status: 'approval_pending', approval_requested_at: new Date().toISOString(),
    })
    const { fetchMock } = buildFetchMock({ table, policyMode: 'off' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
    expect(response.status).toBe(403)
    expect((await response.json() as { error: string }).error).toBe('POLICY_DENIED')
    expect(table.rows[0].status).toBe('denied')
  })

  it('request-phase policy off refuses to even create a pending row', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'off' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
    expect(response.status).toBe(403)
    expect(table.rows).toHaveLength(0)
  })

  it('10. successful execution creates an authoritative succeeded record with a real target id', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask', taskRow: { id: 'task-99', title: 'Call Ahmad', due_date: '2026-09-01' } })
    const requestResponse = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
    const { executionId } = await requestResponse.json() as { executionId: string }
    const approveResponse = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId }), mockEnv()))
    expect(approveResponse.status).toBe(200)
    const body = await approveResponse.json() as { status: string; reply: string }
    expect(body.status).toBe('succeeded')
    expect(table.rows[0].status).toBe('succeeded')
    expect(table.rows[0].target_type).toBe('task')
    expect(table.rows[0].completed_at).toBeTruthy()
  })

  it('11. a failed execution (target not found) creates a failed record with a bounded error category, not the raw internal reason', async () => {
    const table = new FakeExecutionsTable()
    table.insert({
      user_id: USER_ID, domain: 'tasks', action: 'complete', tool_id: 'tasks.complete',
      intent_id: 'intent:hhh', canonical_hash: 'hhh', normalized_arguments: {}, target_id: 'task-missing',
      time_zone: 'Europe/Berlin', status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
    })
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask', failDomainWrite: true })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; errorCode: string }
    expect(body.status).toBe('failed')
    expect(body.errorCode).toBe('TARGET_NOT_FOUND')
    expect(table.rows[0].status).toBe('failed')
    expect(table.rows[0].error_code).toBe('TARGET_NOT_FOUND')
  })

  it('12. an unauthenticated request is rejected before touching the executions table at all', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY, null), mockEnv()))
    expect(response.status).toBe(401)
    expect(table.rows).toHaveLength(0)
  })

  it('unsupported tool id is rejected before any database write', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(
      authRequest('/agent/execution/request', { ...TASK_CREATE_REQUEST_BODY, toolId: 'finance.create_transaction' }),
      mockEnv(),
    ))
    expect(response.status).toBe(400)
    expect((await response.json() as { error: string }).error).toBe('UNSUPPORTED_TOOL')
    expect(table.rows).toHaveLength(0)
  })

  it('mode auto executes immediately in the request call, with no separate approve step needed', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'auto', taskRow: { id: 'task-auto', title: 'Call Ahmad', due_date: '2026-09-01' } })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; executionId: string }
    expect(body.status).toBe('succeeded')
    expect(table.rows[0].status).toBe('succeeded')
    // BLOCKER C CORRECTION: a terminal auto result must still carry the
    // executionId the durable row was actually created under -- previously
    // absent from this response entirely, which left the client with no way
    // to distinguish (or diagnostically correlate) a genuinely auto-executed
    // write from a malformed response, and no id to log/report against.
    expect(body.executionId).toBe(table.rows[0].id)
  })

  // BLOCKER C: an auto-resolved FAILURE or UNCERTAIN outcome must carry
  // executionId too, not only the succeeded case above -- the client-side
  // wiring (ChatPage.tsx / writeRuntime.ts's requestWriteExecution) needs it
  // to correlate a terminal auto result back to the exact row it describes,
  // for every terminal status, not just the happy path.
  it('BLOCKER C: mode auto still returns executionId when the auto-executed write fails', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'auto', failDomainWrite: true })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
    const body = await response.json() as { status: string; executionId: string }
    expect(body.status).toBe('failed')
    expect(body.executionId).toBe(table.rows[0].id)
  })

  it('BLOCKER C: mode auto still returns executionId when the auto-executed write resolves to uncertain', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'auto', throwOnDomainWrite: true })
    const response = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
    const body = await response.json() as { status: string; executionId: string }
    expect(body.status).toBe('uncertain')
    expect(body.executionId).toBe(table.rows[0].id)
  })

  it('a genuine retry of the identical pending request (same idempotency-relevant fields) reuses the existing row instead of erroring', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const first = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
    const second = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
    const firstBody = await first.json() as { executionId: string }
    const secondBody = await second.json() as { executionId: string }
    expect(secondBody.executionId).toBe(firstBody.executionId)
    expect(table.rows).toHaveLength(1)
  })

  it('5. intent/hash mismatch -> denied: this endpoint never accepts a client-supplied hash at all, so two requests (with two distinct request ids) that genuinely differ in any identity-relevant field always produce two distinct, independently-approvable rows -- there is no way to smuggle one request\'s approval onto a different action\'s execution', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
    const first = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
    const second = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(
      authRequest('/agent/execution/request', { ...TASK_CREATE_REQUEST_BODY, requestId: 'req-2', arguments: { title: 'Call Sara', dueDate: '2026-09-01' } }),
      mockEnv(),
    ))
    const firstBody = await first.json() as { executionId: string }
    const secondBody = await second.json() as { executionId: string }
    expect(secondBody.executionId).not.toBe(firstBody.executionId)
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0].canonical_hash).not.toBe(table.rows[1].canonical_hash)

    // Approving the SECOND execution never touches or advances the FIRST.
    await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: secondBody.executionId }), mockEnv()))
    expect(table.rows.find((r) => r.id === firstBody.executionId)?.status).toBe('approval_pending')
  })

  // BLOCKER B: idempotency identity (request_id, a single attempt) must
  // never be conflated with semantic intent identity (canonical_hash/
  // intent_id, the immutable action itself). The three tests below prove
  // the three required behaviors the correction pass demanded, in order.
  describe('BLOCKER B: request-id idempotency is scoped separately from the permanent semantic intent hash', () => {
    it('A. same requestId retried with the SAME canonical intent reuses the one existing row -- no duplicate execution', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
      const first = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
      const retry = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
      const firstBody = await first.json() as { executionId: string }
      const retryBody = await retry.json() as { executionId: string }
      expect(retry.status).toBe(200)
      expect(retryBody.executionId).toBe(firstBody.executionId)
      expect(table.rows).toHaveLength(1)
    })

    it('B. same requestId reused with a DIFFERENT canonical intent (a request-id substitution attempt) fails closed -- no new row, the original row is never reused or extended to the new action', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
      const first = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
      const firstBody = await first.json() as { executionId: string; status: string }

      const substitution = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(
        authRequest('/agent/execution/request', { ...TASK_CREATE_REQUEST_BODY, arguments: { title: 'Something else entirely', dueDate: '2026-09-01' } }),
        mockEnv(),
      ))
      expect(substitution.status).toBe(409)
      expect((await substitution.json() as { error: string }).error).toBe('REQUEST_ID_CONFLICT')
      // No second row was created, and the original row's own recorded
      // arguments/status are untouched by the rejected attempt.
      expect(table.rows).toHaveLength(1)
      expect(table.rows[0].id).toBe(firstBody.executionId)
      expect(table.rows[0].normalized_arguments.title).toBe('Call Ahmad')
      expect(table.rows[0].status).toBe('approval_pending')

      // The substitution attempt never even reaches an executable state --
      // there is no executionId in its response to approve.
      const approveOriginal = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: firstBody.executionId }), mockEnv()))
      expect(approveOriginal.status).toBe(200)
      expect((await approveOriginal.json() as { status: string }).status).toBe('succeeded')
    })

    it('C. a genuinely NEW user action (a different requestId) for the exact same semantic intent creates an independent second row, approvable on its own', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask' })
      const first = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', TASK_CREATE_REQUEST_BODY), mockEnv()))
      const firstBody = await first.json() as { executionId: string }
      const approveFirst = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: firstBody.executionId }), mockEnv()))
      expect((await approveFirst.json() as { status: string }).status).toBe('succeeded')

      // Same actor/tool/domain/action/arguments/target as the first request
      // -- the identical canonical hash -- but a brand new requestId, as a
      // genuinely separate later user action ("do that again").
      const second = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(
        authRequest('/agent/execution/request', { ...TASK_CREATE_REQUEST_BODY, requestId: 'req-again' }),
        mockEnv(),
      ))
      const secondBody = await second.json() as { executionId: string; status: string }
      expect(second.status).toBe(200)
      expect(secondBody.executionId).not.toBe(firstBody.executionId)
      expect(secondBody.status).toBe('approval_pending')
      expect(table.rows).toHaveLength(2)
      expect(table.rows[1].canonical_hash).toBe(table.rows[0].canonical_hash)
      expect(table.rows[1].request_id).toBe('req-again')

      const approveSecond = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: secondBody.executionId }), mockEnv()))
      expect(approveSecond.status).toBe(200)
      expect((await approveSecond.json() as { status: string }).status).toBe('succeeded')
      // Two genuinely separate task-creation writes happened -- the second
      // action actually executed, it was not silently absorbed into the
      // first.
      expect(calls.filter((c) => c.method === 'POST' && c.url.includes('/rest/v1/tasks'))).toHaveLength(2)
    })
  })

  it('tasks.complete executes via its own small server function, correctly bounded to the target task only', async () => {
    const table = new FakeExecutionsTable()
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask', taskRow: { id: 'task-complete-me', title: 'Call Ahmad', due_date: null } })
    const requestResponse = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(
      authRequest('/agent/execution/request', { toolId: 'tasks.complete', targetId: 'task-complete-me', arguments: {}, requestId: 'req-complete', timeZone: 'Europe/Berlin' }),
      mockEnv(),
    ))
    const { executionId, status } = await requestResponse.json() as { executionId: string; status: string }
    expect(status).toBe('approval_pending')
    const approveResponse = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId }), mockEnv()))
    expect(approveResponse.status).toBe(200)
    expect((await approveResponse.json() as { status: string }).status).toBe('succeeded')
  })

  it('calendar.create_event persists the exact same UTC instant a direct calendarService write would have, for any IANA time zone -- the UTC-local-UTC round trip through executeAutoCalendarWrite is lossless', async () => {
    const table = new FakeExecutionsTable()
    const captured: Array<{ method: string; url: string; body?: Record<string, unknown> }> = []
    const { fetchMock } = buildFetchMock({ table, policyMode: 'ask', eventRow: { id: 'event-1', title: 'Standup', date: '2026-09-01', start_time: '08:30', end_time: '09:00' } })
    const wrapped = (async (url: string, init?: RequestInit) => {
      const response = await fetchMock(url, init)
      if (String(url).includes('/rest/v1/calendar_events') && init?.method === 'POST') {
        captured.push({ method: init.method, url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined })
      }
      return response
    }) as typeof fetch

    const requestBody = {
      toolId: 'calendar.create_event',
      // A genuine UTC ISO instant, exactly as calendarCreateEventHandler.ts
      // passes it today -- calendarService.ts's own naive slice would store
      // date="2026-09-01" start_time="08:30" from this exact string.
      arguments: { title: 'Standup', dateTimeStart: '2026-09-01T08:30:00.000Z', dateTimeEnd: '2026-09-01T09:00:00.000Z' },
      requestId: 'req-cal-1',
      // A non-UTC zone specifically, so a naive 'UTC'-only treatment (the
      // rejected earlier approach) would have been detectably wrong here.
      timeZone: 'America/New_York',
    }
    const requestResponse = await withFetch(wrapped, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', requestBody), mockEnv()))
    const { executionId } = await requestResponse.json() as { executionId: string }
    const approveResponse = await withFetch(wrapped, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId }), mockEnv()))
    expect(approveResponse.status).toBe(200)

    const insertedEvent = captured.find((c) => c.method === 'POST')
    expect(insertedEvent?.body?.date).toBe('2026-09-01')
    expect(insertedEvent?.body?.start_time).toBe('08:30')
    expect(insertedEvent?.body?.end_time).toBe('09:00')
  })

  // BLOCKER 3: real Worker-level tests inspecting the ACTUAL PATCH payload
  // (via `calls`) and the authoritative round-tripped response -- not a
  // mock that merely says {status:"succeeded"}. Each of these would have
  // failed against the pre-correction code: tasks.update's PATCH body only
  // ever sent due_date (title/notes were silently dropped); calendar's
  // patch only ever sent date/start_time/end_time TOGETHER, dropping
  // title/notes entirely and refusing to apply end_time without an
  // accompanying start_time.
  describe('BLOCKER 3: tasks.update and calendar.update_event apply every supported field, preserve the rest', () => {
    async function requestAndApprove(fetchMock: typeof fetch, requestBody: Record<string, unknown>) {
      const requestResponse = await withFetch(fetchMock, () => handleAgentToolExecutionRequest(authRequest('/agent/execution/request', requestBody), mockEnv()))
      const { executionId } = await requestResponse.json() as { executionId: string }
      const approveResponse = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId }), mockEnv()))
      return { approveResponse, body: await approveResponse.json() as Record<string, unknown> }
    }

    it('tasks.update title only -- patches title, leaves notes/due_date untouched in the request payload', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', taskRow: { id: 'task-1', title: 'Old title', notes: 'Old notes', due_date: '2026-09-01' } })
      const { approveResponse, body } = await requestAndApprove(fetchMock, {
        toolId: 'tasks.update', targetId: 'task-1', arguments: { title: 'New title' }, requestId: 'req-title', timeZone: 'Europe/Berlin',
      })
      expect(approveResponse.status).toBe(200)
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/tasks'))
      expect((patchCall?.body as Record<string, unknown>).title).toBe('New title')
      expect(patchCall?.body).not.toHaveProperty('notes')
      expect(body).toMatchObject({ status: 'succeeded', title: 'New title', notes: 'Old notes', dueDate: '2026-09-01' })
    })

    it('tasks.update notes only -- patches notes, leaves title/due_date untouched in the request payload', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', taskRow: { id: 'task-1', title: 'Kept title', notes: 'Old notes', due_date: '2026-09-01' } })
      const { body } = await requestAndApprove(fetchMock, {
        toolId: 'tasks.update', targetId: 'task-1', arguments: { notes: 'New notes' }, requestId: 'req-notes', timeZone: 'Europe/Berlin',
      })
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/tasks'))
      expect((patchCall?.body as Record<string, unknown>).notes).toBe('New notes');
      expect(patchCall?.body).not.toHaveProperty('title')
      expect(body).toMatchObject({ status: 'succeeded', title: 'Kept title', notes: 'New notes', dueDate: '2026-09-01' })
    })

    it('tasks.update dueDate only -- patches due_date, leaves title/notes untouched in the request payload', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', taskRow: { id: 'task-1', title: 'Kept title', notes: 'Kept notes', due_date: '2026-09-01' } })
      const { body } = await requestAndApprove(fetchMock, {
        toolId: 'tasks.update', targetId: 'task-1', arguments: { dueDate: '2026-10-01' }, requestId: 'req-due', timeZone: 'Europe/Berlin',
      })
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/tasks'))
      expect((patchCall?.body as Record<string, unknown>).due_date).toBe('2026-10-01')
      expect(patchCall?.body).not.toHaveProperty('title')
      expect(patchCall?.body).not.toHaveProperty('notes')
      expect(body).toMatchObject({ status: 'succeeded', title: 'Kept title', notes: 'Kept notes', dueDate: '2026-10-01' })
    })

    it('tasks.update combined fields -- applies title, notes, AND dueDate together in one request', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', taskRow: { id: 'task-1', title: 'Old', notes: 'Old notes', due_date: '2026-09-01' } })
      const { body } = await requestAndApprove(fetchMock, {
        toolId: 'tasks.update', targetId: 'task-1', arguments: { title: 'New', notes: 'New notes', dueDate: '2026-10-01' }, requestId: 'req-combined', timeZone: 'Europe/Berlin',
      })
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/tasks'))
      expect(patchCall?.body).toMatchObject({ title: 'New', notes: 'New notes', due_date: '2026-10-01' })
      expect(body).toMatchObject({ status: 'succeeded', title: 'New', notes: 'New notes', dueDate: '2026-10-01' })
    })

    it('calendar.update_event title only -- patches title, leaves date/start_time/end_time/description untouched', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', eventRow: { id: 'event-1', title: 'Old title', date: '2026-09-01', start_time: '08:30', end_time: '09:00', description: 'Old notes' } })
      const { body } = await requestAndApprove(fetchMock, {
        toolId: 'calendar.update_event', targetId: 'event-1', arguments: { title: 'New title' }, requestId: 'req-cal-title', timeZone: 'Europe/Berlin',
      })
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/calendar_events'))
      expect((patchCall?.body as Record<string, unknown>).title).toBe('New title')
      expect(patchCall?.body).not.toHaveProperty('date')
      expect(patchCall?.body).not.toHaveProperty('start_time')
      expect(patchCall?.body).not.toHaveProperty('end_time')
      expect(body).toMatchObject({ status: 'succeeded', title: 'New title', notes: 'Old notes' })
    })

    it('calendar.update_event notes only -- patches description, leaves everything else untouched', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', eventRow: { id: 'event-1', title: 'Kept title', date: '2026-09-01', start_time: '08:30', end_time: '09:00', description: 'Old notes' } })
      const { body } = await requestAndApprove(fetchMock, {
        toolId: 'calendar.update_event', targetId: 'event-1', arguments: { notes: 'New notes' }, requestId: 'req-cal-notes', timeZone: 'Europe/Berlin',
      })
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/calendar_events'))
      expect((patchCall?.body as Record<string, unknown>).description).toBe('New notes')
      expect(patchCall?.body).not.toHaveProperty('title')
      expect(patchCall?.body).not.toHaveProperty('date')
      expect(body).toMatchObject({ status: 'succeeded', title: 'Kept title', notes: 'New notes' })
    })

    it('calendar.update_event start only -- patches date/start_time, leaves end_time/title/description untouched', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', eventRow: { id: 'event-1', title: 'Kept title', date: '2026-09-01', start_time: '08:30', end_time: '09:00', description: 'Kept notes' } })
      const { body } = await requestAndApprove(fetchMock, {
        toolId: 'calendar.update_event', targetId: 'event-1', arguments: { dateTimeStart: '2026-09-02T10:00:00.000Z' }, requestId: 'req-cal-start', timeZone: 'UTC',
      })
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/calendar_events'))
      expect((patchCall?.body as Record<string, unknown>).date).toBe('2026-09-02')
      expect((patchCall?.body as Record<string, unknown>).start_time).toBe('10:00')
      expect(patchCall?.body).not.toHaveProperty('end_time')
      expect(body).toMatchObject({ status: 'succeeded', title: 'Kept title', notes: 'Kept notes' })
    })

    it('calendar.update_event end only -- patches end_time alone, independently of start_time (previously impossible)', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', eventRow: { id: 'event-1', title: 'Kept title', date: '2026-09-01', start_time: '08:30', end_time: '09:00', description: 'Kept notes' } })
      const { body } = await requestAndApprove(fetchMock, {
        toolId: 'calendar.update_event', targetId: 'event-1', arguments: { dateTimeEnd: '2026-09-01T09:45:00.000Z' }, requestId: 'req-cal-end', timeZone: 'UTC',
      })
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/calendar_events'))
      expect((patchCall?.body as Record<string, unknown>).end_time).toBe('09:45')
      expect(patchCall?.body).not.toHaveProperty('start_time')
      expect(patchCall?.body).not.toHaveProperty('title')
      expect(body).toMatchObject({ status: 'succeeded', title: 'Kept title', notes: 'Kept notes' })
      expect(body.dateTimeEnd).toBe('2026-09-01T09:45:00.000Z')
    })

    it('calendar.update_event combined fields -- applies title, notes, start, AND end together in one request', async () => {
      const table = new FakeExecutionsTable()
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', eventRow: { id: 'event-1', title: 'Old', date: '2026-09-01', start_time: '08:30', end_time: '09:00', description: 'Old notes' } })
      const { body } = await requestAndApprove(fetchMock, {
        toolId: 'calendar.update_event',
        targetId: 'event-1',
        arguments: { title: 'New', notes: 'New notes', dateTimeStart: '2026-09-03T14:00:00.000Z', dateTimeEnd: '2026-09-03T15:30:00.000Z' },
        requestId: 'req-cal-combined',
        timeZone: 'UTC',
      })
      const patchCall = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/calendar_events'))
      expect(patchCall?.body).toMatchObject({ title: 'New', description: 'New notes', date: '2026-09-03', start_time: '14:00', end_time: '15:30' })
      expect(body).toMatchObject({ status: 'succeeded', title: 'New', notes: 'New notes' })
    })
  })

  // BLOCKER 4: honest execution exception/uncertain-state handling. There
  // is no in-between here -- a caller either gets a genuinely PROVEN
  // succeeded/failed outcome, or an honest 'uncertain' one; never a
  // fabricated success/failure after the durable executing claim.
  describe('BLOCKER 4: honest execution exception state (uncertain)', () => {
    it('1. the domain executor throwing after the executing claim resolves to uncertain, never a fabricated succeeded/failed', async () => {
      const table = new FakeExecutionsTable()
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'update', tool_id: 'tasks.update',
        request_id: 'req-throw', intent_id: 'intent:throw', canonical_hash: 'throw', normalized_arguments: { title: 'New' }, target_id: 'task-1',
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock } = buildFetchMock({ table, policyMode: 'ask', throwOnDomainWrite: true })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(response.status).toBe(200)
      const body = await response.json() as { status: string; errorCode: string }
      expect(body.status).toBe('uncertain')
      expect(body.errorCode).toBe('EXECUTION_OUTCOME_UNKNOWN')
    })

    it('2. simulated network ambiguity: the domain write succeeds but the durable succeeded transition cannot be recorded -- resolves to uncertain, and the row itself is durably moved to uncertain (never left parked in executing)', async () => {
      const table = new FakeExecutionsTable()
      table.blockTransitionTo.add('succeeded')
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
        request_id: 'req-ambiguous', intent_id: 'intent:ambiguous', canonical_hash: 'ambiguous', normalized_arguments: { title: 'Call Ahmad' },
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(response.status).toBe(200)
      const body = await response.json() as { status: string; errorCode: string }
      expect(body.status).toBe('uncertain')
      expect(body.errorCode).toBe('EXECUTION_OUTCOME_UNKNOWN')
      // BLOCKER B CORRECTION: the executing -> succeeded transition being
      // blocked no longer leaves the row silently parked in 'executing' --
      // the module now attempts (and here, succeeds at) the separate
      // executing -> uncertain transition, since only 'succeeded' is
      // blocked in this fake, not 'uncertain'.
      expect(table.rows[0].status).toBe('uncertain')
    })

    it('2b. BLOCKER B: the durable failed transition being blocked also resolves to uncertain, both for the caller and the row itself', async () => {
      const table = new FakeExecutionsTable()
      table.blockTransitionTo.add('failed')
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'update', tool_id: 'tasks.update',
        request_id: 'req-failed-blocked', intent_id: 'intent:failed-blocked', canonical_hash: 'failed-blocked', normalized_arguments: { title: 'New' }, target_id: 'task-1',
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      // failDomainWrite: the domain write itself resolves to a proven,
      // ordinary failure (empty RETURNING -> 'not_found'), not a thrown
      // exception; only the durable 'failed' transition is blocked.
      const { fetchMock } = buildFetchMock({ table, policyMode: 'ask', failDomainWrite: true })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(response.status).toBe(200)
      const body = await response.json() as { status: string; errorCode: string }
      expect(body.status).toBe('uncertain')
      expect(body.errorCode).toBe('EXECUTION_OUTCOME_UNKNOWN')
      expect(table.rows[0].status).toBe('uncertain')
    })

    it('2c. BLOCKER B: when even the executing -> uncertain transition itself cannot be recorded, the response is a distinct, bounded lifecycle-persistence outcome -- never a fabricated durable "uncertain" claim', async () => {
      const table = new FakeExecutionsTable()
      table.blockTransitionTo.add('succeeded')
      table.blockTransitionTo.add('uncertain')
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
        request_id: 'req-doubly-blocked', intent_id: 'intent:doubly-blocked', canonical_hash: 'doubly-blocked', normalized_arguments: { title: 'Call Ahmad' },
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(response.status).toBe(200)
      const body = await response.json() as { status: string; errorCode: string }
      // Still never claims succeeded/failed -- but a DIFFERENT errorCode
      // than the ordinary, durably-recorded uncertain outcome, since this
      // path could not even confirm the row itself says 'uncertain'.
      expect(body.status).toBe('uncertain')
      expect(body.errorCode).toBe('EXECUTION_LIFECYCLE_PERSISTENCE_FAILED')
      expect(body.errorCode).not.toBe('EXECUTION_OUTCOME_UNKNOWN')
      // The row's real status is whatever it already was -- still
      // 'executing' here, since neither blocked transition ever applied --
      // proving this path never silently reports "recorded" when it wasn't.
      expect(table.rows[0].status).toBe('executing')
    })

    it('3. a domain-executor throw still leaves the row in a well-defined terminal state, never silently stuck in executing forever', async () => {
      const table = new FakeExecutionsTable()
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'update', tool_id: 'tasks.update',
        request_id: 'req-stuck', intent_id: 'intent:stuck', canonical_hash: 'stuck', normalized_arguments: { title: 'New' }, target_id: 'task-1',
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock } = buildFetchMock({ table, policyMode: 'ask', throwOnDomainWrite: true })
      await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(table.rows[0].status).toBe('uncertain')
      expect(table.rows[0].error_code).toBe('EXECUTION_OUTCOME_UNKNOWN')
    })

    it('4. no automatic retry after a thrown domain execution -- the module never re-attempts the write itself', async () => {
      const table = new FakeExecutionsTable()
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'update', tool_id: 'tasks.update',
        request_id: 'req-no-retry', intent_id: 'intent:no-retry', canonical_hash: 'no-retry', normalized_arguments: { title: 'New' }, target_id: 'task-1',
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', throwOnDomainWrite: true })
      await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      const taskWriteAttempts = calls.filter((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/tasks'))
      expect(taskWriteAttempts).toHaveLength(1)
    })

    it('5. an uncertain execution cannot be blindly re-approved -- a later approve call on the same row is rejected as a duplicate, never re-executed', async () => {
      const table = new FakeExecutionsTable()
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'update', tool_id: 'tasks.update',
        request_id: 'req-reapprove', intent_id: 'intent:reapprove', canonical_hash: 'reapprove', normalized_arguments: { title: 'New' }, target_id: 'task-1',
        status: 'uncertain', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask' })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(response.status).toBe(409)
      expect((await response.json() as { error: string }).error).toBe('DUPLICATE_EXECUTION')
      expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/tasks'))).toBe(false)
    })

    it('6. a succeeded response is never returned unless the durable succeeded transition was actually recorded', async () => {
      const table = new FakeExecutionsTable()
      table.blockTransitionTo.add('succeeded')
      table.insert({
        user_id: USER_ID, domain: 'calendar', action: 'create', tool_id: 'calendar.create_event',
        request_id: 'req-durable-check', intent_id: 'intent:durable-check', canonical_hash: 'durable-check',
        normalized_arguments: { title: 'Standup', dateTimeStart: '2026-09-01T08:30:00.000Z', dateTimeEnd: '2026-09-01T09:00:00.000Z' },
        time_zone: 'UTC', status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock } = buildFetchMock({ table, policyMode: 'ask' })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      const body = await response.json() as { status: string }
      expect(body.status).not.toBe('succeeded')
      expect(body.status).toBe('uncertain')
    })
  })

  // LIFECYCLE TRANSPORT CORRECTION: transitionStatus's underlying PostgREST
  // call can itself THROW (network rejection, non-2xx response), not just
  // resolve with zero matched rows -- a genuinely different, more ambiguous
  // failure mode than BLOCKER 4's blockTransitionTo tests above (which
  // simulate a normal response that reliably proves nothing matched). A
  // thrown transition means the database's real state is UNKNOWN from the
  // response alone -- these tests prove a readback (never a retry of the
  // domain mutation, never a retry of the same transition) is what
  // resolves that ambiguity, in both directions.
  describe('LIFECYCLE TRANSPORT CORRECTION: ambiguous transitions (transport throws, not just blocked)', () => {
    it('A. domain succeeds, the succeeded-transition request throws, but the row actually committed -- a readback confirms it and the caller still gets an authoritative succeeded response, with no domain retry', async () => {
      const table = new FakeExecutionsTable()
      table.throwTransitionTo.add('succeeded')
      table.commitBeforeThrow.add('succeeded')
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
        request_id: 'req-transport-a', intent_id: 'intent:transport-a', canonical_hash: 'transport-a', normalized_arguments: { title: 'Call Ahmad' },
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask' })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(response.status).toBe(200)
      const body = await response.json() as { status: string; executionId: string }
      expect(body.status).toBe('succeeded')
      expect(body.executionId).toBe(table.rows[0].id)
      expect(table.rows[0].status).toBe('succeeded')
      // tasks.create writes via POST, not PATCH.
      const taskWriteAttempts = calls.filter((c) => c.method === 'POST' && c.url.includes('/rest/v1/tasks'))
      expect(taskWriteAttempts).toHaveLength(1)
    })

    it('B. domain succeeds, the succeeded-transition request throws and did NOT commit -- a readback shows the row still executing, the uncertain fallback transition succeeds, and the row/response are both uncertain', async () => {
      const table = new FakeExecutionsTable()
      table.throwTransitionTo.add('succeeded')
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'create', tool_id: 'tasks.create',
        request_id: 'req-transport-b', intent_id: 'intent:transport-b', canonical_hash: 'transport-b', normalized_arguments: { title: 'Call Ahmad' },
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask' })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(response.status).toBe(200)
      const body = await response.json() as { status: string; errorCode: string }
      expect(body.status).toBe('uncertain')
      expect(body.errorCode).toBe('EXECUTION_OUTCOME_UNKNOWN')
      expect(table.rows[0].status).toBe('uncertain')
      // tasks.create writes via POST, not PATCH.
      const taskWriteAttempts = calls.filter((c) => c.method === 'POST' && c.url.includes('/rest/v1/tasks'))
      expect(taskWriteAttempts).toHaveLength(1)
    })

    it('C. a proven domain failure, the failed-transition request throws and did NOT commit -- a readback shows the row still executing, the uncertain fallback transition succeeds, and the row is uncertain', async () => {
      const table = new FakeExecutionsTable()
      table.throwTransitionTo.add('failed')
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'update', tool_id: 'tasks.update',
        request_id: 'req-transport-c', intent_id: 'intent:transport-c', canonical_hash: 'transport-c', normalized_arguments: { title: 'New' }, target_id: 'task-1',
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', failDomainWrite: true })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(response.status).toBe(200)
      const body = await response.json() as { status: string; errorCode: string }
      expect(body.status).toBe('uncertain')
      expect(body.errorCode).toBe('EXECUTION_OUTCOME_UNKNOWN')
      expect(table.rows[0].status).toBe('uncertain')
      const taskWriteAttempts = calls.filter((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/tasks'))
      expect(taskWriteAttempts).toHaveLength(1)
    })

    it('D. the domain executor itself throws, and the uncertain-transition request ALSO throws without committing -- a readback still shows executing, so this resolves to the distinct bounded EXECUTION_LIFECYCLE_PERSISTENCE_FAILED outcome, never a fabricated uncertain claim, with no domain retry', async () => {
      const table = new FakeExecutionsTable()
      table.throwTransitionTo.add('uncertain')
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'update', tool_id: 'tasks.update',
        request_id: 'req-transport-d', intent_id: 'intent:transport-d', canonical_hash: 'transport-d', normalized_arguments: { title: 'New' }, target_id: 'task-1',
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', throwOnDomainWrite: true })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(response.status).toBe(200)
      const body = await response.json() as { status: string; errorCode: string }
      expect(body.status).toBe('uncertain')
      expect(body.errorCode).toBe('EXECUTION_LIFECYCLE_PERSISTENCE_FAILED')
      // The row's real status is whatever it already was -- still
      // 'executing' -- since the uncertain transition never actually
      // committed, proving this path never silently reports "recorded"
      // when it wasn't.
      expect(table.rows[0].status).toBe('executing')
      // Exactly the one attempt throwOnDomainWrite simulates -- never a
      // second, automatic retry of the domain mutation.
      const taskWriteAttempts = calls.filter((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/tasks'))
      expect(taskWriteAttempts).toHaveLength(1)
    })

    it('E. the symmetric case of A for a proven domain failure: the failed-transition request throws but actually committed -- a readback confirms the row already says failed, not uncertain, and the caller gets the authoritative failed response', async () => {
      const table = new FakeExecutionsTable()
      table.throwTransitionTo.add('failed')
      table.commitBeforeThrow.add('failed')
      table.insert({
        user_id: USER_ID, domain: 'tasks', action: 'update', tool_id: 'tasks.update',
        request_id: 'req-transport-e', intent_id: 'intent:transport-e', canonical_hash: 'transport-e', normalized_arguments: { title: 'New' }, target_id: 'task-1',
        status: 'approved', approval_requested_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      })
      const { fetchMock, calls } = buildFetchMock({ table, policyMode: 'ask', failDomainWrite: true })
      const response = await withFetch(fetchMock, () => handleAgentToolExecutionApprove(authRequest('/agent/execution/approve', { executionId: table.rows[0].id }), mockEnv()))
      expect(response.status).toBe(200)
      const body = await response.json() as { status: string; executionId: string; errorCode: string }
      expect(body.status).toBe('failed')
      expect(body.status).not.toBe('uncertain')
      expect(body.executionId).toBe(table.rows[0].id)
      expect(table.rows[0].status).toBe('failed')
      const taskWriteAttempts = calls.filter((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/tasks'))
      expect(taskWriteAttempts).toHaveLength(1)
    })
  })
})
