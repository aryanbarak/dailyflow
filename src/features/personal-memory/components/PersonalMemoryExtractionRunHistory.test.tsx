// @vitest-environment jsdom
// CORE-W6 (2026-09-07, ADR-0023 SS1): extraction-run history + retry.
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalMemoryExtractionRunHistory } from "./PersonalMemoryExtractionRunHistory";
import type { PersonalMemoryExtractionRun } from "../personalMemoryRecordTypes";
import type { PersonalMemoryExtractionTriggerResult } from "../personalMemoryExtractionTriggerClient";

afterEach(() => {
  cleanup();
});

function run(overrides: Partial<PersonalMemoryExtractionRun> = {}): PersonalMemoryExtractionRun {
  return {
    id: "run-1",
    ownerId: "owner-1",
    modelIdentity: "gemini",
    derivationVersion: "personal-memory-extraction-v1",
    startedAt: "2026-09-01T00:00:00.000Z",
    completedAt: "2026-09-01T00:00:05.000Z",
    candidateCount: 3,
    acceptedCount: 2,
    droppedCount: 1,
    outcome: "completed",
    ...overrides,
  };
}

function successResult(overrides: Partial<PersonalMemoryExtractionTriggerResult & { ok: true }> = {}): PersonalMemoryExtractionTriggerResult {
  return { ok: true, runId: "run-2", sourceItemCount: 4, candidateCount: 2, acceptedCount: 2, droppedCount: 0, outcome: "completed", ...overrides };
}

describe("PersonalMemoryExtractionRunHistory", () => {
  it("renders a completed run with its counts", async () => {
    const service = { listRuns: vi.fn().mockResolvedValue([run()]) };
    render(<PersonalMemoryExtractionRunHistory service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByText("Completed")).toBeInTheDocument();
  });

  it("a run with completed_at null and an old started_at renders Interrupted, not Failed or a spinner", async () => {
    const service = {
      listRuns: vi.fn().mockResolvedValue([
        run({ completedAt: undefined, outcome: undefined, startedAt: "2020-01-01T00:00:00.000Z" }),
      ]),
    };
    render(<PersonalMemoryExtractionRunHistory service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByText("Interrupted")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("a run with completed_at null and a RECENT started_at renders In progress, not Interrupted", async () => {
    const service = {
      listRuns: vi.fn().mockResolvedValue([
        run({ completedAt: undefined, outcome: undefined, startedAt: new Date().toISOString() }),
      ]),
    };
    render(<PersonalMemoryExtractionRunHistory service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByText("In progress")).toBeInTheDocument();
  });

  it("Retry calls the injected triggerExtraction prop and refreshes the list", async () => {
    const listRuns = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([run()]);
    const triggerExtraction = vi.fn().mockResolvedValue(successResult());
    const onRunsChanged = vi.fn();
    render(<PersonalMemoryExtractionRunHistory service={{ listRuns }} triggerExtraction={triggerExtraction} onRunsChanged={onRunsChanged} />);

    await screen.findByText("No extraction runs yet.");
    await userEvent.click(screen.getByRole("button", { name: /check now/i }));

    await waitFor(() => expect(triggerExtraction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(2));
    expect(onRunsChanged).toHaveBeenCalledTimes(1);
  });

  it("a failed retry shows the failure message and does not call onRunsChanged", async () => {
    const listRuns = vi.fn().mockResolvedValue([]);
    const triggerExtraction = vi.fn().mockResolvedValue({ ok: false, code: "NO_SOURCE_MATERIAL", message: "Not enough recent activity." });
    const onRunsChanged = vi.fn();
    render(<PersonalMemoryExtractionRunHistory service={{ listRuns }} triggerExtraction={triggerExtraction} onRunsChanged={onRunsChanged} />);

    await screen.findByText("No extraction runs yet.");
    await userEvent.click(screen.getByRole("button", { name: /check now/i }));

    expect(await screen.findByText("Not enough recent activity.")).toBeInTheDocument();
    expect(onRunsChanged).not.toHaveBeenCalled();
  });
});
