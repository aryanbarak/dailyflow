import { describe, it, expect } from "vitest";
import { assertNotDefaultBranch, remoteUrlFor } from "../src/git.js";

describe("assertNotDefaultBranch", () => {
  it("throws for main", () => {
    expect(() => assertNotDefaultBranch("main")).toThrow(/DEFAULT_BRANCH_DENIED|default\/protected/);
  });

  it("throws for master", () => {
    expect(() => assertNotDefaultBranch("master")).toThrow();
  });

  it("throws case-insensitively", () => {
    expect(() => assertNotDefaultBranch("Main")).toThrow();
    expect(() => assertNotDefaultBranch("MASTER")).toThrow();
  });

  it("throws for empty/missing branch names", () => {
    expect(() => assertNotDefaultBranch("")).toThrow();
    expect(() => assertNotDefaultBranch(undefined)).toThrow();
  });

  it("allows a normal task branch name", () => {
    expect(() => assertNotDefaultBranch("eng-03-spike-abc-123")).not.toThrow();
  });
});

describe("remoteUrlFor", () => {
  it("builds a GitHub URL by default", () => {
    expect(remoteUrlFor("aryanbarak/smartflow")).toBe("https://github.com/aryanbarak/smartflow.git");
  });

  it("builds a local path URL for a local gitRemoteBase override", () => {
    expect(remoteUrlFor("origin.git", "/tmp/fixture")).toBe("/tmp/fixture/origin.git");
  });
});
