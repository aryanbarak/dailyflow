// @vitest-environment jsdom
//
// Task 38, point 7: "disabled on /chat." AppLayout.tsx is heavy (useAuth,
// useAlarms, LaunchProvider, react-router context, several live hooks) and
// isn't practically mountable in isolation -- this follows the same
// source-verification pattern already established for other heavy page/
// layout components (see SettingsPageOrbAppearance.test.tsx,
// ChatPagePwaScroll.test.tsx). The actual gesture-disable MECHANISM
// (enabled: false -> no listeners attached, no refresh fires) is unit-tested
// directly in usePullToRefreshGesture.test.ts; this file only proves the
// WIRING -- that AppLayout actually passes /chat's exclusion through to
// MobilePullToRefreshMain, rather than e.g. hardcoding `disabled={false}`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appLayoutSource = readFileSync(path.resolve(process.cwd(), 'src', 'components', 'layout', 'AppLayout.tsx'), 'utf-8');

describe('AppLayout pull-to-refresh wiring (task 38)', () => {
  it('/chat is in the set of routes excluded from mobile chrome (and therefore from pull-to-refresh)', () => {
    const setDeclaration = appLayoutSource.match(/PAGES_WITHOUT_MOBILE_CHROME = new Set\(\[([^\]]*)\]\)/);
    expect(setDeclaration).not.toBeNull();
    expect(setDeclaration![1]).toMatch(/["']\/chat["']/);
  });

  it('MobilePullToRefreshMain receives disabled={hideMobileChrome} -- not a hardcoded false', () => {
    expect(appLayoutSource).toMatch(/<MobilePullToRefreshMain\s+disabled=\{hideMobileChrome\}/);
  });

  it('hideMobileChrome is derived from the current route, not a constant', () => {
    expect(appLayoutSource).toMatch(/const hideMobileChrome = PAGES_WITHOUT_MOBILE_CHROME\.has\(location\.pathname\)/);
  });

  it('PullToRefreshProvider wraps the app shell (both desktop and mobile Outlet render inside it)', () => {
    const providerStart = appLayoutSource.indexOf('<PullToRefreshProvider>');
    const providerEnd = appLayoutSource.indexOf('</PullToRefreshProvider>');
    expect(providerStart).toBeGreaterThan(-1);
    expect(providerEnd).toBeGreaterThan(providerStart);

    const desktopMainIndex = appLayoutSource.indexOf('<main className={cn("flex-1 min-h-screen"');
    const mobileMainIndex = appLayoutSource.indexOf('<MobilePullToRefreshMain');
    expect(desktopMainIndex).toBeGreaterThan(providerStart);
    expect(desktopMainIndex).toBeLessThan(providerEnd);
    expect(mobileMainIndex).toBeGreaterThan(providerStart);
    expect(mobileMainIndex).toBeLessThan(providerEnd);
  });
});
