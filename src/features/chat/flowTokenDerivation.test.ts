import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

// SmartFlow -- Flow AI visual identity (task 17b): "single source of
// truth; no component may reference a raw hex that exists as a token."
// Verified two ways, both against SOURCE TEXT directly (mirrors task 17a's
// reducedMotionCss.test.ts -- jsdom/node don't evaluate CSS, so this reads
// the files the same way a reviewer would):
//   1. src/styles/flow-tokens.css still holds the PO's values verbatim
//      (spot-checked, not exhaustively -- it's an exact copy-paste, not
//      hand-derived).
//   2. Nothing that CONSUMES those tokens (index.css's derived dark block,
//      and every .ts/.tsx source file under the chat feature + ChatPage)
//      hardcodes a fresh hex literal instead of referencing a token by
//      name -- flow-tokens.css itself is the one permitted exception,
//      since it IS the token definitions.

const REPO_ROOT = resolve(__dirname, "../../..");
const HEX_COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b/g;

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

function listSourceFiles(dirRelativePath: string, extensions: readonly string[]): string[] {
  const dir = resolve(REPO_ROOT, dirRelativePath);
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...listSourceFiles(join(dirRelativePath, entry), extensions));
      continue;
    }
    if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(join(dirRelativePath, entry));
    }
  }
  return results;
}

describe("flow-tokens.css holds the PO's Dark Cosmic tokens verbatim", () => {
  const source = readSource("src/styles/flow-tokens.css");

  it.each([
    "--flow-bg: #050615;",
    "--flow-primary: #7C4DFF;",
    "--flow-primary-600: #6938F0;",
    "--flow-study: #9B5CFF;",
    "--flow-plan: #F06AC6;",
    "--flow-analyze: #55E38A;",
    "--flow-review: #5F91FF;",
    "--flow-report: #62D9EA;",
    "--flow-career: #F3A044;",
    "--flow-text-primary: #F7F7FC;",
    "--flow-glow-violet-soft: rgba(124, 77, 255, 0.18);",
  ])("contains %s verbatim", (line) => {
    expect(source).toContain(line);
  });
});

describe("index.css's derived [data-chat-theme=\"dark\"] block has zero raw hex (single source of truth)", () => {
  it("the dark chat-theme token block uses only HSL triples and var()/gradient references", () => {
    const css = readSource("src/index.css");
    const marker = '[data-chat-theme="dark"] {';
    const start = css.indexOf(marker);
    expect(start, 'expected a [data-chat-theme="dark"] block in index.css').toBeGreaterThan(-1);
    // Brace-counted (not a fixed-length slice or a "\n  }\n" string search --
    // this file uses CRLF line endings, which silently breaks a literal
    // "\n"-based search for the closing brace) so this stays correct
    // regardless of how the block's own length changes over time.
    let depth = 0;
    let end = start;
    for (let i = start; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    const block = css.slice(start, end);
    // Strip CSS comments first -- this block's own header comment
    // documents which --flow-* hex value each derived HSL triple came
    // from (for reviewers), which is prose, not a CSS declaration.
    const blockWithoutComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
    const hexMatches = blockWithoutComments.match(HEX_COLOR_PATTERN) ?? [];
    expect(hexMatches).toEqual([]);
  });
});

describe("no raw hex literals in chat feature components / ChatPage.tsx (must reference a token instead)", () => {
  const files = [
    ...listSourceFiles("src/features/chat", [".ts", ".tsx"]).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")),
    "src/pages/ChatPage.tsx",
  ];

  it.each(files)("%s contains no raw hex color literal", (relativePath) => {
    const source = readSource(relativePath);
    const hexMatches = source.match(HEX_COLOR_PATTERN) ?? [];
    expect(hexMatches).toEqual([]);
  });
});
