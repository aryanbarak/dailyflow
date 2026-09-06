// @vitest-environment jsdom
//
// CORE-W3 (2026-09-06): the journal companion -- checkbox promotion,
// @ai runs, note listing/deletion, all explicit and injected.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JOURNAL_WATCHER_IDLE_MS, JournalCompanion } from "./JournalCompanion";

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

// CORE-W3b (2026-09-06): the watcher -- opt-in auto-run of @ai lines after
// a typing pause. Fake timers drive the idle window; the global localStorage
// shim lacks a full Storage surface, so it is stubbed with a memory one
// (pattern from smartflow-pointer-follower.test.tsx).
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  } as Storage;
}

function okRun(reply = "A calm, good day.") {
  return vi.fn(async (instruction: string) => ({
    ok: true as const,
    persisted: true,
    note: { id: `note-${instruction}`, instruction, reply, createdAt: "2026-09-06T10:00:00Z" },
  }));
}

describe("JournalCompanion watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", makeMemoryStorage());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  async function flush(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("does NOT auto-run by default -- the watcher is opt-in", async () => {
    const runInstruction = okRun();
    render(
      <JournalCompanion
        {...baseProps}
        content={"@ai summarize"}
        onCreateTask={vi.fn()}
        notesService={makeNotesService()}
        runInstruction={runInstruction}
      />,
    );
    await flush(JOURNAL_WATCHER_IDLE_MS * 3);
    expect(runInstruction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Run/ })).toBeInTheDocument();
  });

  it("auto-runs an @ai line after the idle window once enabled", async () => {
    const runInstruction = okRun();
    render(
      <JournalCompanion
        {...baseProps}
        content={"@ai summarize"}
        onCreateTask={vi.fn()}
        notesService={makeNotesService()}
        runInstruction={runInstruction}
      />,
    );
    await flush();
    fireEvent.click(screen.getByRole("switch"));
    await flush(JOURNAL_WATCHER_IDLE_MS);
    expect(runInstruction).toHaveBeenCalledTimes(1);
    expect(runInstruction).toHaveBeenCalledWith("summarize", "2026-09-06", "@ai summarize");
    expect(screen.getByText("A calm, good day.")).toBeInTheDocument();
  });

  it("every keystroke resets the idle window", async () => {
    const runInstruction = okRun();
    const props = {
      ...baseProps,
      onCreateTask: vi.fn(),
      notesService: makeNotesService(),
      runInstruction,
    };
    const { rerender } = render(<JournalCompanion {...props} content={"@ai summarize"} />);
    await flush();
    fireEvent.click(screen.getByRole("switch"));
    await flush(JOURNAL_WATCHER_IDLE_MS - 4000);
    rerender(<JournalCompanion {...props} content={"@ai summarize please"} />);
    await flush(JOURNAL_WATCHER_IDLE_MS - 4000);
    // 12s of total time, but never 10s of silence.
    expect(runInstruction).not.toHaveBeenCalled();
    await flush(4000);
    expect(runInstruction).toHaveBeenCalledTimes(1);
    expect(runInstruction).toHaveBeenCalledWith("summarize please", "2026-09-06", "@ai summarize please");
  });

  it("a failed auto-run never loops -- one attempt, manual Run still offered", async () => {
    const runInstruction = vi.fn(async () => ({
      ok: false as const,
      code: "PROVIDER_UNAVAILABLE" as const,
      message: "The AI model is temporarily unavailable.",
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
    await flush();
    fireEvent.click(screen.getByRole("switch"));
    await flush(JOURNAL_WATCHER_IDLE_MS * 5);
    expect(runInstruction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("button", { name: /Run/ })).toBeInTheDocument();
  });

  it("remembers the switch across mounts via localStorage", async () => {
    const first = render(
      <JournalCompanion
        {...baseProps}
        content={"@ai summarize"}
        onCreateTask={vi.fn()}
        notesService={makeNotesService()}
        runInstruction={okRun()}
      />,
    );
    await flush();
    fireEvent.click(screen.getByRole("switch"));
    first.unmount();

    const runInstruction = okRun();
    render(
      <JournalCompanion
        {...baseProps}
        content={"@ai summarize"}
        onCreateTask={vi.fn()}
        notesService={makeNotesService()}
        runInstruction={runInstruction}
      />,
    );
    await flush(JOURNAL_WATCHER_IDLE_MS);
    expect(runInstruction).toHaveBeenCalledTimes(1);
  });
});
