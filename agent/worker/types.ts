import type { ConfirmedPersonalMemoryRecord } from './personal-memory-prompt-serialization'

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
  AI: Ai  // Cloudflare AI Gateway
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

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  // Task 22-fix (C1 off-by-one): optional so every existing call site that
  // builds a ChatMessage without it (the Gemini-facing history array
  // doesn't need it) keeps compiling unchanged -- see flow-write-policy.ts's
  // RecentChatTurn.createdAt for why this is needed for write-intent
  // reassembly specifically.
  createdAt?: string
}

export interface ChatOptions {
  maxOutputTokens?: number
  temperature?: number
}
