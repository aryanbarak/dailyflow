import { describe, expect, it, vi } from "vitest";
import { reportProposalOutcome, writeProposalTargetFields } from "./proposalOutcomeReporting";
import type { AgentIntentTarget } from "./reasoning/reasoningTypes";

function baseInput() {
  return {
    intentType: "create_finance_transaction" as const,
    toolId: "finance.create_transaction",
    domain: "finance" as const,
    outcome: "approved" as const,
    succeeded: true,
    riskLevel: "high" as const,
    targetFields: ["amount", "direction"],
  };
}

describe("writeProposalTargetFields", () => {
  it("returns only the NAMES of populated fields, never their values", () => {
    const target: AgentIntentTarget = {
      amount: "45",
      direction: "expense",
      description: "groceries for the week",
      iban: "DE89370400440532013000",
    };
    const fields = writeProposalTargetFields(target);
    expect(fields.sort()).toEqual(["amount", "description", "direction", "iban"].sort());
    // The whole point of this test: real values must never appear.
    expect(fields).not.toContain("45");
    expect(fields).not.toContain("groceries for the week");
    expect(fields).not.toContain("DE89370400440532013000");
    expect(fields.every((f) => typeof f === "string")).toBe(true);
  });

  it("excludes fields the proposal left unset", () => {
    const target: AgentIntentTarget = { amount: "45" };
    expect(writeProposalTargetFields(target)).toEqual(["amount"]);
  });

  it("returns an empty array for an undefined target", () => {
    expect(writeProposalTargetFields(undefined)).toEqual([]);
  });
});

describe("reportProposalOutcome", () => {
  function options(overrides: Partial<Parameters<typeof reportProposalOutcome>[0]> = {}) {
    return {
      workerBaseUrl: "https://worker.test",
      getAccessToken: async () => "user-token",
      ...overrides,
    };
  }

  it("POSTs the shape-only body to the endpoint with the access token", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    });

    await reportProposalOutcome(options({ fetcher }), baseInput());

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://worker.test/agent/proposal-outcome");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer user-token");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({
      requestId: undefined,
      intentType: "create_finance_transaction",
      toolId: "finance.create_transaction",
      domain: "finance",
      outcome: "approved",
      succeeded: true,
      riskLevel: "high",
      targetFields: ["amount", "direction"],
    });
  });

  // ADR-0016 Decision item 6 / task 40 Part C: the fire-and-forget
  // guarantee, proven directly at the client -- this must NEVER throw or
  // reject, no matter how the underlying fetch fails, so a caller in
  // ChatPage.tsx can safely call it without awaiting or wrapping it.
  it("never throws when the underlying fetch rejects (fire-and-forget)", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network exploded");
    });
    const logger = { error: vi.fn() };

    await expect(reportProposalOutcome(options({ fetcher, logger }), baseInput())).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("never throws when the endpoint responds with a non-ok status", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "bad request" }), { status: 400 }));
    const logger = { error: vi.fn() };

    await expect(reportProposalOutcome(options({ fetcher, logger }), baseInput())).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("never throws and skips the network call when no access token is available", async () => {
    const fetcher = vi.fn();
    const logger = { error: vi.fn() };

    await expect(
      reportProposalOutcome(options({ fetcher, getAccessToken: async () => undefined, logger }), baseInput()),
    ).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
