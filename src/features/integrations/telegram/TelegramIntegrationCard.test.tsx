// @vitest-environment jsdom
//
// CORE-W1 (2026-09-06): Telegram integration card -- status load, code
// generation flow, and disconnect, all through the injectable service.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TelegramIntegrationCard } from "./TelegramIntegrationCard";

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "user-1" }, session: {}, isLoading: false }),
}));

// The card always receives an injected service in these tests; the real
// module is mocked because merely importing it pulls in the Supabase
// client, whose env guard throws outside a configured environment.
vi.mock("./telegramLinkService", () => ({
  TELEGRAM_LINK_CODE_TTL_MINUTES: 10,
  telegramLinkService: {
    createLinkCode: vi.fn(),
    getStatus: vi.fn(),
    unlink: vi.fn(),
  },
}));

function makeService(overrides: Partial<{
  linked: boolean;
  createLinkCode: () => Promise<string>;
  unlink: () => Promise<void>;
}> = {}) {
  return {
    getStatus: vi.fn(async () => ({ linked: overrides.linked ?? false })),
    createLinkCode: vi.fn(overrides.createLinkCode ?? (async () => "ABCD2345")),
    unlink: vi.fn(overrides.unlink ?? (async () => undefined)),
  };
}

describe("TelegramIntegrationCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the unlinked state with a generate button", async () => {
    render(<TelegramIntegrationCard service={makeService()} />);
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate link code" })).toBeInTheDocument();
  });

  it("generates and displays a /link code on click", async () => {
    const service = makeService();
    render(<TelegramIntegrationCard service={service} />);
    const button = await screen.findByRole("button", { name: "Generate link code" });
    await userEvent.click(button);
    await waitFor(() => {
      expect(screen.getByText("/link ABCD2345")).toBeInTheDocument();
    });
    expect(service.createLinkCode).toHaveBeenCalledWith("user-1");
  });

  it("shows the linked state with a disconnect button, and unlinks", async () => {
    const service = makeService({ linked: true });
    render(<TelegramIntegrationCard service={service} />);
    expect(await screen.findByText("Connected to Telegram")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Disconnect/ }));
    await waitFor(() => {
      expect(screen.getByText("Not connected")).toBeInTheDocument();
    });
    expect(service.unlink).toHaveBeenCalledWith("user-1");
  });

  it("surfaces a readable error when code creation fails", async () => {
    const service = makeService({
      createLinkCode: async () => {
        throw new Error("rls");
      },
    });
    render(<TelegramIntegrationCard service={service} />);
    await userEvent.click(await screen.findByRole("button", { name: "Generate link code" }));
    await waitFor(() => {
      expect(
        screen.getByText("Could not create a link code. Please try again."),
      ).toBeInTheDocument();
    });
  });
});
