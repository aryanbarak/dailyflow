// CORE-W2 (2026-09-06, CORE audit item ۱-۵): "possible subscriptions"
// rail card. Purely suggestive (CORE's own product rule): the deterministic
// detector proposes, the USER promotes a row into recurring_transactions or
// dismisses it -- nothing is ever auto-created. Dismissals are a per-device
// convenience in localStorage, not data.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useT } from "@/i18n";
import type { Transaction } from "../financeService";
import {
  recurringTransactionsDbService,
  type RecurringTransaction,
} from "../recurringTransactionsDbService";
import { detectSubscriptions, type SubscriptionSuggestion } from "../subscriptionDetector";

const DISMISSED_STORAGE_KEY = "sf-subscription-dismissed-v1";

function readDismissedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function persistDismissedKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Storage unavailable (private mode) -> dismissal lasts for the session only.
  }
}

interface RecurringServiceLike {
  getAll(): Promise<RecurringTransaction[]>;
  create(tx: Omit<RecurringTransaction, "id">): Promise<RecurringTransaction>;
}

interface SubscriptionSuggestionsCardProps {
  transactions: readonly Transaction[];
  formatCurrency(amount: number): string;
  service?: RecurringServiceLike;
}

export function SubscriptionSuggestionsCard({
  transactions,
  formatCurrency,
  service = recurringTransactionsDbService,
}: SubscriptionSuggestionsCardProps) {
  const { t } = useT();
  const [existingRecurring, setExistingRecurring] = useState<RecurringTransaction[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissedKeys());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadRecurring = useCallback(async () => {
    try {
      setExistingRecurring(await service.getAll());
    } catch {
      // Without the exclusion list we cannot promise non-duplicate
      // suggestions -- show nothing rather than something wrong.
      setExistingRecurring(null);
    }
  }, [service]);

  useEffect(() => {
    void loadRecurring();
  }, [loadRecurring]);

  const suggestions = useMemo<SubscriptionSuggestion[]>(() => {
    if (existingRecurring === null) return [];
    return detectSubscriptions(transactions, existingRecurring, dismissed);
  }, [transactions, existingRecurring, dismissed]);

  if (suggestions.length === 0) return null;

  const handlePromote = async (suggestion: SubscriptionSuggestion) => {
    setBusyKey(suggestion.key);
    try {
      await service.create({
        title: suggestion.label,
        amount: suggestion.amount,
        type: "expense",
        category: suggestion.category,
        dayOfMonth: suggestion.suggestedDayOfMonth,
      });
      await loadRecurring();
    } finally {
      setBusyKey(null);
    }
  };

  const handleDismiss = (suggestion: SubscriptionSuggestion) => {
    const next = new Set(dismissed);
    next.add(suggestion.key);
    setDismissed(next);
    persistDismissedKeys(next);
  };

  return (
    <Card className="glass-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="icon-tile w-8 h-8 rounded-md flex items-center justify-center shrink-0">
            <Repeat className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-semibold text-sm">{t("subscriptions_card_title")}</h3>
        </div>
        <p className="text-xs text-muted-foreground">{t("subscriptions_card_desc")}</p>
        <ul className="space-y-2">
          {suggestions.map((suggestion) => (
            <li
              key={suggestion.key}
              className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{suggestion.label}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(suggestion.amount)}
                  {" · "}
                  {t(
                    suggestion.confidence === "likely"
                      ? "subscriptions_confidence_likely"
                      : "subscriptions_confidence_possible",
                    { count: suggestion.occurrenceCount },
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 shrink-0"
                disabled={busyKey === suggestion.key}
                onClick={() => void handlePromote(suggestion)}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("subscriptions_promote")}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                aria-label={t("subscriptions_dismiss")}
                onClick={() => handleDismiss(suggestion)}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
