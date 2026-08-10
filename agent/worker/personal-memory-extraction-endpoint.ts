// SmartFlow -- Personal Memory Layer (ADR-0010).
//
// POST /personal-memory/extraction -- an authenticated, production-capable
// Worker route mirroring agent/worker/context-derivation-endpoint.ts's
// structure and posture almost exactly (ADR-0010 Decision section 4 cites
// that route's posture directly): every Supabase call forwards the
// REQUESTING USER's own JWT (never SUPABASE_SERVICE_KEY), so
// auth.uid() inside create_personal_memory_record resolves to the real
// user, not a service-role identity.
//
// ADR-0010 Product Owner Resolution Q4: EXPLICIT USER TRIGGER ONLY. This
// route is only ever called in response to an explicit user action -- it
// is never invoked automatically from /chat or briefing generation the way
// the legacy extractAndSaveMemory/extractAndSaveMemoryFromChat were
// (ENABLE_AUTO_MEMORY_WRITE, now disabled -- see index.ts).
//
// This module cannot import src/features/personal-memory/* (agent/worker is
// a separate, zero-runtime-dependency deployable unit). The content-
// fingerprint algorithm, the closed kind/confidence vocabularies, and the
// sensitive-content defense-in-depth heuristic are therefore intentionally
// duplicated here, not imported, and must be kept manually in sync with
// src/features/personal-memory/personalMemoryRecordTypes.ts and
// personalMemoryRecordValidation.ts if either changes -- flagged as a known
// maintenance cost, exactly as context-derivation-endpoint.ts's own header
// comment already documents for its own equivalent duplication. Guarded by
// src/features/personal-memory/personalMemoryValidationEquivalence.test.ts.

const PERSONAL_MEMORY_RECORD_KINDS = ['preference', 'goal', 'working_pattern', 'commitment', 'personal_fact', 'skill'] as const
type PersonalMemoryRecordKind = typeof PERSONAL_MEMORY_RECORD_KINDS[number]
const CONFIDENCE_VALUES = ['low', 'medium', 'high'] as const
type Confidence = typeof CONFIDENCE_VALUES[number]
// Task 16 (Document-Sourced Memory, slice 1) added 'document' -- a run's
// source material is either chat+briefing (the original, default path) OR
// a single document's chunks (when the request body names a documentId),
// never both in the same run. See readEligibleSourceMaterialFromDocument
// below and this file's own route handler for the branch.
const PROVENANCE_SOURCE_KINDS = ['chat_turn', 'briefing', 'document'] as const
type ProvenanceSourceKind = typeof PROVENANCE_SOURCE_KINDS[number]

const MAX_CHAT_MESSAGES_PER_RUN = 20
const MAX_MESSAGE_TEXT_CHARS = 2000
const MAX_DOCUMENT_CHUNKS_PER_RUN = 20 // mirrors document_chunks' own MAX_CANDIDATES-adjacent bound in document-memory-extraction-endpoint.ts; a resume rarely produces more sections than this
const MAX_CANDIDATES_PER_RUN = 12
const DERIVATION_VERSION = 'personal-memory-extraction-v1'
const MAX_BODY_BYTES = 1024

export interface PersonalMemoryExtractionEnv {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

export interface PersonalMemoryExtractionDependencies {
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
// error body. Safe to expose here specifically because this whole route
// requires a valid Supabase bearer token (authenticateUser below) --
// nobody but the authenticated owner's own browser ever sees this response.
function errorResponse(code: string, message: string, status: number, origin: string, extra?: Record<string, unknown>): Response {
  return jsonResponse({ error: { code, message, ...extra } }, status, origin)
}

// Task 14 fix: the four-way taxonomy distinguishing WHERE a model-call
// failure actually happened, replacing the single generic MODEL_CALL_FAILED
// this route used to report for every case indiscriminately -- including
// cases where the model was never successfully asked at all (a rejected
// request, or the provider being down), which is not an "unusable
// extraction" in any honest sense. NO_SOURCE_MATERIAL already has its own
// code/calm message (unchanged by this task); the three below cover what
// MODEL_CALL_FAILED used to conflate.
type ProviderFailureTaxonomy = 'PROVIDER_REQUEST_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'MODEL_OUTPUT_UNUSABLE'

// Carries enough structure for the route handler to build BOTH a complete
// server-side log line and a bounded, non-sensitive response body, from a
// single thrown error -- see callGeminiForExtraction's own header comment
// for the redaction rules governing what may end up in providerDetail.
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

// Task 14 fix: one honest, distinct user-facing message per taxonomy bucket
// -- replacing "The model did not return a usable extraction." having been
// shown for a rejected request or a down provider, neither of which is
// true. Kept short and non-alarming; providerDetail (server-validated, see
// errorResponse's own comment) carries the specific diagnostic for anyone
// who needs it.
const EXTRACTION_TAXONOMY_MESSAGES: Record<ProviderFailureTaxonomy, string> = {
  PROVIDER_REQUEST_REJECTED: 'The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your data.',
  PROVIDER_UNAVAILABLE: 'The AI model is temporarily unavailable. Please try again in a moment.',
  MODEL_OUTPUT_UNUSABLE: 'The model did not return a usable extraction. Please try again.',
}

/** Mirrors context-derivation-endpoint.ts's own authenticateUser exactly -- each Worker module in this codebase defines its own small copy rather than importing across modules. */
async function authenticateUser(
  request: Request,
  env: PersonalMemoryExtractionEnv,
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

function resolveConfig(env: PersonalMemoryExtractionEnv): { ready: true } | { ready: false; message: string } {
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

async function restGetAsUser<T>(env: PersonalMemoryExtractionEnv, jwt: string, path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Supabase REST error (${path}): ${response.status}`)
  return response.json() as Promise<T>
}

async function restPostAsUser<T>(
  env: PersonalMemoryExtractionEnv,
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
  env: PersonalMemoryExtractionEnv,
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
  env: PersonalMemoryExtractionEnv,
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
// Source read -- bounded, explicit-trigger-only (ADR-0010 Q4). Reads only
// the user's OWN chat messages (role='user' -- what the user said, never an
// assistant reply) and their latest briefing, never a live source.
// ---------------------------------------------------------------------------

interface ChatMessageRow {
  id: string
  content: string
}

interface BriefingRow {
  id: string
  content: string
}

interface SourceItemForPrompt {
  id: string
  provenanceSourceKind: ProvenanceSourceKind
  text: string
}

async function readEligibleSourceMaterial(
  env: PersonalMemoryExtractionEnv,
  jwt: string,
  fetcher: typeof fetch,
): Promise<SourceItemForPrompt[]> {
  const chatRows = await restGetAsUser<ChatMessageRow[]>(
    env,
    jwt,
    `agent_chat_messages?role=eq.user&select=id,content&order=created_at.desc&limit=${MAX_CHAT_MESSAGES_PER_RUN}`,
    fetcher,
  )
  const briefingRows = await restGetAsUser<BriefingRow[]>(
    env,
    jwt,
    `agent_briefings?select=id,content&order=created_at.desc&limit=1`,
    fetcher,
  )

  const items: SourceItemForPrompt[] = chatRows.map((row) => ({
    id: row.id,
    provenanceSourceKind: 'chat_turn' as const,
    text: row.content.slice(0, MAX_MESSAGE_TEXT_CHARS),
  }))
  if (briefingRows[0]) {
    items.push({ id: briefingRows[0].id, provenanceSourceKind: 'briefing', text: briefingRows[0].content.slice(0, MAX_MESSAGE_TEXT_CHARS) })
  }
  return items
}

interface DocumentChunkRow {
  id: string
  content: string
}

// Task 16 (Document-Sourced Memory, slice 1): the document-sourced
// alternative to readEligibleSourceMaterial above -- same return shape
// (SourceItemForPrompt[]), so every downstream step (buildExtractionPrompt,
// callGeminiForExtraction, normalizeCandidate, the create_personal_memory_record
// persistence loop) needs NO changes at all to also work for this source;
// this is "extend the existing pipeline, do not fork a second one" in its
// most literal form. Forwards the user's own JWT (RLS-scoped to their own
// chunks), consistent with this route's existing posture -- unlike
// document-memory-extraction-endpoint.ts, which uses service role for a
// different, already-documented reason (its writes are service-role-only
// by RLS; this route's reads are not).
async function readEligibleSourceMaterialFromDocument(
  documentId: string,
  env: PersonalMemoryExtractionEnv,
  jwt: string,
  fetcher: typeof fetch,
): Promise<SourceItemForPrompt[]> {
  const chunkRows = await restGetAsUser<DocumentChunkRow[]>(
    env,
    jwt,
    `document_chunks?document_id=eq.${encodeURIComponent(documentId)}&select=id,content&order=chunk_index.asc&limit=${MAX_DOCUMENT_CHUNKS_PER_RUN}`,
    fetcher,
  )
  return chunkRows.map((row) => ({
    id: row.id,
    provenanceSourceKind: 'document' as const,
    text: row.content,
  }))
}

// ---------------------------------------------------------------------------
// Prompt + Gemini structured-output schema
// ---------------------------------------------------------------------------

export function buildExtractionSystemInstruction(): string {
  return [
    'You extract durable, long-term personal facts about a user from their own chat messages and their latest generated briefing.',
    'Return exactly one JSON object and no prose -- no markdown code fences, no explanation before or after the object.',
    'The source material may be written in Persian, German, English, or a mix of these in the same message.',
    'The free-text "summary" field should reflect the user\'s own words and language -- do not translate it.',
    'Every OTHER field -- kind, confidence, provenanceSourceKind, and every structured content field (strength, timeframe, frequency, status, category, level) -- MUST use exactly one of the literal English enum values given in the schema, verbatim, regardless of what language the source material is in. Never translate, localize, or paraphrase these values (for example: "medium", never "متوسط"; "active", never "فعال").',
    'Every candidate MUST cite at least one provenanceSourceRefIds value from the source material provided -- never invent an id.',
    'Only propose a candidate when the source material actually supports it -- never guess or extrapolate.',
    'You MUST NOT extract health information, relationship/family information, or emotional-state information, even if the user discusses it -- these categories are permanently excluded, no matter how clearly stated.',
    'Do not extract specific dates, amounts, or anything framed as "today", "this week", or "this month" -- only stable, durable facts.',
    'You never execute, approve, authorize, or claim completion of any action.',
  ].join(' ')
}

export function buildExtractionPrompt(source: readonly SourceItemForPrompt[]): string {
  const blocks = source
    .map((item) => `[ref_id=${item.id}] (${item.provenanceSourceKind})\n${item.text}`)
    .join('\n\n---\n\n')
  return `Source material:\n\n${blocks}`
}

export function buildExtractionResponseSchema() {
  return {
    type: 'OBJECT',
    required: ['candidates'],
    properties: {
      // Task 14 fix: NO maxItems here -- reproduced against the real
      // provider (see task 14 report) and confirmed this exact bound
      // (MAX_CANDIDATES_PER_RUN=12 on this OUTER array, with an already-
      // bounded ARRAY nested inside each item via provenanceSourceRefIds)
      // is what the provider rejects with "constraint that has too many
      // states for serving" -- its own error names "long array length
      // limits (especially when nested)" as a typical cause, and bisecting
      // confirmed it precisely: the inner array's own bounds
      // (provenanceSourceRefIds, unchanged below) are fine on their own;
      // bounding this outer array on top of that is what breaks. The
      // MAX_CANDIDATES_PER_RUN invariant is NOT relaxed -- it now applies
      // in code (see the .slice call after parsing the model's response),
      // which is more robust anyway: it no longer depends on the
      // provider's internal decoding-complexity budget, which could shift
      // with a future model update.
      candidates: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          required: ['kind', 'content', 'confidence', 'provenanceSourceKind', 'provenanceSourceRefIds'],
          properties: {
            kind: { type: 'STRING', enum: [...PERSONAL_MEMORY_RECORD_KINDS] },
            confidence: { type: 'STRING', enum: [...CONFIDENCE_VALUES] },
            provenanceSourceKind: { type: 'STRING', enum: [...PROVENANCE_SOURCE_KINDS] },
            provenanceSourceRefIds: { type: 'ARRAY', minItems: 1, maxItems: 20, items: { type: 'STRING' } },
            content: {
              type: 'OBJECT',
              properties: {
                summary: { type: 'STRING' },
                // Task 12 fix: constrain every secondary field with the SAME
                // enum values normalizeCandidate ultimately requires
                // (SECONDARY_FIELD_OPTIONS below), instead of leaving them as
                // free STRINGs. Gemini's structured-output mode enforces an
                // `enum` constraint at generation time (constrained
                // decoding), which is a much stronger guarantee against
                // localized/translated values (e.g. "متوسط" instead of
                // "medium") than a prompt instruction alone -- especially
                // with mixed-language source material, where the model is
                // already reasoning across languages.
                strength: { type: 'STRING', enum: [...SECONDARY_FIELD_OPTIONS.strength] },
                timeframe: { type: 'STRING', enum: [...SECONDARY_FIELD_OPTIONS.timeframe] },
                frequency: { type: 'STRING', enum: [...SECONDARY_FIELD_OPTIONS.frequency] },
                status: { type: 'STRING', enum: [...SECONDARY_FIELD_OPTIONS.status] },
                category: { type: 'STRING', enum: [...SECONDARY_FIELD_OPTIONS.category] },
                level: { type: 'STRING', enum: [...SECONDARY_FIELD_OPTIONS.level] },
              },
            },
          },
        },
      },
    },
  }
}

// Task 12 fix: bounded, single-line truncation for any diagnostic text that
// might end up in a thrown Error's message -- which the caller both logs to
// console (visible via `wrangler tail`) and, since this fix, persists into
// personal_memory_extraction_runs.failure_reason (column CHECK: <= 500
// chars). Content here is the user's OWN source material reflected back by
// the model (already stored in this user's own tables) or the model's own
// raw output text -- never a secret. GEMINI_API_KEY lives only in the
// request URL, which is never logged by this function.
function truncateForLog(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}...` : collapsed
}

// Task 12 fix (defensive hardening, not an observed divergence -- see the
// design/diagnosis notes: reasoning-endpoint.ts's own "proven working"
// extractJsonObject does NOT strip fences either, and responseMimeType:
// 'application/json' should structurally prevent Gemini from wrapping
// output in markdown in the first place). Kept cheap and narrow: only
// strips a single ```json ... ``` or ``` ... ``` fence wrapping the ENTIRE
// response, never touches content in the middle of an otherwise-bare object.
function stripJsonFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : text
}

// Task 14 fix (provider error transparency): REDACTION GUARD -- this
// function must NEVER log modelUrl.toString() or response.url (both carry
// GEMINI_API_KEY as a query param), never log an Authorization header
// (this call doesn't send one -- the key is a query param only, but the
// rule is stated here for the next person who might add one), and never
// log the key itself under any name. Every log line below uses only
// modelUrl.pathname (no query string) to identify which endpoint was
// called. The provider's own diagnostic (status, error.status,
// error.message, error.details) is otherwise logged IN FULL server-side --
// it describes OUR request shape, not the user, and is essential for
// diagnosing exactly this class of bug (see task 14 report for how this
// was actually used to find the real root cause).
async function callGeminiForExtraction(
  prompt: string,
  env: PersonalMemoryExtractionEnv,
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
        system_instruction: { parts: [{ text: buildExtractionSystemInstruction() }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0,
          responseMimeType: 'application/json',
          // Task 12 fix: gemini-2.5-flash spends output tokens on internal
          // "thinking" by default unless this is explicitly zeroed. Without
          // it, thinking tokens can consume the entire maxOutputTokens budget
          // before the model emits any of the actual JSON -- especially with
          // real, mixed-language (Persian/English) source material, which is
          // more reasoning-heavy than the short fixture strings the fake-model
          // tests used until now. The result is exactly this bug's signature:
          // an empty or truncated `text`, reported generically as "the model
          // did not return a usable extraction." Mirrors reasoning-endpoint.ts's
          // proven-working callGeminiOnce, which already sets this.
          thinkingConfig: { thinkingBudget: 0 },
          responseSchema: buildExtractionResponseSchema(),
        },
      }),
    })
  } catch (networkError) {
    logger.error?.(`[PersonalMemory] provider call failed before any response (network): path=${modelUrl.pathname} error=${(networkError as Error).message}`)
    throw new ProviderCallError('The AI model provider could not be reached.', 'PROVIDER_UNAVAILABLE')
  }

  if (!response.ok) {
    const bodyText = await response.text()
    let providerError: { status?: unknown; message?: unknown; details?: unknown } | undefined
    try {
      providerError = (JSON.parse(bodyText) as { error?: typeof providerError }).error
    } catch {
      // Not JSON -- providerError stays undefined, bodyText itself is still logged/used below.
    }
    const providerMessage = typeof providerError?.message === 'string' ? providerError.message : bodyText
    // Full, unredacted (of everything except the key/URL) diagnostic, exactly
    // as the provider sent it -- this is the line a human reads in
    // `wrangler tail` to actually diagnose a real production failure.
    logger.error?.(
      `[PersonalMemory] provider rejected request: path=${modelUrl.pathname} httpStatus=${response.status} ` +
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
    candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown }> } }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  const candidate = data.candidates?.[0]
  if (!candidate) throw new ProviderCallError('Model returned no candidate.', 'MODEL_OUTPUT_UNUSABLE')
  // Task 12 fix: mirrors reasoning-endpoint.ts's own finishReason check,
  // which this endpoint never had. A truncated response (finishReason
  // 'MAX_TOKENS') previously fell through to the generic "not valid JSON"
  // error below with no indication of WHY -- this makes that cause explicit
  // and immediately diagnosable from the run record / wrangler tail.
  if (candidate.finishReason !== undefined && candidate.finishReason !== 'STOP') {
    throw new ProviderCallError(
      `Model response did not finish safely (finishReason=${String(candidate.finishReason)}).`,
      'MODEL_OUTPUT_UNUSABLE',
      undefined,
      String(candidate.finishReason),
    )
  }
  const text = candidate.content?.parts?.[0]?.text
  if (typeof text !== 'string' || !text.trim()) throw new ProviderCallError('Model returned no extraction content.', 'MODEL_OUTPUT_UNUSABLE')
  const trimmed = stripJsonFence(text.trim())
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
// logged, never coerced (ADR-0009 Decision section 3, cited by ADR-0010
// section 4). Mirrors personalMemoryRecordValidation.ts's per-kind shape
// rules AND its sensitive-content defense-in-depth heuristic; kept in sync
// manually (see file header).
// ---------------------------------------------------------------------------

const CONTENT_FIELDS_BY_KIND: Record<PersonalMemoryRecordKind, readonly string[]> = {
  preference: ['summary', 'strength'],
  goal: ['summary', 'timeframe'],
  working_pattern: ['summary', 'frequency'],
  commitment: ['summary', 'status'],
  personal_fact: ['summary', 'category'],
  skill: ['summary', 'level'],
}

const SECONDARY_FIELD_OPTIONS: Record<string, readonly string[]> = {
  strength: ['strong', 'moderate', 'mild'],
  timeframe: ['short_term', 'long_term'],
  frequency: ['daily', 'weekly', 'occasional'],
  status: ['active', 'completed', 'abandoned'],
  category: ['identity', 'work_status', 'general'],
  level: ['beginner', 'intermediate', 'advanced'],
}

/**
 * Identical curated heuristic to
 * personalMemoryRecordValidation.ts's SENSITIVE_CONTENT_PATTERNS -- see
 * that module's header comment for the false-positive/false-negative
 * trade-off rationale. Kept as a flat, auditable list here too.
 */
const SENSITIVE_CONTENT_PATTERNS: readonly RegExp[] = [
  /\bhealth\b/i, /\bmedical\b/i, /\bdiagnos(is|ed|es)\b/i, /\bdisease\b/i, /\bill(ness)?\b/i,
  /\btherapy\b/i, /\btherapist\b/i, /\bmedication(s)?\b/i, /\bprescri(ption|bed)\b/i,
  /\bdepress(ion|ed)\b/i, /\banxiety\b/i, /\bmental health\b/i, /\bdoctor\b/i, /\bhospital\b/i,
  /\bpregnan(t|cy)\b/i, /\bdisab(led|ility)\b/i, /\bchronic\b/i, /\bsymptom(s)?\b/i,
  /\bcheck-?up(s)?\b/i, /\bappointment(s)?\b/i, /\bdentist\b/i, /\bclinic\b/i, /\bphysician\b/i,
  /\bsurgery\b/i, /\bvaccin(e|ation)\b/i,
  /\bwife\b/i, /\bhusband\b/i, /\bspouse\b/i, /\bpartner\b/i, /\bgirlfriend\b/i, /\bboyfriend\b/i,
  /\bfianc[ée]e?\b/i, /\bmarri(age|ed)\b/i, /\bdivorce(d)?\b/i, /\bchild(ren)?\b/i, /\bkids?\b/i,
  /\bfamily\b/i, /\bparent(s|ing)?\b/i, /\bmom\b/i, /\bdad\b/i, /\bmother\b/i, /\bfather\b/i,
  /\bdaughter(s)?\b/i, /\bson(s)?\b/i, /\bsibling(s)?\b/i, /\bbrother(s)?\b/i, /\bsister(s)?\b/i,
  /\bgrandparent(s)?\b/i, /\bgrandmother\b/i, /\bgrandfather\b/i, /\bgrandma\b/i, /\bgrandpa\b/i,
  /\baunt\b/i, /\buncle\b/i, /\bcousin(s)?\b/i, /\bniece\b/i, /\bnephew\b/i, /\bin-law\b/i,
  /\brelationship\b/i,
  /\bemotion(al|ally)?\b/i, /\bfeeling(s)?\b/i, /\bstressed?\b/i, /\boverwhelm(ed|ing)?\b/i,
  /\bgrief\b/i, /\bmood\b/i, /\blonely\b/i, /\bloneliness\b/i, /\bburn(ed|t)?[ -]?out\b/i,
]

function isBoundedString(value: unknown, maxLength = 300): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
}

function containsSensitiveContent(content: Record<string, unknown>): boolean {
  return Object.values(content).some(
    (value) => typeof value === 'string' && SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(value)),
  )
}

export interface ValidCandidate {
  kind: PersonalMemoryRecordKind
  content: Record<string, unknown>
  confidence: Confidence
  provenanceSourceKind: ProvenanceSourceKind
  provenanceSourceRefIds: string[]
}

export function normalizeCandidate(raw: unknown, refIdKinds: ReadonlyMap<string, ProvenanceSourceKind>): ValidCandidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  const kind = record.kind
  if (typeof kind !== 'string' || !(PERSONAL_MEMORY_RECORD_KINDS as readonly string[]).includes(kind)) return null
  const confidence = record.confidence
  if (typeof confidence !== 'string' || !(CONFIDENCE_VALUES as readonly string[]).includes(confidence)) return null
  const provenanceSourceKind = record.provenanceSourceKind
  if (typeof provenanceSourceKind !== 'string' || !(PROVENANCE_SOURCE_KINDS as readonly string[]).includes(provenanceSourceKind)) return null

  const refIdsRaw = record.provenanceSourceRefIds
  if (!Array.isArray(refIdsRaw) || refIdsRaw.length === 0) return null
  // Every cited id must be real, in-scope, AND actually belong to the
  // claimed provenanceSourceKind -- a model that cites a chat message id
  // while claiming provenanceSourceKind="briefing" (or invents an id)
  // produces a dropped candidate, never a partially-trusted one.
  const refIds = refIdsRaw.filter(
    (id): id is string => typeof id === 'string' && refIdKinds.get(id) === provenanceSourceKind,
  )
  if (refIds.length !== refIdsRaw.length || refIds.length === 0) return null

  const rawContent = record.content
  if (!rawContent || typeof rawContent !== 'object' || Array.isArray(rawContent)) return null
  const contentRecord = rawContent as Record<string, unknown>
  const allowedFields = CONTENT_FIELDS_BY_KIND[kind as PersonalMemoryRecordKind]
  if (Object.keys(contentRecord).some((key) => contentRecord[key] !== undefined && !allowedFields.includes(key))) return null

  if (!isBoundedString(contentRecord.summary)) return null
  const content: Record<string, unknown> = { summary: (contentRecord.summary as string).trim() }

  const secondaryField = allowedFields.find((field) => field !== 'summary')
  if (secondaryField) {
    const isRequired = secondaryField === 'status' // commitment.status is the only required secondary field, mirroring PersonalCommitmentContent's own required `status`.
    const rawValue = contentRecord[secondaryField]
    if (rawValue === undefined) {
      // Absent AND optional is fine (omit it); absent AND required is not.
      if (isRequired) return null
    } else {
      // Present but invalid must reject the whole candidate, exactly like
      // the canonical TS validator's per-kind functions -- silently
      // dropping an invalid-but-present optional field (accepting the
      // candidate anyway) would NOT match validatePersonalMemoryContent's
      // behavior and is exactly the kind of drift
      // personalMemoryValidationEquivalence.test.ts exists to catch.
      const options = SECONDARY_FIELD_OPTIONS[secondaryField]
      if (!isBoundedString(rawValue, 20) || !options.includes(rawValue as string)) return null
      content[secondaryField] = rawValue
    }
  }

  // Defense in depth (see file header): reject regardless of what the
  // prompt already instructs the model not to produce.
  if (containsSensitiveContent(content)) return null

  return {
    kind: kind as PersonalMemoryRecordKind,
    content,
    confidence: confidence as Confidence,
    provenanceSourceKind: provenanceSourceKind as ProvenanceSourceKind,
    provenanceSourceRefIds: refIds,
  }
}

/** Mirrors src/features/personal-memory/personalMemoryRecordValidation.ts's computePersonalMemoryContentFingerprint exactly -- see file header for the manual-sync note. */
async function computeContentFingerprint(kind: PersonalMemoryRecordKind, content: Record<string, unknown>): Promise<string> {
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

export async function handlePersonalMemoryExtractionRequest(
  request: Request,
  env: PersonalMemoryExtractionEnv,
  dependencies: PersonalMemoryExtractionDependencies = {},
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
  // ADR-0010 Q4: explicit user trigger only, with no target to name in the
  // original design -- task 16 adds ONE optional field, documentId, so a
  // run's source material can be a single document's chunks instead of
  // chat+briefing (never both in the same run). An empty JSON object (or
  // no documentId field) is still the expected body for the original path.
  let documentId: string | undefined
  try {
    const text = await request.text()
    if (text.trim()) {
      const parsed = JSON.parse(text) as { documentId?: unknown }
      if (parsed.documentId !== undefined) {
        if (typeof parsed.documentId !== 'string' || !parsed.documentId) {
          return errorResponse('INVALID_REQUEST', 'documentId, if provided, must be a non-empty string.', 400, origin)
        }
        documentId = parsed.documentId
      }
    }
  } catch {
    return errorResponse('INVALID_JSON', 'Request body must contain valid JSON.', 400, origin)
  }

  let source: SourceItemForPrompt[]
  try {
    source = documentId
      ? await readEligibleSourceMaterialFromDocument(documentId, env, jwt, fetcher)
      : await readEligibleSourceMaterial(env, jwt, fetcher)
  } catch (error) {
    logger.error?.(`[PersonalMemory] source read failed: ${(error as Error).message}`)
    return errorResponse('SOURCE_READ_FAILED', 'Unable to read source material.', 502, origin)
  }
  if (source.length === 0) {
    return errorResponse(
      'NO_SOURCE_MATERIAL',
      documentId
        ? 'This document has no extracted chunks yet -- extract it first.'
        : 'No chat messages or briefings exist yet to extract personal memory from.',
      422,
      origin,
    )
  }
  const refIdKinds = new Map(source.map((item) => [item.id, item.provenanceSourceKind]))

  const startedAt = now()
  let run: { id: string }
  try {
    run = await restPostAsUser(
      env,
      jwt,
      'personal_memory_extraction_runs',
      { user_id: userId, model_identity: env.GEMINI_MODEL, derivation_version: DERIVATION_VERSION, started_at: startedAt },
      fetcher,
    )
  } catch (error) {
    logger.error?.(`[PersonalMemory] run creation failed: ${(error as Error).message}`)
    return errorResponse('RUN_CREATE_FAILED', 'Unable to start an extraction run.', 502, origin)
  }

  const prompt = buildExtractionPrompt(source)
  let modelOutput: { raw: unknown; promptTokenCount?: number; responseTokenCount?: number }
  try {
    modelOutput = await callGeminiForExtraction(prompt, env, fetcher, logger)
  } catch (error) {
    // Task 14 fix: callGeminiForExtraction now throws a typed
    // ProviderCallError carrying which of the three taxonomy buckets this
    // failure belongs to, plus a pre-truncated providerDetail -- replacing
    // the single generic MODEL_CALL_FAILED this route used to report for
    // every case (including a rejected request that never reached a real
    // model call at all). The full diagnostic (provider status/message/
    // details) was already logged in full inside callGeminiForExtraction
    // itself; this catch only needs the bounded summary for the run record
    // and the response body.
    const providerError = error instanceof ProviderCallError ? error : null
    const taxonomy: ProviderFailureTaxonomy = providerError?.taxonomy ?? 'MODEL_OUTPUT_UNUSABLE'
    const failureReason = truncateForLog((error as Error).message, 500)
    await restPatchAsUser(env, jwt, `personal_memory_extraction_runs?id=eq.${run.id}`, {
      completed_at: now(),
      outcome: 'failed',
      failure_reason: failureReason,
    }, fetcher).catch(() => undefined)
    logger.error?.(`[PersonalMemory] model call failed: taxonomy=${taxonomy} ${(error as Error).message}`)
    return errorResponse(taxonomy, EXTRACTION_TAXONOMY_MESSAGES[taxonomy], 502, origin, {
      providerStatus: providerError?.providerStatus,
      providerDetail: providerError?.providerDetail,
    })
  }

  // Task 14 fix: MAX_CANDIDATES_PER_RUN is now enforced HERE, in code, not
  // via the response schema's own maxItems (see buildExtractionResponseSchema's
  // own comment for why -- the provider rejects the schema-level bound as
  // too complex to serve). Same invariant, more robust enforcement point.
  const rawCandidates = (Array.isArray((modelOutput.raw as { candidates?: unknown })?.candidates)
    ? ((modelOutput.raw as { candidates: unknown[] }).candidates)
    : []
  ).slice(0, MAX_CANDIDATES_PER_RUN)
  const normalized = rawCandidates.map((candidate) => normalizeCandidate(candidate, refIdKinds))
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
        'create_personal_memory_record',
        {
          p_run_id: run.id,
          p_kind: candidate.kind,
          p_content: candidate.content,
          p_provenance_source_kind: candidate.provenanceSourceKind,
          p_provenance_source_ref_ids: candidate.provenanceSourceRefIds,
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
      logger.error?.(`[PersonalMemory] record persistence failed: ${(error as Error).message}`)
      results.push({ kind: candidate.kind, outcome: 'persistence_failed' })
    }
  }

  const completedAt = now()
  await restPatchAsUser(
    env,
    jwt,
    `personal_memory_extraction_runs?id=eq.${run.id}`,
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
  ).catch((error) => logger.error?.(`[PersonalMemory] run completion update failed: ${(error as Error).message}`))

  logger.info?.(
    `[PersonalMemory] runId=${run.id} sourceItems=${source.length} candidates=${rawCandidates.length} accepted=${acceptedCount} dropped=${droppedCount}`,
  )

  return jsonResponse(
    {
      runId: run.id,
      startedAt,
      completedAt,
      sourceItemCount: source.length,
      candidateCount: rawCandidates.length,
      acceptedCount,
      droppedCount,
      results,
    },
    200,
    origin,
  )
}
