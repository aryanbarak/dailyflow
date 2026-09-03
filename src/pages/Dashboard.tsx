import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  WorkspaceReveal,
  WorkspaceRevealSection,
} from "@/components/animations/WorkspaceReveal";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Briefcase,
  Calendar,
  CheckSquare,
  FileText,
  Flame,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { FlowAIOrb } from "@/components/FlowAIOrb";
import { SmartflowAsciiVisual } from "@/components/smartflow";
import ChatPage from "@/pages/ChatPage";
import { useSetPageTitle } from "@/hooks/useSetPageTitle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { useWorkspace } from "@/features/workspace";
import { trackWorkspaceInteraction } from "@/features/workspace";
import type { ApprovalInteractionResult } from "@/features/agent/approvalInteraction";
import {
  SUPPORTED_READ_ONLY_TOOL_IDS,
  canStartReadOnlyRun,
  runReadOnlyTool,
  type ReadOnlyRuntimeResult,
  type ReadOnlyRunState,
} from "@/features/agent/readOnlyRuntime";
import type { ToolResolutionResult } from "@/features/agent/toolResolverTypes";
import {
  runWriteTool,
  type WriteRuntimeResult,
  type WriteRuntimeStatus,
} from "@/features/agent/writeRuntime";
import { StepApprovalDialog } from "@/features/workspace/components/StepApprovalDialog";
import { useT } from "@/i18n";
import type {
  WorkspaceIconKey,
  WorkspaceInteractionSource,
  WorkspaceInteractionType,
  WorkspaceNavigationTarget,
  WorkspaceRightRail,
  WorkspaceSignalDomain,
  WorkspaceWelcome,
  Workspace,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "@/features/workspace";

const workspaceIconMap = {
  book: BookOpen,
  briefcase: Briefcase,
  calendar: Calendar,
  check: CheckSquare,
  file: FileText,
  flame: Flame,
  message: MessageSquare,
  sparkles: Sparkles,
  wallet: Wallet,
} satisfies Record<WorkspaceIconKey, typeof BookOpen>;

function navigateToWorkspaceTarget(
  navigate: ReturnType<typeof useNavigate>,
  target: WorkspaceNavigationTarget,
) {
  if (target.initialPrompt) {
    navigate(target.route, {
      state: { initialPrompt: target.initialPrompt },
    });
    return;
  }
  navigate(target.route);
}

function domainForWorkspaceRoute(route: string): WorkspaceSignalDomain {
  if (route === "/tasks") return "tasks";
  if (route === "/calendar") return "calendar";
  if (route === "/finance") return "finance";
  if (route === "/documents") return "documents";
  if (route === "/learn-ai") return "learning";
  if (route === "/briefing/weekly") return "documents";
  if (route === "/journal") return "documents";
  return "learning";
}

function trackWorkspaceUiClick({
  type,
  domain,
  targetId,
  targetTitle,
  source,
  metadata,
}: {
  type: WorkspaceInteractionType;
  domain: WorkspaceSignalDomain;
  targetId?: string;
  targetTitle: string;
  source: WorkspaceInteractionSource;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  trackWorkspaceInteraction({
    type,
    domain,
    targetId,
    targetTitle,
    source,
    metadata,
  });
}

function trackAndNavigateToWorkspaceTarget(
  navigate: ReturnType<typeof useNavigate>,
  target: WorkspaceNavigationTarget,
  options: {
    type: WorkspaceInteractionType;
    source: WorkspaceInteractionSource;
    targetTitle: string;
    targetId?: string;
    domain?: WorkspaceSignalDomain;
    metadata?: Record<string, string | number | boolean | null>;
  },
) {
  trackWorkspaceUiClick({
    type: options.type,
    domain: options.domain ?? domainForWorkspaceRoute(target.route),
    targetId: options.targetId ?? target.route,
    targetTitle: options.targetTitle,
    source: options.source,
    metadata: options.metadata,
  });
  navigateToWorkspaceTarget(navigate, target);
}

type TaskCompleteWriteUiStatus =
  | "idle"
  | "awaiting_approval"
  | "approved"
  | "running"
  | "success"
  | "already_completed"
  | "denied"
  | "verification_failed"
  | "timeout"
  | "failed";

interface TaskCompleteWriteCandidate {
  step: WorkspacePlanStep;
  stepApproval: WorkspaceStepApproval;
  toolResolution: ToolResolutionResult;
  taskId: string;
  taskTitle: string;
  bindingKey: string;
}

function getTaskCompleteWriteCandidate(
  workspace: Workspace,
): TaskCompleteWriteCandidate | null {
  const candidates = workspace.plan.steps.flatMap((step) => {
    if (
      step.domain !== "tasks" ||
      step.actionType !== "complete" ||
      !step.targetId?.trim()
    ) {
      return [];
    }

    const toolResolution = workspace.toolResolutions.find(
      (resolution) => resolution.stepId === step.id,
    );
    const stepApproval = workspace.approval.stepApprovals.find(
      (approval) => approval.stepId === step.id,
    );
    const task = workspace.agentContext.tasks.find(
      (item) => item.id === step.targetId,
    );

    if (
      !toolResolution?.resolved ||
      toolResolution.status !== "resolved" ||
      toolResolution.toolId !== "tasks.complete" ||
      toolResolution.tool?.id !== "tasks.complete" ||
      toolResolution.tool.enabled !== true ||
      toolResolution.tool.mode !== "write" ||
      toolResolution.tool.riskLevel !== "medium" ||
      !stepApproval ||
      stepApproval.toolId !== "tasks.complete" ||
      stepApproval.targetId !== step.targetId ||
      stepApproval.approvalScope !== "single_step" ||
      stepApproval.riskLevel !== "medium" ||
      !task?.id ||
      !task.title
    ) {
      return [];
    }

    return [{
      step,
      stepApproval,
      toolResolution,
      taskId: task.id,
      taskTitle: task.title,
      bindingKey: `${step.id}:${toolResolution.toolId}:${task.id}:${stepApproval.approvalScope}:${stepApproval.riskLevel}`,
    }];
  });

  return candidates.length === 1 ? candidates[0] : null;
}

function approvalMatchesTaskCompleteCandidate(
  approval: WorkspaceStepApproval | null | undefined,
  candidate: TaskCompleteWriteCandidate | null,
) {
  return Boolean(
    candidate &&
      approval &&
      approval.status === "approved" &&
      approval.stepId === candidate.step.id &&
      approval.toolId === "tasks.complete" &&
      approval.targetId === candidate.taskId &&
      approval.approvalScope === "single_step" &&
      approval.riskLevel === "medium",
  );
}

function rejectedApprovalMatchesTaskCompleteCandidate(
  approval: WorkspaceStepApproval | null | undefined,
  candidate: TaskCompleteWriteCandidate | null,
) {
  return Boolean(
    candidate &&
      approval &&
      approval.status === "rejected" &&
      approval.stepId === candidate.step.id &&
      approval.toolId === "tasks.complete" &&
      approval.targetId === candidate.taskId,
  );
}

function writeStatusToUiStatus(
  status: WriteRuntimeStatus,
  alreadyCompleted?: boolean,
): TaskCompleteWriteUiStatus {
  if (status === "success") {
    return alreadyCompleted ? "already_completed" : "success";
  }
  if (status === "rejected" || status === "policy_denied" || status === "approval_required") {
    return "denied";
  }
  if (status === "verification_failed") return "verification_failed";
  return "failed";
}

function taskCompleteResultKey(
  status: TaskCompleteWriteUiStatus,
): "write_task_result_success" | "write_task_result_already_completed" | "write_task_result_approval_required" | "write_task_result_rejected" | "write_task_result_policy_denied" | "write_task_result_verification_failed" | "write_task_result_timeout" | "write_task_result_failed" | null {
  switch (status) {
    case "success":
      return "write_task_result_success";
    case "already_completed":
      return "write_task_result_already_completed";
    case "awaiting_approval":
      return "write_task_result_approval_required";
    case "denied":
      return "write_task_result_policy_denied";
    case "verification_failed":
      return "write_task_result_verification_failed";
    case "timeout":
      return "write_task_result_timeout";
    case "failed":
      return "write_task_result_failed";
    default:
      return null;
  }
}

// Home V2 final visual alignment: the FULL original Assistant Rail,
// restored from pre-#211 (the "Home / Flow AI v2 design cleanup" PR had
// trimmed this to a compact "Today + Relevant Context" summary behind a
// `showChatEntry` toggle -- the Product Owner's final contract explicitly
// rejected that trim and asked for the complete original panel back,
// unconditionally, with only its "Flow AI" copy renamed to "SmartFlow").
// No `showChatEntry` toggle anymore -- every call site (the cold-start
// WelcomeWorkspace path and normal Home's own sticky/stacked rail) always
// gets the same full panel: orb, Online status, CTA, Continue learning,
// Recommended today, Recent conversation.
// Exported (named, alongside the default `Dashboard`) so
// DashboardHomeFlowAiLayout.test.tsx can render it directly and assert on
// real DOM output.
export function FlowAIAssistantRail({ rail }: Readonly<{ rail: WorkspaceRightRail }>) {
  const navigate = useNavigate();
  const visibleLessons = rail.recentLessons.slice(0, 6);
  const visibleRecommendations = rail.recommendations.slice(0, 6);
  const visibleConversations = rail.recentConversation
    ? [rail.recentConversation].slice(0, 3)
    : [];

  return (
    <Card className="glass-card relative overflow-hidden">
      <SmartflowAsciiVisual
        variant="sphere"
        className="pointer-events-none absolute -right-24 -top-24 h-[300px] w-[300px] opacity-30"
      />

      <CardContent className="relative z-10 space-y-4 p-4">
        <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-visible">
              <FlowAIOrb
                size="md"
                state="presence"
                beam={false}
                particles
                glowIntensity={0.9}
                theme="transparent"
                ariaLabel="SmartFlow active assistant"
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">SmartFlow</p>
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-45" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  Online
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {rail.statusMessage}
                </p>
              </div>
            </div>
          </div>

        <Button
          size="sm"
          className="w-full gap-2 text-white border-0"
          style={{ background: "var(--gradient-primary)" }}
          onClick={() => {
            trackWorkspaceUiClick({
              type: "chat_opened",
              domain: "learning",
              targetId: "flow-ai-chat",
              targetTitle: "Chat with SmartFlow",
              source: "flow_ai",
            });
            navigate("/chat");
          }}
        >
          <MessageSquare className="w-4 h-4" />
          Chat with SmartFlow
        </Button>

        <div className="border-t border-border/35 pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Continue learning
          </p>
          <div className="space-y-2">
            {visibleLessons.map((lesson) => {
              const LessonIcon = workspaceIconMap[lesson.icon];
              return (
                <button
                  key={lesson.title}
                  type="button"
                  onClick={() => {
                    trackWorkspaceUiClick({
                      type: "learning_continued",
                      domain: "learning",
                      targetId: lesson.title,
                      targetTitle: lesson.title,
                      source: "right_rail_learning",
                      metadata: { progress: lesson.progress },
                    });
                    navigate("/learn-ai");
                  }}
                  className="group w-full rounded-lg border border-border/25 bg-background/15 px-2.5 py-2 text-left transition-colors hover:border-primary/35 hover:bg-primary/10"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="icon-tile h-7 w-7 rounded-md bg-primary/10">
                      <LessonIcon className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium">{lesson.title}</p>
                        <span className="text-[10px] text-muted-foreground">
                          {lesson.progress}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary/50">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${lesson.progress}%`,
                            background: "var(--gradient-primary)",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                trackWorkspaceUiClick({
                  type: "view_all_clicked",
                  domain: "learning",
                  targetId: "right-rail-learning-view-all",
                  targetTitle: "Continue learning",
                  source: "right_rail_learning",
                });
                navigate("/learn-ai");
              }}
              className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 hover:text-primary/85"
            >
              View all
            </button>
          </div>
        </div>

        <div className="border-t border-border/35 pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Recommended today
          </p>
          <div className="grid grid-cols-1 gap-2">
            {visibleRecommendations.map((item) => {
              const ItemIcon = workspaceIconMap[item.icon];
              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() =>
                    trackAndNavigateToWorkspaceTarget(navigate, item.target, {
                      type: "recommendation_opened",
                      source: "right_rail_recommendations",
                      targetId: item.title,
                      targetTitle: item.title,
                      domain: item.signalDomain,
                    })
                  }
                  className="group rounded-lg border border-border/25 bg-background/15 px-2.5 py-2 text-left transition-colors hover:border-primary/35 hover:bg-primary/10"
                >
                  <div className="flex gap-2.5">
                    <div className="icon-tile h-7 w-7 rounded-md bg-primary/10">
                      <ItemIcon className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-4">{item.title}</p>
                      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                        {item.reason}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() =>
                trackWorkspaceUiClick({
                  type: "view_all_clicked",
                  domain: "learning",
                  targetId: "right-rail-recommendations-view-all",
                  targetTitle: "Recommended today",
                  source: "right_rail_recommendations",
                })
              }
              className="rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 hover:text-primary/85"
            >
              View all
            </button>
          </div>
        </div>

        <div className="border-t border-border/35 pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Recent conversation
          </p>
          {rail.isChatLoading ? (
            <div className="rounded-lg border border-border/25 bg-background/15 p-3">
              <SkeletonBlock className="h-3 w-32" />
              <SkeletonBlock className="mt-2 h-2.5 w-16" />
            </div>
          ) : visibleConversations.length > 0 ? (
            <div className="space-y-2">
              {visibleConversations.map((conversation) => (
                <button
                  key={`${conversation.title}-${conversation.relativeTime}`}
                  type="button"
                  onClick={() => {
                    trackWorkspaceUiClick({
                      type: "conversation_opened",
                      domain: "learning",
                      targetId: conversation.title,
                      targetTitle: conversation.title,
                      source: "recent_conversation",
                      metadata: { relativeTime: conversation.relativeTime },
                    });
                    navigate("/chat");
                  }}
                  className="w-full rounded-lg border border-border/25 bg-background/15 p-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/10"
                >
                  <p className="truncate text-xs font-medium" dir="auto">
                    {conversation.title}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {conversation.relativeTime}
                  </p>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  trackWorkspaceUiClick({
                    type: "view_all_clicked",
                    domain: "learning",
                    targetId: "recent-conversation-view-all",
                    targetTitle: "Recent conversation",
                    source: "recent_conversation",
                  });
                  navigate("/chat");
                }}
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 hover:text-primary/85"
              >
                View all
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-border/25 bg-background/15 p-3">
              <p className="text-xs font-medium">No recent conversation yet.</p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Your latest SmartFlow thread will appear here.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WelcomeWorkspace({
  afterHero,
  welcome,
}: Readonly<{ afterHero?: ReactNode; welcome: WorkspaceWelcome }>) {
  const navigate = useNavigate();

  return (
    <>
      <WorkspaceRevealSection order={0}>
        <section className="relative overflow-hidden rounded-2xl border border-primary/10 bg-card/35 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-56"
            style={{
              background:
                "radial-gradient(ellipse 46% 34% at 50% 0%, rgba(196,184,255,0.13), transparent 72%), radial-gradient(ellipse 32% 22% at 12% 12%, rgba(34,211,238,0.055), transparent 74%)",
            }}
          />
          <div className="relative z-10 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/75">
              Welcome Workspace
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[1.8rem]">
              Welcome to SmartFlow.
            </h1>
            <p className="mt-3 text-base leading-7 text-foreground/90">
              I&apos;m still learning how you work.
            </p>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Add a few signals and I&apos;ll start preparing your workspace.
            </p>
          </div>
        </section>
      </WorkspaceRevealSection>
      {afterHero}

      <WorkspaceRevealSection order={1}>
        <section className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Setup Signals
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Start with these</h2>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {welcome.setupActions.map((action) => {
              const ActionIcon = workspaceIconMap[action.icon];
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={() =>
                    trackAndNavigateToWorkspaceTarget(navigate, action.target, {
                      type: "action_clicked",
                      source: "suggested_actions",
                      targetId: action.label,
                      targetTitle: action.label,
                    })
                  }
                  className="group flex min-h-[104px] flex-col rounded-xl border border-border/35 bg-background/25 p-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/10"
                >
                  <ActionIcon className="h-4 w-4 text-primary" />
                  <span className="mt-3 text-sm font-semibold">{action.label}</span>
                  <span className="mt-1 text-xs leading-5 text-muted-foreground">
                    {action.description}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </WorkspaceRevealSection>

      <WorkspaceRevealSection order={2}>
        <section className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              What I need to learn
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">The signals that shape your workspace</h2>
          </div>
          <div className="rounded-xl border border-border/25 bg-background/15 p-4 backdrop-blur-sm">
            <ul className="grid gap-2 text-sm text-foreground/90 sm:grid-cols-2">
              {welcome.learningSignals.map((item) => (
                <li key={item} className="flex gap-2 rounded-lg border border-border/25 bg-secondary/[0.06] px-3 py-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                  <span className="leading-5">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </WorkspaceRevealSection>
    </>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { t } = useT();
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [approvalDialogTarget, setApprovalDialogTarget] =
    useState<"generic" | "taskComplete" | null>(null);
  const [latestApprovalDecision, setLatestApprovalDecision] =
    useState<ApprovalInteractionResult | null>(null);
  const [taskCompleteApprovalDecision, setTaskCompleteApprovalDecision] =
    useState<ApprovalInteractionResult | null>(null);
  const [taskCompleteRunStatus, setTaskCompleteRunStatus] =
    useState<TaskCompleteWriteUiStatus>("idle");
  const [taskCompleteRunResult, setTaskCompleteRunResult] =
    useState<WriteRuntimeResult | null>(null);
  const [taskCompleteRefreshFailed, setTaskCompleteRefreshFailed] =
    useState(false);
  const [readOnlyRunStatus, setReadOnlyRunStatus] =
    useState<ReadOnlyRunState>("idle");
  const [readOnlyRunResult, setReadOnlyRunResult] =
    useState<ReadOnlyRuntimeResult | null>(null);
  const readOnlyRunInFlightRef = useRef(false);
  const taskCompleteRunInFlightRef = useRef(false);
  const workspace = useWorkspace();
  const taskCompleteWriteCandidate = useMemo(
    () => getTaskCompleteWriteCandidate(workspace),
    [workspace],
  );
  const pendingStepApproval = useMemo(
    () =>
      workspace.approval.stepApprovals.find(
        (approval) =>
          approval.status === "pending" &&
          approval.requiresApproval &&
          approval.stepId !== taskCompleteWriteCandidate?.step.id,
      ) ?? null,
    [taskCompleteWriteCandidate?.step.id, workspace.approval.stepApprovals],
  );
  const pendingApprovalStep = useMemo(
    () =>
      pendingStepApproval
        ? workspace.plan.steps.find((step) => step.id === pendingStepApproval.stepId) ?? null
        : null,
    [pendingStepApproval, workspace.plan.steps],
  );
  // Home V2 final visual alignment: the hero's compact tasks/events/
  // approvals counts line reuses the exact same pending/requiresApproval
  // predicate as the approval boundary card below -- no new backend call.
  const approvalsPendingCount = useMemo(
    () =>
      workspace.approval.stepApprovals.filter(
        (approval) => approval.status === "pending" && approval.requiresApproval,
      ).length,
    [workspace.approval.stepApprovals],
  );
  const approvalPresentationTool = useMemo(
    () =>
      pendingStepApproval?.toolId
        ? workspace.toolResolutions.find(
            (resolution) => resolution.stepId === pendingStepApproval.stepId,
          )?.tool ?? null
        : null,
    [pendingStepApproval, workspace.toolResolutions],
  );
  const readOnlyRuntimeResolution = useMemo(
    () =>
      workspace.toolResolutions.find(
        (resolution) =>
          resolution.resolved &&
          SUPPORTED_READ_ONLY_TOOL_IDS.includes(
            resolution.toolId as (typeof SUPPORTED_READ_ONLY_TOOL_IDS)[number],
          ),
      ) ?? null,
    [workspace.toolResolutions],
  );
  const readOnlyRuntimeStep = useMemo(
    () =>
      readOnlyRuntimeResolution
        ? workspace.plan.steps.find((step) => step.id === readOnlyRuntimeResolution.stepId) ?? null
        : null,
    [readOnlyRuntimeResolution, workspace.plan.steps],
  );
  const readOnlyRuntimeApproval = useMemo(
    () =>
      readOnlyRuntimeStep
        ? workspace.approval.stepApprovals.find((approval) => approval.stepId === readOnlyRuntimeStep.id) ?? null
        : null,
    [readOnlyRuntimeStep, workspace.approval.stepApprovals],
  );
  const approvedTaskCompleteApproval = useMemo(() => {
    const approval = taskCompleteApprovalDecision?.ok ? taskCompleteApprovalDecision.approval : null;
    return approvalMatchesTaskCompleteCandidate(approval, taskCompleteWriteCandidate) ? approval : null;
  }, [taskCompleteApprovalDecision, taskCompleteWriteCandidate]);

  useEffect(() => {
    setTaskCompleteApprovalDecision(null);
    setTaskCompleteRunResult(null);
    setTaskCompleteRefreshFailed(false);
    setTaskCompleteRunStatus(taskCompleteWriteCandidate ? "awaiting_approval" : "idle");
  }, [taskCompleteWriteCandidate?.bindingKey]);

  const handleApprovalDialogDecision = (result: ApprovalInteractionResult) => {
    if (approvalDialogTarget === "taskComplete") {
      if (result.ok && result.decision === "approved") {
        setTaskCompleteApprovalDecision(result);
        setTaskCompleteRunStatus(
          approvalMatchesTaskCompleteCandidate(result.approval, taskCompleteWriteCandidate)
            ? "approved"
            : "awaiting_approval",
        );
        return;
      }

      if (result.ok && result.decision === "rejected") {
        setTaskCompleteApprovalDecision(result);
        setTaskCompleteRunStatus(
          rejectedApprovalMatchesTaskCompleteCandidate(result.approval, taskCompleteWriteCandidate)
            ? "denied"
            : "awaiting_approval",
        );
        return;
      }

      if (result.ok && result.decision === "closed") {
        return;
      }

      setTaskCompleteApprovalDecision(result);
      setTaskCompleteRunStatus("awaiting_approval");
      return;
    }

    setLatestApprovalDecision(result);
  };

  const handleCloseApprovalDialog = () => {
    setApprovalDialogOpen(false);
    setApprovalDialogTarget(null);
  };

  const handleRunReadOnlyTool = async () => {
    if (readOnlyRunInFlightRef.current) return;
    if (!canStartReadOnlyRun(readOnlyRunStatus)) return;
    if (!readOnlyRuntimeStep || !readOnlyRuntimeResolution) return;

    readOnlyRunInFlightRef.current = true;
    setReadOnlyRunStatus("running");
    setReadOnlyRunResult(null);
    try {
      const result = await runReadOnlyTool({
        step: readOnlyRuntimeStep,
        toolResolution: readOnlyRuntimeResolution,
        approval: readOnlyRuntimeApproval,
        executionInput: {},
        executionContext: {
          tasks: workspace.agentContext.tasks,
          events: workspace.agentContext.events,
          learningProgress: workspace.agentContext.learningProgress,
          workspace,
        },
      });
      setReadOnlyRunStatus(
        result.status === "success" ? "success" : result.status === "failed" ? "failed" : "denied",
      );
      setReadOnlyRunResult(result);
    } finally {
      readOnlyRunInFlightRef.current = false;
    }
  };

  const handleRunTaskCompleteWrite = async () => {
    if (taskCompleteRunInFlightRef.current) return;
    if (!taskCompleteWriteCandidate || !approvedTaskCompleteApproval) return;

    taskCompleteRunInFlightRef.current = true;
    setTaskCompleteRunStatus("running");
    setTaskCompleteRunResult(null);
    setTaskCompleteRefreshFailed(false);
    try {
      const result = await runWriteTool({
        requestId: `write:tasks.complete:${taskCompleteWriteCandidate.step.id}:${taskCompleteWriteCandidate.taskId}:${Date.now()}`,
        step: taskCompleteWriteCandidate.step,
        toolResolution: taskCompleteWriteCandidate.toolResolution,
        approval: approvedTaskCompleteApproval,
        executionContext: {
          tasks: workspace.agentContext.tasks,
          events: workspace.agentContext.events,
          learningProgress: workspace.agentContext.learningProgress,
          workspace,
        },
      });

      setTaskCompleteRunResult(result);
      const nextStatus = writeStatusToUiStatus(result.status, result.alreadyCompleted);
      setTaskCompleteRunStatus(nextStatus);

      if (
        result.verified &&
        (nextStatus === "success" || nextStatus === "already_completed")
      ) {
        try {
          await workspace.refresh?.tasks();
        } catch {
          setTaskCompleteRefreshFailed(true);
        }
      }
    } finally {
      taskCompleteRunInFlightRef.current = false;
    }
  };

  useSetPageTitle("Dashboard", workspace.today.label);

  return (
    <WorkspaceReveal className="mx-auto max-w-[1180px] px-4 sm:px-6 lg:px-8 pt-5 lg:pt-6 pb-8 space-y-7 [&_.glass-card]:!bg-card/45 [&_.glass-card]:!border-primary/10 [&_.card-accent]:before:!opacity-25">
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-7">
          {workspace.isLowData ? (
            <WelcomeWorkspace
              afterHero={
                <WorkspaceRevealSection order={1} className="lg:hidden">
                  <FlowAIAssistantRail rail={workspace.rightRail} />
                </WorkspaceRevealSection>
              }
              welcome={workspace.welcome}
            />
          ) : (
            <>
      {/* Home V2 final visual correction (round 2): a more polished dark
          futuristic mountain/night landscape -- still no new image asset,
          backend, or content pipeline, and still built only from tokens/
          components this project already ships. Depth-layered look:
          - sky: the existing --flow-gradient-background radial, unchanged
          - two star layers: the exact dot-pattern technique Sidebar.tsx's
            own background already uses (radial-gradient tiled at a small
            size), just static here -- not a new visual language
          - a soft violet atmospheric glow (--flow-glow-violet) low behind
            the mountains
          - FOUR mountain depth layers (was two flat zig-zags): back-to-
            front from --flow-blue (softest/dimmest, distant) through
            --flow-primary-700/--flow-primary-900 to --flow-bg-deep
            (darkest, sharpest, foreground), each with more ridge detail
          - the moon: still the existing FlowAIOrb component, but sized
            "xl" instead of "hero" with a lower glow intensity so it reads
            as a clear glowing moon, not a large blur
          - a dark radial wash behind the greeting/stats text (its own
            z-10 layer, below the text) keeps them readable over the
            scenery regardless of which mountain layer sits behind them. */}
      <WorkspaceRevealSection order={0}>
        <section
          className="relative overflow-hidden rounded-2xl border border-primary/10 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
          style={{ background: "var(--flow-gradient-background)" }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                "radial-gradient(circle at center, hsl(248 95% 82% / 0.5) 0 0.3px, hsl(var(--primary) / 0.24) 0.42px, transparent 0.72px)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                "radial-gradient(circle at center, hsl(0 0% 100% / 0.4) 0 0.5px, transparent 0.9px)",
              backgroundSize: "42px 42px",
              backgroundPosition: "10px 6px",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
            style={{
              background:
                "radial-gradient(ellipse 70% 100% at 50% 100%, var(--flow-glow-violet), transparent 68%)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-4 -top-6 opacity-95 sm:right-4 sm:top-[-0.5rem]"
          >
            <FlowAIOrb size="xl" state="presence" beam={false} particles glowIntensity={0.5} theme="transparent" />
          </div>
          <svg
            aria-hidden="true"
            viewBox="0 0 400 160"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full sm:h-44"
          >
            <polygon
              points="0,160 0,110 40,95 80,105 120,88 160,100 200,85 240,98 280,90 320,102 360,92 400,100 400,160"
              fill="var(--flow-blue)"
              fillOpacity="0.28"
            />
            <polygon
              points="0,160 0,125 30,108 70,120 110,100 150,115 190,98 230,112 270,102 310,118 350,105 400,115 400,160"
              fill="var(--flow-primary-700)"
              fillOpacity="0.5"
            />
            <polygon
              points="0,160 0,140 25,118 65,132 105,110 145,128 185,108 225,124 265,112 305,130 345,116 400,128 400,160"
              fill="var(--flow-primary-900)"
              fillOpacity="0.85"
            />
            <polygon
              points="0,160 0,150 20,128 55,145 90,120 125,140 160,115 195,138 230,118 265,142 300,122 335,145 370,125 400,140 400,160"
              fill="var(--flow-bg-deep)"
            />
          </svg>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 60% 75% at 0% 0%, rgba(3,4,15,0.6), transparent 68%)",
            }}
          />

          <div className="relative z-10 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/75">
              {workspace.today.label}
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground sm:text-[1.7rem]">
              {workspace.hero.title}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {workspace.hero.summary}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {workspace.signals.isLoading ? (
                <>
                  <SkeletonBlock className="h-[52px] w-28 rounded-xl" />
                  <SkeletonBlock className="h-[52px] w-28 rounded-xl" />
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2.5 rounded-xl border border-border/25 bg-background/25 px-3 py-2 backdrop-blur-sm">
                    <div className="icon-tile h-8 w-8 shrink-0 rounded-lg bg-primary/15">
                      <CheckSquare className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] leading-4 text-muted-foreground">Open Tasks</p>
                      <p className="text-sm font-semibold leading-4 text-foreground">
                        {workspace.signals.incompleteTasks}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl border border-border/25 bg-background/25 px-3 py-2 backdrop-blur-sm">
                    <div className="icon-tile h-8 w-8 shrink-0 rounded-lg bg-primary/15">
                      <Calendar className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] leading-4 text-muted-foreground">Today&apos;s Events</p>
                      <p className="text-sm font-semibold leading-4 text-foreground">
                        {workspace.signals.eventsToday}
                      </p>
                    </div>
                  </div>
                  {approvalsPendingCount > 0 && (
                    <div className="flex items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 backdrop-blur-sm">
                      <div className="icon-tile h-8 w-8 shrink-0 rounded-lg bg-primary/15">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] leading-4 text-muted-foreground">Approvals</p>
                        <p className="text-sm font-semibold leading-4 text-foreground">
                          {approvalsPendingCount}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </WorkspaceRevealSection>

      {/* Home V2 final visual correction: these three conditional agent
          boundary surfaces are compact single-row action bars on Home, not
          large dashboard cards -- when more than one is present they no
          longer push SmartFlow Chat below the fold (PO's local screenshot
          finding). Same conditions, same handlers/onClick targets, same
          disabled logic, same approval-dialog wiring -- ONLY the JSX/
          classNames changed. The metadata grids (resolved tool/execution
          mode/risk/scope) and the reflection/preview detail blocks are
          dropped from this compact presentation because they aren't
          needed to make the approve/run decision -- the same detail (risk
          level, scope, ...) is already shown in StepApprovalDialog when
          the user clicks Review, before anything executes. Explicit
          approval and read-only semantics are completely unchanged; no
          action runs without the same button click as before. */}
      {pendingStepApproval && pendingApprovalStep && (
        <WorkspaceRevealSection order={2}>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {t("approval_card_title")}
              </p>
              {latestApprovalDecision?.ok && latestApprovalDecision.decision !== "closed" && (
                <p className="mt-0.5 truncate text-[11px] font-medium text-primary">
                  {latestApprovalDecision.decision === "approved"
                    ? t("approval_decision_approved")
                    : t("approval_decision_rejected")}
                </p>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setApprovalDialogTarget("generic");
                setApprovalDialogOpen(true);
              }}
              className="shrink-0"
            >
              {t("approval_review_action")}
            </Button>
          </div>
        </WorkspaceRevealSection>
      )}

      {taskCompleteWriteCandidate && (
        <WorkspaceRevealSection order={2}>
          <div className="rounded-lg border border-primary/20 bg-card/40 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">
                  {t("write_task_title")}: {taskCompleteWriteCandidate.taskTitle}
                </p>
                {taskCompleteRunStatus === "approved" && (
                  <p className="mt-0.5 truncate text-[11px] font-medium text-primary">
                    {t("write_task_approved_ready")}
                  </p>
                )}
                {taskCompleteRunStatus === "running" && (
                  <p className="mt-0.5 truncate text-[11px] font-medium text-primary" aria-live="polite">
                    {t("write_task_running_state")}
                  </p>
                )}
                {taskCompleteRunStatus === "denied" && !taskCompleteRunResult && (
                  <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground" aria-live="polite">
                    {t(
                      taskCompleteApprovalDecision?.ok &&
                        taskCompleteApprovalDecision.decision === "rejected"
                        ? "write_task_result_rejected"
                        : "write_task_result_policy_denied",
                    )}
                  </p>
                )}
                {taskCompleteRunResult && (
                  <p className="mt-0.5 truncate text-[11px] font-medium text-primary" aria-live="polite">
                    {t(taskCompleteResultKey(taskCompleteRunStatus) ?? "write_task_result_failed")}
                  </p>
                )}
                {taskCompleteRefreshFailed && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {t("write_task_refresh_failed")}
                  </p>
                )}
              </div>

              {approvedTaskCompleteApproval ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleRunTaskCompleteWrite()}
                  disabled={taskCompleteRunStatus === "running" || Boolean(taskCompleteRunResult)}
                  className="shrink-0"
                >
                  {taskCompleteRunStatus === "running"
                    ? t("agent_run_running")
                    : t("write_task_complete_button")}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setApprovalDialogTarget("taskComplete");
                    setApprovalDialogOpen(true);
                  }}
                  disabled={taskCompleteRunStatus === "running"}
                  className="shrink-0"
                >
                  {t("approval_review_action")}
                </Button>
              )}
            </div>
          </div>
        </WorkspaceRevealSection>
      )}

      {readOnlyRuntimeStep && readOnlyRuntimeResolution && (
        <WorkspaceRevealSection order={2}>
          <div className="rounded-lg border border-primary/20 bg-card/40 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">
                  {readOnlyRuntimeStep.title}
                </p>
                {readOnlyRunResult && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {readOnlyRunResult.safeSummary}
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleRunReadOnlyTool()}
                disabled={readOnlyRunStatus === "running"}
                className="shrink-0"
              >
                {readOnlyRunStatus === "running"
                  ? t("agent_run_running")
                  : t("agent_run_read_only_action")}
              </Button>
            </div>
          </div>
        </WorkspaceRevealSection>
      )}

      {/* Home V2 final visual alignment: SmartFlow chat is the dominant
          surface, and the LAST thing in the main column (spec section 4/5)
          -- the real ChatPage, embedded (not a promo card that links out
          to /chat). `embedded` only changes ChatPage's own root height/
          sticky classes (see ChatPage.tsx); every other behaviour
          (messages, composer, approval cards, task/calendar previews,
          execution state, RTL) is exactly the same component /chat uses.
          No other dashboard-style cards or modules render after this --
          the shortcut/insights/playlist widgets this main column used to
          end with are removed from Home's composition per the Product
          Owner's final contract; none of those underlying components were
          deleted from the codebase, just no longer referenced here (see
          DashboardHomeFlowAiLayout.test.tsx for the exact list). */}
      <WorkspaceRevealSection order={1}>
        <div className="h-[560px] overflow-hidden rounded-2xl border border-border/30 bg-card/20 lg:h-[calc(100vh-230px)] lg:min-h-[560px]">
          <ChatPage embedded />
        </div>
      </WorkspaceRevealSection>

      {/* Home V2 final visual alignment: on mobile/tablet the Assistant
          Rail becomes secondary -- it stacks below chat instead of living
          in a separate sticky column (spec section 7). Desktop renders the
          identical, full, unconditional FlowAIAssistantRail as its own
          sticky column instead (below, outside this WelcomeWorkspace/
          isLowData branch's `<div className="space-y-7">` column) -- same
          component, same data, just a different placement per breakpoint. */}
      <WorkspaceRevealSection order={2} className="lg:hidden">
        <FlowAIAssistantRail rail={workspace.rightRail} />
      </WorkspaceRevealSection>
            </>
          )}
        </div>

        {/* Home V2 final visual alignment: the FULL Assistant Rail, sticky
            beside the dominant chat panel on desktop -- restored
            unconditionally for both the cold-start WelcomeWorkspace branch
            and normal Home, exactly as it rendered before PR #211 (this
            section sits outside the isLowData ternary above for the same
            reason it did pre-#211: one rail, same place, regardless of
            which main-column branch is showing). */}
        <WorkspaceRevealSection order={2} className="hidden lg:sticky lg:top-6 lg:block">
          <FlowAIAssistantRail rail={workspace.rightRail} />
        </WorkspaceRevealSection>
      </div>
      <StepApprovalDialog
        open={approvalDialogOpen}
        step={
          approvalDialogTarget === "taskComplete"
            ? taskCompleteWriteCandidate?.step ?? null
            : pendingApprovalStep
        }
        stepApproval={
          approvalDialogTarget === "taskComplete"
            ? taskCompleteWriteCandidate?.stepApproval ?? null
            : pendingStepApproval
        }
        tool={
          approvalDialogTarget === "taskComplete"
            ? taskCompleteWriteCandidate?.toolResolution.tool ?? null
            : approvalPresentationTool
        }
        onClose={handleCloseApprovalDialog}
        onDecision={handleApprovalDialogDecision}
      />
    </WorkspaceReveal>
  );
}
