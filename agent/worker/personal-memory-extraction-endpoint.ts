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
//
// Task PA-02: parseModelJsonObject/EMBEDDING_MODEL/EMBEDDING_DIMENSIONS/
// l2Normalize ARE imported from sibling agent/worker/*.ts modules below --
// there is no actual "zero-cross-import" rule between sibling Worker files
// (see modelJsonParsing.ts's own header comment); the constraint above is
// specifically about not importing src/features/* into agent/worker/.

import { parseModelJsonObject, ModelJsonParseError } from './modelJsonParsing'
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, l2Normalize } from './embeddingConfig'
import { resolveGeminiModel } from './geminiModel'
import type { NeutralObjectSchema } from './providers/schema/neutralSchema'
import { translateNeutralSchema } from './providers/gemini/geminiSchemaTranslation'

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

// Task 16-fix2: production evidence (wrangler tail) showed document-sourced
// runs hitting finishReason=MAX_TOKENS at the old budget of 1024 -- a dense
// resume produces far more full candidates than the chat-sourced material
// this budget was originally calibrated for. Sized for the worst realistic
// case: MAX_CANDIDATES_PER_RUN=12 full candidates, each estimated from the
// actual buildExtractionResponseSchema shape below (see task 16-fix2
// report for the full arithmetic):
//   kind (~27) + confidence (~23) + provenanceSourceKind (~35) +
//   provenanceSourceRefIds with a realistic 3 UUID refs (~145) +
//   content.summary at its isBoundedString cap of 300 chars (~324) +
//   one secondary enum field (~26) = ~580 chars/candidate.
// At ~2.5 chars/token (conservative for mixed English/German/Persian
// content -- non-Latin scripts tokenize less efficiently than the ~4
// chars/token typical for English prose), that's ~232 tokens/candidate;
// 12 candidates + JSON wrapper overhead ≈ 2,816 tokens. 4096 keeps ~45%
// headroom above that estimate.
const MAX_OUTPUT_TOKENS_EXTRACTION = 4096

// Task 16-fix2, FIX 2 (defense in depth -- a budget alone just moves the
// cliff for an even denser resume). Document-sourced runs process chunks
// in batches instead of one call for the whole document: chunks are capped
// at 3000 chars each by document-memory-extraction-endpoint.ts's own
// MAX_CHUNK_CHARS, so two full-size chunks already reach this char budget
// -- naturally landing batches at 2 chunks for dense sections or 3 for
// shorter ones. The chat/briefing path is UNCHANGED (still one call for
// the whole run) -- these two constants and batchDocumentSource below are
// only ever consulted from the document branch of the route handler.
const MAX_DOCUMENT_CHUNKS_PER_BATCH = 3
const MAX_DOCUMENT_BATCH_CHARS = 6000

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

export interface SourceItemForPrompt {
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

// Task 18, A3: the document's own type (resume/financial/personal/
// business/null), read so buildExtractionSystemInstruction can add
// type-specific guidance. Best-effort: a lookup failure degrades to "no
// type-specific guidance" rather than failing the whole extraction run --
// the deterministic containsFinancialIdentifier check below is the actual
// guarantee against a financial identifier reaching storage and does not
// depend on this lookup succeeding.
async function readDocumentType(
  documentId: string,
  env: PersonalMemoryExtractionEnv,
  jwt: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  const rows = await restGetAsUser<Array<{ type: string | null }>>(
    env,
    jwt,
    `documents?id=eq.${encodeURIComponent(documentId)}&select=type`,
    fetcher,
  )
  return rows[0]?.type ?? null
}

// Task 16-fix2, FIX 2: greedy, size-based batching -- a batch grows until
// adding the next chunk would exceed either MAX_DOCUMENT_CHUNKS_PER_BATCH
// items or MAX_DOCUMENT_BATCH_CHARS characters, whichever comes first, then
// a new batch starts. A single oversized item still gets its own batch
// (never dropped, never split) rather than looping forever. Pure and
// exported for direct unit testing -- see the "5 chunks -> batches" test.
export function batchDocumentSource(source: readonly SourceItemForPrompt[]): SourceItemForPrompt[][] {
  const batches: SourceItemForPrompt[][] = []
  let current: SourceItemForPrompt[] = []
  let currentChars = 0
  for (const item of source) {
    const overCount = current.length >= MAX_DOCUMENT_CHUNKS_PER_BATCH
    const overChars = current.length > 0 && currentChars + item.text.length > MAX_DOCUMENT_BATCH_CHARS
    if (overCount || overChars) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(item)
    currentChars += item.text.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

// ---------------------------------------------------------------------------
// Prompt + Gemini structured-output schema
// ---------------------------------------------------------------------------

// Task 18, A3: type-aware guidance appended to the base system instruction
// for a document-sourced run only (chat/briefing runs pass no
// documentType and get the base instruction unchanged, byte for byte, from
// before this task). Financial is the "important case" the task calls out
// explicitly: extract ONLY stable facts, never a transaction/balance/
// running total. This is PROMPT GUIDANCE ONLY -- politeness, not the
// guarantee. The actual guarantee against an identifier (IBAN, account
// number, card number) reaching storage is containsFinancialIdentifier
// below, enforced deterministically on every candidate regardless of
// documentType or provenance, exactly mirroring how containsSensitiveContent
// already enforces the health/relationships/emotional-state exclusion
// unconditionally rather than only for chat-sourced candidates.
const DOCUMENT_TYPE_EXTRACTION_GUIDANCE: Record<string, string> = {
  resume: 'This source material is a résumé/CV. Extract durable skills, qualifications, and roles -- never a specific date range or employer-confidential detail beyond what a normal résumé already discloses.',
  financial: 'This source material is a financial statement. Extract ONLY stable, durable facts about the user\'s financial LIFE, such as "primary bank is X" or "monthly rent is paid to Y" -- NEVER a specific transaction, balance, running total, account number, IBAN, card number, or any other numeric identifier. If nothing in the material rises to a stable fact of this kind, propose nothing at all for this material.',
  personal: 'This source material is a personal document. Extract only stable, durable personal facts -- never a specific date, address, or identifier copied from the document.',
  business: 'This source material is a business document. Extract only stable, durable facts about the user\'s own business context or role -- never confidential figures, specific deal terms, or identifiers.',
}

export function buildExtractionSystemInstruction(documentType?: string | null): string {
  const base = [
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
  ]
  const typeGuidance = documentType ? DOCUMENT_TYPE_EXTRACTION_GUIDANCE[documentType] : undefined
  return typeGuidance ? [...base, typeGuidance].join(' ') : base.join(' ')
}

export function buildExtractionPrompt(source: readonly SourceItemForPrompt[]): string {
  const blocks = source
    .map((item) => `[ref_id=${item.id}] (${item.provenanceSourceKind})\n${item.text}`)
    .join('\n\n---\n\n')
  return `Source material:\n\n${blocks}`
}

// ADR-0018 S2 Phase B: emits the neutral schema subset now, not Gemini's
// dialect -- see providers/schema/neutralSchema.ts's own header comment.
export function buildExtractionResponseSchema(): NeutralObjectSchema {
  return {
    type: 'object',
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
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'content', 'confidence', 'provenanceSourceKind', 'provenanceSourceRefIds'],
          properties: {
            kind: { type: 'string', enum: [...PERSONAL_MEMORY_RECORD_KINDS] },
            confidence: { type: 'string', enum: [...CONFIDENCE_VALUES] },
            provenanceSourceKind: { type: 'string', enum: [...PROVENANCE_SOURCE_KINDS] },
            provenanceSourceRefIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
            content: {
              type: 'object',
              properties: {
                summary: { type: 'string' },
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
                strength: { type: 'string', enum: [...SECONDARY_FIELD_OPTIONS.strength] },
                timeframe: { type: 'string', enum: [...SECONDARY_FIELD_OPTIONS.timeframe] },
                frequency: { type: 'string', enum: [...SECONDARY_FIELD_OPTIONS.frequency] },
                status: { type: 'string', enum: [...SECONDARY_FIELD_OPTIONS.status] },
                category: { type: 'string', enum: [...SECONDARY_FIELD_OPTIONS.category] },
                level: { type: 'string', enum: [...SECONDARY_FIELD_OPTIONS.level] },
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
  documentType?: string | null,
): Promise<{ raw: unknown; promptTokenCount?: number; responseTokenCount?: number }> {
  const modelUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolveGeminiModel(env))}:generateContent`)
  modelUrl.searchParams.set('key', env.GEMINI_API_KEY ?? '')

  let response: Response
  try {
    response = await fetcher(modelUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildExtractionSystemInstruction(documentType) }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          // Already at/above the MIG-01b 2048 floor -- left as-is.
          maxOutputTokens: MAX_OUTPUT_TOKENS_EXTRACTION,
          temperature: 0,
          responseMimeType: 'application/json',
          // MIG-01b: thinkingConfig removed -- gemini-3.6-flash returns 400
          // INVALID_ARGUMENT on thinkingConfig:{thinkingBudget:0} (see
          // geminiModel.ts and scripts/gemini-36-probe.ts's P3 finding).
          // The task 12 fix this replaced (gemini-2.5-flash spending output
          // tokens on internal "thinking" by default, especially on the
          // real, mixed-language Persian/English material this route
          // handles) is still real on 2.5 -- accepted, 2.5 is being
          // retired (see callGemini's identical note in index.ts).
          // ADR-0018 S2 Phase B (interim): see task-title-extraction.ts's
          // identical comment -- Phase C replaces this raw fetch entirely.
          responseSchema: translateNeutralSchema(buildExtractionResponseSchema()),
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
  let raw: unknown
  try {
    raw = parseModelJsonObject(text)
  } catch (err) {
    const parseErr = err as ModelJsonParseError
    const snippet = truncateForLog(parseErr.failedText, 300)
    throw new ProviderCallError(`${parseErr.message} Raw output snippet: "${snippet}"`, 'MODEL_OUTPUT_UNUSABLE', undefined, snippet)
  }
  return {
    raw,
    promptTokenCount: data.usageMetadata?.promptTokenCount,
    responseTokenCount: data.usageMetadata?.candidatesTokenCount,
  }
}

// ---------------------------------------------------------------------------
// Task 16-fix2, FIX 2: the shared, single-call core -- builds the prompt
// from whatever source items it's given and makes exactly ONE model call.
// Deliberately returns raw, uncapped, unnormalized candidates (never slices
// to MAX_CANDIDATES_PER_RUN itself): the chat/briefing route below slices
// BEFORE normalizing (preserving today's exact behavior, unchanged), while
// the document route's batching layer merges raw candidates across batches
// FIRST and slices the merged total once -- both callers own that decision,
// this function only owns "ask the model once". Throws ProviderCallError on
// any failure, exactly like callGeminiForExtraction itself (uncaught here
// on purpose -- the chat/briefing path needs the throw to propagate to its
// existing catch block unchanged; the batched document path below catches
// it per-batch instead).
// ---------------------------------------------------------------------------
interface ExtractionAttemptResult {
  rawCandidates: unknown[]
  promptTokenCount?: number
  responseTokenCount?: number
}

async function runExtractionAttempt(
  source: readonly SourceItemForPrompt[],
  env: PersonalMemoryExtractionEnv,
  fetcher: typeof fetch,
  logger: Pick<Console, 'info' | 'error'>,
  documentType?: string | null,
): Promise<ExtractionAttemptResult> {
  const prompt = buildExtractionPrompt(source)
  const modelOutput = await callGeminiForExtraction(prompt, env, fetcher, logger, documentType)
  const rawCandidates = Array.isArray((modelOutput.raw as { candidates?: unknown })?.candidates)
    ? (modelOutput.raw as { candidates: unknown[] }).candidates
    : []
  return { rawCandidates, promptTokenCount: modelOutput.promptTokenCount, responseTokenCount: modelOutput.responseTokenCount }
}

// Task 16-fix2, FIX 2 (batching lives in the document source-gathering
// layer, not the shared core above) + FIX 3 (honest partial-failure
// semantics): batches the document's chunks (batchDocumentSource) and
// makes ONE runExtractionAttempt call per batch, catching each batch's
// failure independently rather than letting one bad batch fail the whole
// run. Raw candidates from every SUCCESSFUL batch are merged into one flat
// array here; the route handler slices that merged array to
// MAX_CANDIDATES_PER_RUN once, after this function returns -- "merging
// candidates across batches with MAX_CANDIDATES_PER_RUN enforced
// application-level after the merge", same enforcement point as today's
// single-call path, same invariant.
interface BatchedDocumentExtractionResult {
  rawCandidates: unknown[]
  promptTokenCount?: number
  responseTokenCount?: number
  batchesTotal: number
  batchesSucceeded: number
  batchesFailed: number
  /** The most recent batch failure, if any -- used to build the total-failure response when EVERY batch failed (batchesSucceeded === 0). */
  lastFailureError: unknown
}

async function runBatchedDocumentExtraction(
  source: readonly SourceItemForPrompt[],
  env: PersonalMemoryExtractionEnv,
  fetcher: typeof fetch,
  logger: Pick<Console, 'info' | 'error'>,
  documentType?: string | null,
): Promise<BatchedDocumentExtractionResult> {
  const batches = batchDocumentSource(source)
  let batchesSucceeded = 0
  let batchesFailed = 0
  let lastFailureError: unknown
  const rawCandidates: unknown[] = []
  let promptTokenCount = 0
  let responseTokenCount = 0
  for (const batch of batches) {
    try {
      const result = await runExtractionAttempt(batch, env, fetcher, logger, documentType)
      batchesSucceeded += 1
      rawCandidates.push(...result.rawCandidates)
      promptTokenCount += result.promptTokenCount ?? 0
      responseTokenCount += result.responseTokenCount ?? 0
    } catch (error) {
      batchesFailed += 1
      lastFailureError = error
      logger.error?.(
        `[PersonalMemory] document batch extraction failed (batch ${batchesSucceeded + batchesFailed}/${batches.length}): ${(error as Error).message}`,
      )
    }
  }
  return {
    rawCandidates,
    promptTokenCount: promptTokenCount || undefined,
    responseTokenCount: responseTokenCount || undefined,
    batchesTotal: batches.length,
    batchesSucceeded,
    batchesFailed,
    lastFailureError,
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

/**
 * Task 18, A3 -- HARD SENSITIVITY RULE: an IBAN, account number, card
 * number, or similar identifier must NEVER appear in a fact's text.
 * Enforced HERE, deterministically, on every candidate regardless of
 * documentType, kind, or provenance -- exactly mirroring how
 * containsSensitiveContent below already enforces the health/relationships/
 * emotional-state exclusion unconditionally rather than only for
 * document-sourced or financial-typed candidates. The extraction prompt's
 * own financial-specific guidance (buildExtractionSystemInstruction) is
 * politeness; this is the guarantee.
 *
 * Shape-only matching, no mod-97 IBAN checksum validation -- not required:
 * a shape match is sufficient grounds to drop a candidate. A false
 * positive drops a candidate (safe, the accepted trade-off direction
 * SENSITIVE_CONTENT_PATTERNS already documents); a false negative would
 * let a real identifier reach storage (the actual harm this exists to
 * prevent), so this errs toward over-rejection.
 *
 * IBAN_SHAPE_PATTERN matches EITHER a single unspaced run of 15-34
 * characters (2 letters + 2 digits + 11-30 more alnum, e.g.
 * "DE89370400440532013000") OR the conventional printed grouping of
 * EXACTLY 4 characters per group separated by a single space (e.g. "DE89
 * 3704 0044 0532 0130 00") -- deliberately NOT "one optional space before
 * any character," which was tried first and rejected: it made ordinary
 * prose following a coincidental 2-letter+2-digit token (e.g. "Room AB12
 * booked for the...") match too, since natural-language words chained
 * through that looser rule. Requiring literal 4-character groups (matching
 * how IBANs are actually printed) avoids that false-positive class while
 * still catching both the spaced and unspaced real shapes.
 */
const IBAN_SHAPE_PATTERN = /\b[A-Za-z]{2}\d{2}(?:[A-Za-z0-9]{11,30}|(?:[ ][A-Za-z0-9]{4}){2,7}(?:[ ][A-Za-z0-9]{1,4})?)\b/
const ACCOUNT_OR_CARD_NUMBER_PATTERN = /\b\d(?:[ -]?\d){7,}\b/

function containsFinancialIdentifier(content: Record<string, unknown>): boolean {
  return Object.values(content).some(
    (value) => typeof value === 'string' && (IBAN_SHAPE_PATTERN.test(value) || ACCOUNT_OR_CARD_NUMBER_PATTERN.test(value)),
  )
}

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
  // Task 18, A3 HARD SENSITIVITY RULE: reject regardless of documentType --
  // see containsFinancialIdentifier's own comment.
  if (containsFinancialIdentifier(content)) return null

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

// Task 16-fix2: factored out of the route handler's own catch block
// unchanged (byte-for-byte the same run-patch + log + error-response shape
// task 14 already established) so it can also be used for the document
// path's TOTAL failure case (every batch failed) -- see
// runBatchedDocumentExtraction above.
async function reportExtractionFailure(
  error: unknown,
  runId: string,
  env: PersonalMemoryExtractionEnv,
  jwt: string,
  fetcher: typeof fetch,
  logger: Pick<Console, 'info' | 'error'>,
  now: () => string,
  origin: string,
): Promise<Response> {
  const providerError = error instanceof ProviderCallError ? error : null
  const taxonomy: ProviderFailureTaxonomy = providerError?.taxonomy ?? 'MODEL_OUTPUT_UNUSABLE'
  const failureReason = truncateForLog((error as Error).message, 500)
  await restPatchAsUser(env, jwt, `personal_memory_extraction_runs?id=eq.${runId}`, {
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

// ---------------------------------------------------------------------------
// Task 18, B1 -- propose-time overlap detection. Deterministic FIRST (kind +
// normalized subject text); only if that finds nothing does this fall back
// to embedding cosine similarity. Produces a SUGGESTION only
// (possible_update_of_id, stored by create_personal_memory_record) -- never
// itself merges, supersedes, or drops anything. "NEVER auto-merge on a
// model's or a similarity score's word alone" -- the actual supersession
// only ever happens via confirm_personal_memory_record_update, on an
// explicit user Confirm (see the migration's own comment).
//
// THRESHOLD CALIBRATION (real gemini-embedding-001 calls, not simulated --
// see the task 18 report for the full probe data): the task's own starting
// point of 0.88 was tested against the two real motivating pairs first --
//   "IT Specialist for Application Development (IHK)" vs
//   "Fachinformatiker für Anwendungsentwicklung (IHK)"      -> 0.8497
//   "Wants to complete the IHK Fachinformatiker exam" vs
//   "Goal: finish the IHK certified IT specialist qualification" -> 0.8492
// BOTH score BELOW 0.88 -- that threshold would have missed the exact
// cross-language duplicate this feature exists to catch. Lowering the
// threshold to catch them was checked against genuinely-different-subject
// pairs of the same kind (the real risk: a WRONG merge), e.g.
//   "Fachinformatiker für Anwendungsentwicklung (IHK)" vs
//   "Fachinformatiker für Systemintegration (IHK)" (different credential) -> 0.8039
//   "Learning React Native" vs "Learning Flutter"                          -> 0.7694
//   "TypeScript" vs "JavaScript"                                           -> 0.6551
// 0.83 sits in the empirical gap between the highest "must stay separate"
// score (0.8039) and the lowest "must match" score (0.8492) found across
// this probe set, favoring the "stay separate" side of that gap per the
// task's own conservative bias. NOTE: a same-subject VALUE FLIP (e.g. a
// stated preference reversing) also scores high on this scale (0.94+) --
// this is correctly treated as a MATCH (an update candidate), not a false
// positive to guard against: "same subject, different value" is exactly
// B1's other named case, and the UI never applies it without an explicit
// user Confirm regardless of which path (deterministic or embedding)
// produced the suggestion.
// ---------------------------------------------------------------------------

const OVERLAP_EMBEDDING_NORM_EPSILON = 1e-3
export const OVERLAP_EMBEDDING_THRESHOLD = 0.83
// Bounds the fallback's own cost: at most this many same-kind existing
// records are fetched/embedded per run, matching the order-of-magnitude
// bound every other read in this file already uses (MAX_CHAT_MESSAGES_PER_RUN,
// MAX_DOCUMENT_CHUNKS_PER_RUN).
const MAX_EXISTING_RECORDS_FOR_OVERLAP_CHECK = 50

/** Case/diacritics/whitespace-insensitive -- "TypeScript", "typescript ", "Über uns" vs "Uber uns" all normalize identically. Exported for direct unit testing. */
export function normalizeOverlapSubjectText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks left behind by NFD decomposition (e.g. the umlaut dots in "ü" -> "u" + U+0308)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Both inputs are already unit-normalized, so this is a plain dot product. Exported for direct unit testing. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]
  return sum
}

/** Mirrors document-memory-extraction-endpoint.ts's own embedChunk -- model/dimensions/normalization now come from embeddingConfig.ts, the single source of truth for both. */
async function embedTextForOverlap(
  text: string,
  env: PersonalMemoryExtractionEnv,
  fetcher: typeof fetch,
  logger: Pick<Console, 'info' | 'error'>,
): Promise<number[] | null> {
  const modelUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`)
  modelUrl.searchParams.set('key', env.GEMINI_API_KEY ?? '')
  let response: Response
  try {
    response = await fetcher(modelUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: EMBEDDING_DIMENSIONS }),
    })
  } catch (networkError) {
    logger.error?.(`[PersonalMemory] overlap embedding call failed before any response: path=${modelUrl.pathname} error=${(networkError as Error).message}`)
    return null
  }
  if (!response.ok) {
    logger.error?.(`[PersonalMemory] overlap embedding provider rejected request: path=${modelUrl.pathname} httpStatus=${response.status}`)
    return null
  }
  const data = (await response.json()) as { embedding?: { values?: unknown } }
  const values = data.embedding?.values
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS || !values.every((v) => typeof v === 'number')) {
    return null
  }
  const normalized = l2Normalize(values as number[])
  const norm = Math.sqrt(normalized.reduce((sum, v) => sum + v * v, 0))
  if (Math.abs(norm - 1) > OVERLAP_EMBEDDING_NORM_EPSILON) return null
  return normalized
}

interface ExistingRecordForOverlap {
  id: string
  kind: string
  summary: string
  status: string
}

// Only records a NEW candidate could plausibly "update" -- excludes
// 'superseded' (already retired; the live successor is what should be
// matched against instead) and 'user_rejected' (ADR-0010 Q1: rejection is
// a deliberate "not a fact I want tracked" signal -- proposing an "update"
// to it would contradict that signal). 'proposed' is included so two
// pending candidates for the same fact from different runs get merged into
// one review item instead of sitting side by side.
const OVERLAP_TARGET_STATUSES = ['proposed', 'user_confirmed', 'user_corrected']

async function readExistingRecordsForOverlapCheck(
  kinds: readonly string[],
  env: PersonalMemoryExtractionEnv,
  jwt: string,
  fetcher: typeof fetch,
): Promise<ExistingRecordForOverlap[]> {
  if (kinds.length === 0) return []
  const uniqueKinds = [...new Set(kinds)]
  const rows = await restGetAsUser<Array<{ id: string; kind: string; content: { summary?: unknown }; status: string }>>(
    env,
    jwt,
    `personal_memory_records?kind=in.(${uniqueKinds.join(',')})&status=in.(${OVERLAP_TARGET_STATUSES.join(',')})` +
      `&select=id,kind,content,status&order=created_at.desc&limit=${MAX_EXISTING_RECORDS_FOR_OVERLAP_CHECK}`,
    fetcher,
  )
  return rows
    .filter((row) => typeof row.content?.summary === 'string')
    .map((row) => ({ id: row.id, kind: row.kind, summary: row.content.summary as string, status: row.status }))
}

/**
 * Deterministic-first, embedding-fallback-second. Returns the id of the
 * best overlap target, or null if none clears either bar. NEVER called for
 * more than one purpose than "compute a suggestion" -- the caller decides
 * what to do with it (attach it to create_personal_memory_record's own
 * p_possible_update_of_id, nothing more).
 */
async function findPossibleUpdateTarget(
  candidateKind: string,
  candidateSummary: string,
  existingRecords: readonly ExistingRecordForOverlap[],
  env: PersonalMemoryExtractionEnv,
  fetcher: typeof fetch,
  logger: Pick<Console, 'info' | 'error'>,
): Promise<string | null> {
  const sameKind = existingRecords.filter((r) => r.kind === candidateKind)
  if (sameKind.length === 0) return null

  const normalizedCandidate = normalizeOverlapSubjectText(candidateSummary)
  const deterministicMatch = sameKind.find((r) => normalizeOverlapSubjectText(r.summary) === normalizedCandidate)
  if (deterministicMatch) return deterministicMatch.id

  // Embedding fallback -- best-effort: an embedding failure here degrades
  // to "no suggestion found" (the candidate is still created normally,
  // just without a possible_update_of_id), never fails the whole
  // extraction run.
  const candidateEmbedding = await embedTextForOverlap(candidateSummary, env, fetcher, logger)
  if (!candidateEmbedding) return null

  let bestId: string | null = null
  let bestScore = OVERLAP_EMBEDDING_THRESHOLD
  for (const record of sameKind) {
    const recordEmbedding = await embedTextForOverlap(record.summary, env, fetcher, logger)
    if (!recordEmbedding) continue
    const score = cosineSimilarity(candidateEmbedding, recordEmbedding)
    if (score >= bestScore) {
      bestScore = score
      bestId = record.id
    }
  }
  return bestId
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
  let documentType: string | null = null
  try {
    source = documentId
      ? await readEligibleSourceMaterialFromDocument(documentId, env, jwt, fetcher)
      : await readEligibleSourceMaterial(env, jwt, fetcher)
  } catch (error) {
    logger.error?.(`[PersonalMemory] source read failed: ${(error as Error).message}`)
    return errorResponse('SOURCE_READ_FAILED', 'Unable to read source material.', 502, origin)
  }
  if (documentId) {
    documentType = await readDocumentType(documentId, env, jwt, fetcher).catch((error: unknown) => {
      logger.error?.(`[PersonalMemory] document type lookup failed (continuing without type-specific guidance): ${(error as Error).message}`)
      return null
    })
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

  // Task 16-fix2: the document path batches (FIX 2) and tolerates a partial
  // failure across batches (FIX 3); the chat/briefing path is UNCHANGED --
  // still exactly one call, and any failure still fails the whole run via
  // reportExtractionFailure (byte-for-byte the same behavior task 14
  // established, just factored into a shared function -- see its own
  // comment).
  let rawCandidatesUncapped: unknown[]
  let promptTokenCount: number | undefined
  let responseTokenCount: number | undefined
  let partial: { batchesTotal: number; batchesSucceeded: number; batchesFailed: number } | undefined

  if (documentId) {
    const batched = await runBatchedDocumentExtraction(source, env, fetcher, logger, documentType)
    if (batched.batchesSucceeded === 0) {
      // Every batch failed -- a total failure, reported exactly like the
      // chat/briefing path's own all-or-nothing failure (task-14 taxonomy,
      // run marked 'failed'). batches.length >= 1 whenever source is
      // non-empty (already checked above), so lastFailureError is set.
      return await reportExtractionFailure(batched.lastFailureError, run.id, env, jwt, fetcher, logger, now, origin)
    }
    rawCandidatesUncapped = batched.rawCandidates
    promptTokenCount = batched.promptTokenCount
    responseTokenCount = batched.responseTokenCount
    if (batched.batchesFailed > 0) {
      partial = { batchesTotal: batched.batchesTotal, batchesSucceeded: batched.batchesSucceeded, batchesFailed: batched.batchesFailed }
    }
  } else {
    try {
      const attempt = await runExtractionAttempt(source, env, fetcher, logger)
      rawCandidatesUncapped = attempt.rawCandidates
      promptTokenCount = attempt.promptTokenCount
      responseTokenCount = attempt.responseTokenCount
    } catch (error) {
      return await reportExtractionFailure(error, run.id, env, jwt, fetcher, logger, now, origin)
    }
  }

  // Task 14 fix: MAX_CANDIDATES_PER_RUN is enforced HERE, in code, not via
  // the response schema's own maxItems (see buildExtractionResponseSchema's
  // own comment for why -- the provider rejects the schema-level bound as
  // too complex to serve). Task 16-fix2: for the document path this now
  // caps the MERGED total across all successful batches -- "enforced
  // application-level after the merge" -- the same single enforcement
  // point, now shared by both paths instead of duplicated.
  const rawCandidates = rawCandidatesUncapped.slice(0, MAX_CANDIDATES_PER_RUN)
  const normalized = rawCandidates.map((candidate) => normalizeCandidate(candidate, refIdKinds))
  const validCandidates = normalized.filter((candidate): candidate is ValidCandidate => candidate !== null)
  const droppedCount = normalized.length - validCandidates.length

  // Task 18, B1: fetch this user's existing overlap-eligible records ONCE
  // per run (not once per candidate), scoped to only the kinds actually
  // present among this run's valid candidates. Best-effort: a read
  // failure here degrades to "no overlap suggestions this run" rather than
  // failing the whole run -- the extraction itself already succeeded.
  const existingRecordsForOverlap = await readExistingRecordsForOverlapCheck(
    validCandidates.map((c) => c.kind),
    env,
    jwt,
    fetcher,
  ).catch((error: unknown) => {
    logger.error?.(`[PersonalMemory] overlap-check read failed (continuing without overlap suggestions): ${(error as Error).message}`)
    return [] as ExistingRecordForOverlap[]
  })

  let acceptedCount = 0
  const results: Array<{ kind: string; outcome: string }> = []
  for (const candidate of validCandidates) {
    try {
      const fingerprint = await computeContentFingerprint(candidate.kind, candidate.content)
      const candidateSummary = typeof candidate.content.summary === 'string' ? candidate.content.summary : ''
      const possibleUpdateOfId = candidateSummary
        ? await findPossibleUpdateTarget(candidate.kind, candidateSummary, existingRecordsForOverlap, env, fetcher, logger)
        : null
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
          p_possible_update_of_id: possibleUpdateOfId,
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
  // Task 16-fix2, FIX 3: the run row itself stays 'completed' even for a
  // partial run -- it DID complete, and whatever candidates could be
  // extracted WERE persisted (the honest alternative to all-or-nothing
  // failing). The partial signal lives in the response body (outcome/code/
  // batch counts below) and in this log line for wrangler tail visibility;
  // it deliberately does not require a schema change to the 'completed' |
  // 'failed' outcome CHECK constraint (personal_memory_extraction_runs,
  // 20260808000000_personal_memory_records.sql) -- a partial run is a
  // completed run with fewer inputs than requested, not a new DB-level
  // state.
  await restPatchAsUser(
    env,
    jwt,
    `personal_memory_extraction_runs?id=eq.${run.id}`,
    {
      completed_at: completedAt,
      prompt_token_count: promptTokenCount ?? null,
      response_token_count: responseTokenCount ?? null,
      candidate_count: rawCandidates.length,
      accepted_count: acceptedCount,
      dropped_count: droppedCount,
      outcome: 'completed',
    },
    fetcher,
  ).catch((error) => logger.error?.(`[PersonalMemory] run completion update failed: ${(error as Error).message}`))

  logger.info?.(
    `[PersonalMemory] runId=${run.id} sourceItems=${source.length} candidates=${rawCandidates.length} accepted=${acceptedCount} dropped=${droppedCount}` +
      (partial ? ` outcome=partial batchesTotal=${partial.batchesTotal} batchesSucceeded=${partial.batchesSucceeded} batchesFailed=${partial.batchesFailed}` : ''),
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
      // Task 16-fix2, FIX 3: EXTRACTION_PARTIAL is NOT part of
      // ProviderFailureTaxonomy (that taxonomy is only for a TOTAL failure,
      // still reported via reportExtractionFailure/502 above) -- it's a
      // distinct, additive signal on an otherwise-normal 200 response,
      // present only when the document path had at least one failed batch
      // alongside at least one successful one.
      ...(partial
        ? { outcome: 'partial' as const, code: 'EXTRACTION_PARTIAL' as const, batchesTotal: partial.batchesTotal, batchesSucceeded: partial.batchesSucceeded, batchesFailed: partial.batchesFailed }
        : { outcome: 'completed' as const }),
    },
    200,
    origin,
  )
}
