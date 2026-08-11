// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatComposer } from "./ChatComposer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubPointer(kind: "fine" | "coarse") {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: query === "(pointer: fine)" ? kind === "fine" : false })),
  );
}

describe("ChatComposer", () => {
  it("dir=auto is set on the textarea for correct RTL/LTR base-direction inference (task 11e bidi convention)", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("dir", "auto");
  });

  it("the send button sits at the logical end (start in LTR document flow via the `end-*` Tailwind utility) so it flips automatically for RTL, never a hardcoded left/right", () => {
    render(<ChatComposer value="hello" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("end-1");
    expect(button.className).not.toMatch(/\bleft-1\b|\bright-1\b/);
  });

  it("the send button meets the >=44px touch-target minimum", () => {
    render(<ChatComposer value="hello" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("h-11"); // 2.75rem = 44px in the default Tailwind scale
    expect(button.className).toContain("w-11");
  });

  it("send is disabled when the draft is empty or whitespace-only", () => {
    render(<ChatComposer value="   " onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("send is enabled once there is real content", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("disabled prop disables both the textarea and the send button (no double-send affordance)", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("clicking the send button calls onSend", async () => {
    const onSend = vi.fn();
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={onSend} disabled={false} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("on a fine-pointer (desktop) device, Enter sends and Shift+Enter does not", async () => {
    stubPointer("fine");
    const onSend = vi.fn();
    const onChange = vi.fn();
    render(<ChatComposer value="hi" onChange={onChange} onSend={onSend} disabled={false} />);
    const textarea = screen.getByRole("textbox");
    textarea.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledTimes(1);

    onSend.mockClear();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("on a coarse-pointer (touch/mobile) device, Enter does NOT send -- it behaves like ordinary text input", async () => {
    stubPointer("coarse");
    const onSend = vi.fn();
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={onSend} disabled={false} />);
    const textarea = screen.getByRole("textbox");
    textarea.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter never sends when the draft is empty, even on desktop", async () => {
    stubPointer("fine");
    const onSend = vi.fn();
    render(<ChatComposer value="" onChange={vi.fn()} onSend={onSend} disabled={false} />);
    const textarea = screen.getByRole("textbox");
    textarea.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("compact mode applies a smaller font-size/padding, but the touch target stays >=44px regardless", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled={false} compact />);
    expect(screen.getByRole("textbox").className).toContain("text-[13px]");
    const button = screen.getByRole("button");
    expect(button.className).toContain("h-11");
    expect(button.className).toContain("w-11");
  });
});

// Task 17c, E4: production evidence showed Persian text starting at the
// LEFT edge and flowing UNDER the send button. Root cause (verified via a
// throwaway diagnostic, not guessed): the field's `pe-12` padding and the
// button's `end-1` position are LOGICAL properties, which only resolve
// against the ELEMENT'S OWN computed `direction` -- and neither the field
// nor the button had one of their own; `dir="auto"` on the textarea only
// ever resolves THAT element's own direction from ITS OWN text content, it
// does not cascade sideways to the sibling send button the way an ancestor
// `dir="rtl"` does. Since nothing anywhere in ChatPage's tree set an
// ambient `dir`, the button's inherited `direction` was ALWAYS "ltr"
// regardless of interface language -- so in Persian, the button stayed on
// the visual right while the RTL-resolved textarea reserved its large
// `pe-12` clearance on the visual LEFT instead, leaving the button
// unprotected on the right and the text overlapping it. The fix is at the
// ROOT: ChatPage's own wrapper now sets `dir={isRTL ? "rtl" : "ltr"}` (see
// ChatPage.tsx), which gives every logical-property descendant -- including
// this composer -- a REAL, correctly-flipping direction to resolve against.
// This test proves that fix actually reaches the composer's own elements.
describe("ChatComposer E4: RTL non-overlap (task 17c)", () => {
  it("the field only ever uses LOGICAL inline-end padding (pe-*), never a physical pr-*/pl-* class", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const textarea = screen.getByRole("textbox");
    expect(textarea.className).toMatch(/\bpe-12\b/);
    expect(textarea.className).not.toMatch(/\bpr-\d|\bpl-\d/);
  });

  it("under an ancestor dir=rtl (what ChatPage's fixed root now provides), the button resolves a real RTL direction -- not the LTR default it would get with no ambient dir at all", () => {
    render(
      <div dir="rtl">
        <ChatComposer value="سلام" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />
      </div>,
    );
    const textarea = screen.getByRole("textbox");
    const button = screen.getByRole("button");
    // The textarea has its OWN dir="auto", which correctly resolves from
    // ITS OWN content ("سلام" is Persian) -- this is expected, unrelated to
    // the ancestor. The BUTTON has no dir of its own, so its direction can
    // ONLY come from the ancestor -- this is the actual thing E4's fix
    // changes, and the assertion that matters here.
    expect(getComputedStyle(textarea).direction).toBe("rtl");
    expect(getComputedStyle(button).direction).toBe("rtl");
  });

  it("with NO ambient dir at all (the pre-fix state), the button's inherited direction stays ltr regardless of the textarea's own dir=auto -- reproducing the exact bug E4 reported", () => {
    render(<ChatComposer value="سلام" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const button = screen.getByRole("button");
    // The button is a SIBLING of the textarea, not a descendant -- the
    // textarea's own dir="auto" (which DOES resolve to rtl for Persian
    // content) has no bearing on the button's inherited direction at all.
    expect(getComputedStyle(button).direction).toBe("ltr");
  });

  it("the send button only ever uses the logical end-1 position, never a physical left-1/right-1 class (regression guard, task 17a's own assertion)", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("end-1");
    expect(button.className).not.toMatch(/\bleft-1\b|\bright-1\b/);
  });
});
