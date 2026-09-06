// CORE-W1 (2026-09-06): Telegram capture webhook. DB access goes through
// the mocked context-builder helpers; Bot API sends + the module-local
// DELETE go through injected dependencies -- no real fetch anywhere.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./context-builder', () => ({
  supabaseGet: vi.fn(),
  supabasePost: vi.fn(),
  supabasePatch: vi.fn(),
  fetchUserLanguage: vi.fn(),
}))

import { fetchUserLanguage, supabaseGet, supabasePatch, supabasePost } from './context-builder'
import {
  handleTelegramWebhookRequest,
  parseLinkCommand,
  parseTelegramUpdate,
  splitCaptureText,
  TELEGRAM_TITLE_MAX_LENGTH,
} from './telegram-webhook'
import type { Env } from './types'

const mockedGet = vi.mocked(supabaseGet)
const mockedPost = vi.mocked(supabasePost)
const mockedPatch = vi.mocked(supabasePatch)
const mockedLanguage = vi.mocked(fetchUserLanguage)

const env = {
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'hook-secret',
} as unknown as Env

const sendMessage = vi.fn<(env: Env, chatId: number, text: string) => Promise<void>>()
const deleteLinksForChat = vi.fn<(env: Env, chatId: number) => Promise<void>>()
const deps = { sendMessage, deleteLinksForChat, logger: { error: vi.fn() } }

function webhookRequest(body: unknown, overrides: { secret?: string; method?: string } = {}) {
  return new Request('https://worker.example/telegram/webhook', {
    method: overrides.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': overrides.secret ?? 'hook-secret',
    },
    body: JSON.stringify(body),
  })
}

function textUpdate(text: string, chatId = 42) {
  return { message: { chat: { id: chatId, type: 'private' }, text } }
}

beforeEach(() => {
  vi.clearAllMocks()
  sendMessage.mockResolvedValue(undefined)
  deleteLinksForChat.mockResolvedValue(undefined)
  mockedPost.mockResolvedValue(undefined)
  mockedPatch.mockResolvedValue(undefined)
  mockedLanguage.mockResolvedValue('en')
})

describe('parseTelegramUpdate', () => {
  it('accepts a private-chat text message', () => {
    expect(parseTelegramUpdate(textUpdate('hello'))).toEqual({ chatId: 42, text: 'hello' })
  })

  it('ignores group chats, missing text, and non-object bodies', () => {
    expect(parseTelegramUpdate({ message: { chat: { id: 1, type: 'group' }, text: 'x' } })).toBeNull()
    expect(parseTelegramUpdate({ message: { chat: { id: 1, type: 'private' } } })).toBeNull()
    expect(parseTelegramUpdate('nope')).toBeNull()
    expect(parseTelegramUpdate(null)).toBeNull()
  })
})

describe('parseLinkCommand', () => {
  it('extracts and uppercases the code, with or without a bot mention', () => {
    expect(parseLinkCommand('/link abcd1234')).toBe('ABCD1234')
    expect(parseLinkCommand('/link@SmartFlowBot ZZZZ9999')).toBe('ZZZZ9999')
  })

  it('rejects plain text and malformed codes', () => {
    expect(parseLinkCommand('link abcd1234')).toBeNull()
    expect(parseLinkCommand('/link')).toBeNull()
    expect(parseLinkCommand('/link two words')).toBeNull()
  })
})

describe('splitCaptureText', () => {
  it('uses the first line as the title and the rest as notes', () => {
    expect(splitCaptureText('Buy milk\nfull fat\n2 liters')).toEqual({
      title: 'Buy milk',
      notes: 'full fat\n2 liters',
    })
  })

  it('caps an over-long first line and preserves the full text in notes', () => {
    const long = 'x'.repeat(TELEGRAM_TITLE_MAX_LENGTH + 40)
    const result = splitCaptureText(long)
    expect(result.title.length).toBe(TELEGRAM_TITLE_MAX_LENGTH)
    expect(result.title.endsWith('…')).toBe(true)
    expect(result.notes).toBe(long)
  })

  it('single short line has null notes', () => {
    expect(splitCaptureText('Buy milk')).toEqual({ title: 'Buy milk', notes: null })
  })
})

describe('handleTelegramWebhookRequest', () => {
  it('returns null for unrelated paths', async () => {
    const request = new Request('https://worker.example/chat', { method: 'POST' })
    expect(await handleTelegramWebhookRequest(request, env, deps)).toBeNull()
  })

  it('answers 404 when the feature secrets are not configured', async () => {
    const bare = {} as Env
    const response = await handleTelegramWebhookRequest(webhookRequest(textUpdate('hi')), bare, deps)
    expect(response?.status).toBe(404)
  })

  it('rejects a wrong secret header with 401 and a non-POST with 405', async () => {
    const unauthorized = await handleTelegramWebhookRequest(
      webhookRequest(textUpdate('hi'), { secret: 'wrong' }), env, deps,
    )
    expect(unauthorized?.status).toBe(401)
    const get = await handleTelegramWebhookRequest(
      new Request('https://worker.example/telegram/webhook', { method: 'GET' }), env, deps,
    )
    expect(get?.status).toBe(405)
  })

  it('answers 200 and stays silent for ignorable updates', async () => {
    const response = await handleTelegramWebhookRequest(
      webhookRequest({ edited_message: { chat: { id: 1, type: 'private' }, text: 'x' } }), env, deps,
    )
    expect(response?.status).toBe(200)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('/link with a valid code binds the chat, consumes the code, replies in the user language', async () => {
    mockedGet.mockResolvedValueOnce([{ code: 'ABCD1234', user_id: 'user-1' }])
    mockedLanguage.mockResolvedValueOnce('fa')
    const response = await handleTelegramWebhookRequest(webhookRequest(textUpdate('/link abcd1234')), env, deps)
    expect(response?.status).toBe(200)
    expect(deleteLinksForChat).toHaveBeenCalledWith(env, 42)
    expect(mockedPost).toHaveBeenCalledWith(env, 'telegram_links', { chat_id: 42, user_id: 'user-1' })
    expect(mockedPatch).toHaveBeenCalledWith(
      env,
      expect.stringContaining('telegram_link_codes?code=eq.ABCD1234'),
      expect.objectContaining({ consumed_at: expect.any(String) }),
    )
    expect(sendMessage).toHaveBeenCalledWith(env, 42, expect.stringContaining('متصل شد'))
  })

  it('/link with an unknown or expired code replies invalid and binds nothing', async () => {
    mockedGet.mockResolvedValueOnce([])
    await handleTelegramWebhookRequest(webhookRequest(textUpdate('/link ZZZZ9999')), env, deps)
    expect(mockedPost).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith(env, 42, expect.stringContaining('invalid or expired'))
  })

  it('a plain message from an unlinked chat replies with linking instructions, no task', async () => {
    mockedGet.mockResolvedValueOnce([]) // telegram_links lookup
    await handleTelegramWebhookRequest(webhookRequest(textUpdate('buy milk')), env, deps)
    expect(mockedPost).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith(env, 42, expect.stringContaining('/link'))
  })

  it('a plain message from a linked chat becomes a task and gets a localized confirmation', async () => {
    mockedGet.mockResolvedValueOnce([{ chat_id: 42, user_id: 'user-1' }])
    mockedLanguage.mockResolvedValueOnce('fa')
    await handleTelegramWebhookRequest(webhookRequest(textUpdate('خرید شیر\nدو لیتر')), env, deps)
    expect(mockedPost).toHaveBeenCalledWith(env, 'tasks', {
      user_id: 'user-1',
      title: 'خرید شیر',
      notes: 'دو لیتر',
      completed: false,
    })
    expect(sendMessage).toHaveBeenCalledWith(env, 42, expect.stringContaining('ثبت شد'))
  })

  it('a failed task insert still answers 200 and tells the user it failed', async () => {
    mockedGet.mockResolvedValueOnce([{ chat_id: 42, user_id: 'user-1' }])
    mockedPost.mockRejectedValueOnce(new Error('db down'))
    const response = await handleTelegramWebhookRequest(webhookRequest(textUpdate('buy milk')), env, deps)
    expect(response?.status).toBe(200)
    expect(sendMessage).toHaveBeenCalledWith(env, 42, expect.stringContaining('try again'))
  })

  it('/unlink removes the binding and confirms', async () => {
    mockedGet.mockResolvedValueOnce([{ chat_id: 42, user_id: 'user-1' }])
    const response = await handleTelegramWebhookRequest(webhookRequest(textUpdate('/unlink')), env, deps)
    expect(response?.status).toBe(200)
    expect(deleteLinksForChat).toHaveBeenCalledWith(env, 42)
    expect(sendMessage).toHaveBeenCalledWith(env, 42, expect.stringContaining('Disconnected'))
  })
})
