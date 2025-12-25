import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plus, TrendingUp, TrendingDown, DollarSign, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Transaction, TransactionType } from "@/features/finance/financeService";
import { cn } from "@/lib/utils";

const categories = ["Food", "Transport", "Rent", "Health", "Other"];

function formatCurrency(amount: number) {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FinancePage() {
  const { transactions, addTransaction, updateTransaction, removeTransaction } = useFinance();
  const [filter, setFilter] = useState<"month" | "all">("month");
  const [type, setType] = useState<TransactionType>("expense");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const currentMonth = new Date().toISOString().slice(0, 7);

  const filteredTransactions = useMemo(() => {
    if (filter === "all") return transactions;
    return transactions.filter((tx) => tx.date.startsWith(currentMonth));
  }, [transactions, filter, currentMonth]);

  const totals = useMemo(() => {
    const monthTx = transactions.filter((tx) => tx.date.startsWith(currentMonth));
    const income = monthTx.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + tx.amount, 0);
    const expense = monthTx.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0);
    return { income, expense, net: income - expense };
  }, [transactions, currentMonth]);

  const openNew = () => {
    setEditingTx(null);
    setType("expense");
    setAmount("");
    setCategory(categories[0]);
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setError(null);
    setIsDialogOpen(true);
  };

  const openEdit = (tx: Transaction) => {
    setEditingTx(tx);
    setType(tx.type);
    setAmount(tx.amount.toString());
    setCategory(tx.category);
    setDate(tx.date);
    setNotes(tx.notes ?? "");
    setError(null);
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    const numericAmount = Number(amount);
    if (!amount || Number.isNaN(numericAmount) || numericAmount <= 0) {
      setError("Amount must be a positive number.");
      return;
    }
    if (!category) {
      setError("Category is required.");
      return;
    }
    if (editingTx) {
      updateTransaction(editingTx.id, {
        type,
        amount: numericAmount,
        category,
        date,
        notes,
      });
    } else {
      addTransaction({
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
      removeTransaction(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">Finance</h1>
          <p className="text-muted-foreground">Track your income and expenses</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-glow" onClick={openNew}>
              <Plus className="w-4 h-4" />
              Add Entry
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingTx ? "Edit Transaction" : "Add Transaction"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Tabs value={type} onValueChange={(value) => setType(value as TransactionType)}>
                <TabsList className="w-full">
                  <TabsTrigger value="expense" className="flex-1">
                    Expense
                  </TabsTrigger>
                  <TabsTrigger value="income" className="flex-1">
                    Income
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="space-y-2">
                <Label>Amount</Label>
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
                <Label>Category</Label>
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
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
              </div>
              <Button className="w-full" onClick={handleSave}>
                {editingTx ? "Save Changes" : "Save Transaction"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="grid sm:grid-cols-3 gap-4 mb-8"
      >
        <Card className="bg-success/10 border-success/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Monthly Income</p>
                <p className="text-2xl font-semibold text-success">${formatCurrency(totals.income)}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Monthly Expenses</p>
                <p className="text-2xl font-semibold text-destructive">${formatCurrency(totals.expense)}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-destructive/20 flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-primary/10 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Balance</p>
                <p className="text-2xl font-semibold text-primary">${formatCurrency(totals.net)}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="flex items-center justify-between mb-4">
        <CardTitle className="text-lg">Transactions</CardTitle>
        <Tabs value={filter} onValueChange={(value) => setFilter(value as "month" | "all")}>
          <TabsList className="bg-secondary">
            <TabsTrigger value="month">This Month</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          {filteredTransactions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No transactions yet.</p>
          ) : (
            filteredTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center",
                    tx.type === "income" ? "bg-success/20" : "bg-destructive/20",
                  )}
                >
                  {tx.type === "income" ? (
                    <TrendingUp className="w-5 h-5 text-success" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-destructive" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{tx.category}</p>
                  <p className="text-xs text-muted-foreground">{tx.notes || "No notes"}</p>
                </div>
                <div className="text-right">
                  <p className={cn("text-sm font-medium", tx.type === "income" ? "text-success" : "text-destructive")}>
                    {tx.type === "income" ? "+" : "-"}${formatCurrency(tx.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">{tx.date}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => openEdit(tx)}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteTarget(tx)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected transaction.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
