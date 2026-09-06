// CORE-W3 (2026-09-06, CORE audit item ۱-۱): the journal assistant.
//
// POST /journal/assistant runs ONE user-written `@ai <instruction>` from a
// journal entry against the entry's own text and persists the reply as a
// journal_ai_notes row (migration 20260906180000). CORE's version is a
// server-side Yjs scanner that fires on idle; SmartFlow's journal is a
// plain textarea and this repo's governance is explicit-trigger (ADR-0010
// precedent), so the CLIENT detects @ai lines and the user explicitly
// clicks Run -- this endpoint never scans, polls, or fires on its own.
//
// Auth + persistence follow personal-memory-extraction-endpoint.ts's
// pattern exactly: a valid Supabase bearer token is required, and the
// note INSERT goes through the user's own JWT so RLS (insert own) is the
// enforcement, never a service-role bypass. Each Worker module defines
// its own small helper copies rather than importing across modules (the
// codebase's stated convention).

import type { Env } from './types'
import { createProviders } from './providers/createProviders'
import { ProviderRequestError, ProviderUnavailableError } from './provider-errors'

const ROUTE_PATH = '/journal/assistant'

export const JOURNAL_INSTRUCTION_MAX_CHARS = 500
export const JOURNAL_ENTRY_MAX_CHARS = 20000
const REPLY_MAX_OUTPUT_TOKENS = 1024

export interface JournalAssistantDependencies {
  fetcher: typeof fetch
  logger: Pick<Console, 'info' | 'error'>
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

function errorResponse(code: string, message: string, status: number, origin: string): Response {
  return jsonResponse({ error: { code, message } }, status, origin)
}

/** Own small copy, per module convention (see header). */
async function authenticateUser(
  request: Request,
  env: Env,
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

interface ParsedBody {
  instruction: string
  entryDate: string
  entryContent: string
}

export function parseJournalAssistantBody(body: unknown): ParsedBody | null {
  if (typeof body !== 'object' || body === null) return null
  const { instruction, entryDate, entryContent } = body as Record<string, unknown>
  if (typeof instruction !== 'string' || instruction.trim().length === 0) return null
  if (instruction.length > JOURNAL_INSTRUCTION_MAX_CHARS) return null
  if (typeof entryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return null
  if (typeof entryContent !== 'string' || entryContent.length > JOURNAL_ENTRY_MAX_CHARS) return null
  return { instruction: instruction.trim(), entryDate, entryContent }
}

export function buildJournalAssistantSystemInstruction(): string {
  return [
    'You are a thoughtful assistant inside a user\'s PRIVATE journal. The user wrote an instruction for you on a line of their entry; the full entry is provided as context.',
    'Reply in the language the instruction is written in.',
    'Ground your reply in what the entry actually says -- never invent events, feelings, or facts that are not in the text.',
    'Be concise: a few sentences, or a short list when the instruction asks for one. This reply is saved next to the entry, so make it self-contained.',
    'You cannot execute actions, create tasks, or change anything -- if asked to, say what you would note down instead.',
    'This is a private, emotionally significant space: be warm and honest, never clinical, never preachy.',
  ].join(' ')
}

interface JournalAiNoteRow {
  id: string
  instruction: string
  reply: string
  created_at: string
}

export async function handleJournalAssistantRequest(
  request: Request,
  env: Env,
  dependencies: Partial<JournalAssistantDependencies> = {},
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== ROUTE_PATH) return null

  const origin = request.headers.get('Origin') ?? ''
  const fetcher = dependencies.fetcher ?? fetch
  const logger = dependencies.logger ?? console

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported.', 405, origin)
  }

  const auth = await authenticateUser(request, env, fetcher)
  if (!auth) {
    return errorResponse('UNAUTHORIZED', 'A valid session is required.', 401, origin)
  }

  let parsed: ParsedBody | null = null
  try {
    parsed = parseJournalAssistantBody(await request.json())
  } catch {
    parsed = null
  }
  if (!parsed) {
    return errorResponse('INVALID_REQUEST', 'instruction, entryDate (YYYY-MM-DD), and entryContent are required.', 400, origin)
  }

  let replyText: string
  try {
    const result = await createProviders(env, fetcher).text.generateText({
      system: buildJournalAssistantSystemInstruction(),
      turns: [
        {
          role: 'user',
          content: `Journal entry (${parsed.entryDate}):\n\n${parsed.entryContent}\n\n---\nInstruction from the user:\n${parsed.instruction}`,
        },
      ],
      maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
      temperature: 0.6,
    })
    replyText = result.text.trim()
    if (replyText.length === 0) {
      return errorResponse('MODEL_OUTPUT_UNUSABLE', 'The model did not return a usable reply. Please try again.', 502, origin)
    }
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      return errorResponse('PROVIDER_UNAVAILABLE', 'The AI model is temporarily unavailable. Please try again in a moment.', 503, origin)
    }
    if (error instanceof ProviderRequestError) {
      return errorResponse('PROVIDER_REQUEST_REJECTED', 'The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your entry.', 502, origin)
    }
    logger.error?.(`[JournalAssistant] model call failed: ${(error as Error).message}`)
    return errorResponse('REQUEST_FAILED', 'Something went wrong while generating the reply.', 500, origin)
  }

  // Persist as the USER (their JWT) -- RLS "insert own" is the boundary.
  try {
    const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/journal_ai_notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.jwt}`,
        apikey: env.SUPABASE_ANON_KEY,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: auth.userId,
        entry_date: parsed.entryDate,
        instruction: parsed.instruction,
        reply: replyText,
      }),
    })
    if (!response.ok) {
      throw new Error(`Supabase POST error (journal_ai_notes): ${response.status} ${await response.text()}`)
    }
    const rows = (await response.json()) as JournalAiNoteRow[]
    const note = rows[0]
    return jsonResponse(
      {
        note: {
          id: note.id,
          instruction: note.instruction,
          reply: note.reply,
          createdAt: note.created_at,
        },
      },
      200,
      origin,
    )
  } catch (error) {
    logger.error?.(`[JournalAssistant] note persistence failed: ${(error as Error).message}`)
    // The reply was generated but not saved -- return it anyway with a
    // flag, so the user's click is never silently swallowed; the client
    // shows it as unsaved.
    return jsonResponse({ note: { id: null, instruction: parsed.instruction, reply: replyText, createdAt: null }, persisted: false }, 200, origin)
  }
}
