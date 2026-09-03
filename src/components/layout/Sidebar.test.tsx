import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { email: "test@example.com" } }) }));
vi.mock("@/features/profile/useProfile", () => ({ useProfile: () => ({ profile: null }) }));
vi.mock("@/features/search/GlobalSearch", () => ({ GlobalSearch: () => null }));
vi.mock("@/components/FlowAIOrb", () => ({ FlowAIOrb: () => null }));
vi.mock("@/components/smartflow", () => ({ SmartflowAsciiVisual: () => null }));
vi.mock("@/config/apps", () => ({ getSmartAcademyUrl: () => "https://academy.example.test" }));

import { Sidebar } from "./Sidebar";

function renderAt(pathname: string) {
  return renderToString(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

/** Extracts the opening `<a>` tag for a given href, independent of attribute order. */
function linkTag(html: string, href: string): string {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<a[^>]*href="${escaped}"[^>]*>`));
  if (!match) throw new Error(`No <a> tag found for href="${href}"`);
  return match[0];
}

describe("Sidebar", () => {
  // Home V2 final visual alignment: "/" now renders the slim collapsed
  // rail (see the "Home's collapsed icon-only rail" describe block below),
  // which deliberately does NOT show every destination as a top-level
  // icon -- Projects isn't one of the three essentials. These two checks'
  // actual intent (Projects is reachable, no hard-coded demo UUID) is
  // about the FULL sidebar in general, so they now render at a
  // representative non-Home route instead, the same way the existing
  // "does not mark Projects active on an unrelated route" check below
  // already uses /tasks for exactly this reason.
  it("renders a discoverable Projects entry that targets /projects", () => {
    const html = renderAt("/tasks");

    expect(html).toContain("Projects");
    expect(html).toMatch(/href="\/projects"/);
  });

  it("does not hard-code a ProjectRecord UUID or link directly to the demo workspace", () => {
    const html = renderAt("/tasks");

    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    expect(html).not.toMatch(/\/projects\/demo/);
  });

  it("marks Projects active on /projects itself", () => {
    const tag = linkTag(renderAt("/projects"), "/projects");
    expect(tag).toContain("text-primary font-medium");
  });

  it("keeps Projects active while viewing a live project workspace sub-route", () => {
    const tag = linkTag(renderAt("/projects/11111111-1111-4111-8111-111111111111"), "/projects");
    expect(tag).toContain("text-primary font-medium");
  });

  it("does not mark Projects active on an unrelated route", () => {
    const tag = linkTag(renderAt("/tasks"), "/projects");
    expect(tag).not.toContain("text-primary font-medium");
  });

  it("does not introduce a second, unrelated navigation system alongside the existing nav list", () => {
    const html = renderAt("/");
    // Exactly one nav landmark carries the route list.
    expect(html.match(/<nav[^>]*>/g)?.length).toBe(1);
  });
});

// Home V2 final visual alignment, spec section 1: Home/Dashboard uses a
// slim, icon-only navigation rail instead of the full text sidebar --
// route-aware presentation mode (a branch inside this SAME component, same
// `navItems` data source), not a second navigation system, and every other
// route keeps the unchanged full sidebar (see the "full sidebar is
// unaffected elsewhere" tests below, and the corrected Projects/UUID tests
// above which now render at /tasks for exactly this reason).
describe("Sidebar: Home's collapsed icon-only rail (route-aware presentation)", () => {
  it("on / (Home), essential destinations render as icon links with no visible text label, and no full sidebar text (e.g. 'Journal', 'Finance') leaks into the always-visible markup", () => {
    const html = renderAt("/");

    expect(html).toMatch(/href="\/"/);
    expect(html).toMatch(/href="\/chat"/);
    expect(html).toMatch(/href="\/settings"/);

    // The full sidebar's only-sometimes-relevant destinations must not be
    // hard-coded as always-visible text on Home -- they're still reachable
    // via the hamburger's full item sheet (its own describe block below),
    // just not as top-level icons.
    expect(html).not.toContain("Journal");
    expect(html).not.toContain("Finance");
    expect(html).not.toContain("Habits");
  });

  it("on / (Home), the rail is narrow (no w-64 full-sidebar width class) and carries a hamburger/menu trigger", () => {
    const html = renderAt("/");

    expect(html).not.toMatch(/\bw-64\b/);
    expect(html).toMatch(/aria-label="More"/);
  });

  it("on / (Home), a user avatar/initials indicator is still present, same as the full sidebar's footer", () => {
    const html = renderAt("/");
    // useAuth is mocked to "test@example.com" -- the same initials
    // computation the full sidebar footer already uses.
    expect(html).toContain(">T<");
  });

  it("every OTHER route (e.g. /tasks) still renders the full, unchanged text sidebar -- collapsing is scoped to Home only, not a global redesign", () => {
    const html = renderAt("/tasks");

    expect(html).toMatch(/\bw-64\b/);
    expect(html).toContain("Dashboard");
    expect(html).toContain("Tasks");
    expect(html).toContain("Calendar");
    expect(html).toContain("Journal");
    expect(html).toContain("Finance");
  });

  it("the hamburger's sheet reuses MobileNav's own full item set (mainNavItems + moreNavItems) -- every destination stays reachable from Home, not just the three essential icons", () => {
    // Closed by default (Radix Dialog content isn't in the SSR tree until
    // opened, so its contents can't be asserted via renderToString here).
    // This proves Sidebar.tsx actually wires the SAME data source into the
    // trigger, not a second, narrower list -- source-checked because the
    // render-level proof isn't available for closed portal content, per
    // this file's own established renderToString limits.
    const sidebarSource = readFileSync(
      fileURLToPath(new URL("./Sidebar.tsx", import.meta.url)),
      "utf-8",
    );
    expect(sidebarSource).toMatch(/items=\{\[\.\.\.mainNavItems, \.\.\.moreNavItems\]\}/);
  });
});
