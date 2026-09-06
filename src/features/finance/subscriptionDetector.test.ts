// CORE-W2 (2026-09-06, audit item ۱-۵): deterministic subscription
// detection over finance transactions.
import { describe, expect, it } from "vitest";
import { detectSubscriptions, normalizeSubscriptionLabel } from "./subscriptionDetector";
import type { Transaction } from "./financeService";
import type { RecurringTransaction } from "./recurringTransactionsDbService";

let idCounter = 0;
function expense(date: string, amount: number, notes?: string, category = "Entertainment"): Transaction {
  idCounter += 1;
  return {
    id: `tx-${idCounter}`,
    type: "expense",
    amount,
    category,
    date,
    notes,
    createdAt: `${date}T00:00:00Z`,
    updatedAt: `${date}T00:00:00Z`,
  };
}

function recurring(title: string, amount: number, category = "Entertainment"): RecurringTransaction {
  return { id: `rec-${title}`, title, amount, type: "expense", category, dayOfMonth: 15 };
}

describe("normalizeSubscriptionLabel", () => {
  it("is case/whitespace-insensitive", () => {
    expect(normalizeSubscriptionLabel("  Netflix  Abo ")).toBe(normalizeSubscriptionLabel("netflix abo"));
  });
});

describe("detectSubscriptions", () => {
  it("finds a monthly same-notes same-amount expense pair as 'possible'", () => {
    const result = detectSubscriptions(
      [expense("2026-07-05", 17.99, "Netflix"), expense("2026-08-04", 17.99, "Netflix")],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      label: "Netflix",
      amount: 17.99,
      occurrenceCount: 2,
      confidence: "possible",
    });
  });

  it("three monthly occurrences become 'likely' with a median day-of-month", () => {
    const result = detectSubscriptions(
      [
        expense("2026-06-05", 17.99, "Netflix"),
        expense("2026-07-05", 17.99, "Netflix"),
        expense("2026-08-04", 17.99, "Netflix"),
      ],
      [],
    );
    expect(result[0].confidence).toBe("likely");
    expect(result[0].suggestedDayOfMonth).toBe(5);
    expect(result[0].lastDate).toBe("2026-08-04");
  });

  it("falls back to the category as the label when notes are empty", () => {
    const result = detectSubscriptions(
      [expense("2026-07-01", 9.99, undefined, "Music"), expense("2026-08-01", 9.99, "", "Music")],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Music");
  });

  it("ignores income, single occurrences, and different amounts under the same label", () => {
    const result = detectSubscriptions(
      [
        { ...expense("2026-07-01", 17.99, "Salary"), type: "income" },
        { ...expense("2026-08-01", 17.99, "Salary"), type: "income" },
        expense("2026-08-10", 42, "One-off"),
        expense("2026-07-03", 17.99, "Spotify"),
        expense("2026-08-02", 19.99, "Spotify"),
      ],
      [],
    );
    expect(result).toHaveLength(0);
  });

  it("a non-monthly gap disqualifies the whole group (weekly groceries are not a subscription)", () => {
    const result = detectSubscriptions(
      [
        expense("2026-08-01", 55.2, "Groceries"),
        expense("2026-08-08", 55.2, "Groceries"),
        expense("2026-08-15", 55.2, "Groceries"),
      ],
      [],
    );
    expect(result).toHaveLength(0);
  });

  it("suppresses groups already tracked in recurring_transactions (matched on title or category)", () => {
    const txs = [expense("2026-07-05", 17.99, "Netflix"), expense("2026-08-04", 17.99, "Netflix")];
    expect(detectSubscriptions(txs, [recurring("netflix", 17.99)])).toHaveLength(0);
    expect(detectSubscriptions(txs, [recurring("Other", 5)])).toHaveLength(1);
  });

  it("suppresses user-dismissed keys and sorts by occurrence count then amount", () => {
    const txs = [
      expense("2026-07-05", 17.99, "Netflix"),
      expense("2026-08-04", 17.99, "Netflix"),
      expense("2026-06-01", 9.99, "Spotify"),
      expense("2026-07-01", 9.99, "Spotify"),
      expense("2026-08-01", 9.99, "Spotify"),
    ];
    const all = detectSubscriptions(txs, []);
    expect(all.map((s) => s.label)).toEqual(["Spotify", "Netflix"]);
    const withDismissal = detectSubscriptions(txs, [], new Set([all[1].key]));
    expect(withDismissal.map((s) => s.label)).toEqual(["Spotify"]);
  });
});
