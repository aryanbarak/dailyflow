// CORE-W2 (2026-09-06, CORE audit item ۱-۵): subscription detector.
// Adapted from CORE's "Weekly Subscription Identifier" task prompt, but
// implemented DETERMINISTICALLY (no LLM): finance_transactions has no
// merchant field, so the signature of a subscription here is "same
// normalized label (notes, falling back to category) + same exact amount,
// recurring on a ~monthly cadence". Pure module -- no I/O, fully unit
// tested; the FinancePage card does the reading/writing around it.
//
// CORE's own product rule is kept on purpose: the detector only ever
// SUGGESTS -- the user manually promotes a suggestion into
// recurring_transactions (never auto-created), and dismissals are a
// per-device convenience, not data.
import type { Transaction } from "./financeService";
import type { RecurringTransaction } from "./recurringTransactionsDbService";

export interface SubscriptionSuggestion {
  /** Stable identity for dismissal storage: normalized label + amount. */
  key: string;
  /** What the user will recognize: the shared notes text, else category. */
  label: string;
  amount: number;
  category: string;
  occurrenceCount: number;
  lastDate: string;
  suggestedDayOfMonth: number;
  confidence: "likely" | "possible";
}

// A "monthly" gap: 25-35 days covers real billing jitter (weekends,
// month lengths) without absorbing weekly or quarterly patterns.
const MIN_MONTHLY_GAP_DAYS = 25;
const MAX_MONTHLY_GAP_DAYS = 35;
const MS_PER_DAY = 86_400_000;

export function normalizeSubscriptionLabel(text: string): string {
  return text.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

function daysBetween(earlierIsoDate: string, laterIsoDate: string): number {
  return Math.round(
    (new Date(`${laterIsoDate}T00:00:00Z`).getTime() - new Date(`${earlierIsoDate}T00:00:00Z`).getTime()) / MS_PER_DAY,
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Detects ~monthly recurring expenses. `existingRecurring` suppresses
 * groups the user already tracks (matched by amount + normalized
 * title-or-category); `dismissedKeys` suppresses suggestions the user
 * closed by hand.
 */
export function detectSubscriptions(
  transactions: readonly Transaction[],
  existingRecurring: readonly RecurringTransaction[],
  dismissedKeys: ReadonlySet<string> = new Set(),
): SubscriptionSuggestion[] {
  const groups = new Map<string, { label: string; category: string; amount: number; dates: string[] }>();

  for (const tx of transactions) {
    if (tx.type !== "expense") continue;
    const rawLabel = tx.notes?.trim() ? tx.notes : tx.category;
    const label = rawLabel.trim();
    if (label.length === 0) continue;
    const key = `${normalizeSubscriptionLabel(label)}|${tx.amount.toFixed(2)}`;
    const group = groups.get(key);
    if (group) {
      group.dates.push(tx.date);
    } else {
      groups.set(key, { label, category: tx.category, amount: tx.amount, dates: [tx.date] });
    }
  }

  const alreadyTracked = new Set(
    existingRecurring.flatMap((r) => [
      `${normalizeSubscriptionLabel(r.title)}|${r.amount.toFixed(2)}`,
      `${normalizeSubscriptionLabel(r.category)}|${r.amount.toFixed(2)}`,
    ]),
  );

  const suggestions: SubscriptionSuggestion[] = [];
  for (const [key, group] of groups) {
    if (group.dates.length < 2) continue;
    if (alreadyTracked.has(key) || dismissedKeys.has(key)) continue;

    const dates = [...new Set(group.dates)].sort((a, b) => a.localeCompare(b));
    if (dates.length < 2) continue;
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i += 1) {
      gaps.push(daysBetween(dates[i - 1], dates[i]));
    }
    const monthlyGaps = gaps.filter((gap) => gap >= MIN_MONTHLY_GAP_DAYS && gap <= MAX_MONTHLY_GAP_DAYS);
    // Every observed gap must look monthly -- one odd gap (a mid-month
    // one-off purchase with identical notes+amount) disqualifies the
    // group rather than producing a false "subscription".
    if (monthlyGaps.length !== gaps.length) continue;

    const daysOfMonth = dates.map((date) => Number(date.slice(8, 10)));
    suggestions.push({
      key,
      label: group.label,
      amount: group.amount,
      category: group.category,
      occurrenceCount: dates.length,
      lastDate: dates[dates.length - 1],
      suggestedDayOfMonth: median(daysOfMonth),
      confidence: dates.length >= 3 ? "likely" : "possible",
    });
  }

  // Highest-signal first: more occurrences, then larger amount.
  return suggestions.sort(
    (a, b) => b.occurrenceCount - a.occurrenceCount || b.amount - a.amount,
  );
}
