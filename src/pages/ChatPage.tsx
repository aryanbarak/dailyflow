import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  BookOpen,
  Bot,
  Briefcase,
  Calendar,
  CheckCircle2,
  CheckSquare,
  FileText,
  Flame,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Wallet,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useProfile } from '@/features/profile/useProfile'
import { useTasks } from '@/hooks/useTasks'
import { SmartFlowIcon } from '@/components/SmartFlowLogo'
import { SmartflowAsciiVisual } from '@/components/smartflow'
import { translations, useT } from '@/i18n'
import type { TranslationKey } from '@/i18n'
import { useChatSessions } from '@/hooks/useChatSessions'
import { useAppearance } from '@/features/settings/appearanceStore'
import {
  createLlmReasoningCaller,
  canComposeAssistantResponse,
  composeAssistantResponse,
  formatAssistantResponse,
  synthesizeContext,
  getToolById,
  reasonAboutUserMessage,
  resolveAgentReasoningTransport,
  resolveToolForStep,
  runReadOnlyTool,
  runWriteTool,
  type AgentReasoningResult,
  type AgentReasoningGitHubInventory,
  type ReadOnlyRuntimeResult,
  type WriteRuntimeResult,
  type ApprovalInteractionResult,
  type ContextSynthesisWorkspaceContext,
  type ExecutionContextTask,
  type SynthesizedContext,
} from '@/features/agent'
import { StepApprovalDialog } from '@/features/workspace/components/StepApprovalDialog'
import { createGitHubRepositoriesClient } from '@/features/integrations/github/githubRepositoriesClient'
import { createGitHubIssuesClient } from '@/features/integrations/github/githubIssuesClient'
import { createGitHubEpicsClient } from '@/features/integrations/github/githubEpicsClient'
import { createGitHubPullRequestsClient } from '@/features/integrations/github/githubPullRequestsClient'
import { createGitHubWorkflowRunsClient } from '@/features/integrations/github/githubWorkflowRunsClient'
import { createGitHubRepositoryInventoryClient } from '@/features/integrations/github/githubRepositoryInventoryClient'
import { useWorkspace } from '@/features/workspace'
import type {
  WorkspacePlanActionType,
  WorkspacePlanStep,
  WorkspaceDecisionProfile,
  Workspace,
  WorkspaceStepApproval,
} from '@/features/workspace'
import type { ToolResolutionResult } from '@/features/agent'
import {
  getAiResponseDirection,
  getAiResponseLanguageInstruction,
  getStoredAiResponseLanguage,
  resolveAiResponseLanguage,
  type SupportedAiResponseLanguage,
} from '@/features/ai/responseLanguage'

interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  language?: SupportedAiResponseLanguage
}

interface QuickAction {
  labelKey: TranslationKey
  descKey: TranslationKey
  icon: React.ElementType
  iconBg: string
  iconColor: string
  prompt: string
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    labelKey: 'flow_action_study',
    descKey: 'flow_action_study_desc',
    icon: BookOpen,
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-400',
    prompt: 'Help me study and review a concept for my FIAE exam.',
  },
  {
    labelKey: 'flow_action_plan',
    descKey: 'flow_action_plan_desc',
    icon: Calendar,
    iconBg: 'bg-violet-500/15',
    iconColor: 'text-violet-400',
    prompt: 'Help me plan my day effectively based on my tasks and goals.',
  },
  {
    labelKey: 'flow_action_habits',
    descKey: 'flow_action_habits_desc',
    icon: Flame,
    iconBg: 'bg-orange-500/15',
    iconColor: 'text-orange-400',
    prompt: 'Analyze my habits and give me insights on my patterns.',
  },
  {
    labelKey: 'flow_action_finance',
    descKey: 'flow_action_finance_desc',
    icon: Wallet,
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-400',
    prompt: 'Review my finances and help me understand my spending.',
  },
  {
    labelKey: 'flow_action_weekly',
    descKey: 'flow_action_weekly_desc',
    icon: FileText,
    iconBg: 'bg-cyan-500/15',
    iconColor: 'text-cyan-400',
    prompt: 'Give me a weekly summary of my progress and priorities.',
  },
  {
    labelKey: 'flow_action_career',
    descKey: 'flow_action_career_desc',
    icon: Briefcase,
    iconBg: 'bg-rose-500/15',
    iconColor: 'text-rose-400',
    prompt: 'Help me with my job search and interview preparation.',
  },
]

function MsgP({ children }: Readonly<{ children: React.ReactNode }>) {
  return <p dir="auto" className="mb-1 last:mb-0">{children}</p>
}
function MsgUl({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ul className="mt-1 list-disc space-y-0.5 ps-4">{children}</ul>
}
function MsgLi({ children }: Readonly<{ children: React.ReactNode }>) {
  return <li dir="auto">{children}</li>
}
const MSG_MD_COMPONENTS = { p: MsgP, ul: MsgUl, li: MsgLi } as const

type ReasoningRunStatus = 'idle' | 'running' | 'success' | 'failed' | 'approval_required' | 'approved' | 'rejected'
type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

interface ReasoningProposalState {
  result: AgentReasoningResult
  step: WorkspacePlanStep | null
  resolution: ToolResolutionResult | null
  approval: WorkspaceStepApproval | null
  runStatus: ReasoningRunStatus
  readOnlyResult?: ReadOnlyRuntimeResult
  writeResult?: WriteRuntimeResult
}

const readIntentAction: Record<string, WorkspacePlanActionType> = {
  inspect_tasks: 'review',
  inspect_calendar: 'review',
  inspect_learning: 'continue',
  inspect_workspace: 'inspect',
  inspect_github_repositories: 'inspect',
}

const CONVERSATIONAL_FILLER_ATOMS = [
  // English greetings/thanks/acknowledgements, plus "today"/"there"/"and" as
  // low-risk standalone filler words
  'good morning', 'good evening', 'good night', 'how are you', 'thank you',
  'thanks a lot', 'much appreciated', 'that was helpful', 'no problem',
  "you're welcome", 'sounds good', 'got it', 'see you', 'thanks', 'okay',
  'ok', 'cool', 'nice', 'great', 'goodbye', 'bye', 'hello', 'hi', 'hey',
  'today', 'there', 'and',
  // German
  'guten morgen', 'guten abend', 'gute nacht', 'wie geht es dir',
  "wie geht's", 'wie geht', 'dankesch(?:ö|oe)n', 'vielen dank',
  'das war hilfreich', 'kein problem', 'gern geschehen', 'alles klar',
  'klingt gut', 'verstanden', 'auf wiedersehen', 'tsch(?:ü|ue)ss', 'danke',
  'super', 'klasse', 'hallo', 'servus', 'und',
  // Persian
  'سلام', 'درود', 'صبح بخیر', 'شب بخیر', 'روز بخیر', 'حالت چطوره', 'چطوری',
  'خیلی کمک کرد', 'خیلی ممنون', 'خواهش می.کنم', 'ممنونم', 'متشکرم', 'ممنون',
  'مرسی', 'قابل نداره', 'باشه', 'خداحافظ', 'و', 'هم',
].join('|')

// (?<![\p{L}\p{N}_]) / (?![\p{L}\p{N}_]) are Unicode-aware word boundaries —
// unlike \b, which only recognizes ASCII a-z/0-9/_, this correctly treats a
// bare Persian connector like "و" as a whole word instead of matching it as
// a substring inside an unrelated word.
const CONVERSATIONAL_FILLER_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${CONVERSATIONAL_FILLER_ATOMS})(?![\\p{L}\\p{N}_])`,
  'giu',
)
const PUNCTUATION_PATTERN = /[,.!?؟،؛:'"-]/g

function isEntirelyConversationalFiller(text: string): boolean {
  const residual = text
    .replace(CONVERSATIONAL_FILLER_PATTERN, ' ')
    .replace(PUNCTUATION_PATTERN, ' ')
    .replace(/\s+/g, '')
  return residual.length === 0
}

// Persian marks possession primarily with an enclitic suffix on the noun
// (ـم / ـت / ـش / ـمان / ـتان / ـشان), not a standalone word like English
// "my" — a bare "من" check misses most real possessive phrasing ("برنامه‌ام
// چیست؟", "issue‌هایم چیست؟"). This matches the two orthographic shapes that
// are reliably distinguishable from an ordinary word ending:
//   - plural+possessive "های" + suffix (کارهایم, issue‌هایم) — "های" is
//     specific enough that this rarely false-positives;
//   - a suffix directly after a U+200C ZWNJ (برنامه‌ام, خانه‌اش) — in casual
//     Persian text, ZWNJ is used almost exclusively for exactly this kind
//     of enclitic joining, so its presence is a reliable signal.
// A bare suffix with no separator at all (کارم, دستم) is deliberately NOT
// matched: "م"/"ت"/"ش" are also ordinary root-final letters (کرم, دست,
// آتش, ...), and there is no reliable way to tell "my X" from "a word that
// happens to end in that letter" without a real morphological analyzer.
// That gap is real, not hidden — some valid possessive phrasing (informal
// "کارم چیه؟") still will not be caught here. This is exactly informal
// spoken-register Persian ("کارم چیه؟", "issueهام کو؟"), not a rare edge
// case. A regex over the message text alone cannot close it safely. If the
// connected-repo-inventory idea for safeContext (see the intentValidator
// entity-collision discussion) ever lands, giving the model real context
// about what exists, that is the more promising path to revisit this gap —
// not a longer suffix list here.
const PERSIAN_POSSESSIVE_SUFFIX_PATTERN =
  /(های(م|ت|ش|مان|تان|شان)|‌(ام|ات|اش|امان|اتان|اشان|م|ت|ش|مان|تان|شان))(?![\p{L}\p{N}_])/u

function hasPersianPossessiveMarker(text: string): boolean {
  return (
    /(?<![\p{L}\p{N}_])من(?![\p{L}\p{N}_])/u.test(text) ||
    PERSIAN_POSSESSIVE_SUFFIX_PATTERN.test(text)
  )
}

export function shouldUseReasoningForMessage(message: string) {
  const text = message.trim().toLowerCase()
  if (!text) return false
  const realPersianReasoningIntent =
    /(یادگیری|درس|تقویم|قرار|جلسه|وظیفه|وظیفه[‌\s-]?ها|کارها|کار|تمرکز|برنامه\s+فعلی|کامل\s+کن|انجام[‌\s-]?شده|تمام\s+نشده)/i.test(text)

  // "why is / explain / tell me about" (and the German/Persian equivalents)
  // are unconditional generic-topic markers: asking to explain a concept is
  // ordinary conversation no matter which domain words happen to appear in
  // it, so these need no per-tool list and none is applied to them.
  //
  // "what is X" / "X چیست" is genuinely ambiguous the
  // other clauses aren't -- "what is spaced repetition" is ordinary, "what
  // is my GitHub Actions CI status" is a real request naming a specific
  // tool. The distinguishing signal is possession, not which domain X
  // names, so this checks for a possessive marker instead of an enumerated
  // list of known tool phrasings. A new tool works here automatically; it
  // does not need a naming update the way the old domain-phrase list did.
  // English possession is the standalone word "my". Persian possession is
  // usually an enclitic suffix on the noun rather than a standalone word
  // (see hasPersianPossessiveMarker above) -- bare "من" alone would miss
  // most real cases, like "برنامه‌ام چیست؟".
  const ordinaryConversation =
    /\b(why is|explain|tell me about|warum ist|erkläre|erklaere|erzähl|erzaehl)\b/i.test(text) ||
    (/\bwhat is\b/i.test(text) && !/\bmy\b/i.test(text)) ||
    /(چرا|توضیح\s+بده|درباره)/i.test(text) ||
    (/چیست/i.test(text) && !hasPersianPossessiveMarker(text))

  if (ordinaryConversation) return false
  if (realPersianReasoningIntent) return true

  // Small denylist of clearly conversational messages (greetings, thanks,
  // acknowledgements) — everything else attempts reasoning. This replaces
  // the old domain-keyword allowlist, which silently dropped any phrasing
  // it hadn't been taught (e.g. new tool intents) into plain chat.
  //
  // This must anchor to the WHOLE message, not match anywhere in it — "ok"
  // or "great" thrown in as a prefix ("ok show me my repositories") must not
  // disqualify a real request. So instead of testing for presence, strip
  // every known greeting/thanks/acknowledgement phrase (plus a couple of
  // connector/filler words) and all punctuation, then check whether
  // anything substantive is left. CONVERSATIONAL_FILLER_PATTERN uses
  // Unicode-aware boundaries (not \b, which is ASCII-only) so a bare
  // connector like Persian "و" only strips when it stands alone as a word,
  // never as a substring inside an unrelated word.
  if (isEntirelyConversationalFiller(text)) return false

  return true
}

function intentTitleKey(type: AgentReasoningResult['proposal']['type']): TranslationKey {
  switch (type) {
    case 'inspect_tasks':
      return 'agent_intent_title_inspect_tasks'
    case 'inspect_calendar':
      return 'agent_intent_title_inspect_calendar'
    case 'inspect_learning':
      return 'agent_intent_title_inspect_learning'
    case 'inspect_workspace':
      return 'agent_intent_title_inspect_workspace'
    case 'inspect_github_repositories':
      return 'agent_intent_title_inspect_github_repositories'
    case 'inspect_github_issues':
      return 'agent_intent_title_inspect_github_issues'
    case 'inspect_github_epics':
      return 'agent_intent_title_inspect_github_epics'
    case 'inspect_github_pull_requests':
      return 'agent_intent_title_inspect_github_pull_requests'
    case 'inspect_github_workflow_runs':
      return 'agent_intent_title_inspect_github_workflow_runs'
    case 'complete_task':
      return 'agent_intent_title_complete_task'
    case 'ask_clarification':
      return 'agent_intent_title_clarification'
    default:
      return 'agent_intent_title_unsupported'
  }
}

function intentTitle(type: AgentReasoningResult['proposal']['type'], t: Translate) {
  return t(intentTitleKey(type))
}

function responseLanguageTranslator(language: SupportedAiResponseLanguage): Translate {
  const dictionary = translations[language] ?? translations.en
  return (key, vars) => {
    let value = dictionary[key] ?? translations.en[key] ?? key
    if (vars) {
      Object.entries(vars).forEach(([name, replacement]) => {
        value = value.replace(`{{${name}}}`, String(replacement))
      })
    }
    return value
  }
}

export function proposalMessage(result: AgentReasoningResult) {
  if (result.proposal.clarificationQuestion) return result.proposal.clarificationQuestion
  const responseT = responseLanguageTranslator(result.responseLanguage)
  return `${responseT('agent_intent_proposed')}: ${intentTitle(result.proposal.type, responseT)}. ${responseT('agent_intent_run_hint')}`
}

function stepForReasoning(result: AgentReasoningResult, t: Translate): WorkspacePlanStep | null {
  const proposal = result.proposal
  if (!proposal.toolId || proposal.type === 'ask_clarification' || proposal.type === 'unsupported') {
    return null
  }
  const domain =
    proposal.type === 'inspect_github_repositories' ||
    proposal.type === 'inspect_github_issues' ||
    proposal.type === 'inspect_github_epics' ||
    proposal.type === 'inspect_github_pull_requests' ||
    proposal.type === 'inspect_github_workflow_runs'
      ? 'github'
      : proposal.type === 'inspect_workspace'
      ? 'workspace'
      : proposal.type === 'inspect_calendar'
      ? 'calendar'
      : proposal.type === 'inspect_learning'
        ? 'learning'
        : 'tasks'
  const actionType = proposal.type === 'complete_task'
    ? 'complete'
    : readIntentAction[proposal.type] ?? 'inspect'
  const targetId = proposal.type === 'complete_task' ? proposal.target?.taskId : undefined

  return {
    id: `reasoning-step:${proposal.id}`,
    order: 1,
    title: intentTitle(proposal.type, t),
    description: proposal.type === 'complete_task'
      ? t('agent_intent_complete_description', { title: proposal.target?.taskTitleHint ?? t('agent_intent_selected_task') })
      : t('agent_intent_read_description', { toolId: proposal.toolId }),
    domain: domain as WorkspacePlanStep['domain'],
    estimatedMinutes: 5,
    status: 'proposed',
    actionType,
    targetId,
    reason: proposal.reasons[0] ?? t('agent_intent_validated_reason'),
    requiresApproval: proposal.requiresApproval,
    dependencies: [],
    optional: false,
  }
}

function writeResolutionForStep(step: WorkspacePlanStep): ToolResolutionResult | null {
  const tool = getToolById('tasks.complete')
  if (!tool) return null
  return {
    status: 'resolved',
    resolved: true,
    stepId: step.id,
    toolId: 'tasks.complete',
    tool,
    confidence: 'high',
    reasons: ['Resolved through the explicit tasks.complete reasoning mapping.'],
    candidates: [],
    requiredInput: ['taskId'],
    generatedAt: new Date().toISOString(),
    resolverVersion: 'tool-resolver-v1',
  }
}

function approvalForReasoningStep(step: WorkspacePlanStep, resolution: ToolResolutionResult, t: Translate): WorkspaceStepApproval | null {
  if (resolution.toolId !== 'tasks.complete' || !step.targetId) return null
  const tool = resolution.tool
  return {
    stepId: step.id,
    targetId: step.targetId,
    toolId: 'tasks.complete',
    toolName: tool?.name,
    toolDescription: tool?.description,
    toolCapability: tool?.capability,
    toolMode: tool?.mode,
    status: 'pending',
    requiresApproval: true,
    approvalReason: t('agent_intent_complete_approval_reason'),
    riskLevel: 'medium',
    reversible: true,
    externalEffect: true,
    dataDomains: ['tasks'],
    approvalScope: 'single_step',
  }
}

export function proposalToState(result: AgentReasoningResult, t: Translate): ReasoningProposalState {
  const step = stepForReasoning(result, t)
  const resolution = step
    ? result.proposal.type === 'complete_task'
      ? writeResolutionForStep(step)
      : resolveToolForStep({ step, expectedToolId: result.toolId })
    : null
  const approval = step && resolution?.resolved && result.proposal.type === 'complete_task'
    ? approvalForReasoningStep(step, resolution, t)
    : null
  return {
    result,
    step,
    resolution,
    approval,
    runStatus: result.proposal.requiresApproval ? 'approval_required' : 'idle',
  }
}

// Always an array -- one element for a normal confident proposal or a
// disambiguation that collapsed to a single survivor, two or three for a
// genuine disambiguation. Each entry goes through the exact same
// proposalToState used for a lone proposal today, so a card built from
// result.disambiguationCandidates[i] is indistinguishable from a card built
// for a standalone AgentReasoningResult of the same shape.
export function proposalsToStates(result: AgentReasoningResult, t: Translate): ReasoningProposalState[] {
  const candidates = result.disambiguationCandidates
  if (candidates && candidates.length >= 2) {
    return candidates.map(candidate => proposalToState(candidate, t))
  }
  return [proposalToState(result, t)]
}

interface ContextTaskSnapshot {
  id?: string
  title?: string
  createdAt?: string
  completed?: boolean
  dueDate?: string | null
  completedAt?: string | null
}

export interface LiveTaskReasoningContextInput {
  tasks: readonly ContextTaskSnapshot[]
  isLoading: boolean
  error: string | null
}

export function liveTaskReasoningContext(
  input: LiveTaskReasoningContextInput,
): ExecutionContextTask[] {
  if (input.isLoading || input.error !== null || input.tasks.length === 0) return []
  return input.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    completed: task.completed,
    status: task.completed === true ? 'completed' : 'open',
    dueDate: task.dueDate ?? undefined,
    createdAt: task.createdAt,
  }))
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildContextSynthesisWorkspaceContext(
  workspace: Workspace,
  tasks: readonly ContextTaskSnapshot[],
  now: Date,
): ContextSynthesisWorkspaceContext {
  const today = dateKey(now)
  const weekAgoMs = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const openTasks = tasks.filter((task) => task.completed !== true)
  const learningLessons = workspace.agentContext.learningProgress?.lessons ?? []

  return {
    activeTaskCount: openTasks.length,
    dueTodayCount: openTasks.filter((task) => task.dueDate === today).length,
    overdueCount: openTasks.filter((task) => Boolean(task.dueDate) && String(task.dueDate) < today).length,
    unscheduledTaskCount: openTasks.filter((task) => !task.dueDate).length,
    completedThisWeekCount: tasks.filter((task) =>
      task.completedAt ? new Date(task.completedAt).getTime() >= weekAgoMs : false,
    ).length,
    todayEventCount: workspace.signals.eventsToday,
    currentGoalTitle: workspace.goal.title,
    currentPrimaryDomain: workspace.goal.primaryDomain,
    learningActiveCount: learningLessons.filter((lesson) =>
      lesson.completed !== true && (lesson.completionPercentage ?? 0) < 100,
    ).length,
    learningProgressSummary: workspace.agentContext.learningProgress?.mode,
  }
}

export function resultMessage(
  result: ReadOnlyRuntimeResult | WriteRuntimeResult,
  language: SupportedAiResponseLanguage,
  decisionProfile?: WorkspaceDecisionProfile,
  synthesizedContext?: SynthesizedContext,
) {
  if (canComposeAssistantResponse(result.toolId)) {
    return formatAssistantResponse(composeAssistantResponse({
      toolId: result.toolId,
      language,
      success: result.success,
      safeSummary: result.safeSummary,
      safePreviewItems: 'safePreviewItems' in result ? result.safePreviewItems : [],
      reflection: result.reflection,
      decisionProfile,
      synthesizedContext,
    }))
  }

  const items = 'safePreviewItems' in result ? result.safePreviewItems : []
  if (!items.length) return result.safeSummary
  return `${result.safeSummary}\n\n${items.map((item) => `- ${item}`).join('\n')}`
}

export function runtimeSummaryMessage(
  result: ReadOnlyRuntimeResult | WriteRuntimeResult,
  language: SupportedAiResponseLanguage,
) {
  if (!canComposeAssistantResponse(result.toolId)) return result.safeSummary
  return composeAssistantResponse({
    toolId: result.toolId,
    language,
    success: result.success,
    safeSummary: result.safeSummary,
    safePreviewItems: [],
  }).summary
}

export function ReasoningProposalCard({
  proposal,
  onRunReadOnly,
  onReviewApproval,
  onRunWrite,
}: Readonly<{
  proposal: ReasoningProposalState
  onRunReadOnly: () => void
  onReviewApproval: () => void
  onRunWrite: () => void
}>) {
  const { t } = useT()
  const { result, resolution, approval, runStatus } = proposal
  const toolId = resolution?.toolId ?? result.proposal.toolId
  const toolLabel = resolution?.tool?.name ?? toolId ?? t('agent_intent_no_runtime')
  const modeLabel = result.proposal.requiresApproval ? t('agent_intent_mode_write') : t('agent_intent_mode_read')
  const isRunning = runStatus === 'running'
  const isCompleteTask = result.proposal.type === 'complete_task'
  const isApproved = approval?.status === 'approved'
  const isRejected = approval?.status === 'rejected' || runStatus === 'rejected'
  const canRunReadOnly = Boolean(
    !isCompleteTask &&
    proposal.step &&
    resolution?.resolved &&
    runStatus !== 'success' &&
    runStatus !== 'failed'
  )
  const canReviewApproval = isCompleteTask && approval?.status === 'pending'
  const canRunWrite = isCompleteTask && isApproved && runStatus !== 'success' && runStatus !== 'failed'
  const runtimeResult = proposal.readOnlyResult ?? proposal.writeResult

  return (
    <div className="mb-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/80">
            {t('agent_intent_label')}
          </p>
          <p className="mt-1 text-sm font-semibold">
            {intentTitle(result.proposal.type, t)}
          </p>
        </div>
        {runStatus === 'success' && (
          <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg border border-border/25 bg-background/30 px-2.5 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('agent_intent_tool')}
          </dt>
          <dd className="mt-1 font-medium">{toolLabel}</dd>
        </div>
        <div className="rounded-lg border border-border/25 bg-background/30 px-2.5 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('agent_intent_mode')}
          </dt>
          <dd className="mt-1 font-medium">{modeLabel}</dd>
        </div>
        {result.proposal.target?.taskTitleHint && (
          <div className="rounded-lg border border-border/25 bg-background/30 px-2.5 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('agent_intent_target')}
            </dt>
            <dd className="mt-1 truncate font-medium" title={result.proposal.target.taskTitleHint}>
              {result.proposal.target.taskTitleHint}
            </dd>
          </div>
        )}
      </dl>

      {isRejected && (
        <p className="mt-3 text-xs text-muted-foreground">{t('agent_intent_rejected')}</p>
      )}

      {!proposal.step || !resolution?.resolved ? (
        <p className="mt-3 text-xs text-muted-foreground">{t('agent_intent_no_runtime')}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {!isCompleteTask && (
            <Button
              type="button"
              size="sm"
              onClick={onRunReadOnly}
              disabled={!canRunReadOnly || isRunning}
            >
              {isRunning ? t('agent_intent_running') : `${t('agent_intent_run')} ${toolId}`}
            </Button>
          )}
          {canReviewApproval && (
            <Button type="button" size="sm" variant="outline" onClick={onReviewApproval}>
              {t('agent_intent_review_approval')}
            </Button>
          )}
          {isCompleteTask && isApproved && (
            <Button
              type="button"
              size="sm"
              onClick={onRunWrite}
              disabled={!canRunWrite || isRunning}
            >
              {isRunning ? t('agent_intent_running') : t('agent_intent_complete_task')}
            </Button>
          )}
        </div>
      )}

      {runtimeResult && (
        <p
          className="mt-3 rounded-lg border border-border/25 bg-background/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
          dir="auto"
          lang={result.responseLanguage}
        >
          {runtimeSummaryMessage(runtimeResult, result.responseLanguage)}
        </p>
      )}
    </div>
  )
}

export function AssistantContent({ content }: Readonly<{ content: string }>) {
  const md = content.replace(/^•\s*/gm, '- ')
  return <ReactMarkdown components={MSG_MD_COMPONENTS}>{md}</ReactMarkdown>
}

export function ChatBubble({ role, content, language }: Readonly<{
  role: 'user' | 'assistant'
  content: string
  language?: SupportedAiResponseLanguage
}>) {
  const direction = role === 'assistant' && language ? getAiResponseDirection(language) : 'auto'
  return (
    <div className={cn('flex gap-2.5', role === 'user' ? 'justify-end' : 'justify-start')}>
      {role === 'assistant' && (
        <div className="icon-tile w-7 h-7 rounded-full shrink-0 mt-0.5">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed break-words',
          role === 'user'
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'glass-card rounded-bl-sm'
        )}
        dir={direction}
        lang={language}
      >
        {role === 'assistant'
          ? <AssistantContent content={content} />
          : <span className="whitespace-pre-wrap">{content}</span>}
      </div>
    </div>
  )
}

function TypingIndicator({ label }: Readonly<{ label: string }>) {
  return (
    <div className="flex gap-2.5 justify-start">
      <div className="icon-tile w-7 h-7 rounded-full shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="glass-card rounded-xl rounded-bl-sm px-4 py-2.5 text-sm flex items-center gap-2">
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" />
        <span className="text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export default function ChatPage() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const { tasks, isLoading: tasksLoading, error: tasksError } = useTasks()
  const workspace = useWorkspace()
  const { t } = useT()
  const interfaceLanguage = useAppearance((state) => state.language)
  const location = useLocation()
  const nav = useNavigate()
  const { sessions, refresh: refreshSessions, createSession, deleteSession } = useChatSessions()

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [reasoningProposal, setReasoningProposal] = useState<ReasoningProposalState[] | null>(null)
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false)
  const [githubRepositoryInventory, setGithubRepositoryInventory] = useState<AgentReasoningGitHubInventory>({ status: 'unknown' })
  const bottomRef = useRef<HTMLDivElement>(null)
  const initialPromptFired = useRef(false)
  const workerUrl = import.meta.env.VITE_AGENT_WORKER_URL as string
  const reasoningTransport = resolveAgentReasoningTransport(import.meta.env)

  // Fetched once per mount, not per message -- the underlying cache itself
  // only changes when github.repositories.list runs, so re-fetching this
  // cheap DB-only read on every reasoning call would add a request for no
  // fresher data. The client degrades to { status: 'unknown' } on any
  // failure, so a failed fetch here is silently equivalent to "not loaded
  // yet," never a visible error.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    const inventoryClient = createGitHubRepositoryInventoryClient({
      workerBaseUrl: workerUrl,
      getAccessToken: async () => {
        const { data: { session } } = await supabase.auth.getSession()
        return session?.access_token
      },
    })
    inventoryClient.getInventory().then((inventory) => {
      if (!cancelled) setGithubRepositoryInventory(inventory)
    })
    return () => {
      cancelled = true
    }
  }, [user?.id, workerUrl])

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    if (!user?.id) return
    setLoading(true)
    setMessages([])
    const { data, error } = await supabase
      .from('agent_chat_messages')
      .select('id, role, content')
      .eq('user_id', user.id)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })

    if (!error && data) {
      setMessages(
        data.map((r: { id: string; role: string; content: string }) => ({
          id: r.id,
          role: r.role as 'user' | 'assistant',
          content: r.content,
        }))
      )
    }
    setLoading(false)
  }, [user?.id])

  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
    void loadSessionMessages(sessionId)
  }, [loadSessionMessages])

  const startNewChat = useCallback(() => {
    setActiveSessionId(null)
    setMessages([])
    setSendError(null)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const handleSend = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim()
    if (text === '' || sending) return
    const responseLanguage = resolveAiResponseLanguage({
      configuredResponseLanguage: getStoredAiResponseLanguage(),
      latestUserMessage: text,
      interfaceLanguage,
    })
    const responseLanguageInstruction = getAiResponseLanguageInstruction(responseLanguage)

    if (!overrideText) setDraft('')
    setSending(true)
    setSendError(null)

    let sessionId = activeSessionId

    try {
      if (!sessionId) {
        const newId = await createSession(text)
        if (!newId) throw new Error('Failed to create session')
        sessionId = newId
        setActiveSessionId(newId)
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (session === null) throw new Error('No session')

      if (shouldUseReasoningForMessage(text)) {
        // TEMP diagnostic, remove once the stale-closure fix (adding
        // githubRepositoryInventory to handleSend's useCallback deps) is
        // confirmed live: proves what this specific reasoning call actually
        // sent, independent of what the DB cache holds.
        console.log('[GitHubInventory] safeContext value at send time:', githubRepositoryInventory)
        const result = await reasonAboutUserMessage({
          userMessage: text,
          configuredResponseLanguage: getStoredAiResponseLanguage(),
          interfaceLanguage,
          safeContext: {
            tasks: liveTaskReasoningContext({
              tasks,
              isLoading: tasksLoading,
              error: tasksError,
            }),
            events: workspace.agentContext.events,
            learningProgress: workspace.agentContext.learningProgress,
            workspace: {
              goal: workspace.goal,
              plan: workspace.plan,
              signalFeed: workspace.signalFeed,
            },
            githubRepositoryInventory,
          },
          sessionId,
        }, {
          callLlmReasoning: createLlmReasoningCaller({
            endpoint: reasoningTransport.endpoint,
            accessToken: session.access_token,
            transport: reasoningTransport.transport,
          }),
        })
        setReasoningProposal(proposalsToStates(result, t))
        const assistantContent = proposalMessage(result)

        setMessages(prev => [
          ...prev,
          { id: `u-${Date.now()}`, role: 'user', content: text },
          { id: `a-${Date.now() + 1}`, role: 'assistant', content: assistantContent, language: result.responseLanguage },
        ])

        void refreshSessions()
        return
      }

      const res = await fetch(`${workerUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          responseLanguage,
          responseLanguageInstruction,
        }),
      })

      if (!res.ok) throw new Error(`Worker responded ${res.status}`)

      const { reply } = await res.json() as { reply: string }

      setMessages(prev => [
        ...prev,
        { id: `u-${Date.now()}`, role: 'user', content: text },
        { id: `a-${Date.now() + 1}`, role: 'assistant', content: reply, language: responseLanguage },
      ])

      void refreshSessions()
    } catch {
      setSendError(t('chat_error_send'))
      if (!overrideText) setDraft(text)
    } finally {
      setSending(false)
    }
  }, [draft, sending, workerUrl, t, activeSessionId, createSession, refreshSessions, interfaceLanguage, workspace, tasks, tasksLoading, tasksError, githubRepositoryInventory])

  useEffect(() => {
    const prompt = (location.state as { initialPrompt?: string } | null)?.initialPrompt
    if (!prompt || initialPromptFired.current) return
    initialPromptFired.current = true
    nav(location.pathname, { replace: true, state: {} })
    void handleSend(prompt)
  }, [location.state, location.pathname, nav, handleSend])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey === false) {
      e.preventDefault()
      void handleSend()
    }
  }

  const appendAssistantResult = useCallback((content: string, language?: SupportedAiResponseLanguage) => {
    setMessages(prev => [
      ...prev,
      {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content,
        language: language ?? resolveAiResponseLanguage({
          configuredResponseLanguage: getStoredAiResponseLanguage(),
          interfaceLanguage,
        }),
      },
    ])
  }, [interfaceLanguage])

  const handleRunReasoningProposal = useCallback(async (index: number) => {
    const current = reasoningProposal?.[index]
    if (!current?.step || !current.resolution?.resolved) return
    if (current.result.proposal.requiresApproval) return

    setReasoningProposal(prev => prev
      ? prev.map((p, i) => i === index ? { ...p, runStatus: 'running' } : p)
      : prev)
    const currentTime = new Date()
    const runResult = await runReadOnlyTool({
      requestId: `reasoning:read:${current.resolution.toolId}:${current.step.id}:${currentTime.getTime()}`,
      step: current.step,
      toolResolution: current.resolution,
      approval: null,
      executionInput: {},
      executionContext: {
        ...workspace.agentContext,
        workspace,
        currentTime: currentTime.toISOString(),
        githubRepositoriesClient: createGitHubRepositoriesClient({
          workerBaseUrl: workerUrl,
          getAccessToken: async () => {
            const { data: { session } } = await supabase.auth.getSession()
            return session?.access_token
          },
        }),
        githubIssuesClient: createGitHubIssuesClient({
          workerBaseUrl: workerUrl,
          getAccessToken: async () => {
            const { data: { session } } = await supabase.auth.getSession()
            return session?.access_token
          },
        }),
        githubEpicsClient: createGitHubEpicsClient({
          workerBaseUrl: workerUrl,
          getAccessToken: async () => {
            const { data: { session } } = await supabase.auth.getSession()
            return session?.access_token
          },
        }),
        githubPullRequestsClient: createGitHubPullRequestsClient({
          workerBaseUrl: workerUrl,
          getAccessToken: async () => {
            const { data: { session } } = await supabase.auth.getSession()
            return session?.access_token
          },
        }),
        githubWorkflowRunsClient: createGitHubWorkflowRunsClient({
          workerBaseUrl: workerUrl,
          getAccessToken: async () => {
            const { data: { session } } = await supabase.auth.getSession()
            return session?.access_token
          },
        }),
      },
      currentTime,
    })

    setReasoningProposal(prev => prev
      ? prev.map((p, i) => i === index ? {
        ...p,
        runStatus: runResult.success ? 'success' : 'failed',
        readOnlyResult: runResult,
      } : p)
      : prev)
    const synthesizedContext = synthesizeContext({
      toolId: runResult.toolId,
      executionStatus: runResult.status,
      safeRuntimeSummary: runResult.safeSummary,
      safePreviewItems: runResult.safePreviewItems,
      reflection: runResult.reflection,
      workspaceContext: buildContextSynthesisWorkspaceContext(workspace, tasks, currentTime),
      decisionProfile: workspace.decisionProfile,
      responseLanguage: current.result.responseLanguage,
      generatedAt: currentTime.toISOString(),
    })
    appendAssistantResult(
      resultMessage(
        runResult,
        current.result.responseLanguage,
        workspace.decisionProfile,
        synthesizedContext,
      ),
      current.result.responseLanguage,
    )
  }, [appendAssistantResult, reasoningProposal, tasks, workerUrl, workspace])

  // complete_task proposals are always a single-element reasoningProposal
  // array -- disambiguation candidates are deliberately never complete_task
  // (see resolveDisambiguationCandidates) -- so the approval flow only ever
  // needs to address index 0.
  const handleApprovalDecision = useCallback((decision: ApprovalInteractionResult) => {
    if (!decision.ok || decision.decision === 'closed') return
    setReasoningProposal(prev => {
      if (!prev || prev.length === 0) return prev
      return prev.map((p, i) => i === 0 ? {
        ...p,
        approval: decision.approval,
        runStatus: decision.decision === 'approved' ? 'approved' : 'rejected',
      } : p)
    })
  }, [])

  const handleRunTaskCompleteProposal = useCallback(async () => {
    const current = reasoningProposal?.[0]
    if (!current?.step || !current.resolution?.resolved) return
    if (current.approval?.status !== 'approved') return

    setReasoningProposal(prev => prev
      ? prev.map((p, i) => i === 0 ? { ...p, runStatus: 'running' } : p)
      : prev)
    const currentTime = new Date()
    const writeResult = await runWriteTool({
      requestId: `reasoning:write:tasks.complete:${current.step.id}:${current.step.targetId}:${currentTime.getTime()}`,
      step: current.step,
      toolResolution: current.resolution,
      approval: current.approval,
      executionContext: {
        ...workspace.agentContext,
        workspace,
        currentTime: currentTime.toISOString(),
      },
      currentTime,
    }, {
      getAuthenticatedUserId: () => user?.id,
    })

    setReasoningProposal(prev => prev
      ? prev.map((p, i) => i === 0 ? {
        ...p,
        runStatus: writeResult.success ? 'success' : 'failed',
        writeResult,
      } : p)
      : prev)
    if (writeResult.success) {
      void workspace.refresh?.tasks()
    }
    const synthesizedContext = synthesizeContext({
      toolId: writeResult.toolId,
      executionStatus: writeResult.status,
      safeRuntimeSummary: writeResult.safeSummary,
      safePreviewItems: [],
      reflection: writeResult.reflection,
      workspaceContext: buildContextSynthesisWorkspaceContext(workspace, tasks, currentTime),
      decisionProfile: workspace.decisionProfile,
      responseLanguage: current.result.responseLanguage,
      generatedAt: currentTime.toISOString(),
    })
    appendAssistantResult(
      resultMessage(
        writeResult,
        current.result.responseLanguage,
        workspace.decisionProfile,
        synthesizedContext,
      ),
      current.result.responseLanguage,
    )
  }, [appendAssistantResult, reasoningProposal, tasks, user?.id, workspace])

  const firstName =
    profile?.displayName?.trim()?.split(' ')[0] ||
    user?.email?.split('@')[0] ||
    'there'
  const conversationCount = messages.filter(m => m.role === 'user').length + sessions.length
  const taskCount = tasks.length

  const canSend = draft.trim().length > 0 && !sending && !loading
  const showWelcome = !activeSessionId && messages.length === 0 && !sending

  return (
    <div className="pb-6">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-4 sm:px-6 lg:px-8 py-4 border-b border-border"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="icon-tile">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">{t('chat_title')}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">{t('chat_subtitle')}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={startNewChat}
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('flow_new_chat')}</span>
          </Button>
        </div>
      </motion.header>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-5 px-4 sm:px-6 lg:px-8 pt-5">
        {/* Center column */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Quick actions — shown when no active session */}
          {showWelcome && (
            <div>
              <h3 className="text-sm font-semibold mb-3">{t('flow_quick_title')}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.labelKey}
                    type="button"
                    disabled={sending}
                    onClick={() => void handleSend(action.prompt)}
                    className="glass-card flex items-center gap-3 rounded-xl p-3 text-left transition-all hover:shadow-elevated hover:scale-[1.02] hover:border-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className={cn('icon-tile w-9 h-9 rounded-lg shrink-0', action.iconBg)}>
                      <action.icon className={cn('w-4 h-4', action.iconColor)} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{t(action.labelKey)}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{t(action.descKey)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation */}
          <Card className="glass-card card-accent">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2.5">
                <div className="icon-tile w-7 h-7 rounded-md">
                  <MessageSquare className="w-3.5 h-3.5 text-primary" />
                </div>
                {t('flow_conversation_title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              {/* Messages */}
              <div className="max-h-[450px] overflow-y-auto space-y-3 pr-1 mb-3">
                {loading && (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    {t('loading')}
                  </div>
                )}

                {!loading && messages.length === 0 && !sending && (
                  <div className="py-6">
                    <div className="glass-card relative overflow-hidden rounded-2xl p-5 w-full">
                      <SmartflowAsciiVisual
                        variant="wiremesh"
                        className="absolute -right-8 -top-10 h-44 w-44 opacity-45 sm:h-52 sm:w-52"
                      />
                      <div className="relative z-10 flex items-center gap-4">
                        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border border-primary/10 bg-background/25">
                          <SmartflowAsciiVisual
                            variant="wiremesh"
                            className="h-full w-full opacity-80"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h2 className="text-lg sm:text-xl font-semibold">
                            {t('flow_greeting')}, {firstName} 👋
                          </h2>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t('flow_hero_desc')}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-4 mt-4 pt-3 border-t border-border/30">
                        <div className="flex items-center gap-2">
                          <div className="icon-tile w-7 h-7 rounded-md">
                            <MessageSquare className="w-3.5 h-3.5 text-primary" />
                          </div>
                          <div>
                            <p className="text-base font-bold leading-none">{conversationCount}</p>
                            <p className="text-[10px] text-muted-foreground">{t('flow_stat_conversations')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="icon-tile w-7 h-7 rounded-md">
                            <CheckSquare className="w-3.5 h-3.5 text-primary" />
                          </div>
                          <div>
                            <p className="text-base font-bold leading-none">{taskCount}</p>
                            <p className="text-[10px] text-muted-foreground">{t('flow_stat_tasks')}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {messages.map(msg => (
                  <ChatBubble key={msg.id} role={msg.role} content={msg.content} language={msg.language} />
                ))}

                {sending && <TypingIndicator label={t('chat_typing')} />}

                <div ref={bottomRef} />
              </div>

              {reasoningProposal?.map((proposal, index) => (
                <ReasoningProposalCard
                  key={proposal.result.proposal.id}
                  proposal={proposal}
                  onRunReadOnly={() => handleRunReasoningProposal(index)}
                  onReviewApproval={() => setApprovalDialogOpen(true)}
                  onRunWrite={handleRunTaskCompleteProposal}
                />
              ))}

              {/* Input */}
              <div className="border-t border-border/40 pt-3">
                {sendError !== null && (
                  <p className="text-xs text-destructive mb-2">{sendError}</p>
                )}
                <div className="flex gap-2 items-end">
                  <Textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('chat_placeholder')}
                    rows={5}
                    disabled={sending || loading}
                    className="resize-none min-h-[120px]"
                    dir="auto"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSend()}
                    disabled={!canSend}
                    className="gap-1.5 self-end shrink-0"
                    style={{ background: 'var(--gradient-primary)' }}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                      {sending ? t('chat_sending') : t('chat_send')}
                    </span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar — session list */}
        <div className="w-full lg:w-[260px] shrink-0">
          <Card className="glass-card card-accent">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2.5">
                <div className="icon-tile w-7 h-7 rounded-md">
                  <MessageSquare className="w-3.5 h-3.5 text-primary" />
                </div>
                {t('flow_conversations')}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              {sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('flow_no_conversations')}
                </p>
              ) : (
                <ul className="max-h-[500px] overflow-y-auto space-y-1 -mx-1">
                  {sessions.map(s => (
                    <li key={s.id} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => selectSession(s.id)}
                        className={cn(
                          'flex-1 min-w-0 text-left rounded-lg px-2.5 py-2 transition-colors',
                          s.id === activeSessionId
                            ? 'bg-primary/10 border border-primary/20'
                            : 'hover:bg-secondary/30'
                        )}
                      >
                        <p className="text-xs font-medium truncate" dir="auto">
                          {s.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {timeAgo(s.updated_at)}
                        </p>
                      </button>
                      <button
                        type="button"
                        aria-label="Delete conversation"
                        onClick={async () => {
                          const ok = await deleteSession(s.id);
                          if (ok && activeSessionId === s.id) startNewChat();
                        }}
                        className="shrink-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <StepApprovalDialog
        open={approvalDialogOpen}
        step={reasoningProposal?.[0]?.step ?? null}
        stepApproval={reasoningProposal?.[0]?.approval ?? null}
        tool={reasoningProposal?.[0]?.resolution?.tool ?? null}
        onClose={() => setApprovalDialogOpen(false)}
        onDecision={handleApprovalDecision}
      />
    </div>
  )
}
