import { describe, expect, it } from "vitest";
import { resolveSchedulingDomain } from "./schedulingDomain";

describe("resolveSchedulingDomain (Slice 2B.1.1 shared scheduling-domain primitive)", () => {
  it("explicit calendar trigger alone -> calendar, reason explicit_calendar", () => {
    expect(resolveSchedulingDomain({ explicitCalendarTrigger: true, explicitTaskTrigger: false, hasConcreteTime: false })).toEqual({
      kind: "calendar",
      reason: "explicit_calendar",
    });
  });

  it("explicit calendar trigger + a concrete time -> still calendar, reason stays explicit_calendar (not double-counted)", () => {
    expect(resolveSchedulingDomain({ explicitCalendarTrigger: true, explicitTaskTrigger: false, hasConcreteTime: true })).toEqual({
      kind: "calendar",
      reason: "explicit_calendar",
    });
  });

  it("explicit task trigger, no concrete time -> task", () => {
    expect(resolveSchedulingDomain({ explicitCalendarTrigger: false, explicitTaskTrigger: true, hasConcreteTime: false })).toEqual({
      kind: "task",
    });
  });

  it("explicit task trigger + a concrete time -> calendar, reason exact_time -- the core PO-decision rule (preserve the user's requested time)", () => {
    expect(resolveSchedulingDomain({ explicitCalendarTrigger: false, explicitTaskTrigger: true, hasConcreteTime: true })).toEqual({
      kind: "calendar",
      reason: "exact_time",
    });
  });

  it("both an explicit calendar noun AND an explicit task noun -> ambiguous (two different domain nouns), regardless of time", () => {
    expect(resolveSchedulingDomain({ explicitCalendarTrigger: true, explicitTaskTrigger: true, hasConcreteTime: false })).toEqual({
      kind: "ambiguous",
      reason: "conflicting_domain_nouns",
    });
    expect(resolveSchedulingDomain({ explicitCalendarTrigger: true, explicitTaskTrigger: true, hasConcreteTime: true })).toEqual({
      kind: "ambiguous",
      reason: "conflicting_domain_nouns",
    });
  });

  it("neither trigger -> none, even with a concrete time -- this function never invents write/scheduling intent from a bare time alone", () => {
    expect(resolveSchedulingDomain({ explicitCalendarTrigger: false, explicitTaskTrigger: false, hasConcreteTime: true })).toEqual({ kind: "none" });
    expect(resolveSchedulingDomain({ explicitCalendarTrigger: false, explicitTaskTrigger: false, hasConcreteTime: false })).toEqual({ kind: "none" });
  });
});
