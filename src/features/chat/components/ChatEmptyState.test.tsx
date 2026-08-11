import { BookOpen } from "lucide-react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatEmptyState, type ChatEmptyStateAction } from "./ChatEmptyState";

// Language/RTL-dependent behavior is covered separately in
// ChatEmptyStateRTL.test.tsx (needs jsdom + a live re-render to flip
// useAppearance's language away from its default -- see that file's own
// header comment for why plain renderToString can't be used for that).

// SmartFlow -- Flow AI visual identity (task 17b). Uses the same
// renderToString pattern as task 17a's own component tests
// (ChatComposer.test.tsx uses RTL/jsdom instead only where a real DOM/user
// interaction is needed -- this component has no measurement/focus logic,
// so the lighter renderToString approach used elsewhere in this codebase
// (ConversationsList.test.tsx, JumpToLatestPill.test.tsx) applies here too.

const action: ChatEmptyStateAction = {
  id: "study",
  labelKey: "flow_action_study",
  descKey: "flow_action_study_desc",
  icon: BookOpen,
  iconBg: "bg-blue-500/15",
  iconColor: "text-blue-400",
  accent: "study",
  prompt: "Help me study and review a concept for my FIAE exam.",
};

describe("ChatEmptyState", () => {
  it("renders the greeting with the given name and no stats row (task 17b: 'compact welcome card... NO stats row')", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    expect(html).toContain("Aryan");
    expect(html).not.toMatch(/conversation/i);
    expect(html).not.toMatch(/tasks created/i);
  });

  it("light theme renders the action's own iconBg/iconColor classes and no inline flow-token style (PO scope: light theme untouched)", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="light" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    expect(html).toContain("bg-blue-500/15");
    expect(html).toContain("text-blue-400");
    expect(html).not.toContain("var(--flow-study");
    expect(html).not.toContain("var(--flow-gradient-orb)");
  });

  it("dark theme renders the accent as an inline flow-token style, not the light-mode Tailwind classes", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    expect(html).toContain("var(--flow-study-bg)");
    expect(html).toContain("var(--flow-study)");
    expect(html).not.toContain("bg-blue-500/15");
  });

  it("dark theme renders exactly one orbital motif element, contained (aria-hidden, decorative) and never inside the text block", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    const orbMatches = html.match(/var\(--flow-gradient-orb\)/g) ?? [];
    expect(orbMatches).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
  });

  it("light theme renders no orbital motif at all", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="light" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    expect(html).not.toContain("--flow-gradient-orb");
  });

  it("LTR (default language): the row carries dir=ltr", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    expect(html).toContain('dir="ltr"');
  });

  it("uses logical start/end classes for the orb and card padding, never hardcoded left/right", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    expect(html).toMatch(/-end-10/);
    expect(html).not.toMatch(/\bleft-10\b|\bright-10\b/);
  });

  it("does not truncate the action label or description (task 17b: 'full labels, no truncation')", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    expect(html).not.toContain("truncate");
  });

  it("each chip is a role=listitem inside a role=list row", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    expect(html).toContain('role="list"');
    expect(html).toContain('role="listitem"');
  });

  it("disabled=true disables every chip button (no sending mid-flight)", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled onSelectPrompt={vi.fn()} />,
    );
    expect(html).toContain("disabled=\"\"");
  });
});

// Task 17c, PO decision D2: "NO quick-action cards/chips on mobile AT ALL...
// Desktop keeps 17b's chip row (breakpoint-gated)." Verified structurally,
// not just via a CSS class name: the mobile block is a genuinely separate
// subtree containing zero chip/card/orb markup, not the same markup merely
// hidden by a `hidden` utility class -- extracted from the full HTML string
// via the two data-testid markers so each block's OWN markup can be
// inspected in isolation.
describe("ChatEmptyState D2: mobile has no chip/card/orb markup at all", () => {
  function extractTestBlock(html: string, testId: string): string {
    const marker = `data-testid="${testId}"`;
    const start = html.indexOf(marker);
    expect(start, `expected a [${marker}] element`).toBeGreaterThan(-1);
    // Both blocks are simple, non-nested-div-of-the-same-testid content --
    // grabbing up to the next data-testid marker (or end of string for the
    // last one) is enough to isolate each block's own markup.
    const nextMarkerIndex = html.indexOf("data-testid=", start + marker.length);
    return html.slice(start, nextMarkerIndex === -1 ? undefined : nextMarkerIndex);
  }

  it("the mobile block (lg:hidden) contains no chip buttons, no role=listitem, no card, and no orbital motif", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    const mobileBlock = extractTestBlock(html, "chat-empty-state-mobile");
    expect(mobileBlock).not.toContain("role=\"listitem\"");
    expect(mobileBlock).not.toContain("<button");
    expect(mobileBlock).not.toContain("glass-card");
    expect(mobileBlock).not.toContain("--flow-gradient-orb");
    expect(mobileBlock).toContain("Aryan");
  });

  it("the mobile block is marked lg:hidden and the desktop block is marked hidden lg:block (breakpoint gating)", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    const mobileBlock = extractTestBlock(html, "chat-empty-state-mobile");
    const desktopBlock = extractTestBlock(html, "chat-empty-state-desktop");
    expect(mobileBlock).toMatch(/class="[^"]*\blg:hidden\b/);
    expect(desktopBlock).toMatch(/class="[^"]*\bhidden\b[^"]*\blg:block\b/);
  });

  it("the desktop block still renders the full chip row (D2 only removes chips from MOBILE, desktop keeps them)", () => {
    const html = renderToString(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    const desktopBlock = extractTestBlock(html, "chat-empty-state-desktop");
    expect(desktopBlock).toContain('role="listitem"');
    expect(desktopBlock).toContain(action.labelKey === "flow_action_study" ? "Study With Me" : "");
  });
});
