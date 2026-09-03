// @vitest-environment jsdom
//
// SmartFlow -- Flow AI visual identity (task 17b). Split out from
// ChatEmptyState.test.tsx because useT()'s isRTL comes from zustand's
// useAppearance store, and exercising a language change here needs both:
//  (a) a LIVE jsdom-mounted render + act() (react-dom/server's
//      renderToString freezes its SSR snapshot at first subscription, so a
//      later store mutation never reaches a fresh renderToString call --
//      confirmed via a throwaway diagnostic), and
//  (b) a fresh module graph per test, stubbed with a working localStorage
//      BEFORE appearanceStore's persist middleware is created -- mirrors
//      src/features/chat/chatDisplayPreferencesStore.test.tsx's own
//      MemoryStorage + vi.resetModules() + dynamic-import pattern (itself
//      mirroring src/features/workspace/interactionTracker.test.ts): this
//      test environment's real `localStorage` global is non-functional,
//      and persist resolves `localStorage` at STORE-CREATION (module
//      evaluation) time, not lazily per call, so a top-level static import
//      of appearanceStore would always be stubbed too late.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { BookOpen } from "lucide-react";
import type { useAppearance as UseAppearance } from "@/features/settings/appearanceStore";
import type { ChatEmptyState as ChatEmptyStateComponent, ChatEmptyStateAction } from "./ChatEmptyState";

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

async function freshModules() {
  vi.resetModules();
  const [appearanceMod, emptyStateMod] = await Promise.all([
    import("@/features/settings/appearanceStore"),
    import("./ChatEmptyState"),
  ]);
  return {
    useAppearance: appearanceMod.useAppearance as typeof UseAppearance,
    ChatEmptyState: emptyStateMod.ChatEmptyState as typeof ChatEmptyStateComponent,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatEmptyState RTL (task 17b)", () => {
  // The FIRST freshModules() call pays the whole module-graph import cost
  // (appearanceStore + ChatEmptyState, which since SmartFlow Home v2 also
  // pulls FlowAIOrb for the embedded variant) -- under a fully parallel
  // `npm test` run that warmup intermittently blows the 5s default and
  // fails this one test by timeout with every assertion untouched. Same
  // hardening as ChatPageHeader.test.tsx's warmup-bearing test.
  it("Persian language flips the row to dir=rtl, so native flex order and scroll-start mirror correctly", { timeout: 20000 }, async () => {
    const { useAppearance, ChatEmptyState } = await freshModules();
    act(() => {
      useAppearance.setState({ language: "fa" });
    });
    const { container } = render(
      <ChatEmptyState greetingName="آریان" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
    expect(container.textContent).toContain("سلام");
  });

  it("English (default) language keeps dir=ltr", async () => {
    const { ChatEmptyState } = await freshModules();
    const { container } = render(
      <ChatEmptyState greetingName="Aryan" theme="dark" actions={[action]} disabled={false} onSelectPrompt={vi.fn()} />,
    );
    expect(container.querySelector('[dir="ltr"]')).not.toBeNull();
    expect(container.querySelector('[dir="rtl"]')).toBeNull();
  });
});
