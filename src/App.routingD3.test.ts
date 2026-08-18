import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// SmartFlow -- task 17c, PO decision D3: "Remove the bottom nav ON THIS
// PAGE. Chat takes the full height... Every other page's mobile shell is
// completely unchanged." AppLayout.tsx renders MobileNav/GlobalSearch
// unconditionally for ALL routes prior to this task -- mounting the full
// AppLayout component tree (auth/launch/query providers, useAlarms, etc.)
// just to assert this is heavier than reading the actual conditional
// logic directly, so this reads the source the same way
// flowTokenDerivation.test.ts / App.routing.test.ts do.
const APP_LAYOUT_SOURCE = readFileSync(resolve(__dirname, "./components/layout/AppLayout.tsx"), "utf8");
// Task 38: the mobile <main> (and its pb-20 conditional) moved out of
// AppLayout.tsx's own JSX into MobilePullToRefreshMain.tsx -- AppLayout now
// only passes `bottomPadding={!hideMobileChrome}` through as a prop.
const MOBILE_PULL_TO_REFRESH_MAIN_SOURCE = readFileSync(
  resolve(__dirname, "./features/pull-to-refresh/MobilePullToRefreshMain.tsx"),
  "utf8",
);

describe("AppLayout mobile chrome gating (task 17c, D3)", () => {
  it("gates MobileNav rendering on the current route (not always-on)", () => {
    expect(APP_LAYOUT_SOURCE).toMatch(/\{!hideMobileChrome && <MobileNav \/>\}/);
  });

  it("gates the GlobalSearch row rendering on the current route", () => {
    expect(APP_LAYOUT_SOURCE).toMatch(/\{!hideMobileChrome && \(/);
    expect(APP_LAYOUT_SOURCE).toContain("<GlobalSearch />");
  });

  it("the gate is keyed specifically off /chat, not a broad/accidental condition", () => {
    expect(APP_LAYOUT_SOURCE).toContain('PAGES_WITHOUT_MOBILE_CHROME = new Set(["/chat"])');
  });

  it("main's bottom padding (reserved for the now-removed nav bar height) is also conditional, not a fixed pb-20 that would leave dead space on /chat", () => {
    // Task 38: the conditional now spans two files -- AppLayout passes the
    // condition in as a prop, MobilePullToRefreshMain applies the class.
    expect(APP_LAYOUT_SOURCE).toMatch(/bottomPadding=\{!hideMobileChrome\}/);
    expect(MOBILE_PULL_TO_REFRESH_MAIN_SOURCE).toMatch(/bottomPadding && ['"]pb-20['"]/);
  });
});
