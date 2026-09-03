import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRightRail } from "@/features/workspace";

// FlowAIAssistantRail renders FlowAIOrb/SmartflowAsciiVisual (decorative,
// canvas/animation-flavoured) -- mocked out the same way Sidebar.test.tsx
// already mocks them for its own renderToString-based render, since this
// test only cares about which TEXT sections render, not their visuals.
vi.mock("@/components/FlowAIOrb", () => ({ FlowAIOrb: () => null }));
vi.mock("@/components/smartflow", () => ({ SmartflowAsciiVisual: () => null }));
// Dashboard.tsx (via useWorkspace's many services -- tasksService,
// calendarService, financeService, habitsService, ...) transitively
// imports the real Supabase client, which throws at module-construction
// time outside a real dev/CI env (VITE_SMARTFLOW_SUPABASE_MODE guard --
// see supabaseConfig.ts and the same gotcha documented in
// writeRuntime.test.ts/chatV2Routing.test.ts). FlowAIAssistantRail itself
// never touches Supabase, so a minimal client stub is enough to let the
// module graph load -- no per-service mocking needed.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}));

import { FlowAIAssistantRail } from "./Dashboard";

// Non-empty in every list so a false pass can't hide behind "nothing to
// render anyway" -- if a gated section's items showed up in the output,
// these are the exact strings that would catch it.
const FIXTURE_RAIL: WorkspaceRightRail = {
  statusMessage: "Ready when you are.",
  recentLessons: [{ title: "Sorting Algorithms Lesson", progress: 40, icon: "book" }],
  recommendations: [{
    title: "Big O Notation Recommendation",
    reason: "Because you asked about complexity",
    icon: "sparkles",
    signalDomain: "learning",
    target: { route: "/learn-ai" },
  }],
  recentConversation: { title: "Yesterday planning chat", relativeTime: "1 day ago" },
  isChatLoading: false,
};

function renderRail(showChatEntry?: boolean) {
  return renderToString(
    <MemoryRouter>
      <FlowAIAssistantRail rail={FIXTURE_RAIL} showChatEntry={showChatEntry} />
    </MemoryRouter>,
  );
}

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

  it("the standalone 'Continue Learning' (Smart Academy widget) section is gone -- SmartAcademyWidget is no longer imported or rendered by Dashboard.tsx at all", () => {
    expect(dashboardSource).not.toMatch(/SmartAcademyWidget/);
  });

  it("the standalone 'Recommended Today' section is gone -- RecommendedTopicsWidget is no longer imported or rendered by Dashboard.tsx at all", () => {
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
    expect(matches).toHaveLength(2);
    expect(dashboardSource).toMatch(/<FlowAIAssistantRail rail=\{workspace\.rightRail\} showChatEntry=\{false\}/);
  });
});

// Home V2 design contract correction: normal Home's "Relevant Context"
// group (showChatEntry=false, the two Dashboard.tsx call sites verified
// above) must be restrained -- Recent conversation only, NOT Continue
// learning or Recommended today (those are permanent-dashboard-widget
// content the approved contract removed from Home). The regression this
// guards: the original implementation only ever HID the CTA/orb block --
// Continue learning and Recommended today kept rendering unconditionally,
// which the previous version of this test file failed to catch because it
// checked for the absence of the wrong (Title Case) strings while the
// actual rendered text is sentence case ("Continue learning" / "Recommended
// today"). These assertions render the REAL component (not a regex over
// its source) and read its actual DOM text, so a similar case mismatch
// -- or any other way the gate could quietly stop applying -- fails loudly
// here instead of passing by accident.
describe("Home V2 design contract: FlowAIAssistantRail's 'Relevant Context' group is restrained for normal Home", () => {
  it("showChatEntry=false (normal Home): renders 'Relevant Context' and Recent conversation, but NOT Continue learning or Recommended today", () => {
    const html = renderRail(false);

    expect(html).toContain("Relevant Context");
    expect(html).toContain("Recent conversation");
    expect(html).toContain(FIXTURE_RAIL.recentConversation!.title);

    expect(html).not.toContain("Continue learning");
    expect(html).not.toContain("Recommended today");
    expect(html).not.toContain(FIXTURE_RAIL.recentLessons[0].title);
    expect(html).not.toContain(FIXTURE_RAIL.recommendations[0].title);
  });

  it("showChatEntry=true (cold-start / WelcomeWorkspace, this component's pre-existing default): still renders the CTA plus all three sections, exactly as before this correction", () => {
    const htmlExplicit = renderRail(true);
    const htmlDefault = renderRail(undefined);

    for (const html of [htmlExplicit, htmlDefault]) {
      expect(html).toContain("Chat with Flow AI");
      expect(html).toContain("Continue learning");
      expect(html).toContain(FIXTURE_RAIL.recentLessons[0].title);
      expect(html).toContain("Recommended today");
      expect(html).toContain(FIXTURE_RAIL.recommendations[0].title);
      expect(html).toContain("Recent conversation");
      expect(html).toContain(FIXTURE_RAIL.recentConversation!.title);
      expect(html).not.toContain("Relevant Context");
    }
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
