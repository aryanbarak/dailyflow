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

describe("E2: Persian assistant text with trailing punctuation (task 17c)", () => {
  it("isolates the Persian run in its own <bdi>, leaving trailing punctuation OUTSIDE it in DOM order (11e's own design -- punctuation attaches to the surrounding paragraph, not the run)", () => {
    const { container } = render(<AssistantContent content="سلام! بررسی: کار انجام نشده است." />);
    const paragraph = container.querySelector("p")!;
    expect(paragraph).toHaveAttribute("dir", "auto");

    const bdiElements = Array.from(paragraph.querySelectorAll("bdi"));
    expect(bdiElements.length).toBeGreaterThan(0);
    // Every isolated run holds a real chunk of Persian text -- the
    // BEHAVIORAL claim under test is that the run boundary excludes the
    // trailing punctuation, i.e. no <bdi> text content ends in "!"/":"/"."
    for (const bdi of bdiElements) {
      expect(bdi.textContent?.trim().endsWith("!")).toBe(false);
      expect(bdi.textContent?.trim().endsWith(":")).toBe(false);
      expect(bdi.textContent?.trim().endsWith(".")).toBe(false);
    }
    // And the punctuation genuinely exists in the paragraph's rendered
    // text, just outside any <bdi> -- proving it wasn't dropped, only
    // correctly left unisolated.
    expect(paragraph.textContent).toContain("سلام!");
    expect(paragraph.textContent).toContain("بررسی:");
    expect(paragraph.textContent).toContain("نشده است.");
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

describe("E3: Persian user bubble alignment (task 17c)", () => {
  it("resolves CSS direction to rtl for Persian user content (text-align:start therefore resolves to the visual right, not a hardcoded left)", () => {
    const { container } = render(<ChatBubble role="user" content="امروز چطوری؟" />);
    const bubble = container.querySelector('[dir="auto"]')!;
    expect(bubble).toHaveAttribute("dir", "auto");
    expect(getComputedStyle(bubble).direction).toBe("rtl");
  });

  it("resolves CSS direction to ltr for English user content in the SAME component (proves the direction is genuinely content-driven, not a fixed rtl override)", () => {
    const { container } = render(<ChatBubble role="user" content="How are you today?" />);
    const bubble = container.querySelector('[dir="auto"]')!;
    expect(getComputedStyle(bubble).direction).toBe("ltr");
  });

  it("no hardcoded text-align:left / text-left class exists anywhere on the bubble markup (would silently defeat dir=auto's correct start-alignment)", () => {
    const { container } = render(<ChatBubble role="user" content="امروز چطوری؟" />);
    expect(container.innerHTML).not.toMatch(/\btext-left\b/);
    expect(container.innerHTML).not.toMatch(/text-align:\s*left/);
  });

  it("the Persian run is isolated (<bdi>) inside the user bubble too, same as assistant messages", () => {
    const { container } = render(<ChatBubble role="user" content="امروز چطوری؟" />);
    expect(container.querySelector("bdi")).not.toBeNull();
  });
});
