// @vitest-environment jsdom
//
// CORE-W3 (2026-09-06): the journal companion -- checkbox promotion,
// @ai runs, note listing/deletion, all explicit and injected.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JournalCompanion } from "./JournalCompanion";

// Both pull in the Supabase client at import time; tests always inject.
vi.mock("../journalAiNotesService", () => ({
  journalAiNotesService: { listByDate: vi.fn(), delete: vi.fn() },
}));
vi.mock("../journalAssistantClient", () => ({
  runJournalInstruction: vi.fn(),
}));

function makeNotesService(notes: Array<{ id: string; instruction: string; reply: string; createdAt: string }> = []) {
  return {
    listByDate: vi.fn(async () => notes),
    delete: vi.fn(async () => undefined),
  };
}

const baseProps = {
  userId: "user-1",
  date: "2026-09-06",
  tasks: [] as Array<{ title: string; completed: boolean }>,
};

describe("JournalCompanion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when the draft has no checkboxes, no @ai lines, and no saved notes", async () => {
    const notesService = makeNotesService();
    const { container } = render(
      <JournalCompanion {...baseProps} content="یک روز معمولی" onCreateTask={vi.fn()} notesService={notesService} runInstruction={vi.fn()} />,
    );
    await waitFor(() => expect(notesService.listByDate).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("promotes a detected checkbox to a task on click and removes the chip", async () => {
    const onCreateTask = vi.fn(async () => ({}));
    render(
      <JournalCompanion
        {...baseProps}
        content={"روز خوبی بود\n- [ ] خرید شیر"}
        onCreateTask={onCreateTask}
        notesService={makeNotesService()}
        runInstruction={vi.fn()}
      />,
    );
    expect(await screen.findByText("خرید شیر")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Make task/ }));
    await waitFor(() => expect(screen.queryByText("خرید شیر")).toBeNull());
    expect(onCreateTask).toHaveBeenCalledWith({ title: "خرید شیر", notes: "From journal 2026-09-06" });
  });

  it("does not suggest a checkbox whose title already exists as an open task", async () => {
    const notesService = makeNotesService();
    render(
      <JournalCompanion
        {...baseProps}
        tasks={[{ title: "خرید شیر", completed: false }]}
        content={"- [ ] خرید شیر"}
        onCreateTask={vi.fn()}
        notesService={notesService}
        runInstruction={vi.fn()}
      />,
    );
    await waitFor(() => expect(notesService.listByDate).toHaveBeenCalled());
    expect(screen.queryByText(/Make task/)).toBeNull();
  });

  it("runs an @ai instruction on click and shows the saved reply", async () => {
    const runInstruction = vi.fn(async () => ({
      ok: true as const,
      persisted: true,
      note: { id: "note-1", instruction: "summarize", reply: "A calm, good day.", createdAt: "2026-09-06T10:00:00Z" },
    }));
    render(
      <JournalCompanion
        {...baseProps}
        content={"@ai summarize"}
        onCreateTask={vi.fn()}
        notesService={makeNotesService()}
        runInstruction={runInstruction}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Run/ }));
    expect(await screen.findByText("A calm, good day.")).toBeInTheDocument();
    expect(runInstruction).toHaveBeenCalledWith("summarize", "2026-09-06", "@ai summarize");
    // The answered instruction no longer offers a Run button.
    expect(screen.queryByRole("button", { name: /Run/ })).toBeNull();
  });

  it("surfaces the error message when a run fails", async () => {
    const runInstruction = vi.fn(async () => ({
      ok: false as const,
      code: "PROVIDER_UNAVAILABLE" as const,
      message: "The AI model is temporarily unavailable. Please try again in a moment.",
    }));
    render(
      <JournalCompanion
        {...baseProps}
        content={"@ai summarize"}
        onCreateTask={vi.fn()}
        notesService={makeNotesService()}
        runInstruction={runInstruction}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Run/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("temporarily unavailable");
  });

  it("lists persisted notes for the date and deletes one", async () => {
    const notesService = makeNotesService([
      { id: "note-1", instruction: "summarize", reply: "Saved reply.", createdAt: "2026-09-06T10:00:00Z" },
    ]);
    render(
      <JournalCompanion {...baseProps} content="" onCreateTask={vi.fn()} notesService={notesService} runInstruction={vi.fn()} />,
    );
    expect(await screen.findByText("Saved reply.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete note" }));
    await waitFor(() => expect(screen.queryByText("Saved reply.")).toBeNull());
    expect(notesService.delete).toHaveBeenCalledWith("note-1");
  });
});
