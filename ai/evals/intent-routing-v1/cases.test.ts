import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectIntentRoutingLearningPayloadErrors } from "../../../shared/aiLearning";

const FIXTURE_DIR = __dirname;
const FIXTURE_PATH = join(FIXTURE_DIR, "cases.jsonl");

function loadCases() {
  return readFileSync(FIXTURE_PATH, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

const CANONICAL_EXACT_TIME = "برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم.";
const CANONICAL_DATE_ONLY = "برای فردا یک تسک بساز که به احمد زنگ بزنم.";

describe("ai/evals/intent-routing-v1/cases.jsonl -- gold fixture schema", () => {
  const cases = loadCases();

  it("has at least 90 cases (task requirement)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(90);
  });

  it("every case has a unique caseId", () => {
    const ids = cases.map((c) => c.caseId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every case has a non-empty utterance and category", () => {
    for (const c of cases) {
      expect(typeof c.utterance).toBe("string");
      expect(c.utterance.length).toBeGreaterThan(0);
      expect(typeof c.category).toBe("string");
      expect(c.category.length).toBeGreaterThan(0);
    }
  });

  it("every case's `expected` field is a valid IntentRoutingLearningPayloadV1", () => {
    for (const c of cases) {
      const errors = collectIntentRoutingLearningPayloadErrors(c.expected);
      expect(errors, `case ${c.caseId} has invalid expected payload: ${errors.join("; ")}`).toEqual([]);
    }
  });

  it("case.language matches expected.language for every case", () => {
    for (const c of cases) {
      expect(c.expected.language, `case ${c.caseId}`).toBe(c.language);
    }
  });

  it("is balanced across English, German, and Farsi (roughly 1/3 each)", () => {
    const counts: Record<string, number> = {};
    for (const c of cases) counts[c.language] = (counts[c.language] ?? 0) + 1;
    expect(Object.keys(counts).sort()).toEqual(["de", "en", "fa"]);
    for (const language of ["en", "de", "fa"]) {
      const share = counts[language] / cases.length;
      expect(share, `${language} share of the fixture`).toBeGreaterThan(0.25);
      expect(share, `${language} share of the fixture`).toBeLessThan(0.4);
    }
  });

  it("covers every required category from the task spec", () => {
    const categories = new Set(cases.map((c) => c.category));
    for (const required of [
      "ordinary_conversation",
      "task_read",
      "task_create",
      "calendar_read",
      "calendar_create",
      "exact_time_scheduling",
      "date_only_task",
      "calendar_update",
      "ambiguous",
      "negative_time_mention",
      "github_read",
      "finance_classification",
      "unsupported",
    ]) {
      expect(categories.has(required), `missing category: ${required}`).toBe(true);
    }
  });

  it("includes the exact-time canonical case, routed to calendar per the PO's semantic rule", () => {
    const found = cases.find((c) => c.utterance === CANONICAL_EXACT_TIME);
    expect(found, "canonical exact-time case not found").toBeDefined();
    expect(found.canonical).toBe(true);
    expect(found.expected).toMatchObject({
      interactionClass: "write",
      domain: "calendar",
      intentType: "create_calendar_event",
      toolId: "calendar.create_event",
      requiresClarification: false,
      requiresApproval: true,
    });
  });

  it("includes the date-only canonical case, staying a task per the PO's semantic rule", () => {
    const found = cases.find((c) => c.utterance === CANONICAL_DATE_ONLY);
    expect(found, "canonical date-only case not found").toBeDefined();
    expect(found.canonical).toBe(true);
    expect(found.expected).toMatchObject({
      interactionClass: "write",
      domain: "tasks",
      intentType: "create_task",
      toolId: "tasks.create",
      requiresClarification: false,
      requiresApproval: true,
    });
  });

  it("ambiguous-category cases resolve to clarification/unknown, never to a concrete domain", () => {
    for (const c of cases.filter((c2) => c2.category === "ambiguous")) {
      expect(c.expected.interactionClass, c.caseId).toBe("clarification");
      expect(c.expected.domain, c.caseId).toBe("unknown");
      expect(c.expected.requiresClarification, c.caseId).toBe(true);
    }
  });

  it("negative-time-mention cases are reads, never writes, despite mentioning a time", () => {
    for (const c of cases.filter((c2) => c2.category === "negative_time_mention")) {
      expect(c.expected.interactionClass, c.caseId).toBe("read");
      expect(c.expected.requiresApproval, c.caseId).toBe(false);
    }
  });

  // ADR-0020 Decision item 7 / task requirement: eval data must never
  // overlap with training data. No training-example file
  // (schemaVersion: 'training-example-v1') exists anywhere under this
  // eval fixture's own directory -- a stray training file placed here by
  // accident would be exactly the kind of silent eval/train contamination
  // this guards against.
  it("this eval fixture directory contains no training-example-shaped file (no eval/train overlap)", () => {
    const files = readdirSync(FIXTURE_DIR);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const content = readFileSync(join(FIXTURE_DIR, file), "utf8");
      expect(content, `${file} must not contain training-example-v1 records`).not.toContain('"training-example-v1"');
    }
  });

  it("no case's `expected` schemaVersion is anything but intent-routing-v1 (never the training-example schema)", () => {
    for (const c of cases) {
      expect(c.expected.schemaVersion, c.caseId).toBe("intent-routing-v1");
    }
  });
});
