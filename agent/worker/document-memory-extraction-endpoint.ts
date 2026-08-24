// SmartFlow -- Document-Sourced Memory, slice 1 (task 16) + slice 2 (task
// 18, A3: type-aware chunking + a native_text path for plain-text
// documents, both added below without touching slice 1's PDF/resume
// behaviour).
//
// POST /documents/extract-memory -- an authenticated, production-capable
// Worker route mirroring personal-memory-extraction-endpoint.ts's and
// context-derivation-endpoint.ts's structure and posture: Bearer-token
// auth via authenticateUser, task 14's provider-error taxonomy, and the
// same redaction-guard discipline for every Gemini call.
//
// Unlike those two routes, this one's Supabase REST calls use SERVICE_ROLE
// throughout, not the requesting user's forwarded JWT -- by explicit task
// design ("verify via service-role lookup, fail closed"), and because this
// route's writes (document_chunks) are service-role-only by RLS (browser
// INSERT/UPDATE/DELETE revoked -- see
// 20260811000000_document_chunks_pgvector.sql). Ownership is therefore
// verified in application code (explicit `user_id = eq.<authenticated
// userId>` filter on every query), not delegated to RLS -- the same
// defense-in-depth posture create_personal_memory_record's own SQL already
// applies to its ref-id membership checks.
//
// This module cannot import src/features/documents/* or
// src/features/personal-memory/* (agent/worker is a separate,
// zero-runtime-dependency deployable unit -- see every other file in this
// directory's own header comment for the same statement). Nothing here
// depends on a PDF-parsing library: PO-approved amendment to task 16's own
// decision 1 accepts sending the PDF to Gemini and asking for a verbatim
// plain-text transcription, subject to the M1-M3 mitigations below, rather
// than adding a dependency this Worker has never had one of.

// Task 19 (Attach file in Flow AI): exported so chat-attachment-context.ts
// can apply the SAME ceiling to an in-conversation attachment's service-role
// download -- a single source of truth, not a second magic number, even
// though the browser-side chat attach control applies its own tighter 10MB
// cap before upload (chatAttachmentValidation.ts) -- this is defense in
// depth against a documentId referencing a larger document uploaded some
// other way (e.g. directly via the Documents page).
// Task PA-02: EMBEDDING_DIMENSIONS comes from embeddingConfig.ts (one
// source of truth shared with personal-memory-extraction-endpoint.ts)
// instead of being declared here -- see that module's own header comment
// for why the prior "zero-cross-import convention" justification for the
// duplication did not reflect an actual rule. EMBEDDING_MODEL/l2Normalize
// moved on: ADR-0018 S3 migrated embedChunk to GeminiEmbeddingProvider,
// which now owns both (see that adapter's own header comment).
import { EMBEDDING_DIMENSIONS } from './embeddingConfig'
import { createProviders } from './providers/createProviders'
import { ProviderRequestError, ProviderUnavailableError } from './provider-errors'
import { EmbeddingDimensionMismatchError } from './providers/gemini/GeminiEmbeddingProvider'
import { ProviderCallError, type ProviderFailureTaxonomy } from './providers/providerFailureTaxonomy'
import type { EmbeddingResult, TextGenerationResult } from './providers/types'

export const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024 // matches docs_file_size_error's existing 20MB upload cap (src/i18n/index.ts); task 18 renamed from MAX_PDF_BYTES -- this bound now also gates plain-text uploads
const MAX_EXTRACTED_TEXT_CHARS = 20000 // resumes are short documents; generous headroom for a multi-page CV, still bounded
const MAX_CHUNK_CHARS = 3000
const EMBEDDING_NORM_EPSILON = 1e-3 // sanity-check tolerance for the post-normalization unit norm
// Task 18, A3: extraction_method is now chosen per document rather than a
// single fixed constant -- 'model_transcription' for PDFs (unchanged),
// 'native_text' for plain-text documents, which skip the Gemini
// transcription call entirely (see the route handler's own branch below and
// 20260812000000_document_types_and_sensitivity.sql's widened CHECK).
type ExtractionMethod = 'model_transcription' | 'native_text'

export interface DocumentMemoryExtractionEnv {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_KEY: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

export interface DocumentMemoryExtractionDependencies {
  fetcher?: typeof fetch
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

// Mirrors personal-memory-extraction-endpoint.ts's errorResponse exactly --
// see that file's own comment for why providerStatus/providerDetail are
// safe to expose here (this whole route requires a valid Supabase bearer
// token).
function errorResponse(code: string, message: string, status: number, origin: string, extra?: Record<string, unknown>): Response {
  return jsonResponse({ error: { code, message, ...extra } }, status, origin)
}

// ADR-0018 S1: the "task 14" taxonomy/error class now live in
// providerFailureTaxonomy.ts (unified with context-derivation-endpoint.ts's
// former duplicate) -- re-exported here, not moved, so every existing
// importer of THIS file (chat-attachment-context.ts's own ProviderCallError
// handling, task 19) keeps working unchanged.
export { ProviderCallError, type ProviderFailureTaxonomy }

export const TAXONOMY_MESSAGES: Record<ProviderFailureTaxonomy, string> = {
  PROVIDER_REQUEST_REJECTED: 'The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your data.',
  PROVIDER_UNAVAILABLE: 'The AI model is temporarily unavailable. Please try again in a moment.',
  MODEL_OUTPUT_UNUSABLE: 'The model did not return a usable transcription. Please try again.',
}

function truncateForLog(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}...` : collapsed
}

/** Mirrors context-derivation-endpoint.ts's own authenticateUser exactly. */
async function authenticateUser(
  request: Request,
  env: DocumentMemoryExtractionEnv,
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

function resolveConfig(env: DocumentMemoryExtractionEnv): { ready: true } | { ready: false; message: string } {
  if (!env.SUPABASE_URL?.trim()) return { ready: false, message: 'SUPABASE_URL is required.' }
  if (!env.SUPABASE_ANON_KEY?.trim()) return { ready: false, message: 'SUPABASE_ANON_KEY is required.' }
  if (!env.SUPABASE_SERVICE_KEY?.trim()) return { ready: false, message: 'SUPABASE_SERVICE_KEY is required.' }
  if (!env.GEMINI_API_KEY?.trim()) return { ready: false, message: 'GEMINI_API_KEY is required.' }
  if (!env.GEMINI_MODEL?.trim()) return { ready: false, message: 'GEMINI_MODEL is required.' }
  return { ready: true }
}

// ---------------------------------------------------------------------------
// Service-role Supabase REST helpers -- see file header for why this route
// uses service role throughout instead of forwarding the user's JWT.
// ---------------------------------------------------------------------------

// Task 19: exported for chat-attachment-context.ts's own service-role
// document lookup -- same ownership-verification posture (explicit
// user_id=eq.<authenticated userId> filter applied by the caller), not a
// second copy of this REST helper.
export async function restGetServiceRole<T>(env: DocumentMemoryExtractionEnv, path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, apikey: env.SUPABASE_SERVICE_KEY, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Supabase REST error (${path}): ${response.status}`)
  return response.json() as Promise<T>
}

async function restPostServiceRole<T>(env: DocumentMemoryExtractionEnv, table: string, body: unknown, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      apikey: env.SUPABASE_SERVICE_KEY,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Supabase POST error (${table}): ${response.status} ${text}`)
  }
  return response.json() as Promise<T>
}

async function restDeleteServiceRole(env: DocumentMemoryExtractionEnv, path: string, fetcher: typeof fetch): Promise<void> {
  const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, apikey: env.SUPABASE_SERVICE_KEY, Prefer: 'return=minimal' },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Supabase DELETE error (${path}): ${response.status} ${text}`)
  }
}

// Task 19: exported for chat-attachment-context.ts's reuse -- an attached
// document lives in the SAME storage bucket/path convention as any other
// document (documentsService.ts), so the download mechanics are identical.
export async function downloadFromStorage(env: DocumentMemoryExtractionEnv, storagePath: string, fetcher: typeof fetch): Promise<ArrayBuffer> {
  const response = await fetcher(`${env.SUPABASE_URL}/storage/v1/object/documents/${storagePath}`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, apikey: env.SUPABASE_SERVICE_KEY },
  })
  if (!response.ok) throw new Error(`Storage download error (${storagePath}): ${response.status}`)
  return response.arrayBuffer()
}

// Task 19: exported for chat-attachment-context.ts's image branch (sends the
// downloaded bytes as inlineData, same encoding this file already uses for
// a PDF's transcription call).
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// ---------------------------------------------------------------------------
// UNTRUSTED-INPUT bounds -- the transcribed text is document content the
// model read from a user-supplied PDF; it is data, never instructions, no
// matter what it contains (see the M3 injection smoke test in
// document-memory-extraction-endpoint.test.ts). Mirrors
// github-integration.ts's containsBinaryMarkers character-class logic, but
// STRIPS rather than rejects -- a resume transcription is expected to be
// ordinary prose, and control characters in it are far more likely to be a
// transcription artifact than a real attack; a hard reject would punish the
// user for a model quirk it did not cause.
// ---------------------------------------------------------------------------
export function stripControlCharacters(text: string): string {
  let result = ''
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    const isControl = code < 32 && code !== 9 && code !== 10 && code !== 13
    const isDel = code === 127
    if (!isControl && !isDel) result += text[index]
  }
  return result
}

export function boundExtractedText(rawText: string): string {
  const stripped = stripControlCharacters(rawText).trim()
  return stripped.length > MAX_EXTRACTED_TEXT_CHARS ? stripped.slice(0, MAX_EXTRACTED_TEXT_CHARS) : stripped
}

// ---------------------------------------------------------------------------
// Transcription -- M1 (PO amendment to task 16's decision 1): minimal
// instruction, temperature 0, response always treated as untrusted
// regardless of content. Mirrors callGeminiForExtraction's / /documents/
// analyze's inlineData pattern and the full task-14 redaction-guard
// discipline: the API key lives only in the URL GeminiTextGenerationProvider
// builds internally (ADR-0018 S1) -- neither that URL nor GEMINI_API_KEY
// itself is ever part of a thrown error's .message, so nothing this
// function logs below can leak it.
// ---------------------------------------------------------------------------
const TRANSCRIPTION_INSTRUCTION = 'Return the complete plain text of this document verbatim. Output nothing else.'

// Task 19: exported so chat-attachment-context.ts's PDF branch reuses this
// EXACT transcription call (same M1-M3 mitigations, same untrusted-input
// discipline) rather than a second, drifting copy.
export async function transcribePdf(
  pdfBase64: string,
  env: DocumentMemoryExtractionEnv,
  fetcher: typeof fetch,
  logger: Pick<Console, 'info' | 'error'>,
): Promise<string> {
  // ADR-0018 S1b: transcribePdf always carries a PDF attachment -- pinned
  // to Gemini (pinTextProvider: 'gemini' ignores AI_TEXT_PROVIDER
  // entirely) rather than relying on WorkersAITextGenerationProvider's
  // generic attachments-unsupported rejection, so a deployment that flips
  // the env default to 'workers-ai' for chat cannot also silently break
  // document transcription.
  const provider = createProviders(env, fetcher, { pinTextProvider: 'gemini' }).text

  let result: TextGenerationResult
  try {
    result = await provider.generateText({
      turns: [{ role: 'user', content: TRANSCRIPTION_INSTRUCTION }],
      maxOutputTokens: 8192,
      temperature: 0,
      // ADR-0018 S1 follow-up: restores the original raw-fetch part order
      // (PDF part BEFORE the text instruction) -- S1's adapter briefly
      // flipped this to "after" via an unverified assumption. See
      // GeminiTextGenerationProvider.ts's header comment.
      attachmentPosition: 'before',
      providerOptions: {
        inlineDataAttachment: { mimeType: 'application/pdf', data: pdfBase64 },
      },
    })
  } catch (err) {
    // ADR-0018 S1: fetchGeminiOrThrow's own binary classification (network/
    // 429/5xx -> ProviderUnavailableError, other non-ok -> ProviderRequestError)
    // is deliberately narrower than this route's three-way taxonomy -- a 429
    // is retryable-per-provider-errors.ts but was NEVER >=500, so this
    // route's own long-standing `status >= 500` rule (unchanged below) must
    // keep classifying it PROVIDER_REQUEST_REJECTED exactly as before. Both
    // thrown classes carry the real status/body (S1 addition to
    // provider-errors.ts) precisely so this reclassification is possible
    // without re-deriving anything from the error message string.
    if (err instanceof ProviderUnavailableError && err.status === undefined) {
      logger.error?.(`[DocumentMemory] transcription call failed before any response (network): error=${err.message}`)
      throw new ProviderCallError('The AI model provider could not be reached.', 'PROVIDER_UNAVAILABLE')
    }
    if (err instanceof ProviderUnavailableError || err instanceof ProviderRequestError) {
      const status = err.status as number
      const bodyText = err.body ?? ''
      let providerError: { status?: unknown; message?: unknown; details?: unknown } | undefined
      try {
        providerError = (JSON.parse(bodyText) as { error?: typeof providerError }).error
      } catch {
        // Not JSON -- providerError stays undefined, bodyText itself is still used below.
      }
      const providerMessage = typeof providerError?.message === 'string' ? providerError.message : bodyText
      logger.error?.(
        `[DocumentMemory] transcription provider rejected request: httpStatus=${status} ` +
          `providerStatus=${String(providerError?.status ?? 'unknown')} message=${providerMessage}`,
      )
      const taxonomy: ProviderFailureTaxonomy = status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REQUEST_REJECTED'
      throw new ProviderCallError(`Transcription request failed with status ${status}.`, taxonomy, status, truncateForLog(providerMessage, 300))
    }
    throw err
  }

  if (result.finishReason !== 'stop') {
    throw new ProviderCallError(
      `Transcription did not finish safely (finishReason=${result.finishReason}).`,
      'MODEL_OUTPUT_UNUSABLE',
      undefined,
      result.finishReason,
    )
  }
  if (!result.text) throw new ProviderCallError('Model returned no transcription text.', 'MODEL_OUTPUT_UNUSABLE')

  const bounded = boundExtractedText(result.text)
  // M1: server-side diagnostic logging of the extracted length + word-count
  // stats. Page count is not logged -- a plain-text transcription carries
  // no page-break markers, so an honest page count is not obtainable from
  // this method without a native text-layer extractor (see the task 16
  // report's decision 1 amendment); logging a fabricated page count would
  // itself be a small provenance dishonesty of the kind M2 exists to avoid.
  logger.info?.(`[DocumentMemory] transcription complete: chars=${bounded.length} words=${bounded.split(/\s+/).filter(Boolean).length}`)
  return bounded
}

// ---------------------------------------------------------------------------
// Chunking -- section heuristics (EN/DE headers) with a size-based fallback.
// Exported for direct unit testing.
// ---------------------------------------------------------------------------
export interface TextChunk {
  sectionLabel: string
  content: string
}

const SECTION_HEADER_PATTERNS: RegExp[] = [
  /^(work\s+)?experience$/i,
  /^employment(\s+history)?$/i,
  /^education$/i,
  /^skills?$/i,
  /^summary$/i,
  /^profile$/i,
  /^certifications?$/i,
  /^languages?$/i,
  /^berufserfahrung$/i,
  /^erfahrung$/i,
  /^ausbildung$/i,
  /^bildung$/i,
  /^kenntnisse$/i,
  /^f[äa]higkeiten$/i,
  /^qualifikationen$/i,
  /^zusammenfassung$/i,
  /^profil$/i,
  /^sprachen$/i,
  /^zertifikate$/i,
]

function isSectionHeaderLine(line: string): boolean {
  const trimmed = line.trim().replace(/:$/, '')
  if (trimmed.length === 0 || trimmed.length > 40) return false
  return SECTION_HEADER_PATTERNS.some((pattern) => pattern.test(trimmed))
}

/** Splits an already-bounded chunk's content further if it exceeds MAX_CHUNK_CHARS, keeping the same sectionLabel. */
function splitOversizedChunk(chunk: TextChunk): TextChunk[] {
  if (chunk.content.length <= MAX_CHUNK_CHARS) return [chunk]
  const parts: TextChunk[] = []
  for (let start = 0; start < chunk.content.length; start += MAX_CHUNK_CHARS) {
    parts.push({ sectionLabel: chunk.sectionLabel, content: chunk.content.slice(start, start + MAX_CHUNK_CHARS).trim() })
  }
  return parts.filter((part) => part.content.length > 0)
}

/** Bounded size-based chunking, no structural cue -- the fallback for every non-resume type (and for a resume that didn't have enough recognizable headers). */
function chunkBySize(text: string): TextChunk[] {
  const chunks: TextChunk[] = []
  for (let start = 0, index = 1; start < text.length; start += MAX_CHUNK_CHARS, index += 1) {
    const content = text.slice(start, start + MAX_CHUNK_CHARS).trim()
    if (content.length > 0) chunks.push({ sectionLabel: `Part ${index}`, content })
  }
  return chunks
}

// Task 18, A3: type-aware chunking. 'resume' keeps slice 1's
// section-header heuristic unchanged (SECTION_HEADER_PATTERNS below, with
// its own <2-headers-found fallback to size-based chunking, also
// unchanged). Every OTHER type (financial/personal/business) -- and any
// document with no type at all -- skips the header heuristic entirely and
// always uses bounded size-based chunking: "Experience"/"Education"-style
// resume headers are not just unhelpful but actively misleading for e.g. a
// financial statement, which could coincidentally contain a line that
// happens to match one of those patterns (a "Summary" section, a
// "Zusammenfassung" heading) and get mis-sectioned as if it were resume
// content. Deliberately NOT building a per-type structural parser in this
// slice (task instruction: "do NOT build elaborate per-type parsers") --
// financial/personal/business documents all get the identical, honest,
// bounded fallback rather than a bespoke cue for one of them.
export function chunkDocumentText(text: string, documentType: string | null): TextChunk[] {
  if (documentType !== 'resume') return chunkBySize(text)

  const lines = text.split(/\r?\n/)
  const sectioned: TextChunk[] = []
  let currentLabel: string | null = null
  let currentLines: string[] = []

  const flush = () => {
    const content = currentLines.join('\n').trim()
    if (currentLabel && content.length > 0) sectioned.push({ sectionLabel: currentLabel, content })
    currentLines = []
  }

  for (const line of lines) {
    if (isSectionHeaderLine(line)) {
      flush()
      currentLabel = line.trim().replace(/:$/, '')
    } else {
      currentLines.push(line)
    }
  }
  flush()

  // Fallback: fewer than 2 recognized section headers found -- size-based
  // chunking over the whole bounded text instead (per task: "fall back to
  // size-based chunks").
  if (sectioned.length < 2) return chunkBySize(text)

  return sectioned.flatMap(splitOversizedChunk)
}

// ---------------------------------------------------------------------------
// Embedding -- reuses the same taxonomy + redaction-guard discipline as
// transcribePdf above.
// ---------------------------------------------------------------------------
// ADR-0018 S3: migrated to the EmbeddingProvider adapter -- normalization
// now lives there (once); this function's own job shrinks to the two
// judgment calls Decision 3's precedent keeps at the call site (shape,
// post-normalization unit-norm sanity) plus this file's own three-way
// taxonomy reclassification, identical in pattern to S2's
// callGeminiForDerivation (context-derivation-endpoint.ts).
async function embedChunk(
  text: string,
  env: DocumentMemoryExtractionEnv,
  fetcher: typeof fetch,
  logger: Pick<Console, 'info' | 'error'>,
): Promise<number[]> {
  // REDACTED_ENDPOINT_LABEL mirrors S2's callGeminiForDerivation: a fixed,
  // key-free label -- the adapter owns URL construction internally now and
  // never exposes it.
  const REDACTED_ENDPOINT_LABEL = 'embedContent'

  let result: EmbeddingResult
  try {
    result = await createProviders(env, fetcher).embedding.embed([text])
  } catch (err) {
    // ADR-0018 Decision 4: a dimension-mismatch is OUR config bug, not a
    // provider outage -- never reclassified into this file's own
    // provider-failure taxonomy (that would misreport it as
    // PROVIDER_UNAVAILABLE/PROVIDER_REQUEST_REJECTED, and it would be
    // wrongly eligible for recordProviderFailure's persistence, which the
    // adapter itself already guarantees it never triggers). Propagated
    // as-is; the route handler's own catch (below) maps it to a distinct
    // 500, not this taxonomy's 502.
    if (err instanceof EmbeddingDimensionMismatchError) throw err
    if (err instanceof ProviderUnavailableError && err.status === undefined) {
      logger.error?.(`[DocumentMemory] embedding call failed before any response (network): endpoint=${REDACTED_ENDPOINT_LABEL} error=${(err as Error).message}`)
      throw new ProviderCallError('The AI model provider could not be reached.', 'PROVIDER_UNAVAILABLE')
    }
    if (err instanceof ProviderUnavailableError || err instanceof ProviderRequestError) {
      const status = err.status as number
      const bodyText = err.body ?? ''
      let providerError: { status?: unknown; message?: unknown } | undefined
      try {
        providerError = (JSON.parse(bodyText) as { error?: typeof providerError }).error
      } catch {
        // Not JSON -- providerError stays undefined, bodyText itself is still used below.
      }
      const providerMessage = typeof providerError?.message === 'string' ? providerError.message : bodyText
      logger.error?.(`[DocumentMemory] embedding provider rejected request: endpoint=${REDACTED_ENDPOINT_LABEL} httpStatus=${status} message=${providerMessage}`)
      const taxonomy: ProviderFailureTaxonomy = status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REQUEST_REJECTED'
      throw new ProviderCallError(`Embedding request failed with status ${status}.`, taxonomy, status, truncateForLog(providerMessage, 300))
    }
    throw err
  }

  const values = result.vectors[0] ?? []
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new ProviderCallError(`Embedding response had an unexpected shape (expected ${EMBEDDING_DIMENSIONS} numeric values).`, 'MODEL_OUTPUT_UNUSABLE')
  }
  // Sanity check ONLY -- the adapter already normalized this vector once;
  // re-calling l2Normalize here would apply the same math twice. A norm
  // meaningfully off from 1 can only mean the adapter's own degenerate
  // (all-zero) fallback fired, which the adapter itself never normalizes
  // away (see its own comment).
  const norm = vectorNorm(values)
  if (Math.abs(norm - 1) > EMBEDDING_NORM_EPSILON) {
    throw new ProviderCallError(`Embedding failed to normalize to unit length (norm=${norm}).`, 'MODEL_OUTPUT_UNUSABLE')
  }
  return values
}

function vectorNorm(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0))
}

function embeddingToPgvectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function handleDocumentMemoryExtractionRequest(
  request: Request,
  env: DocumentMemoryExtractionEnv,
  dependencies: DocumentMemoryExtractionDependencies = {},
): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported.', 405, origin)

  const fetcher = dependencies.fetcher ?? globalThis.fetch
  const logger = dependencies.logger ?? console

  const config = resolveConfig(env)
  if (config.ready === false) return errorResponse('CONFIGURATION_MISSING', config.message, 503, origin)

  const authResult = await authenticateUser(request, env, fetcher).catch(() => null)
  if (!authResult) return errorResponse('UNAUTHORIZED', 'A valid Supabase bearer token is required.', 401, origin)
  const { userId } = authResult

  let body: unknown
  try {
    body = JSON.parse(await request.text())
  } catch {
    return errorResponse('INVALID_JSON', 'Request body must contain valid JSON.', 400, origin)
  }
  const documentId = (body as { documentId?: unknown } | null)?.documentId
  if (typeof documentId !== 'string' || !documentId) {
    return errorResponse('INVALID_REQUEST', 'documentId is required.', 400, origin)
  }

  // Ownership: explicit service-role lookup filtered by BOTH id and the
  // authenticated user_id (task 16 design: "must belong to the
  // authenticated user -- verify via service-role lookup, fail closed").
  // A document that does not exist and one that exists but belongs to
  // someone else both simply return zero rows here -- deliberately
  // indistinguishable to the caller, exactly as context-derivation-
  // endpoint.ts's PROJECT_NOT_FOUND already treats the identical ambiguity
  // for projects.
  let documentRows: Array<{ id: string; storage_path: string; file_name: string; mime_type: string | null; type: string | null }>
  try {
    documentRows = await restGetServiceRole(
      env,
      `documents?id=eq.${encodeURIComponent(documentId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,storage_path,file_name,mime_type,type`,
      fetcher,
    )
  } catch (error) {
    logger.error?.(`[DocumentMemory] document read failed: ${(error as Error).message}`)
    return errorResponse('DOCUMENT_READ_FAILED', 'Unable to read the document.', 502, origin)
  }
  const document = documentRows[0]
  if (!document) return errorResponse('DOCUMENT_NOT_FOUND', 'Document was not found for this user.', 404, origin)

  // Task 18, A3: widened from PDF-only to PDF + plain text -- a .txt
  // document (e.g. a bank statement export) never needs a model
  // transcription step, see the native_text branch below.
  const isPdfDocument = document.mime_type === 'application/pdf'
  const isPlainTextDocument = document.mime_type === 'text/plain'
  if (!isPdfDocument && !isPlainTextDocument) {
    return errorResponse('UNSUPPORTED_DOCUMENT_TYPE', 'Only PDF or plain-text documents can be extracted to personal memory.', 400, origin)
  }

  // Storage fetch + size bound -- before spending anything on a Gemini
  // call.
  let fileBytes: ArrayBuffer
  try {
    fileBytes = await downloadFromStorage(env, document.storage_path, fetcher)
  } catch (error) {
    logger.error?.(`[DocumentMemory] storage download failed: ${(error as Error).message}`)
    return errorResponse('STORAGE_READ_FAILED', 'Unable to read the document from storage.', 502, origin)
  }
  if (fileBytes.byteLength === 0) {
    return errorResponse('NO_SOURCE_MATERIAL', 'This document is empty.', 422, origin)
  }
  if (fileBytes.byteLength > MAX_SOURCE_FILE_BYTES) {
    return errorResponse('DOCUMENT_TOO_LARGE', `Document exceeds the ${Math.floor(MAX_SOURCE_FILE_BYTES / (1024 * 1024))}MB extraction limit.`, 413, origin)
  }

  let extractedText: string
  let extractionMethod: ExtractionMethod
  if (isPlainTextDocument) {
    // Task 18, A3: the document's bytes ARE the text -- no model call, no
    // transcription taxonomy to handle, and more honest provenance
    // (native_text) than laundering a plain-text read through a model.
    extractedText = boundExtractedText(new TextDecoder('utf-8', { fatal: false }).decode(fileBytes))
    extractionMethod = 'native_text'
  } else {
    const pdfBase64 = arrayBufferToBase64(fileBytes)
    try {
      extractedText = await transcribePdf(pdfBase64, env, fetcher, logger)
    } catch (error) {
      const providerError = error instanceof ProviderCallError ? error : null
      const taxonomy: ProviderFailureTaxonomy = providerError?.taxonomy ?? 'MODEL_OUTPUT_UNUSABLE'
      logger.error?.(`[DocumentMemory] transcription failed: taxonomy=${taxonomy} ${(error as Error).message}`)
      return errorResponse(taxonomy, TAXONOMY_MESSAGES[taxonomy], 502, origin, {
        providerStatus: providerError?.providerStatus,
        providerDetail: providerError?.providerDetail,
      })
    }
    extractionMethod = 'model_transcription'
  }

  if (extractedText.length === 0) {
    return errorResponse('NO_SOURCE_MATERIAL', 'No readable text was found in this document.', 422, origin)
  }

  const chunks = chunkDocumentText(extractedText, document.type)
  if (chunks.length === 0) {
    return errorResponse('NO_SOURCE_MATERIAL', 'No readable text was found in this document.', 422, origin)
  }

  const embeddedChunks: Array<{ sectionLabel: string; content: string; embedding: number[] }> = []
  for (const chunk of chunks) {
    try {
      const embedding = await embedChunk(chunk.content, env, fetcher, logger)
      embeddedChunks.push({ sectionLabel: chunk.sectionLabel, content: chunk.content, embedding })
    } catch (error) {
      // ADR-0018 Decision 4: a config bug (provider.dimensions !==
      // EMBEDDING_DIMENSIONS), not a provider outage -- distinct 500, not
      // this taxonomy's 502, and NOT recorded via recordProviderFailure
      // (already guaranteed by the adapter itself never calling it for
      // this error). Checked first, before the taxonomy fallback below
      // would otherwise misreport it as MODEL_OUTPUT_UNUSABLE.
      if (error instanceof EmbeddingDimensionMismatchError) {
        logger.error?.(`[DocumentMemory] embedding provider misconfigured: ${error.message}`)
        return errorResponse('EMBEDDING_CONFIGURATION_ERROR', 'The embedding provider is misconfigured.', 500, origin, {
          providerDetail: truncateForLog(error.message, 300),
        })
      }
      const providerError = error instanceof ProviderCallError ? error : null
      const taxonomy: ProviderFailureTaxonomy = providerError?.taxonomy ?? 'MODEL_OUTPUT_UNUSABLE'
      logger.error?.(`[DocumentMemory] embedding failed: taxonomy=${taxonomy} ${(error as Error).message}`)
      return errorResponse(taxonomy, TAXONOMY_MESSAGES[taxonomy], 502, origin, {
        providerStatus: providerError?.providerStatus,
        providerDetail: providerError?.providerDetail,
      })
    }
  }

  // Re-extraction is idempotent by replacement, not accumulation: clear any
  // prior chunk set for this document before writing the fresh one. Chunks
  // are derived data (cheaply regenerable), unlike personal_memory_records
  // which are never touched here.
  try {
    await restDeleteServiceRole(env, `document_chunks?document_id=eq.${encodeURIComponent(documentId)}`, fetcher)
  } catch (error) {
    logger.error?.(`[DocumentMemory] prior-chunk cleanup failed: ${(error as Error).message}`)
    return errorResponse('CHUNK_WRITE_FAILED', 'Unable to store document chunks.', 502, origin)
  }

  try {
    await restPostServiceRole(
      env,
      'document_chunks',
      embeddedChunks.map((chunk, index) => ({
        user_id: userId,
        document_id: documentId,
        file_name: document.file_name,
        chunk_index: index,
        section_label: chunk.sectionLabel,
        content: chunk.content,
        extraction_method: extractionMethod,
        embedding: embeddingToPgvectorLiteral(chunk.embedding),
      })),
      fetcher,
    )
  } catch (error) {
    logger.error?.(`[DocumentMemory] chunk write failed: ${(error as Error).message}`)
    return errorResponse('CHUNK_WRITE_FAILED', 'Unable to store document chunks.', 502, origin)
  }

  logger.info?.(`[DocumentMemory] documentId=${documentId} fileName=${document.file_name} chunks=${embeddedChunks.length}`)

  return jsonResponse(
    { documentId, chunkCount: embeddedChunks.length, extractionMethod },
    200,
    origin,
  )
}
