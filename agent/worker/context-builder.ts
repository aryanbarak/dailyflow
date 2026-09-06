import type {
  Env, UserContext, FinanceContext, CalendarContext, Language,
  CalendarEvent, BriefingMode, JournalContext, JournalEntry,
  TaskSummary, HabitContext, ConfirmedPersonalMemoryRecord,
} from './types'

// =============================================
// Generic REST helper — GET /rest/v1/<path>
// =============================================
export async function supabaseGet<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Accept': 'application/json',
    },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase REST error (${path}): ${err}`)
  }

  return res.json()
}

// =============================================
// Generic REST helper — POST /rest/v1/<table>
// =============================================
export async function supabasePost(
  env: Env,
  table: string,
  body: Record<string, unknown>,
  prefer = 'return=minimal'
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer': prefer,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase POST error (${table}): ${err}`)
  }
}

// =============================================
// Generic REST helper — PATCH /rest/v1/<path>
// =============================================
export async function supabasePatch(
  env: Env,
  path: string,
  body: Record<string, unknown>,
  prefer = 'return=minimal'
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer': prefer,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Supabase PATCH error (${path}): ${err}`)
  }
}

// =============================================
// ADR-0011 Confirmed Personal Memory Consumption v1 -- the ONLY read
// enforcement point on the Worker side: `status` is filtered in the query
// itself (`status=in.(...)`), never by consumer code afterward, mirroring
// personalMemoryRecordRepository.ts's listConfirmedByOwner on the browser
// side exactly. `limit` bounds the read; the per-kind cap is a separate,
// later step in personal-memory-prompt-serialization.ts.
// =============================================
export async function fetchConfirmedPersonalMemory(
  userId: string,
  env: Env,
  limit = 30
): Promise<ConfirmedPersonalMemoryRecord[]> {
  const rows = await supabaseGet<Array<{ kind: string; content: unknown; created_at: string }>>(
    env,
    `personal_memory_records?user_id=eq.${userId}&status=in.(user_confirmed,user_corrected)&select=kind,content,created_at&order=created_at.desc&limit=${limit}`
  )

  return rows.map(r => ({
    kind: r.kind as ConfirmedPersonalMemoryRecord['kind'],
    content: r.content as Record<string, unknown>,
    createdAt: r.created_at,
  }))
}

// =============================================
// CORE-W2 (2026-09-06, CORE audit item ۳-۴): the user's own persona
// document (user_persona, migration 20260906120000) -- a hand-written,
// user-OWNED markdown doc, distinct from model-extracted personal memory.
// Best-effort by design: any read failure returns null and the chat turn
// proceeds without a persona section (same degradation posture as the
// overlap check in personal-memory-extraction-endpoint.ts).
// =============================================
export async function fetchUserPersona(userId: string, env: Env): Promise<string | null> {
  try {
    const rows = await supabaseGet<Array<{ content: string | null }>>(
      env,
      `user_persona?user_id=eq.${userId}&select=content&limit=1`
    )
    const content = rows[0]?.content
    if (typeof content !== 'string') return null
    const trimmed = content.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch (error) {
    console.error(`[Persona] read failed (continuing without persona): ${(error as Error).message}`)
    return null
  }
}

// =============================================
// User language from user_settings
// =============================================
export async function fetchUserLanguage(userId: string, env: Env): Promise<Language> {
  const rows = await supabaseGet<Array<{ language: string }>>(
    env,
    `user_settings?select=language&user_id=eq.${userId}&limit=1`
  )
  const rawLang = rows[0]?.language ?? null
  if (rawLang === 'de' || rawLang === 'fa') return rawLang
  return 'en'
}

// =============================================
// Journal — last 7 days (both modes)
// =============================================
export async function fetchJournalContext(
  userId: string,
  env: Env
): Promise<JournalContext> {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const dateStr = sevenDaysAgo.toISOString().slice(0, 10)

  const rows = await supabaseGet<Array<{ date: string; mood: number | null; content: string | null }>>(
    env,
    `journal_entries?select=date,mood,content&user_id=eq.${userId}&date=gte.${dateStr}&order=date.desc&limit=7`
  )

  const moodEntries = rows.filter(r => r.mood !== null)
  const averageMood = moodEntries.length > 0
    ? Math.round((moodEntries.reduce((s, r) => s + (r.mood ?? 0), 0) / moodEntries.length) * 10) / 10
    : null

  const entries: JournalEntry[] = rows.map(r => ({
    date: r.date,
    mood: r.mood ?? null,
    content: r.content ? r.content.slice(0, 200) : null,
  }))

  return { entries, entryCount: rows.length, averageMood }
}

// =============================================
// Tasks — due this week + overdue (weekly mode)
// =============================================
export async function fetchTaskContext(
  userId: string,
  env: Env
): Promise<TaskSummary[]> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  // End of the current week (Sunday)
  const weekEnd = new Date(now)
  weekEnd.setDate(now.getDate() - now.getDay() + 7)
  const weekEndStr = weekEnd.toISOString().slice(0, 10)

  const rows = await supabaseGet<Array<{ title: string; due_date: string }>>(
    env,
    `tasks?select=title,due_date&user_id=eq.${userId}&completed=eq.false&due_date=lte.${weekEndStr}&order=due_date.asc&limit=15`
  )

  return rows
    .filter(r => r.due_date)
    .map(r => ({
      title: r.title,
      due_date: r.due_date,
      overdue: r.due_date < today,
    }))
}

// =============================================
// Tasks — full snapshot for AI suggestions
// =============================================
export interface TaskSnapshot {
  total: number
  open: number
  completed: number
  overdue: number
  noDueDate: number
  completedThisWeek: number
  overdueList: string[]
  noDueDateList: string[]
  recentlyCompleted: string[]
}

export async function fetchTaskSnapshot(userId: string, env: Env): Promise<TaskSnapshot> {
  const rows = await supabaseGet<Array<{
    title: string
    completed: boolean
    due_date: string | null
    completed_at: string | null
  }>>(env, `tasks?select=title,completed,due_date,completed_at&user_id=eq.${userId}&order=created_at.desc&limit=100`)

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const total = rows.length
  const open = rows.filter(r => !r.completed).length
  const completed = rows.filter(r => r.completed).length
  const overdue = rows.filter(r => !r.completed && r.due_date && r.due_date < today).length
  const noDueDate = rows.filter(r => !r.completed && !r.due_date).length
  const completedThisWeek = rows.filter(r => r.completed_at && r.completed_at >= weekAgo).length
  const overdueList = rows.filter(r => !r.completed && r.due_date && r.due_date < today).map(r => r.title).slice(0, 5)
  const noDueDateList = rows.filter(r => !r.completed && !r.due_date).map(r => r.title).slice(0, 5)
  const recentlyCompleted = rows.filter(r => r.completed_at && r.completed_at >= weekAgo).map(r => r.title).slice(0, 5)

  return { total, open, completed, overdue, noDueDate, completedThisWeek, overdueList, noDueDateList, recentlyCompleted }
}

// =============================================
// Habits — snapshot for AI habit suggestions
// =============================================
export interface HabitSnapshotItem {
  title: string
  completionRate: number
  currentStreak: number
  longestStreak: number
  atBestStreak: boolean
  notCompletedIn3Days: boolean
}

export interface HabitSnapshot {
  total: number
  habits: HabitSnapshotItem[]
  atRiskCount: number
  bestStreakCount: number
}

export async function fetchHabitSnapshot(userId: string, env: Env): Promise<HabitSnapshot> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString().slice(0, 10)

  const [habitRows, completionRows] = await Promise.all([
    supabaseGet<Array<{ id: string; title: string; created_at: string }>>(
      env, `habits?select=id,title,created_at&user_id=eq.${userId}&is_active=eq.true&order=created_at.asc`
    ),
    supabaseGet<Array<{ habit_id: string; completed_date: string }>>(
      env, `habit_completions?select=habit_id,completed_date&user_id=eq.${userId}&completed_date=gte.${thirtyDaysAgo}`
    ),
  ])

  const habits: HabitSnapshotItem[] = habitRows.map(h => {
    const comps = completionRows.filter(c => c.habit_id === h.id)
    const dates = comps.map(c => c.completed_date).sort().reverse()

    // Streak calculation — same logic as frontend habitsService.ts
    let currentStreak = 0
    if (dates.length > 0 && (dates[0] === today || dates[0] === yesterday)) {
      let checkDate = dates[0]
      for (const date of dates) {
        if (currentStreak === 0) {
          currentStreak = 1
          checkDate = date
        } else {
          const expected = new Date(checkDate + 'T00:00:00')
          expected.setDate(expected.getDate() - 1)
          const expectedStr = expected.toISOString().slice(0, 10)
          if (date === expectedStr) { currentStreak++; checkDate = date }
          else break
        }
      }
    }

    let longestStreak = currentStreak
    let streak = 1
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + 'T00:00:00')
      const curr = new Date(dates[i] + 'T00:00:00')
      const diff = Math.round((prev.getTime() - curr.getTime()) / 86400000)
      if (diff === 1) { streak++; if (streak > longestStreak) longestStreak = streak }
      else streak = 1
    }

    // Completion rate — same formula as frontend
    const daysSinceCreation = Math.ceil((now.getTime() - new Date(h.created_at).getTime()) / 86400000)
    const ratePeriodDays = Math.max(1, Math.min(30, daysSinceCreation))
    const completionRate = Math.round((comps.length / ratePeriodDays) * 100)

    const mostRecent = dates[0] ?? null
    const notCompletedIn3Days = !mostRecent || mostRecent < threeDaysAgo
    const atBestStreak = currentStreak === longestStreak && longestStreak > 1

    return { title: h.title, completionRate, currentStreak, longestStreak, atBestStreak, notCompletedIn3Days }
  })

  return {
    total: habits.length,
    habits,
    atRiskCount: habits.filter(h => h.notCompletedIn3Days).length,
    bestStreakCount: habits.filter(h => h.atBestStreak).length,
  }
}

// =============================================
// Calendar — snapshot for AI schedule suggestions
// =============================================
export interface CalendarSnapshot {
  totalThisWeek: number
  freeDays: string[]
  busyDays: { date: string; count: number }[]
  categories: Record<string, number>
  eventList: { title: string; date: string; time: string; type: string | null }[]
}

export async function fetchCalendarSnapshot(userId: string, env: Env): Promise<CalendarSnapshot> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const rows = await supabaseGet<Array<{
    title: string
    date: string
    start_time: string | null
    type: string | null
  }>>(env, `calendar_events?select=title,date,start_time,type&user_id=eq.${userId}&date=gte.${today}&date=lte.${weekEnd}&order=date.asc,start_time.asc&limit=50`)

  const byDate: Record<string, number> = {}
  const categories: Record<string, number> = {}
  const eventList: CalendarSnapshot['eventList'] = []

  for (const r of rows) {
    byDate[r.date] = (byDate[r.date] ?? 0) + 1
    if (r.type) categories[r.type] = (categories[r.type] ?? 0) + 1
    eventList.push({ title: r.title, date: r.date, time: r.start_time ?? 'all-day', type: r.type })
  }

  const allDays: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000)
    allDays.push(d.toISOString().slice(0, 10))
  }

  const freeDays = allDays.filter(d => !byDate[d])
  const busyDays = Object.entries(byDate)
    .filter(([, count]) => count >= 2)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.count - a.count)

  return { totalThisWeek: rows.length, freeDays, busyDays, categories, eventList: eventList.slice(0, 15) }
}

// =============================================
// Habits — completion rate this week (weekly)
// =============================================
export async function fetchHabitContext(
  userId: string,
  env: Env
): Promise<HabitContext | null> {
  const now = new Date()

  // Monday of the current week
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay() + 1)
  const weekStartStr = weekStart.toISOString().slice(0, 10)
  const todayStr = now.toISOString().slice(0, 10)

  const [habits, completions] = await Promise.all([
    supabaseGet<Array<{ id: string }>>(
      env,
      `habits?select=id&user_id=eq.${userId}&is_active=eq.true`
    ),
    supabaseGet<Array<{ habit_id: string }>>(
      env,
      `habit_completions?select=habit_id&user_id=eq.${userId}&completed_date=gte.${weekStartStr}&completed_date=lte.${todayStr}`
    ),
  ])

  if (habits.length === 0) return null

  // Days elapsed this week (Mon=1 … Sun=7)
  const rawDay = now.getDay()
  const daysElapsed = rawDay === 0 ? 7 : rawDay

  const totalPossible = habits.length * daysElapsed
  const completedCount = completions.length
  const completionRate = totalPossible > 0
    ? Math.round((completedCount / totalPossible) * 100)
    : 0

  return { completedCount, totalPossible, completionRate }
}

// =============================================
// Finance — snapshot for AI suggestions
// =============================================
export interface FinanceSnapshot {
  totalIncome: number
  totalExpenses: number
  net: number
  topCategories: { category: string; amount: number }[]
  lastMonthExpenses: number
  expenseChangePct: number | null
  incomeSpentPct: number | null
  transactionCount: number
  recentTransactions: { date: string; type: string; category: string; amount: number; notes: string | null }[]
}

export async function fetchFinanceSnapshot(userId: string, env: Env): Promise<FinanceSnapshot> {
  const now = new Date()
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10)
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const firstOfLastMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`

  const rows = await supabaseGet<Array<{
    date: string; type: string; category: string; amount: number; notes: string | null
  }>>(env, `finance_transactions?select=date,type,category,amount,notes&user_id=eq.${userId}&date=gte.${ninetyDaysAgo}&order=date.desc&limit=200`)

  const currentMonth = rows.filter(r => r.date >= firstOfMonth)
  const lastMonth = rows.filter(r => r.date >= firstOfLastMonth && r.date < firstOfMonth)

  const income = currentMonth.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0)
  const expenses = currentMonth.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0)
  const lastMonthExp = lastMonth.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0)

  const catTotals: Record<string, number> = {}
  for (const r of currentMonth.filter(r2 => r2.type === 'expense')) {
    catTotals[r.category] = (catTotals[r.category] ?? 0) + r.amount
  }
  const topCategories = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))

  const expenseChangePct = lastMonthExp > 0 ? Math.round(((expenses - lastMonthExp) / lastMonthExp) * 100) : null
  const incomeSpentPct = income > 0 ? Math.round((expenses / income) * 100) : null

  return {
    totalIncome: Math.round(income * 100) / 100,
    totalExpenses: Math.round(expenses * 100) / 100,
    net: Math.round((income - expenses) * 100) / 100,
    topCategories,
    lastMonthExpenses: Math.round(lastMonthExp * 100) / 100,
    expenseChangePct,
    incomeSpentPct,
    transactionCount: currentMonth.length,
    recentTransactions: rows.slice(0, 15).map(r => ({ ...r, amount: Math.round(r.amount * 100) / 100 })),
  }
}

// =============================================
// داده‌های Finance ماه جاری
// =============================================
export async function fetchFinanceContext(
  userId: string,
  env: Env
): Promise<FinanceContext> {
  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()

  const currentRows = await supabaseGet<Array<{ amount: number }>>(env,
    `finance_transactions?select=amount&user_id=eq.${userId}&date=gte.${firstOfMonth}`)

  const income = currentRows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0)
  const expenses = currentRows.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0)
  const transactionCount = currentRows.length

  const catRows = await supabaseGet<Array<{ category: string; amount: number }>>(env,
    `finance_transactions?select=category,amount&user_id=eq.${userId}&amount=lt.0&date=gte.${firstOfMonth}`)

  const catTotals: Record<string, number> = {}
  for (const row of catRows) {
    if (row.category) catTotals[row.category] = (catTotals[row.category] ?? 0) + Math.abs(row.amount)
  }
  const topExpenseCategory = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown'

  const lastMonthRows = await supabaseGet<Array<{ amount: number }>>(env,
    `finance_transactions?select=amount&user_id=eq.${userId}&amount=lt.0&date=gte.${firstOfLastMonth}&date=lt.${firstOfMonth}`)
  const lastMonthExpenses = lastMonthRows.reduce((s, r) => s + Math.abs(r.amount), 0)

  const expenseChangePercent = lastMonthExpenses > 0
    ? Math.round(((expenses - lastMonthExpenses) / lastMonthExpenses) * 100)
    : null

  return {
    totalIncome: Math.round(income * 100) / 100,
    totalExpenses: Math.round(expenses * 100) / 100,
    net: Math.round((income - expenses) * 100) / 100,
    topExpenseCategory,
    transactionCount,
    currency: 'EUR',
    expenseChangePercent,
  }
}

// =============================================
// داده‌های Calendar این هفته
// =============================================
export async function fetchCalendarContext(
  userId: string,
  env: Env
): Promise<CalendarContext> {
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay() + 1) // Monday
  weekStart.setHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)

  const events = await supabaseGet<CalendarEvent[]>(env,
    `calendar_events?select=title,start_time,end_time,location&user_id=eq.${userId}&start_time=gte.${weekStart.toISOString()}&start_time=lte.${weekEnd.toISOString()}&order=start_time.asc&limit=10`)

  const nextEvent = events.find(e => new Date(e.start_time) > now) ?? null

  return {
    eventsThisWeek: events,
    eventCount: events.length,
    nextEvent,
  }
}

// =============================================
// Context کامل یه کاربر رو می‌سازه
// =============================================
export async function buildUserContext(
  userId: string,
  env: Env,
  mode: BriefingMode = 'daily'
): Promise<UserContext> {
  const language = await fetchUserLanguage(userId, env)
  console.log(`[Context] userId=${userId} language=${language} mode=${mode}`)

  if (mode === 'weekly') {
    const [finance, calendar, confirmedMemory, journal, tasks, habits] = await Promise.all([
      fetchFinanceContext(userId, env),
      fetchCalendarContext(userId, env),
      fetchConfirmedPersonalMemory(userId, env),
      fetchJournalContext(userId, env),
      fetchTaskContext(userId, env),
      fetchHabitContext(userId, env),
    ])
    return { userId, language, mode, memory: [], confirmedMemory, journal, finance, calendar, tasks, habits }
  }

  const [finance, calendar, confirmedMemory, journal] = await Promise.all([
    fetchFinanceContext(userId, env),
    fetchCalendarContext(userId, env),
    fetchConfirmedPersonalMemory(userId, env),
    fetchJournalContext(userId, env),
  ])
  return { userId, language, mode, memory: [], confirmedMemory, journal, finance, calendar, tasks: [], habits: null }
}
