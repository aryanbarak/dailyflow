// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JumpToLatestPill } from "./JumpToLatestPill";

afterEach(cleanup);

describe("JumpToLatestPill", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(<JumpToLatestPill visible={false} onClick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a clickable pill when visible, and calls onClick", async () => {
    const onClick = vi.fn();
    render(<JumpToLatestPill visible onClick={onClick} />);
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
