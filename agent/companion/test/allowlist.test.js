import { describe, it, expect } from "vitest";
import { isRepoAllowed, assertRepoAllowed } from "../src/allowlist.js";

describe("allowlist", () => {
  const allowed = ["aryanbarak/smartflow"];

  it("accepts an allow-listed repository", () => {
    expect(isRepoAllowed("aryanbarak/smartflow", allowed)).toBe(true);
    expect(() => assertRepoAllowed("aryanbarak/smartflow", allowed)).not.toThrow();
  });

  it("denies an unknown repository", () => {
    expect(isRepoAllowed("someone-else/other-repo", allowed)).toBe(false);
    expect(() => assertRepoAllowed("someone-else/other-repo", allowed)).toThrow(/not on the allowlist/);
  });

  it("denies an empty allowlist for any repo", () => {
    expect(isRepoAllowed("aryanbarak/smartflow", [])).toBe(false);
  });

  it("fails closed on non-string input", () => {
    expect(isRepoAllowed(undefined, allowed)).toBe(false);
    expect(isRepoAllowed(null, allowed)).toBe(false);
  });
});
