import { describe, it, expect } from "vitest";
import { WorkspaceLockRegistry } from "../src/workspaceLock.js";

describe("WorkspaceLockRegistry", () => {
  it("allows the first acquire and denies a concurrent second one for the same repo", () => {
    const registry = new WorkspaceLockRegistry();
    const first = registry.acquire("aryanbarak/smartflow");
    expect(first.ok).toBe(true);

    const second = registry.acquire("aryanbarak/smartflow");
    expect(second.ok).toBe(false);
  });

  it("allows a new acquire after the previous holder releases", () => {
    const registry = new WorkspaceLockRegistry();
    const first = registry.acquire("aryanbarak/smartflow");
    expect(first.ok).toBe(true);
    first.release();

    const second = registry.acquire("aryanbarak/smartflow");
    expect(second.ok).toBe(true);
  });

  it("locks are independent per repository", () => {
    const registry = new WorkspaceLockRegistry();
    const a = registry.acquire("aryanbarak/smartflow");
    const b = registry.acquire("aryanbarak/smartflow-github-test");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});
