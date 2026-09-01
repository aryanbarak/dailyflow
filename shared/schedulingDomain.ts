// Chat V2 Slice 2B.1.1 -- the shared scheduling-domain decision primitive.
//
// PO decision (supersedes Slice 2B.1's "ask task-vs-calendar" rule): a
// concrete time-of-day is scheduling intent. Tasks have no time-of-day
// column, so when the user's requested action carries an exact time that
// Tasks cannot represent, SmartFlow preserves that time by routing to
// Calendar instead -- the user should never need to understand that the
// Task entity has no time-of-day field. Core principle: PRESERVE THE
// USER'S SEMANTICS, NOT THE DATABASE NOUN THEY HAPPENED TO USE.
//
// This same precedence rule was previously hand-maintained independently
// in THREE places (the client's intentValidator.ts, the Worker's
// flow-write-policy.ts, and -- as prose -- reasoningPrompt.ts) -- exactly
// the drift risk shared/taskCalendarDomainParityCases.ts was built to
// catch for the OLD rule. This file is the single deterministic decision
// function both runtimes now call for "given this message's own trigger
// evidence, which scheduling domain does it resolve to" -- callers still
// derive the EVIDENCE (explicit noun/verb pattern matches, time-of-day
// parsing) locally, since that extraction is genuinely
// language/runtime-specific (regex literals differ, Worker vs. client
// have different deterministic date/time parsers) and moving it here
// would be a much larger, riskier change than this slice calls for. Only
// the FINAL precedence rule -- explicit calendar noun OR a concrete clock
// time wins -- lives here, exactly once.
//
// Plain, framework-free, zero imports: safe for both `src/` (bundled by
// Vite) and `agent/worker/` (a separately bundled Cloudflare Worker that
// cannot import from `src/`, and vice versa -- see
// shared/taskCalendarDomainParityCases.ts's own header for the exact
// cross-runtime constraint this file avoids by living in `shared/`).
export type SchedulingDomainDecision =
  | { kind: "task" }
  | { kind: "calendar"; reason: "explicit_calendar" | "exact_time" }
  | { kind: "ambiguous"; reason: "conflicting_domain_nouns" }
  | { kind: "none" };

export interface SchedulingDomainEvidence {
  // An explicit calendar/event/meeting/appointment noun paired with a
  // write verb (create or update) matched somewhere in the message.
  readonly explicitCalendarTrigger: boolean;
  // An explicit task/todo noun paired with a write verb (create or
  // update/reschedule) matched somewhere in the message.
  readonly explicitTaskTrigger: boolean;
  // A concrete, resolved clock time-of-day (not just a date) was found in
  // the message -- Tasks have no field to hold this.
  readonly hasConcreteTime: boolean;
}

// Deliberately NOT "time anywhere in a sentence means Calendar" -- this
// function only ever fires once a CALLER has already established that the
// message carries WRITE/SCHEDULING evidence (explicitCalendarTrigger or
// explicitTaskTrigger true). A purely informational or read-shaped
// sentence that happens to mention a time ("What time is my task due?",
// "What did I do at 10?") has neither trigger set and correctly resolves
// to 'none' here -- the caller's own read/write classification, which
// runs independently, is what keeps this a write-only decision.
export function resolveSchedulingDomain(evidence: SchedulingDomainEvidence): SchedulingDomainDecision {
  if (evidence.explicitCalendarTrigger && evidence.explicitTaskTrigger) {
    return { kind: "ambiguous", reason: "conflicting_domain_nouns" };
  }
  if (evidence.explicitCalendarTrigger) {
    return { kind: "calendar", reason: "explicit_calendar" };
  }
  if (evidence.explicitTaskTrigger) {
    return evidence.hasConcreteTime
      ? { kind: "calendar", reason: "exact_time" }
      : { kind: "task" };
  }
  return { kind: "none" };
}
