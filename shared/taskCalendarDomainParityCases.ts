// Chat V2 Slice 2B.1.1 -- scheduling-domain parity fixture (SUPERSEDES
// Slice 2B.1's "LOCKED DOMAIN RULE" fixture of the same name).
//
// Task-vs-calendar domain routing exists TWICE: the client's
// src/features/agent/reasoning/intentValidator.ts (drives the reasoning
// overlay/approval-card lane) and the Worker's
// agent/worker/flow-write-policy.ts (detectWriteDomainSignal, drives the
// older deterministic /chat lane). Both now consume the SAME final
// precedence rule from shared/schedulingDomain.ts's resolveSchedulingDomain
// -- this fixture is what keeps their EVIDENCE EXTRACTION (still
// independently hand-written per runtime; see that module's own header
// comment for why) from drifting apart in practice. This is a plain,
// framework-free data fixture (no vitest, no runtime-specific imports) so
// BOTH src/features/agent/reasoning/intentValidator.test.ts and
// agent/worker/flow-write-policy.test.ts can import it directly and each
// assert their OWN function's behavior against the SAME expected outcome
// for the SAME message -- CI fails if either side's answer for a case ever
// disagrees with this pinned expectation.
//
// PO decision (Slice 2B.1.1): a concrete time-of-day is scheduling
// intent -- PRESERVE THE USER'S SEMANTICS, NOT THE DATABASE NOUN THEY
// HAPPENED TO USE. An explicit calendar noun OR a concrete clock time
// wins; only two DIFFERENT domain nouns co-occurring is a genuine
// ambiguity.
export type TaskCalendarDomainParityExpectation = "task" | "calendar" | "ambiguous";

export interface TaskCalendarDomainParityCase {
  readonly label: string;
  readonly message: string;
  readonly expected: TaskCalendarDomainParityExpectation;
}

export const taskCalendarDomainParityCases: readonly TaskCalendarDomainParityCase[] = [
  { label: "EN explicit task, date only -> task", message: "Create a task for tomorrow", expected: "task" },
  { label: "EN explicit task + time -> calendar (preserve the requested time)", message: "Create a task for tomorrow at 3pm", expected: "calendar" },
  { label: "EN explicit task + 24h compact time -> calendar", message: "Create a task for tomorrow at 16:00", expected: "calendar" },
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
  { label: "DE explicit task + time -> calendar", message: "Erstelle eine Aufgabe fuer morgen um 15 Uhr", expected: "calendar" },
  { label: "DE explicit task, date only -> task", message: "Erstelle eine Aufgabe fuer morgen", expected: "task" },
  { label: "FA explicit task + time -> calendar", message: "یک تسک برای فردا بساز که نوبت دکتر فامیلی دارم. ساعت ۱۳ عصر", expected: "calendar" },
  { label: "FA explicit task, date only -> task", message: "یک تسک برای فردا بساز که نوبت دکتر فامیلی دارم", expected: "task" },
  { label: "FA production acceptance case: explicit task + time -> calendar directly, no clarification", message: "برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم", expected: "calendar" },
  { label: "FA explicit calendar noun + time -> calendar", message: "یک جلسه برای فردا بساز، ساعت ۱۰", expected: "calendar" },
  { label: "DE explicit calendar noun (Termin) + time -> calendar", message: "Erstelle einen Termin fuer morgen um 15 Uhr", expected: "calendar" },
  { label: "FA acceptance case: explicit calendar noun (with تقویم mentioned too) + time -> calendar", message: "فردا ساعت ۱۰ در تقویم جلسه با احمد بساز", expected: "calendar" },
  { label: "mixed task+calendar nouns -> ambiguous (two different domain nouns)", message: "Create a task for the meeting tomorrow", expected: "ambiguous" },
  // NOTE: an explicit task UPDATE + time (e.g. "Update my task for
  // tomorrow at 3pm", or the "بگذار" reschedule phrasing) is deliberately
  // NOT in this shared fixture either, for the same reason "explicit
  // calendar noun, no time" above is excluded -- the two runtimes
  // disagree at a DIFFERENT layer, not on domain routing. Slice 2B.1.1:
  // an UPDATE-worded task+time message resolves to a BRAND NEW calendar
  // event using the REFERENCED TASK's own title (never bridging task
  // identity into update_calendar_event) -- the client's
  // validateAgentIntentProposal must additionally resolve WHICH task via
  // safeContext.tasks (findTaskTarget) before it can produce an
  // executable create_calendar_event, and fails closed with a generic
  // "task target required" clarification when no plausible taskReference
  // is present (as none of these generic messages actually name one) --
  // a genuine, DIFFERENT question from domain routing, which the
  // lightweight Worker signal never asks at all. Both runtimes are
  // correct at their own layer; each has its own dedicated test coverage
  // (flow-write-policy.test.ts's detectWriteDomainSignal table;
  // intentValidator.test.ts's own "explicit UPDATE-worded task + time"
  // describe block, which supplies a safeContext task to resolve
  // against).
];
