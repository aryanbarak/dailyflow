// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { resolveShellHeightStyle, useVisualViewportInsets } from "./useVisualViewportInsets";

// Task 17f, C2: production evidence -- after a fresh mount in the Android
// PWA standalone context, `100dvh` mis-measured the chat shell (the
// composer sat below the visible viewport). resolveShellHeightStyle is
// the ONE pure decision of which height source is authoritative --
// verified directly here, independent of any component.

describe("resolveShellHeightStyle (task 17f, C2 height-source precedence resolver)", () => {
  it("a real visualViewport measurement is authoritative -- returns an explicit px height that overrides the h-[100dvh] CSS class via inline style", () => {
    expect(resolveShellHeightStyle(640)).toBe("640px");
  });

  it("falls back to undefined (letting the h-[100dvh] CSS class apply untouched) when no measurement is available", () => {
    expect(resolveShellHeightStyle(null)).toBeUndefined();
  });

  it("a zero-height measurement (theoretically possible mid-transition) is still treated as authoritative, not silently discarded", () => {
    expect(resolveShellHeightStyle(0)).toBe("0px");
  });
});

describe("useVisualViewportInsets -- viewportHeightPx", () => {
  afterEach(() => {
    delete window.visualViewport;
  });

  it("reports null when window.visualViewport is unavailable (jsdom default, SSR, older browsers)", () => {
    const { result } = renderHook(() => useVisualViewportInsets());
    expect(result.current.viewportHeightPx).toBeNull();
  });

  it("reports the rounded window.visualViewport.height when available", () => {
    // Minimal test double, not the full VisualViewport interface.
    window.visualViewport = {
      height: 639.6,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as VisualViewport;
    const { result } = renderHook(() => useVisualViewportInsets());
    expect(result.current.viewportHeightPx).toBe(640);
  });
});
