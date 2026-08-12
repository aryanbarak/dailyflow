import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import briefingBg from '@/assets/briefing-bg.jpg'
import { useAppearance } from '@/features/settings/appearanceStore'
import { createDirectionalMarkdownComponents } from '@/lib/bidiText'
import {
  getAiResponseLanguageInstruction,
  getStoredAiResponseLanguage,
  resolveAiResponseLanguage,
  type SupportedAiResponseLanguage,
} from '@/features/ai/responseLanguage'

interface Briefing {
  id: string
  content: string
  language: string
  created_at: string
}

// Task 11e (bidi rendering): direction-handling lives in the shared
// createDirectionalMarkdownComponents utility (src/lib/bidiText.tsx), used
// identically by ChatPage, AgentBriefingCard, and TasksPage. Only the
// visual class names below are specific to this page. `ps-5` (logical
// padding-start) replaces the previous physical `pl-5`, so bullet
// indentation mirrors correctly for RTL content.
// Exported (task 17f) purely so this consumer's direction-aware markdown
// wiring can be verified directly against bidiText.tsx's behavior in tests
// without mounting the full page (auth/supabase-heavy) -- no runtime change.
export const MD_COMPONENTS = createDirectionalMarkdownComponents({
  p: 'mb-2 last:mb-0 text-sm leading-relaxed text-foreground/85',
  ul: 'list-disc ps-5 mt-2 space-y-1',
  li: 'text-sm leading-relaxed text-foreground/85',
})

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays} days ago`
}

export default function WeeklyBriefingPage() {
  const { user } = useAuth()
  const interfaceLanguage = useAppearance((state) => state.language)
  const navigate = useNavigate()
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchBriefing = useCallback(async () => {
    if (!user?.id) return
    const { data, error: err } = await supabase
      .from('agent_briefings')
      .select('id, content, language, created_at')
      .eq('user_id', user.id)
      .eq('mode', 'weekly')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (err) {
      setError('Could not load weekly briefing.')
    } else {
      setBriefing(data ?? null)
    }
  }, [user?.id])

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchBriefing().finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [fetchBriefing])

  const handleGenerate = async () => {
    if (!user?.id) return
    setGenerating(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')
      const workerUrl = import.meta.env.VITE_AGENT_WORKER_URL as string
      const responseLanguage = resolveAiResponseLanguage({
        configuredResponseLanguage: getStoredAiResponseLanguage(),
        interfaceLanguage,
      })
      const res = await fetch(`${workerUrl}/generate?mode=weekly`, {
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
      await new Promise(r => setTimeout(r, 1500))
      await fetchBriefing()
    } catch {
      setError('Failed to generate weekly briefing.')
    } finally {
      setGenerating(false)
    }
  }

  const md = briefing?.content.replace(/^•\s*/gm, '- ') ?? ''
  const briefingLanguage = briefing?.language === 'fa' || briefing?.language === 'de' || briefing?.language === 'en'
    ? briefing.language as SupportedAiResponseLanguage
    : undefined

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 py-5">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5"
          onClick={() => navigate('/')}
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Button>
      </div>

      {/* Card */}
      <div className="glass-card rounded-2xl shadow-elevated relative overflow-hidden">
        <img
          src={briefingBg}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-center opacity-15 pointer-events-none select-none"
        />
        <div className="relative p-5 sm:p-7">
          {/* Title */}
          <div className="flex items-center gap-2 mb-5">
            <span className="text-sm" aria-hidden="true">✦</span>
            <h1 className="text-lg font-semibold">Weekly Briefing</h1>
          </div>

          {/* Content */}
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-5/6 rounded bg-muted" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : briefing ? (
            <div dir="auto" lang={briefingLanguage}>
              <ReactMarkdown components={MD_COMPONENTS}>{md}</ReactMarkdown>
              <p className="text-[11px] text-muted-foreground mt-4">
                Generated {formatTimeAgo(new Date(briefing.created_at))}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4 gap-1.5"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? 'Generating…' : 'Regenerate'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No weekly briefing yet. Weekly briefings summarize your tasks, habits,
                finances, and calendar for the entire week.
              </p>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? 'Generating…' : 'Generate weekly briefing'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
