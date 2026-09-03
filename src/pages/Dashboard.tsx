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
  Music,
  Pause,
  Play,
  Plus,
  Sparkles,
  Wallet,
} from "lucide-react";
import { AddHabitModal } from "@/features/habits/components/AddHabitModal";
import { FlowAIOrb } from "@/components/FlowAIOrb";
import { SmartflowAsciiVisual } from "@/components/smartflow";
import { TodaysFocusWidget } from "@/components/dashboard/TodaysFocusWidget";
import { AiInsightsWidget } from "@/components/dashboard/AiInsightsWidget";
import ChatPage from "@/pages/ChatPage";
import { useSetPageTitle } from "@/hooks/useSetPageTitle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { cn } from "@/lib/utils";
import { useMusicPlayer, loadHistory } from "@/hooks/useMusicPlayer";
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
import { ReflectionSummary } from "@/features/workspace/components/ReflectionSummary";
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

function FocusPlaylistCard() {
  const navigate = useNavigate();
  const { currentTrack, isPlaying, pause, resume, playYouTube } =
    useMusicPlayer();
  const lastPlayed = useMemo(() => loadHistory()[0] ?? null, []);

  const isYouTube = currentTrack?.type === "youtube";
  const trackTitle = currentTrack
    ? currentTrack.type === "youtube"
      ? currentTrack.title
      : currentTrack.name
    : null;
  const videoId = isYouTube ? currentTrack.videoId : null;
  const thumbnailUrl = videoId
    ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    : null;

  return (
    <Card className="glass-card">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-3">
          <div className="icon-tile w-7 h-7 rounded-md">
            <Music className="w-3.5 h-3.5 text-primary" />
          </div>
          <p className="text-sm font-semibold">Focus Playlist</p>
        </div>

        {currentTrack ? (
          <div className="flex items-center gap-3">
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt=""
                className="w-12 h-12 rounded-md object-cover shrink-0"
              />
            ) : (
              <div className="icon-tile w-12 h-12 rounded-md">
                <Music className="w-5 h-5 text-primary" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{trackTitle}</p>
              <p className="text-[10px] text-muted-foreground">
                {isPlaying ? "Now playing" : "Paused"}
              </p>
            </div>
            <button
              type="button"
              aria-label={isPlaying ? "Pause" : "Resume"}
              onClick={isPlaying ? pause : resume}
              className="icon-tile w-8 h-8 rounded-full shrink-0 hover:bg-primary/20 transition-colors"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 text-primary" />
              ) : (
                <Play className="w-4 h-4 text-primary ml-0.5" />
              )}
            </button>
          </div>
        ) : lastPlayed ? (
          <div className="flex items-center gap-3">
            <img
              src={`https://img.youtube.com/vi/${lastPlayed.videoId}/mqdefault.jpg`}
              alt=""
              className="w-12 h-12 rounded-md object-cover shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">
                {lastPlayed.title}
              </p>
              <p className="text-[10px] text-muted-foreground">Last played</p>
            </div>
            <button
              type="button"
              aria-label="Play"
              onClick={() =>
                playYouTube(lastPlayed.videoId, lastPlayed.title)
              }
              className="icon-tile w-8 h-8 rounded-full shrink-0 hover:bg-primary/20 transition-colors"
            >
              <Play className="w-4 h-4 text-primary ml-0.5" />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              No recent tracks
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-2"
              onClick={() => navigate("/music")}
            >
              <Music className="w-3.5 h-3.5" />
              Browse Music
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Home / Flow AI v2 design cleanup: the "Smart Context" rail's first (and
// most important) group -- a compact, read-only "what's happening today"
// summary. Deliberately not its own Card (TodaysFocusWidget already
// supplies its own card chrome below) so it doesn't nest cards inside
// cards. Uses only data Dashboard already had available (workspace.agentContext.events
// for `nextEvent`, the same pending-approval predicate the existing
// approval boundary card already uses for `approvalsPendingCount`) -- no
// new fetch, no new recommendation logic.
function HomeTodayContext({
  nextEvent,
  approvalsPendingCount,
}: Readonly<{
  nextEvent: { title: string; startLabel: string } | null;
  approvalsPendingCount: number;
}>) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        Today
      </p>
      {(nextEvent || approvalsPendingCount > 0) && (
        <div className="space-y-2">
          {nextEvent && (
            <div className="rounded-lg border border-border/25 bg-background/15 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Next event
              </p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">{nextEvent.title}</p>
              <p className="text-[11px] text-muted-foreground">{nextEvent.startLabel}</p>
            </div>
          )}
          {approvalsPendingCount > 0 && (
            <div className="rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2">
              <p className="text-xs font-medium text-foreground">
                {approvalsPendingCount} pending approval{approvalsPendingCount > 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>
      )}
      <TodaysFocusWidget />
    </div>
  );
}

// Home / Flow AI v2 design cleanup: `showChatEntry` toggles the orb/status/
// "Chat with Flow AI" CTA block. On Home itself the real, working chat
// panel is already the dominant surface (see Dashboard's own composition
// below), so that CTA would just point at itself -- `showChatEntry={false}`
// there renders this as a plain "Relevant Context" supporting card instead,
// and ALSO gates out Continue learning / Recommended today (Home V2 design
// contract correction: those are permanent-dashboard-widget content,
// approved to be removed/reduced from normal Home -- they only remain on
// the showChatEntry=true cold-start path). The welcome (cold-start) flow
// still passes no prop (defaults to true), unchanged from before this
// task, since it has no inline chat panel yet.
// Exported (named, alongside the default `Dashboard`) solely so
// DashboardHomeFlowAiLayout.test.tsx can render it directly and assert on
// real DOM output instead of source-text regexes for this distinction.
export function FlowAIAssistantRail({
  rail,
  showChatEntry = true,
}: Readonly<{ rail: WorkspaceRightRail; showChatEntry?: boolean }>) {
  const navigate = useNavigate();
  const visibleLessons = rail.recentLessons.slice(0, 6);
  const visibleRecommendations = rail.recommendations.slice(0, 6);
  const visibleConversations = rail.recentConversation
    ? [rail.recentConversation].slice(0, 3)
    : [];

  return (
    <Card className="glass-card relative overflow-hidden">
      {showChatEntry && (
        <SmartflowAsciiVisual
          variant="sphere"
          className="pointer-events-none absolute -right-24 -top-24 h-[300px] w-[300px] opacity-30"
        />
      )}

      <CardContent className="relative z-10 space-y-4 p-4">
        {showChatEntry ? (
          <>
            <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-visible">
                  <FlowAIOrb
                    size="md"
                    state="presence"
                    beam={false}
                    particles
                    glowIntensity={0.9}
                    theme="transparent"
                    ariaLabel="Flow AI active assistant"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Flow AI</p>
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
                  targetTitle: "Chat with Flow AI",
                  source: "flow_ai",
                });
                navigate("/chat");
              }}
            >
              <MessageSquare className="w-4 h-4" />
              Chat with Flow AI
            </Button>
          </>
        ) : (
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Relevant Context
          </p>
        )}

        {/* Home V2 design contract correction: Continue learning and
            Recommended today are permanent-dashboard-widget content --
            approved to be removed/reduced from normal Home (spec's Home V2
            contract). They stay ONLY on the cold-start/WelcomeWorkspace
            path (showChatEntry=true, this component's pre-existing default
            behaviour, deliberately untouched here) and are never rendered
            for normal Home's "Relevant Context" group
            (showChatEntry=false) -- see the two `{showChatEntry && (...)}`
            guards below and the FlowAIAssistantRail usage sites in
            Dashboard's own return JSX. */}
        {showChatEntry && (
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
        )}

        {showChatEntry && (
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
        )}

        {/* Recent conversation is the ONLY "Relevant Context" content for
            normal Home (showChatEntry=false) -- Continue learning and
            Recommended today are gated out above. When showChatEntry is
            false this is the first block under the "Relevant Context"
            label, so it gets no top border there (mirrors HomeTodayContext's
            own first-block treatment); when true it's the third block
            after the CTA/Continue-learning/Recommended-today stack, same
            as before this correction. */}
        <div className={cn("pt-3", showChatEntry ? "border-t border-border/35" : "border-t-0")}>
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
                Your latest Flow AI thread will appear here.
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
  const [showAddHabit, setShowAddHabit] = useState(false);
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
  // Home / Flow AI v2 design cleanup: the Smart Context rail's compact
  // "Today" summary -- both derived from data `useWorkspace()` already
  // fetches (workspace.agentContext.events / workspace.approval.stepApprovals),
  // no new backend call. `approvalsPendingCount` reuses the exact same
  // pending/requiresApproval predicate as the approval boundary card above.
  const approvalsPendingCount = useMemo(
    () =>
      workspace.approval.stepApprovals.filter(
        (approval) => approval.status === "pending" && approval.requiresApproval,
      ).length,
    [workspace.approval.stepApprovals],
  );
  const nextEvent = useMemo(() => {
    const nowIso = new Date().toISOString();
    const upcoming = workspace.agentContext.events
      .filter((event) => {
        const start = event.dateTimeStart ?? event.start;
        return Boolean(start) && start! >= nowIso;
      })
      .sort((a, b) => (a.dateTimeStart ?? a.start ?? "").localeCompare(b.dateTimeStart ?? b.start ?? ""));
    const soonest = upcoming[0];
    if (!soonest) return null;
    const start = soonest.dateTimeStart ?? soonest.start;
    if (!start) return null;
    return {
      title: soonest.title,
      startLabel: new Date(start).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    };
  }, [workspace.agentContext.events]);
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
      {/* Home / Flow AI v2 design cleanup: compact greeting + tiny daily
          brief, replacing the old hero card's decorative gradient, the
          "How I can help today" skills grid, and the bordered "Today's
          Signals" box with one small counts line -- metrics as supporting
          context, not a primary card (spec section 2/7). Net-this-month is
          intentionally not repeated here (still on the Finance page); the
          three counts mirrored below are the same predicate/fields the
          rest of this file already used for them. */}
      <WorkspaceRevealSection order={0}>
        <section className="px-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/70">
            {workspace.today.label}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-[1.7rem]">
            {workspace.hero.title}
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
            {workspace.hero.summary}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            {workspace.signals.isLoading ? (
              <SkeletonBlock className="h-3.5 w-40" />
            ) : (
              <>
                <span>
                  <span className="font-medium text-foreground">{workspace.signals.incompleteTasks}</span> tasks
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <span className="font-medium text-foreground">{workspace.signals.eventsToday}</span> events
                </span>
                {approvalsPendingCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      <span className="font-medium text-foreground">{approvalsPendingCount}</span> approval
                      {approvalsPendingCount > 1 ? "s" : ""}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      </WorkspaceRevealSection>

      {pendingStepApproval && pendingApprovalStep && (
        <WorkspaceRevealSection order={2}>
          <section className="rounded-xl border border-primary/15 bg-primary/[0.035] p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary/75">
                  {t("approval_boundary_label")}
                </p>
                <h2 className="mt-1 text-sm font-semibold tracking-tight">
                  {t("approval_card_title")}
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("approval_card_description")}
                </p>
                {latestApprovalDecision?.ok && latestApprovalDecision.decision !== "closed" && (
                  <p className="mt-2 text-xs font-medium text-primary">
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
          </section>
        </WorkspaceRevealSection>
      )}

      {taskCompleteWriteCandidate && (
        <WorkspaceRevealSection order={2}>
          <section className="rounded-xl border border-primary/15 bg-card/45 p-3 sm:p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-primary/75">
                    {t("write_task_boundary_label")}
                  </p>
                  <h2 className="mt-1 text-sm font-semibold tracking-tight">
                    {t("write_task_title")}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t("write_task_description")}
                  </p>
                </div>

                <div className="rounded-lg border border-border/30 bg-background/25 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("write_task_target_label")}
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {taskCompleteWriteCandidate.taskTitle}
                  </p>
                </div>

                <div className="grid gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-border/25 bg-background/25 px-3 py-2">
                    <p className="font-semibold text-muted-foreground">{t("agent_resolved_tool")}</p>
                    <p className="mt-1 font-medium text-foreground">tasks.complete</p>
                  </div>
                  <div className="rounded-lg border border-border/25 bg-background/25 px-3 py-2">
                    <p className="font-semibold text-muted-foreground">{t("agent_execution_mode")}</p>
                    <p className="mt-1 font-medium text-foreground">{t("write_task_mode_write")}</p>
                  </div>
                  <div className="rounded-lg border border-border/25 bg-background/25 px-3 py-2">
                    <p className="font-semibold text-muted-foreground">{t("approval_risk_level")}</p>
                    <p className="mt-1 font-medium text-foreground">{t("write_task_risk_medium")}</p>
                  </div>
                  <div className="rounded-lg border border-border/25 bg-background/25 px-3 py-2">
                    <p className="font-semibold text-muted-foreground">{t("approval_scope")}</p>
                    <p className="mt-1 font-medium text-foreground">{t("write_task_scope_this_task")}</p>
                  </div>
                </div>

                {taskCompleteRunStatus === "approved" && (
                  <p className="text-xs font-medium text-primary">
                    {t("write_task_approved_ready")}
                  </p>
                )}

                {taskCompleteRunStatus === "running" && (
                  <p className="text-xs font-medium text-primary" aria-live="polite">
                    {t("write_task_running_state")}
                  </p>
                )}

                {taskCompleteRunStatus === "denied" && !taskCompleteRunResult && (
                  <p className="text-xs font-medium text-muted-foreground" aria-live="polite">
                    {t(
                      taskCompleteApprovalDecision?.ok &&
                        taskCompleteApprovalDecision.decision === "rejected"
                        ? "write_task_result_rejected"
                        : "write_task_result_policy_denied",
                    )}
                  </p>
                )}

                {taskCompleteRunResult && (
                  <div
                    className="rounded-lg border border-primary/15 bg-primary/10 px-3 py-2"
                    aria-live="polite"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/75">
                      {t("agent_result_label")}
                    </p>
                    <p className="mt-1 text-xs font-medium text-foreground">
                      {t(
                        taskCompleteResultKey(taskCompleteRunStatus) ??
                          "write_task_result_failed",
                      )}
                    </p>
                    {(taskCompleteRunStatus === "success" ||
                      taskCompleteRunStatus === "already_completed") && (
                      <div className="mt-3 rounded-lg border border-border/30 bg-background/20 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          {t("reflection_section_label")}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {taskCompleteRunStatus === "already_completed"
                            ? t("write_task_reflection_already_completed")
                            : t("write_task_reflection_verified")}
                        </p>
                      </div>
                    )}
                    {taskCompleteRefreshFailed && (
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {t("write_task_refresh_failed")}
                      </p>
                    )}
                  </div>
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
          </section>
        </WorkspaceRevealSection>
      )}

      {readOnlyRuntimeStep && readOnlyRuntimeResolution && (
        <WorkspaceRevealSection order={2}>
          <section className="rounded-xl border border-primary/15 bg-card/45 p-3 sm:p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-primary/75">
                    {t("agent_vertical_slice_label")}
                  </p>
                  <h2 className="mt-1 text-sm font-semibold tracking-tight">
                    {readOnlyRuntimeStep.title}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {readOnlyRuntimeStep.description}
                  </p>
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded-lg border border-border/25 bg-background/25 px-3 py-2">
                    <p className="font-semibold text-muted-foreground">{t("agent_resolved_tool")}</p>
                    <p className="mt-1 font-medium text-foreground">{readOnlyRuntimeResolution.toolId}</p>
                  </div>
                  <div className="rounded-lg border border-border/25 bg-background/25 px-3 py-2">
                    <p className="font-semibold text-muted-foreground">{t("agent_execution_mode")}</p>
                    <p className="mt-1 font-medium text-foreground">{t("agent_read_only")}</p>
                  </div>
                  <div className="rounded-lg border border-border/25 bg-background/25 px-3 py-2">
                    <p className="font-semibold text-muted-foreground">{t("agent_approval_state")}</p>
                    <p className="mt-1 font-medium text-foreground">
                      {readOnlyRuntimeApproval?.status ?? t("approval_not_declared")}
                    </p>
                  </div>
                </div>
                {readOnlyRunResult && (
                  <div className="rounded-lg border border-primary/15 bg-primary/10 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/75">
                      {t("agent_result_label")}
                    </p>
                    <p className="mt-1 text-xs font-medium text-foreground">
                      {readOnlyRunResult.safeSummary}
                    </p>
                    {readOnlyRunResult.safePreviewItems.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {readOnlyRunResult.safePreviewItems.map((title) => (
                          <li key={title}>{title}</li>
                        ))}
                      </ul>
                    )}
                    <ReflectionSummary result={readOnlyRunResult} />
                  </div>
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
          </section>
        </WorkspaceRevealSection>
      )}

      {/* Home / Flow AI v2 design cleanup: Flow AI is the dominant surface
          on Home now -- the real ChatPage, embedded (not a promo card that
          links out to /chat). `embedded` only changes ChatPage's own root
          height/sticky classes (see ChatPage.tsx); every other behaviour
          (messages, composer, approval cards, task/calendar previews,
          execution state, RTL) is exactly the same component /chat uses.
          The panel's own height is set here, by this parent, since
          embedding is what makes ChatPage's normal `lg:h-screen` wrong. */}
      <WorkspaceRevealSection order={1}>
        <div className="h-[560px] overflow-hidden rounded-2xl border border-border/30 bg-card/20 lg:h-[calc(100vh-230px)] lg:min-h-[560px]">
          <ChatPage embedded />
        </div>
      </WorkspaceRevealSection>

      {/* Home / Flow AI v2 design cleanup: Smart Context, mobile placement
          -- stacks below the chat panel (spec section 8), never squeezing
          it. Desktop shows the same two groups in the sticky rail instead
          (below, outside this WelcomeWorkspace/isLowData branch's `<div
          className="space-y-7">` column). */}
      <WorkspaceRevealSection order={2} className="space-y-4 lg:hidden">
        <HomeTodayContext nextEvent={nextEvent} approvalsPendingCount={approvalsPendingCount} />
        <FlowAIAssistantRail rail={workspace.rightRail} showChatEntry={false} />
      </WorkspaceRevealSection>

      <WorkspaceRevealSection order={3}>
        <AiInsightsWidget />
      </WorkspaceRevealSection>

      <WorkspaceRevealSection order={3}>
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-4">
          <Card className="glass-card">
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center gap-3">
                <div className="icon-tile w-7 h-7 rounded-md">
                  <Plus className="w-3.5 h-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Manual Actions</p>
                  <p className="text-xs text-muted-foreground">Still available when you need a direct shortcut.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => {
                    trackWorkspaceUiClick({
                      type: "action_clicked",
                      domain: "tasks",
                      targetId: "manual-new-task",
                      targetTitle: "New Task",
                      source: "manual_actions",
                    });
                    navigate("/tasks");
                  }}
                  className="flex items-center gap-2 rounded-lg border border-border/45 bg-secondary/15 px-3 py-2.5 text-left text-foreground transition-colors hover:bg-secondary/35 hover:border-primary/30"
                >
                  <div className="icon-tile w-6 h-6 rounded-md bg-violet-500/15">
                    <CheckSquare className="w-3.5 h-3.5 text-violet-400" />
                  </div>
                  <span className="text-[11px] font-medium">New Task</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    trackWorkspaceUiClick({
                      type: "action_clicked",
                      domain: "documents",
                      targetId: "manual-journal",
                      targetTitle: "Journal",
                      source: "manual_actions",
                    });
                    navigate("/journal");
                  }}
                  className="flex items-center gap-2 rounded-lg border border-border/45 bg-secondary/15 px-3 py-2.5 text-left text-foreground transition-colors hover:bg-secondary/35 hover:border-primary/30"
                >
                  <div className="icon-tile w-6 h-6 rounded-md bg-blue-500/15">
                    <BookOpen className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                  <span className="text-[11px] font-medium">Journal</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    trackWorkspaceUiClick({
                      type: "action_clicked",
                      domain: "habits",
                      targetId: "manual-add-habit",
                      targetTitle: "Add Habit",
                      source: "manual_actions",
                    });
                    setShowAddHabit(true);
                  }}
                  className="flex items-center gap-2 rounded-lg border border-border/45 bg-secondary/15 px-3 py-2.5 text-left text-foreground transition-colors hover:bg-secondary/35 hover:border-primary/30"
                >
                  <div className="icon-tile w-6 h-6 rounded-md bg-orange-500/15">
                    <Flame className="w-3.5 h-3.5 text-orange-400" />
                  </div>
                  <span className="text-[11px] font-medium">Add Habit</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    trackWorkspaceUiClick({
                      type: "action_clicked",
                      domain: "finance",
                      targetId: "manual-record-expense",
                      targetTitle: "Record Expense",
                      source: "manual_actions",
                    });
                    navigate("/finance");
                  }}
                  className="flex items-center gap-2 rounded-lg border border-border/45 bg-secondary/15 px-3 py-2.5 text-left text-foreground transition-colors hover:bg-secondary/35 hover:border-primary/30"
                >
                  <div className="icon-tile w-6 h-6 rounded-md bg-emerald-500/15">
                    <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <span className="text-[11px] font-medium">Record Expense</span>
                </button>
              </div>
            </CardContent>
          </Card>
          <FocusPlaylistCard />
          {showAddHabit && (
            <AddHabitModal onClose={() => setShowAddHabit(false)} />
          )}
        </section>
      </WorkspaceRevealSection>
            </>
          )}
        </div>

        {/* Home / Flow AI v2 design cleanup: Smart Context, desktop
            placement -- the same two groups as the mobile stack above,
            sticky beside the dominant chat panel rather than a second
            dashboard's worth of cards (spec section 4). */}
        <WorkspaceRevealSection order={2} className="hidden space-y-4 lg:sticky lg:top-6 lg:block">
          {!workspace.isLowData && (
            <HomeTodayContext nextEvent={nextEvent} approvalsPendingCount={approvalsPendingCount} />
          )}
          <FlowAIAssistantRail rail={workspace.rightRail} showChatEntry={workspace.isLowData} />
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
