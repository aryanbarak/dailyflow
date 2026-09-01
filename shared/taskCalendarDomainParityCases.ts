// Chat V2 Slice 2B.1 -- LOCKED DOMAIN RULE parity fixture.
//
// Task-vs-calendar domain routing exists TWICE: the client's
// src/features/agent/reasoning/intentValidator.ts (drives the reasoning
// overlay/approval-card lane) and the Worker's
// agent/worker/flow-write-policy.ts (detectWriteDomainSignal, drives the
// older deterministic /chat lane) -- the same rule, hand-written
// independently in two files, because agent/worker is an independently
// bundled deployable that cannot import from src/ (and vice versa: src/
// importing agent/worker drags in Cloudflare's ambient types and fails
// typecheck -- see flowWriteDefaultParity.test.ts's own comment on this
// exact cross-runtime constraint).
//
// Nothing enforced their agreement before this file. This is a plain,
// framework-free data fixture (no vitest, no runtime-specific imports) so
// BOTH src/features/agent/reasoning/intentValidator.test.ts and
// agent/worker/flow-write-policy.test.ts can import it directly and each
// assert their OWN function's behavior against the SAME expected outcome
// for the SAME message -- CI fails if either side's answer for an
// explicit-domain case ever disagrees with this pinned expectation, i.e.
// if the Worker says 'task' while the client says 'calendar' (or vice
// versa) for the same message.
//
// LOCKED DOMAIN RULE: an explicit domain noun ("task"/"تسک"/"Aufgabe" or
// "event"/"meeting"/"جلسه"/"Termin"/...) wins before temporal inference.
// An explicit task noun paired with a time-of-day is a genuine ambiguity
// -- neither runtime may silently resolve it either way.
export type TaskCalendarDomainParityExpectation = "task" | "calendar" | "task_time_ambiguous" | "ambiguous";

export interface TaskCalendarDomainParityCase {
  readonly label: string;
  readonly message: string;
  readonly expected: TaskCalendarDomainParityExpectation;
}

export const taskCalendarDomainParityCases: readonly TaskCalendarDomainParityCase[] = [
  { label: "EN explicit task, date only -> task", message: "Create a task for tomorrow", expected: "task" },
  { label: "EN explicit task + time -> task_time_ambiguous, never calendar", message: "Create a task for tomorrow at 3pm", expected: "task_time_ambiguous" },
  { label: "EN explicit task + 24h compact time -> task_time_ambiguous, never calendar", message: "Create a task for tomorrow at 16:00", expected: "task_time_ambiguous" },
  { label: "EN explicit calendar noun + time -> calendar", message: "Create an event for tomorrow at 3pm", expected: "calendar" },
  // NOTE: "explicit calendar noun, no time" is deliberately NOT in this
  // shared fixture -- the two runtimes disagree at a DIFFERENT layer for
  // that case (unrelated to domain routing): the Worker's
  // detectWriteDomainSignal is a lightweight signal that only checks
  // trigger words, while the client's validateAgentIntentProposal builds
  // a fully executable proposal and requires create_calendar_event to
  // have a resolved start time, always -- a message with no time genuinely
  // cannot produce one client-side, so it asks for a DIFFERENT reason
  // (missing start time, not domain ambiguity). Both are correct at their
  // own layer; a shared parity fixture comparing them for this exact case
  // would be comparing two different questions. The Worker's own
  // dedicated test table (flow-write-policy.test.ts) still covers this
  // case on its own.
  { label: "DE explicit task + time -> task_time_ambiguous, never calendar", message: "Erstelle eine Aufgabe fuer morgen um 15 Uhr", expected: "task_time_ambiguous" },
  { label: "DE explicit task, date only -> task", message: "Erstelle eine Aufgabe fuer morgen", expected: "task" },
  { label: "FA explicit task + time -> task_time_ambiguous, never calendar", message: "یک تسک برای فردا بساز که نوبت دکتر فامیلی دارم. ساعت ۱۳ عصر", expected: "task_time_ambiguous" },
  { label: "FA explicit task, date only -> task", message: "یک تسک برای فردا بساز که نوبت دکتر فامیلی دارم", expected: "task" },
  { label: "FA acceptance case: explicit task + time -> task_time_ambiguous, never calendar", message: "برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم", expected: "task_time_ambiguous" },
  { label: "FA explicit calendar noun + time -> calendar", message: "یک جلسه برای فردا بساز، ساعت ۱۰", expected: "calendar" },
  { label: "DE explicit calendar noun (Termin) + time -> calendar", message: "Erstelle einen Termin fuer morgen um 15 Uhr", expected: "calendar" },
  { label: "FA acceptance case G: explicit calendar noun (with تقویم mentioned too) + time -> calendar", message: "فردا ساعت ۱۰ در تقویم جلسه با احمد بساز", expected: "calendar" },
  { label: "mixed task+calendar nouns -> ambiguous (two different domain nouns)", message: "Create a task for the meeting tomorrow", expected: "ambiguous" },
];
