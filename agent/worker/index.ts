import type { Env, AgentBriefing, ExtractedFact, MemoryEntry, UserContext, BriefingMode, ChatMessage, ChatOptions, Language } from './types'
import { buildUserContext, fetchConfirmedPersonalMemory, fetchUserLanguage, fetchTaskSnapshot, fetchCalendarSnapshot, fetchHabitSnapshot, fetchFinanceSnapshot, supabaseGet, supabasePost, supabasePatch } from './context-builder'
import { buildConfirmedMemoryIndicatorLine } from './personal-memory-prompt-serialization'
import { buildPrompt, buildExtractionPrompt, buildChatExtractionPrompt, EXTRACTABLE_KEYS, buildChatSystemPrompt } from './prompt-builder'
import {
  handleLocalReasoningRequest,
  buildReasoningSystemInstruction,
  buildReasoningResponseSchema,
  RESPONSE_LANGUAGES,
  type ReasoningResponseLanguage,
} from './reasoning-endpoint'
import { handleGitHubIntegrationRequest } from './github-integration'
import { handleContextDerivationRequest } from './context-derivation-endpoint'
import { handlePersonalMemoryExtractionRequest } from './personal-memory-extraction-endpoint'
import { handleDocumentMemoryExtractionRequest } from './document-memory-extraction-endpoint'
import { buildAttachmentTextPart, resolveChatAttachment } from './chat-attachment-context'
import { checkForFalseCompletionClaim } from './completion-claim-guard'
import {
  assembleCalendarWriteIntent,
  assembleFinanceWriteIntent,
  assembleTaskWriteIntent,
  detectContinuationDomain,
  detectWriteDomainSignal,
  executeAutoCalendarWrite,
  executeAutoFinanceWrite,
  executeAutoTaskWrite,
  resolveCreateEventTitle,
  resolveCreateTaskTitle,
  resolveServerFlowWriteMode,
  undoAutoWrite,
} from './flow-write-policy'

// ADR-0010 Product Owner Resolution Q4: always-on background extraction
// into user_context is DISABLED by this decision (SUPERSEDE per Q3 --
// user_context writes are frozen). extractAndSaveMemory/
// extractAndSaveMemoryFromChat below are kept only as historical reference
// for the prompt-construction logic they still share with nothing else in
// this file; neither is called anywhere anymore now that this flag is
// false. Automatic extraction may return only via a future recorded
// decision (ADR-0010 section 4) -- Personal Memory extraction now happens
// only via the explicit-trigger POST /personal-memory/extraction route
// (personal-memory-extraction-endpoint.ts).
const ENABLE_AUTO_MEMORY_WRITE = false

export default {
  // =============================================
  // Cron Trigger — هر روز ساعت ۶ UTC
  // =============================================
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runBriefingForAllUsers(env, 'cron'))
  },

  // =============================================
  // HTTP Trigger — POST /generate | POST /chat
  // =============================================
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname === '/agent/reason') {
      return handleLocalReasoningRequest(request, env, { logger: console })
    }

    const githubResponse = await handleGitHubIntegrationRequest(request, env)
    if (githubResponse) return githubResponse

    const origin = request.headers.get('Origin') ?? ''
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin)
    }

    if (pathname === '/chat') {
      return handleChat(request, env, ctx)
    }

    if (pathname === '/generate') {
      return handleGenerate(request, env)
    }

    if (pathname === '/tasks/suggestions') {
      return handleTaskSuggestions(request, env)
    }

    if (pathname === '/calendar/suggestions') {
      return handleCalendarSuggestions(request, env)
    }

    if (pathname === '/habits/suggestions') {
      return handleHabitSuggestions(request, env)
    }

    if (pathname === '/finance/suggestions') {
      return handleFinanceSuggestions(request, env)
    }

    if (pathname === '/documents/analyze') {
      return handleDocumentAnalyze(request, env)
    }

    if (pathname === '/projects/context-derivation') {
      return handleContextDerivationRequest(request, env, { logger: console })
    }

    if (pathname === '/personal-memory/extraction') {
      return handlePersonalMemoryExtractionRequest(request, env, { logger: console })
    }

    if (pathname === '/documents/extract-memory') {
      return handleDocumentMemoryExtractionRequest(request, env, { logger: console })
    }

    return json({ error: 'Not found' }, 404, origin)
  },
}

// =============================================
// همه کاربرها رو briefing بده (cron)
// =============================================
async function runBriefingForAllUsers(env: Env, triggeredBy: 'cron' | 'user') {
  // همه user_idها رو بگیر
  const usersRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_settings?select=user_id,language`,
    {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  )

  if (!usersRes.ok) {
    console.error('Failed to fetch users')
    return
  }

  const users: Array<{ user_id: string }> = await usersRes.json()

  // برای هر کاربر موازی generate کن
  await Promise.allSettled(
    users.map(u => generateBriefing(u.user_id, env, triggeredBy))
  )
}

// =============================================
// برای یه کاربر briefing بساز و ذخیره کن
// =============================================
async function generateBriefing(
  userId: string,
  env: Env,
  triggeredBy: 'cron' | 'user' | 'alert',
  mode: BriefingMode = 'daily'
): Promise<AgentBriefing> {
  // ۱. داده‌ها رو جمع کن
  const context = await buildUserContext(userId, env, mode)

  // ۲. Prompt بساز
  const { system, user } = buildPrompt(context)
  console.log(`[Briefing] language=${context.language} mode=${mode} userId=${userId}`)

  // ۳. Gemini رو صدا بزن — weekly needs more tokens
  const maxOutputTokens = mode === 'weekly' ? 1500 : 1024
  const rawContent = await callGemini(system, user, env, maxOutputTokens)

  // ADR-0011 Q5: a one-line, user-visible, deterministically-appended
  // indicator when confirmed memory actually shaped this briefing — never
  // left to the model to remember to say. /chat gets no such indicator.
  const content = context.confirmedMemory.length > 0
    ? `${rawContent}\n\n${buildConfirmedMemoryIndicatorLine()}`
    : rawContent

  // ۴. توی Supabase ذخیره کن
  await saveBriefing(userId, content, context.language, mode, context, triggeredBy, env)

  // ۵. حافظه بلندمدت — فعلاً غیرفعال است (Phase C)
  if (ENABLE_AUTO_MEMORY_WRITE) {
    await extractAndSaveMemory(userId, content, context, env).catch(err =>
      console.error('[Memory] Unexpected extraction error:', err)
    )
  }

  return { content, language: context.language, mode, context, triggered_by: triggeredBy }
}

// =============================================
// /generate handler
// =============================================
async function handleGenerate(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''

  const { userId, error: authError } = await requireAuth(request, env)
  if (authError || !userId) {
    return json({ error: authError ?? 'Unauthorized' }, 401, origin)
  }

  const url = new URL(request.url)
  const queryMode = url.searchParams.get('mode')
  let mode: BriefingMode = 'daily'
  if (queryMode === 'daily' || queryMode === 'weekly') {
    mode = queryMode
  } else {
    try {
      const body = await request.json() as { mode?: string }
      if (body.mode === 'daily' || body.mode === 'weekly') mode = body.mode
    } catch {
      // no body or invalid JSON — keep default 'daily'
    }
  }

  try {
    const briefing = await generateBriefing(userId, env, 'user', mode)
    return json({ success: true, briefing: briefing.content }, 200, origin)
  } catch (err) {
    console.error('Agent error:', err)
    return json({ error: 'Failed to generate briefing' }, 500, origin)
  }
}

// =============================================
// /tasks/suggestions handler
// =============================================
async function handleTaskSuggestions(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''

  const { userId, error: authError } = await requireAuth(request, env)
  if (authError || !userId) {
    return json({ error: authError ?? 'Unauthorized' }, 401, origin)
  }

  try {
    const [snapshot, language] = await Promise.all([
      fetchTaskSnapshot(userId, env),
      fetchUserLanguage(userId, env),
    ])

    if (snapshot.total === 0) {
      return json({ suggestions: [] }, 200, origin)
    }

    const system = [
      `You are a task productivity analyst. Analyze the user's real task data below and return 2-3 short, specific, actionable observations.`,
      ``,
      `RULES:`,
      `- ONLY state patterns that are verifiably true from the provided data — no generic motivational filler, no fabricated claims.`,
      `- Each observation must reference specific numbers or task names from the data.`,
      `- Keep each observation to 1 sentence, max 15 words.`,
      `- Return ONLY a JSON array, no markdown, no preamble, no explanation.`,
      `- Each item: { "text": "...", "type": "pattern" | "recommendation" }`,
      `- "pattern" = an observation about what the data shows. "recommendation" = a specific suggested action.`,
      `- Write in ${language === 'de' ? 'German' : language === 'fa' ? 'Persian (Farsi)' : 'English'}.`,
    ].join('\n')

    const dataLines = [
      `Total tasks: ${snapshot.total}`,
      `Open: ${snapshot.open}, Completed: ${snapshot.completed}`,
      `Overdue: ${snapshot.overdue}`,
      `Tasks with no due date: ${snapshot.noDueDate}`,
      `Completed this week: ${snapshot.completedThisWeek}`,
      snapshot.overdueList.length > 0 ? `Overdue tasks: ${snapshot.overdueList.join(', ')}` : null,
      snapshot.noDueDateList.length > 0 ? `Unscheduled tasks: ${snapshot.noDueDateList.join(', ')}` : null,
      snapshot.recentlyCompleted.length > 0 ? `Recently completed: ${snapshot.recentlyCompleted.join(', ')}` : null,
    ].filter(Boolean).join('\n')

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: dataLines }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  text: { type: 'STRING' },
                  type: { type: 'STRING', enum: ['pattern', 'recommendation'] },
                },
                required: ['text', 'type'],
              },
            },
            maxOutputTokens: 256,
            temperature: 0.3,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    )

    if (!res.ok) {
      console.error('[TaskSuggestions] Gemini error:', await res.text())
      return json({ suggestions: [] }, 200, origin)
    }

    const data: unknown = await res.json()
    const raw: string = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

    let suggestions: Array<{ text: string; type: string }> = []
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .filter((s: any) => typeof s.text === 'string' && s.text.trim().length > 0)
          .slice(0, 3)
          .map((s: any) => ({ text: s.text.trim(), type: s.type === 'recommendation' ? 'recommendation' : 'pattern' }))
      }
    } catch {
      console.error('[TaskSuggestions] Failed to parse Gemini response:', raw)
    }

    console.log(`[TaskSuggestions] userId=${userId} total=${snapshot.total} suggestions=${suggestions.length}`)
    return json({ suggestions }, 200, origin)
  } catch (err) {
    console.error('[TaskSuggestions] Error:', err)
    return json({ suggestions: [] }, 200, origin)
  }
}

// =============================================
// /calendar/suggestions handler
// =============================================
async function handleCalendarSuggestions(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''

  const { userId, error: authError } = await requireAuth(request, env)
  if (authError || !userId) {
    return json({ error: authError ?? 'Unauthorized' }, 401, origin)
  }

  try {
    const [snapshot, language] = await Promise.all([
      fetchCalendarSnapshot(userId, env),
      fetchUserLanguage(userId, env),
    ])

    if (snapshot.totalThisWeek === 0 && snapshot.freeDays.length === 7) {
      return json({ suggestions: [] }, 200, origin)
    }

    const system = [
      `You are a calendar schedule analyst. Analyze the user's real calendar data below and return 2-3 short, specific, actionable observations.`,
      ``,
      `RULES:`,
      `- ONLY state patterns that are verifiably true from the provided data — no generic motivational filler, no fabricated claims.`,
      `- Each observation must reference specific days, event counts, or event names from the data.`,
      `- Keep each observation to 1 sentence, max 15 words.`,
      `- Return ONLY a JSON array, no markdown, no preamble, no explanation.`,
      `- Each item: { "text": "...", "type": "pattern" | "recommendation", "suggestedDate": "YYYY-MM-DD" or omit }`,
      `- "pattern" = an observation about what the schedule shows. "recommendation" = a specific suggested action.`,
      `- Include "suggestedDate" ONLY when the suggestion references a specific day — use the exact YYYY-MM-DD date string from the data (e.g. from the free days or busy days lists). Omit suggestedDate if the suggestion is not about a specific day.`,
      `- Write in ${language === 'de' ? 'German' : language === 'fa' ? 'Persian (Farsi)' : 'English'}.`,
    ].join('\n')

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const formatDay = (d: string) => {
      const dt = new Date(d + 'T00:00:00')
      return `${dayNames[dt.getDay()]} ${d}`
    }

    const dataLines = [
      `Events this week: ${snapshot.totalThisWeek}`,
      snapshot.freeDays.length > 0 ? `Free days (0 events): ${snapshot.freeDays.map(formatDay).join(', ')}` : 'No free days this week',
      snapshot.busyDays.length > 0 ? `Busy days: ${snapshot.busyDays.map(d => `${formatDay(d.date)} (${d.count} events)`).join(', ')}` : null,
      Object.keys(snapshot.categories).length > 0 ? `Categories: ${Object.entries(snapshot.categories).map(([k, v]) => `${k}: ${v}`).join(', ')}` : null,
      snapshot.eventList.length > 0 ? `Upcoming events:\n${snapshot.eventList.map(e => `  ${e.date} ${e.time} — ${e.title}${e.type ? ` [${e.type}]` : ''}`).join('\n')}` : null,
    ].filter(Boolean).join('\n')

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: dataLines }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  text: { type: 'STRING' },
                  type: { type: 'STRING', enum: ['pattern', 'recommendation'] },
                  suggestedDate: { type: 'STRING' },
                },
                required: ['text', 'type'],
              },
            },
            maxOutputTokens: 256,
            temperature: 0.3,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    )

    if (!res.ok) {
      console.error('[CalendarSuggestions] Gemini error:', await res.text())
      return json({ suggestions: [] }, 200, origin)
    }

    const data: unknown = await res.json()
    const raw: string = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    let suggestions: Array<{ text: string; type: string; suggestedDate?: string }> = []
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .filter((s: any) => typeof s.text === 'string' && s.text.trim().length > 0)
          .slice(0, 3)
          .map((s: any) => {
            const item: { text: string; type: string; suggestedDate?: string } = {
              text: s.text.trim(),
              type: s.type === 'recommendation' ? 'recommendation' : 'pattern',
            }
            if (typeof s.suggestedDate === 'string' && dateRe.test(s.suggestedDate)) {
              item.suggestedDate = s.suggestedDate
            }
            return item
          })
      }
    } catch {
      console.error('[CalendarSuggestions] Failed to parse Gemini response:', raw)
    }

    console.log(`[CalendarSuggestions] userId=${userId} events=${snapshot.totalThisWeek} suggestions=${suggestions.length}`)
    return json({ suggestions }, 200, origin)
  } catch (err) {
    console.error('[CalendarSuggestions] Error:', err)
    return json({ suggestions: [] }, 200, origin)
  }
}

// =============================================
// /habits/suggestions handler
// =============================================
async function handleHabitSuggestions(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''

  const { userId, error: authError } = await requireAuth(request, env)
  if (authError || !userId) {
    return json({ error: authError ?? 'Unauthorized' }, 401, origin)
  }

  try {
    const [snapshot, language] = await Promise.all([
      fetchHabitSnapshot(userId, env),
      fetchUserLanguage(userId, env),
    ])

    if (snapshot.total === 0) {
      return json({ suggestions: [] }, 200, origin)
    }

    const system = [
      `You are a habit tracking analyst. Analyze the user's real habit data below and return 2-3 short, specific, actionable observations.`,
      ``,
      `RULES:`,
      `- ONLY state patterns that are verifiably true from the provided data — no generic motivational filler, no fabricated claims.`,
      `- Each observation must reference specific habit names, streak counts, or completion rates from the data.`,
      `- Keep each observation to 1 sentence, max 15 words.`,
      `- Return ONLY a JSON array, no markdown, no preamble, no explanation.`,
      `- Each item: { "text": "...", "type": "pattern" | "recommendation" }`,
      `- "pattern" = an observation about what the data shows. "recommendation" = a specific suggested action.`,
      `- Do NOT claim any time-of-day patterns — no time data is available.`,
      `- Do NOT claim habits affect productivity, mood, or other unrelated metrics.`,
      `- If nothing notable exists in the data, return an empty array [].`,
      `- Write in ${language === 'de' ? 'German' : language === 'fa' ? 'Persian (Farsi)' : 'English'}.`,
    ].join('\n')

    const habitLines = snapshot.habits.map(h => {
      const flags: string[] = []
      if (h.atBestStreak) flags.push('AT BEST STREAK')
      if (h.notCompletedIn3Days) flags.push('NOT DONE IN 3+ DAYS')
      return `  ${h.title}: ${h.currentStreak}-day streak, best ${h.longestStreak}, rate ${h.completionRate}%${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}`
    }).join('\n')

    const dataLines = [
      `Active habits: ${snapshot.total}`,
      `At risk (not completed in 3+ days): ${snapshot.atRiskCount}`,
      `At best-ever streak: ${snapshot.bestStreakCount}`,
      ``,
      `Per-habit details:`,
      habitLines,
    ].join('\n')

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: dataLines }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  text: { type: 'STRING' },
                  type: { type: 'STRING', enum: ['pattern', 'recommendation'] },
                },
                required: ['text', 'type'],
              },
            },
            maxOutputTokens: 256,
            temperature: 0.3,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    )

    if (!res.ok) {
      console.error('[HabitSuggestions] Gemini error:', await res.text())
      return json({ suggestions: [] }, 200, origin)
    }

    const data: unknown = await res.json()
    const raw: string = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

    let suggestions: Array<{ text: string; type: string }> = []
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .filter((s: any) => typeof s.text === 'string' && s.text.trim().length > 0)
          .slice(0, 3)
          .map((s: any) => ({ text: s.text.trim(), type: s.type === 'recommendation' ? 'recommendation' : 'pattern' }))
      }
    } catch {
      console.error('[HabitSuggestions] Failed to parse Gemini response:', raw)
    }

    console.log(`[HabitSuggestions] userId=${userId} habits=${snapshot.total} suggestions=${suggestions.length}`)
    return json({ suggestions }, 200, origin)
  } catch (err) {
    console.error('[HabitSuggestions] Error:', err)
    return json({ suggestions: [] }, 200, origin)
  }
}

// =============================================
// /finance/suggestions handler
// =============================================
async function handleFinanceSuggestions(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''

  const { userId, error: authError } = await requireAuth(request, env)
  if (authError || !userId) {
    return json({ error: authError ?? 'Unauthorized' }, 401, origin)
  }

  try {
    const [snapshot, language] = await Promise.all([
      fetchFinanceSnapshot(userId, env),
      fetchUserLanguage(userId, env),
    ])

    if (snapshot.transactionCount === 0 && snapshot.recentTransactions.length === 0) {
      return json({ suggestions: [] }, 200, origin)
    }

    const system = [
      `You are a personal finance assistant. Analyze the user's real transaction data below and return 2-3 short, specific, actionable insights.`,
      ``,
      `RULES:`,
      `- ONLY reference categories and amounts visible in the provided data — no generic advice.`,
      `- Each insight must reference specific numbers, categories, or percentages from the data.`,
      `- Keep each insight to 1 sentence, max 15 words.`,
      `- Return ONLY a JSON array, no markdown, no preamble, no explanation.`,
      `- Each item: { "text": "...", "type": "insight" | "action" }`,
      `- "insight" = observation about a spending pattern. "action" = specific recommendation.`,
      `- Do NOT invent data not present below. Do NOT give generic budgeting tips.`,
      `- If nothing notable exists, return an empty array [].`,
      `- Write in ${language === 'de' ? 'German' : language === 'fa' ? 'Persian (Farsi)' : 'English'}.`,
    ].join('\n')

    const catLines = snapshot.topCategories.map(c => `  ${c.category}: €${c.amount}`).join('\n')

    const dataLines = [
      `Current month: Income €${snapshot.totalIncome}, Expenses €${snapshot.totalExpenses}, Balance €${snapshot.net}`,
      `Transactions this month: ${snapshot.transactionCount}`,
      snapshot.expenseChangePct !== null ? `Expense change vs last month: ${snapshot.expenseChangePct >= 0 ? '+' : ''}${snapshot.expenseChangePct}%` : null,
      snapshot.incomeSpentPct !== null ? `${snapshot.incomeSpentPct}% of income spent` : null,
      catLines ? `Top expense categories:\n${catLines}` : null,
      snapshot.recentTransactions.length > 0 ? `Recent transactions:\n${snapshot.recentTransactions.map(t => `  ${t.date} ${t.type} ${t.category} €${t.amount}${t.notes ? ` (${t.notes})` : ''}`).join('\n')}` : null,
    ].filter(Boolean).join('\n')

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: dataLines }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  text: { type: 'STRING' },
                  type: { type: 'STRING', enum: ['insight', 'action'] },
                },
                required: ['text', 'type'],
              },
            },
            maxOutputTokens: 256,
            temperature: 0.3,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    )

    if (!res.ok) {
      console.error('[FinanceSuggestions] Gemini error:', await res.text())
      return json({ suggestions: [] }, 200, origin)
    }

    const data: unknown = await res.json()
    const raw: string = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'

    let suggestions: Array<{ text: string; type: string }> = []
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .filter((s: any) => typeof s.text === 'string' && s.text.trim().length > 0)
          .slice(0, 3)
          .map((s: any) => ({ text: s.text.trim(), type: s.type === 'action' ? 'action' : 'insight' }))
      }
    } catch {
      console.error('[FinanceSuggestions] Failed to parse Gemini response:', raw)
    }

    console.log(`[FinanceSuggestions] userId=${userId} transactions=${snapshot.transactionCount} suggestions=${suggestions.length}`)
    return json({ suggestions }, 200, origin)
  } catch (err) {
    console.error('[FinanceSuggestions] Error:', err)
    return json({ suggestions: [] }, 200, origin)
  }
}

// =============================================
// /chat handler
// =============================================
// Task 22: shared by the task and calendar auto-write branches below --
// persists the turn, builds the undo affordance, and returns the HTTP
// response for a terminal execution outcome (executed/clarify/failed).
// Returns null for 'not_found' so the caller falls through to the
// pending-ask-mode path below, exactly like the pre-task-22 inline logic.
async function respondToWriteExecution(
  env: Env,
  userId: string,
  sessionId: string,
  origin: string,
  message: string,
  language: Language,
  domain: 'tasks' | 'calendar' | 'finance',
  action: 'create' | 'update',
  mode: 'auto' | 'ask' | 'off',
  execution:
    | { status: 'executed'; reply: string; undoId: string; undoExpiresAt: string }
    | { status: 'clarify'; reply: string }
    | { status: 'failed'; reply: string }
    | { status: 'not_found' },
): Promise<Response | null> {
  if (execution.status !== 'executed' && execution.status !== 'clarify' && execution.status !== 'failed') return null
  await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'user', content: message })
  await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'assistant', content: execution.reply })
  const undo = execution.status === 'executed'
    ? { id: execution.undoId, label: language === 'de' ? 'Rückgängig' : language === 'fa' ? 'برگرداندن' : 'Undo', expiresAt: execution.undoExpiresAt }
    : undefined
  return json({ reply: execution.reply, writePolicy: { domain, action, mode }, writeExecution: execution.status, undo }, 200, origin)
}

async function handleChat(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''

  const { userId, error: authError } = await requireAuth(request, env)
  if (authError || !userId) {
    return json({ error: authError ?? 'Unauthorized' }, 401, origin)
  }

  let message: string
  let sessionId: string
  let mode: 'reasoning' | 'chat'
  let responseLanguage: ReasoningResponseLanguage
  let documentId: string | null
  let timeZone: string
  let undoIdFromBody: string | null
  try {
    const body = await request.json() as {
      message?: unknown
      session_id?: unknown
      mode?: unknown
      responseLanguage?: unknown
      documentId?: unknown
      timeZone?: unknown
      undoId?: unknown
    }
    const parsed = typeof body.message === 'string' ? body.message.trim() : ''
    if (parsed === '') {
      return json({ error: 'message must be a non-empty string' }, 400, origin)
    }
    if (typeof body.session_id !== 'string' || body.session_id.trim() === '') {
      return json({ error: 'session_id is required' }, 400, origin)
    }
    message = parsed
    sessionId = body.session_id.trim()
    mode = body.mode === 'reasoning' ? 'reasoning' : 'chat'
    responseLanguage = typeof body.responseLanguage === 'string' && RESPONSE_LANGUAGES.has(body.responseLanguage)
      ? (body.responseLanguage as ReasoningResponseLanguage)
      : 'auto'
    // Task 19 (Attach file in Flow AI): an optional reference to a document
    // already uploaded via the SAME documents bucket/table any other
    // document uses (documentsService.ts) -- resolved below, turn-scoped
    // (see the comment at its use site for exactly what that means).
    documentId = typeof body.documentId === 'string' && body.documentId.trim() !== '' ? body.documentId.trim() : null
    timeZone = typeof body.timeZone === 'string' && body.timeZone.trim() !== '' ? body.timeZone.trim() : 'UTC'
    undoIdFromBody = typeof body.undoId === 'string' && /^undo:[0-9a-f-]{36}$/i.test(body.undoId.trim()) ? body.undoId.trim() : null
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    } catch {
      timeZone = 'UTC'
    }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin)
  }

  // Reasoning mode: the frontend has already built the full reasoning prompt
  // (instructions + safe context JSON) and sent it as `message`. This is not
  // a conversational turn — schema-enforce the model call and persist
  // nothing to agent_chat_messages, since there is no user-visible message
  // here to record.
  if (mode === 'reasoning') {
    try {
      const reply = await callGeminiReasoning(message, responseLanguage, env)
      console.log(`[Chat] userId=${userId} sessionId=${sessionId} mode=reasoning reply=${reply.length} chars`)
      return json({ reply }, 200, origin)
    } catch (err) {
      console.error('[Chat] Reasoning mode error:', err)
      return json({ error: 'Failed to generate reasoning proposal' }, 500, origin)
    }
  }

  try {
    const [language, confirmedMemory] = await Promise.all([
      fetchUserLanguage(userId, env),
      fetchConfirmedPersonalMemory(userId, env),
    ])

    const undoMatch = message.match(/\bundo:([0-9a-f-]{36})\b/i)
    if (undoIdFromBody || undoMatch) {
      const undoId = undoIdFromBody ?? `undo:${undoMatch![1]}`
      const undone = await undoAutoWrite(env, userId, undoId, new Date())
      const reply = undone ? 'Undo complete.' : 'I could not undo that action. The undo window may have expired.'
      await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'user', content: undoIdFromBody ? 'Undo' : message })
      await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'assistant', content: reply })
      return json({ reply }, 200, origin)
    }

    // Last 20 messages from this session, oldest first. Loaded before
    // write-policy handling so bounded multi-turn task writes can be
    // assembled without asking the model to hold authority over execution.
    const historyRows = await supabaseGet<Array<{ role: string; content: string; created_at: string }>>(
      env,
      `agent_chat_messages?select=role,content,created_at&user_id=eq.${userId}&session_id=eq.${sessionId}&order=created_at.desc&limit=20`
    )
    const history: ChatMessage[] = historyRows
      .filter(r => r.role === 'user' || r.role === 'assistant')
      .map(r => ({ role: r.role as ChatMessage['role'], content: r.content, createdAt: r.created_at }))
      .reverse()

    let pendingWritePolicy: { domain: 'tasks' | 'calendar' | 'finance'; action: 'create' | 'update'; mode: 'ask' } | undefined

    // Task 22 -- routing: a request naming a calendar concept, or a
    // task-shaped request that ALSO carries a resolved time-of-day
    // (tasks have no time-of-day column), is calendar business; a
    // date-only task-shaped request is unchanged from today. Both noun
    // classes matching is genuinely ambiguous -- ask once, don't loop:
    // no pending state is stored, so the very next message is evaluated
    // fresh and resolves on its own once it names either domain.
    const writeDomainSignal = detectWriteDomainSignal(message, new Date(), timeZone)
    if (writeDomainSignal === 'ambiguous') {
      const reply = language === 'de'
        ? 'Soll ich ein Kalenderereignis oder eine Aufgabe erstellen?'
        : language === 'fa'
          ? 'رویداد تقویم بسازم یا تسک؟'
          : 'Should I create a calendar event or a task?'
      await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'user', content: message })
      await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'assistant', content: reply })
      return json({ reply }, 200, origin)
    }

    // 'none' on THIS message doesn't rule out a continuation (an
    // affirmative "yes"/"بله" or a title correction) of a domain-bearing
    // message earlier in the conversation -- detectContinuationDomain
    // finds which domain that was, so a time-bearing original request
    // still resolves to calendar even when the reply that finally
    // triggers execution says neither "task" nor "event".
    const resolvedDomain: 'task' | 'calendar' | 'finance' | null =
      writeDomainSignal === 'task' || writeDomainSignal === 'calendar' || writeDomainSignal === 'finance'
        ? writeDomainSignal
        : detectContinuationDomain(history, new Date(), timeZone)
    const taskWriteIntent = resolvedDomain === 'task' ? assembleTaskWriteIntent(message, history, new Date(), timeZone) : null
    const calendarWriteIntent = resolvedDomain === 'calendar' ? assembleCalendarWriteIntent(message, history, new Date(), timeZone) : null
    // Task 28: parsed the same way as task/calendar above, but never
    // reaches an 'auto' execution in production -- resolveServerFlowWriteMode
    // hard-clamps the 'finance' domain to 'ask' regardless of what mode is
    // resolved below (see that function's own comment). Parsed here anyway
    // so the 'ask' branch's pendingWritePolicy response is still accurate
    // for the frontend, and so executeAutoFinanceWrite stays exercised by
    // this dispatch shape for symmetry with the other two domains, per this
    // task's own instruction.
    const financeWriteIntent = resolvedDomain === 'finance' ? assembleFinanceWriteIntent(message, history, new Date(), timeZone) : null

    if (taskWriteIntent || calendarWriteIntent || financeWriteIntent) {
      const domain: 'tasks' | 'calendar' | 'finance' = taskWriteIntent ? 'tasks' : calendarWriteIntent ? 'calendar' : 'finance'
      const action: 'create' | 'update' = (taskWriteIntent?.kind ?? calendarWriteIntent?.kind ?? financeWriteIntent!.kind).startsWith('create') ? 'create' : 'update'
      const mode = await resolveServerFlowWriteMode(env, userId, domain, action)
      if (mode === 'off') {
        const reply = language === 'de'
          ? 'Diese Flow-AI-Aktion ist in deinen Einstellungen ausgeschaltet.'
          : language === 'fa'
            ? 'این اقدام Flow AI در تنظیمات شما خاموش است.'
            : 'This Flow AI action is switched off in your settings.'
        await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'user', content: message })
        await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'assistant', content: reply })
        return json({ reply, writePolicy: { domain, action, mode } }, 200, origin)
      }
      if (mode === 'auto') {
        if (taskWriteIntent) {
          // Task 21-fix6: resolve the create_task title through the model
          // (validated, with pattern-extraction as a last-resort fallback)
          // right before executing the write -- skipped for an explicit
          // user title correction (that title is exact user intent) and
          // when a due-date clarification is about to short-circuit this
          // write anyway, to avoid a wasted model call.
          if (taskWriteIntent.kind === 'create_task' && !taskWriteIntent.dateClarificationNeeded && taskWriteIntent.titleSource !== 'correction') {
            taskWriteIntent.title = await resolveCreateTaskTitle(env, taskWriteIntent, message)
          }
          const execution = await executeAutoTaskWrite({ env, userId, language, intent: taskWriteIntent, now: new Date(), timeZone })
          const response = await respondToWriteExecution(env, userId, sessionId, origin, message, language, domain, action, mode, execution)
          if (response) return response
        } else if (calendarWriteIntent) {
          // Task 22: same model-title-resolution treatment as tasks above.
          if (calendarWriteIntent.kind === 'create_calendar_event' && !calendarWriteIntent.dateClarificationNeeded && calendarWriteIntent.titleSource !== 'correction') {
            calendarWriteIntent.title = await resolveCreateEventTitle(env, calendarWriteIntent, message)
          }
          const execution = await executeAutoCalendarWrite({ env, userId, language, intent: calendarWriteIntent, now: new Date(), timeZone })
          const response = await respondToWriteExecution(env, userId, sessionId, origin, message, language, domain, action, mode, execution)
          if (response) return response
        } else if (financeWriteIntent) {
          // Task 28: unreachable in production today -- resolveServerFlowWriteMode
          // hard-clamps 'finance' to never resolve 'auto' (see its own
          // comment), so this branch only ever runs under a direct unit
          // test that calls executeAutoFinanceWrite/this dispatch shape
          // with a forced mode. Kept for symmetry with the task/calendar
          // branches above, per this task's own instruction to build the
          // full triad -- see the task 28 report.
          const execution = await executeAutoFinanceWrite({ env, userId, language, intent: financeWriteIntent, now: new Date() })
          const response = await respondToWriteExecution(env, userId, sessionId, origin, message, language, domain, action, mode, execution)
          if (response) return response
        }
      }
      pendingWritePolicy = { domain, action, mode: 'ask' }
    }

    // Task 19: resolve the optional attachment for THIS turn only. Nothing
    // resolved here is persisted (the ORIGINAL, unaugmented `message` is
    // what gets written to agent_chat_messages below) -- so a re-loaded
    // history on a LATER turn (including a page reload mid-session) never
    // carries the attachment's content again. If the user wants the model
    // to keep referencing the same file, they attach it again; that is the
    // deliberately simple, bounded scoping choice for this task (see the
    // task 19 report's turn-scoping section).
    let modelFacingMessage = message
    let attachmentImage: { mimeType: string; base64: string } | undefined
    if (documentId) {
      const attachment = await resolveChatAttachment(documentId, userId, env)
      if (attachment.ok && attachment.part.kind === 'text') {
        modelFacingMessage = `${message}\n\n${buildAttachmentTextPart(attachment.part.fileName, attachment.part.text)}`
      } else if (attachment.ok && attachment.part.kind === 'image') {
        attachmentImage = { mimeType: attachment.part.mimeType, base64: attachment.part.base64 }
      } else if (!attachment.ok) {
        // Calm, not an error (task 19 scope): the turn still proceeds
        // without the attachment's content -- this deterministic,
        // app-authored note (never model output) is the ONLY thing added,
        // so the model can acknowledge the miss naturally instead of
        // silently ignoring what the user just attached.
        console.log(`[Chat] attachment unavailable: documentId=${documentId} code=${attachment.code}`)
        modelFacingMessage = `${message}\n\n[Note: the attached file could not be read -- ${attachment.message}]`
      }
    }

    const system = buildChatSystemPrompt(language, confirmedMemory)
    const fullHistory: ChatMessage[] = [...history, { role: 'user', content: modelFacingMessage }]

    const rawReply = await callGeminiChat(system, fullHistory, env, {}, attachmentImage)

    // Task 20, Part A2: deterministic post-check -- see
    // completion-claim-guard.ts for the full rationale. Applied BEFORE
    // persistence so the stored history and the returned reply never
    // diverge (no drift between what the user sees now and what a later
    // turn's history reload would show).
    const claimCheck = checkForFalseCompletionClaim(rawReply, language)
    if (claimCheck.flagged) {
      console.log(`[Chat] false completion claim intercepted: userId=${userId} sessionId=${sessionId} kind=${claimCheck.matchedKind} matched="${claimCheck.matchedText}"`)
    }
    const reply = claimCheck.text

    // Persist both after a successful Gemini call so no orphaned turns are saved on error
    await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'user', content: message })
    await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'assistant', content: reply })

    // Bump session's updated_at so sidebar sorts by most recently active
    await supabasePatch(
      env,
      `chat_sessions?id=eq.${sessionId}&user_id=eq.${userId}`,
      { updated_at: new Date().toISOString() }
    )

    console.log(`[Chat] userId=${userId} sessionId=${sessionId} language=${language} history=${history.length} turns reply=${reply.length} chars`)

    // Background memory extraction — does not delay the user's reply.
    // Permanently unreachable (ENABLE_AUTO_MEMORY_WRITE is false, ADR-0010
    // Q4); `[]` in place of a real user_context fetch since ADR-0011 no
    // longer reads that table on this path at all.
    if (ENABLE_AUTO_MEMORY_WRITE) {
      ctx.waitUntil(
        extractAndSaveMemoryFromChat(userId, message, [], env).catch(err =>
          console.error('[Memory] Chat extraction error:', err)
        )
      )
    }

    return json(pendingWritePolicy ? { reply, writePolicy: pendingWritePolicy } : { reply }, 200, origin)
  } catch (err) {
    console.error('[Chat] Error:', err)
    // Task 22-fix2 (D2): defense-in-depth for any turn failure this
    // handler didn't already catch and convert to a clean reply (the
    // specific undo-persist failure this task targets is now handled
    // inside executeAutoTaskWrite/executeAutoCalendarWrite themselves --
    // see persistUndoOrRollback -- but nothing upstream of this catch
    // should ever be able to surface as a bare, content-less "Failed to
    // send": the frontend only shows that generic fallback when the HTTP
    // response itself is non-2xx (it never inspects the error body), so a
    // 500 here always produces it regardless of what this JSON contains.
    // Returning 200 with a real `reply` lets the turn degrade to an
    // honest, retryable chat message instead.
    return json({ reply: 'Something went wrong on my end. Please try again.' }, 200, origin)
  }
}

// =============================================
// Gemini API call
// =============================================
async function callGemini(system: string, user: string, env: Env, maxOutputTokens = 1024): Promise<string> {
  console.log('[Gemini] system prompt (first 300 chars):', system.slice(0, 300))
  console.log('[Gemini] user prompt (first 500 chars):', user.slice(0, 500))
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens,
          temperature: 0.7,
          // Disable thinking tokens — they count against maxOutputTokens in Gemini 2.5
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error: ${err}`)
  }

  const data: any = await res.json()

  const candidate = data?.candidates?.[0]
  const finishReason = candidate?.finishReason ?? 'UNKNOWN'
  const text: string = candidate?.content?.parts?.[0]?.text ?? ''

  console.log('[Gemini] finishReason:', finishReason)
  console.log('[Gemini] text length:', text.length)
  console.log('[Gemini] full text:', text)

  if (!text) throw new Error(`No content from Gemini (finishReason: ${finishReason})`)
  return text.trim()
}

// =============================================
// Gemini multi-turn chat API call
// =============================================
async function callGeminiChat(
  system: string,
  history: ChatMessage[],
  env: Env,
  options: ChatOptions = {},
  // Task 19: an image attachment is sent as inlineData on the LAST turn's
  // parts only (the /documents/analyze precedent in this same file) -- it
  // is never attached to any earlier turn, which is what keeps an image
  // attachment turn-scoped exactly like the text-attachment path above.
  imageAttachment?: { mimeType: string; base64: string }
): Promise<string> {
  const maxOutputTokens = options.maxOutputTokens ?? 1024
  const temperature = options.temperature ?? 0.7

  // Gemini uses 'model' for the assistant role
  const lastIndex = history.length - 1
  const contents = history.map((msg, index) => {
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: msg.content }]
    if (imageAttachment && index === lastIndex && msg.role === 'user') {
      parts.push({ inlineData: { mimeType: imageAttachment.mimeType, data: imageAttachment.base64 } })
    }
    return {
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    }
  })

  console.log('[Chat] sending', history.length, 'turns to Gemini')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          maxOutputTokens,
          temperature,
          // Disable thinking tokens — they count against maxOutputTokens in Gemini 2.5
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini Chat API error: ${err}`)
  }

  const data: any = await res.json()
  const candidate = data?.candidates?.[0]
  const finishReason: string = candidate?.finishReason ?? 'UNKNOWN'
  const text: string = candidate?.content?.parts?.[0]?.text ?? ''

  console.log('[Chat] finishReason:', finishReason, 'text length:', text.length)

  if (!text) throw new Error(`No content from Gemini chat (finishReason: ${finishReason})`)
  return text.trim()
}

// =============================================
// Gemini reasoning-mode call (/chat with mode="reasoning")
//
// Schema-enforced like /agent/reason's callGeminiOnce, so the model cannot
// return prose. This is a defense-in-depth measure, not a replacement for
// intentValidator's deterministic rescues (unrecognized type, non-literal
// confidence) — those stay in place as the fallback for whatever Gemini
// returns off-contract despite the schema.
// =============================================
async function callGeminiReasoning(
  reasoningPrompt: string,
  responseLanguage: ReasoningResponseLanguage,
  env: Env,
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: buildReasoningSystemInstruction(responseLanguage) }],
        },
        contents: [{ role: 'user', parts: [{ text: reasoningPrompt }] }],
        generationConfig: {
          maxOutputTokens: 768,
          temperature: 0,
          responseMimeType: 'application/json',
          // Disable thinking tokens — they count against maxOutputTokens in Gemini 2.5
          thinkingConfig: { thinkingBudget: 0 },
          responseSchema: buildReasoningResponseSchema(),
        },
      }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini reasoning API error: ${err}`)
  }

  const data: any = await res.json()
  const candidate = data?.candidates?.[0]
  const finishReason: string = candidate?.finishReason ?? 'UNKNOWN'
  const text: string = candidate?.content?.parts?.[0]?.text ?? ''

  console.log('[Chat] reasoning mode finishReason:', finishReason, 'text length:', text.length)

  if (!text) throw new Error(`No content from Gemini reasoning (finishReason: ${finishReason})`)
  return text.trim()
}

// =============================================
// Supabase — briefing ذخیره کن
// =============================================
async function saveBriefing(
  userId: string,
  content: string,
  language: string,
  mode: string,
  context: any,
  triggeredBy: string,
  env: Env
) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/agent_briefings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      user_id: userId,
      content,
      language,
      mode,
      context,
      triggered_by: triggeredBy,
    }),
  })

  if (!res.ok) {
    console.error('Failed to save briefing:', await res.text())
  }
}

// =============================================
// Memory extraction — facts worth remembering
// =============================================
const EXTRACTABLE_KEY_SET = new Set<string>(EXTRACTABLE_KEYS)

async function extractAndSaveMemory(
  userId: string,
  briefing: string,
  ctx: UserContext,
  env: Env
): Promise<void> {
  const { system, user } = buildExtractionPrompt(briefing, ctx)

  let facts: ExtractedFact[] = []

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  key:   { type: 'STRING' },
                  value: { type: 'STRING' },
                },
                required: ['key', 'value'],
              },
            },
            maxOutputTokens: 512,
            temperature: 0.1,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    )

    if (!res.ok) {
      console.error('[Memory] Gemini extraction failed:', await res.text())
      return
    }

    const data: unknown = await res.json()
    const raw: string = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
    facts = JSON.parse(raw) as ExtractedFact[]
  } catch (err) {
    console.error('[Memory] Extraction parse error:', err)
    return
  }

  // Guard: only keep valid keys with non-empty string values
  const valid = facts.filter(
    f =>
      typeof f.key === 'string' &&
      typeof f.value === 'string' &&
      f.value.trim().length > 0 &&
      EXTRACTABLE_KEY_SET.has(f.key)
  )

  if (valid.length === 0) {
    console.log('[Memory] No durable facts extracted — nothing written.')
    return
  }

  console.log(`[Memory] Extracted ${valid.length} fact(s):`, JSON.stringify(valid))

  // Upsert each fact individually so each failure is logged separately
  for (const fact of valid) {
    const upsertRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/user_context?on_conflict=user_id,key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          user_id: userId,
          key: fact.key,
          value: fact.value.trim(),
          source: 'agent',
        }),
      }
    )

    if (upsertRes.ok) {
      console.log(`[Memory] Wrote: ${fact.key} = "${fact.value.trim()}"`)
    } else {
      console.error(`[Memory] Upsert failed for key "${fact.key}":`, await upsertRes.text())
    }
  }
}

// =============================================
// Memory extraction — from a single chat turn
// Source: what the user stated about themselves, not an assistant reply.
// =============================================
async function extractAndSaveMemoryFromChat(
  userId: string,
  userMessage: string,
  memory: MemoryEntry[],
  env: Env
): Promise<void> {
  const { system, user } = buildChatExtractionPrompt(userMessage, memory)

  let facts: ExtractedFact[] = []

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  key:   { type: 'STRING' },
                  value: { type: 'STRING' },
                },
                required: ['key', 'value'],
              },
            },
            maxOutputTokens: 256,
            temperature: 0.1,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    )

    if (!res.ok) {
      console.error('[Memory] Chat extraction Gemini call failed:', await res.text())
      return
    }

    const data: unknown = await res.json()
    const raw: string = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
    facts = JSON.parse(raw) as ExtractedFact[]
  } catch (err) {
    console.error('[Memory] Chat extraction parse error:', err)
    return
  }

  // Guard: only valid keys with non-empty string values
  const valid = facts.filter(
    f =>
      typeof f.key === 'string' &&
      typeof f.value === 'string' &&
      f.value.trim().length > 0 &&
      EXTRACTABLE_KEY_SET.has(f.key)
  )

  if (valid.length === 0) {
    console.log('[Memory] Chat turn: no durable facts found — nothing written.')
    return
  }

  console.log(`[Memory] Chat turn: extracted ${valid.length} fact(s):`, JSON.stringify(valid))

  for (const fact of valid) {
    const upsertRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/user_context?on_conflict=user_id,key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          user_id: userId,
          key: fact.key,
          value: fact.value.trim(),
          source: 'agent',
        }),
      }
    )

    if (upsertRes.ok) {
      console.log(`[Memory] Chat wrote: ${fact.key} = "${fact.value.trim()}"`)
    } else {
      console.error(`[Memory] Chat upsert failed for key "${fact.key}":`, await upsertRes.text())
    }
  }
}

// =============================================
// Auth — Supabase JWT verification
// =============================================
async function requireAuth(
  request: Request,
  env: Env
): Promise<{ userId: string | null; error: string | null }> {
  const auth = request.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return { userId: null, error: 'Missing authorization token' }
  }
  const token = auth.slice(7)

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': env.SUPABASE_ANON_KEY,
    },
  })

  if (!res.ok) {
    return { userId: null, error: 'Unauthorized' }
  }

  const user = await res.json() as { id?: string }
  if (!user?.id) {
    return { userId: null, error: 'Invalid token' }
  }

  return { userId: user.id, error: null }
}

// =============================================
// /documents/analyze handler
// =============================================
async function handleDocumentAnalyze(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''

  const { userId, error: authError } = await requireAuth(request, env)
  if (authError || !userId) {
    return json({ error: authError ?? 'Unauthorized' }, 401, origin)
  }

  try {
    const body = await request.json() as {
      message: string
      text?: string
      fileData?: { base64: string; mimeType: string; name: string }
      language?: string
    }

    if (!body.message) {
      return json({ error: 'message is required' }, 400, origin)
    }

    // Build Gemini content parts
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []

    // If PDF/file attachment: send as inlineData
    if (body.fileData?.base64) {
      parts.push({
        inlineData: {
          mimeType: body.fileData.mimeType,
          data: body.fileData.base64,
        },
      })
    }

    // If text content provided: embed in prompt
    if (body.text) {
      parts.push({ text: `${body.message}\n\nDocument text:\n${body.text.slice(0, 30000)}` })
    } else if (!body.fileData) {
      parts.push({ text: body.message })
    } else {
      parts.push({ text: body.message })
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        }),
      },
    )

    if (!res.ok) {
      const errBody = await res.text()
      console.error('[documents/analyze] Gemini error:', res.status, errBody)
      return json({ error: `Gemini error: ${res.status}` }, 502, origin)
    }

    const geminiData = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const answer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    return json({ answer }, 200, origin)
  } catch (err) {
    console.error('[documents/analyze] error:', err)
    return json({ error: 'Internal error' }, 500, origin)
  }
}

// =============================================
// Helpers
// =============================================
function json(body: unknown, status = 200, origin = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

// Task 24: the production frontend moved to https://smartaryn.com
// (Cloudflare Pages custom domain, Supabase Site URL/redirect URLs already
// updated). barakzai.cloud is kept alongside it -- dual-origin during the
// transition -- and stays until the PO explicitly authorizes removing it as
// a separate, later step.
const PRODUCTION_ORIGINS = new Set([
  'https://smartaryn.com',
  'https://www.smartaryn.com',
  'https://barakzai.cloud',
  'https://www.barakzai.cloud',
])

const DEV_ORIGIN_RES = [
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
]

function corsHeaders(origin: string): Record<string, string> {
  // Task 24: this fallback value has no security effect either way -- a
  // browser only accepts a response whose Access-Control-Allow-Origin
  // matches ITS OWN origin exactly, so a disallowed origin is blocked
  // client-side regardless of what string appears here. Pointed at the new
  // primary domain purely for consistency now that smartaryn.com is the
  // production frontend.
  const allowed = PRODUCTION_ORIGINS.has(origin) || DEV_ORIGIN_RES.some(re => re.test(origin))
    ? origin
    : 'https://smartaryn.com'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}
