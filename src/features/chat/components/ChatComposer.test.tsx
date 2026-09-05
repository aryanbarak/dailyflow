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

  it("PO decision (2026-09-05, DeepSeek-style box): the send button lives in the action row BELOW the textarea, inside the same visual box -- after the field in DOM order, justify-end so it mirrors automatically for RTL, never absolutely positioned", () => {
    render(<ChatComposer value="hello" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const button = screen.getByRole("button");
    const textarea = screen.getByRole("textbox");
    // The action row is a sibling of the textarea inside the box wrapper.
    expect(button.parentElement!.parentElement).toBe(textarea.parentElement);
    expect(button.parentElement!.className).toMatch(/\bjustify-end\b/);
    const boxChildren = Array.from(textarea.parentElement!.children);
    expect(boxChildren.indexOf(button.parentElement!)).toBeGreaterThan(boxChildren.indexOf(textarea));
    expect(button.className).not.toMatch(/\bleft-1\b|\bright-1\b|\bend-1\b|\babsolute\b/);
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

// Task 17c, E4 (background): production evidence showed Persian text
// starting at the LEFT edge and flowing UNDER the send button, root-caused
// to the button's `position: absolute` + `end-1` never getting an ambient
// `direction` to resolve against. E4's fix (ChatPage's root now sets a real
// `dir`) is still correct and still tested below, but task 17d's OWN device
// evidence (V1) showed it was NOT SUFFICIENT: on a real Android phone the
// text still clipped behind the button even after that fix shipped. The
// reason: `pe-12` padding lining up with an absolutely-positioned button is
// two independent numbers (48px padding vs. a 44px button + 4px inset) that
// merely HAPPENED to match on desktop/jsdom -- nothing in the box model
// actually GUARANTEED they'd stay in sync on every font/zoom/rendering
// engine. Root fix (V1): the button is now a REAL FLEX SIBLING (`shrink-0`)
// of the textarea (`flex-1 min-w-0`) in one flex row, not an
// absolutely-positioned overlay -- the browser's box model itself makes
// overlap impossible, independent of direction resolution entirely.
// PO decision (2026-09-05, DeepSeek-style box): the buttons moved out of
// the textarea's own flex row into a dedicated action row BELOW the field
// (both inside one visual box). That makes 17d V1's overlap guarantee even
// stronger -- text and buttons occupy separate block-level rows, so
// intersection is impossible by construction, without relying on
// flex-1/shrink-0 arithmetic at all. What must still hold: nothing is
// absolutely positioned, and the rows are real block/flex siblings.
describe("ChatComposer V1 (task 17d) -> PO 2026-09-05: structural overlap prevention", () => {
  it("the button lives in its own flex action row -- a real sibling row of the textarea, never absolutely positioned over it", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const button = screen.getByRole("button");
    const textarea = screen.getByRole("textbox");
    expect(button.parentElement!.parentElement).toBe(textarea.parentElement);
    expect(button.className).not.toMatch(/\babsolute\b/);
    expect(button.parentElement!.className).toMatch(/\bflex\b/);
    expect(textarea.parentElement!.className).toMatch(/\bflex-col\b/);
  });

  it("the button never shrinks (shrink-0) and the field spans the box's full width -- separate rows make overlap structurally impossible", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const textarea = screen.getByRole("textbox");
    const button = screen.getByRole("button");
    expect(textarea.className).toMatch(/\bw-full\b/);
    expect(button.className).toMatch(/\bshrink-0\b/);
  });

  it("non-intersection under RTL: the textarea and the button sit in DIFFERENT rows of a flex-col box -- neither is absolutely positioned, so they cannot intersect in any direction", () => {
    render(
      <div dir="rtl" style={{ width: "320px" }}>
        <ChatComposer value="برای" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />
      </div>,
    );
    const textarea = screen.getByRole("textbox");
    const button = screen.getByRole("button");
    // (Tailwind's compiled stylesheet isn't loaded in this test environment,
    // so `.flex-col`'s actual computed display can't be read back via
    // getComputedStyle here -- the class names themselves, plus the absence
    // of any `position: absolute` on either element, is what this
    // environment CAN verify structurally.)
    expect(textarea.parentElement!.className).toMatch(/\bflex-col\b/);
    expect(textarea.className).not.toMatch(/\babsolute\b/);
    expect(button.className).not.toMatch(/\babsolute\b/);
    expect(button.parentElement).not.toBe(textarea.parentElement);
    expect(button.parentElement!.parentElement).toBe(textarea.parentElement);
  });

  it("no leftover asymmetric pe-12-style padding hack remains on the textarea (the reservation is now structural, not padding-based)", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const textarea = screen.getByRole("textbox");
    expect(textarea.className).not.toMatch(/\bpe-12\b|\bpr-12\b|\bpl-12\b/);
  });
});

// Task 17d, V2: device evidence showed the composer rendering only ONE
// line on first paint despite COMPOSER_MIN_LINES=2 (task 17c, D1) --
// jsdom's own layout-effect timing never surfaced this since it has no
// real font-loading pipeline. Fixed with a CSS-only `minHeight` inline
// style (see ChatComposer.tsx's own comment) that is present in the VERY
// FIRST render output, before any effect has had a chance to run at all --
// these tests assert on that first-render output specifically, not after
// an effect flush, to prove the floor doesn't depend on JS timing.
describe("ChatComposer V2 (task 17d): 2-line minimum applies on first paint, not only after typing", () => {
  it("the native rows attribute is 2 (COMPOSER_MIN_LINES), not 1, from the very first render", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("rows", "2");
  });

  it("a CSS min-height reserving 2 lines is present in the textarea's inline style on first render -- a pure font-size-relative calc, not a JS-measured pixel value that could still be wrong before fonts settle", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // jsdom's inline-style parser arithmetically simplifies the calc()'s
    // constant multiplication (2 * 1.625em -> 3.25em) when it parses the
    // style string -- 3.25em IS exactly 2 lines' worth of leading-relaxed
    // (1.625) line-height, so this is checking the same fact, just in the
    // form jsdom actually stores it.
    expect(textarea.style.minHeight).toContain("3.25em");
    expect(textarea.style.minHeight).toContain("1.25rem");
  });

  it("compact mode still reserves a 2-line floor, just with the smaller compact padding baked into the same calc", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} compact />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.style.minHeight).toContain("3.25em");
    expect(textarea.style.minHeight).toContain("1rem");
  });

  it("no min-h-0 class remains that would fight the inline min-height (the old value was actively working AGAINST a 2-line floor)", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    expect(screen.getByRole("textbox").className).not.toMatch(/\bmin-h-0\b/);
  });
});

describe("ChatComposer E4 (task 17c): ambient RTL direction still reaches the composer's elements", () => {
  it("under an ancestor dir=rtl (what ChatPage's fixed root provides), the button resolves a real RTL direction -- not the LTR default it would get with no ambient dir at all", () => {
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
    // ONLY come from the ancestor.
    expect(getComputedStyle(textarea).direction).toBe("rtl");
    expect(getComputedStyle(button).direction).toBe("rtl");
  });

  it("with NO ambient dir at all, the button's inherited direction stays ltr regardless of the textarea's own dir=auto", () => {
    render(<ChatComposer value="سلام" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const button = screen.getByRole("button");
    expect(getComputedStyle(button).direction).toBe("ltr");
  });
});

// Task 19 (Attach file in Flow AI): the attach control is opt-in -- it
// renders ONLY when onAttachFile is provided, which is exactly why every
// test ABOVE this point (none of which pass that prop) keeps working
// unmodified: they still see exactly one button (send), same as before this
// task.
describe("ChatComposer -- attach control (task 19)", () => {
  it("renders no attach button at all when onAttachFile is not provided (pre-task-19 callers unaffected)", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders an attach button side by side with send in the action row (PO 2026-09-05: attach first, send last), when onAttachFile is provided", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    const attachButton = screen.getByRole("button", { name: /attach/i });
    const sendButton = screen.getByRole("button", { name: /send/i });
    // Both buttons share ONE action row inside the composer box; attach
    // comes first in DOM order so the pair mirrors automatically for RTL.
    expect(attachButton.parentElement).toBe(sendButton.parentElement);
    const siblings = Array.from(attachButton.parentElement!.children);
    expect(siblings.indexOf(attachButton)).toBeLessThan(siblings.indexOf(sendButton));
  });

  it("the attach button meets the >=44px touch-target minimum, same as the send button", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} />);
    const attachButton = screen.getByRole("button", { name: /attach/i });
    expect(attachButton.className).toContain("h-11");
    expect(attachButton.className).toContain("w-11");
    expect(attachButton.className).not.toMatch(/\babsolute\b/);
  });

  it("clicking the attach button opens the hidden file input (structural, not absolutely-positioned)", async () => {
    const user = userEvent.setup();
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} />);
    const attachButton = screen.getByRole("button", { name: /attach/i });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");
    await user.click(attachButton);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("selecting a file through the hidden input calls onAttachFile with that File", async () => {
    const onAttachFile = vi.fn();
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={onAttachFile} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await userEvent.upload(fileInput, file);
    expect(onAttachFile).toHaveBeenCalledTimes(1);
    expect(onAttachFile.mock.calls[0][0]).toBe(file);
  });

  it("the hidden file input's accept attribute matches the accepted attachment mime types", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.accept).toContain("application/pdf");
    expect(fileInput.accept).toContain("image/png");
    expect(fileInput.accept).toContain("text/plain");
  });

  it("attach and disabled/attachBusy: the attach button is disabled while the composer itself is disabled or an upload is in progress", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} attachBusy />);
    expect(screen.getByRole("button", { name: /attach/i })).toBeDisabled();
  });

  it("renders the attachment chip with file name and formatted size when attachedFile is set", () => {
    const file = new File(["x".repeat(2048)], "statement.txt", { type: "text/plain" });
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} attachedFile={file} />);
    expect(screen.getByTestId("chat-attachment-chip")).toHaveTextContent("statement.txt");
    expect(screen.getByTestId("chat-attachment-chip")).toHaveTextContent("2.0 KB");
  });

  it("the chip's file name is routed through bidi isolation for RTL/mixed-direction file names", () => {
    const file = new File(["x"], "پرونده.pdf", { type: "application/pdf" });
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} attachedFile={file} />);
    const chip = screen.getByTestId("chat-attachment-chip");
    // isolateEmbeddedBidiRuns wraps the minority-direction run in a <bdi> --
    // the exact assertion documentTypeMigration-style tests in this repo use
    // to prove the utility was actually invoked, not just plain interpolation.
    expect(chip.querySelector("bdi")).not.toBeNull();
  });

  it("clicking remove on the chip calls onRemoveAttachedFile", async () => {
    const onRemove = vi.fn();
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    render(
      <ChatComposer
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        disabled={false}
        onAttachFile={vi.fn()}
        attachedFile={file}
        onRemoveAttachedFile={onRemove}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("renders no chip at all when there is no attachedFile", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} />);
    expect(screen.queryByTestId("chat-attachment-chip")).toBeNull();
  });

  it("renders attachError text (e.g. an unsupported-type or too-large rejection message) with role=alert", () => {
    render(
      <ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} attachError="File too large. Maximum size is 10 MB." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("File too large");
  });

  it("non-overlap still holds with the attach button present: both buttons live in the action row below the field (shrink-0), never in the textarea's own row", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} />);
    const textarea = screen.getByRole("textbox");
    const attachButton = screen.getByRole("button", { name: /attach/i });
    const sendButton = screen.getByRole("button", { name: /send/i });
    expect(textarea.className).toMatch(/\bw-full\b/);
    expect(attachButton.parentElement).not.toBe(textarea.parentElement);
    expect(attachButton.className).toMatch(/\bshrink-0\b/);
    expect(sendButton.className).toMatch(/\bshrink-0\b/);
  });

  it("V2 2-line minimum is unaffected by the attach control's presence", () => {
    render(<ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} disabled={false} onAttachFile={vi.fn()} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea).toHaveAttribute("rows", "2");
    expect(textarea.style.minHeight).toContain("3.25em");
  });
});
