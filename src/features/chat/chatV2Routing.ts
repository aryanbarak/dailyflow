// Chat V2 Slice 1 -- deterministic FAST-vs-LEGACY routing for handleSend.
//
// THE PROBLEM THIS SOLVES: classifyMessageIntentSignal is a denylist whose
// default fall-through is 'explicit' (ChatPage.tsx -- deliberate, task 11b:
// an unrecognized ACTION phrasing must reach reasoning). But that default
// also drags a large share of ordinary conversation ("how does X work?",
// brainstorming, follow-ups) into the reasoning overlay, whose result is
// then usually discarded by resolveChatTurnOutcome -- while Promise.all in
// handleSend makes the user wait on it (up to REASONING_FETCH_TIMEOUT_MS,
// 30s, vs the chat lane's own 25s ceiling; the "ACCEPTED COST" note in
// llmReasoningService.ts names the structural fix this module is part of).
//
// THE RULE (all deterministic -- no model call decides routing):
//   1. baseSignal !== 'explicit'  -> FAST. These messages already skip the
//      overlay today; FAST here changes nothing except the Worker's text-
//      provider preference.
//   2. any ACTION EVIDENCE        -> LEGACY. Write verbs
//      (looksLikeExplicitActionRequest -- ChatPage's own vocabulary, passed
//      in as a dep to avoid a page<->feature import cycle), read-domain
//      evidence (getStrongReadDomainEvidence, incl. 'conflicting'),
//      read-action verbs, or actionable nouns (reminder/appointment/نوبت).
//   3. a positive CONVERSATIONAL SHAPE (question mark, interrogative,
//      explain/summarize/brainstorm verbs, greeting) -> FAST.
//   4. anything else -> LEGACY. Uncertainty fails to the existing safe
//      path, per the Slice 1 contract.
//
// SAFETY INVARIANT (pinned by chatV2Routing.test.ts): this module can only
// ever DOWNGRADE an 'explicit' base signal to 'conversational' (skipping
// the overlay); it never upgrades, so no action becomes automatic because
// Chat V2 exists. Server-side write detection in the Worker's handleChat
// runs unconditionally on every turn regardless of this routing, so even a
// misrouted write-shaped message still hits the server's own deterministic
// policy -- routing here only decides whether the CLIENT starts the
// reasoning overlay and which lane it declares to the Worker.

import type { MessageIntentSignal } from '@/pages/ChatPage'
import { getStrongReadDomainEvidence } from '@/features/agent'

export type ChatV2Route = 'fast' | 'legacy'

// looksLikeExplicitActionRequest lives in ChatPage.tsx (its vocabulary is
// owned there -- see its own comment for why it is deliberately separate
// from hasImperativeClause). Injected rather than imported: a runtime
// import of the 3000-line page module from a feature module would create a
// page<->feature cycle (ChatPage imports this file). The type-only
// MessageIntentSignal import above is erased at compile time and carries no
// such cycle.
export interface ChatV2RoutingDeps {
  looksLikeExplicitActionRequest(message: string): boolean
}

// Read-action verbs, mirroring the intent of ChatPage's own (unexported)
// IMPERATIVE_CLAUSE_PATTERN_* lists: verbs a user writes when asking the
// app to DO something with their data rather than to talk. Router-local
// narrow copies, not a general imperative detector -- same posture as every
// other vocabulary table in this codebase. ("tell me"/"give me" are safe to
// include even though "tell me about X" is ordinary conversation: that
// message is base-classified 'conversational' and returns FAST at rule 1,
// before action evidence is ever consulted.)
const READ_ACTION_VERB_EN = /\b(show|check|list|complete|mark|open|display|run|give me|tell me)\b/i
const READ_ACTION_VERB_DE = /\b(zeig|zeige|pr(?:ü|ue)fe|liste|markiere|(?:ö|oe)ffne|gib mir)\b/i
const READ_ACTION_VERB_FA = /(نشان\s*بده|نشونم\s*بده|چک\s*کن|لیست\s*کن|کامل\s*کن|باز\s*کن|علامت\s*بزن|اجرا\s*کن)/

// Actionable nouns NOT covered by getStrongReadDomainEvidence's domain
// vocabulary (verified against its lists): reminders, and the
// Persian/Dari appointment word "نوبت" (the doctor-appointment acceptance
// case). English "appointment" and Persian "قرار/جلسه" are already
// calendar-domain evidence and need no second entry here.
const ACTIONABLE_NOUN_EN = /\b(reminders?)\b/i
const ACTIONABLE_NOUN_DE = /\b(erinnerung(?:en)?)\b/i
const ACTIONABLE_NOUN_FA = /(نوبت|یادآور)/

// Engineering-companion verbs (propose_engineering_task reaches the overlay
// today -- see intentValidator.ts's requestLooksLikeEngineeringTask; that
// function is unexported, so these are router-local narrow equivalents).
// A FAST misroute here would silently degrade a real capability, so bias
// to LEGACY: a false LEGACY hit merely keeps today's exact behavior.
const ENGINEERING_VERB_EN = /\b(fix|implement|refactor|debug|deploy|merge)\b/i
const ENGINEERING_VERB_DE = /\b(behebe|repariere|implementiere|deploye)\b/i
const ENGINEERING_VERB_FA = /(درست\s*کن|رفع\s*کن|اصلاح\s*کن)/

// Bare code/GitHub nouns getStrongReadDomainEvidence deliberately does not
// count (its GitHub evidence is phrase-based): "is my CI green?" names a
// real inspectable target and must keep its overlay path.
const CODE_TARGET_NOUN =
  /\b(github|repos?|repositor(?:y|ies)|issues?|pull\s*requests?|prs?|ci|pipelines?|workflows?|builds?|commits?)\b|(ریپو|مخزن|ایشو|گیت[\s‌-]*هاب)/i

// Schedule-query shapes ("do I have anything tomorrow?") -- a real
// calendar/task read even with no domain noun present. The Persian shape
// requires دارم *after* a temporal word so that a temporal word alone
// (e.g. "امروز برای چی می‌توانی کمکم کنی؟") stays conversational.
const SCHEDULE_QUERY_EN = /\bdo i have\b|\bwhat(?:'s| is) on\b/i
const SCHEDULE_QUERY_DE = /\bhabe ich\b/i
const SCHEDULE_QUERY_FA = /(امروز|فردا|پس‌فردا|این\s*هفته|هفته\s*(?:ی\s*)?(?:بعد|آینده))[^؟?]{0,40}دارم/

function hasActionEvidence(text: string, deps: ChatV2RoutingDeps): boolean {
  return (
    deps.looksLikeExplicitActionRequest(text) ||
    getStrongReadDomainEvidence(text) !== null ||
    READ_ACTION_VERB_EN.test(text) ||
    READ_ACTION_VERB_DE.test(text) ||
    READ_ACTION_VERB_FA.test(text) ||
    ACTIONABLE_NOUN_EN.test(text) ||
    ACTIONABLE_NOUN_DE.test(text) ||
    ACTIONABLE_NOUN_FA.test(text) ||
    ENGINEERING_VERB_EN.test(text) ||
    ENGINEERING_VERB_DE.test(text) ||
    ENGINEERING_VERB_FA.test(text) ||
    CODE_TARGET_NOUN.test(text) ||
    SCHEDULE_QUERY_EN.test(text) ||
    SCHEDULE_QUERY_DE.test(text) ||
    SCHEDULE_QUERY_FA.test(text)
  )
}

// Positive conversational shapes -- consulted only AFTER action evidence
// has been ruled out, so overlaps with action phrasing are impossible by
// construction at the call site.
const QUESTION_MARK = /[?؟]/
const INTERROGATIVE_EN = /\b(what|why|how|when|where|who|whose|which|can you|could you|would you|should i|do you|does|is|are|am i)\b/i
const INTERROGATIVE_DE = /\b(was|warum|wieso|weshalb|wie|wann|wo|wer|wessen|welche[rs]?|kannst du|k(?:ö|oe)nntest du|soll(?:te)? ich|ist|sind)\b/i
const INTERROGATIVE_FA = /(چی|چه|چرا|چطور|چطوری|چگونه|آیا|کدام|چند|کجا|کیست|چیست|می\s*تو(?:انی|انید)|می‌تو(?:انی|انید))/
const EXPLANATION_EN = /\b(explain|describe|summar(?:ize|ise)|compare|clarify|teach me|brainstorm|ideas?|help me understand)\b/i
const EXPLANATION_DE = /\b(erkl(?:ä|ae)re?|beschreibe?|fasse .{0,30}zusammen|vergleiche?|bring mir .{0,20}bei|ideen?)\b/i
const EXPLANATION_FA = /(توضیح|تشریح|شرح\s*بده|خلاصه|مقایسه|یاد\s*بده|ایده)/
const GREETING = /(?:^|[\s,،.!؟?])(hi|hello|hey|hallo|servus|moin|guten\s+(?:morgen|tag|abend)|سلام|درود|صبح\s*بخیر|شب\s*بخیر|خسته\s*نباشید)(?![\p{L}\p{N}_])/iu

function hasConversationalShape(text: string): boolean {
  return (
    QUESTION_MARK.test(text) ||
    INTERROGATIVE_EN.test(text) ||
    INTERROGATIVE_DE.test(text) ||
    INTERROGATIVE_FA.test(text) ||
    EXPLANATION_EN.test(text) ||
    EXPLANATION_DE.test(text) ||
    EXPLANATION_FA.test(text) ||
    GREETING.test(text)
  )
}

export function classifyChatV2Route(
  message: string,
  baseSignal: MessageIntentSignal,
  deps: ChatV2RoutingDeps,
): ChatV2Route {
  const text = message.trim()
  if (text === '') return 'fast'
  // Rule 1: non-'explicit' messages already run as a single conversational
  // call today -- FAST is a relabeling, not a behavior change, for them.
  if (baseSignal !== 'explicit') return 'fast'
  // Rule 2: any action evidence keeps today's exact legacy behavior.
  if (hasActionEvidence(text, deps)) return 'legacy'
  // Rule 3: a positive conversational shape with zero action evidence.
  if (hasConversationalShape(text)) return 'fast'
  // Rule 4: uncertain -> the existing safe path.
  return 'legacy'
}

// The signal handleSend should hand to everything downstream (overlay gate,
// resolveChatTurnOutcome). FAST-routed 'explicit' messages are downgraded
// to 'conversational' so the whole existing downstream path behaves exactly
// as it already does for conversational turns -- one lane, no overlay, no
// new outcome branches. Every other combination passes through unchanged
// ('ambiguous' keeps its trailing-offer behavior).
export function resolveChatV2IntentSignal(
  message: string,
  baseSignal: MessageIntentSignal,
  deps: ChatV2RoutingDeps,
): MessageIntentSignal {
  if (baseSignal === 'explicit' && classifyChatV2Route(message, baseSignal, deps) === 'fast') {
    return 'conversational'
  }
  return baseSignal
}

// The one overlay gate, extracted so a test can pin "FAST never starts the
// reasoning lane" without rendering ChatPage: handleSend starts the overlay
// iff this returns true, and resolveChatV2IntentSignal can never return
// 'explicit' for a FAST-routed message.
export function shouldStartReasoningOverlay(intentSignal: MessageIntentSignal): boolean {
  return intentSignal === 'explicit'
}
