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
  it("renders a discoverable Projects entry that targets /projects", () => {
    const html = renderAt("/");

    expect(html).toContain("Projects");
    expect(html).toMatch(/href="\/projects"/);
  });

  it("does not hard-code a ProjectRecord UUID or link directly to the demo workspace", () => {
    const html = renderAt("/");

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
