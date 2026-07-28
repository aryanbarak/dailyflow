import { describe, expect, it } from "vitest";
import {
  containsBinaryMarkers,
  isProtectedRepositoryPath,
  isWithinCodeFileSizeLimit,
  MAX_CODE_FILE_BYTES,
  validateCodeFileContent,
  validateCodeFileProposalInput,
  validateRepositoryIdentifier,
  validateRepositoryRelativePath,
} from "./codeProposalValidator";

describe("validateRepositoryIdentifier", () => {
  it("accepts an exact owner/name identifier", () => {
    expect(validateRepositoryIdentifier("aryan/smartflow")).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ["empty", ""],
    ["missing slash", "smartflow"],
    ["two slashes", "aryan/smartflow/extra"],
    ["leading whitespace", " aryan/smartflow"],
    ["trailing whitespace", "aryan/smartflow "],
  ])("rejects %s", (_label, repo) => {
    expect(validateRepositoryIdentifier(repo).valid).toBe(false);
  });
});

describe("validateRepositoryRelativePath", () => {
  it("accepts a normal nested repository-relative path", () => {
    expect(validateRepositoryRelativePath("src/features/agent/index.ts")).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ["empty", ""],
    ["absolute", "/etc/passwd"],
    ["windows drive", "C:/Windows/System32"],
    ["url", "https://example.com/x"],
    ["backslashes", "src\\index.ts"],
    ["traversal segment", "src/../../etc/passwd"],
    ["dot segment", "./README.md"],
    ["empty segment", "src//index.ts"],
    ["leading whitespace", " README.md"],
    ["trailing whitespace", "README.md "],
  ])("rejects %s", (_label, path) => {
    expect(validateRepositoryRelativePath(path).valid).toBe(false);
  });

  it("rejects a path over the maximum length", () => {
    const longPath = `${"a".repeat(401)}.ts`;
    expect(validateRepositoryRelativePath(longPath).valid).toBe(false);
  });
});

describe("isProtectedRepositoryPath", () => {
  it.each([
    [".env", true],
    [".env.production", true],
    ["nested/.git/config", true],
    [".git/HEAD", true],
    [".github/workflows/ci.yml", true],
    ["credentials", true],
    ["credentials.json", true],
    ["secrets.yaml", true],
    [".npmrc", true],
    [".netrc", true],
    ["deploy/id_rsa", true],
    ["deploy/id_ed25519", true],
    ["certs/server.pem", true],
    ["keys/client.key", true],
    ["src/index.ts", false],
    ["README.md", false],
    ["docs/adr/ADR-0004.md", false],
  ])("evaluates %s as protected=%s", (path, expected) => {
    expect(isProtectedRepositoryPath(path)).toBe(expected);
  });

  it("does not protect the public half of a key pair", () => {
    expect(isProtectedRepositoryPath("deploy/id_rsa.pub")).toBe(false);
  });

  it("rejects a protected path through the full path validator", () => {
    expect(validateRepositoryRelativePath(".env").valid).toBe(false);
    expect(validateRepositoryRelativePath(".github/workflows/ci.yml").valid).toBe(false);
  });
});

describe("containsBinaryMarkers", () => {
  it("returns false for normal text", () => {
    expect(containsBinaryMarkers("hello world\nline two\t(tab)\r\n")).toBe(false);
  });

  it("returns true for an embedded NUL byte", () => {
    expect(containsBinaryMarkers("abc\u0000def")).toBe(true);
  });

  it("returns true for an unpaired high surrogate", () => {
    expect(containsBinaryMarkers("abc\ud800def")).toBe(true);
  });

  it("returns true for an unpaired low surrogate", () => {
    expect(containsBinaryMarkers("abc\udc00def")).toBe(true);
  });

  it("returns false for a valid surrogate pair (emoji)", () => {
    expect(containsBinaryMarkers("hello \u{1F600} world")).toBe(false);
  });

  it("returns true for disallowed control characters", () => {
    expect(containsBinaryMarkers("abc\u0007def")).toBe(true);
  });
});

describe("isWithinCodeFileSizeLimit", () => {
  it("accepts sizes at or under the cap", () => {
    expect(isWithinCodeFileSizeLimit(0)).toBe(true);
    expect(isWithinCodeFileSizeLimit(MAX_CODE_FILE_BYTES)).toBe(true);
  });

  it("rejects sizes over the cap", () => {
    expect(isWithinCodeFileSizeLimit(MAX_CODE_FILE_BYTES + 1)).toBe(false);
  });

  it("rejects negative or non-finite sizes", () => {
    expect(isWithinCodeFileSizeLimit(-1)).toBe(false);
    expect(isWithinCodeFileSizeLimit(Number.NaN)).toBe(false);
  });
});

describe("validateCodeFileContent", () => {
  it("rejects content over the byte cap even when character count is small", () => {
    // Multi-byte characters can exceed the byte cap well before the
    // character-count cap -- validated by UTF-8 byte length, not length.
    const content = "\u{1F600}".repeat(40_000);
    const result = validateCodeFileContent({ content, label: "proposed" });
    expect(result.valid).toBe(false);
  });
});

describe("validateCodeFileProposalInput", () => {
  const baseInput = {
    repo: "aryan/smartflow",
    path: "README.md",
    proposedContent: "hello\n",
    baseContent: "hi\n",
    operationCount: 1,
  };

  it("accepts a valid single-file proposal input", () => {
    expect(validateCodeFileProposalInput(baseInput)).toEqual({ valid: true, errors: [] });
  });

  it("rejects operationCount other than exactly 1", () => {
    const result = validateCodeFileProposalInput({ ...baseInput, operationCount: 2 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("operationCount"))).toBe(true);
  });

  it("aggregates multiple independent failures", () => {
    const result = validateCodeFileProposalInput({
      ...baseInput,
      repo: "not-a-repo",
      path: "../etc/passwd",
      operationCount: 3,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
