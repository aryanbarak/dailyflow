// SmartFlow -- Inferred Project Context Layer (ADR-0009).
//
// POST /projects/context-derivation -- an authenticated, production-capable
// Worker route (unlike /agent/reason, this is NOT local-qa-only: it mirrors
// the same production auth pattern index.ts's requireAuth already uses for
// /chat, /generate, and the suggestion endpoints, since ADR-0009 does not
// restrict Context Derivation to local QA the way ADR-0003 restricts
// /agent/reason).
//
// Every Supabase call in this file forwards the REQUESTING USER's own JWT
// (never SUPABASE_SERVICE_KEY) as the Authorization header -- deliberately
// different from this Worker's OTHER REST helpers (context-builder.ts's
// supabaseGet/supabasePost/supabasePatch, which are service-role by
// convention for backend-owned tables like agent_briefings/user_context).
// This route's target tables (project_records, project_evidence,
// project_evidence_observations, inferred_project_context_fields,
// inferred_context_derivation_runs) are Project Domain tables whose
// established, repeatedly-stated convention throughout this codebase is
// "the trusted authenticated owner is resolved from the Supabase Auth
// session ... never accepted from caller input ... service-role identity
// [is] never used as the user." create_inferred_context_field's own
// auth.uid() resolution technically depends on this: auth.uid() only
// resolves to the real user when PostgREST processes the request with that
// user's own JWT, not a service-role key.
//
// This module cannot import src/features/projects/* (agent/worker is a
// separate, zero-runtime-dependency deployable unit -- see its package.json
// and every other file in this directory). The content-fingerprint
// algorithm and the closed kind/confidence/status vocabularies are
// therefore intentionally duplicated here, not imported, and must be kept
// manually in sync with
// src/features/projects/inferredProjectContextFieldTypes.ts and
// inferredProjectContextFieldValidation.ts if either changes -- flagged as
// a known maintenance cost, not a hidden one. This sync is no longer
// merely a comment's promise: review finding F2
// (docs/reviews/2026-08-inferred-context-layer-review.md, MAJOR #4) found
// this module's date-shaped-field validation (since/completedAt/decidedAt)
// had silently drifted from the canonical TS validator (a bounded-string
// check here vs. a Date.parse check there). The standing guard against
// that recurring is
// src/features/projects/contextDerivationValidationEquivalence.test.ts,
// which runs the SAME fixture set through this module's normalizeCandidate
// and the TS module's validateInferredFieldContent and asserts identical
// accept/reject outcomes for every kind -- run it after editing either
// this file's normalizeCandidate or inferredProjectContextFieldValidation.ts.

const CONTEXT_FIELD_KINDS = ['objective', 'milestone', 'decision', 'risk', 'capability', 'candidate_action'] as const
type ContextFieldKind = typeof CONTEXT_FIELD_KINDS[number]
const CONFIDENCE_VALUES = ['low', 'medium', 'high'] as const
type Confidence = typeof CONFIDENCE_VALUES[number]

const MAX_EVIDENCE_ITEMS_PER_RUN = 12
const MAX_EVIDENCE_TEXT_CHARS_PER_ITEM = 4000
const MAX_CANDIDATES_PER_RUN = 12
const DERIVATION_VERSION = 'context-derivation-v1'
const MAX_BODY_BYTES = 4 * 1024

export interface ContextDerivationEnv {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

export interface ContextDerivationDependencies {
  fetcher?: typeof fetch
  now?: () => string
  logger?: Pick<Console, 'info' | 'error'>
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function jsonResponse(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } })
}

// Task 14 fix: optional extra fields (providerStatus/providerDetail) on the
// error body -- mirrors personal-memory-extraction-endpoint.ts's identical
// fix. Safe to expose here specifically because this whole route requires a
// valid Supabase bearer token (authenticateUser below) -- nobody but the
// authenticated owner's own browser ever sees this response.
function errorResponse(code: string, message: string, status: number, origin: string, extra?: Record<string, unknown>): Response {
  return jsonResponse({ error: { code, message, ...extra } }, status, origin)
}

// Task 14 fix: same taxonomy and same ProviderCallError shape as
// personal-memory-extraction-endpoint.ts's identical fix (see that file's
// own comments for the full rationale) -- this module cannot import that
// one (agent/worker's own zero-cross-import convention, see file header),
// so it is duplicated here rather than shared.
type ProviderFailureTaxonomy = 'PROVIDER_REQUEST_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'MODEL_OUTPUT_UNUSABLE'

class ProviderCallError extends Error {
  constructor(
    message: string,
    readonly taxonomy: ProviderFailureTaxonomy,
    readonly providerStatus?: number,
    readonly providerDetail?: string,
  ) {
    super(message)
    this.name = 'ProviderCallError'
  }
}

const DERIVATION_TAXONOMY_MESSAGES: Record<ProviderFailureTaxonomy, string> = {
  PROVIDER_REQUEST_REJECTED: 'The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your data.',
  PROVIDER_UNAVAILABLE: 'The AI model is temporarily unavailable. Please try again in a moment.',
  MODEL_OUTPUT_UNUSABLE: 'The model did not return a usable derivation. Please try again.',
}

// Task 14 fix: bounded, single-line truncation -- mirrors
// personal-memory-extraction-endpoint.ts's identical helper.
function truncateForLog(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}...` : collapsed
}

/** Mirrors index.ts's own requireAuth exactly (Bearer token -> /auth/v1/user) -- each Worker module in this codebase defines its own small copy rather than importing across modules (github-integration.ts and reasoning-endpoint.ts already follow this same convention). */
async function authenticateUser(
  request: Request,
  env: ContextDerivationEnv,
  fetcher: typeof fetch,
): Promise<{ userId: string; jwt: string } | null> {
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) return null
  const jwt = authorization.slice(7)

  const response = await fetcher(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY },
  })
  if (!response.ok) return null
  const user = (await response.json()) as { id?: unknown }
  if (typeof user.id !== 'string' || !user.id) return null
  return { userId: user.id, jwt }
}

function resolveConfig(env: ContextDerivationEnv): { ready: true } | { ready: false; message: string } {
  if (!env.SUPABASE_URL?.trim()) return { ready: false, message: 'SUPABASE_URL is required.' }
  if (!env.SUPABASE_ANON_KEY?.trim()) return { ready: false, message: 'SUPABASE_ANON_KEY is required.' }
  if (!env.GEMINI_API_KEY?.trim()) return { ready: false, message: 'GEMINI_API_KEY is required.' }
  if (!env.GEMINI_MODEL?.trim()) return { ready: false, message: 'GEMINI_MODEL is required.' }
  return { ready: true }
}

// ---------------------------------------------------------------------------
// User-JWT-scoped Supabase REST helpers -- see file header for why these
// forward the user's own JWT rather than SUPABASE_SERVICE_KEY.
// ---------------------------------------------------------------------------

async function restGetAsUser<T>(env: ContextDerivationEnv, jwt: string, path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Supabase REST error (${path}): ${response.status}`)
  return response.json() as Promise<T>
}

async function restPostAsUser<T>(
  env: ContextDerivationEnv,
  jwt: string,
  table: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      apikey: env.SUPABASE_ANON_KEY,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Supabase POST error (${table}): ${response.status} ${text}`)
  }
  const rows = (await response.json()) as T[]
  return rows[0] as T
}

async function restPatchAsUser(
  env: ContextDerivationEnv,
  jwt: string,
  path: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<void> {
  const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      apikey: env.SUPABASE_ANON_KEY,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Supabase PATCH error (${path}): ${response.status} ${text}`)
  }
}

async function rpcAsUser<T>(
  env: ContextDerivationEnv,
  jwt: string,
  functionName: string,
  params: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify(params),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`RPC error (${functionName}): ${text}`)
  return (text ? JSON.parse(text) : null) as T
}

// ---------------------------------------------------------------------------
// Evidence read (project-evidence-acquisition.md section 22: reads only
// already-persisted evidence, never a live source or provider).
// ---------------------------------------------------------------------------

interface EvidenceRow {
  id: string
  source_kind: string
  classification: string
  title: string
  reference: string
  collected_at: string
  supersedes_id: string | null
}

interface ObservationRow {
  evidence_id: string
  text_content: string
}

interface EvidenceItemForPrompt {
  id: string
  sourceKind: string
  title: string
  reference: string
  text: string
}

async function readEligibleEvidence(
  env: ContextDerivationEnv,
  jwt: string,
  projectId: string,
  fetcher: typeof fetch,
): Promise<EvidenceItemForPrompt[]> {
  const evidenceRows = await restGetAsUser<EvidenceRow[]>(
    env,
    jwt,
    `project_evidence?project_id=eq.${encodeURIComponent(projectId)}&select=id,source_kind,classification,title,reference,collected_at,supersedes_id&order=collected_at.desc`,
    fetcher,
  )
  // Exclude any item another selected item's supersedes_id points at --
  // the same exclusion rule evidenceSnapshotBuilder.ts already applies,
  // reimplemented here at the same "simple filter over already-scoped rows"
  // level of rigor (this route does not need that module's deterministic
  // ordering/hash machinery, only its exclusion semantics).
  const supersededIds = new Set(evidenceRows.map((row) => row.supersedes_id).filter((id): id is string => Boolean(id)))
  const active = evidenceRows.filter((row) => !supersededIds.has(row.id)).slice(0, MAX_EVIDENCE_ITEMS_PER_RUN)
  if (active.length === 0) return []

  const evidenceIds = active.map((row) => row.id)
  const observationRows = await restGetAsUser<ObservationRow[]>(
    env,
    jwt,
    `project_evidence_observations?evidence_id=in.(${evidenceIds.map(encodeURIComponent).join(',')})&select=evidence_id,text_content`,
    fetcher,
  )
  const textByEvidenceId = new Map(observationRows.map((row) => [row.evidence_id, row.text_content]))

  return active
    .filter((row) => textByEvidenceId.has(row.id))
    .map((row) => ({
      id: row.id,
      sourceKind: row.source_kind,
      title: row.title,
      reference: row.reference,
      text: (textByEvidenceId.get(row.id) ?? '').slice(0, MAX_EVIDENCE_TEXT_CHARS_PER_ITEM),
    }))
}

// ---------------------------------------------------------------------------
// Prompt + Gemini structured-output schema
// ---------------------------------------------------------------------------

export function buildDerivationSystemInstruction(): string {
  return [
    'You derive candidate ProjectContext facts from already-collected project evidence documents.',
    'Return exactly one JSON object and no prose.',
    'Every candidate MUST cite at least one sourceEvidenceIds value from the evidence provided -- never invent an id.',
    'Only propose a candidate when the evidence text actually supports it -- never guess or extrapolate beyond what is written.',
    'You never execute, approve, authorize, or claim completion of any action.',
    'At most one candidate of kind "objective" and at most one of kind "milestone" should have status "active" -- if the evidence is ambiguous about which is current, omit status "active" for that kind rather than guessing.',
  ].join(' ')
}

export function buildDerivationPrompt(projectName: string, evidence: readonly EvidenceItemForPrompt[]): string {
  const evidenceBlocks = evidence
    .map((item) => `[evidence_id=${item.id}] (${item.sourceKind}, ${item.reference})\n${item.text}`)
    .join('\n\n---\n\n')
  return `Project: ${projectName}\n\nEvidence:\n\n${evidenceBlocks}`
}

export function buildDerivationResponseSchema() {
  return {
    type: 'OBJECT',
    required: ['candidates'],
    properties: {
      // Task 14 fix: NO maxItems here -- the identical bug diagnosed and
      // fixed in personal-memory-extraction-endpoint.ts's own
      // buildExtractionResponseSchema (see that file's comment for the
      // full reproduction/bisection against the real provider). This
      // route's schema has the exact same shape (an outer array bounded by
      // MAX_CANDIDATES_PER_RUN, nested with an already-bounded inner array,
      // sourceEvidenceIds) that the provider rejects as "too many states
      // for serving". The invariant now lives in code (see the .slice call
      // after parsing the model's response), not in the schema.
      candidates: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          required: ['kind', 'content', 'confidence', 'sourceEvidenceIds'],
          properties: {
            kind: { type: 'STRING', enum: [...CONTEXT_FIELD_KINDS] },
            confidence: { type: 'STRING', enum: [...CONFIDENCE_VALUES] },
            sourceEvidenceIds: { type: 'ARRAY', minItems: 1, maxItems: 20, items: { type: 'STRING' } },
            content: {
              type: 'OBJECT',
              properties: {
                summary: { type: 'STRING' },
                title: { type: 'STRING' },
                status: { type: 'STRING' },
                severity: { type: 'STRING' },
                notes: { type: 'STRING' },
                rationale: { type: 'STRING' },
                since: { type: 'STRING' },
                decidedAt: { type: 'STRING' },
                completedAt: { type: 'STRING' },
                order: { type: 'INTEGER' },
              },
            },
          },
        },
      },
    },
  }
}

// Task 14 fix (provider error transparency): REDACTION GUARD -- mirrors
// personal-memory-extraction-endpoint.ts's own callGeminiForExtraction
// exactly. Never logs modelUrl.toString() or response.url (both carry
// GEMINI_API_KEY as a query param); every log line uses only
// modelUrl.pathname. The provider's own diagnostic is otherwise logged in
// full server-side.
async function callGeminiForDerivation(
  prompt: string,
  env: ContextDerivationEnv,
  fetcher: typeof fetch,
  logger: Pick<Console, 'info' | 'error'>,
): Promise<{ raw: unknown; promptTokenCount?: number; responseTokenCount?: number }> {
  const modelUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL ?? '')}:generateContent`)
  modelUrl.searchParams.set('key', env.GEMINI_API_KEY ?? '')

  let response: Response
  try {
    response = await fetcher(modelUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildDerivationSystemInstruction() }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: buildDerivationResponseSchema(),
        },
      }),
    })
  } catch (networkError) {
    logger.error?.(`[ContextDerivation] provider call failed before any response (network): path=${modelUrl.pathname} error=${(networkError as Error).message}`)
    throw new ProviderCallError('The AI model provider could not be reached.', 'PROVIDER_UNAVAILABLE')
  }

  if (!response.ok) {
    const bodyText = await response.text()
    let providerError: { status?: unknown; message?: unknown; details?: unknown } | undefined
    try {
      providerError = (JSON.parse(bodyText) as { error?: typeof providerError }).error
    } catch {
      // Not JSON -- providerError stays undefined, bodyText itself is still used below.
    }
    const providerMessage = typeof providerError?.message === 'string' ? providerError.message : bodyText
    logger.error?.(
      `[ContextDerivation] provider rejected request: path=${modelUrl.pathname} httpStatus=${response.status} ` +
        `providerStatus=${String(providerError?.status ?? 'unknown')} message=${providerMessage} ` +
        `details=${providerError?.details !== undefined ? JSON.stringify(providerError.details) : 'none'}`,
    )
    const taxonomy: ProviderFailureTaxonomy = response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REQUEST_REJECTED'
    throw new ProviderCallError(
      `Model request failed with status ${response.status}.`,
      taxonomy,
      response.status,
      truncateForLog(providerMessage, 300),
    )
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (typeof text !== 'string' || !text.trim()) throw new ProviderCallError('Model returned no derivation content.', 'MODEL_OUTPUT_UNUSABLE')
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    const snippet = truncateForLog(trimmed, 300)
    throw new ProviderCallError(`Model response must be exactly one JSON object. Raw output snippet: "${snippet}"`, 'MODEL_OUTPUT_UNUSABLE', undefined, snippet)
  }
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch (parseError) {
    const snippet = truncateForLog(trimmed, 300)
    throw new ProviderCallError(
      `Model response was not valid JSON (${(parseError as Error).message}). Raw output snippet: "${snippet}"`,
      'MODEL_OUTPUT_UNUSABLE',
      undefined,
      snippet,
    )
  }
  return {
    raw,
    promptTokenCount: data.usageMetadata?.promptTokenCount,
    responseTokenCount: data.usageMetadata?.candidatesTokenCount,
  }
}

// ---------------------------------------------------------------------------
// Deterministic per-candidate validation -- invalid output dropped and
// logged, never coerced (ADR-0009 Decision section 3). Mirrors
// inferredProjectContextFieldValidation.ts's per-kind shape rules; kept in
// sync manually (see file header) and guarded by
// src/features/projects/contextDerivationValidationEquivalence.test.ts.
// ---------------------------------------------------------------------------

const CONTENT_FIELDS_BY_KIND: Record<ContextFieldKind, readonly string[]> = {
  objective: ['summary', 'status', 'since'],
  milestone: ['title', 'status', 'order', 'completedAt'],
  decision: ['title', 'status', 'decidedAt'],
  risk: ['summary', 'severity', 'notes'],
  capability: ['title', 'status', 'notes'],
  candidate_action: ['summary', 'rationale'],
}

export interface ValidCandidate {
  kind: ContextFieldKind
  content: Record<string, unknown>
  confidence: Confidence
  sourceEvidenceIds: string[]
}

function isBoundedString(value: unknown, maxLength = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
}

/**
 * Review finding F2 (docs/reviews/2026-08-inferred-context-layer-review.md,
 * MAJOR #4): must stay behaviorally identical to the canonical TS module's
 * optionalIsoTimestamp (inferredProjectContextFieldValidation.ts) --
 * `Date.parse` success is the ENTIRE rule there (no trim, no length bound;
 * an invalid date string cannot be a long string anyway). Equivalence is
 * enforced by contextDerivationValidationEquivalence.test.ts, which runs
 * the identical fixture set through both this function and the TS
 * validator and asserts identical accept/reject outcomes -- keep this
 * function and that module's optionalIsoTimestamp in lockstep; a change to
 * either without updating the other fails that test.
 */
function isValidTimestampString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

export function normalizeCandidate(raw: unknown, validEvidenceIds: ReadonlySet<string>): ValidCandidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  const kind = record.kind
  if (typeof kind !== 'string' || !(CONTEXT_FIELD_KINDS as readonly string[]).includes(kind)) return null
  const confidence = record.confidence
  if (typeof confidence !== 'string' || !(CONFIDENCE_VALUES as readonly string[]).includes(confidence)) return null

  const sourceEvidenceIdsRaw = record.sourceEvidenceIds
  if (!Array.isArray(sourceEvidenceIdsRaw) || sourceEvidenceIdsRaw.length === 0) return null
  const sourceEvidenceIds = sourceEvidenceIdsRaw.filter((id): id is string => typeof id === 'string' && validEvidenceIds.has(id))
  // Every cited id must be real and in-scope -- a model that invents an id
  // or cites one outside this run's evidence set produces a dropped
  // candidate, never a partially-trusted one.
  if (sourceEvidenceIds.length !== sourceEvidenceIdsRaw.length || sourceEvidenceIds.length === 0) return null

  const rawContent = record.content
  if (!rawContent || typeof rawContent !== 'object' || Array.isArray(rawContent)) return null
  const contentRecord = rawContent as Record<string, unknown>
  const allowedFields = CONTENT_FIELDS_BY_KIND[kind as ContextFieldKind]
  if (Object.keys(contentRecord).some((key) => contentRecord[key] !== undefined && !allowedFields.includes(key))) return null

  const content: Record<string, unknown> = {}
  if (kind === 'objective' || kind === 'risk' || kind === 'candidate_action') {
    if (!isBoundedString(contentRecord.summary)) return null
    content.summary = (contentRecord.summary as string).trim()
  }
  if (kind === 'milestone' || kind === 'decision' || kind === 'capability') {
    if (!isBoundedString(contentRecord.title)) return null
    content.title = (contentRecord.title as string).trim()
  }
  if (kind === 'objective') {
    if (!isBoundedString(contentRecord.status, 20) || !['active', 'achieved', 'abandoned', 'superseded'].includes(contentRecord.status as string)) return null
    content.status = contentRecord.status
    if (contentRecord.since !== undefined) {
      if (!isValidTimestampString(contentRecord.since)) return null
      content.since = contentRecord.since
    }
  }
  if (kind === 'milestone') {
    if (!isBoundedString(contentRecord.status, 20) || !['planned', 'active', 'completed', 'deferred', 'blocked'].includes(contentRecord.status as string)) return null
    content.status = contentRecord.status
    if (contentRecord.order !== undefined) {
      if (typeof contentRecord.order !== 'number' || !Number.isFinite(contentRecord.order)) return null
      content.order = contentRecord.order
    }
    if (contentRecord.completedAt !== undefined) {
      if (!isValidTimestampString(contentRecord.completedAt)) return null
      content.completedAt = contentRecord.completedAt
    }
  }
  if (kind === 'decision') {
    if (!isBoundedString(contentRecord.status, 20) || !['accepted', 'proposed', 'superseded', 'rejected'].includes(contentRecord.status as string)) return null
    content.status = contentRecord.status
    if (contentRecord.decidedAt !== undefined) {
      if (!isValidTimestampString(contentRecord.decidedAt)) return null
      content.decidedAt = contentRecord.decidedAt
    }
  }
  if (kind === 'risk') {
    if (!isBoundedString(contentRecord.severity, 10) || !['low', 'medium', 'high'].includes(contentRecord.severity as string)) return null
    content.severity = contentRecord.severity
    if (contentRecord.notes !== undefined) {
      if (!isBoundedString(contentRecord.notes, 1000)) return null
      content.notes = contentRecord.notes
    }
  }
  if (kind === 'capability') {
    if (!isBoundedString(contentRecord.status, 25) || !['implemented', 'partially_implemented', 'planned', 'deferred', 'unsupported'].includes(contentRecord.status as string)) return null
    content.status = contentRecord.status
    if (contentRecord.notes !== undefined) {
      if (!isBoundedString(contentRecord.notes, 1000)) return null
      content.notes = contentRecord.notes
    }
  }
  if (kind === 'candidate_action' && contentRecord.rationale !== undefined) {
    if (!isBoundedString(contentRecord.rationale, 1000)) return null
    content.rationale = contentRecord.rationale
  }

  return { kind: kind as ContextFieldKind, content, confidence: confidence as Confidence, sourceEvidenceIds }
}

/** Mirrors src/features/projects/inferredProjectContextFieldValidation.ts's computeInferredFieldContentFingerprint exactly -- see file header for the manual-sync note. */
async function computeContentFingerprint(kind: ContextFieldKind, content: Record<string, unknown>): Promise<string> {
  const sortedKeys = Object.keys(content).sort()
  const canonical: Record<string, unknown> = {}
  for (const key of sortedKeys) canonical[key] = content[key]
  const text = `${kind}::${JSON.stringify(canonical)}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleContextDerivationRequest(
  request: Request,
  env: ContextDerivationEnv,
  dependencies: ContextDerivationDependencies = {},
): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported.', 405, origin)

  const fetcher = dependencies.fetcher ?? globalThis.fetch
  const now = dependencies.now ?? (() => new Date().toISOString())
  const logger = dependencies.logger ?? console

  const config = resolveConfig(env)
  if (config.ready === false) return errorResponse('CONFIGURATION_MISSING', config.message, 503, origin)

  const authResult = await authenticateUser(request, env, fetcher).catch(() => null)
  if (!authResult) return errorResponse('UNAUTHORIZED', 'A valid Supabase bearer token is required.', 401, origin)
  const { userId, jwt } = authResult

  const declaredLength = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse('REQUEST_TOO_LARGE', 'Request body is too large.', 413, origin)
  }
  let body: unknown
  try {
    body = JSON.parse(await request.text())
  } catch {
    return errorResponse('INVALID_JSON', 'Request body must contain valid JSON.', 400, origin)
  }
  const projectId = (body as { projectId?: unknown } | null)?.projectId
  if (typeof projectId !== 'string' || !projectId) {
    return errorResponse('INVALID_REQUEST', 'projectId is required.', 400, origin)
  }

  // Project read: RLS (forwarded JWT) already scopes this to the caller's
  // own project -- a project owned by someone else, or a nonexistent one,
  // both simply return zero rows here.
  let projectRows: Array<{ id: string; name: string; status: string }>
  try {
    projectRows = await restGetAsUser(env, jwt, `project_records?id=eq.${encodeURIComponent(projectId)}&select=id,name,status`, fetcher)
  } catch (error) {
    logger.error?.(`[ContextDerivation] project read failed: ${(error as Error).message}`)
    return errorResponse('PROJECT_READ_FAILED', 'Unable to read the project.', 502, origin)
  }
  const project = projectRows[0]
  if (!project) return errorResponse('PROJECT_NOT_FOUND', 'Project was not found for this user.', 404, origin)
  if (project.status === 'archived') return errorResponse('PROJECT_ARCHIVED', 'Cannot derive context for an archived project.', 409, origin)

  // ADR-0009 Q4 (Product Owner resolution): no minimum evidence threshold
  // beyond "at least one active observation" -- structural validation, not
  // input counting, controls quality from here on.
  let evidence: EvidenceItemForPrompt[]
  try {
    evidence = await readEligibleEvidence(env, jwt, projectId, fetcher)
  } catch (error) {
    logger.error?.(`[ContextDerivation] evidence read failed: ${(error as Error).message}`)
    return errorResponse('EVIDENCE_READ_FAILED', 'Unable to read project evidence.', 502, origin)
  }
  if (evidence.length === 0) {
    return errorResponse('NO_ELIGIBLE_EVIDENCE', 'This project has no active evidence to derive context from yet.', 422, origin)
  }
  const validEvidenceIds = new Set(evidence.map((item) => item.id))

  const startedAt = now()
  let run: { id: string }
  try {
    run = await restPostAsUser(
      env,
      jwt,
      'inferred_context_derivation_runs',
      { user_id: userId, project_id: projectId, model_identity: env.GEMINI_MODEL, derivation_version: DERIVATION_VERSION, started_at: startedAt },
      fetcher,
    )
  } catch (error) {
    logger.error?.(`[ContextDerivation] run creation failed: ${(error as Error).message}`)
    return errorResponse('RUN_CREATE_FAILED', 'Unable to start a derivation run.', 502, origin)
  }

  const prompt = buildDerivationPrompt(project.name, evidence)
  let modelOutput: { raw: unknown; promptTokenCount?: number; responseTokenCount?: number }
  try {
    modelOutput = await callGeminiForDerivation(prompt, env, fetcher, logger)
  } catch (error) {
    // Task 14 fix: mirrors personal-memory-extraction-endpoint.ts's
    // identical fix -- taxonomy-tagged failure instead of the old generic
    // MODEL_CALL_FAILED for every case indiscriminately.
    const providerError = error instanceof ProviderCallError ? error : null
    const taxonomy: ProviderFailureTaxonomy = providerError?.taxonomy ?? 'MODEL_OUTPUT_UNUSABLE'
    const failureReason = truncateForLog((error as Error).message, 500)
    await restPatchAsUser(env, jwt, `inferred_context_derivation_runs?id=eq.${run.id}`, {
      completed_at: now(),
      outcome: 'failed',
      failure_reason: failureReason,
    }, fetcher).catch(() => undefined)
    logger.error?.(`[ContextDerivation] model call failed: taxonomy=${taxonomy} ${(error as Error).message}`)
    return errorResponse(taxonomy, DERIVATION_TAXONOMY_MESSAGES[taxonomy], 502, origin, {
      providerStatus: providerError?.providerStatus,
      providerDetail: providerError?.providerDetail,
    })
  }

  // Task 14 fix: MAX_CANDIDATES_PER_RUN is now enforced here, in code, not
  // via the response schema's own maxItems (see buildDerivationResponseSchema's
  // own comment).
  const rawCandidates = (Array.isArray((modelOutput.raw as { candidates?: unknown })?.candidates)
    ? ((modelOutput.raw as { candidates: unknown[] }).candidates)
    : []
  ).slice(0, MAX_CANDIDATES_PER_RUN)
  const normalized = rawCandidates.map((candidate) => normalizeCandidate(candidate, validEvidenceIds))
  const validCandidates = normalized.filter((candidate): candidate is ValidCandidate => candidate !== null)
  const droppedCount = normalized.length - validCandidates.length

  let acceptedCount = 0
  const results: Array<{ kind: string; outcome: string }> = []
  for (const candidate of validCandidates) {
    try {
      const fingerprint = await computeContentFingerprint(candidate.kind, candidate.content)
      const outcome = await rpcAsUser<{ outcome: 'created' | 'duplicate_suppressed' }>(
        env,
        jwt,
        'create_inferred_context_field',
        {
          p_project_id: projectId,
          p_run_id: run.id,
          p_kind: candidate.kind,
          p_content: candidate.content,
          p_source_evidence_ids: candidate.sourceEvidenceIds,
          p_model_identity: env.GEMINI_MODEL,
          p_derivation_version: DERIVATION_VERSION,
          p_confidence: candidate.confidence,
          p_content_fingerprint: fingerprint,
        },
        fetcher,
      )
      if (outcome.outcome === 'created') acceptedCount += 1
      results.push({ kind: candidate.kind, outcome: outcome.outcome })
    } catch (error) {
      logger.error?.(`[ContextDerivation] field persistence failed: ${(error as Error).message}`)
      results.push({ kind: candidate.kind, outcome: 'persistence_failed' })
    }
  }

  const completedAt = now()
  await restPatchAsUser(
    env,
    jwt,
    `inferred_context_derivation_runs?id=eq.${run.id}`,
    {
      completed_at: completedAt,
      prompt_token_count: modelOutput.promptTokenCount ?? null,
      response_token_count: modelOutput.responseTokenCount ?? null,
      candidate_count: rawCandidates.length,
      accepted_count: acceptedCount,
      dropped_count: droppedCount,
      outcome: 'completed',
    },
    fetcher,
  ).catch((error) => logger.error?.(`[ContextDerivation] run completion update failed: ${(error as Error).message}`))

  logger.info?.(
    `[ContextDerivation] projectId=${projectId} runId=${run.id} candidates=${rawCandidates.length} accepted=${acceptedCount} dropped=${droppedCount}`,
  )

  return jsonResponse(
    {
      runId: run.id,
      startedAt,
      completedAt,
      evidenceCount: evidence.length,
      candidateCount: rawCandidates.length,
      acceptedCount,
      droppedCount,
      results,
    },
    200,
    origin,
  )
}
