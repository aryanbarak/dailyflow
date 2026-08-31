import { describe, expect, it, vi } from "vitest";
import { createAgentToolExecutionClient } from "./agentToolExecutionClient";

const BASE_INPUT = {
  toolId: "tasks.create" as const,
  arguments: { title: "Call Ahmad", dueDate: "2026-09-01" },
  requestId: "req-1",
  timeZone: "Europe/Berlin",
};

describe("agent tool execution client (Chat V2 Slice 2A)", () => {
  it("calls request then approve, in that order, with the exact expected shapes", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/agent/execution/request")) {
        return new Response(JSON.stringify({ executionId: "exec-1", status: "approval_pending" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "succeeded", reply: "Task created.", undoId: "undo:1" }), { status: 200 });
    });
    const client = createAgentToolExecutionClient({
      workerBaseUrl: "http://127.0.0.1:8787",
      getAccessToken: async () => "session-token",
      fetcher: fetcher as unknown as typeof fetch,
    });

    const result = await client.requestAndExecute(BASE_INPUT);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("http://127.0.0.1:8787/agent/execution/request");
    expect(calls[1].url).toBe("http://127.0.0.1:8787/agent/execution/approve");
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer session-token");
    expect(JSON.parse(calls[0].init?.body as string)).toMatchObject({
      toolId: "tasks.create",
      arguments: { title: "Call Ahmad", dueDate: "2026-09-01" },
      requestId: "req-1",
      timeZone: "Europe/Berlin",
    });
    // The approve call carries ONLY the executionId -- never arguments,
    // never toolId -- mirroring the Worker's own refusal to re-accept them
    // (agent-tool-execution.ts's own header comment).
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({ executionId: "exec-1" });
    expect(result).toEqual({ status: "succeeded", reply: "Task created.", undoId: "undo:1", errorCode: undefined, targetId: undefined });
  });

  it("stops after the request call when the Worker already executed it (policy mode auto)", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "succeeded", reply: "Task created." }), { status: 200 }));
    const client = createAgentToolExecutionClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: fetcher as unknown as typeof fetch,
    });
    const result = await client.requestAndExecute(BASE_INPUT);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("succeeded");
  });

  it("requires authentication before calling the worker at all", async () => {
    const fetcher = vi.fn();
    const client = createAgentToolExecutionClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => undefined,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.requestAndExecute(BASE_INPUT)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces the Worker's specific error code from the request call, never calling approve", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "POLICY_DENIED" }), { status: 403 }));
    const client = createAgentToolExecutionClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.requestAndExecute(BASE_INPUT)).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("surfaces the Worker's specific error code from the approve call (e.g. a fail-closed denial)", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/agent/execution/request")) {
        return new Response(JSON.stringify({ executionId: "exec-1", status: "approval_pending" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "ACTOR_MISMATCH" }), { status: 403 });
    });
    const client = createAgentToolExecutionClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.requestAndExecute(BASE_INPUT)).rejects.toMatchObject({ code: "ACTOR_MISMATCH" });
  });

  it("a network failure on either call is reported as a distinct, non-retryable unavailability error, not thrown raw", async () => {
    const client = createAgentToolExecutionClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => { throw new Error("network down") },
    });
    await expect(client.requestAndExecute(BASE_INPUT)).rejects.toMatchObject({ code: "AGENT_EXECUTION_REQUEST_UNAVAILABLE", retryable: false });
  });

  it("a failed (not succeeded) outcome from approve is returned, not thrown -- 'failed' is a valid, informative result, not a client error", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/agent/execution/request")) {
        return new Response(JSON.stringify({ executionId: "exec-1", status: "approval_pending" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "failed", reply: "Could not verify.", errorCode: "TARGET_NOT_FOUND" }), { status: 200 });
    });
    const client = createAgentToolExecutionClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: fetcher as unknown as typeof fetch,
    });
    const result = await client.requestAndExecute(BASE_INPUT);
    expect(result).toMatchObject({ status: "failed", errorCode: "TARGET_NOT_FOUND" });
  });
});
