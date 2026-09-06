// @vitest-environment jsdom
//
// CORE audit item 1-3 -- DaySection wiring: correct date key threaded to
// the editor/companion, and the today indicator.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DaySection } from "./DaySection";

// Both pull in the Supabase client at import time (via useJournalEntry /
// journalAiNotesService); stub with lightweight stand-ins that surface
// the props under test, same convention as JournalCompanion.test.tsx.
vi.mock("@/features/journal/components/JournalEditor", () => ({
  JournalEditor: ({ date }: { date: string }) => <div data-testid="journal-editor">{date}</div>,
}));
vi.mock("@/features/journal/components/JournalCompanion", () => ({
  JournalCompanion: ({ date }: { date: string }) => <div data-testid="journal-companion">{date}</div>,
}));

afterEach(() => {
  cleanup();
});

const baseProps = {
  userId: "user-1",
  tasks: [] as Array<{ title: string; completed: boolean }>,
  onCreateTask: vi.fn(),
};

describe("DaySection", () => {
  it("threads the same UTC-slice date key to both the editor and the companion", () => {
    const date = new Date("2026-09-06T12:00:00.000Z");
    const today = new Date("2026-09-06T12:00:00.000Z");
    render(<DaySection {...baseProps} date={date} today={today} />);
    expect(screen.getByTestId("journal-editor")).toHaveTextContent("2026-09-06");
    expect(screen.getByTestId("journal-companion")).toHaveTextContent("2026-09-06");
  });

  it("renders a localized weekday/month/day header", () => {
    const date = new Date("2026-09-06T12:00:00.000Z");
    render(<DaySection {...baseProps} date={date} today={date} />);
    expect(screen.getByText(/September/)).toBeInTheDocument();
  });

  it("shows the today marker only when the date matches the shared 'today'", () => {
    const today = new Date("2026-09-06T12:00:00.000Z");
    const { rerender, container } = render(
      <DaySection {...baseProps} date={today} today={today} />,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent("•");
    expect(container.querySelector(".border-primary")).not.toBeNull();

    rerender(<DaySection {...baseProps} date={new Date("2026-09-07T12:00:00.000Z")} today={today} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector(".border-primary")).toBeNull();
  });

  it("has a stable, key-scoped test id for the parent scroll container to target", () => {
    const date = new Date("2026-09-06T12:00:00.000Z");
    render(<DaySection {...baseProps} date={date} today={date} />);
    expect(screen.getByTestId("day-section-2026-09-06")).toBeInTheDocument();
  });
});
