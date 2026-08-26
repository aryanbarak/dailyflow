// ENG-04: Worker routes backing the engineering-task queue. See
// docs/architecture/notes/eng-04-companion-chat-approval-wiring-v1.md.
//
// Three routes, each with a different, deliberately distinct auth model:
//   POST /engineering-tasks              -- end-user, Supabase bearer token
//   GET  /engineering-tasks/pending      -- companion, shared secret token
//   POST /engineering-tasks/:id/report   -- companion, shared secret token
//   GET  /engineering-tasks/:id          -- end-user, Supabase bearer token
//     (status polling, so chat can surface the result -- Part 1 item 4)
//
// The companion is not a Supabase-authenticated user (ENG-03: it runs on
// the PO's own machine, no login flow) -- ENGINEERING_TASKS_COMPANION_TOKEN
// is the sole authority boundary for the two companion-facing routes,
// exactly as agent/companion's own COMPANION_SHARED_TOKEN gated its
// (now-removed) inbound listener. The Worker never inserts/updates this
// table from anything but a request that passes one of these two checks --
// mirrors github-integration.ts's own pattern of raw PostgREST fetch calls
// authenticated with SUPABASE_SERVICE_KEY, never the Supabase JS SDK.

import type { Env } from './types'

const MAX_REPO_LENGTH = 200
const MAX_INSTRUCTION_LENGTH = 4000
const MAX_TASK_CLASS_LENGTH = 100
const MAX_CLAIMED_BY_LENGTH = 200

// Dependency-injected fetch, mirroring github-integration.ts's own
// convention -- tests supply a fake fetcher instead of stubbing the global.
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>
export interface EngineeringTasksDeps {
  fetcher: Fetcher
}
const defaultDeps: EngineeringTasksDeps = { fetcher: (input, init) => fetch(input, init) }

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function requireSupabaseUser(request: Request, env: Env, deps: EngineeringTasksDeps): Promise<{ userId: string } | Response> {
  const auth = request.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return json({ error: 'Missing authorization token' }, 401)
  }
  const token = auth.slice(7)
  const res = await deps.fetcher(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  })
  if (!res.ok) return json({ error: 'Unauthorized' }, 401)
  const user = (await res.json()) as { id?: string }
  if (!user?.id) return json({ error: 'Invalid token' }, 401)
  return { userId: user.id }
}

function requireCompanionToken(request: Request, env: Env): Response | null {
  if (!env.ENGINEERING_TASKS_COMPANION_TOKEN) {
    return json({ error: 'Engineering task companion polling is not configured.' }, 503)
  }
  const provided = request.headers.get('X-Companion-Token') ?? ''
  if (provided !== env.ENGINEERING_TASKS_COMPANION_TOKEN) {
    return json({ error: 'Missing or invalid companion token.' }, 401)
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function supabaseRest(
  env: Env,
  deps: EngineeringTasksDeps,
  path: string,
  init: RequestInit & { preferReturn?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    ...(init.preferReturn ? { Prefer: 'return=representation' } : {}),
  }
  return deps.fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } })
}

// POST /engineering-tasks -- create a pending row from an already-approved
// chat proposal. The APPROVAL itself already happened (Part 1 item 3: the
// existing approval-card flow, before this route is ever called) -- this
// route only persists the already-decided intent; it does not re-decide
// anything.
async function handleCreate(request: Request, env: Env, deps: EngineeringTasksDeps): Promise<Response> {
  const authResult = await requireSupabaseUser(request, env, deps)
  if (authResult instanceof Response) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }
  if (!isRecord(body)) return json({ error: 'Body must be an object.' }, 400)

  const { repo, instruction, taskClass } = body
  if (typeof repo !== 'string' || repo.length === 0 || repo.length > MAX_REPO_LENGTH) {
    return json({ error: 'repo is required.' }, 400)
  }
  if (typeof instruction !== 'string' || instruction.length === 0 || instruction.length > MAX_INSTRUCTION_LENGTH) {
    return json({ error: 'instruction is required.' }, 400)
  }
  if (typeof taskClass !== 'string' || taskClass.length === 0 || taskClass.length > MAX_TASK_CLASS_LENGTH) {
    return json({ error: 'taskClass is required.' }, 400)
  }

  const insertRes = await supabaseRest(env, deps, 'engineering_tasks', {
    method: 'POST',
    preferReturn: true,
    body: JSON.stringify([{ user_id: authResult.userId, repo, instruction, task_class: taskClass }]),
  })
  if (!insertRes.ok) {
    return json({ error: 'Failed to create engineering task.' }, 502)
  }
  const rows = (await insertRes.json()) as Array<Record<string, unknown>>
  const row = rows[0]
  return json({ id: row?.id, status: row?.status ?? 'pending' }, 201)
}

// GET /engineering-tasks/pending -- the companion's poll. Claims at most
// one task per call via the atomic RPC (no double-claim race -- see the
// migration's claim_pending_engineering_task). `claimedBy` is a query
// param the companion sends purely for its own operator visibility in the
// row; it authorizes nothing.
async function handleClaimPending(request: Request, env: Env, deps: EngineeringTasksDeps): Promise<Response> {
  const tokenError = requireCompanionToken(request, env)
  if (tokenError) return tokenError

  const url = new URL(request.url)
  const claimedByRaw = url.searchParams.get('claimedBy') ?? 'companion'
  const claimedBy = claimedByRaw.slice(0, MAX_CLAIMED_BY_LENGTH)

  const rpcRes = await supabaseRest(env, deps, 'rpc/claim_pending_engineering_task', {
    method: 'POST',
    body: JSON.stringify({ p_claimed_by: claimedBy }),
  })
  if (!rpcRes.ok) {
    return json({ error: 'Failed to poll for pending tasks.' }, 502)
  }
  const rows = (await rpcRes.json()) as Array<Record<string, unknown>>
  if (rows.length === 0) {
    return json({ task: null }, 200)
  }
  const row = rows[0]
  return json({
    task: {
      id: row.id,
      repo: row.repo,
      instruction: row.instruction,
      taskClass: row.task_class,
    },
  }, 200)
}

// POST /engineering-tasks/:id/report -- the companion posts back its
// self-report (advisory) and independently-verified result (ENG-03's own
// distinction, unchanged here) once the task pipeline finishes.
async function handleReport(request: Request, env: Env, taskId: string, deps: EngineeringTasksDeps): Promise<Response> {
  const tokenError = requireCompanionToken(request, env)
  if (tokenError) return tokenError

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }
  if (!isRecord(body)) return json({ error: 'Body must be an object.' }, 400)

  const { ok, selfReport, verified, disagreement, branchName, errorMessage } = body
  const status = ok === true ? 'completed' : 'failed'

  const updateRes = await supabaseRest(env, deps, `engineering_tasks?id=eq.${encodeURIComponent(taskId)}&status=eq.claimed`, {
    method: 'PATCH',
    preferReturn: true,
    body: JSON.stringify({
      status,
      completed_at: new Date().toISOString(),
      branch_name: typeof branchName === 'string' ? branchName : null,
      self_report: selfReport ?? null,
      verified_result: verified ?? null,
      disagreement: disagreement ?? null,
      error_message: typeof errorMessage === 'string' ? errorMessage : null,
    }),
  })
  if (!updateRes.ok) {
    return json({ error: 'Failed to record report.' }, 502)
  }
  const rows = (await updateRes.json()) as Array<Record<string, unknown>>
  if (rows.length === 0) {
    // Either the id doesn't exist, or it wasn't in 'claimed' status (e.g. a
    // duplicate report for an already-completed task) -- fail closed rather
    // than silently accept a second report for the same task.
    return json({ error: 'No matching claimed task found for this id.' }, 409)
  }
  return json({ id: taskId, status }, 200)
}

// GET /engineering-tasks/:id -- status polling for the chat UI (Part 1
// item 4 / Part 2 item 6). Owner-scoped: a user may only poll their own
// task's status.
//
// Part 1 item 5 / this module's honest-offline requirement: a task must
// never silently sit in "pending" forever with no explanation, and never
// silently vanish. This does NOT retry, re-queue, or resume anything
// (explicitly out of scope) -- it only tells the truth about elapsed time,
// derived from timestamps already on the row, so the chat UI can render
// "waiting for your machine to come online" instead of an unexplained
// spinner, or "this task appears stuck" if a companion claimed it and then
// went offline mid-run without ever reporting back.
const PENDING_STALE_AFTER_SECONDS = 120
const CLAIMED_STALE_AFTER_SECONDS = 600

async function handleGetStatus(request: Request, env: Env, taskId: string, deps: EngineeringTasksDeps): Promise<Response> {
  const authResult = await requireSupabaseUser(request, env, deps)
  if (authResult instanceof Response) return authResult

  const getRes = await supabaseRest(env, deps, `engineering_tasks?id=eq.${encodeURIComponent(taskId)}&user_id=eq.${encodeURIComponent(authResult.userId)}&select=*`, {
    method: 'GET',
  })
  if (!getRes.ok) return json({ error: 'Failed to fetch task status.' }, 502)
  const rows = (await getRes.json()) as Array<Record<string, unknown>>
  if (rows.length === 0) return json({ error: 'Not found.' }, 404)
  const row = rows[0]

  const now = Date.now()
  let waitingForCompanion = false
  let stuckInProgress = false
  if (row.status === 'pending' && typeof row.created_at === 'string') {
    waitingForCompanion = (now - Date.parse(row.created_at)) / 1000 > PENDING_STALE_AFTER_SECONDS
  }
  if (row.status === 'claimed' && typeof row.claimed_at === 'string') {
    stuckInProgress = (now - Date.parse(row.claimed_at)) / 1000 > CLAIMED_STALE_AFTER_SECONDS
  }

  return json({
    id: row.id,
    status: row.status,
    repo: row.repo,
    branchName: row.branch_name,
    verifiedResult: row.verified_result,
    disagreement: row.disagreement,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    waitingForCompanion,
    stuckInProgress,
  }, 200)
}

// Mirrors handleGitHubIntegrationRequest's own convention (index.ts):
// returns null when the path isn't one of this module's routes, so the
// caller can fall through to the rest of its own dispatch.
export async function handleEngineeringTasksRequest(
  request: Request,
  env: Env,
  deps: EngineeringTasksDeps = defaultDeps,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname === '/engineering-tasks' && request.method === 'POST') {
    return handleCreate(request, env, deps)
  }
  if (pathname === '/engineering-tasks/pending' && request.method === 'GET') {
    return handleClaimPending(request, env, deps)
  }
  const reportMatch = pathname.match(/^\/engineering-tasks\/([^/]+)\/report$/)
  if (reportMatch && request.method === 'POST') {
    return handleReport(request, env, reportMatch[1], deps)
  }
  const statusMatch = pathname.match(/^\/engineering-tasks\/([^/]+)$/)
  if (statusMatch && request.method === 'GET') {
    return handleGetStatus(request, env, statusMatch[1], deps)
  }
  return null
}
