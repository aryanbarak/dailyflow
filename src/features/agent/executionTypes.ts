import type {
  Workspace,
  WorkspaceApprovalRiskLevel,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";
import type {
  AgentToolDefinition,
  AgentToolSchemaField,
  ExecutionPolicyContext,
  ExecutionPolicyDecision,
} from "./toolTypes";
import type { ExecutionAuditRecord } from "./executionAuditTypes";

export type ExecutionStatus =
  | "success"
  | "policy_denied"
  | "tool_not_found"
  | "handler_not_found"
  | "invalid_input"
  | "verification_failed"
  | "timeout"
  | "failed";

export interface ExecutionContextTask {
  id?: string;
  title?: string;
  completed?: boolean;
  status?: string;
  priority?: string;
  dueDate?: string;
  createdAt?: string;
}

export interface ExecutionContextEvent {
  id?: string;
  title: string;
  dateTimeStart?: string;
  start?: string;
  end?: string;
  location?: string;
}

export interface ExecutionLearningProgressItem {
  id?: string;
  title: string;
  completionPercentage?: number;
  completed?: boolean;
  lastActivityAt?: string;
}

export interface ExecutionLearningProgressSnapshot {
  lessons?: ExecutionLearningProgressItem[];
  totalQuestions?: number;
  lastActivityAt?: string;
  mode?: string;
}

export interface GitHubRepositorySummary {
  id: string;
  name: string;
  owner: string;
  visibility: "public" | "private" | "internal";
  defaultBranch: string;
  archived: boolean;
}

export interface GitHubRepositoriesResult {
  connectionStatus: "connected" | "not_connected";
  repositories: GitHubRepositorySummary[];
}

export interface GitHubRepositoriesClient {
  listRepositories(): Promise<GitHubRepositoriesResult>;
}

export interface GitHubIssueSummary {
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed";
  updatedAt: string;
}

export interface GitHubIssuesResult {
  connectionStatus: "connected" | "not_connected";
  issues: GitHubIssueSummary[];
}

export interface GitHubIssuesClient {
  listIssues(): Promise<GitHubIssuesResult>;
}

export interface GitHubEpicSummary {
  repo: string;
  number: number;
  title: string;
  epic: string;
  status: string;
  url: string;
}

export interface GitHubEpicsResult {
  connectionStatus: "connected" | "not_connected";
  epics: GitHubEpicSummary[];
}

export interface GitHubEpicsClient {
  listEpics(): Promise<GitHubEpicsResult>;
}

export interface GitHubPullRequestSummary {
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed";
  updatedAt: string;
  draft: boolean;
}

export interface GitHubPullRequestsResult {
  connectionStatus: "connected" | "not_connected";
  pullRequests: GitHubPullRequestSummary[];
}

export interface GitHubPullRequestsClient {
  listPullRequests(): Promise<GitHubPullRequestsResult>;
}

export interface GitHubWorkflowRunSummary {
  repo: string;
  workflowName: string;
  status: string;
  conclusion?: string;
  updatedAt: string;
}

export interface GitHubWorkflowRunsResult {
  connectionStatus: "connected" | "not_connected";
  workflowRuns: GitHubWorkflowRunSummary[];
}

export interface GitHubWorkflowRunsClient {
  listWorkflowRuns(): Promise<GitHubWorkflowRunsResult>;
}

// EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
export interface GitHubIssueCommentInput {
  repo: string;
  issueNumber: number;
  body: string;
}

export interface GitHubIssueCommentResult {
  commentId: number;
  url: string;
}

export interface GitHubIssueCommentClient {
  createComment(input: GitHubIssueCommentInput): Promise<GitHubIssueCommentResult>;
}

export interface GitHubIssueUpdateInput {
  repo: string;
  issueNumber: number;
  title?: string;
  body?: string;
  labels?: string[];
}

export interface GitHubIssueUpdateResult {
  issueNumber: number;
  url: string;
}

export interface GitHubIssueUpdateClient {
  updateIssue(input: GitHubIssueUpdateInput): Promise<GitHubIssueUpdateResult>;
}

// EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
// Authenticated, bounded, single-file read only. No write counterpart exists
// yet; SUPPORTED_WRITE_TOOL_IDS in writeRuntime.ts is unchanged by this type.
export interface GitHubFileContentInput {
  repo: string;
  path: string;
}

export interface GitHubFileContentFile {
  repo: string;
  path: string;
  branch: string;
  blobSha: string;
  commitSha: string;
  content: string;
  size: number;
}

export interface GitHubFileContentResult {
  connectionStatus: "connected" | "not_connected";
  file: GitHubFileContentFile | null;
}

export interface GitHubFileContentClient {
  readFile(input: GitHubFileContentInput): Promise<GitHubFileContentResult>;
}

export interface ExecutionContext {
  tasks?: readonly ExecutionContextTask[];
  events?: readonly ExecutionContextEvent[];
  learningProgress?: ExecutionLearningProgressSnapshot | null;
  workspace?: Workspace | null;
  policyContext?: ExecutionPolicyContext;
  currentTime?: string;
  githubRepositoriesClient?: GitHubRepositoriesClient;
  githubIssuesClient?: GitHubIssuesClient;
  githubEpicsClient?: GitHubEpicsClient;
  githubPullRequestsClient?: GitHubPullRequestsClient;
  githubWorkflowRunsClient?: GitHubWorkflowRunsClient;
  githubIssueCommentClient?: GitHubIssueCommentClient;
  githubFileContentClient?: GitHubFileContentClient;
  githubIssueUpdateClient?: GitHubIssueUpdateClient;
}

export interface ExecutionRequest {
  requestId: string;
  step: WorkspacePlanStep;
  toolId: string;
  approval?: WorkspaceStepApproval | null;
  input: Record<string, unknown>;
  requestedAt: string;
  context?: ExecutionContext;
}

export interface ExecutionError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ExecutionResult {
  requestId: string;
  stepId: string;
  toolId: string;
  status: ExecutionStatus;
  success: boolean;
  data?: unknown;
  error?: ExecutionError;
  policyDecision: ExecutionPolicyDecision;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  executionVersion: "execution-engine-v1";
  metadata: {
    readOnly: boolean;
    handlerId?: string;
    effectiveRiskLevel: WorkspaceApprovalRiskLevel;
  };
}

export interface ExecutionRecord {
  requestId: string;
  stepId: string;
  toolId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  policyStatus: ExecutionPolicyDecision["status"];
  errorCode?: string;
}

export interface ExecutionInputValidationResult {
  valid: boolean;
  errors: string[];
}

export interface AgentToolHandler {
  toolId: string;
  execute(input: Record<string, unknown>, context: ExecutionContext): unknown | Promise<unknown>;
  validateInput(input: unknown, schema: readonly AgentToolSchemaField[]): ExecutionInputValidationResult;
  timeoutMs: number;
  readOnly: true;
}

export type AgentWriteToolExecutionStatus =
  | "success"
  | "invalid_input"
  | "failed"
  | "verification_failed";

export interface AgentWriteToolAuditMetadata {
  taskId?: string;
  alreadyCompleted?: boolean;
  verified: boolean;
  resultShape: "object";
  redacted: true;
}

export interface AgentWriteToolCompensationDescriptor {
  taskId: string;
  previousCompleted: boolean;
  previousCompletedAt?: string | null;
}

export interface AgentWriteToolExecutionResult<TData = unknown> {
  status: AgentWriteToolExecutionStatus;
  success: boolean;
  data?: TData;
  error?: ExecutionError;
  auditMetadata: AgentWriteToolAuditMetadata;
  compensation?: AgentWriteToolCompensationDescriptor;
}

export interface AgentWriteToolHandler<TData = unknown> {
  toolId: string;
  mode: "write";
  readOnly: false;
  externalEffect: true;
  reversible: boolean;
  requiresVerification: true;
  execute(input: Record<string, unknown>, context: ExecutionContext): Promise<AgentWriteToolExecutionResult<TData>>;
  validateInput(input: unknown, schema: readonly AgentToolSchemaField[]): ExecutionInputValidationResult;
  timeoutMs: number;
}

export interface ExecutionEngineDependencies {
  getToolById(toolId: string): AgentToolDefinition | undefined;
  getHandlerByToolId(toolId: string): AgentToolHandler | undefined;
  now(): Date;
  appendExecutionAuditRecord(record: ExecutionAuditRecord): ExecutionAuditRecord;
}
