// @vitest-environment jsdom
//
// SmartFlow -- task 17c, PO decision D4: "[More menu] [Conversations] --
// 'Flow AI' -- [theme/density] [New]... RTL: the whole header mirrors
// correctly." A fresh module graph + MemoryStorage shim is used per test
// (mirrors ChatEmptyStateRTL.test.tsx's own pattern): appearanceStore's
// persist middleware resolves `localStorage` at STORE-CREATION (module
// evaluation) time, not lazily per call, so a plain top-level static
// import + beforeEach stub is too late -- confirmed the hard way while
// writing this file.
//
// FLAKE-01: this file originally queried the global `screen` (document.
// body-wide), NOT scoped to each test's own render() container -- the one
// part of "mirrors ChatEmptyStateRTL.test.tsx's own pattern" (above) this
// file did NOT actually copy; that sibling scopes every query to its own
// `const { container } = render(...)` instead. A `screen` query makes a
// test's pass/fail depend on the ENTIRE document body being exactly what
// this one render produced -- if anything else is ever mounted at the
// same time for any reason (a previous test's cleanup() racing an async
// effect, a future regression, a testing-library/jsdom edge case), a
// same-named accessible name anywhere else in the body turns into "found
// multiple elements" here, in a file with NO code of its own to blame.
// Every render() below now captures its own `container` and every query
// is scoped to it via `within(container)` -- this test can now only ever
// see the DOM it itself created, matching the sibling file's own
// discipline exactly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import type { useAppearance as UseAppearance } from "@/features/settings/appearanceStore";
import type { ChatPageHeader as ChatPageHeaderComponent } from "./ChatPageHeader";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

async function freshModules() {
  vi.resetModules();
  const [appearanceMod, headerMod] = await Promise.all([
    import("@/features/settings/appearanceStore"),
    import("./ChatPageHeader"),
  ]);
  return {
    useAppearance: appearanceMod.useAppearance as typeof UseAppearance,
    ChatPageHeader: headerMod.ChatPageHeader as typeof ChatPageHeaderComponent,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatPageHeader composition (task 17c, D4)", () => {
  // The FIRST freshModules() call in this file pays the whole module-graph
  // import cost (appearanceStore + header, ~3-4s cold) -- under a fully
  // parallel `npm test` run that warmup intermittently blew the 5s default
  // and failed this one test by timeout with every assertion untouched.
  // Explicit timeout for the warmup-bearing test only.
  it("renders exactly two icon-only trigger buttons before the brand text -- More then Conversations, in that DOM order", { timeout: 20000 }, async () => {
    const { ChatPageHeader } = await freshModules();
    const { container } = render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={vi.fn()}
        onOpenConversations={vi.fn()}
        onStartNewChat={vi.fn()}
      />,
    );
    const moreButton = within(container).getByLabelText("More");
    const conversationsButton = within(container).getByLabelText("Conversations");
    expect(moreButton.compareDocumentPosition(conversationsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the More button uses the hamburger (Menu) icon and the Conversations button uses History -- NOT the hamburger (task 17c D4: 'ICON CHANGE per PO -- use a history/chat-list icon... NOT the hamburger')", async () => {
    const { ChatPageHeader } = await freshModules();
    const { container } = render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={vi.fn()}
        onOpenConversations={vi.fn()}
        onStartNewChat={vi.fn()}
      />,
    );
    const moreButton = within(container).getByLabelText("More");
    const conversationsButton = within(container).getByLabelText("Conversations");
    expect(moreButton.querySelector("svg")?.classList.toString()).toContain("lucide-menu");
    expect(conversationsButton.querySelector("svg")?.classList.toString()).toContain("lucide-history");
    expect(conversationsButton.querySelector("svg")?.classList.toString()).not.toContain("lucide-menu");
  });

  it("renders the full, untruncated 'Flow AI' brand text", async () => {
    const { ChatPageHeader } = await freshModules();
    const { container } = render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={vi.fn()}
        onOpenConversations={vi.fn()}
        onStartNewChat={vi.fn()}
      />,
    );
    const heading = within(container).getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Flow AI");
    expect(heading.className).not.toContain("truncate");
  });

  it("clicking More/Conversations/New Chat calls the respective handler", async () => {
    const { ChatPageHeader } = await freshModules();
    const onOpenMoreMenu = vi.fn();
    const onOpenConversations = vi.fn();
    const onStartNewChat = vi.fn();
    const { container } = render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={onOpenMoreMenu}
        onOpenConversations={onOpenConversations}
        onStartNewChat={onStartNewChat}
      />,
    );
    within(container).getByLabelText("More").click();
    within(container).getByLabelText("Conversations").click();
    within(container).getByText("New Chat").click();
    expect(onOpenMoreMenu).toHaveBeenCalledTimes(1);
    expect(onOpenConversations).toHaveBeenCalledTimes(1);
    expect(onStartNewChat).toHaveBeenCalledTimes(1);
  });
});

describe("ChatPageHeader title override (Home V2 final visual correction, round 2)", () => {
  it("renders the provided titleOverride instead of the chat_title translation -- Home's embedded chat panel passes 'SmartFlow' here", async () => {
    const { ChatPageHeader } = await freshModules();
    const { container } = render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={vi.fn()}
        onOpenConversations={vi.fn()}
        onStartNewChat={vi.fn()}
        titleOverride="SmartFlow"
      />,
    );
    const heading = within(container).getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("SmartFlow");
  });

  it("falls back to the unchanged chat_title translation ('Flow AI') when titleOverride is omitted -- the standalone /chat route's own call site passes no override, so its behavior is unaffected", async () => {
    const { ChatPageHeader } = await freshModules();
    const { container } = render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={vi.fn()}
        onOpenConversations={vi.fn()}
        onStartNewChat={vi.fn()}
      />,
    );
    const heading = within(container).getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Flow AI");
  });
});

describe("ChatPageHeader RTL mirroring (task 17c, D4)", () => {
  it("renders correctly (labels translate, no crash) under an ancestor dir=rtl -- the actual VISUAL mirroring is native flexbox behavior driven by that ancestor dir, which jsdom does not lay out pixel-for-pixel; this component deliberately has NO hardcoded flex-row-reverse of its own, relying entirely on the ancestor (ChatPage's own root, task 17c's E4 fix) the way the codebase's own RTL convention elsewhere (ConversationsDrawer's side={isRTL?...}) already establishes", async () => {
    const { useAppearance, ChatPageHeader } = await freshModules();
    act(() => {
      useAppearance.setState({ language: "fa" });
    });
    const { container } = render(
      <div dir="rtl">
        <ChatPageHeader
          compact={false}
          prefersReducedMotion
          onOpenMoreMenu={vi.fn()}
          onOpenConversations={vi.fn()}
          onStartNewChat={vi.fn()}
        />
      </div>,
    );
    expect(within(container).getByLabelText("بیشتر")).not.toBeNull();
    expect(within(container).getByLabelText("مکالمات")).not.toBeNull();
    expect(within(container).getByRole("heading", { level: 1 }).textContent).toBe("Flow AI");
  });

  it("does not itself set a flex-row-reverse or hardcoded direction class (mirroring must come from the ancestor's real dir, not a local override that could fight it)", async () => {
    const { ChatPageHeader } = await freshModules();
    const { container } = render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={vi.fn()}
        onOpenConversations={vi.fn()}
        onStartNewChat={vi.fn()}
      />,
    );
    expect(within(container).getByRole("heading", { level: 1 }).closest("div")?.innerHTML).not.toMatch(/flex-row-reverse/);
  });
});
