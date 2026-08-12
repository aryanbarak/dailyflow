// @vitest-environment jsdom
//
// SmartFlow -- task 17c, production evidence E2 + E3. The PO reported
// Persian assistant bubbles with punctuation on the wrong side ("!سلام",
// ":بررسی") and Persian user bubbles left-aligned. Task instructions:
// "verify the rendered path goes through 11e's markdown components; add a
// BEHAVIORAL test (rendered DOM order/attributes for a Persian string with
// trailing punctuation), not attribute-only."
//
// Investigation (see the task 17c report, section B) found dir="auto" and
// 11e's isolateEmbeddedBidiRuns/createDirectionalMarkdownComponents were
// ALREADY correctly wired on this render path -- confirmed here by
// rendering real Persian strings and inspecting the actual DOM, not by
// re-reading the source. These tests lock that in as a genuine regression
// guard, kept SEPARATE from bidiText.test.tsx (which tests the utility in
// isolation) and ChatPage.test.tsx (the pipeline/UX-boundary suite, which
// must stay unmodified) -- this file tests the ACTUAL message-render path
// (AssistantContent/ChatBubble) a Persian string travels through end to
// end, which neither of those existing suites exercises directly.
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}));

import { AssistantContent, ChatBubble } from "./ChatPage";

describe("E2: Persian assistant text with trailing punctuation (task 17c; superseded by task 17f's bidiText.tsx rewrite)", () => {
  // Task 17f: "سلام! بررسی: کار انجام نشده است." is single-script Persian
  // (task 17f, R2 -- digits/neutrals don't count as a second script), so
  // it now renders COMPLETELY UNCHANGED -- no <bdi> at all. This ISN'T a
  // weaker guarantee than the old "isolate the run, leave punctuation
  // outside" design; it's the actual root-cause fix task 17e's own
  // diagnostic called for: a paragraph that is never partially swallowed
  // by an isolate always has real strong characters directly in the DOM
  // for its own dir="auto" to resolve from, so the terminal marks can
  // never end up "outside the isolate at the wrong edge" in the first
  // place -- there is no isolate for them to be outside OF.
  it("renders single-script Persian text with terminal punctuation completely unwrapped -- no <bdi> needed, an explicit dir=\"rtl\" (task 20, Part B -- was dir=\"auto\") resolves directly from the real Persian characters in the DOM", () => {
    const { container } = render(<AssistantContent content="سلام! بررسی: کار انجام نشده است." />);
    const paragraph = container.querySelector("p")!;
    expect(paragraph).toHaveAttribute("dir", "rtl");
    expect(paragraph.querySelectorAll("bdi").length).toBe(0);
    expect(paragraph.textContent).toBe("سلام! بررسی: کار انجام نشده است.");
    expect(paragraph.innerHTML).toBe("سلام! بررسی: کار انجام نشده است.");
  });

  // NOTE: a getComputedStyle(paragraph).direction assertion was deliberately
  // NOT added here. A throwaway diagnostic found jsdom's own dir="auto"
  // resolution is INCONSISTENT for structurally-equivalent cases that
  // should be identical per the HTML auto-directionality algorithm (bdi
  // descendants are excluded from the parent's own text scan either way):
  // <div dir="auto"><bdi>text</bdi></div> resolves "ltr" (bdi as a DIRECT
  // child), but <div dir="auto"><span><bdi>text</bdi></span></div> resolves
  // "rtl" (bdi nested one level deeper) -- for the SAME Persian text, with
  // no spec-relevant difference between the two shapes. This looks like a
  // jsdom bidi-implementation limitation, not a real cross-browser bug --
  // jsdom does not implement a full Unicode Bidi Algorithm -- so asserting
  // a specific computed direction here would be testing jsdom's quirks, not
  // this codebase's correctness. Real-browser verification of Persian
  // assistant message punctuation placement is listed as a pending
  // device-QA item in the task 17c report instead of asserted here.

  it("a mixed Persian+Latin sentence still isolates only the embedded run, not the whole message", () => {
    const { container } = render(<AssistantContent content="این یک تست SmartFlow است." />);
    const paragraph = container.querySelector("p")!;
    const bdiTexts = Array.from(paragraph.querySelectorAll("bdi")).map((el) => el.textContent);
    expect(bdiTexts).toContain("SmartFlow");
  });
});

describe("E3: Persian user bubble alignment (task 17c; direction resolution reworked by task 17e, W1)", () => {
  // Task 17e, W1: the bubble's own dir is now an EXPLICIT "rtl"/"ltr"
  // (resolveMessageBaseDirection in ChatPage.tsx), not "auto" -- a bare
  // dir="auto" silently fails for exactly a pure single-language message
  // (isolateEmbeddedBidiRuns wraps its ENTIRE strong-character content into
  // <bdi>, and dir="auto"'s own search skips <bdi> content, finding
  // nothing to detect a direction from) -- see ChatPage.tsx's own comment
  // on resolveMessageBaseDirection for the full production trace. This also
  // makes the assertion below reliable in jsdom for the first time: an
  // EXPLICIT dir="rtl"/"ltr" is a plain UA-stylesheet mapping, not
  // jsdom's own auto-directionality implementation (flagged elsewhere in
  // this file, see the NOTE above, as inconsistent for structurally
  // equivalent cases).
  it("resolves CSS direction to rtl for Persian user content (text-align:start therefore resolves to the visual right, not a hardcoded left)", () => {
    const { container } = render(<ChatBubble role="user" content="امروز چطوری؟" />);
    const bubble = container.querySelector('[dir="rtl"]')!;
    expect(bubble).not.toBeNull();
    expect(getComputedStyle(bubble).direction).toBe("rtl");
  });

  it("resolves CSS direction to ltr for English user content in the SAME component (proves the direction is genuinely content-driven, not a fixed rtl override)", () => {
    const { container } = render(<ChatBubble role="user" content="How are you today?" />);
    const bubble = container.querySelector('[dir="ltr"]')!;
    expect(bubble).not.toBeNull();
    expect(getComputedStyle(bubble).direction).toBe("ltr");
  });

  it("no hardcoded text-align:left / text-left class exists anywhere on the bubble markup (would silently defeat dir=auto's correct start-alignment)", () => {
    const { container } = render(<ChatBubble role="user" content="امروز چطوری؟" />);
    expect(container.innerHTML).not.toMatch(/\btext-left\b/);
    expect(container.innerHTML).not.toMatch(/text-align:\s*left/);
  });

  // Task 17f: "امروز چطوری؟" is single-script Persian, so it renders
  // unwrapped (R2) -- same as the assistant path in E2 above. A MIXED
  // user-bubble message still isolates its minority run, unaffected.
  it("single-script Persian user-bubble text renders unwrapped (no <bdi>); a mixed user-bubble message still isolates its minority run", () => {
    const { container: pure } = render(<ChatBubble role="user" content="امروز چطوری؟" />);
    expect(pure.querySelector("bdi")).toBeNull();

    const { container: mixed } = render(<ChatBubble role="user" content="امروز با Codex کار می‌کنم." />);
    const bdi = mixed.querySelector("bdi");
    expect(bdi).not.toBeNull();
    expect(bdi?.textContent).toBe("Codex");
  });
});

// Task 17e, W1 (bidi ARCHITECTURE superseded by task 17f's rewrite of
// bidiText.tsx, see that file's own header comment; this regression guard
// itself still stands). Device evidence (post-17d build, app UI language
// non-Persian, conversation Persian): PURE-Persian bubbles ("!سلام",
// ":برایتان لیست می‌کنم") showed terminal punctuation at the wrong visual
// end. Root cause: a pure single-language message had ALL of its strong
// characters captured by isolateEmbeddedBidiRuns's <bdi> run(s), leaving
// nothing but neutral terminal punctuation OUTSIDE any <bdi> --
// dir="auto"'s own browser-native detection explicitly skips <bdi>
// content, so it found no strong character to resolve from and fell back
// to the ambient/inherited direction -- which, with nothing between the
// bubble and ChatPage's own root to interrupt it, was the page root's
// dir={isRTL ? 'rtl' : 'ltr'} (ChatPage.tsx), driven by the APP UI
// LANGUAGE, not by what was actually typed. Task 17f fixes this at BOTH
// layers: resolveMessageBaseDirection still gives the bubble container an
// explicit, content-derived dir (never "auto"), AND bidiText.tsx no longer
// isolates single-script text into a <bdi> at all -- so there is no longer
// even an isolate for the terminal mark to be "outside" of. These four
// combinations are the exhaustive matrix of {app UI language} x {message
// language} the original device evidence's own hypothesis named.
describe("W1 (task 17e/17f): message direction resolves from the message's own content, independent of the app-language page root", () => {
  const renderInAppRoot = (appDir: "rtl" | "ltr", content: string) =>
    render(
      <div dir={appDir}>
        <ChatBubble role="assistant" content={content} />
      </div>,
    );

  // The bubble's own content div is located via its unique `.rounded-xl`
  // class (the ancestor app-root wrapper and the avatar tile never carry
  // that class), NOT via a bare `[dir=...]` selector on the whole
  // container -- the ancestor wrapper legitimately carries the OTHER dir
  // value (it stands in for the real app root), so asserting "no element
  // anywhere has dir=X" would wrongly fail on that ancestor itself.
  it("FA-app / FA-msg: a Persian app root with a Persian message resolves the bubble to rtl; single-script text renders unwrapped (no <bdi>), the terminal marks sit as plain text in the correct logical position", () => {
    const { container } = renderInAppRoot("rtl", "سلام! برایتان لیست می‌کنم:");
    const bubble = container.querySelector(".rounded-xl")!;
    expect(bubble).toHaveAttribute("dir", "rtl");
    expect(bubble.querySelector("bdi")).toBeNull();
    expect(bubble.textContent).toContain("سلام! برایتان لیست می‌کنم:");
  });

  it("EN-app / FA-msg (the reported broken combo): an English app root with a Persian message STILL resolves the bubble to rtl -- the app's own UI-language root must not leak in", () => {
    const { container } = renderInAppRoot("ltr", "سلام! برایتان لیست می‌کنم:");
    const bubble = container.querySelector(".rounded-xl")!;
    expect(bubble).toHaveAttribute("dir", "rtl");
    expect(bubble.querySelector("bdi")).toBeNull();
    expect(bubble.textContent).toContain("سلام! برایتان لیست می‌کنم:");
  });

  it("FA-app / EN-msg: a Persian app root with an English message resolves the bubble to ltr, not the app root's rtl", () => {
    const { container } = renderInAppRoot("rtl", "Let me write it.");
    const bubble = container.querySelector(".rounded-xl")!;
    expect(bubble).toHaveAttribute("dir", "ltr");
    expect(bubble.querySelector("bdi")).toBeNull();
    expect(bubble.textContent).toContain("Let me write it.");
  });

  it("EN-app / EN-msg: an English app root with an English message resolves the bubble to ltr", () => {
    const { container } = renderInAppRoot("ltr", "Let me write it.");
    const bubble = container.querySelector(".rounded-xl")!;
    expect(bubble).toHaveAttribute("dir", "ltr");
    expect(bubble.querySelector("bdi")).toBeNull();
    expect(bubble.textContent).toContain("Let me write it.");
  });
});

// Task 17e, W2. Device evidence: assistant bubbles capped at ~70-80% width
// on a phone-narrow column wasted both margins. Below lg, assistant
// bubbles now use the full column width minus the avatar gutter, user
// bubbles (no avatar) use 92%; the 70ch reading-measure cap now only
// applies at lg+ (see ChatBubble's own comment in ChatPage.tsx).
describe("W2 (task 17e, width updated by task 17g Y2 once the avatar gutter was removed): mobile bubble width below lg, 70ch cap only at lg+", () => {
  // Task 17g, Y2: the assistant avatar (and the gutter its w-7 + gap-2.5
  // used to reserve, `calc(100%-2.5rem)`) is gone -- the assistant bubble
  // now uses the full column width (max-w-full) below lg, starting flush
  // at the column edge.
  it("assistant bubble: full width (no more avatar gutter to reserve) below lg, 70ch cap at lg+", () => {
    const { container } = render(<ChatBubble role="assistant" content="Hello there." />);
    const bubble = container.querySelector(".rounded-xl")!;
    expect(bubble.className).toMatch(/\bmax-w-full\b/);
    expect(bubble.className).not.toMatch(/calc\(100%-2\.5rem\)/);
    expect(bubble.className).toMatch(/lg:max-w-\[70ch\]/);
  });

  it("user bubble: 92% below lg, 70ch cap at lg+", () => {
    const { container } = render(<ChatBubble role="user" content="Hello there." />);
    const bubble = container.querySelector(".rounded-xl")!;
    expect(bubble.className).toMatch(/max-w-\[92%\]/);
    expect(bubble.className).toMatch(/lg:max-w-\[70ch\]/);
  });

  it("no leftover sm:max-w-[70ch] or plain max-w-[80%] remains on either bubble role", () => {
    const assistant = render(<ChatBubble role="assistant" content="Hi." />).container.innerHTML;
    const user = render(<ChatBubble role="user" content="Hi." />).container.innerHTML;
    for (const html of [assistant, user]) {
      expect(html).not.toMatch(/\bsm:max-w-\[70ch\]/);
      expect(html).not.toMatch(/\bmax-w-\[80%\]/);
    }
  });
});
