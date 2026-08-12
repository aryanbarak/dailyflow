import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useAppearance } from '@/features/settings/appearanceStore'
import { createDirectionalMarkdownComponents } from '@/lib/bidiText'
import {
  getAiResponseLanguageInstruction,
  getStoredAiResponseLanguage,
  resolveAiResponseLanguage,
  type SupportedAiResponseLanguage,
} from '@/features/ai/responseLanguage'
import './AgentBriefingCard.css'

// =============================================
// Types
// =============================================
type Mode = 'daily' | 'weekly'

interface Briefing {
  id: string
  content: string
  language: string
  created_at: string
  triggered_by: string
}

// =============================================
// Markdown renderer — converts • bullets to list items
// Task 11e (bidi rendering): direction-handling lives in the shared
// createDirectionalMarkdownComponents utility (src/lib/bidiText.tsx), used
// identically by ChatPage, WeeklyBriefingPage, and TasksPage. Only the
// visual class names below are specific to this card.
// =============================================
// Exported (task 17f) purely so this consumer's direction-aware markdown
// wiring can be verified directly against bidiText.tsx's behavior in tests
// without mounting the full card (auth/supabase-heavy) -- no runtime change.
export const MD_COMPONENTS = createDirectionalMarkdownComponents({
  p: 'agent-briefing-card__text',
  ul: 'agent-briefing-card__list',
  li: 'agent-briefing-card__list-item',
})

function BriefingContent({ content, language }: Readonly<{ content: string; language?: string | null }>) {
  const md = content.replace(/^•\s*/gm, '- ')
  const responseLanguage = language === 'fa' || language === 'de' || language === 'en'
    ? language as SupportedAiResponseLanguage
    : undefined
  return (
    // Task 11e: dir="auto" unconditionally -- base direction is decided per
    // block inside the markdown renderer (first-strong heuristic), not once
    // for the whole briefing from the resolved language.
    <div dir="auto" lang={responseLanguage}>
      <ReactMarkdown components={MD_COMPONENTS}>{md}</ReactMarkdown>
    </div>
  )
}

// =============================================
// AgentBriefingCard
// =============================================
export function AgentBriefingCard() {
  const { user } = useAuth()
  const interfaceLanguage = useAppearance((state) => state.language)
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('daily')
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchLatestBriefing = useCallback(async (m: Mode): Promise<void> => {
    if (!user?.id) return
    const { data, error: err } = await supabase
      .from('agent_briefings')
      .select('id, content, language, created_at, triggered_by')
      .eq('user_id', user.id)
      .eq('mode', m)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (err) {
      setError('Could not load briefing.')
    } else {
      setBriefing(data ?? null)
    }
  }, [user?.id])

  // Re-fetch whenever mode changes (also covers initial load)
  useEffect(() => {
    let active = true
    setLoading(true)
    setBriefing(null)
    setError(null)
    fetchLatestBriefing(mode).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [mode, fetchLatestBriefing])

  const handleRefresh = async () => {
    if (!user?.id) return
    setRefreshing(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')
      const workerUrl = import.meta.env.VITE_AGENT_WORKER_URL as string
      const responseLanguage = resolveAiResponseLanguage({
        configuredResponseLanguage: getStoredAiResponseLanguage(),
        interfaceLanguage,
      })
      const res = await fetch(`${workerUrl}/generate?mode=${mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          responseLanguage,
          responseLanguageInstruction: getAiResponseLanguageInstruction(responseLanguage),
        }),
      })
      if (!res.ok) throw new Error('Worker error')
      await new Promise(r => setTimeout(r, 1000))
      await fetchLatestBriefing(mode)
    } catch {
      setError('Failed to generate briefing. Try again.')
    } finally {
      setRefreshing(false)
    }
  }

  const isToday = briefing
    ? new Date(briefing.created_at).toDateString() === new Date().toDateString()
    : false
  const timeAgo = briefing ? formatTimeAgo(new Date(briefing.created_at)) : null
  const staleClass = briefing && !isToday ? 'agent-briefing-card--stale' : ''
  const title = 'Daily Briefing'
  const emptyText = 'No briefing yet for today.'

  // =============================================
  // Render
  // =============================================
  if (loading) {
    return (
      <div className="agent-briefing-card agent-briefing-card--loading">
        <div className="agent-briefing-card__shimmer" />
      </div>
    )
  }

  return (
    <div className={`agent-briefing-card ${staleClass}`}>
      {/* Header */}
      <div className="agent-briefing-card__header">
        <div className="agent-briefing-card__title">
          <span className="agent-briefing-card__icon" aria-hidden="true">✦</span>
          <span>{title}</span>
        </div>
        <div className="agent-briefing-card__controls">
          <div className="agent-briefing-card__mode-toggle">
            <button
              type="button"
              className={`agent-briefing-card__mode-btn${mode === 'daily' ? ' agent-briefing-card__mode-btn--active' : ''}`}
              onClick={() => setMode('daily')}
              aria-pressed={mode === 'daily' ? 'true' : 'false'}
            >
              Today
            </button>
            <button
              type="button"
              className="agent-briefing-card__mode-btn"
              onClick={() => navigate('/briefing/weekly')}
            >
              This Week
            </button>
          </div>
          <button
            type="button"
            className="agent-briefing-card__refresh"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Generate new briefing"
            aria-label="Refresh briefing"
          >
            <span className={refreshing ? 'spinning' : ''}>↻</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="agent-briefing-card__content">
        {error && <p className="agent-briefing-card__error">{error}</p>}
        {!error && briefing && (
          <>
            <BriefingContent content={briefing.content} language={briefing.language} />
            {timeAgo && <span className="agent-briefing-card__time">{timeAgo}</span>}
          </>
        )}
        {!error && !briefing && (
          <div className="agent-briefing-card__empty">
            <p>{emptyText}</p>
            <button
              type="button"
              className="agent-briefing-card__generate-btn"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Generating…' : 'Generate my briefing'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================
// Helper
// =============================================
function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString()
}
