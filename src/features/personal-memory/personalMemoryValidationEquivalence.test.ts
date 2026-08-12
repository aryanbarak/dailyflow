// Standing guard against agent/worker/personal-memory-extraction-endpoint.ts's
// duplicated per-kind validation and sensitive-content heuristic drifting
// from the canonical TS validator -- the same pattern
// contextDerivationValidationEquivalence.test.ts already establishes for
// the project layer (review finding F2 there was exactly this kind of
// drift going undetected without a standing test).

import { describe, expect, it } from "vitest";
import { validatePersonalMemoryContent } from "./personalMemoryRecordValidation";
import { normalizeCandidate } from "../../../agent/worker/personal-memory-extraction-endpoint";

const CHAT_ID = "22222222-2222-4222-8222-222222222222";
const refIdKinds = new Map<string, "chat_turn" | "briefing">([[CHAT_ID, "chat_turn"]]);

interface Fixture {
  readonly label: string;
  readonly kind: Parameters<typeof validatePersonalMemoryContent>[0];
  readonly content: Record<string, unknown>;
  readonly expectValid: boolean;
}

const FIXTURES: readonly Fixture[] = [
  { label: "preference: valid with strength", kind: "preference", content: { summary: "Prefers async updates", strength: "strong" }, expectValid: true },
  { label: "preference: valid without optional strength", kind: "preference", content: { summary: "Prefers short meetings" }, expectValid: true },
  { label: "preference: empty summary", kind: "preference", content: { summary: "" }, expectValid: false },
  { label: "preference: invalid strength", kind: "preference", content: { summary: "x", strength: "extreme" }, expectValid: false },
  { label: "goal: valid", kind: "goal", content: { summary: "Learn React Native", timeframe: "long_term" }, expectValid: true },
  { label: "goal: invalid timeframe", kind: "goal", content: { summary: "x", timeframe: "eventually" }, expectValid: false },
  { label: "working_pattern: valid", kind: "working_pattern", content: { summary: "Reviews PRs in the morning", frequency: "daily" }, expectValid: true },
  { label: "commitment: valid", kind: "commitment", content: { summary: "Start running 3x/week", status: "active" }, expectValid: true },
  { label: "commitment: missing required status", kind: "commitment", content: { summary: "Start running 3x/week" }, expectValid: false },
  { label: "commitment: invalid status", kind: "commitment", content: { summary: "x", status: "someday" }, expectValid: false },
  { label: "personal_fact: valid", kind: "personal_fact", content: { summary: "Prefers to be called Aryan", category: "identity" }, expectValid: true },
  { label: "skill: valid", kind: "skill", content: { summary: "Learning algorithms", level: "beginner" }, expectValid: true },
  { label: "skill: invalid level", kind: "skill", content: { summary: "x", level: "expert" }, expectValid: false },
  { label: "sensitive: health content under personal_fact", kind: "personal_fact", content: { summary: "Was diagnosed with anxiety last year" }, expectValid: false },
  { label: "sensitive: family content under preference", kind: "preference", content: { summary: "My husband prefers we eat early" }, expectValid: false },
  { label: "sensitive: emotional state under working_pattern", kind: "working_pattern", content: { summary: "Feels overwhelmed most weeks" }, expectValid: false },
  // Review finding MAJOR #2 (2026-08-personal-memory-layer-review.md,
  // section B) -- the exact two proven bypass payloads, plus neighbors,
  // now that SENSITIVE_CONTENT_PATTERNS covers family nouns and
  // keyword-less medical phrasing.
  { label: "sensitive: daughter (proven bypass, review MAJOR #2)", kind: "personal_fact", content: { summary: "My daughter starts kindergarten this fall" }, expectValid: false },
  { label: "sensitive: checkup (proven bypass, review MAJOR #2)", kind: "commitment", content: { summary: "Annual checkup next month", status: "active" }, expectValid: false },
  { label: "sensitive: son (neighbor)", kind: "personal_fact", content: { summary: "My son just started high school" }, expectValid: false },
  { label: "sensitive: dentist appointment (neighbor)", kind: "commitment", content: { summary: "Dentist appointment next Tuesday", status: "active" }, expectValid: false },
  // Task 18, A3 HARD SENSITIVITY RULE: IBAN/account/card-number-shaped
  // identifiers must be DROPPED, never stored, regardless of kind.
  { label: "financial: German IBAN shape (spaced) must be DROPPED", kind: "personal_fact", content: { summary: "IBAN is DE89 3704 0044 0532 0130 00", category: "general" }, expectValid: false },
  { label: "financial: plain long digit run (account number) must be DROPPED", kind: "personal_fact", content: { summary: "Account number 1234567890123456 on file", category: "general" }, expectValid: false },
  { label: "financial: stable fact with no identifier is accepted", kind: "personal_fact", content: { summary: "Primary bank is Sparkasse Holstein", category: "general" }, expectValid: true },
];

describe.each(FIXTURES)("$label", ({ kind, content, expectValid }) => {
  it("TS canonical validator and Worker normalizeCandidate agree", () => {
    const tsResult = validatePersonalMemoryContent(kind, content);
    expect(tsResult.valid).toBe(expectValid);

    const workerCandidate = {
      kind,
      content,
      confidence: "medium",
      provenanceSourceKind: "chat_turn",
      provenanceSourceRefIds: [CHAT_ID],
    };
    const workerResult = normalizeCandidate(workerCandidate, refIdKinds);
    expect(workerResult !== null).toBe(expectValid);
  });
});
