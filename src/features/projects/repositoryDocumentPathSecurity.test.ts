import { describe, expect, it } from "vitest";
import { DOCUMENT_ADAPTER_SUPPORTED_SOURCE_KINDS, validateRepositoryDocumentPath } from "./repositoryDocumentPathSecurity";

describe("validateRepositoryDocumentPath", () => {
  describe("allowlisted paths", () => {
    it("allows README.md as repository_document", () => {
      const result = validateRepositoryDocumentPath("repository_document", "README.md");
      expect(result).toEqual({ safe: true, sourceKind: "repository_document", relativePath: "README.md" });
    });

    it("allows PROJECT_STATUS.md as project_status_document", () => {
      const result = validateRepositoryDocumentPath("project_status_document", "PROJECT_STATUS.md");
      expect(result).toEqual({ safe: true, sourceKind: "project_status_document", relativePath: "PROJECT_STATUS.md" });
    });

    it("allows a nested architecture document", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs/architecture/project-domain.md");
      expect(result.safe).toBe(true);
    });

    it("allows a nested ADR document", () => {
      const result = validateRepositoryDocumentPath("adr", "docs/decisions/adr/ADR-0006-canonical-product-identity.md");
      expect(result.safe).toBe(true);
    });

    it("allows a nested product direction document", () => {
      const result = validateRepositoryDocumentPath("product_direction_document", "docs/product/product-direction-v1.md");
      expect(result.safe).toBe(true);
    });

    it("allows a nested roadmap document", () => {
      const result = validateRepositoryDocumentPath(
        "roadmap_document",
        "docs/roadmap/project-workspace-implementation-roadmap-v1.md",
      );
      expect(result.safe).toBe(true);
    });

    it("allows a deeply nested allowlisted document", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs/architecture/sub/nested/deep.md");
      expect(result.safe).toBe(true);
    });
  });

  describe("path rejection", () => {
    it("rejects an empty string", () => {
      expect(validateRepositoryDocumentPath("repository_document", "")).toEqual({ safe: false, reason: "EMPTY" });
    });

    it("rejects a non-string value", () => {
      expect(validateRepositoryDocumentPath("repository_document", 42)).toEqual({ safe: false, reason: "EMPTY" });
      expect(validateRepositoryDocumentPath("repository_document", null)).toEqual({ safe: false, reason: "EMPTY" });
      expect(validateRepositoryDocumentPath("repository_document", undefined)).toEqual({ safe: false, reason: "EMPTY" });
    });

    it("rejects a null byte", () => {
      const result = validateRepositoryDocumentPath("repository_document", "README.md\u0000");
      expect(result).toEqual({ safe: false, reason: "NULL_BYTE" });
    });

    it("rejects percent-encoded traversal", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs/architecture/%2e%2e/secret.md");
      expect(result).toEqual({ safe: false, reason: "PERCENT_ENCODING" });
    });

    it("rejects a backslash", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs\\architecture\\project-domain.md");
      expect(result).toEqual({ safe: false, reason: "BACKSLASH" });
    });

    it("rejects a UNC path", () => {
      const result = validateRepositoryDocumentPath("repository_document", "//server/share/README.md");
      expect(result).toEqual({ safe: false, reason: "UNC_PATH" });
    });

    it("rejects an absolute path", () => {
      const result = validateRepositoryDocumentPath("repository_document", "/etc/passwd.md");
      expect(result).toEqual({ safe: false, reason: "ABSOLUTE_PATH" });
    });

    it("rejects a Windows drive prefix", () => {
      const result = validateRepositoryDocumentPath("repository_document", "C:/Windows/System32/config.md");
      expect(result).toEqual({ safe: false, reason: "WINDOWS_DRIVE" });
    });

    it("rejects a '../' traversal segment", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs/architecture/../../secret.md");
      expect(result).toEqual({ safe: false, reason: "DOT_SEGMENT" });
    });

    it("rejects a leading '../' traversal", () => {
      const result = validateRepositoryDocumentPath("repository_document", "../README.md");
      expect(result).toEqual({ safe: false, reason: "DOT_SEGMENT" });
    });

    it("rejects a bare '.' segment", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs/./architecture/project-domain.md");
      expect(result).toEqual({ safe: false, reason: "DOT_SEGMENT" });
    });

    it("rejects an empty path segment (double slash)", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs//architecture/project-domain.md");
      expect(result).toEqual({ safe: false, reason: "EMPTY_SEGMENT" });
    });

    it("rejects a trailing empty segment", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs/architecture/");
      expect(result).toEqual({ safe: false, reason: "EMPTY_SEGMENT" });
    });

    it("rejects unsafe segment characters", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs/architecture/pro*ject.md");
      expect(result).toEqual({ safe: false, reason: "UNSAFE_SEGMENT_CHARACTERS" });
    });

    it("rejects a path not on the allowlist", () => {
      const result = validateRepositoryDocumentPath("repository_document", "src/index.md");
      expect(result).toEqual({ safe: false, reason: "NOT_ALLOWLISTED" });
    });

    it("rejects an allowlist-adjacent directory name (not a true prefix match)", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs/architecture-old/x.md");
      expect(result).toEqual({ safe: false, reason: "NOT_ALLOWLISTED" });
    });

    it("rejects reaching into .git", () => {
      const result = validateRepositoryDocumentPath("repository_document", ".git/config.md");
      expect(result).toEqual({ safe: false, reason: "NOT_ALLOWLISTED" });
    });

    it("rejects reaching into node_modules", () => {
      const result = validateRepositoryDocumentPath("repository_document", "node_modules/pkg/README.md");
      expect(result).toEqual({ safe: false, reason: "NOT_ALLOWLISTED" });
    });

    it("rejects an unsupported (non-Markdown) extension", () => {
      const result = validateRepositoryDocumentPath("architecture_document", "docs/architecture/project-domain.json");
      expect(result).toEqual({ safe: false, reason: "UNSUPPORTED_EXTENSION" });
    });

    it("rejects a source-kind/path mismatch", () => {
      const result = validateRepositoryDocumentPath("roadmap_document", "docs/architecture/project-domain.md");
      expect(result).toEqual({ safe: false, reason: "SOURCE_KIND_MISMATCH" });
    });

    it("rejects README.md requested under the wrong source kind", () => {
      const result = validateRepositoryDocumentPath("project_status_document", "README.md");
      expect(result).toEqual({ safe: false, reason: "SOURCE_KIND_MISMATCH" });
    });

    it("fails closed for an unsupported source kind regardless of path", () => {
      const result = validateRepositoryDocumentPath("verified_repository_state", "README.md");
      expect(result).toEqual({ safe: false, reason: "UNSUPPORTED_SOURCE_KIND" });
    });

    it("fails closed for verified_integration_evidence regardless of path", () => {
      const result = validateRepositoryDocumentPath("verified_integration_evidence", "docs/architecture/x.md");
      expect(result).toEqual({ safe: false, reason: "UNSUPPORTED_SOURCE_KIND" });
    });
  });

  it("exposes exactly the six document-capable source kinds", () => {
    expect([...DOCUMENT_ADAPTER_SUPPORTED_SOURCE_KINDS].sort()).toEqual(
      [
        "adr",
        "architecture_document",
        "product_direction_document",
        "project_status_document",
        "repository_document",
        "roadmap_document",
      ].sort(),
    );
  });
});
