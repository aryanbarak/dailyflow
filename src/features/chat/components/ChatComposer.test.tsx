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

  it("the send button is the textarea's LAST flex sibling in a flex row, so it sits at the flow-end and mirrors automatically for RTL via native flex order (task 17d, V1 -- see the structural-overlap describe block below for why this replaced the old absolute+end-1 approach)", () => {
    render(<ChatComposer value="hello" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const button = screen.getByRole("button");
    const textarea = screen.getByRole("textbox");
    expect(button.parentElement).toBe(textarea.parentElement);
    const siblings = Array.from(button.parentElement!.children);
    expect(siblings.indexOf(button)).toBeGreaterThan(siblings.indexOf(textarea));
    expect(button.className).not.toMatch(/\bleft-1\b|\bright-1\b|\bend-1\b/);
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
describe("ChatComposer V1 (task 17d): structural overlap prevention", () => {
  it("the button is a REAL flex sibling of the textarea -- not absolutely positioned over it", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const button = screen.getByRole("button");
    const textarea = screen.getByRole("textbox");
    expect(button.parentElement).toBe(textarea.parentElement);
    expect(button.className).not.toMatch(/\babsolute\b/);
    expect(button.parentElement!.className).toMatch(/\bflex\b/);
  });

  it("the textarea grows/shrinks (flex-1 min-w-0) while the button never shrinks (shrink-0) -- the box-model guarantee that makes overlap geometrically impossible regardless of direction, font, or zoom", () => {
    render(<ChatComposer value="hi" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />);
    const textarea = screen.getByRole("textbox");
    const button = screen.getByRole("button");
    expect(textarea.className).toMatch(/\bflex-1\b/);
    expect(textarea.className).toMatch(/\bmin-w-0\b/);
    expect(button.className).toMatch(/\bshrink-0\b/);
  });

  it("V1 non-intersection: under RTL, the textarea's content box and the button's border box do not intersect -- computed from the structural flex layout itself, not from a hoped-for padding/absolute-position pairing", () => {
    const { container } = render(
      <div dir="rtl" style={{ width: "320px" }}>
        <ChatComposer value="برای" onChange={vi.fn()} onSend={vi.fn()} disabled={false} />
      </div>,
    );
    const row = container.querySelector(".flex.items-end")!;
    const textarea = screen.getByRole("textbox");
    const button = screen.getByRole("button");
    // The row is a real flex container (verified above); both children
    // participate in flex layout (neither is absolutely positioned, which
    // would remove it from the flex algorithm entirely). Given that, the
    // flex algorithm's own invariant -- a shrink-0 item always keeps its
    // full box, and a flex-1/min-w-0 sibling is laid out in the REMAINING
    // space, never overlapping it -- is what jsdom CAN verify structurally,
    // per the task's own framing ("jsdom can compute this from inline
    // styles/classes if the layout is structural").
    // (Tailwind's compiled stylesheet isn't loaded in this test environment,
    // so `.flex`'s actual `display: flex` can't be read back via
    // getComputedStyle here -- the class name itself, plus the absence of
    // any `position: absolute` inline style/class on either child, is what
    // this environment CAN verify structurally.)
    expect(row.className).toMatch(/\bflex\b/);
    expect(textarea.className).not.toMatch(/\babsolute\b/);
    expect(button.className).not.toMatch(/\babsolute\b/);
    expect(textarea.className).toMatch(/\bflex-1\b/);
    expect(button.className).toMatch(/\bshrink-0\b/);
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
