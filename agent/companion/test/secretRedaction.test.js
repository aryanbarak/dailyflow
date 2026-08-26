import { describe, it, expect } from "vitest";
import { redactSecrets, redactSecretsDeep } from "../src/secretRedaction.js";

describe("secretRedaction", () => {
  it("redacts a GitHub token pattern", () => {
    const text = `used token ghp_${"A".repeat(36)} while working`;
    expect(redactSecrets(text)).not.toContain("ghp_");
    expect(redactSecrets(text)).toContain("[redacted]");
  });

  it("redacts an Anthropic-style API key", () => {
    const text = "key: sk-ant-api03-abcdefghijklmnop";
    expect(redactSecrets(text)).not.toContain("sk-ant-");
  });

  it("leaves ordinary text untouched", () => {
    const text = "Created NOTE.md as requested.";
    expect(redactSecrets(text)).toBe(text);
  });

  it("redacts secrets nested inside an object/array structure", () => {
    const input = {
      summary: `token ghp_${"B".repeat(36)}`,
      nested: { list: [`Bearer ${"x".repeat(20)}`, "fine"] },
    };
    const out = redactSecretsDeep(input);
    expect(JSON.stringify(out)).not.toContain("ghp_");
    expect(JSON.stringify(out)).not.toMatch(/Bearer x{20}/);
    expect(out.nested.list[1]).toBe("fine");
  });
});
