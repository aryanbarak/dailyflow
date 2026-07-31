// SmartFlow Slice 2A -- Software Project Context Foundation.
//
// A bounded fixture representing SmartFlow itself as a Software Project,
// built from explicit structured inputs with source references rather than
// hardcoded as an opaque example. Every fact below is traceable to a
// specific canonical document via SMARTFLOW_PROJECT_CONTEXT_INPUT.sources
// and was checked against that document's content as of the dates recorded
// there -- this is a fixture for tests and documentation, not a live sync
// with the repository, so it can drift if those documents change without
// this file being updated.

import { buildProjectContext } from "./projectContextBuilder";
import type { ProjectContextInput } from "./projectContextTypes";

/** Matches PROJECT_STATUS.md's "Last updated" date at the time this fixture was written. */
export const SMARTFLOW_FIXTURE_GENERATED_AT = "2026-07-30T00:00:00.000Z";

export const SMARTFLOW_PROJECT_CONTEXT_INPUT: ProjectContextInput = {
  generatedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
  project: {
    id: "project:smartflow",
    type: "software_project",
    name: "SmartFlow",
    // Repository binding is intentionally omitted here: this fixture
    // documents the project from canonical docs, not from a live verified
    // GitHub connection. See SoftwareProject's doc comment -- a repository
    // is one possible evidence source, never the whole project.
  },
  sources: [
    {
      id: "source:project-status",
      kind: "project_status_document",
      title: "SmartFlow Project Status",
      reference: "PROJECT_STATUS.md",
      retrievedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
    },
    {
      id: "source:current-architecture",
      kind: "architecture_document",
      title: "SmartFlow Current Architecture",
      reference: "docs/architecture/current-architecture.md",
      retrievedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
    },
    {
      id: "source:execution-intent",
      kind: "architecture_document",
      title: "SmartFlow Execution Intent",
      reference: "docs/architecture/execution-intent.md",
      retrievedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
    },
    {
      id: "source:authority-model",
      kind: "architecture_document",
      title: "SmartFlow Authority Model",
      reference: "docs/architecture/authority-model.md",
      retrievedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
    },
    {
      id: "source:github-integration",
      kind: "architecture_document",
      title: "GitHub Read-only Integration V1",
      reference: "docs/architecture/github-read-only-integration-v1.md",
      retrievedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
    },
    {
      id: "source:product-direction",
      kind: "product_direction_document",
      title: "SmartFlow Product Direction v1",
      reference: "docs/product/product-direction-v1.md",
      retrievedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
    },
    {
      id: "source:product-roadmap",
      kind: "roadmap_document",
      title: "SmartFlow Product Roadmap",
      reference: "docs/roadmap/product-roadmap.md",
      retrievedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
    },
    {
      id: "source:project-workspace-roadmap",
      kind: "roadmap_document",
      title: "Project Workspace -- Implementation Roadmap v1",
      reference: "docs/roadmap/project-workspace-implementation-roadmap-v1.md",
      retrievedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
    },
    {
      id: "source:adr-0004",
      kind: "adr",
      title: "ADR-0004: Write Boundaries for SmartFlow GitHub Integration",
      reference: "docs/decisions/adr/ADR-0004-write-boundaries.md",
      retrievedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
    },
    {
      id: "source:adr-0005",
      kind: "adr",
      title: "ADR-0005: EPIC-08 Code Write Mutation Boundary",
      reference: "docs/decisions/adr/ADR-0005-code-write-mutation-boundary.md",
      retrievedAt: SMARTFLOW_FIXTURE_GENERATED_AT,
    },
  ],
  objectives: [
    {
      id: "objective:software-project-proving-ground",
      summary:
        "Use software projects as the primary proving ground for the complete Observe -> Understand -> Act -> Verify loop, currently focused on the Software Project Context Foundation.",
      status: "active",
      sourceIds: ["source:product-direction", "source:project-status"],
    },
  ],
  milestones: [
    {
      id: "milestone:execution-intent-lifecycle-slice-1",
      title: "Unified Execution Intent Lifecycle Foundation Slice 1",
      status: "completed",
      sourceIds: ["source:project-status", "source:execution-intent"],
      order: 1,
    },
    {
      id: "milestone:github-read-only-integration-slice-1",
      title: "GitHub Read-only Integration V1 Slice 1",
      status: "completed",
      sourceIds: ["source:project-status", "source:github-integration"],
      order: 2,
    },
    {
      id: "milestone:software-project-context-foundation",
      title: "Software Project Context Foundation (Slice 2A)",
      status: "active",
      sourceIds: ["source:project-status"],
      order: 3,
    },
    {
      id: "milestone:project-workspace-roadmap-slices",
      title: "Project Workspace Implementation Roadmap (S1-S12)",
      status: "planned",
      sourceIds: ["source:project-workspace-roadmap"],
      order: 4,
    },
  ],
  decisions: [
    {
      id: "decision:server-owned-least-privilege-policy",
      title: "Server-owned execution policy under a least-privilege authority model",
      status: "accepted",
      sourceIds: ["source:authority-model"],
    },
    {
      id: "decision:explicit-approval-required",
      title: "Explicit, exact user approval is required before any write execution",
      status: "accepted",
      sourceIds: ["source:authority-model", "source:execution-intent"],
    },
    {
      id: "decision:write-boundaries-adr-0004",
      title: "Write Boundaries for SmartFlow GitHub Integration",
      status: "accepted",
      sourceIds: ["source:adr-0004"],
    },
    {
      id: "decision:code-write-mutation-boundary-adr-0005",
      title: "EPIC-08 Code Write Mutation Boundary",
      status: "accepted",
      sourceIds: ["source:adr-0005"],
    },
  ],
  capabilities: [
    {
      id: "capability:deterministic-reasoning-and-validation",
      title: "Deterministic reasoning and validation boundaries",
      status: "implemented",
      sourceIds: ["source:current-architecture"],
    },
    {
      id: "capability:explicit-approval-and-bounded-execution",
      title: "Explicit approval and bounded execution",
      status: "implemented",
      sourceIds: ["source:current-architecture", "source:authority-model"],
    },
    {
      id: "capability:execution-intent-lifecycle",
      title: "Trusted execution-intent lifecycle",
      status: "implemented",
      sourceIds: ["source:project-status", "source:execution-intent"],
    },
    {
      id: "capability:github-read-only-integration",
      title: "GitHub read-only integration",
      status: "implemented",
      sourceIds: ["source:project-status", "source:github-integration"],
    },
    {
      id: "capability:durable-audit",
      title: "Durable, restart-safe execution audit",
      status: "partially_implemented",
      sourceIds: ["source:execution-intent"],
      notes: "GitHub writes persist agent_write_log rows; frontend execution audit remains in-memory.",
    },
    {
      id: "capability:durable-execution-persistence",
      title: "Durable, restart-safe execution-intent lifecycle persistence",
      status: "deferred",
      sourceIds: ["source:project-status"],
    },
    {
      id: "capability:distributed-concurrency",
      title: "Distributed concurrency for execution-intent claims",
      status: "deferred",
      sourceIds: ["source:project-status"],
    },
    {
      id: "capability:scheduling-and-retries",
      title: "Scheduling and automatic retries",
      status: "deferred",
      sourceIds: ["source:project-status"],
    },
    {
      id: "capability:integration-expansion",
      title: "Broader integration expansion beyond GitHub",
      status: "deferred",
      sourceIds: ["source:project-status", "source:product-direction"],
    },
    {
      id: "capability:autonomous-execution",
      title: "Autonomous execution",
      status: "deferred",
      sourceIds: ["source:authority-model"],
    },
    {
      id: "capability:additional-project-types",
      title: "Learning Project and Personal Project types",
      status: "deferred",
      sourceIds: ["source:product-direction"],
    },
  ],
  risks: [
    {
      id: "risk:in-memory-lifecycle-persistence",
      summary:
        "The execution-intent lifecycle registry is in-memory and single-process: a restart loses lifecycle state and there is no distributed-concurrency guarantee.",
      severity: "medium",
      sourceIds: ["source:project-status", "source:execution-intent"],
    },
    {
      id: "risk:stale-supabase-generated-types",
      summary:
        "Generated Supabase types for github_connections are stale relative to the latest migration (repository_names_cache columns), so that table's typed shape does not reflect the real schema until the next canonical regeneration.",
      severity: "low",
      sourceIds: ["source:project-status"],
    },
    {
      id: "risk:distributed-and-restart-safe-claims-not-implemented",
      summary:
        "Restart-safe and distributed execution claims are not implemented; the current lifecycle foundation assumes a single running process.",
      severity: "medium",
      sourceIds: ["source:project-status", "source:execution-intent"],
    },
  ],
  candidateActions: [
    {
      id: "candidate:regenerate-supabase-types",
      kind: "candidate_action",
      authority: "non_authoritative",
      summary: "Regenerate canonical Supabase types against a migrated database to remove the github_connections drift.",
      rationale: "Closes a documented, low-severity type/schema drift rather than leaving it as standing technical debt.",
      sourceIds: ["source:project-status"],
      relatedRiskId: "risk:stale-supabase-generated-types",
    },
    {
      id: "candidate:begin-project-workspace-slice-s1",
      kind: "candidate_action",
      authority: "non_authoritative",
      summary:
        "Once Slice 2A's context foundation lands, consider beginning Project Workspace Implementation Roadmap Slice S1 (Project Entity).",
      rationale: "S1 depends only on Layer 0 systems that already exist; this context foundation is a natural prerequisite for it.",
      sourceIds: ["source:project-workspace-roadmap"],
    },
  ],
};

/**
 * Builds the SmartFlow fixture. Throws only if the fixture input itself
 * becomes invalid (e.g. a future edit introduces a contradiction) --
 * callers in tests and documentation examples can rely on this always
 * succeeding against the input above as committed.
 */
export function getSmartFlowProjectContext() {
  const result = buildProjectContext(SMARTFLOW_PROJECT_CONTEXT_INPUT);
  if (result.valid !== true) {
    throw new Error(
      `SmartFlow project context fixture is invalid: ${result.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return result.context;
}
