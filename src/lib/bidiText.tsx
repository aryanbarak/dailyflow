import { createContext, useContext, type ReactElement, type ReactNode } from "react";

// SmartFlow bidi utility (task 11e, generalised by task 17f) -- shared by
// every surface that renders model- or user-generated text that can mix
// Persian (RTL) and Latin (LTR) content: chat bubbles, the assistant
// markdown renderer, briefing views, the per-task assistant answer,
// personal-memory cards, and conversation titles. One utility, used
// everywhere the bug appeared, rather than a per-page patch.
//
// Task 17f root cause (verified against task 17e's own rendered-DOM
// diagnostic before this rewrite -- see the task 17f report): <bdi>
// isolates a run only up to its LAST strong character, so in single-script
// text every strong character ends up inside a <bdi> and only neutral
// marks are left outside it. The HTML `dir="auto"` algorithm explicitly
// SKIPS <bdi> contents when searching for a first strong character to
// determine direction -- so once isolation swallows 100% of a block's
// strong characters, `dir="auto"` finds nothing and falls back to the
// AMBIENT direction (whatever the page happens to be), not the message's
// own. The fix is architectural, not a patch: this file previously
// isolated EVERY run of either script symmetrically, which is exactly what
// caused pure single-script text (and even the DOMINANT-script portions of
// mixed text) to be entirely bdi-swallowed. It now isolates ONLY the
// MINORITY-direction run(s) relative to the block's own dominant direction
// (resolveMessageBaseDirection below) -- the dominant-script text is left
// as plain, unwrapped characters, so `dir="auto"` (or an explicit dir=
// "rtl"/"ltr", see resolveMessageBaseDirection) always has real strong
// characters to resolve from, directly in the DOM, never hidden in an
// isolate.

// Each run must start and end on a strong LETTER of its own script --
// internal spaces, digits, and separators (0-9, ., -, _, /, :, @, +, #,
// and, for Persian, the ZWNJ used in normal enclitic joining) are allowed
// so a whole PHRASE ("Node.js", "AI/ML", "به به") isolates as ONE run, not
// one run per word. Digits are deliberately excluded from the START/END
// boundary class (though still allowed internally): a bare digit sequence
// ("2", "24/7") has no strong bidi type of its own (UAX#9) and must not be
// treated as a "run" needing isolation on its own -- this is what makes a
// case like "(2)." (task 17d's protected regression) safe by construction
// now: "2" alone never matches either run pattern, so nothing wraps it, no
// matter what punctuation surrounds it. Digits/neutrals/spaces/emoji never
// make otherwise-single-script text "mixed" (task 17f, R2).
const LATIN_STRONG = "A-Za-zÀ-ÖØ-öø-ÿ";
const PERSIAN_STRONG = "\\u0600-\\u06FF";
const LATIN_RUN_SOURCE = `[${LATIN_STRONG}](?:[${LATIN_STRONG}0-9 ._\\-/:@+#]*[${LATIN_STRONG}])?`;
const PERSIAN_RUN_SOURCE = `[${PERSIAN_STRONG}](?:[${PERSIAN_STRONG}0-9 \\u200c._\\-/:@+#]*[${PERSIAN_STRONG}])?`;
const STRONG_LTR_PATTERN = new RegExp(`[${LATIN_STRONG}]`);
const STRONG_RTL_PATTERN = new RegExp(`[${PERSIAN_STRONG}]`);
const LATIN_RUN_PATTERN_GLOBAL = new RegExp(LATIN_RUN_SOURCE, "g");
const PERSIAN_RUN_PATTERN_GLOBAL = new RegExp(PERSIAN_RUN_SOURCE, "g");
const FIRST_STRONG_PATTERN = new RegExp(`[${PERSIAN_STRONG}${LATIN_STRONG}]`);

/**
 * The SAME "first-strong-character" heuristic `dir="auto"` itself uses
 * (UAX#9 P2/P3), computed directly over a RAW string -- not the post-
 * isolation DOM. This is necessary wherever a container's own direction
 * must be guaranteed correct even when its entire visible content might end
 * up inside a <bdi> (dir="auto"'s native search skips <bdi> content -- see
 * this file's header comment). Introduced in task 17e for the chat bubble
 * root; task 17f promotes it into this shared utility so every consumer
 * (conversation titles included, task 17f B3) can reuse the SAME logic
 * instead of each re-implementing it.
 */
export function resolveMessageBaseDirection(text: string): "rtl" | "ltr" {
  const match = text.match(FIRST_STRONG_PATTERN);
  if (!match) return "ltr";
  return STRONG_RTL_PATTERN.test(match[0]) ? "rtl" : "ltr";
}

/**
 * Task 20b, W1: a MAJORITY direction, with resolveMessageBaseDirection's
 * own first-strong heuristic used only as a tie-break. Counts WORDS of each
 * script across the WHOLE given text and picks whichever script has more.
 *
 * Two simpler measures were tried first and both failed a real case,
 * caught by re-running this file's existing test suite after each attempt
 * (not just the new production-evidence cases):
 *   - Raw CHARACTER count: Persian is written without short vowels, so it
 *     is often more character-dense per word than English. A clearly
 *     Persian-dominant sentence like "این نتیجه برای Review active tasks
 *     است." (four Persian words carrying the sentence; "Review active
 *     tasks" is only the quoted OBJECT) has MORE Latin characters than
 *     Persian ones purely from average word length, and a character
 *     majority wrongly flipped it to ltr -- an existing, previously
 *     passing task 11e/17e test caught this immediately.
 *   - RUN count (this file's own LATIN_RUN_SOURCE/PERSIAN_RUN_SOURCE
 *     matches, where a same-script PHRASE with no script interruption
 *     counts as one run): closer, but "**SmartFlow** به شما کمک می‌کند:"
 *     is ONE Latin run ("SmartFlow") against ONE Persian run ("به شما کمک
 *     می‌کند", four words merged into a single run since nothing
 *     interrupts them) -- a tie that fell back to first-strong and wrongly
 *     picked ltr, when the sentence is obviously Persian-dominant (four
 *     words to one). Run count only reflects how many times the SCRIPT
 *     switches, not how much text is actually in each language.
 * Actual WORD count (splitting each matched run on internal whitespace)
 * gets every case checked so far right, including both regressions above
 * and the production evidence, because it is not skewed by either
 * character density or by how many separate same-script clusters happen to
 * exist.
 *
 * WHY first-strong alone is not enough here (task 20b's own root-cause
 * finding, verified against a real rendered-DOM diagnostic): a block whose
 * TRUE majority is Persian can still start with a short Latin label --
 * "Task: (وظیفه) را انجام بده." starts with "Task", but the sentence is
 * overwhelmingly Persian. Both of this file's PRE-20b heuristics
 * (`resolveMessageBaseDirection`'s pure first-strong, and the block-level
 * "skip isolated content" heuristic this replaces below) pick LTR here
 * purely because a Latin run happens to sit first/non-isolated -- and that
 * wrong dominant then propagates into which run gets isolated as
 * "minority", producing exactly the production bug (a mark or bracket
 * anchored to the wrong side). Majority-of-words gets this right because it
 * looks at the block as a whole rather than only its leading edge. Ties
 * (e.g. a short label plus an equally short gloss, "Task: (وظیفه)" alone --
 * one word each) fall back to first-strong, preserving today's behavior for
 * the genuinely ambiguous case.
 *
 * This is intentionally a SEPARATE function from resolveMessageBaseDirection
 * (which still drives the ChatBubble root's own dir, task 17e -- untouched
 * by this task) -- see computeBlockDirection's own comment for where this
 * is actually used: markdown BLOCK-level direction and the shared dominant
 * propagated into nested inline elements, never the message-root heuristic.
 */
function countWordsInRuns(runs: string[]): number {
  return runs.reduce((total, run) => total + run.trim().split(/\s+/).filter(Boolean).length, 0);
}

export function computeMajorityDirection(text: string): "rtl" | "ltr" {
  const latinWords = countWordsInRuns(text.match(LATIN_RUN_PATTERN_GLOBAL) ?? []);
  const persianWords = countWordsInRuns(text.match(PERSIAN_RUN_PATTERN_GLOBAL) ?? []);
  if (persianWords > latinWords) return "rtl";
  if (latinWords > persianWords) return "ltr";
  return resolveMessageBaseDirection(text);
}

// Task 17f, R3: a MINORITY run immediately followed by an attached closing
// paren and/or a trailing mark from :.!? belongs INSIDE that run's isolate
// -- generalising task 17d's V3 beyond parenthesized multi-word phrases
// (that phrase-only, space-required restriction existed ONLY to keep a
// bare digit like "(2)." from being swallowed whole; now that digits can
// never match RUN_SOURCE at all -- see above -- that restriction is no
// longer needed and is dropped). Three alternatives, tried in this order:
//  1. `(RUN)` + a REQUIRED trailing mark -- unchanged from task 17d's V3:
//     the closing paren is only pulled INTO the isolate together with an
//     attached mark. A parenthesized run with nothing attached to its own
//     closing paren (task 17d's protected "(به به)"/"(Advanced Technical
//     Support)" cases, no mark follows) does NOT match this alternative,
//     and falls through to alternative 3 below, which starts matching
//     one character later (RUN_SOURCE never itself starts on "(") -- so
//     the parens are correctly left OUTSIDE the isolate, exactly as
//     before.
//  2. Task 20, Part B: `[RUN]` + a REQUIRED trailing mark -- the exact
//     same shape as alternative 1, generalised to square brackets (the
//     production evidence's "تاریخ سررسید: [3 روز از امروز]" bracket-
//     boundary instability). Deliberately symmetric with round parens,
//     including the SAME "no mark -> stays excluded, falls through to the
//     bare run" behaviour -- a leading digit immediately inside the
//     brackets (the "3" above) is not itself a strong character so it can
//     never be part of RUN_SOURCE either way; only the run itself
//     isolates. See the task 20 report for this documented, accepted
//     scope boundary.
//  3. A bare RUN with an OPTIONAL trailing mark -- the task 17f
//     generalisation: "SmartFlow." / "AI/ML." / "Codex:" now isolate their
//     attached mark too, whether or not any brackets are involved.
function runWithAttachedMarks(runSource: string): string {
  return `(?:\\(${runSource}\\)[:.!?]|\\[${runSource}\\][:.!?]|${runSource}[:.!?]?)`;
}
const LATIN_RUN_WITH_MARKS = runWithAttachedMarks(LATIN_RUN_SOURCE);
const PERSIAN_RUN_WITH_MARKS = runWithAttachedMarks(PERSIAN_RUN_SOURCE);
const LATIN_MINORITY_PATTERN = new RegExp(LATIN_RUN_WITH_MARKS, "g");
const PERSIAN_MINORITY_PATTERN = new RegExp(PERSIAN_RUN_WITH_MARKS, "g");

// Task 20, Part B: the mirror-image case -- a neutral mark (colon, period,
// etc.) attached OUTSIDE and immediately AFTER a preceding INLINE ELEMENT
// (<strong>/<em>/<a>, already its own isolated React node from markdown,
// e.g. "**Task**: (وظیفه)") has nothing of its own to anchor to: it is not
// part of any string that could isolate it via the RUN patterns above,
// since it lives in a SEPARATE sibling text node. See
// isolateEmbeddedBidiRuns's own use of this below.
const LEADING_ATTACHED_MARK_PATTERN = /^[:.!?]+/;

// Task 20b, W2: a bracket/paren PAIR whose CONTENT itself mixes both
// scripts -- e.g. "[لطفاً ... تا در Task ثبت کنم.]" (a Persian sentence
// containing one Latin word) or "(Anaconda یا VS Code)." (a Latin phrase
// containing one Persian word). The existing per-run alternatives above
// (runWithAttachedMarks) only ever isolate a SINGLE-SCRIPT run; they cannot
// match a bracket pair whose content mixes scripts at all, so today such a
// group's delimiters stay bare/plain while only the embedded minority WORD
// gets its own isolate, leaving the delimiters unanchored to either side of
// their own content. This pre-pass isolates the WHOLE group (delimiters +
// content + an attached trailing mark, e.g. the period in "(Anaconda یا VS
// Code).") as ONE atomic unit -- generalising 17f/20's own "delimiters +
// attached mark belong together" principle from single-script runs to
// mixed-script ones -- with the group's OWN interior recursively run back
// through this same function (isolateBidiRunsInText), using a dominant
// computed from JUST that interior (computeMajorityDirection), so an
// embedded minority word inside the group still gets its own nested
// isolate exactly as it would outside a bracket pair.
//
// Deliberately excludes NESTED brackets of the same kind (no "(a (b) c)"
// support) -- matching the existing single-script alternatives' own scope,
// not a new limitation. A bracket pair whose content is single-script (or
// has no strong characters at all) is intentionally left OUT of this pass
// (isMixedScript returns false) and falls through unchanged to the
// existing per-run alternatives below, preserving 17d's "(به به)"/
// "(Advanced Technical Support)" behaviour and 17d's "(2)." exception
// exactly as before.
const BRACKET_GROUP_PATTERN = /\(([^()]*)\)([:.!?]?)|\[([^[\]]*)\]([:.!?]?)/g;

function isMixedScript(content: string): boolean {
  return STRONG_LTR_PATTERN.test(content) && STRONG_RTL_PATTERN.test(content);
}

interface MixedBracketGroup {
  readonly bracketType: "round" | "square";
  readonly inner: string;
  readonly trailingMark: string;
}

type BracketSplitSegment = { readonly type: "text"; readonly value: string } | ({ readonly type: "group" } & MixedBracketGroup);

function splitMixedBracketGroups(text: string): BracketSplitSegment[] {
  const segments: BracketSplitSegment[] = [];
  let lastIndex = 0;
  BRACKET_GROUP_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(BRACKET_GROUP_PATTERN)) {
    const isRound = match[1] !== undefined;
    const inner = isRound ? match[1] : (match[3] as string);
    if (!isMixedScript(inner)) continue;

    const trailingMark = (isRound ? match[2] : match[4]) ?? "";
    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, start) });
    segments.push({ type: "group", bracketType: isRound ? "round" : "square", inner, trailingMark });
    lastIndex = start + match[0].length;
  }

  if (segments.length === 0) return [{ type: "text", value: text }];
  if (lastIndex < text.length) segments.push({ type: "text", value: text.slice(lastIndex) });
  return segments;
}

function renderMixedBracketGroup(group: MixedBracketGroup, keyPrefix: string, index: number): ReactNode {
  const localDominant = computeMajorityDirection(group.inner);
  const [open, close] = group.bracketType === "round" ? ["(", ")"] : ["[", "]"];
  return (
    <bdi key={`${keyPrefix}-bracket-${index}`}>
      {open}
      {isolateBidiRunsInText(group.inner, `${keyPrefix}-bracket-${index}-inner`, localDominant)}
      {close}
      {group.trailingMark}
    </bdi>
  );
}

/**
 * Splits a plain string into alternating literal segments and isolated
 * `<bdi>` runs, isolating ONLY the minority-direction run(s) relative to
 * the text's own dominant direction (task 17f, R2/R3). Single-script text
 * (all strong characters the same direction class -- digits/neutrals never
 * count) is returned COMPLETELY UNCHANGED, wrapped in no <bdi> at all: this
 * is the direct fix for the 17e root cause, since a block that is never
 * fully swallowed by an isolate always has real strong characters left for
 * `dir="auto"` (or an explicit dir) to resolve from. Returns the original
 * string unchanged (in a one-element array) whenever there's nothing to
 * isolate, so callers can always treat the result as a ReactNode array.
 *
 * `dominantOverride` (task 20, Part B): when this string is only a FRAGMENT
 * of a larger logical block -- e.g. one text-node sibling of a preceding
 * `<strong>` element, as react-markdown produces for "**Task**: (وظیفه)" --
 * computing the dominant direction from THIS FRAGMENT ALONE is wrong: a
 * trailing fragment like ": (وظیفه)" has no Latin characters in it at all,
 * so it would resolve its OWN dominant as Persian even though the block's
 * REAL dominant (established by "Task" in the preceding element) is Latin.
 * Callers spanning multiple children (isolateEmbeddedBidiRuns) compute ONE
 * shared dominant from the block's full extracted text and pass it through
 * here for every fragment, so a mid-block text node isolates consistently
 * with its neighbours instead of contradicting them. Omitted (single-string
 * callers, e.g. a bare chat bubble body) falls back to computing it locally
 * from the string itself -- unchanged default behaviour.
 */
export function isolateBidiRunsInText(text: string, keyPrefix: string, dominantOverride?: "rtl" | "ltr"): ReactNode[] {
  // Task 20b, W2: pull out any mixed-script bracket/paren groups FIRST, as
  // atomic units, and recurse into the remaining plain-text segments with
  // the existing single-script logic below. See splitMixedBracketGroups's
  // own comment. When there are no mixed-script groups at all (the common
  // case), this returns the text back unchanged as a single segment and
  // falls straight through to the unmodified logic below -- 17f's R2
  // single-script short-circuit is untouched for that path.
  const bracketSegments = splitMixedBracketGroups(text);
  if (bracketSegments.length > 1 || bracketSegments[0].type === "group") {
    return bracketSegments.flatMap((segment, index) =>
      segment.type === "group"
        ? [renderMixedBracketGroup(segment, keyPrefix, index)]
        : isolateBidiRunsInText(segment.value, `${keyPrefix}-t${index}`, dominantOverride),
    );
  }

  const dominant = dominantOverride ?? resolveMessageBaseDirection(text);
  const minorityIsPersian = dominant === "ltr";
  const minorityStrongPattern = minorityIsPersian ? STRONG_RTL_PATTERN : STRONG_LTR_PATTERN;

  // R2 fast path (task 17f, unchanged by task 20b): no minority-direction
  // strong character (relative to `dominant`) anywhere in this text at all
  // -- single-script relative to the applicable dominant, or no strong
  // character at all -- return unchanged. Task 20b, W1 note: `dominant` can
  // now be an externally-propagated block dominant (see
  // BlockDominantDirectionContext) rather than always computed locally from
  // this exact text -- callers that would otherwise cause a REDUNDANT
  // isolation this way (a `<strong>`/`<em>`/`<a>` element whose own content
  // is genuinely single-script, already fully protected by that element's
  // own CSS isolate boundary) are responsible for not passing an
  // externally-mismatched override in the first place -- see strong/em/a's
  // own comments in createDirectionalMarkdownComponents for how that's
  // decided (only when the element's own content is itself mixed-script).
  if (!minorityStrongPattern.test(text)) return [text];

  const minorityPattern = minorityIsPersian ? PERSIAN_MINORITY_PATTERN : LATIN_MINORITY_PATTERN;
  minorityPattern.lastIndex = 0;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let runIndex = 0;

  for (const match of text.matchAll(minorityPattern)) {
    const start = match.index ?? 0;
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    parts.push(<bdi key={`${keyPrefix}-${runIndex}`}>{match[0]}</bdi>);
    runIndex += 1;
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : [text];
}

/**
 * Recursively reads the plain-text content of a React node, INCLUDING
 * text inside nested elements (a `<strong>`/`<em>`/`<a>` from markdown) --
 * unlike isolateEmbeddedBidiRuns itself, which deliberately leaves element
 * children untouched for RENDERING, this is used only as the FALLBACK half
 * of computeBlockDirection below (task 20, Part B).
 */
function extractPlainText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractPlainText).join("");
  if (node !== null && typeof node === "object" && "props" in node) {
    return extractPlainText((node as ReactElement<{ children?: ReactNode }>).props.children);
  }
  return "";
}

/**
 * The direction for a markdown block's own `dir` attribute (task 20, Part
 * B; redesigned task 20b, W1) -- see p/ul/ol/li's own comment in
 * createDirectionalMarkdownComponents for why this replaced a bare
 * `dir="auto"`.
 *
 * Task 20b root-cause finding: this originally used a two-tier "skip
 * isolated content, read through only as a fallback" strategy (mirroring
 * native `dir="auto"`'s own isolate-skipping search). That fixed the
 * degenerate case (a block that's nothing but an isolated bold run) but
 * introduced a NEW contradiction: `isolateEmbeddedBidiRuns` (below)
 * computed its OWN separate dominant via a plain read-through first-strong
 * scan, so the two could disagree whenever a block's non-isolated text
 * happened to start with the block's MINORITY script -- e.g. "**وظیفه**:
 * Task را انجام بده." (a Persian sentence with an English word in the
 * middle) resolved this block's own `<p>` to ltr (the non-isolated scan
 * hits "Task" before any non-isolated Persian character, since "وظیفه" is
 * hidden inside the bold isolate), while the sentence is overwhelmingly
 * Persian -- confirmed via a rendered-DOM diagnostic before this fix, and
 * exactly the same failure class as the W1 production evidence ("Task:
 * (وظیفه)" embedded in a Persian line). Using ONE majority-based function
 * (computeMajorityDirection) for both the block's own dir AND the dominant
 * threaded into nested inline elements (see BlockDominantDirectionContext
 * below) removes the possibility of the two disagreeing at all -- there is
 * only one computation now, not two.
 */
function computeBlockDirection(node: ReactNode): "rtl" | "ltr" {
  return computeMajorityDirection(extractPlainText(node));
}

/**
 * Task 20b, W1: carries a block's own resolved direction (computed once, by
 * `p`/`ul`/`ol`/`li` via computeBlockDirection) DOWN to nested inline
 * elements (`strong`/`em`/`a`) so they use the SAME dominant for their own
 * internal minority-run isolation, instead of each independently
 * recomputing it from only their own local text.
 *
 * WHY this needs React Context rather than a plain function argument:
 * react-markdown builds `<strong>`/`<em>`/`<a>` as unevaluated ReactElement
 * descriptors (`{type: strongComponent, props: {children: "..."}}`) that
 * are only actually RENDERED (i.e. the component function is only called)
 * once React reconciles them as children of the already-rendered `<p>`/
 * `<li>` -- by which point `p`'s/`li`'s own render function has already
 * returned. There is no direct call-time handoff possible; Context is the
 * standard mechanism for a value determined by an ancestor to reach a
 * descendant component that hasn't rendered yet.
 *
 * A `null` value means "no enclosing block computed one" (defensive only --
 * every real markdown render path always has a `p`/`li`/`ul`/`ol` ancestor);
 * consumers fall back to their own local computation in that case.
 */
const BlockDominantDirectionContext = createContext<"rtl" | "ltr" | null>(null);

/**
 * Decides whether a `<strong>`/`<em>`/`<a>` element should use the block's
 * propagated dominant (task 20b, W1) for its OWN internal minority-run
 * isolation, or fall back to computing one locally from just its own text
 * (task 17f/20's original behaviour).
 *
 * ONLY when the element's own content genuinely mixes both scripts (e.g.
 * "Task: (وظیفه)" -- the W1 production shape): the block's dominant is
 * needed here so the mixed content resolves the same way it would as plain
 * paragraph text, instead of the element picking its own contradictory
 * local direction (this task's own root-cause finding).
 *
 * When the element's own content is single-script (e.g. "SmartFlow"), it
 * is intentionally left to fall back to LOCAL computation instead: that
 * content is already fully protected by the element's own CSS
 * `unicode-bidi: isolate` boundary, so there is nothing for a block-level
 * dominant to usefully change -- passing it anyway would make R2's
 * single-script fast path evaluate against the WRONG (externally supplied)
 * dominant and wrap the element's entire content in a redundant, pointless
 * inner `<bdi>` -- caught as a real regression (via a rendered-DOM
 * diagnostic) against an existing task 17f test during this task.
 */
function resolveInlineElementDominant(children: ReactNode, blockDominant: "rtl" | "ltr" | null): "rtl" | "ltr" | undefined {
  if (blockDominant === null) return undefined;
  return isMixedScript(extractPlainText(children)) ? blockDominant : undefined;
}

/**
 * Applies `isolateBidiRunsInText` to every string child of a React children
 * value (a single string, or the array react-markdown passes for a
 * paragraph/list-item with multiple text/element children). Non-string
 * children (already-rendered elements, e.g. a nested `<strong>`) pass
 * through unchanged -- those get their own isolation independently, from
 * their own component override, so nothing is ever wrapped twice.
 *
 * Task 20, Part B (bidi at inline boundaries): two fixes layered on top of
 * the task 17f behaviour above, both needed for "**Task**: (وظیفه)"-shaped
 * content (a bold run followed by an attached mark and/or a parenthesized
 * phrase in the OPPOSITE script):
 *   1. ONE shared dominant direction is computed from the FULL block's
 *      extracted text (every child, including inside elements), not
 *      recomputed independently per string fragment -- see
 *      isolateBidiRunsInText's own dominantOverride comment for why a
 *      trailing fragment computed in isolation gets the wrong answer.
 *   2. A string child that immediately follows a non-string (element)
 *      sibling and starts with an attached mark (":", ".", "!", "?") has
 *      that mark split off into its OWN small isolate, rendered as the
 *      very next sibling of the preceding element. A lone neutral
 *      character living unisolated in the ambient (block) direction is
 *      exactly what let it drift to the wrong visual side in the
 *      production evidence ("Task :(وظیفه)" instead of "(وظیفه) Task:");
 *      isolating it fixes its position the same way isolating a whole run
 *      already does elsewhere in this file, without touching the
 *      preceding element (already isolated by its own component override)
 *      at all.
 *
 * `dominantOverride` (task 20b, W1): when this call is for a child of a
 * markdown block (`p`/`li`) or inline element (`strong`/`em`/`a`) that
 * already computed its OWN shared dominant (computeBlockDirection, threaded
 * down via BlockDominantDirectionContext), that value is passed in here so
 * this function's per-string minority-run splitting agrees with it, rather
 * than each nested element recomputing its own local (and potentially
 * contradictory) dominant -- see BlockDominantDirectionContext's own
 * comment for why this mismatch was the actual W1 root cause. Omitted
 * (every DIRECT caller outside the markdown block components -- the
 * ChatBubble compact-mode body, conversation titles, attached-file names,
 * personal-memory cards) falls back to the ORIGINAL task 17f/20 behaviour
 * (resolveMessageBaseDirection over this call's own text) completely
 * unchanged -- this task's fix scope is the markdown block/inline-element
 * boundary, not those simpler single-call sites.
 */
export function isolateEmbeddedBidiRuns(children: ReactNode, dominantOverride?: "rtl" | "ltr"): ReactNode {
  const list = Array.isArray(children) ? children : [children];
  const dominant = dominantOverride ?? resolveMessageBaseDirection(extractPlainText(list));

  return list.flatMap((child, index) => {
    if (typeof child !== "string") return [child];

    const previousChild = index > 0 ? list[index - 1] : undefined;
    const previousWasElement = previousChild !== undefined && typeof previousChild !== "string";

    if (previousWasElement) {
      const leadingMarkMatch = child.match(LEADING_ATTACHED_MARK_PATTERN);
      if (leadingMarkMatch) {
        const mark = leadingMarkMatch[0];
        const rest = child.slice(mark.length);
        const markNode = <bdi key={`bidi-anchor-${index}`}>{mark}</bdi>;
        return rest.length > 0 ? [markNode, ...isolateBidiRunsInText(rest, `bidi-${index}`, dominant)] : [markNode];
      }
    }

    return isolateBidiRunsInText(child, `bidi-${index}`, dominant);
  });
}

// CSS unicode-bidi: isolate is the preferred mechanism (task 11e's own
// wording) for an inline element that is ALREADY its own separate markdown
// node -- strong/em/code/a -- since no text-splitting is needed there: the
// browser isolates the whole element as one unit while `dir="auto"` still
// lets that unit pick its own internal base direction from its own first
// strong character.
export const BIDI_ISOLATE_STYLE = { unicodeBidi: "isolate" } as const;

export interface DirectionalMarkdownClassNames {
  readonly p?: string;
  readonly ul?: string;
  readonly ol?: string;
  readonly li?: string;
  readonly strong?: string;
  readonly em?: string;
  readonly code?: string;
  readonly pre?: string;
  readonly a?: string;
}

/**
 * Builds a react-markdown `components` object that is direction-aware:
 * every block gets an EXPLICIT direction (first-strong heuristic via
 * resolveMessageBaseDirection + extractPlainText, applied per block, not
 * per page -- task 20, Part B; see p/ul/ol/li's own comment below for why
 * this replaced native `dir="auto"`); paragraphs and list items
 * additionally isolate any embedded MINORITY-direction runs in their own
 * text (task 17f, R3);
 * bold/emphasis are isolated as whole units via CSS `unicode-bidi:
 * isolate`; inline code, fenced code blocks, and links are always LTR
 * (task 17f, R5 -- code/URLs/technical identifiers must never flip with
 * the surrounding paragraph). Lists use logical `ps-*`/`padding-inline-
 * start` classes (task 17f, R6) so markers and indentation mirror
 * correctly under RTL, including nested lists (a nested `<ul>`/`<ol>` goes
 * through this SAME component recursively). Callers pass their own
 * existing class names so this only changes direction handling, never
 * visual styling (task 17f, R8).
 */
export function createDirectionalMarkdownComponents(classNames: DirectionalMarkdownClassNames = {}) {
  return {
    // Task 20, Part B / redesigned task 20b, W1: p/ul/ol/li use an EXPLICIT
    // direction (computeBlockDirection -- majority-of-strong-characters,
    // see its own comment), not native `dir="auto"`. This is the SAME fix
    // ChatPage.tsx's ChatBubble root already applies at the message level
    // (`dir={resolveMessageBaseDirection(content)}`, task 17e) -- extended
    // here to the block-level markdown overrides, the one place in this
    // file that was still relying on the browser's own dir="auto" search
    // (or, until task 20b, a weaker heuristic prone to the same class of
    // bug -- see computeBlockDirection's own comment for the root cause).
    // The SAME resolved value is threaded down to nested strong/em/a via
    // BlockDominantDirectionContext, so a bold/emphasis/link run's own
    // internal minority-isolation never contradicts its enclosing block.
    p({ children }: Readonly<{ children?: ReactNode }>) {
      const dominant = computeBlockDirection(children);
      return (
        <p dir={dominant} className={classNames.p}>
          <BlockDominantDirectionContext.Provider value={dominant}>
            {isolateEmbeddedBidiRuns(children, dominant)}
          </BlockDominantDirectionContext.Provider>
        </p>
      );
    },
    // Task 20b, W3: the list's own SHARED dominant (computed from every
    // item's combined text, not per item) is what `li` uses for its own
    // `dir` below -- this is what keeps every item's BULLET/MARKER on the
    // same side regardless of that one item's own script, since marker
    // placement follows the element's `dir`, not its content. Each item's
    // own TEXT still gets correctly isolated/reordered via
    // isolateEmbeddedBidiRuns's minority-run logic (an all-Latin item in an
    // RTL list becomes one isolated LTR run, same mechanism as any other
    // minority run in this file) -- only the ITEM BOX's own direction (and
    // therefore its marker) is now list-wide rather than per-item.
    ul({ children }: Readonly<{ children?: ReactNode }>) {
      const dominant = computeBlockDirection(children);
      return (
        <ul dir={dominant} className={classNames.ul}>
          <BlockDominantDirectionContext.Provider value={dominant}>{children}</BlockDominantDirectionContext.Provider>
        </ul>
      );
    },
    ol({ children }: Readonly<{ children?: ReactNode }>) {
      const dominant = computeBlockDirection(children);
      return (
        <ol dir={dominant} className={classNames.ol}>
          <BlockDominantDirectionContext.Provider value={dominant}>{children}</BlockDominantDirectionContext.Provider>
        </ol>
      );
    },
    li({ children }: Readonly<{ children?: ReactNode }>) {
      // These are react-markdown component overrides (plain functions used
      // AS components by react-markdown's renderer), not hooks called
      // conditionally; every call here is a genuine top-level component
      // render, satisfying the Rules of Hooks despite the lint rule's
      // static heuristic not recognising this lowercase-named call shape.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const listDominant = useContext(BlockDominantDirectionContext);
      const dominant = listDominant ?? computeBlockDirection(children);
      return (
        <li dir={dominant} className={classNames.li}>
          {isolateEmbeddedBidiRuns(children, dominant)}
        </li>
      );
    },
    strong({ children }: Readonly<{ children?: ReactNode }>) {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- see li's own note above.
      const blockDominant = useContext(BlockDominantDirectionContext);
      return (
        <strong dir="auto" style={BIDI_ISOLATE_STYLE} className={classNames.strong}>
          {isolateEmbeddedBidiRuns(children, resolveInlineElementDominant(children, blockDominant))}
        </strong>
      );
    },
    em({ children }: Readonly<{ children?: ReactNode }>) {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- see li's own note above.
      const blockDominant = useContext(BlockDominantDirectionContext);
      return (
        <em dir="auto" style={BIDI_ISOLATE_STYLE} className={classNames.em}>
          {isolateEmbeddedBidiRuns(children, resolveInlineElementDominant(children, blockDominant))}
        </em>
      );
    },
    code({ children }: Readonly<{ children?: ReactNode }>) {
      // Task 17f, R5: inline code (identifiers, snippets) is always LTR,
      // isolated from the surrounding paragraph either way.
      return (
        <code dir="ltr" style={BIDI_ISOLATE_STYLE} className={classNames.code}>
          {children}
        </code>
      );
    },
    pre({ children }: Readonly<{ children?: ReactNode }>) {
      // Task 17f, R5: a FENCED code block is its own block-level node (not
      // inside a <p>), so it needs its own explicit LTR treatment --
      // otherwise it would inherit whatever ambient direction the message
      // happens to have, which is wrong for a shell command/snippet
      // regardless of the surrounding Persian prose.
      return (
        <pre dir="ltr" style={BIDI_ISOLATE_STYLE} className={classNames.pre}>
          {children}
        </pre>
      );
    },
    a({ children, href }: Readonly<{ children?: ReactNode; href?: string }>) {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- see li's own note above.
      const blockDominant = useContext(BlockDominantDirectionContext);
      return (
        <a dir="auto" style={BIDI_ISOLATE_STYLE} className={classNames.a} href={href} target="_blank" rel="noreferrer">
          {isolateEmbeddedBidiRuns(children, resolveInlineElementDominant(children, blockDominant))}
        </a>
      );
    },
  };
}
