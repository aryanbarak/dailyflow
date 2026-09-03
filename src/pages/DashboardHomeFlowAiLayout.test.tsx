import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRightRail } from "@/features/workspace";

// Home V2 final visual alignment. Dashboard.tsx mounts useWorkspace() (a
// composition of useTasks/useEvents/useFinance/useChatSessions/useHabits/
// useDocuments/useLearnAiActivity) plus a dozen agent-runtime hooks -- the
// same "too heavy to mount, verify shipped SOURCE instead" situation
// ChatPageDesktopLayout.test.tsx/ChatPagePwaScroll.test.tsx already
// document and rely on for ChatPage.tsx. FlowAIAssistantRail itself is
// lightweight (only useNavigate) and exported specifically so it CAN be
// rendered for real -- used below wherever the contract is actually about
// its rendered output, per this task's "avoid fragile case-sensitive
// source checks where a render-level test can prove the actual behavior."
vi.mock("@/components/FlowAIOrb", () => ({ FlowAIOrb: (props: { ariaLabel?: string }) => <div data-testid="flow-ai-orb" aria-label={props.ariaLabel} /> }));
vi.mock("@/components/smartflow", () => ({ SmartflowAsciiVisual: () => null }));
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

function renderRail() {
  return renderToString(
    <MemoryRouter>
      <FlowAIAssistantRail rail={FIXTURE_RAIL} />
    </MemoryRouter>,
  );
}

// Requirement 1 (task list): Home uses the real ChatPage.
describe("Home V2 final contract: the real chat surface is embedded, not a promo card", () => {
  it("Dashboard renders the actual ChatPage component in embedded mode -- same messages/composer/approval/execution logic as /chat, not a duplicate", () => {
    expect(dashboardSource).toMatch(/<ChatPage embedded \/>/);
  });

  it("ChatPage is imported from its real module, not re-implemented locally", () => {
    expect(dashboardSource).toMatch(/import ChatPage from "@\/pages\/ChatPage"/);
  });
});

// Requirement 11: standalone /chat behavior remains unaffected by the
// `embedded` prop Home's usage relies on.
describe("Home V2 final contract: ChatPage's `embedded` prop only changes its own root sizing, nothing else", () => {
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
    expect(chatPageSource).toMatch(/export default function ChatPage\(\{ embedded = false \}: ChatPageProps = \{\}\)/);
  });

  it("round 2 (PO local review): Home's embedded panel passes 'SmartFlow' as the header's titleOverride -- the standalone route (embedded=false) resolves the SAME expression to undefined, so its own chat_title translation ('Flow AI', proven in ChatPageHeader.test.tsx) is unaffected -- this is the minimal extension of the existing `embedded` presentation mode the task asked for, not a new prop/route", () => {
    expect(chatPageSource).toMatch(/titleOverride=\{embedded \? 'SmartFlow' : undefined\}/);
  });
});

// Requirements 2, 3, 4: nothing renders after chat in Home's main column.
describe("Home V2 final contract: nothing below the chat -- Home's main column ends with the chat panel", () => {
  it("AiInsightsWidget is not imported or rendered by Dashboard.tsx at all (not just moved -- removed from Home's composition; the component itself is untouched elsewhere)", () => {
    expect(dashboardSource).not.toMatch(/AiInsightsWidget/);
  });

  it("no Manual Actions composition exists after chat", () => {
    expect(dashboardSource).not.toMatch(/Manual Actions/);
  });

  it("FocusPlaylistCard is not defined or rendered by Dashboard.tsx at all", () => {
    expect(dashboardSource).not.toMatch(/FocusPlaylistCard/);
  });

  it("the chat panel is the LAST element of the main content column before it closes -- nothing else follows except the Assistant Rail's own mobile-stacked placement (a distinct, explicitly-preserved surface, not a dashboard card)", () => {
    // Everything between the chat panel's own WorkspaceRevealSection and
    // the closing of the isLowData ternary's main-column fragment is
    // either the mobile Assistant Rail stack or JSX structure/whitespace
    // -- no OTHER named section (AiInsightsWidget/Manual Actions/Focus
    // Playlist/AddHabitModal) can appear there.
    const chatIndex = dashboardSource.indexOf("<ChatPage embedded />");
    const fragmentCloseIndex = dashboardSource.indexOf("</>", chatIndex);
    expect(chatIndex).toBeGreaterThan(-1);
    expect(fragmentCloseIndex).toBeGreaterThan(chatIndex);
    const afterChat = dashboardSource.slice(chatIndex, fragmentCloseIndex);
    expect(afterChat).not.toMatch(/AiInsightsWidget|Manual Actions|FocusPlaylistCard|AddHabitModal/);
  });
});

// Requirements 5, 6, 7, 8, 9: the FULL Assistant Rail, restored, with the
// SmartFlow naming correction -- proven by rendering the real component,
// not by regexing its source (the exact gap that let PR #211's compact
// trim slip past the previous version of this test file).
describe("Home V2 final contract: the FULL Assistant Rail is restored, unconditionally, for normal Home", () => {
  it("both Dashboard call sites (mobile-stacked and desktop-sticky) render FlowAIAssistantRail with no trimming prop -- one full panel, not a compact summary", () => {
    const matches = dashboardSource.match(/<FlowAIAssistantRail rail=\{workspace\.rightRail\} \/>/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // No leftover trimming mechanism from the superseded PR #211 contract
    // -- checked as actual usage/declaration syntax (`=`/`:` immediately
    // after the identifier), not a bare word, since Dashboard.tsx's own
    // comments legitimately still narrate that history in prose.
    expect(dashboardSource).not.toMatch(/showChatEntry\s*[:=]/);
    expect(dashboardSource).not.toMatch(/HomeTodayContext\s*[<({]/);
  });

  it("renders the animated assistant visual (FlowAIOrb) with SmartFlow status/CTA copy, Online state, Continue learning, Recommended today, Recent conversation, and their View all actions -- the complete original panel, not a subset", () => {
    const html = renderRail();

    // Requirement 8: the animated assistant visual/component is present.
    expect(html).toContain('data-testid="flow-ai-orb"');

    // Requirement 9: SmartFlow naming, not "Flow AI", in the visible copy.
    expect(html).toContain("SmartFlow");
    expect(html).toContain("Chat with SmartFlow");
    expect(html).not.toContain("Flow AI");

    // Status/CTA/Online state.
    expect(html).toContain(FIXTURE_RAIL.statusMessage);
    expect(html).toContain("Online");

    // Requirement 6: Continue Learning, with its progress bar and item.
    expect(html).toContain("Continue learning");
    expect(html).toContain(FIXTURE_RAIL.recentLessons[0].title);
    expect(html).toMatch(/width:\s*40%/);

    // Requirement 7: Recommended Today.
    expect(html).toContain("Recommended today");
    expect(html).toContain(FIXTURE_RAIL.recommendations[0].title);

    // Recent conversation + "View all" interactions (at least 3, one per
    // section) + existing borders/scroll-eligible card chrome.
    expect(html).toContain("Recent conversation");
    expect(html).toContain(FIXTURE_RAIL.recentConversation!.title);
    expect(html.match(/>View all</g)?.length).toBe(3);
    expect(html).toContain("glass-card");
    expect(html).toContain("border-t border-border/35");
  });

  it("Pending Approvals and AI Suggestions are not part of this panel (they were never part of the original pre-#211 panel either) -- only Continue learning, Recommended today, and Recent conversation, as the source of truth had it", () => {
    const html = renderRail();
    expect(html).not.toContain("Pending Approvals");
    expect(html).not.toContain("AI Suggestions");
  });
});

// Requirement 6 (approval/agent boundary presentation): still conditional
// runtime UI, not a permanent block between the header and chat, and
// unchanged in behavior.
describe("Home V2 final contract: approval/write/read-only boundary cards stay conditional runtime UI, not a permanent dashboard block", () => {
  it("all three boundary cards remain conditionally rendered (unchanged execution/state logic) and sit between the header and the chat panel", () => {
    expect(dashboardSource).toMatch(/pendingStepApproval && pendingApprovalStep/);
    expect(dashboardSource).toMatch(/taskCompleteWriteCandidate &&/);
    expect(dashboardSource).toMatch(/readOnlyRuntimeStep && readOnlyRuntimeResolution/);

    const approvalIndex = dashboardSource.indexOf("pendingStepApproval && pendingApprovalStep");
    const chatIndex = dashboardSource.indexOf("<ChatPage embedded />");
    expect(approvalIndex).toBeGreaterThan(-1);
    expect(approvalIndex).toBeLessThan(chatIndex);
  });
});

// Requirement 3 (scenic hero): dark background, moon/orb upper-right,
// greeting + compact stats over it, no new asset/content pipeline.
describe("Home V2 final contract: scenic hero header", () => {
  it("uses the existing dark cosmic gradient token as the background, not a new asset", () => {
    expect(dashboardSource).toMatch(/background:\s*"var\(--flow-gradient-background\)"/);
  });

  it("places the existing FlowAIOrb component (the same 'orb' the rail/sidebar already use) as the moon/orb visual, decorative (aria-hidden)", () => {
    const heroIndex = dashboardSource.indexOf('background: "var(--flow-gradient-background)"');
    const orbIndex = dashboardSource.indexOf("<FlowAIOrb", heroIndex);
    expect(orbIndex).toBeGreaterThan(heroIndex);
    expect(orbIndex).toBeLessThan(dashboardSource.indexOf("<ChatPage embedded />"));
  });

  it("greeting text and compact stats render above the scenery (relative z-10), not as a separate card below it", () => {
    expect(dashboardSource).toMatch(/relative z-10 max-w-2xl/);
    expect(dashboardSource).toMatch(/workspace\.signals\.incompleteTasks/);
    expect(dashboardSource).toMatch(/workspace\.signals\.eventsToday/);
    expect(dashboardSource).toMatch(/approvalsPendingCount/);
  });

  it("round 2 (PO local review): the mountain silhouette has multiple (4) depth layers, not two flat zig-zag polygons -- back-to-front colors from the existing token palette, darkest/foreground layer opaque", () => {
    const heroIndex = dashboardSource.indexOf('background: "var(--flow-gradient-background)"');
    const svgIndex = dashboardSource.indexOf("<svg", heroIndex);
    const svgEndIndex = dashboardSource.indexOf("</svg>", svgIndex);
    const svgBlock = dashboardSource.slice(svgIndex, svgEndIndex);
    const polygonMatches = svgBlock.match(/<polygon\b/g) ?? [];
    expect(polygonMatches).toHaveLength(4);
    expect(svgBlock).toMatch(/fill="var\(--flow-blue\)"/);
    expect(svgBlock).toMatch(/fill="var\(--flow-primary-700\)"/);
    expect(svgBlock).toMatch(/fill="var\(--flow-primary-900\)"/);
    expect(svgBlock).toMatch(/fill="var\(--flow-bg-deep\)"/);
  });

  it("round 2: a star treatment (dot-pattern radial-gradient background, the same technique Sidebar.tsx's own starfield already uses) and a violet atmospheric glow behind the mountains are present", () => {
    const heroIndex = dashboardSource.indexOf('background: "var(--flow-gradient-background)"');
    const chatIndex = dashboardSource.indexOf("<ChatPage embedded />");
    const heroBlock = dashboardSource.slice(heroIndex, chatIndex);
    const starLayerMatches = heroBlock.match(/radial-gradient\(circle at center,/g) ?? [];
    expect(starLayerMatches.length).toBeGreaterThanOrEqual(2);
    expect(heroBlock).toMatch(/var\(--flow-glow-violet\)/);
  });

  it("round 2: the moon/orb uses a smaller, less-blurred preset (xl, not hero) so it reads as a clear glowing moon rather than a large blur", () => {
    const heroIndex = dashboardSource.indexOf('background: "var(--flow-gradient-background)"');
    const chatIndex = dashboardSource.indexOf("<ChatPage embedded />");
    const heroBlock = dashboardSource.slice(heroIndex, chatIndex);
    expect(heroBlock).toMatch(/<FlowAIOrb size="xl"/);
    expect(heroBlock).not.toMatch(/<FlowAIOrb size="hero"/);
  });
});

// Round 2 (PO local review): the conditional approval/write/read-only
// boundary surfaces are compact single-row action bars now, not large
// dashboard cards -- proven by the ABSENCE of the old bulky presentation
// (metadata grids, eyebrow labels, reflection/preview detail blocks) and
// the PRESENCE of the same conditions/handlers this file already proved
// above (requirement 6's describe block, unchanged by this round).
describe("Home V2 final contract, round 2: agent boundary surfaces are compact action bars, not large cards", () => {
  it("the old large-card treatment (rounded-xl cards, metadata grids, eyebrow labels, reflection/preview detail) is gone", () => {
    expect(dashboardSource).not.toMatch(/rounded-xl border border-primary\/15/);
    expect(dashboardSource).not.toMatch(/agent_resolved_tool/);
    expect(dashboardSource).not.toMatch(/agent_execution_mode/);
    expect(dashboardSource).not.toMatch(/write_task_target_label/);
    expect(dashboardSource).not.toMatch(/agent_vertical_slice_label/);
    expect(dashboardSource).not.toMatch(/approval_boundary_label/);
    expect(dashboardSource).not.toMatch(/write_task_boundary_label/);
    expect(dashboardSource).not.toMatch(/reflection_section_label/);
    expect(dashboardSource).not.toMatch(/safePreviewItems/);
    expect(dashboardSource).not.toMatch(/ReflectionSummary/);
  });

  it("all three surfaces now share the same compact single-row bar treatment", () => {
    const matches = dashboardSource.match(/rounded-lg border border-primary\/20/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("every action button's exact onClick handler and disabled condition are byte-identical to before this round -- only the surrounding markup changed", () => {
    expect(dashboardSource).toMatch(/onClick=\{\(\) => \{\s*setApprovalDialogTarget\("generic"\);\s*setApprovalDialogOpen\(true\);\s*\}\}/);
    expect(dashboardSource).toMatch(/onClick=\{\(\) => void handleRunTaskCompleteWrite\(\)\}/);
    expect(dashboardSource).toMatch(/disabled=\{taskCompleteRunStatus === "running" \|\| Boolean\(taskCompleteRunResult\)\}/);
    expect(dashboardSource).toMatch(/onClick=\{\(\) => \{\s*setApprovalDialogTarget\("taskComplete"\);\s*setApprovalDialogOpen\(true\);\s*\}\}/);
    expect(dashboardSource).toMatch(/onClick=\{\(\) => void handleRunReadOnlyTool\(\)\}/);
    expect(dashboardSource).toMatch(/disabled=\{readOnlyRunStatus === "running"\}/);
  });

  it("sufficient identifying text remains for every surface -- the task title, the approval card title, and the read-only step title are still rendered", () => {
    expect(dashboardSource).toMatch(/\{t\("approval_card_title"\)\}/);
    expect(dashboardSource).toMatch(/\{t\("write_task_title"\)\}: \{taskCompleteWriteCandidate\.taskTitle\}/);
    expect(dashboardSource).toMatch(/\{readOnlyRuntimeStep\.title\}/);
  });
});

// Requirement 10: Home navigation uses collapsed/icon-only presentation.
// (Full behavioral coverage lives in Sidebar.test.tsx's own "Home's
// collapsed icon-only rail" describe block -- this is a lightweight
// cross-check that Dashboard's own route doesn't fight that presentation,
// e.g. by rendering a second, competing nav element.)
describe("Home V2 final contract: navigation rail presentation", () => {
  it("Dashboard.tsx itself renders no navigation chrome of its own -- collapsing the rail is entirely AppLayout/Sidebar's route-aware concern, not duplicated here", () => {
    expect(dashboardSource).not.toMatch(/<Sidebar/);
    expect(dashboardSource).not.toMatch(/<nav\b/);
  });
});

describe("Home V2 final contract: existing capabilities preserved elsewhere, not deleted", () => {
  it("the cold-start Welcome Workspace flow (workspace.isLowData) is untouched by this layout change", () => {
    expect(dashboardSource).toMatch(/workspace\.isLowData \? \(\s*<WelcomeWorkspace/);
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

// Merge-blocker round (PO review), blocker 1: the embedded composer must
// stay fixed and always visible -- header pinned, transcript the ONLY
// scrollable region, composer a non-scrolling footer. The contract is a
// complete flex chain (bounded shell -> flex-1/min-h-0 at every level ->
// shrink-0 footer); these assertions pin each link so a future edit that
// silently breaks one (the historical failure mode: a nested flex item's
// content-based automatic min-height reintroducing growth) fails here.
describe("Home V2 merge blockers: embedded chat column contract (composer always visible)", () => {
  it("Home's desktop main column is a viewport-height flex column (100vh minus the shell chrome above it plus a bottom gap, 5.25rem -- measured in a real browser), so the chat card can never extend past the fold", () => {
    expect(dashboardSource).toMatch(/lg:h-\[calc\(100vh-5\.25rem\)\]/);
    expect(dashboardSource).toMatch(/lg:flex-col/);
    expect(dashboardSource).not.toMatch(/lg:h-\[calc\(100vh-230px\)\]/);
  });

  it("the chat card is a flex-col shell: bounded 560px below lg, flex-grown to the remaining column height at lg+, floored at a usable minimum", () => {
    expect(dashboardSource).toMatch(
      /flex h-\[560px\] flex-col overflow-hidden[^"]*lg:h-auto[^"]*lg:flex-1/,
    );
  });

  it("ChatPage's embedded root grows by flex (flex: 1 1 0% + minHeight: 0) inside that shell, not by percentage-height resolution alone", () => {
    expect(chatPageSource).toMatch(/flex: '1 1 0%', minHeight: 0/);
  });

  it("the transcript viewport is the only scrollable region (min-h-0 flex-1 overflow-y-auto) and the composer is a shrink-0 non-scrolling footer", () => {
    expect(chatPageSource).toMatch(/min-h-0 flex-1 overflow-y-auto overscroll-contain px-3/);
    expect(chatPageSource).toMatch(/className="shrink-0 border-t border-border\/60 bg-background\/95"/);
  });

  it("every intermediate flex level between root and transcript carries min-h-0 (body row, and the chat column -- appended so the pinned column substring other tests rely on stays intact)", () => {
    expect(chatPageSource).toMatch(/className="flex min-h-0 flex-1"/);
    expect(chatPageSource).toMatch(
      /relative flex min-w-0 flex-1 flex-col lg:mx-auto lg:max-w-3xl min-h-0/,
    );
  });
});

// Merge-blocker round (PO review), blocker 2: the hero must read as a real
// layered mountain composition -- night sky, stars, glowing moon/orb,
// mountains with depth -- not a thin decorative stripe. The old 400x160
// viewBox stretched ~12 small zig-zag points across the full hero width;
// that IS the "meaningless horizontal band" the PO rejected.
describe("Home V2 merge blockers: hero mountains are a real composition, not a stripe", () => {
  it("the mountain canvas is wide-aspect (1200x340) with a taller rendered band (h-40 -> lg:h-60), replacing the old 400x160 ribbon entirely", () => {
    expect(dashboardSource).toMatch(/viewBox="0 0 1200 340"/);
    expect(dashboardSource).toMatch(/h-40 w-full sm:h-52 lg:h-60/);
    expect(dashboardSource).not.toMatch(/viewBox="0 0 400 160"/);
  });

  it("each of the 4 depth layers has a handful of LARGE peaks with long slopes (8-11 points per polygon), not a dozen tightly-spaced zig-zag vertices", () => {
    const heroIndex = dashboardSource.indexOf('background: "var(--flow-gradient-background)"');
    const svgIndex = dashboardSource.indexOf("<svg", heroIndex);
    const svgEndIndex = dashboardSource.indexOf("</svg>", svgIndex);
    const svgBlock = dashboardSource.slice(svgIndex, svgEndIndex);
    const pointCounts = [...svgBlock.matchAll(/points="([^"]+)"/g)].map(
      (match) => match[1].trim().split(/\s+/).length,
    );
    expect(pointCounts).toHaveLength(4);
    for (const count of pointCounts) {
      expect(count).toBeGreaterThanOrEqual(8);
      expect(count).toBeLessThanOrEqual(11);
    }
  });

  it("the hero reserves a bottom band for the scenery (pb-20 -> sm:pb-24) so the mountains render below the copy instead of hiding behind it", () => {
    expect(dashboardSource).toMatch(/pb-20 pt-6 sm:px-6 sm:pb-24 lg:px-8/);
  });
});
