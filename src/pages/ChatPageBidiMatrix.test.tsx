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

describe("task 17f bidi matrix -- Persian ending in ':' after a bold phrase (single-script bold renders unwrapped inside its own CSS-isolated <strong>)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] the colon sits directly after </strong>, in DOM order, not inside any isolate`, () => {
      const { container } = renderBubble(appDir, "**خلاصه**: امروز کارها تمام شد.");
      const bubble = container.querySelector(".rounded-xl")!;
      const paragraph = bubble.querySelector("p")!;
      const strong = paragraph.querySelector("strong")!;
      expect(strong.textContent).toBe("خلاصه");
      expect(strong.querySelector("bdi")).toBeNull(); // single-script bold text, R2 applies inside strong too
      expect(paragraph.innerHTML).toMatch(/<\/strong>: امروز کارها تمام شد\./);
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

describe("task 17f bidi matrix -- RTL bullet list, including a nested list (R6: logical padding-inline-start, every level gets dir=auto)", () => {
  for (const appDir of APP_ROOTS) {
    it(`[app=${appDir}] top-level and nested <ul> both use ps-4 (never pl-4/pr-4), both dir=auto`, () => {
      const { container } = renderBubble(
        appDir,
        "- تسک اول\n  - زیرتسک الف\n  - زیرتسک ب\n- تسک دوم",
      );
      const bubble = container.querySelector(".rounded-xl")!;
      const lists = bubble.querySelectorAll("ul");
      expect(lists.length).toBe(2); // top-level + one nested
      for (const ul of Array.from(lists)) {
        expect(ul).toHaveAttribute("dir", "auto");
        expect(ul.className).toMatch(/\bps-4\b/);
        expect(ul.className).not.toMatch(/\bpl-4\b|\bpr-4\b/);
      }
      expect(bubble.textContent).toContain("زیرتسک الف");
      expect(bubble.textContent).toContain("زیرتسک ب");
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
