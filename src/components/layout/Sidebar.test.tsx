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

// SmartFlow Home frozen design handoff §4/§9: Home renders the slim,
// icon-only rail (hamburger · spacer · Home · Chat · Settings · spacer ·
// avatar), 68px wide, and BOTH the hamburger and the Home icon open the
// EXISTING full navigation (FullSidebarContent: same navItems, star-field
// identity, logo, footer) as a 256px overlay drawer. Route-aware
// presentation of ONE navigation system -- every other route keeps the
// unchanged full sidebar.
describe("Sidebar: Home's slim icon-only rail + full-navigation drawer (frozen handoff)", () => {
  it("on / (Home), Chat and Settings render as icon links, the Home icon and hamburger are drawer triggers, and no full-sidebar text (e.g. 'Journal', 'Finance') leaks into the always-visible markup", () => {
    const html = renderAt("/");

    expect(html).toMatch(/href="\/chat"/);
    expect(html).toMatch(/href="\/settings"/);
    // The Home icon is a drawer trigger (frozen §9: it opens the full
    // navigation), not a NavLink -- Home is already the current route.
    expect(html).toMatch(/aria-label="Dashboard — More"/);
    expect(html).toMatch(/aria-label="More"/);

    // The full sidebar's destinations must not be hard-coded as
    // always-visible text on Home -- they're reachable via the drawer.
    expect(html).not.toContain("Journal");
    expect(html).not.toContain("Finance");
    expect(html).not.toContain("Habits");
  });

  it("on / (Home), the rail is the frozen slim width (68px, 64px at <=1280px) -- never the w-64 full-sidebar width", () => {
    const html = renderAt("/");

    expect(html).not.toMatch(/\bw-64\b/);
    expect(html).toMatch(/w-\[68px\]/);
    expect(html).toMatch(/max-\[1280px\]:w-16/);
  });

  it("on / (Home), the frozen avatar treatment is present (initials + online dot), same identity as the full sidebar's footer", () => {
    const html = renderAt("/");
    // useAuth is mocked to "test@example.com" -- the same initials
    // computation the full sidebar footer already uses.
    expect(html).toContain(">T<");
    expect(html).toMatch(/bg-\[#34D399\]/);
  });

  it("every OTHER route (e.g. /tasks) still renders the full text sidebar (from xl up since DESIGN-AUDIT phase 5), with all destinations as text", () => {
    const html = renderAt("/tasks");

    expect(html).toMatch(/\bw-64\b/);
    expect(html).toContain("Dashboard");
    expect(html).toContain("Tasks");
    expect(html).toContain("Calendar");
    expect(html).toContain("Journal");
    expect(html).toContain("Finance");
  });

  it("DESIGN-AUDIT phase 5 (tablet icon-rail): on non-Home routes the full sidebar is xl-gated and a 68px icon rail (same navItems, labels as aria-labels, active pill, avatar) covers lg..<xl", () => {
    const html = renderAt("/tasks");

    // CSS-toggled pair: full sidebar hidden until xl, compact rail hidden from xl.
    expect(html).toMatch(/hidden xl:flex/);
    expect(html).toMatch(/w-\[68px\][^"]*xl:hidden/);
    // The compact rail reuses the SAME destinations, icon-only with the
    // translated label as the accessible name.
    expect(html).toMatch(/aria-label="Journal"/);
    expect(html).toMatch(/aria-label="Finance"/);
    // Active state on the current route's icon, styled like Home's rail.
    expect(html).toMatch(/bg-\[#7C4DFF\]\/\[0\.16\]/);
  });

  it("the drawer renders the SAME FullSidebarContent (same navItems/star-field/logo/footer) the full sidebar uses -- never a second menu system -- and selecting a destination closes it", () => {
    // Closed by default (Radix Dialog content isn't in the SSR tree until
    // opened, so its contents can't be asserted via renderToString here).
    // This proves Sidebar.tsx actually wires the SAME component/data into
    // the drawer, not a second, narrower list -- source-checked because
    // the render-level proof isn't available for closed portal content,
    // per this file's own established renderToString limits.
    const sidebarSource = readFileSync(
      fileURLToPath(new URL("./Sidebar.tsx", import.meta.url)),
      "utf-8",
    );
    expect(sidebarSource).toMatch(/<FullSidebarContent onNavigate=\{\(\) => setHomeMenuOpen\(false\)\} \/>/);
    // Exactly one navItems declaration -- one navigation data source.
    expect(sidebarSource.match(/const navItems/g)).toHaveLength(1);
    // Both the hamburger and the Home icon are SheetTriggers for the SAME
    // drawer (two triggers, one Sheet).
    expect(sidebarSource.match(/<SheetTrigger asChild>/g)).toHaveLength(2);
    // Frozen §9 drawer chrome: 256px (w-64), scrim'd overlay, z-90.
    expect(sidebarSource).toMatch(/z-\[90\] flex w-64/);
  });

  it("FullSidebarContent items call onNavigate on selection, so a drawer destination click closes the drawer AND navigates (NavLink)", () => {
    const sidebarSource = readFileSync(
      fileURLToPath(new URL("./Sidebar.tsx", import.meta.url)),
      "utf-8",
    );
    expect(sidebarSource.match(/onClick=\{onNavigate\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
