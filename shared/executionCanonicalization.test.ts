import { describe, expect, it } from "vitest";
import {
  computeToolExecutionCanonicalHash,
  sha256Hex,
  stableSerialize,
  toolExecutionIntentId,
} from "./executionCanonicalization";

describe("stableSerialize", () => {
  it("sorts object keys deterministically regardless of insertion order", () => {
    expect(stableSerialize({ b: 1, a: 2 })).toBe(stableSerialize({ a: 2, b: 1 }));
    expect(stableSerialize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("serializes nested objects and arrays deterministically", () => {
    expect(stableSerialize({ z: [3, 2, 1], a: { y: 1, x: 2 } })).toBe('{"a":{"x":2,"y":1},"z":[3,2,1]}');
  });

  it("rejects __proto__/prototype/constructor keys", () => {
    const poisoned = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    expect(() => stableSerialize(poisoned)).toThrow();
  });

  it("distinguishes null from absent and from other primitives", () => {
    expect(stableSerialize({ a: null })).toBe('{"a":null}');
    expect(stableSerialize({})).toBe("{}");
    expect(stableSerialize({ a: null })).not.toBe(stableSerialize({}));
  });
});

describe("sha256Hex", () => {
  it("matches a known SHA-256 test vector for an empty string", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("is deterministic for the same input", async () => {
    const a = await sha256Hex("smartflow");
    const b = await sha256Hex("smartflow");
    expect(a).toBe(b);
  });
});

describe("computeToolExecutionCanonicalHash", () => {
  const base = {
    actorId: "user-1",
    toolId: "tasks.create",
    domain: "tasks",
    action: "create",
    normalizedArguments: { title: "Call Ahmad", dueDate: "2026-09-01" },
  };

  it("is deterministic and key-order independent in normalizedArguments", async () => {
    const a = await computeToolExecutionCanonicalHash(base);
    const b = await computeToolExecutionCanonicalHash({
      ...base,
      normalizedArguments: { dueDate: "2026-09-01", title: "Call Ahmad" },
    });
    expect(a).toBe(b);
  });

  it("changes when any identity-relevant field changes", async () => {
    const baseline = await computeToolExecutionCanonicalHash(base);
    const differentActor = await computeToolExecutionCanonicalHash({ ...base, actorId: "user-2" });
    const differentTool = await computeToolExecutionCanonicalHash({ ...base, toolId: "tasks.update" });
    const differentArgs = await computeToolExecutionCanonicalHash({
      ...base,
      normalizedArguments: { ...base.normalizedArguments, title: "Call Sara" },
    });
    const withTarget = await computeToolExecutionCanonicalHash({ ...base, targetId: "task-123" });
    expect(differentActor).not.toBe(baseline);
    expect(differentTool).not.toBe(baseline);
    expect(differentArgs).not.toBe(baseline);
    expect(withTarget).not.toBe(baseline);
  });

  it("ignores nothing outside the declared preimage -- an unrelated extra property on the input object cannot change the hash", async () => {
    const withExtra = await computeToolExecutionCanonicalHash({
      ...base,
      // @ts-expect-error -- deliberately passing a field outside the type to prove it is not read
      unrelatedField: "should never affect the hash",
    });
    expect(withExtra).toBe(await computeToolExecutionCanonicalHash(base));
  });
});

describe("toolExecutionIntentId", () => {
  it("is a stable 32-hex-char slice of the hash, prefixed", () => {
    expect(toolExecutionIntentId("abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567")).toBe(
      "intent:abcdef0123456789abcdef0123456789",
    );
  });
});
