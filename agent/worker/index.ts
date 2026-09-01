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
import { handleEngineeringTasksRequest } from './engineering-tasks-endpoint'
import { handleContextDerivationRequest } from './context-derivation-endpoint'
import { handlePersonalMemoryExtractionRequest } from './personal-memory-extraction-endpoint'
import { handleDocumentMemoryExtractionRequest } from './document-memory-extraction-endpoint'
import { buildAttachmentTextPart, resolveChatAttachment } from './chat-attachment-context'
import { checkForFalseCompletionClaim } from './completion-claim-guard'
import {
  assembleCalendarWriteIntent,
  assembleFinanceWriteIntent,
  assembleTaskWriteIntent,
  calendarIntentTargetFields,
  checkDuplicateRows,
  detectContinuationDomain,
  detectWriteDomainSignal,
  executeAutoCalendarWrite,
  executeAutoFinanceWrite,
  executeAutoTaskWrite,
  executeBatchFinanceImport,
  financeIntentTargetFields,
  loadImportBatch,
  markImportBatchConsumed,
  persistImportBatch,
  PROVIDER_UNAVAILABLE_WRITE_REPLY,
  resolveCreateEventTitle,
  resolveCreateTaskTitle,
  resolveServerFlowWriteMode,
  taskIntentTargetFields,
  undoAutoWrite,
  writeIntentOutcomeIdentity,
} from './flow-write-policy'
import { ProviderRequestError, ProviderUnavailableError } from './provider-errors'
import { createProviders } from './providers/createProviders'
// Chat V2 Slice 1: structured text-lane diagnostics (correlation id,
// provider, model, elapsed ms, tokens, fallbackUsed) -- see that module's
// own security contract (no message contents, ever).
import { formatChatTextTelemetryLine, resolveExpectedPrimaryProviderId, resolveFallbackUsed } from './chat-text-telemetry'
// ADR-0018 S1b follow-up: /chat's own AttachmentsUnsupportedError handler
// (handleChat's mode:'chat' catch, below) needs the class to check against
// -- this is a structural last resort, since callGeminiChat now pins to
// Gemini whenever an attachment is present (see that function's own
// comment), so the workers-ai adapter's own rejection should never
// actually fire from this path in practice.
import { AttachmentsUnsupportedError } from './providers/workers-ai/WorkersAITextGenerationProvider'
import { resolveGeminiModel } from './geminiModel'
import { recordProposalOutcome } from './proposal-outcome-recording'
import { parseProposalOutcomeRequestBody } from './proposal-outcome-endpoint'
import { handleAgentToolExecutionApprove, handleAgentToolExecutionRequest } from './agent-tool-execution'
import type { WriteIntentType } from '../../shared/writeIntentRegistry'
import { parseBankStatement } from '../../shared/bankStatementParser'
import { buildBatchImportPreview, selectImportableRows } from '../../shared/bankImportBatchPreview'
// ALF-1A (ADR-0021): live learning capture -- fire-and-forget only, always
// via ctx.waitUntil, always AFTER the deterministic production decision at
// each capture point below is already known. See each call site's own
// comment for exactly which outcome it describes and why. Zero runtime
// authority: nothing imported here is ever read back into a write/policy/
// approval decision in this file.
import { captureProductionRoutingTurn } from './ai-learning/live-capture'
import { resolveLiveCaptureConfig, type LiveCaptureConfig } from './ai-learning/live-capture-config'

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

    const engineeringTasksResponse = await handleEngineeringTasksRequest(request, env)
    if (engineeringTasksResponse) return engineeringTasksResponse

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

    if (pathname === '/agent/proposal-outcome') {
      return handleProposalOutcomeRequest(request, env, ctx)
    }

    // Chat V2 Slice 2A: server-owned execution lifecycle foundation. See
    // agent/worker/agent-tool-execution.ts's own header comment.
    if (pathname === '/agent/execution/request') {
      return handleAgentToolExecutionRequest(request, env)
    }

    if (pathname === '/agent/execution/approve') {
      return handleAgentToolExecutionApprove(request, env)
    }

    if (pathname === '/finance/import-batch/preview') {
      return handleFinanceImportBatchPreview(request, env)
    }

    if (pathname === '/finance/import-batch/commit') {
      return handleFinanceImportBatchCommit(request, env, ctx)
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

  // ۳. Gemini رو صدا بزن
  // MIG-01b: both were <2048 (weekly 1500, daily 1024) -- raised to the
  // 2048 floor now that thinking consumes output budget on every call
  // (thinkingConfig removed, see callGemini's own comment). Flattens the
  // "weekly needs more tokens" margin weekly used to have over daily;
  // flagged in the MIG-01b report as a candidate follow-up if weekly
  // briefings start truncating at 2048 in practice.
  const maxOutputTokens = 2048
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
    // INC-01/ADR-0018 S1 follow-up: a provider failure must surface as a
    // distinct, honest outcome, not the generic 500 below -- mirrors the
    // /chat mode=reasoning 503 PROVIDER_UNAVAILABLE response (same file,
    // see that branch's own comment) for this endpoint's own single,
    // un-retried Gemini call.
    if (err instanceof ProviderUnavailableError) {
      console.error('Briefing generation failed: provider unavailable', err)
      return json({ error: 'The AI provider is temporarily unavailable.', code: 'PROVIDER_UNAVAILABLE' }, 503, origin)
    }
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

    // ADR-0018 S2: migrated to the StructuredGenerationProvider adapter.
    // This handler's own posture (unchanged): ANY failure -- provider
    // unavailable/rejected, or the response not parsing as a JSON array --
    // degrades calmly to an empty suggestions list with 200, never a
    // user-visible error. Both failure classes used to be handled by two
    // separate checks (`!res.ok`, then a parse try/catch); one try/catch
    // around the adapter call + parse now covers both, same outcome.
    let suggestions: Array<{ text: string; type: string }> = []
    try {
      const result = await createProviders(env).structured.generateStructured({
        system,
        turns: [{ role: 'user', content: dataLines }],
        schema: {
          type: 'array',
          items: {
            type: 'object',
            required: ['text', 'type'],
            properties: {
              text: { type: 'string' },
              type: { type: 'string', enum: ['pattern', 'recommendation'] },
            },
          },
        },
        // MIG-01b: 256 -> 2048. thinkingConfig removed (gemini-3.6-flash
        // rejects thinkingBudget:0, see geminiModel.ts) -- thinking now
        // consumes output budget on every call, so the ceiling has to
        // rise even though this response itself is short.
        maxOutputTokens: 2048,
        temperature: 0.3,
      })
      const parsed = JSON.parse(result.rawText || '[]')
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .filter((s: any) => typeof s.text === 'string' && s.text.trim().length > 0)
          .slice(0, 3)
          .map((s: any) => ({ text: s.text.trim(), type: s.type === 'recommendation' ? 'recommendation' : 'pattern' }))
      }
    } catch (err) {
      console.error('[TaskSuggestions] Gemini error:', err)
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

    // ADR-0018 S2: migrated to the StructuredGenerationProvider adapter --
    // see handleTaskSuggestions's identical comment above for this
    // handler's own calm-degradation posture.
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    let suggestions: Array<{ text: string; type: string; suggestedDate?: string }> = []
    try {
      const result = await createProviders(env).structured.generateStructured({
        system,
        turns: [{ role: 'user', content: dataLines }],
        schema: {
          type: 'array',
          items: {
            type: 'object',
            required: ['text', 'type'],
            properties: {
              text: { type: 'string' },
              type: { type: 'string', enum: ['pattern', 'recommendation'] },
              suggestedDate: { type: 'string' },
            },
          },
        },
        // MIG-01b: 256 -> 2048, thinkingConfig removed -- see
        // handleTaskSuggestions's identical comment above.
        maxOutputTokens: 2048,
        temperature: 0.3,
      })
      const parsed = JSON.parse(result.rawText || '[]')
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
    } catch (err) {
      console.error('[CalendarSuggestions] Gemini error:', err)
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

    // ADR-0018 S2: migrated to the StructuredGenerationProvider adapter --
    // see handleTaskSuggestions's identical comment above for this
    // handler's own calm-degradation posture.
    let suggestions: Array<{ text: string; type: string }> = []
    try {
      const result = await createProviders(env).structured.generateStructured({
        system,
        turns: [{ role: 'user', content: dataLines }],
        schema: {
          type: 'array',
          items: {
            type: 'object',
            required: ['text', 'type'],
            properties: {
              text: { type: 'string' },
              type: { type: 'string', enum: ['pattern', 'recommendation'] },
            },
          },
        },
        // MIG-01b: 256 -> 2048, thinkingConfig removed -- see
        // handleTaskSuggestions's identical comment above.
        maxOutputTokens: 2048,
        temperature: 0.3,
      })
      const parsed = JSON.parse(result.rawText || '[]')
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .filter((s: any) => typeof s.text === 'string' && s.text.trim().length > 0)
          .slice(0, 3)
          .map((s: any) => ({ text: s.text.trim(), type: s.type === 'recommendation' ? 'recommendation' : 'pattern' }))
      }
    } catch (err) {
      console.error('[HabitSuggestions] Gemini error:', err)
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

    // ADR-0018 S2: migrated to the StructuredGenerationProvider adapter --
    // see handleTaskSuggestions's identical comment above for this
    // handler's own calm-degradation posture.
    let suggestions: Array<{ text: string; type: string }> = []
    try {
      const result = await createProviders(env).structured.generateStructured({
        system,
        turns: [{ role: 'user', content: dataLines }],
        schema: {
          type: 'array',
          items: {
            type: 'object',
            required: ['text', 'type'],
            properties: {
              text: { type: 'string' },
              type: { type: 'string', enum: ['insight', 'action'] },
            },
          },
        },
        // MIG-01b: 256 -> 2048, thinkingConfig removed -- see
        // handleTaskSuggestions's identical comment above.
        maxOutputTokens: 2048,
        temperature: 0.3,
      })
      const parsed = JSON.parse(result.rawText || '[]')
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .filter((s: any) => typeof s.text === 'string' && s.text.trim().length > 0)
          .slice(0, 3)
          .map((s: any) => ({ text: s.text.trim(), type: s.type === 'action' ? 'action' : 'insight' }))
      }
    } catch (err) {
      console.error('[FinanceSuggestions] Gemini error:', err)
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
// Task 40, ADR-0016 Slice 2: the auto-write lane's own outcome-recording
// identity -- intentType/toolId (registry-derived) plus target_fields
// (which fields the parsed intent populated, never their values). Callers
// build this from whichever of taskWriteIntent/calendarWriteIntent/
// financeWriteIntent actually triggered the write.
interface WriteExecutionOutcomeContext {
  kind: WriteIntentType
  targetFields: readonly string[]
}

async function respondToWriteExecution(
  env: Env,
  ctx: ExecutionContext,
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
    // INC-01: title resolution never reached a real write attempt because
    // the AI provider itself was unreachable -- semantically closer to
    // 'clarify' (no proposal was ever formed) than 'failed' (a write was
    // attempted and something went wrong persisting it), so it is excluded
    // from the outcome-ledger recording below the same way 'clarify' is.
    | { status: 'provider_unavailable'; reply: string }
    | { status: 'not_found' },
  outcomeContext: WriteExecutionOutcomeContext,
  // ALF-1A (ADR-0021): the pre-generated, durable id this turn's user
  // message row will be inserted with below (section 8) -- the exact
  // value ai_learning_events.source_message_id must reference, with no
  // second lookup.
  sourceMessageId: string,
  liveCaptureConfig: LiveCaptureConfig,
): Promise<Response | null> {
  if (execution.status !== 'executed' && execution.status !== 'clarify' && execution.status !== 'failed' && execution.status !== 'provider_unavailable') return null
  await supabasePost(env, 'agent_chat_messages', { id: sourceMessageId, user_id: userId, session_id: sessionId, role: 'user', content: message })
  await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'assistant', content: execution.reply })
  const undo = execution.status === 'executed'
    ? { id: execution.undoId, label: language === 'de' ? 'Rückgängig' : language === 'fa' ? 'برگرداندن' : 'Undo', expiresAt: execution.undoExpiresAt }
    : undefined
  const identity = writeIntentOutcomeIdentity(outcomeContext.kind)
  // ALF-1A (ADR-0021) capture point: an auto-mode write intent that
  // reached a deterministic outcome here. requiresApproval is always
  // false -- 'auto' mode means the user's standing permission already
  // authorized this, no approval flow was ever shown, regardless of
  // whether the write itself succeeded, failed, or paused for
  // clarification. requiresClarification is true only for 'clarify'/
  // 'provider_unavailable' -- the two statuses where the deterministic
  // parser never reached a fully-formed write proposal in the first
  // place (see this function's own header comment). Fire-and-forget via
  // ctx.waitUntil, exactly like recordProposalOutcome below -- never
  // awaited, never able to delay or fail this response.
  if (identity && liveCaptureConfig.captureEnabled) {
    ctx.waitUntil(captureProductionRoutingTurn({
      env,
      config: liveCaptureConfig,
      userId,
      sessionId,
      sourceMessageId,
      rawMessage: message,
      label: {
        language,
        interactionClass: 'write',
        domain,
        intentType: identity.intentType,
        toolId: identity.toolId,
        requiresClarification: execution.status === 'clarify' || execution.status === 'provider_unavailable',
        requiresApproval: false,
      },
    }))
  }
  // Task 40: 'executed'/'failed' are the only auto-lane states that
  // represent an actual attempted write -- 'clarify' means the deterministic
  // parser never reached a well-formed proposal in the first place (nothing
  // to record an outcome for, the same way the ask-lane never records a
  // proposal that was never shown). Fire-and-forget (ADR-0016 item 6):
  // ctx.waitUntil keeps the isolate alive for this insert without making
  // the user's chat reply wait on it; recordProposalOutcome itself never
  // throws, so a failure here can never surface as a chat/write failure.
  if (execution.status === 'executed' || execution.status === 'failed') {
    if (identity) {
      ctx.waitUntil(recordProposalOutcome(env, {
        userId,
        intentType: identity.intentType,
        toolId: identity.toolId,
        domain,
        writeMode: 'auto',
        outcome: 'auto_executed',
        succeeded: execution.status === 'executed',
        targetFields: outcomeContext.targetFields,
      }))
    }
  }
  return json({ reply: execution.reply, writePolicy: { domain, action, mode }, writeExecution: execution.status, undo }, 200, origin)
}

// =============================================
// POST /agent/proposal-outcome -- ADR-0016 Decision item 7 / task 40.
// The ask-lane's reporting mechanism: the frontend calls this once per
// proposal outcome (approved or rejected) AFTER the write it describes has
// already completed or been rejected. Reuses THIS FILE's own requireAuth/
// json/corsHeaders exactly (not a copy) -- see this task's own report for
// why: a second, independent CORS mechanism is the exact pattern that broke
// production for weeks in github-integration.ts (task 32).
// =============================================
async function handleProposalOutcomeRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''

  const { userId, error: authError } = await requireAuth(request, env)
  if (authError || !userId) {
    return json({ error: authError ?? 'Unauthorized' }, 401, origin)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin)
  }

  const validation = parseProposalOutcomeRequestBody(body)
  if (validation.ok === false) {
    // Task 40 Part A.2: a rejection here returns an error to the CALLER
    // only. It cannot propagate into any write path -- the write this
    // outcome describes (if any) already completed or was already
    // rejected before the frontend ever made this call.
    return json({ error: validation.error }, 400, origin)
  }

  const input = validation.value
  // Fire-and-forget (ADR-0016 item 6): ctx.waitUntil lets the isolate
  // finish the insert after this response is sent, so this endpoint's own
  // round trip never makes the CALLER wait on it either. recordProposalOutcome
  // itself never throws, so nothing here can turn into a 500 once
  // validation has passed.
  ctx.waitUntil(recordProposalOutcome(env, {
    userId,
    requestId: input.requestId,
    intentType: input.intentType,
    toolId: input.toolId,
    domain: input.domain,
    writeMode: 'ask',
    outcome: input.outcome,
    succeeded: input.succeeded,
    riskLevel: input.riskLevel,
    targetFields: input.targetFields,
  }))

  return json({ accepted: true }, 202, origin)
}

// =============================================
// Task 45c, ADR-0017 -- bank-statement batch import
//
// PREVIEW parses the uploaded file server-side via the shared/ parser and
// LOCKS the resulting importable row set (shared/bankImportBatchPreview.ts's
// selectImportableRows -- post-quarantine, post-duplicate-exclusion) under
// a server-issued batchId, persisted in finance_import_batches. COMMIT
// never re-parses a file and never re-derives which rows are importable --
// it loads that exact locked set by batchId. This is task 45c PART B's
// Ruling 3 (PO): what is approved must be exactly what executes, never a
// value independently recomputed from possibly-changed DB state between
// the two calls. See flow-write-policy.ts's persistImportBatch/
// loadImportBatch for the full reasoning, and ADR-0017's task-45c
// amendment for the durable record.
//
// COMMIT does re-run checkDuplicateRows, but only as a NARROW collision
// check against the locked rows' own hashes -- never to redecide which
// rows are importable, only to detect whether any of those exact,
// already-approved rows collided with something imported since preview. A
// collision fails the WHOLE batch (Ruling 1's all-or-nothing philosophy
// applied to this specific cause), never a silent partial skip.
//
// Neither endpoint executes through writeRuntime.ts/runWriteTool -- the
// browser never inserts a row itself. This is the RLS bypass this task
// closes: unlike the existing single-transaction finance write (a direct
// browser-side Supabase insert authorized only by RLS), the actual insert
// here runs only in executeBatchFinanceImport, using env.SUPABASE_SERVICE_KEY.
// =============================================

async function readUploadedBankStatementFile(request: Request): Promise<{ bytes: Uint8Array } | { error: string }> {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return { error: 'Invalid multipart body' }
  }
  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return { error: 'file field is required' }
  }
  // Same order-of-magnitude ceiling as the recovered ai-worker's own
  // /import-bank endpoint (task 44's own finding) -- a CAMT CSV statement
  // is plain text, so this is generous headroom, not a tight budget.
  if (file.size > 20 * 1024 * 1024) {
    return { error: 'File too large (max 20 MB)' }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { bytes }
}

async function handleFinanceImportBatchPreview(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''

  const { userId, error: authError } = await requireAuth(request, env)
  if (authError || !userId) {
    return json({ error: authError ?? 'Unauthorized' }, 401, origin)
  }

  const upload = await readUploadedBankStatementFile(request)
  if ('error' in upload) {
    return json({ error: upload.error }, 400, origin)
  }

  const parseResult = parseBankStatement(upload.bytes, userId)
  const duplicateHashes = parseResult.verdict === 'ok'
    ? await checkDuplicateRows(env, userId, parseResult.rows.map((row) => row.rowHash))
    : new Set<string>()
  const preview = buildBatchImportPreview(parseResult, duplicateHashes)

  // Ruling 3: lock the importable row set now, under a fresh batchId, so
  // commit never has to re-derive it. Only issued when there is something
  // to import -- an empty/blocked preview has nothing worth locking, and
  // never gets a batchId, so the client cannot even attempt to commit it.
  let batchId: string | null = null
  if (parseResult.verdict === 'ok') {
    const importable = selectImportableRows(parseResult, duplicateHashes)
    if (importable.length > 0) {
      const persisted = await persistImportBatch(env, userId, importable, new Date())
      batchId = persisted.batchId
    }
  }

  return json({ ...preview, batchId }, 200, origin)
}

async function parseImportBatchCommitBody(request: Request): Promise<{ batchId: string } | { error: string }> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { error: 'Invalid JSON body' }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' }
  }
  const batchId = (body as Record<string, unknown>).batchId
  if (typeof batchId !== 'string' || !batchId.trim()) {
    return { error: 'batchId is required' }
  }
  return { batchId: batchId.trim() }
}

async function handleFinanceImportBatchCommit(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''

  const { userId, error: authError } = await requireAuth(request, env)
  if (authError || !userId) {
    return json({ error: authError ?? 'Unauthorized' }, 401, origin)
  }

  const bodyResult = await parseImportBatchCommitBody(request)
  if ('error' in bodyResult) {
    return json({ error: bodyResult.error }, 400, origin)
  }

  const now = new Date()
  const batch = await loadImportBatch(env, userId, bodyResult.batchId, now)
  if (!batch) {
    // Not found, already consumed, or expired -- nothing was decided here
    // (a stale/garbage/replayed batchId is a lookup failure, not an
    // approval outcome), so no ledger row.
    return json({ error: 'Import batch not found or expired. Please re-import the file to try again.' }, 404, origin)
  }

  const identity = writeIntentOutcomeIdentity('import_bank_statement')
  const targetFields = ['rowCount', 'dateRangeStart', 'dateRangeEnd', 'currency']
  const dateRange = batch.rows.reduce(
    (acc, row) => ({ start: row.date < acc.start ? row.date : acc.start, end: row.date > acc.end ? row.date : acc.end }),
    { start: batch.rows[0].date, end: batch.rows[0].date },
  )

  // Ruling 3: narrow collision check against the LOCKED rows' own hashes
  // only -- never a re-derivation of which rows are importable (that was
  // already decided and locked at preview time). A non-empty result means
  // something else imported an overlapping row since this batch was
  // approved; the whole batch fails rather than silently dropping the
  // colliding row and importing the rest (Ruling 1's all-or-nothing
  // philosophy, applied here).
  const collisionHashes = await checkDuplicateRows(env, userId, batch.rows.map((row) => row.rowHash))

  let result: Awaited<ReturnType<typeof executeBatchFinanceImport>>
  let failureStatus = 502
  if (collisionHashes.size > 0) {
    await markImportBatchConsumed(env, bodyResult.batchId, now)
    result = { status: 'failed', reply: 'Some rows in this batch were already imported since you approved it. Please re-import the file to try again.' }
    failureStatus = 409
  } else {
    result = await executeBatchFinanceImport(env, userId, batch.rows, now)
    if (result.status === 'executed') {
      await markImportBatchConsumed(env, bodyResult.batchId, now)
    }
    // On a transient infrastructure failure, the batch is deliberately
    // left NOT consumed -- Ruling 1: "the same proposal retryable" -- so
    // the same batchId can be committed again without a fresh preview.
  }

  if (identity) {
    // Fire-and-forget (ADR-0016 item 6): the ledger write never gates this
    // response, and its own failure can never turn into a write failure --
    // recordProposalOutcome itself never throws.
    ctx.waitUntil(recordProposalOutcome(env, {
      userId,
      intentType: identity.intentType,
      toolId: identity.toolId,
      domain: 'finance',
      writeMode: 'ask',
      outcome: 'approved',
      succeeded: result.status === 'executed',
      riskLevel: 'medium',
      targetFields,
    }))
  }

  if (result.status === 'failed') {
    return json({ error: result.reply }, failureStatus, origin)
  }

  return json({
    status: 'executed',
    insertedCount: result.insertedCount,
    dateRange,
    undoId: result.undoId,
    undoExpiresAt: result.undoExpiresAt,
  }, 200, origin)
}

// INC-01: the plain-conversation sibling of flow-write-policy.ts's
// PROVIDER_UNAVAILABLE_WRITE_REPLY -- same cause, different context (no
// task/event was being set up here, just an ordinary reply), so worded
// for a normal chat turn instead of an auto-write outcome.
const PROVIDER_UNAVAILABLE_CHAT_REPLY: Record<Language, string> = {
  en: 'The AI assistant is temporarily unavailable. Please try again in a moment.',
  de: 'Der KI-Assistent ist vorübergehend nicht verfügbar. Bitte versuche es gleich noch einmal.',
  fa: 'دستیار هوش مصنوعی موقتاً در دسترس نیست. لطفاً کمی بعد دوباره امتحان کنید.',
}

// ADR-0018 S1b follow-up: the same honest-reply discipline as
// PROVIDER_UNAVAILABLE_CHAT_REPLY above, for AttachmentsUnsupportedError's
// structural-last-resort branch (callGeminiChat pins to Gemini whenever an
// attachment is present, so this should never actually fire in practice --
// but a generic 500 is still the wrong failure mode if it ever does).
const ATTACHMENT_UNSUPPORTED_CHAT_REPLY: Record<Language, string> = {
  en: 'I could not process the attached file with the AI assistant right now. Please try again without the attachment, or contact support if this keeps happening.',
  de: 'Ich konnte die angehängte Datei gerade nicht mit dem KI-Assistenten verarbeiten. Bitte versuche es ohne den Anhang erneut oder wende dich an den Support, falls dies weiterhin auftritt.',
  fa: 'در حال حاضر امکان پردازش فایل پیوست‌شده توسط دستیار هوش مصنوعی وجود ندارد. لطفاً بدون پیوست دوباره امتحان کنید یا در صورت تکرار با پشتیبانی تماس بگیرید.',
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
  let requestedLane: 'fast' | 'legacy'
  try {
    const body = await request.json() as {
      message?: unknown
      session_id?: unknown
      mode?: unknown
      responseLanguage?: unknown
      documentId?: unknown
      timeZone?: unknown
      undoId?: unknown
      lane?: unknown
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
    // Chat V2 Slice 1: the client's route declaration for this turn.
    // 'legacy' for anything but the exact literal 'fast' (fail-closed) --
    // and even 'fast' is only a PREFERENCE: it is demoted below whenever
    // this handler's own deterministic write detection engages, so the
    // client can never route a write-shaped turn around server policy.
    requestedLane = body.lane === 'fast' ? 'fast' : 'legacy'
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
      console.log(`[Chat] userId=${userId} sessionId=${sessionId} mode=reasoning outcome=${reasoningOutcomeForLog(reply)} reply=${reply.length} chars`)
      return json({ reply }, 200, origin)
    } catch (err) {
      // INC-01: a provider failure (429/5xx/network) is a distinct outcome
      // from the model answering with something the schema-enforced call
      // still couldn't use (callGeminiReasoning's own no-content/finish-
      // reason checks) -- the former gets its own typed code + status so
      // the client (llmReasoningService.ts's createLlmReasoningCaller) can
      // tell "the AI never got a chance to answer" apart from "the model
      // responded badly," instead of collapsing both into the same
      // rawText:"" that used to feed the ask_clarification rescue.
      if (err instanceof ProviderUnavailableError) {
        // ENG-06f: stable cause tag. This is one of five producers of the
        // same user-facing "temporarily unavailable" sentence (the other
        // four: this file's plain-chat branch below, and three in the
        // client -- see src/features/chat/unavailableCause.ts for the full
        // list and why the shared sentence is kept). The literal is
        // duplicated from that module rather than imported, because
        // agent/worker is a separate deployable that never imports from
        // src/; unavailableCause.test.ts asserts the two stay identical.
        console.error(`[UnavailableCause] cause=WORKER_PROVIDER_UNAVAILABLE_REASONING httpStatus=${err.status ?? 'none'}`, err)
        return json({ error: 'The AI provider is temporarily unavailable.', code: 'PROVIDER_UNAVAILABLE' }, 503, origin)
      }
      // ENG-06d: a THIRD outcome, kept distinct from both of its
      // neighbours. The provider was reachable and answered (so not the
      // 503 above -- that wording is reserved for a real provider
      // failure), but the answer was truncated mid-JSON, so there is no
      // proposal to hand back. 502 (upstream returned something
      // unusable) matches what /agent/reason already returns for its own
      // unusable-response case (reasoning-endpoint.ts's
      // MODEL_RESPONSE_INVALID 502); the code is separate from that one
      // because this is specifically "cut off", which is actionable
      // (retry/shorten) in a way a generally invalid response is not.
      if (err instanceof ModelResponseIncompleteError) {
        console.error('[Chat] Reasoning mode incomplete response:', err)
        return json({ error: 'The AI model response was cut off before a complete proposal.', code: 'MODEL_RESPONSE_INCOMPLETE' }, 502, origin)
      }
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

    // ALF-1A (ADR-0021), section 8: pre-generate this turn's user-message
    // id BEFORE any INSERT into agent_chat_messages below, so every
    // possible outcome branch can supply it as `id` in that insert's body
    // (a plain client-supplied override of the column's own `default
    // gen_random_uuid()` -- the exact same pattern already used in
    // github-integration.ts) and reuse the SAME id as
    // ai_learning_events.source_message_id. This is what makes the
    // capture calls below never need a second lookup, a find-by-content/
    // timestamp match (both concurrency-unsafe), or a duplicate insert.
    const userMessageId = crypto.randomUUID()
    // ALF-1A (ADR-0021), section 4: resolved ONCE per turn (not
    // per-branch) -- every capture call site below shares this SAME
    // fail-closed config rather than each re-parsing env vars.
    const liveCaptureConfig: LiveCaptureConfig = resolveLiveCaptureConfig(env)

    // Task 22 / Slice 2B.1.1 -- routing: a request naming a calendar
    // concept is calendar business regardless of whether a time was
    // given. PO decision (SUPERSEDES Slice 2B.1's "LOCKED DOMAIN RULE"):
    // a request naming an EXPLICIT task noun that ALSO carries a resolved
    // time-of-day (tasks have no time-of-day column) now PRESERVES that
    // time by resolving directly to calendar business, instead of asking
    // the user to resolve an internal schema detail -- see
    // shared/schedulingDomain.ts and detectWriteDomainSignal's own
    // comment. Only a task write with NO explicit noun at all (a bare
    // personal statement like "I have a dentist appointment tomorrow at
    // 3pm") still silently resolves to calendar when a time is present --
    // unchanged. A date-only task-shaped request is unchanged from today.
    // Two DIFFERENT domain nouns both matching is genuinely ambiguous --
    // ask once, don't loop: no pending state is stored, so the very next
    // message is evaluated fresh and resolves on its own once it names
    // either domain.
    const writeDomainSignal = detectWriteDomainSignal(message, new Date(), timeZone)
    if (writeDomainSignal === 'ambiguous') {
      const reply = language === 'de'
        ? 'Soll ich ein Kalenderereignis oder eine Aufgabe erstellen?'
        : language === 'fa'
          ? 'رویداد تقویم بسازم یا تسک؟'
          : 'Should I create a calendar event or a task?'
      await supabasePost(env, 'agent_chat_messages', { id: userMessageId, user_id: userId, session_id: sessionId, role: 'user', content: message })
      await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'assistant', content: reply })
      // ALF-1A (ADR-0021) capture point: two conflicting domain nouns
      // (e.g. both a task noun and a calendar noun) in one message --
      // production code genuinely cannot resolve a single domain here,
      // so the truthful label is clarification/unknown, matching ALF-0's
      // own "ambiguous" eval-fixture category exactly.
      if (liveCaptureConfig.captureEnabled) {
        ctx.waitUntil(captureProductionRoutingTurn({
          env,
          config: liveCaptureConfig,
          userId,
          sessionId,
          sourceMessageId: userMessageId,
          rawMessage: message,
          label: {
            language,
            interactionClass: 'clarification',
            domain: 'unknown',
            requiresClarification: true,
            requiresApproval: false,
          },
        }))
      }
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
      // ALF-1A (ADR-0021): the exact same WriteIntentType production code
      // itself uses to compute `action` just below -- reused (not
      // recomputed) for writeIntentOutcomeIdentity at each capture point
      // in this block, so the label's intentType/toolId can never drift
      // from what `action` itself was derived from.
      const kind: WriteIntentType = taskWriteIntent?.kind ?? calendarWriteIntent?.kind ?? financeWriteIntent!.kind
      const action: 'create' | 'update' = kind.startsWith('create') ? 'create' : 'update'
      const mode = await resolveServerFlowWriteMode(env, userId, domain, action)
      if (mode === 'off') {
        const reply = language === 'de'
          ? 'Diese Flow-AI-Aktion ist in deinen Einstellungen ausgeschaltet.'
          : language === 'fa'
            ? 'این اقدام Flow AI در تنظیمات شما خاموش است.'
            : 'This Flow AI action is switched off in your settings.'
        await supabasePost(env, 'agent_chat_messages', { id: userMessageId, user_id: userId, session_id: sessionId, role: 'user', content: message })
        await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'assistant', content: reply })
        // ALF-1A (ADR-0021) capture point: a real write intent was
        // deterministically detected, but the domain+action is switched
        // off in this user's own settings -- requiresApproval is false
        // because no approval flow will ever be shown; nothing is pending.
        const offIdentity = writeIntentOutcomeIdentity(kind)
        if (offIdentity && liveCaptureConfig.captureEnabled) {
          ctx.waitUntil(captureProductionRoutingTurn({
            env,
            config: liveCaptureConfig,
            userId,
            sessionId,
            sourceMessageId: userMessageId,
            rawMessage: message,
            label: {
              language,
              interactionClass: 'write',
              domain,
              intentType: offIdentity.intentType,
              toolId: offIdentity.toolId,
              requiresClarification: false,
              requiresApproval: false,
            },
          }))
        }
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
          //
          // INC-01: resolveCreateTaskTitle throws ProviderUnavailableError
          // instead of returning undefined when the provider is down AND
          // pattern extraction also found nothing -- that specific case
          // must never reach executeAutoTaskWrite's `!intent.title` check,
          // since that would report the exact same "What should the task
          // be called?" clarification a genuinely ambiguous message gets,
          // masquerading a provider outage as the assistant asking a
          // question it was never able to ask.
          let providerUnavailable = false
          if (taskWriteIntent.kind === 'create_task' && !taskWriteIntent.dateClarificationNeeded && taskWriteIntent.titleSource !== 'correction') {
            try {
              taskWriteIntent.title = await resolveCreateTaskTitle(env, taskWriteIntent, message)
            } catch (err) {
              if (!(err instanceof ProviderUnavailableError)) throw err
              providerUnavailable = true
            }
          }
          const execution = providerUnavailable
            ? { status: 'provider_unavailable' as const, reply: PROVIDER_UNAVAILABLE_WRITE_REPLY[language] }
            : await executeAutoTaskWrite({ env, userId, language, intent: taskWriteIntent, now: new Date(), timeZone })
          const response = await respondToWriteExecution(env, ctx, userId, sessionId, origin, message, language, domain, action, mode, execution, { kind: taskWriteIntent.kind, targetFields: taskIntentTargetFields(taskWriteIntent) }, userMessageId, liveCaptureConfig)
          if (response) return response
        } else if (calendarWriteIntent) {
          // Task 22: same model-title-resolution treatment as tasks above.
          // INC-01: same provider-unavailable distinction as the task
          // branch above.
          // Slice 2B.1.1 correction (review blocker 4): sourceTaskReference
          // means executeAutoCalendarWrite is about to resolve this event's
          // title from an EXISTING task's own authoritative persisted row,
          // never from Gemini -- skip the model call entirely rather than
          // let its guess be computed and then discarded, and rather than
          // risk any model output surviving that resolution step.
          let providerUnavailable = false
          if (calendarWriteIntent.kind === 'create_calendar_event' && !calendarWriteIntent.dateClarificationNeeded && calendarWriteIntent.titleSource !== 'correction' && calendarWriteIntent.sourceTaskReference === undefined) {
            try {
              calendarWriteIntent.title = await resolveCreateEventTitle(env, calendarWriteIntent, message)
            } catch (err) {
              if (!(err instanceof ProviderUnavailableError)) throw err
              providerUnavailable = true
            }
          }
          const execution = providerUnavailable
            ? { status: 'provider_unavailable' as const, reply: PROVIDER_UNAVAILABLE_WRITE_REPLY[language] }
            : await executeAutoCalendarWrite({ env, userId, language, intent: calendarWriteIntent, now: new Date(), timeZone })
          const response = await respondToWriteExecution(env, ctx, userId, sessionId, origin, message, language, domain, action, mode, execution, { kind: calendarWriteIntent.kind, targetFields: calendarIntentTargetFields(calendarWriteIntent) }, userMessageId, liveCaptureConfig)
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
          const response = await respondToWriteExecution(env, ctx, userId, sessionId, origin, message, language, domain, action, mode, execution, { kind: financeWriteIntent.kind, targetFields: financeIntentTargetFields(financeWriteIntent) }, userMessageId, liveCaptureConfig)
          if (response) return response
        }
      }
      pendingWritePolicy = { domain, action, mode: 'ask' }
      // ALF-1A (ADR-0021) capture point: this branch is reached either by
      // a genuinely resolved mode==='ask', OR by mode==='auto' whose
      // execution outcome was 'not_found' (respondToWriteExecution
      // returned null above, so nothing captured there -- see that
      // function's own header comment). Either way, `pendingWritePolicy`
      // above is the literal, real value about to be sent back to the
      // frontend in this response's JSON -- requiresApproval=true here is
      // not an inference, it is exactly what that field already says.
      const askIdentity = writeIntentOutcomeIdentity(kind)
      if (askIdentity && liveCaptureConfig.captureEnabled) {
        ctx.waitUntil(captureProductionRoutingTurn({
          env,
          config: liveCaptureConfig,
          userId,
          sessionId,
          sourceMessageId: userMessageId,
          rawMessage: message,
          label: {
            language,
            interactionClass: 'write',
            domain,
            intentType: askIdentity.intentType,
            toolId: askIdentity.toolId,
            requiresClarification: false,
            requiresApproval: true,
          },
        }))
      }
    } else if (writeDomainSignal === 'none') {
      // ALF-1A (ADR-0021) capture point: no deterministic write trigger
      // matched anywhere in this message -- production code's own
      // handling for this case is to treat it as ordinary conversation
      // (build a system prompt, call the text-generation provider, return
      // its reply -- see the plain chat flow just below), with zero
      // domain-specific handling of any kind. That absence of special
      // handling IS the truthful label: interactionClass='conversation',
      // domain='none'. Captured here, decoupled from whether the model
      // call further below succeeds or fails, since writeDomainSignal
      // itself is already final at this point regardless of what happens
      // next.
      if (liveCaptureConfig.captureEnabled) {
        ctx.waitUntil(captureProductionRoutingTurn({
          env,
          config: liveCaptureConfig,
          userId,
          sessionId,
          sourceMessageId: userMessageId,
          rawMessage: message,
          label: {
            language,
            interactionClass: 'conversation',
            domain: 'none',
            requiresClarification: false,
            requiresApproval: false,
          },
        }))
      }
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

    const system = buildChatSystemPrompt(language, confirmedMemory, new Date(), timeZone)
    const fullHistory: ChatMessage[] = [...history, { role: 'user', content: modelFacingMessage }]

    // INC-01: a provider failure (429/5xx/network) here must not fall
    // through to the generic, content-less "Something went wrong on my
    // end" the outer catch below reports for any OTHER unexpected turn
    // failure (DB errors, etc.) -- that text is honest about SOMETHING
    // being wrong but not about WHAT, and the incident's second symptom
    // was exactly this generic message standing in for a knowable,
    // specific cause. Caught here, before the outer catch, so this one
    // specific cause gets a specific, honest reply instead.
    // Chat V2 Slice 1: the server-authoritative lane decision. The client's
    // 'fast' declaration survives only when this handler's own deterministic
    // write detection found nothing for the turn (pendingWritePolicy unset;
    // every other write outcome already returned above). The lane changes
    // ONLY the text-provider preference (Gemini primary) and the telemetry
    // line inside callGeminiChat -- policy, approval, history, and
    // persistence are identical on both lanes.
    const effectiveChatLane: 'fast' | 'legacy' = requestedLane === 'fast' && !pendingWritePolicy ? 'fast' : 'legacy'

    let rawReply: string
    try {
      rawReply = await callGeminiChat(system, fullHistory, env, { lane: effectiveChatLane }, attachmentImage)
    } catch (err) {
      // ADR-0018 S1b follow-up: structural last resort -- callGeminiChat
      // pins to Gemini whenever attachmentImage is set, so this branch
      // should not be reachable in practice, but a generic 500 is still
      // the wrong failure mode for it if something ever does throw it
      // (a misconfigured pin, a future refactor that drops it, ...) --
      // same honest-reply discipline as the ProviderUnavailableError
      // branch below, not a code-path this could silently regress into a
      // 500 for.
      if (err instanceof AttachmentsUnsupportedError) {
        console.error('[Chat] attachment provider error:', err)
        const reply = ATTACHMENT_UNSUPPORTED_CHAT_REPLY[language]
        await supabasePost(env, 'agent_chat_messages', { id: userMessageId, user_id: userId, session_id: sessionId, role: 'user', content: message })
        await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'assistant', content: reply })
        return json({ reply }, 200, origin)
      }
      if (!(err instanceof ProviderUnavailableError)) throw err
      // ENG-06f: see the reasoning branch's tag above. This producer is
      // the easiest of the five to mistake for the others, because it
      // returns a normal 200 carrying the honest sentence as the reply --
      // so in a tail with no status code to go on, only this tag
      // identifies it.
      console.error(`[UnavailableCause] cause=WORKER_PROVIDER_UNAVAILABLE_CHAT httpStatus=${err.status ?? 'none'}`, err)
      const reply = PROVIDER_UNAVAILABLE_CHAT_REPLY[language]
      await supabasePost(env, 'agent_chat_messages', { id: userMessageId, user_id: userId, session_id: sessionId, role: 'user', content: message })
      await supabasePost(env, 'agent_chat_messages', { user_id: userId, session_id: sessionId, role: 'assistant', content: reply })
      return json({ reply }, 200, origin)
    }

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

    // Persist both after a successful Gemini call so no orphaned turns are saved on error.
    // ALF-1A (ADR-0021): `id: userMessageId` here is the SAME id any
    // capture point above already used as ai_learning_events
    // .source_message_id for this turn (writeDomainSignal==='none', or
    // the pendingWritePolicy 'ask'/'not_found' fallthrough) -- this is
    // the actual row that id refers to.
    await supabasePost(env, 'agent_chat_messages', { id: userMessageId, user_id: userId, session_id: sessionId, role: 'user', content: message })
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

  // ADR-0018 S1: migrated to the TextGenerationProvider adapter.
  // MIG-01b: thinkingConfig removed -- gemini-3.6-flash returns 400
  // INVALID_ARGUMENT on thinkingConfig:{thinkingBudget:0} (see
  // geminiModel.ts and scripts/gemini-36-probe.ts's P3 finding). No
  // model-conditional logic added here either way (ADR-0018 Decision 2:
  // the adapter/call site encodes no model-specific policy) -- on
  // gemini-2.5-flash (still reachable via an env-pinned GEMINI_MODEL,
  // see wrangler.toml's comment) thinking is simply enabled now; accepted,
  // 2.5 is being retired. "No content" still throws here, not inside the
  // adapter (ADR-0018 Decision 3: that judgment call stays with the
  // caller).
  const result = await createProviders(env).text.generateText({
    system,
    turns: [{ role: 'user', content: user }],
    maxOutputTokens,
    temperature: 0.7,
  })

  console.log('[Gemini] finishReason:', result.finishReason)
  console.log('[Gemini] text length:', result.text.length)
  console.log('[Gemini] full text:', result.text)

  if (!result.text) throw new Error(`No content from Gemini (finishReason: ${result.finishReason})`)
  return result.text.trim()
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
  // ADR-0018 S1: now passed through providerOptions.inlineDataAttachment
  // -- GeminiTextGenerationProvider owns the "last turn, 'user' role only"
  // placement rule that used to live here (see its own comment).
  imageAttachment?: { mimeType: string; base64: string }
): Promise<string> {
  // MIG-01b: 1024 -> 2048 default -- see callGemini's own comment for why
  // (thinkingConfig removal + gemini-3.6-flash thinking consuming output
  // budget).
  const maxOutputTokens = options.maxOutputTokens ?? 2048
  const temperature = options.temperature ?? 0.7
  // Chat V2 Slice 1: 'legacy' when the caller says nothing, so every
  // pre-existing call shape keeps today's provider selection byte-for-byte.
  const lane = options.lane ?? 'legacy'

  // Chat V2 Slice 1 (ENG-06f fix): this line used to hardcode "to Gemini",
  // which was wrong whenever AI_TEXT_PROVIDER selected Workers AI -- the
  // provider that actually answered is now reported by the telemetry line
  // below instead of asserted up front.
  console.log(`[Chat] sending ${history.length} turns to text provider (lane=${lane})`)

  // MIG-01b: thinkingConfig removed -- see callGemini's own comment.
  // ADR-0018 S1b follow-up: an image attachment must WORK regardless of
  // AI_TEXT_PROVIDER, not be rejected -- pinned to Gemini here the same
  // way transcribePdf and /documents/analyze already are (createProviders.ts's
  // pinTextProvider option), rather than relying on
  // WorkersAITextGenerationProvider's generic attachments-unsupported
  // rejection for a request that structurally cannot succeed on that
  // provider.
  // Chat V2 Slice 1: the fast conversational lane prefers Gemini as PRIMARY
  // (createProviders' preferTextProvider -- keeps the AI_TEXT_FALLBACK
  // chain, unlike the attachment pin, which stays first and unchanged).
  const providerOptions = imageAttachment
    ? { pinTextProvider: 'gemini' as const }
    : lane === 'fast'
      ? { preferTextProvider: 'gemini' as const }
      : {}

  const requestId = crypto.randomUUID()
  const textCallStartedAt = Date.now()
  const result = await createProviders(env, fetch, providerOptions).text.generateText({
    system,
    turns: history,
    maxOutputTokens,
    temperature,
    // ADR-0018 S1 follow-up: attachmentPosition only matters (and is only
    // required by the adapter) when an attachment is actually present.
    ...(imageAttachment ? { attachmentPosition: 'after' as const } : {}),
    ...(imageAttachment
      ? { providerOptions: { inlineDataAttachment: { mimeType: imageAttachment.mimeType, data: imageAttachment.base64 } } }
      : {}),
  })

  // Chat V2 Slice 1: the structured text-lane diagnostics ENG-06f asked for
  // (provider, model, elapsed ms, tokens, fallbackUsed) -- one line, no
  // message contents, no secrets (see chat-text-telemetry.ts's contract).
  // Replaces the old finishReason/text-length line, whose surrounding logs
  // wrongly asserted "Gemini" regardless of which provider actually ran.
  console.log(formatChatTextTelemetryLine({
    requestId,
    lane,
    providerId: result.providerId,
    model: result.model,
    elapsedMs: Date.now() - textCallStartedAt,
    finishReason: result.finishReason,
    promptTokens: result.usage?.promptTokens,
    responseTokens: result.usage?.responseTokens,
    fallbackUsed: resolveFallbackUsed(
      result.providerId,
      resolveExpectedPrimaryProviderId(env, {
        pinnedToGemini: Boolean(imageAttachment),
        preferGemini: lane === 'fast',
      }),
    ),
  }))

  if (!result.text) throw new Error(`No content from text provider ${result.providerId ?? 'unknown'} (finishReason: ${result.finishReason})`)
  return result.text.trim()
}

// ENG-06d: the reasoning call's output budget, named because two things
// have to be reasoned about together -- the model's thinking tokens AND a
// whole structured proposal (up to a 4000-char engineeringInstruction,
// ENG-04) share this one ceiling. 8192 is the same figure MIG-01a's own
// probe used as its "much larger maxOutputTokens" length probe
// (scripts/gemini-36-probe.ts P8), i.e. the value this repo already
// treated as generous headroom for gemini-3.6-flash thinking; 4x the
// previous 2048, against an observed truncation that left only 243 chars.
const REASONING_MAX_OUTPUT_TOKENS = 8192

// ENG-06d: "the model answered, but its answer was cut off" -- distinct
// from ProviderUnavailableError (the provider never answered at all,
// INC-01) and from ProviderRequestError (our request was malformed). Kept
// here rather than in provider-errors.ts on purpose: ADR-0018 Decision 3
// puts the "is this response usable?" judgment with the CALLER, not the
// adapter -- the adapter reports finishReason faithfully and takes no
// view on it, exactly as it already does for the empty-text case
// immediately above this one.
class ModelResponseIncompleteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelResponseIncompleteError'
  }
}

// =============================================
// ENG-06i: the LOCAL reasoning endpoint has logged `outcome=<type>` since it
// shipped (reasoning-endpoint.ts's [LocalReasoning] line); the DEPLOYED one
// logged only a character count. That gap is why classification variance on
// the live path had to be inferred rather than read: the ENG-06e tail
// captured three byte-identical requests answering with 538/385/496-char
// proposals, and telling which classifications those were meant reasoning
// backwards from payload size. This closes that gap with one field, named
// identically so a single `outcome=` grep spans both endpoints.
//
// Read for the log line only, never trusted and never acted on. Two
// deliberate properties:
//
//  1. This is the MODEL'S CLAIMED type, sampled BEFORE the client's
//     deterministic validator runs -- unlike the local endpoint's field,
//     which is post-normalizeProposal. The validator reclassifies routinely
//     (ENG-06g sends a hedged type carrying an engineering-task-shaped
//     target to ask_clarification), so `outcome=unsupported` here means "the
//     model said unsupported", NOT "the user was told it is unsupported".
//     Reading it as the latter is exactly the inference error this line
//     exists to remove, so it is written down rather than left implicit.
//
//  2. A parse failure is a log VALUE, not an error. This runs on a request
//     that has already succeeded and is about to return 200, and the client
//     owns parsing the proposal. Nothing here may change what the caller
//     gets -- including by throwing.
function reasoningOutcomeForLog(reply: string): string {
  try {
    const parsed = JSON.parse(reply) as { type?: unknown } | null
    return typeof parsed?.type === 'string' ? parsed.type : 'absent'
  } catch {
    return 'unparseable'
  }
}

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
  // ADR-0018 S2: migrated to the StructuredGenerationProvider adapter.
  // A ProviderUnavailableError/ProviderRequestError still propagates
  // unchanged (this function never catches either) -- INC-01's own
  // `err instanceof ProviderUnavailableError` check in this file's mode:
  // 'reasoning' handler (the 503 PROVIDER_UNAVAILABLE branch) is checking
  // the SAME class the adapter throws, imported from provider-errors.ts,
  // not a new one.
  const result = await createProviders(env).structured.generateStructured({
    system: buildReasoningSystemInstruction(responseLanguage),
    turns: [{ role: 'user', content: reasoningPrompt }],
    schema: buildReasoningResponseSchema(),
    // ENG-06d: 2048 -> REASONING_MAX_OUTPUT_TOKENS. Captured live
    // (ENG-06c, 2026-08-26T19:26:29Z): this call returned
    // finishReason=MAX_TOKENS with only 243 chars of text after 14 493 ms
    // -- gemini-3.6-flash spent essentially the whole 2048-token budget
    // thinking and truncated the JSON mid-object, which then failed
    // parseLlmIntentJson on the client and silently degraded to
    // ask_clarification (no approval card).
    //
    // Deliberately NOT fixed with thinkingConfig:{thinkingBudget:0}: that
    // is the OPPOSITE of the MIG-01b precedent. gemini-3.6-flash returns
    // 400 INVALID_ARGUMENT for thinkingConfig (geminiModel.ts,
    // scripts/gemini-36-probe.ts P3/P7), which is precisely why MIG-01b
    // REMOVED it from every call site and why two regression tests assert
    // this codebase never sends it. Sending it here would turn an
    // intermittent truncation into a hard 400 on every reasoning call.
    // More budget is the only lever this model actually accepts -- the
    // same lever MIG-01b already pulled everywhere else (256/512/1024 ->
    // 2048); this call site simply needs more of it than the others
    // because it emits a whole structured proposal, not a sentence.
    maxOutputTokens: REASONING_MAX_OUTPUT_TOKENS,
    temperature: 0,
  })

  // ENG-06d: usage is logged, not just length -- thinking tokens are
  // charged against maxOutputTokens but appear in neither promptTokens nor
  // responseTokens, so "243 chars" alone could not distinguish "the model
  // answered briefly" from "the model burned the budget thinking and got
  // cut off". That ambiguity is what made ENG-06c's root cause a
  // three-round inference instead of one log line.
  console.log(
    '[Chat] reasoning mode finishReason:', result.rawFinishReason ?? result.finishReason,
    'text length:', result.rawText.length,
    'promptTokens:', result.usage?.promptTokens ?? 'n/a',
    'thinkingTokens:', result.usage?.thinkingTokens ?? 'n/a',
    'responseTokens:', result.usage?.responseTokens ?? 'n/a',
    'maxOutputTokens:', REASONING_MAX_OUTPUT_TOKENS,
  )

  if (!result.rawText) throw new Error(`No content from Gemini reasoning (finishReason: ${result.rawFinishReason ?? result.finishReason})`)
  // ENG-06d: the check reasoning-endpoint.ts:620 already had locally and
  // this deployed path did not. A non-stop finish means the JSON is cut
  // off mid-object; forwarding it lets the client's own parse failure
  // manufacture an ask_clarification out of a truncated proposal -- the
  // exact "fabricated clarification" failure mode INC-01 was raised to
  // eliminate, arriving here by a different route.
  //
  // Raised as a DISTINCT typed error rather than retried. A retry would
  // not fit: the measured worst case for one reasoning call is 14 493 ms
  // (ENG-06c) and the client aborts the whole request at
  // REASONING_FETCH_TIMEOUT_MS = 20 000 ms (PR #177), so a second call
  // would routinely blow that ceiling and surface as the very
  // "temporarily unavailable" message this fix is meant to stop
  // manufacturing -- trading a truncated proposal for a fake outage.
  // The budget increase above addresses the cause; this check makes the
  // residual case honest instead of silent.
  if (result.finishReason !== 'stop') {
    throw new ModelResponseIncompleteError(
      `Gemini reasoning response was cut off (finishReason: ${result.rawFinishReason ?? result.finishReason}, textLength: ${result.rawText.length})`,
    )
  }
  return result.rawText.trim()
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
      `https://generativelanguage.googleapis.com/v1beta/models/${resolveGeminiModel(env)}:generateContent?key=${env.GEMINI_API_KEY}`,
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
            // MIG-01b: 512 -> 2048, thinkingConfig removed -- see
            // handleTaskSuggestions's identical comment above.
            maxOutputTokens: 2048,
            temperature: 0.1,
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
      `https://generativelanguage.googleapis.com/v1beta/models/${resolveGeminiModel(env)}:generateContent?key=${env.GEMINI_API_KEY}`,
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
            // MIG-01b: 256 -> 2048, thinkingConfig removed -- see
            // handleTaskSuggestions's identical comment above.
            maxOutputTokens: 2048,
            temperature: 0.1,
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

    // Text content: embed the document text in the prompt when provided,
    // otherwise just the message (both former no-text branches were
    // identical).
    const text = body.text
      ? `${body.message}\n\nDocument text:\n${body.text.slice(0, 30000)}`
      : body.message

    // ADR-0018 S1: migrated to the TextGenerationProvider adapter. A
    // non-ok HTTP response (429/5xx via ProviderUnavailableError, other
    // non-ok via ProviderRequestError) is caught HERE, not by the outer
    // catch below, so the pre-existing "Gemini error: <status>"/502 shape
    // is preserved exactly -- only a genuine network-level failure (no
    // HTTP status at all -- ProviderUnavailableError with `.status`
    // undefined) still falls through to the outer catch's generic 500,
    // unchanged from before this migration (the original raw fetch() was
    // never specially caught for that case either).
    let answer: string
    try {
      // ADR-0018 S1b: /documents/analyze can carry a file attachment --
      // pinned to Gemini (pinTextProvider: 'gemini' ignores
      // AI_TEXT_PROVIDER entirely) rather than relying on
      // WorkersAITextGenerationProvider's generic attachments-unsupported
      // rejection.
      const result = await createProviders(env, fetch, { pinTextProvider: 'gemini' }).text.generateText({
        turns: [{ role: 'user', content: text }],
        temperature: 0.3,
        maxOutputTokens: 4096,
        // ADR-0018 S1 follow-up: the ORIGINAL raw fetch here pushed the
        // fileData part BEFORE the text part (see the pre-S1 code) -- S1's
        // adapter briefly flipped this to "after" by an unverified,
        // wrongly-generalized assumption. 'before' restores the original
        // order.
        ...(body.fileData?.base64 ? { attachmentPosition: 'before' as const } : {}),
        providerOptions: body.fileData?.base64
          ? { inlineDataAttachment: { mimeType: body.fileData.mimeType, data: body.fileData.base64 } }
          : undefined,
      })
      answer = result.text
    } catch (err) {
      if (
        (err instanceof ProviderUnavailableError && err.status !== undefined) ||
        err instanceof ProviderRequestError
      ) {
        console.error('[documents/analyze] Gemini error:', (err as ProviderUnavailableError | ProviderRequestError).status, (err as ProviderUnavailableError | ProviderRequestError).body)
        return json({ error: `Gemini error: ${(err as ProviderUnavailableError | ProviderRequestError).status}` }, 502, origin)
      }
      throw err
    }

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
