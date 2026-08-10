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
