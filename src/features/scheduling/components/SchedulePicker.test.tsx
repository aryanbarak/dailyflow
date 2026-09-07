// @vitest-environment jsdom
//
// CORE-W5 (2026-09-06): SchedulePicker -- chip selection (no network),
// explicit-confirm-only free-text parsing, preview display, error
// surfacing.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchedulePicker } from "./SchedulePicker";

// Importing the real client pulls in the Supabase client, whose env guard
// throws outside a configured environment; tests always inject `parseText`
// directly, so the real implementation is never called -- this stub only
// needs to exist for the module graph to load (same convention as
// ApiAccessCard.test.tsx / DashboardHomeFlowAiLayout.test.tsx).
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

afterEach(() => {
  cleanup();
});

const baseProps = {
  granularity: "datetime" as const,
  recurrenceRule: null as string | null,
  onChange: vi.fn(),
};

describe("SchedulePicker quick picks (no network)", () => {
  it("a one-time chip emits a resolved datetime with no rrule, and never calls parseText", async () => {
    const onChange = vi.fn();
    const parseText = vi.fn();
    render(<SchedulePicker {...baseProps} onChange={onChange} parseText={parseText} />);
    await userEvent.click(screen.getByRole("button", { name: "Tomorrow morning" }));
    expect(parseText).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    const [result] = onChange.mock.calls[0];
    expect(result.recurrenceRule).toBeNull();
    expect(result.resolvedDateTime).toEqual(expect.any(String));
  });

  it("a recurring chip emits its hard-coded rrule with no resolvedDateTime, and never calls parseText", async () => {
    const onChange = vi.fn();
    const parseText = vi.fn();
    render(<SchedulePicker {...baseProps} onChange={onChange} parseText={parseText} />);
    await userEvent.click(screen.getByRole("button", { name: "Every Monday at 9 AM" }));
    expect(parseText).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
      recurrenceEndDate: null,
      resolvedDateTime: null,
    });
  });

  it("clicking Clear on an existing schedule emits an all-null result", async () => {
    const onChange = vi.fn();
    render(<SchedulePicker {...baseProps} recurrenceRule="FREQ=DAILY;BYHOUR=9;BYMINUTE=0" onChange={onChange} parseText={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(onChange).toHaveBeenCalledWith({ recurrenceRule: null, recurrenceEndDate: null, resolvedDateTime: null });
  });

  it("shows a human-readable preview for an already-set schedule", () => {
    render(<SchedulePicker {...baseProps} recurrenceRule="FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0" parseText={vi.fn()} />);
    expect(screen.getByTestId("schedule-preview")).toHaveTextContent("Every Monday at 9 AM");
  });
});

describe("SchedulePicker free text (explicit confirm only)", () => {
  it("does not call parseText while typing -- only on the confirm click", async () => {
    const parseText = vi.fn(async () => ({ ok: true as const, kind: "none" as const, label: "" }));
    render(<SchedulePicker {...baseProps} parseText={parseText} />);
    await userEvent.type(screen.getByPlaceholderText(/every Monday/i), "every Monday at 9am");
    expect(parseText).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(parseText).toHaveBeenCalledTimes(1);
    expect(parseText).toHaveBeenCalledWith("every Monday at 9am", "datetime", "en");
  });

  it("applies a recurring parse result", async () => {
    const onChange = vi.fn();
    const parseText = vi.fn(async () => ({ ok: true as const, kind: "recurring" as const, rrule: "FREQ=WEEKLY;BYDAY=TU", label: "Every Tuesday" }));
    render(<SchedulePicker {...baseProps} onChange={onChange} parseText={parseText} />);
    await userEvent.type(screen.getByPlaceholderText(/every Monday/i), "every Tuesday");
    await userEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(onChange).toHaveBeenCalledWith({ recurrenceRule: "FREQ=WEEKLY;BYDAY=TU", recurrenceEndDate: null, resolvedDateTime: null });
  });

  it("applies a one-time parse result", async () => {
    const onChange = vi.fn();
    const parseText = vi.fn(async () => ({ ok: true as const, kind: "one_time" as const, startTime: "2026-09-10T15:00:00.000Z", label: "Sep 10, 3pm" }));
    render(<SchedulePicker {...baseProps} onChange={onChange} parseText={parseText} />);
    await userEvent.type(screen.getByPlaceholderText(/every Monday/i), "next Thursday at 3pm");
    await userEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(onChange).toHaveBeenCalledWith({ recurrenceRule: null, recurrenceEndDate: null, resolvedDateTime: "2026-09-10T15:00:00.000Z" });
  });

  it("surfaces a translated error message on a failed parse", async () => {
    const parseText = vi.fn(async () => ({ ok: false as const, code: "PROVIDER_UNAVAILABLE" as const, message: "raw" }));
    render(<SchedulePicker {...baseProps} parseText={parseText} />);
    await userEvent.type(screen.getByPlaceholderText(/every Monday/i), "whenever");
    await userEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(await screen.findByRole("status")).toHaveTextContent("temporarily unavailable");
  });

  it("surfaces a 'no schedule detected' message when the model finds nothing to parse", async () => {
    const parseText = vi.fn(async () => ({ ok: true as const, kind: "none" as const, label: "" }));
    render(<SchedulePicker {...baseProps} parseText={parseText} />);
    await userEvent.type(screen.getByPlaceholderText(/every Monday/i), "hello there");
    await userEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/couldn't find a schedule/i);
  });
});
