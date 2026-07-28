import { describe, expect, it } from 'vitest'
import { handleGitHubIntegrationRequest } from './github-integration'
import type { Env } from './types'

const USER_ONE = '11111111-1111-4111-8111-111111111111'
const USER_TWO = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-07-22T10:00:00.000Z')

function env(overrides: Partial<Env> = {}): Env {
  return {
    SMARTFLOW_WORKER_MODE: 'local-qa',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_KEY: 'service-key',
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-model',
    GITHUB_APP_ID: '12345',
    GITHUB_CLIENT_ID: 'Iv1_client',
    GITHUB_APP_SLUG: 'smartflow-local-qa',
    GITHUB_SETUP_URL: 'http://127.0.0.1:8787/github/connect/setup',
    GITHUB_CALLBACK_URL: 'http://127.0.0.1:8787/github/connect/callback',
    GITHUB_ALLOWED_ORIGINS: 'http://localhost:8080',
    GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----',
    GITHUB_CLIENT_SECRET: 'client-secret',
    AI: {} as Ai,
    ...overrides,
  }
}

interface FakeOptions {
  currentUser?: string
  tokenExchangeStatus?: number
  verificationStatus?: number
  verifiedAppId?: number
  verifiedInstallationId?: number
  installationsPages?: unknown[][]
  installationTokenStatus?: number
  repositoriesStatus?: number
  repositories?: unknown
  malformedToken?: boolean
  malformedRepositoriesJson?: boolean
  rejectGitHub?: boolean
  issuesByRepo?: Record<string, unknown[]>
  issuesFailureByRepo?: Record<string, number>
  pullsByRepo?: Record<string, unknown[]>
  pullsFailureByRepo?: Record<string, number>
  workflowRunsByRepo?: Record<string, unknown[]>
  workflowRunsFailureByRepo?: Record<string, number>
  repositoryCacheWriteStatus?: number
  // EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
  accessibleRepos?: string[]
  labelsByRepo?: Record<string, string[]>
  labelsFailureByRepo?: Record<string, number>
  commentResultByRepo?: Record<string, { id: number; html_url: string } | number>
  updateResultByRepo?: Record<string, { number: number; html_url: string } | number>
  writeLogInsertStatus?: number
  writeLogUpdateStatus?: number
  preseedWriteLogRows?: Array<Record<string, unknown>>
  // EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
  defaultBranchByRepo?: Record<string, string>
  branchCommitShaByRepo?: Record<string, string>
  branchFailureByRepo?: Record<string, number>
  fileContentByRepo?: Record<string, { sha: string; content: string; encoding?: string; size?: number; type?: string }>
  fileContentFailureByRepo?: Record<string, number>
}

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fakeProvider(options: FakeOptions = {}) {
  let currentUser = options.currentUser ?? USER_ONE
  let attempt: Record<string, unknown> | undefined
  let connection: Record<string, unknown> | undefined
  let randomCall = 0
  let writeLogSeq = 0
  const calls: Array<{ url: string; method: string; body?: string; authorization?: string }> = []
  const writeLogRows: Array<Record<string, unknown>> = (options.preseedWriteLogRows ?? []).map((row) => ({ ...row }))

  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const parsed = new URL(url)
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const body = typeof init.body === 'string' ? init.body : undefined
    calls.push({ url, method, body, authorization: headers.get('Authorization') ?? undefined })

    if (url.endsWith('/auth/v1/user')) {
      return headers.get('Authorization')?.startsWith('Bearer ') ? response({ id: currentUser }) : response({}, 401)
    }

    if (parsed.pathname.includes('/rest/v1/github_connection_attempts')) {
      if (method === 'DELETE') {
        attempt = undefined
        return response(null, 204)
      }
      if (method === 'POST') {
        attempt = JSON.parse(body ?? '{}')
        return response(null, 201)
      }
      if (method === 'PATCH') {
        const update = JSON.parse(body ?? '{}') as Record<string, unknown>
        if (!attempt) return response([])
        if (parsed.searchParams.has('setup_state_hash')) {
          const setupStateHash = parsed.searchParams.get('setup_state_hash')?.replace(/^eq\./, '')
          if (attempt.setup_state_hash !== setupStateHash || attempt.setup_consumed_at) return response([])
          attempt = { ...attempt, ...update }
          return response([{
            id: attempt.id,
            user_id: attempt.user_id,
            claimed_installation_id: attempt.claimed_installation_id,
            expires_at: attempt.expires_at,
          }])
        }
        if (parsed.searchParams.has('oauth_state_hash')) {
          const oauthStateHash = parsed.searchParams.get('oauth_state_hash')?.replace(/^eq\./, '')
          if (attempt.oauth_state_hash !== oauthStateHash || attempt.oauth_consumed_at) return response([])
          attempt = { ...attempt, ...update }
          return response([{
            id: attempt.id,
            user_id: attempt.user_id,
            claimed_installation_id: attempt.claimed_installation_id,
            expires_at: attempt.expires_at,
          }])
        }
        attempt = { ...attempt, ...update }
        return response(null, 204)
      }
    }

    if (parsed.pathname.includes('/rest/v1/github_connections')) {
      if (method === 'POST') {
        connection = JSON.parse(body ?? '{}')
        return response(null, 201)
      }
      if (method === 'PATCH') {
        const status = options.repositoryCacheWriteStatus ?? 204
        if (status >= 300) {
          return response({ message: 'provider detail must not escape' }, status)
        }
        const update = JSON.parse(body ?? '{}') as Record<string, unknown>
        if (connection) connection = { ...connection, ...update }
        return response(null, 204)
      }
      if (method === 'DELETE') {
        if (connection?.user_id === currentUser) connection = undefined
        return response(null, 204)
      }
      if (method === 'GET') {
        return response(connection?.user_id === currentUser ? [connection] : [])
      }
    }

    // EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
    if (parsed.pathname.includes('/rest/v1/agent_write_log')) {
      if (method === 'POST') {
        const status = options.writeLogInsertStatus ?? 201
        if (status >= 300) return response({ message: 'provider detail must not escape' }, status)
        writeLogSeq += 1
        const row = { ...JSON.parse(body ?? '{}'), id: `write-log-${writeLogSeq}` } as Record<string, unknown>
        writeLogRows.push(row)
        return response([row], status)
      }
      if (method === 'PATCH') {
        const status = options.writeLogUpdateStatus ?? 204
        if (status >= 300) return response({ message: 'provider detail must not escape' }, status)
        const idParam = parsed.searchParams.get('id')?.replace(/^eq\./, '')
        const update = JSON.parse(body ?? '{}') as Record<string, unknown>
        const row = writeLogRows.find((item) => item.id === idParam)
        if (row) Object.assign(row, update)
        return response(null, 204)
      }
      if (method === 'GET') {
        const userIdParam = parsed.searchParams.get('user_id')?.replace(/^eq\./, '')
        return response(writeLogRows.filter((item) => item.user_id === userIdParam).map((item) => ({ id: item.id })))
      }
    }

    if (parsed.origin === 'https://github.com' || parsed.origin === 'https://api.github.com') {
      if (options.rejectGitHub) {
        throw new DOMException('Aborted', 'AbortError')
      }
      if (url === 'https://github.com/login/oauth/access_token') {
        const status = options.tokenExchangeStatus ?? 200
        if (status !== 200) {
          return response({ message: 'provider detail must not escape' }, status)
        }
        return options.malformedToken
          ? response({ token_type: 'bearer' })
          : response({ access_token: 'ghu_transient-user-token', token_type: 'bearer' })
      }
      if (parsed.pathname === '/user/installations') {
        const status = options.verificationStatus ?? 200
        if (status !== 200) {
          return response({ message: 'provider detail must not escape' }, status)
        }
        const page = Number(parsed.searchParams.get('page') ?? '1')
        if (options.installationsPages) {
          return response({ installations: options.installationsPages[page - 1] ?? [] })
        }
        const installations = page === 1
          ? [{
              id: options.verifiedInstallationId ?? 777,
              app_id: options.verifiedAppId ?? 12345,
              account: { id: 9001, login: 'verified-user' },
            }]
          : []
        return response({ installations })
      }
      if (parsed.pathname.endsWith('/access_tokens')) {
        const status = options.installationTokenStatus ?? 201
        return status < 300
          ? response({ token: 'ghs_transient-installation-token', expires_at: '2026-07-22T11:00:00Z' }, status)
          : response({ message: 'provider detail must not escape' }, status)
      }
      if (parsed.pathname === '/installation/repositories') {
        const status = options.repositoriesStatus ?? 200
        if (options.malformedRepositoriesJson) {
          return new Response('{not-json', { status, headers: { 'Content-Type': 'application/json' } })
        }
        return status === 200
          ? response({ repositories: options.repositories ?? [] })
          : response({ message: 'provider detail must not escape' }, status)
      }
      const issuesMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues$/)
      if (issuesMatch) {
        const key = `${decodeURIComponent(issuesMatch[1])}/${decodeURIComponent(issuesMatch[2])}`
        const failStatus = options.issuesFailureByRepo?.[key]
        if (failStatus) {
          return response({ message: 'provider detail must not escape' }, failStatus)
        }
        return response(options.issuesByRepo?.[key] ?? [])
      }
      const pullsMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls$/)
      if (pullsMatch) {
        const key = `${decodeURIComponent(pullsMatch[1])}/${decodeURIComponent(pullsMatch[2])}`
        const failStatus = options.pullsFailureByRepo?.[key]
        if (failStatus) {
          return response({ message: 'provider detail must not escape' }, failStatus)
        }
        return response(options.pullsByRepo?.[key] ?? [])
      }
      const workflowRunsMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/actions\/runs$/)
      if (workflowRunsMatch) {
        const key = `${decodeURIComponent(workflowRunsMatch[1])}/${decodeURIComponent(workflowRunsMatch[2])}`
        const failStatus = options.workflowRunsFailureByRepo?.[key]
        if (failStatus) {
          return response({ message: 'provider detail must not escape' }, failStatus)
        }
        return response({ workflow_runs: options.workflowRunsByRepo?.[key] ?? [] })
      }

      // EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
      const repoAccessMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)$/)
      if (repoAccessMatch && method === 'GET') {
        const key = `${decodeURIComponent(repoAccessMatch[1])}/${decodeURIComponent(repoAccessMatch[2])}`
        const accessible = options.accessibleRepos ? options.accessibleRepos.includes(key) : true
        return accessible
          ? response({
            id: 1,
            name: repoAccessMatch[2],
            owner: { login: repoAccessMatch[1] },
            default_branch: options.defaultBranchByRepo?.[key] ?? 'main',
          })
          : response({ message: 'provider detail must not escape' }, 404)
      }
      // EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
      const branchMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/branches\/([^/]+)$/)
      if (branchMatch && method === 'GET') {
        const key = `${decodeURIComponent(branchMatch[1])}/${decodeURIComponent(branchMatch[2])}`
        const failStatus = options.branchFailureByRepo?.[key]
        if (failStatus) {
          return response({ message: 'provider detail must not escape' }, failStatus)
        }
        return response({
          name: decodeURIComponent(branchMatch[3]),
          commit: { sha: options.branchCommitShaByRepo?.[key] ?? 'commit-sha-main' },
        })
      }
      const contentsMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/)
      if (contentsMatch && method === 'GET') {
        const key = `${decodeURIComponent(contentsMatch[1])}/${decodeURIComponent(contentsMatch[2])}`
        const failStatus = options.fileContentFailureByRepo?.[key]
        if (failStatus) {
          return response({ message: 'provider detail must not escape' }, failStatus)
        }
        const file = options.fileContentByRepo?.[key]
        if (!file) {
          return response({ message: 'provider detail must not escape' }, 404)
        }
        return response({
          type: file.type ?? 'file',
          sha: file.sha,
          size: file.size ?? file.content.length,
          content: file.content,
          encoding: file.encoding ?? 'base64',
        })
      }
      const labelsMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/labels$/)
      if (labelsMatch) {
        const key = `${decodeURIComponent(labelsMatch[1])}/${decodeURIComponent(labelsMatch[2])}`
        const failStatus = options.labelsFailureByRepo?.[key]
        if (failStatus) {
          return response({ message: 'provider detail must not escape' }, failStatus)
        }
        return response((options.labelsByRepo?.[key] ?? []).map((name) => ({ name })))
      }
      const commentMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/)
      if (commentMatch && method === 'POST') {
        const key = `${decodeURIComponent(commentMatch[1])}/${decodeURIComponent(commentMatch[2])}`
        const result = options.commentResultByRepo?.[key]
        if (typeof result === 'number') {
          return response({ message: 'provider detail must not escape' }, result)
        }
        return response(result ?? { id: 555, html_url: `https://github.com/${key}/issues/${commentMatch[3]}#issuecomment-555` })
      }
      const updateMatch = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/)
      if (updateMatch && method === 'PATCH') {
        const key = `${decodeURIComponent(updateMatch[1])}/${decodeURIComponent(updateMatch[2])}`
        const result = options.updateResultByRepo?.[key]
        if (typeof result === 'number') {
          return response({ message: 'provider detail must not escape' }, result)
        }
        return response(result ?? { number: Number(updateMatch[3]), html_url: `https://github.com/${key}/issues/${updateMatch[3]}` })
      }
    }

    throw new Error(`Unexpected request: ${method} ${url}`)
  }

  const dependencies = {
    fetcher,
    now: () => NOW,
    randomBytes(length: number) {
      randomCall += 1
      return new Uint8Array(length).fill(randomCall)
    },
    createAppJwt: async () => 'signed-app-jwt',
  }

  return {
    calls,
    dependencies,
    get attempt() { return attempt },
    get connection() { return connection },
    set connection(value: Record<string, unknown> | undefined) { connection = value },
    set currentUser(value: string) { currentUser = value },
    get writeLogRows() { return writeLogRows },
  }
}

function apiRequest(path: string, method = 'GET', authenticated = true) {
  return new Request(`http://127.0.0.1:8787${path}`, {
    method,
    headers: {
      Origin: 'http://localhost:8080',
      ...(authenticated ? { Authorization: 'Bearer supabase-session' } : {}),
    },
  })
}

async function start(fake: ReturnType<typeof fakeProvider>) {
  const result = await handleGitHubIntegrationRequest(
    apiRequest('/github/connect/start', 'POST'),
    env(),
    fake.dependencies,
  )
  expect(result?.status).toBe(200)
  const body = await result!.json() as { installationUrl: string; expiresAt: string }
  return body
}

async function setup(fake: ReturnType<typeof fakeProvider>, state: string, installationId = 777) {
  const result = await handleGitHubIntegrationRequest(
    new Request(`http://127.0.0.1:8787/github/connect/setup?state=${state}&installation_id=${installationId}`),
    env(),
    fake.dependencies,
  )
  expect(result?.status).toBe(302)
  return new URL(result!.headers.get('Location')!).searchParams.get('state')!
}

async function connect(fake: ReturnType<typeof fakeProvider>, installationId = 777) {
  const started = await start(fake)
  const setupState = new URL(started.installationUrl).searchParams.get('state')!
  const oauthState = await setup(fake, setupState, installationId)
  const callback = await handleGitHubIntegrationRequest(
    new Request(`http://127.0.0.1:8787/github/connect/callback?code=oauth-code&state=${oauthState}`),
    env(),
    fake.dependencies,
  )
  return { callback: callback!, setupState, oauthState, started }
}

describe('GitHub App connection boundary', () => {
  it('requires a verified Supabase bearer token before connection start', async () => {
    const fake = fakeProvider()
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/connect/start', 'POST', false), env(), fake.dependencies)
    expect(result?.status).toBe(401)
    expect(fake.attempt).toBeUndefined()
  })

  it('creates a secure short-lived user-bound state and stores only its hash', async () => {
    const fake = fakeProvider()
    const result = await start(fake)
    const state = new URL(result.installationUrl).searchParams.get('state')!
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(fake.attempt?.user_id).toBe(USER_ONE)
    expect(fake.attempt?.setup_state_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(fake.attempt)).not.toContain(state)
    expect(new Date(String(fake.attempt?.expires_at)).getTime() - NOW.getTime()).toBe(10 * 60 * 1000)
  })

  it('keeps Setup URL and user authorization callback distinct and single-use', async () => {
    const fake = fakeProvider()
    const started = await start(fake)
    const setupState = new URL(started.installationUrl).searchParams.get('state')!
    const oauthState = await setup(fake, setupState)
    const setupReplay = await handleGitHubIntegrationRequest(
      new Request(`http://127.0.0.1:8787/github/connect/setup?state=${setupState}&installation_id=777`),
      env(),
      fake.dependencies,
    )
    expect(setupReplay?.status).toBe(400)

    const callback = await handleGitHubIntegrationRequest(
      new Request(`http://127.0.0.1:8787/github/connect/callback?code=oauth-code&state=${oauthState}`),
      env(),
      fake.dependencies,
    )
    expect(callback?.status).toBe(200)
    const replay = await handleGitHubIntegrationRequest(
      new Request(`http://127.0.0.1:8787/github/connect/callback?code=oauth-code&state=${oauthState}`),
      env(),
      fake.dependencies,
    )
    expect(replay?.status).toBe(400)
  })

  it.each([
    ['wrong App', { verifiedAppId: 99999 }],
    ['spoofed installation ID', { verifiedInstallationId: 778 }],
  ] as const)('rejects a %s before persistence', async (_label, options) => {
    const fake = fakeProvider(options)
    const { callback } = await connect(fake)
    expect(callback.status).toBe(409)
    expect(fake.connection).toBeUndefined()
  })

  it.each([401, 403, 404])('rejects an installation the authorizing GitHub user cannot access (%s)', async (status) => {
    const fake = fakeProvider({ verificationStatus: status })
    const { callback } = await connect(fake)
    expect(callback.status).toBe(409)
    expect(fake.connection).toBeUndefined()
  })

  it('persists the connection when installationId is present in the authenticated user installation list', async () => {
    const fake = fakeProvider()
    const { callback } = await connect(fake, 777)
    expect(callback.status).toBe(200)
    expect(fake.connection).toMatchObject({
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'connected',
    })
  })

  it('rejects with INSTALLATION_NOT_ACCESSIBLE and persists nothing when installationId is absent from the list', async () => {
    const fake = fakeProvider({ verifiedInstallationId: 909090 })
    const { callback } = await connect(fake, 777)
    expect(callback.status).toBe(409)
    expect(await callback.json()).toMatchObject({ error: { code: 'INSTALLATION_NOT_ACCESSIBLE' } })
    expect(fake.connection).toBeUndefined()
  })

  it('rejects an installation that belongs to another user and never appears in this user list', async () => {
    const fake = fakeProvider({
      installationsPages: [[
        { id: 55555, app_id: 12345, account: { id: 1, login: 'someone-elses-account' } },
      ]],
    })
    const { callback } = await connect(fake, 777)
    expect(callback.status).toBe(409)
    expect(await callback.json()).toMatchObject({ error: { code: 'INSTALLATION_NOT_ACCESSIBLE' } })
    expect(fake.connection).toBeUndefined()
  })

  it('paginates through /user/installations when the match is beyond the first page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, app_id: 12345, account: { id: 1, login: 'other' } }))
    const fake = fakeProvider({
      installationsPages: [
        firstPage,
        [{ id: 777, app_id: 12345, account: { id: 9001, login: 'verified-user' } }],
      ],
    })
    const { callback } = await connect(fake, 777)
    expect(callback.status).toBe(200)
    expect(fake.connection).toMatchObject({ installation_id: 777, github_account_login: 'verified-user' })
    const installationCalls = fake.calls.filter((call) => call.url.startsWith('https://api.github.com/user/installations'))
    expect(installationCalls).toHaveLength(2)
    expect(installationCalls[0].url).toContain('page=1')
    expect(installationCalls[1].url).toContain('page=2')
  })

  it('persists only verified non-secret metadata after user/installation association succeeds', async () => {
    const fake = fakeProvider()
    const { callback } = await connect(fake)
    expect(callback.status).toBe(200)
    expect(fake.connection).toMatchObject({
      user_id: USER_ONE,
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'connected',
    })
    const persisted = JSON.stringify(fake.calls.filter((call) => call.url.includes('/rest/v1/')).map((call) => call.body))
    const returned = await callback.text()
    expect(persisted).not.toContain('ghu_transient-user-token')
    expect(persisted).not.toContain('ghs_transient-installation-token')
    expect(returned).not.toContain('token')
  })

  it('keeps callback ownership bound to the SmartFlow user that initiated the state', async () => {
    const fake = fakeProvider({ currentUser: USER_ONE })
    const started = await start(fake)
    const setupState = new URL(started.installationUrl).searchParams.get('state')!
    const oauthState = await setup(fake, setupState)
    fake.currentUser = USER_TWO

    const callback = await handleGitHubIntegrationRequest(
      new Request(`http://127.0.0.1:8787/github/connect/callback?code=oauth-code&state=${oauthState}`),
      env(),
      fake.dependencies,
    )

    expect(callback?.status).toBe(200)
    expect(fake.connection?.user_id).toBe(USER_ONE)
    expect(fake.connection?.user_id).not.toBe(USER_TWO)
  })

  it('completes the connection via the setup-state fallback when the Setup URL is bypassed', async () => {
    const fake = fakeProvider()
    const started = await start(fake)
    const setupState = new URL(started.installationUrl).searchParams.get('state')!

    const callback = await handleGitHubIntegrationRequest(
      new Request(`http://127.0.0.1:8787/github/connect/callback?code=oauth-code&state=${setupState}&installation_id=777&setup_action=install`),
      env(),
      fake.dependencies,
    )

    expect(callback?.status).toBe(200)
    expect(fake.connection).toMatchObject({
      user_id: USER_ONE,
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'connected',
    })
  })

  it('still completes the connection via the normal two-step setup-then-oauth path', async () => {
    const fake = fakeProvider()
    const { callback } = await connect(fake)

    expect(callback.status).toBe(200)
    expect(fake.connection).toMatchObject({
      user_id: USER_ONE,
      installation_id: 777,
      status: 'connected',
    })
  })

  it('calls installation verification on both the oauth-state and setup-state fallback paths', async () => {
    const oauthPathFake = fakeProvider()
    await connect(oauthPathFake)
    expect(oauthPathFake.calls.some((call) => call.url.includes('/user/installations'))).toBe(true)

    const setupPathFake = fakeProvider()
    const started = await start(setupPathFake)
    const setupState = new URL(started.installationUrl).searchParams.get('state')!
    await handleGitHubIntegrationRequest(
      new Request(`http://127.0.0.1:8787/github/connect/callback?code=oauth-code&state=${setupState}&installation_id=777&setup_action=install`),
      env(),
      setupPathFake.dependencies,
    )
    expect(setupPathFake.calls.some((call) => call.url.includes('/user/installations'))).toBe(true)
  })

  it('never allows a state consumed via the fallback path to be replayed on either column', async () => {
    const fake = fakeProvider()
    const started = await start(fake)
    const setupState = new URL(started.installationUrl).searchParams.get('state')!
    const callbackUrl = `http://127.0.0.1:8787/github/connect/callback?code=oauth-code&state=${setupState}&installation_id=777&setup_action=install`

    const first = await handleGitHubIntegrationRequest(new Request(callbackUrl), env(), fake.dependencies)
    expect(first?.status).toBe(200)

    // Replaying the same raw state tries the oauth column first (never
    // populated on this path) and then the setup column (already consumed
    // by the first call), so both lookups must miss.
    const replay = await handleGitHubIntegrationRequest(new Request(callbackUrl), env(), fake.dependencies)
    expect(replay?.status).toBe(400)
    expect(await replay?.json()).toMatchObject({ error: { code: 'CONNECTION_STATE_INVALID' } })
  })

  it('rejects a pending organization-approval installation without consuming state', async () => {
    const fake = fakeProvider()
    const started = await start(fake)
    const setupState = new URL(started.installationUrl).searchParams.get('state')!

    const pending = await handleGitHubIntegrationRequest(
      new Request(`http://127.0.0.1:8787/github/connect/callback?code=oauth-code&state=${setupState}&installation_id=777&setup_action=request`),
      env(),
      fake.dependencies,
    )
    expect(pending?.status).toBe(409)
    expect(await pending?.json()).toMatchObject({ error: { code: 'CONNECTION_APPROVAL_PENDING' } })
    expect(fake.connection).toBeUndefined()

    // The request-pending check runs before any state is touched, so the
    // same state can still complete once the installation is approved.
    const retry = await handleGitHubIntegrationRequest(
      new Request(`http://127.0.0.1:8787/github/connect/callback?code=oauth-code&state=${setupState}&installation_id=777&setup_action=install`),
      env(),
      fake.dependencies,
    )
    expect(retry?.status).toBe(200)
  })

  it('exchanges the authorization code against the exact documented GitHub OAuth endpoint', async () => {
    const fake = fakeProvider()
    await connect(fake)

    const exchangeCall = fake.calls.find((call) => call.url.includes('/login/oauth/access_token'))
    expect(exchangeCall?.url).toBe('https://github.com/login/oauth/access_token')
    expect(exchangeCall?.method).toBe('POST')
  })

  it('reports a failed token exchange distinctly from a missing installation, without touching verification', async () => {
    const fake = fakeProvider({ tokenExchangeStatus: 404 })
    const started = await start(fake)
    const setupState = new URL(started.installationUrl).searchParams.get('state')!

    const callback = await handleGitHubIntegrationRequest(
      new Request(`http://127.0.0.1:8787/github/connect/callback?code=oauth-code&state=${setupState}&installation_id=777&setup_action=install`),
      env(),
      fake.dependencies,
    )

    expect(callback?.status).toBe(409)
    expect(await callback?.json()).toMatchObject({ error: { code: 'GITHUB_TOKEN_EXCHANGE_FAILED' } })
    expect(fake.calls.some((call) => call.url.includes('/user/installations'))).toBe(false)
    expect(fake.connection).toBeUndefined()
  })

  it('fails closed when required Worker configuration is missing', async () => {
    const fake = fakeProvider()
    const incomplete = env({ GITHUB_CLIENT_SECRET: undefined })
    const unauthenticated = await handleGitHubIntegrationRequest(
      apiRequest('/github/connect/start', 'POST', false),
      incomplete,
      fake.dependencies,
    )
    expect(unauthenticated?.status).toBe(401)
    fake.calls.length = 0

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/connect/start', 'POST'), incomplete, fake.dependencies)
    expect(result?.status).toBe(503)
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].url).toContain('/auth/v1/user')
  })
})

describe('GitHub repository listing boundary', () => {
  function verifiedConnection(userId = USER_ONE) {
    return {
      user_id: userId,
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'connected',
    }
  }

  it('requires authentication and loads only the authenticated user connection', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection()
    const unauthenticated = await handleGitHubIntegrationRequest(apiRequest('/github/repositories', 'GET', false), env(), fake.dependencies)
    expect(unauthenticated?.status).toBe(401)

    fake.currentUser = USER_TWO
    const crossUser = await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), fake.dependencies)
    expect(crossUser?.status).toBe(409)
    expect(fake.calls.some((call) => call.url.includes('/access_tokens'))).toBe(false)
  })

  it('mints transient installation credentials and returns at most 20 sanitized repositories', async () => {
    const repositories = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      name: `repo-${index}`,
      owner: { login: 'owner' },
      visibility: index % 2 ? 'private' : 'public',
      default_branch: 'main',
      archived: false,
      clone_url: 'https://token@example.invalid/private.git',
      permissions: { admin: true },
    }))
    const fake = fakeProvider({ repositories })
    fake.connection = verifiedConnection()
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { repositories: Array<Record<string, unknown>> }
    expect(body.repositories).toHaveLength(20)
    expect(Object.keys(body.repositories[0]).sort()).toEqual(['archived', 'defaultBranch', 'id', 'name', 'owner', 'visibility'])
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('clone_url')
    expect(serialized).not.toContain('permissions')
    expect(serialized).not.toContain('ghs_transient-installation-token')

    const githubCalls = fake.calls.filter((call) => call.url.startsWith('https://github.com') || call.url.startsWith('https://api.github.com'))
    expect(githubCalls.every((call) => ['https://github.com', 'https://api.github.com'].includes(new URL(call.url).origin))).toBe(true)
    expect(githubCalls.filter((call) => call.url.includes('/installation/repositories'))).toHaveLength(1)
  })

  it('returns an empty bounded list without traversing pages', async () => {
    const fake = fakeProvider({ repositories: [] })
    fake.connection = verifiedConnection()
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ repositories: [] })
    expect(fake.calls.filter((call) => call.url.includes('/installation/repositories'))).toHaveLength(1)
  })

  it('caches owner/name repository names on the connection row after a successful listing', async () => {
    const repositories = [
      { id: 1, name: 'smart-academy', owner: { login: 'aryan' }, visibility: 'private', default_branch: 'main', archived: false },
      { id: 2, name: 'dailyflow', owner: { login: 'aryan' }, visibility: 'public', default_branch: 'main', archived: false },
    ]
    const fake = fakeProvider({ repositories })
    fake.connection = verifiedConnection()
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    expect(fake.connection).toMatchObject({
      repository_names_cache: ['aryan/smart-academy', 'aryan/dailyflow'],
      repository_names_cached_at: NOW.toISOString(),
    })
    const cacheWrite = fake.calls.find((call) => call.method === 'PATCH' && call.url.includes('/rest/v1/github_connections'))
    expect(cacheWrite?.url).toContain(`user_id=eq.${USER_ONE}`)
  })

  it('caps the cached inventory at 12 independent of the 20-repository response cap', async () => {
    const repositories = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      name: `repo-${index}`,
      owner: { login: 'owner' },
      visibility: 'public',
      default_branch: 'main',
      archived: false,
    }))
    const fake = fakeProvider({ repositories })
    fake.connection = verifiedConnection()
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), fake.dependencies)
    const body = await result!.json() as { repositories: unknown[] }
    expect(body.repositories).toHaveLength(20)
    expect((fake.connection?.repository_names_cache as unknown[]).length).toBe(12)
  })

  it('does not fail the repositories response when the cache write fails', async () => {
    const repositories = [{ id: 1, name: 'smart-academy', owner: { login: 'aryan' }, visibility: 'private', default_branch: 'main', archived: false }]
    const fake = fakeProvider({ repositories, repositoryCacheWriteStatus: 500 })
    fake.connection = verifiedConnection()
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { repositories: Array<{ name: string }> }
    expect(body.repositories).toHaveLength(1)
    expect(body.repositories[0].name).toBe('smart-academy')
    // The write was attempted and failed closed on the cache alone -- the
    // verifiedConnection() fixture never had repository_names_cache set.
    expect(fake.connection).not.toHaveProperty('repository_names_cache')
  })

  it('bounds each cached name to 200 characters, since the database can only bound array length', async () => {
    // sanitizeRepository already bounds owner and name to 100 chars each,
    // so "owner/name" can reach 201 chars -- one over the write-path bound.
    const owner = 'o'.repeat(100)
    const name = 'r'.repeat(100)
    const repositories = [{ id: 1, name, owner: { login: owner }, visibility: 'private', default_branch: 'main', archived: false }]
    const fake = fakeProvider({ repositories })
    fake.connection = verifiedConnection()
    await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), fake.dependencies)
    const cached = fake.connection?.repository_names_cache as string[]
    expect(cached[0]).toHaveLength(200)
    expect(cached[0]).toBe(`${owner}/${name}`.slice(0, 200))
  })

  it.each([
    [401, 409, 'GITHUB_AUTHORIZATION_INVALID'],
    [403, 409, 'GITHUB_AUTHORIZATION_INVALID'],
    [404, 409, 'GITHUB_APP_NOT_INSTALLED'],
    [429, 503, 'GITHUB_RATE_LIMITED'],
    [500, 502, 'GITHUB_UNAVAILABLE'],
  ])('normalizes provider status %s without raw errors or retries', async (providerStatus, expectedStatus, code) => {
    const fake = fakeProvider({ repositoriesStatus: providerStatus })
    fake.connection = verifiedConnection()
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), fake.dependencies)
    expect(result?.status).toBe(expectedStatus)
    const responseText = await result!.text()
    expect(JSON.parse(responseText)).toMatchObject({ error: { code } })
    expect(fake.calls.filter((call) => call.url.includes('/installation/repositories'))).toHaveLength(1)
    expect(responseText).not.toContain('provider detail')
  })

  it('normalizes timeouts and malformed provider responses without retrying', async () => {
    const timeoutFake = fakeProvider({ rejectGitHub: true })
    timeoutFake.connection = verifiedConnection()
    const timeout = await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), timeoutFake.dependencies)
    expect(timeout?.status).toBe(504)

    const malformedFake = fakeProvider({ repositories: [{ id: 1, name: 'missing-owner' }] })
    malformedFake.connection = verifiedConnection()
    const malformed = await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), malformedFake.dependencies)
    expect(malformed?.status).toBe(502)
    expect(await malformed?.json()).toMatchObject({ error: { code: 'GITHUB_RESPONSE_INVALID' } })

    const invalidJsonFake = fakeProvider({ malformedRepositoriesJson: true })
    invalidJsonFake.connection = verifiedConnection()
    const invalidJson = await handleGitHubIntegrationRequest(apiRequest('/github/repositories'), env(), invalidJsonFake.dependencies)
    expect(invalidJson?.status).toBe(502)
    expect(await invalidJson?.json()).toMatchObject({ error: { code: 'GITHUB_RESPONSE_INVALID' } })
  })

  it('disconnects only the authenticated user mapping and does not call GitHub', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection()
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/disconnect', 'POST'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ connected: false, appUninstalled: false })
    expect(fake.connection).toBeUndefined()
    expect(fake.calls.some((call) => call.url.startsWith('https://api.github.com'))).toBe(false)
  })
})

describe('GitHub issues listing boundary', () => {
  function verifiedConnection(userId = USER_ONE) {
    return {
      user_id: userId,
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'connected',
    }
  }

  function repoFixture(id: number, name: string, owner = 'owner') {
    return {
      id,
      name,
      owner: { login: owner },
      visibility: 'public',
      default_branch: 'main',
      archived: false,
    }
  }

  function issueFixture(number: number, title: string, extra: Record<string, unknown> = {}) {
    return {
      number,
      title,
      state: 'open',
      updated_at: '2026-07-20T10:00:00.000Z',
      body: 'must-not-pass',
      user: { login: 'must-not-pass' },
      ...extra,
    }
  }

  it('requires authentication and loads only the authenticated user connection', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection()
    const unauthenticated = await handleGitHubIntegrationRequest(apiRequest('/github/issues', 'GET', false), env(), fake.dependencies)
    expect(unauthenticated?.status).toBe(401)

    fake.currentUser = USER_TWO
    const crossUser = await handleGitHubIntegrationRequest(apiRequest('/github/issues'), env(), fake.dependencies)
    expect(crossUser?.status).toBe(409)
    expect(fake.calls.some((call) => call.url.includes('/access_tokens'))).toBe(false)
  })

  it('fans out issue requests in parallel across scanned repos and returns bounded sanitized issues', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta'), repoFixture(3, 'gamma')],
      issuesByRepo: {
        'owner/alpha': [issueFixture(1, 'Alpha issue one'), issueFixture(2, 'Alpha issue two')],
        'owner/beta': [issueFixture(10, 'Beta issue one')],
        'owner/gamma': [],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/issues'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { issues: Array<Record<string, unknown>> }
    expect(body.issues).toHaveLength(3)
    expect(Object.keys(body.issues[0]).sort()).toEqual(['number', 'repo', 'state', 'title', 'updatedAt'])
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('must-not-pass')
    expect(serialized).not.toContain('ghs_transient-installation-token')

    const issueCalls = fake.calls.filter((call) => call.url.includes('/issues') && !call.url.includes('github_connection'))
    expect(issueCalls).toHaveLength(3)
  })

  it('scans at most 3 repositories even when more are connected', async () => {
    const fake = fakeProvider({
      repositories: [
        repoFixture(1, 'r1'), repoFixture(2, 'r2'), repoFixture(3, 'r3'),
        repoFixture(4, 'r4'), repoFixture(5, 'r5'),
      ],
      issuesByRepo: {
        'owner/r1': [issueFixture(1, 'one')],
        'owner/r2': [issueFixture(1, 'one')],
        'owner/r3': [issueFixture(1, 'one')],
        'owner/r4': [issueFixture(1, 'one')],
        'owner/r5': [issueFixture(1, 'one')],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/issues'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { issues: unknown[] }
    expect(body.issues).toHaveLength(3)

    const reposCall = fake.calls.find((call) => call.url.includes('/installation/repositories'))
    expect(reposCall?.url).toContain('per_page=3')
    const issueCalls = fake.calls.filter((call) => /\/repos\/owner\/r\d+\/issues/.test(call.url))
    expect(issueCalls).toHaveLength(3)
  })

  it('caps total issues at 20 across all scanned repos', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta'), repoFixture(3, 'gamma')],
      issuesByRepo: {
        'owner/alpha': Array.from({ length: 10 }, (_, i) => issueFixture(i + 1, `Alpha ${i + 1}`)),
        'owner/beta': Array.from({ length: 10 }, (_, i) => issueFixture(i + 1, `Beta ${i + 1}`)),
        'owner/gamma': Array.from({ length: 10 }, (_, i) => issueFixture(i + 1, `Gamma ${i + 1}`)),
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/issues'), env(), fake.dependencies)
    const body = await result!.json() as { issues: unknown[] }
    expect(body.issues).toHaveLength(20)
  })

  it('excludes pull requests silently rather than treating them as invalid issue data', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha')],
      issuesByRepo: {
        'owner/alpha': [
          issueFixture(1, 'Real issue'),
          issueFixture(2, 'A pull request', { pull_request: { url: 'https://api.github.com/pulls/2' } }),
        ],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/issues'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { issues: Array<{ number: number }> }
    expect(body.issues).toHaveLength(1)
    expect(body.issues[0].number).toBe(1)
  })

  it('fails the whole request closed if any single scanned repo fails, instead of returning a partial list', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta')],
      issuesByRepo: {
        'owner/alpha': [issueFixture(1, 'Alpha issue')],
      },
      issuesFailureByRepo: {
        'owner/beta': 500,
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/issues'), env(), fake.dependencies)
    expect(result?.status).toBe(502)
    const body = await result!.json() as { error: { code: string } }
    expect(body.error.code).toBe('GITHUB_UNAVAILABLE')
    expect(JSON.stringify(body)).not.toContain('provider detail')
  })

  it('rejects malformed issue metadata the same way malformed repository metadata is rejected', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha')],
      issuesByRepo: {
        'owner/alpha': [{ number: 1, title: 'Missing state and updated_at' }],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/issues'), env(), fake.dependencies)
    expect(result?.status).toBe(502)
    expect(await result?.json()).toMatchObject({ error: { code: 'GITHUB_RESPONSE_INVALID' } })
  })

  it('returns an empty bounded list without calling any repo issues endpoint when there are no repos', async () => {
    const fake = fakeProvider({ repositories: [] })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/issues'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ issues: [] })
    expect(fake.calls.some((call) => /\/repos\/.+\/issues/.test(call.url))).toBe(false)
  })
})

describe('GitHub epics listing boundary', () => {
  function verifiedConnection(userId = USER_ONE) {
    return {
      user_id: userId,
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'connected',
    }
  }

  function repoFixture(id: number, name: string, owner = 'owner') {
    return {
      id,
      name,
      owner: { login: owner },
      visibility: 'public',
      default_branch: 'main',
      archived: false,
    }
  }

  function epicIssueFixture(
    number: number,
    title: string,
    labels: string[],
    extra: Record<string, unknown> = {},
  ) {
    return {
      number,
      title,
      state: 'open',
      updated_at: '2026-07-20T10:00:00.000Z',
      html_url: `https://github.com/owner/alpha/issues/${number}`,
      labels: labels.map((name) => ({ name, must_not_pass: 'label-metadata' })),
      body: 'must-not-pass',
      user: { login: 'must-not-pass' },
      ...extra,
    }
  }

  it('requires authentication and loads only the authenticated user connection', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection()
    const unauthenticated = await handleGitHubIntegrationRequest(apiRequest('/github/epics', 'GET', false), env(), fake.dependencies)
    expect(unauthenticated?.status).toBe(401)

    fake.currentUser = USER_TWO
    const crossUser = await handleGitHubIntegrationRequest(apiRequest('/github/epics'), env(), fake.dependencies)
    expect(crossUser?.status).toBe(409)
    expect(fake.calls.some((call) => call.url.includes('/access_tokens'))).toBe(false)
  })

  it('fetches all issues (state=all), keeps only epic:-labeled ones, and returns bounded sanitized fields', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta'), repoFixture(3, 'gamma')],
      issuesByRepo: {
        'owner/alpha': [
          epicIssueFixture(1, 'Roadmap epic', ['epic:06-roadmap', 'status:planned']),
          epicIssueFixture(2, 'Untagged issue', ['bug']),
        ],
        'owner/beta': [epicIssueFixture(10, 'Beta epic', ['epic:07-billing'])],
        'owner/gamma': [],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/epics'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { epics: Array<Record<string, unknown>> }
    expect(body.epics).toHaveLength(2)
    expect(Object.keys(body.epics[0]).sort()).toEqual(['epic', 'number', 'repo', 'status', 'title', 'url'])
    expect(body.epics[0]).toEqual({
      repo: 'owner/alpha',
      number: 1,
      title: 'Roadmap epic',
      epic: 'epic:06-roadmap',
      status: 'status:planned',
      url: 'https://github.com/owner/alpha/issues/1',
    })
    expect(body.epics[1].status).toBe('')
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('must-not-pass')
    expect(serialized).not.toContain('label-metadata')
    expect(serialized).not.toContain('bug')

    const issueCalls = fake.calls.filter((call) => /\/repos\/owner\/\w+\/issues/.test(call.url))
    expect(issueCalls).toHaveLength(3)
    expect(issueCalls.every((call) => call.url.includes('state=all'))).toBe(true)
  })

  it('scans at most 3 repositories even when more are connected', async () => {
    const fake = fakeProvider({
      repositories: [
        repoFixture(1, 'r1'), repoFixture(2, 'r2'), repoFixture(3, 'r3'),
        repoFixture(4, 'r4'), repoFixture(5, 'r5'),
      ],
      issuesByRepo: {
        'owner/r1': [epicIssueFixture(1, 'one', ['epic:a'])],
        'owner/r2': [epicIssueFixture(1, 'one', ['epic:a'])],
        'owner/r3': [epicIssueFixture(1, 'one', ['epic:a'])],
        'owner/r4': [epicIssueFixture(1, 'one', ['epic:a'])],
        'owner/r5': [epicIssueFixture(1, 'one', ['epic:a'])],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/epics'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { epics: unknown[] }
    expect(body.epics).toHaveLength(3)

    const issueCalls = fake.calls.filter((call) => /\/repos\/owner\/r\d+\/issues/.test(call.url))
    expect(issueCalls).toHaveLength(3)
  })

  it('caps total epics at 20 across all scanned repos', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta'), repoFixture(3, 'gamma')],
      issuesByRepo: {
        'owner/alpha': Array.from({ length: 10 }, (_, i) => epicIssueFixture(i + 1, `Alpha ${i + 1}`, ['epic:a'])),
        'owner/beta': Array.from({ length: 10 }, (_, i) => epicIssueFixture(i + 1, `Beta ${i + 1}`, ['epic:a'])),
        'owner/gamma': Array.from({ length: 10 }, (_, i) => epicIssueFixture(i + 1, `Gamma ${i + 1}`, ['epic:a'])),
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/epics'), env(), fake.dependencies)
    const body = await result!.json() as { epics: unknown[] }
    expect(body.epics).toHaveLength(20)
  })

  it('excludes pull requests silently rather than treating them as invalid issue data', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha')],
      issuesByRepo: {
        'owner/alpha': [
          epicIssueFixture(1, 'Real epic', ['epic:a']),
          epicIssueFixture(2, 'A pull request', ['epic:a'], { pull_request: { url: 'https://api.github.com/pulls/2' } }),
        ],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/epics'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { epics: Array<{ number: number }> }
    expect(body.epics).toHaveLength(1)
    expect(body.epics[0].number).toBe(1)
  })

  it('fails the whole request closed if any single scanned repo fails, instead of returning a partial list', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta')],
      issuesByRepo: {
        'owner/alpha': [epicIssueFixture(1, 'Alpha epic', ['epic:a'])],
      },
      issuesFailureByRepo: {
        'owner/beta': 500,
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/epics'), env(), fake.dependencies)
    expect(result?.status).toBe(502)
    const body = await result!.json() as { error: { code: string } }
    expect(body.error.code).toBe('GITHUB_UNAVAILABLE')
  })

  it('rejects malformed issue metadata (missing html_url) instead of guessing a URL', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha')],
      issuesByRepo: {
        'owner/alpha': [{ number: 1, title: 'Missing html_url', labels: [{ name: 'epic:a' }] }],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/epics'), env(), fake.dependencies)
    expect(result?.status).toBe(502)
    expect(await result?.json()).toMatchObject({ error: { code: 'GITHUB_RESPONSE_INVALID' } })
  })

  it('returns an empty bounded list without calling any repo issues endpoint when there are no repos', async () => {
    const fake = fakeProvider({ repositories: [] })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/epics'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ epics: [] })
    expect(fake.calls.some((call) => /\/repos\/.+\/issues/.test(call.url))).toBe(false)
  })
})

describe('GitHub pull requests listing boundary', () => {
  function verifiedConnection(userId = USER_ONE) {
    return {
      user_id: userId,
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'connected',
    }
  }

  function repoFixture(id: number, name: string, owner = 'owner') {
    return {
      id,
      name,
      owner: { login: owner },
      visibility: 'public',
      default_branch: 'main',
      archived: false,
    }
  }

  function pullFixture(number: number, title: string, extra: Record<string, unknown> = {}) {
    return {
      number,
      title,
      state: 'open',
      updated_at: '2026-07-20T10:00:00.000Z',
      draft: false,
      body: 'must-not-pass',
      user: { login: 'must-not-pass' },
      ...extra,
    }
  }

  it('requires authentication and loads only the authenticated user connection', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection()
    const unauthenticated = await handleGitHubIntegrationRequest(apiRequest('/github/pulls', 'GET', false), env(), fake.dependencies)
    expect(unauthenticated?.status).toBe(401)

    fake.currentUser = USER_TWO
    const crossUser = await handleGitHubIntegrationRequest(apiRequest('/github/pulls'), env(), fake.dependencies)
    expect(crossUser?.status).toBe(409)
    expect(fake.calls.some((call) => call.url.includes('/access_tokens'))).toBe(false)
  })

  it('fans out pull request requests in parallel across scanned repos and returns bounded sanitized pulls', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta'), repoFixture(3, 'gamma')],
      pullsByRepo: {
        'owner/alpha': [pullFixture(1, 'Alpha PR one'), pullFixture(2, 'Alpha PR two', { draft: true })],
        'owner/beta': [pullFixture(10, 'Beta PR one')],
        'owner/gamma': [],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/pulls'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { pullRequests: Array<Record<string, unknown>> }
    expect(body.pullRequests).toHaveLength(3)
    expect(Object.keys(body.pullRequests[0]).sort()).toEqual(['draft', 'number', 'repo', 'state', 'title', 'updatedAt'])
    expect(body.pullRequests.find((pr) => pr.number === 2)?.draft).toBe(true)
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('must-not-pass')
    expect(serialized).not.toContain('ghs_transient-installation-token')

    const pullCalls = fake.calls.filter((call) => call.url.includes('/pulls') && !call.url.includes('github_connection'))
    expect(pullCalls).toHaveLength(3)
  })

  it('scans at most 3 repositories even when more are connected', async () => {
    const fake = fakeProvider({
      repositories: [
        repoFixture(1, 'r1'), repoFixture(2, 'r2'), repoFixture(3, 'r3'),
        repoFixture(4, 'r4'), repoFixture(5, 'r5'),
      ],
      pullsByRepo: {
        'owner/r1': [pullFixture(1, 'one')],
        'owner/r2': [pullFixture(1, 'one')],
        'owner/r3': [pullFixture(1, 'one')],
        'owner/r4': [pullFixture(1, 'one')],
        'owner/r5': [pullFixture(1, 'one')],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/pulls'), env(), fake.dependencies)
    const body = await result!.json() as { pullRequests: unknown[] }
    expect(body.pullRequests).toHaveLength(3)
    const pullCalls = fake.calls.filter((call) => /\/repos\/owner\/r\d+\/pulls/.test(call.url))
    expect(pullCalls).toHaveLength(3)
  })

  it('caps total pull requests at 20 across all scanned repos', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta'), repoFixture(3, 'gamma')],
      pullsByRepo: {
        'owner/alpha': Array.from({ length: 10 }, (_, i) => pullFixture(i + 1, `Alpha ${i + 1}`)),
        'owner/beta': Array.from({ length: 10 }, (_, i) => pullFixture(i + 1, `Beta ${i + 1}`)),
        'owner/gamma': Array.from({ length: 10 }, (_, i) => pullFixture(i + 1, `Gamma ${i + 1}`)),
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/pulls'), env(), fake.dependencies)
    const body = await result!.json() as { pullRequests: unknown[] }
    expect(body.pullRequests).toHaveLength(20)
  })

  it('fails the whole request closed if any single scanned repo fails, instead of returning a partial list', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta')],
      pullsByRepo: {
        'owner/alpha': [pullFixture(1, 'Alpha PR')],
      },
      pullsFailureByRepo: {
        'owner/beta': 500,
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/pulls'), env(), fake.dependencies)
    expect(result?.status).toBe(502)
    const body = await result!.json() as { error: { code: string } }
    expect(body.error.code).toBe('GITHUB_UNAVAILABLE')
  })

  it('rejects malformed pull request metadata the same way malformed issue metadata is rejected', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha')],
      pullsByRepo: {
        'owner/alpha': [{ number: 1, title: 'Missing state and updated_at' }],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/pulls'), env(), fake.dependencies)
    expect(result?.status).toBe(502)
    expect(await result?.json()).toMatchObject({ error: { code: 'GITHUB_RESPONSE_INVALID' } })
  })

  it('returns an empty bounded list without calling any repo pulls endpoint when there are no repos', async () => {
    const fake = fakeProvider({ repositories: [] })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/pulls'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ pullRequests: [] })
    expect(fake.calls.some((call) => /\/repos\/.+\/pulls/.test(call.url))).toBe(false)
  })
})

describe('GitHub workflow runs listing boundary', () => {
  function verifiedConnection(userId = USER_ONE) {
    return {
      user_id: userId,
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'connected',
    }
  }

  function repoFixture(id: number, name: string, owner = 'owner') {
    return {
      id,
      name,
      owner: { login: owner },
      visibility: 'public',
      default_branch: 'main',
      archived: false,
    }
  }

  function runFixture(name: string, status: string, conclusion: string | null, updatedAt: string) {
    return { name, status, conclusion, updated_at: updatedAt, id: 999, head_sha: 'must-not-pass' }
  }

  it('requires authentication and loads only the authenticated user connection', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection()
    const unauthenticated = await handleGitHubIntegrationRequest(apiRequest('/github/workflow_runs', 'GET', false), env(), fake.dependencies)
    expect(unauthenticated?.status).toBe(401)

    fake.currentUser = USER_TWO
    const crossUser = await handleGitHubIntegrationRequest(apiRequest('/github/workflow_runs'), env(), fake.dependencies)
    expect(crossUser?.status).toBe(409)
    expect(fake.calls.some((call) => call.url.includes('/access_tokens'))).toBe(false)
  })

  it('fans out workflow run requests in parallel across scanned repos and returns bounded sanitized runs', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta')],
      workflowRunsByRepo: {
        'owner/alpha': [runFixture('CI', 'completed', 'success', '2026-07-20T10:00:00.000Z')],
        'owner/beta': [runFixture('Deploy', 'in_progress', null, '2026-07-21T10:00:00.000Z')],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/workflow_runs'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { workflowRuns: Array<Record<string, unknown>> }
    expect(body.workflowRuns).toHaveLength(2)
    expect(Object.keys(body.workflowRuns[0]).sort()).toEqual(['repo', 'status', 'updatedAt', 'workflowName'])
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('must-not-pass')
    expect(serialized).not.toContain('ghs_transient-installation-token')

    const runCalls = fake.calls.filter((call) => call.url.includes('/actions/runs'))
    expect(runCalls).toHaveLength(2)
  })

  it('accepts a null conclusion for a still-running run instead of rejecting it as malformed', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha')],
      workflowRunsByRepo: {
        'owner/alpha': [runFixture('CI', 'in_progress', null, '2026-07-20T10:00:00.000Z')],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/workflow_runs'), env(), fake.dependencies)
    expect(result?.status).toBe(200)
    const body = await result!.json() as { workflowRuns: Array<Record<string, unknown>> }
    expect(body.workflowRuns[0]).toEqual({
      repo: 'owner/alpha',
      workflowName: 'CI',
      status: 'in_progress',
      updatedAt: '2026-07-20T10:00:00.000Z',
    })
  })

  it('sorts by updatedAt across repos before capping, so the most recent runs win regardless of scan order', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta')],
      workflowRunsByRepo: {
        'owner/alpha': [runFixture('Old', 'completed', 'success', '2026-07-01T00:00:00.000Z')],
        'owner/beta': [runFixture('Newest', 'completed', 'success', '2026-07-21T00:00:00.000Z')],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/workflow_runs'), env(), fake.dependencies)
    const body = await result!.json() as { workflowRuns: Array<{ workflowName: string }> }
    expect(body.workflowRuns[0].workflowName).toBe('Newest')
    expect(body.workflowRuns[1].workflowName).toBe('Old')
  })

  it('scans at most 3 repositories even when more are connected', async () => {
    const fake = fakeProvider({
      repositories: [
        repoFixture(1, 'r1'), repoFixture(2, 'r2'), repoFixture(3, 'r3'),
        repoFixture(4, 'r4'), repoFixture(5, 'r5'),
      ],
      workflowRunsByRepo: {
        'owner/r1': [runFixture('CI', 'completed', 'success', '2026-07-20T10:00:00.000Z')],
        'owner/r2': [runFixture('CI', 'completed', 'success', '2026-07-20T10:00:00.000Z')],
        'owner/r3': [runFixture('CI', 'completed', 'success', '2026-07-20T10:00:00.000Z')],
        'owner/r4': [runFixture('CI', 'completed', 'success', '2026-07-20T10:00:00.000Z')],
        'owner/r5': [runFixture('CI', 'completed', 'success', '2026-07-20T10:00:00.000Z')],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/workflow_runs'), env(), fake.dependencies)
    const body = await result!.json() as { workflowRuns: unknown[] }
    expect(body.workflowRuns).toHaveLength(3)
    const runCalls = fake.calls.filter((call) => /\/repos\/owner\/r\d+\/actions\/runs/.test(call.url))
    expect(runCalls).toHaveLength(3)
  })

  it('caps total workflow runs at 10 across all scanned repos', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta'), repoFixture(3, 'gamma')],
      workflowRunsByRepo: {
        'owner/alpha': Array.from({ length: 10 }, (_, i) => runFixture(`Alpha ${i + 1}`, 'completed', 'success', '2026-07-20T10:00:00.000Z')),
        'owner/beta': Array.from({ length: 10 }, (_, i) => runFixture(`Beta ${i + 1}`, 'completed', 'success', '2026-07-20T10:00:00.000Z')),
        'owner/gamma': Array.from({ length: 10 }, (_, i) => runFixture(`Gamma ${i + 1}`, 'completed', 'success', '2026-07-20T10:00:00.000Z')),
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/workflow_runs'), env(), fake.dependencies)
    const body = await result!.json() as { workflowRuns: unknown[] }
    expect(body.workflowRuns).toHaveLength(10)
  })

  it('fails the whole request closed if any single scanned repo fails, instead of returning a partial list', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha'), repoFixture(2, 'beta')],
      workflowRunsByRepo: {
        'owner/alpha': [runFixture('CI', 'completed', 'success', '2026-07-20T10:00:00.000Z')],
      },
      workflowRunsFailureByRepo: {
        'owner/beta': 500,
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/workflow_runs'), env(), fake.dependencies)
    expect(result?.status).toBe(502)
    const body = await result!.json() as { error: { code: string } }
    expect(body.error.code).toBe('GITHUB_UNAVAILABLE')
  })

  it('rejects malformed workflow run metadata the same way malformed issue metadata is rejected', async () => {
    const fake = fakeProvider({
      repositories: [repoFixture(1, 'alpha')],
      workflowRunsByRepo: {
        'owner/alpha': [{ name: 'CI' }],
      },
    })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/workflow_runs'), env(), fake.dependencies)
    expect(result?.status).toBe(502)
    expect(await result?.json()).toMatchObject({ error: { code: 'GITHUB_RESPONSE_INVALID' } })
  })

  it('returns an empty bounded list without calling any repo actions endpoint when there are no repos', async () => {
    const fake = fakeProvider({ repositories: [] })
    fake.connection = verifiedConnection()

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/workflow_runs'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ workflowRuns: [] })
    expect(fake.calls.some((call) => /\/repos\/.+\/actions\/runs/.test(call.url))).toBe(false)
  })
})

describe('GitHub repository inventory boundary', () => {
  function verifiedConnection(userId = USER_ONE, overrides: Record<string, unknown> = {}) {
    return {
      user_id: userId,
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'connected',
      ...overrides,
    }
  }

  it('requires authentication without requiring GitHub App credentials', async () => {
    const fake = fakeProvider()
    const missingProviderConfig = env({
      GITHUB_APP_ID: undefined,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_APP_SLUG: undefined,
      GITHUB_SETUP_URL: undefined,
      GITHUB_CALLBACK_URL: undefined,
      GITHUB_APP_PRIVATE_KEY: undefined,
      GITHUB_CLIENT_SECRET: undefined,
    })

    const unauthenticated = await handleGitHubIntegrationRequest(
      apiRequest('/github/repository-inventory', 'GET', false),
      missingProviderConfig,
      fake.dependencies,
    )
    expect(unauthenticated?.status).toBe(401)

    fake.connection = verifiedConnection()
    const authenticated = await handleGitHubIntegrationRequest(
      apiRequest('/github/repository-inventory'),
      missingProviderConfig,
      fake.dependencies,
    )
    expect(authenticated?.status).toBe(200)
  })

  it('returns unknown when GitHub is not connected at all', async () => {
    const fake = fakeProvider()
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repository-inventory'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ status: 'unknown' })
  })

  it('returns unknown when connected but github.repositories.list has never populated the cache', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection()
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repository-inventory'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ status: 'unknown' })
  })

  it('returns known with an empty list when the cache was refreshed and confirmed zero repositories', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection(USER_ONE, { repository_names_cache: [] })
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repository-inventory'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ status: 'known', names: [] })
  })

  it('returns known with names when the cache has been populated', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection(USER_ONE, {
      repository_names_cache: ['aryan/smart-academy', 'aryan/dailyflow'],
    })
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repository-inventory'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ status: 'known', names: ['aryan/smart-academy', 'aryan/dailyflow'] })
  })

  it('treats a revoked connection as unknown even if stale names remain cached', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection(USER_ONE, {
      status: 'revoked',
      repository_names_cache: ['aryan/stale-repo'],
    })
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repository-inventory'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ status: 'unknown' })
  })

  it('never mints an installation token or calls GitHub for this read', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection(USER_ONE, { repository_names_cache: ['aryan/smart-academy'] })
    await handleGitHubIntegrationRequest(apiRequest('/github/repository-inventory'), env(), fake.dependencies)
    expect(fake.calls.some((call) => call.url.startsWith('https://api.github.com') || call.url.startsWith('https://github.com'))).toBe(false)
  })

  it('scopes the read to the authenticated user only', async () => {
    const fake = fakeProvider()
    fake.connection = verifiedConnection(USER_ONE, { repository_names_cache: ['aryan/smart-academy'] })
    fake.currentUser = USER_TWO
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/repository-inventory'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({ status: 'unknown' })
  })
})

describe('GitHub connection status boundary', () => {
  it('requires authentication without requiring GitHub App credentials', async () => {
    const fake = fakeProvider()
    const missingProviderConfig = env({
      GITHUB_APP_ID: undefined,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_APP_SLUG: undefined,
      GITHUB_SETUP_URL: undefined,
      GITHUB_CALLBACK_URL: undefined,
      GITHUB_APP_PRIVATE_KEY: undefined,
      GITHUB_CLIENT_SECRET: undefined,
    })

    const unauthenticated = await handleGitHubIntegrationRequest(
      apiRequest('/github/connection', 'GET', false),
      missingProviderConfig,
      fake.dependencies,
    )
    expect(unauthenticated?.status).toBe(401)

    const authenticated = await handleGitHubIntegrationRequest(
      apiRequest('/github/connection'),
      missingProviderConfig,
      fake.dependencies,
    )
    expect(await authenticated?.json()).toEqual({
      connected: false,
      status: 'not_connected',
      reconnectRequired: false,
    })
  })

  it('returns only bounded connection fields through the user RLS token', async () => {
    const fake = fakeProvider()
    fake.connection = {
      user_id: USER_ONE,
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'connected',
      verified_at: '2026-07-22T10:00:00.000Z',
      provider_secret: 'must-not-pass',
    }

    const result = await handleGitHubIntegrationRequest(apiRequest('/github/connection'), env(), fake.dependencies)
    const body = await result?.json()
    expect(body).toEqual({
      connected: true,
      accountLabel: 'verified-user',
      status: 'connected',
      connectedAt: '2026-07-22T10:00:00.000Z',
      reconnectRequired: false,
    })
    const databaseRead = fake.calls.find((call) => call.url.includes('/rest/v1/github_connections'))
    expect(databaseRead?.authorization).toBe('Bearer supabase-session')
    expect(JSON.stringify(body)).not.toContain('installation')
  })

  it('maps revoked local state to reconnect required without exposing provider metadata', async () => {
    const fake = fakeProvider()
    fake.connection = {
      user_id: USER_ONE,
      installation_id: 777,
      github_account_id: 9001,
      github_account_login: 'verified-user',
      status: 'revoked',
      verified_at: '2026-07-22T10:00:00.000Z',
    }
    const result = await handleGitHubIntegrationRequest(apiRequest('/github/connection'), env(), fake.dependencies)
    expect(await result?.json()).toEqual({
      connected: false,
      accountLabel: 'verified-user',
      status: 'reconnect_required',
      connectedAt: '2026-07-22T10:00:00.000Z',
      reconnectRequired: true,
    })
  })
})

// EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
function writeApiRequest(path: string, method: string, body?: unknown, authenticated = true) {
  return new Request(`http://127.0.0.1:8787${path}`, {
    method,
    headers: {
      Origin: 'http://localhost:8080',
      'Content-Type': 'application/json',
      ...(authenticated ? { Authorization: 'Bearer supabase-session' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function writeVerifiedConnection(userId = USER_ONE) {
  return {
    user_id: userId,
    installation_id: 777,
    github_account_id: 9001,
    github_account_login: 'verified-user',
    status: 'connected',
  }
}

describe('GitHub issue comment write boundary', () => {
  it('requires authentication', async () => {
    const fake = fakeProvider()
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/comment', 'POST', { repo: 'owner/alpha', issue_number: 1, body: 'hi' }, false),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(401)
  })

  it('rejects malformed input before touching the rate limit, connection, or GitHub', async () => {
    const fake = fakeProvider()
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/comment', 'POST', { repo: 'not-a-repo', issue_number: 1, body: 'hi' }),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(400)
    expect(await result?.json()).toMatchObject({ error: { code: 'WRITE_INPUT_INVALID' } })
    expect(fake.writeLogRows).toHaveLength(0)
  })

  it('enforces the 5-writes-per-hour rate limit before calling GitHub', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      preseedWriteLogRows: Array.from({ length: 5 }, (_, i) => ({
        id: `existing-${i}`,
        user_id: USER_ONE,
        created_at: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
      })),
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/comment', 'POST', { repo: 'owner/alpha', issue_number: 1, body: 'hi' }),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(429)
    expect(await result?.json()).toMatchObject({ error: { code: 'WRITE_RATE_LIMIT_EXCEEDED' } })
    expect(fake.calls.some((call) => call.url.includes('/comments'))).toBe(false)
  })

  it('rejects a repository outside the verified installation before posting anything', async () => {
    const fake = fakeProvider({ accessibleRepos: ['owner/other'] })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/comment', 'POST', { repo: 'owner/alpha', issue_number: 1, body: 'hi' }),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(409)
    expect(await result?.json()).toMatchObject({ error: { code: 'REPOSITORY_NOT_ACCESSIBLE' } })
    expect(fake.calls.some((call) => call.url.includes('/comments'))).toBe(false)
    expect(fake.writeLogRows).toHaveLength(0)
  })

  it('logs pending before posting, then executed with the GitHub response on success', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      commentResultByRepo: { 'owner/alpha': { id: 42, html_url: 'https://github.com/owner/alpha/issues/1#issuecomment-42' } },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/comment', 'POST', { repo: 'owner/alpha', issue_number: 1, body: 'Thanks!' }),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(200)
    expect(await result?.json()).toEqual({ commentId: 42, url: 'https://github.com/owner/alpha/issues/1#issuecomment-42' })
    expect(fake.writeLogRows).toHaveLength(1)
    expect(fake.writeLogRows[0]).toMatchObject({
      user_id: USER_ONE,
      tool_id: 'github.issues.comment',
      status: 'executed',
      parameters: { repo: 'owner/alpha', issueNumber: 1, body: 'Thanks!' },
    })
    expect(fake.writeLogRows[0].github_response).toMatchObject({ id: 42 })
  })

  it('logs failed (not executed) and still returns the provider error when GitHub rejects the write', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      commentResultByRepo: { 'owner/alpha': 502 },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/comment', 'POST', { repo: 'owner/alpha', issue_number: 1, body: 'Thanks!' }),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(502)
    expect(fake.writeLogRows).toHaveLength(1)
    expect(fake.writeLogRows[0].status).toBe('failed')
  })
})

describe('GitHub issue update write boundary', () => {
  it('rejects an update with none of title/body/labels present', async () => {
    const fake = fakeProvider({ accessibleRepos: ['owner/alpha'] })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/update', 'PATCH', { repo: 'owner/alpha', issue_number: 1 }),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(400)
    expect(await result?.json()).toMatchObject({ error: { code: 'WRITE_INPUT_INVALID' } })
    expect(fake.writeLogRows).toHaveLength(0)
  })

  it('rejects labels that do not exist on the repository, without applying any change', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      labelsByRepo: { 'owner/alpha': ['bug', 'enhancement'] },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/update', 'PATCH', { repo: 'owner/alpha', issue_number: 1, labels: ['bug', 'not-a-real-label'] }),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(400)
    expect(await result?.json()).toMatchObject({ error: { code: 'LABELS_NOT_RECOGNIZED' } })
    expect(fake.calls.some((call) => call.method === 'PATCH' && /\/issues\/\d+$/.test(new URL(call.url).pathname))).toBe(false)
    expect(fake.writeLogRows).toHaveLength(0)
  })

  it('accepts labels that exist on the repository and logs pending -> executed', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      labelsByRepo: { 'owner/alpha': ['bug', 'priority:high'] },
      updateResultByRepo: { 'owner/alpha': { number: 1, html_url: 'https://github.com/owner/alpha/issues/1' } },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/update', 'PATCH', { repo: 'owner/alpha', issue_number: 1, labels: ['bug', 'priority:high'] }),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(200)
    expect(await result?.json()).toEqual({ issueNumber: 1, url: 'https://github.com/owner/alpha/issues/1' })
    expect(fake.writeLogRows).toHaveLength(1)
    expect(fake.writeLogRows[0]).toMatchObject({ status: 'executed', tool_id: 'github.issues.update' })
  })

  it('rejects a repository outside the verified installation', async () => {
    const fake = fakeProvider({ accessibleRepos: ['owner/other'] })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/update', 'PATCH', { repo: 'owner/alpha', issue_number: 1, title: 'New title' }),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(409)
    expect(await result?.json()).toMatchObject({ error: { code: 'REPOSITORY_NOT_ACCESSIBLE' } })
    expect(fake.writeLogRows).toHaveLength(0)
  })

  it('does not require labels when only updating the title', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      updateResultByRepo: { 'owner/alpha': { number: 1, html_url: 'https://github.com/owner/alpha/issues/1' } },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      writeApiRequest('/github/issues/update', 'PATCH', { repo: 'owner/alpha', issue_number: 1, title: 'New title' }),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(200)
  })
})

// EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
// Read-only: no branch, no commit, no pull request, no mutation. Every test
// in this block asserts the boundary holds, not only the happy path.
describe('GitHub file read boundary (EPIC-08 Slice 1)', () => {
  function base64(content: string) {
    return Buffer.from(content, 'utf-8').toString('base64')
  }

  function readRequest(query: string, authenticated = true) {
    return apiRequest(`/github/files/read?${query}`, 'GET', authenticated)
  }

  it('requires authentication before any provider call', async () => {
    const fake = fakeProvider()
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      readRequest('repo=owner/alpha&path=README.md', false),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(401)
    expect(fake.calls).toHaveLength(0)
  })

  it('rejects a missing or malformed repo or path before any provider call', async () => {
    const fake = fakeProvider()
    fake.connection = writeVerifiedConnection()

    const missingPath = await handleGitHubIntegrationRequest(readRequest('repo=owner/alpha'), env(), fake.dependencies)
    expect(missingPath?.status).toBe(400)
    expect(await missingPath?.json()).toMatchObject({ error: { code: 'WRITE_INPUT_INVALID' } })

    const missingRepo = await handleGitHubIntegrationRequest(readRequest('path=README.md'), env(), fake.dependencies)
    expect(missingRepo?.status).toBe(400)

    const malformedRepo = await handleGitHubIntegrationRequest(readRequest('repo=not-a-repo&path=README.md'), env(), fake.dependencies)
    expect(malformedRepo?.status).toBe(400)

    expect(fake.calls.some((call) => call.url.startsWith('https://api.github.com'))).toBe(false)
  })

  it.each([
    ['traversal', 'repo=owner/alpha&path=..%2Fetc%2Fpasswd'],
    ['absolute path', 'repo=owner/alpha&path=%2Fetc%2Fpasswd'],
    ['.env', 'repo=owner/alpha&path=.env'],
    ['.env.production', 'repo=owner/alpha&path=.env.production'],
    ['nested .git', 'repo=owner/alpha&path=vendor%2F.git%2Fconfig'],
    ['github workflow', 'repo=owner/alpha&path=.github%2Fworkflows%2Fci.yml'],
    ['private key', 'repo=owner/alpha&path=deploy%2Fid_rsa'],
    ['pem certificate', 'repo=owner/alpha&path=certs%2Fserver.pem'],
  ] as const)('rejects a protected or invalid path (%s) before any provider call', async (_label, query) => {
    const fake = fakeProvider()
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(readRequest(query), env(), fake.dependencies)
    expect(result?.status).toBe(400)
    expect(fake.calls.some((call) => call.url.startsWith('https://api.github.com'))).toBe(false)
  })

  it('accepts an id_rsa.pub public key path -- only the private-key basename is protected', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      fileContentByRepo: { 'owner/alpha': { sha: 'blob-sha-1', content: base64('ssh-rsa AAAA...') } },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      readRequest('repo=owner/alpha&path=deploy%2Fid_rsa.pub'),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(200)
  })

  it('rejects a repository outside the verified installation', async () => {
    const fake = fakeProvider({ accessibleRepos: ['owner/other'] })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      readRequest('repo=owner/alpha&path=README.md'),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(409)
    expect(await result?.json()).toMatchObject({ error: { code: 'REPOSITORY_NOT_ACCESSIBLE' } })
  })

  it('reads the default branch head commit and file content, and returns exactly the sanitized shape', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      defaultBranchByRepo: { 'owner/alpha': 'main' },
      branchCommitShaByRepo: { 'owner/alpha': 'commit-sha-abc' },
      fileContentByRepo: { 'owner/alpha': { sha: 'blob-sha-1', content: base64('hello world\n') } },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      readRequest('repo=owner/alpha&path=README.md'),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(200)
    const body = await result!.json()
    expect(body).toEqual({
      repo: 'owner/alpha',
      path: 'README.md',
      branch: 'main',
      blobSha: 'blob-sha-1',
      commitSha: 'commit-sha-abc',
      content: 'hello world\n',
      size: 12,
    })
    expect(fake.calls.some((call) => call.url.includes('/branches/main'))).toBe(true)
    expect(fake.calls.some((call) => call.url.includes('/contents/README.md'))).toBe(true)
    expect(JSON.stringify(body)).not.toContain('ghs_transient-installation-token')
  })

  it('reads a nested path using the repository default branch, never a caller-supplied ref', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      defaultBranchByRepo: { 'owner/alpha': 'develop' },
      branchCommitShaByRepo: { 'owner/alpha': 'commit-sha-develop' },
      fileContentByRepo: { 'owner/alpha': { sha: 'blob-sha-2', content: base64('export const x = 1;\n') } },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      readRequest('repo=owner/alpha&path=src%2Findex.ts&ref=some-other-branch'),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(200)
    const body = await result!.json() as { branch: string }
    expect(body.branch).toBe('develop')
    expect(fake.calls.some((call) => call.url.includes('/branches/develop'))).toBe(true)
    expect(fake.calls.some((call) => call.url.includes('ref=some-other-branch'))).toBe(false)
  })

  it('rejects a non-file path (directory) without exposing the raw provider shape', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      fileContentByRepo: { 'owner/alpha': { sha: 'tree-sha', content: '', type: 'dir' } },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      readRequest('repo=owner/alpha&path=src'),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(400)
    expect(await result?.json()).toMatchObject({ error: { code: 'FILE_NOT_A_TEXT_FILE' } })
  })

  it('rejects a file over the 128 KiB size limit before decoding its content', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      fileContentByRepo: {
        'owner/alpha': { sha: 'blob-sha-big', content: base64('x'.repeat(10)), size: 128 * 1024 + 1 },
      },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      readRequest('repo=owner/alpha&path=big.txt'),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(400)
    expect(await result?.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } })
  })

  it('rejects binary (invalid UTF-8) content', async () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe, 0x00, 0x01]).toString('base64')
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      fileContentByRepo: { 'owner/alpha': { sha: 'blob-sha-bin', content: invalidUtf8 } },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      readRequest('repo=owner/alpha&path=image.png'),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(400)
    expect(await result?.json()).toMatchObject({ error: { code: 'FILE_NOT_UTF8' } })
  })

  it('rejects content containing an embedded NUL byte even though it decodes as valid UTF-8', async () => {
    const withNul = Buffer.from('abc\u0000def', 'utf-8').toString('base64')
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      fileContentByRepo: { 'owner/alpha': { sha: 'blob-sha-nul', content: withNul } },
    })
    fake.connection = writeVerifiedConnection()
    const result = await handleGitHubIntegrationRequest(
      readRequest('repo=owner/alpha&path=weird.txt'),
      env(),
      fake.dependencies,
    )
    expect(result?.status).toBe(400)
    expect(await result?.json()).toMatchObject({ error: { code: 'FILE_NOT_UTF8' } })
  })

  it('never writes an agent_write_log row and never consumes the write rate limit', async () => {
    const fake = fakeProvider({
      accessibleRepos: ['owner/alpha'],
      fileContentByRepo: { 'owner/alpha': { sha: 'blob-sha-1', content: base64('ok') } },
    })
    fake.connection = writeVerifiedConnection()

    for (let index = 0; index < 6; index += 1) {
      const result = await handleGitHubIntegrationRequest(
        readRequest('repo=owner/alpha&path=README.md'),
        env(),
        fake.dependencies,
      )
      expect(result?.status).toBe(200)
    }

    expect(fake.writeLogRows).toHaveLength(0)
    expect(fake.calls.some((call) => call.url.includes('/rest/v1/agent_write_log'))).toBe(false)
  })
})
