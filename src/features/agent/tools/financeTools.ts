import type { AgentToolDefinition } from "../toolTypes";

export const financeTools: AgentToolDefinition[] = [
  {
    id: "finance.create_transaction",
    name: "Create transaction",
    description: "Create a finance transaction after policy evaluation and approval (finance never auto-executes -- see ADR-0012 and agent/worker/flow-write-policy.ts's server-side hard clamp).",
    domain: "finance",
    capability: "create",
    mode: "write",
    riskLevel: "high",
    requiresApproval: true,
    approvalScope: "single_step",
    // Task 28: this was `false` ("classified conservatively" per this
    // file's own prior constraint) when this entry was only a future
    // placeholder with no handler. A handler is now registered
    // (financeCreateTransactionHandler.ts) with a real undo path
    // (financeService.deleteTransaction, wired through the shared
    // registry's undoKind), matching every other reversible=true entry's
    // actual guarantee -- reconciled here rather than left contradicting
    // the registry. See the task 28 report for this flagged explicitly as
    // a resolved conflict with this file's own prior state, not a silent
    // overwrite.
    reversible: true,
    externalEffect: true,
    inputSchema: [
      {
        name: "amount",
        type: "number",
        required: true,
        description: "Transaction amount.",
        sensitive: true,
      },
      {
        name: "type",
        type: "enum",
        required: true,
        description: "Transaction type.",
        enumValues: ["income", "expense"],
      },
      {
        name: "date",
        type: "date",
        required: true,
        description: "Transaction date.",
      },
      {
        name: "category",
        type: "string",
        required: false,
        description: "Transaction category. No dedicated parser; defaults to a fixed fallback when unmentioned.",
      },
      {
        name: "notes",
        type: "string",
        required: false,
        description: "Free-text description, passed through from the request.",
      },
      {
        name: "iban",
        type: "string",
        required: false,
        description: "IBAN mentioned in the request, validated deterministically (ISO 7064 MOD 97-10). Preview-only -- finance_transactions has no iban column, so this is never persisted.",
        sensitive: true,
      },
    ],
    outputSchema: {
      type: "object",
      description: "Created transaction metadata.",
      fields: [],
      containsSensitiveData: true,
    },
    enabled: true,
    version: "1.1.0",
    tags: ["finance", "write", "sensitive"],
    examples: [
      {
        title: "Record expense",
        input: { amount: 12.5, type: "expense", date: "2026-07-12" },
        expectedOutcome: "Creates a transaction only after explicit user approval (finance is never auto-executed).",
      },
    ],
    constraints: [
      "Requires explicit user approval -- finance never auto-executes, even if a stored permission row requests it.",
      "Amount/currency/direction/IBAN are re-derived deterministically from the request, never trusted from a model proposal.",
      "An IBAN mentioned in the request is validated (ISO 7064 MOD 97-10) but never persisted -- preview-only.",
    ],
  },
];
