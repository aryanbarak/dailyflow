import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Task 17f, B1/B2: the PO decided to remove the persistent desktop
// Conversations panel entirely -- desktop now matches mobile, the
// conversation list lives ONLY in ConversationsDrawer (a header icon opens
// it, same as mobile). ChatPage's default export mounts useAuth/useTasks/
// useWorkspace/useChatSessions/useProfile and a dozen other real hooks
// (see this file's own imports) -- no existing test in this codebase
// mounts it directly (ChatPage.test.tsx/ChatPageRTLBehavior.test.tsx both
// test extracted pure functions and sub-components instead, the
// established pattern here). Building the mocking infrastructure to mount
// the full page is out of proportion for a layout-removal regression
// guard, so this verifies the actual shipped SOURCE directly -- a
// lightweight but real regression guard: the desktop sidebar markup
// (`lg:w-[260px]`, `ConversationsList` imported into ChatPage.tsx) must be
// gone, the chat column must self-centre at lg+, and the header's History
// button (which ChatPageHeader.test.tsx verifies renders/works) must no
// longer be mobile-only.

const chatPageSource = readFileSync(
  fileURLToPath(new URL("./ChatPage.tsx", import.meta.url)),
  "utf-8",
);
const chatPageHeaderSource = readFileSync(
  fileURLToPath(new URL("../features/chat/components/ChatPageHeader.tsx", import.meta.url)),
  "utf-8",
);

describe("B1 (task 17f): the persistent desktop Conversations panel is gone from ChatPage.tsx", () => {
  it("no desktop-sidebar-specific width/border classes remain", () => {
    expect(chatPageSource).not.toMatch(/lg:w-\[260px\]/);
    expect(chatPageSource).not.toMatch(/hidden lg:flex lg:w-/);
  });

  it("ConversationsList is no longer imported or rendered directly by ChatPage.tsx -- it only lives inside ConversationsDrawer now", () => {
    expect(chatPageSource).not.toMatch(/import\s*\{\s*ConversationsList\s*\}/);
  });

  it("ConversationsDrawer is still rendered (the ONE remaining place the conversation list lives, for both mobile and desktop)", () => {
    expect(chatPageSource).toMatch(/<ConversationsDrawer/);
  });
});

describe("B2 (task 17f): the chat column takes the freed width and self-centres at lg+", () => {
  it("the chat column carries a centred max-width at lg+, not an unconstrained full-bleed flex-1", () => {
    expect(chatPageSource).toMatch(/relative flex min-w-0 flex-1 flex-col lg:mx-auto lg:max-w-3xl/);
  });

  it("the 70ch bubble reading-measure cap from task 17e is untouched", () => {
    expect(chatPageSource).toMatch(/lg:max-w-\[70ch\]/);
  });
});

describe("B1 (task 17f): the header's History/Conversations button is no longer mobile-only", () => {
  it("the Conversations button has no lg:hidden class (unlike the More button, which stays mobile-only, out of this task's scope)", () => {
    const conversationsButtonBlock = chatPageHeaderSource.slice(
      chatPageHeaderSource.indexOf("onClick={onOpenConversations}") - 200,
      chatPageHeaderSource.indexOf("onClick={onOpenConversations}") + 50,
    );
    expect(conversationsButtonBlock).not.toMatch(/lg:hidden/);

    const moreButtonBlock = chatPageHeaderSource.slice(
      chatPageHeaderSource.indexOf("onClick={onOpenMoreMenu}") - 200,
      chatPageHeaderSource.indexOf("onClick={onOpenMoreMenu}") + 50,
    );
    expect(moreButtonBlock).toMatch(/lg:hidden/);
  });
});
