import type { WorkspacePlanActionType } from "../workspace/workspaceTypes";
import { listTools } from "./toolRegistry";
import type { AgentToolCapability, AgentToolDefinition } from "./toolTypes";
import type {
  ToolResolutionCandidate,
  ToolResolutionInput,
  ToolResolutionResult,
  ToolResolutionStatus,
} from "./toolResolverTypes";

export const TOOL_RESOLVER_VERSION = "tool-resolver-v1" as const;

const executableReadOnlyToolIds = new Set([
  "tasks.list",
  "calendar.list_today",
  "learning.get_progress",
  "workspace.get_context",
  "github.repositories.list",
  "github.issues.list",
  "github.epics.list",
  "github.pulls.list",
  "github.workflow_runs.list",
]);

// Task 11d (auto-execute read-only tools): a read-only view of the same set
// used internally above, exported so a second, independent allowlist
// (readOnlyRuntime.ts's SUPPORTED_READ_ONLY_TOOL_IDS) can be intersected
// with THIS one at the call site that decides whether to auto-run a read --
// deliberately not merged into a single shared list, since the two files
// enforce two different boundaries (resolvability vs. runtime eligibility)
// and a real intersection check is what stays fail-closed if they ever
// drift apart.
export const EXECUTABLE_READ_ONLY_TOOL_IDS: ReadonlySet<string> = executableReadOnlyToolIds;

const unsupportedMutationActions = new Set<WorkspacePlanActionType>([
  "create",
  "update",
  "delete",
  "send",
  "pay",
  "share",
  "invite",
]);

const explicitReadOnlyMappings: Record<string, Partial<Record<WorkspacePlanActionType, string>>> = {
  tasks: {
    review: "tasks.list",
    open: "tasks.list",
    inspect: "tasks.list",
  },
  calendar: {
    review: "calendar.list_today",
    open: "calendar.list_today",
    plan: "calendar.list_today",
  },
  learning: {
    review: "learning.get_progress",
    open: "learning.get_progress",
    continue: "learning.get_progress",
  },
  workspace: {
    review: "workspace.get_context",
    reflect: "workspace.get_context",
    inspect: "workspace.get_context",
    open: "workspace.get_context",
  },
  github: {
    inspect: "github.repositories.list",
  },
};

function generatedAt(currentTime?: Date) {
  return (currentTime ?? new Date()).toISOString();
}

function emptyResult(
  input: ToolResolutionInput,
  status: ToolResolutionStatus,
  reasons: string[],
  candidates: ToolResolutionCandidate[] = [],
  requiredInput: string[] = [],
): ToolResolutionResult {
  return {
    status,
    resolved: false,
    stepId: input.step?.id ?? "unknown-step",
    confidence: "low",
    reasons,
    candidates,
    requiredInput,
    generatedAt: generatedAt(input.currentTime),
    resolverVersion: TOOL_RESOLVER_VERSION,
  };
}

function cloneTool(tool: AgentToolDefinition): AgentToolDefinition {
  return {
    ...tool,
    inputSchema: tool.inputSchema.map((field) => ({
      ...field,
      enumValues: field.enumValues ? [...field.enumValues] : undefined,
      defaultValue: Array.isArray(field.defaultValue)
        ? [...field.defaultValue]
        : field.defaultValue,
    })),
    outputSchema: {
      ...tool.outputSchema,
      fields: tool.outputSchema.fields?.map((field) => ({
        ...field,
        enumValues: field.enumValues ? [...field.enumValues] : undefined,
        defaultValue: Array.isArray(field.defaultValue)
          ? [...field.defaultValue]
          : field.defaultValue,
      })),
    },
    tags: [...tool.tags],
    examples: tool.examples.map((example) => ({
      ...example,
      input: { ...example.input },
    })),
    constraints: [...tool.constraints],
  };
}

function expectedToolIdFor(
  domain: string,
  actionType: WorkspacePlanActionType,
) {
  return explicitReadOnlyMappings[domain]?.[actionType];
}

function expectedCapabilitiesFor(domain: string, actionType: WorkspacePlanActionType): AgentToolCapability[] {
  if (domain === "github" && actionType === "inspect") return ["read"];
  switch (actionType) {
    case "review":
    case "open":
    case "inspect":
    case "continue":
    case "plan":
    case "reflect":
      return ["inspect"];
    default:
      return [];
  }
}

function isReadOnlyResolvableTool(tool: AgentToolDefinition) {
  return (
    executableReadOnlyToolIds.has(tool.id) &&
    tool.mode === "read" &&
    tool.externalEffect === false
  );
}

function candidateFor(
  tool: AgentToolDefinition,
  input: ToolResolutionInput,
  expectedToolId: string,
): ToolResolutionCandidate {
  const step = input.step;
  const expectedCapabilities = step ? expectedCapabilitiesFor(step.domain, step.actionType) : [];
  const domainMatch = Boolean(step && tool.domain === step.domain);
  const capabilityMatch = expectedCapabilities.includes(tool.capability);
  const modeMatch = tool.mode === "read" && !tool.externalEffect;
  const idMatch = tool.id === expectedToolId;
  const enabled = tool.enabled;
  let score = 0;
  const reasons: string[] = [];

  if (idMatch) {
    score += 50;
    reasons.push("Tool id matches the explicit resolver mapping.");
  }
  if (domainMatch) {
    score += 20;
    reasons.push("Tool domain matches the plan step domain.");
  }
  if (capabilityMatch) {
    score += 20;
    reasons.push("Tool capability matches the allowed action capability.");
  }
  if (modeMatch) {
    score += 10;
    reasons.push("Tool is read-only and has no external effect.");
  }
  if (!enabled) reasons.push("Tool is disabled.");
  if (!executableReadOnlyToolIds.has(tool.id)) {
    reasons.push("Tool is not supported by Tool Resolver V1.");
  }

  return {
    toolId: tool.id,
    score,
    domainMatch,
    capabilityMatch,
    modeMatch,
    enabled,
    reasons,
  };
}

function matchingTools(
  tools: AgentToolDefinition[],
  expectedToolId: string,
) {
  return tools.filter((tool) => tool.id === expectedToolId);
}

export function resolveToolForStep(input: ToolResolutionInput): ToolResolutionResult {
  const step = input.step;
  const tools = input.availableTools ?? listTools();

  if (!step?.id) {
    return emptyResult(input, "missing_context", ["A plan step with an id is required."], [], ["step.id"]);
  }

  if (unsupportedMutationActions.has(step.actionType)) {
    return emptyResult(input, "unsupported_action", [
      "Tool Resolver V1 does not resolve mutation, payment, sharing, or send actions.",
    ]);
  }

  const expectedToolId = input.expectedToolId ?? expectedToolIdFor(step.domain, step.actionType);
  if (!expectedToolId) {
    return emptyResult(input, "unsupported_action", [
      "No explicit read-only resolver mapping exists for this step domain and action.",
    ]);
  }

  const candidates = tools.map((tool) => candidateFor(tool, input, expectedToolId));
  const exactTools = matchingTools(tools, expectedToolId);

  if (exactTools.length === 0) {
    return emptyResult(input, "tool_not_found", [
      `Expected tool ${expectedToolId} is not registered in the available tool set.`,
    ], candidates);
  }

  const validTools = exactTools.filter(
    (tool) => tool.enabled && isReadOnlyResolvableTool(tool),
  );

  if (validTools.length === 0) {
    const disabled = exactTools.some((tool) => !tool.enabled);
    return emptyResult(input, disabled ? "tool_disabled" : "unresolved", [
      disabled
        ? `Expected tool ${expectedToolId} is disabled.`
        : `Expected tool ${expectedToolId} is not an enabled read-only V1 resolver tool.`,
    ], candidates);
  }

  const validCandidates = candidates.filter((candidate) =>
    validTools.some((tool) => tool.id === candidate.toolId),
  );
  const bestScore = Math.max(...validCandidates.map((candidate) => candidate.score));
  const bestCandidates = validCandidates.filter((candidate) => candidate.score === bestScore);

  if (bestCandidates.length > 1) {
    return emptyResult(input, "ambiguous", [
      "Multiple enabled read-only candidates have equal priority.",
    ], candidates);
  }

  const candidate = bestCandidates[0];
  const tool = validTools.find((item) => item.id === candidate.toolId);
  if (!tool) {
    return emptyResult(input, "tool_not_found", [
      `Expected tool ${expectedToolId} could not be selected deterministically.`,
    ], candidates);
  }

  if (!candidate.domainMatch) {
    return emptyResult(input, "domain_mismatch", [
      "Selected tool domain does not match the plan step domain.",
    ], candidates);
  }

  if (!candidate.capabilityMatch) {
    return emptyResult(input, "capability_mismatch", [
      "Selected tool capability does not match the allowed action capability.",
    ], candidates);
  }

  return {
    status: "resolved",
    resolved: true,
    stepId: step.id,
    toolId: tool.id,
    tool: cloneTool(tool),
    confidence: "high",
    reasons: [
      "Resolved through an explicit domain/action/tool mapping.",
      "Selected tool is enabled, read-only, and has no external effect.",
    ],
    candidates,
    requiredInput: tool.inputSchema
      .filter((field) => field.required)
      .map((field) => field.name),
    generatedAt: generatedAt(input.currentTime),
    resolverVersion: TOOL_RESOLVER_VERSION,
  };
}
