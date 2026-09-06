// @vitest-environment jsdom
//
// CORE-W2 (2026-09-06): persona editor -- load, edit, save, error, all
// through the injectable service.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonaCard } from "./PersonaCard";

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "user-1" }, session: {}, isLoading: false }),
}));

// The card always receives an injected service here; the real module is
// mocked because importing it pulls in the Supabase client, whose env
// guard throws outside a configured environment.
vi.mock("./personaService", () => ({
  PERSONA_MAX_CHARS: 8000,
  personaService: { getPersona: vi.fn(), savePersona: vi.fn() },
}));

function makeService(overrides: Partial<{
  content: string;
  savePersona: (userId: string, content: string) => Promise<void>;
}> = {}) {
  return {
    getPersona: vi.fn(async () => overrides.content ?? ""),
    savePersona: vi.fn(overrides.savePersona ?? (async () => undefined)),
  };
}

describe("PersonaCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads and shows the existing document", async () => {
    render(<PersonaCard service={makeService({ content: "## Who I am\nDeveloper." })} />);
    const editor = await screen.findByRole("textbox", { name: "About me (persona)" });
    expect(editor).toHaveValue("## Who I am\nDeveloper.");
  });

  it("saves edits through the service and confirms", async () => {
    const service = makeService();
    render(<PersonaCard service={service} />);
    const editor = await screen.findByRole("textbox", { name: "About me (persona)" });
    await userEvent.type(editor, "Short answers only.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
    expect(service.savePersona).toHaveBeenCalledWith("user-1", "Short answers only.");
  });

  it("shows a readable error when saving fails", async () => {
    const service = makeService({
      savePersona: async () => {
        throw new Error("rls");
      },
    });
    render(<PersonaCard service={service} />);
    await screen.findByRole("textbox", { name: "About me (persona)" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Could not save. Please try again.")).toBeInTheDocument();
    });
  });
});
