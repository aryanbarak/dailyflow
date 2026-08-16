import { financeService, type TransactionType } from "@/features/finance/financeService";
import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionError,
  ExecutionInputValidationResult,
} from "../executionTypes";
import type { AgentToolSchemaField } from "../toolTypes";

export interface FinanceCreateTransactionHandlerOutput {
  transactionId: string;
  type: TransactionType;
  amount: number;
  verified: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function executionError(code: string, message: string, retryable = false): ExecutionError {
  return { code, message, retryable };
}

// Task 28: userId accepted for parity/audit-trail consistency with every
// other handler (writeRuntime.ts's buildHandlerInput always injects it as
// runtimeActorId), same as calendarCreateEventHandler's own comment on this
// -- financeService resolves the acting user internally via its own
// Supabase session, not this field. iban is deliberately NOT in this
// allow-list: finance_transactions has no iban column, and the shared
// registry's buildHandlerInput never includes it in the object this handler
// receives (see writeIntentRegistry.ts's own comment on that) -- there is
// nothing for this handler to reject, because the value was never passed
// through in the first place.
function validateFinanceCreateInput(input: unknown): ExecutionInputValidationResult {
  if (!isRecord(input)) return { valid: false, errors: ["Input must be an object."] };
  const allowed = new Set(["userId", "type", "amount", "category", "date", "notes"]);
  const errors = Object.keys(input)
    .filter((key) => !allowed.has(key))
    .map((key) => `${key} is not allowed for finance.create_transaction.`);
  if (typeof input.userId !== "string" || !input.userId.trim()) errors.push("userId is required.");
  if (input.type !== "income" && input.type !== "expense") errors.push("type must be 'income' or 'expense'.");
  if (typeof input.amount !== "number" && typeof input.amount !== "string") errors.push("amount is required.");
  else if (!Number.isFinite(Number(input.amount)) || Number(input.amount) < 0) errors.push("amount must be a non-negative number.");
  if (typeof input.date !== "string" || Number.isNaN(Date.parse(input.date))) errors.push("date must be a valid date string.");
  if (input.category !== undefined && typeof input.category !== "string") errors.push("category must be a string.");
  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== "string") errors.push("notes must be a string.");
  return { valid: errors.length === 0, errors };
}

function failure(
  status: AgentWriteToolExecutionResult<FinanceCreateTransactionHandlerOutput>["status"],
  code: string,
  message: string,
  transactionId?: string,
): AgentWriteToolExecutionResult<FinanceCreateTransactionHandlerOutput> {
  return {
    status,
    success: false,
    error: executionError(code, message),
    // taskId reused as a generic id slot -- see AgentWriteToolAuditMetadata's
    // own definition; calendarCreateEventHandler's own comment on this
    // applies identically here.
    auditMetadata: { taskId: transactionId, verified: false, resultShape: "object", redacted: true },
  };
}

export const financeCreateTransactionHandler: AgentWriteToolHandler<FinanceCreateTransactionHandlerOutput> = {
  toolId: "finance.create_transaction",
  mode: "write",
  timeoutMs: 3000,
  readOnly: false,
  externalEffect: true,
  reversible: true,
  requiresVerification: true,
  validateInput(input: unknown, _schema: readonly AgentToolSchemaField[]) {
    return validateFinanceCreateInput(input);
  },
  async execute(input: Record<string, unknown>) {
    const validation = validateFinanceCreateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "finance.create_transaction input failed validation.");
    const userId = String(input.userId);
    const type = input.type as TransactionType;
    const amount = Number(input.amount);
    // finance_transactions.category is NOT NULL -- no dedicated category
    // parser (out of this task's stated scope), so an unmentioned category
    // needs a real fallback, the same one the shared registry's
    // buildHandlerInput and the Worker's own executeAutoFinanceWrite use.
    const category = typeof input.category === "string" && input.category.trim() ? input.category : "Flow AI";
    const date = String(input.date);
    const notes = typeof input.notes === "string" ? input.notes : undefined;
    try {
      const created = await financeService.createTransaction(userId, { type, amount, category, date, notes });
      // financeService has no dedicated "get by id" readback -- an
      // independent read via listTransactions (the only listing method
      // available) is the closest equivalent verification, the same
      // pattern calendarCreateEventHandler uses via calendarService.getAll().
      const all = await financeService.listTransactions(userId);
      const verified = all.some((transaction) => transaction.id === created.id && transaction.amount === created.amount);
      if (!verified) return failure("verification_failed", "VERIFICATION_FAILED", "Created transaction could not be verified.", created.id);
      return {
        status: "success",
        success: true,
        data: Object.freeze({ transactionId: created.id, type: created.type, amount: created.amount, verified: true }),
        auditMetadata: { taskId: created.id, verified: true, resultShape: "object", redacted: true },
      };
    } catch {
      return failure("failed", "FINANCE_TRANSACTION_CREATE_FAILED", "Unable to create transaction.");
    }
  },
};
