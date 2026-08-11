import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDirectionalMarkdownComponents,
  isolateBidiRunsInText,
  isolateEmbeddedBidiRuns,
} from "./bidiText";
import ReactMarkdown from "react-markdown";

// Task 11e: correct bidirectional (RTL/LTR) rendering for mixed
// Persian/Latin content. Root-cause production evidence (see the ChatPage
// bubble tests for the full trace): a Persian reply containing a bare
// Latin token ("SmartFlow") rendered scrambled because message containers
// lacked per-message base direction, embedded opposite-direction runs
// weren't bidi-isolated, and the markdown renderer wasn't direction-aware.

describe("isolateBidiRunsInText / isolateEmbeddedBidiRuns", () => {
  it("pure-FA text: no Latin content at all -- the whole string is one Persian run, isolated as a single <bdi> (harmless, dir=\"auto\" on the container already establishes rtl)", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("امروز دو کار فعال داری.")}</p>);
    expect(html).toBe('<p dir="auto"><bdi>امروز دو کار فعال داری</bdi>.</p>');
  });

  it("pure-EN text: no Persian content at all -- the whole string is one Latin run, isolated as a single <bdi>", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("Review active tasks today.")}</p>);
    expect(html).toBe('<p dir="auto"><bdi>Review active tasks today</bdi>.</p>');
  });

  it("FA-with-Latin-token (the exact production evidence string): the embedded Latin word is isolated as its own run, with a literal (unwrapped) space on each side separating it from the surrounding Persian isolates -- proving the isolate wraps exactly the Latin run, nothing more, nothing less", () => {
    const evidence = "لطفاً برای دیدن تسک‌های امروزتون، اپلیکیشن SmartFlow رو باز کنید.";
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns(evidence)}</p>);

    expect(html).toContain("<bdi>SmartFlow</bdi>");
    // "SmartFlow" is flanked by a literal space immediately outside its own
    // <bdi> on both sides (not swallowed into the Persian run before/after).
    expect(html).toContain("</bdi> <bdi>SmartFlow</bdi> <bdi>");
    // The full string's visible text content survives round-trip untouched.
    const rendered = html.replace(/<[^>]+>/g, "");
    expect(rendered).toBe(evidence);
  });

  it("FA-with-Latin-token: trailing punctuation directly attached to a Latin run (no space) stays outside the isolate too", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("این SmartFlow. است.")}</p>);
    expect(html).toContain("<bdi>SmartFlow</bdi>.");
    expect(html).not.toContain("<bdi>SmartFlow.</bdi>");
  });

  it("EN-with-FA-quote: an English sentence quoting a Persian phrase isolates the Persian run the same way a Latin run inside Persian text is isolated -- symmetric, not Latin-only", () => {
    const original = "SmartFlow calls this feature (به به) internally.";
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns(original)}</p>);
    expect(html).toContain("<bdi>به به</bdi>");
    expect(html).toContain("<bdi>SmartFlow calls this feature</bdi>");
    const rendered = html.replace(/<[^>]+>/g, "");
    expect(rendered).toBe(original);
  });

  it("does not wrap children that are already elements (e.g. a nested <strong> from markdown) -- only string children are split, so nothing is ever double-isolated", () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns(["Check ", <strong key="s">SmartFlow</strong>, " now."])}</p>,
    );
    expect(html).toBe('<p dir="auto"><bdi>Check</bdi> <strong>SmartFlow</strong> <bdi>now</bdi>.</p>');
  });

  it("isolateBidiRunsInText returns the original string unchanged (wrapped in a single-element array) when there is no match at all", () => {
    expect(isolateBidiRunsInText("   ", "k")).toEqual(["   "]);
    expect(isolateBidiRunsInText("...", "k")).toEqual(["..."]);
  });

  // Task 17d, V3: production evidence -- "(Advanced Technical Support):" in
  // a Persian sentence placed the colon/paren boundary on the wrong side.
  // A parenthesized run with a mark from :.!? DIRECTLY attached to its
  // closing paren (no space) now isolates as ONE unit (brackets, content,
  // and that mark together) -- deliberately narrower than "any trailing
  // punctuation on any run" (see the "SmartFlow." case above, and the
  // no-attached-punctuation case just below, both UNCHANGED by this).
  it("V3: a parenthesized Latin phrase with an attached trailing colon isolates as ONE unit -- brackets, content, and the colon together (the exact production evidence string)", () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns("لطفا با تیم (Advanced Technical Support): تماس بگیرید.")}</p>,
    );
    expect(html).toContain("<bdi>(Advanced Technical Support):</bdi>");
    expect(html).not.toContain("<bdi>Advanced Technical Support</bdi>");
  });

  it("V3: the same parenthesized-run isolation also fires for a trailing period, exclamation mark, or question mark", () => {
    for (const mark of [".", "!", "?"]) {
      const html = renderToString(
        <p dir="auto">{isolateEmbeddedBidiRuns(`این (Advanced Technical Support)${mark} است.`)}</p>,
      );
      expect(html).toContain(`<bdi>(Advanced Technical Support)${mark}</bdi>`);
    }
  });

  it("V3: applies symmetrically to a Persian phrase parenthesized inside Latin text with an attached trailing mark", () => {
    const html = renderToString(
      <p dir="auto">{isolateEmbeddedBidiRuns("Contact the team (پشتیبانی فنی): available 24/7.")}</p>,
    );
    expect(html).toContain("<bdi>(پشتیبانی فنی):</bdi>");
  });

  it("V3: a parenthesized run with NO mark directly attached to its closing paren still isolates only its bare content, parens excluded -- the narrower scoping this task deliberately kept (regression guard alongside the pre-existing به-به test above)", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("این (Advanced Technical Support) خوب است.")}</p>);
    expect(html).toContain("<bdi>Advanced Technical Support</bdi>");
    expect(html).not.toContain("<bdi>(Advanced Technical Support)</bdi>");
  });

  it("V3: a SINGLE-TOKEN parenthetical (e.g. a numeric count like \"(2).\") is deliberately NOT pulled into one unit -- a different, already-tested pattern (see ChatPage.test.tsx's 'Review active tasks (2).' case) that this task's fix must not disturb", () => {
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns("Review active tasks (2).")}</p>);
    expect(html).toContain("<bdi>Review active tasks</bdi> (<bdi>2</bdi>).");
    expect(html).not.toContain("<bdi>(2).</bdi>");
  });

  it("V3: full text content survives round-trip through the parenthesized-run isolation unchanged", () => {
    const original = "لطفا با تیم (Advanced Technical Support): تماس بگیرید.";
    const html = renderToString(<p dir="auto">{isolateEmbeddedBidiRuns(original)}</p>);
    const rendered = html.replace(/<[^>]+>/g, "");
    expect(rendered).toBe(original);
  });
});

describe("createDirectionalMarkdownComponents", () => {
  const components = createDirectionalMarkdownComponents({ p: "p-class", ul: "ul-class", li: "li-class" });

  it("FA markdown with bold + a bulleted list: dir=\"auto\" is applied per block, list markers/indentation are direction-aware (no hardcoded left/right), and the bold Latin run is isolated as a whole unit via CSS unicode-bidi: isolate", () => {
    const md = "**SmartFlow** به شما کمک می‌کند:\n\n- تسک اول\n- تسک دوم";
    const html = renderToString(<ReactMarkdown components={components}>{md}</ReactMarkdown>);

    expect(html).toContain('<p dir="auto" class="p-class">');
    expect(html).toContain('<ul dir="auto" class="ul-class">');
    expect(html).toContain('<li dir="auto" class="li-class">');
    expect(html.match(/<li dir="auto"/g)?.length).toBe(2);
    // Bold is isolated as ONE unit via CSS, not split into per-word <bdi>s.
    expect(html).toMatch(/<strong dir="auto" style="unicode-bidi:\s*isolate"[^>]*>/);
    expect(html).toContain("SmartFlow</bdi></strong>");
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
});
