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
    confirmUpdate: vi.fn(),
  };
}

function successResult(overrides: Partial<PersonalMemoryExtractionTriggerResult & { ok: true }> = {}): PersonalMemoryExtractionTriggerResult {
  return { ok: true, runId: "run-1", sourceItemCount: 4, candidateCount: 2, acceptedCount: 2, droppedCount: 0, outcome: "completed", ...overrides };
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
    const service = { listByOwner: vi.fn().mockRejectedValue(new Error("boom")), resolve: vi.fn(), remove: vi.fn(), confirmUpdate: vi.fn() };
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Personal memory could not be loaded.");
  });

  it("shows the empty state when there is nothing to show", async () => {
    const service = makeService([]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByText("No personal memory recorded yet.")).toBeInTheDocument();
  });

  it("task 11e: a memory card with a mixed Persian/Latin title gets dir=\"auto\" and isolates the embedded Latin token, instead of rendering it as one undifferentiated text node", async () => {
    const service = makeService([
      record({ status: "proposed", content: { summary: "می‌خواهد با SmartFlow کار کند", timeframe: "long_term" } }),
    ]);
    const { container } = render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    await waitFor(() => expect(container.querySelector('p[dir="auto"]')).not.toBeNull());
    const titleParagraph = container.querySelector('p[dir="auto"]');
    expect(titleParagraph?.innerHTML).toContain("<bdi>SmartFlow</bdi>");
    expect(titleParagraph?.textContent).toBe("می‌خواهد با SmartFlow کار کند");
  });
});

// Task 16 (Document-Sourced Memory slice 1): the source line for a
// document-sourced record -- live-resolved chunk info first, falling back
// to the record's own provenanceSnapshot when the live resolver doesn't
// have it (chunk deleted by re-extraction or a document hard-delete).
//
// The source line's text is split across multiple <bdi> elements by the
// 11e bidi utility (isolateEmbeddedBidiRuns), so a plain string passed to
// getByText/findByText cannot match it -- DOM Testing Library's own
// documented limitation ("text is broken up by multiple elements"). These
// tests instead locate the source-line <p> directly and assert its full
// textContent, which is exactly what a real user visually reads.
describe("PersonalMemorySection -- document provenance source line (task 16)", () => {
  const CHUNK_ID = "77777777-7777-4777-8777-777777777777";
  const SOURCE_LINE_SELECTOR = 'p[dir="auto"].italic';

  function documentSourcedRecord(overrides: Partial<PersonalMemoryRecord> = {}): PersonalMemoryRecord {
    return record({
      kind: "skill",
      content: { summary: "Senior software engineering experience", level: "advanced" },
      provenance: { sourceKind: "document", sourceReferenceIds: [CHUNK_ID] },
      ...overrides,
    });
  }

  it("renders the live-resolved file name and section label with the AI-transcription qualifier", async () => {
    const service = makeService([documentSourcedRecord()]);
    const resolveDocumentSources = vi.fn().mockResolvedValue({ [CHUNK_ID]: { fileName: "resume.pdf", sectionLabel: "Experience" } });

    const { container } = render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} resolveDocumentSources={resolveDocumentSources} />);

    await waitFor(() => expect(container.querySelector(SOURCE_LINE_SELECTOR)).not.toBeNull());
    expect(container.querySelector(SOURCE_LINE_SELECTOR)?.textContent).toBe("resume.pdf — Experience (via AI transcription)");
    expect(resolveDocumentSources).toHaveBeenCalledWith([CHUNK_ID]);
  });

  it("falls back to the record's own provenanceSnapshot when the live resolver does not have the chunk (deleted)", async () => {
    const service = makeService([
      documentSourcedRecord({
        provenanceSnapshot: [{ chunkId: CHUNK_ID, fileName: "old-resume.pdf", sectionLabel: "Skills", contentExcerpt: "TypeScript, Postgres." }],
      }),
    ]);
    const resolveDocumentSources = vi.fn().mockResolvedValue({}); // live join misses -- chunk was deleted

    const { container } = render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} resolveDocumentSources={resolveDocumentSources} />);

    await waitFor(() => expect(container.querySelector(SOURCE_LINE_SELECTOR)).not.toBeNull());
    expect(container.querySelector(SOURCE_LINE_SELECTOR)?.textContent).toBe("old-resume.pdf — Skills (via AI transcription)");
  });

  it("renders no source line at all for a chat-sourced record (unchanged behavior)", async () => {
    const service = makeService([record({ provenance: { sourceKind: "chat_turn", sourceReferenceIds: ["22222222-2222-4222-8222-222222222222"] } })]);
    const resolveDocumentSources = vi.fn().mockResolvedValue({});

    const { container } = render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} resolveDocumentSources={resolveDocumentSources} />);

    await screen.findByText("Learn React Native");
    expect(resolveDocumentSources).not.toHaveBeenCalled();
    expect(container.querySelector(SOURCE_LINE_SELECTOR)).toBeNull();
  });

  it("mixed-direction file name: isolates an embedded Latin run inside the source line via the 11e bidi utility", async () => {
    const service = makeService([documentSourcedRecord()]);
    const resolveDocumentSources = vi.fn().mockResolvedValue({ [CHUNK_ID]: { fileName: "رزومه SmartFlow.pdf", sectionLabel: "Experience" } });

    const { container } = render(
      <PersonalMemorySection service={service} triggerExtraction={vi.fn()} resolveDocumentSources={resolveDocumentSources} />,
    );

    await waitFor(() => expect(container.querySelector(SOURCE_LINE_SELECTOR)).not.toBeNull());
    const sourceParagraph = container.querySelector(SOURCE_LINE_SELECTOR);
    expect(sourceParagraph?.innerHTML).toContain("<bdi>SmartFlow.pdf</bdi>");
    expect(sourceParagraph?.textContent).toBe("رزومه SmartFlow.pdf — Experience (via AI transcription)");
  });

  it("gracefully renders no source line (never an error) when resolveDocumentSources is omitted entirely", async () => {
    const service = makeService([documentSourcedRecord()]);

    const { container } = render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    await screen.findByText("Senior software engineering experience");
    expect(container.querySelector(SOURCE_LINE_SELECTOR)).toBeNull();
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

  it("reveals the pre-correction original only via the correction's 'Previous versions' affordance, read-only and clearly labeled", async () => {
    const user = userEvent.setup();
    const service = makeService([
      record({ id: "orig", status: "user_corrected", source: "model", content: { summary: "Original summary" } }),
      record({ id: "corr", status: "user_confirmed", source: "user", supersedesId: "orig", content: { summary: "Corrected summary" } }),
    ]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    expect(await screen.findByText("Corrected summary")).toBeInTheDocument();
    expect(screen.queryByText("Original summary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /previous versions/i }));

    expect(await screen.findByText("Original summary")).toBeInTheDocument();
    expect(screen.getByText("Previous version")).toBeInTheDocument();
  });
});

// Task 18, B2: an overlap-detected candidate (possibleUpdateOfId resolved
// to a live existing record by groupVisiblePersonalMemoryRecords) is
// presented as an UPDATE -- existing value struck through, proposed value
// below it -- with the same Confirm/Correct/Reject/Delete verbs, but
// Confirm calls service.confirmUpdate (atomic), never service.resolve.
describe("PersonalMemorySection -- update-candidate presentation (task 18, B2)", () => {
  it("shows the existing value (struck through) and the proposed value for an update candidate, not a plain proposal", async () => {
    const existing = record({ id: "existing", kind: "skill", status: "user_confirmed", source: "model", content: { summary: "TypeScript", level: "intermediate" } });
    const candidate = record({ id: "candidate", kind: "skill", status: "proposed", source: "model", possibleUpdateOfId: "existing", content: { summary: "TypeScript", level: "advanced" } });
    const service = makeService([existing, candidate]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);

    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());
    expect(await screen.findByText("This looks like an update to the record above.")).toBeInTheDocument();
    expect(screen.getByText(/TypeScript — Level: intermediate/)).toBeInTheDocument();
    expect(screen.getByText(/TypeScript — Level: advanced/)).toBeInTheDocument();
  });

  it("Confirm on an update candidate calls service.confirmUpdate with the candidate and target ids, never service.resolve", async () => {
    const user = userEvent.setup();
    const existing = record({ id: "existing", kind: "skill", status: "user_confirmed", source: "model", content: { summary: "TypeScript", level: "intermediate" } });
    const candidate = record({ id: "candidate", kind: "skill", status: "proposed", source: "model", possibleUpdateOfId: "existing", content: { summary: "TypeScript", level: "advanced" } });
    const service = makeService([existing, candidate]);
    service.confirmUpdate.mockResolvedValue({
      outcome: "update_confirmed",
      candidate: { ...candidate, status: "user_confirmed", supersedesId: "existing" },
      superseded: { ...existing, status: "superseded", supersededById: "candidate", supersededAt: "2026-08-12T00:00:00.000Z" },
    });
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());

    const confirmButtons = await screen.findAllByRole("button", { name: /confirm/i });
    await user.click(confirmButtons[0]);

    await waitFor(() => expect(service.confirmUpdate).toHaveBeenCalledWith({ candidateRecordId: "candidate", supersededRecordId: "existing" }));
    expect(service.resolve).not.toHaveBeenCalled();
  });

  it("Reject on an update candidate calls the normal reject flow (service.resolve) -- the suggested target is never touched", async () => {
    const user = userEvent.setup();
    const existing = record({ id: "existing", kind: "skill", status: "user_confirmed", source: "model", content: { summary: "TypeScript", level: "intermediate" } });
    const candidate = record({ id: "candidate", kind: "skill", status: "proposed", source: "model", possibleUpdateOfId: "existing", content: { summary: "TypeScript", level: "advanced" } });
    const service = makeService([existing, candidate]);
    service.resolve.mockResolvedValue({ outcome: "user_rejected", record: { ...candidate, status: "user_rejected" } });
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());

    // Exact match, not /reject/i -- the toolbar's own "Hide rejected"/"Show
    // rejected" toggle button also matches a loose "reject" substring.
    const rejectButtons = await screen.findAllByRole("button", { name: "Reject" });
    await user.click(rejectButtons[0]);

    await waitFor(() => expect(service.resolve).toHaveBeenCalledWith({ recordId: "candidate", action: "reject" }));
    expect(service.confirmUpdate).not.toHaveBeenCalled();
  });

  it("a plain proposal (no possibleUpdateOfId) still Confirms via the normal resolve flow, unaffected by the update-candidate feature", async () => {
    const user = userEvent.setup();
    const plain = record({ id: "plain", status: "proposed" });
    const service = makeService([plain]);
    service.resolve.mockResolvedValue({ outcome: "user_confirmed", record: { ...plain, status: "user_confirmed" } });
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());

    await user.click(await screen.findByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(service.resolve).toHaveBeenCalledWith({ recordId: "plain", action: "confirm" }));
    expect(service.confirmUpdate).not.toHaveBeenCalled();
  });

  it("a proposed record whose possibleUpdateOfId points at a NOT-loaded record renders as a plain proposal (no crash, no diff view)", async () => {
    const candidate = record({ id: "candidate", status: "proposed", possibleUpdateOfId: "not-loaded-anywhere" });
    const service = makeService([candidate]);
    render(<PersonalMemorySection service={service} triggerExtraction={vi.fn()} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());

    expect(await screen.findByText("Learn React Native")).toBeInTheDocument();
    expect(screen.queryByText("This looks like an update to the record above.")).not.toBeInTheDocument();
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

  it("task 14: renders PROVIDER_REQUEST_REJECTED with its own distinct message, not the generic 'model did not return a usable extraction'", async () => {
    const user = userEvent.setup();
    const service = makeService([]);
    const triggerExtraction = vi.fn().mockResolvedValue({
      ok: false,
      code: "PROVIDER_REQUEST_REJECTED",
      message: "The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your data.",
    } satisfies PersonalMemoryExtractionTriggerResult);

    render(<PersonalMemorySection service={service} triggerExtraction={triggerExtraction} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /check for new personal memory/i }));

    expect(await screen.findByText(/the request to the ai model was rejected/i)).toBeInTheDocument();
  });

  it("task 14: renders PROVIDER_UNAVAILABLE with its own distinct message", async () => {
    const user = userEvent.setup();
    const service = makeService([]);
    const triggerExtraction = vi.fn().mockResolvedValue({
      ok: false,
      code: "PROVIDER_UNAVAILABLE",
      message: "The AI model is temporarily unavailable. Please try again in a moment.",
    } satisfies PersonalMemoryExtractionTriggerResult);

    render(<PersonalMemorySection service={service} triggerExtraction={triggerExtraction} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /check for new personal memory/i }));

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
  });

  it("task 14: renders MODEL_OUTPUT_UNUSABLE with its own distinct message (this is the ONLY taxonomy code that keeps the old wording, since it's the only case that genuinely matches it -- a real model output that failed validation)", async () => {
    const user = userEvent.setup();
    const service = makeService([]);
    const triggerExtraction = vi.fn().mockResolvedValue({
      ok: false,
      code: "MODEL_OUTPUT_UNUSABLE",
      message: "The model did not return a usable extraction. Please try again.",
    } satisfies PersonalMemoryExtractionTriggerResult);

    render(<PersonalMemorySection service={service} triggerExtraction={triggerExtraction} />);
    await waitFor(() => expect(service.listByOwner).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /check for new personal memory/i }));

    expect(await screen.findByText(/did not return a usable extraction/i)).toBeInTheDocument();
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
