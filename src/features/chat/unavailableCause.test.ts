import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  UNAVAILABLE_CAUSE,
  UNAVAILABLE_CAUSE_LOG_PREFIX,
  formatUnavailableCause,
  logUnavailableCause,
} from "./unavailableCause";

// ENG-06f: three unrelated failures render the same user-facing
// "temporarily unavailable" sentence, and telling them apart from logs
// alone cost three investigation rounds (ENG-06 blamed the reasoning
// timeout, ENG-06c blamed a provider outage and was wrong, ENG-06e
// measured it as the chat-lane ceiling). These tests pin the diagnostic
// that makes the next occurrence self-identifying.
describe("unavailableCause", () => {
  it("emits one greppable line carrying the cause code", () => {
    const line = formatUnavailableCause(UNAVAILABLE_CAUSE.CHAT_LANE_TIMEOUT);

    expect(line).toContain(UNAVAILABLE_CAUSE_LOG_PREFIX);
    expect(line).toContain("cause=CHAT_LANE_TIMEOUT");
  });

  it("appends detail as flat key=value pairs, skipping absent values", () => {
    const line = formatUnavailableCause(UNAVAILABLE_CAUSE.CHAT_LANE_TIMEOUT, {
      ceilingMs: 25_000,
      elapsedMs: 25_001,
      omittedUndefined: undefined,
      omittedNull: null,
    });

    expect(line).toBe("[UnavailableCause] cause=CHAT_LANE_TIMEOUT ceilingMs=25000 elapsedMs=25001");
    expect(line).not.toContain("omitted");
  });

  // The whole point is that ONE grep finds every producer. If two codes
  // ever collide, that grep silently under-reports -- which is exactly
  // the failure mode this module exists to end.
  it("gives every producer a distinct code", () => {
    const codes = Object.values(UNAVAILABLE_CAUSE);

    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBeGreaterThanOrEqual(5);
  });

  it("logs at warn level -- above debug noise, but not an unhandled fault", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      logUnavailableCause(UNAVAILABLE_CAUSE.OVERLAY_PROVIDER_UNAVAILABLE, { intentSignal: "explicit" });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        "[UnavailableCause] cause=OVERLAY_PROVIDER_UNAVAILABLE intentSignal=explicit",
      );
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  // agent/worker is a separate deployable with its own tsconfig and never
  // imports from src/, so the Worker's two cause codes are plain string
  // literals over there. That duplication is deliberate but silent -- it
  // would drift the first time someone renamed a code here and the grep
  // would quietly stop matching the Worker half. This reads the Worker
  // source and pins the literals instead of trusting the convention.
  it("keeps the Worker's duplicated literals identical to this module's codes", () => {
    const workerSource = readFileSync(
      path.join(process.cwd(), "agent", "worker", "index.ts"),
      "utf8",
    );

    expect(workerSource).toContain(
      `${UNAVAILABLE_CAUSE_LOG_PREFIX} cause=${UNAVAILABLE_CAUSE.WORKER_PROVIDER_UNAVAILABLE_REASONING}`,
    );
    expect(workerSource).toContain(
      `${UNAVAILABLE_CAUSE_LOG_PREFIX} cause=${UNAVAILABLE_CAUSE.WORKER_PROVIDER_UNAVAILABLE_CHAT}`,
    );
  });

  // Both Worker producers must be tagged. The plain-chat one is the easy
  // one to miss: it returns a normal 200 carrying the honest sentence as
  // the reply, so without its tag a tail shows no error status at all.
  it("tags both Worker producers, including the one that returns 200", () => {
    const workerSource = readFileSync(
      path.join(process.cwd(), "agent", "worker", "index.ts"),
      "utf8",
    );
    const tagged = workerSource.match(/\[UnavailableCause\] cause=/g) ?? [];

    expect(tagged.length).toBe(2);
  });
});
