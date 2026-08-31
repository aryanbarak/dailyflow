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
import type {
  CanonicalExecutionIntent,
  ExecutionAttempt,
  ExecutionResultReference,
  IntentApprovalBinding,
  IntentPolicyDecision,
} from "./executionIntent";

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

// Chat V2 Slice 2A -- see agent/worker/agent-tool-execution.ts's own header
// comment for the full request -> approve -> execute lifecycle this client
// drives. requestAndExecute performs BOTH Worker calls (POST
// /agent/execution/request, then POST /agent/execution/approve) as one
// awaited round trip from the handler's point of view -- by the time a
// write handler's execute() runs, the user has already approved in the UI
// (or the write resolved to policy mode 'auto', which the Worker itself
// completes in the request call alone), so there is exactly one moment in
// the existing write path where this needs to be called, matching this
// slice's own "change the post-approval write path only as much as
// necessary" scope.
export interface AgentToolExecutionInput {
  toolId: 'tasks.create' | 'tasks.update' | 'tasks.complete' | 'calendar.create_event' | 'calendar.update_event';
  targetId?: string;
  arguments: Record<string, unknown>;
  requestId: string;
  sessionId?: string;
  chatMessageId?: string;
  timeZone: string;
  language?: 'en' | 'de' | 'fa';
}

export interface AgentToolExecutionResult {
  status: 'succeeded' | 'failed';
  reply: string;
  undoId?: string;
  errorCode?: string;
  targetId?: string;
  completedAt?: string;
}

export interface AgentToolExecutionClient {
  requestAndExecute(input: AgentToolExecutionInput): Promise<AgentToolExecutionResult>;
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

// EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
// The mutation write path. Deliberately has no baseBlobSha/baseCommitSha/
// proposedContentDigest/riskLevel/expiresAt fields -- the Worker sources all
// of those from its own server-verifiable approval record
// (agent_code_proposal_approvals), never from this request. See
// codeChange/codeProposalApprovalRecording.ts for the separate step that
// records that approval before this input is ever built.
export interface GitHubFileUpdateInput {
  proposalId: string;
  repo: string;
  path: string;
  proposedContent: string;
  commitMessage?: string;
}

export interface GitHubFileUpdateResult {
  repo: string;
  path: string;
  branch: string;
  commitSha: string;
  blobSha: string;
  commitUrl: string;
}

export interface GitHubFileUpdateClient {
  updateFile(input: GitHubFileUpdateInput): Promise<GitHubFileUpdateResult>;
}

// ENG-04 -- see docs/architecture/notes/eng-04-companion-chat-approval-wiring-v1.md.
export interface EngineeringTaskProposeInput {
  repo: string;
  instruction: string;
  taskClass: string;
}

export interface EngineeringTaskProposeResult {
  id: string;
  status: string;
}

export interface EngineeringTaskClient {
  propose(input: EngineeringTaskProposeInput): Promise<EngineeringTaskProposeResult>;
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
  githubFileUpdateClient?: GitHubFileUpdateClient;
  engineeringTaskClient?: EngineeringTaskClient;
  agentToolExecutionClient?: AgentToolExecutionClient;
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
    executionIntent?: {
      intentId: string;
      canonicalHash: string;
      policyDecisionId?: string;
      attemptId?: string;
      resultStatus?: string;
    };
  };
}

export interface ExecutionIntentLifecycleArtifacts {
  intent: CanonicalExecutionIntent;
  policyDecision: IntentPolicyDecision;
  approvalBinding?: IntentApprovalBinding;
  attempt?: ExecutionAttempt;
  resultReference?: ExecutionResultReference;
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
