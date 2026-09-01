import { describe, expect, it, vi } from "vitest";
import { createAgentToolExecutionClient } from "./agentToolExecutionClient";

const BASE_INPUT = {
  toolId: "tasks.create" as const,
  arguments: { title: "Call Ahmad", dueDate: "2026-09-01" },
  requestId: "req-1",
  timeZone: "Europe/Berlin",
};

describe("agent tool execution client (Chat V2 Slice 2A, Blocker 1 correction: split request/approve)", () => {
  describe("requestExecution", () => {
    it("calls only /agent/execution/request, with the exact expected body shape", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ executionId: "exec-1", status: "approval_pending" }), { status: 200 });
      });
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "http://127.0.0.1:8787",
        getAccessToken: async () => "session-token",
        fetcher: fetcher as unknown as typeof fetch,
      });

      const result = await client.requestExecution(BASE_INPUT);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://127.0.0.1:8787/agent/execution/request");
      expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer session-token");
      expect(JSON.parse(calls[0].init?.body as string)).toMatchObject({
        toolId: "tasks.create",
        arguments: { title: "Call Ahmad", dueDate: "2026-09-01" },
        requestId: "req-1",
        timeZone: "Europe/Berlin",
      });
      expect(result).toEqual({ status: "approval_pending", executionId: "exec-1" });
    });

    it("returns a terminal status directly, with no approve call, when server policy independently resolved auto", async () => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "succeeded", reply: "Task created." }), { status: 200 }));
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "https://worker.example.com",
        getAccessToken: async () => "session",
        fetcher: fetcher as unknown as typeof fetch,
      });
      const result = await client.requestExecution(BASE_INPUT);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: "succeeded", reply: "Task created." });
    });

    it("requires authentication before calling the worker at all", async () => {
      const fetcher = vi.fn();
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "https://worker.example.com",
        getAccessToken: async () => undefined,
        fetcher: fetcher as unknown as typeof fetch,
      });
      await expect(client.requestExecution(BASE_INPUT)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("surfaces the Worker's specific error code from a rejected request", async () => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "POLICY_DENIED" }), { status: 403 }));
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "https://worker.example.com",
        getAccessToken: async () => "session",
        fetcher: fetcher as unknown as typeof fetch,
      });
      await expect(client.requestExecution(BASE_INPUT)).rejects.toMatchObject({ code: "POLICY_DENIED" });
    });

    it("a network failure is reported as a distinct, non-retryable unavailability error, not thrown raw", async () => {
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "https://worker.example.com",
        getAccessToken: async () => "session",
        fetcher: async () => { throw new Error("network down") },
      });
      await expect(client.requestExecution(BASE_INPUT)).rejects.toMatchObject({ code: "AGENT_EXECUTION_REQUEST_UNAVAILABLE", retryable: false });
    });
  });

  describe("approveExecution", () => {
    it("calls only /agent/execution/approve, with the body carrying ONLY the executionId -- never arguments, never toolId", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ status: "succeeded", reply: "Task created.", undoId: "undo:1" }), { status: 200 });
      });
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "http://127.0.0.1:8787",
        getAccessToken: async () => "session-token",
        fetcher: fetcher as unknown as typeof fetch,
      });

      const result = await client.approveExecution("exec-1");

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://127.0.0.1:8787/agent/execution/approve");
      expect(JSON.parse(calls[0].init?.body as string)).toEqual({ executionId: "exec-1" });
      expect(result).toEqual({ status: "succeeded", reply: "Task created.", undoId: "undo:1", errorCode: undefined, targetId: undefined });
    });

    it("a failed (not succeeded) outcome is returned, not thrown -- 'failed' is a valid, informative result, not a client error", async () => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "failed", reply: "Could not verify.", errorCode: "TARGET_NOT_FOUND" }), { status: 200 }));
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "https://worker.example.com",
        getAccessToken: async () => "session",
        fetcher: fetcher as unknown as typeof fetch,
      });
      const result = await client.approveExecution("exec-1");
      expect(result).toMatchObject({ status: "failed", errorCode: "TARGET_NOT_FOUND" });
    });

    it("an 'uncertain' outcome is returned as-is, never coerced into succeeded or failed", async () => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "uncertain", reply: "We could not confirm this completed.", errorCode: "EXECUTION_OUTCOME_UNKNOWN" }), { status: 200 }));
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "https://worker.example.com",
        getAccessToken: async () => "session",
        fetcher: fetcher as unknown as typeof fetch,
      });
      const result = await client.approveExecution("exec-1");
      expect(result).toMatchObject({ status: "uncertain", errorCode: "EXECUTION_OUTCOME_UNKNOWN" });
    });

    it("requires authentication before calling the worker at all", async () => {
      const fetcher = vi.fn();
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "https://worker.example.com",
        getAccessToken: async () => undefined,
        fetcher: fetcher as unknown as typeof fetch,
      });
      await expect(client.approveExecution("exec-1")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("surfaces the Worker's specific error code from a rejected approve (e.g. a fail-closed denial)", async () => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "ACTOR_MISMATCH" }), { status: 403 }));
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "https://worker.example.com",
        getAccessToken: async () => "session",
        fetcher: fetcher as unknown as typeof fetch,
      });
      await expect(client.approveExecution("exec-1")).rejects.toMatchObject({ code: "ACTOR_MISMATCH" });
    });

    it("a network failure is reported as a distinct, non-retryable unavailability error, not thrown raw", async () => {
      const client = createAgentToolExecutionClient({
        workerBaseUrl: "https://worker.example.com",
        getAccessToken: async () => "session",
        fetcher: async () => { throw new Error("network down") },
      });
      await expect(client.approveExecution("exec-1")).rejects.toMatchObject({ code: "AGENT_EXECUTION_APPROVE_UNAVAILABLE", retryable: false });
    });
  });
});
