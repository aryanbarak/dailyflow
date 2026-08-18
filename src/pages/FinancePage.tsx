import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  FileBarChart,
  Tag,
  MoreVertical,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatePanel } from "@/components/common/StatePanel";
import {
  SkeletonBlock,
  SkeletonCard,
  SkeletonListItem,
} from "@/components/common/Skeletons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFinance } from "@/hooks/useFinance";
import { usePullToRefreshHandler } from "@/features/pull-to-refresh/PullToRefreshContext";
import {
  Transaction,
  TransactionType,
} from "@/features/finance/financeService";
import { BudgetGoalsWidget } from "@/features/finance/components/BudgetGoalsWidget";
import { CsvImportExport } from "@/features/finance/components/CsvImportExport";
import { BankImportTool } from "@/features/finance/components/BankImportTool";
import { BudgetLimitsWidget } from "@/features/finance/components/BudgetLimitsWidget";
import { SavingsGoalsWidget } from "@/features/finance/components/SavingsGoalsWidget";
import { FinanceCharts } from "@/features/finance/components/FinanceCharts";
import { RecurringTransactions } from "@/features/finance/components/RecurringTransactions";
import { generateMonthlyReport } from "@/features/finance/reportService";
import { migrateLocalStorageToDb } from "@/features/finance/migrateLocalStorage";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { Sparkles, Lightbulb, ArrowRight } from "lucide-react";
import { useAppearance } from "@/features/settings/appearanceStore";
import {
  getAiResponseLanguageInstruction,
  getStoredAiResponseLanguage,
  resolveAiResponseLanguage,
} from "@/features/ai/responseLanguage";

const categories = ["Food", "Transport", "Rent", "Health", "Other"];

type GroupBy = "none" | "day" | "week";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Local date helper: interpret "YYYY-MM-DD" as local midnight */
function toLocalDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return new Date(`${value}T00:00:00`);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function formatMonthYear(date: Date): string {
  return date.toLocaleString(undefined, { month: "long", year: "numeric" });
}

// week starts on Monday
function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 Sun, 1 Mon, ...
  const diff = (day + 6) % 7; // 0 for Mon, 6 for Sun
  d.setDate(d.getDate() - diff);
  return d;
}

function formatDateISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface TransactionGroup {
  key: string;
  label: string;
  transactions: Transaction[];
  income: number;
  expense: number;
  net: number;
}

export default function FinancePage() {
  const interfaceLanguage = useAppearance((state) => state.language);
  const { t } = useT();
  const {
    transactions,
    addTransaction,
    updateTransaction,
    removeTransaction,
    isLoading,
    error: financeError,
    refresh,
  } = useFinance();
  // Task 38, point 8: opts this route into the shared pull-to-refresh
  // gesture -- `refresh` only re-fetches and replaces the `transactions`
  // array (useFinance.ts), it never touches this page's own local dialog
  // state (isDialogOpen/editingTx/deleteTarget below), so a mid-edit pull
  // can't clear an open dialog (task 38, point 9).
  usePullToRefreshHandler(refresh);

  // This Month / All
  const [filter, setFilter] = useState<"month" | "all">("month");
  const [selectedMonth, setSelectedMonth] = useState<Date>(
    startOfMonth(new Date())
  );

  // Dialog / form
  const [type, setType] = useState<TransactionType>("expense");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Search / filters
  const [searchQuery, setSearchQuery] = useState("");
  const [showIncome, setShowIncome] = useState(true);
  const [showExpense, setShowExpense] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Grouping for list + chart
  const [groupBy, setGroupBy] = useState<GroupBy>("day");

  const [showImport, setShowImport] = useState(false);

  // One-time migration of localStorage data to DB
  useEffect(() => { void migrateLocalStorageToDb(); }, []);

  // ---------- Scope + month navigation ----------

  const baseTransactions = useMemo(() => {
    if (filter === "all") return transactions;
    return transactions.filter((tx) =>
      isSameMonth(toLocalDate(tx.date), selectedMonth)
    );
  }, [transactions, filter, selectedMonth]);

  // ---------- Filters + search ----------

  const filteredTransactions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return baseTransactions.filter((tx) => {
      if (!showIncome && tx.type === "income") return false;
      if (!showExpense && tx.type === "expense") return false;
      if (categoryFilter !== "all" && tx.category !== categoryFilter)
        return false;

      if (!query) return true;
      const haystack = `${tx.category} ${tx.notes ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [
    baseTransactions,
    categoryFilter,
    searchQuery,
    showExpense,
    showIncome,
  ]);

  // ---------- Grouping by day/week (for list + chart) ----------

  const groups = useMemo<TransactionGroup[]>(() => {
    if (groupBy === "none") {
      const income = filteredTransactions
        .filter((tx) => tx.type === "income")
        .reduce((s, tx) => s + tx.amount, 0);
      const expense = filteredTransactions
        .filter((tx) => tx.type === "expense")
        .reduce((s, tx) => s + tx.amount, 0);

      return [
        {
          key: "all",
          label: t('finance_all_transactions'),
          transactions: filteredTransactions,
          income,
          expense,
          net: income - expense,
        },
      ];
    }

    const map = new Map<string, TransactionGroup>();

    for (const tx of filteredTransactions) {
      const d = toLocalDate(tx.date);
      let key: string;
      let label: string;

      if (groupBy === "day") {
        key = formatDateISO(d);
        label = d.toLocaleDateString();
      } else {
        const wkStart = startOfWeek(d);
        key = `week-${formatDateISO(wkStart)}`;
        const wkEnd = new Date(wkStart);
        wkEnd.setDate(wkEnd.getDate() + 6);
        label = `${wkStart.toLocaleDateString()} - ${wkEnd.toLocaleDateString()}`;
      }

      if (!map.has(key)) {
        map.set(key, {
          key,
          label,
          transactions: [],
          income: 0,
          expense: 0,
          net: 0,
        });
      }

      const group = map.get(key)!;
      group.transactions.push(tx);
      if (tx.type === "income") group.income += tx.amount;
      else group.expense += tx.amount;
      group.net = group.income - group.expense;
    }

    const result = Array.from(map.values()).sort((a, b) =>
      a.key.localeCompare(b.key)
    );
    return result;
  }, [filteredTransactions, groupBy]);

  // ---------- Totals = Ø®Ù„Ø§ØµÙ‡â€ŒÛŒ Ø¯ÛŒØªØ§ÛŒ Ù‚Ø§Ø¨Ù„ Ù…Ø´Ø§Ù‡Ø¯Ù‡ ----------

  const totals = useMemo(() => {
    const income = filteredTransactions
      .filter((tx) => tx.type === "income")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const expense = filteredTransactions
      .filter((tx) => tx.type === "expense")
      .reduce((sum, tx) => sum + tx.amount, 0);
    return { income, expense, net: income - expense };
  }, [filteredTransactions]);

  const categoryStats = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    filteredTransactions.forEach((tx) => {
      const current = map.get(tx.category) ?? { income: 0, expense: 0 };
      if (tx.type === "income") current.income += tx.amount;
      else current.expense += tx.amount;
      map.set(tx.category, current);
    });
    const items = Array.from(map.entries())
      .map(([category, values]) => ({
        category,
        income: values.income,
        expense: values.expense,
      }))
      .sort((a, b) => b.expense - a.expense);
    const totalExpense = items.reduce((sum, item) => sum + item.expense, 0);
    return {
      totalExpense,
      items: items.map((item) => ({
        ...item,
        expenseShare: totalExpense ? item.expense / totalExpense : 0,
      })),
    };
  }, [filteredTransactions]);

  const topCategory = useMemo(() => {
    const top = categoryStats.items[0];
    if (!top || top.expense === 0) return null;
    return { name: top.category, amount: top.expense };
  }, [categoryStats]);

  const hasAnyTransactions = transactions.length > 0;
  const hasFilteredResults = filteredTransactions.length > 0;
  const isInitialLoading = isLoading && !transactions.length;

  const currentMonthStr = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, "0")}`;

  const currentMonthTransactions = useMemo(
    () => transactions.filter((tx) => isSameMonth(toLocalDate(tx.date), selectedMonth)),
    [transactions, selectedMonth],
  );

  const last6Months = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en", { month: "short" });
      const income = transactions
        .filter((t) => t.date?.startsWith(key) && t.type === "income")
        .reduce((s, t) => s + Number(t.amount), 0);
      const expenses = transactions
        .filter((t) => t.date?.startsWith(key) && t.type === "expense")
        .reduce((s, t) => s + Number(t.amount), 0);
      return { month: label, income, expenses };
    });
  }, [transactions]);

  // AI Suggestions — fetched from Gemini
  const [finSuggestions, setFinSuggestions] = useState<Array<{ text: string; type: string }>>([]);
  const [finSugLoading, setFinSugLoading] = useState(false);
  const finSugLoaded = useRef(false);
  const workerUrl = import.meta.env.VITE_AGENT_WORKER_URL as string;

  const fetchFinanceSuggestions = () => {
    if (finSugLoaded.current) return;
    finSugLoaded.current = true;
    setFinSugLoading(true);
    supabase.auth.getSession().then(({ data: { session: authSession } }) => {
      if (!authSession) { setFinSugLoading(false); return; }
      const responseLanguage = resolveAiResponseLanguage({
        configuredResponseLanguage: getStoredAiResponseLanguage(),
        interfaceLanguage,
      });
      fetch(`${workerUrl}/finance/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession.access_token}` },
        body: JSON.stringify({
          responseLanguage,
          responseLanguageInstruction: getAiResponseLanguageInstruction(responseLanguage),
        }),
      })
        .then(res => res.ok ? res.json() : { suggestions: [] })
        .then((body: { suggestions: Array<{ text: string; type: string }> }) => {
          setFinSuggestions(body.suggestions ?? []);
        })
        .catch(() => setFinSuggestions([]))
        .finally(() => setFinSugLoading(false));
    });
  };

  // Computed real stats (no AI needed)
  const prevMonthExpenses = useMemo(() => {
    const prev = addMonths(selectedMonth, -1);
    return transactions
      .filter(tx => isSameMonth(toLocalDate(tx.date), prev) && tx.type === 'expense')
      .reduce((s, tx) => s + tx.amount, 0);
  }, [transactions, selectedMonth]);

  const expenseChangePct = prevMonthExpenses > 0
    ? Math.round(((totals.expense - prevMonthExpenses) / prevMonthExpenses) * 100)
    : null;

  const incomeSpentPct = totals.income > 0
    ? Math.round((totals.expense / totals.income) * 100)
    : null;

  const monthLabel =
    filter === "all" ? t('finance_all_time') : formatMonthYear(selectedMonth);

  const handleScopeChange = (value: "month" | "all") => {
    setFilter(value);
    if (value === "month") {
      setSelectedMonth(startOfMonth(new Date()));
    }
  };

  const handlePrevMonth = () => {
    if (filter === "all") return;
    setSelectedMonth((prev) => addMonths(prev, -1));
  };

  const handleNextMonth = () => {
    if (filter === "all") return;
    setSelectedMonth((prev) => addMonths(prev, 1));
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setShowIncome(true);
    setShowExpense(true);
    setCategoryFilter("all");
  };

  // ---------- CRUD handlers ----------

  const openNew = () => {
    setEditingTx(null);
    setType("expense");
    setAmount("");
    setCategory(categories[0]);
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setFormError(null);
    setIsDialogOpen(true);
  };

  const openEdit = (tx: Transaction) => {
    setEditingTx(tx);
    setType(tx.type);
    setAmount(tx.amount.toString());
    setCategory(tx.category);
    setDate(tx.date);
    setNotes(tx.notes ?? "");
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    const numericAmount = Number(amount);
    if (!amount || Number.isNaN(numericAmount) || numericAmount <= 0) {
      setFormError("Amount must be a positive number.");
      return;
    }
    if (!category) {
      setFormError("Category is required.");
      return;
    }
    if (editingTx) {
      void updateTransaction(editingTx.id, {
        type,
        amount: numericAmount,
        category,
        date,
        notes,
      });
    } else {
      void addTransaction({
        type,
        amount: numericAmount,
        category,
        date,
        notes,
      });
    }
    setIsDialogOpen(false);
  };

  const handleDelete = () => {
    if (deleteTarget) {
      void removeTransaction(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  // ---------- Export visible data to PDF ----------

  const handleExportPdf = () => {
    if (filteredTransactions.length === 0) return;

    const docTitle =
      filter === "all"
        ? "Finance - All transactions"
        : `Finance - ${monthLabel}`;

    const win = window.open("", "_blank");
    if (!win) return;

    const style = `
      <style>
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        h2 { font-size: 16px; margin-top: 24px; margin-bottom: 8px; }
        .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #f5f5f5; }
        .right { text-align: right; }
        .income { color: #15803d; }
        .expense { color: #b91c1c; }
        .totals { margin-top: 16px; font-size: 13px; }
      </style>
    `;

    const rowsHtml = filteredTransactions
      .map((tx) => {
        const d = toLocalDate(tx.date).toLocaleDateString();
        const sign = tx.type === "income" ? "+" : "-";
        const cls = tx.type === "income" ? "income" : "expense";
        return `
          <tr>
            <td>${d}</td>
            <td>${tx.type}</td>
            <td>${tx.category}</td>
            <td>${tx.notes ?? ""}</td>
            <td class="right ${cls}">${sign}${formatCurrency(tx.amount)}</td>
          </tr>
        `;
      })
      .join("");

    const html = `
      <html>
        <head>
          <title>${docTitle}</title>
          ${style}
        </head>
        <body>
          <h1>${docTitle}</h1>
          <div class="meta">
            Group by: ${groupBy.toUpperCase()} | 
            Scope: ${filter === "all" ? "All" : monthLabel} |
            Generated: ${new Date().toLocaleString()}
          </div>

          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Category</th>
                <th>Notes</th>
                <th class="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="totals">
            <strong>Income:</strong> ${formatCurrency(totals.income)} |
            <strong>Expenses:</strong> ${formatCurrency(totals.expense)} |
            <strong>Net:</strong> ${formatCurrency(totals.net)}
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  // ---------- Monthly PDF report ----------

  const handleExportReport = async () => {
    const byCategory = Object.entries(
      filteredTransactions
        .filter((t) => t.type === "expense")
        .reduce((acc, t) => {
          acc[t.category] = (acc[t.category] ?? 0) + Number(t.amount);
          return acc;
        }, {} as Record<string, number>),
    )
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    const bytes = await generateMonthlyReport({
      month: currentMonthStr,
      totalIncome: totals.income,
      totalExpenses: totals.expense,
      balance: totals.net,
      byCategory,
      transactions: filteredTransactions.map((t) => ({
        date: t.date,
        type: t.type,
        category: t.category,
        amount: Number(t.amount),
        notes: t.notes ?? null,
      })),
    });

    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-report-${currentMonthStr}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('finance_report_downloaded'));
  };


  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-6">
      {financeError && (
        <div className="mb-4">
          <StatePanel
            variant="error"
            title="Finance failed to load"
            description={financeError || "Failed to load finance data. Please try again."}
          />
        </div>
      )}
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between py-5"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">{t('finance_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('finance_subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <MoreVertical className="w-4 h-4" />
                <span className="hidden sm:inline">{t('finance_tools')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportPdf} disabled={!hasFilteredResults}>
                <Download className="w-3.5 h-3.5 mr-2" /> {t('finance_export_pdf')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExportReport()} disabled={!hasFilteredResults}>
                <FileBarChart className="w-3.5 h-3.5 mr-2" /> {t('finance_monthly_report')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowImport(true)}>
                <Upload className="w-3.5 h-3.5 mr-2" /> {t('finance_import_statement')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <CsvImportExport
            transactions={transactions}
            onImport={async (rows) => {
              for (const row of rows) {
                await addTransaction(row);
              }
            }}
          />
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" style={{ background: 'var(--gradient-primary)' }} onClick={openNew}>
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">{t('finance_add_entry')}</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingTx ? t('finance_edit_transaction') : t('finance_add_transaction')}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                {formError && (
                  <Alert variant="destructive">
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                )}
                <Tabs
                  value={type}
                  onValueChange={(value) =>
                    setType(value as TransactionType)
                  }
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="expense" className="flex-1">
                      {t('finance_expense')}
                    </TabsTrigger>
                    <TabsTrigger value="income" className="flex-1">
                      {t('finance_income')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="space-y-2">
                  <Label>{t('finance_amount')}</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('finance_category')}</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('finance_date')}</Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('finance_notes')}</Label>
                  <Input
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
                <Button className="w-full" onClick={handleSave}>
                  {editingTx ? t('finance_save_changes') : t('finance_save_transaction')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </motion.div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
      {/* Left column */}
      <div className="flex-1 min-w-0 space-y-4">

      {/* KPI Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card className="glass-card card-accent surface-elevated">
          <CardContent className="p-3.5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="icon-tile w-8 h-8 rounded-md bg-emerald-500/15">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{t('finance_income')}</span>
            </div>
            <p className="text-2xl font-bold tracking-tight text-emerald-400">
              {isInitialLoading ? '...' : formatCurrency(totals.income)}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card card-accent surface-elevated">
          <CardContent className="p-3.5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="icon-tile w-8 h-8 rounded-md bg-rose-500/15">
                <TrendingDown className="w-4 h-4 text-rose-400" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{t('finance_expenses')}</span>
            </div>
            <p className="text-2xl font-bold tracking-tight text-rose-400">
              {isInitialLoading ? '...' : formatCurrency(totals.expense)}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card card-accent surface-elevated">
          <CardContent className="p-3.5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="icon-tile w-8 h-8 rounded-md">
                <DollarSign className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{t('finance_balance')}</span>
            </div>
            <p className={cn("text-2xl font-bold tracking-tight", totals.net >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {isInitialLoading ? '...' : formatCurrency(totals.net)}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card card-accent surface-elevated">
          <CardContent className="p-3.5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="icon-tile w-8 h-8 rounded-md bg-cyan-500/15">
                <Tag className="w-4 h-4 text-cyan-400" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{t('finance_top_spend')}</span>
            </div>
            <p className="text-lg font-bold tracking-tight">
              {isInitialLoading ? '...' : topCategory ? topCategory.name : '—'}
            </p>
            {topCategory && !isInitialLoading && (
              <p className="text-[11px] text-muted-foreground">{formatCurrency(topCategory.amount)}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Transactions header: tabs + month nav + group by */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-lg">Transactions</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Tabs
              value={filter}
              onValueChange={(value) =>
                handleScopeChange(value as "month" | "all")
              }
            >
              <TabsList className="bg-secondary">
                <TabsTrigger value="month" className="text-xs sm:text-sm">This Month</TabsTrigger>
                <TabsTrigger value="all" className="text-xs sm:text-sm">All</TabsTrigger>
              </TabsList>
            </Tabs>

            <div
              className={cn(
                "flex items-center gap-1 rounded-md border px-1 py-1 text-xs sm:text-sm",
                filter === "all" && "opacity-60"
              )}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handlePrevMonth}
                disabled={filter === "all"}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="min-w-[90px] sm:min-w-[120px] text-center font-medium text-xs sm:text-sm">
                {monthLabel}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleNextMonth}
                disabled={filter === "all"}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Select
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as GroupBy)}
          >
            <SelectTrigger className="w-[130px] sm:w-[140px] text-xs sm:text-sm">
              <SelectValue placeholder={t('finance_group_by')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('finance_no_grouping')}</SelectItem>
              <SelectItem value="day">{t('finance_day')}</SelectItem>
              <SelectItem value="week">{t('finance_week')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t('finance_search')}
          className="max-w-xs"
        />
        <Toggle
          pressed={showIncome}
          onPressedChange={setShowIncome}
          className="rounded-full"
        >
          {t('finance_income')}
        </Toggle>
        <Toggle
          pressed={showExpense}
          onPressedChange={setShowExpense}
          className="rounded-full"
        >
          {t('finance_expense')}
        </Toggle>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('finance_all_categories')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('finance_all_categories')}</SelectItem>
            {categories.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('finance_category_insights')}</CardTitle>
        </CardHeader>
        <CardContent>
          {categoryStats.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No category data for current filters.
            </p>
          ) : (
            <div className="space-y-2 text-xs">
              {categoryStats.items.slice(0, 5).map((item) => (
                <div key={item.category} className="space-y-1">
                  <div className="flex justify-between">
                    <span className="font-medium">{item.category}</span>
                    <span>
                      {formatCurrency(item.expense)}
                      {categoryStats.totalExpense > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({Math.round(item.expenseShare * 100)}%)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-destructive"
                      style={{ width: `${item.expenseShare * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      {isInitialLoading ? (
        <Card className="glass-card card-accent">
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, idx) => (
              <SkeletonListItem key={idx} />
            ))}
          </CardContent>
        </Card>
      ) : !hasAnyTransactions ? (
        <div className="max-w-md mx-auto">
          <StatePanel
            variant="empty"
            title={t('finance_no_transactions')}
            description={t('finance_no_transactions_desc')}
            actionLabel={t('finance_add_entry')}
            onAction={openNew}
          />
        </div>
      ) : !hasFilteredResults ? (
        <div className="max-w-md mx-auto">
          <StatePanel
            variant="empty"
            title={t('finance_no_results')}
            description={t('finance_no_results_desc')}
            actionLabel={t('finance_clear_filters')}
            onAction={handleClearFilters}
          />
        </div>
      ) : (
        <Card className="glass-card card-accent">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">{t('finance_recent')}</h3>
            {groups.map((g) => (
              <div key={g.key} className="space-y-2">
                {groupBy !== "none" && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {g.label}
                    </span>
                    <span>
                      {g.transactions.length} item
                      {g.transactions.length > 1 ? "s" : ""} Net:{" "}
                      <span
                        className={cn(
                          g.net >= 0 ? "text-success" : "text-destructive"
                        )}
                      >
                        {g.net >= 0 ? "+" : "-"}
                        {formatCurrency(Math.abs(g.net))}
                      </span>
                    </span>
                  </div>
                )}

                {g.transactions.map((tx) => {
                  const dateLabel = toLocalDate(tx.date).toLocaleDateString();
                  const initial = tx.category.charAt(0).toUpperCase();
                  return (
                    <div
                      key={tx.id}
                      className="glass-card flex items-center gap-2 sm:gap-3 p-3 rounded-xl transition-colors group hover:bg-secondary/30"
                    >
                      <div
                        className={cn(
                          "w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold",
                          tx.type === "income"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-rose-500/15 text-rose-400"
                        )}
                      >
                        {initial}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{tx.category}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {tx.notes ? `${tx.notes} · ${dateLabel}` : dateLabel}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={cn(
                            "text-sm font-semibold",
                            tx.type === "income"
                              ? "text-emerald-400"
                              : "text-rose-400"
                          )}
                        >
                          {tx.type === "income" ? "+" : "-"}
                          {formatCurrency(tx.amount)}
                        </p>
                        <p className="text-[10px] text-muted-foreground hidden sm:block">
                          {dateLabel}
                        </p>
                      </div>
                      <div className="flex shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(tx)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(tx)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
<AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('finance_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('finance_delete_desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('finance_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {t('finance_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Charts */}
      <Card className="glass-card card-accent">
        <CardContent className="p-4">
          <FinanceCharts
            transactions={filteredTransactions}
            months={last6Months}
          />
        </CardContent>
      </Card>

      {/* Budget Goals */}
      <BudgetGoalsWidget />

      {/* Budget Limits + Savings Goals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BudgetLimitsWidget
          currentMonth={currentMonthStr}
          transactions={currentMonthTransactions}
        />
        <SavingsGoalsWidget />
      </div>

      {/* Recurring Transactions */}
      <RecurringTransactions onApplied={refresh} />

      </div>

      {/* Right sidebar */}
      <div className="w-full lg:w-[300px] shrink-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
        {/* Financial Health */}
        <Card className="glass-card card-accent">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="icon-tile w-7 h-7 rounded-md">
                <DollarSign className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-sm font-semibold">{t('finance_health')}</span>
            </div>
            {(() => {
              const score =
                (totals.net > 0 ? 30 : 0) +
                (totals.income > 0 && totals.expense < totals.income * 0.8 ? 20 : 0) +
                (totals.income > 0 ? 20 : 0) +
                (categoryStats.items.length > 0 && categoryStats.items[0].expenseShare < 0.5 ? 15 : 0) +
                (filteredTransactions.length > 3 ? 15 : 0);
              const label = score >= 85 ? t('finance_health_excellent') : score >= 65 ? t('finance_health_stable') : score >= 40 ? t('finance_health_caution') : t('finance_health_at_risk');
              const color = score >= 65 ? 'text-emerald-400' : score >= 40 ? 'text-orange-400' : 'text-rose-400';
              const strokeColor = score >= 65 ? 'hsl(142, 76%, 42%)' : score >= 40 ? 'hsl(38, 92%, 55%)' : 'hsl(0, 84%, 55%)';
              return (
                <>
                  <div className="flex flex-col items-center">
                    <div className="relative w-24 h-24">
                      <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90">
                        <circle cx="48" cy="48" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
                        <circle
                          cx="48" cy="48" r="40" fill="none"
                          stroke={strokeColor}
                          strokeWidth="6"
                          strokeLinecap="round"
                          strokeDasharray={`${(score / 100) * 251.3} 251.3`}
                        />
                      </svg>
                      <span className={cn("absolute inset-0 flex items-center justify-center text-xl font-bold", color)}>
                        {score}
                      </span>
                    </div>
                    <p className={cn("text-xs font-medium mt-1", color)}>{label}</p>
                  </div>
                  <div className="space-y-1.5 text-[11px] text-muted-foreground">
                    <div className="flex justify-between"><span>{t('finance_health_positive')}</span><span>{totals.net > 0 ? '✓' : '✗'}</span></div>
                    <div className="flex justify-between"><span>{t('finance_health_under80')}</span><span>{totals.income > 0 && totals.expense < totals.income * 0.8 ? '✓' : '✗'}</span></div>
                    <div className="flex justify-between"><span>{t('finance_health_has_income')}</span><span>{totals.income > 0 ? '✓' : '✗'}</span></div>
                    <div className="flex justify-between"><span>{t('finance_health_diversified')}</span><span>{categoryStats.items.length > 0 && categoryStats.items[0].expenseShare < 0.5 ? '✓' : '✗'}</span></div>
                    <div className="flex justify-between"><span>{t('finance_health_active')}</span><span>{filteredTransactions.length > 3 ? '✓' : '✗'}</span></div>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>

        {/* AI Finance Insights */}
        <Card className="glass-card card-accent">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="icon-tile w-7 h-7 rounded-md">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-sm font-semibold">{t('finance_ai_title')}</span>
            </div>

            {finSuggestions.length > 0 ? (
              <ul className="space-y-2">
                {finSuggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-lg bg-secondary/20 px-3 py-2.5">
                    <div className={cn("icon-tile w-7 h-7 rounded-lg shrink-0 mt-0.5", s.type === 'action' ? 'bg-emerald-500/15' : 'bg-violet-500/15')}>
                      {s.type === 'action'
                        ? <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                        : <Lightbulb className="w-3.5 h-3.5 text-violet-400" />}
                    </div>
                    <p className="text-xs leading-relaxed">{s.text}</p>
                  </li>
                ))}
              </ul>
            ) : finSugLoading ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-10 w-full" />
                <SkeletonBlock className="h-10 w-full" />
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{t('finance_ai_desc')}</p>
                <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={fetchFinanceSuggestions}>
                  <Sparkles className="w-3.5 h-3.5" /> {t('finance_ai_generate')}
                </Button>
              </>
            )}

            {/* Computed real stats */}
            <div className="border-t border-border/40 pt-3 space-y-2">
              {topCategory && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t('finance_top_category')}</span>
                  <span className="font-medium">{topCategory.name}: {formatCurrency(topCategory.amount)}</span>
                </div>
              )}
              {expenseChangePct !== null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t('finance_vs_last_month')}</span>
                  <span className={cn("font-medium", expenseChangePct <= 0 ? "text-emerald-400" : "text-rose-400")}>
                    Expenses {expenseChangePct >= 0 ? '↑' : '↓'} {Math.abs(expenseChangePct)}%
                  </span>
                </div>
              )}
              {incomeSpentPct !== null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t('finance_income_spent')}</span>
                  <span className={cn("font-medium", incomeSpentPct <= 80 ? "text-emerald-400" : "text-rose-400")}>
                    {incomeSpentPct}%
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="glass-card card-accent">
          <CardContent className="p-4 space-y-2">
            <h3 className="text-sm font-semibold mb-1">{t('finance_quick_actions')}</h3>
            <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => { setType('income'); openNew(); }}>
              <Plus className="w-3.5 h-3.5 text-emerald-400" /> {t('finance_add_income')}
            </Button>
            <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => { setType('expense'); openNew(); }}>
              <Plus className="w-3.5 h-3.5 text-rose-400" /> {t('finance_add_expense')}
            </Button>
            <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => setShowImport(true)}>
              <Upload className="w-3.5 h-3.5" /> {t('finance_import_statement')}
            </Button>
            <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => void handleExportReport()}>
              <FileBarChart className="w-3.5 h-3.5" /> {t('finance_monthly_report')}
            </Button>
          </CardContent>
        </Card>
      </div>
      </div>

      <AnimatePresence>
        {showImport && (
          <BankImportTool
            onImportComplete={() => { /* transactions reload automatically via useFinance subscription */ }}
            onClose={() => setShowImport(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}










