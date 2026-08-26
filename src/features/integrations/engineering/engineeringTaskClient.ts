// ENG-04 -- see docs/architecture/notes/eng-04-companion-chat-approval-wiring-v1.md.
// Mirrors githubIssuesUpdateClient.ts's own shape exactly: same endpoint-
// construction guard, same auth pattern, same fail-closed error handling.
import type {
  EngineeringTaskClient,
  EngineeringTaskProposeInput,
  EngineeringTaskProposeResult,
  ExecutionError,
} from "@/features/agent/executionTypes";

interface EngineeringTaskClientOptions {
  workerBaseUrl: string;
  getAccessToken(): Promise<string | undefined>;
  fetcher?: typeof fetch;
}

function safeExecutionError(code: string, message: string): ExecutionError {
  return { code, message, retryable: false };
}

function safeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function createEndpoint(workerBaseUrl: string) {
  const base = new URL(workerBaseUrl);
  if (base.username || base.password || (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1")) {
    throw safeExecutionError("ENGINEERING_TASKS_CONFIGURATION_INVALID", "Engineering task endpoint is invalid.");
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}/engineering-tasks`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function createEngineeringTaskClient(
  options: EngineeringTaskClientOptions,
): EngineeringTaskClient {
  const endpoint = createEndpoint(options.workerBaseUrl);
  const fetcher = options.fetcher ?? fetch;

  return Object.freeze({
    async propose(input: EngineeringTaskProposeInput): Promise<EngineeringTaskProposeResult> {
      const accessToken = await options.getAccessToken();
      if (!accessToken) throw safeExecutionError("AUTH_REQUIRED", "Authentication is required.");

      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repo: input.repo,
            instruction: input.instruction,
            taskClass: input.taskClass,
          }),
        });
      } catch {
        throw safeExecutionError("ENGINEERING_TASKS_UNAVAILABLE", "Engineering task submission is unavailable.");
      }

      if (!response.ok) {
        throw safeExecutionError("ENGINEERING_TASK_SUBMIT_FAILED", "The engineering task could not be submitted.");
      }

      const body = (await response.json()) as { id?: unknown; status?: unknown };
      const id = safeString(body.id, 200);
      const status = safeString(body.status, 50);
      if (!id || !status) {
        throw safeExecutionError("ENGINEERING_TASKS_RESPONSE_INVALID", "The Worker returned an invalid response.");
      }
      return { id, status };
    },
  });
}
