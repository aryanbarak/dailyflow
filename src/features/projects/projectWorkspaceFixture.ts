import type { ProjectBrief, ProjectBriefSingleValueField, ProjectBriefTextItem } from "./projectBriefTypes";
import type { ProjectSourceKind } from "./projectContextTypes";

export type ProjectWorkspaceRefreshStatus =
  | {
      readonly status: "not_yet_refreshed" | "stale" | "unavailable";
      readonly label: string;
      readonly lastRefreshAt?: string;
      readonly message: string;
    }
  | {
      readonly status: "completed";
      readonly label: string;
      readonly lastRefreshAt: string;
      readonly createdCount: number;
      readonly unchangedCount: number;
      readonly failedCount: number;
      readonly message: string;
    }
  | {
      readonly status: "failed" | "failed_partial";
      readonly label: string;
      readonly lastRefreshAt?: string;
      readonly createdCount: number;
      readonly unchangedCount: number;
      readonly failedCount: number;
      readonly errorCode: string;
      readonly message: string;
    };

export interface ProjectWorkspaceModel {
  readonly integration: "fixture" | "live";
  readonly projectId: string;
  readonly projectName: string;
  readonly briefAvailable: boolean;
  readonly generatedAt?: string;
  readonly brief: ProjectBrief;
  readonly refresh: ProjectWorkspaceRefreshStatus;
  readonly cliCommand: string;
}

const project = { id: "smartflow-local-project", name: "SmartFlow" };
const sampleBriefGeneratedAt = "sample-fixture-not-persisted";

function provenance(
  sourceEvidenceId: string,
  sourceReference: string,
  sourceKind: ProjectSourceKind,
  sectionHeading: string,
  lineOffset: number,
) {
  return { sourceEvidenceId, sourceReference, sourceKind, sectionHeading, lineOffset };
}

const statusPhase = provenance("ev-status-1", "PROJECT_STATUS.md", "project_status_document", "2. Current Project Phase", 4);
const statusSprint = provenance("ev-status-1", "PROJECT_STATUS.md", "project_status_document", "10. Next Sprint", 932);
const localRefresh = provenance("ev-status-2", "PROJECT_STATUS.md", "project_status_document", "Sprint 1 Deliverable 1", 122);
const projectDomain = provenance("ev-arch-1", "docs/architecture/project-domain.md", "architecture_document", "Project Workspace", 210);
const adrIdentity = provenance("ev-adr-6", "docs/decisions/adr/ADR-0006-canonical-product-identity.md", "adr", "Decision", 1);
const adrObservation = provenance("ev-adr-7", "docs/decisions/adr/ADR-0007-projectevidence-observation-model.md", "adr", "Consequences", 18);
const roadmap = provenance("ev-roadmap-1", "docs/roadmap/project-workspace-implementation-roadmap-v1.md", "roadmap_document", "Deferred", 64);

function item(text: string, provenanceValue: ReturnType<typeof provenance>, conflictedWith?: readonly ReturnType<typeof provenance>[]): ProjectBriefTextItem {
  return conflictedWith ? { text, provenance: provenanceValue, conflictedWith } : { text, provenance: provenanceValue };
}

const known = (value: string, provenanceValue: ReturnType<typeof provenance>): ProjectBriefSingleValueField<string> => ({
  status: "known",
  value,
  provenance: provenanceValue,
});

export const smartflowProjectWorkspaceFixture: ProjectWorkspaceModel = {
  integration: "fixture",
  projectId: project.id,
  projectName: project.name,
  briefAvailable: false,
  cliCommand: "npm --silent run smartflow:refresh-project -- --project-id <project-id> --repo-root <trusted-local-repo-path> --json",
  refresh: {
    status: "not_yet_refreshed",
    label: "Demo only - not refreshed",
    message: "Sample fixture preview only. No live or persisted Project Brief has been loaded in the browser.",
  },
  brief: {
    briefVersion: "project-brief-v1",
    project,
    generatedAt: sampleBriefGeneratedAt,
    snapshotHash: "c".repeat(64),
    evidenceIds: ["ev-status-1", "ev-status-2", "ev-arch-1", "ev-adr-6", "ev-adr-7", "ev-roadmap-1"],
    currentPhase: known("Daily Project Workspace - Sprint 1", statusPhase),
    currentFocus: known("Deliverable 2 - SmartFlow UX Phase 1", statusSprint),
    explicitNextActions: [
      item("Build one minimal usable Project Workspace page around the existing Project Brief.", statusSprint),
      item("Keep browser refresh instructional until a safe persisted read/write endpoint exists.", localRefresh),
    ],
    completedMilestones: [
      item("ProjectRecord, ProjectEvidence, observation persistence, Context Rebuild, Project Brief, and Local Project Refresh CLI are committed on main.", localRefresh),
      item("Local refresh writes evidence through owner-scoped services and returns a typed Project Brief.", localRefresh),
    ],
    acceptedDecisions: [
      item("Personal Digital Representative is the canonical SmartFlow product identity.", adrIdentity),
      item("ProjectEvidenceObservation owns the consumable text payload for evidence-backed rebuilds.", adrObservation),
    ],
    openDecisions: [
      item("The browser-safe Project Brief persistence/read model remains open for a future slice.", projectDomain),
    ],
    knownRisks: [
      item("A browser page cannot safely read Aryan's local repository filesystem.", localRefresh),
      item("Project Context remains narrower than a full semantic understanding system.", projectDomain),
    ],
    technicalDebt: [
      item("Repo-wide lint still has existing failures outside the project workspace slice.", statusSprint),
      item("Browser Project Brief loading needs a real persisted read path before fixture data can be removed.", projectDomain),
    ],
    decisionConsequences: [
      item("Evidence rows must contain the exact normalized observation text, not only a hash.", adrObservation),
    ],
    limitations: [
      item("Local manual trusted-operator command only.", localRefresh),
      item("No browser refresh button, hosted filesystem access, scheduler, semantic memory, LLM extraction, or Smart Automation.", localRefresh),
    ],
    nonGoals: [
      item("Live browser filesystem refresh.", localRefresh),
      item("Semantic memory, embeddings, vector search, or RAG.", roadmap),
    ],
    deferredItems: [
      item("Persisted browser-safe Project Brief endpoint.", projectDomain),
      item("Background refresh and Smart Automation.", roadmap),
    ],
    outOfScope: [
      item("AI-generated recommendations.", roadmap),
      item("Avatar, voice, notifications, or scheduling.", roadmap),
    ],
    extractionWarnings: [
      {
        code: "CONFLICTING_CANONICAL_STATEMENT",
        message: "Example fixture warning: milestone and deferred statements must remain visible when they conflict.",
        sourceEvidenceId: "ev-roadmap-1",
        sourceReference: "docs/roadmap/project-workspace-implementation-roadmap-v1.md",
        sectionHeading: "Deferred",
      },
    ],
    sourceReferences: [statusPhase, statusSprint, localRefresh, projectDomain, adrIdentity, adrObservation, roadmap],
  },
};
