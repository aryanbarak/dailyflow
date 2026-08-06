import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProjectWorkspaceView } from "./ProjectWorkspacePage";
import { smartflowProjectWorkspaceFixture, type ProjectWorkspaceModel } from "@/features/projects/projectWorkspaceFixture";

function render(model: ProjectWorkspaceModel = smartflowProjectWorkspaceFixture) {
  return renderToString(
    <MemoryRouter>
      <ProjectWorkspaceView model={model} />
    </MemoryRouter>,
  );
}

describe("ProjectWorkspacePage", () => {
  it("renders project identity and the new primary situation section", () => {
    const html = render();

    expect(html).toContain("Project Workspace");
    expect(html).toContain("SmartFlow");
    expect(html).toContain("Current situation");
    expect(html).toContain("Current phase");
    expect(html).toContain("Current focus");
    expect(html).toContain("Next explicit action");
    expect(html).not.toContain("Top explicit next action");
    expect(html).toContain("Last refresh:");
  });

  it("does not use the previous narrow three-card grid for phase/focus/next action", () => {
    const html = render();

    // The old layout squeezed Phase/Focus/Next-Action into a 3-column grid
    // inside the header; the new situation section stacks them full-width.
    expect(html).not.toMatch(/mt-5 grid gap-3 md:grid-cols-3/);
    expect(html).toContain("divide-y divide-border");
  });

  it("prominently labels the default workspace as demo fixture data that is not live or persisted", () => {
    const html = render();

    expect(html).toContain("Demo fixture only - not live or persisted");
    expect(html).toContain("sample Project Brief values");
    expect(html).toContain("No persisted Evidence or live Project Brief has been loaded");
  });

  it("does not use a large live banner and keeps refresh detail behind a disclosure", () => {
    const html = render();

    expect(html).toContain("<details");
    expect(html).toContain("Refresh details");
    expect(html).toContain("local refresh instructions");
  });

  it("does not show completed refresh, realistic timestamps, or live-looking counts for the default fixture", () => {
    const html = render();

    expect(smartflowProjectWorkspaceFixture.refresh.status).not.toBe("completed");
    expect(smartflowProjectWorkspaceFixture.generatedAt).toBeUndefined();
    expect(html).toContain("Not refreshed in browser");
    expect(html).toContain("Demo only - not refreshed");
    expect(html).toContain("Sample fixture data - not live or persisted");
    expect(html).not.toContain(">Completed</span>");
    expect(html).not.toContain("Aug 04");
  });

  it("uses sample brief and sample provenance labels for fixture mode", () => {
    const html = render();

    expect(html).toContain("Sample brief preview");
    expect(html).toContain("Sample provenance");
    expect(html).not.toContain("Brief available");
    expect(html).not.toContain("Sources / provenance");
  });

  it("uses live labels without sample wording for live workspace models", () => {
    const model: ProjectWorkspaceModel = {
      ...smartflowProjectWorkspaceFixture,
      integration: "live",
      briefAvailable: true,
      generatedAt: "2026-08-04T08:01:00.000Z",
      refresh: {
        status: "completed",
        label: "Last evidence snapshot",
        lastRefreshAt: "2026-08-04T08:00:00.000Z",
        createdCount: 3,
        unchangedCount: 1,
        failedCount: 0,
        message: "Live persisted Project Brief loaded from existing ProjectEvidence. Browser refresh is not implemented.",
      },
    };

    const html = render(model);

    expect(html).toContain("Live persisted data");
    expect(html).toContain("Live brief available");
    expect(html).toContain("Sources / provenance");
    expect(html).toContain("Included evidence");
    expect(html).toContain("Excluded superseded");
    expect(html).toContain("Reload data");
    expect(html).not.toContain("Demo fixture only");
    expect(html).not.toContain("Sample brief preview");
    expect(html).not.toContain("Sample provenance");
    // Live mode has no persisted refresh-run history, so it must never claim
    // a specific failed count -- the browser genuinely does not know one.
    expect(html).not.toContain("Failed");
    expect(html).not.toMatch(/<dt[^>]*>Failed<\/dt>/);
  });

  it("never renders a Failed tile or any numeric failed count for live workspace models, while preserving real snapshot metadata", () => {
    const model: ProjectWorkspaceModel = {
      ...smartflowProjectWorkspaceFixture,
      integration: "live",
      briefAvailable: true,
      generatedAt: "2026-08-04T08:01:00.000Z",
      refresh: {
        status: "completed",
        label: "Last evidence snapshot",
        lastRefreshAt: "2026-08-04T08:00:00.000Z",
        createdCount: 4,
        unchangedCount: 2,
        failedCount: 0,
        message: "Live persisted Project Brief loaded from existing ProjectEvidence. Browser refresh is not implemented.",
      },
    };

    const html = render(model);

    expect(html).not.toContain("Failed");
    expect(html).not.toMatch(/<dt[^>]*>Failed<\/dt>/);
    // The two real, snapshot-derived counts remain present and correct.
    expect(html).toContain("Included evidence");
    expect(html).toContain("Excluded superseded");
    expect(html).toMatch(/Included evidence<\/dt><dd[^>]*>4<\/dd>/);
    expect(html).toMatch(/Excluded superseded<\/dt><dd[^>]*>2<\/dd>/);
  });

  it("still shows the demo fixture's Failed tile with real sample counts, unchanged", () => {
    const model: ProjectWorkspaceModel = {
      ...smartflowProjectWorkspaceFixture,
      refresh: {
        status: "completed",
        label: "Demo refresh",
        lastRefreshAt: "2026-08-04T08:00:00.000Z",
        createdCount: 2,
        unchangedCount: 1,
        failedCount: 1,
        message: "Sample fixture refresh result.",
      },
    };

    const html = render(model);

    expect(html).toContain("Created");
    expect(html).toContain("Unchanged");
    expect(html).toContain("Failed");
    expect(html).toMatch(/Failed<\/dt><dd[^>]*>1<\/dd>/);
  });

  it("preserves known, unknown, and conflicted states in the primary situation section", () => {
    const model: ProjectWorkspaceModel = {
      ...smartflowProjectWorkspaceFixture,
      brief: {
        ...smartflowProjectWorkspaceFixture.brief,
        currentPhase: { status: "unknown" },
        currentFocus: {
          status: "conflicted",
          candidates: [
            { value: "Focus A", provenance: smartflowProjectWorkspaceFixture.brief.sourceReferences[0] },
            { value: "Focus B", provenance: smartflowProjectWorkspaceFixture.brief.sourceReferences[1] },
          ],
        },
      },
    };

    const html = render(model);

    expect(html).toContain("Unknown");
    expect(html).toContain("Conflicted");
    expect(html).toContain("Focus A");
    expect(html).toContain("Focus B");
  });

  it("keeps conflicts visible: the secondary section auto-opens whenever a conflict exists", () => {
    const html = render();

    // The default fixture carries one CONFLICTING_CANONICAL_STATEMENT
    // extraction warning, so the secondary disclosure must start open,
    // and the conflict must be summarized in its own summary text.
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("includes 1 conflict");
  });

  it("keeps semantic categories distinct instead of merging them into warnings", () => {
    const html = render();

    for (const label of [
      "Explicit next actions",
      "Completed milestones",
      "Accepted decisions",
      "Open decisions",
      "Risks",
      "Technical debt",
      "Limitations",
      "Decision consequences",
      "Non-goals",
      "Deferred items",
      "Out of scope",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("renders provenance drill-down for brief items", () => {
    const html = render();

    expect(html).toContain("Sample provenance");
    expect(html).toContain("Source reference");
    expect(html).toContain("Source kind");
    expect(html).toContain("Evidence");
    expect(html).toContain("PROJECT_STATUS.md");
  });

  it("renders conflict extraction warnings with provenance and never reports none when they exist", () => {
    const html = render();

    expect(html).toContain("CONFLICTING_CANONICAL_STATEMENT");
    expect(html).toContain("Example fixture warning");
    expect(html).toContain("docs/roadmap/project-workspace-implementation-roadmap-v1.md");
    expect(html).toContain("Deferred");
    expect(html).toContain("ev-roadmap-1");
    expect(html).not.toContain("Conflicts</h3><span class=\"inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium border-success/30 bg-success/10 text-success\">None</span>");
    expect(html).not.toContain("No conflicting Project Brief statements are present.");
  });

  it("shows failed and partial refresh states honestly", () => {
    const model: ProjectWorkspaceModel = {
      ...smartflowProjectWorkspaceFixture,
      refresh: {
        status: "failed_partial",
        label: "Partially refreshed",
        lastRefreshAt: "2026-08-04T08:00:00.000Z",
        createdCount: 1,
        unchangedCount: 2,
        failedCount: 1,
        errorCode: "DOCUMENT_READ_FAILURE",
        message: "One document failed after earlier evidence was persisted.",
      },
    };

    const html = render(model);

    expect(html).toContain("Partially refreshed");
    expect(html).toContain("Created");
    expect(html).toContain("Unchanged");
    expect(html).toContain("Failed");
    expect(html).toContain("DOCUMENT_READ_FAILURE");
  });

  it("does not present a fake browser refresh control", () => {
    const html = render();

    expect(html).toContain("Browser refresh is not wired");
    expect(html).toContain("Run local refresh");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("Reload sample preview");
    expect(html).toContain("npm --silent run smartflow:refresh-project -- --project-id &lt;project-id&gt; --repo-root &lt;trusted-local-repo-path&gt; --json");
    expect(html).not.toContain("SMARTFLOW_SUPABASE_ACCESS_TOKEN");
    expect(html).not.toContain("C:\\Projects");
  });

  it("Reload data is wired to the onReload callback rather than a full page navigation", () => {
    const html = renderToString(
      <MemoryRouter>
        <ProjectWorkspaceView model={{ ...smartflowProjectWorkspaceFixture, integration: "live" }} onReload={() => {}} />
      </MemoryRouter>,
    );

    expect(html).toContain("Reload data");
    expect(html).toContain("aria-label=\"Reload persisted project data\"");
  });

  it("reuses the existing conversation route without claiming live brief-aware AI", () => {
    const html = render();

    expect(html).toContain("SmartFlow chat");
    expect(html).toContain("href=\"/chat\"");
    expect(html).toContain("not injected into prompts");
    expect(html).toContain("No semantic memory, RAG, or live Project Brief awareness is claimed");
  });

  it("keeps the responsive structure as context first and conversation second, with an approximately 65-70/30-35 desktop split", () => {
    const html = render();

    expect(html).toContain("data-testid=\"project-workspace-layout\"");
    expect(html.indexOf("Project Workspace")).toBeLessThan(html.indexOf("SmartFlow chat"));
    expect(html).toContain("xl:grid-cols-[minmax(0,1fr)_420px]");
  });

  it("does not make LLM, memory, RAG, token, or path leakage claims", () => {
    const html = render();

    expect(html).not.toContain("Recommended next action");
    expect(html).not.toContain("AI recommends");
    expect(html).not.toContain("SMARTFLOW_SUPABASE");
    expect(html).not.toContain("access_token");
    expect(html).not.toContain("C:\\");
  });
});
