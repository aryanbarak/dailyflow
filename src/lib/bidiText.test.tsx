import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  computeMajorityDirection,
  createDirectionalMarkdownComponents,
  isolateBidiRunsInText,
  isolateEmbeddedBidiRuns,
  resolveMessageBaseDirection,
} from "./bidiText";
import ReactMarkdown from "react-markdown";

// Task 11e: correct bidirectional (RTL/LTR) rendering for mixed
// Persian/Latin content. Root-cause production evidence (see the ChatPage
// bubble tests for the full trace): a Persian reply containing a bare
// Latin token ("SmartFlow") rendered scrambled because message containers
// lacked per-message base direction, embedded opposite-direction runs
// weren't bidi-isolated, and the markdown renderer wasn't direction-aware.
//
// Task 17f rewrite: this file's ORIGINAL isolation strategy wrapped EVERY
// run of either script symmetrically -- including the paragraph's own
// DOMINANT-script text. That is exactly what caused task 17e's production
// bug: once 100% of a block's strong characters are swallowed into <bdi>
// isolates, the HTML `dir="auto"` algorithm (which explicitly skips <bdi>
// content when searching for a first strong character) finds nothing and
// falls back to the ambient/app-language direction instead of the
// message's own. The fix isolates ONLY the MINORITY-direction run relative
// to the block's own dominant direction; the dominant-script text is left
// as plain, unwrapped characters so `dir="auto"` always has real strong
// characters to resolve from directly. Every assertion below that expected
// the OLD "wrap everything" behavior has been rewritten to expect the new,
// minority-only behavior -- each rewritten case says so explicitly.

describe("resolveMessageBaseDirection (promoted from ChatPage.tsx's task 17e helper into this shared utility, task 17f)", () => {
  it("returns rtl when the first strong character is Persian", () => {
    expect(resolveMessageBaseDirection("سلام دنیا")).toBe("rtl");
  });
  it("returns ltr when the first strong character is Latin", () => {
    expect(resolveMessageBaseDirection("Hello world")).toBe("ltr");
  });
  it("ignores leading digits/neutrals/spaces and finds the first REAL strong character", () => {
    expect(resolveMessageBaseDirection("123 -- سلام")).toBe("rtl");
    expect(resolveMessageBaseDirection("123 -- Hello")).toBe("ltr");
  });
  it("falls back to ltr when there is no strong character at all", () => {
    expect(resolveMessageBaseDirection("123 456 :)")).toBe("ltr");
  });
});

describe("isolateBidiRunsInText / isolateEmbeddedBidiRuns", () => {
  // Task 17f, R2: single-script text (digits/neutrals never count as a
  // second script) is returned COMPLETELY UNCHANGED -- no <bdi> at all.
  // This is the direct fix for the 17e root cause: a block that is never
  // fully swallowed by an isolate always has real strong characters left
  // for `dir="auto"` to resolve its OWN direction from.
  it("R2: pure-FA text returns completely unchanged, no <bdi> at all (was previously wrapped whole -- exactly the shape that caused task 17e's production bug)", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("امروز دو کار فعال داری.")}</p>);
    expect(html).toBe('<p dir="auto">امروز دو کار فعال داری.</p>');
  });

  it("R2: pure-EN text returns completely unchanged, no <bdi> at all (same fix, symmetric)", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("Review active tasks today.")}</p>);
    expect(html).toBe('<p dir="auto">Review active tasks today.</p>');
  });

  it("R2: digits, spaces, and neutral punctuation alone never make text 'mixed' -- a Persian sentence with numbers is still single-script Persian, unchanged", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("امروز ۲ کار و 2 جلسه داری.")}</p>);
    expect(html).not.toContain("<bdi>");
  });

  it("FA-with-Latin-token (the exact production evidence string): the embedded Latin word is isolated as its own run; the surrounding Persian (the DOMINANT script) is left as plain, unwrapped text -- task 17f, R3", () => {
    const evidence = "لطفاً برای دیدن تسک‌های امروزتون، اپلیکیشن SmartFlow رو باز کنید.";
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns(evidence)}</p>);

    expect(html).toContain("<bdi>SmartFlow</bdi>");
    // The surrounding Persian text is NOT wrapped in any <bdi> of its own
    // anymore -- exactly one <bdi> exists in the whole output, for the
    // minority Latin run only.
    expect(html.match(/<bdi>/g)?.length).toBe(1);
    expect(html).toContain("اپلیکیشن <bdi>SmartFlow</bdi> رو");
    // The full string's visible text content survives round-trip untouched.
    const rendered = html.replace(/<[^>]+>/g, "");
    expect(rendered).toBe(evidence);
  });

  // Task 17f, R3: generalises task 17d's V3 rule (previously parentheses-
  // only) to ANY minority run -- a trailing . : ! ? DIRECTLY attached (no
  // space) to a bare Latin/Persian run now belongs INSIDE its own isolate.
  // This deliberately SUPERSEDES the old rule (this exact case used to
  // assert the opposite -- punctuation stays OUTSIDE): the PO's real usage
  // (task 17f) showed technical terms like "AI/ML." with their sentence-
  // final mark attached needing to move as ONE visual unit, not have the
  // mark separately re-attach to the Persian side.
  it("R3 (supersedes the old rule): trailing punctuation DIRECTLY attached (no space) to a minority run now isolates INSIDE that run's <bdi>", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("این SmartFlow. است.")}</p>);
    expect(html).toContain("<bdi>SmartFlow.</bdi>");
    expect(html).not.toContain("<bdi>SmartFlow</bdi>.");
  });

  it("R3: a minority run followed by a SPACE (no direct attachment) is isolated bare, unaffected by the attached-mark rule", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("این SmartFlow است.")}</p>);
    expect(html).toContain("<bdi>SmartFlow</bdi>");
  });

  it("EN-with-FA-quote: an English sentence quoting a Persian phrase isolates ONLY the minority Persian run -- the dominant English text ('SmartFlow calls this feature') is left unwrapped, same R3 rule applied symmetrically", () => {
    const original = "SmartFlow calls this feature (به به) internally.";
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns(original)}</p>);
    expect(html).toContain("<bdi>به به</bdi>");
    expect(html).not.toContain("<bdi>(به به)</bdi>"); // no mark attached to ")" -- parens stay excluded
    expect(html).not.toContain("<bdi>SmartFlow calls this feature</bdi>"); // dominant text, no longer wrapped
    expect(html.match(/<bdi>/g)?.length).toBe(1);
    const rendered = html.replace(/<[^>]+>/g, "");
    expect(rendered).toBe(original);
  });

  it("does not wrap children that are already elements (e.g. a nested <strong> from markdown) -- only string children are split, so nothing is ever double-isolated. Both 'Check' and 'now' are dominant-script (English) text around a Latin <strong>, so under R3 neither is wrapped anymore", () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns(["Check ", <strong key="s">SmartFlow</strong>, " now."])}</p>,
    );
    expect(html).toBe('<p dir="auto">Check <strong>SmartFlow</strong> now.</p>');
  });

  it("isolateBidiRunsInText returns the original string unchanged (wrapped in a single-element array) when there is no match at all", () => {
    expect(isolateBidiRunsInText("   ", "k")).toEqual(["   "]);
    expect(isolateBidiRunsInText("...", "k")).toEqual(["..."]);
  });

  it("R3: a parenthesized Latin phrase with an attached trailing colon isolates as ONE unit -- brackets, content, and the colon together (the exact task 17d production evidence string, still correct under the generalised rule)", () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns("لطفا با تیم (Advanced Technical Support): تماس بگیرید.")}</p>,
    );
    expect(html).toContain("<bdi>(Advanced Technical Support):</bdi>");
    expect(html).not.toContain("<bdi>Advanced Technical Support</bdi>");
  });

  it("R3: the same parenthesized-run isolation also fires for a trailing period, exclamation mark, or question mark", () => {
    for (const mark of [".", "!", "?"]) {
      const html = renderToString(
        <p dir="auto">{isolateEmbeddedBidiRuns(`این (Advanced Technical Support)${mark} است.`)}</p>,
      );
      expect(html).toContain(`<bdi>(Advanced Technical Support)${mark}</bdi>`);
    }
  });

  it("R3: applies symmetrically to a Persian phrase parenthesized inside Latin text with an attached trailing mark", () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns("Contact the team (پشتیبانی فنی): available 24/7.")}</p>,
    );
    expect(html).toContain("<bdi>(پشتیبانی فنی):</bdi>");
  });

  it("R3: a parenthesized run with NO mark directly attached to its closing paren still isolates only its bare content, parens excluded -- unchanged from task 17d's V3 (regression guard alongside the به-به test above)", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("این (Advanced Technical Support) خوب است.")}</p>);
    expect(html).toContain("<bdi>Advanced Technical Support</bdi>");
    expect(html).not.toContain("<bdi>(Advanced Technical Support)</bdi>");
  });

  // Task 17d's protected regression, now satisfied by construction rather
  // than by a special-cased lookahead: "Review active tasks (2)." is
  // single-script English (a lone digit has no strong bidi type of its
  // own -- task 17f, R2), so R2's fast path returns it COMPLETELY
  // UNCHANGED. Nothing is wrapped at all, which trivially guarantees "(2)."
  // is never pulled into one unit with anything.
  it("R2/R3: '(2).' -- a numeric count -- is untouched: the whole sentence is single-script English, so nothing isolates at all", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("Review active tasks (2).")}</p>);
    expect(html).toBe('<p dir="auto">Review active tasks (2).</p>');
  });

  it("R2/R3: '(2).' inside a Persian-dominant sentence also stays untouched -- a lone digit is never treated as a minority run", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("کارهای فعال (2) را بررسی کن.")}</p>);
    expect(html).not.toContain("<bdi>(2)</bdi>");
    expect(html).not.toContain("<bdi>2</bdi>");
  });

  it("R3: full text content survives round-trip through the parenthesized-run isolation unchanged", () => {
    const original = "لطفا با تیم (Advanced Technical Support): تماس بگیرید.";
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns(original)}</p>);
    const rendered = html.replace(/<[^>]+>/g, "");
    expect(rendered).toBe(original);
  });
});

// Task 20, Part B: bidi at inline boundaries. Root cause -- a neutral mark
// (colon/period/etc.) attached OUTSIDE a preceding inline element
// (<strong>/<em>/<a>, itself already isolated by markdown) lives in a
// SEPARATE sibling text node with nothing anchoring it, AND that trailing
// text node's own dominant direction was previously computed in ISOLATION
// from the rest of the block, giving the wrong answer for a fragment like
// ": (وظیفه)" that has no Latin characters of its own at all. Unit-level
// coverage of isolateEmbeddedBidiRuns's array-based mechanics directly
// (see ChatPageBidiMatrix.test.tsx and bidiTextConsumers.test.tsx for the
// full EN-root/FA-root integration matrix through real consumers).
describe("isolateEmbeddedBidiRuns -- attached-mark anchoring at inline-element boundaries (task 20, Part B)", () => {
  it("a leading colon on a string child immediately following an element isolates into its own <bdi>, anchored right after that element", () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns([<strong key="s">Task</strong>, ": (وظیفه) را انجام بده."])}</p>,
    );
    // Bare <strong> here (this test calls isolateEmbeddedBidiRuns directly
    // with a plain React element fixture, not through createDirectional-
    // MarkdownComponents's own strong() override -- same convention the
    // existing "does not wrap children that are already elements" test
    // above already uses) -- the anchor <bdi> is what's under test.
    expect(html).toContain("<strong>Task</strong><bdi>:</bdi> ");
    // The Persian parenthetical, now correctly evaluated against the
    // BLOCK's shared dominant (ltr, from "Task") rather than its own
    // fragment-local dominant, isolates as its own run too.
    expect(html).toContain("<bdi>وظیفه</bdi>");
    const rendered = html.replace(/<[^>]+>/g, "");
    expect(rendered).toBe("Task: (وظیفه) را انجام بده.");
  });

  it("a string child with NO leading attached mark, following an element, is unaffected -- no spurious anchor <bdi> is introduced", () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns([<strong key="s">Task</strong>, " تمام شد."])}</p>,
    );
    expect(html).toBe('<p dir="auto"><strong>Task</strong> <bdi>تمام شد.</bdi></p>');
  });

  it("a leading attached mark on the FIRST child (no preceding element at all) is NOT split off -- the anchoring rule only applies right after an element sibling", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns(": شروع می‌کنیم")}</p>);
    expect(html).not.toContain("<bdi>:</bdi>");
  });

  it("the SAME shared dominant direction is used for every fragment of a multi-child block, not recomputed independently per fragment", () => {
    // Without a shared dominant, ": (وظیفه)" alone would compute its OWN
    // dominant as Persian (its only strong script) and never isolate
    // "وظیفه" as a minority run at all -- this proves the block-wide
    // computation actually drives the fragment's own isolation decision.
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns([<strong key="s">Task</strong>, ": (وظیفه)"])}</p>,
    );
    expect(html).toContain("<bdi>وظیفه</bdi>");
  });

  it("multiple element siblings each still isolate independently via their own component, with attached marks anchored to the correct one", () => {
    const html = renderToString(
      <p dir="auto">
        {isolateEmbeddedBidiRuns([<strong key="a">Task</strong>, ": (وظیفه) و ", <strong key="b">Reminder</strong>, ": (یادآور)."])}
      </p>,
    );
    expect(html).toContain("<strong>Task</strong><bdi>:</bdi> ");
    expect(html).toContain("<strong>Reminder</strong><bdi>:</bdi> ");
  });
});

describe("square-bracket phrase isolation (task 20, Part B -- generalises the existing round-paren rule)", () => {
  it("a bracketed Persian phrase inside dominant Latin text isolates as its own unit, brackets included only when a trailing mark is attached", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("Due: [سه روز] from today.")}</p>);
    expect(html).toContain("<bdi>سه روز</bdi>");
    expect(html).not.toContain("<bdi>[سه روز]</bdi>");
  });

  it("a bracketed phrase with an attached trailing mark isolates AS ONE UNIT including the brackets -- symmetric with the round-paren rule", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("این [Advanced Technical Support]: مهم است.")}</p>);
    expect(html).toContain("<bdi>[Advanced Technical Support]:</bdi>");
  });

  it("a bracketed Latin phrase inside dominant Persian text isolates symmetrically", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("تاریخ: [Due Soon] است.")}</p>);
    expect(html).toContain("<bdi>Due Soon</bdi>");
  });

  it("brackets containing ONLY a digit (no strong character) are never treated as a run -- mirrors the '(2).' protected exception", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("Review active tasks [2].")}</p>);
    expect(html).toBe('<p dir="auto">Review active tasks [2].</p>');
  });
});

describe("createDirectionalMarkdownComponents", () => {
  const components = createDirectionalMarkdownComponents({ p: "p-class", ul: "ul-class", li: "li-class" });

  it("renders semantic headings separately from list items, with no bullet on the heading", () => {
    const componentsWithHeadings = createDirectionalMarkdownComponents({
      h3: "heading-class",
      ul: "ul-class",
      li: "li-class",
    });
    const md = "### معماری و استقرار هوش مصنوعی (Deployment – MLOps & AI Architecture)\n\n- مورد اول\n  - زیرمورد";
    const html = renderToString(<ReactMarkdown components={componentsWithHeadings}>{md}</ReactMarkdown>);

    expect(html).toContain('<h3 dir="rtl" class="heading-class">');
    expect(html).toMatch(/<\/h3>\s*<ul/);
    expect(html).not.toMatch(/<li[^>]*>.*معماری و استقرار هوش مصنوعی/);
    expect(html.match(/<ul dir="rtl" class="ul-class">/g)?.length).toBe(2);
  });

  it("keeps common LTR technical phrases isolated inside Persian prose", () => {
    const md = [
      "برای API از Flask/FastAPI یا Node.js استفاده کنید.",
      "پلتفرم‌های ابری: AWS (SageMaker), Google Cloud (Vertex AI), Azure",
      "این الگو برای RAG و MLOps در نسخه 2 مناسب است.",
    ].join("\n\n");
    const html = renderToString(<ReactMarkdown components={components}>{md}</ReactMarkdown>);

    expect(html).toContain("<bdi>API</bdi>");
    expect(html).toContain("<bdi>Flask/FastAPI</bdi>");
    expect(html).toContain("<bdi>Node.js</bdi>");
    expect(html).toContain("<bdi>AWS (SageMaker), Google Cloud (Vertex AI), Azure</bdi>");
    expect(html).toContain("<bdi>RAG</bdi>");
    expect(html).toContain("<bdi>MLOps</bdi>");
  });

  it("covers blockquote, ordered list, bold text inside a list item, inline code, code block, and links", () => {
    const componentsFull = createDirectionalMarkdownComponents({
      blockquote: "quote-class",
      ol: "ol-class",
      li: "li-class",
      code: "code-class",
      pre: "pre-class",
      a: "link-class",
    });
    const md = [
      "> نکته: برای `npm run build` آماده باش.",
      "",
      "1. **متن مهم** داخل مورد لیست",
      "2. لینک https://example.com و [ایمیل](mailto:test@example.com)",
      "",
      "```",
      "npm run build",
      "```",
    ].join("\n");
    const html = renderToString(<ReactMarkdown components={componentsFull}>{md}</ReactMarkdown>);

    expect(html).toContain('<blockquote dir="rtl" class="quote-class">');
    expect(html).toContain('<ol dir="rtl" class="ol-class">');
    expect(html).toContain('<li dir="rtl" class="li-class">');
    expect(html).toMatch(/<strong dir="auto" style="unicode-bidi:\s*isolate"[^>]*>متن مهم<\/strong>/);
    expect(html).toMatch(/<code dir="ltr" style="unicode-bidi:\s*isolate" class="code-class">npm run build<\/code>/);
    expect(html).toMatch(/<pre dir="ltr" style="unicode-bidi:\s*isolate" class="pre-class"><code/);
    expect(html).toMatch(/<a dir="auto" style="unicode-bidi:\s*isolate" class="link-class" href="mailto:test@example.com"/);
  });

  it("FA markdown with bold + a bulleted list: an EXPLICIT direction (task 20, Part B -- was dir=\"auto\") is applied per block, list markers/indentation are direction-aware (no hardcoded left/right), and the bold Latin run (single-script content) renders unwrapped inside its own CSS-isolated <strong> -- task 17f, R2 applies inside strong/em too, since isolateEmbeddedBidiRuns is the same shared function", () => {
    const md = "**SmartFlow** به شما کمک می‌کند:\n\n- تسک اول\n- تسک دوم";
    const html = renderToString(<ReactMarkdown components={components}>{md}</ReactMarkdown>);

    // Task 20, Part B: p/ul/li now compute an EXPLICIT rtl/ltr instead of
    // native dir="auto" (see bidiText.tsx's own comment on
    // createDirectionalMarkdownComponents for why) -- this block correctly
    // resolves "rtl" from "به" (the first NON-isolated strong character;
    // "SmartFlow" is skipped because it's already isolated inside its own
    // <strong>), exactly what a working native dir="auto" search would also
    // have found. This assertion changed from the literal string "auto" to
    // the actual resolved value; the underlying correctness (RTL block,
    // bold Latin run isolated as its own unit) is unchanged and still
    // verified below.
    expect(html).toContain('<p dir="rtl" class="p-class">');
    expect(html).toContain('<ul dir="rtl" class="ul-class">');
    expect(html).toContain('<li dir="rtl" class="li-class">');
    expect(html.match(/<li dir="rtl"/g)?.length).toBe(2);
    // Bold is isolated as ONE unit via CSS on the <strong> itself; its
    // single-script ("SmartFlow") content is no longer ALSO wrapped in an
    // inner <bdi> -- the outer <strong dir="auto" unicode-bidi:isolate> is
    // sufficient, and R2's fast path leaves the plain text alone.
    expect(html).toMatch(/<strong dir="auto" style="unicode-bidi:\s*isolate"[^>]*>SmartFlow<\/strong>/);
    expect(html).toContain("تسک اول");
    expect(html).toContain("تسک دوم");
  });

  it("inline code and links inside an RTL paragraph are isolated as whole units and stay LTR/left-to-right internally", () => {
    const md = "برای اجرا از `npm run build` استفاده کن یا به [این لینک](https://example.com) برو.";
    const html = renderToString(<ReactMarkdown components={components}>{md}</ReactMarkdown>);

    expect(html).toMatch(/<code dir="ltr" style="unicode-bidi:\s*isolate"[^>]*>npm run build<\/code>/);
    expect(html).toMatch(/<a dir="auto" style="unicode-bidi:\s*isolate"[^>]*href="https:\/\/example\.com"[^>]*>/);
    expect(html).toContain(">این لینک<");
  });

  it("a bare (undecorated) Latin word inside an RTL markdown paragraph is still isolated -- the fix does not depend on the model wrapping product names in markdown syntax", () => {
    const md = "لطفاً برای دیدن تسک‌های امروزتون، اپلیکیشن SmartFlow رو باز کنید.";
    const html = renderToString(<ReactMarkdown components={components}>{md}</ReactMarkdown>);
    expect(html).toContain("<bdi>SmartFlow</bdi>");
  });

  // Task 17f, R5: fenced code blocks are their own block-level markdown
  // node (not inside a <p>) and must always render LTR regardless of the
  // surrounding message's direction.
  it("R5: a fenced code block inside Persian text renders dir=\"ltr\", isolated from the surrounding RTL flow", () => {
    const md = "این دستور را اجرا کن:\n\n```\nnpm run build\n```";
    const html = renderToString(<ReactMarkdown components={components}>{md}</ReactMarkdown>);
    expect(html).toMatch(/<pre dir="ltr" style="unicode-bidi:\s*isolate"[^>]*><code[^>]*>npm run build/);
  });

  // Task 17f, R6: nested lists must inherit the SAME direction-aware
  // treatment as the top level -- react-markdown routes a nested <ul>
  // through this same `ul` component recursively.
  it("R6: a nested bullet list inside a Persian top-level list gets its own EXPLICIT rtl direction (task 20, Part B -- was dir=\"auto\") and logical padding-inline-start at every level", () => {
    const componentsWithPadding = createDirectionalMarkdownComponents({ ul: "ps-4", li: "li-class" });
    const md = "- تسک اول\n  - زیرتسک الف\n  - زیرتسک ب\n- تسک دوم";
    const html = renderToString(<ReactMarkdown components={componentsWithPadding}>{md}</ReactMarkdown>);
    // Top-level ul + one nested ul, both resolve "rtl" (Persian content)
    // and use the SAME logical ps-4 class (never a hardcoded pl-4/pr-4).
    expect(html.match(/<ul dir="rtl" class="ps-4">/g)?.length).toBe(2);
    expect(html).not.toMatch(/\bpl-4\b|\bpr-4\b/);
    expect(html).toContain("زیرتسک الف");
    expect(html).toContain("زیرتسک ب");
  });
});

// ===========================================================================
// Task 20b, W1: computeMajorityDirection -- the unified, word-count-based
// majority rule that replaced the two DIFFERENT (and sometimes
// contradictory) dominant-direction heuristics task 20 shipped with a
// block's own `dir` and a nested inline element's internal minority-run
// isolation. See the function's own doc comment for the two simpler
// measures (raw character count, then run count) that were tried and
// rejected during this task, each caught by re-running the existing suite.
// ===========================================================================
describe("computeMajorityDirection (task 20b, W1)", () => {
  it("a Persian sentence using a short Latin object stays rtl even though the Latin phrase has MORE CHARACTERS -- the exact regression a raw character-count majority caused (task 11e/17e's own test)", () => {
    expect(computeMajorityDirection("این نتیجه برای Review active tasks است.")).toBe("rtl");
  });

  it('"Task: (وظیفه) را انجام بده." (the W1 production evidence, embedded in its realistic surrounding sentence) resolves rtl -- four Persian words outweigh one Latin word', () => {
    expect(computeMajorityDirection("Task: (وظیفه) را انجام بده.")).toBe("rtl");
  });

  it('"SmartFlow به شما کمک می‌کند:" resolves rtl -- a single Latin run count is fooled into a tie against a WORD-MERGED Persian run (the run-count measure\'s own regression, since "به شما کمک می‌کند" is one contiguous run but four real words)', () => {
    expect(computeMajorityDirection("SmartFlow به شما کمک می‌کند:")).toBe("rtl");
  });

  it('a one-word-vs-one-word TIE ("Task: (وظیفه)" alone, no surrounding sentence) falls back to first-strong and stays ltr -- preserves today\'s behavior for the genuinely ambiguous case rather than flipping on a coin-flip word count', () => {
    expect(computeMajorityDirection("Task: (وظیفه)")).toBe("ltr");
  });

  it("a clearly Latin-dominant sentence with a short Persian gloss stays ltr", () => {
    expect(computeMajorityDirection("SmartFlow supports Persian (فارسی) too.")).toBe("ltr");
  });

  it("pure single-script text in either direction is unaffected", () => {
    expect(computeMajorityDirection("امروز خوب پیش رفت.")).toBe("rtl");
    expect(computeMajorityDirection("Everything looks good today.")).toBe("ltr");
  });

  it("no strong character at all defaults to ltr, matching resolveMessageBaseDirection's own no-match default", () => {
    expect(computeMajorityDirection("123 456 :)")).toBe("ltr");
  });
});

// ===========================================================================
// Task 20b, W2: mixed-script bracket/paren groups isolate as ONE atomic
// unit (delimiters + content + an attached trailing mark), generalising
// the existing single-script-only alternatives. Exercised here directly at
// the isolateEmbeddedBidiRuns/markdown level (the ChatPageBidiMatrix suite
// covers the full ChatBubble-rendered production-evidence shapes).
// ===========================================================================
describe("mixed-script bracket/paren group isolation (task 20b, W2)", () => {
  it('a square-bracket group whose content mixes Persian and Latin isolates as ONE unit, with the embedded Latin word isolated AGAIN inside it', () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns("[لطفاً در Task ثبت کنم.] متشکرم.")}</p>,
    );
    // renderToString inserts <!-- --> comment separators between adjacent
    // sibling text nodes (a hydration-safety artifact, not app markup) --
    // stripped before matching, same as the surrounding tests' use of
    // `.replace(/<[^>]+>/g, "")` elsewhere in this file for text-content
    // comparisons.
    const stripped = html.replace(/<!--\s*-->/g, "");
    expect(stripped).toContain("<bdi>[لطفاً در <bdi>Task</bdi> ثبت کنم.]</bdi>");
  });

  it("a round-paren group whose content mixes scripts, with an attached trailing period, isolates as one unit including the period", () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns("یکی از این دو را نصب کن: (Anaconda یا VS Code).")}</p>,
    );
    const stripped = html.replace(/<!--\s*-->/g, "");
    expect(stripped).toContain("<bdi>(Anaconda <bdi>یا</bdi> VS Code).</bdi>");
  });

  it("a bracket group whose content is SINGLE-script (no mixing) is left to the existing per-run alternatives, unchanged -- this pass does not fire", () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns("[تاریخ سررسید سه روز دیگر است.] توجه کنید.")}</p>,
    );
    expect(html).not.toMatch(/<bdi>\[/);
    expect(html).toContain("[تاریخ سررسید سه روز دیگر است.]");
  });

  it('task 17d\'s "(2)." exception still holds inside a mixed-content sentence -- a bare digit is never part of a run, mixed-bracket or otherwise', () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns("Review active tasks (2) در لیست Task دیده می‌شود.")}</p>,
    );
    // "(2)" itself never isolates (no strong character inside it at all);
    // only the two actual word runs do.
    expect(html).not.toMatch(/<bdi>\(2\)/);
  });
});
