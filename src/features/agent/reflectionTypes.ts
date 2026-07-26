import type { ExecutionAuditRecord } from "./executionAuditTypes";
import type { ExecutionResult } from "./executionTypes";
import type { ToolResolutionResult } from "./toolResolverTypes";
import type {
  WorkspaceGoal,
  WorkspacePlan,
  WorkspacePlanStep,
  WorkspaceSignalDomain,
} from "../workspace/workspaceTypes";

export type AgentReflectionDomain = WorkspaceSignalDomain | "workspace" | "github" | "conversations";

export const REFLECTION_ENGINE_VERSION = "reflection-engine-v1" as const;

export type AgentReflectionOutcome =
  | "successful"
  | "empty"
  | "partial"
  | "policy_denied"
  | "failed"
  | "timeout"
  | "invalid";

export type AgentReflectionUsefulness = "none" | "low" | "medium" | "high";
export type AgentReflectionGoalProgress = "none" | "informed" | "supported" | "unknown";
export type AgentReflectionStepAssessment =
  | "not_started"
  | "information_gathered"
  | "blocked"
  | "failed";
export type AgentReflectionConfidence = "low" | "medium" | "high";

export interface AgentReflectionInput {
  executionResult: ExecutionResult;
  auditRecords: readonly ExecutionAuditRecord[];
  step: WorkspacePlanStep;
  goal: WorkspaceGoal;
  plan?: WorkspacePlan;
  toolResolution: ToolResolutionResult;
  reflectedAt: Date;
}

export interface AgentReflectionEvidence {
  toolId: string;
  domain?: AgentReflectionDomain;
  outcome: AgentReflectionOutcome;
  usefulness: AgentReflectionUsefulness;
  goalProgress: AgentReflectionGoalProgress;
  itemCount?: number;
  timestamp: string;
}

export interface AgentReflectionResult {
  id: string;
  requestId: string;
  stepId: string;
  goalId: string;
  toolId: string;
  outcome: AgentReflectionOutcome;
  usefulness: AgentReflectionUsefulness;
  goalProgress: AgentReflectionGoalProgress;
  stepAssessment: AgentReflectionStepAssessment;
  confidence: AgentReflectionConfidence;
  summary: string;
  evidence: AgentReflectionEvidence[];
  suggestedFollowUp?: string;
  retainAsMemoryEvidence: boolean;
  generatedAt: string;
  reflectionVersion: typeof REFLECTION_ENGINE_VERSION;
}
