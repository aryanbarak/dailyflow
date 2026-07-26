import {
  REFLECTION_ENGINE_VERSION,
  type AgentReflectionConfidence,
  type AgentReflectionDomain,
  type AgentReflectionGoalProgress,
  type AgentReflectionInput,
  type AgentReflectionOutcome,
  type AgentReflectionResult,
  type AgentReflectionStepAssessment,
  type AgentReflectionUsefulness,
} from "./reflectionTypes";
import type { ExecutionAuditRecord } from "./executionAuditTypes";
import type { ExecutionResult } from "./executionTypes";
import type {
  WorkspaceGoal,
  WorkspacePlanStep,
  WorkspaceSignalDomain,
} from "../workspace/workspaceTypes";

interface ToolDataAssessment {
  itemCount?: number;
  hasUsefulData: boolean;
  empty: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function stableReflectionId(requestId: string, stepId: string, generatedAt: string) {
  return `reflection:${requestId}:${stepId}:${generatedAt}`;
}

function terminalRecords(records: readonly ExecutionAuditRecord[], result: ExecutionResult) {
  return records.filter(
    (record) =>
      record.requestId === result.requestId &&
      record.status !== "started",
  );
}

function hasStartedRecord(records: readonly ExecutionAuditRecord[], result: ExecutionResult) {
  return records.some(
    (record) =>
      record.requestId === result.requestId &&
      record.status === "started" &&
      record.stepId === result.stepId &&
      record.toolId === result.toolId,
  );
}

function auditCorrelationIsValid(input: AgentReflectionInput) {
  const result = input.executionResult;
  if (result.stepId !== input.step.id) return false;
  if (input.toolResolution.stepId !== input.step.id) return false;
  if (input.toolResolution.toolId !== result.toolId) return false;

  const matchingTerminalRecords = terminalRecords(input.auditRecords, result);
  if (!hasStartedRecord(input.auditRecords, result)) return false;
  if (matchingTerminalRecords.length !== 1) return false;

  const [terminal] = matchingTerminalRecords;
  return (
    terminal.stepId === result.stepId &&
    terminal.toolId === result.toolId &&
    terminal.status === result.status
  );
}

function arrayLength(data: unknown, key: string) {
  if (!isObject(data)) return 0;
  const value = data[key];
  return Array.isArray(value) ? value.length : 0;
}

function assessToolData(result: ExecutionResult): ToolDataAssessment {
  if (result.status !== "success") {
    return {
      hasUsefulData: false,
      empty: true,
    };
  }

  switch (result.toolId) {
    case "tasks.list": {
      const tasks = isObject(result.data) && Array.isArray(result.data.tasks)
        ? result.data.tasks
        : [];
      const activeCount = tasks.filter(
        (task) => isObject(task) && task.status !== "completed",
      ).length;
      return {
        itemCount: activeCount,
        hasUsefulData: activeCount > 0,
        empty: activeCount === 0,
      };
    }
    case "calendar.list_today": {
      const count = arrayLength(result.data, "events");
      return {
        itemCount: count,
        hasUsefulData: count > 0,
        empty: count === 0,
      };
    }
    case "learning.get_progress": {
      const count = arrayLength(result.data, "lessons");
      return {
        itemCount: count,
        hasUsefulData: count > 0,
        empty: count === 0,
      };
    }
    case "workspace.get_context": {
      const hasContext = isObject(result.data) && Boolean(result.data.workspace);
      return {
        itemCount: hasContext ? 1 : 0,
        hasUsefulData: hasContext,
        empty: !hasContext,
      };
    }
    case "github.repositories.list": {
      const count = arrayLength(result.data, "repositories");
      return {
        itemCount: count,
        hasUsefulData: count > 0,
        empty: count === 0,
      };
    }
    case "github.issues.list": {
      const count = arrayLength(result.data, "issues");
      return {
        itemCount: count,
        hasUsefulData: count > 0,
        empty: count === 0,
      };
    }
    case "github.pulls.list": {
      const count = arrayLength(result.data, "pullRequests");
      return {
        itemCount: count,
        hasUsefulData: count > 0,
        empty: count === 0,
      };
    }
    case "github.workflow_runs.list": {
      const count = arrayLength(result.data, "workflowRuns");
      return {
        itemCount: count,
        hasUsefulData: count > 0,
        empty: count === 0,
      };
    }
    case "tasks.complete": {
      const alreadyCompleted = isObject(result.data) && result.data.alreadyCompleted === true;
      const verified = isObject(result.data) && result.data.verified === true;
      return {
        itemCount: alreadyCompleted || !verified ? 0 : 1,
        hasUsefulData: verified && !alreadyCompleted,
        empty: alreadyCompleted || !verified,
      };
    }
    default:
      return {
        hasUsefulData: false,
        empty: true,
      };
  }
}

function outcomeFor(result: ExecutionResult, assessment: ToolDataAssessment): AgentReflectionOutcome {
  switch (result.status) {
    case "success":
      return assessment.empty ? "empty" : "successful";
    case "policy_denied":
      return "policy_denied";
    case "timeout":
      return "timeout";
    case "invalid_input":
    case "tool_not_found":
    case "handler_not_found":
      return "invalid";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

function toolDomain(input: AgentReflectionInput): AgentReflectionDomain | undefined {
  const domain = input.toolResolution.tool?.domain;
  // "system" is a real AgentToolDomain member with no reflection concept -- every
  // other member matches AgentReflectionDomain exactly, so this is the only case
  // to exclude rather than force-cast through.
  if (domain && domain !== "system") return domain;
  return input.toolResolution.toolId?.split(".")[0] as AgentReflectionDomain | undefined;
}

function relevance(
  step: WorkspacePlanStep,
  goal: WorkspaceGoal,
  domain?: AgentReflectionDomain,
) {
  if (step.domain !== goal.primaryDomain && domain !== goal.primaryDomain) {
    if (step.domain !== "github" && step.domain !== "workspace" && goal.supportingDomains.includes(step.domain)) return "supporting";
    if (domain && domain !== "workspace" && domain !== "github" && domain !== "conversations" && goal.supportingDomains.includes(domain)) return "supporting";
    if (domain === "workspace") return "supporting";
    return "unrelated";
  }

  return "primary";
}

function usefulnessFor(
  outcome: AgentReflectionOutcome,
  assessment: ToolDataAssessment,
  relevanceLevel: ReturnType<typeof relevance>,
): AgentReflectionUsefulness {
  if (outcome === "policy_denied" || outcome === "failed" || outcome === "timeout" || outcome === "invalid") {
    return "none";
  }

  if (relevanceLevel === "unrelated") return "low";
  if (assessment.empty) return relevanceLevel === "primary" ? "medium" : "low";
  if (relevanceLevel === "primary") return "high";
  return "medium";
}

function progressFor(
  outcome: AgentReflectionOutcome,
  usefulness: AgentReflectionUsefulness,
  relevanceLevel: ReturnType<typeof relevance>,
): AgentReflectionGoalProgress {
  if (outcome === "policy_denied" || outcome === "failed" || outcome === "timeout" || outcome === "invalid") {
    return "none";
  }
  if (relevanceLevel === "unrelated") return "none";
  if (usefulness === "high") return "supported";
  if (usefulness === "medium" || usefulness === "low") return "informed";
  return "unknown";
}

function stepAssessmentFor(outcome: AgentReflectionOutcome): AgentReflectionStepAssessment {
  switch (outcome) {
    case "successful":
    case "empty":
    case "partial":
      return "information_gathered";
    case "policy_denied":
      return "blocked";
    case "timeout":
    case "failed":
    case "invalid":
      return "failed";
    default:
      return "not_started";
  }
}

function confidenceFor(
  validCorrelation: boolean,
  outcome: AgentReflectionOutcome,
  usefulness: AgentReflectionUsefulness,
): AgentReflectionConfidence {
  if (!validCorrelation || outcome === "invalid") return "low";
  if (outcome === "failed" || outcome === "timeout" || outcome === "policy_denied") return "medium";
  if (usefulness === "high") return "high";
  return "medium";
}

function summaryFor(result: ExecutionResult, outcome: AgentReflectionOutcome, assessment: ToolDataAssessment) {
  if (outcome === "policy_denied") return "The read-only action was blocked by policy.";
  if (outcome === "timeout") return "The read-only action timed out.";
  if (outcome === "failed") return "The read-only action failed.";
  if (outcome === "invalid") return "The execution evidence could not be trusted.";

  switch (result.toolId) {
    case "tasks.list":
      return assessment.empty
        ? "No active tasks were found."
        : "Active task information was gathered.";
    case "calendar.list_today":
      return assessment.empty
        ? "No calendar events were found for today."
        : "Today's calendar information was gathered.";
    case "learning.get_progress":
      return assessment.empty
        ? "No learning progress was found."
        : "Learning progress information was gathered.";
    case "workspace.get_context":
      return assessment.empty
        ? "No workspace context was available."
        : "Workspace context was gathered.";
    case "github.repositories.list":
      return assessment.empty
        ? "No connected GitHub repositories were found."
        : "Connected GitHub repository metadata was gathered.";
    case "github.issues.list":
      return assessment.empty
        ? "No open GitHub issues were found."
        : "Open GitHub issue metadata was gathered.";
    case "github.pulls.list":
      return assessment.empty
        ? "No open GitHub pull requests were found."
        : "Open GitHub pull request metadata was gathered.";
    case "github.workflow_runs.list":
      return assessment.empty
        ? "No recent GitHub workflow runs were found."
        : "Recent GitHub workflow run status was gathered.";
    case "tasks.complete":
      return assessment.empty
        ? "Task was already completed. No new change was needed."
        : "Task completion was verified.";
    default:
      return "Read-only information was gathered.";
  }
}

function followUpFor(result: ExecutionResult, outcome: AgentReflectionOutcome, assessment: ToolDataAssessment) {
  if (outcome === "policy_denied") return undefined;
  if (outcome === "timeout") return "Try the read-only action again later.";
  if (outcome === "failed" || outcome === "invalid") return "Review the failure and try again later.";

  switch (result.toolId) {
    case "tasks.list":
      return assessment.empty
        ? "Use the open focus window to choose the next setup step."
        : "Review the active tasks and choose the next one.";
    case "calendar.list_today":
      return assessment.empty
        ? "Use the available time window for focused work."
        : "Review today's events before choosing the next focus block.";
    case "learning.get_progress":
      return assessment.empty
        ? "Start a learning item to create continuity."
        : "Continue the most recent unfinished learning item.";
    case "workspace.get_context":
      return "Use the loaded context to choose the next read-only step.";
    case "github.repositories.list":
      return assessment.empty ? undefined : "Choose a repository to inspect in GitHub when needed.";
    case "github.issues.list":
      return assessment.empty ? undefined : "Choose an issue to follow up on in GitHub when needed.";
    case "github.pulls.list":
      return assessment.empty ? undefined : "Choose a pull request to review or merge in GitHub when needed.";
    case "github.workflow_runs.list":
      return assessment.empty ? undefined : "Open GitHub Actions if a run needs a closer look.";
    case "tasks.complete":
      return assessment.empty ? undefined : "Refresh the task view before choosing the next action.";
    default:
      return undefined;
  }
}

function shouldRetain(
  validCorrelation: boolean,
  outcome: AgentReflectionOutcome,
  usefulness: AgentReflectionUsefulness,
  progress: AgentReflectionGoalProgress,
) {
  return (
    validCorrelation &&
    (outcome === "successful" || outcome === "empty") &&
    usefulness !== "none" &&
    progress !== "none"
  );
}

function invalidReflection(input: AgentReflectionInput): AgentReflectionResult {
  const generatedAt = input.reflectedAt.toISOString();
  return {
    id: stableReflectionId(input.executionResult.requestId, input.step.id, generatedAt),
    requestId: input.executionResult.requestId,
    stepId: input.step.id,
    goalId: input.goal.id,
    toolId: input.executionResult.toolId,
    outcome: "invalid",
    usefulness: "none",
    goalProgress: "none",
    stepAssessment: "failed",
    confidence: "low",
    summary: "The execution evidence could not be trusted.",
    evidence: [],
    suggestedFollowUp: "Review the failure and try again later.",
    retainAsMemoryEvidence: false,
    generatedAt,
    reflectionVersion: REFLECTION_ENGINE_VERSION,
  };
}

export function reflectOnExecution(input: AgentReflectionInput): AgentReflectionResult {
  const validCorrelation = auditCorrelationIsValid(input);
  if (!validCorrelation) return invalidReflection(input);

  const generatedAt = input.reflectedAt.toISOString();
  const assessment = assessToolData(input.executionResult);
  const outcome = outcomeFor(input.executionResult, assessment);
  const domain = toolDomain(input);
  const relevanceLevel = relevance(input.step, input.goal, domain);
  const usefulness = usefulnessFor(outcome, assessment, relevanceLevel);
  const goalProgress = progressFor(outcome, usefulness, relevanceLevel);
  const retainAsMemoryEvidence =
    !(input.executionResult.toolId === "tasks.complete" && assessment.empty) &&
    shouldRetain(
      validCorrelation,
      outcome,
      usefulness,
      goalProgress,
    );

  return {
    id: stableReflectionId(input.executionResult.requestId, input.step.id, generatedAt),
    requestId: input.executionResult.requestId,
    stepId: input.step.id,
    goalId: input.goal.id,
    toolId: input.executionResult.toolId,
    outcome,
    usefulness,
    goalProgress,
    stepAssessment: stepAssessmentFor(outcome),
    confidence: confidenceFor(validCorrelation, outcome, usefulness),
    summary: summaryFor(input.executionResult, outcome, assessment),
    evidence: retainAsMemoryEvidence
      ? [{
          toolId: input.executionResult.toolId,
          domain,
          outcome,
          usefulness,
          goalProgress,
          itemCount: assessment.itemCount,
          timestamp: generatedAt,
        }]
      : [],
    suggestedFollowUp: followUpFor(input.executionResult, outcome, assessment),
    retainAsMemoryEvidence,
    generatedAt,
    reflectionVersion: REFLECTION_ENGINE_VERSION,
  };
}
