// @vitest-environment jsdom
//
// Conversation Quality v1 (task 9), tutor topic liberation: the four
// suggestion chips still work exactly as before, and a free-typed topic is
// now first-class -- typing a topic and submitting calls the same `setMode`
// the chips already call, with the typed string instead of a canonical
// value (see the design note).

import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(() => {
  cleanup();
});

const setMode = vi.fn();
let mockMode = "fiae_algorithms";

vi.mock("@/hooks/useLearnAI", () => ({
  useLearnAI: () => ({
    messages: [],
    isLoading: false,
    error: null,
    mode: mockMode,
    language: "auto",
    setMode,
    setLanguage: vi.fn(),
    sendMessage: vi.fn(),
    clearLocalView: vi.fn(),
    reload: vi.fn(),
    attachedFile: null,
    attachFile: vi.fn(),
    isProcessingFile: false,
  }),
}));

import LearnAIPage from "./LearnAIPage";

describe("LearnAIPage -- topic chips + free-topic input", () => {
  it("clicking a suggestion chip calls setMode with the canonical value, unchanged", async () => {
    const user = userEvent.setup();
    render(<LearnAIPage />);

    await user.click(screen.getByRole("button", { name: "WISO" }));
    expect(setMode).toHaveBeenCalledWith("wiso");
  });

  it("typing a free topic and pressing Enter calls setMode with the typed string", async () => {
    const user = userEvent.setup();
    render(<LearnAIPage />);

    const input = screen.getByLabelText("Custom study topic");
    await user.type(input, "Kubernetes networking{enter}");
    expect(setMode).toHaveBeenCalledWith("Kubernetes networking");
  });

  it("typing a free topic and clicking 'Use topic' calls setMode with the typed string", async () => {
    const user = userEvent.setup();
    render(<LearnAIPage />);

    const input = screen.getByLabelText("Custom study topic");
    await user.type(input, "Graph traversal");
    await user.click(screen.getByRole("button", { name: "Use topic" }));
    expect(setMode).toHaveBeenCalledWith("Graph traversal");
  });

  it("an empty free-topic submission never calls setMode with an empty string", async () => {
    const user = userEvent.setup();
    render(<LearnAIPage />);

    await user.click(screen.getByRole("button", { name: "Use topic" }));
    expect(setMode).not.toHaveBeenCalledWith("");
  });

  it("a legacy stored mode value (one of the four canonical topics) loads and highlights its own chip, not the free-text input", () => {
    mockMode = "planner";
    render(<LearnAIPage />);
    expect(screen.queryByText(/current topic:/i)).not.toBeInTheDocument();
    mockMode = "fiae_algorithms";
  });

  it("a previously-set custom topic (not one of the four) shows as the current topic", () => {
    mockMode = "Graph traversal";
    render(<LearnAIPage />);
    expect(screen.getByText("Current topic: Graph traversal")).toBeInTheDocument();
    mockMode = "fiae_algorithms";
  });
});
