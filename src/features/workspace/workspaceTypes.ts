import type {
  WorkspaceInteractionEvent,
  WorkspaceInteractionSource,
  WorkspaceInteractionType,
} from "./workspaceInteractionTypes";
import type { ToolResolutionResult } from "../agent/toolResolverTypes";
import type {
  ExecutionContextEvent,
  ExecutionContextTask,
  ExecutionLearningProgressSnapshot,
} from "../agent/executionTypes";
import type { AgentToolCapability, AgentToolMode } from "../agent/toolTypes";

export type WorkspaceIconKey =
  | "book"
  | "briefcase"
  | "calendar"
  | "check"
  | "file"
  | "flame"
  | "message"
  | "sparkles"
  | "wallet";

export type WorkspaceRoute =
  | "/briefing/weekly"
  | "/calendar"
  | "/chat"
  | "/documents"
  | "/finance"
  | "/learn-ai"
  | "/tasks";

export interface WorkspaceNavigationTarget {
  route: WorkspaceRoute;
  initialPrompt?: string;
}

export interface WorkspaceAction {
  title: string;
  description: string;
  icon: WorkspaceIconKey;
  target: WorkspaceNavigationTarget;
  signalDomain?: WorkspaceSignalDomain;
}

export interface WorkspaceSkill extends WorkspaceAction {}

export interface WorkspaceSetupAction {
  label: string;
  description: string;
  icon: WorkspaceIconKey;
  target: WorkspaceNavigationTarget;
}

export interface WorkspaceTaskSignal {
  id?: string;
  title?: string;
  completed: boolean;
  createdAt: string;
}

export interface WorkspaceEventSignal {
  id?: string;
  title: string;
  dateTimeStart: string;
}

export interface WorkspaceFinanceSignal {
  id?: string;
  type: "income" | "expense";
  amount: number;
  date: string;
}

export interface WorkspaceChatSignal {
  id: string;
  title: string;
  updatedAt: string;
}

export interface WorkspaceLearnAiSignal {
  totalQuestions: number;
  lastQuestion: { content: string; mode: string; createdAt: string } | null;
  mostActiveMode: { mode: string; count: number } | null;
}

export type WorkspaceSignalDomain =
  | "tasks"
  | "calendar"
  | "finance"
  | "habits"
  | "documents"
  | "learning";

export type WorkspacePlanDomain = WorkspaceSignalDomain | "github" | "workspace";

export type WorkspaceSignalSeverity = "low" | "medium" | "high";
export type WorkspacePriorityConfidence = "low" | "medium" | "high";
export type WorkspacePersonalizationConfidence = "low" | "medium" | "high";
export type WorkspaceMemoryConfidence = "low" | "medium" | "high";
export type WorkspaceDecisionConfidence = "low" | "medium" | "high";
export type WorkspaceUsageWindow = "morning" | "afternoon" | "evening" | "night";
export type WorkspaceSuggestedActionMemoryStatus =
  | "shown"
  | "clicked"
  | "completed"
  | "dismissed";

export type WorkspaceDomainAffinity = Record<WorkspaceSignalDomain, number>;
export type WorkspaceUsageWindowMemory = Record<
  WorkspaceUsageWindow,
  Partial<Record<WorkspaceSignalDomain, number>>
>;

export interface WorkspaceSignal {
  id: string;
  domain: WorkspaceSignalDomain;
  label: string;
  score: number;
  severity: WorkspaceSignalSeverity;
  reason: string;
  count: number;
  createdAt?: string;
  generatedAt: string;
}

export interface WorkspacePriorityModel {
  primaryDomain: WorkspaceSignalDomain;
  secondaryDomains: WorkspaceSignalDomain[];
  missionTitle: string;
  missionSummary: string;
  confidence: WorkspacePriorityConfidence;
  reasons: string[];
  orderedSignalIds: string[];
}

export interface WorkspacePersonalizationModel {
  domainAffinity: WorkspaceDomainAffinity;
  recentDomains: WorkspaceSignalDomain[];
  preferredDomains: WorkspaceSignalDomain[];
  confidence: WorkspacePersonalizationConfidence;
  evidence: string[];
  generatedAt: string;
}

export interface WorkspaceActionEngagement {
  targetId: string;
  domain: WorkspaceSignalDomain;
  clicks: number;
  completions: number;
  dismissals: number;
  lastInteractionAt?: string;
  score: number;
}

export interface WorkspaceRepeatedInteractionPattern {
  domain: WorkspaceSignalDomain;
  type: WorkspaceInteractionType;
  count: number;
  score: number;
}

export interface WorkspaceInteractionFeedback {
  domainEngagement: WorkspaceDomainAffinity;
  actionEngagement: WorkspaceActionEngagement[];
  repeatedInteractionPatterns: WorkspaceRepeatedInteractionPattern[];
  avoidedDomains: WorkspaceSignalDomain[];
  recentInteractionDomains: WorkspaceSignalDomain[];
  preferredSources: Partial<Record<WorkspaceInteractionSource, number>>;
  confidence: WorkspacePersonalizationConfidence;
  evidence: string[];
  generatedAt: string;
}

export interface WorkspaceDecisionProfile {
  version: 1;
  preferredDomains: WorkspaceSignalDomain[];
  avoidedDomains: WorkspaceSignalDomain[];
  reliableDomains: WorkspaceSignalDomain[];
  recentSuccessDomains: WorkspaceSignalDomain[];
  recentEmptyDomains: WorkspaceSignalDomain[];
  decisionConfidence: WorkspaceDecisionConfidence;
  lowData: boolean;
}

export interface WorkspaceDecisionIntelligenceInput {
  now?: Date;
  memory: WorkspaceMemory;
  interactionFeedback: WorkspaceInteractionFeedback;
  signals: WorkspaceSignal[];
  currentGoal?: WorkspaceGoal;
  reflectionEvidence?: WorkspaceReflectionEvidence[];
}

export type WorkspaceGoalStatus =
  | "proposed"
  | "accepted"
  | "completed"
  | "dismissed";

export interface WorkspaceGoal {
  id: string;
  title: string;
  summary: string;
  primaryDomain: WorkspaceSignalDomain;
  supportingDomains: WorkspaceSignalDomain[];
  successCriteria: string[];
  estimatedEffortMinutes: number;
  confidence: WorkspacePriorityConfidence;
  reasons: string[];
  constraints: string[];
  generatedAt: string;
  sourceSignalIds: string[];
  sourcePriorityDomains: WorkspaceSignalDomain[];
  status: WorkspaceGoalStatus;
}

export type WorkspacePlanStatus = "proposed";
export type WorkspacePlanStepStatus = "proposed";
export type WorkspacePlanActionType =
  | "review"
  | "continue"
  | "focus"
  | "plan"
  | "open"
  | "select"
  | "reflect"
  | "inspect"
  | "create"
  | "update"
  | "complete"
  | "delete"
  | "send"
  | "pay"
  | "share"
  | "invite";

export interface WorkspacePlanStep {
  id: string;
  order: number;
  title: string;
  description: string;
  domain: WorkspacePlanDomain;
  estimatedMinutes: number;
  status: WorkspacePlanStepStatus;
  actionType: WorkspacePlanActionType;
  targetId?: string;
  targetRoute?: WorkspaceRoute;
  reason: string;
  requiresApproval: boolean;
  dependencies: string[];
  optional: boolean;
}

export interface WorkspacePlan {
  id: string;
  goalId: string;
  title: string;
  summary: string;
  status: WorkspacePlanStatus;
  steps: WorkspacePlanStep[];
  totalEstimatedMinutes: number;
  confidence: WorkspacePriorityConfidence;
  constraints: string[];
  reasons: string[];
  generatedAt: string;
  sourceGoal: WorkspaceGoal;
  sourceSignalIds: string[];
}

export type WorkspaceApprovalOverallStatus =
  | "not_required"
  | "pending"
  | "partially_approved"
  | "approved"
  | "rejected";
export type WorkspaceStepApprovalStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected";
export type WorkspaceApprovalScope =
  | "view_only"
  | "single_step"
  | "multiple_steps"
  | "entire_plan";
export type WorkspaceApprovalRiskLevel =
  | "none"
  | "low"
  | "medium"
  | "high";

// EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
// The exact base/proposed identifiers a code-change approval is bound to.
// Distinct from previewText (the human-readable diff) because these fields
// must be independently comparable (stale-base detection) without re-parsing
// free text.
export interface WorkspaceCodeProposalBinding {
  repo: string;
  path: string;
  baseBlobSha: string;
  baseCommitSha: string;
  proposedContentDigest: string;
}

export interface WorkspaceStepApproval {
  stepId: string;
  targetId?: string;
  toolId?: string;
  toolName?: string;
  toolDescription?: string;
  toolCapability?: AgentToolCapability;
  toolMode?: AgentToolMode;
  status: WorkspaceStepApprovalStatus;
  requiresApproval: boolean;
  approvalReason: string;
  riskLevel: WorkspaceApprovalRiskLevel;
  reversible: boolean;
  externalEffect: boolean;
  dataDomains: WorkspacePlanDomain[];
  approvalScope: WorkspaceApprovalScope;
  // EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
  // The exact pending content (comment body, or a title/body/label diff
  // summary) shown in the approval dialog before Run is enabled. Absent for
  // tasks.complete, which has no free-text payload to preview.
  previewText?: string;
  // EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
  // Present only for a code-change proposal. Absent for every other tool.
  codeProposalBinding?: WorkspaceCodeProposalBinding;
}

export interface WorkspaceApprovalModel {
  planId: string;
  goalId: string;
  overallStatus: WorkspaceApprovalOverallStatus;
  stepApprovals: WorkspaceStepApproval[];
  approvalScope: WorkspaceApprovalScope;
  requiresUserApproval: boolean;
  approvalSummary: string;
  riskLevel: WorkspaceApprovalRiskLevel;
  generatedAt: string;
  reasons: string[];
}

export interface WorkspaceDomainUsageMemory {
  openCount: number;
  lastOpenedAt?: string;
  recentOpenTimestamps: string[];
}

export interface WorkspaceLastOpenedItemMemory {
  id?: string;
  title?: string;
  progress?: number;
  openedAt: string;
}

export interface WorkspaceLastOpenedItemsMemory {
  task?: WorkspaceLastOpenedItemMemory;
  document?: WorkspaceLastOpenedItemMemory;
  lesson?: WorkspaceLastOpenedItemMemory;
  conversation?: WorkspaceLastOpenedItemMemory;
}

export interface WorkspaceSuggestedActionMemory {
  id: string;
  domain: WorkspaceSignalDomain;
  title: string;
  presentedAt: string;
  status: WorkspaceSuggestedActionMemoryStatus;
}

export interface WorkspaceConversationMemory {
  id: string;
  title: string;
  updatedAt: string;
}

export interface WorkspaceLearningContextMemory {
  mode?: string;
  totalQuestions: number;
  progress?: number;
  updatedAt?: string;
}

export interface WorkspaceHistoryEntry {
  generatedAt: string;
  primaryDomain: WorkspaceSignalDomain;
  secondaryDomains: WorkspaceSignalDomain[];
  confidence: WorkspacePriorityConfidence;
}

export type WorkspaceReflectionEvidenceDomain = WorkspaceSignalDomain | "workspace";

export interface WorkspaceReflectionEvidence {
  id: string;
  requestId: string;
  stepId: string;
  toolId: string;
  domain: WorkspaceReflectionEvidenceDomain;
  outcome: "successful" | "empty";
  usefulness: "low" | "medium" | "high";
  goalProgress: "informed" | "supported";
  reflectedAt: string;
  retainedAt: string;
  schemaVersion: 1;
}

export interface WorkspaceMemory {
  version: 1;
  createdAt: string;
  updatedAt: string;
  lastWorkspaceOpenedAt?: string;
  lastPrimaryDomain?: WorkspaceSignalDomain;
  recentDomains: WorkspaceSignalDomain[];
  domainUsage: Record<WorkspaceSignalDomain, WorkspaceDomainUsageMemory>;
  lastOpenedItems: WorkspaceLastOpenedItemsMemory;
  preferredUsageWindows: WorkspaceUsageWindowMemory;
  recentSuggestedActions: WorkspaceSuggestedActionMemory[];
  dismissedSuggestedActions: WorkspaceSuggestedActionMemory[];
  completedSuggestedActions: WorkspaceSuggestedActionMemory[];
  recentInteractions: WorkspaceInteractionEvent[];
  interactionCountsByType: Partial<Record<WorkspaceInteractionType, number>>;
  interactionCountsByDomain: Partial<Record<WorkspaceSignalDomain, number>>;
  lastInteractionAt?: string;
  lastConversation?: WorkspaceConversationMemory;
  lastLearningContext?: WorkspaceLearningContextMemory;
  recentReflectionEvidence: WorkspaceReflectionEvidence[];
  workspaceHistory: WorkspaceHistoryEntry[];
}

export interface WorkspaceMemoryInsights {
  recentDomains: WorkspaceSignalDomain[];
  familiarDomains: WorkspaceSignalDomain[];
  preferredTimeDomains: WorkspaceSignalDomain[];
  lastPrimaryDomain?: WorkspaceSignalDomain;
  repeatedActionPatterns: WorkspaceSignalDomain[];
  interactionDomains: WorkspaceSignalDomain[];
  recentReflectedDomains: WorkspaceReflectionEvidenceDomain[];
  reflectionEngagementByDomain: Partial<Record<WorkspaceReflectionEvidenceDomain, number>>;
  reflectionContinuityConfidence: WorkspacePersonalizationConfidence;
  learningContinuity?: WorkspaceLearningContextMemory;
  confidence: WorkspaceMemoryConfidence;
  evidence: string[];
}

export interface WorkspaceDataLoadingState {
  tasks: boolean;
  events: boolean;
  finance: boolean;
  habits: boolean;
  documents: boolean;
  learnAi: boolean;
  chat: boolean;
}

export interface WorkspaceSignalEngineInput {
  now?: Date;
  tasks: WorkspaceTaskSignal[];
  events: WorkspaceEventSignal[];
  transactions: WorkspaceFinanceSignal[];
  habits: unknown[];
  documents: unknown[];
  learnAiActivity: WorkspaceLearnAiSignal | null;
  loading: WorkspaceDataLoadingState;
}

export interface WorkspaceMemoryEngineInput extends WorkspaceSignalEngineInput {
  signals: WorkspaceSignal[];
  existingMemory: WorkspaceMemory;
  chatSessions: WorkspaceChatSignal[];
}

export interface WorkspaceMemoryEngineResult {
  updatedMemory: WorkspaceMemory;
  memoryInsights: WorkspaceMemoryInsights;
  hasChanges: boolean;
}

export interface WorkspaceGoalEngineInput {
  now?: Date;
  signals: WorkspaceSignal[];
  priority: WorkspacePriorityModel;
  personalization: WorkspacePersonalizationModel;
  memoryInsights: WorkspaceMemoryInsights;
  interactionFeedback: WorkspaceInteractionFeedback;
  decisionProfile?: WorkspaceDecisionProfile;
}

export interface WorkspacePlannerEngineInput {
  now?: Date;
  goal: WorkspaceGoal;
  signals: WorkspaceSignal[];
  decisionProfile?: WorkspaceDecisionProfile;
}

export interface WorkspaceApprovalEngineInput {
  now?: Date;
  plan: WorkspacePlan;
  toolResolutions?: ToolResolutionResult[];
}

export interface WorkspaceEngineInput extends WorkspaceSignalEngineInput {
  chatSessions: WorkspaceChatSignal[];
  signals: WorkspaceSignal[];
  decisionProfile: WorkspaceDecisionProfile;
  personalization: WorkspacePersonalizationModel;
  priority: WorkspacePriorityModel;
  interactionFeedback: WorkspaceInteractionFeedback;
  goal: WorkspaceGoal;
  plan: WorkspacePlan;
  toolResolutions: ToolResolutionResult[];
  approval: WorkspaceApprovalModel;
}

export interface WorkspaceToday {
  date: Date;
  label: string;
  greeting: string;
}

export interface WorkspaceSignals {
  isLoading: boolean;
  totalSignals: number;
  incompleteTasks: number;
  eventsToday: number;
  netThisMonth: number;
  netThisMonthLabel: string;
  tasksCreatedThisWeek: number;
}

export interface WorkspaceDailyStory {
  bullets: string[];
}

export interface WorkspaceReason {
  title: string;
  body: string;
  signalDomain?: WorkspaceSignalDomain;
}

export interface WorkspaceRecentLesson {
  title: string;
  progress: number;
  icon: WorkspaceIconKey;
}

export interface WorkspaceRecommendation {
  title: string;
  reason: string;
  icon: WorkspaceIconKey;
  target: WorkspaceNavigationTarget;
  signalDomain?: WorkspaceSignalDomain;
}

export interface WorkspaceRecentConversation {
  title: string;
  relativeTime: string;
}

export interface WorkspaceRightRail {
  statusMessage: string;
  recentLessons: WorkspaceRecentLesson[];
  recommendations: WorkspaceRecommendation[];
  recentConversation: WorkspaceRecentConversation | null;
  isChatLoading: boolean;
}

export interface WorkspaceAgentContext {
  tasks: ExecutionContextTask[];
  events: ExecutionContextEvent[];
  learningProgress: ExecutionLearningProgressSnapshot | null;
}

export interface WorkspaceWelcome {
  setupActions: WorkspaceSetupAction[];
  learningSignals: string[];
}

export interface Workspace {
  today: WorkspaceToday;
  isLowData: boolean;
  signals: WorkspaceSignals;
  hero: {
    title: string;
    summary: string;
    skills: WorkspaceSkill[];
  };
  suggestedActions: WorkspaceAction[];
  dailyStory: WorkspaceDailyStory;
  recommendationReasons: WorkspaceReason[];
  signalFeed: WorkspaceSignal[];
  decisionProfile: WorkspaceDecisionProfile;
  personalization: WorkspacePersonalizationModel;
  goal: WorkspaceGoal;
  plan: WorkspacePlan;
  toolResolutions: ToolResolutionResult[];
  approval: WorkspaceApprovalModel;
  agentContext: WorkspaceAgentContext;
  welcome: WorkspaceWelcome;
  rightRail: WorkspaceRightRail;
  refresh?: {
    tasks(): Promise<void>;
  };
}
