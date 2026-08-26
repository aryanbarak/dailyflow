import { describe, expect, it, vi } from "vitest";
import {
  fetchEngineeringTaskStatus,
  pollEngineeringTaskUntilDone,
  formatEngineeringTaskResultMessage,
} from "./engineeringTaskStatusPoller";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("fetchEngineeringTaskStatus", () => {
  it("requires authentication before calling the worker", async () => {
    const fetcher = vi.fn();
    await expect(
      fetchEngineeringTaskStatus(
        { workerBaseUrl: "https://worker.example", getAccessToken: async () => undefined, fetcher },
        "task-1",
      ),
    ).rejects.toThrow(/Authentication/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fetches the fixed status route with a bearer token", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: "task-1", status: "completed" }));
    const result = await fetchEngineeringTaskStatus(
      { workerBaseUrl: "https://worker.example", getAccessToken: async () => "token", fetcher },
      "task-1",
    );
    expect(fetcher.mock.calls[0][0]).toBe("https://worker.example/engineering-tasks/task-1");
    expect(new Headers(fetcher.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer token");
    expect(result).toEqual({ id: "task-1", status: "completed" });
  });
});

describe("pollEngineeringTaskUntilDone", () => {
  it("polls until a terminal status is reached, calling onUpdate each time", async () => {
    const responses = [
      { id: "task-1", status: "pending" },
      { id: "task-1", status: "claimed" },
      { id: "task-1", status: "completed", verifiedResult: { filesChanged: ["a.md"] } },
    ];
    let call = 0;
    const fetcher = vi.fn().mockImplementation(async () => jsonResponse(responses[call++]));
    const updates: string[] = [];

    const result = await pollEngineeringTaskUntilDone(
      { workerBaseUrl: "https://worker.example", getAccessToken: async () => "token", fetcher },
      "task-1",
      { intervalMs: 0, onUpdate: (s) => updates.push(s.status) },
    );

    expect(result.status).toBe("completed");
    expect(updates).toEqual(["pending", "claimed", "completed"]);
  });

  it("stops after maxAttempts and returns the last-known (non-terminal) status honestly", async () => {
    const fetcher = vi.fn().mockImplementation(async () => jsonResponse({ id: "task-1", status: "pending", waitingForCompanion: true }));
    const result = await pollEngineeringTaskUntilDone(
      { workerBaseUrl: "https://worker.example", getAccessToken: async () => "token", fetcher },
      "task-1",
      { intervalMs: 0, maxAttempts: 3 },
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("pending");
    expect(result.waitingForCompanion).toBe(true);
  });
});

describe("formatEngineeringTaskResultMessage", () => {
  it("reports an honest waiting-for-companion message", () => {
    const msg = formatEngineeringTaskResultMessage({ id: "t", status: "pending", repo: "a/b", waitingForCompanion: true });
    expect(msg).toMatch(/waiting for your machine to come online/);
  });

  it("reports an honest stuck-in-progress message without implying it was lost", () => {
    const msg = formatEngineeringTaskResultMessage({ id: "t", status: "claimed", repo: "a/b", stuckInProgress: true });
    expect(msg).toMatch(/appears stuck/);
    expect(msg).toMatch(/was not lost/);
  });

  it("reports failure with the error message", () => {
    const msg = formatEngineeringTaskResultMessage({ id: "t", status: "failed", repo: "a/b", errorMessage: "timed out" });
    expect(msg).toMatch(/failed: timed out/);
  });

  it("reports a bounded, honest success summary matching the spec's own example shape", () => {
    const msg = formatEngineeringTaskResultMessage({
      id: "t",
      status: "completed",
      repo: "a/b",
      branchName: "eng-04-x",
      verifiedResult: { filesChanged: ["README.md"] },
      disagreement: { disagreement: false },
    });
    expect(msg).toBe("Engineering task done -- branch eng-04-x, 1 file changed, verified. PR needed for merge.");
  });

  it("flags a self-report/verification disagreement instead of hiding it", () => {
    const msg = formatEngineeringTaskResultMessage({
      id: "t",
      status: "completed",
      branchName: "eng-04-x",
      verifiedResult: { filesChanged: [] },
      disagreement: { disagreement: true },
    });
    expect(msg).toMatch(/did not match what was independently verified/);
  });
});
