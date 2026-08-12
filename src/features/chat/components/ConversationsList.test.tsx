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

  // Task 17f, B3: dir is now an EXPLICIT rtl/ltr computed per-item from
  // the title's own content (resolveMessageBaseDirection), not a bare
  // dir="auto" -- a bare dir="auto" suffered the same task-17e-class leak
  // as chat bubbles for a pure single-language title. Each title's dir
  // matches ITS OWN first-strong character, independent of the others.
  it("renders one entry per session, each with an EXPLICIT per-item dir derived from that title's own content (task 17f, B3)", () => {
    render(<ConversationsList sessions={sessions} activeSessionId={null} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(document.querySelector('p[dir="ltr"]')?.textContent).toBe("Study plan for IHK");
    expect(document.querySelector('p[dir="rtl"]')?.textContent).toBe("برنامه هفتگی");
    expect(document.querySelectorAll("p[dir]").length).toBe(2);
  });

  it("truncates using a logical text-start alignment, never a hardcoded text-left (task 17f, B3 -- text-left was defeating truncate's own per-direction ellipsis placement)", () => {
    const { container } = render(
      <ConversationsList sessions={sessions} activeSessionId={null} onSelect={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.innerHTML).not.toMatch(/\btext-left\b/);
    expect(container.querySelectorAll(".text-start").length).toBe(2);
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
