import { describe, expect, it, vi } from "vitest";
import { createEngineeringTaskClient } from "./engineeringTaskClient";

describe("Engineering task propose client", () => {
  it("sends a POST to the fixed create route with repo/instruction/taskClass", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: "task-1", status: "pending" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    const client = createEngineeringTaskClient({
      workerBaseUrl: "http://127.0.0.1:8787",
      getAccessToken: async () => "supabase-session",
      fetcher: fetcher as typeof fetch,
    });

    const result = await client.propose({ repo: "aryan/smartflow", instruction: "do it", taskClass: "docs_fix" });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8787/engineering-tasks");
    const init = fetcher.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer supabase-session");
    expect(JSON.parse(init?.body as string)).toEqual({ repo: "aryan/smartflow", instruction: "do it", taskClass: "docs_fix" });
    expect(result).toEqual({ id: "task-1", status: "pending" });
  });

  it("requires authentication before calling the worker", async () => {
    const fetcher = vi.fn();
    const client = createEngineeringTaskClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => undefined,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.propose({ repo: "a/b", instruction: "x", taskClass: "docs_fix" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed on a non-ok Worker response", async () => {
    const client = createEngineeringTaskClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ error: "bad" }), { status: 400 }),
    });
    await expect(client.propose({ repo: "a/b", instruction: "x", taskClass: "docs_fix" })).rejects.toMatchObject({ code: "ENGINEERING_TASK_SUBMIT_FAILED" });
  });

  it("fails closed on a network error", async () => {
    const client = createEngineeringTaskClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => { throw new Error("network down"); },
    });
    await expect(client.propose({ repo: "a/b", instruction: "x", taskClass: "docs_fix" })).rejects.toMatchObject({ code: "ENGINEERING_TASKS_UNAVAILABLE" });
  });

  it("rejects an endpoint with embedded credentials", () => {
    expect(() => createEngineeringTaskClient({
      workerBaseUrl: "https://user:pass@worker.example.com",
      getAccessToken: async () => "session",
    })).toThrow();
  });
});
