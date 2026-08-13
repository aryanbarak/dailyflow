import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  BookOpen,
  Briefcase,
  Calendar,
  CheckCircle2,
  FileText,
  Flame,
  Wallet,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { createDirectionalMarkdownComponents, isolateEmbeddedBidiRuns, resolveMessageBaseDirection } from '@/lib/bidiText'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useProfile } from '@/features/profile/useProfile'
import { useTasks } from '@/hooks/useTasks'
import { SmartFlowIcon } from '@/components/SmartFlowLogo'
import { translations, useT } from '@/i18n'
import type { TranslationKey } from '@/i18n'
import { useChatSessions } from '@/hooks/useChatSessions'
import { persistActiveSessionId, readPersistedActiveSessionId, resolveActiveSessionOnMount } from '@/features/chat/activeSessionResolver'
// Task 17c, PO decisions D3/D4: the mobile bottom nav is removed on this
// page (AppLayout.tsx); its "More" sheet content is reused here verbatim
// instead of being rebuilt -- see MobileNav.tsx's own comment on why these
// are exported.
import { NavItemsGrid } from '@/components/layout/MobileNav'
import { mainNavItems, moreNavItems } from '@/components/layout/mobileNavItems'
// Task 17a (Chat Experience v2, mobile-first foundation) -- see
// src/features/chat/ for the new composer/drawer/scroll/theme/compact
// pieces this page now composes. Pipeline logic below (reasoning,
// classification, proposal handling) is UNCHANGED by this task.
import { ChatComposer } from '@/features/chat/components/ChatComposer'
import { validateChatAttachment } from '@/features/chat/chatAttachmentValidation'
import { createDocument, uploadToStorage, type Document } from '@/features/documents/documentsService'
import { ChatPageHeader } from '@/features/chat/components/ChatPageHeader'
import { ChatEmptyState, type ChatEmptyStateAction } from '@/features/chat/components/ChatEmptyState'
import { ConversationsDrawer } from '@/features/chat/components/ConversationsDrawer'
import { JumpToLatestPill } from '@/features/chat/components/JumpToLatestPill'
import { useChatDisplayPreferences } from '@/features/chat/chatDisplayPreferencesStore'
import { shouldAutoScrollOnNewContent } from '@/features/chat/chatScrollDecision'
import { isChatEmptyState } from '@/features/chat/emptyStateVisibility'
import { timeAgo } from '@/features/chat/timeAgo'
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
  undo?: {
    id: string
    label: string
    expiresAt: string
  }
}

// Task 17b: `accent` is the Flow AI semantic accent slug
// (src/styles/flow-tokens.css's --flow-<accent>/--flow-<accent>-bg pair)
// each action maps to in Dark Cosmic -- see ChatEmptyState.tsx. iconBg/
// iconColor are unchanged and still used verbatim for the light theme
// (PO scope: "light theme untouched"). These six actions and their prompts
// are REUSED exactly as-is (task 17b: "reuse the existing quick-action
// definitions/i18n from the current home surface... do not invent new
// copy") -- this array already IS that canonical definition; nothing here
// was renamed, reworded, or re-prompted for this task.
interface QuickAction {
  id: string
  labelKey: TranslationKey
  descKey: TranslationKey
  icon: React.ElementType
  iconBg: string
  iconColor: string
  accent: ChatEmptyStateAction['accent']
  prompt: string
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'study',
    labelKey: 'flow_action_study',
    descKey: 'flow_action_study_desc',
    icon: BookOpen,
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-400',
    accent: 'study',
    prompt: 'Help me study and review a concept for my FIAE exam.',
  },
  {
    id: 'plan',
    labelKey: 'flow_action_plan',
    descKey: 'flow_action_plan_desc',
    icon: Calendar,
    iconBg: 'bg-violet-500/15',
    iconColor: 'text-violet-400',
    accent: 'plan',
    prompt: 'Help me plan my day effectively based on my tasks and goals.',
  },
  {
    id: 'habits',
    labelKey: 'flow_action_habits',
    descKey: 'flow_action_habits_desc',
    icon: Flame,
    iconBg: 'bg-orange-500/15',
    iconColor: 'text-orange-400',
    accent: 'analyze',
    prompt: 'Analyze my habits and give me insights on my patterns.',
  },
  {
    id: 'finance',
    labelKey: 'flow_action_finance',
    descKey: 'flow_action_finance_desc',
    icon: Wallet,
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-400',
    accent: 'review',
    prompt: 'Review my finances and help me understand my spending.',
  },
  {
    id: 'weekly',
    labelKey: 'flow_action_weekly',
    descKey: 'flow_action_weekly_desc',
    icon: FileText,
    iconBg: 'bg-cyan-500/15',
    iconColor: 'text-cyan-400',
    accent: 'report',
    prompt: 'Give me a weekly summary of my progress and priorities.',
  },
  {
    id: 'career',
    labelKey: 'flow_action_career',
    descKey: 'flow_action_career_desc',
    icon: Briefcase,
    iconBg: 'bg-rose-500/15',
    iconColor: 'text-rose-400',
    accent: 'career',
    prompt: 'Help me with my job search and interview preparation.',
  },
]

// Task 11e (bidi rendering): direction-handling now lives in the shared
// createDirectionalMarkdownComponents utility (src/lib/bidiText.tsx), used
// identically by ChatPage, AgentBriefingCard, WeeklyBriefingPage, and
// TasksPage -- one solution, not a per-page patch. Only the visual class
// names are specific to this page, passed straight through unchanged.
// Task 17d, workstream 3 (design polish -- typography scale for long-form
// Persian answers): paragraph/list spacing bumped one notch (mb-1->mb-2,
// space-y-0.5->space-y-1) for clearer visual separation between blocks in
// longer multi-paragraph replies -- existing Tailwind spacing scale only,
// no new tokens, no layout change (still the same mb-*/space-y-* utilities
// this file already used, just the next step up).
const MSG_MD_COMPONENTS = createDirectionalMarkdownComponents({
  h1: 'mb-3 mt-1 text-base font-semibold leading-snug tracking-normal text-foreground first:mt-0',
  h2: 'mb-2.5 mt-4 text-[15px] font-semibold leading-snug tracking-normal text-foreground first:mt-0',
  h3: 'mb-2 mt-3 text-sm font-semibold leading-snug tracking-normal text-foreground first:mt-0',
  h4: 'mb-1.5 mt-3 text-[13px] font-semibold leading-snug tracking-normal text-foreground first:mt-0',
  p: 'mb-2 last:mb-0',
  ul: 'my-2 list-disc space-y-1 ps-4',
  ol: 'my-2 list-decimal space-y-1 ps-4',
  li: 'ps-1 leading-relaxed',
  blockquote: 'my-2 border-inline-start-2 border-border/70 ps-3 text-muted-foreground',
  strong: 'font-semibold text-foreground',
  em: 'italic',
  code: 'rounded bg-background/70 px-1 py-0.5 font-mono text-[0.92em]',
  pre: 'my-2 overflow-x-auto rounded-md bg-background/80 p-3 text-left font-mono text-xs leading-5',
  a: 'font-medium text-primary underline underline-offset-2',
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
  'create_task',
  'update_task',
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

// Task 20, Part A0 (PO revision of task 11b): 'unsupported' is silenced by
// default (see resolveChatTurnOutcome below) because task 11b's own root
// cause was exactly this shape -- a message misclassified 'explicit' by a
// keyword collision (bare Persian "کار" in a personal statement about job
// hunting) reaching 'unsupported' and becoming a nag on ordinary
// conversation. That risk has NOT gone away; classifyMessageIntentSignal's
// 'explicit' bucket still catches that same historical case today. So this
// is a DELIBERATELY narrower, separate gate from plain 'explicit': a small,
// explicit vocabulary of verbs for the WRITE-shaped requests a user would
// actually phrase when asking Flow AI to create/set/schedule something
// (the task's own motivating example: "set a daily study task and two daily
// reminders") -- never a general imperative-mood detector, same philosophy
// as IMPERATIVE_CLAUSE_PATTERN_* above and intentValidator.ts's own
// requestLooksUnsupported, but purpose-built here rather than reusing
// either: hasImperativeClause's list (show/check/list/complete/mark/
// create/add/update) serves a DIFFERENT job (demoting self-statements) and
// is missing set/schedule/remind entirely; requestLooksUnsupported lives in
// intentValidator.ts and changing its vocabulary would alter reasoning-
// pipeline classification itself, out of this task's scope (no
// write-tool/approval/execution changes). This list exists ONLY to gate
// whether the reply gets one extra sentence.
const EXPLICIT_ACTION_VERB_PATTERN_EN =
  /\b(create|set up|set|schedule|add|remind|remove|delete|update|cancel|book|reserve)\b/i
const EXPLICIT_ACTION_VERB_PATTERN_DE =
  /\b(erstelle|erstellen|richte ein|einrichten|setze|plane|planen|f[üu]ge hinzu|hinzuf[üu]gen|erinnere|erinnern|entferne|l[öo]sche|l[öo]schen|aktualisiere|aktualisieren|storniere|buche|reserviere)\b/i
const EXPLICIT_ACTION_VERB_PATTERN_FA =
  /(بساز|ایجاد\s*کن|تنظیم\s*کن|برنامه[‌\s-]?ریزی\s*کن|اضافه\s*کن|یادآوری\s*کن|حذف\s*کن|پاک\s*کن|به[‌\s-]?روزرسانی\s*کن|لغو\s*کن|رزرو\s*کن)/

export function looksLikeExplicitActionRequest(message: string): boolean {
  return (
    EXPLICIT_ACTION_VERB_PATTERN_EN.test(message) ||
    EXPLICIT_ACTION_VERB_PATTERN_DE.test(message) ||
    EXPLICIT_ACTION_VERB_PATTERN_FA.test(message)
  )
}

// Short, calm, non-naggy -- states the gap plainly without apologizing at
// length or inviting a back-and-forth. Deliberately does not name specific
// missing tools (e.g. "reminders") -- the capability list changes over
// time; this stays evergreen.
const UNSUPPORTED_CAPABILITY_TEXT: Record<SupportedAiResponseLanguage, string> = {
  en: "I can't do that yet — this isn't something Flow AI supports right now.",
  de: 'Das kann ich noch nicht — das unterstützt Flow AI aktuell noch nicht.',
  fa: 'هنوز نمی‌توانم این کار را انجام دهم — Flow AI فعلاً این قابلیت را ندارد.',
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
    case 'create_task':
    case 'update_task':
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
    case 'create_task':
      return 'agent_intent_title_create_task' as TranslationKey
    case 'update_task':
      return 'agent_intent_title_update_task' as TranslationKey
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
    : proposal.type === 'create_task'
      ? 'create'
      : proposal.type === 'update_task'
        ? 'update'
        : proposal.type === 'write_github_issue_comment'
          ? 'create'
          : proposal.type === 'write_github_issue_update'
            ? 'update'
            : readIntentAction[proposal.type] ?? 'inspect'
  const githubIssueTargetId = isGithubIssueWrite && proposal.target?.repo && proposal.target?.issueNumber
    ? `${proposal.target.repo}#${proposal.target.issueNumber}`
    : undefined
  const targetId = proposal.type === 'complete_task' || proposal.type === 'update_task'
    ? proposal.target?.taskId
    : githubIssueTargetId

  return {
    id: `reasoning-step:${proposal.id}`,
    order: 1,
    title: intentTitle(proposal.type, t),
    description: proposal.type === 'complete_task'
      ? t('agent_intent_complete_description', { title: proposal.target?.taskTitleHint ?? t('agent_intent_selected_task') })
      : proposal.type === 'create_task'
        ? t('agent_intent_create_description', { title: proposal.target?.title ?? '' })
        : proposal.type === 'update_task'
          ? t('agent_intent_task_update_description', { title: proposal.target?.taskTitleHint ?? proposal.target?.taskReference ?? '' })
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

  if (proposal.type === 'create_task') {
    const target = proposal.target
    if (resolution.toolId !== 'tasks.create' || !target?.title) return null
    return {
      stepId: step.id,
      targetId: step.id,
      toolId: 'tasks.create',
      toolName: tool?.name,
      toolDescription: tool?.description,
      toolCapability: tool?.capability,
      toolMode: tool?.mode,
      status: 'pending',
      requiresApproval: true,
      approvalReason: t('agent_intent_create_approval_reason'),
      riskLevel: 'medium',
      reversible: true,
      externalEffect: true,
      dataDomains: ['tasks'],
      approvalScope: 'single_step',
      previewText: [`${t('agent_intent_preview_title')}: ${target.title}`, target.dueDate ? `${t('agent_intent_preview_due')}: ${target.dueDate}` : null, target.notes ? `${t('agent_intent_preview_notes')}: ${target.notes}` : null]
        .filter(Boolean)
        .join('\n'),
    }
  }

  if (proposal.type === 'update_task') {
    const target = proposal.target
    if (resolution.toolId !== 'tasks.update' || !step.targetId) return null
    return {
      stepId: step.id,
      targetId: step.targetId,
      toolId: 'tasks.update',
      toolName: tool?.name,
      toolDescription: tool?.description,
      toolCapability: tool?.capability,
      toolMode: tool?.mode,
      status: 'pending',
      requiresApproval: true,
      approvalReason: t('agent_intent_task_update_approval_reason'),
      riskLevel: 'medium',
      reversible: true,
      externalEffect: true,
      dataDomains: ['tasks'],
      approvalScope: 'single_step',
      previewText: [
        target?.title ? `${t('agent_intent_preview_title')}: ${target.title}` : null,
        target?.dueDate !== undefined ? `${t('agent_intent_preview_due')}: ${target.dueDate ?? t('agent_intent_preview_none')}` : null,
        target?.notes ? `${t('agent_intent_preview_notes')}: ${target.notes}` : null,
      ].filter(Boolean).join('\n'),
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
  readonly serverWritePolicyMode?: 'auto' | 'ask' | 'off'
  readonly serverWriteExecution?: string
}

export interface ChatTurnOutcome {
  readonly content: string
  readonly reasoningStates: ReasoningProposalState[] | null
}

// Task 11b (silence the overlay), revised by task 20's Part A0: the ONE
// place that decides how a resolved conversational reply and a resolved
// (possibly null, possibly failed) overlay result combine into what the
// user actually sees. Extracted as a pure function -- independent of
// fetch/Supabase/React state -- so the decision logic is directly testable
// without rendering the full ChatPage component, mirroring how
// classifyMessageIntentSignal/getAmbiguousOfferHint are already tested as
// pure functions in this same file.
//
// Exactly THREE outcomes can add anything to what the user sees:
//   (a) a supported, actionable proposal -> the intent panel (unchanged UI)
//   (b) the task-9 ambiguous trailing offer -> one extra sentence
//   (c) task 20, A0: an 'unsupported' overlay for a message that ALSO looks
//       like a genuine, explicit write-shaped action request
//       (looksLikeExplicitActionRequest) -> one short, calm capability
//       statement. This is DELIBERATELY narrower than "intentSignal is
//       explicit and overlay is unsupported" -- that broader condition is
//       exactly task 11b's own original bug shape (a conversational
//       self-statement misclassified 'explicit' by a keyword collision,
//       reaching 'unsupported', becoming a nag) and would reproduce it
//       verbatim; requiring the extra verb-vocabulary match keeps that case
//       silent while still surfacing an honest answer for a real request
//       like "set a daily study task and two daily reminders."
// Everything else -- unsupported for a non-action-shaped message, a genuine
// ask_clarification, low confidence, conflicting domain evidence, a mixed
// request, an unparseable LLM response, or the overlay promise having
// failed/thrown/timed out -- surfaces NOTHING: no panel, no trailing note,
// no clarificationQuestion text. The conversational reply the default lane
// already produced is the whole story for all of those; see
// hasSupportedActionableOverlay above for the exhaustive type-level
// definition of "actionable."
export function resolveChatTurnOutcome(input: ChatTurnOverlayInput, t: Translate): ChatTurnOutcome {
  const overlayResult = input.overlayResult
  const serverTerminalWrite = input.serverWritePolicyMode === 'auto' || input.serverWritePolicyMode === 'off' || Boolean(input.serverWriteExecution)
  const hasGenuineOverlay = !serverTerminalWrite && overlayResult !== null && hasSupportedActionableOverlay(overlayResult)

  if (!hasGenuineOverlay && overlayResult !== null) {
    console.debug('[ChatPage] overlay suppressed (task 11b): not a supported, actionable proposal', {
      type: overlayResult.proposal.type,
      reasons: overlayResult.proposal.reasons,
    })
  }

  const offerHint = input.intentSignal === 'ambiguous' ? getAmbiguousOfferHint(input.message) : null
  const ambiguousTrailingNote = offerHint ? getAmbiguousOfferText(offerHint, input.responseLanguage) : null

  const isExplicitUnsupportedActionRequest =
    input.intentSignal === 'explicit' &&
    overlayResult !== null &&
    overlayResult.proposal.type === 'unsupported' &&
    looksLikeExplicitActionRequest(input.message)
  const capabilityTrailingNote = isExplicitUnsupportedActionRequest ? UNSUPPORTED_CAPABILITY_TEXT[input.responseLanguage] : null

  const trailingNote = ambiguousTrailingNote ?? capabilityTrailingNote

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
  compact = false,
}: Readonly<{
  proposal: ReasoningProposalState
  onRunReadOnly: () => void
  onReviewApproval: () => void
  onRunWrite: () => void
  compact?: boolean
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
    <div className={cn('chat-message-enter mb-3 rounded-xl border border-primary/20 bg-primary/[0.04]', compact ? 'p-2.5' : 'p-3')}>
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

// Task 17e, W1 (promoted into src/lib/bidiText.tsx by task 17f, R1): the
// bubble's own base direction is resolveMessageBaseDirection(content) --
// the SAME "first-strong character" heuristic `dir="auto"` itself uses
// (UAX#9 P2/P3), computed directly over the RAW message string, before any
// bdi-isolation. This is necessary because `dir="auto"`'s own native
// search explicitly SKIPS the contents of <bdi> descendants (see the HTML
// Standard's auto-directionality algorithm): a pure single-language
// message used to have ALL of its strong characters swallowed into <bdi>
// run(s) by isolateEmbeddedBidiRuns, leaving `dir="auto"` nothing to detect
// a direction from -- its fallback then inherited the ambient direction,
// which (with nothing else interrupting the chain) was this page's own
// `dir={isRTL ? 'rtl' : 'ltr'}` root, driven by the APP UI LANGUAGE, not
// the message's own content. Task 17f's rewrite of bidiText.tsx fixes this
// at its root (isolateEmbeddedBidiRuns no longer wraps a block's DOMINANT-
// script text at all, only genuinely minority-direction runs -- see that
// file's own header comment), which makes this explicit dir computation
// belt-and-suspenders rather than strictly load-bearing for every case --
// but it stays, since it is still the one guaranteed-correct anchor for
// the (now much rarer) case of a message with literally zero minority-
// direction content for `dir="auto"` to have needed in the first place,
// and it costs nothing to keep. Heading elements (h1-h6) aren't given any
// dir override at all by createDirectionalMarkdownComponents and aren't
// used in this reply surface today -- they simply inherit this same
// ambient direction normally, with no independent auto-detection of their
// own to go wrong.

export function ChatBubble({ role, content, language, compact = false, undo, onUndo }: Readonly<{
  role: 'user' | 'assistant'
  content: string
  language?: SupportedAiResponseLanguage
  compact?: boolean
  undo?: ChatMsg['undo']
  onUndo?: (undoId: string) => void
}>) {
  return (
    // Task 17g, Y2: the assistant avatar (icon-tile + Bot) that used to sit
    // here was removed -- turn identity is now carried entirely by
    // alignment + bubble colour (user = end-aligned + gradient/primary;
    // assistant = start-aligned + surface), matching the PO's explicit
    // decision. The empty-state greeting's OWN avatar (ChatEmptyState.tsx)
    // is untouched -- that one was called out as intentional (task 17d).
    <div className={cn('chat-message-enter flex', role === 'user' ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          // Task 17a, workstream 2 (reading layout): bubble line length
          // constrained on wide screens for readability. Task 17e, W2 /
          // 17g, Y2: below lg, user bubbles (no avatar to clear) use a
          // wide but not edge-to-edge 92%; assistant bubbles now use the
          // FULL column width (100%, task 17g removed the avatar gutter
          // this used to reserve -- the bubble starts flush at the column
          // edge). The 70ch reading-measure cap only applies at lg+, where
          // the column is wide (task 17g, Y3: the column itself is now
          // ALSO capped to a reading measure -- see this page's root
          // render below -- so this per-bubble cap and the column cap
          // never fight: 70ch is comfortably narrower than the column's
          // own max-w-3xl, so the bubble cap is always the binding one).
          role === 'user' ? 'max-w-[92%] lg:max-w-[70ch]' : 'max-w-full lg:max-w-[70ch]',
          'rounded-xl text-sm leading-relaxed break-words',
          compact ? 'px-3 py-1.5 text-[13px] leading-normal' : 'px-4 py-2.5',
          // Task 17g, Y1: the assistant bubble's decorative
          // `border border-border/40` outline is removed entirely --
          // separation from the page now comes from --chat-bubble-
          // assistant (backed by --flow-surface-2 in Dark Cosmic) against
          // the page's own background gradient alone, no outline needed.
          role === 'user'
            ? 'bg-chat-bubble-user text-chat-bubble-user-foreground rounded-br-sm'
            : 'bg-chat-bubble-assistant text-chat-bubble-assistant-foreground rounded-bl-sm'
        )}
        // Task 11e: base direction is decided per content block, not once
        // for the whole bubble from the resolved response language -- that
        // per-bubble language-based direction was the root cause of the
        // original production bug (it doesn't isolate embedded opposite-
        // direction runs). Task 17e, W1: that per-block direction is now
        // resolveMessageBaseDirection(content) -- an explicit rtl/ltr
        // computed from THIS message's own raw content -- rather than a
        // bare dir="auto", for the reason documented at length on
        // resolveMessageBaseDirection above: dir="auto"'s own browser-
        // native detection silently fails (and leaks the app UI language's
        // direction instead) for exactly the pure-single-language messages
        // this bubble renders most often.
        dir={resolveMessageBaseDirection(content)}
        lang={language}
      >
        {role === 'assistant'
          ? <AssistantContent content={content} />
          : <span className="whitespace-pre-wrap">{isolateEmbeddedBidiRuns(content)}</span>}
        {role === 'assistant' && undo && (
          <div className="mt-3">
            <Button type="button" size="sm" variant="outline" onClick={() => onUndo?.(undo.id)}>
              {undo.label}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// Task 17a, workstream 3 (functional micro-animation, not performative):
// "soft three-dot typing indicator in an assistant bubble" -- replaces
// the previous spinner+label. Three dots pulse in a staggered wave via
// .chat-typing-dot (index.css), transform/opacity only, and collapse to a
// static (still visible, non-animated) state under prefers-reduced-motion
// -- see that class's own definition for the full rationale.
// Task 17g, Y1/Y2: the typing indicator shares the assistant bubble's own
// visual chrome (same border/avatar treatment it used to have), so it gets
// the SAME two fixes for consistency -- a real reply and the "thinking"
// indicator now render identically borderless/avatar-less, matching Y1's
// design principle ("separation comes from --flow-surface-2 against the
// page gradient only") uniformly rather than leaving an inconsistent
// bordered-avatar'd exception for this one element.
function TypingIndicator({ label }: Readonly<{ label: string }>) {
  return (
    <div className="chat-message-enter flex justify-start">
      <div
        className="bg-chat-bubble-assistant text-chat-bubble-assistant-foreground rounded-xl rounded-bl-sm px-4 py-3 text-sm flex items-center gap-1.5"
        role="status"
        aria-label={label}
      >
        <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: '0ms' }} />
        <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: '160ms' }} />
        <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: '320ms' }} />
      </div>
    </div>
  )
}

export default function ChatPage() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const { tasks, isLoading: tasksLoading, error: tasksError } = useTasks()
  const workspace = useWorkspace()
  const { t, isRTL } = useT()
  const interfaceLanguage = useAppearance((state) => state.language)
  const location = useLocation()
  const nav = useNavigate()
  const { sessions, isLoading: sessionsLoading, refresh: refreshSessions, createSession, deleteSession } = useChatSessions()
  // Task 17a (Chat Experience v2): chat-page-scoped theme + compact-mode
  // preference, persisted alongside each other -- see
  // chatDisplayPreferencesStore.ts's own header comment for why this is a
  // dedicated, page-scoped store rather than reusing the app-wide
  // appearanceStore.ts. prefersReducedMotion gates the header's own
  // existing framer-motion fade-in (workstream 3's "reduced = instant, no
  // motion" requirement applied to this pre-existing animation too, not
  // just the new ones).
  const theme = useChatDisplayPreferences((state) => state.theme)
  const density = useChatDisplayPreferences((state) => state.density)
  const compact = density === 'compact'
  const prefersReducedMotion = useReducedMotion()

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // Task 19 (Attach file in Flow AI): attachedFile is the raw selection
  // (drives the composer's chip render immediately); attachedDocument is
  // set once the upload into the SAME documents bucket/table any other
  // document uses (documentsService.ts) has actually completed -- only a
  // real, persisted document's id is ever sent to the worker. memoryOffer
  // is the dismissible post-send affordance (scope item 4); it is entirely
  // separate from write persistence -- routing to it never itself writes
  // anything to personal memory.
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [attachedDocument, setAttachedDocument] = useState<Document | null>(null)
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [memoryOffer, setMemoryOffer] = useState<{ documentId: string; fileName: string } | null>(null)
  const [reasoningProposal, setReasoningProposal] = useState<ReasoningProposalState[] | null>(null)
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false)
  const [githubRepositoryInventory, setGithubRepositoryInventory] = useState<AgentReasoningGitHubInventory>({ status: 'unknown' })
  // Task 17a: replaces the old bottomRef/scrollIntoView sentinel -- the
  // scroll CONTAINER itself is now tracked (see the smart-scroll effect
  // near the render section below), so a reader who has scrolled up into
  // history is never yanked back down by a new message.
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const wasNearBottomRef = useRef(true)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [conversationsDrawerOpen, setConversationsDrawerOpen] = useState(false)
  // Task 17c, PO decisions D3/D4: the mobile bottom nav is gone on this
  // page (AppLayout.tsx), so this "More" sheet -- reusing MobileNav's own
  // NavItemsGrid/mainNavItems/moreNavItems -- is now the only way to reach
  // any other page from here.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
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
    wasNearBottomRef.current = true
    setShowJumpToLatest(false)
    // Task 17f, C1b: an explicit New Chat is a deliberate "start fresh"
    // action -- clear persistence too, so an accidental reload right after
    // (before anything is sent) doesn't drag back the PREVIOUS session.
    // Once something is actually sent, handleSend's own persistence effect
    // (below) takes back over with the new session's real id.
    persistActiveSessionId(null)
  }, [])

  // Task 17f, C1b: session continuity across a fresh mount. Production
  // evidence: pull-to-refresh inside the chat reloads the PWA (see this
  // page's root/scroll-container overscroll-behavior fix for the other
  // half of this bug) and the reload used to land on a brand-new EMPTY
  // chat -- root cause was that `activeSessionId` (above) had NO
  // persistence and NO restoration logic at all; every fresh mount simply
  // started at `null`. This effect runs the pure resolveActiveSessionOnMount
  // decision (activeSessionResolver.ts) exactly ONCE, as soon as
  // useChatSessions has finished its own first load (sessionsLoading
  // false) -- the `hasResolvedInitialSession` ref guard is load-bearing:
  // without it, this would re-fire and stomp the user's CURRENT session
  // every time `sessions` refreshes later (e.g. after sending a message
  // creates a new session, or after a title updates), which would silently
  // fight both "+" New Chat and drawer selection.
  const hasResolvedInitialSession = useRef(false)
  useEffect(() => {
    if (hasResolvedInitialSession.current || sessionsLoading) return
    hasResolvedInitialSession.current = true
    const resolution = resolveActiveSessionOnMount({
      persistedSessionId: readPersistedActiveSessionId(),
      sessions,
      explicitNewChat: false,
    })
    if (resolution.kind === 'resume') selectSession(resolution.sessionId)
  }, [sessionsLoading, sessions, selectSession])

  // Task 17f, C1b: keep persistence in sync with whichever session is
  // actually active, from WHATEVER path set it (drawer selection,
  // handleSend creating a new session, or the restoration effect above) --
  // one write site, not duplicated at each call site.
  useEffect(() => {
    persistActiveSessionId(activeSessionId)
  }, [activeSessionId])

  // Task 17a, workstream 2 (smart auto-scroll): "follow new messages ONLY
  // if the reader is already at bottom; otherwise show a 'jump to latest'
  // pill; never yank the scroll position while reading history." The
  // reader's bottom-proximity is tracked continuously by handleMessagesScroll
  // below (via the pure decision function in chatScrollDecision.ts) into
  // wasNearBottomRef, which this effect reads AFTER messages/sending has
  // already changed -- it reflects where the reader was an instant before
  // this update, since scroll events are independent of message updates.
  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current
    if (!el) return
    const nearBottom = shouldAutoScrollOnNewContent({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    })
    wasNearBottomRef.current = nearBottom
    if (nearBottom) setShowJumpToLatest(false)
  }, [])

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    wasNearBottomRef.current = true
    setShowJumpToLatest(false)
  }, [])

  useLayoutEffect(() => {
    if (wasNearBottomRef.current) {
      scrollToLatest(loading ? 'auto' : 'smooth')
    } else {
      setShowJumpToLatest(true)
    }
  }, [messages, sending, loading, scrollToLatest])

  // Task 19: validate, then upload into the SAME documents bucket/table any
  // other document uses (documentsService.ts) -- the attachment appears in
  // Documents afterwards, subject to the same RLS and hard-delete semantics,
  // exactly like scope item 2 requires. type is left NULL (untyped);
  // createDocument's own insert never sets it, so it defaults to null.
  // Extraction to personal memory is never triggered here (scope item 4 is
  // an offer only, routed to the EXISTING slice-2 flow).
  const handleAttachFile = useCallback(async (file: File) => {
    const validation = validateChatAttachment(file)
    // Task 19 quirk (this repo builds with tsconfig.app.json's strict:
    // false): `!validation.ok` fails to narrow this discriminated union at
    // all under strict:false (verified in isolation -- a real TS behavior,
    // not a typo), while an explicit `=== false` equality check narrows
    // correctly. Use the explicit form here for exactly that reason.
    if (validation.ok === false) {
      setAttachError(validation.reason === 'too_large' ? t('chat_attach_too_large') : t('chat_attach_unsupported_type'))
      return
    }
    if (!user) return
    setAttachError(null)
    setAttachedFile(file)
    setAttachBusy(true)
    try {
      const { storagePath, fileName } = await uploadToStorage(user.id, file)
      const document = await createDocument({
        storagePath,
        fileName,
        mimeType: file.type,
        sizeBytes: file.size,
      })
      setAttachedDocument(document)
    } catch (err) {
      console.error('[ChatPage] attachment upload failed:', err)
      setAttachError(t('chat_attach_upload_failed'))
      setAttachedFile(null)
    } finally {
      setAttachBusy(false)
    }
  }, [user, t])

  const handleRemoveAttachedFile = useCallback(() => {
    // The uploaded document itself is NOT deleted -- it is already a real,
    // persisted Document (per scope item 2, "hard-delete semantics" apply
    // the same way any other document's do, via the Documents page, not
    // implicitly from the composer). This only detaches it from the
    // in-progress chat turn.
    setAttachedFile(null)
    setAttachedDocument(null)
    setAttachError(null)
  }, [])

  // Task 19, scope item 4: the two extraction-capable mime types --
  // mirrors document-memory-extraction-endpoint.ts's own PDF/plain-text gate
  // exactly (isDocExtractable in DocumentsPage.tsx). An image attachment has
  // no extraction path, so the offer never appears for one.
  const isMemoryOfferEligible = (mimeType: string | null) =>
    mimeType === 'application/pdf' || mimeType === 'text/plain'

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
    // Task 19: captured once, at the moment of send -- the turn this
    // attachment applies to. Cleared from the composer below regardless of
    // outcome, so it is never silently re-sent on a later, unrelated turn.
    const sentDocument = attachedDocument

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
      const chatCallPromise = (async (): Promise<{ reply: string; writePolicy?: { mode?: 'auto' | 'ask' | 'off' }; writeExecution?: string; undo?: ChatMsg['undo'] }> => {
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
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            // Task 19: turn-scoped -- only ever the document attached to
            // THIS specific turn, never a stale reference from an earlier one.
            documentId: sentDocument?.id ?? null,
          }),
        })
        if (!res.ok) throw new Error(`Worker responded ${res.status}`)
        return (await res.json()) as { reply: string; writePolicy?: { mode?: 'auto' | 'ask' | 'off' }; writeExecution?: string; undo?: ChatMsg['undo'] }
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

      const [{ reply, writePolicy, writeExecution, undo }, overlayResult] = await Promise.all([chatCallPromise, overlayPromise])

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
        : resolveChatTurnOutcome({ intentSignal, message: text, responseLanguage, reply, overlayResult, serverWritePolicyMode: writePolicy?.mode, serverWriteExecution: writeExecution }, t)
      setReasoningProposal(outcome.reasoningStates)

      setMessages(prev => [
        ...prev,
        { id: `u-${Date.now()}`, role: 'user', content: text },
        { id: `a-${Date.now() + 1}`, role: 'assistant', content: outcome.content, language: responseLanguage, undo },
      ])

      // Task 19: the composer's attachment is turn-scoped -- always cleared
      // after a successful send, whether or not it was actually used. If it
      // was an extraction-capable document (PDF/plain-text), offer the
      // EXISTING slice-2 flow (scope item 4); an image attachment has no
      // extraction path, so no offer appears for one.
      if (sentDocument) {
        setAttachedFile(null)
        setAttachedDocument(null)
        setMemoryOffer(
          isMemoryOfferEligible(sentDocument.mimeType)
            ? { documentId: sentDocument.id, fileName: sentDocument.fileName }
            : null,
        )
      }

      void refreshSessions()
    } catch {
      setSendError(t('chat_error_send'))
      if (!overrideText) setDraft(text)
    } finally {
      setSending(false)
    }
  }, [draft, sending, workerUrl, t, activeSessionId, createSession, refreshSessions, interfaceLanguage, workspace, tasks, tasksLoading, tasksError, githubRepositoryInventory, attachedDocument])

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

  const handleUndo = useCallback(async (undoId: string) => {
    if (!activeSessionId || sending) return
    setSending(true)
    setSendError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session === null) throw new Error('No session')
      const res = await fetch(`${workerUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: 'Undo',
          undoId,
          session_id: activeSessionId,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      if (!res.ok) throw new Error(`Worker responded ${res.status}`)
      const { reply } = await res.json() as { reply: string }
      setMessages(prev => [
        ...prev.map(message => message.undo?.id === undoId ? { ...message, undo: undefined } : message),
        { id: `u-${Date.now()}`, role: 'user', content: 'Undo' },
        { id: `a-${Date.now() + 1}`, role: 'assistant', content: reply, language: getStoredAiResponseLanguage() === 'auto' ? undefined : getStoredAiResponseLanguage() },
      ])
      void refreshSessions()
    } catch {
      setSendError(t('chat_error_send'))
    } finally {
      setSending(false)
    }
  }, [activeSessionId, sending, workerUrl, refreshSessions, t])

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

  // Task 17b (conversation-first architecture): the ONE pure decision of
  // whether the empty state (welcome card + quick-action chips) is showing
  // -- replaces the two separate, slightly different ad-hoc conditions
  // task 17a used for its "quick actions" grid and "hero" card (the hero's
  // old condition never checked activeSessionId, a latent gap this also
  // closes). See emptyStateVisibility.ts.
  const isEmptyState = isChatEmptyState({
    hasActiveSession: activeSessionId !== null,
    messageCount: messages.length,
    isSending: sending,
  })

  // Task 17b architecture decision: a quick-action chip tap INSERTS its
  // starter prompt into the composer -- it does NOT auto-send (overrides
  // task 17a's original grid, which called handleSend(action.prompt)
  // directly). The user reviews/edits before sending, same as typing.
  const insertQuickActionPrompt = useCallback((prompt: string) => {
    setDraft(prompt)
  }, [])

  const handleDeleteSession = useCallback(async (id: string) => {
    const ok = await deleteSession(id)
    if (ok && activeSessionId === id) startNewChat()
  }, [deleteSession, activeSessionId, startNewChat])

  return (
    // Task 20c: `overscroll-contain` REMOVED from this root (it was task
    // 17f, C1a's outermost chat-tree link in the pull-to-refresh
    // suppression chain, alongside index.css's html/body -- both removed
    // together, since either one left in place would still block the
    // chain reaching the browser). This div is a plain non-scrolling flex
    // layout wrapper (`overflow-hidden`, kept for its own separate reason
    // -- task 17g, Y5's double-scrollbar fix), never itself the scrolled
    // element, so it never served the "prevent scroll-chaining while
    // reading" purpose the messages region and ConversationsDrawer still
    // need -- see this task's report for the full container-by-container
    // decision.
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      data-chat-theme={theme}
      data-chat-density={density}
      className="flex h-full flex-col overflow-hidden bg-background text-foreground lg:sticky lg:top-0 lg:h-screen"
    >
      {/* Header -- task 17c, PO decision D4, final single-row layout:
          [More menu] [Conversations] -- "Flow AI" -- [theme/density] [New].
          Extracted into its own component (ChatPageHeader.tsx) so it's
          independently testable without ChatPage's heavy hook dependencies.
          The explicit `dir` on this page's own root (above) is what makes
          this row -- and every other logical-property-positioned element on
          this page (the composer's send button, etc.) -- genuinely mirror
          under RTL: `dir="auto"` on individual text leaves (message bubbles)
          only ever resolved THEIR OWN content's direction, it never
          established an ambient `direction` for sibling/structural elements
          like a button positioned via `end-*`. Task 17c's E4 fix (see
          ChatComposer.test.tsx's own comment) and this header's mirroring
          both rely on that one root-level fix, not a scattered per-element
          one. */}
      <ChatPageHeader
        compact={compact}
        prefersReducedMotion={prefersReducedMotion}
        onOpenMoreMenu={() => setMoreMenuOpen(true)}
        onOpenConversations={() => setConversationsDrawerOpen(true)}
        onStartNewChat={startNewChat}
      />

      {/* Body: the chat column. Task 17f, B1 (PO decision): the persistent
          desktop Conversations panel that used to live here has been
          REMOVED entirely -- desktop now matches mobile, the conversation
          list lives ONLY in ConversationsDrawer (below), opened from the
          History icon in the header next to New Chat (see
          ChatPageHeader.tsx) -- one pattern, one code path, no
          desktop-only sidebar variant to keep in sync. Task 17f, B2: the
          chat column takes the freed width, but centres itself at lg+
          (`lg:mx-auto lg:max-w-3xl`) rather than stretching edge-to-edge
          on a wide desktop viewport -- 17e's own `lg:max-w-[70ch]` bubble
          cap (ChatBubble, this file) still governs individual message
          reading measure; this is a wider container width so bubbles have
          comfortable breathing room around them, not a second reading cap. */}
      <div className="flex min-h-0 flex-1">
        {/* Chat column */}
        <div className="relative flex min-w-0 flex-1 flex-col lg:mx-auto lg:max-w-3xl">
          {/* Task 17a, workstream 2: this is the ONLY scroll container for
              the conversation -- messages/quick-actions/proposals all live
              inside it, the composer below is a non-scrolling flex sibling
              that is therefore always visible without any sticky/fixed
              positioning trick. handleMessagesScroll feeds the smart
              auto-scroll decision (chatScrollDecision.ts). `overscroll-
              contain` here is KEPT by task 20c (unlike the page root and
              index.css's html/body, both un-contained by that task to
              restore the browser's native pull-to-refresh gesture): this
              is a genuinely scrollED element with its own independent
              reason to stay contained -- reaching the top/bottom of
              message history while reading must not chain into rubber-
              banding whatever sits behind it (the page root, which no
              longer stops that chain itself). That reading-scroll-chaining
              concern is separate from, and survives, 20c's gesture
              restoration. */}
          <div
            ref={messagesScrollRef}
            onScroll={handleMessagesScroll}
            className={cn('flex-1 overflow-y-auto overscroll-contain px-3 sm:px-6', compact ? 'space-y-2 py-3' : 'space-y-3 py-4')}
          >
            {/* Task 17b (conversation-first architecture): the mockup's
                lobby page, distilled into the empty-state of THIS chat
                surface -- welcome card + quick-action chips, animating out
                (17a's motion rules, reduced-motion honored) the instant the
                first message is sent, leaving nothing above the messages
                but the header. See ChatEmptyState.tsx for the welcome
                card/orb/chip implementation and emptyStateVisibility.ts for
                the isEmptyState decision. */}
            <AnimatePresence>
              {isEmptyState && (
                <motion.div
                  key="chat-empty-state"
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: prefersReducedMotion ? 0.01 : 0.18, ease: 'easeOut' }}
                >
                  <ChatEmptyState
                    greetingName={firstName}
                    theme={theme}
                    actions={QUICK_ACTIONS}
                    disabled={sending}
                    onSelectPrompt={insertQuickActionPrompt}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                {t('loading')}
              </div>
            )}

            {messages.map(msg => (
              <ChatBubble key={msg.id} role={msg.role} content={msg.content} language={msg.language} compact={compact} undo={msg.undo} onUndo={handleUndo} />
            ))}

            {sending && <TypingIndicator label={t('chat_typing')} />}

            {reasoningProposal?.map((proposal, index) => (
              <ReasoningProposalCard
                key={proposal.result.proposal.id}
                proposal={proposal}
                onRunReadOnly={() => handleRunReasoningProposal(index)}
                onReviewApproval={() => setApprovalDialogOpen(true)}
                onRunWrite={handleRunWriteProposal}
                compact={compact}
              />
            ))}
          </div>

          <JumpToLatestPill visible={showJumpToLatest} onClick={() => scrollToLatest('smooth')} />

          {/* Composer -- task 17a workstream 1. A non-scrolling flex
              sibling of the scroll region above, so it is ALWAYS visible
              within this column's own box with no sticky/fixed
              positioning needed; that box itself is kept correctly sized
              against the visible viewport (including under an open mobile
              keyboard) by AppLayout's h-[100dvh] mobile shell -- see that
              file and the task 17a report's viewport-strategy writeup. */}
          <div className="shrink-0 border-t border-border/60 bg-background/95">
            {sendError !== null && (
              <p className="px-3 pt-2 text-xs text-destructive sm:px-6">{sendError}</p>
            )}
            {/* Task 19, scope item 4: a plain, dismissible affordance, not a
                modal -- routes to the EXISTING slice-2 flow (document type
                selection + propose/confirm) on DocumentsPage; nothing is
                ever extracted or stored to memory from here. */}
            {memoryOffer && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs sm:px-6">
                <span className="min-w-0 truncate text-muted-foreground">{t('chat_attach_memory_offer')}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => {
                      const offer = memoryOffer
                      setMemoryOffer(null)
                      if (offer) nav('/documents', { state: { preselectDocumentId: offer.documentId } })
                    }}
                  >
                    {t('chat_attach_memory_offer_action')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setMemoryOffer(null)}
                  >
                    {t('chat_attach_memory_offer_dismiss')}
                  </Button>
                </div>
              </div>
            )}
            <ChatComposer
              value={draft}
              onChange={setDraft}
              onSend={() => void handleSend()}
              disabled={sending || loading}
              compact={compact}
              attachedFile={attachedFile}
              onAttachFile={(file) => void handleAttachFile(file)}
              onRemoveAttachedFile={handleRemoveAttachedFile}
              attachBusy={attachBusy}
              attachError={attachError}
            />
          </div>
        </div>
      </div>

      <ConversationsDrawer
        open={conversationsDrawerOpen}
        onOpenChange={setConversationsDrawerOpen}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={selectSession}
        onDelete={handleDeleteSession}
      />

      {/* "More" navigation -- task 17c D3/D4: reuses MobileNav's own sheet
          content (NavItemsGrid) with the FULL item set (mainNavItems +
          moreNavItems), since the bottom nav itself is absent on this page
          and this is the only remaining way to reach any other page. */}
      <Sheet open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
        <SheetContent side="bottom" className="h-auto rounded-t-2xl" aria-label={t('chat_open_more_menu')}>
          <NavItemsGrid
            items={[...mainNavItems, ...moreNavItems]}
            onNavigate={(path) => { setMoreMenuOpen(false); nav(path) }}
            isActive={(path) => location.pathname === path || location.pathname.startsWith(`${path}/`)}
          />
        </SheetContent>
      </Sheet>

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
