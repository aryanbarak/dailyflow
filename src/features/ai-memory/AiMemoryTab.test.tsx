// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AiMemoryTab } from "./AiMemoryTab";
import type { MemoryEntry } from "./aiMemoryService";

const useAiMemoryMock = vi.hoisted(() => vi.fn());
vi.mock("./useAiMemory", () => ({ useAiMemory: useAiMemoryMock }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: vi.fn() } },
}));

afterEach(() => {
  cleanup();
  useAiMemoryMock.mockReset();
});

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return { id: "1", key: "goal_primary", value: "Ship v1", source: "manual", updatedAt: "2026-08-08T00:00:00.000Z", ...overrides };
}

function mockHook(entries: MemoryEntry[], remove = vi.fn()) {
  useAiMemoryMock.mockReturnValue({
    entries,
    isLoading: false,
    remove,
    getValue: (key: string) => entries.find((e) => e.key === key)?.value ?? "",
    getSource: (key: string) => entries.find((e) => e.key === key)?.source ?? null,
  });
}

describe("AiMemoryTab -- AI-authored content marking (ADR-0010 Problem section gap fix)", () => {
  it("renders no badge for an empty slot (no entry)", () => {
    mockHook([]);
    render(<AiMemoryTab />);
    expect(screen.queryByText("Auto")).not.toBeInTheDocument();
    expect(screen.queryByText("Manual")).not.toBeInTheDocument();
    expect(screen.queryByText("AI-written, unreviewed")).not.toBeInTheDocument();
  });

  it("renders a Manual badge for a manual entry", () => {
    mockHook([entry({ key: "goal_primary", source: "manual" })]);
    render(<AiMemoryTab />);
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("renders an Auto badge for an auto-detected entry", () => {
    mockHook([entry({ key: "mood_pattern", source: "auto" })]);
    render(<AiMemoryTab />);
    expect(screen.getByText("Auto")).toBeInTheDocument();
  });

  it("renders a distinct 'AI-written, unreviewed' badge for a source='agent' row -- previously rendered with NO badge at all, indistinguishable from the user's own words", () => {
    mockHook([entry({ key: "goal_primary", source: "agent", value: "Wants to switch careers" })]);
    render(<AiMemoryTab />);
    expect(screen.getByText("AI-written, unreviewed")).toBeInTheDocument();
    expect(screen.queryByText("Auto")).not.toBeInTheDocument();
    expect(screen.queryByText("Manual")).not.toBeInTheDocument();
  });

  it("renders the same 'AI-written, unreviewed' badge for a source='ai' row (the fourth historically-allowed but unused source value)", () => {
    mockHook([entry({ key: "goal_primary", source: "ai" })]);
    render(<AiMemoryTab />);
    expect(screen.getByText("AI-written, unreviewed")).toBeInTheDocument();
  });
});

describe("AiMemoryTab -- ADR-0010 Q3 complete write-freeze (review MAJOR #1 remediation)", () => {
  it("renders the Auto-detect button disabled, with no click handler capable of writing", () => {
    mockHook([]);
    render(<AiMemoryTab />);
    const autoDetectButton = screen.getByRole("button", { name: /Auto-detect/i });
    expect(autoDetectButton).toBeDisabled();
  });

  it("renders every memory field's input as disabled/read-only -- no affordance to add or edit a value", () => {
    mockHook([entry({ key: "goal_primary", value: "Ship v1" })]);
    render(<AiMemoryTab />);
    const input = screen.getByDisplayValue("Ship v1");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("readonly");
  });

  it("renders no Save button anywhere -- editing has no path to a write call", () => {
    mockHook([entry({ key: "goal_primary", value: "Ship v1" })]);
    render(<AiMemoryTab />);
    expect(screen.queryByTitle("Save")).not.toBeInTheDocument();
  });

  it("still renders a working Clear/delete button for an existing entry, and calls remove on click", async () => {
    const remove = vi.fn();
    mockHook([entry({ key: "goal_primary", value: "Ship v1" })], remove);
    render(<AiMemoryTab />);
    const clearButton = screen.getByTitle("Clear");
    clearButton.click();
    expect(remove).toHaveBeenCalledWith("goal_primary");
  });

  it("renders no Clear button for an empty slot (nothing to delete)", () => {
    mockHook([]);
    render(<AiMemoryTab />);
    expect(screen.queryByTitle("Clear")).not.toBeInTheDocument();
  });
});
