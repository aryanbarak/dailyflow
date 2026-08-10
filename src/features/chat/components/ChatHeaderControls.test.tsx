// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatHeaderControls as ChatHeaderControlsComponent } from "./ChatHeaderControls";
import type { useChatDisplayPreferences as UseChatDisplayPreferences } from "../chatDisplayPreferencesStore";

// zustand's persist middleware resolves `localStorage` when the store
// module is EVALUATED (imported), not lazily per call. ChatHeaderControls
// imports the store statically, so a working localStorage stub must be in
// place BEFORE either module is imported -- vi.resetModules() + a dynamic
// import per test (rather than static top-level imports) makes that
// possible. Mirrors chatDisplayPreferencesStore.test.ts's own pattern.
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
  const [{ ChatHeaderControls }, store] = await Promise.all([
    import("./ChatHeaderControls"),
    import("../chatDisplayPreferencesStore"),
  ]);
  return { ChatHeaderControls, useChatDisplayPreferences: store.useChatDisplayPreferences };
}

let ChatHeaderControls: typeof ChatHeaderControlsComponent;
let useChatDisplayPreferences: typeof UseChatDisplayPreferences;

beforeEach(async () => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  ({ ChatHeaderControls, useChatDisplayPreferences } = await freshModules());
  useChatDisplayPreferences.setState({ theme: "dark", density: "comfortable" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatHeaderControls", () => {
  it("both toggles are plain, keyboard-operable buttons with aria-pressed reflecting current state", () => {
    render(<ChatHeaderControls />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(screen.getByRole("button", { pressed: true, name: /switch to light theme/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: false })).toBeInTheDocument();
  });

  it("clicking the theme toggle flips the shared store's theme (light <-> dark)", async () => {
    render(<ChatHeaderControls />);
    await userEvent.click(screen.getByRole("button", { name: /switch to light theme/i }));
    expect(useChatDisplayPreferences.getState().theme).toBe("light");
  });

  it("clicking the density toggle flips the shared store's density (comfortable <-> compact)", async () => {
    render(<ChatHeaderControls />);
    await userEvent.click(screen.getByRole("button", { name: /switch to compact/i }));
    expect(useChatDisplayPreferences.getState().density).toBe("compact");
  });

  it("both toggles persist their new value to localStorage under the chat-scoped key", async () => {
    render(<ChatHeaderControls />);
    await userEvent.click(screen.getByRole("button", { name: /switch to light theme/i }));
    await userEvent.click(screen.getByRole("button", { name: /switch to compact/i }));
    const stored = JSON.parse(localStorage.getItem("smartflow:chat-display-preferences") ?? "{}");
    expect(stored.state).toMatchObject({ theme: "light", density: "compact" });
  });

  it("re-renders to reflect a store change made elsewhere (e.g. after a restored/persisted preference)", () => {
    render(<ChatHeaderControls />);
    expect(screen.getByRole("button", { pressed: true, name: /switch to light theme/i })).toBeInTheDocument();
    act(() => {
      useChatDisplayPreferences.setState({ theme: "light" });
    });
    expect(screen.getByRole("button", { pressed: false, name: /switch to dark theme/i })).toBeInTheDocument();
  });
});
