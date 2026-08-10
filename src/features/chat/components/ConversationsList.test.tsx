// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationsList } from "./ConversationsList";
import type { ChatSession } from "@/hooks/useChatSessions";

afterEach(cleanup);

const sessions: ChatSession[] = [
  { id: "s1", title: "Study plan for IHK", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" },
  { id: "s2", title: "برنامه هفتگی", created_at: "2026-08-02T00:00:00Z", updated_at: "2026-08-02T00:00:00Z" },
];

describe("ConversationsList", () => {
  it("shows the empty-state message when there are no sessions", () => {
    render(<ConversationsList sessions={[]} activeSessionId={null} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
  });

  it("renders one entry per session, each with dir=auto for correct bidi rendering (task 11e)", () => {
    render(<ConversationsList sessions={sessions} activeSessionId={null} onSelect={vi.fn()} onDelete={vi.fn()} />);
    const titleParagraphs = document.querySelectorAll('p[dir="auto"]');
    expect(titleParagraphs.length).toBe(2);
  });

  it("clicking a session calls onSelect with its id", async () => {
    const onSelect = vi.fn();
    render(<ConversationsList sessions={sessions} activeSessionId={null} onSelect={onSelect} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByText("Study plan for IHK"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("clicking delete calls onDelete with the session id, using a localized (not hardcoded-English) aria-label", async () => {
    const onDelete = vi.fn();
    render(<ConversationsList sessions={sessions} activeSessionId={null} onSelect={vi.fn()} onDelete={onDelete} />);
    const deleteButtons = screen.getAllByRole("button", { name: /delete conversation/i });
    expect(deleteButtons).toHaveLength(2);
    await userEvent.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalledWith("s1");
  });
});
