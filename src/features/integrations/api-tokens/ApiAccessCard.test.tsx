// @vitest-environment jsdom
//
// CORE-W3 (2026-09-06): API/MCP access card -- mint (shown once), list,
// revoke, all through the injectable service.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiAccessCard } from "./ApiAccessCard";
import type { ApiTokenSummary } from "./apiTokenService";

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "user-1" }, session: {}, isLoading: false }),
}));

// Importing the real service pulls in the Supabase client, whose env
// guard throws outside a configured environment; tests always inject.
vi.mock("./apiTokenService", () => ({
  apiTokenService: { createToken: vi.fn(), listTokens: vi.fn(), revokeToken: vi.fn() },
}));

function summary(overrides: Partial<ApiTokenSummary> = {}): ApiTokenSummary {
  return {
    id: "tok-1",
    name: "Claude Desktop",
    createdAt: "2026-09-06T10:00:00Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function makeService(tokens: ApiTokenSummary[] = []) {
  let current = tokens;
  return {
    listTokens: vi.fn(async () => current),
    createToken: vi.fn(async () => {
      current = [...current, summary()];
      return "sfp_FRESHTOKEN123";
    }),
    revokeToken: vi.fn(async (id: string) => {
      current = current.map((token) => (token.id === id ? { ...token, revokedAt: "2026-09-06T11:00:00Z" } : token));
    }),
  };
}

describe("ApiAccessCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("mints a token and shows the plaintext exactly once", async () => {
    const service = makeService();
    render(<ApiAccessCard service={service} />);
    const input = await screen.findByRole("textbox");
    await userEvent.type(input, "Claude Desktop");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText("sfp_FRESHTOKEN123")).toBeInTheDocument();
    expect(service.createToken).toHaveBeenCalledWith("user-1", "Claude Desktop");
  });

  it("the create button stays disabled without a name", async () => {
    render(<ApiAccessCard service={makeService()} />);
    expect(await screen.findByRole("button", { name: "Create token" })).toBeDisabled();
  });

  it("lists active tokens and revokes one (revoked tokens leave the list)", async () => {
    const service = makeService([summary()]);
    render(<ApiAccessCard service={service} />);
    expect(await screen.findByText("Claude Desktop")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Revoke/ }));
    await waitFor(() => expect(screen.queryByText("Claude Desktop")).toBeNull());
    expect(service.revokeToken).toHaveBeenCalledWith("tok-1");
  });

  it("shows a readable error when minting fails", async () => {
    const service = makeService();
    service.createToken.mockRejectedValueOnce(new Error("rls"));
    render(<ApiAccessCard service={service} />);
    await userEvent.type(await screen.findByRole("textbox"), "X");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Could not create the token");
  });
});
