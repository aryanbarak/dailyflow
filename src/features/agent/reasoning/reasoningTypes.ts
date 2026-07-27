import type { AiResponseLanguage } from "@/features/ai/responseLanguage";
import type {
  ExecutionContextEvent,
  ExecutionContextTask,
  ExecutionLearningProgressSnapshot,
} from "../executionTypes";
import type { Workspace } from "@/features/workspace/workspaceTypes";

export const AGENT_INTENT_SCHEMA_VERSION = 1 as const;

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
  | "ask_clarification"
  | "unsupported";

export type AgentIntentConfidence = "low" | "medium" | "high";
export type AgentIntentDomain =
  | "tasks"
  | "calendar"
  | "learning"
  | "workspace"
  | "github";

export interface AgentIntentTarget {
  taskId?: string;
  taskReference?: string;
  taskTitleHint?: string;
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
}

export type AgentLlmReasoningCaller = (
  request: AgentLlmReasoningRequest,
) => Promise<AgentLlmReasoningResponse>;

export interface AgentReasoningValidationResult {
  proposal: AgentIntentProposal;
  toolId?: "tasks.list" | "calendar.list_today" | "learning.get_progress" | "workspace.get_context" | "github.repositories.list" | "github.issues.list" | "github.epics.list" | "github.pulls.list" | "github.workflow_runs.list" | "tasks.complete";
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
