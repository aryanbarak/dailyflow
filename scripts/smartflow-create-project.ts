#!/usr/bin/env node
// Developer-only CLI: creates exactly one ProjectRecord. This is the smallest
// possible write path for standing up a ProjectRecord so the existing Local
// Project Refresh CLI (scripts/smartflow-refresh-project.ts) has something to
// operate against -- it does not run a refresh itself, does not touch
// ProjectContext/ProjectBrief, and adds no UI.
//
// Mirrors scripts/smartflow-refresh-project.ts's own conventions exactly:
// same env vars, same access-token-bearer Supabase client (never
// service-role), same "resolve owner from the authenticated session, never
// accept one as an argument" rule, and the same
// createProjectRecordService/createSupabaseProjectRecordRepository pair the
// rest of the app already uses -- so ownership, RLS, and input validation are
// enforced exactly once, in projectRecordService.ts/projectRecordValidation.ts,
// not re-implemented here.
import { createClient } from "@supabase/supabase-js";
import { createSanitizedFetch } from "../src/features/projects/sanitizedSupabaseFetch";

type ParsedArgs = {
  name: string;
  description?: string;
  repoOwner?: string;
  repoName?: string;
  json: boolean;
  allowProduction: boolean;
};

class CliError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CliError";
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let name = "";
  let description: string | undefined;
  let repoOwner: string | undefined;
  let repoName: string | undefined;
  let json = false;
  let allowProduction = false;
  // Duplicate flags are intentionally last-value-wins, not rejected --
  // identical to scripts/smartflow-refresh-project.ts's own parseArgs, which
  // this CLI otherwise mirrors exactly. See
  // createProjectCliActual.test.ts's "duplicated --name" test for the
  // explicit, asserted contract this loop implements.
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--allow-production") {
      allowProduction = true;
    } else if (arg === "--name") {
      name = argv[++index] ?? "";
    } else if (arg === "--description") {
      description = argv[++index] ?? "";
    } else if (arg === "--repo-owner") {
      repoOwner = argv[++index] ?? "";
    } else if (arg === "--repo-name") {
      repoName = argv[++index] ?? "";
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!name) throw new Error("--name is required.");
  if ((repoOwner && !repoName) || (repoName && !repoOwner)) {
    throw new Error("--repo-owner and --repo-name must be supplied together.");
  }
  return { name, description, repoOwner, repoName, json, allowProduction };
}

function readRequiredEnv(name: string, fallbackName?: string): string {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : "");
  if (!value || value.trim().length === 0) {
    throw new CliError("AUTH_CONFIGURATION_REQUIRED", `Missing ${name}${fallbackName ? ` or ${fallbackName}` : ""}.`);
  }
  return value.trim();
}

function exitCodeFor(code: string): number {
  if (code === "INVALID_ARGUMENTS" || code === "INVALID_INPUT") return 2;
  if (
    code === "AUTH_CONFIGURATION_REQUIRED" ||
    code === "INVALID_SUPABASE_URL" ||
    code === "UNAUTHENTICATED" ||
    code === "NOT_LOCAL_TARGET" ||
    code === "PRODUCTION_NOT_CONFIRMED"
  ) {
    return 3;
  }
  if (code === "DUPLICATE_REPOSITORY_BINDING") return 4;
  return 1;
}

interface HumanCreateResult {
  id: string;
  name: string;
  status: string;
  version: number;
  enabledEvidenceSourceKinds: readonly string[];
  repository?: { provider: string; owner: string; name: string };
}

function renderHuman(targetHost: string, result: HumanCreateResult): string {
  return [
    `Target: ${targetHost}`,
    `Project created: ${result.name} (${result.id})`,
    `Status: ${result.status}`,
    `Version: ${result.version}`,
    `Enabled evidence sources: ${result.enabledEvidenceSourceKinds.join(", ")}`,
    result.repository ? `Repository: ${result.repository.owner}/${result.repository.name} (${result.repository.provider})` : "Repository: none",
  ].join("\n");
}

function renderFailure(code: string, message: string, targetHost?: string, issues?: unknown): { text: string; json: Record<string, unknown> } {
  const json: Record<string, unknown> = { ok: false, code, message };
  if (targetHost) json.target = { host: targetHost };
  if (issues) json.issues = issues;
  const text = [targetHost ? `Target: ${targetHost}` : undefined, `Project creation failed: ${code}`, message]
    .filter((line): line is string => line !== undefined)
    .join("\n");
  return { text, json };
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

  // Resolved before the try/catch below closes over it, so every failure
  // from this point on -- auth, validation, persistence -- can report which
  // database host was actually targeted, not just missing-config failures
  // where no host is resolvable at all.
  let targetHost: string | undefined;

  try {
    const supabaseUrl = readRequiredEnv("SMARTFLOW_SUPABASE_URL", "SMARTFLOW_LOCAL_SUPABASE_URL");

    const [
      { resolveCliSupabaseTarget, describeCliSupabaseTargetFailure },
      { createSupabaseProjectRecordRepository },
      { createProjectRecordService },
      { REQUIRED_LOCAL_REFRESH_SOURCE_KINDS },
    ] = await Promise.all([
      import("../src/features/projects/cliSupabaseEnvironmentGate"),
      import("../src/features/projects/projectRecordRepository"),
      import("../src/features/projects/projectRecordService"),
      import("../src/features/projects/localProjectRefreshService"),
    ]);

    // R-1 remediation: gate the resolved target BEFORE reading anon key/access
    // token or constructing any Supabase client -- a non-local target with no
    // --allow-production flag must fail closed here, unconditionally. Also
    // replaces this file's own former resolveTargetHost -- the gate resolves
    // and reports the same host, so that host-parsing logic is not duplicated.
    const gateResult = await resolveCliSupabaseTarget(supabaseUrl, { allowProduction: parsed.allowProduction });
    targetHost = gateResult.host;
    if (!gateResult.ok) {
      throw new CliError(gateResult.reason, describeCliSupabaseTargetFailure(gateResult));
    }

    const anonKey = readRequiredEnv("SMARTFLOW_SUPABASE_ANON_KEY", "SMARTFLOW_LOCAL_SUPABASE_ANON_KEY");
    const accessToken = readRequiredEnv("SMARTFLOW_SUPABASE_ACCESS_TOKEN");

    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` }, fetch: createSanitizedFetch() },
    });
    const resolveOwnerId = async () => {
      const { data, error } = await client.auth.getUser(accessToken);
      if (error) return null;
      return data.user?.id ?? null;
    };

    const repository = createSupabaseProjectRecordRepository(client);
    const service = createProjectRecordService({ repository, resolveOwnerId });

    const created = await service.create({
      type: "software_project",
      name: parsed.name,
      ...(parsed.description ? { description: parsed.description } : {}),
      ...(parsed.repoOwner && parsed.repoName
        ? { repository: { provider: "github" as const, owner: parsed.repoOwner, name: parsed.repoName } }
        : {}),
      enabledEvidenceSourceKinds: REQUIRED_LOCAL_REFRESH_SOURCE_KINDS,
    });

    const humanResult: HumanCreateResult = {
      id: created.id,
      name: created.name,
      status: created.status,
      version: created.version,
      enabledEvidenceSourceKinds: created.enabledEvidenceSourceKinds,
      repository: created.repository,
    };

    if (parsed.json) console.log(JSON.stringify({ ok: true, target: { host: targetHost }, result: created }, null, 2));
    else console.log(renderHuman(targetHost, humanResult));
    return 0;
  } catch (error) {
    const code = error instanceof CliError ? error.code : (error as { code?: string }).code ?? "UNEXPECTED_CREATE_FAILURE";
    const message =
      code === "AUTH_CONFIGURATION_REQUIRED"
        ? "Authentication configuration is required."
        : error instanceof Error
          ? error.message
          : "Project creation failed.";
    const issues = (error as { issues?: unknown }).issues;
    const { text, json } = renderFailure(code, message, targetHost, issues);
    if (parsed.json) console.log(JSON.stringify(json, null, 2));
    else console.error(text);
    return exitCodeFor(code);
  }
}

main().then((code) => {
  process.exitCode = code;
});
