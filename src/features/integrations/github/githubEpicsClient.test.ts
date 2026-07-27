import { describe, expect, it, vi } from "vitest";
import { createGitHubEpicsClient } from "./githubEpicsClient";

describe("GitHub epics browser client", () => {
  it("calls only the fixed epics route with runtime authentication and sanitizes output", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      epics: [
        {
          repo: "aryan/smartflow",
          number: 42,
          title: "Roadmap epic",
          epic: "epic:06-roadmap",
          status: "status:planned",
          url: "https://github.com/aryan/smartflow/issues/42",
          token: "must-not-pass",
          body: "must-not-pass",
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createGitHubEpicsClient({
      workerBaseUrl: "http://127.0.0.1:8787",
      getAccessToken: async () => "supabase-session",
      fetcher: fetcher as typeof fetch,
    });
    const result = await client.listEpics();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8787/github/epics");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer supabase-session");
    expect(result.epics[0]).toEqual({
      repo: "aryan/smartflow",
      number: 42,
      title: "Roadmap epic",
      epic: "epic:06-roadmap",
      status: "status:planned",
      url: "https://github.com/aryan/smartflow/issues/42",
    });
    expect(JSON.stringify(result)).not.toContain("must-not-pass");
  });

  it("maps not-connected separately and fails closed for malformed responses", async () => {
    const notConnected = createGitHubEpicsClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response("{}", { status: 409 }),
    });
    expect(await notConnected.listEpics()).toEqual({ connectionStatus: "not_connected", epics: [] });

    const malformed = createGitHubEpicsClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ epics: "not-an-array" }), { status: 200 }),
    });
    await expect(malformed.listEpics()).rejects.toMatchObject({ code: "GITHUB_RESPONSE_INVALID" });
  });

  it("drops items missing an epic label or a valid github.com issue url instead of guessing", async () => {
    const client = createGitHubEpicsClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({
        epics: [
          {
            repo: "aryan/smartflow",
            number: 1,
            title: "Valid",
            epic: "epic:a",
            status: "",
            url: "https://github.com/aryan/smartflow/issues/1",
          },
          {
            repo: "aryan/smartflow",
            number: 2,
            title: "Missing epic label",
            epic: "",
            status: "",
            url: "https://github.com/aryan/smartflow/issues/2",
          },
          {
            repo: "aryan/smartflow",
            number: 3,
            title: "Untrusted url host",
            epic: "epic:a",
            status: "",
            url: "https://evil.example.com/aryan/smartflow/issues/3",
          },
        ],
      }), { status: 200 }),
    });
    const result = await client.listEpics();
    expect(result.epics).toHaveLength(1);
    expect(result.epics[0].number).toBe(1);
  });
});
