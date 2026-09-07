// @vitest-environment jsdom
// CORE-W6 (2026-09-07, ADR-0023 SS2): recall log viewer, grouped by batch.
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PersonalMemoryRecallLogViewer } from "./PersonalMemoryRecallLogViewer";
import type { PersonalMemoryRecallLogEntry } from "../personalMemoryRecallLogTypes";

afterEach(() => {
  cleanup();
});

function entry(overrides: Partial<PersonalMemoryRecallLogEntry> = {}): PersonalMemoryRecallLogEntry {
  return {
    id: "log-1",
    recordId: "record-1",
    recordKind: "preference",
    recordPrimaryText: "Prefers async written updates",
    consumer: "chat",
    recallBatchId: "batch-1",
    createdAt: "2026-09-07T09:00:00.000Z",
    ...overrides,
  };
}

describe("PersonalMemoryRecallLogViewer", () => {
  it("shows an empty state when nothing has been recalled yet", async () => {
    const service = { listByOwner: vi.fn().mockResolvedValue([]) };
    render(<PersonalMemoryRecallLogViewer service={service} />);
    expect(await screen.findByText("No memory has been recalled yet.")).toBeInTheDocument();
  });

  it("groups entries by recallBatchId and shows the consumer and cited records", async () => {
    const service = {
      listByOwner: vi.fn().mockResolvedValue([
        entry({ id: "log-1", recordId: "record-1", recordPrimaryText: "Prefers async written updates" }),
        entry({ id: "log-2", recordId: "record-2", recordPrimaryText: "Learn React Native", recordKind: "goal" }),
      ]),
    };
    render(<PersonalMemoryRecallLogViewer service={service} />);

    expect(await screen.findByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Prefers async written updates")).toBeInTheDocument();
    expect(screen.getByText("Learn React Native")).toBeInTheDocument();
  });

  it("a load failure shows an error message, not a crash", async () => {
    const service = { listByOwner: vi.fn().mockRejectedValue(new Error("network down")) };
    render(<PersonalMemoryRecallLogViewer service={service} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
  });
});
