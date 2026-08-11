import type { ReactNode } from "react";

// SmartFlow bidi utility (task 11e) -- shared by every surface that renders
// model- or user-generated text that can mix Persian (RTL) and Latin (LTR)
// content: chat bubbles, the assistant markdown renderer, briefing views,
// the per-task assistant answer, and personal-memory cards. One utility,
// used everywhere the bug appeared, rather than a per-page patch.
//
// Root cause this fixes: the Unicode Bidi Algorithm (UAX#9) renders a
// contiguous run of strong characters embedded in an opposite-direction
// paragraph in ITS OWN internal order, but it does NOT isolate that run
// from the surrounding bidi context on its own -- neutral characters
// immediately OUTSIDE the run (spaces, and especially punctuation) resolve
// which side they attach to based on nearby STRONG characters, so a bare
// Latin word like "SmartFlow" embedded in Persian text (or a Persian
// phrase quoted inside English text) can visually reorder relative to its
// own surrounding punctuation and neighboring words. `<bdi>` (and its exact
// CSS equivalent, `unicode-bidi: isolate`) creates a genuine isolation
// boundary: the run's own internal direction is still auto-detected from
// its own content, but the surrounding text can no longer be pulled into
// it or reordered around it. This is applied symmetrically -- a Latin run
// inside RTL text and a Persian run inside LTR text are both isolated the
// same way, since the bug is about the OPPOSITE-direction run relative to
// its context, not about Persian or Latin specifically.

// Each run must start and end on a strong character of its own script --
// internal spaces and separators (., -, _, /, :, @, +, #, and, for Persian,
// the ZWNJ used in normal enclitic joining) are allowed so a whole PHRASE
// ("Rejected fact", "SmartFlow rocks", "به به") isolates as ONE run, not
// one run per word. The trailing strong-character requirement is load-
// bearing: it forces the regex engine to backtrack away from ANY trailing
// space or punctuation, so "SmartFlow." only matches "SmartFlow" and
// "SmartFlow رو" only matches "SmartFlow" -- that trailing punctuation or
// space is deliberately left OUTSIDE the isolate, since it belongs to --
// and must visually attach to -- the surrounding script's direction, not
// the run's own. This default stays UNCHANGED (see the bidiText.test.tsx
// "SmartFlow." case) -- ordinary sentence-final punctuation after a bare
// run is genuinely part of the SURROUNDING sentence, not the run.
const LATIN_RUN_SOURCE = "[A-Za-zÀ-ÖØ-öø-ÿ0-9](?:[A-Za-zÀ-ÖØ-öø-ÿ0-9 ._\\-/:@+#]*[A-Za-zÀ-ÖØ-öø-ÿ0-9])?";
const PERSIAN_RUN_SOURCE = "[\\u0600-\\u06FF](?:[\\u0600-\\u06FF \\u200c._\\-/:@+#]*[\\u0600-\\u06FF])?";

// Task 17d, V3: production evidence -- "(Advanced Technical Support):" (a
// parenthesized Latin PHRASE immediately followed by a colon) placed its
// colon/paren boundary on the wrong side of the isolate. Deliberately
// narrow on TWO axes, each protecting a real, already-tested case:
//  1. The trailing [:.!?] is REQUIRED, not optional -- a parenthesized run
//     with NO attached trailing mark (the existing "SmartFlow calls this
//     feature (به به) internally." test below, where ")" is followed by a
//     space) still isolates only its bare content, parens excluded.
//  2. The lookahead below requires an internal SPACE -- i.e. this only
//     fires for a multi-word PHRASE, not a single token. Without this, a
//     numeric annotation like "Review active tasks (2)." (an existing,
//     already-tested ChatPage.test.tsx case -- a COUNT in parens, a
//     genuinely different pattern from a parenthesized label) would
//     wrongly get pulled into "(2)." as one unit too; single-token
//     parentheticals keep their pre-existing bare-content-only isolation.
// Applied symmetrically to a Persian phrase parenthesized inside Latin
// text too, matching this file's existing "isolate symmetrically, not
// Latin-only" principle. Listed FIRST in the alternation so it's tried
// before the bare-run patterns at the "(" position; if it doesn't match
// (no ")", no attached trailing mark, or single-token content) the engine
// falls through to the bare-run patterns, unchanged from before this task.
const PAREN_WRAPPED_RUN_SOURCE = `\\((?=[^)]*\\s)(?:${LATIN_RUN_SOURCE}|${PERSIAN_RUN_SOURCE})\\)[:.!?]`;

const BIDI_RUN_PATTERN = new RegExp(`${PAREN_WRAPPED_RUN_SOURCE}|${LATIN_RUN_SOURCE}|${PERSIAN_RUN_SOURCE}`, "g");

/**
 * Splits a plain string into alternating literal segments and isolated
 * `<bdi>` runs (Latin OR Persian). Returns the original string unchanged
 * (in a one-element array) when no run is found, so callers can always
 * treat the result as a ReactNode array.
 */
export function isolateBidiRunsInText(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let runIndex = 0;

  for (const match of text.matchAll(BIDI_RUN_PATTERN)) {
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
  readonly li?: string;
  readonly strong?: string;
  readonly em?: string;
  readonly code?: string;
  readonly a?: string;
}

/**
 * Builds a react-markdown `components` object that is direction-aware:
 * every block gets `dir="auto"` (first-strong heuristic, applied per
 * block, not per page); paragraphs and list items additionally isolate any
 * bare embedded opposite-direction runs in their own text; bold/emphasis/
 * inline code/links are isolated as whole units via CSS
 * `unicode-bidi: isolate`. Callers pass their own existing class names so
 * this only changes direction handling, never visual styling.
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
      // Code content (identifiers, URLs, snippets) is treated as LTR
      // unconditionally, isolated from the surrounding paragraph either way.
      return (
        <code dir="ltr" style={BIDI_ISOLATE_STYLE} className={classNames.code}>
          {children}
        </code>
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
