import { type ReactNode, useMemo, useState } from "react";
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
  ChevronRight,
  FileText,
  Flame,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { FlowAIOrb } from "@/components/FlowAIOrb";
import { cn } from "@/lib/utils";
import ChatPage from "@/pages/ChatPage";
import { useSetPageTitle } from "@/hooks/useSetPageTitle";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { SmartflowAsciiVisual } from "@/components/smartflow";
import { useWorkspace } from "@/features/workspace";
import { trackWorkspaceInteraction } from "@/features/workspace";
import { useHabits } from "@/features/habits/useHabits";
import { localeFor, useT, type TranslationKey } from "@/i18n";

// I18N-SWEEP-1: the workspace engines emit fixed English copy that the
// Home tests pin; translate at the render layer by exact-string lookup.
// The en dictionary values are byte-identical to the engine strings, so
// English output (and every pinned test) is unchanged.
const ENGINE_STATUS_KEYS: Record<string, TranslationKey> = {
  "I'm learning from your first workspace signals.": "dashboard_status_learning",
  "Always learning from your workspace.": "dashboard_status_always",
};
function translateEngineCopy(
  text: string,
  t: (key: TranslationKey) => string,
  map: Record<string, TranslationKey>,
): string {
  const key = map[text];
  return key ? t(key) : text;
}

// PO decision (2026-09-05): the hero's greeting/goal H1 is REMOVED --
// the hero shows only the orb + date lockup. workspace.hero.title is
// still computed by the engine (other consumers unaffected), it just no
// longer renders on Home.
import type { ToolResolutionResult } from "@/features/agent/toolResolverTypes";
import { StepApprovalDialog } from "@/features/workspace/components/StepApprovalDialog";
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

// SmartFlow Home frozen design handoff §8 (REV 2): the FULL approved
// Assistant Rail -- animated FlowAIOrb (the REAL existing component,
// exactly the mount the handoff freezes), "SmartFlow", Online ping,
// status line, then the five approved sections in order: Pending
// Approvals · AI Suggestions · Continue Learning · Recommended Today ·
// Recent Conversation. REV 2 removed the "Chat with SmartFlow" CTA --
// Home itself IS the SmartFlow conversation, so the CTA was redundant.
// All data is EXISTING Dashboard/workspace/runtime data composed in by
// the caller (no new backends/engines): approvals come from the same
// runtime predicates the approval dialog uses, suggestions from
// workspace.suggestedActions, everything else from WorkspaceRightRail.
// The body is its own independent scroller (flex-1/min-h-0/overflow-y-auto)
// so the rail's height can never influence the chat composer.
// Exported (named, alongside the default `Dashboard`) so
// DashboardHomeFlowAiLayout.test.tsx can render it directly and assert on
// real DOM output.
export interface AssistantRailApprovalItem {
  readonly title: string;
  readonly meta?: string;
  readonly onReview: () => void;
}

export interface AssistantRailSuggestionItem {
  readonly title: string;
  readonly meta?: string;
  readonly icon: WorkspaceIconKey;
  readonly onOpen: () => void;
}

const RAIL_SECTION_CLASS = "mt-[18px] border-t border-[#757CAA]/[0.14] pt-4";
const RAIL_SECTION_LABEL_CLASS =
  "text-[11px] font-semibold uppercase tracking-[.12em] text-[#777C9A]";
const RAIL_VIEW_ALL_CLASS =
  "text-[11px] font-medium text-[#9A6BFF] transition-colors hover:text-[#C2B1FF]";
const RAIL_ROW_CLASS =
  "flex w-full items-center gap-[11px] rounded-[11px] border border-[#7078B4]/[0.18] bg-[#0B0D20]/40 px-2.5 py-[9px] text-left transition-colors hover:border-[#7D5CFF]/40 hover:bg-[#7C4DFF]/[0.08]";
const RAIL_TILE_CLASS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#7C4DFF]/[0.14] text-[#A88BFF]";

export function FlowAIAssistantRail({
  rail,
  pendingApprovals = [],
  suggestions = [],
  onClosePanel,
}: Readonly<{
  rail: WorkspaceRightRail;
  pendingApprovals?: readonly AssistantRailApprovalItem[];
  suggestions?: readonly AssistantRailSuggestionItem[];
  onClosePanel?: () => void;
}>) {
  const navigate = useNavigate();
  const { t } = useT();
  const visibleLessons = rail.recentLessons.slice(0, 6);
  const visibleRecommendations = rail.recommendations.slice(0, 6);
  const visibleConversations = rail.recentConversation
    ? [rail.recentConversation].slice(0, 3)
    : [];

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* PO decision (post-v2 correction): the animated ASCII sphere that
          lived in this section's background before the frozen-handoff
          rewrite (PR #211's rail: SmartflowAsciiVisual variant="sphere",
          top-right, 300px, 30% opacity, decorative) is restored -- same
          existing component, same placement, never a recreation. */}
      <SmartflowAsciiVisual
        variant="sphere"
        className="pointer-events-none absolute -right-24 -top-24 h-[300px] w-[300px] opacity-30"
      />
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5">
        <div className="flex items-start gap-3.5">
          <div className="mt-0.5 flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-visible">
            {/* Frozen handoff §2/§8: MOUNT EXISTING SMARTFLOW ASSISTANT
                ANIMATION HERE -- the real FlowAIOrb, presence state,
                exactly this mount. Never a CSS stand-in. */}
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
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-semibold text-[#F7F7FC]">SmartFlow</p>
              {onClosePanel && (
                <button
                  type="button"
                  aria-label="Close panel"
                  onClick={onClosePanel}
                  className="ml-auto hidden h-7 w-7 items-center justify-center rounded-lg text-[#9EA3BF] hover:bg-[#7C4DFF]/[0.12] hover:text-[#F3F3FA] max-[1120px]:flex"
                >
                  <X className="h-[15px] w-[15px]" strokeWidth={2} />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-[7px] text-xs font-medium text-[#6EE7B7]">
              <span className="relative inline-flex h-2 w-2">
                <span className="sf-home-ping absolute inset-0 rounded-full bg-[#34D399] motion-safe:animate-[sfPing_2.2s_cubic-bezier(0,0,0.2,1)_infinite]" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34D399]" />
              </span>
              {t("online")}
            </div>
            <p className="mt-1.5 text-xs leading-[1.55] text-[#A5A8C2]">
              {translateEngineCopy(rail.statusMessage, t, ENGINE_STATUS_KEYS)}
            </p>
          </div>
        </div>

        {pendingApprovals.length > 0 && (
          <div className="mt-5 border-t border-[#757CAA]/[0.14] pt-4">
            <div className="mb-2.5 flex items-baseline justify-between">
              <p className={RAIL_SECTION_LABEL_CLASS}>{t("dashboard_rail_pending_approvals")}</p>
              <button type="button" onClick={pendingApprovals[0].onReview} className={RAIL_VIEW_ALL_CLASS}>
                {t("view_all")}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {pendingApprovals.map((item) => (
                <button key={item.title} type="button" onClick={item.onReview} className={RAIL_ROW_CLASS}>
                  <span className={RAIL_TILE_CLASS}>
                    <FileText className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-[#F7F7FC]" dir="auto">
                      {item.title}
                    </span>
                    {item.meta && (
                      <span className="mt-px block text-[11.5px] text-[#A5A8C2]">{item.meta}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className={RAIL_SECTION_CLASS}>
            <div className="mb-2.5 flex items-baseline justify-between">
              <p className={RAIL_SECTION_LABEL_CLASS}>{t("ai_suggestions")}</p>
              <button
                type="button"
                onClick={() =>
                  trackWorkspaceUiClick({
                    type: "view_all_clicked",
                    domain: "learning",
                    targetId: "right-rail-suggestions-view-all",
                    targetTitle: "AI Suggestions",
                    source: "suggested_actions",
                  })
                }
                className={RAIL_VIEW_ALL_CLASS}
              >
                {t("view_all")}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {suggestions.map((item) => {
                const ItemIcon = workspaceIconMap[item.icon];
                return (
                  <button key={item.title} type="button" onClick={item.onOpen} className={RAIL_ROW_CLASS}>
                    <span className={RAIL_TILE_CLASS}>
                      <ItemIcon className="h-[15px] w-[15px]" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-[#F7F7FC]">
                        {item.title}
                      </span>
                      {item.meta && (
                        <span className="mt-px block truncate text-[11.5px] text-[#A5A8C2]">{item.meta}</span>
                      )}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#777C9A]" strokeWidth={2} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={RAIL_SECTION_CLASS}>
          <div className="mb-2.5 flex items-baseline justify-between">
            <p className={RAIL_SECTION_LABEL_CLASS}>{t("dashboard_rail_continue_learning")}</p>
            <button
              type="button"
              onClick={() => {
                trackWorkspaceUiClick({
                  type: "view_all_clicked",
                  domain: "learning",
                  targetId: "right-rail-learning-view-all",
                  targetTitle: "Continue Learning",
                  source: "right_rail_learning",
                });
                navigate("/learn-ai");
              }}
              className={RAIL_VIEW_ALL_CLASS}
            >
              {t("view_all")}
            </button>
          </div>
          <div className="flex flex-col gap-2">
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
                  className={RAIL_ROW_CLASS}
                >
                  <span className={RAIL_TILE_CLASS}>
                    <LessonIcon className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-medium text-[#F7F7FC]">
                        {lesson.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-[#A5A8C2]">{lesson.progress}%</span>
                    </span>
                    <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[#272B4B]/90">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${lesson.progress}%`,
                          background: "var(--gradient-primary)",
                        }}
                      />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={RAIL_SECTION_CLASS}>
          <div className="mb-2.5 flex items-baseline justify-between">
            <p className={RAIL_SECTION_LABEL_CLASS}>{t("dashboard_rail_recommended_today")}</p>
            <button
              type="button"
              onClick={() =>
                trackWorkspaceUiClick({
                  type: "view_all_clicked",
                  domain: "learning",
                  targetId: "right-rail-recommendations-view-all",
                  targetTitle: "Recommended Today",
                  source: "right_rail_recommendations",
                })
              }
              className={RAIL_VIEW_ALL_CLASS}
            >
              {t("view_all")}
            </button>
          </div>
          <div className="flex flex-col gap-2">
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
                  className={RAIL_ROW_CLASS}
                >
                  <span className={RAIL_TILE_CLASS}>
                    <ItemIcon className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-[#F7F7FC]">
                      {item.title}
                    </span>
                    <span className="mt-px block truncate text-[11.5px] text-[#A5A8C2]">
                      {item.reason}
                    </span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#777C9A]" strokeWidth={2} />
                </button>
              );
            })}
          </div>
        </div>

        <div className={RAIL_SECTION_CLASS}>
          <p className={`mb-2.5 ${RAIL_SECTION_LABEL_CLASS}`}>Recent Conversation</p>
          {rail.isChatLoading ? (
            <div className="rounded-[11px] border border-[#7078B4]/[0.18] bg-[#0B0D20]/40 p-3">
              <SkeletonBlock className="h-3 w-32" />
              <SkeletonBlock className="mt-2 h-2.5 w-16" />
            </div>
          ) : visibleConversations.length > 0 ? (
            <div className="flex flex-col gap-2">
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
                  className="block w-full rounded-[11px] border border-[#7078B4]/[0.18] bg-[#0B0D20]/40 px-3 py-[11px] text-start transition-colors hover:border-[#7D5CFF]/40 hover:bg-[#7C4DFF]/[0.08]"
                >
                  <span className="block truncate text-[12.5px] font-medium text-[#F7F7FC]" dir="auto">
                    {conversation.title}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-[#A5A8C2]">
                    {conversation.relativeTime}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-[11px] border border-[#7078B4]/[0.18] bg-[#0B0D20]/40 p-3">
              <p className="text-[12.5px] font-medium text-[#F7F7FC]">{t("dashboard_no_recent_conversation")}</p>
              <p className="mt-1 text-[11.5px] leading-4 text-[#A5A8C2]">
                {t("dashboard_no_recent_conversation_hint")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
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
  const { t, lang } = useT();
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  // SmartFlow Home frozen design handoff §10 (<=1120px, desktop shell):
  // the Assistant Rail leaves the grid and becomes a fixed right overlay,
  // opened from the panel button in the embedded chat header.
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(false);
  const [approvalDialogTarget, setApprovalDialogTarget] =
    useState<"generic" | "taskComplete" | null>(null);
  const workspace = useWorkspace();
  // SmartFlow Home v2: the fourth metric capsule (Habit Streak) reads the
  // EXISTING habits query -- the same React Query key useWorkspace already
  // fetches (deduped by the cache), so this adds no new data read or
  // backend call. Best CURRENT streak across active habits, matching the
  // Habits page's own currentStreak stat.
  const habitsQuery = useHabits();
  const habitStreak = useMemo(
    () =>
      (habitsQuery.data ?? []).reduce(
        (best, habit) => Math.max(best, habit.currentStreak ?? 0),
        0,
      ),
    [habitsQuery.data],
  );
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
  // The approval/reject/close interaction itself happens INSIDE
  // StepApprovalDialog (it calls the approval service directly and remains
  // the single explicit-approval surface). The decision callback
  // previously only drove the removed Home action bars' local status
  // text/run buttons (the PO removed those bar cards from Home), so there
  // is no Home-side state to update. Execution of approved work continues
  // through the existing conversation (ChatPage agent execution wiring).
  const handleApprovalDialogDecision = () => {};

  const handleCloseApprovalDialog = () => {
    setApprovalDialogOpen(false);
    setApprovalDialogTarget(null);
  };

  useSetPageTitle("Dashboard", workspace.today.label);

  // Frozen handoff §8 (Pending Approvals): the rail rows reuse the EXACT
  // same runtime predicates (pending + requiresApproval, task-complete
  // write candidate) that gate the boundary bars -- clicking a row opens
  // the same StepApprovalDialog the corresponding bar's Review button
  // opens. No new approval semantics.
  const railPendingApprovals = useMemo<AssistantRailApprovalItem[]>(() => {
    const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
    const items: AssistantRailApprovalItem[] = [];
    if (pendingStepApproval && pendingApprovalStep) {
      items.push({
        title: pendingApprovalStep.title,
        meta: `${capitalize(pendingStepApproval.riskLevel)} priority`,
        onReview: () => {
          setApprovalDialogTarget("generic");
          setApprovalDialogOpen(true);
        },
      });
    }
    if (taskCompleteWriteCandidate) {
      items.push({
        title: taskCompleteWriteCandidate.taskTitle,
        meta: `${capitalize(taskCompleteWriteCandidate.stepApproval.riskLevel)} priority`,
        onReview: () => {
          setApprovalDialogTarget("taskComplete");
          setApprovalDialogOpen(true);
        },
      });
    }
    return items;
  }, [pendingStepApproval, pendingApprovalStep, taskCompleteWriteCandidate]);

  // Frozen handoff §8 (AI Suggestions): existing workspace.suggestedActions
  // data (already computed by workspaceEngine from existing signals),
  // composed into the rail presentation -- no new engine, no new provider.
  const railSuggestions = useMemo<AssistantRailSuggestionItem[]>(
    () =>
      workspace.suggestedActions.slice(0, 2).map((action) => ({
        title: action.title,
        meta: action.description,
        icon: action.icon,
        onOpen: () =>
          trackAndNavigateToWorkspaceTarget(navigate, action.target, {
            type: "action_clicked",
            source: "suggested_actions",
            targetId: action.title,
            targetTitle: action.title,
            domain: action.signalDomain,
          }),
      })),
    [navigate, workspace.suggestedActions],
  );

  return (
    // SmartFlow Home frozen design handoff §3: the page is a 100dvh
    // surface that never scrolls itself on desktop -- the ONLY scrolling
    // regions are the chat transcript and the Assistant Rail body. The
    // 68px navigation rail is the Sidebar sibling in AppLayout, so this
    // page's own grid supplies the remaining two frozen columns:
    // minmax(0,1fr) center + 372px rail (330px at <=1280px; at <=1120px
    // the rail leaves the grid and becomes a fixed right overlay). The
    // cold-start WelcomeWorkspace branch keeps a scrollable padded column
    // instead -- it has no chat surface to fit.
    // PO fix (2026-09-05, phase-5 mobile pass): the mobile shell now uses
    // the SAME flex height contract as desktop instead of tuned
    // h-[calc(100dvh-NNNpx)] constants -- Home mobile is hero + chat only
    // (search row and capsules removed), so the page fills the app
    // shell's <main> (h-full; main's pb-20 is the fixed bottom-nav
    // reserve) and the chat wrapper flexes into whatever remains. The
    // composer can no longer fall behind the bottom nav on ANY viewport
    // height.
    <WorkspaceReveal className="h-full min-h-0 lg:h-dvh lg:overflow-hidden">
      <div className="h-full min-h-0">
          {workspace.isLowData ? (
            <div className="mx-auto max-w-[1180px] space-y-7 px-4 pb-8 pt-5 sm:px-6 lg:h-full lg:overflow-y-auto lg:px-8 lg:pt-6">
              <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
                <div className="space-y-7">
                  <WelcomeWorkspace
                    afterHero={
                      <WorkspaceRevealSection order={1} className="lg:hidden">
                        <div className="overflow-hidden rounded-2xl border border-[#7078B4]/[0.22] bg-[#070816]/[0.78]">
                          <FlowAIAssistantRail rail={workspace.rightRail} />
                        </div>
                      </WorkspaceRevealSection>
                    }
                    welcome={workspace.welcome}
                  />
                </div>
                <WorkspaceRevealSection order={2} className="hidden lg:sticky lg:top-6 lg:block">
                  <div className="overflow-hidden rounded-2xl border border-[#7078B4]/[0.22] bg-[#070816]/[0.78]">
                    <FlowAIAssistantRail rail={workspace.rightRail} />
                  </div>
                </WorkspaceRevealSection>
              </div>
            </div>
          ) : (
            <div
              // DESIGN-AUDIT 0.6 (light mode): the Dark Cosmic gradient is
              // dark-theme-only; light gets the plain background token.
              className="flex h-full min-h-0 flex-col bg-background dark:[background:var(--flow-gradient-background)] lg:grid lg:grid-cols-[minmax(0,1fr)_372px] lg:max-[1280px]:grid-cols-[minmax(0,1fr)_330px] lg:max-[1120px]:grid-cols-[minmax(0,1fr)]"
            >
              {/* Center column -- frozen §3: flex column, min-width 0,
                  min-height 0; hero, action bars and the metric-capsule
                  row are flex-none rows and the chat wrapper takes all
                  remaining height. */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* SmartFlow Home hero -- night-sky composition (v2 base), revised
          per PO decision (2026-09-05): the greeting/goal H1 is REMOVED,
          the moon/orb moved out of the sky into the overlay lockup (orb
          first, date beside it in white), and the star field grew from
          the v2 20-star set to 32 stars with several larger radii and 6
          twinkles. Heights stay v2 (190px; 132px at <=760px). NO
          mountain/ridge/wave paths. */}
      {/* PO decision (2026-09-05, phase-5 mobile pass round 2): the hero
          (star field + orb/date lockup) is DESKTOP-ONLY -- on mobile the
          chat takes the whole screen, ChatGPT-style. */}
      <WorkspaceRevealSection order={0} className="shrink-0 max-lg:hidden">
        <section className="relative min-h-[190px] flex-none overflow-hidden max-[760px]:min-h-[132px]">
          <svg
            aria-hidden="true"
            viewBox="0 0 1200 300"
            preserveAspectRatio="xMidYMax slice"
            className="absolute inset-0 block h-full w-full"
          >
            <defs>
              <linearGradient id="sfHomeSky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0C0F2E" />
                <stop offset="55%" stopColor="#080A1F" />
                <stop offset="100%" stopColor="#050615" />
              </linearGradient>
              {/* PO decision (2026-09-05, round 3): luminous stars -- a
                  tiny bright core fading to nothing, so the visible dot
                  stays SMALL while reading as a glow, not a flat disc. */}
              <radialGradient id="sfStarGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="22%" stopColor="#DDD4FF" stopOpacity=".85" />
                <stop offset="100%" stopColor="#DDD4FF" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="sfHomeAtmo" cx="78%" cy="30%" r="55%">
                <stop offset="0%" stopColor="rgba(124,77,255,.30)" />
                <stop offset="45%" stopColor="rgba(104,61,255,.14)" />
                <stop offset="100%" stopColor="rgba(104,61,255,0)" />
              </radialGradient>
            </defs>
            <rect width="1200" height="300" fill="url(#sfHomeSky)" />
            <g fill="#DDD4FF">
              <circle cx="60" cy="40" r="1" />
              <circle cx="150" cy="86" r=".8" opacity=".6" />
              <circle cx="230" cy="30" r="1.1" className="sf-home-twinkle" style={{ animation: "sfTwinkle 3.4s ease-in-out infinite" }} />
              <circle cx="320" cy="70" r=".7" opacity=".5" />
              <circle cx="405" cy="26" r=".9" opacity=".7" />
              <circle cx="470" cy="98" r=".7" opacity=".45" />
              <circle cx="545" cy="48" r="1" className="sf-home-twinkle" style={{ animation: "sfTwinkle 4.2s ease-in-out .8s infinite" }} />
              <circle cx="620" cy="18" r=".8" opacity=".6" />
              <circle cx="685" cy="74" r=".7" opacity=".5" />
              <circle cx="748" cy="34" r="1.1" className="sf-home-twinkle" style={{ animation: "sfTwinkle 3.8s ease-in-out 1.4s infinite" }} />
              <circle cx="812" cy="96" r=".6" opacity=".4" />
              <circle cx="905" cy="52" r=".9" opacity=".65" />
              <circle cx="1005" cy="24" r=".8" opacity=".55" />
              <circle cx="1058" cy="112" r=".7" opacity=".4" />
              <circle cx="1120" cy="66" r="1" className="sf-home-twinkle" style={{ animation: "sfTwinkle 4.6s ease-in-out .4s infinite" }} />
              <circle cx="1178" cy="30" r=".8" opacity=".6" />
              <circle cx="95" cy="128" r=".6" opacity=".35" />
              <circle cx="360" cy="120" r=".6" opacity=".35" />
              <circle cx="660" cy="128" r=".6" opacity=".3" />
              <circle cx="985" cy="140" r=".6" opacity=".3" />
              {/* PO decision (2026-09-05, rounds 2+3): 12 additional
                  stars; the brighter ones use the sfStarGlow gradient
                  (tiny luminous core, soft halo) instead of larger solid
                  discs. */}
              <circle cx="110" cy="18" r="2.6" fill="url(#sfStarGlow)" />
              <circle cx="275" cy="52" r="2.2" fill="url(#sfStarGlow)" />
              <circle cx="430" cy="76" r="2.8" fill="url(#sfStarGlow)" className="sf-home-twinkle" style={{ animation: "sfTwinkle 5.1s ease-in-out 1.9s infinite" }} />
              <circle cx="512" cy="14" r=".9" opacity=".6" />
              <circle cx="700" cy="44" r="2.6" fill="url(#sfStarGlow)" />
              <circle cx="775" cy="112" r=".8" opacity=".5" />
              <circle cx="860" cy="24" r="2.2" fill="url(#sfStarGlow)" />
              <circle cx="930" cy="92" r="3" fill="url(#sfStarGlow)" className="sf-home-twinkle" style={{ animation: "sfTwinkle 4.9s ease-in-out .6s infinite" }} />
              <circle cx="1040" cy="58" r="2.2" fill="url(#sfStarGlow)" />
              <circle cx="1150" cy="104" r=".8" opacity=".5" />
              <circle cx="200" cy="132" r=".7" opacity=".45" />
              <circle cx="590" cy="86" r=".9" opacity=".6" />
              {/* PO decision (2026-09-05, rounds 2+3): 14 more stars in
                  the lower half of the band (y 150-285) -- small solids
                  plus luminous sfStarGlow cores, two more twinkles. */}
              <circle cx="80" cy="188" r=".8" opacity=".55" />
              <circle cx="185" cy="236" r=".8" opacity=".4" />
              <circle cx="300" cy="172" r="2.4" fill="url(#sfStarGlow)" />
              <circle cx="365" cy="262" r=".8" opacity=".5" />
              <circle cx="455" cy="205" r="3" fill="url(#sfStarGlow)" className="sf-home-twinkle" style={{ animation: "sfTwinkle 5.4s ease-in-out 2.3s infinite" }} />
              <circle cx="540" cy="278" r=".9" opacity=".4" />
              <circle cx="640" cy="182" r="2.2" fill="url(#sfStarGlow)" />
              <circle cx="735" cy="248" r=".7" opacity=".45" />
              <circle cx="820" cy="168" r="2.6" fill="url(#sfStarGlow)" />
              <circle cx="915" cy="232" r=".8" opacity=".5" />
              <circle cx="1010" cy="196" r="2.8" fill="url(#sfStarGlow)" className="sf-home-twinkle" style={{ animation: "sfTwinkle 4.4s ease-in-out 1.1s infinite" }} />
              <circle cx="1095" cy="266" r=".9" opacity=".4" />
              <circle cx="1160" cy="176" r="2.2" fill="url(#sfStarGlow)" />
              <circle cx="620" cy="240" r=".7" opacity=".35" />
            </g>
            <ellipse cx="870" cy="150" rx="420" ry="200" fill="url(#sfHomeAtmo)" opacity=".75" />
          </svg>

          {/* PO decision (2026-09-05): the overlay is a single top-aligned
              lockup -- the breathing orb first, the date beside it in
              WHITE (#F7F7FC) -- and nothing else (the greeting/goal H1 is
              removed in both languages). pt-[22px] lines the lockup up
              with the Assistant Rail's own SmartFlow header row (pt-5 +
              its 52px orb mount). Direction-agnostic: flex order puts the
              orb on the start side in LTR and RTL alike. */}
          <div className="relative z-[2] flex items-center gap-3.5 px-9 pt-[22px] max-[760px]:gap-2.5 max-[760px]:px-4 max-[760px]:pt-3">
            <svg
              aria-hidden="true"
              viewBox="0 0 96 96"
              className="h-12 w-12 shrink-0 max-[760px]:h-9 max-[760px]:w-9"
              style={{ animation: "sfMoonBreathe 8s ease-in-out infinite" }}
            >
              <defs>
                <radialGradient id="sfHeroOrb" cx="50%" cy="45%" r="55%">
                  <stop offset="0%" stopColor="#FFFFFF" />
                  <stop offset="35%" stopColor="#E4D9FF" />
                  <stop offset="75%" stopColor="#9A6BFF" />
                  <stop offset="100%" stopColor="#6938F0" />
                </radialGradient>
              </defs>
              <circle cx="48" cy="48" r="46" fill="none" stroke="rgba(154,107,255,.14)" strokeWidth="1.5" />
              <circle cx="48" cy="48" r="31" fill="none" stroke="rgba(154,107,255,.3)" strokeWidth="1.5" />
              <circle cx="48" cy="48" r="16" fill="url(#sfHeroOrb)" />
            </svg>
            <p className="text-[15px] font-semibold uppercase tracking-[.18em] text-[#F7F7FC] max-[760px]:text-[12.5px]">
              {lang === "en"
                ? workspace.today.label
                : new Intl.DateTimeFormat(localeFor(lang), {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  }).format(workspace.today.date)}
            </p>
          </div>
        </section>
      </WorkspaceRevealSection>

      {/* PO decision (post-v2 correction): the two/three conditional
          action-bar cards are REMOVED from Home again -- the hero flows
          into the capsule row and chat with nothing between. Approval and
          execution governance stays fully reachable through the
          conversation's own approval interactions and the Assistant
          Rail's Pending Approvals rows (both open the same
          StepApprovalDialog / existing runtime surfaces). */}
      {/* SmartFlow Home frozen design handoff §7 -- CRITICAL LAYOUT
          CONTRACT. SmartFlow chat is the dominant surface and the LAST
          thing in the center column: the real ChatPage, embedded (never a
          second chat implementation). The frozen flex chain, end to end:
          center column (flex-col, min-h-0) -> this chat wrapper (flex-1,
          min-h-0, padding 12px 28px 20px) -> the shell (flex-col, flex-1,
          min-h-0, overflow-hidden, radius 18/glass) -> ChatPage's own
          embedded root (`flex: 1 1 0%` + `minHeight: 0`, see ChatPage.tsx)
          -> header flex-none, transcript flex-1/min-h-0/overflow-y-auto
          (the ONLY scroller), composer flex-none. A long conversation
          scrolls ONLY inside the transcript; the composer stays
          permanently visible; the page never scrolls because the
          transcript grew. Below lg (the app's separate mobile shell,
          which scrolls the page) the wrapper keeps a bounded height so
          the same internal contract holds there too -- sized so that
          with the shell's search row (~42px) + the v2 hero above (190px;
          132px at <=760px per the v2 rev-2 mobile rules) and the fixed
          bottom nav (pb-20, 80px) below, the composer lands exactly at
          the nav's top edge on first paint instead of being clipped
          behind it (mobile responsive pass): 318px = 42+196+80 for the
          761-1023 band, 254px = 42+132+80 at <=760px; dvh also shrinks
          with the on-screen keyboard, keeping the composer visible while
          typing. min-h keeps the chat usable on short viewports (the
          page then scrolls, as before). The <=760px paddings are the v2
          rev-2 sfCenter values (10px all around). Nothing renders after
          the chat except the mobile-stacked Assistant Rail. */}
      <WorkspaceRevealSection order={1} className="flex min-h-0 flex-1 flex-col">
        {/* PO fix (2026-09-05, phase-5 mobile pass): the tuned mobile
            h-[calc(100dvh-NNNpx)] constants (318/254, briefly 266/202)
            are GONE -- the wrapper now flexes into the remaining shell
            height on every breakpoint, exactly like the desktop
            contract, so the composer's action row is always visible
            above the fixed bottom nav. */}
        {/* PO decision (2026-09-05, round 2): on mobile the wrapper is
            FULL-BLEED (p-0) -- the chat surface runs edge to edge under
            the glass header/nav; desktop keeps its former padding. */}
        <div className="flex min-h-0 flex-1 flex-col max-lg:p-0 lg:px-7 lg:pb-5 lg:pt-3">
          {/* SmartFlow Home v2 §metrics: the metric capsules moved OUT of
              the hero to a flex-none row directly above the chat shell,
              each stretching equally (flex-1, min-width 150px), and v2
              adds the fourth capsule -- Habit Streak (existing habits
              data, best current streak). Counts are the existing
              workspace signals; no new backend reads. (v2 rev-2's 2x2
              mobile grid is gone -- see the phase-5 mobile-pass comment
              below: the row no longer renders below lg at all.)
              PO decision (post-v2 rev-2): the four capsules are
              CLICKABLE -- Open Tasks -> /tasks, Today's Events ->
              /calendar, Habit Streak -> /habits (existing routes,
              tracked like every other workspace navigation), and
              Approvals opens the SAME StepApprovalDialog the rail's
              Pending Approvals rows open (first pending item; disabled
              when nothing is pending). Navigation + the existing dialog
              only -- no new execution surface. */}
          {/* PO decision (2026-09-05, phase-5 mobile pass): the metric
              capsules are DESKTOP-ONLY -- on mobile they're hidden
              entirely (hidden lg:flex), so the chat gets the space; the
              old 2x2 mobile grid is gone. */}
          <div className="mb-3 hidden lg:flex flex-none flex-wrap gap-2.5">
            {workspace.signals.isLoading ? (
              <>
                <SkeletonBlock className="h-[46px] min-w-[150px] flex-1 rounded-xl max-[760px]:min-w-0" />
                <SkeletonBlock className="h-[46px] min-w-[150px] flex-1 rounded-xl max-[760px]:min-w-0" />
                <SkeletonBlock className="h-[46px] min-w-[150px] flex-1 rounded-xl max-[760px]:min-w-0" />
                <SkeletonBlock className="h-[46px] min-w-[150px] flex-1 rounded-xl max-[760px]:min-w-0" />
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() =>
                    trackAndNavigateToWorkspaceTarget(navigate, { route: "/tasks" }, {
                      type: "action_clicked",
                      source: "hero",
                      targetId: "home-metric-open-tasks",
                      targetTitle: "Open Tasks",
                      domain: "tasks",
                    })
                  }
                  className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-xl border border-border bg-card/70 py-2 pl-2.5 pr-3.5 text-left backdrop-blur-[8px] transition-colors hover:border-primary/40 hover:bg-primary/[0.06] dark:border-[#7078B4]/[0.22] dark:bg-[#0B0D20]/60 dark:hover:border-[#7D5CFF]/40 dark:hover:bg-[#7C4DFF]/[0.08] max-[760px]:min-w-0 max-[760px]:py-[7px] max-[760px]:pr-2.5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#7C4DFF]/[0.16] text-primary dark:text-[#A88BFF]">
                    <CheckSquare className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                  <span>
                    <span className="block text-[10px] font-medium uppercase tracking-[.08em] text-muted-foreground dark:text-[#777C9A] max-[760px]:text-[9px]">{t("dashboard_stat_open_tasks")}</span>
                    <span className="text-[17px] font-semibold text-foreground dark:text-[#F7F7FC]">
                      {workspace.signals.incompleteTasks}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    trackAndNavigateToWorkspaceTarget(navigate, { route: "/calendar" }, {
                      type: "action_clicked",
                      source: "hero",
                      targetId: "home-metric-todays-events",
                      targetTitle: "Today's Events",
                      domain: "calendar",
                    })
                  }
                  className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-xl border border-border bg-card/70 py-2 pl-2.5 pr-3.5 text-left backdrop-blur-[8px] transition-colors hover:border-primary/40 hover:bg-primary/[0.06] dark:border-[#7078B4]/[0.22] dark:bg-[#0B0D20]/60 dark:hover:border-[#7D5CFF]/40 dark:hover:bg-[#7C4DFF]/[0.08] max-[760px]:min-w-0 max-[760px]:py-[7px] max-[760px]:pr-2.5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#4F73FF]/[0.15] text-[#3557E8] dark:text-[#678BFF]">
                    <Calendar className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                  <span>
                    <span className="block text-[10px] font-medium uppercase tracking-[.08em] text-muted-foreground dark:text-[#777C9A] max-[760px]:text-[9px]">{t("dashboard_stat_todays_events")}</span>
                    <span className="text-[17px] font-semibold text-foreground dark:text-[#F7F7FC]">
                      {workspace.signals.eventsToday}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  // /habits is a real app route but not part of the
                  // WorkspaceRoute union (that type stays untouched --
                  // no shared-type change for a presentation click), so
                  // this capsule tracks + navigates directly instead of
                  // going through trackAndNavigateToWorkspaceTarget.
                  onClick={() => {
                    trackWorkspaceUiClick({
                      type: "action_clicked",
                      domain: "habits",
                      targetId: "home-metric-habit-streak",
                      targetTitle: "Habit Streak",
                      source: "hero",
                    });
                    navigate("/habits");
                  }}
                  className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-xl border border-border bg-card/70 py-2 pl-2.5 pr-3.5 text-left backdrop-blur-[8px] transition-colors hover:border-primary/40 hover:bg-primary/[0.06] dark:border-[#7078B4]/[0.22] dark:bg-[#0B0D20]/60 dark:hover:border-[#7D5CFF]/40 dark:hover:bg-[#7C4DFF]/[0.08] max-[760px]:min-w-0 max-[760px]:py-[7px] max-[760px]:pr-2.5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F3A044]/[0.14] text-[#B26A0D] dark:text-[#F3A044]">
                    <Flame className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                  <span>
                    <span className="block text-[10px] font-medium uppercase tracking-[.08em] text-muted-foreground dark:text-[#777C9A] max-[760px]:text-[9px]">{t("dashboard_stat_habit_streak")}</span>
                    <span className="text-[17px] font-semibold text-foreground dark:text-[#F7F7FC]">
                      {habitStreak}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={railPendingApprovals.length === 0}
                  onClick={() => railPendingApprovals[0]?.onReview()}
                  className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-xl border border-primary/35 bg-primary/[0.08] py-2 pl-2.5 pr-3.5 text-left backdrop-blur-[8px] transition-colors enabled:hover:border-primary/60 enabled:hover:bg-primary/[0.14] disabled:cursor-default dark:border-[#7D5CFF]/[0.35] dark:bg-[#7C4DFF]/[0.10] dark:enabled:hover:border-[#7D5CFF]/60 dark:enabled:hover:bg-[#7C4DFF]/[0.16] max-[760px]:min-w-0 max-[760px]:py-[7px] max-[760px]:pr-2.5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#7C4DFF]/20 text-primary dark:text-[#C2B1FF]">
                    <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                  <span>
                    <span className="block text-[10px] font-medium uppercase tracking-[.08em] text-muted-foreground dark:text-[#777C9A] max-[760px]:text-[9px]">{t("dashboard_stat_approvals")}</span>
                    <span className="text-[17px] font-semibold text-foreground dark:text-[#F7F7FC]">
                      {approvalsPendingCount}
                    </span>
                  </span>
                </button>
              </>
            )}
          </div>
          <section
            aria-label="SmartFlow conversation"
            // PO decision (2026-09-05, round 2): on mobile the card chrome
            // (radius/border/shadow) drops away -- the same translucent
            // glass surface, edge to edge over the gradient background.
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-border bg-card/60 shadow-[0_16px_40px_rgba(0,0,0,0.08)] backdrop-blur-[14px] dark:border-[#7078B4]/[0.22] dark:bg-[#080A1B]/[0.55] dark:shadow-[0_16px_40px_rgba(0,0,0,0.28)] max-lg:rounded-none max-lg:border-0 max-lg:shadow-none"
          >
            <ChatPage embedded onOpenAssistantPanel={() => setAssistantPanelOpen(true)} />
          </section>
        </div>
      </WorkspaceRevealSection>

              </div>

              {/* Frozen §10/§11, widened by DESIGN-AUDIT phase 5: at
                  <=1120px -- now INCLUDING the mobile shell, not just the
                  1024-1120 desktop window -- the rail leaves the grid and
                  becomes a fixed right overlay; this scrim sits behind it
                  (z 60) and closes it on click. The old mobile arrangement
                  (the rail stacked below the chat, far under the fold and
                  effectively undiscoverable) is replaced by the same
                  overlay, opened from the chat header's panel button. */}
              {assistantPanelOpen && (
                <button
                  type="button"
                  aria-label="Close assistant panel"
                  onClick={() => setAssistantPanelOpen(false)}
                  className="hidden cursor-default max-[1120px]:fixed max-[1120px]:inset-0 max-[1120px]:z-[60] max-[1120px]:block max-[1120px]:bg-[#03040F]/60 max-[1120px]:backdrop-blur-[2px]"
                />
              )}

              {/* Frozen §8: the FULL right Assistant Rail -- 372px grid
                  column on desktop (330px at <=1280px), its body an
                  independent vertical scroller; at <=1120px (all shells,
                  phase 5) a fixed right overlay (372px, max 92vw, z 70)
                  slid in/out per §10. */}
              <aside
                aria-label="Assistant panel"
                className={cn(
                  "flex min-h-0 flex-col border-s border-[#7078B4]/[0.14] bg-[#070816]/[0.78] backdrop-blur-[14px]",
                  "max-[1120px]:fixed max-[1120px]:inset-y-0 max-[1120px]:right-0 max-[1120px]:z-[70] max-[1120px]:w-[372px] max-[1120px]:max-w-[92vw] max-[1120px]:shadow-[-24px_0_60px_rgba(0,0,0,0.55)] max-[1120px]:transition-transform max-[1120px]:duration-[320ms] max-[1120px]:ease-[cubic-bezier(0.32,0.72,0.28,1)] motion-reduce:transition-none",
                  assistantPanelOpen
                    ? "max-[1120px]:translate-x-0"
                    : "max-[1120px]:translate-x-[103%]",
                )}
              >
                <FlowAIAssistantRail
                  rail={workspace.rightRail}
                  pendingApprovals={railPendingApprovals}
                  suggestions={railSuggestions}
                  onClosePanel={() => setAssistantPanelOpen(false)}
                />
              </aside>
            </div>
          )}
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
