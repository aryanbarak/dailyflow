import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// SmartFlow -- task 17c, section A (two-surfaces diagnosis). Production
// evidence suggested the mobile "Flow AI" nav entry might render a
// DIFFERENT component than ChatPage.tsx. Investigation (see the task 17c
// report) found only ONE /chat route, mapping to ChatPage, and no second
// router/component anywhere in src/ -- this test locks that finding in as
// a permanent regression guard: if a future change ever introduces a
// second "/chat"-ish route or points it at a different component, this
// fails immediately instead of silently reintroducing the two-surfaces
// problem.
const APP_SOURCE = readFileSync(resolve(__dirname, "./App.tsx"), "utf8");

describe("App.tsx routing: /chat is unified onto ChatPage (task 17c, two-surfaces diagnosis)", () => {
  it("imports exactly one ChatPage-like module for chat", () => {
    const chatImports = APP_SOURCE.match(/^import\s+\w*Chat\w*\s+from\s+["'][^"']+["']/gm) ?? [];
    expect(chatImports).toHaveLength(1);
    expect(chatImports[0]).toContain("ChatPage");
  });

  it("declares exactly one route matching /chat, rendering <ChatPage />", () => {
    const chatRoutes = APP_SOURCE.match(/<Route\s+path="\/chat"[^>]*\/>/g) ?? [];
    expect(chatRoutes).toHaveLength(1);
    expect(chatRoutes[0]).toContain("<ChatPage />");
  });

  it("does not declare any OTHER route path that looks like a second mobile/chat surface (e.g. /chat/mobile, /mobile-chat, /flow-ai)", () => {
    // /__dev/flow-ai-orb is a known, legitimate, dev-only ORB COMPONENT
    // playground (FlowAIOrbPlayground -- a visual demo for the orb motif
    // itself), not a chat surface -- explicitly excluded, not a false
    // negative being papered over.
    const KNOWN_NON_CHAT_ROUTES = new Set(["/__dev/flow-ai-orb"]);
    const allRoutePaths = Array.from(APP_SOURCE.matchAll(/<Route\s+path="([^"]+)"/g)).map((m) => m[1]);
    const suspiciousDuplicates = allRoutePaths.filter(
      (path) => path !== "/chat" && !KNOWN_NON_CHAT_ROUTES.has(path) && /chat|flow-ai/i.test(path),
    );
    expect(suspiciousDuplicates).toEqual([]);
  });
});
