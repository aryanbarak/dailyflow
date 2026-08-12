import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ReactMarkdown from "react-markdown";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}));

import { MD_COMPONENTS as AGENT_BRIEFING_MD_COMPONENTS } from "@/components/AgentBriefingCard";
import { MD_COMPONENTS as WEEKLY_BRIEFING_MD_COMPONENTS } from "@/pages/WeeklyBriefingPage";
import { TASK_MD_COMPONENTS } from "@/pages/TasksPage";

// Task 17f, SHARED-LAYER SAFETY: bidiText.tsx (src/lib/bidiText.tsx) is
// consumed by six surfaces. ChatPage's own suites (ChatPage.test.tsx,
// ChatPageRTLBehavior.test.tsx) and PersonalMemorySection.test.tsx already
// exercise two of them end to end; ConversationsList/ConversationsDrawer
// (conversation titles) get dedicated coverage from task 17f's own B3 work
// (see ConversationsList.test.tsx). AgentBriefingCard, WeeklyBriefingPage,
// and TasksPage had NO existing test coverage of their markdown/bidi
// wiring at all (mounting the full pages requires heavy auth/supabase
// mocking unrelated to this task) -- each page's `MD_COMPONENTS` /
// `TASK_MD_COMPONENTS` constant was exported (a one-line, non-behavioral
// change) specifically so this file can verify their direction-aware
// rendering directly against real Persian+Latin content, the same way
// bidiText.test.tsx verifies createDirectionalMarkdownComponents itself.

describe("AgentBriefingCard's MD_COMPONENTS renders correctly with the rewritten bidiText.tsx", () => {
  it("mixed Persian+Latin content isolates only the minority Latin run, dominant Persian text stays unwrapped", () => {
    const html = renderToString(
      <ReactMarkdown components={AGENT_BRIEFING_MD_COMPONENTS}>
        {"امروز با Codex روی این کار پیش رفتی."}
      </ReactMarkdown>,
    );
    expect(html).toContain('<p dir="auto" class="agent-briefing-card__text">');
    expect(html).toContain("<bdi>Codex</bdi>");
    expect(html.match(/<bdi>/g)?.length).toBe(1);
  });

  it("a bulleted Persian list renders with logical (RTL-correct) indentation classes, unchanged visual styling", () => {
    const html = renderToString(
      <ReactMarkdown components={AGENT_BRIEFING_MD_COMPONENTS}>{"- تسک اول\n- تسک دوم"}</ReactMarkdown>,
    );
    expect(html).toContain('<ul dir="auto" class="agent-briefing-card__list">');
    expect(html.match(/<li dir="auto" class="agent-briefing-card__list-item">/g)?.length).toBe(2);
  });
});

describe("WeeklyBriefingPage's MD_COMPONENTS renders correctly with the rewritten bidiText.tsx", () => {
  it("mixed Persian+Latin content isolates only the minority Latin run", () => {
    const html = renderToString(
      <ReactMarkdown components={WEEKLY_BRIEFING_MD_COMPONENTS}>
        {"این هفته روی TypeScript کار کردی."}
      </ReactMarkdown>,
    );
    expect(html).toContain("<bdi>TypeScript</bdi>");
    expect(html.match(/<bdi>/g)?.length).toBe(1);
  });

  it("a Persian bullet list uses logical ps-5 padding, not a hardcoded pl-5", () => {
    const html = renderToString(
      <ReactMarkdown components={WEEKLY_BRIEFING_MD_COMPONENTS}>{"- کار اول\n- کار دوم"}</ReactMarkdown>,
    );
    expect(html).toContain('class="list-disc ps-5 mt-2 space-y-1"');
    expect(html).not.toMatch(/\bpl-5\b/);
  });
});

describe("TasksPage's TASK_MD_COMPONENTS renders correctly with the rewritten bidiText.tsx", () => {
  it("mixed Persian+Latin content isolates only the minority Latin run", () => {
    const html = renderToString(
      <ReactMarkdown components={TASK_MD_COMPONENTS}>{"این تسک به HTML/CSS نیاز دارد."}</ReactMarkdown>,
    );
    expect(html).toContain("<bdi>HTML/CSS</bdi>");
    expect(html.match(/<bdi>/g)?.length).toBe(1);
  });

  it("single-script pure Persian content (task 17f, R2) renders completely unwrapped", () => {
    const html = renderToString(<ReactMarkdown components={TASK_MD_COMPONENTS}>{"این تسک را کامل کن."}</ReactMarkdown>);
    expect(html).not.toContain("<bdi>");
  });
});
