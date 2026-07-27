import type { Env } from './types'

const GITHUB_AUTH_ORIGIN = 'https://github.com'
const GITHUB_API_ORIGIN = 'https://api.github.com'
const CONNECT_ATTEMPT_TTL_MS = 10 * 60 * 1000
const GITHUB_TIMEOUT_MS = 8_000
const MAX_REPOSITORIES = 20
const MAX_ISSUES = 20
const MAX_EPICS = 20
const MAX_PULL_REQUESTS = 20
const MAX_WORKFLOW_RUNS = 10
const MAX_REPOS_SCANNED_FOR_FANOUT = 3
// Separate from MAX_REPOSITORIES: this bounds only the cached inventory used
// for reasoning-context disambiguation, matching the MAX_SAFE_ITEMS cap the
// frontend already applies to every other safeContext array. The actual
// /github/repositories response keeps its own MAX_REPOSITORIES cap.
const MAX_CACHED_REPOSITORY_NAMES = 12
const MAX_INSTALLATION_LIST_PAGES = 10
const API_VERSION = '2022-11-28'

type Fetcher = typeof fetch

interface GitHubIntegrationDependencies {
  fetcher: Fetcher
  now(): Date
  randomBytes(length: number): Uint8Array
  createAppJwt(appId: string, privateKey: string, now: Date): Promise<string>
}

interface GitHubBaseConfig {
  allowedOrigins: Set<string>
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceKey: string
}

interface GitHubConfig extends GitHubBaseConfig {
  appId: string
  clientId: string
  appSlug: string
  setupUrl: string
  callbackUrl: string
  privateKey: string
  clientSecret: string
}

interface ConnectionAttempt {
  id: string
  user_id: string
  claimed_installation_id?: number | null
  expires_at: string
}

interface VerifiedConnection {
  user_id: string
  installation_id: number
  github_account_id: number
  github_account_login: string
  status: 'connected'
}

interface GitHubInstallationResponse {
  id?: unknown
  app_id?: unknown
  account?: {
    id?: unknown
    login?: unknown
  }
}

interface GitHubRepositoryResponse {
  id?: unknown
  name?: unknown
  visibility?: unknown
  private?: unknown
  default_branch?: unknown
  archived?: unknown
  owner?: { login?: unknown }
}

interface GitHubIssueResponse {
  number?: unknown
  title?: unknown
  state?: unknown
  updated_at?: unknown
  pull_request?: unknown
}

interface GitHubLabelResponse {
  name?: unknown
}

interface GitHubEpicIssueResponse {
  number?: unknown
  title?: unknown
  html_url?: unknown
  labels?: unknown
  pull_request?: unknown
}

interface GitHubPullRequestResponse {
  number?: unknown
  title?: unknown
  state?: unknown
  updated_at?: unknown
  draft?: unknown
}

interface GitHubWorkflowRunResponse {
  name?: unknown
  status?: unknown
  conclusion?: unknown
  updated_at?: unknown
}

class GitHubIntegrationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const defaultDependencies: GitHubIntegrationDependencies = {
  fetcher: (input, init) => fetch(input, init),
  now: () => new Date(),
  randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length))
  },
  createAppJwt,
}

function boundedString(value: unknown, maxLength: number) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength)
    : ''
}

function positiveInteger(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function isHttpUrl(value: string, expectedPath: string) {
  try {
    const url = new URL(value)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return (url.protocol === 'https:' || (local && url.protocol === 'http:')) &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === expectedPath &&
      url.search === '' &&
      url.hash === ''
  } catch {
    return false
  }
}

function resolveBaseConfig(env: Env): GitHubBaseConfig {
  const supabaseUrl = (env.SUPABASE_URL ?? '').replace(/\/$/, '')
  const allowedOrigins = new Set(
    (env.GITHUB_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => {
        try {
          const url = new URL(item)
          const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
          return url.origin === item && (url.protocol === 'https:' || localHttp)
        } catch {
          return false
        }
      }),
  )

  if (
    !supabaseUrl ||
    !env.SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_KEY ||
    allowedOrigins.size === 0
  ) {
    throw new GitHubIntegrationError(
      'GITHUB_BASE_CONFIGURATION_MISSING',
      503,
      'GitHub integration is not configured.',
    )
  }

  return {
    allowedOrigins,
    supabaseUrl,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    supabaseServiceKey: env.SUPABASE_SERVICE_KEY,
  }
}

function resolveConfig(env: Env): GitHubConfig {
  const base = resolveBaseConfig(env)
  const appId = boundedString(env.GITHUB_APP_ID, 32)
  const clientId = boundedString(env.GITHUB_CLIENT_ID, 128)
  const appSlug = boundedString(env.GITHUB_APP_SLUG, 100)
  const setupUrl = boundedString(env.GITHUB_SETUP_URL, 500)
  const callbackUrl = boundedString(env.GITHUB_CALLBACK_URL, 500)
  const privateKey = (env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim()
  const clientSecret = (env.GITHUB_CLIENT_SECRET ?? '').trim()

  if (
    !positiveInteger(appId) ||
    !/^[A-Za-z0-9_-]+$/.test(clientId) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(appSlug) ||
    !isHttpUrl(setupUrl, '/github/connect/setup') ||
    !isHttpUrl(callbackUrl, '/github/connect/callback') ||
    !privateKey.includes('PRIVATE KEY') ||
    clientSecret.length < 8
  ) {
    throw new GitHubIntegrationError(
      'GITHUB_CONFIGURATION_MISSING',
      503,
      'GitHub integration is not configured.',
    )
  }

  return { ...base, appId, clientId, appSlug, setupUrl, callbackUrl, privateKey, clientSecret }
}

function corsHeaders(origin: string, config?: GitHubBaseConfig) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (origin && config?.allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function json(body: unknown, status: number, origin = '', config?: GitHubBaseConfig) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin, config),
    },
  })
}

function safeErrorResponse(error: unknown, origin = '', config?: GitHubBaseConfig) {
  if (error instanceof GitHubIntegrationError) {
    return json({ error: { code: error.code, message: error.message } }, error.status, origin, config)
  }
  return json(
    { error: { code: 'GITHUB_INTEGRATION_FAILED', message: 'GitHub integration request failed safely.' } },
    500,
    origin,
    config,
  )
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function stateToken(deps: GitHubIntegrationDependencies) {
  return base64Url(deps.randomBytes(32))
}

function validState(value: string | null) {
  return Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value))
}

async function requireUser(request: Request, config: GitHubBaseConfig, deps: GitHubIntegrationDependencies) {
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || authorization.length > 8192) {
    throw new GitHubIntegrationError('AUTH_REQUIRED', 401, 'Authentication is required.')
  }

  const response = await deps.fetcher(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: authorization,
      apikey: config.supabaseAnonKey,
    },
  })
  if (!response.ok) {
    throw new GitHubIntegrationError('AUTH_INVALID', 401, 'Authentication is invalid or expired.')
  }
  const body = await response.json() as { id?: unknown }
  const userId = boundedString(body.id, 64)
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new GitHubIntegrationError('AUTH_INVALID', 401, 'Authentication is invalid or expired.')
  }
  return { userId, authorization }
}

function serviceHeaders(config: GitHubBaseConfig, prefer?: string) {
  return {
    apikey: config.supabaseServiceKey,
    Authorization: `Bearer ${config.supabaseServiceKey}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  }
}

async function databaseRequest(
  config: GitHubBaseConfig,
  deps: GitHubIntegrationDependencies,
  path: string,
  init: RequestInit = {},
) {
  const response = await deps.fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...serviceHeaders(config),
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    throw new GitHubIntegrationError('CONNECTION_STORAGE_FAILED', 500, 'Connection state could not be stored safely.')
  }
  return response
}

async function userDatabaseRequest(
  config: GitHubBaseConfig,
  deps: GitHubIntegrationDependencies,
  authorization: string,
  path: string,
) {
  const response = await deps.fetcher(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
  })
  if (!response.ok) {
    throw new GitHubIntegrationError('CONNECTION_STATUS_FAILED', 500, 'Connection status could not be loaded safely.')
  }
  return response
}

async function tryConsumeAttempt(
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
  hashColumn: 'setup_state_hash' | 'oauth_state_hash',
  stateHash: string,
  consumedColumn: 'setup_consumed_at' | 'oauth_consumed_at',
  update: Record<string, unknown>,
): Promise<ConnectionAttempt | undefined> {
  const now = deps.now().toISOString()
  const response = await databaseRequest(
    config,
    deps,
    `github_connection_attempts?${hashColumn}=eq.${stateHash}&${consumedColumn}=is.null&expires_at=gt.${encodeURIComponent(now)}&select=id,user_id,claimed_installation_id,expires_at`,
    {
      method: 'PATCH',
      headers: serviceHeaders(config, 'return=representation'),
      body: JSON.stringify({ ...update, [consumedColumn]: now }),
    },
  )
  const rows = await response.json() as ConnectionAttempt[]
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : undefined
}

async function consumeAttempt(
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
  hashColumn: 'setup_state_hash' | 'oauth_state_hash',
  stateHash: string,
  consumedColumn: 'setup_consumed_at' | 'oauth_consumed_at',
  update: Record<string, unknown>,
) {
  const attempt = await tryConsumeAttempt(config, deps, hashColumn, stateHash, consumedColumn, update)
  if (!attempt) {
    throw new GitHubIntegrationError('CONNECTION_STATE_INVALID', 400, 'Connection state is invalid, expired, or already used.')
  }
  return attempt
}

async function startConnection(
  userId: string,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const setupState = stateToken(deps)
  const setupStateHash = await sha256(setupState)
  const now = deps.now()
  const expiresAt = new Date(now.getTime() + CONNECT_ATTEMPT_TTL_MS).toISOString()

  await databaseRequest(
    config,
    deps,
    `github_connection_attempts?user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  )
  await databaseRequest(config, deps, 'github_connection_attempts', {
    method: 'POST',
    headers: serviceHeaders(config, 'return=minimal'),
    body: JSON.stringify({
      id: crypto.randomUUID(),
      user_id: userId,
      setup_state_hash: setupStateHash,
      expires_at: expiresAt,
      created_at: now.toISOString(),
    }),
  })

  const installationUrl = new URL(`/apps/${config.appSlug}/installations/new`, GITHUB_AUTH_ORIGIN)
  installationUrl.searchParams.set('state', setupState)
  return { installationUrl: installationUrl.toString(), expiresAt }
}

async function handleSetup(
  request: Request,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const url = new URL(request.url)
  const setupState = url.searchParams.get('state')
  const installationId = positiveInteger(url.searchParams.get('installation_id'))
  if (!validState(setupState) || !installationId) {
    throw new GitHubIntegrationError('CONNECTION_SETUP_INVALID', 400, 'GitHub setup parameters are invalid.')
  }

  const oauthState = stateToken(deps)
  const attempt = await consumeAttempt(
    config,
    deps,
    'setup_state_hash',
    await sha256(setupState!),
    'setup_consumed_at',
    {
      claimed_installation_id: installationId,
      oauth_state_hash: await sha256(oauthState),
    },
  )
  if (!attempt.user_id) {
    throw new GitHubIntegrationError('CONNECTION_STATE_INVALID', 400, 'Connection state is invalid.')
  }

  const authorizationUrl = new URL('/login/oauth/authorize', GITHUB_AUTH_ORIGIN)
  authorizationUrl.searchParams.set('client_id', config.clientId)
  authorizationUrl.searchParams.set('redirect_uri', config.callbackUrl)
  authorizationUrl.searchParams.set('state', oauthState)
  return Response.redirect(authorizationUrl.toString(), 302)
}

async function githubFetch(
  deps: GitHubIntegrationDependencies,
  url: string,
  init: RequestInit,
) {
  const parsed = new URL(url)
  if (parsed.origin !== GITHUB_AUTH_ORIGIN && parsed.origin !== GITHUB_API_ORIGIN) {
    throw new GitHubIntegrationError('GITHUB_ENDPOINT_DENIED', 500, 'Provider endpoint is not allowed.')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS)
  try {
    return await deps.fetcher(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GitHubIntegrationError('GITHUB_TIMEOUT', 504, 'GitHub did not respond in time.')
    }
    throw new GitHubIntegrationError('GITHUB_UNAVAILABLE', 502, 'GitHub is currently unavailable.')
  } finally {
    clearTimeout(timeout)
  }
}

function providerError(
  response: Response,
  context: 'verification' | 'user-token-exchange' | 'installation-token-mint' | 'repositories' | 'issues' | 'epics' | 'pulls' | 'workflow_runs',
) {
  if (response.status === 429) {
    return new GitHubIntegrationError('GITHUB_RATE_LIMITED', 503, 'GitHub rate limit was reached.')
  }
  if (response.status === 404) {
    const code = context === 'verification'
      ? 'INSTALLATION_NOT_ACCESSIBLE'
      : context === 'user-token-exchange'
        ? 'GITHUB_TOKEN_EXCHANGE_FAILED'
        : 'GITHUB_APP_NOT_INSTALLED'
    const message = context === 'user-token-exchange'
      ? 'GitHub could not exchange the authorization code for a user token.'
      : 'The GitHub App installation is not available.'
    return new GitHubIntegrationError(code, 409, message)
  }
  if (response.status === 401 || response.status === 403) {
    const code = context === 'verification' ? 'INSTALLATION_NOT_ACCESSIBLE' : 'GITHUB_AUTHORIZATION_INVALID'
    return new GitHubIntegrationError(code, 409, 'GitHub authorization is invalid or revoked.')
  }
  if (response.status >= 500) {
    return new GitHubIntegrationError('GITHUB_UNAVAILABLE', 502, 'GitHub is currently unavailable.')
  }
  return new GitHubIntegrationError('GITHUB_PROVIDER_REJECTED', 502, 'GitHub rejected the request.')
}

async function providerJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid response.')
  }
}

async function exchangeUserCode(
  code: string,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const response = await githubFetch(deps, `${GITHUB_AUTH_ORIGIN}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }).toString(),
  })
  if (!response.ok) throw providerError(response, 'user-token-exchange')
  const body = await providerJson<{ access_token?: unknown; token_type?: unknown }>(response)
  const token = boundedString(body.access_token, 512)
  if (!token || boundedString(body.token_type, 32).toLowerCase() !== 'bearer') {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid authorization response.')
  }
  return token
}

// GET /user/installations/{id} is not a real GitHub endpoint — the only
// documented user-scoped installation route is the paginated list,
// GET /user/installations. Verification therefore means "does installationId
// appear in the list GitHub returns for this user's own OAuth token", which
// preserves the same guarantee a single-resource lookup was meant to give:
// the installation must be visible to the authenticated user, not merely
// claimed by an unauthenticated party.
async function verifyInstallation(
  installationId: number,
  userToken: string,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  for (let page = 1; page <= MAX_INSTALLATION_LIST_PAGES; page++) {
    const response = await githubFetch(
      deps,
      `${GITHUB_API_ORIGIN}/user/installations?per_page=100&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${userToken}`,
          'X-GitHub-Api-Version': API_VERSION,
          'User-Agent': 'SmartFlow-GitHub-App',
        },
      },
    )
    if (!response.ok) throw providerError(response, 'verification')
    const body = await providerJson<{ installations?: unknown }>(response)
    if (!Array.isArray(body.installations)) {
      throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid installation list response.')
    }
    const match = body.installations.find((item) => {
      if (!item || typeof item !== 'object') return false
      return positiveInteger((item as GitHubInstallationResponse).id) === installationId
    }) as GitHubInstallationResponse | undefined
    if (match) {
      const appId = positiveInteger(match.app_id)
      const accountId = positiveInteger(match.account?.id)
      const accountLogin = boundedString(match.account?.login, 100)
      if (appId !== Number(config.appId) || !accountId || !accountLogin) {
        throw new GitHubIntegrationError('INSTALLATION_VERIFICATION_FAILED', 409, 'The GitHub installation could not be verified.')
      }
      return { installationId, accountId, accountLogin }
    }
    if (body.installations.length < 100) break
  }
  throw new GitHubIntegrationError('INSTALLATION_NOT_ACCESSIBLE', 409, 'The GitHub App installation is not available.')
}

async function persistConnection(
  attempt: ConnectionAttempt,
  verified: Awaited<ReturnType<typeof verifyInstallation>>,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const now = deps.now().toISOString()
  const connection: VerifiedConnection & Record<string, unknown> = {
    user_id: attempt.user_id,
    installation_id: verified.installationId,
    github_account_id: verified.accountId,
    github_account_login: verified.accountLogin,
    status: 'connected',
    verified_at: now,
    updated_at: now,
  }
  await databaseRequest(config, deps, 'github_connections?on_conflict=user_id', {
    method: 'POST',
    headers: serviceHeaders(config, 'resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(connection),
  })
  await databaseRequest(config, deps, `github_connection_attempts?id=eq.${encodeURIComponent(attempt.id)}`, {
    method: 'PATCH',
    headers: serviceHeaders(config, 'return=minimal'),
    body: JSON.stringify({ completed_at: now }),
  })
}

async function handleCallback(
  request: Request,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const url = new URL(request.url)
  const code = boundedString(url.searchParams.get('code'), 512)
  const incomingState = url.searchParams.get('state')
  const setupAction = url.searchParams.get('setup_action')
  if (!code || !validState(incomingState)) {
    throw new GitHubIntegrationError('CONNECTION_CALLBACK_INVALID', 400, 'GitHub callback parameters are invalid.')
  }
  if (setupAction === 'request') {
    throw new GitHubIntegrationError(
      'CONNECTION_APPROVAL_PENDING',
      409,
      'Installation approval is pending from an organization owner.',
    )
  }

  // GitHub does not guarantee state survives a Setup URL round trip, but
  // production traffic confirms it reliably reaches this callback. When the
  // Setup URL was skipped, the state we receive here is still the original
  // setup-phase token, so oauth_state_hash never got populated for it. Try
  // the OAuth-phase column first (the intended two-step path), then fall
  // back to the setup-phase column (the collapsed path GitHub actually took
  // for this App configuration). Each lookup is a single atomic
  // filtered PATCH, so a given state can be consumed at most once total,
  // regardless of which column it is eventually matched against.
  const stateHash = await sha256(incomingState!)
  const oauthAttempt = await tryConsumeAttempt(config, deps, 'oauth_state_hash', stateHash, 'oauth_consumed_at', {})

  let attempt: ConnectionAttempt
  let installationId: number | undefined

  if (oauthAttempt) {
    attempt = oauthAttempt
    installationId = positiveInteger(attempt.claimed_installation_id)
  } else {
    const setupAttempt = await tryConsumeAttempt(config, deps, 'setup_state_hash', stateHash, 'setup_consumed_at', {})
    if (!setupAttempt) {
      throw new GitHubIntegrationError('CONNECTION_STATE_INVALID', 400, 'Connection state is invalid, expired, or already used.')
    }
    attempt = setupAttempt
    // handleSetup() never ran on this path, so claimed_installation_id was
    // never written. The callback's own installation_id is the only source
    // for it here; verifyInstallation() independently re-checks it against
    // GitHub before anything is trusted or persisted.
    installationId = positiveInteger(url.searchParams.get('installation_id'))
  }

  if (!installationId || !attempt.user_id) {
    throw new GitHubIntegrationError('CONNECTION_STATE_INVALID', 400, 'Connection state is incomplete.')
  }

  const userToken = await exchangeUserCode(code, config, deps)
  const verified = await verifyInstallation(installationId, userToken, config, deps)
  await persistConnection(attempt, verified, config, deps)

  return json({ connected: true, accountLogin: verified.accountLogin }, 200)
}

function encodeDerLength(length: number) {
  if (length < 128) return new Uint8Array([length])
  const bytes: number[] = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining >>= 8
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function concatBytes(...arrays: Uint8Array[]) {
  const output = new Uint8Array(arrays.reduce((sum, item) => sum + item.length, 0))
  let offset = 0
  for (const item of arrays) {
    output.set(item, offset)
    offset += item.length
  }
  return output
}

function der(tag: number, body: Uint8Array) {
  return concatBytes(new Uint8Array([tag]), encodeDerLength(body.length), body)
}

function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const rsaAlgorithmIdentifier = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ])
  return der(0x30, concatBytes(new Uint8Array([0x02, 0x01, 0x00]), rsaAlgorithmIdentifier, der(0x04, pkcs1)))
}

function pemBytes(privateKey: string) {
  const isPkcs1 = privateKey.includes('BEGIN RSA PRIVATE KEY')
  const base64 = privateKey.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\s/g, '')
  if (!base64) throw new GitHubIntegrationError('GITHUB_CONFIGURATION_INVALID', 503, 'GitHub private key is invalid.')
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return isPkcs1 ? pkcs1ToPkcs8(bytes) : bytes
}

async function createAppJwt(appId: string, privateKey: string, now: Date) {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: appId })))
  const unsigned = `${header}.${payload}`
  try {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemBytes(privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
    return `${unsigned}.${base64Url(new Uint8Array(signature))}`
  } catch {
    throw new GitHubIntegrationError('GITHUB_CONFIGURATION_INVALID', 503, 'GitHub private key is invalid.')
  }
}

async function loadConnection(
  userId: string,
  authorization: string,
  config: GitHubBaseConfig,
  deps: GitHubIntegrationDependencies,
) {
  const response = await userDatabaseRequest(
    config,
    deps,
    authorization,
    `github_connections?status=eq.connected&select=user_id,installation_id,github_account_id,github_account_login,status&limit=1`,
  )
  const rows = await response.json() as VerifiedConnection[]
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].user_id !== userId) {
    throw new GitHubIntegrationError('GITHUB_NOT_CONNECTED', 409, 'GitHub is not connected.')
  }
  return rows[0]
}

async function installationToken(
  installationId: number,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const appJwt = await deps.createAppJwt(config.appId, config.privateKey, deps.now())
  const response = await githubFetch(
    deps,
    `${GITHUB_API_ORIGIN}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${appJwt}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'SmartFlow-GitHub-App',
      },
    },
  )
  if (!response.ok) throw providerError(response, 'installation-token-mint')
  const body = await providerJson<{ token?: unknown }>(response)
  const token = boundedString(body.token, 512)
  if (!token) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid installation token response.')
  }
  return token
}

function sanitizeRepository(value: GitHubRepositoryResponse) {
  const id = positiveInteger(value.id)
  const name = boundedString(value.name, 100)
  const owner = boundedString(value.owner?.login, 100)
  const defaultBranch = boundedString(value.default_branch, 100)
  if (!id || !name || !owner || !defaultBranch) return undefined
  const visibilityValue = boundedString(value.visibility, 16)
  const visibility = visibilityValue === 'public' || visibilityValue === 'private' || visibilityValue === 'internal'
    ? visibilityValue
    : typeof value.private === 'boolean'
      ? value.private ? 'private' : 'public'
      : undefined
  if (!visibility) return undefined
  return {
    id: String(id),
    name,
    owner,
    visibility,
    defaultBranch,
    archived: value.archived === true,
  }
}

// Best-effort side write, never allowed to fail the caller's actual
// repositories response. A write failure just leaves the cache at whatever
// it was before (possibly still NULL/"unknown") -- that degrades the
// reasoning-context hint, it does not break repository listing.
//
// Per-element length bounding happens here, not in a database CHECK
// constraint -- Postgres CHECK constraints forbid subqueries entirely
// (error 0A000), which rules out any per-element predicate over an array
// column. The migration can only bound array length; this is the one place
// that writes the column, so it is also the one place that can bound each
// element.
async function cacheRepositoryNames(
  userId: string,
  names: string[],
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const boundedNames = names
    .map((name) => boundedString(name, 200))
    .filter((name): name is string => Boolean(name))
  await databaseRequest(config, deps, `github_connections?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: serviceHeaders(config, 'return=minimal'),
    body: JSON.stringify({
      repository_names_cache: boundedNames,
      repository_names_cached_at: deps.now().toISOString(),
    }),
  })
}

async function listRepositories(
  request: Request,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const { userId, authorization } = await requireUser(request, config, deps)
  const connection = await loadConnection(userId, authorization, config, deps)
  const installationId = positiveInteger(connection.installation_id)
  if (!installationId) {
    throw new GitHubIntegrationError('CONNECTION_RECORD_INVALID', 500, 'Verified connection metadata is invalid.')
  }
  const token = await installationToken(installationId, config, deps)
  const response = await githubFetch(
    deps,
    `${GITHUB_API_ORIGIN}/installation/repositories?per_page=${MAX_REPOSITORIES}&page=1`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'SmartFlow-GitHub-App',
      },
    },
  )
  if (!response.ok) throw providerError(response, 'repositories')
  const body = await providerJson<{ repositories?: unknown }>(response)
  if (!Array.isArray(body.repositories)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid repository response.')
  }
  const selected = body.repositories.slice(0, MAX_REPOSITORIES)
  const repositories = selected
    .map((item) => item && typeof item === 'object' ? sanitizeRepository(item as GitHubRepositoryResponse) : undefined)
  if (repositories.some((item) => !item)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned invalid repository metadata.')
  }
  const sanitizedRepositories = repositories.filter(
    (item): item is NonNullable<ReturnType<typeof sanitizeRepository>> => Boolean(item),
  )

  // Piggybacks on this already-authenticated, already-token-minted call
  // instead of fetching GitHub again elsewhere -- this is the only place
  // the reasoning-context repository inventory gets refreshed.
  try {
    await cacheRepositoryNames(
      userId,
      sanitizedRepositories
        .slice(0, MAX_CACHED_REPOSITORY_NAMES)
        .map((item) => `${item.owner}/${item.name}`),
      config,
      deps,
    )
  } catch (error) {
    console.error('[GitHub] Failed to cache repository inventory:', error)
  }

  return {
    repositories: sanitizedRepositories,
  }
}

function isPullRequest(value: GitHubIssueResponse) {
  return value.pull_request !== undefined
}

function sanitizeIssue(repo: string, value: GitHubIssueResponse) {
  const number = positiveInteger(value.number)
  const title = boundedString(value.title, 200)
  const stateValue = boundedString(value.state, 16)
  const state = stateValue === 'open' || stateValue === 'closed' ? stateValue : undefined
  const updatedAt = boundedString(value.updated_at, 64)
  if (!number || !title || !state || !updatedAt) return undefined
  return { repo, number, title, state, updatedAt }
}

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item : (item as GitHubLabelResponse)?.name))
    .map((name) => boundedString(name, 100))
    .filter((name): name is string => Boolean(name))
}

function isGitHubIssueUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

// Only number/title/html_url are validated here -- "not carrying an epic:
// label" is expected for the vast majority of issues and is filtered out by
// the caller, not treated as malformed data the way a missing number/title
// is. Keeping that distinction here (base sanitize can fail closed; label
// matching cannot) mirrors how isPullRequest() is excluded silently instead
// of failing sanitizeIssue.
function sanitizeEpicBase(repo: string, value: GitHubEpicIssueResponse) {
  const number = positiveInteger(value.number)
  const title = boundedString(value.title, 200)
  const url = boundedString(value.html_url, 500)
  if (!number || !title || !url || !isGitHubIssueUrl(url)) return undefined
  return { repo, number, title, url, labels: labelNames(value.labels) }
}

function sanitizePullRequest(repo: string, value: GitHubPullRequestResponse) {
  const number = positiveInteger(value.number)
  const title = boundedString(value.title, 200)
  const stateValue = boundedString(value.state, 16)
  const state = stateValue === 'open' || stateValue === 'closed' ? stateValue : undefined
  const updatedAt = boundedString(value.updated_at, 64)
  if (!number || !title || !state || !updatedAt) return undefined
  return { repo, number, title, state, updatedAt, draft: value.draft === true }
}

// Unlike issue/PR "state" (a stable open|closed pair), GitHub Actions run
// status/conclusion cover a larger, still-evolving vocabulary (queued,
// in_progress, completed, action_required, neutral, stale, ...). Enum-gating
// them the same way risks fail-closed rejecting a legitimate value GitHub
// adds later, so they are bounded strings instead. conclusion is also
// genuinely absent (null) while a run is still in progress, not malformed.
function sanitizeWorkflowRun(repo: string, value: GitHubWorkflowRunResponse) {
  const workflowName = boundedString(value.name, 200)
  const status = boundedString(value.status, 32)
  const updatedAt = boundedString(value.updated_at, 64)
  if (!workflowName || !status || !updatedAt) return undefined
  const conclusion = boundedString(value.conclusion, 32) || undefined
  return { repo, workflowName, status, conclusion, updatedAt }
}

async function scanRepositoriesForFanout(
  token: string,
  deps: GitHubIntegrationDependencies,
  maxRepos: number,
) {
  const response = await githubFetch(
    deps,
    `${GITHUB_API_ORIGIN}/installation/repositories?per_page=${maxRepos}&page=1`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'SmartFlow-GitHub-App',
      },
    },
  )
  if (!response.ok) throw providerError(response, 'repositories')
  const body = await providerJson<{ repositories?: unknown }>(response)
  if (!Array.isArray(body.repositories)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid repository response.')
  }
  const selected = body.repositories.slice(0, maxRepos)
  const repositories = selected
    .map((item) => item && typeof item === 'object' ? sanitizeRepository(item as GitHubRepositoryResponse) : undefined)
  if (repositories.some((item) => !item)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned invalid repository metadata.')
  }
  return repositories.filter(
    (item): item is NonNullable<ReturnType<typeof sanitizeRepository>> => Boolean(item),
  )
}

async function listIssuesForRepository(
  repo: NonNullable<ReturnType<typeof sanitizeRepository>>,
  token: string,
  deps: GitHubIntegrationDependencies,
) {
  const response = await githubFetch(
    deps,
    `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues?state=open&per_page=${MAX_ISSUES}&page=1`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'SmartFlow-GitHub-App',
      },
    },
  )
  if (!response.ok) throw providerError(response, 'issues')
  const body = await providerJson<unknown>(response)
  if (!Array.isArray(body)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid issues response.')
  }
  const repoLabel = `${repo.owner}/${repo.name}`
  // Pull requests share this endpoint and carry a pull_request key — excluded
  // silently, they are not "invalid issue data". Anything else that fails to
  // sanitize is a genuine data problem and fails the whole request closed,
  // same as listRepositories.
  const candidates = body.filter(
    (item): item is GitHubIssueResponse =>
      Boolean(item) && typeof item === 'object' && !isPullRequest(item as GitHubIssueResponse),
  )
  const sanitized = candidates.map((item) => sanitizeIssue(repoLabel, item))
  if (sanitized.some((item) => !item)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned invalid issue metadata.')
  }
  return sanitized.filter((item): item is NonNullable<typeof item> => Boolean(item))
}

async function listIssues(
  request: Request,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const { userId, authorization } = await requireUser(request, config, deps)
  const connection = await loadConnection(userId, authorization, config, deps)
  const installationId = positiveInteger(connection.installation_id)
  if (!installationId) {
    throw new GitHubIntegrationError('CONNECTION_RECORD_INVALID', 500, 'Verified connection metadata is invalid.')
  }
  const token = await installationToken(installationId, config, deps)
  const repositories = await scanRepositoriesForFanout(token, deps, MAX_REPOS_SCANNED_FOR_FANOUT)

  // Repos are independent, read-only requests — fan out in parallel rather
  // than one round trip per repo. Promise.all fails the whole request closed
  // if any single repo's issues call fails, rather than silently returning a
  // partial, undercounted list.
  const perRepositoryIssues = await Promise.all(
    repositories.map((repo) => listIssuesForRepository(repo, token, deps)),
  )

  return {
    issues: perRepositoryIssues.flat().slice(0, MAX_ISSUES),
  }
}

async function listEpicsForRepository(
  repo: NonNullable<ReturnType<typeof sanitizeRepository>>,
  token: string,
  deps: GitHubIntegrationDependencies,
) {
  const response = await githubFetch(
    deps,
    `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues?state=all&per_page=${MAX_EPICS}&page=1`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'SmartFlow-GitHub-App',
      },
    },
  )
  if (!response.ok) throw providerError(response, 'epics')
  const body = await providerJson<unknown>(response)
  if (!Array.isArray(body)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid issues response.')
  }
  const repoLabel = `${repo.owner}/${repo.name}`
  const candidates = body.filter(
    (item): item is GitHubEpicIssueResponse =>
      Boolean(item) && typeof item === 'object' && !isPullRequest(item as GitHubIssueResponse),
  )
  const sanitizedBase = candidates.map((item) => sanitizeEpicBase(repoLabel, item))
  if (sanitizedBase.some((item) => !item)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned invalid issue metadata.')
  }
  const validBase = sanitizedBase.filter((item): item is NonNullable<typeof item> => Boolean(item))

  // Not carrying a label starting with "epic:" is the expected, common case
  // -- filtered out the same way pull requests are excluded above, not
  // treated as invalid data.
  return validBase
    .map((item) => {
      const epicLabel = item.labels.find((name) => name.toLowerCase().startsWith('epic:'))
      if (!epicLabel) return undefined
      const statusLabel = item.labels.find((name) => name.toLowerCase().startsWith('status:')) ?? ''
      return { repo: item.repo, number: item.number, title: item.title, epic: epicLabel, status: statusLabel, url: item.url }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

async function listEpics(
  request: Request,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const { userId, authorization } = await requireUser(request, config, deps)
  const connection = await loadConnection(userId, authorization, config, deps)
  const installationId = positiveInteger(connection.installation_id)
  if (!installationId) {
    throw new GitHubIntegrationError('CONNECTION_RECORD_INVALID', 500, 'Verified connection metadata is invalid.')
  }
  const token = await installationToken(installationId, config, deps)
  const repositories = await scanRepositoriesForFanout(token, deps, MAX_REPOS_SCANNED_FOR_FANOUT)

  const perRepositoryEpics = await Promise.all(
    repositories.map((repo) => listEpicsForRepository(repo, token, deps)),
  )

  return {
    epics: perRepositoryEpics.flat().slice(0, MAX_EPICS),
  }
}

async function listPullRequestsForRepository(
  repo: NonNullable<ReturnType<typeof sanitizeRepository>>,
  token: string,
  deps: GitHubIntegrationDependencies,
) {
  const response = await githubFetch(
    deps,
    `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pulls?state=open&per_page=${MAX_PULL_REQUESTS}&page=1`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'SmartFlow-GitHub-App',
      },
    },
  )
  if (!response.ok) throw providerError(response, 'pulls')
  const body = await providerJson<unknown>(response)
  if (!Array.isArray(body)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid pull request response.')
  }
  const repoLabel = `${repo.owner}/${repo.name}`
  // Unlike /issues, the /pulls endpoint returns only pull requests — no
  // exclusion filter is needed here.
  const sanitized = body
    .filter((item): item is GitHubPullRequestResponse => Boolean(item) && typeof item === 'object')
    .map((item) => sanitizePullRequest(repoLabel, item))
  if (sanitized.some((item) => !item)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned invalid pull request metadata.')
  }
  return sanitized.filter((item): item is NonNullable<typeof item> => Boolean(item))
}

async function listPullRequests(
  request: Request,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const { userId, authorization } = await requireUser(request, config, deps)
  const connection = await loadConnection(userId, authorization, config, deps)
  const installationId = positiveInteger(connection.installation_id)
  if (!installationId) {
    throw new GitHubIntegrationError('CONNECTION_RECORD_INVALID', 500, 'Verified connection metadata is invalid.')
  }
  const token = await installationToken(installationId, config, deps)
  const repositories = await scanRepositoriesForFanout(token, deps, MAX_REPOS_SCANNED_FOR_FANOUT)

  const perRepositoryPulls = await Promise.all(
    repositories.map((repo) => listPullRequestsForRepository(repo, token, deps)),
  )

  return {
    pullRequests: perRepositoryPulls.flat().slice(0, MAX_PULL_REQUESTS),
  }
}

async function listWorkflowRunsForRepository(
  repo: NonNullable<ReturnType<typeof sanitizeRepository>>,
  token: string,
  deps: GitHubIntegrationDependencies,
) {
  const response = await githubFetch(
    deps,
    `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/actions/runs?per_page=${MAX_WORKFLOW_RUNS}&page=1`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'SmartFlow-GitHub-App',
      },
    },
  )
  if (!response.ok) throw providerError(response, 'workflow_runs')
  const body = await providerJson<{ workflow_runs?: unknown }>(response)
  if (!Array.isArray(body.workflow_runs)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned an invalid workflow runs response.')
  }
  const repoLabel = `${repo.owner}/${repo.name}`
  const sanitized = body.workflow_runs
    .filter((item): item is GitHubWorkflowRunResponse => Boolean(item) && typeof item === 'object')
    .map((item) => sanitizeWorkflowRun(repoLabel, item))
  if (sanitized.some((item) => !item)) {
    throw new GitHubIntegrationError('GITHUB_RESPONSE_INVALID', 502, 'GitHub returned invalid workflow run metadata.')
  }
  return sanitized.filter((item): item is NonNullable<typeof item> => Boolean(item))
}

async function listWorkflowRuns(
  request: Request,
  config: GitHubConfig,
  deps: GitHubIntegrationDependencies,
) {
  const { userId, authorization } = await requireUser(request, config, deps)
  const connection = await loadConnection(userId, authorization, config, deps)
  const installationId = positiveInteger(connection.installation_id)
  if (!installationId) {
    throw new GitHubIntegrationError('CONNECTION_RECORD_INVALID', 500, 'Verified connection metadata is invalid.')
  }
  const token = await installationToken(installationId, config, deps)
  const repositories = await scanRepositoriesForFanout(token, deps, MAX_REPOS_SCANNED_FOR_FANOUT)

  const perRepositoryRuns = await Promise.all(
    repositories.map((repo) => listWorkflowRunsForRepository(repo, token, deps)),
  )

  // "Is the latest build green" is meaningless in repo-scan order, unlike
  // issues/pulls — callers need the genuinely most-recent runs across all
  // scanned repos, not the first repo's runs padded out with others. Sort by
  // updatedAt (ISO 8601 strings sort lexicographically the same as
  // chronologically) before capping so the final slice reflects true recency.
  return {
    workflowRuns: perRepositoryRuns
      .flat()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, MAX_WORKFLOW_RUNS),
  }
}

async function connectionStatus(
  request: Request,
  config: GitHubBaseConfig,
  deps: GitHubIntegrationDependencies,
) {
  const { authorization } = await requireUser(request, config, deps)
  const response = await userDatabaseRequest(
    config,
    deps,
    authorization,
    'github_connections?select=github_account_login,status,verified_at&limit=1',
  )
  const rows = await response.json() as Array<Record<string, unknown>>
  if (!Array.isArray(rows) || rows.length === 0) {
    return { connected: false, status: 'not_connected', reconnectRequired: false }
  }
  const row = rows[0]
  const status = row.status === 'connected' ? 'connected' : row.status === 'revoked' ? 'reconnect_required' : undefined
  if (!status) {
    throw new GitHubIntegrationError('CONNECTION_RECORD_INVALID', 500, 'Connection status is invalid.')
  }
  const accountLabel = boundedString(row.github_account_login, 100)
  const connectedAt = boundedString(row.verified_at, 64)
  return {
    connected: status === 'connected',
    ...(accountLabel ? { accountLabel } : {}),
    status,
    ...(connectedAt ? { connectedAt } : {}),
    reconnectRequired: status === 'reconnect_required',
  }
}

// Cheap DB-only read for reasoning-context disambiguation -- never mints a
// token or calls GitHub. "unknown" covers both "never connected" and
// "connected but github.repositories.list has not run yet since the cache
// columns were added" -- deliberately not distinguished from "no repos",
// since neither means the same thing to a caller deciding how to use this.
async function repositoryInventory(
  request: Request,
  config: GitHubBaseConfig,
  deps: GitHubIntegrationDependencies,
): Promise<{ status: 'unknown' } | { status: 'known'; names: string[] }> {
  const { authorization } = await requireUser(request, config, deps)
  const response = await userDatabaseRequest(
    config,
    deps,
    authorization,
    'github_connections?select=status,repository_names_cache&limit=1',
  )
  const rows = await response.json() as Array<Record<string, unknown>>
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row || row.status !== 'connected' || !Array.isArray(row.repository_names_cache)) {
    return { status: 'unknown' }
  }
  const names = row.repository_names_cache
    .filter((item): item is string => typeof item === 'string')
    .map((item) => boundedString(item, 200))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_CACHED_REPOSITORY_NAMES)
  return { status: 'known', names }
}

async function disconnect(
  request: Request,
  config: GitHubBaseConfig,
  deps: GitHubIntegrationDependencies,
) {
  const { userId } = await requireUser(request, config, deps)
  await databaseRequest(config, deps, `github_connections?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' })
  return { connected: false, appUninstalled: false }
}

export async function handleGitHubIntegrationRequest(
  request: Request,
  env: Env,
  dependencies: Partial<GitHubIntegrationDependencies> = {},
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/github/')) return null
  const origin = request.headers.get('Origin') ?? ''
  let baseConfig: GitHubBaseConfig | undefined
  try {
    baseConfig = resolveBaseConfig(env)
    if (origin && !baseConfig.allowedOrigins.has(origin)) {
      throw new GitHubIntegrationError('ORIGIN_DENIED', 403, 'Request origin is not allowed.')
    }
    const deps = { ...defaultDependencies, ...dependencies }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, baseConfig) })
    }
    if (url.pathname === '/github/connection' && request.method === 'GET') {
      return json(await connectionStatus(request, baseConfig, deps), 200, origin, baseConfig)
    }
    if (url.pathname === '/github/repository-inventory' && request.method === 'GET') {
      return json(await repositoryInventory(request, baseConfig, deps), 200, origin, baseConfig)
    }
    if (url.pathname === '/github/disconnect' && request.method === 'POST') {
      return json(await disconnect(request, baseConfig, deps), 200, origin, baseConfig)
    }
    if (url.pathname === '/github/connect/start' && request.method === 'POST') {
      const { userId } = await requireUser(request, baseConfig, deps)
      const config = resolveConfig(env)
      return json(await startConnection(userId, config, deps), 200, origin, config)
    }
    const config = resolveConfig(env)
    if (url.pathname === '/github/connect/setup' && request.method === 'GET') {
      return await handleSetup(request, config, deps)
    }
    if (url.pathname === '/github/connect/callback' && request.method === 'GET') {
      return await handleCallback(request, config, deps)
    }
    if (url.pathname === '/github/repositories' && request.method === 'GET') {
      return json(await listRepositories(request, config, deps), 200, origin, config)
    }
    if (url.pathname === '/github/issues' && request.method === 'GET') {
      return json(await listIssues(request, config, deps), 200, origin, config)
    }
    if (url.pathname === '/github/epics' && request.method === 'GET') {
      return json(await listEpics(request, config, deps), 200, origin, config)
    }
    if (url.pathname === '/github/pulls' && request.method === 'GET') {
      return json(await listPullRequests(request, config, deps), 200, origin, config)
    }
    if (url.pathname === '/github/workflow_runs' && request.method === 'GET') {
      return json(await listWorkflowRuns(request, config, deps), 200, origin, config)
    }
    if (
      url.pathname === '/github/connect/start' ||
      url.pathname === '/github/connect/setup' ||
      url.pathname === '/github/connect/callback' ||
      url.pathname === '/github/repositories' ||
      url.pathname === '/github/issues' ||
      url.pathname === '/github/epics' ||
      url.pathname === '/github/pulls' ||
      url.pathname === '/github/workflow_runs' ||
      url.pathname === '/github/disconnect' ||
      url.pathname === '/github/connection' ||
      url.pathname === '/github/repository-inventory'
    ) {
      return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } }, 405, origin, config)
    }
    return json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404, origin, config)
  } catch (error) {
    return safeErrorResponse(error, origin, baseConfig)
  }
}

export const githubIntegrationInternals = {
  GITHUB_API_ORIGIN,
  GITHUB_AUTH_ORIGIN,
  MAX_REPOSITORIES,
  MAX_ISSUES,
  MAX_EPICS,
  MAX_PULL_REQUESTS,
  MAX_WORKFLOW_RUNS,
  MAX_REPOS_SCANNED_FOR_FANOUT,
  MAX_CACHED_REPOSITORY_NAMES,
  CONNECT_ATTEMPT_TTL_MS,
  resolveBaseConfig,
  resolveConfig,
  sanitizeRepository,
  sanitizeIssue,
  sanitizeEpicBase,
  sanitizePullRequest,
  sanitizeWorkflowRun,
}
