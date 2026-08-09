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
import { createDirectionalMarkdownComponents, isolateEmbeddedBidiRuns } from '@/lib/bidiText'
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
  getStrongReadDomainEvidence,
  synthesizeContext,
  getToolById,
  isAutoExecutableReadOnlyToolId,
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
import { createGitHubIssuesCommentClient } from '@/features/integrations/github/githubIssuesCommentClient'
import { createGitHubIssuesUpdateClient } from '@/features/integrations/github/githubIssuesUpdateClient'
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

// Task 11e (bidi rendering): direction-handling now lives in the shared
// createDirectionalMarkdownComponents utility (src/lib/bidiText.tsx), used
// identically by ChatPage, AgentBriefingCard, WeeklyBriefingPage, and
// TasksPage -- one solution, not a per-page patch. Only the visual class
// names are specific to this page, passed straight through unchanged.
const MSG_MD_COMPONENTS = createDirectionalMarkdownComponents({
  p: 'mb-1 last:mb-0',
  ul: 'mt-1 list-disc space-y-0.5 ps-4',
})

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

// EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
// Every type here already carries requiresApproval=true from the validator;
// this set drives which write-resolution/approval path proposalToState uses,
// generalizing what used to be a tasks.complete-only check.
const WRITE_PROPOSAL_TYPES = new Set<AgentReasoningResult['proposal']['type']>([
  'complete_task',
  'write_github_issue_comment',
  'write_github_issue_update',
])

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

// Conversation Quality v1 (task 9): "خودم/خودت/خودش/..." ("my own"/"your
// own"/...) are added as standalone possessive-emphasis words, alongside
// the existing bare "من" check -- whole words, not suffixes, so they carry
// none of the attachment ambiguity the comment on
// PERSIAN_POSSESSIVE_SUFFIX_PATTERN documents for bare word-final letters.
// That deeper gap (کارم, دستم) is intentionally NOT addressed here; the
// existing reasoning below for why a longer suffix list is unsafe still
// holds and is not revisited.
const PERSIAN_POSSESSIVE_STANDALONE_PATTERN =
  /(?<![\p{L}\p{N}_])(من|خودم|خودت|خودش|خودمان|خودتان|خودشان)(?![\p{L}\p{N}_])/u

function hasPersianPossessiveMarker(text: string): boolean {
  return (
    PERSIAN_POSSESSIVE_STANDALONE_PATTERN.test(text) ||
    PERSIAN_POSSESSIVE_SUFFIX_PATTERN.test(text)
  )
}

// Conversation Quality v1 (task 9): a request to study/review/prepare FOR
// something (an exam, a concept) is asking for tutoring content, not asking
// SmartFlow to inspect the user's own learning-progress data -- even though
// it contains "study", the same word getStrongReadDomainEvidence's
// `learning` evidence uses. Unconditional, like the existing why-is/explain
// bucket it lives alongside: this is the Product Owner's FIAE-exam
// screenshot case (see the design note).
const STUDY_HELP_PATTERN =
  /\bhelp me (study|review|prepare|practice)\b/i
const STUDY_HELP_PATTERN_DE =
  /\bhilf mir (beim|zu) (lernen|wiederholen|vorbereiten|üben|ueben)\b/i
const STUDY_HELP_PATTERN_FA =
  /کمک\s*کن.{0,30}(مطالعه|مرور|امتحان|درس)/i

// Conversation Quality v1 (task 9): a narrative status-inquiry ("how is X
// doing", "how's X going") differs from an imperative request ("check the
// status of X") by having no command verb -- only a WH-question about how
// something is going. On its own this is not enough to demote a message
// (see shouldUseReasoningForMessage's use of it below, combined with
// getStrongReadDomainEvidence); it exists to isolate exactly the shape of
// the Product Owner's canonical ambiguous example, "How is my project
// doing?", from imperative-shaped requests like "Check the status of my
// project rollout", which stay explicit unchanged.
const NARRATIVE_STATUS_INQUIRY_PATTERN =
  /\bhow\s+(is|are|'s)\b.{0,40}\b(doing|going)\b/i
const NARRATIVE_STATUS_INQUIRY_PATTERN_DE =
  /\bwie\s+(läuft|laeuft|geht(’s|'s)?|steht\s+es\s+um)\b/i
const NARRATIVE_STATUS_INQUIRY_PATTERN_FA =
  /(چطور(ه)?|چگونه|وضعیت)[\s\S]{0,20}(پیش[‌\s]*(می[‌\s]*رود|میره)|در\s*حال\s*پیشرفت)/i

function isNarrativeStatusInquiry(text: string): boolean {
  return (
    NARRATIVE_STATUS_INQUIRY_PATTERN.test(text) ||
    NARRATIVE_STATUS_INQUIRY_PATTERN_DE.test(text) ||
    NARRATIVE_STATUS_INQUIRY_PATTERN_FA.test(text)
  )
}

// Conversation Quality v1 (task 10-fix): a declarative first-person
// self-statement -- introducing who you are, what you know, or what you're
// looking for -- is ordinary conversation, not a request for SmartFlow to do
// anything. This is the Product Owner's IHK/React/TELC/junior-Java
// introduction case: it names "درس" (study), which is literally one of
// getStrongReadDomainEvidence's own `learning` evidence words, so gating
// this carve-out on "no domain evidence" (the way isNarrativeStatusInquiry
// is gated) would wrongly block it -- talking about what you're studying
// inherently mentions learning-shaped words. Gating on the ABSENCE of an
// imperative/tool-shaped clause instead (see hasImperativeClause below)
// correctly distinguishes "I'm studying for the IHK exam" (no command verb
// anywhere) from a mixed message like "...and show my tasks" (a real
// command verb is present), which must stay explicit no matter what
// self-statement shape precedes it.
// "i have" is excluded when preceded by "do" ((?<!\bdo\s)) -- "do I have" is
// the inverted-auxiliary question form ("What tasks do I have today?",
// already an existing explicit test case, task 9), never a declarative
// self-statement the way non-inverted "I have three years of experience" is.
const SELF_STATEMENT_PATTERN_EN =
  /\bi\s*(?:'m|am)\s+(?:a|an|looking for)\b|\bi\s+know\b|(?<!\bdo\s)\bi\s+have\b/i
const SELF_STATEMENT_PATTERN_DE =
  /\bich\s+(?:bin|kann|habe|suche)\b/i
const SELF_STATEMENT_PATTERN_FA =
  /من[\s\S]{0,60}(هستم|بلدم|دارم)|دنبال[\s\S]{0,60}می[‌\s]*گردم/i

function isSelfStatement(text: string): boolean {
  return (
    SELF_STATEMENT_PATTERN_EN.test(text) ||
    SELF_STATEMENT_PATTERN_DE.test(text) ||
    SELF_STATEMENT_PATTERN_FA.test(text)
  )
}

// A small, explicit table of command verbs for the tool-shaped actions this
// app actually supports (show/check/list/complete/mark/create/add/update) --
// deliberately not a general imperative-mood detector, the same "narrow,
// explicit, tool-relevant" posture AMBIGUOUS_OFFER_TEXT and
// GERMAN_OFFEN_WITH_TASK_CONTEXT already take elsewhere in this codebase.
// This is what "an imperative/tool-shaped clause anywhere in the message"
// (task 10-fix's own phrase) is checked against -- a self-statement
// combined with one of these anywhere in the message keeps EXPLICIT
// priority, matching "...and show my tasks" staying explicit.
const IMPERATIVE_CLAUSE_PATTERN_EN =
  /\b(show|check|list|complete|mark|create|add|update|give me|tell me)\b/i
const IMPERATIVE_CLAUSE_PATTERN_DE =
  /\b(zeig|zeige|pr(?:ü|ue)fe|liste|erstelle|markiere|aktualisiere|gib mir)\b/i
const IMPERATIVE_CLAUSE_PATTERN_FA =
  /(نشان\s*بده|نشونم\s*بده|چک\s*کن|لیست\s*کن|کامل\s*کن|ایجاد\s*کن)/i

function hasImperativeClause(text: string): boolean {
  return (
    IMPERATIVE_CLAUSE_PATTERN_EN.test(text) ||
    IMPERATIVE_CLAUSE_PATTERN_DE.test(text) ||
    IMPERATIVE_CLAUSE_PATTERN_FA.test(text)
  )
}

export type MessageIntentSignal = 'explicit' | 'ambiguous' | 'conversational'

// Conversation Quality v1 (task 9): three-way classification replacing the
// old two-way (reasoning vs. plain chat) routing. See the design note
// (docs/architecture/notes/conversation-quality-v1-design-note.md) for the
// full rationale, including why this is NOT simply "require
// getStrongReadDomainEvidence to reach reasoning mode" -- that would break
// ordinary explicit requests like "Show me my repositories" that don't
// happen to contain the qualifier words that function's rescue-purpose
// patterns require. Instead, narrow, additive carve-outs sit on top of the
// existing, unchanged binary gate (task 9 added two -- study-help and
// narrative-status; task 10-fix added a third -- self-statement).
export function classifyMessageIntentSignal(message: string): MessageIntentSignal {
  const text = message.trim().toLowerCase()
  if (!text) return 'conversational'
  const realPersianReasoningIntent =
    /(یادگیری|درس|تقویم|قرار|جلسه|وظیفه|وظیفه[‌\s-]?ها|کارها|کار|تمرکز|برنامه\s+فعلی|کامل\s+کن|انجام[‌\s-]?شده|تمام\s+نشده)/i.test(text)

  // "why is / explain / tell me about" (and the German/Persian equivalents)
  // are unconditional generic-topic markers: asking to explain a concept is
  // ordinary conversation no matter which domain words happen to appear in
  // it, so these need no per-tool list and none is applied to them. The
  // study-help patterns are the same shape of unconditional marker, added
  // for task 9 (see comment above their definitions).
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
    (/چیست/i.test(text) && !hasPersianPossessiveMarker(text)) ||
    STUDY_HELP_PATTERN.test(text) ||
    STUDY_HELP_PATTERN_DE.test(text) ||
    STUDY_HELP_PATTERN_FA.test(text) ||
    (isSelfStatement(text) && !hasImperativeClause(text))

  if (ordinaryConversation) return 'conversational'
  if (realPersianReasoningIntent) return 'explicit'

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
  if (isEntirelyConversationalFiller(text)) return 'conversational'

  // A narrative status-inquiry ("how is X doing") with no nameable tool
  // behind it (getStrongReadDomainEvidence returns null) is neither a real
  // action request nor ordinary chat -- it demotes from the old default
  // "explicit" to "ambiguous". A message that also names a concrete domain
  // ("how are my tasks doing") keeps its domain evidence and is not
  // affected by this branch at all, since isNarrativeStatusInquiry alone
  // never demotes anything -- see the design note.
  if (isNarrativeStatusInquiry(text) && getStrongReadDomainEvidence(text) === null) {
    return 'ambiguous'
  }

  return 'explicit'
}

export function shouldUseReasoningForMessage(message: string) {
  return classifyMessageIntentSignal(message) === 'explicit'
}

// Conversation Quality v1 (task 9): the one currently-supported trailing
// offer. Deliberately a tiny, explicit table, not a general classifier --
// bare "project" in a narrative status-inquiry maps to GitHub because a
// connected repository's live issue/PR/workflow state is the most concrete,
// verifiable "real status" this app can pull for a project today. An
// ambiguous message matching nothing here gets a plain conversational
// reply with no offer at all -- that is an intended, valid outcome, not a
// gap (see the design note).
export type AmbiguousOfferHint = 'github'

export function getAmbiguousOfferHint(message: string): AmbiguousOfferHint | null {
  const text = message.trim().toLowerCase()
  if (/\bproject\b/i.test(text) || /\bprojekt\b/i.test(text) || /پروژه/i.test(text)) {
    return 'github'
  }
  return null
}

const AMBIGUOUS_OFFER_TEXT: Record<AmbiguousOfferHint, Record<SupportedAiResponseLanguage, string>> = {
  github: {
    en: 'Want me to pull the real status from GitHub?',
    de: 'Soll ich den tatsächlichen Status von GitHub abrufen?',
    fa: 'می‌خوای وضعیت واقعی رو از گیت‌هاب برات بیارم؟',
  },
}

export function getAmbiguousOfferText(hint: AmbiguousOfferHint, language: SupportedAiResponseLanguage): string {
  return AMBIGUOUS_OFFER_TEXT[hint][language]
}

// Task 11b (silence the overlay): exhaustive over every AgentIntentType the
// reasoning path can validate to (intentValidator.ts's supportedIntentTypes).
// A `never` check on the default branch makes adding a new intent type
// without updating this function a COMPILE ERROR rather than a silent
// fallthrough to "visible" -- the scope guard task 11b was written against
// (no default-to-visible fallthrough).
//
// Only these 12 concrete, resolvable types count as a real, actionable
// proposal. "ask_clarification" and "unsupported" are deliberately excluded
// here no matter what triggered them (low confidence, mixed request,
// conflicting domain evidence, an unparseable LLM response, a rejected
// write verb, ...) -- none of those name a concrete tool the UI could ever
// run, so there is nothing for a panel to attach to. See the task 11b
// report for why this replaces the OLD, narrower "only 'unsupported' is
// silent" rule that let genuine ask_clarification proposals still render a
// panel for purely conversational messages.
function isSupportedActionableProposalType(type: AgentReasoningResult['proposal']['type']): boolean {
  switch (type) {
    case 'inspect_tasks':
    case 'inspect_calendar':
    case 'inspect_learning':
    case 'inspect_workspace':
    case 'inspect_github_repositories':
    case 'inspect_github_issues':
    case 'inspect_github_epics':
    case 'inspect_github_pull_requests':
    case 'inspect_github_workflow_runs':
    case 'complete_task':
    case 'write_github_issue_comment':
    case 'write_github_issue_update':
      return true
    case 'ask_clarification':
    case 'unsupported':
      return false
    default: {
      const exhaustiveCheck: never = type
      return exhaustiveCheck
    }
  }
}

// A multi-candidate disambiguation result carries a top-level
// "ask_clarification" type (see reasoningOrchestrator.ts's
// disambiguationCandidates branch) but each candidate inside it is itself a
// validated, concrete-type, non-approval-required proposal
// (resolveDisambiguationCandidates already filters to exactly that) -- so
// it counts as case (a), same as a single confident proposal.
function hasSupportedActionableOverlay(result: AgentReasoningResult): boolean {
  if (result.disambiguationCandidates && result.disambiguationCandidates.length >= 2) return true
  return isSupportedActionableProposalType(result.proposal.type)
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
    case 'write_github_issue_comment':
      return 'agent_intent_title_write_github_issue_comment'
    case 'write_github_issue_update':
      return 'agent_intent_title_write_github_issue_update'
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
  const isGithubIssueWrite = proposal.type === 'write_github_issue_comment' || proposal.type === 'write_github_issue_update'
  const domain =
    proposal.type === 'inspect_github_repositories' ||
    proposal.type === 'inspect_github_issues' ||
    proposal.type === 'inspect_github_epics' ||
    proposal.type === 'inspect_github_pull_requests' ||
    proposal.type === 'inspect_github_workflow_runs' ||
    isGithubIssueWrite
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
    : proposal.type === 'write_github_issue_comment'
      ? 'create'
      : proposal.type === 'write_github_issue_update'
        ? 'update'
        : readIntentAction[proposal.type] ?? 'inspect'
  const githubIssueTargetId = isGithubIssueWrite && proposal.target?.repo && proposal.target?.issueNumber
    ? `${proposal.target.repo}#${proposal.target.issueNumber}`
    : undefined
  const targetId = proposal.type === 'complete_task' ? proposal.target?.taskId : githubIssueTargetId

  return {
    id: `reasoning-step:${proposal.id}`,
    order: 1,
    title: intentTitle(proposal.type, t),
    description: proposal.type === 'complete_task'
      ? t('agent_intent_complete_description', { title: proposal.target?.taskTitleHint ?? t('agent_intent_selected_task') })
      : proposal.type === 'write_github_issue_comment'
        ? t('agent_intent_comment_description', { targetId: githubIssueTargetId ?? '' })
        : proposal.type === 'write_github_issue_update'
          ? t('agent_intent_update_description', { targetId: githubIssueTargetId ?? '' })
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

// Generalized for EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
// Previously hardcoded to tasks.complete; now resolves whichever write tool
// the validated proposal actually named.
function writeResolutionForStep(step: WorkspacePlanStep, toolId: string): ToolResolutionResult | null {
  const tool = getToolById(toolId)
  if (!tool) return null
  return {
    status: 'resolved',
    resolved: true,
    stepId: step.id,
    toolId,
    tool,
    confidence: 'high',
    reasons: [`Resolved through the explicit ${toolId} reasoning mapping.`],
    candidates: [],
    requiredInput: tool.inputSchema.filter(field => field.required).map(field => field.name),
    generatedAt: new Date().toISOString(),
    resolverVersion: 'tool-resolver-v1',
  }
}

// Generalized for EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
// Previously hardcoded to tasks.complete only. previewText carries the exact
// pending write content (comment body, or a title/body/label diff) so the
// approval dialog can show it before Run is enabled -- the ADR's mandatory
// preview step.
function approvalForReasoningStep(
  result: AgentReasoningResult,
  step: WorkspacePlanStep,
  resolution: ToolResolutionResult,
  t: Translate,
): WorkspaceStepApproval | null {
  const proposal = result.proposal
  const tool = resolution.tool

  if (proposal.type === 'complete_task') {
    if (resolution.toolId !== 'tasks.complete' || !step.targetId) return null
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

  if (proposal.type === 'write_github_issue_comment') {
    const target = proposal.target
    if (resolution.toolId !== 'github.issues.comment' || !step.targetId || !target?.commentBody) return null
    return {
      stepId: step.id,
      targetId: step.targetId,
      toolId: 'github.issues.comment',
      toolName: tool?.name,
      toolDescription: tool?.description,
      toolCapability: tool?.capability,
      toolMode: tool?.mode,
      status: 'pending',
      requiresApproval: true,
      approvalReason: t('agent_intent_github_comment_approval_reason'),
      riskLevel: 'medium',
      reversible: false,
      externalEffect: true,
      dataDomains: ['github'],
      approvalScope: 'single_step',
      previewText: target.commentBody,
    }
  }

  if (proposal.type === 'write_github_issue_update') {
    const target = proposal.target
    if (resolution.toolId !== 'github.issues.update' || !step.targetId) return null
    if (!target?.updateTitle && !target?.updateBody && !target?.updateLabels) return null
    const previewLines = [
      target.updateTitle ? `${t('approval_preview_title_label')}: ${target.updateTitle}` : undefined,
      target.updateBody ? `${t('approval_preview_body_label')}: ${target.updateBody}` : undefined,
      target.updateLabels ? `${t('approval_preview_labels_label')}: ${target.updateLabels.join(', ')}` : undefined,
    ].filter((line): line is string => Boolean(line))
    return {
      stepId: step.id,
      targetId: step.targetId,
      toolId: 'github.issues.update',
      toolName: tool?.name,
      toolDescription: tool?.description,
      toolCapability: tool?.capability,
      toolMode: tool?.mode,
      status: 'pending',
      requiresApproval: true,
      approvalReason: t('agent_intent_github_update_approval_reason'),
      riskLevel: 'medium',
      reversible: false,
      externalEffect: true,
      dataDomains: ['github'],
      approvalScope: 'single_step',
      previewText: previewLines.join('\n'),
    }
  }

  return null
}

export function proposalToState(result: AgentReasoningResult, t: Translate): ReasoningProposalState {
  const step = stepForReasoning(result, t)
  const isWriteProposal = WRITE_PROPOSAL_TYPES.has(result.proposal.type)
  const resolution = step
    ? isWriteProposal && result.toolId
      ? writeResolutionForStep(step, result.toolId)
      : resolveToolForStep({ step, expectedToolId: result.toolId })
    : null
  const approval = step && resolution?.resolved && isWriteProposal
    ? approvalForReasoningStep(result, step, resolution, t)
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

export interface ChatTurnOverlayInput {
  readonly intentSignal: MessageIntentSignal
  readonly message: string
  readonly responseLanguage: SupportedAiResponseLanguage
  readonly reply: string
  // Already resolved (never a pending/rejecting Promise) -- the caller is
  // responsible for the FAILURE RULE at the promise level (catching a
  // throw/timeout from reasonAboutUserMessage and passing null here). This
  // function's own job is purely the DECISION of what to show, given an
  // outcome that already exists.
  readonly overlayResult: AgentReasoningResult | null
}

export interface ChatTurnOutcome {
  readonly content: string
  readonly reasoningStates: ReasoningProposalState[] | null
}

// Task 11b (silence the overlay): the ONE place that decides how a resolved
// conversational reply and a resolved (possibly null, possibly failed)
// overlay result combine into what the user actually sees. Extracted as a
// pure function -- independent of fetch/Supabase/React state -- so the
// decision logic is directly testable without rendering the full ChatPage
// component, mirroring how classifyMessageIntentSignal/getAmbiguousOfferHint
// are already tested as pure functions in this same file.
//
// Exactly two outcomes can add anything to what the user sees:
//   (a) a supported, actionable proposal -> the intent panel (unchanged UI)
//   (b) the task-9 ambiguous trailing offer -> one extra sentence
// Everything else -- unsupported, a genuine ask_clarification, low
// confidence, conflicting domain evidence, a mixed request, an unparseable
// LLM response, or the overlay promise having failed/thrown/timed out --
// surfaces NOTHING: no panel, no trailing note, no clarificationQuestion
// text. The conversational reply the default lane already produced is the
// whole story for all of those; see hasSupportedActionableOverlay above for
// the exhaustive type-level definition of "actionable."
export function resolveChatTurnOutcome(input: ChatTurnOverlayInput, t: Translate): ChatTurnOutcome {
  const overlayResult = input.overlayResult
  const hasGenuineOverlay = overlayResult !== null && hasSupportedActionableOverlay(overlayResult)

  if (!hasGenuineOverlay && overlayResult !== null) {
    console.debug('[ChatPage] overlay suppressed (task 11b): not a supported, actionable proposal', {
      type: overlayResult.proposal.type,
      reasons: overlayResult.proposal.reasons,
    })
  }

  const offerHint = input.intentSignal === 'ambiguous' ? getAmbiguousOfferHint(input.message) : null
  const trailingNote = offerHint ? getAmbiguousOfferText(offerHint, input.responseLanguage) : null

  return {
    content: trailingNote ? `${input.reply}\n\n${trailingNote}` : input.reply,
    reasoningStates: hasGenuineOverlay ? proposalsToStates(overlayResult, t) : null,
  }
}

// Task 11d (auto-execute read-only tools): a supported, actionable overlay
// proposal (see isSupportedActionableProposalType above) is eligible to run
// automatically in the same turn -- no panel, no "Run" click -- as long as
// it is (a) not a write type (WRITE_PROPOSAL_TYPES; unchanged: panel +
// explicit approval, per ADR-0004) and (b) not part of a genuine
// disambiguation (2-3 candidates means the user still has to pick which one
// -- auto-running an arbitrary candidate would defeat the point of asking).
// The actual per-tool eligibility (is THIS toolId allowed to auto-run) is a
// separate, later check against isAutoExecutableReadOnlyToolId's real
// allowlist intersection -- this function only narrows by proposal SHAPE.
export function isAutoExecutableReadOnlyProposal(result: AgentReasoningResult): boolean {
  if (result.disambiguationCandidates && result.disambiguationCandidates.length >= 2) return false
  return isSupportedActionableProposalType(result.proposal.type) && !WRITE_PROPOSAL_TYPES.has(result.proposal.type)
}

// Task 11d: a small, deterministic, SmartFlow-authored provenance marker --
// same posture as AMBIGUOUS_OFFER_TEXT/UNSUPPORTED_ACTION_NOTE elsewhere in
// this file (never model-generated) -- so an auto-executed read's real data
// is legible as "where did this come from" without the intent panel that
// used to carry that information. Keyed by the plan step's domain, which
// stepForReasoning only ever sets to one of these five values for a
// read-only proposal (see stepForReasoning's own domain derivation above).
type AutoReadDomain = 'tasks' | 'calendar' | 'learning' | 'workspace' | 'github'

const READ_PROVENANCE_TEXT: Record<AutoReadDomain, Record<SupportedAiResponseLanguage, string>> = {
  tasks: { en: '— from your tasks', de: '— aus deinen Aufgaben', fa: '— از تسک‌های شما' },
  calendar: { en: '— from your calendar', de: '— aus deinem Kalender', fa: '— از تقویم شما' },
  learning: { en: '— from your learning progress', de: '— aus deinem Lernfortschritt', fa: '— از پیشرفت یادگیری شما' },
  workspace: { en: '— from your workspace', de: '— aus deinem Arbeitsbereich', fa: '— از فضای کاری شما' },
  github: { en: '— from GitHub', de: '— von GitHub', fa: '— از گیت‌هاب' },
}

function isAutoReadDomain(domain: string): domain is AutoReadDomain {
  return domain === 'tasks' || domain === 'calendar' || domain === 'learning' || domain === 'workspace' || domain === 'github'
}

// Task 11d, FAILURE RULE: if the read tool itself fails (auth, network,
// RLS, provider outage -- anything runReadOnlyTool.success=false covers),
// the conversational reply the default lane already produced is still
// delivered; this is appended as a brief, honest note instead of the real
// data -- never a dead end, never a panel, mirroring task 11b's "silence
// over failure" posture but with one short acknowledgement rather than
// nothing, since the user asked a question that genuinely needed live data.
const READ_FETCH_FAILURE_NOTE: Record<SupportedAiResponseLanguage, string> = {
  en: "I couldn't pull the live data just now, so this is just from what I already know.",
  de: 'Ich konnte gerade keine aktuellen Daten abrufen, das hier basiert also nur auf dem, was ich schon weiß.',
  fa: 'الان نتوانستم داده‌های به‌روز را بگیرم، پس این فقط بر اساس چیزی است که از قبل می‌دانم.',
}

export interface AutoReadTurnInput {
  readonly reply: string
  readonly responseLanguage: SupportedAiResponseLanguage
  readonly domain: string
  readonly readResult: ReadOnlyRuntimeResult
  readonly decisionProfile?: WorkspaceDecisionProfile
  readonly synthesizedContext?: SynthesizedContext
}

// Task 11d: the ONE place that turns a completed (successful OR failed)
// auto-read execution into the single reply the user sees. GitHub-sourced
// (or any tool-sourced) text only ever reaches this through readResult,
// which is runReadOnlyTool's own output -- already passed through
// presentReadOnlyResult's bounded, sanitizing presenter and (for the tools
// composeAssistantResponse supports) resultMessage's existing composition.
// Nothing here reads raw provider payloads or bypasses that bounding.
export function resolveAutoReadTurnContent(input: AutoReadTurnInput): string {
  if (!input.readResult.success) {
    return `${input.reply}\n\n${READ_FETCH_FAILURE_NOTE[input.responseLanguage]}`
  }
  const dataText = resultMessage(input.readResult, input.responseLanguage, input.decisionProfile, input.synthesizedContext)
  const provenance = isAutoReadDomain(input.domain) ? READ_PROVENANCE_TEXT[input.domain][input.responseLanguage] : null
  return provenance ? `${input.reply}\n\n${dataText}\n\n${provenance}` : `${input.reply}\n\n${dataText}`
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
  // Generalized for EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
  // Previously `result.proposal.type === 'complete_task'` only, which silently
  // routed every other write proposal (github.issues.comment/update) through
  // the read-only run button/handler instead of the approval dialog.
  const isWriteProposal = WRITE_PROPOSAL_TYPES.has(result.proposal.type)
  const isApproved = approval?.status === 'approved'
  const isRejected = approval?.status === 'rejected' || runStatus === 'rejected'
  const canRunReadOnly = Boolean(
    !isWriteProposal &&
    proposal.step &&
    resolution?.resolved &&
    runStatus !== 'success' &&
    runStatus !== 'failed'
  )
  const canReviewApproval = isWriteProposal && approval?.status === 'pending'
  const canRunWrite = isWriteProposal && isApproved && runStatus !== 'success' && runStatus !== 'failed'
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
          {!isWriteProposal && (
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
          {isWriteProposal && isApproved && (
            <Button
              type="button"
              size="sm"
              onClick={onRunWrite}
              disabled={!canRunWrite || isRunning}
            >
              {isRunning ? t('agent_intent_running') : intentTitle(result.proposal.type, t)}
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
        // Task 11e: base direction is decided per content block (first-strong
        // heuristic, dir="auto"), not once for the whole bubble from the
        // resolved response language -- that per-bubble language-based
        // direction was the root cause of the production bug (it doesn't
        // isolate embedded opposite-direction runs, and it stopped mattering
        // anyway once AssistantContent's own per-block dir="auto" overrode
        // it for every markdown paragraph/list). Plain user-bubble text gets
        // the exact same per-block treatment now, including Latin-run
        // isolation, instead of only a bare dir="auto" with no isolation.
        dir="auto"
        lang={language}
      >
        {role === 'assistant'
          ? <AssistantContent content={content} />
          : <span className="whitespace-pre-wrap">{isolateEmbeddedBidiRuns(content)}</span>}
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

      const intentSignal = classifyMessageIntentSignal(text)

      // Task 11 fix (conversation-first inversion): the DEFAULT LANE.
      // Every inbound message calls the plain /chat conversational
      // endpoint, unconditionally -- this call is no longer inside the
      // 'explicit' branch, and nothing below can prevent it from running.
      // See the task 11 report's pipeline map/root-cause trace for why the
      // OLD code (this call gated behind `intentSignal !== 'explicit'`,
      // with an early `return` in the explicit branch) was the actual
      // production bug: a message misclassified 'explicit' by a keyword
      // collision never reached this call at all.
      const chatCallPromise = (async (): Promise<{ reply: string }> => {
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
        return (await res.json()) as { reply: string }
      })()

      // Task 11 fix: the OVERLAY LANE. Action interpretation runs
      // CONCURRENTLY with the conversation lane above (Promise.all below),
      // never serialized in front of it -- and this promise itself never
      // rejects (the .catch below always resolves to null), so it can
      // never be the reason handleSend's own try/catch fires. This is the
      // FAILURE RULE: any classifier/intent/toolResolver error or timeout
      // degrades to the conversation lane silently (logged here, not
      // surfaced to the user).
      let overlayPromise: Promise<AgentReasoningResult | null> = Promise.resolve(null)
      if (intentSignal === 'explicit') {
        // TEMP diagnostic, remove once the stale-closure fix (adding
        // githubRepositoryInventory to handleSend's useCallback deps) is
        // confirmed live: proves what this specific reasoning call actually
        // sent, independent of what the DB cache holds.
        console.log('[GitHubInventory] safeContext value at send time:', githubRepositoryInventory)
        overlayPromise = reasonAboutUserMessage({
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
        }).catch((error) => {
          console.error('[ChatPage] overlay reasoning failed -- degrading to conversation-only (task 11 failure rule):', error)
          return null
        })
      }

      const [{ reply }, overlayResult] = await Promise.all([chatCallPromise, overlayPromise])

      // Task 11d (auto-execute read-only tools): a supported, actionable,
      // non-write, non-disambiguated read proposal whose resolved tool is
      // in BOTH server-side allowlists' actual intersection runs
      // immediately, in this same turn -- no panel, no "Run" click, per
      // the PO decision that reads are not consequential (ADR-0004).
      // WRITE proposals never reach this branch at all
      // (isAutoExecutableReadOnlyProposal excludes WRITE_PROPOSAL_TYPES),
      // so they always fall through to the unchanged panel + approval flow
      // below. A read whose tool didn't resolve, or a genuine
      // disambiguation, also falls through unchanged (fail-closed).
      let autoReadContent: string | null = null
      if (overlayResult && isAutoExecutableReadOnlyProposal(overlayResult)) {
        const overlayState = proposalToState(overlayResult, t)
        if (
          overlayState.step &&
          overlayState.resolution?.resolved &&
          isAutoExecutableReadOnlyToolId(overlayState.resolution.toolId)
        ) {
          const currentTime = new Date()
          const readResult = await runReadOnlyTool({
            requestId: `auto-read:${overlayState.resolution.toolId}:${overlayState.step.id}:${currentTime.getTime()}`,
            step: overlayState.step,
            toolResolution: overlayState.resolution,
            approval: null,
            executionInput: {},
            executionContext: {
              ...workspace.agentContext,
              workspace,
              currentTime: currentTime.toISOString(),
              githubRepositoriesClient: createGitHubRepositoriesClient({
                workerBaseUrl: workerUrl,
                getAccessToken: async () => session.access_token,
              }),
              githubIssuesClient: createGitHubIssuesClient({
                workerBaseUrl: workerUrl,
                getAccessToken: async () => session.access_token,
              }),
              githubEpicsClient: createGitHubEpicsClient({
                workerBaseUrl: workerUrl,
                getAccessToken: async () => session.access_token,
              }),
              githubPullRequestsClient: createGitHubPullRequestsClient({
                workerBaseUrl: workerUrl,
                getAccessToken: async () => session.access_token,
              }),
              githubWorkflowRunsClient: createGitHubWorkflowRunsClient({
                workerBaseUrl: workerUrl,
                getAccessToken: async () => session.access_token,
              }),
            },
            currentTime,
          })
          const synthesizedContext = synthesizeContext({
            toolId: readResult.toolId,
            executionStatus: readResult.status,
            safeRuntimeSummary: readResult.safeSummary,
            safePreviewItems: readResult.safePreviewItems,
            reflection: readResult.reflection,
            workspaceContext: buildContextSynthesisWorkspaceContext(workspace, tasks, currentTime),
            decisionProfile: workspace.decisionProfile,
            responseLanguage,
            generatedAt: currentTime.toISOString(),
          })
          autoReadContent = resolveAutoReadTurnContent({
            reply,
            responseLanguage,
            domain: overlayState.step.domain,
            readResult,
            decisionProfile: workspace.decisionProfile,
            synthesizedContext,
          })
        }
      }

      // Task 11: the actual combining decision (for everything that isn't
      // an auto-executed read) lives in resolveChatTurnOutcome (a pure,
      // independently-tested function) -- see its own comment for the
      // outcome rationale. handleSend's job is only to gather the resolved
      // inputs and apply the decision.
      const outcome = autoReadContent !== null
        ? { content: autoReadContent, reasoningStates: null }
        : resolveChatTurnOutcome({ intentSignal, message: text, responseLanguage, reply, overlayResult }, t)
      setReasoningProposal(outcome.reasoningStates)

      setMessages(prev => [
        ...prev,
        { id: `u-${Date.now()}`, role: 'user', content: text },
        { id: `a-${Date.now() + 1}`, role: 'assistant', content: outcome.content, language: responseLanguage },
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

  // Generalized for EPIC-07 (Write Light) -- runs any resolved write proposal
  // (tasks.complete, github.issues.comment, github.issues.update), not just
  // task completion. runWriteTool's own capability/step-shape/handler-input
  // logic was still tasks.complete-only until a follow-up fix generalized it;
  // `target` is threaded through here so the github handlers can see
  // repo/issueNumber/commentBody/etc. -- step.targetId alone only carries
  // `${repo}#${issueNumber}`, never the comment body or update fields.
  const handleRunWriteProposal = useCallback(async () => {
    const current = reasoningProposal?.[0]
    if (!current?.step || !current.resolution?.resolved) return
    if (current.approval?.status !== 'approved') return

    const toolId = current.resolution.toolId
    setReasoningProposal(prev => prev
      ? prev.map((p, i) => i === 0 ? { ...p, runStatus: 'running' } : p)
      : prev)
    const currentTime = new Date()
    const writeResult = await runWriteTool({
      requestId: `reasoning:write:${toolId}:${current.step.id}:${currentTime.getTime()}`,
      step: current.step,
      toolResolution: current.resolution,
      approval: current.approval,
      target: current.result.proposal.target,
      executionContext: {
        ...workspace.agentContext,
        workspace,
        currentTime: currentTime.toISOString(),
        githubIssueCommentClient: createGitHubIssuesCommentClient({
          workerBaseUrl: workerUrl,
          getAccessToken: async () => {
            const { data: { session } } = await supabase.auth.getSession()
            return session?.access_token
          },
        }),
        githubIssueUpdateClient: createGitHubIssuesUpdateClient({
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
      ? prev.map((p, i) => i === 0 ? {
        ...p,
        runStatus: writeResult.success ? 'success' : 'failed',
        writeResult,
      } : p)
      : prev)
    if (writeResult.success && toolId === 'tasks.complete') {
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
  }, [appendAssistantResult, reasoningProposal, tasks, workerUrl, workspace])

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
                  onRunWrite={handleRunWriteProposal}
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
