import type {
  AgentToolExecutionClient,
  AgentToolExecutionInput,
  AgentToolExecutionRequestResult,
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
//
// BLOCKER 1 CORRECTION: requestExecution() and approveExecution() are two
// genuinely independent calls now, not one combined requestAndExecute() --
// see executionTypes.ts's own comment on AgentToolExecutionClient for why.

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

function isTerminalStatus(value: unknown): value is "succeeded" | "failed" | "uncertain" {
  return value === "succeeded" || value === "failed" || value === "uncertain";
}

export function createAgentToolExecutionClient(options: AgentToolExecutionClientOptions): AgentToolExecutionClient {
  const requestEndpoint = endpoint(options.workerBaseUrl, "/agent/execution/request");
  const approveEndpoint = endpoint(options.workerBaseUrl, "/agent/execution/approve");
  const fetcher = options.fetcher ?? fetch;

  async function getAuthenticatedAccessToken(): Promise<string> {
    const accessToken = await options.getAccessToken();
    if (!accessToken) throw safeExecutionError("AUTH_REQUIRED", "Authentication is required.");
    return accessToken;
  }

  return Object.freeze({
    // Called as soon as a write proposal is normalized -- BEFORE the user
    // approves -- so a durable approval_pending row already exists by the
    // time the approval UI is shown. Only reaches a terminal
    // succeeded/failed/uncertain status here when server policy
    // independently resolved 'auto'.
    async requestExecution(input: AgentToolExecutionInput): Promise<AgentToolExecutionRequestResult> {
      const accessToken = await getAuthenticatedAccessToken();

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

      if (isTerminalStatus(requested.body.status)) {
        return { ...adaptOutcome(requested.body, requested.body.status), executionId: safeString(requested.body.executionId) };
      }

      const executionId = safeString(requested.body.executionId);
      if (!executionId) throw safeExecutionError("AGENT_EXECUTION_REQUEST_FAILED", "The action could not be recorded.");
      return { status: "approval_pending", executionId };
    },

    // Called ONLY from the user's actual approval action. Accepts nothing
    // but the executionId a prior requestExecution() call already returned
    // -- never arguments, never toolId, never domain again -- see this
    // module's own header comment.
    async approveExecution(executionId: string): Promise<AgentToolExecutionResult> {
      const accessToken = await getAuthenticatedAccessToken();
      const approved = await postJson(fetcher, approveEndpoint, accessToken, { executionId }, "AGENT_EXECUTION_APPROVE_UNAVAILABLE");
      if (approved.status >= 400) {
        throw safeExecutionError(safeString(approved.body.error) ?? "AGENT_EXECUTION_APPROVE_FAILED", "The action could not be completed.");
      }
      const status = isTerminalStatus(approved.body.status) ? approved.body.status : "uncertain";
      return adaptOutcome(approved.body, status);
    },
  });
}

// Chat Runtime Truth V1 (frozen PO decision, Reject -> revoked): the
// browser half of POST /agent/execution/revoke. Deliberately a standalone
// function rather than a third method on AgentToolExecutionClient --
// that interface is what write HANDLERS receive through ExecutionContext,
// and no handler may ever revoke; rejection is exclusively a direct user
// action wired from the Chat UI (ChatPage.tsx). Sends the executionId and
// nothing else, mirroring approveExecution's own accepts-nothing-else
// contract on the server side.
export type AgentToolExecutionRevokeStatus =
  | "revoked"
  | "approval_pending"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"
  | "denied"
  | "expired"
  | "uncertain";

const REVOKE_STATUSES: ReadonlySet<string> = new Set([
  "revoked", "approval_pending", "approved", "executing", "succeeded", "failed", "denied", "expired", "uncertain",
]);

export interface AgentToolExecutionRevokeResult {
  // 'revoked' on a successful (or already-revoked, honest-duplicate)
  // transition; otherwise the row's actual current lifecycle status as the
  // Worker reported it in its WRONG_LIFECYCLE_STATE conflict -- returned
  // (not thrown) so the caller can reconcile its card to that durable
  // truth instead of showing a generic error for an honest answer.
  status: AgentToolExecutionRevokeStatus;
}

export async function revokeAgentToolExecution(
  options: AgentToolExecutionClientOptions,
  executionId: string,
): Promise<AgentToolExecutionRevokeResult> {
  const revokeEndpoint = endpoint(options.workerBaseUrl, "/agent/execution/revoke");
  const fetcher = options.fetcher ?? fetch;
  const accessToken = await options.getAccessToken();
  if (!accessToken) throw safeExecutionError("AUTH_REQUIRED", "Authentication is required.");

  const revoked = await postJson(fetcher, revokeEndpoint, accessToken, { executionId }, "AGENT_EXECUTION_REVOKE_UNAVAILABLE");
  const bodyStatus = typeof revoked.body.status === "string" && REVOKE_STATUSES.has(revoked.body.status)
    ? (revoked.body.status as AgentToolExecutionRevokeStatus)
    : undefined;
  if (revoked.status < 400) {
    if (bodyStatus === "revoked") return { status: "revoked" };
    throw safeExecutionError("AGENT_EXECUTION_REVOKE_FAILED", "The action could not be rejected.");
  }
  // 409 WRONG_LIFECYCLE_STATE carries the row's real current status --
  // an honest already-terminal/already-advancing answer, not a failure.
  if (revoked.status === 409 && bodyStatus) return { status: bodyStatus };
  throw safeExecutionError(safeString(revoked.body.error) ?? "AGENT_EXECUTION_REVOKE_FAILED", "The action could not be rejected.");
}

function adaptOutcome(body: Record<string, unknown>, status: "succeeded" | "failed" | "uncertain"): AgentToolExecutionResult {
  return {
    status,
    reply: safeString(body.reply) ?? "",
    undoId: safeString(body.undoId),
    errorCode: safeString(body.errorCode),
    targetId: safeString(body.targetId),
    completedAt: safeString(body.completedAt),
    // BLOCKER 3 CORRECTION: the authoritative persisted field values --
    // forwarded verbatim, never re-derived from anything this client sent.
    title: safeString(body.title),
    notes: typeof body.notes === "string" ? body.notes : body.notes === null ? null : undefined,
    dueDate: typeof body.dueDate === "string" ? body.dueDate : body.dueDate === null ? null : undefined,
    dateTimeStart: safeString(body.dateTimeStart),
    dateTimeEnd: safeString(body.dateTimeEnd),
  };
}
