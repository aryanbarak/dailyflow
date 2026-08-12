// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}));

import { ConversationsDrawer } from "@/features/chat/components/ConversationsDrawer";

// Task 17f, C1a: pull-to-refresh inside the chat triggered a full browser
// reload -- the native rubber-band/pull-to-refresh gesture chains up from
// a scrolled-to-top inner scroll container all the way to the document
// root by default. Every scroll container in the chat tree needs
// `overscroll-behavior: contain` to stop that chain at each level. As with
// ChatPageDesktopLayout.test.tsx, ChatPage's own root/messages-region
// classes and AppLayout.tsx (LaunchProvider/LaunchContext-heavy) are
// verified against their real shipped SOURCE rather than a full DOM mount
// -- ConversationsDrawer IS mountable (it already has its own test setup)
// and is verified by rendering it for real.

const srcDir = path.resolve(process.cwd(), "src");
const chatPageSource = readFileSync(path.join(srcDir, "pages", "ChatPage.tsx"), "utf-8");
const appLayoutSource = readFileSync(path.join(srcDir, "components", "layout", "AppLayout.tsx"), "utf-8");
const indexCssSource = readFileSync(path.join(srcDir, "index.css"), "utf-8");

describe("C1a (task 17f): overscroll-behavior: contain on every scroll container in the chat tree", () => {
  it("the global page root (html, body) contains overscroll", () => {
    expect(indexCssSource).toMatch(/html,\s*\n\s*body\s*\{\s*\n\s*overscroll-behavior:\s*contain;/);
  });

  it("AppLayout's mobile scrolling <main> (the page's real scrolling ancestor on mobile PWA) contains overscroll", () => {
    expect(appLayoutSource).toMatch(/overflow-auto overscroll-contain/);
  });

  it("ChatPage's own root contains overscroll", () => {
    expect(chatPageSource).toMatch(/overflow-hidden overscroll-contain bg-background/);
  });

  it("ChatPage's messages scroll region (the primary chat scroll container) contains overscroll", () => {
    expect(chatPageSource).toMatch(/overflow-y-auto overscroll-contain px-3/);
  });

  it("ConversationsDrawer's own scroll area contains overscroll, verified by rendering the real component", () => {
    render(
      <ConversationsDrawer
        open
        onOpenChange={vi.fn()}
        sessions={[{ id: "s1", title: "Test", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" }]}
        activeSessionId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // Sheet (Radix Dialog) portals its content onto document.body, not
    // into the local render container.
    const scrollArea = document.body.querySelector(".overflow-y-auto");
    expect(scrollArea).not.toBeNull();
    expect(scrollArea?.className).toMatch(/overscroll-contain/);
  });
});

// Task 17f, C2: after the C1 reload fix, the composer sat below the
// visible viewport in the Android PWA standalone context (100dvh
// mis-measured the shell). AppLayout.tsx (LaunchProvider/LaunchContext/
// useAlarms-heavy) isn't mounted directly here, matching this file's own
// established source-verification pattern above -- resolveShellHeightStyle
// itself (the actual height-source decision) has full behavioral coverage
// in useVisualViewportInsets.test.ts.
describe("C2 (task 17f): the mobile shell wires useVisualViewportInsets as an ACTIVE height correction, scoped to the chat page only", () => {
  it("AppLayout imports and calls useVisualViewportInsets/resolveShellHeightStyle", () => {
    expect(appLayoutSource).toMatch(/from "@\/features\/chat\/useVisualViewportInsets"/);
    expect(appLayoutSource).toMatch(/useVisualViewportInsets\(\)/);
    expect(appLayoutSource).toMatch(/resolveShellHeightStyle\(/);
  });

  it("the correction is scoped to hideMobileChrome (the chat page) -- every other page keeps h-[100dvh] alone, untouched", () => {
    expect(appLayoutSource).toMatch(/hideMobileChrome \? resolveShellHeightStyle\(viewportHeightPx\) : undefined/);
  });

  it("the h-[100dvh] class remains as the CSS fallback -- the JS measurement is layered on top via inline style, not a replacement", () => {
    expect(appLayoutSource).toMatch(/className="lg:hidden flex flex-col h-\[100dvh\]"\s+style=\{mobileShellHeight/);
  });
});
