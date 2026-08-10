import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// SmartFlow -- Chat Experience v2 (task 17a), workstream 3: "ALL behind
// prefers-reduced-motion (reduced = instant, no motion)". The chat
// animations themselves are implemented as plain CSS classes
// (.chat-message-enter, .chat-typing-dot) neutralized entirely inside a
// `@media (prefers-reduced-motion: reduce)` block in index.css -- there is
// no JS branch to unit-test for THIS mechanism (that's deliberate: a
// CSS-only media query is more robust than duplicating the same logic in
// JS, and it can't drift out of sync with what actually ships). jsdom does
// not evaluate CSS, so this test verifies the SOURCE directly: the
// reduced-motion block exists and genuinely neutralizes every animation
// class this task introduced, rather than asserting on rendered browser
// behavior this environment cannot produce.
const CSS_SOURCE = readFileSync(resolve(__dirname, "../../index.css"), "utf8");

function extractReducedMotionBlock(css: string): string {
  const marker = "@media (prefers-reduced-motion: reduce)";
  const start = css.indexOf(marker);
  expect(start, "expected an @media (prefers-reduced-motion: reduce) block in index.css").toBeGreaterThan(-1);
  // Grab a generous slice following the marker -- enough to contain the
  // whole block without needing a full CSS parser.
  return css.slice(start, start + 800);
}

describe("index.css reduced-motion handling (task 17a)", () => {
  it("defines the chat message-entry and typing-dot animations", () => {
    expect(CSS_SOURCE).toContain("@keyframes chatMessageIn");
    expect(CSS_SOURCE).toContain(".chat-message-enter");
    expect(CSS_SOURCE).toContain("@keyframes chatTypingDot");
    expect(CSS_SOURCE).toContain(".chat-typing-dot");
  });

  it("every chat animation is transform/opacity only (GPU-friendly, no layout-triggering properties)", () => {
    const keyframeBlocks = CSS_SOURCE.match(/@keyframes chat\w+\s*\{[\s\S]*?\n\}/g) ?? [];
    expect(keyframeBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of keyframeBlocks) {
      const declarations = block.match(/^\s*[a-z-]+(?=\s*:)/gim) ?? [];
      const properties = declarations.map((d) => d.trim().toLowerCase()).filter((d) => d !== "from" && d !== "to");
      for (const property of properties) {
        expect(["opacity", "transform"]).toContain(property);
      }
    }
  });

  it("the reduced-motion media query neutralizes both chat animation classes down to no motion", () => {
    const block = extractReducedMotionBlock(CSS_SOURCE);
    expect(block).toContain(".chat-message-enter");
    expect(block).toContain(".chat-typing-dot");
    expect(block).toMatch(/\.chat-message-enter\s*\{[^}]*animation:\s*none/);
    expect(block).toMatch(/\.chat-typing-dot\s*\{[^}]*animation:\s*none/);
  });

  it("the reduced-motion media query also neutralizes the shared Sheet/tailwindcss-animate transitions the mobile drawer reuses", () => {
    const block = extractReducedMotionBlock(CSS_SOURCE);
    expect(block).toContain(".animate-in");
    expect(block).toContain(".animate-out");
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it("provides a .chat-reduced-motion escape hatch class for JS-driven transitions (theme/compact toggle buttons)", () => {
    const block = extractReducedMotionBlock(CSS_SOURCE);
    expect(block).toContain(".chat-reduced-motion");
  });
});
