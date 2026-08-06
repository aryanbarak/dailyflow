// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectRecord } from "@/features/projects/projectRecordTypes";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ownerId: "owner-1",
    type: "software_project",
    name: "SmartFlow",
    status: "active",
    enabledEvidenceSourceKinds: ["project_status_document", "adr"],
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockList(implementation: (options?: { includeArchived?: boolean }) => Promise<ProjectRecord[]>) {
  vi.doMock("@/features/projects/projectRecordBrowserReadService", () => ({
    browserProjectRecordReadService: { list: implementation },
  }));
}

async function renderPage() {
  const { default: ProjectsIndexPage } = await import("./ProjectsIndexPage");
  return render(
    <MemoryRouter>
      <ProjectsIndexPage />
    </MemoryRouter>,
  );
}

describe("ProjectsIndexPage", () => {
  it("shows a loading state before the list resolves", async () => {
    let listInvoked = false;
    let resolveList: (projects: ProjectRecord[]) => void = () => {};
    mockList(() => {
      listInvoked = true;
      return new Promise((resolve) => { resolveList = resolve; });
    });

    await renderPage();

    expect(screen.getByLabelText("Loading projects")).toBeInTheDocument();
    // The service is reached through a dynamic import inside the page's
    // effect, so its resolver is only captured after that import settles.
    await waitFor(() => expect(listInvoked).toBe(true));
    resolveList([]);
    await waitFor(() => expect(screen.queryByLabelText("Loading projects")).not.toBeInTheDocument());
  });

  it("lists owned active projects with an Open workspace action pointing at the immutable ProjectRecord id", async () => {
    const project = makeProject({ id: "22222222-2222-4222-8222-222222222222", name: "SmartFlow Live" });
    mockList(async () => [project]);

    await renderPage();

    await waitFor(() => expect(screen.getByText("SmartFlow Live")).toBeInTheDocument());
    const link = screen.getByRole("link", { name: /open workspace for smartflow live/i });
    expect(link).toHaveAttribute("href", "/projects/22222222-2222-4222-8222-222222222222");
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("visually and textually distinguishes archived projects from active ones", async () => {
    const active = makeProject({ id: "11111111-1111-4111-8111-111111111111", name: "Active Project", status: "active" });
    const archived = makeProject({ id: "33333333-3333-4333-8333-333333333333", name: "Archived Project", status: "archived" });
    mockList(async () => [active, archived]);

    await renderPage();

    await waitFor(() => expect(screen.getByText("Archived Project")).toBeInTheDocument());
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Active Project")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Active")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Archived Project")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Archived")).toBeInTheDocument();
  });

  it("orders active projects before archived projects deterministically", async () => {
    const archived = makeProject({ id: "33333333-3333-4333-8333-333333333333", name: "Z Archived", status: "archived", createdAt: "2026-08-03T00:00:00.000Z" });
    const activeOlder = makeProject({ id: "11111111-1111-4111-8111-111111111111", name: "A Active Older", status: "active", createdAt: "2026-08-01T00:00:00.000Z" });
    const activeNewer = makeProject({ id: "22222222-2222-4222-8222-222222222222", name: "B Active Newer", status: "active", createdAt: "2026-08-02T00:00:00.000Z" });
    // Deliberately returned out of order to prove the page sorts, not the mock.
    mockList(async () => [archived, activeOlder, activeNewer]);

    await renderPage();

    await waitFor(() => expect(screen.getByText("Z Archived")).toBeInTheDocument());
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("B Active Newer");
    expect(rows[1]).toContain("A Active Older");
    expect(rows[2]).toContain("Z Archived");
  });

  it("shows an honest empty state when the owner has no projects", async () => {
    mockList(async () => []);

    await renderPage();

    await waitFor(() => expect(screen.getByText("No projects yet")).toBeInTheDocument());
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("shows a sanitized failure state without leaking the raw error", async () => {
    mockList(async () => {
      throw new Error("You must be signed in to manage projects.");
    });

    await renderPage();

    await waitFor(() => expect(screen.getByText("Projects could not be loaded")).toBeInTheDocument());
    expect(screen.getByText("You must be signed in to manage projects.")).toBeInTheDocument();
    expect(screen.queryByText(/postgres|supabase|permission denied|stack/i)).not.toBeInTheDocument();
  });

  it("does not automatically redirect to a first project", async () => {
    mockList(async () => [makeProject({ name: "Only Project" })]);

    await renderPage();

    await waitFor(() => expect(screen.getByText("Only Project")).toBeInTheDocument());
    expect(window.location.pathname).not.toMatch(/^\/projects\/[0-9a-f-]{36}$/);
  });
});
