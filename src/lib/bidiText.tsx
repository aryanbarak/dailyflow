import type { ReactElement, ReactNode } from "react";

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
  const dominant = dominantOverride ?? resolveMessageBaseDirection(text);
  const minorityIsPersian = dominant === "ltr";
  const minorityStrongPattern = minorityIsPersian ? STRONG_RTL_PATTERN : STRONG_LTR_PATTERN;

  // R2 fast path: no minority-direction strong character anywhere in this
  // text at all -- single-script (or no strong character at all), return
  // unchanged.
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
 * Reads ONLY the text that is NOT inside a nested element -- an element
 * child (e.g. a `<strong>` from markdown, already isolated via its own
 * component override) is treated as opaque and contributes nothing. This
 * deliberately MIRRORS what a real browser's native `dir="auto"` search
 * already does (this file's own header comment: it "explicitly SKIPS <bdi>
 * contents", and the same isolate semantics apply to any unicode-bidi:
 * isolate element) -- used as the PRIMARY signal in computeBlockDirection
 * below, so a block like "**SmartFlow** به شما کمک می‌کند" still resolves
 * RTL from "به" the same way native dir="auto" already correctly does,
 * instead of being thrown off by reading INTO the isolated "SmartFlow".
 */
function extractNonIsolatedText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNonIsolatedText).join("");
  return "";
}

/**
 * The direction for a markdown block's own `dir` attribute (task 20, Part
 * B) -- see p/ul/ol/li's own comment in createDirectionalMarkdownComponents
 * for why this replaced a bare `dir="auto"`. Two-tier, matching native
 * dir="auto" behavior for the common case while adding a safety net for the
 * one case native dir="auto" cannot handle at all:
 *   1. PRIMARY: resolve from only the NON-isolated text (extractNonIsolatedText)
 *      -- identical to what the browser's own dir="auto" search already
 *      does when it works correctly, so a block with real non-isolated
 *      dominant-script text elsewhere (the common case for every reported
 *      production example) is completely unaffected by this change.
 *   2. FALLBACK: only when there is NO strong character anywhere outside
 *      an isolated element (the degenerate case -- a block that IS, or
 *      begins and ends with, nothing but an isolated run, e.g. a list item
 *      that is just "**پروژه من**" alone) -- read INTO the isolated
 *      content too (extractPlainText), rather than silently defaulting to
 *      ltr the way native dir="auto" would.
 */
function computeBlockDirection(node: ReactNode): "rtl" | "ltr" {
  const nonIsolated = extractNonIsolatedText(node);
  if (FIRST_STRONG_PATTERN.test(nonIsolated)) return resolveMessageBaseDirection(nonIsolated);
  return resolveMessageBaseDirection(extractPlainText(node));
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
 */
export function isolateEmbeddedBidiRuns(children: ReactNode): ReactNode {
  const list = Array.isArray(children) ? children : [children];
  const dominant = resolveMessageBaseDirection(extractPlainText(list));

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
    // Task 20, Part B: p/ul/ol/li use an EXPLICIT direction computed from
    // their own extracted plain text (resolveMessageBaseDirection +
    // extractPlainText), not native `dir="auto"`. This is the SAME fix
    // ChatPage.tsx's ChatBubble root already applies at the message level
    // (`dir={resolveMessageBaseDirection(content)}`, task 17e) -- extended
    // here to the block-level markdown overrides, the one place in this
    // file that was still relying on the browser's own dir="auto" search.
    // That native search explicitly SKIPS isolated content (this file's own
    // header comment), so a block that BEGINS with (or entirely consists
    // of) an isolated inline run -- e.g. a list item "**پروژه من**" with a
    // bold Persian label and nothing else -- would have nothing left for
    // dir="auto" to find and silently fall back to the wrong direction.
    // extractPlainText reads through isolation, so this never has that
    // blind spot; for a plain-text-only block (no isolated children at
    // all) it resolves to exactly the same answer dir="auto" already gave,
    // so this is a strict robustness improvement, not a behavior tradeoff.
    p({ children }: Readonly<{ children?: ReactNode }>) {
      return (
        <p dir={computeBlockDirection(children)} className={classNames.p}>
          {isolateEmbeddedBidiRuns(children)}
        </p>
      );
    },
    ul({ children }: Readonly<{ children?: ReactNode }>) {
      return (
        <ul dir={computeBlockDirection(children)} className={classNames.ul}>
          {children}
        </ul>
      );
    },
    ol({ children }: Readonly<{ children?: ReactNode }>) {
      return (
        <ol dir={computeBlockDirection(children)} className={classNames.ol}>
          {children}
        </ol>
      );
    },
    li({ children }: Readonly<{ children?: ReactNode }>) {
      return (
        <li dir={computeBlockDirection(children)} className={classNames.li}>
          {isolateEmbeddedBidiRuns(children)}
        </li>
      );
    },
    strong({ children }: Readonly<{ children?: ReactNode }>) {
      return (
        <strong dir="auto" style={BIDI_ISOLATE_STYLE} className={classNames.strong}>
          {isolateEmbeddedBidiRuns(children)}
        </strong>
      );
    },
    em({ children }: Readonly<{ children?: ReactNode }>) {
      return (
        <em dir="auto" style={BIDI_ISOLATE_STYLE} className={classNames.em}>
          {isolateEmbeddedBidiRuns(children)}
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
      return (
        <a dir="auto" style={BIDI_ISOLATE_STYLE} className={classNames.a} href={href} target="_blank" rel="noreferrer">
          {isolateEmbeddedBidiRuns(children)}
        </a>
      );
    },
  };
}
