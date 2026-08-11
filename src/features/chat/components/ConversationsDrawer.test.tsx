// @vitest-environment jsdom
//
// SmartFlow -- task 17c, PO decision D4: "the search entry merges INTO the
// conversations drawer (search field at its top) -- no separate search
// row." This is the drawer's own local conversation-title filter (a NEW
// behavior this task adds), distinct from the app-wide GlobalSearch widget
// AppLayout.tsx no longer renders on this page.
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatSession } from "@/hooks/useChatSessions";
import { ConversationsDrawer } from "./ConversationsDrawer";

afterEach(() => {
  cleanup();
});

const sessions: ChatSession[] = [
  { id: "1", title: "Plan my week", updated_at: "2026-08-01T00:00:00.000Z" } as ChatSession,
  { id: "2", title: "Review finances", updated_at: "2026-08-02T00:00:00.000Z" } as ChatSession,
  { id: "3", title: "Study for exam", updated_at: "2026-08-03T00:00:00.000Z" } as ChatSession,
];

describe("ConversationsDrawer search (task 17c, D4)", () => {
  it("renders a search field at the top of the drawer", () => {
    render(
      <ConversationsDrawer
        open
        onOpenChange={vi.fn()}
        sessions={sessions}
        activeSessionId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("typing a query filters the visible conversation list by title (case-insensitive)", async () => {
    render(
      <ConversationsDrawer
        open
        onOpenChange={vi.fn()}
        sessions={sessions}
        activeSessionId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("Plan my week")).toBeInTheDocument();
    expect(screen.getByText("Review finances")).toBeInTheDocument();
    expect(screen.getByText("Study for exam")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "FINAN");

    expect(screen.queryByText("Plan my week")).not.toBeInTheDocument();
    expect(screen.getByText("Review finances")).toBeInTheDocument();
    expect(screen.queryByText("Study for exam")).not.toBeInTheDocument();
  });

  it("shows a no-match message when the query matches nothing, without crashing", async () => {
    render(
      <ConversationsDrawer
        open
        onOpenChange={vi.fn()}
        sessions={sessions}
        activeSessionId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByRole("searchbox"), "zzz-no-match");
    expect(screen.queryByText("Plan my week")).not.toBeInTheDocument();
    expect(screen.getByText(/no conversations match/i)).toBeInTheDocument();
  });
});
