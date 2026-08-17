import { describe, expect, it } from "vitest";
import { buildReasoningPrompt } from "./reasoningPrompt";
import type { AgentReasoningPromptInput, AgentReasoningSafeContext } from "./reasoningTypes";
import { writeIntentRegistry } from "../../../../shared/writeIntentRegistry";

const now = new Date("2026-07-25T09:00:00.000Z");

function baseSafeContext(overrides: Partial<AgentReasoningSafeContext> = {}): AgentReasoningSafeContext {
  return {
    tasks: [],
    events: [],
    learningProgress: null,
    workspace: null,
    ...overrides,
  };
}

function promptInput(overrides: Partial<AgentReasoningPromptInput> = {}): AgentReasoningPromptInput {
  return {
    userMessage: "چه چیزی در Smart Academy باز مانده؟",
    configuredResponseLanguage: "auto",
    interfaceLanguage: "fa",
    safeContext: baseSafeContext(),
    responseLanguage: "fa",
    now,
    ...overrides,
  };
}

function githubInventoryFromPrompt(prompt: string) {
  const match = prompt.match(/Current safe context JSON: (.+)\nUser message:/s);
  expect(match).not.toBeNull();
  const parsed = JSON.parse(match![1]) as { githubRepositoryInventory: unknown };
  return parsed.githubRepositoryInventory;
}

describe("buildReasoningPrompt githubRepositoryInventory", () => {
  it("renders unknown when the field is entirely absent from safeContext", () => {
    const prompt = buildReasoningPrompt(promptInput());
    expect(githubInventoryFromPrompt(prompt)).toEqual({ status: "unknown" });
  });

  it("renders unknown when explicitly marked unknown, distinct from a known-empty list", () => {
    const prompt = buildReasoningPrompt(promptInput({
      safeContext: baseSafeContext({ githubRepositoryInventory: { status: "unknown" } }),
    }));
    expect(githubInventoryFromPrompt(prompt)).toEqual({ status: "unknown" });
  });

  it("renders known with an empty list as a genuinely different shape than unknown", () => {
    const prompt = buildReasoningPrompt(promptInput({
      safeContext: baseSafeContext({ githubRepositoryInventory: { status: "known", names: [] } }),
    }));
    expect(githubInventoryFromPrompt(prompt)).toEqual({ status: "known", names: [] });
  });

  it("renders known repository names, capped and sanitized", () => {
    const names = Array.from({ length: 20 }, (_, i) => `owner/repo-${i}`);
    const prompt = buildReasoningPrompt(promptInput({
      safeContext: baseSafeContext({ githubRepositoryInventory: { status: "known", names } }),
    }));
    const rendered = githubInventoryFromPrompt(prompt) as { status: string; names: string[] };
    expect(rendered.status).toBe("known");
    expect(rendered.names).toHaveLength(12);
    expect(rendered.names[0]).toBe("owner/repo-0");
  });

  it("includes an explicit instruction that unknown must not be read as zero repositories", () => {
    const prompt = buildReasoningPrompt(promptInput());
    expect(prompt).toContain("does NOT mean the user has no GitHub repositories");
  });

  it("includes an instruction that a name match is disambiguation evidence, not a tool selector", () => {
    const prompt = buildReasoningPrompt(promptInput());
    expect(prompt).toContain("never by itself selects which GitHub tool");
  });
});

describe("buildReasoningPrompt finance support", () => {
  it("lists create_finance_transaction as supported and drops the old finance-unsupported phrasing", () => {
    const prompt = buildReasoningPrompt(promptInput());
    expect(prompt).toContain("create_finance_transaction");
    expect(prompt).not.toContain("finance mutations");
  });

  it.each(writeIntentRegistry.map((entry) => entry.intentType))(
    "includes registry write intent %s in the built prompt",
    (intentType) => {
      const prompt = buildReasoningPrompt(promptInput());
      expect(prompt).toContain(intentType);
    },
  );
});
