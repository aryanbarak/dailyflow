// SmartFlow -- Document-Sourced Memory, slice 1 (task 16).
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

const MAX_PDF_BYTES = 20 * 1024 * 1024 // matches docs_file_size_error's existing 20MB upload cap (src/i18n/index.ts)
const MAX_EXTRACTED_TEXT_CHARS = 20000 // resumes are short documents; generous headroom for a multi-page CV, still bounded
const MAX_CHUNK_CHARS = 3000
const EMBEDDING_MODEL = 'gemini-embedding-001' // text-embedding-004 was retired Jan 2026 (task 16-fix); successor model
const EMBEDDING_DIMENSIONS = 768 // requested via outputDimensionality -- gemini-embedding-001's native output is 3072-dim
const EMBEDDING_NORM_EPSILON = 1e-3 // sanity-check tolerance for the post-normalization unit norm
const EXTRACTION_METHOD = 'model_transcription' as const // M2: the only value this slice ever writes -- see document_chunks.extraction_method's own comment

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

// Task 14 taxonomy, reused verbatim (same three values, same meaning) --
// mirrors context-derivation-endpoint.ts's own duplicated copy; this module
// cannot import that one either (zero-cross-import convention).
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

const TAXONOMY_MESSAGES: Record<ProviderFailureTaxonomy, string> = {
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

async function restGetServiceRole<T>(env: DocumentMemoryExtractionEnv, path: string, fetcher: typeof fetch): Promise<T> {
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

async function downloadFromStorage(env: DocumentMemoryExtractionEnv, storagePath: string, fetcher: typeof fetch): Promise<ArrayBuffer> {
  const response = await fetcher(`${env.SUPABASE_URL}/storage/v1/object/documents/${storagePath}`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, apikey: env.SUPABASE_SERVICE_KEY },
  })
  if (!response.ok) throw new Error(`Storage download error (${storagePath}): ${response.status}`)
  return response.arrayBuffer()
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
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
// discipline: never logs modelUrl.toString() or response.url (both carry
// GEMINI_API_KEY as a query param); every log line uses only
// modelUrl.pathname.
// ---------------------------------------------------------------------------
const TRANSCRIPTION_INSTRUCTION = 'Return the complete plain text of this document verbatim. Output nothing else.'

async function transcribePdf(
  pdfBase64: string,
  env: DocumentMemoryExtractionEnv,
  fetcher: typeof fetch,
  logger: Pick<Console, 'info' | 'error'>,
): Promise<string> {
  const modelUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL ?? '')}:generateContent`)
  modelUrl.searchParams.set('key', env.GEMINI_API_KEY ?? '')

  let response: Response
  try {
    response = await fetcher(modelUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } }, { text: TRANSCRIPTION_INSTRUCTION }],
        }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0 },
      }),
    })
  } catch (networkError) {
    logger.error?.(`[DocumentMemory] transcription call failed before any response (network): path=${modelUrl.pathname} error=${(networkError as Error).message}`)
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
      `[DocumentMemory] transcription provider rejected request: path=${modelUrl.pathname} httpStatus=${response.status} ` +
        `providerStatus=${String(providerError?.status ?? 'unknown')} message=${providerMessage}`,
    )
    const taxonomy: ProviderFailureTaxonomy = response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REQUEST_REJECTED'
    throw new ProviderCallError(`Transcription request failed with status ${response.status}.`, taxonomy, response.status, truncateForLog(providerMessage, 300))
  }

  const data = (await response.json()) as {
    candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown }> } }>
  }
  const candidate = data.candidates?.[0]
  if (!candidate) throw new ProviderCallError('Model returned no candidate.', 'MODEL_OUTPUT_UNUSABLE')
  if (candidate.finishReason !== undefined && candidate.finishReason !== 'STOP') {
    throw new ProviderCallError(
      `Transcription did not finish safely (finishReason=${String(candidate.finishReason)}).`,
      'MODEL_OUTPUT_UNUSABLE',
      undefined,
      String(candidate.finishReason),
    )
  }
  const text = candidate.content?.parts?.[0]?.text
  if (typeof text !== 'string') throw new ProviderCallError('Model returned no transcription text.', 'MODEL_OUTPUT_UNUSABLE')

  const bounded = boundExtractedText(text)
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

export function chunkResumeText(text: string): TextChunk[] {
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
  if (sectioned.length < 2) {
    const fallback: TextChunk[] = []
    for (let start = 0, index = 1; start < text.length; start += MAX_CHUNK_CHARS, index += 1) {
      const content = text.slice(start, start + MAX_CHUNK_CHARS).trim()
      if (content.length > 0) fallback.push({ sectionLabel: `Part ${index}`, content })
    }
    return fallback;
  }

  return sectioned.flatMap(splitOversizedChunk)
}

// ---------------------------------------------------------------------------
// Embedding -- reuses the same taxonomy + redaction-guard discipline as
// transcribePdf above.
// ---------------------------------------------------------------------------
async function embedChunk(
  text: string,
  env: DocumentMemoryExtractionEnv,
  fetcher: typeof fetch,
  logger: Pick<Console, 'info' | 'error'>,
): Promise<number[]> {
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
    logger.error?.(`[DocumentMemory] embedding call failed before any response (network): path=${modelUrl.pathname} error=${(networkError as Error).message}`)
    throw new ProviderCallError('The AI model provider could not be reached.', 'PROVIDER_UNAVAILABLE')
  }

  if (!response.ok) {
    const bodyText = await response.text()
    let providerError: { status?: unknown; message?: unknown } | undefined
    try {
      providerError = (JSON.parse(bodyText) as { error?: typeof providerError }).error
    } catch {
      // Not JSON -- providerError stays undefined.
    }
    const providerMessage = typeof providerError?.message === 'string' ? providerError.message : bodyText
    logger.error?.(`[DocumentMemory] embedding provider rejected request: path=${modelUrl.pathname} httpStatus=${response.status} message=${providerMessage}`)
    const taxonomy: ProviderFailureTaxonomy = response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REQUEST_REJECTED'
    throw new ProviderCallError(`Embedding request failed with status ${response.status}.`, taxonomy, response.status, truncateForLog(providerMessage, 300))
  }

  const data = (await response.json()) as { embedding?: { values?: unknown } }
  const values = data.embedding?.values
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS || !values.every((v) => typeof v === 'number')) {
    throw new ProviderCallError(`Embedding response had an unexpected shape (expected ${EMBEDDING_DIMENSIONS} numeric values).`, 'MODEL_OUTPUT_UNUSABLE')
  }

  const normalized = l2Normalize(values as number[])
  const norm = vectorNorm(normalized)
  if (Math.abs(norm - 1) > EMBEDDING_NORM_EPSILON) {
    throw new ProviderCallError(`Embedding failed to normalize to unit length (norm=${norm}).`, 'MODEL_OUTPUT_UNUSABLE')
  }
  return normalized
}

// gemini-embedding-001 at a non-default outputDimensionality is NOT
// unit-normalized by the provider (unlike its native 3072-dim output) --
// per Gemini docs, callers requesting a truncated dimensionality must
// normalize client-side. Deterministic, no provider dependence.
export function l2Normalize(values: readonly number[]): number[] {
  const norm = vectorNorm(values)
  if (norm === 0) return values.slice() as number[]
  return values.map((v) => v / norm)
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

  if (document.mime_type !== 'application/pdf') {
    return errorResponse('UNSUPPORTED_DOCUMENT_TYPE', 'Only PDF documents can be extracted to personal memory in this slice.', 400, origin)
  }

  // Storage fetch + size bound -- before spending anything on a Gemini
  // call.
  let pdfBytes: ArrayBuffer
  try {
    pdfBytes = await downloadFromStorage(env, document.storage_path, fetcher)
  } catch (error) {
    logger.error?.(`[DocumentMemory] storage download failed: ${(error as Error).message}`)
    return errorResponse('STORAGE_READ_FAILED', 'Unable to read the document from storage.', 502, origin)
  }
  if (pdfBytes.byteLength === 0) {
    return errorResponse('NO_SOURCE_MATERIAL', 'This document is empty.', 422, origin)
  }
  if (pdfBytes.byteLength > MAX_PDF_BYTES) {
    return errorResponse('DOCUMENT_TOO_LARGE', `Document exceeds the ${Math.floor(MAX_PDF_BYTES / (1024 * 1024))}MB extraction limit.`, 413, origin)
  }

  const pdfBase64 = arrayBufferToBase64(pdfBytes)

  let extractedText: string
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

  if (extractedText.length === 0) {
    return errorResponse('NO_SOURCE_MATERIAL', 'No readable text was found in this document.', 422, origin)
  }

  const chunks = chunkResumeText(extractedText)
  if (chunks.length === 0) {
    return errorResponse('NO_SOURCE_MATERIAL', 'No readable text was found in this document.', 422, origin)
  }

  const embeddedChunks: Array<{ sectionLabel: string; content: string; embedding: number[] }> = []
  for (const chunk of chunks) {
    try {
      const embedding = await embedChunk(chunk.content, env, fetcher, logger)
      embeddedChunks.push({ sectionLabel: chunk.sectionLabel, content: chunk.content, embedding })
    } catch (error) {
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
        extraction_method: EXTRACTION_METHOD,
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
    { documentId, chunkCount: embeddedChunks.length, extractionMethod: EXTRACTION_METHOD },
    200,
    origin,
  )
}
