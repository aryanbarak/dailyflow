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
  it("renders the Project Brief hierarchy with project identity first", () => {
    const html = render();

    expect(html).toContain("Project Workspace");
    expect(html).toContain("SmartFlow");
    expect(html).toContain("Current phase");
    expect(html).toContain("Current focus");
    expect(html).toContain("Top explicit next action");
    expect(html).toContain("Last refresh:");
  });

  it("prominently labels the default workspace as demo fixture data that is not live or persisted", () => {
    const html = render();

    expect(html).toContain("Demo fixture only - not live or persisted");
    expect(html).toContain("sample Project Brief values");
    expect(html).toContain("No persisted Evidence or live Project Brief has been loaded");
  });

  it("does not show completed refresh, realistic timestamps, or live-looking counts for the default fixture", () => {
    const html = render();

    expect(smartflowProjectWorkspaceFixture.refresh.status).not.toBe("completed");
    expect(smartflowProjectWorkspaceFixture.generatedAt).toBeUndefined();
    expect(html).toContain("Not refreshed in browser");
    expect(html).toContain("Demo only - not refreshed");
    expect(html).toContain("Sample only");
    expect(html).not.toContain(">Completed</span>");
    expect(html).not.toContain("Created");
    expect(html).not.toContain("Unchanged");
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
  });

  it("preserves known, unknown, and conflicted states", () => {
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

  it("keeps semantic categories distinct instead of merging them into warnings", () => {
    const html = render();

    for (const label of [
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
    expect(html).not.toContain("Conflicts</h2><span class=\"inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium border-success/30 bg-success/10 text-success\">None</span>");
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

  it("reuses the existing conversation route without claiming live brief-aware AI", () => {
    const html = render();

    expect(html).toContain("SmartFlow chat");
    expect(html).toContain("href=\"/chat\"");
    expect(html).toContain("not injected into prompts");
    expect(html).toContain("No semantic memory, RAG, or live Project Brief awareness is claimed");
  });

  it("keeps the responsive structure as context first and conversation second", () => {
    const html = render();

    expect(html).toContain("data-testid=\"project-workspace-layout\"");
    expect(html.indexOf("Project Workspace")).toBeLessThan(html.indexOf("SmartFlow chat"));
    expect(html).toContain("xl:grid-cols-[minmax(0,1fr)_360px]");
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
