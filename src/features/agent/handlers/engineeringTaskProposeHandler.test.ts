import { describe, expect, it, vi } from "vitest";
import { engineeringTaskProposeHandler } from "./engineeringTaskProposeHandler";
import type { ExecutionContext } from "../executionTypes";

function contextWith(propose: ReturnType<typeof vi.fn>): ExecutionContext {
  return { engineeringTaskClient: { propose } };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    repo: "aryan/smartflow",
    instruction: "Fix the typo in README.md's install section.",
    taskClass: "docs_fix",
    ...overrides,
  };
}

describe("engineeringTaskProposeHandler", () => {
  it("describes a high-risk write handler without weakening the write contract", () => {
    expect(engineeringTaskProposeHandler).toMatchObject({
      toolId: "engineering.task.propose",
      mode: "write",
      readOnly: false,
      externalEffect: true,
      reversible: false,
      requiresVerification: true,
    });
  });

  it("requires repo, instruction, and taskClass", () => {
    const result = engineeringTaskProposeHandler.validateInput({}, []);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("repo is required.");
    expect(result.errors).toContain("instruction is required.");
    expect(result.errors).toContain("taskClass is required.");
  });

  it("rejects arbitrary fields", () => {
    const result = engineeringTaskProposeHandler.validateInput(validInput({ extra: 1 }), []);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("extra is not allowed for engineering.task.propose.");
  });

  it("fails closed when no engineeringTaskClient is configured", async () => {
    const result = await engineeringTaskProposeHandler.execute(validInput(), {});
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("ENGINEERING_TASKS_NOT_CONFIGURED");
  });

  it("submits the task and returns the queued id/status on success", async () => {
    const propose = vi.fn().mockResolvedValue({ id: "task-1", status: "pending" });
    const result = await engineeringTaskProposeHandler.execute(validInput(), contextWith(propose));
    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.data).toEqual({ id: "task-1", status: "pending" });
    expect(propose).toHaveBeenCalledWith({
      repo: "aryan/smartflow",
      instruction: "Fix the typo in README.md's install section.",
      taskClass: "docs_fix",
    });
  });

  it("returns verification_failed if the client returns an incomplete result", async () => {
    const propose = vi.fn().mockResolvedValue({ id: "", status: "" });
    const result = await engineeringTaskProposeHandler.execute(validInput(), contextWith(propose));
    expect(result.success).toBe(false);
    expect(result.status).toBe("verification_failed");
  });

  it("propagates a client error as a failed result without throwing", async () => {
    const propose = vi.fn().mockRejectedValue({ code: "ENGINEERING_TASKS_UNAVAILABLE", message: "down" });
    const result = await engineeringTaskProposeHandler.execute(validInput(), contextWith(propose));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("ENGINEERING_TASKS_UNAVAILABLE");
  });

  it("never returns raw provider content marked as unredacted", async () => {
    const propose = vi.fn().mockResolvedValue({ id: "task-1", status: "pending" });
    const result = await engineeringTaskProposeHandler.execute(validInput(), contextWith(propose));
    expect(result.auditMetadata?.redacted).toBe(true);
  });
});
