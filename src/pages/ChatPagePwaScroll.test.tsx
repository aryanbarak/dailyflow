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
// root by default. `overscroll-behavior: contain` was added at every level
// of the chat tree to stop that chain, suppressing the gesture entirely.
//
// Task 20c: C1b (activeSessionResolver.ts) now persists and restores the
// active session on mount, so the reload the gesture triggers is no
// longer destructive -- the PO wants the native gesture BACK. This is a
// container-by-container decision, not a blanket revert: containment is
// removed ONLY from the two links that existed purely to block the
// browser gesture (html/body, ChatPage's own root); it is KEPT wherever a
// container is a genuinely SCROLLED element with its own independent
// "don't chain into whatever's behind me while reading a scrolled list"
// reason (ChatPage's messages region, ConversationsDrawer's list).
// AppLayout's mobile <main> is deliberately left untouched -- it is not
// "the chat page root," and for the chat page specifically it never
// actually scrolls at all (C2's resolveShellHeightStyle sizes chat's own
// root to fill it exactly), so its containment was never a live link in
// THIS chain to begin with; it still matters for every other mobile page.
//
// As with ChatPageDesktopLayout.test.tsx, ChatPage's own root/messages-
// region classes and AppLayout.tsx (LaunchProvider/LaunchContext-heavy)
// are verified against their real shipped SOURCE rather than a full DOM
// mount -- ConversationsDrawer IS mountable (it already has its own test
// setup) and is verified by rendering it for real.

const srcDir = path.resolve(process.cwd(), "src");
const chatPageSource = readFileSync(path.join(srcDir, "pages", "ChatPage.tsx"), "utf-8");
const appLayoutSource = readFileSync(path.join(srcDir, "components", "layout", "AppLayout.tsx"), "utf-8");
const indexCssSource = readFileSync(path.join(srcDir, "index.css"), "utf-8");

describe("task 20c: overscroll-behavior: contain REMOVED where it existed only to block the browser's native pull-to-refresh gesture", () => {
  it("the global page root (html, body) no longer contains overscroll -- the outermost gesture-blocking link is gone", () => {
    expect(indexCssSource).not.toMatch(/overscroll-behavior:\s*contain/);
  });

  it("ChatPage's own root no longer contains overscroll -- it was never itself a scrolled element (overflow-hidden), so this containment served no reading-scroll-chaining purpose", () => {
    expect(chatPageSource).toMatch(/className="flex h-full flex-col overflow-hidden bg-background text-foreground/);
    expect(chatPageSource).not.toMatch(/overflow-hidden overscroll-contain/);
  });
});

describe("task 20c: overscroll-behavior: contain KEPT where a container is a genuinely scrolled element with an independent reading-scroll-chaining reason", () => {
  it("ChatPage's messages scroll region (the primary chat scroll container) still contains overscroll", () => {
    expect(chatPageSource).toMatch(/overflow-y-auto overscroll-contain px-3/);
  });

  it("ConversationsDrawer's own scroll area still contains overscroll, verified by rendering the real component", () => {
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

describe("task 20c: overscroll-behavior: contain deliberately left UNTOUCHED on AppLayout's mobile <main> -- not the chat page root, and inert for chat specifically", () => {
  it("AppLayout's mobile <main> still contains overscroll, unaffected by this task -- it protects every OTHER mobile page's own pull-to-refresh (Settings, Documents, etc.), which this task was never asked to change", () => {
    expect(appLayoutSource).toMatch(/overflow-auto overscroll-contain/);
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
