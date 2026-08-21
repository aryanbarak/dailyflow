// Task 42, Part B: parseFinanceDirection used to be hand-duplicated,
// verbatim, in both agent/worker/flow-write-policy.ts (as
// parseFinanceDirection) and src/features/agent/reasoning/intentValidator.ts
// (as parseDeterministicDirection) -- flagged as an ADR-0013-class drift
// risk by task 41-verify's diagnosis (the two files' finance TRIGGER
// regexes, isFinanceWriteTrigger and requestLooksLikeFinanceCreate, are a
// separate, still-unmerged duplication -- see that file's own comment;
// out of this task's scope). Extracted here, the one shared/ location both
// the Worker and the frontend already import registry data from (see
// writeIntentRegistry.ts), so there is exactly one implementation to keep
// correct and no possibility of the two silently diverging again.
//
// This does NOT fold into writeIntentRegistry.ts itself or its per-entry
// promptInstruction/target-field data -- that file's own scope-boundary
// comment deliberately keeps free-text intent RESOLUTION (this function,
// the trigger regexes, the cross-domain precedence cascade) out of the
// registry, since collapsing resolution logic into registry data risks
// silently reordering the task/calendar/finance precedence cascade. This
// function has no interaction with that cascade at all -- it only ever
// runs after 'finance' is already the decided domain -- so extracting it to
// its own small shared/ module respects that boundary rather than
// crossing it.
//
// Pure, deterministic, no dependencies -- ADR-0012's boundary ("a
// transaction's direction is never asked of, or trusted from, a model")
// applies identically in both runtimes, so this ports unchanged to both.

export function parseFinanceDirection(message: string): "income" | "expense" | undefined {
  const text = message.toLowerCase();
  // "got paid"/"received a payment" is income; a bare "pay"/"paid"/"send"/
  // "transfer" (no "got"/"received" framing) is money going out, the
  // common case for a single-user app recording the user's OWN transactions.
  if (
    /\bgot paid\b/.test(text) ||
    /\b(income|earned|received|salary)\b/.test(text) ||
    /\b(einnahme|erhalten|gehalt)\b/.test(text) ||
    /درآمد|دریافت|حقوق/.test(message)
  ) {
    return "income";
  }
  if (
    /\b(expense|spent|paid|pay|bought|cost|send|sent|transfer)\b/.test(text) ||
    /\b(ausgabe|bezahlt|zahle|gekauft|kosten|sende|überweise)\b/.test(text) ||
    /هزینه|خرید|پرداخت|بفرست/.test(message)
  ) {
    return "expense";
  }
  // Task 42, Part B: a stated spending CATEGORY names no explicit
  // income/expense word by itself -- "در بخش مواد غذایی اضافه کن" ("add it
  // in the groceries category") never says "expense" -- but this app
  // models no concept of an "income category" (spending is categorized;
  // salary/refunds are not), so naming a category at all, while recording
  // something, is itself implicit expense evidence -- the same "money
  // going out is the default, single-user-app case" reasoning already used
  // for the bare pay/paid/send/transfer words above, applied to a category
  // phrase instead of a verb alone. Narrowly gated on BOTH a
  // category-shaped clause (بخش/دسته, "section"/"category") AND one of the
  // three write verbs this task named (اضافه/ثبت/وارد کن -- deliberately
  // NOT بزن, task 41's own "heavily overloaded colloquial verb" -- the same
  // over-triggering risk that kept بزن noun-gated there keeps it excluded
  // from this inference too) within a bounded distance of it, mirroring
  // isFinanceWriteTrigger's own {0,40} noun/verb proximity gate elsewhere
  // in this codebase. Never derived from the amount alone -- this pattern
  // does not reference the amount token at all. Only reached as a
  // fallback: the explicit income/expense checks above always run first
  // and always win when present, satisfying this task's "explicit words
  // always win" requirement by construction (dead code would be needed to
  // violate it).
  if (/(بخش|دسته)[\s\S]{0,40}(اضافه|ثبت|وارد)\s*کن/.test(message)) {
    return "expense";
  }
  return undefined;
}
