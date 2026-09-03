// @vitest-environment jsdom
//
// SmartFlow -- task 17g. PO decisions from device + desktop evidence:
// Y1 (remove assistant bubble border, composer decorative outline stays
// only as a focus ring), Y2 (remove the assistant avatar + its gutter),
// Y3 (constrain the desktop message COLUMN to a reading measure), Y4 (a
// stray cursor-following orb rendered over the conversation), Y5 (nested
// scrollbars from a redundant outer scroll container). Y3/Y4/Y5 touch
// AppLayout.tsx (LaunchProvider/LaunchContext-heavy, not mountable
// directly -- same constraint noted in ChatPageDesktopLayout.test.tsx and
// ChatPagePwaScroll.test.tsx from task 17f) and ChatPage.tsx's own
// default-exported page (auth/tasks/workspace-hook-heavy), so this file
// follows those files' own established pattern: real component tests for
// what IS mountable (ChatBubble, TypingIndicator via a message with
// `sending`), source-verification for what isn't.
//
// UPDATE, task 17h: Y4's own call was wrong -- the "stray orb" was
// app-shell chrome the PO actually likes, unrelated to 17b's chat-surface
// glow rule Y4 invoked to justify gating it. The Y4 describe block below
// now asserts the RESTORED (unconditional, app-wide) behaviour instead;
// see AppLayout.tsx's own task 17h comment and
// SmartflowPointerFollowerPreferences.test.tsx for the new
// enabled/colour/size/opacity settings coverage.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}));

import { ChatBubble } from "./ChatPage";

const srcDir = path.resolve(process.cwd(), "src");
const chatPageSource = readFileSync(path.join(srcDir, "pages", "ChatPage.tsx"), "utf-8");
const appLayoutSource = readFileSync(path.join(srcDir, "components", "layout", "AppLayout.tsx"), "utf-8");
const composerSource = readFileSync(
  path.join(srcDir, "features", "chat", "components", "ChatComposer.tsx"),
  "utf-8",
);
const emptyStateSource = readFileSync(
  path.join(srcDir, "features", "chat", "components", "ChatEmptyState.tsx"),
  "utf-8",
);

describe("Y1 (task 17g): no decorative border/outline on assistant or user bubbles", () => {
  it("the assistant bubble has no border class at all", () => {
    const { container } = render(<ChatBubble role="assistant" content="Hello there." />);
    const bubble = container.querySelector(".rounded-xl")!;
    expect(bubble.className).not.toMatch(/\bborder\b/);
    expect(bubble.className).not.toMatch(/border-border/);
  });

  it("the user bubble has no border class either (was already borderless, still is)", () => {
    const { container } = render(<ChatBubble role="user" content="Hello there." />);
    const bubble = container.querySelector(".rounded-xl")!;
    expect(bubble.className).not.toMatch(/\bborder\b/);
  });

  it("the typing indicator (shares the assistant bubble's own visual chrome) is also borderless, for consistency -- the exact className string has no border class directly in it", () => {
    // This exact contiguous className string only matches if there is
    // NOTHING (in particular no border class) between "assistant-foreground"
    // and "rounded-xl" -- proving the border class was removed from the
    // actual JSX, not merely reworded in a comment elsewhere in the file.
    expect(chatPageSource).toMatch(
      /bg-chat-bubble-assistant text-chat-bubble-assistant-foreground rounded-xl rounded-bl-sm px-4 py-3 text-sm flex items-center gap-1\.5/,
    );
  });

  it("the composer textarea has no permanent decorative border -- only the focus-visible ring remains", () => {
    // The exact contiguous className string (border-0 immediately after
    // rounded-2xl, immediately before the background) only matches if the
    // actual JSX has no border-color class in between -- proving removal
    // from the real code, not just from a comment.
    expect(composerSource).toMatch(/rounded-2xl border-0 bg-\[hsl\(var\(--glass-bg\)\)\]/);
    // The focus AFFORDANCE stays -- only visible on focus, not decorative.
    expect(composerSource).toMatch(/focus-visible:ring-2/);
  });
});

describe("Y2 (task 17g): no avatar node in assistant message rows; the empty-state greeting keeps its own avatar", () => {
  it("no icon-tile/Bot avatar renders next to an assistant reply", () => {
    const { container } = render(<ChatBubble role="assistant" content="Hello there." />);
    expect(container.querySelector(".icon-tile")).toBeNull();
    expect(container.querySelector("svg.lucide-bot")).toBeNull();
  });

  it("no avatar renders next to a user message either (never had one)", () => {
    const { container } = render(<ChatBubble role="user" content="Hello there." />);
    expect(container.querySelector(".icon-tile")).toBeNull();
  });

  it("the assistant bubble is now the ONLY child of its row -- no avatar gutter/gap left over", () => {
    const { container } = render(<ChatBubble role="assistant" content="Hello there." />);
    const row = container.querySelector(".chat-message-enter")!;
    expect(row.children.length).toBe(1);
    expect(row.className).not.toMatch(/gap-2\.5/);
  });

  it("the typing indicator's own avatar is also removed, for the same consistency reason as Y1", () => {
    expect(chatPageSource).not.toMatch(/icon-tile w-7 h-7 rounded-full shrink-0 mt-0\.5/);
  });

  it("the empty-state greeting's avatar is UNTOUCHED -- still present, still intentional (task 17d)", () => {
    expect(emptyStateSource).toMatch(/icon-tile h-8 w-8 shrink-0 rounded-full/);
    expect(emptyStateSource).toMatch(/<Bot className="h-4 w-4 text-primary" aria-hidden="true" \/>/);
  });
});

describe("Y3 (task 17g, scoped to STANDALONE by SmartFlow Home REV 2 §7): the standalone message column is capped to a reading measure at lg+; Home's embedded transcript deliberately is NOT", () => {
  it("the chat column carries the centred max-w-3xl at lg+ ONLY when not embedded -- Home's embedded transcript spans the full chat-shell width (REV 2 'wider conversation')", () => {
    expect(chatPageSource).toMatch(
      /'relative flex min-w-0 flex-1 flex-col min-h-0', !embedded && 'lg:mx-auto lg:max-w-3xl'/,
    );
  });

  it("the per-bubble 70ch cap is comfortably narrower than the standalone column's own 3xl cap -- no double-capping conflict (70ch ~ 490-560px at a 14px body font, well under 48rem/768px); embedded bubbles instead cap at the REV 2 percentages", () => {
    const { container } = render(<ChatBubble role="assistant" content="Hello there." />);
    const bubble = container.querySelector(".rounded-xl")!;
    expect(bubble.className).toMatch(/lg:max-w-\[70ch\]/);
    const embeddedRender = render(<ChatBubble role="assistant" content="Hello there." embedded />);
    const embeddedBubble = embeddedRender.container.querySelector(".rounded-xl")!;
    expect(embeddedBubble.className).toMatch(/lg:max-w-\[86%\]/);
    expect(embeddedBubble.className).not.toMatch(/lg:max-w-\[70ch\]/);
    const embeddedUser = render(<ChatBubble role="user" content="Hello there." embedded />);
    expect(embeddedUser.container.querySelector(".rounded-xl")!.className).toMatch(/lg:max-w-\[64%\]/);
    // The bubble cap is what actually binds at lg+; the standalone column
    // cap exists to keep the whole column from stretching edge-to-edge on
    // an ultra-wide monitor now that 17f removed the desktop sidebar.
  });
});

describe("Y4 (task 17g's gate REVERSED by task 17h): the cursor-following pointer glow renders on every route again, including chat -- it's app-shell chrome, a concern separate from 17b's chat-surface glow rule", () => {
  it("SmartflowPointerFollower renders unconditionally in AppLayout again (task 17g's per-page gate was removed)", () => {
    expect(appLayoutSource).toMatch(/\n\s*<SmartflowPointerFollower \/>/);
    expect(appLayoutSource).not.toMatch(/hideMobileChrome && <SmartflowPointerFollower/);
  });

  it("AppLayout still imports SmartflowPointerFollower", () => {
    expect(appLayoutSource).toMatch(/import \{ SmartflowPointerFollower \} from "@\/components\/smartflow"/);
  });

  it("the empty-state's own contained orb is untouched -- still one of 17b's two permitted CHAT-SURFACE placements (a separate rule from the pointer follower)", () => {
    expect(emptyStateSource).toMatch(/var\(--flow-gradient-orb\)/);
  });

  it("no ChatBubble/TypingIndicator render path introduces any new glow/orb token on the chat surface itself -- 17b's rule is unaffected by 17h restoring the (unrelated) pointer follower", () => {
    expect(chatPageSource).not.toMatch(/--flow-gradient-orb/);
    expect(chatPageSource).not.toMatch(/--flow-glow-/);
  });
});

describe("Y5 (task 17g): exactly one scroll container owns the chat message list on desktop", () => {
  it("the desktop <main> no longer scrolls for the chat page (redundant outer scroll container removed) -- the SmartFlow Home frozen handoff later widened the same per-page branch to a set that also covers Home ('/'), which self-manages its scroll the same way", () => {
    expect(appLayoutSource).toMatch(
      /className=\{cn\("flex-1 min-h-screen", PAGES_WITH_SELF_MANAGED_DESKTOP_SCROLL\.has\(location\.pathname\) \? "overflow-hidden" : "overflow-auto"\)\}/,
    );
    expect(appLayoutSource).toMatch(/PAGES_WITH_SELF_MANAGED_DESKTOP_SCROLL = new Set\(\["\/chat", "\/"\]\)/);
  });

  it("every OTHER page still gets the normal scrolling <main> (overflow-auto), unaffected", () => {
    // The ternary's false-branch (the non-chat-page case) is still
    // "overflow-auto" -- confirmed by the same regex above; this test
    // documents that the fix is a per-page branch, not a global removal.
    expect(appLayoutSource).toMatch(/"overflow-auto"/);
  });

  it("ChatPage's own message region remains the ONE real scroll container, with 17f's overscroll-contain preserved", () => {
    expect(chatPageSource).toMatch(/overflow-y-auto overscroll-contain px-3/);
  });

  it("ChatPage's own root still doesn't scroll itself (overflow-hidden) -- it delegates entirely to the one inner region (task 20c: overscroll-contain removed from this root -- it was never the scrolled element Y5's own fix cares about here; that was 17f, C1a's unrelated gesture-suppression concern, see ChatPagePwaScroll.test.tsx)", () => {
    expect(chatPageSource).toMatch(/overflow-hidden bg-background/);
  });
});
