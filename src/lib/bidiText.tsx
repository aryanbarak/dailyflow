import type { ReactNode } from "react";

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
// longer needed and is dropped). Two alternatives, tried in this order:
//  1. `(RUN)` + a REQUIRED trailing mark -- unchanged from task 17d's V3:
//     the closing paren is only pulled INTO the isolate together with an
//     attached mark. A parenthesized run with nothing attached to its own
//     closing paren (task 17d's protected "(به به)"/"(Advanced Technical
//     Support)" cases, no mark follows) does NOT match this alternative,
//     and falls through to alternative 2 below, which starts matching
//     one character later (RUN_SOURCE never itself starts on "(") -- so
//     the parens are correctly left OUTSIDE the isolate, exactly as
//     before.
//  2. A bare RUN with an OPTIONAL trailing mark -- the actual task 17f
//     generalisation: "SmartFlow." / "AI/ML." / "Codex:" now isolate their
//     attached mark too, whether or not any parens are involved.
function runWithAttachedMarks(runSource: string): string {
  return `(?:\\(${runSource}\\)[:.!?]|${runSource}[:.!?]?)`;
}
const LATIN_RUN_WITH_MARKS = runWithAttachedMarks(LATIN_RUN_SOURCE);
const PERSIAN_RUN_WITH_MARKS = runWithAttachedMarks(PERSIAN_RUN_SOURCE);
const LATIN_MINORITY_PATTERN = new RegExp(LATIN_RUN_WITH_MARKS, "g");
const PERSIAN_MINORITY_PATTERN = new RegExp(PERSIAN_RUN_WITH_MARKS, "g");

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
 */
export function isolateBidiRunsInText(text: string, keyPrefix: string): ReactNode[] {
  const dominant = resolveMessageBaseDirection(text);
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
 * Applies `isolateBidiRunsInText` to every string child of a React children
 * value (a single string, or the array react-markdown passes for a
 * paragraph/list-item with multiple text/element children). Non-string
 * children (already-rendered elements, e.g. a nested `<strong>`) pass
 * through unchanged -- those get their own isolation independently, from
 * their own component override, so nothing is ever wrapped twice.
 */
export function isolateEmbeddedBidiRuns(children: ReactNode): ReactNode {
  const list = Array.isArray(children) ? children : [children];
  return list.flatMap((child, index) =>
    typeof child === "string" ? isolateBidiRunsInText(child, `bidi-${index}`) : [child],
  );
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
 * every block gets `dir="auto"` (first-strong heuristic, applied per
 * block, not per page); paragraphs and list items additionally isolate any
 * embedded MINORITY-direction runs in their own text (task 17f, R3);
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
    p({ children }: Readonly<{ children?: ReactNode }>) {
      return (
        <p dir="auto" className={classNames.p}>
          {isolateEmbeddedBidiRuns(children)}
        </p>
      );
    },
    ul({ children }: Readonly<{ children?: ReactNode }>) {
      return (
        <ul dir="auto" className={classNames.ul}>
          {children}
        </ul>
      );
    },
    ol({ children }: Readonly<{ children?: ReactNode }>) {
      return (
        <ol dir="auto" className={classNames.ol}>
          {children}
        </ol>
      );
    },
    li({ children }: Readonly<{ children?: ReactNode }>) {
      return (
        <li dir="auto" className={classNames.li}>
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
