import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRightRail } from "@/features/workspace";

// SmartFlow Home -- frozen Claude Design handoff (SMARTFLOW-HOME-HANDOFF.md
// / `SmartFlow Home.dc.html`). Dashboard.tsx mounts useWorkspace() (a
// composition of useTasks/useEvents/useFinance/useChatSessions/useHabits/
// useDocuments/useLearnAiActivity) plus a dozen agent-runtime hooks -- the
// same "too heavy to mount, verify shipped SOURCE instead" situation
// ChatPageDesktopLayout.test.tsx/ChatPagePwaScroll.test.tsx already
// document and rely on for ChatPage.tsx. FlowAIAssistantRail itself is
// lightweight (only useNavigate) and exported specifically so it CAN be
// rendered for real -- used below wherever the contract is actually about
// its rendered output.
vi.mock("@/components/FlowAIOrb", () => ({ FlowAIOrb: (props: { ariaLabel?: string }) => <div data-testid="flow-ai-orb" aria-label={props.ariaLabel} /> }));
vi.mock("@/components/smartflow", () => ({
  SmartflowAsciiVisual: (props: { variant?: string; className?: string }) => (
    <div data-testid="ascii-visual" data-variant={props.variant} className={props.className} />
  ),
}));
// Dashboard.tsx transitively imports the real Supabase client (via
// useWorkspace's many services), which throws at module-construction time
// outside a real dev/CI env (VITE_SMARTFLOW_SUPABASE_MODE guard -- see
// supabaseConfig.ts and the same gotcha documented in writeRuntime.test.ts/
// chatV2Routing.test.ts). Neither FlowAIAssistantRail nor this file's own
// source-text checks touch Supabase -- a minimal client stub is enough to
// let the module graph load, no per-service mocking needed.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}));

import { FlowAIAssistantRail } from "./Dashboard";

const dashboardSource = readFileSync(
  fileURLToPath(new URL("./Dashboard.tsx", import.meta.url)),
  "utf-8",
);
const chatPageSource = readFileSync(
  fileURLToPath(new URL("./ChatPage.tsx", import.meta.url)),
  "utf-8",
);

// Non-empty in every list so a false pass can't hide behind "nothing to
// render anyway" -- these are the exact strings assertions below look for.
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

const FIXTURE_APPROVALS = [
  { title: "Vendor Onboarding Approval", meta: "High priority", onReview: vi.fn() },
];
const FIXTURE_SUGGESTIONS = [
  { title: "Finish active tasks suggestion", meta: "Because 3 items need attention", icon: "check" as const, onOpen: vi.fn() },
];

function renderRail(withRuntimeSections = false) {
  return renderToString(
    <MemoryRouter>
      <FlowAIAssistantRail
        rail={FIXTURE_RAIL}
        pendingApprovals={withRuntimeSections ? FIXTURE_APPROVALS : []}
        suggestions={withRuntimeSections ? FIXTURE_SUGGESTIONS : []}
      />
    </MemoryRouter>,
  );
}

// The hero section's own source block (frozen §5, REV 2): from the
// section's min-height marker through the end of its reveal wrapper.
function heroBlock() {
  const start = dashboardSource.indexOf("min-h-[190px]");
  const end = dashboardSource.indexOf("</WorkspaceRevealSection>", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return dashboardSource.slice(start, end);
}

// Frozen handoff §2/§7: Home embeds the REAL ChatPage.
describe("Frozen handoff: the real chat surface is embedded, not a promo card or a second chat", () => {
  it("Dashboard renders the actual ChatPage component in embedded mode -- same messages/composer/approval/execution logic as /chat, not a duplicate", () => {
    expect(dashboardSource).toMatch(/<ChatPage\s+embedded\b/);
  });

  it("ChatPage is imported from its real module, not re-implemented locally", () => {
    expect(dashboardSource).toMatch(/import ChatPage from "@\/pages\/ChatPage"/);
  });
});

// Standalone /chat behavior remains unaffected by the `embedded` prop.
describe("Frozen handoff: ChatPage's `embedded` prop only changes its own root sizing/presentation, nothing else", () => {
  it("the `/chat` route's own className literal is completely untouched -- ChatPagePwaScroll.test.tsx and ChatPageChromeCleanup.test.tsx both pin this exact source string, and both still pass unmodified", () => {
    expect(chatPageSource).toMatch(
      /className="flex h-full flex-col overflow-hidden bg-background text-foreground lg:sticky lg:top-0 lg:h-screen"/,
    );
  });

  it("embedding is an inline style override (position/height/flex growth), not a className swap -- so no chat/execution logic, and no other pinned className assertion, is affected by it", () => {
    expect(chatPageSource).toMatch(
      /style=\{embedded \? \{ position: 'static', height: '100%', flex: '1 1 0%', minHeight: 0 \} : undefined\}/,
    );
  });

  it("`embedded` defaults to false, so `<Route path=\"/chat\" element={<ChatPage />} />` (no prop passed) is pixel-identical to before this prop existed", () => {
    expect(chatPageSource).toMatch(/export default function ChatPage\(\{ embedded = false, onOpenAssistantPanel \}: ChatPageProps = \{\}\)/);
  });

  it("SmartFlow Home v2: the embedded header carries 'SmartFlow' + the Online cluster again (titleOverride/showOnlineStatus, v2 superseded REV 2's de-branded header) -- the standalone route resolves the same expressions to undefined/false, unchanged", () => {
    expect(chatPageSource).toMatch(/titleOverride=\{embedded \? 'SmartFlow' : undefined\}/);
    expect(chatPageSource).toMatch(/showOnlineStatus=\{embedded\}/);
  });

  it("the embedded-only extras (assistant-panel button, 'Ask SmartFlow anything…' placeholder, wide transcript, v2 centered empty state) are all gated on `embedded`, so the standalone route renders none of them", () => {
    expect(chatPageSource).toMatch(/onOpenAssistantPanel=\{embedded \? onOpenAssistantPanel : undefined\}/);
    expect(chatPageSource).toMatch(/placeholderOverride=\{embedded \? 'Ask SmartFlow anything…' : undefined\}/);
    expect(chatPageSource).toMatch(/embedded=\{embedded\}/);
  });

  it("REV 2 §7 (wider transcript): the centred lg reading-measure column cap applies ONLY to the standalone route; embedded Home spans the full shell width with percentage bubble caps instead", () => {
    expect(chatPageSource).toMatch(
      /'relative flex min-w-0 flex-1 flex-col min-h-0', !embedded && 'lg:mx-auto lg:max-w-3xl'/,
    );
    expect(chatPageSource).toMatch(/embedded \? 'max-w-\[92%\] lg:max-w-\[64%\]' : 'max-w-\[92%\] lg:max-w-\[70ch\]'/);
    expect(chatPageSource).toMatch(/embedded \? 'max-w-full lg:max-w-\[86%\]' : 'max-w-full lg:max-w-\[70ch\]'/);
  });
});

// Frozen handoff §1/§13: nothing renders after chat in Home's center column.
describe("Frozen handoff: nothing below the chat -- Home's center column ends with the chat", () => {
  it("AiInsightsWidget is not imported or rendered by Dashboard.tsx at all (not just moved -- removed from Home's composition; the component itself is untouched elsewhere)", () => {
    expect(dashboardSource).not.toMatch(/AiInsightsWidget/);
  });

  it("no Manual Actions composition exists after chat", () => {
    expect(dashboardSource).not.toMatch(/Manual Actions/);
  });

  it("FocusPlaylistCard is not defined or rendered by Dashboard.tsx at all", () => {
    expect(dashboardSource).not.toMatch(/FocusPlaylistCard/);
  });

  it("between the chat panel and the center column's close, only the mobile-stacked Assistant Rail placement appears -- no other dashboard module", () => {
    const chatIndex = dashboardSource.indexOf("<ChatPage");
    const railColumnIndex = dashboardSource.indexOf('aria-label="Assistant panel"', chatIndex);
    expect(chatIndex).toBeGreaterThan(-1);
    expect(railColumnIndex).toBeGreaterThan(chatIndex);
    const afterChat = dashboardSource.slice(chatIndex, railColumnIndex);
    expect(afterChat).not.toMatch(/AiInsightsWidget|Manual Actions|FocusPlaylistCard|AddHabitModal/);
  });
});

// Frozen handoff §8: the FULL Assistant Rail with all five approved
// sections, the real FlowAIOrb mount, SmartFlow naming, and an independent
// scroll container -- proven by rendering the real component.
describe("Frozen handoff: the FULL Assistant Rail (five sections, real orb, independent scroll)", () => {
  it("renders the real FlowAIOrb component (never a CSS stand-in), SmartFlow naming, Online state, and status copy -- and NO 'Chat with SmartFlow' CTA (REV 2 §5: Home already IS the conversation)", () => {
    const html = renderRail();
    expect(html).toContain('data-testid="flow-ai-orb"');
    expect(html).toContain("SmartFlow");
    expect(html).not.toContain("Chat with SmartFlow");
    expect(html).not.toContain("Flow AI");
    expect(html).toContain(FIXTURE_RAIL.statusMessage);
    expect(html).toContain("Online");
  });

  it("the rail body is its own independent vertical scroller (flex-1/min-h-0/overflow-y-auto), so its height can never influence the chat composer", () => {
    const html = renderRail();
    expect(html).toMatch(/min-h-0 flex-1 overflow-y-auto/);
  });

  it("PO correction: the animated ASCII sphere background is back in the rail header -- the SAME SmartflowAsciiVisual sphere placement PR #211's approved rail had (top-right, 300px, 30% opacity, decorative), behind a z-10 content layer", () => {
    const html = renderRail();
    expect(html).toContain('data-testid="ascii-visual"');
    expect(html).toContain('data-variant="sphere"');
    expect(html).toMatch(/pointer-events-none absolute -right-24 -top-24 h-\[300px\] w-\[300px\] opacity-30/);
    // Contained by the rail (overflow-hidden root) and never intercepting
    // clicks; the scrolling content sits above it.
    expect(html).toMatch(/relative flex h-full min-h-0 flex-col overflow-hidden/);
    expect(html).toMatch(/relative z-10 min-h-0 flex-1 overflow-y-auto/);
  });

  it("renders all five approved sections, in the frozen order, when data is supplied: Pending Approvals, AI Suggestions, Continue Learning, Recommended Today, Recent Conversation", () => {
    const html = renderRail(true);
    const order = [
      "Pending Approvals",
      "AI Suggestions",
      "Continue Learning",
      "Recommended Today",
      "Recent Conversation",
    ].map((label) => ({ label, index: html.indexOf(label) }));
    for (const section of order) {
      expect(section.index, `${section.label} should render`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < order.length; i++) {
      expect(order[i].index).toBeGreaterThan(order[i - 1].index);
    }
    expect(html).toContain(FIXTURE_APPROVALS[0].title);
    expect(html).toContain(FIXTURE_SUGGESTIONS[0].title);
    expect(html).toContain(FIXTURE_RAIL.recentLessons[0].title);
    expect(html).toMatch(/width:\s*40%/);
    expect(html).toContain(FIXTURE_RAIL.recommendations[0].title);
    expect(html).toContain(FIXTURE_RAIL.recentConversation!.title);
  });

  it("Pending Approvals and AI Suggestions come from EXISTING runtime data passed in by Dashboard (boundary predicates + workspace.suggestedActions) -- when absent, those two sections simply don't render; the other three always do", () => {
    const html = renderRail(false);
    expect(html).not.toContain("Pending Approvals");
    expect(html).not.toContain("AI Suggestions");
    expect(html).toContain("Continue Learning");
    expect(html).toContain("Recommended Today");
    expect(html).toContain("Recent Conversation");
    // Dashboard composes them from existing state, no new services:
    expect(dashboardSource).toMatch(/workspace\.suggestedActions/);
    expect(dashboardSource).toMatch(/railPendingApprovals/);
  });
});

// PO decision (post-v2 correction): the action-bar cards are REMOVED from
// Home again (presentation only) -- nothing replaces them. The approval
// CAPABILITY stays: the same StepApprovalDialog, the same runtime
// predicates (wiring the Assistant Rail's Pending Approvals rows), and the
// runtime modules themselves (readOnlyRuntime.test.ts / writeRuntime.test.ts
// / ChatPageAgentExecutionWiring.test.tsx cover execution semantics, which
// this change never touches).
describe("PO correction: Home action-bar cards removed -- approval capability preserved through dialog + rail", () => {
  it("none of the bar presentations render on Home (no bar copy, no bar-only i18n keys)", () => {
    expect(dashboardSource).not.toMatch(/approval_card_title/);
    expect(dashboardSource).not.toMatch(/write_task_title/);
    expect(dashboardSource).not.toMatch(/agent_run_read_only_action/);
    expect(dashboardSource).not.toMatch(/border-\[#7D5CFF\]\/30 bg-\[#7C4DFF\]\/\[0\.07\]/);
    expect(dashboardSource).not.toMatch(/border-\[#7078B4\]\/25 bg-\[#0F1128\]\/\[0\.55\]/);
  });

  it("nothing replaced the bars: between the hero section and the chat panel only the v2 metric-capsule row renders -- no interactive bar/button", () => {
    const heroEnd = dashboardSource.indexOf("</WorkspaceRevealSection>", dashboardSource.indexOf("min-h-[190px]"));
    const chatIndex = dashboardSource.indexOf("<ChatPage");
    expect(heroEnd).toBeGreaterThan(-1);
    expect(chatIndex).toBeGreaterThan(heroEnd);
    const between = dashboardSource.slice(heroEnd, chatIndex);
    expect(between).toMatch(/Habit Streak/);
    expect(between).not.toMatch(/<Button|<button|onClick/);
  });

  it("the approval surfaces stay: StepApprovalDialog still renders with the same generic/taskComplete targets, opened from the rail's Pending Approvals rows via the SAME runtime predicates", () => {
    expect(dashboardSource).toMatch(/<StepApprovalDialog/);
    expect(dashboardSource).toMatch(/setApprovalDialogTarget\("generic"\);\s*setApprovalDialogOpen\(true\);/);
    expect(dashboardSource).toMatch(/setApprovalDialogTarget\("taskComplete"\);\s*setApprovalDialogOpen\(true\);/);
    expect(dashboardSource).toMatch(/pendingStepApproval && pendingApprovalStep/);
    expect(dashboardSource).toMatch(/getTaskCompleteWriteCandidate/);
    // The dialog itself performs approve/reject/close against the approval
    // service (see StepApprovalDialog.tsx) -- Dashboard only opens/closes it.
    expect(dashboardSource).toMatch(/onDecision=\{handleApprovalDialogDecision\}/);
  });

  it("the old large-card metadata-grid presentation also stays gone (nothing regressed back in)", () => {
    expect(dashboardSource).not.toMatch(/rounded-xl border border-primary\/15/);
    expect(dashboardSource).not.toMatch(/agent_resolved_tool/);
    expect(dashboardSource).not.toMatch(/reflection_section_label/);
    expect(dashboardSource).not.toMatch(/ReflectionSummary/);
  });
});

// Frozen handoff §5: the approved hero -- sky gradient, exact star field,
// atmospheric glow, inward moon/orb group. NO mountains of any kind.
describe("Frozen handoff: hero is the approved star-field composition -- NO mountain/ridge/wave paths", () => {
  it("no mountain/ridge/wave SVG polygons or ribbon paths remain anywhere in Dashboard.tsx", () => {
    expect(dashboardSource).not.toMatch(/<polygon/);
    expect(dashboardSource).not.toMatch(/viewBox="0 0 1200 340"/);
    expect(dashboardSource).not.toMatch(/viewBox="0 0 400 160"/);
    expect(dashboardSource).not.toMatch(/--flow-primary-900/);
    expect(dashboardSource).not.toMatch(/--flow-bg-deep/);
  });

  it("the hero SVG is the 1200x300 canvas with the v2 crop (xMidYMax slice) and the v2 heights: 190px, 196px at <=760px", () => {
    const hero = heroBlock();
    expect(dashboardSource).toMatch(/min-h-\[190px\]/);
    expect(dashboardSource).toMatch(/max-\[760px\]:min-h-\[196px\]/);
    expect(dashboardSource).not.toMatch(/min-h-\[248px\]/);
    expect(hero).toMatch(/viewBox="0 0 1200 300"/);
    expect(hero).toMatch(/preserveAspectRatio="xMidYMax slice"/);
    expect(hero).toMatch(/#0C0F2E/);
    expect(hero).toMatch(/#080A1F/);
    expect(hero).toMatch(/#050615/);
  });

  it("the star field is the exact frozen 20-circle set with the prototype's twinkling stars (sfTwinkle, staggered 3.4-4.6s)", () => {
    const hero = heroBlock();
    // 20 stars + the 3 moon circles = 23 <circle> elements in the hero SVG.
    const circles = hero.match(/<circle /g) ?? [];
    const twinkles = hero.match(/sfTwinkle/g) ?? [];
    expect(circles).toHaveLength(23);
    // The handoff PROSE says "exactly 5 animate sfTwinkle", but its own
    // position list marks 4 stars (*) and the authoritative prototype
    // (`SmartFlow Home.dc.html`, which the handoff defers to for "exact
    // rendered values") animates exactly these same 4: (230,30) (545,48)
    // (748,34) (1120,66). Implemented verbatim from the prototype;
    // discrepancy reported in the implementation handback.
    expect(twinkles).toHaveLength(4);
  });

  it("the moon/orb group sits inward at (880,118) with the frozen radii (15 core, 30 + 46 rings) and breathes via sfMoonBreathe", () => {
    const hero = heroBlock();
    expect(hero).toMatch(/<circle cx="880" cy="118" r="46"/);
    expect(hero).toMatch(/<circle cx="880" cy="118" r="30"/);
    expect(hero).toMatch(/<circle cx="880" cy="118" r="15"/);
    expect(hero).toMatch(/sfMoonBreathe 8s ease-in-out infinite/);
  });

  it("the hero mounts no FlowAIOrb of its own -- the real orb lives in the Assistant Rail per the frozen component mapping", () => {
    expect(heroBlock()).not.toMatch(/<FlowAIOrb/);
  });

  it("SmartFlow Home v2: the hero overlay is date eyebrow + greeting H1 ONLY (32px, 23px at <=760px) -- no supporting sentence and no capsules inside the hero", () => {
    const hero = heroBlock();
    expect(hero).toMatch(/<h1/);
    expect(hero).toMatch(/workspace\.hero\.title/);
    expect(hero).toMatch(/text-\[32px\]/);
    expect(hero).toMatch(/max-\[760px\]:text-\[23px\]/);
    expect(hero).toMatch(/workspace\.today\.label/);
    expect(hero).not.toMatch(/workspace\.hero\.summary/);
    expect(hero).not.toMatch(/Open Tasks/);
    expect(hero).not.toMatch(/workspace\.signals\.incompleteTasks/);
    expect(dashboardSource).toMatch(/max-w-\[720px\]/);
  });

  it("SmartFlow Home v2: the FOUR metric capsules (Open Tasks · Today's Events · Habit Streak · Approvals) render as an equal-stretch row (flex-1, min-w 150px) between the hero and the chat shell, from existing data only", () => {
    const heroEnd = dashboardSource.indexOf("</WorkspaceRevealSection>", dashboardSource.indexOf("min-h-[190px]"));
    const chatIndex = dashboardSource.indexOf("<ChatPage");
    const betweenHeroAndChat = dashboardSource.slice(heroEnd, chatIndex);
    expect(betweenHeroAndChat).toMatch(/Open Tasks/);
    expect(betweenHeroAndChat).toMatch(/Today&apos;s Events/);
    expect(betweenHeroAndChat).toMatch(/Habit Streak/);
    expect(betweenHeroAndChat).toMatch(/Approvals/);
    expect(betweenHeroAndChat).toMatch(/min-w-\[150px\] flex-1/);
    expect(betweenHeroAndChat).toMatch(/workspace\.signals\.incompleteTasks/);
    expect(betweenHeroAndChat).toMatch(/workspace\.signals\.eventsToday/);
    expect(betweenHeroAndChat).toMatch(/\{habitStreak\}/);
    expect(betweenHeroAndChat).toMatch(/\{approvalsPendingCount\}/);
    // Habit Streak reuses the EXISTING habits query (same React Query key
    // useWorkspace already fetches) -- no new backend read.
    expect(dashboardSource).toMatch(/useHabits\(\)/);
    expect(dashboardSource).toMatch(/habit\.currentStreak/);
  });
});

// Frozen handoff §3/§7: the desktop shell grid + the chat flex chain.
describe("Frozen handoff: desktop grid and the chat layout contract (composer always visible)", () => {
  it("Home's desktop surface is the frozen grid -- minmax(0,1fr) center + 372px rail (330px at <=1280px; rail leaves the grid at <=1120px) on a 100dvh non-scrolling page", () => {
    expect(dashboardSource).toMatch(/lg:grid-cols-\[minmax\(0,1fr\)_372px\]/);
    expect(dashboardSource).toMatch(/lg:max-\[1280px\]:grid-cols-\[minmax\(0,1fr\)_330px\]/);
    expect(dashboardSource).toMatch(/lg:max-\[1120px\]:grid-cols-\[minmax\(0,1fr\)\]/);
    expect(dashboardSource).toMatch(/lg:h-dvh lg:min-h-0 lg:overflow-hidden/);
    // No brittle viewport-magic values -- the frozen grid/flex contract
    // sizes everything structurally:
    expect(dashboardSource).not.toMatch(/calc\(100vh-/);
  });

  it("the center column is a flex column with min-width/min-height 0, the hero a flex-none row, and the chat wrapper the flex-1/min-h-0 remainder (REV 2: hero flows DIRECTLY into chat)", () => {
    expect(dashboardSource).toMatch(/flex min-h-0 min-w-0 flex-col/);
    expect(dashboardSource).toMatch(/lg:flex lg:min-h-0 lg:flex-1 lg:flex-col/);
  });

  it("the chat shell is the frozen glass treatment (radius 18, §7 border/background/shadow), flex-col/flex-1/min-h-0/overflow-hidden", () => {
    expect(dashboardSource).toMatch(
      /flex min-h-0 flex-1 flex-col overflow-hidden rounded-\[18px\] border border-\[#7078B4\]\/\[0\.22\] bg-\[#080A1B\]\/\[0\.55\]/,
    );
  });

  it("inside ChatPage: transcript is the ONLY scrolling region (flex-1/min-h-0/overflow-y-auto/overscroll-contain) and the composer is a non-scrolling flex-none footer outside it", () => {
    expect(chatPageSource).toMatch(/min-h-0 flex-1 overflow-y-auto overscroll-contain px-3/);
    expect(chatPageSource).toMatch(/className="shrink-0 border-t border-border\/60 bg-background\/95"/);
    expect(chatPageSource).toMatch(/className="flex min-h-0 flex-1"/);
    // REV 2 §7: the flex chain is unchanged; only the lg centred cap
    // moved behind `!embedded` (see the wider-transcript describe above).
    expect(chatPageSource).toMatch(
      /'relative flex min-w-0 flex-1 flex-col min-h-0', !embedded && 'lg:mx-auto lg:max-w-3xl'/,
    );
  });

  it("at <=1120px the Assistant Rail becomes a fixed right overlay (372px, max 92vw, z-70) over a z-60 scrim, opened from the chat header's panel button", () => {
    expect(dashboardSource).toMatch(/lg:max-\[1120px\]:fixed/);
    expect(dashboardSource).toMatch(/lg:max-\[1120px\]:w-\[372px\]/);
    expect(dashboardSource).toMatch(/lg:max-\[1120px\]:max-w-\[92vw\]/);
    expect(dashboardSource).toMatch(/lg:max-\[1120px\]:z-\[70\]/);
    expect(dashboardSource).toMatch(/lg:max-\[1120px\]:z-\[60\]/);
    expect(dashboardSource).toMatch(/onOpenAssistantPanel=\{\(\) => setAssistantPanelOpen\(true\)\}/);
  });
});

// Mobile responsive pass (PO: "the mobile section must be fixed too --
// the design must be responsive"): below lg Home lives in the app's
// scrollable mobile shell (search row above, fixed bottom nav below), so
// the chat wrapper can't be flex-sized by the page -- it takes a
// dvh-bound height instead, tuned so the composer lands at the bottom
// nav's top edge on first paint instead of being clipped behind it.
describe("Mobile responsive pass: bounded dvh chat wrapper below lg", () => {
  it("the chat wrapper's mobile height is dvh-bound with a min-height floor for short viewports, and lg still overrides back to the desktop flex contract", () => {
    expect(dashboardSource).toMatch(
      /h-\[calc\(100dvh-318px\)\] min-h-\[420px\] flex-col[^"]*lg:h-auto lg:min-h-0 lg:flex-1/,
    );
  });
});

// Navigation cross-check (full behavioral coverage lives in
// Sidebar.test.tsx): Dashboard renders no nav chrome of its own.
describe("Frozen handoff: navigation rail presentation", () => {
  it("Dashboard.tsx itself renders no navigation chrome of its own -- the slim rail/drawer is entirely AppLayout/Sidebar's route-aware concern, not duplicated here", () => {
    expect(dashboardSource).not.toMatch(/<Sidebar/);
    expect(dashboardSource).not.toMatch(/<nav\b/);
  });
});

describe("Frozen handoff: existing capabilities preserved elsewhere, not deleted", () => {
  it("the cold-start Welcome Workspace flow (workspace.isLowData) still renders WelcomeWorkspace", () => {
    expect(dashboardSource).toMatch(/workspace\.isLowData \? \(/);
    expect(dashboardSource).toMatch(/<WelcomeWorkspace/);
  });

  it("AiInsightsWidget/FocusPlaylistCard/AddHabitModal are removed from Home's composition, not deleted from the codebase", () => {
    expect(readFileSync(
      fileURLToPath(new URL("../components/dashboard/AiInsightsWidget.tsx", import.meta.url)),
      "utf-8",
    )).toMatch(/export function AiInsightsWidget/);
    expect(readFileSync(
      fileURLToPath(new URL("../features/habits/components/AddHabitModal.tsx", import.meta.url)),
      "utf-8",
    )).toMatch(/export function AddHabitModal/);
  });
});
