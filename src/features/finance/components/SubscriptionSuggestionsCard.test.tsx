// @vitest-environment jsdom
//
// CORE-W2 (2026-09-06): the subscription-suggestions rail card -- hidden
// when nothing is detected, promote goes through the service, dismiss
// hides locally.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubscriptionSuggestionsCard } from "./SubscriptionSuggestionsCard";
import type { Transaction } from "../financeService";

// Importing the real service pulls in the Supabase client, whose env
// guard throws outside a configured environment; tests always inject.
vi.mock("../recurringTransactionsDbService", () => ({
  recurringTransactionsDbService: { getAll: vi.fn(), create: vi.fn() },
}));

let idCounter = 0;
function expense(date: string, amount: number, notes: string): Transaction {
  idCounter += 1;
  return {
    id: `tx-${idCounter}`,
    type: "expense",
    amount,
    category: "Entertainment",
    date,
    notes,
    createdAt: `${date}T00:00:00Z`,
    updatedAt: `${date}T00:00:00Z`,
  };
}

const netflixPair = [expense("2026-07-05", 17.99, "Netflix"), expense("2026-08-04", 17.99, "Netflix")];
const euro = (amount: number) => `€${amount.toFixed(2)}`;

function makeService(existing: Array<{ id: string; title: string; amount: number; type: "expense"; category: string; dayOfMonth: number }> = []) {
  return {
    getAll: vi.fn(async () => existing),
    create: vi.fn(async (tx: object) => ({ id: "rec-new", ...(tx as Record<string, unknown>) }) as never),
  };
}

// The global localStorage in this environment is an incomplete shim
// (no removeItem/clear) -- stub a real in-memory Storage per test, the
// same MemoryStorage approach smartflow-pointer-follower.test.tsx uses.
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

describe("SubscriptionSuggestionsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", makeMemoryStorage());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders nothing when no subscription pattern exists", async () => {
    const service = makeService();
    const { container } = render(
      <SubscriptionSuggestionsCard transactions={[expense("2026-08-01", 42, "One-off")]} formatCurrency={euro} service={service} />,
    );
    await waitFor(() => expect(service.getAll).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("lists a detected subscription with amount and cadence", async () => {
    render(<SubscriptionSuggestionsCard transactions={netflixPair} formatCurrency={euro} service={makeService()} />);
    expect(await screen.findByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText(/€17\.99/)).toBeInTheDocument();
  });

  it("promoting creates a recurring transaction and removes the row", async () => {
    const service = makeService();
    render(<SubscriptionSuggestionsCard transactions={netflixPair} formatCurrency={euro} service={service} />);
    await screen.findByText("Netflix");
    // After promotion the reloaded exclusion list contains the new row.
    service.getAll.mockResolvedValueOnce([
      { id: "rec-new", title: "Netflix", amount: 17.99, type: "expense", category: "Entertainment", dayOfMonth: 5 },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(screen.queryByText("Netflix")).toBeNull();
    });
    expect(service.create).toHaveBeenCalledWith({
      title: "Netflix",
      amount: 17.99,
      type: "expense",
      category: "Entertainment",
      dayOfMonth: expect.any(Number),
    });
  });

  it("dismissing hides the row and survives a remount via localStorage", async () => {
    const service = makeService();
    const first = render(
      <SubscriptionSuggestionsCard transactions={netflixPair} formatCurrency={euro} service={service} />,
    );
    await screen.findByText("Netflix");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss suggestion" }));
    expect(screen.queryByText("Netflix")).toBeNull();
    first.unmount();

    render(<SubscriptionSuggestionsCard transactions={netflixPair} formatCurrency={euro} service={makeService()} />);
    await waitFor(() => expect(screen.queryByText("Netflix")).toBeNull());
  });
});
