// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalMemorySection } from "./PersonalMemorySection";
import type { PersonalMemoryRecord } from "../personalMemoryRecordTypes";
import type { PersonalMemoryExtractionTriggerResult } from "../personalMemoryExtractionTriggerClient";

afterEach(() => {
  cleanup();
});

function record(overrides: Partial<PersonalMemoryRecord> = {}): PersonalMemoryRecord {
  return {
    id: "record-1",
    ownerId: "owner-1",
    runId: "run-1",
    kind: "goal",
    content: { summary: "Learn React Native", timeframe: "long_term" },
    provenance: { sourceKind: "chat_turn", sourceReferenceIds: ["22222222-2222-4222-8222-222222222222"] },
    modelIdentity: "gemini",
    derivationVersion: "personal-memory-extraction-v1",
    confidence: "high",
    status: "proposed",
    source: "model",
    contentFingerprint: "a".repeat(64),
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeService(records: PersonalMemoryRecord[]) {
  return {
    listByOwner: vi.fn().mockResolvedValue(records),
    resolve: vi.fn(),
    remove: vi.fn(),
  };
}

function successResult(overrides: Partial<PersonalMemoryExtractionTriggerResult & { ok: true }> = {}): PersonalMemoryExtractionTriggerResult {
  return { ok: true, runId: "run-1", sourceItemCount: 4, candidateCount: 2, acceptedCount: 2, droppedCount: 0, ...overrides };
}

describe("PersonalMemorySection -- rendering states", () => {
  it("shows a proposed record as Proposed, with the Q5 zero-consumption help text and all actions available", async () => {
    const service = makeService([record({ status: "proposed", source: "model" })]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByText("Learn React Native")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
    expect(screen.getByText(/not used anywhere until you confirm it/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /correct/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("shows a plain-confirmed record (source=model) as Confirmed, with no confirm/correct/reject actions but Delete remains", async () => {
    const service = makeService([record({ status: "user_confirmed", source: "model" })]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("groups records by kind", async () => {
    const service = makeService([
      record({ id: "goal-1", kind: "goal", status: "proposed" }),
      record({ id: "skill-1", kind: "skill", status: "proposed", content: { summary: "Learning algorithms" } }),
    ]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByText("Goals")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
  });

  it("surfaces a load failure honestly", async () => {
    const service = { listByOwner: vi.fn().mockRejectedValue(new Error("boom")), resolve: vi.fn(), remove: vi.fn() };
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Personal memory could not be loaded.");
  });

  it("shows the empty state when there is nothing to show", async () => {
    const service = makeService([]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByText("No personal memory recorded yet.")).toBeInTheDocument();
  });
});

describe("PersonalMemorySection -- rejected visibility", () => {
  it("hides a rejected record by default, and shows it (with its help text, and only Delete) behind the toggle", async () => {
    const user = userEvent.setup();
    const service = makeService([
      record({ id: "rej", status: "user_rejected", content: { summary: "Rejected fact" } }),
      record({ id: "prop", status: "proposed" }),
    ]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    await screen.findByText("Learn React Native");
    expect(screen.queryByText("Rejected fact")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show rejected/i }));

    expect(await screen.findByText("Rejected fact")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText(/still prevents this same fact from being suggested again/i)).toBeInTheDocument();
    const rejectedCard = screen.getByText("Rejected fact").closest("li") as HTMLElement;
    expect(within(rejectedCard).queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    expect(within(rejectedCard).getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });
});

describe("PersonalMemorySection -- corrected/original history affordance", () => {
  it("never renders the pre-correction original or a superseded record as their own list entry", async () => {
    const service = makeService([
      record({ id: "orig", status: "user_corrected", source: "model", content: { summary: "Original summary" } }),
      record({ id: "sup", status: "superseded", content: { summary: "Superseded summary" } }),
    ]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());
    expect(await screen.findByText("No personal memory recorded yet.")).toBeInTheDocument();
    expect(screen.queryByText("Original summary")).not.toBeInTheDocument();
    expect(screen.queryByText("Superseded summary")).not.toBeInTheDocument();
  });

  it("reveals the pre-correction original only via the correction's 'View original' affordance, read-only and clearly labeled", async () => {
    const user = userEvent.setup();
    const service = makeService([
      record({ id: "orig", status: "user_corrected", source: "model", content: { summary: "Original summary" } }),
      record({ id: "corr", status: "user_confirmed", source: "user", supersedesId: "orig", content: { summary: "Corrected summary" } }),
    ]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByText("Corrected summary")).toBeInTheDocument();
    expect(screen.queryByText("Original summary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /view original/i }));

    expect(await screen.findByText("Original summary")).toBeInTheDocument();
    expect(screen.getByText(/superseded by your correction/i)).toBeInTheDocument();
  });
});

describe("PersonalMemorySection -- confirm/reject/correct flows", () => {
  it("confirms a record, then reloads the list and notifies the caller", async () => {
    const user = userEvent.setup();
    const service = makeService([record({ status: "proposed" })]);
    service.resolve.mockResolvedValue({ outcome: "user_confirmed", record: record({ status: "user_confirmed", source: "model" }) });
    const onRecordsChanged = vi.fn();

    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} onRecordsChanged={onRecordsChanged} />);
    await screen.findByText("Learn React Native");

    await user.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(service.resolve).toHaveBeenCalledWith({ recordId: "record-1", action: "confirm" }));
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalledTimes(2));
    expect(onRecordsChanged).toHaveBeenCalled();
  });

  it("rejects a record", async () => {
    const user = userEvent.setup();
    const service = makeService([record({ status: "proposed" })]);
    service.resolve.mockResolvedValue({ outcome: "user_rejected", record: record({ status: "user_rejected" }) });

    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);
    await screen.findByText("Learn React Native");

    await user.click(screen.getByRole("button", { name: /^reject$/i }));

    await waitFor(() => expect(service.resolve).toHaveBeenCalledWith({ recordId: "record-1", action: "reject" }));
  });

  it("shows a per-record error and keeps the record actionable when resolve fails", async () => {
    const user = userEvent.setup();
    const service = makeService([record({ status: "proposed" })]);
    service.resolve.mockRejectedValue(new Error("Only a still-proposed record can be resolved."));

    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);
    await screen.findByText("Learn React Native");

    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Only a still-proposed record can be resolved.");
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
  });

  it("opens the correction form pre-filled, rejects invalid input via the canonical validator (never calling resolve), then submits valid corrected content that replaces the display entry", async () => {
    const user = userEvent.setup();
    const original = record({ status: "proposed", kind: "goal", content: { summary: "Learn React Native", timeframe: "long_term" } });
    const corrected = record({ id: "record-2", status: "user_confirmed", source: "user", supersedesId: "record-1", content: { summary: "Learn TypeScript" } });
    const service = makeService([original]);
    service.resolve.mockResolvedValue({ outcome: "user_corrected", record: corrected });
    // The list reload after a successful correction reflects the backend's
    // new state (the corrected row replacing the original) -- simulated
    // here by queuing a second listByOwner() resolution distinct from the
    // first, since the fake service has no real persistence of its own.
    service.listByOwner.mockResolvedValueOnce([original]).mockResolvedValueOnce([corrected]);

    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);
    await screen.findByText("Learn React Native");

    await user.click(screen.getByRole("button", { name: /correct/i }));

    const summaryInput = await screen.findByLabelText(/Summary/);
    expect(summaryInput).toHaveValue("Learn React Native");

    // Clear the required summary field -- the canonical validator must reject this client-side, before any resolve() call.
    await user.clear(summaryInput);
    await user.click(screen.getByRole("button", { name: /submit correction/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/summary/i);
    expect(service.resolve).not.toHaveBeenCalled();

    await user.type(summaryInput, "Learn TypeScript");
    await user.click(screen.getByRole("button", { name: /submit correction/i }));

    await waitFor(() =>
      expect(service.resolve).toHaveBeenCalledWith({
        recordId: "record-1",
        action: "correct",
        correctedContent: { summary: "Learn TypeScript", timeframe: "long_term" },
      }),
    );
    expect(await screen.findByText("Learn TypeScript")).toBeInTheDocument();
  });
});

describe("PersonalMemorySection -- delete (ADR-0010 Q1: any status, no exceptions)", () => {
  it("shows a confirmation dialog with honest re-extraction copy before deleting a proposed record, and does nothing on Cancel", async () => {
    const user = userEvent.setup();
    const service = makeService([record({ status: "proposed" })]);

    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);
    await screen.findByText("Learn React Native");

    await user.click(screen.getByRole("button", { name: /delete/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: /delete this memory/i })).toBeInTheDocument();
    const description = dialog.querySelector("p");
    expect(description).toHaveTextContent(/permanently delete/i);
    expect(description).toHaveTextContent(/re-extracted and proposed again/i);

    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it("deletes a proposed record on confirmation, then reloads the list and notifies the caller", async () => {
    const user = userEvent.setup();
    const service = makeService([record({ id: "record-1", status: "proposed" })]);
    service.remove.mockResolvedValue({ outcome: "deleted", id: "record-1" });
    const onRecordsChanged = vi.fn();

    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} onRecordsChanged={onRecordsChanged} />);
    await screen.findByText("Learn React Native");

    await user.click(screen.getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(service.remove).toHaveBeenCalledWith("record-1"));
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalledTimes(2));
    expect(onRecordsChanged).toHaveBeenCalled();
  });

  it("deletes a rejected record too -- delete is status-independent", async () => {
    const user = userEvent.setup();
    const service = makeService([record({ id: "rej", status: "user_rejected", content: { summary: "Rejected fact" } })]);
    service.remove.mockResolvedValue({ outcome: "deleted", id: "rej" });

    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /show rejected/i }));
    await screen.findByText("Rejected fact");

    await user.click(screen.getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(service.remove).toHaveBeenCalledWith("rej"));
  });
});

describe("PersonalMemorySection -- extraction trigger", () => {
  it("shows an in-progress state while the extraction run is pending", async () => {
    const user = userEvent.setup();
    const service = makeService([]);
    let resolveTrigger: (result: PersonalMemoryExtractionTriggerResult) => void = () => {};
    const triggerExtraction = vi.fn().mockImplementation(
      () => new Promise<PersonalMemoryExtractionTriggerResult>((resolve) => { resolveTrigger = resolve; }),
    );

    render(<PersonalMemorySection service={service} triggerExtraction={triggerExtraction} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /check for new personal memory/i }));

    expect(screen.getByRole("button", { name: /checking/i })).toBeDisabled();
    resolveTrigger(successResult());
    await waitFor(() => expect(screen.queryByRole("button", { name: /checking/i })).not.toBeInTheDocument());
  });

  it("renders a 422 NO_SOURCE_MATERIAL failure as an honest, human-readable message", async () => {
    const user = userEvent.setup();
    const service = makeService([]);
    const triggerExtraction = vi.fn().mockResolvedValue({
      ok: false,
      code: "NO_SOURCE_MATERIAL",
      message: "No chat messages or briefings exist yet to extract personal memory from.",
    } satisfies PersonalMemoryExtractionTriggerResult);

    render(<PersonalMemorySection service={service} triggerExtraction={triggerExtraction} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /check for new personal memory/i }));

    expect(await screen.findByText(/not enough recent activity to extract from yet/i)).toBeInTheDocument();
  });

  it("reloads the list and notifies the caller after a successful extraction, showing an accepted/dropped summary", async () => {
    const user = userEvent.setup();
    const service = makeService([]);
    const triggerExtraction = vi.fn().mockResolvedValue(successResult({ acceptedCount: 2, droppedCount: 1 }));
    const onRecordsChanged = vi.fn();

    render(<PersonalMemorySection service={service} triggerExtraction={triggerExtraction} onRecordsChanged={onRecordsChanged} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /check for new personal memory/i }));

    await waitFor(() => expect(service.listByOwner).toHaveBeenCalledTimes(2));
    expect(onRecordsChanged).toHaveBeenCalled();
    expect(await screen.findByText(/Extraction complete: 2 accepted, 1 dropped\./)).toBeInTheDocument();
  });

  it("task 12: a successful extraction with zero accepted candidates renders a calm 'no new facts' message, not the accepted/dropped breakdown and never an error style", async () => {
    const user = userEvent.setup();
    const service = makeService([]);
    const triggerExtraction = vi.fn().mockResolvedValue(successResult({ candidateCount: 0, acceptedCount: 0, droppedCount: 0 }));

    render(<PersonalMemorySection service={service} triggerExtraction={triggerExtraction} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /check for new personal memory/i }));

    expect(await screen.findByText("No new personal memory found.")).toBeInTheDocument();
    expect(screen.queryByText(/accepted,/)).not.toBeInTheDocument();
    // Rendered via the same role="status" element the accepted/dropped
    // summary uses -- calm, not role="alert" the way loadError/recordErrors
    // render.
    expect(screen.getByRole("status")).toHaveTextContent("No new personal memory found.");
  });
});
