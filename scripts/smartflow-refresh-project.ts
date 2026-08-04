#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

type ParsedArgs = { projectId: string; repoRoot: string; json: boolean };

class CliError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CliError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv: readonly string[]): ParsedArgs {
  let projectId = "";
  let repoRoot = "";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--project-id") {
      projectId = argv[++index] ?? "";
    } else if (arg === "--repo-root") {
      repoRoot = argv[++index] ?? "";
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!projectId) throw new Error("--project-id is required.");
  if (!UUID_PATTERN.test(projectId)) throw new Error("--project-id must be a UUID.");
  if (!repoRoot) throw new Error("--repo-root is required.");
  if (repoRoot.includes(String.fromCharCode(0))) throw new Error("--repo-root is invalid.");
  return { projectId, repoRoot, json };
}

function readRequiredEnv(name: string, fallbackName?: string): string {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : "");
  if (!value || value.trim().length === 0) {
    throw new CliError("AUTH_CONFIGURATION_REQUIRED", `Missing ${name}${fallbackName ? ` or ${fallbackName}` : ""}.`);
  }
  return value.trim();
}

function exitCodeFor(code: string): number {
  if (code === "INVALID_ARGUMENTS") return 2;
  if (code === "AUTH_CONFIGURATION_REQUIRED" || code === "UNAUTHENTICATED") return 3;
  if (code === "PROJECT_NOT_FOUND" || code === "PROJECT_ARCHIVED" || code === "EVIDENCE_SOURCE_DISABLED") return 4;
  if (code === "INVALID_REPOSITORY_ROOT" || code === "DOCUMENT_DISCOVERY_FAILURE" || code === "UNSAFE_DOCUMENT_PATH" || code === "DOCUMENT_READ_FAILURE") return 5;
  return 1;
}

interface HumanRefreshResult {
  project: { name: string; id: string };
  counts: { created: number; unchanged: number; skipped: number; failed: number; discovered: number };
  projectBrief: {
    currentPhase: { status: string; value?: string };
    currentFocus: { status: string; value?: string };
    explicitNextActions: readonly unknown[];
  };
  extractionWarnings: readonly unknown[];
  conflicts: { currentPhase: boolean; currentFocus: boolean; itemConflictCount: number };
  snapshotHash: string;
}

function renderHuman(result: HumanRefreshResult): string {
  const phase =
    result.projectBrief.currentPhase.status === "known"
      ? result.projectBrief.currentPhase.value
      : result.projectBrief.currentPhase.status;
  const focus =
    result.projectBrief.currentFocus.status === "known"
      ? result.projectBrief.currentFocus.value
      : result.projectBrief.currentFocus.status;
  return [
    `Project: ${result.project.name} (${result.project.id})`,
    `Refresh: ${result.counts.created} created, ${result.counts.unchanged} unchanged, ${result.counts.skipped} skipped, ${result.counts.failed} failed / ${result.counts.discovered} discovered`,
    `Current phase: ${phase}`,
    `Current focus: ${focus}`,
    `Warnings: ${result.extractionWarnings.length}`,
    `Conflicts: ${(result.conflicts.currentPhase ? 1 : 0) + (result.conflicts.currentFocus ? 1 : 0) + result.conflicts.itemConflictCount}`,
    `Snapshot: ${result.snapshotHash.slice(0, 12)}`,
    `Next actions: ${result.projectBrief.explicitNextActions.length}`,
  ].join("\n");
}

async function main(): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    const result = { ok: false, code: "INVALID_ARGUMENTS", message: error instanceof Error ? error.message : "Invalid CLI arguments." };
    const line = JSON.stringify(result, null, 2);
    if (process.argv.includes("--json")) console.log(line);
    else console.error(line);
    return exitCodeFor(result.code);
  }

  try {
    const supabaseUrl = readRequiredEnv("SMARTFLOW_SUPABASE_URL", "SMARTFLOW_LOCAL_SUPABASE_URL");
    const anonKey = readRequiredEnv("SMARTFLOW_SUPABASE_ANON_KEY", "SMARTFLOW_LOCAL_SUPABASE_ANON_KEY");
    const accessToken = readRequiredEnv("SMARTFLOW_SUPABASE_ACCESS_TOKEN");

    const [
      { createSupabaseProjectRecordRepository },
      { createSupabaseProjectEvidenceRepository },
      { createProjectEvidenceService },
      { createContextRebuildService },
      { refreshLocalProject },
    ] = await Promise.all([
      import("../src/features/projects/projectRecordRepository"),
      import("../src/features/projects/projectEvidenceRepository"),
      import("../src/features/projects/projectEvidenceService"),
      import("../src/features/projects/contextRebuildService"),
      import("../src/features/projects/localProjectRefreshService"),
    ]);

    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const resolveOwnerId = async () => {
      const { data, error } = await client.auth.getUser(accessToken);
      if (error) return null;
      return data.user?.id ?? null;
    };

    const projectRepository = createSupabaseProjectRecordRepository(client);
    const evidenceRepository = createSupabaseProjectEvidenceRepository(client);
    const evidenceService = createProjectEvidenceService({ repository: evidenceRepository, projectRepository, resolveOwnerId });
    const contextRebuildService = createContextRebuildService({ projectRepository, evidenceRepository, resolveOwnerId });
    const result = await refreshLocalProject(
      { projectId: parsed.projectId, repositoryRoot: parsed.repoRoot },
      {
        resolveOwnerId,
        projectRepository,
        contextRebuildService,
        evidenceService,
        now: () => new Date().toISOString(),
      },
    );

    if (parsed.json) console.log(JSON.stringify({ ok: true, result }, null, 2));
    else console.log(renderHuman(result));
    return 0;
  } catch (error) {
    const code = error instanceof CliError ? error.code : (error as { code?: string }).code ?? "UNEXPECTED_REFRESH_FAILURE";
    const message =
      code === "AUTH_CONFIGURATION_REQUIRED"
        ? "Authentication configuration is required."
        : error instanceof Error
          ? error.message
          : "Refresh failed.";
    const result = (error as { result?: unknown }).result;
    const safe = result ? { ok: false, code, message, result } : { ok: false, code, message };
    if (parsed.json) console.log(JSON.stringify(safe, null, 2));
    else console.error(`Refresh failed: ${code}\n${message}`);
    return exitCodeFor(code);
  }
}

main().then((code) => {
  process.exitCode = code;
});
