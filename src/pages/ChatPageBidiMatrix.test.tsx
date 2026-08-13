// @vitest-environment jsdom
//
// SmartFlow -- task 17f, workstream A. PO USAGE REALITY: the app UI
// language is ALWAYS English; the PO types in Persian; Persian messages
// frequently contain Latin technical tokens (Codex, TypeScript, AI/ML).
// This is the REQUIRED test matrix: every case rendered under BOTH an EN
// app root and an FA app root, asserting DOM PLACEMENT of marks/markers
// (not just dir attributes) -- proving the app-language root never leaks
// into message-content rendering (task 17e/17f, R1/R7).
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}));

import { ChatBubble } from "./ChatPage";

const APP_ROOTS = ["ltr", "rtl"] as const;

function renderBubble(appDir: "ltr" | "rtl", content: string) {
  return render(
    <div dir={appDir}>
      <ChatBubble role="assistant" content={content} />
    </div>,
  );
}

describe("task 17f bidi matrix -- pure Persian (R2: single-script, no <bdi> at all)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] renders unwrapped, dir resolves to rtl regardless of app root`, () => {
      const { container } = renderBubble(appDir, "امروز خوب پیش رفت.");
      const bubble = container.querySelector(".rounded-xl")!;
      expect(bubble).toHaveAttribute("dir", "rtl");
      expect(bubble.querySelector("bdi")).toBeNull();
      expect(bubble.textContent).toContain("امروز خوب پیش رفت.");
    });
  }
});

describe("task 17f bidi matrix -- pure English (R2: single-script, no <bdi> at all)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] renders unwrapped, dir resolves to ltr regardless of app root`, () => {
      const { container } = renderBubble(appDir, "Everything looks good today.");
      const bubble = container.querySelector(".rounded-xl")!;
      expect(bubble).toHaveAttribute("dir", "ltr");
      expect(bubble.querySelector("bdi")).toBeNull();
    });
  }
});

describe("task 17f bidi matrix -- Persian + Node.js/JavaScript/HTML/CSS (R3: each Latin technical term isolated as its own minority run)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] four separate <bdi> runs, dominant Persian text stays unwrapped`, () => {
      const { container } = renderBubble(
        appDir,
        "این پروژه از Node.js و JavaScript و HTML و CSS استفاده می‌کند.",
      );
      const bubble = container.querySelector(".rounded-xl")!;
      expect(bubble).toHaveAttribute("dir", "rtl");
      const bdiTexts = Array.from(bubble.querySelectorAll("bdi")).map((el) => el.textContent);
      expect(bdiTexts).toEqual(["Node.js", "JavaScript", "HTML", "CSS"]);
    });
  }
});

describe("task 17f bidi matrix -- Persian + numbers (R2: digits never make text mixed)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] renders unwrapped -- digits are not a second script`, () => {
      const { container } = renderBubble(appDir, "امروز 3 جلسه و 5 کار داری.");
      const bubble = container.querySelector(".rounded-xl")!;
      expect(bubble).toHaveAttribute("dir", "rtl");
      expect(bubble.querySelector("bdi")).toBeNull();
      expect(bubble.textContent).toContain("امروز 3 جلسه و 5 کار داری.");
    });
  }
});

describe("task 17f bidi matrix -- Persian ending in '.' (single-script, terminal mark stays plain text at the correct logical position)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] no <bdi>, the period is the literal last character of the paragraph's text content`, () => {
      const { container } = renderBubble(appDir, "کار امروز تمام شد.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph.querySelector("bdi")).toBeNull();
      expect(paragraph.textContent?.endsWith("تمام شد.")).toBe(true);
    });
  }
});

// Task 20, Part B CORRECTION: this suite's ORIGINAL assertion (the colon
// sits BARE, "not inside any isolate", directly after </strong>) was task
// 17f's own untested assumption -- and it was WRONG. Production evidence
// (task 20) showed exactly this shape ("**Task**: (وظیفه)") rendering with
// the mark on the WRONG side, because a lone neutral character living
// unisolated at a direction boundary has nothing anchoring its position.
// The fix (bidiText.tsx's LEADING_ATTACHED_MARK_PATTERN) now isolates that
// attached mark into its OWN small <bdi>, immediately following the
// <strong>'s isolate in DOM order -- still "directly after </strong>", just
// now isolated rather than bare. This test is corrected accordingly; see
// bidiText.test.tsx's own new "attached mark anchoring" describe block for
// the isolated unit-level coverage of this exact mechanism.
describe("task 17f bidi matrix -- Persian ending in ':' after a bold phrase (single-script bold renders unwrapped inside its own CSS-isolated <strong>; the attached colon now anchors via its own isolate, task 20 correction)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the colon sits directly after </strong> in DOM order, now inside its OWN small isolate (task 20 fix) rather than bare`, () => {
      const { container } = renderBubble(appDir, "**خلاصه**: امروز کارها تمام شد.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      const strong = paragraph.querySelector("strong")!;
      expect(strong.textContent).toBe("خلاصه");
      expect(strong.querySelector("bdi")).toBeNull(); // single-script bold text, R2 applies inside strong too
      // The attached colon is the <strong>'s very next sibling, isolated in
      // its own <bdi> (task 20) -- DOM order unchanged, isolation added.
      expect(paragraph.innerHTML).toMatch(/<\/strong><bdi>:<\/bdi> امروز کارها تمام شد\./);
      expect(paragraph.textContent).toBe("خلاصه: امروز کارها تمام شد.");
    });
  }
});

describe('task 17f bidi matrix -- "AI/ML." (R3: attached trailing mark generalisation, the PO\'s own named example)', () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the period isolates INSIDE the same <bdi> as the technical term`, () => {
      const { container } = renderBubble(appDir, "این یک روش AI/ML. است.");
      const bubble = container.querySelector(".rounded-xl")!;
      const bdi = bubble.querySelector("bdi")!;
      expect(bdi.textContent).toBe("AI/ML.");
    });
  }
});

describe("task 17f bidi matrix -- RTL bullet list, including a nested list (R6: logical padding-inline-start, every level gets an explicit direction)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] top-level and nested <ul> both use ps-4 (never pl-4/pr-4), both resolve dir="rtl" explicitly (task 20, Part B -- was dir="auto")`, () => {
      const { container } = renderBubble(
        appDir,
        "- تسک اول\n  - زیرتسک الف\n  - زیرتسک ب\n- تسک دوم",
      );
      const bubble = container.querySelector(".rounded-xl")!;
      const lists = bubble.querySelectorAll("ul");
      expect(lists.length).toBe(2); // top-level + one nested
      for (const ul of Array.from(lists)) {
        expect(ul).toHaveAttribute("dir", "rtl");
        expect(ul.className).toMatch(/\bps-4\b/);
        expect(ul.className).not.toMatch(/\bpl-4\b|\bpr-4\b/);
      }
      expect(bubble.textContent).toContain("زیرتسک الف");
      expect(bubble.textContent).toContain("زیرتسک ب");
    });
  }
});

describe("Flow AI Markdown semantics -- headings and nested lists remain visually distinct", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] renders a Persian heading as h3, not as a bullet, and preserves nested list hierarchy`, () => {
      const { container } = renderBubble(
        appDir,
        "### معماری و استقرار هوش مصنوعی (Deployment – MLOps & AI Architecture)\n\n- API Development\n  - برای API از Flask/FastAPI یا Node.js استفاده کنید.\n- پلتفرم‌های ابری: AWS (SageMaker), Google Cloud (Vertex AI), Azure",
      );
      const bubble = container.querySelector(".rounded-xl")!;
      const heading = bubble.querySelector("h3")!;
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveAttribute("dir", "rtl");
      expect(heading.textContent).toBe("معماری و استقرار هوش مصنوعی (Deployment – MLOps & AI Architecture)");
      expect(bubble.querySelector("li")?.textContent).not.toContain("معماری و استقرار هوش مصنوعی");
      expect(bubble.querySelectorAll("ul")).toHaveLength(2);
      const bdiTexts = Array.from(bubble.querySelectorAll("bdi")).map((el) => el.textContent);
      expect(bdiTexts).toContain("Deployment – MLOps & AI Architecture");
      expect(bdiTexts).toContain("Flask/FastAPI");
      expect(bdiTexts).toContain("Node.js");
      expect(bubble.textContent).toContain("AWS (SageMaker), Google Cloud (Vertex AI), Azure");
    });
  }
});

describe("task 17f bidi matrix -- inline code inside Persian (R5: always LTR)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the <code> element carries dir="ltr" regardless of the surrounding Persian paragraph`, () => {
      const { container } = renderBubble(appDir, "برای اجرا از `npm run build` استفاده کن.");
      const bubble = container.querySelector(".rounded-xl")!;
      const code = bubble.querySelector("code")!;
      expect(code).toHaveAttribute("dir", "ltr");
      expect(code.textContent).toBe("npm run build");
    });
  }
});

describe("task 17f bidi matrix -- fenced code block inside Persian (R5: always LTR)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the <pre> element carries dir="ltr" regardless of the surrounding Persian message`, () => {
      const { container } = renderBubble(appDir, "این دستور را اجرا کن:\n\n```\nnpm run build\n```");
      const bubble = container.querySelector(".rounded-xl")!;
      const pre = bubble.querySelector("pre")!;
      expect(pre).toHaveAttribute("dir", "ltr");
      expect(pre.textContent).toContain("npm run build");
    });
  }
});

describe("task 17f bidi matrix -- URL inside Persian (R5: the URL isolates as its own Latin minority run)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the raw URL is isolated as one whole <bdi> run, dominant Persian text stays unwrapped`, () => {
      const { container } = renderBubble(
        appDir,
        "برای اطلاعات بیشتر به https://example.com/fa/docs مراجعه کنید.",
      );
      const bubble = container.querySelector(".rounded-xl")!;
      const bdi = bubble.querySelector("bdi")!;
      expect(bdi.textContent).toBe("https://example.com/fa/docs");
    });
  }
});

describe("task 17f bidi matrix -- punctuation immediately around an LTR fragment (R3: parens only join the isolate together WITH an attached mark)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] no attached mark: parens stay OUTSIDE the isolate, only the bare term is wrapped`, () => {
      const { container } = renderBubble(appDir, "این (Codex) خوب است.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph.querySelector("bdi")?.textContent).toBe("Codex");
      expect(paragraph.innerHTML).toContain("این (<bdi>Codex</bdi>) خوب است.");
    });

    it(`[app=${appDir}] an attached trailing colon pulls the parens AND the mark INSIDE the isolate together`, () => {
      const { container } = renderBubble(appDir, "این (Codex): خوب است.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph.querySelector("bdi")?.textContent).toBe("(Codex):");
    });
  }
});

describe('task 17f bidi matrix -- "(2)." regression (task 17d\'s protected numeric-count exception, now satisfied by construction)', () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] a lone digit is never a run -- the whole single-script Persian sentence renders completely unwrapped`, () => {
      const { container } = renderBubble(appDir, "بررسی کارها (2).");
      const bubble = container.querySelector(".rounded-xl")!;
      expect(bubble.querySelector("bdi")).toBeNull();
      expect(bubble.textContent).toContain("بررسی کارها (2).");
    });
  }
});

// ===========================================================================
// Task 20, Part B: bidi at inline boundaries -- production evidence:
// "Task :(وظیفه)" rendered instead of "(وظیفه) Task:", same for
// "Reminder :(یادآور)", plus a list-marker and a "[...]" bracket case. Every
// case below is run under BOTH an EN app root AND an FA app root (the same
// PO-usage-reality matrix requirement as the rest of this file).
// ===========================================================================

describe("task 20 bidi matrix -- bold Latin label + attached colon + adjacent Persian parenthetical (the exact production evidence shape)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the colon anchors immediately after </strong> in its own isolate, and the Persian parenthetical stays a separate, correctly-placed unit`, () => {
      const { container } = renderBubble(appDir, "**Task**: (وظیفه) را انجام بده.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      const strong = paragraph.querySelector("strong")!;
      expect(strong.textContent).toBe("Task");
      // The attached colon is the <strong>'s very next DOM sibling, in its
      // own isolate -- never floating bare at the direction boundary.
      expect(paragraph.innerHTML).toMatch(/<\/strong><bdi>:<\/bdi> /);
      // Full text content survives round-trip untouched regardless of
      // isolation structure.
      expect(paragraph.textContent).toBe("Task: (وظیفه) را انجام بده.");
    });

    it(`[app=${appDir}] "Reminder" -- the second production-evidence label, same shape`, () => {
      const { container } = renderBubble(appDir, "**Reminder**: (یادآور) را هم تنظیم کن.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph.innerHTML).toMatch(/<\/strong><bdi>:<\/bdi> /);
      expect(paragraph.textContent).toBe("Reminder: (یادآور) را هم تنظیم کن.");
    });
  }
});

describe("task 20 bidi matrix -- bold Persian label + attached mark + adjacent Latin word", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the attached mark anchors to the bold Persian run, the Latin word isolates as its own minority run`, () => {
      const { container } = renderBubble(appDir, "**وظیفه**: Task را انجام بده.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      const strong = paragraph.querySelector("strong")!;
      expect(strong.textContent).toBe("وظیفه");
      expect(paragraph.innerHTML).toMatch(/<\/strong><bdi>:<\/bdi> <bdi>Task<\/bdi> /);
      expect(paragraph.textContent).toBe("وظیفه: Task را انجام بده.");
    });
  }
});

describe("task 20 bidi matrix -- RTL list item starting with a bold run", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the <li> resolves an explicit rtl direction even though its content BEGINS with an isolated bold run -- native dir="auto" would have found nothing to resolve from here`, () => {
      const { container } = renderBubble(appDir, "- **پروژه من**: در حال انجام است.\n- تسک دوم");
      const bubble = container.querySelector(".rounded-xl")!;
      const items = bubble.querySelectorAll("li");
      expect(items.length).toBe(2);
      const [first] = Array.from(items);
      expect(first).toHaveAttribute("dir", "rtl");
      expect(first.querySelector("strong")?.textContent).toBe("پروژه من");
      expect(first.innerHTML).toMatch(/<\/strong><bdi>:<\/bdi> /);
    });

    it(`[app=${appDir}] a list item that is ENTIRELY a bold Persian run (nothing else at all) still resolves rtl via the degenerate-case fallback`, () => {
      const { container } = renderBubble(appDir, "- **پروژه من**\n- تسک دوم");
      const bubble = container.querySelector(".rounded-xl")!;
      const [first] = Array.from(bubble.querySelectorAll("li"));
      expect(first).toHaveAttribute("dir", "rtl");
    });
  }
});

describe('task 20 bidi matrix -- bracketed Persian phrase "[...]" mid-sentence (production evidence: "تاریخ سررسید: [3 روز از امروز]")', () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the bracketed Persian run isolates as its own unit inside dominant Latin text`, () => {
      const { container } = renderBubble(appDir, "Due date: [سه روز از امروز] is the deadline.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph.querySelector("bdi")?.textContent).toBe("سه روز از امروز");
      expect(paragraph.textContent).toBe("Due date: [سه روز از امروز] is the deadline.");
    });

    it(`[app=${appDir}] a bracketed Latin phrase isolates as its own unit inside dominant Persian text (symmetric)`, () => {
      const { container } = renderBubble(appDir, "تاریخ سررسید: [Due Soon] است.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph.querySelector("bdi")?.textContent).toBe("Due Soon");
      expect(paragraph.textContent).toBe("تاریخ سررسید: [Due Soon] است.");
    });
  }
});

// ===========================================================================
// Task 20b: bidi regression at inline boundaries -- three PRODUCTION-EVIDENCE
// shapes that survived task 20's own fix. Diagnosed via a rendered-DOM
// diagnostic (not the width-dependence the PO's first report suggested --
// the PO's own correction confirmed these are structural, not width-
// dependent, so this file's existing "renderToString"-style DOM assertions,
// same convention as every other case in this matrix, are sufficient) plus
// a real UAX9 bidi-algorithm simulation (bidi-js) used only to VALIDATE the
// design during development -- not a project dependency, not referenced by
// any committed test.
// ===========================================================================

describe('task 20b bidi matrix, W1 -- "Task: (وظیفه)" (the exact production evidence string, both alone and embedded in a Persian line)', () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the exact literal string alone: "Task" and "(وظیفه)" are a one-word-each TIE, so this stays ltr (first-strong tie-break, unchanged from task 20) -- the colon stays anchored inside "Task:" either way`, () => {
      const { container } = renderBubble(appDir, "**Task: (وظیفه)**");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph).toHaveAttribute("dir", "ltr");
      expect(paragraph.textContent).toBe("Task: (وظیفه)");
    });

    it(`[app=${appDir}] embedded in a Persian line (the realistic production shape -- a Persian sentence using "Task: (وظیفه)" as its object): the block resolves rtl (Persian has more words), and the colon stays anchored immediately after "Task" as ONE isolated unit -- this is the actual W1 regression fix`, () => {
      const { container } = renderBubble(appDir, "**Task: (وظیفه)** را انجام بده.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph).toHaveAttribute("dir", "rtl");
      const strong = paragraph.querySelector("strong")!;
      // The colon is pulled INTO the same isolate as "Task" (they are one
      // unbroken run within the strong's own text, unlike the task-20
      // shape where the colon sits OUTSIDE a separate <strong>) -- and the
      // Persian parenthetical, now correctly recognised as part of the
      // block's DOMINANT script, is left plain/unwrapped beside it.
      expect(strong.innerHTML).toBe("<bdi>Task:</bdi> (وظیفه)");
      expect(paragraph.textContent).toBe("Task: (وظیفه) را انجام بده.");
    });

    it(`[app=${appDir}] "Reminder: (یادآور)" -- the second production-evidence label, same embedded shape`, () => {
      const { container } = renderBubble(appDir, "**Reminder: (یادآور)** را هم تنظیم کن.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph).toHaveAttribute("dir", "rtl");
      expect(paragraph.querySelector("strong")!.innerHTML).toBe("<bdi>Reminder:</bdi> (یادآور)");
      expect(paragraph.textContent).toBe("Reminder: (یادآور) را هم تنظیم کن.");
    });

    it(`[app=${appDir}] the task-20 shape ("**Task**: (وظیفه) را انجام بده.", colon OUTSIDE the bold run) still resolves rtl and still anchors the colon -- this task did not regress it`, () => {
      const { container } = renderBubble(appDir, "**Task**: (وظیفه) را انجام بده.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph).toHaveAttribute("dir", "rtl");
      expect(paragraph.innerHTML).toMatch(/<\/strong><bdi>:<\/bdi> /);
      expect(paragraph.textContent).toBe("Task: (وظیفه) را انجام بده.");
    });
  }
});

describe("task 20b bidi matrix, W2 -- bracket/paren pairs enclosing MIXED-script content isolate as ONE atomic unit (delimiters + content + attached trailing mark)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] bracketed Persian phrase CONTAINING a Latin token (production evidence: "[... تا در Task ثبت کنم.]") -- the whole group isolates together, and "Task" isolates AGAIN inside it`, () => {
      const { container } = renderBubble(
        appDir,
        "[لطفاً زمان دقیق نوبت دکتر را بفرمایید تا در Task ثبت کنم.]",
      );
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      const outerBdi = paragraph.querySelector(":scope > bdi")!;
      expect(outerBdi.textContent?.startsWith("[")).toBe(true);
      expect(outerBdi.textContent?.endsWith("]")).toBe(true);
      expect(outerBdi.querySelector("bdi")?.textContent).toBe("Task");
      expect(paragraph.textContent).toBe("[لطفاً زمان دقیق نوبت دکتر را بفرمایید تا در Task ثبت کنم.]");
    });

    it(`[app=${appDir}] bracketed Persian phrase with NO Latin token stays fully plain (single-script content -- the existing 17d/17f behaviour for a delimiter group is untouched)`, () => {
      const { container } = renderBubble(
        appDir,
        "[تاریخ سررسید که 3 روز از روزی که آن را ساختیم، بود.]",
      );
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      expect(paragraph.querySelector("bdi")).toBeNull();
      expect(paragraph.textContent).toBe("[تاریخ سررسید که 3 روز از روزی که آن را ساختیم، بود.]");
    });

    it(`[app=${appDir}] "(Anaconda یا VS Code)." -- a Latin-dominant paren group with an embedded Persian word AND an attached trailing period, all isolated as one unit`, () => {
      const { container } = renderBubble(appDir, "یکی از این دو را نصب کن: (Anaconda یا VS Code).");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      const outerBdi = paragraph.querySelector(":scope > bdi")!;
      expect(outerBdi.textContent).toBe("(Anaconda یا VS Code).");
      expect(outerBdi.querySelector("bdi")?.textContent).toBe("یا");
      expect(paragraph.textContent).toBe("یکی از این دو را نصب کن: (Anaconda یا VS Code).");
    });
  }
});

describe("task 20b bidi matrix, W3 -- list marker/bullet follows the LIST's own shared direction, even when one item's own text is pure single-script in the opposite direction", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] a pure-Latin item inside an otherwise-Persian list keeps its <li> at the LIST's rtl direction (marker consistency), while its own text is isolated as one correctly-ordered run`, () => {
      const { container } = renderBubble(appDir, "- دکتر کلاین\n- Dr Klein Termin\n- تماس با مطب");
      const bubble = container.querySelector(".rounded-xl")!;
      const list = bubble.querySelector("ul")!;
      expect(list).toHaveAttribute("dir", "rtl");
      const items = Array.from(list.querySelectorAll("li"));
      expect(items).toHaveLength(3);
      // Every item's OWN <li> box shares the list's direction -- this is
      // the actual W3 fix: marker placement is governed by dir on the
      // element itself, and this no longer varies per item.
      for (const item of items) expect(item).toHaveAttribute("dir", "rtl");
      expect(items[1].innerHTML).toBe("<bdi>Dr Klein Termin</bdi>");
      expect(items[1].textContent).toBe("Dr Klein Termin");
    });

    it(`[app=${appDir}] symmetric case: a pure-Persian item inside an otherwise-Latin list keeps its <li> at the LIST's ltr direction`, () => {
      const { container } = renderBubble(appDir, "- Call the clinic\n- تماس با مطب\n- Confirm the time");
      const bubble = container.querySelector(".rounded-xl")!;
      const list = bubble.querySelector("ul")!;
      expect(list).toHaveAttribute("dir", "ltr");
      const items = Array.from(list.querySelectorAll("li"));
      for (const item of items) expect(item).toHaveAttribute("dir", "ltr");
      expect(items[1].innerHTML).toBe("<bdi>تماس با مطب</bdi>");
    });
  }
});
