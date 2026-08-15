// SmartFlow -- task 20, Part A2: a deterministic, server-side post-check
// applied to every /chat reply, BEFORE it is persisted or returned.
//
// WHY THIS EXISTS (production evidence): asked to set a daily study task and
// two daily reminders, /chat replied with a full spec and "این Task و
// Reminder با موفقیت تنظیم شدند" ("these were successfully set"). Nothing was
// created -- no proposal, no approval, no execution, and no reminders tool
// exists at all (see chat-attachment... no, see A3's tool-registry report in
// the task 20 report). Challenged, the model then fabricated a SECOND false
// claim: a "display delay" excuse, sending the user to look for data that
// will never exist.
//
// A1 (prompt-builder.ts's strengthened CHAT_IDENTITY) tells the model never
// to claim this. That is necessary but NOT sufficient -- the same lesson
// task 18's financial-sensitivity validator already established for this
// codebase: a model can still ignore its own system prompt. This module is
// the deterministic backstop.
//
// ARCHITECTURAL INVARIANT this check relies on: at the moment /chat
// generates a reply, NO write action from this same turn could possibly
// have executed yet. Every write this app supports (complete_task,
// write_github_issue_comment, write_github_issue_update -- see ADR-0004 and
// this task's own A3 tool-registry audit) is gated behind a SEPARATE, LATER,
// explicitly user-approved client action (StepApprovalDialog -> runWriteTool
// in ChatPage.tsx), never triggered by /chat itself, and that approval step
// cannot possibly have happened yet when /chat's reply is being generated
// (the reasoning overlay that produces a proposal for the user to approve
// runs concurrently with /chat, not before it -- see ChatPage.tsx's task 11
// comment). So a completion claim inside a /chat reply is UNCONDITIONALLY
// false at the moment it is generated: this check does not need to consult
// any live approval/execution state to decide whether a match is a "real"
// completion or not -- every match is one.

import type { Language } from './types'

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------
// Two distinct claim shapes, both covered per the task's own scope:
//   1. A direct completion claim ("successfully set/created/scheduled/...").
//   2. A SECOND-ORDER fabricated explanation for a non-existent result
//      ("display delay", "should appear shortly", "I've re-submitted it") --
//      the amendment's own observed follow-up lie when challenged.
// Deliberately narrow, closed vocabularies (matching this codebase's own
// established pattern-design convention -- see ChatPage.tsx's
// IMPERATIVE_CLAUSE_PATTERN_* / requestLooksUnsupported in intentValidator.ts
// for the same "small explicit list, not a general detector" philosophy),
// not an attempt at general sentiment/claim detection.
const COMPLETION_CLAIM_PATTERNS: Record<Language, RegExp[]> = {
  en: [
    /\bsuccessfully (?:set up|scheduled|created|saved|added|completed|done)\b/i,
    /\bhas been (?:successfully )?(?:set up|scheduled|created|saved|added)\b/i,
    /\bhave been (?:successfully )?(?:set up|scheduled|created|saved|added)\b/i,
    /\bi(?:'ve| have) (?:set up|scheduled|created|saved|added)\b/i,
    /\b(?:is|are) now (?:set|scheduled|saved|created|added)\b/i,
    // Task 22-fix (C3): "has already been added" was NOT covered by the
    // "has been X" pattern above -- "already" sits BETWEEN "has" and
    // "been", not after it, so the two are distinct phrasings. Present
    // continuous ("is being added") is a third, separate shape: production
    // evidence showed both surviving the guard entirely.
    /\bhas already been (?:set up|scheduled|created|saved|added)\b/i,
    /\bhave already been (?:set up|scheduled|created|saved|added)\b/i,
    /\bis being (?:set up|scheduled|created|saved|added)\b/i,
    /\bare being (?:set up|scheduled|created|saved|added)\b/i,
  ],
  de: [
    /\berfolgreich (?:eingerichtet|erstellt|gespeichert|hinzugefügt|geplant|angelegt)\b/i,
    /\bwurden? (?:erfolgreich )?(?:eingerichtet|erstellt|gespeichert|hinzugefügt|geplant|angelegt)\b/i,
    /\bich habe (?:es|das|sie|ihn) (?:eingerichtet|erstellt|gespeichert|hinzugefügt|angelegt)\b/i,
    /\b(?:ist|sind) jetzt (?:eingerichtet|erstellt|gespeichert|angelegt)\b/i,
    // Task 22-fix (C3): "wurde bereits hinzugefügt" ("was already added")
    // uses "bereits" (already), a different word than "erfolgreich"
    // (successfully) above -- not covered. "wird ... erstellt" is present
    // tense ("is being created"), a separate shape again.
    /\bwurde bereits (?:eingerichtet|erstellt|gespeichert|hinzugefügt|angelegt)\b/i,
    /\bwurden bereits (?:eingerichtet|erstellt|gespeichert|hinzugefügt|angelegt)\b/i,
    /\bwird (?:gerade |jetzt )?(?:eingerichtet|erstellt|gespeichert|hinzugefügt|geplant|angelegt)\b/i,
  ],
  fa: [
    /با موفقیت (?:تنظیم|ایجاد|ذخیره|اضافه|ثبت) شد(?:ه|ند)?/,
    /(?:تنظیم|ایجاد|ذخیره|ثبت) شدند/,
    // Task 22-fix (C3, production evidence): present/future tense ("به
    // تقویم اضافه می‌شود" -- "is being added to the calendar") and perfect
    // tense ("قبلاً ... اضافه شده است" -- "has already been added") --
    // neither was covered above, which only matched simple past ("شد"/
    // "شدند").
    /(?:تنظیم|ایجاد|ذخیره|اضافه|ثبت|ساخته)\s*می[‌\s]?شود/,
    /می[‌\s]?سازم/,
    /(?:تنظیم|ایجاد|ذخیره|اضافه|ثبت|ساخته)\s+شده(?:\s+است|اند)?/,
  ],
}

const FABRICATED_EXPLANATION_PATTERNS: Record<Language, RegExp[]> = {
  en: [
    /\bdisplay delay\b/i,
    /\b(?:should|will|might) appear (?:shortly|soon|in a (?:moment|bit|while))\b/i,
    /\bi(?:'ve| have) re-?submitted\b/i,
    /\bsometimes (?:there is|there's) a (?:display )?delay\b/i,
    /\btry (?:refreshing|checking) again (?:shortly|soon|in a (?:moment|bit))\b/i,
  ],
  de: [
    /\banzeigeverzögerung\b/i,
    /\bsollte (?:in )?(?:kürze|bald) erscheinen\b/i,
    /\bich habe (?:es|das) erneut (?:gesendet|eingereicht|übermittelt)\b/i,
    /\bmanchmal gibt es eine verzögerung\b/i,
  ],
  fa: [
    /تاخیر (?:در )?نمایش/,
    /به\s*زودی (?:نمایش داده می‌شود|ظاهر می‌شود)/,
    /دوباره (?:ثبت|ارسال) کردم/,
    /گاهی(?: اوقات)? تاخیر/,
  ],
}

// False-positive mitigation: the reported risk is the assistant discussing
// something the USER did themselves (quoted back, or past-tense), e.g.
// "You've already successfully created that task." A match is skipped ONLY
// when an explicit "you"/"your team"/etc. SUBJECT phrase sits IMMEDIATELY
// (no other word between, optionally with "already") before the matched
// verb phrase -- anchored at the end of a short preceding window, not "this
// pronoun appears ANYWHERE earlier in the sentence." That wider check was
// tried first and rejected: it wrongly excluded the exact production shape
// ("Your task ... has been successfully created" -- "Your" is a possessive
// determiner on the OBJECT being created, three words before the verb, not
// the verb's own subject) as a false NEGATIVE, which is worse than any
// false positive this exists to catch. This narrower, anchored check is a
// heuristic, not a parser -- see the task 20 report for the residual risk
// it does NOT close (a bare passive with no pronoun at all anywhere, e.g.
// "it has been created already," is not attributable either way and is
// still flagged; biased toward catching a real lie over avoiding every
// possible false positive, since a missed claim reproduces the exact
// production trust failure this exists to prevent).
// Task 22-fix (C3): the plain FA pattern below was `(?:شما|تو)\s+(?:قبلاً\s+)?$`
// -- it matched "شما" immediately before ANY verb, without checking whether
// "شما" was actually the verb's subject or just a POSSESSIVE on the
// immediately preceding noun (Persian possessives follow their noun: "تقویم
// شما" = "your calendar"). That silently exempted the exact production
// string this task's C3 fix targets -- "...به تقویم شما اضافه شده است" --
// since "شما" (modifying "تقویم", the OBJECT) sat right before "اضافه شده
// است", the same false-negative class the English comment above already
// warns about for "Your task ... has been successfully created." Narrowed
// to require "شما"/"تو" sit at a clause boundary (start of window, or after
// a separator/connector) rather than directly after an arbitrary noun.
const FA_ATTRIBUTION_SUBJECT_BOUNDARY = /(?:^|[،,.]\s*|\bو\s+|\bکه\s+)(?:شما|تو)\s+(?:قبلاً\s+)?$/

const OTHER_ATTRIBUTION_IMMEDIATE_PATTERNS: Record<Language, RegExp> = {
  en: /\b(?:you(?:'ve| have)|your team(?:'s)? (?:has|have)|they(?:'ve| have)|he(?:'s| has)|she(?:'s| has))\s+(?:already\s+)?$/i,
  de: /\b(?:du (?:hast|bist)|ihr (?:habt|seid)|sie (?:haben|hat)|er (?:hat|ist)|dein team (?:hat|habt))\s+(?:bereits\s+)?$/i,
  fa: FA_ATTRIBUTION_SUBJECT_BOUNDARY,
}

const ATTRIBUTION_WINDOW_CHARS = 30

function precedingClauseHasOtherAttribution(text: string, matchIndex: number, language: Language): boolean {
  const windowStart = Math.max(0, matchIndex - ATTRIBUTION_WINDOW_CHARS)
  const window = text.slice(windowStart, matchIndex)
  return OTHER_ATTRIBUTION_IMMEDIATE_PATTERNS[language].test(window)
}

function findUnattributedMatch(text: string, patterns: RegExp[], language: Language): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match && match.index !== undefined && !precedingClauseHasOtherAttribution(text, match.index, language)) {
      return match
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Neutral replacement copy -- calm, non-alarming, offers to prepare the
// action for approval rather than a bare "that's not true" correction.
// ---------------------------------------------------------------------------
const NEUTRAL_REPLACEMENT: Record<Language, string> = {
  en: "I can prepare that for you, but nothing has been created, scheduled, or saved yet — it still needs your approval first.",
  de: "Ich kann das für dich vorbereiten, aber es wurde noch nichts erstellt, geplant oder gespeichert — das braucht zuerst deine Zustimmung.",
  fa: "می‌توانم این را برایت آماده کنم، اما هنوز چیزی ایجاد، زمان‌بندی یا ذخیره نشده — ابتدا باید تو آن را تایید کنی.",
}

export interface CompletionClaimCheckResult {
  readonly flagged: boolean
  readonly text: string
  /** For server-side diagnostic logging only -- never sent to the client. */
  readonly matchedKind?: 'completion_claim' | 'fabricated_explanation'
  readonly matchedText?: string
}

/**
 * Replaces the ENTIRE reply with a single neutral line when a completion
 * claim or fabricated explanation is found, rather than attempting to strip
 * just the offending sentence. Chosen over sentence-level surgery: reliable
 * sentence-boundary detection across EN/DE/FA (Persian in particular does
 * not consistently use periods) is itself failure-prone, and a partially
 * edited reply risks leaving a grammatically broken fragment -- a worse user
 * experience than one clean, calm, complete replacement. The cost (losing
 * whatever else was accurate in the reply) is judged smaller than the risk
 * of a mangled partial edit, matching this codebase's existing
 * fail-closed/bias-conservative posture (task 18's sensitivity validator).
 */
export function checkForFalseCompletionClaim(
  reply: string,
  language: Language,
  options: { verifiedWriteExecutedInTurn?: boolean } = {},
): CompletionClaimCheckResult {
  if (options.verifiedWriteExecutedInTurn) return { flagged: false, text: reply }
  const completionMatch = findUnattributedMatch(reply, COMPLETION_CLAIM_PATTERNS[language], language)
  if (completionMatch) {
    return { flagged: true, text: NEUTRAL_REPLACEMENT[language], matchedKind: 'completion_claim', matchedText: completionMatch[0] }
  }
  const explanationMatch = findUnattributedMatch(reply, FABRICATED_EXPLANATION_PATTERNS[language], language)
  if (explanationMatch) {
    return { flagged: true, text: NEUTRAL_REPLACEMENT[language], matchedKind: 'fabricated_explanation', matchedText: explanationMatch[0] }
  }
  return { flagged: false, text: reply }
}
