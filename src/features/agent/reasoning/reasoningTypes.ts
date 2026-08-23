import type { AiResponseLanguage } from "@/features/ai/responseLanguage";
import type {
  ExecutionContextEvent,
  ExecutionContextTask,
  ExecutionLearningProgressSnapshot,
} from "../executionTypes";
import type { Workspace } from "@/features/workspace/workspaceTypes";
import type {
  WriteIntentDomain,
  WriteIntentToolId,
  WriteIntentType,
} from "../../../../shared/writeIntentRegistry";

export const AGENT_INTENT_SCHEMA_VERSION = 1 as const;

// Task 23: the four write-domain members (create_task/update_task/
// create_calendar_event/update_calendar_event) now come from the shared
// registry's WriteIntentType instead of being listed here a second time --
// see shared/writeIntentRegistry.ts. Every other member is a read intent,
// GitHub write, or terminal state outside this task's scope (tasks +
// calendar only) and stays a plain literal here.
export type AgentIntentType =
  | "inspect_tasks"
  | "inspect_calendar"
  | "inspect_learning"
  | "inspect_workspace"
  | "inspect_github_repositories"
  | "inspect_github_issues"
  | "inspect_github_epics"
  | "inspect_github_pull_requests"
  | "inspect_github_workflow_runs"
  | "complete_task"
  | WriteIntentType
  | "write_github_issue_comment"
  | "write_github_issue_update"
  | "ask_clarification"
  | "unsupported";

export type AgentIntentConfidence = "low" | "medium" | "high";
// Task 36d, ADR-0013 Slice 1 (item 1): the three write-domain members
// ('tasks' | 'calendar' | 'finance') now come from the shared registry's
// WriteIntentDomain instead of being listed here a second time -- same
// pattern AgentIntentType above already uses for WriteIntentType. The
// remaining three ('learning' | 'workspace' | 'github') have no registry
// entry (they're read-only/GitHub-write domains, out of the registry's
// tasks+calendar+finance write scope) and stay hand-written literals here.
export type AgentIntentDomain =
  | WriteIntentDomain
  | "learning"
  | "workspace"
  | "github";

export interface AgentIntentTarget {
  taskId?: string;
  taskReference?: string;
  taskTitleHint?: string;
  title?: string;
  notes?: string;
  dueDate?: string | null;
  // Task 22 (calendar write slice): kept distinct from title/dueDate above
  // (rather than reused) so a create_task and a create_calendar_event
  // proposal in the same flat interface can never be confused about which
  // domain a given field belongs to. start/end are ISO datetime strings.
  eventTitle?: string;
  eventReference?: string;
  eventId?: string;
  start?: string;
  end?: string;
  // Task 28 (finance write slice): amount/currency/iban are re-derived
  // deterministically from the raw message and OVERRIDE whatever the model
  // proposed here, mirroring how start/end above are re-derived rather than
  // trusted (task 22-fix's own C1 fix) -- see intentValidator.ts's own
  // normalizeTarget and its post-validation override step. transactionDate
  // defaults to today when unmentioned; category has no dedicated parser
  // and defaults to a fixed fallback in the shared registry's
  // buildHandlerInput.
  amount?: string;
  currency?: string;
  direction?: string;
  transactionDate?: string;
  category?: string;
  description?: string;
  iban?: string;
  // EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
  // Unlike task fields above, these are never fuzzy-matched against safe
  // context: repo/issueNumber/body must come from an explicit, well-formed
  // proposal, or the request falls back to ask_clarification.
  repo?: string;
  issueNumber?: number;
  commentBody?: string;
  updateTitle?: string;
  updateBody?: string;
  updateLabels?: string[];
}

export interface AgentIntentProposal {
  id: string;
  type: AgentIntentType;
  confidence: AgentIntentConfidence;
  userMessage: string;
  target?: AgentIntentTarget;
  requestedDomain?: AgentIntentDomain;
  toolId?: string;
  requiresTool: boolean;
  requiresApproval: boolean;
  clarificationQuestion?: string;
  reasons: string[];
  language: Exclude<AiResponseLanguage, "auto">;
  generatedAt: string;
  schemaVersion: typeof AGENT_INTENT_SCHEMA_VERSION;
}

// "unknown" (never refreshed / not connected / auth or network failure) is
// deliberately distinct from "known" with an empty names array (refreshed
// and confirmed zero repositories) -- collapsing them would let an unrefreshed
// cache read as "this user has no GitHub repositories at all," which is a
// different, wrong claim. See buildReasoningPrompt's phrasing for this field.
export type AgentReasoningGitHubInventory =
  | { status: "unknown" }
  | { status: "known"; names: string[] };

export interface AgentReasoningSafeContext {
  tasks: ExecutionContextTask[];
  events: ExecutionContextEvent[];
  learningProgress: ExecutionLearningProgressSnapshot | null;
  workspace?: Pick<Workspace, "goal" | "plan" | "signalFeed"> | null;
  githubRepositoryInventory?: AgentReasoningGitHubInventory;
}

export interface AgentReasoningInput {
  userMessage: string;
  configuredResponseLanguage?: AiResponseLanguage;
  interfaceLanguage?: string;
  safeContext: AgentReasoningSafeContext;
  now?: Date;
  sessionId?: string;
  // Task 22-fix (C1): the caller's IANA timezone, threaded through to
  // validateAgentIntentProposal's deterministic date/time resolution --
  // matches the same field already sent to the Worker's /chat endpoint.
  // Falls back to the browser's own timezone when omitted (see
  // intentValidator.ts's defaultTimeZone), so this is explicit-for-clarity,
  // not required for correctness.
  timeZone?: string;
}

export interface AgentReasoningPromptInput extends AgentReasoningInput {
  responseLanguage: Exclude<AiResponseLanguage, "auto">;
}

export interface AgentLlmReasoningRequest {
  prompt: string;
  responseLanguage: Exclude<AiResponseLanguage, "auto">;
  sessionId?: string;
}

export interface AgentLlmReasoningResponse {
  rawText: string;
  // INC-01: set when the worker reported the AI provider itself as
  // unreachable (429/5xx/network -- PROVIDER_UNAVAILABLE, or the fetch
  // call to the worker failing outright) rather than the model responding
  // with something unusable. reasoningOrchestrator.ts uses this to skip
  // parseLlmIntentJson/fallbackRawProposal entirely and report an honest,
  // distinct outcome instead of running the malformed-output rescue on an
  // empty string that was never actually model output.
  providerUnavailable?: boolean;
}

export type AgentLlmReasoningCaller = (
  request: AgentLlmReasoningRequest,
) => Promise<AgentLlmReasoningResponse>;

export interface AgentReasoningValidationResult {
  proposal: AgentIntentProposal;
  // Task 36d, ADR-0013 Slice 1 (item 1): the five registry write-tool ids
  // (tasks.create/tasks.update/calendar.create_event/calendar.update_event/
  // finance.create_transaction) now come from WriteIntentToolId instead of
  // being re-typed here a second time -- same derivation pattern as
  // AgentIntentType/AgentIntentDomain above. The remaining 9 read-tool ids
  // plus tasks.complete/github.issues.comment/github.issues.update (12
  // non-registry ids total) have no registry entry and stay hand-written.
  toolId?: "tasks.list" | "calendar.list_today" | "learning.get_progress" | "workspace.get_context" | "github.repositories.list" | "github.issues.list" | "github.epics.list" | "github.pulls.list" | "github.workflow_runs.list" | "tasks.complete" | WriteIntentToolId | "github.issues.comment" | "github.issues.update";
  validationReasons: string[];
}

export interface AgentReasoningResult extends AgentReasoningValidationResult {
  responseLanguage: Exclude<AiResponseLanguage, "auto">;
  promptPreview: {
    containsTaskNotes: false;
    containsRawMemory: false;
    containsAuditPolicy: false;
    containsUserId: false;
  };
  // Present only when the model proposed ask_clarification with 2-3 genuinely
  // distinct, validated candidates (see resolveDisambiguationCandidates).
  // Each entry is a complete, independent AgentReasoningResult -- not a
  // partial or a pointer into this one -- so running any single candidate is
  // indistinguishable from that candidate having been the sole proposal.
  // Absent for a normal confident proposal, a plain clarification with no
  // candidates, and for a disambiguation that collapsed to exactly one
  // survivor (that case is returned as a normal top-level result instead).
  disambiguationCandidates?: AgentReasoningResult[];
}
