import type { ConfirmedPersonalMemoryRecord } from './personal-memory-prompt-serialization'
// ADR-0018 S2: moved to its own leaf module -- re-exported here unchanged
// for every existing `import { ChatMessage } from './types'` -- see
// chatMessage.ts's own header comment for why.
export type { ChatMessage } from './chatMessage'

export interface Env {
  SMARTFLOW_WORKER_MODE?: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_KEY: string
  GEMINI_API_KEY: string
  GEMINI_MODEL: string
  GITHUB_APP_ID?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_APP_SLUG?: string
  GITHUB_SETUP_URL?: string
  GITHUB_CALLBACK_URL?: string
  GITHUB_ALLOWED_ORIGINS?: string
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_CLIENT_SECRET?: string
  AI: Ai  // Cloudflare Workers AI binding
  // ADR-0018 S1b: 'gemini' (default) | 'workers-ai' -- selects the
  // TextGenerationProvider createProviders() constructs. Per-deployment
  // config (wrangler.toml [vars]), not per-request; no fallback chain yet
  // (S1c). Structured generation and embeddings are unaffected -- they
  // stay Gemini-only per ADR-0018 Decision 5 regardless of this value.
  AI_TEXT_PROVIDER?: string
  // ENG-04: shared secret the companion presents to claim/report on
  // engineering_tasks. Not a Supabase user credential -- the companion is
  // not a logged-in user, so this is the sole authentication mechanism for
  // GET /engineering-tasks/pending and POST /engineering-tasks/:id/report.
  ENGINEERING_TASKS_COMPANION_TOKEN?: string
  // ALF-1A (ADR-0021): server-owned, fail-closed live-learning-capture
  // config. All six are plain wrangler [vars] strings (Workers AI needs no
  // browser-exposed secret) -- see
  // agent/worker/ai-learning/live-capture-config.ts's resolveLiveCaptureConfig
  // for the exact parsing/validation rules. Absent or malformed in ANY of
  // these means capture and/or shadow prediction stay OFF; there is no
  // "best guess" default. None of these are set to an enabling value in
  // this slice.
  AI_LEARNING_CAPTURE_ENABLED?: string
  AI_SHADOW_ENABLED?: string
  AI_SHADOW_PROVIDER?: string
  AI_SHADOW_MODEL_ID?: string
  AI_SHADOW_MODEL_VERSION?: string
  AI_SHADOW_SAMPLE_RATE?: string
}

export type Language = 'en' | 'de' | 'fa'
export type BriefingMode = 'daily' | 'weekly'

export interface MemoryEntry {
  key: string
  value: string
  source: 'manual' | 'auto' | 'ai' | 'agent'
}

/**
 * ADR-0011 Confirmed Personal Memory Consumption v1. A `personal_memory_records`
 * row already filtered to `status IN (user_confirmed, user_corrected)` by the
 * query that produced it (see context-builder.ts's `fetchConfirmedPersonalMemory`)
 * -- never re-filtered by consumers, per the ADR's enforcement-at-the-query rule.
 * Defined in personal-memory-prompt-serialization.ts (not here) so that
 * self-contained module stays free of this file's Cloudflare Workers-specific
 * `Env`/`Ai` types -- see that file's header for why.
 */
export type { ConfirmedPersonalMemoryRecord } from './personal-memory-prompt-serialization'

export interface ExtractedFact {
  key: string
  value: string
}

export interface JournalEntry {
  date: string
  mood: number | null
  content: string | null
}

export interface JournalContext {
  entries: JournalEntry[]
  entryCount: number
  averageMood: number | null
}

export interface TaskSummary {
  title: string
  due_date: string
  overdue: boolean
}

export interface HabitContext {
  completedCount: number
  totalPossible: number
  completionRate: number  // 0–100
}

export interface UserContext {
  userId: string
  language: Language
  mode: BriefingMode
  /** Legacy `user_context` rows -- always `[]` now (ADR-0011). Kept only so the still-dead, `ENABLE_AUTO_MEMORY_WRITE`-gated extraction functions in index.ts continue to typecheck; not fetched live. */
  memory: MemoryEntry[]
  /** ADR-0011 Confirmed Personal Memory Consumption v1 -- the live prompt-personalization source, replacing `memory` above for that purpose. */
  confirmedMemory: ConfirmedPersonalMemoryRecord[]
  journal: JournalContext
  finance: FinanceContext
  calendar: CalendarContext
  tasks: TaskSummary[]        // populated in weekly mode; empty array in daily
  habits: HabitContext | null // populated in weekly mode; null in daily
}

export interface FinanceContext {
  totalIncome: number
  totalExpenses: number
  net: number
  topExpenseCategory: string
  transactionCount: number
  currency: string
  expenseChangePercent: number | null
}

export interface CalendarContext {
  eventsThisWeek: CalendarEvent[]
  eventCount: number
  nextEvent: CalendarEvent | null
}

export interface CalendarEvent {
  title: string
  start_time: string
  end_time: string | null
  location: string | null
}

export interface AgentBriefing {
  content: string
  language: Language
  mode: BriefingMode
  context: UserContext
  triggered_by: 'cron' | 'user' | 'alert'
}

export interface ChatOptions {
  maxOutputTokens?: number
  temperature?: number
  // Chat V2 Slice 1: 'fast' = an ordinary conversational turn. The client
  // DECLARES its route, but the server stays authoritative: handleChat
  // demotes the declaration to 'legacy' whenever its own deterministic
  // write detection engaged for the turn (see effectiveChatLane there).
  // The lane affects ONLY text-provider preference (Gemini primary for
  // 'fast') and the telemetry line -- never write policy, approval, or
  // persistence.
  lane?: 'fast' | 'legacy'
}
