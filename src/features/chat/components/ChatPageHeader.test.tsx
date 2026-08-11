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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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
  it("renders exactly two icon-only trigger buttons before the brand text -- More then Conversations, in that DOM order", async () => {
    const { ChatPageHeader } = await freshModules();
    render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={vi.fn()}
        onOpenConversations={vi.fn()}
        onStartNewChat={vi.fn()}
      />,
    );
    const moreButton = screen.getByLabelText("More");
    const conversationsButton = screen.getByLabelText("Conversations");
    expect(moreButton.compareDocumentPosition(conversationsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the More button uses the hamburger (Menu) icon and the Conversations button uses History -- NOT the hamburger (task 17c D4: 'ICON CHANGE per PO -- use a history/chat-list icon... NOT the hamburger')", async () => {
    const { ChatPageHeader } = await freshModules();
    render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={vi.fn()}
        onOpenConversations={vi.fn()}
        onStartNewChat={vi.fn()}
      />,
    );
    const moreButton = screen.getByLabelText("More");
    const conversationsButton = screen.getByLabelText("Conversations");
    expect(moreButton.querySelector("svg")?.classList.toString()).toContain("lucide-menu");
    expect(conversationsButton.querySelector("svg")?.classList.toString()).toContain("lucide-history");
    expect(conversationsButton.querySelector("svg")?.classList.toString()).not.toContain("lucide-menu");
  });

  it("renders the full, untruncated 'Flow AI' brand text", async () => {
    const { ChatPageHeader } = await freshModules();
    render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={vi.fn()}
        onOpenConversations={vi.fn()}
        onStartNewChat={vi.fn()}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Flow AI");
    expect(heading.className).not.toContain("truncate");
  });

  it("clicking More/Conversations/New Chat calls the respective handler", async () => {
    const { ChatPageHeader } = await freshModules();
    const onOpenMoreMenu = vi.fn();
    const onOpenConversations = vi.fn();
    const onStartNewChat = vi.fn();
    render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={onOpenMoreMenu}
        onOpenConversations={onOpenConversations}
        onStartNewChat={onStartNewChat}
      />,
    );
    screen.getByLabelText("More").click();
    screen.getByLabelText("Conversations").click();
    screen.getByText("New Chat").click();
    expect(onOpenMoreMenu).toHaveBeenCalledTimes(1);
    expect(onOpenConversations).toHaveBeenCalledTimes(1);
    expect(onStartNewChat).toHaveBeenCalledTimes(1);
  });
});

describe("ChatPageHeader RTL mirroring (task 17c, D4)", () => {
  it("renders correctly (labels translate, no crash) under an ancestor dir=rtl -- the actual VISUAL mirroring is native flexbox behavior driven by that ancestor dir, which jsdom does not lay out pixel-for-pixel; this component deliberately has NO hardcoded flex-row-reverse of its own, relying entirely on the ancestor (ChatPage's own root, task 17c's E4 fix) the way the codebase's own RTL convention elsewhere (ConversationsDrawer's side={isRTL?...}) already establishes", async () => {
    const { useAppearance, ChatPageHeader } = await freshModules();
    act(() => {
      useAppearance.setState({ language: "fa" });
    });
    render(
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
    expect(screen.getByLabelText("بیشتر")).not.toBeNull();
    expect(screen.getByLabelText("مکالمات")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Flow AI");
  });

  it("does not itself set a flex-row-reverse or hardcoded direction class (mirroring must come from the ancestor's real dir, not a local override that could fight it)", async () => {
    const { ChatPageHeader } = await freshModules();
    render(
      <ChatPageHeader
        compact={false}
        prefersReducedMotion
        onOpenMoreMenu={vi.fn()}
        onOpenConversations={vi.fn()}
        onStartNewChat={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).closest("div")?.innerHTML).not.toMatch(/flex-row-reverse/);
  });
});
