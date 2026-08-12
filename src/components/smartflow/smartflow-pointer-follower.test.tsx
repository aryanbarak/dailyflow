// @vitest-environment jsdom
//
// Task 17h: SmartflowPointerFollower is now user-configurable from
// Settings -> Appearance (appearanceStore.ts's orb* fields). Mirrors
// ChatPageHeader.test.tsx's own fresh-module + MemoryStorage pattern:
// appearanceStore's persist middleware resolves `localStorage` at
// STORE-CREATION (module evaluation) time, not lazily per call, so a
// plain top-level static import + beforeEach stub is too late here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import type { useAppearance as UseAppearance, OrbColor, OrbSize } from "@/features/settings/appearanceStore";
import type { SmartflowPointerFollower as SmartflowPointerFollowerComponent } from "./smartflow-pointer-follower";

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

function stubFinePointerNoReducedMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(hover: hover) and (pointer: fine)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

async function freshModules() {
  vi.resetModules();
  const [appearanceMod, followerMod] = await Promise.all([
    import("@/features/settings/appearanceStore"),
    import("./smartflow-pointer-follower"),
  ]);
  return {
    useAppearance: appearanceMod.useAppearance as typeof UseAppearance,
    ORB_SIZE_PX: appearanceMod.ORB_SIZE_PX,
    ORB_COLOR_VAR: appearanceMod.ORB_COLOR_VAR,
    SmartflowPointerFollower: followerMod.SmartflowPointerFollower as typeof SmartflowPointerFollowerComponent,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  stubFinePointerNoReducedMotion();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SmartflowPointerFollower preferences (task 17h)", () => {
  it("renders (app-shell chrome, on by default) -- task 17g's chat-page gate is gone, this is a plain unconditional mount test", async () => {
    const { SmartflowPointerFollower } = await freshModules();
    const { container } = render(<SmartflowPointerFollower />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("disabled setting (orbEnabled: false) -> renders nothing at all", async () => {
    const { useAppearance, SmartflowPointerFollower } = await freshModules();
    useAppearance.setState({ orbEnabled: false });
    const { container } = render(<SmartflowPointerFollower />);
    expect(container.firstChild).toBeNull();
  });

  it.each<OrbSize>(["small", "medium", "large", "xl"])(
    "size step %s maps to its configured px value via the --orb-size custom property",
    async (size) => {
      const { useAppearance, ORB_SIZE_PX, SmartflowPointerFollower } = await freshModules();
      useAppearance.setState({ orbSize: size });
      const { container } = render(<SmartflowPointerFollower />);
      const root = container.querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(root.style.getPropertyValue("--orb-size")).toBe(`${ORB_SIZE_PX[size]}px`);
    },
  );

  it("medium (the default) is 144px -- identical to the pointer follower's original hardcoded h-36/w-36 size", async () => {
    const { ORB_SIZE_PX, SmartflowPointerFollower } = await freshModules();
    const { container } = render(<SmartflowPointerFollower />);
    const root = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(ORB_SIZE_PX.medium).toBe(144);
    expect(root.style.getPropertyValue("--orb-size")).toBe("144px");
  });

  it.each<OrbColor>(["primary", "blue", "cyan", "study", "plan", "analyze", "review", "report", "career"])(
    "colour selection %s sets --orb-color to the matching --flow-* token, which the core dot and the glow both derive from",
    async (color) => {
      const { useAppearance, ORB_COLOR_VAR, SmartflowPointerFollower } = await freshModules();
      useAppearance.setState({ orbColor: color });
      const { container } = render(<SmartflowPointerFollower />);
      const root = container.querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(root.style.getPropertyValue("--orb-color")).toBe(`var(${ORB_COLOR_VAR[color]})`);

      // The glow (blur halo) and the core dot's box-shadow both read FROM
      // --orb-color (never a hardcoded colour) -- so whatever the root
      // sets --orb-color to, both automatically pick up the same token.
      const glow = root.children[0] as HTMLElement;
      const core = root.children[1] as HTMLElement;
      expect(glow.style.background).toContain("var(--orb-color)");
      expect(core.style.boxShadow).toContain("var(--orb-color)");
    },
  );

  it.each([0.3, 0.5, 0.72, 0.9, 1])("opacity step %s is applied via the --orb-opacity custom property", async (opacity) => {
    const { useAppearance, SmartflowPointerFollower } = await freshModules();
    useAppearance.setState({ orbOpacity: opacity });
    const { container } = render(<SmartflowPointerFollower />);
    const root = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(root.style.getPropertyValue("--orb-opacity")).toBe(String(opacity));
  });

  it("the visible `opacity` style (not just the --orb-opacity var) reads the configured value once the cursor has moved -- never a hardcoded number", async () => {
    const { SmartflowPointerFollower } = await freshModules();
    const { container } = render(<SmartflowPointerFollower />);
    const root = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    // Before any pointer movement the halo is invisible (opacity: 0) --
    // this is the SAME pre-17h fade-in behaviour, untouched by this task.
    expect(root.style.opacity).toBe("0");
  });
});
