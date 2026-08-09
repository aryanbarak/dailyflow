import { describe, expect, it } from "vitest";
import { LEARN_AI_SUGGESTED_TOPICS } from "./types";

describe("LEARN_AI_SUGGESTED_TOPICS (Conversation Quality v1, task 9)", () => {
  it("keeps exactly the four legacy canonical values -- a stored session using any of these still loads unchanged", () => {
    expect(LEARN_AI_SUGGESTED_TOPICS).toEqual(["fiae_algorithms", "general_it", "wiso", "planner"]);
  });
});
