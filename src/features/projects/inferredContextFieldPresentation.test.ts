import { describe, expect, it } from "vitest";
import {
  buildInferredFieldContentFromForm,
  groupVisibleInferredFields,
  inferredFieldDisplayStatus,
  inferredFieldFormInitialValues,
  inferredFieldPrimaryText,
  inferredFieldSecondaryText,
  isActionable,
  isVisibleByDefault,
} from "./inferredContextFieldPresentation";
import type { InferredProjectContextField } from "./inferredProjectContextFieldTypes";

function field(overrides: Partial<InferredProjectContextField> = {}): InferredProjectContextField {
  return {
    id: "field-1",
    ownerId: "owner-1",
    projectId: "project-1",
    runId: "run-1",
    kind: "risk",
    content: { summary: "Data loss risk", severity: "high" },
    sourceEvidenceIds: ["ev-1"],
    modelIdentity: "gemini",
    derivationVersion: "context-derivation-v1",
    confidence: "high",
    status: "proposed",
    source: "model",
    contentFingerprint: "abc",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("inferredFieldDisplayStatus / isVisibleByDefault / isActionable", () => {
  it("marks a proposed model row as inferred_unconfirmed and actionable", () => {
    const f = field({ status: "proposed", source: "model" });
    expect(inferredFieldDisplayStatus(f)).toBe("inferred_unconfirmed");
    expect(isVisibleByDefault(f)).toBe(true);
    expect(isActionable(f)).toBe(true);
  });

  it("marks a plain confirmed row (same model row) as confirmed, not actionable", () => {
    const f = field({ status: "user_confirmed", source: "model" });
    expect(inferredFieldDisplayStatus(f)).toBe("confirmed");
    expect(isVisibleByDefault(f)).toBe(true);
    expect(isActionable(f)).toBe(false);
  });

  it("distinguishes a correction's new row (source=user, supersedesId set) as corrected, not confirmed", () => {
    const f = field({ status: "user_confirmed", source: "user", supersedesId: "field-original" });
    expect(inferredFieldDisplayStatus(f)).toBe("corrected");
    expect(isVisibleByDefault(f)).toBe(true);
    expect(isActionable(f)).toBe(false);
  });

  it("never treats a user_confirmed row with source=user but no supersedesId as corrected (defensive: cannot actually occur via the RPC, but must not be misread as a correction)", () => {
    const f = field({ status: "user_confirmed", source: "user" });
    expect(inferredFieldDisplayStatus(f)).toBe("confirmed");
  });

  it("hides the pre-correction original row (status=user_corrected) -- never shown as user content", () => {
    const f = field({ status: "user_corrected", source: "model" });
    expect(inferredFieldDisplayStatus(f)).toBeNull();
    expect(isVisibleByDefault(f)).toBe(false);
    expect(isActionable(f)).toBe(false);
  });

  it("hides a rejected row from the default view", () => {
    const f = field({ status: "user_rejected" });
    expect(isVisibleByDefault(f)).toBe(false);
  });

  it("hides a superseded row from the default view", () => {
    const f = field({ status: "superseded" });
    expect(isVisibleByDefault(f)).toBe(false);
  });
});

describe("groupVisibleInferredFields", () => {
  it("excludes hidden statuses, groups by kind in canonical order, newest first", () => {
    const fields: InferredProjectContextField[] = [
      field({ id: "r1", kind: "risk", status: "proposed", createdAt: "2026-08-01T00:00:00.000Z" }),
      field({ id: "r2", kind: "risk", status: "proposed", createdAt: "2026-08-02T00:00:00.000Z" }),
      field({ id: "o1", kind: "objective", status: "user_confirmed", source: "model", createdAt: "2026-08-01T00:00:00.000Z" }),
      field({ id: "rej", kind: "risk", status: "user_rejected", createdAt: "2026-08-03T00:00:00.000Z" }),
      field({ id: "sup", kind: "risk", status: "superseded", createdAt: "2026-08-03T00:00:00.000Z" }),
      field({ id: "orig", kind: "risk", status: "user_corrected", source: "model", createdAt: "2026-08-03T00:00:00.000Z" }),
    ];

    const grouped = groupVisibleInferredFields(fields);

    expect(grouped.map((g) => g.kind)).toEqual(["objective", "risk"]);
    expect(grouped.find((g) => g.kind === "risk")?.fields.map((f) => f.id)).toEqual(["r2", "r1"]);
    expect(grouped.find((g) => g.kind === "objective")?.fields.map((f) => f.id)).toEqual(["o1"]);
  });

  it("returns an empty array when nothing is visible", () => {
    const fields = [field({ status: "user_rejected" }), field({ status: "superseded" })];
    expect(groupVisibleInferredFields(fields)).toEqual([]);
  });
});

describe("inferredFieldPrimaryText / inferredFieldSecondaryText", () => {
  it("reads summary for objective/risk/candidate_action and title for milestone/decision/capability", () => {
    expect(inferredFieldPrimaryText("objective", { summary: "Ship v1", status: "active" })).toBe("Ship v1");
    expect(inferredFieldPrimaryText("milestone", { title: "Beta", status: "planned" })).toBe("Beta");
    expect(inferredFieldPrimaryText("risk", { summary: "Outage risk", severity: "low" })).toBe("Outage risk");
    expect(inferredFieldPrimaryText("candidate_action", { summary: "Add retries" })).toBe("Add retries");
  });

  it("formats a secondary status/severity line, and omits one for candidate_action", () => {
    expect(inferredFieldSecondaryText("risk", { summary: "x", severity: "high" })).toBe("Severity: high");
    expect(inferredFieldSecondaryText("milestone", { title: "x", status: "blocked" })).toBe("Status: blocked");
    expect(inferredFieldSecondaryText("candidate_action", { summary: "x" })).toBeUndefined();
  });
});

describe("form value <-> content conversion", () => {
  it("pre-fills form values from existing content, including a numeric field as a string", () => {
    const values = inferredFieldFormInitialValues("milestone", { title: "Beta", status: "planned", order: 3 });
    expect(values).toEqual({ title: "Beta", status: "planned", order: "3", completedAt: "" });
  });

  it("omits empty fields rather than fabricating a value, and parses a number field back to a number", () => {
    const content = buildInferredFieldContentFromForm("milestone", { title: "Beta", status: "planned", order: "3", completedAt: "" });
    expect(content).toEqual({ title: "Beta", status: "planned", order: 3 });
  });

  it("omits a non-finite number field rather than passing NaN through", () => {
    const content = buildInferredFieldContentFromForm("milestone", { title: "Beta", status: "planned", order: "not-a-number", completedAt: "" });
    expect(content).toEqual({ title: "Beta", status: "planned" });
  });

  it("round-trips risk content through initial-values and back", () => {
    const original = { summary: "Data loss risk", severity: "high", notes: "affects backups" };
    const values = inferredFieldFormInitialValues("risk", original);
    const rebuilt = buildInferredFieldContentFromForm("risk", values);
    expect(rebuilt).toEqual(original);
  });
});
