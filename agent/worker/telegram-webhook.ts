// CORE-W1 (2026-09-06, CORE audit item ۲-۱): Telegram capture channel.
//
// POST /telegram/webhook receives Telegram Bot API updates and turns plain
// text messages from a LINKED private chat into rows in `tasks` -- quick
// capture from anywhere, without opening the app. Trust shape mirrors
// engineering-tasks (ENG-04): Telegram is NOT a Supabase-authenticated
// user, so the sole authentication is a shared secret -- Telegram echoes
// the `secret_token` registered at setWebhook time back on every delivery
// in the `X-Telegram-Bot-Api-Secret-Token` header, and we constant-shape
// compare it against env.TELEGRAM_WEBHOOK_SECRET. All DB access is
// service-role from this Worker; the browser only ever touches the two
// link tables through their own RLS policies (see migration
// 20260906000000_telegram_capture.sql).
//
// Linking flow (no OAuth): Settings > Integrations generates a short-lived
// code row (telegram_link_codes, 10 min TTL, single-use); the user sends
// `/link <code>` to the bot; this handler consumes the code and upserts
// the chat->user binding (telegram_links). `/unlink` removes it.
//
// Fail-closed: if either TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET is
// unset, the route answers 404 exactly like an unknown path -- the feature
// simply does not exist for that deployment. After authentication, the
// handler always answers 200 (even for updates it ignores or internal
// errors) so Telegram's retry queue never hammers the Worker.

import type { Env, Language } from './types'
import { fetchUserLanguage, supabaseGet, supabasePatch, supabasePost } from './context-builder'

const WEBHOOK_PATH = '/telegram/webhook'
const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token'

export const TELEGRAM_TITLE_MAX_LENGTH = 120

interface TelegramChat {
  id: number
  type: string
}

interface TelegramMessage {
  chat?: TelegramChat
  text?: string
}

export interface ParsedTelegramUpdate {
  chatId: number
  text: string
}

/** Extracts {chatId, text} from an update; null for anything we ignore
 * (edits, channels, group chats, stickers, non-text payloads). */
export function parseTelegramUpdate(body: unknown): ParsedTelegramUpdate | null {
  if (typeof body !== 'object' || body === null) return null
  const message = (body as { message?: TelegramMessage }).message
  if (!message || typeof message !== 'object') return null
  const chat = message.chat
  if (!chat || typeof chat.id !== 'number' || chat.type !== 'private') return null
  const text = typeof message.text === 'string' ? message.text.trim() : ''
  if (text.length === 0) return null
  return { chatId: chat.id, text }
}

/** `/link ABCD1234` (case-insensitive command, code normalized to upper). */
export function parseLinkCommand(text: string): string | null {
  const match = /^\/link(?:@\w+)?\s+([A-Za-z0-9]{4,32})\s*$/.exec(text)
  return match ? match[1].toUpperCase() : null
}

/** First line (capped) becomes the task title; any remainder its notes. */
export function splitCaptureText(text: string): { title: string; notes: string | null } {
  const [firstLine, ...restLines] = text.split(/\r?\n/)
  const trimmedFirst = firstLine.trim()
  const overflow = trimmedFirst.length > TELEGRAM_TITLE_MAX_LENGTH
  const title = overflow
    ? `${trimmedFirst.slice(0, TELEGRAM_TITLE_MAX_LENGTH - 1)}…`
    : trimmedFirst
  const rest = restLines.join('\n').trim()
  const notesParts: string[] = []
  if (overflow) notesParts.push(trimmedFirst)
  if (rest.length > 0) notesParts.push(rest)
  return { title, notes: notesParts.length > 0 ? notesParts.join('\n\n') : null }
}

// Bot replies, keyed by the linked user's stored app language. Unlinked
// chats have no user yet -> English.
const REPLIES: Record<Language, {
  linked: string
  linkInvalid: string
  unlinked: string
  notLinked: string
  captured: (title: string) => string
  captureFailed: string
}> = {
  en: {
    linked: '✅ Connected. Send me any message and I will capture it as a SmartFlow task.',
    linkInvalid: 'That link code is invalid or expired. Generate a new one in SmartFlow → Settings → Integrations.',
    unlinked: 'Disconnected. Generate a new link code in SmartFlow whenever you want to reconnect.',
    notLinked: 'This chat is not connected yet. In SmartFlow open Settings → Integrations → Telegram, generate a code, then send: /link <code>',
    captured: (title) => `✓ Captured: ${title}`,
    captureFailed: 'Could not save that just now — please try again in a moment.',
  },
  de: {
    linked: '✅ Verbunden. Schick mir eine Nachricht und ich erfasse sie als SmartFlow-Aufgabe.',
    linkInvalid: 'Dieser Verbindungscode ist ungültig oder abgelaufen. Erstelle in SmartFlow → Einstellungen → Integrationen einen neuen.',
    unlinked: 'Getrennt. Erstelle jederzeit einen neuen Verbindungscode in SmartFlow.',
    notLinked: 'Dieser Chat ist noch nicht verbunden. Öffne in SmartFlow Einstellungen → Integrationen → Telegram, erstelle einen Code und sende: /link <code>',
    captured: (title) => `✓ Erfasst: ${title}`,
    captureFailed: 'Konnte das gerade nicht speichern — bitte gleich noch einmal versuchen.',
  },
  fa: {
    linked: '✅ متصل شد. هر پیامی بفرستی به‌عنوان وظیفه در اسمارت‌فلو ثبت می‌شود.',
    linkInvalid: 'این کد اتصال نامعتبر یا منقضی است. در اسمارت‌فلو ← تنظیمات ← اتصال‌ها کد تازه بساز.',
    unlinked: 'اتصال قطع شد. هر وقت خواستی، در اسمارت‌فلو کد اتصال تازه بساز.',
    notLinked: 'این چت هنوز متصل نیست. در اسمارت‌فلو به تنظیمات ← اتصال‌ها ← تلگرام برو، کد بساز و بفرست: /link <code>',
    captured: (title) => `✓ ثبت شد: ${title}`,
    captureFailed: 'الان ذخیره نشد — چند لحظه دیگر دوباره امتحان کن.',
  },
}

interface LinkCodeRow {
  code: string
  user_id: string
}

interface LinkRow {
  chat_id: number
  user_id: string
}

export interface TelegramWebhookDependencies {
  sendMessage: (env: Env, chatId: number, text: string) => Promise<void>
  deleteLinksForChat: (env: Env, chatId: number) => Promise<void>
  logger: Pick<Console, 'error'>
}

async function sendTelegramMessage(env: Env, chatId: number, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) {
    // Body deliberately not logged (could echo user content); status is enough.
    throw new Error(`Telegram sendMessage failed (${res.status})`)
  }
}

// context-builder deliberately has no DELETE helper (nothing else in the
// Worker deletes rows); kept module-local rather than widening the shared
// surface for one caller.
async function deleteTelegramLinksForChat(env: Env, chatId: number): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_links?chat_id=eq.${chatId}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase DELETE error (telegram_links): ${err}`)
  }
}

async function resolveLinkedUserId(env: Env, chatId: number): Promise<string | null> {
  const rows = await supabaseGet<LinkRow[]>(
    env,
    `telegram_links?select=chat_id,user_id&chat_id=eq.${chatId}&limit=1`,
  )
  return rows[0]?.user_id ?? null
}

async function replyIn(
  deps: TelegramWebhookDependencies,
  env: Env,
  chatId: number,
  language: Language,
  pick: (replies: (typeof REPLIES)[Language]) => string,
): Promise<void> {
  try {
    await deps.sendMessage(env, chatId, pick(REPLIES[language]))
  } catch (error) {
    deps.logger.error('[telegram-webhook] reply failed', error)
  }
}

export async function handleTelegramWebhookRequest(
  request: Request,
  env: Env,
  dependencies: Partial<TelegramWebhookDependencies> = {},
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== WEBHOOK_PATH) return null

  // Feature off -> indistinguishable from an unknown route.
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  if (request.headers.get(SECRET_HEADER) !== env.TELEGRAM_WEBHOOK_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const deps: TelegramWebhookDependencies = {
    sendMessage: dependencies.sendMessage ?? sendTelegramMessage,
    deleteLinksForChat: dependencies.deleteLinksForChat ?? deleteTelegramLinksForChat,
    logger: dependencies.logger ?? console,
  }

  // From here on, always 200: Telegram retries non-2xx deliveries and a
  // poison update must never wedge the queue.
  const ok = () => Response.json({ ok: true })

  let update: ParsedTelegramUpdate | null = null
  try {
    update = parseTelegramUpdate(await request.json())
  } catch {
    return ok()
  }
  if (!update) return ok()

  const { chatId, text } = update

  try {
    const linkCode = parseLinkCommand(text)
    if (linkCode) {
      const nowIso = new Date().toISOString()
      const codes = await supabaseGet<LinkCodeRow[]>(
        env,
        `telegram_link_codes?select=code,user_id&code=eq.${linkCode}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(nowIso)}&limit=1`,
      )
      const codeRow = codes[0]
      if (!codeRow) {
        await replyIn(deps, env, chatId, 'en', (r) => r.linkInvalid)
        return ok()
      }
      // Re-linking a chat replaces its previous binding; one chat maps to
      // exactly one user (chat_id is the primary key).
      await deps.deleteLinksForChat(env, chatId)
      await supabasePost(env, 'telegram_links', { chat_id: chatId, user_id: codeRow.user_id })
      await supabasePatch(env, `telegram_link_codes?code=eq.${linkCode}`, { consumed_at: nowIso })
      const language = await fetchUserLanguage(codeRow.user_id, env)
      await replyIn(deps, env, chatId, language, (r) => r.linked)
      return ok()
    }

    if (/^\/unlink(?:@\w+)?\s*$/.test(text)) {
      const userId = await resolveLinkedUserId(env, chatId)
      const language = userId ? await fetchUserLanguage(userId, env) : 'en'
      await deps.deleteLinksForChat(env, chatId)
      await replyIn(deps, env, chatId, language, (r) => r.unlinked)
      return ok()
    }

    if (text.startsWith('/')) {
      // /start and any other command on an unlinked or linked chat: explain
      // the flow (harmless if already linked).
      const userId = await resolveLinkedUserId(env, chatId)
      const language = userId ? await fetchUserLanguage(userId, env) : 'en'
      await replyIn(deps, env, chatId, language, (r) => (userId ? r.linked : r.notLinked))
      return ok()
    }

    const userId = await resolveLinkedUserId(env, chatId)
    if (!userId) {
      await replyIn(deps, env, chatId, 'en', (r) => r.notLinked)
      return ok()
    }

    const language = await fetchUserLanguage(userId, env)
    const { title, notes } = splitCaptureText(text)
    try {
      await supabasePost(env, 'tasks', {
        user_id: userId,
        title,
        notes,
        completed: false,
      })
    } catch (error) {
      deps.logger.error('[telegram-webhook] task insert failed', error)
      await replyIn(deps, env, chatId, language, (r) => r.captureFailed)
      return ok()
    }
    await replyIn(deps, env, chatId, language, (r) => r.captured(title))
    return ok()
  } catch (error) {
    deps.logger.error('[telegram-webhook] update handling failed', error)
    return ok()
  }
}
