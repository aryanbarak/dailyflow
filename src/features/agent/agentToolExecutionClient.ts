import type {
  AgentToolExecutionClient,
  AgentToolExecutionInput,
  AgentToolExecutionResult,
  ExecutionError,
} from "./executionTypes";

// Chat V2 Slice 2A -- the browser-side half of
// agent/worker/agent-tool-execution.ts's request -> approve -> execute
// lifecycle. Same shape as every existing github*Client.ts in
// src/features/integrations/github/ (workerBaseUrl + getAccessToken +
// optional fetcher, Authorization: Bearer <session token>) -- this is not
// a new pattern for "a handler calls the Worker," it is the established
// one, applied to tasks/calendar for the first time.

interface AgentToolExecutionClientOptions {
  workerBaseUrl: string;
  getAccessToken(): Promise<string | undefined>;
  fetcher?: typeof fetch;
}

function safeExecutionError(code: string, message: string): ExecutionError {
  return { code, message, retryable: false };
}

function endpoint(workerBaseUrl: string, path: string) {
  const base = new URL(workerBaseUrl);
  if (base.username || base.password || (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1")) {
    throw safeExecutionError("WORKER_CONFIGURATION_INVALID", "Agent execution endpoint is invalid.");
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}${path}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

async function postJson(
  fetcher: typeof fetch,
  url: string,
  accessToken: string,
  body: Record<string, unknown>,
  networkErrorCode: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw safeExecutionError(networkErrorCode, "The agent execution service is unavailable.");
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = {};
  }
  return { status: response.status, body: (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown> };
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createAgentToolExecutionClient(options: AgentToolExecutionClientOptions): AgentToolExecutionClient {
  const requestEndpoint = endpoint(options.workerBaseUrl, "/agent/execution/request");
  const approveEndpoint = endpoint(options.workerBaseUrl, "/agent/execution/approve");
  const fetcher = options.fetcher ?? fetch;

  return Object.freeze({
    async requestAndExecute(input: AgentToolExecutionInput): Promise<AgentToolExecutionResult> {
      const accessToken = await options.getAccessToken();
      if (!accessToken) throw safeExecutionError("AUTH_REQUIRED", "Authentication is required.");

      const requested = await postJson(fetcher, requestEndpoint, accessToken, {
        toolId: input.toolId,
        targetId: input.targetId,
        arguments: input.arguments,
        requestId: input.requestId,
        sessionId: input.sessionId,
        chatMessageId: input.chatMessageId,
        timeZone: input.timeZone,
        language: input.language,
      }, "AGENT_EXECUTION_REQUEST_UNAVAILABLE");

      if (requested.status >= 400) {
        throw safeExecutionError(safeString(requested.body.error) ?? "AGENT_EXECUTION_REQUEST_FAILED", "The action could not be recorded.");
      }

      // policy mode 'auto': the request call already executed -- no
      // approve step to make, same as the client never having shown an
      // approval card for it in the first place.
      if (requested.body.status === "succeeded" || requested.body.status === "failed") {
        return adaptOutcome(requested.body);
      }

      const executionId = safeString(requested.body.executionId);
      if (!executionId) throw safeExecutionError("AGENT_EXECUTION_REQUEST_FAILED", "The action could not be recorded.");

      const approved = await postJson(fetcher, approveEndpoint, accessToken, { executionId }, "AGENT_EXECUTION_APPROVE_UNAVAILABLE");
      if (approved.status >= 400) {
        throw safeExecutionError(safeString(approved.body.error) ?? "AGENT_EXECUTION_APPROVE_FAILED", "The action could not be completed.");
      }
      return adaptOutcome(approved.body);
    },
  });
}

function adaptOutcome(body: Record<string, unknown>): AgentToolExecutionResult {
  const status = body.status === "succeeded" ? "succeeded" : "failed";
  return {
    status,
    reply: safeString(body.reply) ?? "",
    undoId: safeString(body.undoId),
    errorCode: safeString(body.errorCode),
    targetId: safeString(body.targetId),
    completedAt: safeString(body.completedAt),
  };
}
