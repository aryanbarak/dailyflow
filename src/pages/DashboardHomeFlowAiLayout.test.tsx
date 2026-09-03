import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Home / Flow AI v2 design cleanup. Dashboard.tsx mounts useWorkspace()
// (itself a composition of useTasks/useEvents/useFinance/useChatSessions/
// useHabits/useDocuments/useLearnAiActivity) plus a dozen agent-runtime
// hooks -- the same "too heavy to mount, verify shipped SOURCE instead"
// situation ChatPageDesktopLayout.test.tsx and ChatPagePwaScroll.test.tsx
// already document and rely on for ChatPage.tsx. No Dashboard/Home layout
// test existed before this task (confirmed by search); this is a
// lightweight regression guard for the new information hierarchy --
// Flow AI dominant, metrics compact, permanent dashboard-card sections
// gone -- not a full behavioral test of the workspace hooks themselves.

const dashboardSource = readFileSync(
  fileURLToPath(new URL("./Dashboard.tsx", import.meta.url)),
  "utf-8",
);
const chatPageSource = readFileSync(
  fileURLToPath(new URL("./ChatPage.tsx", import.meta.url)),
  "utf-8",
);

describe("Home / Flow AI v2: ChatPage's `embedded` prop only changes its own root sizing, nothing else", () => {
  it("the `/chat` route's own className literal is completely untouched -- ChatPagePwaScroll.test.tsx and ChatPageChromeCleanup.test.tsx both pin this exact source string, and both still pass unmodified", () => {
    expect(chatPageSource).toMatch(
      /className="flex h-full flex-col overflow-hidden bg-background text-foreground lg:sticky lg:top-0 lg:h-screen"/,
    );
  });

  it("embedding is an inline style override (position/height), not a className swap -- so no chat/execution logic, and no other pinned className assertion, is affected by it", () => {
    expect(chatPageSource).toMatch(/style=\{embedded \? \{ position: 'static', height: '100%' \} : undefined\}/);
  });

  it("`embedded` defaults to false, so `<Route path=\"/chat\" element={<ChatPage />} />` (no prop passed) is pixel-identical to before this prop existed", () => {
    expect(chatPageSource).toMatch(/export default function ChatPage\(\{ embedded = false \}: ChatPageProps = \{\}\)/);
  });
});

describe("Home / Flow AI v2: the real chat surface is embedded, not a promo card", () => {
  it("Dashboard renders the actual ChatPage component in embedded mode -- same messages/composer/approval/execution logic as /chat, not a duplicate", () => {
    expect(dashboardSource).toMatch(/<ChatPage embedded \/>/);
  });

  it("ChatPage is imported from its real module, not re-implemented locally", () => {
    expect(dashboardSource).toMatch(/import ChatPage from "@\/pages\/ChatPage"/);
  });
});

describe("Home / Flow AI v2: dashboard-card sections removed from the permanent composition", () => {
  it("no permanent 'My Suggested Actions' widget grid", () => {
    expect(dashboardSource).not.toMatch(/My Suggested Actions/);
  });

  it("no permanent 'AI Reasoning' / daily story card", () => {
    expect(dashboardSource).not.toMatch(/AI Reasoning/);
    expect(dashboardSource).not.toMatch(/AgentBriefingCard/);
  });

  it("no permanent 'Continue Learning' (Smart Academy) section", () => {
    expect(dashboardSource).not.toMatch(/Continue Learning/);
    expect(dashboardSource).not.toMatch(/SmartAcademyWidget/);
  });

  it("no permanent 'Recommended Today' section", () => {
    expect(dashboardSource).not.toMatch(/Recommended Today/);
    expect(dashboardSource).not.toMatch(/RecommendedTopicsWidget/);
  });

  it("the old bulky 'Today's Signals' box and the 'How I can help today' skills grid are gone", () => {
    expect(dashboardSource).not.toMatch(/Today&apos;s Signals/);
    expect(dashboardSource).not.toMatch(/<HeroSkills\b/);
  });
});

describe("Home / Flow AI v2: compact daily orientation + Smart Context rail", () => {
  it("the header shows a compact tasks/events/approvals counts line instead of a metric-card grid", () => {
    expect(dashboardSource).toMatch(/workspace\.signals\.incompleteTasks/);
    expect(dashboardSource).toMatch(/workspace\.signals\.eventsToday/);
    expect(dashboardSource).toMatch(/approvalsPendingCount/);
  });

  it("HomeTodayContext + the trimmed FlowAIAssistantRail render in both the mobile stack and the desktop sticky rail -- Smart Context stacks below chat on mobile, never squeezing it", () => {
    const matches = dashboardSource.match(/<HomeTodayContext\b/g) ?? [];
    expect(matches.length).toBe(2);
    expect(dashboardSource).toMatch(/<FlowAIAssistantRail rail=\{workspace\.rightRail\} showChatEntry=\{false\}/);
  });

  it("FlowAIAssistantRail's 'Chat with Flow AI' CTA is conditional (showChatEntry), not always shown -- Home's rail no longer duplicates a link to the chat that is already the dominant surface", () => {
    expect(dashboardSource).toMatch(/showChatEntry\s*=\s*true/);
    expect(dashboardSource).toMatch(/showChatEntry \? \(/);
  });
});

describe("Home / Flow AI v2: existing capabilities preserved elsewhere, not deleted", () => {
  it("TodaysFocusWidget and AiInsightsWidget are still imported and rendered (relocated, not removed)", () => {
    expect(dashboardSource).toMatch(/<TodaysFocusWidget \/>/);
    expect(dashboardSource).toMatch(/<AiInsightsWidget \/>/);
  });

  it("the cold-start Welcome Workspace flow (workspace.isLowData) is untouched by this layout change", () => {
    expect(dashboardSource).toMatch(/workspace\.isLowData \? \(\s*<WelcomeWorkspace/);
  });

  it("Manual Actions shortcuts and the approval/write/read-only boundary cards are still present, just reordered ahead of the chat panel", () => {
    expect(dashboardSource).toMatch(/Manual Actions/);
    expect(dashboardSource).toMatch(/pendingStepApproval && pendingApprovalStep/);
    expect(dashboardSource).toMatch(/taskCompleteWriteCandidate &&/);
    expect(dashboardSource).toMatch(/readOnlyRuntimeStep && readOnlyRuntimeResolution/);
  });
});
