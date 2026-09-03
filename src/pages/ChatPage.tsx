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
import { shouldAutoRunReadOnlyOverlay } from '@/features/chat/autoReadOverlayGate'
import { isChatEmptyState } from '@/features/chat/emptyStateVisibility'
import { UNAVAILABLE_CAUSE, logUnavailableCause } from '@/features/chat/unavailableCause'
import { timeAgo } from '@/features/chat/timeAgo'
// Chat V2 Slice 1: deterministic FAST-vs-LEGACY routing -- see that
// module's own header for the rule and the downgrade-only safety invariant.
import { classifyChatV2Route, resolveChatV2IntentSignal, shouldStartReasoningOverlay } from '@/features/chat/chatV2Routing'
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
  PROVIDER_UNAVAILABLE_REASON_MARKER,
  MODEL_RESPONSE_INCOMPLETE_REASON_MARKER,
  ENGINEERING_TASK_NOT_PROPOSED_REASON_MARKER,
  reasonAboutUserMessage,
  resolveAgentReasoningTransport,
  resolveToolForStep,
  runReadOnlyTool,
  runWriteTool,
  requestWriteExecution,
  isAgentExecutionToolId,
  approveWorkspaceStep,
  withTimeout,
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
import { createEngineeringTaskClient } from '@/features/integrations/engineering/engineeringTaskClient'
import { createAgentToolExecutionClient } from '@/features/agent/agentToolExecutionClient'
import { pollEngineeringTaskUntilDone, formatEngineeringTaskResultMessage } from '@/features/agent/engineeringTaskStatusPoller'
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
import { findWriteIntentDescriptor, writeIntentRegistry } from '../../shared/writeIntentRegistry'
import { reportProposalOutcome, writeProposalTargetFields, type ProposalOutcomeDomain } from '@/features/agent/proposalOutcomeReporting'
import { formatDateTime } from '@/lib/date'

export interface ChatMsg {
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

// Chat V2 Slice 2A, BLOCKER A CORRECTION: an explicit, narrow state for
// whether the pre-approval requestWriteExecution() binding for a proposal
// has resolved -- deliberately NOT folded into approval.status (which only
// ever describes the user's own LOCAL decision, independent of whether the
// server has durably recorded anything yet) or runStatus (the actual write
// attempt). See isExecutionBindingReady below for the single gate every
// approval affordance (the one-click Confirm button, the Review dialog's
// own Approve button, the post-review Run button) is checked against.
//   'idle'            -- this proposal's tool has no server-execution
//                         binding requirement at all (github.*,
//                         engineering.task.propose, or a read-only
//                         proposal) -- always ready.
//   'requesting'       -- a binding IS required and the pre-approval
//                         request is still in flight -- NOT ready; this is
//                         the race window the correction closes.
//   'approval_pending' -- the durable row exists and is bound
//                         (approval.serverExecutionId is set) -- ready.
//   'succeeded'/'failed'/'uncertain' -- server policy independently
//                         resolved 'auto' and the write already concluded
//                         during the request call itself -- never ready;
//                         see executionRequestReply for what to show
//                         instead of an approval affordance.
type ExecutionRequestStatus = 'idle' | 'requesting' | 'approval_pending' | 'succeeded' | 'failed' | 'uncertain'

// Absent (undefined) is treated exactly like 'idle' -- every hand-built
// ReasoningProposalState in this file's own tests that predates this
// correction, and every proposal for a tool outside
// isAgentExecutionToolId, never needs to set this field at all.
function isExecutionBindingReady(status: ExecutionRequestStatus | undefined): boolean {
  return status === undefined || status === 'idle' || status === 'approval_pending'
}

interface ReasoningProposalState {
  result: AgentReasoningResult
  step: WorkspacePlanStep | null
  resolution: ToolResolutionResult | null
  approval: WorkspaceStepApproval | null
  runStatus: ReasoningRunStatus
  readOnlyResult?: ReadOnlyRuntimeResult
  writeResult?: WriteRuntimeResult
  // Chat V2 Slice 2A, BLOCKER 1/2 CORRECTION: generated ONCE, here, when the
  // proposal is first normalized -- never regenerated later. This is the
  // SAME id writeRuntime.ts's requestWriteExecution uses for its
  // pre-approval Worker request AND runWriteTool later uses for the actual
  // approved write, so both calls are provably the same logical attempt
  // (see writeRuntime.ts's own comments on why a handler-local
  // crypto.randomUUID() would defeat the Worker's own idempotency
  // guarantee). Read-only proposals carry one too, unused, for shape
  // simplicity -- harmless, since nothing reads it for a read.
  requestId: string
  // BLOCKER A CORRECTION: see ExecutionRequestStatus's own comment above.
  executionRequestStatus?: ExecutionRequestStatus
  // The Worker's own human-readable outcome text for a terminal auto-
  // resolved status (succeeded/failed/uncertain), or a bounded client-side
  // message when the pre-approval request itself could not be completed.
  // Absent otherwise -- see the pre-approval useEffect and
  // ReasoningProposalCard's own rendering of this.
  executionRequestReply?: string
}

// Chat V2 Slice 2B.2: when the Worker's deterministic decomposer resolves
// one message into two independent Task/Calendar actions (see
// agent/worker/index.ts's respondToTwoActionWrite), it returns `actions`
// instead of the usual singular reply/writePolicy/writeExecution/undo
// fields. Deliberately NOT routed through AgentReasoningResult/
// ReasoningProposalState/proposalsToStates: that whole pipeline is built
// around the CLIENT's own concurrent LLM reasoning overlay reconstructing a
// proposal's concrete arguments (see resolveChatTurnOutcome's own comment),
// which has no contract for two independent, non-mutually-exclusive
// proposals in one turn -- forcing a hand-built AgentReasoningResult
// through it would mean fabricating validator-shaped fields
// (AGENT_INTENT_SCHEMA_VERSION, promptPreview, etc.) the server never
// computed.
//
// Two kinds of action:
//  - 'resolved' -- already auto-executed or switched off server-side.
//    Needs no approval card at all, exactly like a single auto-executed
//    write today shows no ReasoningProposalCard, just a reply bubble with
//    an optional undo (see resolveChatTurnOutcome's serverTerminalWrite
//    branch). Rendered as its own assistant message.
//  - 'pending' -- CORRECTION 1: server policy resolved 'ask' for this
//    action (the PRIMARY production case -- INC-02 clamps every real
//    Task/Calendar write to 'ask'). The Worker already deterministically
//    parsed and confirmed this action's concrete toolId/arguments; this
//    client does NOT re-derive or re-guess them (never via the LLM
//    overlay). It calls the EXISTING agentToolExecutionClient.requestExecution()
//    with them (creating a durable approval_pending row, same as a single
//    action already does) and later, on explicit user approval,
//    approveExecution(executionId) -- for that action's own executionId
//    only. See TwoActionPendingState/buildTwoActionPendingStates below.
interface ChatWorkerActionResolved {
  kind: 'resolved'
  reply: string
  writePolicy: { domain: 'tasks' | 'calendar'; action: 'create' | 'update'; mode: 'auto' | 'off' }
  writeExecution?: 'executed' | 'failed' | 'provider_unavailable' | 'clarify' | 'not_found'
  undo?: ChatMsg['undo']
}

interface ChatWorkerActionPending {
  kind: 'pending'
  reply: string
  writePolicy: { domain: 'tasks' | 'calendar'; action: 'create'; mode: 'ask' }
  toolId: 'tasks.create' | 'calendar.create_event'
  requestId: string
  chatMessageId: string
  arguments: Record<string, unknown>
  previewText: string
}

type ChatWorkerAction = ChatWorkerActionResolved | ChatWorkerActionPending

// Stabilization patch 1 follow-up (Option B): the single-action sibling of
// ChatWorkerActionPending above -- same shape minus `reply` (this turn's
// top-level `reply` below already carries the ordinary conversational
// answer; this descriptor never carries a second one). Sent only for a
// single-action ask-mode tasks.create/calendar.create_event write whose
// intent the Worker could already fully resolve server-side (see
// agent/worker/index.ts's own comment at its construction site) --
// mutually exclusive with `actions` (2B.2's own, unrelated multi-action
// shape) in practice, never both set on the same response.
type ChatWorkerPendingAction = Omit<ChatWorkerActionPending, 'reply'>

interface ChatWorkerResponse {
  reply?: string
  writePolicy?: { mode?: 'auto' | 'ask' | 'off' }
  writeExecution?: string
  undo?: ChatMsg['undo']
  actions?: ChatWorkerAction[]
  pendingAction?: ChatWorkerPendingAction
}

// Pure builder for a decomposed multi-action turn's RESOLVED-only message
// list -- one user message plus one assistant message per already-resolved
// action, in the server's own order, each carrying its own independent
// undo. Pending actions are handled entirely separately (see
// buildTwoActionPendingStates) -- never mixed into this list, since they
// have no reply bubble of their own yet (their card IS the reply). `nowMs`
// is injected (never Date.now() internally) so this stays independently
// testable with deterministic, collision-free ids, matching this file's own
// existing convention (resolveChatTurnOutcome/proposalsToStates).
export function buildTwoActionMessages(
  userText: string,
  actions: ChatWorkerActionResolved[],
  responseLanguage: SupportedAiResponseLanguage,
  nowMs: number,
): ChatMsg[] {
  return [
    { id: `u-${nowMs}`, role: 'user', content: userText },
    ...actions.map((action, index) => ({
      id: `a-${nowMs + 1 + index}`,
      role: 'assistant' as const,
      content: action.reply,
      language: responseLanguage,
      undo: action.undo,
    })),
  ]
}

// Chat V2 Slice 2B.2 correction 1 -- one card's worth of state for a
// pending decomposed action. Deliberately a small, additive, standalone
// shape (not a ReasoningProposalState) -- see ChatWorkerActionPending's own
// comment for why. `status` mirrors agent_tool_executions' own lifecycle
// (approval_pending -> executing -> succeeded/failed/uncertain) plus two
// client-only transient states ('requesting' before the initial
// requestExecution() call resolves, 'approving' while approveExecution()
// is in flight) and one client-only failure state ('error', a network/auth
// failure talking to the Worker at all, never a domain outcome).
export type TwoActionPendingStatus = 'requesting' | 'approval_pending' | 'approving' | 'succeeded' | 'failed' | 'uncertain' | 'error'

export interface TwoActionPendingState {
  requestId: string
  toolId: 'tasks.create' | 'calendar.create_event'
  domain: 'tasks' | 'calendar'
  chatMessageId: string
  arguments: Record<string, unknown>
  previewText: string
  status: TwoActionPendingStatus
  executionId?: string
  resultReply?: string
  undo?: ChatMsg['undo']
}

// Pure: the initial render state for every pending action in one turn, in
// order, BEFORE any requestExecution() call has resolved. The caller
// (handleSend) is responsible for actually firing those calls and folding
// their results back in via applyTwoActionRequestResult.
export function buildTwoActionPendingStates(actions: Array<Omit<ChatWorkerActionPending, 'reply'>>): TwoActionPendingState[] {
  return actions.map((action) => ({
    requestId: action.requestId,
    toolId: action.toolId,
    domain: action.writePolicy.domain,
    chatMessageId: action.chatMessageId,
    arguments: action.arguments,
    previewText: action.previewText,
    status: 'requesting',
  }))
}

// Pure state transition for one action's requestExecution() outcome.
// Matches by requestId ONLY -- every other entry in `prev` (in particular
// the sibling action) is returned completely unchanged, which is what
// guarantees one action's own request/approve flow can never leak into
// another's rendered state.
export function applyTwoActionRequestResult(
  prev: TwoActionPendingState[],
  requestId: string,
  result:
    | { status: 'approval_pending'; executionId: string }
    | { status: 'succeeded' | 'failed' | 'uncertain'; executionId?: string; reply?: string }
    | { status: 'error' },
): TwoActionPendingState[] {
  return prev.map((entry) => {
    if (entry.requestId !== requestId) return entry
    if (result.status === 'error') return { ...entry, status: 'error' }
    return {
      ...entry,
      status: result.status,
      executionId: 'executionId' in result ? result.executionId : entry.executionId,
      resultReply: 'reply' in result ? result.reply : entry.resultReply,
    }
  })
}

// Pure state transition for one action's approveExecution() outcome --
// same requestId-only matching discipline as applyTwoActionRequestResult.
// Approving action A calling this with A's own requestId can structurally
// never touch B's entry.
export function applyTwoActionApproveResult(
  prev: TwoActionPendingState[],
  requestId: string,
  result:
    | { status: 'succeeded' | 'failed' | 'uncertain'; reply: string; undo?: ChatMsg['undo'] }
    | { status: 'error' }
    | { status: 'approving' },
): TwoActionPendingState[] {
  return prev.map((entry) => {
    if (entry.requestId !== requestId) return entry
    if (result.status === 'approving' || result.status === 'error') return { ...entry, status: result.status }
    return { ...entry, status: result.status, resultReply: result.reply, undo: result.undo }
  })
}

// CORRECTION 2, BLOCKER 1: the pending card previously showed only
// pending.previewText (effectively just the title) -- not enough for the
// user to approve consequential facts (a scheduled time, a due date) sight
// unseen. This reads ONLY `pending.toolId`/`pending.arguments` -- the exact
// same, already server-confirmed object this action's own requestExecution()
// call sends -- never re-parses the original message and never re-runs an
// LLM. Pure and per-entry, so it structurally cannot mix in a sibling
// action's fields (there is no sibling in scope here at all). dueDate is a
// date-only string (flow-write-policy.ts's ParsedTaskWriteIntent.dueDate)
// -- shown VERBATIM, never through `new Date(dueDate)` (CORRECTION 4:
// Date-parsing a date-only ISO string drops the year via
// toLocaleDateString's {month,day} formatting and can shift the displayed
// calendar day in timezones west of UTC -- both wrong at an approval
// boundary, where the user must see the exact value that will execute; the
// existing single-action create_task preview already displays dueDate
// this same verbatim way). dateTimeStart/dateTimeEnd are UTC ISO instants
// (zonedDateTimeToUtcIso in respondToTwoActionWrite) -- formatDateTime
// (src/lib/date.ts) is the same helper TasksPage/other approval previews
// already use for this exact display purpose, reused here rather than
// re-implemented.
//
// CORRECTION 3: the "Title" line is derived ONLY from
// pending.arguments.title, the immutable execution argument -- never
// pending.previewText (a separate, display-only, possibly-clause-fallback
// value; see twoActionFallbackPreview in index.ts). The Worker now never
// returns a pending descriptor with an empty arguments.title (see
// respondToTwoActionWrite's own CORRECTION 3 bail), so in practice this is
// always present here -- but this function does not fall back to
// previewText even defensively, since doing so would mislabel a
// display-only fallback as the exact value that will be submitted.
export function twoActionPendingPreviewLines(pending: TwoActionPendingState, t: Translate): string[] {
  const title = pending.arguments.title as string | undefined
  const notes = pending.arguments.notes as string | undefined
  if (pending.toolId === 'tasks.create') {
    const dueDate = pending.arguments.dueDate as string | null | undefined
    // Stabilization patch 1, FIX A2: shown VERBATIM, same discipline as
    // dueDate above -- a consequential, immutable execution argument that
    // must be visible before approval.
    const timeOfDay = pending.arguments.timeOfDay as string | undefined
    return [
      title ? `${t('agent_intent_preview_title')}: ${title}` : null,
      dueDate ? `${t('agent_intent_preview_due')}: ${dueDate}` : null,
      timeOfDay ? `${t('family_reminder')}: ${timeOfDay}` : null,
      notes ? `${t('agent_intent_preview_notes')}: ${notes}` : null,
    ].filter((line): line is string => Boolean(line))
  }
  const dateTimeStart = pending.arguments.dateTimeStart as string | undefined
  const dateTimeEnd = pending.arguments.dateTimeEnd as string | undefined
  return [
    title ? `${t('agent_intent_preview_title')}: ${title}` : null,
    dateTimeStart ? `${t('agent_intent_preview_start')}: ${formatDateTime(dateTimeStart)}` : null,
    dateTimeEnd ? `${t('agent_intent_preview_end')}: ${formatDateTime(dateTimeEnd)}` : null,
    notes ? `${t('agent_intent_preview_notes')}: ${notes}` : null,
  ].filter((line): line is string => Boolean(line))
}

// Task 40: WorkspacePlanStep['domain'] is broader (habits/documents/
// learning/workspace) than the proposal-outcome ledger's own domain CHECK
// constraint (tasks/calendar/finance/github) -- a write proposal's step
// never actually resolves to the broader values (stepForReasoning below
// only ever derives tasks/calendar/finance/github for a write-capable
// proposal), but this guard makes that assumption explicit and safe rather
// than asserting it.
const PROPOSAL_OUTCOME_DOMAINS = new Set<string>(['tasks', 'calendar', 'finance', 'github'])
function isProposalOutcomeDomain(domain: string): domain is ProposalOutcomeDomain {
  return PROPOSAL_OUTCOME_DOMAINS.has(domain)
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
// Task 23: the four task/calendar write types come from the shared
// registry instead of being listed here a second time.
const WRITE_PROPOSAL_TYPES = new Set<AgentReasoningResult['proposal']['type']>([
  'complete_task',
  ...writeIntentRegistry.map((entry) => entry.intentType),
  'write_github_issue_comment',
  'write_github_issue_update',
  'propose_engineering_task',
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
    case 'create_calendar_event':
    case 'update_calendar_event':
    case 'create_finance_transaction':
    case 'write_github_issue_comment':
    case 'write_github_issue_update':
    case 'propose_engineering_task':
      return true
    case 'ask_clarification':
    case 'unsupported':
      return false
    // Task 45c, ADR-0017: import_bank_statement is registered in
    // shared/writeIntentRegistry.ts (for its undo-kind/domain/write-runtime
    // metadata, not so it becomes a real chat proposal) -- intentValidator.ts's
    // own explicit guard already converts any occurrence of this type to
    // 'unsupported' before a proposal reaches ChatPage at all, so this case
    // is unreachable in practice. It is still grouped with ask_clarification/
    // unsupported here (never actionable), not with the real write types
    // above, as a second, independent layer -- exactly the compile-time
    // safety net this function's own header comment describes.
    case 'import_bank_statement':
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
    // Task 23/28: the task/calendar/finance write title keys come from the shared registry.
    case 'create_task':
    case 'update_task':
    case 'create_calendar_event':
    case 'update_calendar_event':
    case 'create_finance_transaction':
      return findWriteIntentDescriptor(type)!.i18n.titleKey as TranslationKey
    case 'write_github_issue_comment':
      return 'agent_intent_title_write_github_issue_comment'
    case 'write_github_issue_update':
      return 'agent_intent_title_write_github_issue_update'
    case 'propose_engineering_task':
      return 'agent_intent_title_propose_engineering_task'
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
  // Task 23: a single registry lookup replaces the per-type task/calendar
  // branches below (domain, actionType, targetId, description) -- undefined
  // for every non-task/calendar proposal type, so each ternary chain falls
  // through to its original non-write branches unchanged.
  const writeEntry = findWriteIntentDescriptor(proposal.type)
  const domain =
    proposal.type === 'inspect_github_repositories' ||
    proposal.type === 'inspect_github_issues' ||
    proposal.type === 'inspect_github_epics' ||
    proposal.type === 'inspect_github_pull_requests' ||
    proposal.type === 'inspect_github_workflow_runs' ||
    isGithubIssueWrite ||
    proposal.type === 'propose_engineering_task'
      ? 'github'
      : proposal.type === 'inspect_workspace'
      ? 'workspace'
      : proposal.type === 'inspect_calendar' || writeEntry?.domain === 'calendar'
      ? 'calendar'
      : writeEntry?.domain === 'finance'
      ? 'finance'
      : proposal.type === 'inspect_learning'
        ? 'learning'
        : 'tasks'
  const actionType = proposal.type === 'complete_task'
    ? 'complete'
    : writeEntry
      ? writeEntry.action
      : proposal.type === 'write_github_issue_comment'
          ? 'create'
          : proposal.type === 'write_github_issue_update'
            ? 'update'
            : proposal.type === 'propose_engineering_task'
              ? 'create'
              : readIntentAction[proposal.type] ?? 'inspect'
  const githubIssueTargetId = isGithubIssueWrite && proposal.target?.repo && proposal.target?.issueNumber
    ? `${proposal.target.repo}#${proposal.target.issueNumber}`
    : undefined
  const stepId = `reasoning-step:${proposal.id}`
  // Task 30: a CREATE write entry (create_task/create_calendar_event/
  // create_finance_transaction) has no existing record to target, so it has
  // no targetIdField and used to fall all the way through to
  // githubIssueTargetId (undefined for non-github types), leaving
  // step.targetId undefined. approvalForReasoningStep already assumes
  // step.id doubles as the target identity for a not-yet-existing create
  // (`targetId: isCreate ? step.id : step.targetId!`) -- but writeRuntime's
  // validateApprovalBoundary requires step.targetId to be truthy AND equal
  // approval.targetId for EVERY write tool, creates included, so every
  // create write's own step/approval pair failed that check and runWriteTool
  // returned approval_required even after an explicit approve. This was
  // invisible for create_task/create_calendar_event (defaultFlowWritePermissionMode
  // is "auto" for both, so the Worker executes them directly and this
  // frontend run-write path is only reached if a user overrides their
  // permission to "ask") but is the ONLY path finance ever takes
  // (defaultFlowWritePermissionMode hard-clamps finance to "ask" -- see
  // flowWritePermissions.ts), so it surfaced there first. Fixed at the
  // source: step.targetId now equals step.id for every CREATE write entry,
  // exactly what approvalForReasoningStep already assumed.
  const targetId = proposal.type === 'complete_task'
    ? proposal.target?.taskId
    : writeEntry?.targetIdField
      ? proposal.target?.[writeEntry.targetIdField]
      : writeEntry?.action === 'create' || proposal.type === 'propose_engineering_task'
        ? stepId
        : githubIssueTargetId

  return {
    id: stepId,
    order: 1,
    title: intentTitle(proposal.type, t),
    description: proposal.type === 'complete_task'
      ? t('agent_intent_complete_description', { title: proposal.target?.taskTitleHint ?? t('agent_intent_selected_task') })
      : writeEntry
        ? t(writeEntry.i18n.descriptionKey as TranslationKey, { title: writeEntry.descriptionTitle(proposal.target as Record<string, unknown> | undefined) })
        : proposal.type === 'write_github_issue_comment'
            ? t('agent_intent_comment_description', { targetId: githubIssueTargetId ?? '' })
            : proposal.type === 'write_github_issue_update'
              ? t('agent_intent_update_description', { targetId: githubIssueTargetId ?? '' })
              : proposal.type === 'propose_engineering_task'
                ? t('agent_intent_propose_engineering_task_description', { repo: proposal.target?.repo ?? '' })
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

  // Task 23: create_task/update_task/create_calendar_event/
  // update_calendar_event -- previously four near-identical blocks -- now
  // read their tool id/approval reason key/reversible/dataDomains/preview
  // construction from the shared registry. Guard conditions, targetId
  // (step.id for create, step.targetId for update), and the ported
  // per-field preview-line logic are unchanged.
  const writeEntry = findWriteIntentDescriptor(proposal.type)
  if (writeEntry) {
    const target = proposal.target as Record<string, unknown> | undefined
    const isCreate = writeEntry.action === 'create'
    if (resolution.toolId !== writeEntry.toolId) return null
    if (isCreate) {
      const missingRequiredField = writeEntry.createRequiredTargetFields?.some((field) => !target?.[field])
      if (missingRequiredField) return null
    } else if (!step.targetId) {
      return null
    }
    const previewLabels = {
      title: t('agent_intent_preview_title'),
      due: t('agent_intent_preview_due'),
      notes: t('agent_intent_preview_notes'),
      start: t('agent_intent_preview_start'),
      end: t('agent_intent_preview_end'),
      none: t('agent_intent_preview_none'),
      amount: t('agent_intent_preview_amount'),
      direction: t('agent_intent_preview_direction'),
      date: t('agent_intent_preview_date'),
      category: t('agent_intent_preview_category'),
      description: t('agent_intent_preview_description'),
      iban: t('agent_intent_preview_iban'),
      // Stabilization patch 1, FIX A2: reuses the existing "Reminder"
      // translation rather than adding a new i18n key.
      reminder: t('family_reminder'),
    }
    return {
      stepId: step.id,
      targetId: isCreate ? step.id : step.targetId!,
      toolId: writeEntry.toolId,
      toolName: tool?.name,
      toolDescription: tool?.description,
      toolCapability: tool?.capability,
      toolMode: tool?.mode,
      status: 'pending',
      requiresApproval: true,
      approvalReason: t(writeEntry.i18n.approvalReasonKey as TranslationKey),
      // Was hardcoded 'medium', matching tasks.create/update and
      // calendar.create_event/update_event's own registered riskLevel by
      // coincidence -- silently wrong for create_finance_transaction, whose
      // tool is registered "high" (financeTools.ts), which made
      // validateApprovalBoundary's compareRiskLevels(approval.riskLevel,
      // tool.riskLevel) reject every approved finance approval as
      // insufficient. Now reads the actually resolved tool's own riskLevel,
      // same source expectedCapabilityForToolId already trusts.
      riskLevel: tool?.riskLevel ?? 'medium',
      reversible: writeEntry.reversible,
      externalEffect: true,
      dataDomains: [writeEntry.domain],
      approvalScope: 'single_step',
      previewText: writeEntry.previewLines(target, previewLabels).filter(Boolean).join('\n'),
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

// candidateIndex: distinguishes multiple disambiguation candidates that
// share the same underlying proposal.id (proposalsToStates below) so each
// gets its own stable requestId -- see ReasoningProposalState.requestId's
// own comment on why this must be deterministic (never crypto.randomUUID(),
// which would break byte-identical-output tests like proposalsToStates'
// own "built the same way a standalone proposal would be" check below) AND
// collision-free across candidates (a shared requestId across two
// DIFFERENT proposed actions would make the second candidate's pre-approval
// Worker request fail closed as a request-id substitution attempt -- see
// this slice's own BLOCKER 2 correction).
export function proposalToState(result: AgentReasoningResult, t: Translate, candidateIndex = 0): ReasoningProposalState {
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
  // BLOCKER A CORRECTION: computed synchronously here, from the resolved
  // toolId alone -- never from anything the pre-approval network call
  // returns -- so a proposal for one of the five server-execution-backed
  // tools starts life already in the non-approvable 'requesting' state on
  // its very first render, before the pre-approval useEffect has even had
  // a chance to run once. This is what closes the race entirely: there is
  // no window, however small, where such a proposal is approvable before
  // the binding effect has fired.
  const requiresServerExecutionBinding = Boolean(
    approval && resolution?.resolved && resolution.toolId && isAgentExecutionToolId(resolution.toolId)
  )
  return {
    result,
    step,
    resolution,
    approval,
    runStatus: result.proposal.requiresApproval ? 'approval_required' : 'idle',
    requestId: `agent-exec:${result.proposal.id}:${candidateIndex}`,
    executionRequestStatus: requiresServerExecutionBinding ? 'requesting' : 'idle',
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
    return candidates.map((candidate, index) => proposalToState(candidate, t, index))
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
  // Stabilization patch 1 follow-up (Option B): true when this turn's
  // Worker response already carried a server-resolved pendingAction (see
  // ChatWorkerPendingAction above) -- that descriptor is authoritative and
  // already rendered via its own card (handleSend's own pendingAction
  // branch), so the overlay's own competing, history-blind reconstruction
  // of the SAME intent must never also surface here. Same suppression
  // mechanism serverWritePolicyMode==='auto'/'off' already use below
  // (hasGenuineOverlay), just one more true-making condition -- reasoning
  // itself is never globally disabled, only this one turn's write card.
  readonly hasServerPendingAction?: boolean
}

export interface ChatTurnOutcome {
  readonly content: string
  readonly reasoningStates: ReasoningProposalState[] | null
}

// Task 11b (silence the overlay), revised by task 20's Part A0 and task 42's
// Part A: the ONE place that decides how a resolved conversational reply and
// a resolved (possibly null, possibly failed) overlay result combine into
// what the user actually sees. Extracted as a pure function -- independent
// of fetch/Supabase/React state -- so the decision logic is directly
// testable without rendering the full ChatPage component, mirroring how
// classifyMessageIntentSignal/getAmbiguousOfferHint are already tested as
// pure functions in this same file.
//
// Exactly FOUR outcomes can add anything to what the user sees:
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
//   (d) task 42, Part A: a SERVER-CONFIRMED write trigger
//       (serverWritePolicyMode === 'ask' -- the Worker's own independent,
//       deterministic parse, not this overlay, already recognized a genuine
//       task/calendar/finance write request in this message) whose overlay
//       resolved to ask_clarification -> the clarificationQuestion text,
//       still no panel (ask_clarification names no concrete tool to attach
//       one to). Task 41-verify traced a real production case (a finance
//       message whose direction couldn't be determined) that reached
//       exactly this state and was silently dropped, leaving only the
//       conversational lane's own false completion promise -- see that
//       report. This is deliberately narrower than "any ask_clarification":
//       an overlay THAT ALONE decided a plain, non-domain-confirmed message
//       needed clarification (task 11b's original silencing target) stays
//       silent -- only a server-confirmed write request that is missing one
//       field gets to speak.
// Everything else -- unsupported for a non-action-shaped message, an
// ask_clarification with no server-confirmed write trigger, low confidence,
// conflicting domain evidence, a mixed request, an unparseable LLM response,
// or the overlay promise having failed/thrown/timed out -- surfaces
// NOTHING: no panel, no trailing note, no clarificationQuestion text. The
// conversational reply the default lane already produced is the whole story
// for all of those; see hasSupportedActionableOverlay above for the
// exhaustive type-level definition of "actionable."
//
// KNOWN DEAD END (task 42, reported per that task's own instruction, not
// fixed here): if the user answers this surfaced clarification in their
// NEXT message ("expense" / "هزینه"), that reply alone will not resolve
// anything. reasonAboutUserMessage/buildReasoningPrompt carries no prior
// chat turns at all (only safeContext + the single current userMessage), so
// the follow-up is reasoned about with zero memory of the amount/category
// from the turn that prompted the question -- it will most likely produce
// its OWN ask_clarification (this time for the missing amount), which this
// same branch surfaces again, looking like a loop rather than progress.
// Multi-turn intent completion (giving the overlay access to recent turns)
// is separate, larger work, out of this task's scope.
export function resolveChatTurnOutcome(input: ChatTurnOverlayInput, t: Translate): ChatTurnOutcome {
  const overlayResult = input.overlayResult
  const serverTerminalWrite = input.serverWritePolicyMode === 'auto' || input.serverWritePolicyMode === 'off' || Boolean(input.serverWriteExecution) || Boolean(input.hasServerPendingAction)
  const hasGenuineOverlay = !serverTerminalWrite && overlayResult !== null && hasSupportedActionableOverlay(overlayResult)

  // Task 42, Part A: see outcome (d) above. Gated on the SERVER's own
  // write-trigger confirmation, never on the overlay's own opinion alone --
  // that is what keeps this from reintroducing task 11b's original bug
  // (a plain conversational message the overlay alone misreads as needing
  // clarification must stay silent).
  const isServerConfirmedClarification =
    input.serverWritePolicyMode === 'ask' &&
    overlayResult !== null &&
    overlayResult.proposal.type === 'ask_clarification' &&
    Boolean(overlayResult.proposal.clarificationQuestion)
  const clarificationTrailingNote = isServerConfirmedClarification ? overlayResult!.proposal.clarificationQuestion! : null

  if (!hasGenuineOverlay && overlayResult !== null) {
    console.debug(
      isServerConfirmedClarification
        ? '[ChatPage] overlay ask_clarification surfaced as text only (task 42): server-confirmed write trigger, no panel (no concrete tool)'
        : '[ChatPage] overlay suppressed (task 11b): not a supported, actionable proposal',
      {
        type: overlayResult.proposal.type,
        reasons: overlayResult.proposal.reasons,
      },
    )
  }

  const offerHint = input.intentSignal === 'ambiguous' ? getAmbiguousOfferHint(input.message) : null
  const ambiguousTrailingNote = offerHint ? getAmbiguousOfferText(offerHint, input.responseLanguage) : null

  // INC-01 follow-up review: providerUnavailableProposal (reasoningOrchestrator.ts)
  // reuses type 'unsupported' for a provider outage -- so without this
  // check, isExplicitUnsupportedActionRequest below would show it the
  // GENERIC "I can't do that" capability text (wrong: implies the action
  // itself is unsupported, not that the AI briefly couldn't be reached),
  // and outside that narrow gate it would be silently dropped entirely.
  // PROVIDER_UNAVAILABLE_REASON_MARKER is the exact, stable string that
  // tells the two apart -- checked here, unconditionally (never gated on
  // looksLikeExplicitActionRequest/intentSignal the way the generic
  // capability note is), since a provider outage is worth telling the
  // user about regardless of how their message was phrased.
  const isProviderUnavailableOverlay =
    !serverTerminalWrite &&
    overlayResult !== null &&
    overlayResult.proposal.type === 'unsupported' &&
    overlayResult.proposal.reasons.includes(PROVIDER_UNAVAILABLE_REASON_MARKER)
  // ENG-06f: see the chat-lane tag in handleSend -- same purpose, other
  // lane. Logged here rather than at the orchestrator's own short-circuit
  // because this is the point where the outcome actually reaches the
  // user; an overlay result that gets suppressed upstream never produced
  // a user-visible "unavailable" at all and should not be counted as one.
  if (isProviderUnavailableOverlay) {
    logUnavailableCause(UNAVAILABLE_CAUSE.OVERLAY_PROVIDER_UNAVAILABLE, {
      intentSignal: input.intentSignal,
      responseLanguage: input.responseLanguage,
    })
  }
  const providerUnavailableTrailingNote = isProviderUnavailableOverlay
    ? (overlayResult!.proposal.clarificationQuestion ?? null)
    : null

  // ENG-06d: the truncation sibling of isProviderUnavailableOverlay above.
  // modelResponseIncompleteProposal also reuses type 'unsupported', so
  // without this check it would hit the same two wrong fates that comment
  // describes -- the generic "I can't do that" capability text inside the
  // narrow explicit-request gate, and silent suppression outside it. Like
  // the provider-unavailable check (and unlike the capability note) it is
  // unconditional: a truncated proposal is worth telling the user about
  // however they phrased their message, since the phrasing is not what
  // went wrong.
  const isModelResponseIncompleteOverlay =
    !serverTerminalWrite &&
    overlayResult !== null &&
    overlayResult.proposal.type === 'unsupported' &&
    overlayResult.proposal.reasons.includes(MODEL_RESPONSE_INCOMPLETE_REASON_MARKER)
  // ENG-06f: ENG-06d's truncation outcome, tagged from the same place so
  // one grep enumerates every "user asked for a proposal and did not get
  // one" outcome, not just the unavailable-shaped subset.
  if (isModelResponseIncompleteOverlay) {
    logUnavailableCause(UNAVAILABLE_CAUSE.OVERLAY_MODEL_RESPONSE_INCOMPLETE, {
      intentSignal: input.intentSignal,
      responseLanguage: input.responseLanguage,
    })
  }
  const modelResponseIncompleteTrailingNote = isModelResponseIncompleteOverlay
    ? (overlayResult!.proposal.clarificationQuestion ?? null)
    : null

  const isExplicitUnsupportedActionRequest =
    !serverTerminalWrite &&
    !input.serverWritePolicyMode &&
    input.intentSignal === 'explicit' &&
    overlayResult !== null &&
    overlayResult.proposal.type === 'unsupported' &&
    !overlayResult.proposal.reasons.includes(PROVIDER_UNAVAILABLE_REASON_MARKER) &&
    // ENG-06d: same exclusion as the line above, for the same reason -- a
    // truncated proposal must never be reported as "I can't do that",
    // which would tell the user their request is unsupported when the
    // model was in fact mid-way through supporting it.
    !overlayResult.proposal.reasons.includes(MODEL_RESPONSE_INCOMPLETE_REASON_MARKER) &&
    looksLikeExplicitActionRequest(input.message)
  const capabilityTrailingNote = isExplicitUnsupportedActionRequest ? UNSUPPORTED_CAPABILITY_TEXT[input.responseLanguage] : null

  // ENG-06g: the one ask_clarification that surfaces WITHOUT the
  // server-confirmed write trigger isServerConfirmedClarification
  // requires. That gate (task 42) exists to stop the overlay inventing a
  // question about ordinary small talk; it does not apply here, because
  // this outcome only exists when the MODEL returned a real repo plus a
  // real instruction and merely hedged on the type
  // (intentValidator.ts's ENGINEERING_TASK_CONFIRMATION branch).
  // Surfacing it is the point of the fix: without this line the change
  // would swap a false "Flow AI can't do that" for total silence, which
  // is not more honest to someone waiting on an approval card -- it just
  // moves the failure somewhere the user cannot see it.
  const isEngineeringTaskNotProposed =
    !serverTerminalWrite &&
    overlayResult !== null &&
    overlayResult.proposal.type === 'ask_clarification' &&
    overlayResult.proposal.reasons.includes(ENGINEERING_TASK_NOT_PROPOSED_REASON_MARKER) &&
    Boolean(overlayResult.proposal.clarificationQuestion)
  const engineeringTaskNotProposedNote = isEngineeringTaskNotProposed
    ? overlayResult!.proposal.clarificationQuestion!
    : null

  // Ordered ahead of capabilityTrailingNote deliberately: when both could
  // apply, the question is the true statement and the denial is the false
  // one. (In practice they are mutually exclusive -- the capability note
  // requires type 'unsupported' and this requires 'ask_clarification' --
  // but the ordering documents the intent if that ever changes.)
  const trailingNote = ambiguousTrailingNote ?? providerUnavailableTrailingNote ?? modelResponseIncompleteTrailingNote ?? engineeringTaskNotProposedNote ?? capabilityTrailingNote ?? clarificationTrailingNote

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

// GH-06: chatCallPromise's own fetch is now wrapped in withTimeout
// (CHAT_REQUEST_TIMEOUT_MS) instead of being unbounded -- see handleSend's
// try/catch. This is the exact rejection shape withTimeout
// (executionEngine.ts) produces on a timeout; nothing else handleSend
// awaits can produce this same { code: "TIMEOUT" } shape as an escaping
// rejection (executeAgentTool/runReadOnlyTool already catch their own
// handler-timeout internally and return a normal, non-throwing result --
// see readOnlyRuntime.ts -- and overlayPromise never rejects at all, by
// its own explicit .catch(() => null)), so checking the code alone is
// sufficient to identify "the primary /chat reply timed out" specifically,
// without also matching an ordinary network/HTTP failure from the same
// call, which keeps the pre-existing setSendError + restore-draft path.
//
// ENG-06f: 15_000 -> 25_000, derived from measurement (ENG-06e,
// 2026-08-26T21:50Z) rather than chosen as a round number.
//
// Observed plain-chat wall times on three consecutive real turns:
// 14 071 / 13 649 / 11 458 ms. The worst sat at 94% of the old 15 000 ms
// ceiling -- so an ordinary turn was one slow second away from being
// reported to the user as a failure. That is the SAME inversion ENG-06
// fixed on the reasoning lane, relocated: the lane doing the work no
// longer had room to finish it.
//
// The number is anchored to the reasoning lane's own proven-good margin.
// REASONING_FETCH_TIMEOUT_MS is 20 000 ms against an observed max of
// 12 297 ms -- a 1.63x factor, 7 703 ms of absolute headroom. Applying
// each of those to chat's observed max of 14 071 ms gives 22 879 ms
// (same ratio) and 21 774 ms (same absolute headroom). 25 000 clears
// both, at 1.78x observed max.
//
// The extra margin over the two derivations is itself measured, not
// padding: the SAME lane returned 5 001 ms in the ENG-06c capture
// (19:26Z) and 14 071 ms in ENG-06e (21:50Z) -- a 2.8x swing on
// comparable traffic about 2.5 hours apart. With three chat samples in
// hand, a ceiling fitted tightly to one session's max would be
// under-provisioned against variance that size.
//
// Note this puts chat (25s) ABOVE reasoning (20s), which nominally
// reverses ENG-06's ordering rule. That rule rested on "reasoning is
// consistently the heavier call" -- a premise measurement has since
// falsified: reasoning is the FASTER lane (12 297 ms max vs chat's
// 14 071 ms). The invariant that actually holds is per-lane: each
// ceiling should clear its OWN observed max by ~1.6x or better, which
// both now do. If reasoning latency ever grows, its 20 000 ms deserves
// the same re-derivation -- deliberately not touched here (ENG-06f
// scope), but flagged.
//
// ENG-06j: that flag came due immediately. Raising this constant past
// REASONING_FETCH_TIMEOUT_MS (then 20_000) inverted the ordering the
// original ENG-06 fix existed to establish, and the inversion is not
// cosmetic: the overlay lane RESOLVES on timeout with a claim that the AI
// provider is unavailable, while this lane REJECTS and tears the turn down
// honestly. With this ceiling higher, the overlay gave up first and its
// claim rode along on a chat reply that then arrived successfully -- a true
// answer with a false "temporarily unavailable" note under it.
//
// Fixed by raising REASONING_FETCH_TIMEOUT_MS to 30_000 rather than by
// lowering this one: see that constant's comment for why relative lane
// speed cannot decide the ordering (the two lanes' observed maxima are
// within 3%) and why the rule is instead "the lane that makes claims must
// never be the first to give up". The relationship is pinned by
// src/features/chat/laneTimeoutOrdering.test.ts, which fails if either
// constant is edited in a way that re-inverts it.
//
// ACCEPTED COST of this constant's own 15_000 -> 25_000 change, recorded
// here because it was never written down: on a genuinely dead request the
// user now waits 25 s instead of 15 s before seeing any failure at all --
// 10 s longer staring at a spinner with no signal. That is a real
// regression on the true-failure path, accepted deliberately: the
// alternative was continuing to report ordinary 14 071 ms turns (94% of the
// old ceiling) as failures, and a false failure on a working turn is worse
// than a slow true one on a broken turn. Revisit if latency work ever
// brings the observed max down enough to lower this.
export const CHAT_REQUEST_TIMEOUT_MS = 25_000

export function isChatRequestTimeoutError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'TIMEOUT',
  )
}

export interface ChatTimeoutFailureMessages {
  user: ChatMsg
  assistant: ChatMsg
}

// GH-06: what the user sees, and what gets persisted, when the primary
// /chat reply times out -- reuses the same honest-bounded-message
// convention already established for AI provider failures elsewhere in
// this app (context_derivation_error_provider_unavailable,
// doc_memory_error_provider_unavailable) rather than a generic send-failed
// banner, since a timeout is genuinely ambiguous (the Worker may still be
// processing) rather than a definite rejection. Never silence: the
// returned pair is both appended to local state AND persisted directly to
// agent_chat_messages via the browser's own RLS-scoped insert (handleSend),
// since the abandoned /chat request itself may never persist anything.
export function buildChatTimeoutFailureMessages(
  userText: string,
  responseLanguage: SupportedAiResponseLanguage,
  t: Translate,
  now: () => number = Date.now,
): ChatTimeoutFailureMessages {
  return {
    user: { id: `u-${now()}`, role: 'user', content: userText },
    assistant: { id: `a-${now() + 1}`, role: 'assistant', content: t('chat_error_provider_unavailable'), language: responseLanguage },
  }
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
  onConfirmAndRunWrite,
  compact = false,
}: Readonly<{
  proposal: ReasoningProposalState
  onRunReadOnly: () => void
  onReviewApproval: () => void
  onRunWrite: () => void
  onConfirmAndRunWrite: () => void
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
  // BLOCKER A CORRECTION: the ONE gate every approval affordance below is
  // checked against -- see isExecutionBindingReady's own comment. While a
  // server-execution binding is still in flight, or once server policy has
  // already auto-resolved this proposal to a terminal outcome, approval
  // must never be offered.
  const executionBindingReady = isExecutionBindingReady(proposal.executionRequestStatus)
  const executionRequestTerminal = proposal.executionRequestStatus === 'succeeded' || proposal.executionRequestStatus === 'failed' || proposal.executionRequestStatus === 'uncertain'
  const canReviewApproval = isWriteProposal && approval?.status === 'pending' && !executionRequestTerminal
  const canRunWrite = isWriteProposal && isApproved && executionBindingReady && runStatus !== 'success' && runStatus !== 'failed'
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

      {/* Task 30 (PO decision, one-click approval): the full preview
          (amount, direction, date, category, ...) is shown directly on the
          card, not only inside the separate Review dialog -- the Review
          dialog stays available (see canReviewApproval below) but is no
          longer the only way to see what will be recorded before
          confirming. */}
      {approval?.previewText && (
        <div className="mt-3 rounded-lg border border-border/25 bg-background/30 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('approval_preview_label')}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/90" dir="auto">
            {approval.previewText}
          </p>
        </div>
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
            <>
              {/* Task 30 (PO decision, one-click approval): the primary
                  action on a pending write proposal now confirms and runs
                  directly, in one click -- the full preview is already
                  shown on the card above. This does NOT skip approval: it
                  calls the exact same approveWorkspaceStep the Review
                  dialog's own Approve button calls
                  (handleConfirmAndRunWrite in ChatPage), so every policy
                  check (evaluateExecutionPolicy, validateApprovalBoundary,
                  the server-side ask-clamp) still runs unchanged. Review
                  stays available as a secondary action for anyone who wants
                  the full diagnostic panel first -- it is no longer
                  mandatory. */}
              {/* BLOCKER A CORRECTION: disabled (never hidden) while a
                  server-execution binding is still in flight -- the row
                  and its buttons stay in place, just non-executable, so
                  the layout does not jump and the user can see something
                  is happening (see agent_intent_preparing). */}
              <Button
                type="button"
                size="sm"
                onClick={onConfirmAndRunWrite}
                disabled={isRunning || !executionBindingReady}
              >
                {!executionBindingReady ? t('agent_intent_preparing') : isRunning ? t('agent_intent_running') : intentTitle(result.proposal.type, t)}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onReviewApproval} disabled={!executionBindingReady}>
                {t('agent_intent_review_approval')}
              </Button>
            </>
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

      {/* BLOCKER C CORRECTION: server policy resolved 'auto' and the write
          already concluded during the pre-approval request call itself --
          this proposal never went through runWriteTool (runtimeResult is
          unset), so this is the ONLY place its outcome is ever shown. The
          button row above is already gated off (canReviewApproval excludes
          every terminal executionRequestStatus) -- an auto write can never
          execute a second time from this card. */}
      {!runtimeResult && proposal.executionRequestReply && (
        <p
          className="mt-3 rounded-lg border border-border/25 bg-background/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
          dir="auto"
        >
          {proposal.executionRequestReply}
        </p>
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

export function ChatBubble({ role, content, language, compact = false, embedded = false, undo, onUndo }: Readonly<{
  role: 'user' | 'assistant'
  content: string
  language?: SupportedAiResponseLanguage
  compact?: boolean
  // SmartFlow Home REV 2 §7: inside Home's embedded chat shell the
  // transcript spans the full shell width (no centred column cap), so the
  // per-bubble lg+ caps switch from the standalone route's 70ch reading
  // measure to the approved percentage widths (assistant <=86%, user
  // <=64% of the shell). Default false keeps standalone /chat byte-
  // identical.
  embedded?: boolean
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
          // the column is wide (task 17g, Y3: the STANDALONE column is
          // ALSO capped to a reading measure -- see this page's root
          // render below -- so this per-bubble cap and the column cap
          // never fight: 70ch is comfortably narrower than the column's
          // own max-w-3xl, so the bubble cap is always the binding one).
          // REV 2 §7: embedded (Home) swaps the lg+ caps to the approved
          // percentage widths of the now-uncapped shell-wide column.
          role === 'user'
            ? (embedded ? 'max-w-[92%] lg:max-w-[64%]' : 'max-w-[92%] lg:max-w-[70ch]')
            : (embedded ? 'max-w-full lg:max-w-[86%]' : 'max-w-full lg:max-w-[70ch]'),
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

export interface ChatPageProps {
  // Home / Flow AI v2 design cleanup: when true, this page is mounted
  // INSIDE another route's layout (Dashboard's chat panel) rather than as
  // the full-height `/chat` route itself -- the only difference is sizing.
  // The route element (`<Route path="/chat" element={<ChatPage />} />`)
  // never passes this, so `/chat` itself is pixel-identical to before this
  // prop existed. No chat/execution logic reads this flag -- it only
  // changes the root element's own height/sticky classes, below.
  readonly embedded?: boolean
  // SmartFlow Home frozen design handoff §10 (<=1120px): Home passes a
  // handler so the embedded chat header can show the Assistant-panel
  // button that opens the rail overlay. Presentation-only wiring; the
  // standalone /chat route never passes it and renders no new control.
  readonly onOpenAssistantPanel?: () => void
}

export default function ChatPage({ embedded = false, onOpenAssistantPanel }: ChatPageProps = {}) {
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
  // Chat V2 Slice 2B.2 correction 1: independent from reasoningProposal on
  // purpose -- see ChatWorkerActionPending's own comment on why this is a
  // small, additive, standalone shape rather than a ReasoningProposalState.
  const [twoActionPending, setTwoActionPending] = useState<TwoActionPendingState[] | null>(null)
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

  // Chat V2 Slice 2A, BLOCKER 1 CORRECTION: as soon as a write proposal for
  // one of the Worker-execution-backed tools (tasks.create/update/complete,
  // calendar.create_event/update_event) becomes pending, durably record it
  // on the Worker BEFORE the user approves anything -- see
  // writeRuntime.ts's own requestWriteExecution and this slice's report for
  // why the durable row must exist before, not only as a side effect of,
  // the user's approval action. Every OTHER write tool (github.*,
  // engineering.task.propose, tasks.complete's own separate
  // ExecutionIntent ceremony) is untouched -- requestWriteExecution itself
  // no-ops (`not_applicable`) for anything outside that tool set, and such
  // a proposal's executionRequestStatus starts (and stays) 'idle', so this
  // effect never has anything to fire for it in the first place.
  // Fire-and-forget per proposal, deduplicated by requestId (the SAME
  // stable id proposalToState already generated) so a re-render never
  // re-issues the same request twice.
  //
  // BLOCKER A/C CORRECTION: only fires for a proposal whose
  // executionRequestStatus is exactly 'requesting' -- proposalToState
  // already put every gated proposal there synchronously on first render
  // (see its own comment), so approval is never briefly enabled before
  // this effect gets a chance to run. Every one of the four outcomes the
  // Worker's /agent/execution/request call can resolve to is handled
  // explicitly below, never silently ignored:
  //   'approval_pending' -- bind serverExecutionId, become approvable.
  //   'succeeded'/'failed'/'uncertain' -- server policy independently
  //     resolved 'auto' and the write already concluded during this same
  //     request call; the proposal is marked terminal (never approvable)
  //     and the Worker's own reply text is shown -- the UI must never
  //     display an approval card for a write that already ran.
  //   the request itself failing ('blocked', or a malformed response
  //     missing what the outcome status requires) -- marked 'failed' with
  //     a bounded, translated message; approval stays disabled and no
  //     domain write is ever attempted from this state.
  const agentExecutionRequestedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!reasoningProposal || !user?.id) return
    for (const proposal of reasoningProposal) {
      if (!proposal.step || !proposal.resolution?.resolved || !proposal.approval) continue
      if (proposal.executionRequestStatus !== 'requesting') continue
      if (agentExecutionRequestedRef.current.has(proposal.requestId)) continue
      agentExecutionRequestedRef.current.add(proposal.requestId)

      const { requestId, step: proposalStep, resolution: proposalResolution } = proposal
      void requestWriteExecution({
        requestId,
        step: proposalStep,
        toolResolution: proposalResolution,
        target: proposal.result.proposal.target,
        executionContext: {
          agentToolExecutionClient: createAgentToolExecutionClient({
            workerBaseUrl: workerUrl,
            getAccessToken: async () => {
              const { data: { session } } = await supabase.auth.getSession()
              return session?.access_token
            },
          }),
        },
      }).then((outcome) => {
        setReasoningProposal(prev => prev
          ? prev.map(p => {
            if (p.requestId !== requestId || !p.approval) return p
            if (outcome.status === 'requested' && outcome.serverStatus === 'approval_pending' && outcome.executionId) {
              return { ...p, approval: { ...p.approval, serverExecutionId: outcome.executionId }, executionRequestStatus: 'approval_pending' }
            }
            if (outcome.status === 'requested' && (outcome.serverStatus === 'succeeded' || outcome.serverStatus === 'failed' || outcome.serverStatus === 'uncertain')) {
              return {
                ...p,
                executionRequestStatus: outcome.serverStatus,
                executionRequestReply: outcome.reply,
                runStatus: outcome.serverStatus === 'succeeded' ? 'success' : p.runStatus,
              }
            }
            // status === 'blocked' (the pre-approval request itself could
            // not be completed), or a 'requested' response this client
            // could not make sense of -- fail closed exactly the same way:
            // terminal, never approvable, bounded surfaced message, no
            // domain write possible from this state.
            return { ...p, executionRequestStatus: 'failed', executionRequestReply: t('agent_intent_execution_request_failed') }
          })
          : prev)
      })
    }
  }, [reasoningProposal, user?.id, workerUrl, t])

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
    // Task 17f, C1b + PO decision (v2 follow-up): an explicit New Chat is
    // a deliberate "start fresh" action -- persist that (null writes the
    // NEW_CHAT_PERSISTED_MARKER, see activeSessionResolver.ts) so a reload
    // right after (before anything is sent) lands back on the NEW empty
    // chat instead of dragging back the PREVIOUS session. Once something
    // is actually sent, the persistence effect (below) takes back over
    // with the new session's real id.
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
  // PO decision (v2 follow-up) guard: do NOT write before the mount
  // resolution has run. Without the guard, this effect's very first run
  // (activeSessionId still its initial null, sessions still loading)
  // overwrote the persisted value BEFORE resolveActiveSessionOnMount could
  // read it -- previously masked by the resolver's most-recent fallback,
  // but fatal once null persists the new-chat marker: every reload would
  // look like an explicit New Chat.
  useEffect(() => {
    if (!hasResolvedInitialSession.current) return
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

    // ENG-06f: turn start, used only for the CHAT_LANE_TIMEOUT diagnostic
    // below -- it reports how long the browser actually waited before
    // giving up, which is what tells a near-miss (re-derive the ceiling)
    // apart from a genuinely stuck request (fix the latency).
    const sendStartedAt = Date.now()

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

      // Chat V2 Slice 1: base classification is unchanged; the router can
      // only DOWNGRADE an 'explicit' base signal to 'conversational' for a
      // message with zero action evidence and a positive conversational
      // shape (see chatV2Routing.ts). 'legacy'-routed messages keep today's
      // behavior byte-for-byte, including the reasoning overlay below.
      const baseIntentSignal = classifyMessageIntentSignal(text)
      const chatV2RoutingDeps = { looksLikeExplicitActionRequest }
      const chatV2Route = classifyChatV2Route(text, baseIntentSignal, chatV2RoutingDeps)
      const intentSignal = resolveChatV2IntentSignal(text, baseIntentSignal, chatV2RoutingDeps)

      // Task 11 fix (conversation-first inversion): the DEFAULT LANE.
      // Every inbound message calls the plain /chat conversational
      // endpoint, unconditionally -- this call is no longer inside the
      // 'explicit' branch, and nothing below can prevent it from running.
      // See the task 11 report's pipeline map/root-cause trace for why the
      // OLD code (this call gated behind `intentSignal !== 'explicit'`,
      // with an early `return` in the explicit branch) was the actual
      // production bug: a message misclassified 'explicit' by a keyword
      // collision never reached this call at all.
      const chatCallPromise = (async (): Promise<ChatWorkerResponse> => {
        // GH-06: previously an unbounded fetch -- a Worker stall here hung
        // this whole promise forever, which in turn hung the Promise.all
        // below indefinitely (nothing downstream, including the read-tool
        // step's own 10s timeout, ever got a chance to run). withTimeout
        // lets the request keep running server-side but stops the browser
        // from waiting past CHAT_REQUEST_TIMEOUT_MS -- the rejection is
        // caught below and turned into an honest, persisted message
        // (isChatRequestTimeoutError / buildChatTimeoutFailureMessages)
        // instead of an indefinite spinner.
        const res = await withTimeout(
          fetch(`${workerUrl}/chat`, {
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
              // Chat V2 Slice 1: the route DECLARATION. The Worker stays
              // authoritative -- it demotes 'fast' to 'legacy' whenever its
              // own deterministic write detection engages, and the lane
              // only ever affects text-provider preference + telemetry
              // there, never policy.
              lane: chatV2Route,
            }),
          }),
          CHAT_REQUEST_TIMEOUT_MS,
          'Chat request timed out.',
        )
        if (!res.ok) throw new Error(`Worker responded ${res.status}`)
        return (await res.json()) as ChatWorkerResponse
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
      // Chat V2 Slice 1: the gate is the extracted, pinned
      // shouldStartReasoningOverlay (still `intentSignal === 'explicit'`).
      // A FAST-routed message can never satisfy it (its signal was
      // downgraded above), so the fast path never starts -- and therefore
      // never waits on -- the reasoning lane; Promise.all below then
      // resolves on the conversation lane alone.
      if (shouldStartReasoningOverlay(intentSignal)) {
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
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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

      const [{ reply, writePolicy, writeExecution, undo, actions, pendingAction }, overlayResult] = await Promise.all([chatCallPromise, overlayPromise])

      // Chat V2 Slice 2B.2: two independently decomposed actions -- skip
      // the single-proposal overlay/outcome machinery entirely (see
      // ChatWorkerResponse's own comment for why). Never mixed with the
      // single-outcome path below in the same turn.
      if (actions && actions.length > 0) {
        const resolvedActions = actions.filter((a): a is ChatWorkerActionResolved => a.kind === 'resolved')
        const pendingActions = actions.filter((a): a is ChatWorkerActionPending => a.kind === 'pending')

        setReasoningProposal(null)
        setMessages(prev => [...prev, ...buildTwoActionMessages(text, resolvedActions, responseLanguage, Date.now())])

        if (pendingActions.length > 0) {
          setTwoActionPending(buildTwoActionPendingStates(pendingActions))
          const turnSessionId = sessionId
          const turnLanguage = responseLanguage
          for (const pending of pendingActions) {
            // Fire-and-forget, one independent call per action -- matches
            // the existing single-action convention (requestExecution()
            // called as soon as the proposal is normalized, BEFORE the
            // user approves, so a durable approval_pending row already
            // exists by the time the card is shown). A failure here only
            // ever updates THIS action's own card (requestId-keyed) --
            // never the sibling's.
            void (async () => {
              try {
                const client = createAgentToolExecutionClient({
                  workerBaseUrl: workerUrl,
                  getAccessToken: async () => {
                    const { data: { session: authSession } } = await supabase.auth.getSession()
                    return authSession?.access_token
                  },
                })
                const result = await client.requestExecution({
                  toolId: pending.toolId,
                  arguments: pending.arguments,
                  requestId: pending.requestId,
                  sessionId: turnSessionId ?? undefined,
                  chatMessageId: pending.chatMessageId,
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  language: turnLanguage,
                })
                setTwoActionPending(prev => prev ? applyTwoActionRequestResult(prev, pending.requestId, result.status === 'approval_pending'
                  ? { status: 'approval_pending', executionId: result.executionId ?? '' }
                  : { status: result.status, executionId: result.executionId, reply: result.reply }) : prev)
              } catch (error) {
                console.error('[ChatPage] Slice 2B.2 correction 1: requestExecution failed for a decomposed action:', error)
                setTwoActionPending(prev => prev ? applyTwoActionRequestResult(prev, pending.requestId, { status: 'error' }) : prev)
              }
            })()
          }
        }

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
        return
      }

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
      if (shouldAutoRunReadOnlyOverlay({
        hasAutoExecutableReadOnlyOverlay: Boolean(overlayResult && isAutoExecutableReadOnlyProposal(overlayResult)),
        writePolicy,
        writeExecution,
      })) {
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
      // an auto-executed read) lives in resolveChatTurnOutcome (an
      // independently-tested function) -- see its own comment for the
      // outcome rationale. handleSend's job is only to gather the resolved
      // inputs and apply the decision.
      //
      // ENG-06j: that function was described here as "pure" until ENG-06f
      // added two logUnavailableCause() calls inside it, which write to the
      // console. Its RETURN VALUE is still a function of its inputs alone,
      // which is what the independent tests rely on -- but it is no longer
      // side-effect free, and the distinction matters at exactly one point:
      // this call site must stay the only one, and must stay out of render.
      // Calling it during render would emit a diagnostic line per render
      // pass, silently inflating the very counts those lines exist to make
      // countable.
      const outcome = autoReadContent !== null
        ? { content: autoReadContent, reasoningStates: null }
        : resolveChatTurnOutcome({ intentSignal, message: text, responseLanguage, reply, overlayResult, serverWritePolicyMode: writePolicy?.mode, serverWriteExecution: writeExecution, hasServerPendingAction: Boolean(pendingAction) }, t)
      setReasoningProposal(outcome.reasoningStates)

      setMessages(prev => [
        ...prev,
        { id: `u-${Date.now()}`, role: 'user', content: text },
        { id: `a-${Date.now() + 1}`, role: 'assistant', content: outcome.content, language: responseLanguage, undo },
      ])

      // Stabilization patch 1 follow-up (Option B): a server-resolved
      // single-action pendingAction (agent/worker/index.ts's own comment
      // at its construction site) renders through the EXACT SAME
      // TwoActionPendingState lifecycle 2B.2 already uses above -- one
      // entry instead of two, reusing buildTwoActionPendingStates/
      // applyTwoActionRequestResult rather than a second, parallel
      // request/approve state machine. The overlay's own competing write
      // card is already suppressed for this turn (hasServerPendingAction
      // above), so this is the ONLY card the user sees for it.
      if (pendingAction) {
        setTwoActionPending(buildTwoActionPendingStates([pendingAction]))
        const turnSessionId = sessionId
        const turnLanguage = responseLanguage
        void (async () => {
          try {
            const client = createAgentToolExecutionClient({
              workerBaseUrl: workerUrl,
              getAccessToken: async () => {
                const { data: { session: authSession } } = await supabase.auth.getSession()
                return authSession?.access_token
              },
            })
            const result = await client.requestExecution({
              toolId: pendingAction.toolId,
              arguments: pendingAction.arguments,
              requestId: pendingAction.requestId,
              sessionId: turnSessionId ?? undefined,
              chatMessageId: pendingAction.chatMessageId,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              language: turnLanguage,
            })
            setTwoActionPending(prev => prev ? applyTwoActionRequestResult(prev, pendingAction.requestId, result.status === 'approval_pending'
              ? { status: 'approval_pending', executionId: result.executionId ?? '' }
              : { status: result.status, executionId: result.executionId, reply: result.reply }) : prev)
          } catch (error) {
            console.error('[ChatPage] stabilization patch 1 follow-up: requestExecution failed for the server-resolved pendingAction:', error)
            setTwoActionPending(prev => prev ? applyTwoActionRequestResult(prev, pendingAction.requestId, { status: 'error' }) : prev)
          }
        })()
      }

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
    } catch (err) {
      // GH-06: a chatCallPromise timeout is not an ordinary send failure --
      // the Worker may still be processing, and the user's draft was
      // already cleared as "sent," so this gets an honest, persisted
      // transcript entry instead of the generic error banner + restored
      // draft used for every other failure (network reject, non-ok
      // status, session creation failure). Never a blank gap: appended to
      // local state immediately, and persisted directly (best-effort, same
      // fail-safe posture as every other secondary write in this codebase)
      // since the abandoned Worker request itself may never persist
      // anything for this turn.
      if (isChatRequestTimeoutError(err) && sessionId) {
        // ENG-06f: the chat lane is one of three producers of the same
        // user-facing "temporarily unavailable" sentence. This stamps
        // WHICH one, so the next occurrence does not have to be
        // re-diagnosed from the string (ENG-06 -> ENG-06c -> ENG-06e).
        // elapsedMs vs the ceiling is the number that actually matters
        // here: it says whether this was a near-miss worth re-deriving
        // the ceiling from, or a genuinely stuck request.
        logUnavailableCause(UNAVAILABLE_CAUSE.CHAT_LANE_TIMEOUT, {
          ceilingMs: CHAT_REQUEST_TIMEOUT_MS,
          elapsedMs: Date.now() - sendStartedAt,
        })
        const failureMessages = buildChatTimeoutFailureMessages(text, responseLanguage, t)
        setMessages(prev => [...prev, failureMessages.user, failureMessages.assistant])
        if (user?.id) {
          const ownerId = user.id
          const ownerSessionId = sessionId
          try {
            await supabase.from('agent_chat_messages').insert([
              { user_id: ownerId, session_id: ownerSessionId, role: 'user', content: failureMessages.user.content },
              { user_id: ownerId, session_id: ownerSessionId, role: 'assistant', content: failureMessages.assistant.content },
            ])
          } catch (persistError) {
            console.error('[ChatPage] Failed to persist chat-timeout fallback message:', persistError)
          }
        }
        void refreshSessions()
      } else {
        setSendError(t('chat_error_send'))
        if (!overrideText) setDraft(text)
      }
    } finally {
      setSending(false)
    }
  }, [draft, sending, workerUrl, t, activeSessionId, createSession, refreshSessions, interfaceLanguage, workspace, tasks, tasksLoading, tasksError, githubRepositoryInventory, attachedDocument, user])

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
      const storedResponseLanguage = getStoredAiResponseLanguage()
      const assistantLanguage = storedResponseLanguage === 'auto' ? undefined : storedResponseLanguage
      setMessages(prev => [
        ...prev.map(message => message.undo?.id === undoId ? { ...message, undo: undefined } : message),
        { id: `u-${Date.now()}`, role: 'user', content: 'Undo' },
        { id: `a-${Date.now() + 1}`, role: 'assistant', content: reply, language: assistantLanguage },
      ])
      void refreshSessions()
    } catch {
      setSendError(t('chat_error_send'))
    } finally {
      setSending(false)
    }
  }, [activeSessionId, sending, workerUrl, refreshSessions, t])

  // Chat V2 Slice 2B.2 correction 1: approves exactly ONE decomposed
  // action's own executionId. Matched by requestId, mutating only that
  // entry (applyTwoActionApproveResult's own guarantee) -- there is no
  // "approve all" affordance anywhere in this file, and none is ever built
  // from this function; the caller passes one requestId per button.
  const handleApproveTwoAction = useCallback(async (requestId: string) => {
    const entry = twoActionPending?.find(p => p.requestId === requestId)
    if (!entry || !entry.executionId || entry.status !== 'approval_pending') return

    setTwoActionPending(prev => prev ? applyTwoActionApproveResult(prev, requestId, { status: 'approving' }) : prev)
    try {
      const client = createAgentToolExecutionClient({
        workerBaseUrl: workerUrl,
        getAccessToken: async () => {
          const { data: { session } } = await supabase.auth.getSession()
          return session?.access_token
        },
      })
      const result = await client.approveExecution(entry.executionId)
      setTwoActionPending(prev => prev ? applyTwoActionApproveResult(prev, requestId, { status: result.status, reply: result.reply }) : prev)
    } catch (error) {
      console.error('[ChatPage] Slice 2B.2 correction 1: approveExecution failed for a decomposed action:', error)
      setTwoActionPending(prev => prev ? applyTwoActionApproveResult(prev, requestId, { status: 'error' }) : prev)
    }
  }, [twoActionPending, workerUrl])

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

  // Task 40, ADR-0016 Slice 2: the ask-lane's half of the proposal outcome
  // ledger (Part A established finance ALWAYS takes this lane while tasks/
  // calendar usually take the Worker's own in-process auto-lane -- if only
  // one lane reports, the data is systematically biased). Fire-and-forget
  // (Decision item 6): reportProposalOutcome itself never throws, and this
  // is never awaited, so it can never delay or fail the write it describes
  // -- by the time any call site below reaches this, the write has already
  // completed (or already been rejected).
  const reportCurrentProposalOutcome = useCallback((
    current: ReasoningProposalState,
    outcome: 'approved' | 'rejected',
    succeeded: boolean | null,
    requestId?: string,
  ) => {
    const domain = current.step?.domain
    const toolId = current.resolution?.toolId
    if (!domain || !toolId || !isProposalOutcomeDomain(domain)) return
    void reportProposalOutcome({
      workerBaseUrl: workerUrl,
      getAccessToken: async () => {
        const { data: { session } } = await supabase.auth.getSession()
        return session?.access_token
      },
    }, {
      requestId,
      intentType: current.result.proposal.type,
      toolId,
      domain,
      outcome,
      succeeded,
      riskLevel: current.resolution?.tool?.riskLevel,
      targetFields: writeProposalTargetFields(current.result.proposal.target, domain),
    })
  }, [workerUrl])

  // complete_task proposals are always a single-element reasoningProposal
  // array -- disambiguation candidates are deliberately never complete_task
  // (see resolveDisambiguationCandidates) -- so the approval flow only ever
  // needs to address index 0.
  const handleApprovalDecision = useCallback((decision: ApprovalInteractionResult) => {
    if (!decision.ok || decision.decision === 'closed') return
    setReasoningProposal(prev => {
      if (!prev || prev.length === 0) return prev
      const current = prev[0]
      // Task 40: only the REJECTED decision is reported here -- an
      // APPROVED decision via the full dialog still needs a separate Run
      // click (handleRunWriteProposal) before the write actually happens,
      // so its outcome (with the write's own success/failure) is reported
      // from runWriteProposalWithApproval instead, once both facts are
      // known together.
      if (decision.decision === 'rejected') {
        reportCurrentProposalOutcome(current, 'rejected', null)
      }
      return prev.map((p, i) => i === 0 ? {
        ...p,
        approval: decision.approval,
        runStatus: decision.decision === 'approved' ? 'approved' : 'rejected',
      } : p)
    })
  }, [reportCurrentProposalOutcome])

  // Generalized for EPIC-07 (Write Light) -- runs any resolved write proposal
  // (tasks.complete, github.issues.comment, github.issues.update), not just
  // task completion. runWriteTool's own capability/step-shape/handler-input
  // logic was still tasks.complete-only until a follow-up fix generalized it;
  // `target` is threaded through here so the github handlers can see
  // repo/issueNumber/commentBody/etc. -- step.targetId alone only carries
  // `${repo}#${issueNumber}`, never the comment body or update fields.
  //
  // Task 30: takes `approval` as an explicit parameter instead of always
  // reading `reasoningProposal[0].approval` from closure state -- the
  // one-click confirm path (handleConfirmAndRunWrite below) approves and
  // runs in the same user gesture, and setReasoningProposal's state update
  // from the approval step is not guaranteed to have landed yet by the time
  // this runs, so it passes the just-issued approval straight through
  // rather than re-reading state that may still be stale.
  const runWriteProposalWithApproval = useCallback(async (approval: WorkspaceStepApproval) => {
    const current = reasoningProposal?.[0]
    if (!current?.step || !current.resolution?.resolved) return

    const toolId = current.resolution.toolId
    setReasoningProposal(prev => prev
      ? prev.map((p, i) => i === 0 ? { ...p, runStatus: 'running' } : p)
      : prev)
    const currentTime = new Date()
    // BLOCKER 2 CORRECTION: current.requestId is the SAME stable id
    // (generated once, in proposalToState) that requestWriteExecution's own
    // pre-approval effect below already used for this exact proposal --
    // never freshly minted here. See ReasoningProposalState.requestId's own
    // comment.
    const requestId = current.requestId
    const writeResult = await runWriteTool({
      requestId,
      step: current.step,
      toolResolution: current.resolution,
      approval,
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
        // ENG-04.
        engineeringTaskClient: createEngineeringTaskClient({
          workerBaseUrl: workerUrl,
          getAccessToken: async () => {
            const { data: { session } } = await supabase.auth.getSession()
            return session?.access_token
          },
        }),
        // Chat V2 Slice 2A: tasks.create/update/complete and
        // calendar.create_event/update_event now execute through the
        // Worker's server-owned execution lifecycle instead of writing
        // directly to Supabase from here -- see
        // agent/worker/agent-tool-execution.ts's own header comment.
        agentToolExecutionClient: createAgentToolExecutionClient({
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
    // Task 40, ADR-0016 Slice 2: the write has already completed (success
    // or failure) by this point -- reporting its outcome here can never
    // delay or change what the user already sees above.
    reportCurrentProposalOutcome(current, 'approved', writeResult.success, requestId)
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

    // ENG-04, Part 1 item 4 / Part 2 item 6: engineering.task.propose's
    // "success" above only means the task was SUBMITTED (see
    // safeSummaryFor's own comment in writeRuntime.ts) -- it is
    // fundamentally asynchronous, unlike every other write tool here.
    // This follow-up polls the Worker and appends a SECOND, later message
    // with the honest, verified outcome once the companion reports back
    // (or an honest "still waiting"/"appears stuck" message if it never
    // does -- Part 1 item 5). Fire-and-forget: never blocks or delays the
    // synchronous submission message above.
    if (toolId === 'engineering.task.propose' && writeResult.success && writeResult.resultData) {
      const submitted = writeResult.resultData as { id?: string }
      if (submitted.id) {
        void pollEngineeringTaskUntilDone(
          {
            workerBaseUrl: workerUrl,
            getAccessToken: async () => {
              const { data: { session } } = await supabase.auth.getSession()
              return session?.access_token
            },
          },
          submitted.id,
        )
          .then((status) => {
            appendAssistantResult(formatEngineeringTaskResultMessage(status), current.result.responseLanguage)
          })
          .catch((error: unknown) => {
            console.error('[ChatPage] engineering task status polling failed (non-fatal):', error)
          })
      }
    }
  }, [appendAssistantResult, reasoningProposal, reportCurrentProposalOutcome, tasks, workerUrl, workspace])

  const handleRunWriteProposal = useCallback(async () => {
    const current = reasoningProposal?.[0]
    if (!current?.approval || current.approval.status !== 'approved') return
    // BLOCKER A CORRECTION: defense in depth beyond the UI's own disabled
    // button -- even a programmatic/stale-closure invocation of this
    // handler cannot execute a write whose server-execution binding never
    // resolved (or resolved to a terminal auto outcome already).
    if (!isExecutionBindingReady(current.executionRequestStatus)) return
    await runWriteProposalWithApproval(current.approval)
  }, [reasoningProposal, runWriteProposalWithApproval])

  // Task 30 (PO decision, one-click approval): the server-side ask-clamp
  // (resolveServerFlowWriteMode in agent/worker/flow-write-policy.ts) and
  // every local policy check (evaluateExecutionPolicy, validateApprovalBoundary)
  // are untouched by this -- this is a UI step-count change only. It goes
  // through the EXACT SAME approveWorkspaceStep the Review dialog's own
  // Approve button calls (StepApprovalDialog.tsx's handleApprove), just
  // without requiring the dialog to be opened first. The full preview
  // (amount, direction, date, category, ...) is already visible on the card
  // itself before this is pressed -- see ReasoningProposalCard's previewText
  // block below.
  const handleConfirmAndRunWrite = useCallback(async () => {
    const current = reasoningProposal?.[0]
    if (!current?.step || !current.approval || current.approval.status !== 'pending') return
    // BLOCKER A CORRECTION: same defense-in-depth as handleRunWriteProposal
    // above -- approveWorkspaceStep must never even be called while a
    // server-execution binding is still in flight, or once one has already
    // resolved to a terminal auto outcome.
    if (!isExecutionBindingReady(current.executionRequestStatus)) return
    const decision = await approveWorkspaceStep({
      step: current.step,
      stepApproval: current.approval,
      tool: current.resolution?.tool,
    })
    if (!decision.ok || decision.decision !== 'approved' || !decision.approval) {
      // Task 40: matches the existing runStatus:'rejected' the UI already
      // shows for this path (an approval that failed policy validation,
      // not a literal user Reject click) -- no write was ever attempted.
      reportCurrentProposalOutcome(current, 'rejected', null)
      setReasoningProposal(prev => prev
        ? prev.map((p, i) => i === 0 ? { ...p, runStatus: 'rejected' } : p)
        : prev)
      return
    }
    const approvedApproval = decision.approval
    setReasoningProposal(prev => prev
      ? prev.map((p, i) => i === 0 ? { ...p, approval: approvedApproval, runStatus: 'approved' } : p)
      : prev)
    await runWriteProposalWithApproval(approvedApproval)
  }, [reasoningProposal, reportCurrentProposalOutcome, runWriteProposalWithApproval])

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
      // Home / Flow AI v2 design cleanup: `lg:sticky lg:top-0 lg:h-screen`
      // (className above, kept as a static literal -- ChatPagePwaScroll.
      // test.tsx and ChatPageChromeCleanup.test.tsx both pin its exact
      // source text) is what makes the standalone /chat route claim the
      // full viewport height regardless of its ancestor's own sizing (see
      // AppLayout.tsx's own comment on why -- Y5's double-scrollbar fix
      // relies on it). Embedded on Home, the parent panel already supplies
      // an explicit bounded height, so this page must fill THAT instead of
      // the viewport -- an inline style, which always wins over a utility
      // class regardless of breakpoint, overrides just the properties
      // that matter rather than touching the className string at all.
      // Home V2 blocker fix: the embedded wrapper is now a flex-col card
      // (see Dashboard.tsx), so `flex: 1 1 0%` + `minHeight: 0` size this
      // root by flex growth instead of leaning on percentage-height
      // resolution against a flex item -- the reliable column contract
      // (bounded shell -> flex-1 min-h-0 transcript -> flex-none footer)
      // holds at every level. `height: 100%` is kept as a harmless
      // fallback for any non-flex host.
      style={embedded ? { position: 'static', height: '100%', flex: '1 1 0%', minHeight: 0 } : undefined}
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
        // SmartFlow Home v2 (`SmartFlow Home v2.dc.html`): the embedded
        // header carries the "SmartFlow" title and the ping-dot "Online"
        // cluster again (v2 superseded REV 2's compact de-branded header).
        // The standalone /chat route (embedded=false) passes no override,
        // so its own `chat_title` translation is completely unchanged.
        titleOverride={embedded ? 'SmartFlow' : undefined}
        showOnlineStatus={embedded}
        // Frozen handoff §10: (<=1120px only) the Assistant-panel button.
        onOpenAssistantPanel={embedded ? onOpenAssistantPanel : undefined}
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
        {/* Home V2 visual correction, round 3: `min-h-0` -- without it,
            this nested flex-col item's automatic minimum height defaults
            to its content's size, so inside a height-bounded ancestor
            (Home's embedded panel) it grew past the panel instead of
            yielding scroll space to the messages region below -- the
            composer visually drifted out of view as the conversation grew
            instead of staying pinned while only the message list
            scrolled. */}
        {/* SmartFlow Home REV 2 §7: the centred lg+ reading-measure cap
            (`lg:mx-auto lg:max-w-3xl`, task 17f B2) applies ONLY to the
            standalone /chat route. Home's embedded transcript spans the
            full chat-shell width -- the wider conversational surface is
            achieved here (no capped column), while ChatBubble's embedded
            percentage caps keep individual messages from running
            edge-to-edge. */}
        <div className={cn('relative flex min-w-0 flex-1 flex-col min-h-0', !embedded && 'lg:mx-auto lg:max-w-3xl')}>
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
            className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 sm:px-6', compact ? 'space-y-2 py-3' : 'space-y-3 py-4')}
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
                    // SmartFlow Home v2: Home's embedded new-chat empty
                    // state is the centered animated-orb greeting from the
                    // v2 prototype (see ChatEmptyState's own comment); the
                    // standalone /chat route keeps its card + quick actions.
                    embedded={embedded}
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
              <ChatBubble key={msg.id} role={msg.role} content={msg.content} language={msg.language} compact={compact} embedded={embedded} undo={msg.undo} onUndo={handleUndo} />
            ))}

            {sending && <TypingIndicator label={t('chat_typing')} />}

            {reasoningProposal?.map((proposal, index) => (
              <ReasoningProposalCard
                key={proposal.result.proposal.id}
                proposal={proposal}
                onRunReadOnly={() => handleRunReasoningProposal(index)}
                onReviewApproval={() => setApprovalDialogOpen(true)}
                onRunWrite={handleRunWriteProposal}
                onConfirmAndRunWrite={handleConfirmAndRunWrite}
                compact={compact}
              />
            ))}

            {/* Chat V2 Slice 2B.2 correction 1: one small card per pending
                decomposed action, each with its OWN independent approve
                control -- approving one never touches the other (see
                handleApproveTwoAction's own comment). Intentionally not a
                ReasoningProposalCard -- see ChatWorkerActionPending's
                comment for why this is a small, standalone shape instead. */}
            {twoActionPending?.map(pending => (
              <div key={pending.requestId} className="rounded-lg border border-border bg-card p-3 text-sm">
                <div className="font-medium">{pending.previewText}</div>
                {/* Chat V2 Slice 2B.2 correction 2, BLOCKER 1: the exact
                    consequential arguments (title/due date/notes for tasks;
                    title/start/end/notes for calendar) this action will
                    submit, so the user can see them BEFORE clicking Approve
                    -- not only the title above. See
                    twoActionPendingPreviewLines' own comment. */}
                <div className="mt-2 rounded-lg border border-border/25 bg-background/30 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('approval_preview_label')}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/90" dir="auto">
                    {twoActionPendingPreviewLines(pending, t).join('\n')}
                  </p>
                </div>
                {pending.status === 'requesting' && <div className="text-muted-foreground">{t('chat_typing') ?? 'Preparing…'}</div>}
                {pending.status === 'approval_pending' && (
                  <button
                    type="button"
                    className="mt-2 rounded-md border border-primary px-3 py-1 text-primary"
                    onClick={() => void handleApproveTwoAction(pending.requestId)}
                  >
                    Approve
                  </button>
                )}
                {pending.status === 'approving' && <div className="text-muted-foreground">Approving…</div>}
                {(pending.status === 'succeeded' || pending.status === 'failed' || pending.status === 'uncertain') && (
                  <div className="text-muted-foreground">{pending.resultReply}</div>
                )}
                {pending.status === 'error' && <div className="text-destructive">Could not reach the server for this action.</div>}
              </div>
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
              // Frozen handoff §7: Home's embedded composer placeholder.
              placeholderOverride={embedded ? 'Ask SmartFlow anything…' : undefined}
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
        // BLOCKER A CORRECTION, requirement 2: the Review dialog's own
        // Approve/Reject buttons must not allow an executable approval
        // either -- disabled for the exact same reason (and using the exact
        // same gate) the card's own buttons are, in case the dialog was
        // reachable through any path other than the card's now-disabled
        // Review button.
        disabled={!isExecutionBindingReady(reasoningProposal?.[0]?.executionRequestStatus)}
        onClose={() => setApprovalDialogOpen(false)}
        onDecision={handleApprovalDecision}
      />
    </div>
  )
}
