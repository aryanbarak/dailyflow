import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
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

describe("createDirectionalMarkdownComponents", () => {
  const components = createDirectionalMarkdownComponents({ p: "p-class", ul: "ul-class", li: "li-class" });

  it("FA markdown with bold + a bulleted list: dir=\"auto\" is applied per block, list markers/indentation are direction-aware (no hardcoded left/right), and the bold Latin run (single-script content) renders unwrapped inside its own CSS-isolated <strong> -- task 17f, R2 applies inside strong/em too, since isolateEmbeddedBidiRuns is the same shared function", () => {
    const md = "**SmartFlow** به شما کمک می‌کند:\n\n- تسک اول\n- تسک دوم";
    const html = renderToString(<ReactMarkdown components={components}>{md}</ReactMarkdown>);

    expect(html).toContain('<p dir="auto" class="p-class">');
    expect(html).toContain('<ul dir="auto" class="ul-class">');
    expect(html).toContain('<li dir="auto" class="li-class">');
    expect(html.match(/<li dir="auto"/g)?.length).toBe(2);
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
  it("R6: a nested bullet list inside a Persian top-level list gets its own dir=\"auto\" and logical padding-inline-start at every level", () => {
    const componentsWithPadding = createDirectionalMarkdownComponents({ ul: "ps-4", li: "li-class" });
    const md = "- تسک اول\n  - زیرتسک الف\n  - زیرتسک ب\n- تسک دوم";
    const html = renderToString(<ReactMarkdown components={componentsWithPadding}>{md}</ReactMarkdown>);
    // Top-level ul + one nested ul, both dir="auto" and using the SAME
    // logical ps-4 class (never a hardcoded pl-4/pr-4).
    expect(html.match(/<ul dir="auto" class="ps-4">/g)?.length).toBe(2);
    expect(html).not.toMatch(/\bpl-4\b|\bpr-4\b/);
    expect(html).toContain("زیرتسک الف");
    expect(html).toContain("زیرتسک ب");
  });
});
