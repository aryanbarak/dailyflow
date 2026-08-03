// SmartFlow -- Repository Documents Adapter.
//
// Pure, deterministic allowlist and path-security logic. No filesystem
// access, no clock read, no randomness -- every function here is a plain
// string computation over a caller-supplied relative path, fully testable
// without a temp directory. The actual filesystem read and real-path
// containment check live in repositoryDocumentFileReader.ts, which treats a
// path accepted here as merely "shaped safely," never as "known to exist" or
// "known not to escape the repository root via a symlink" -- this module
// cannot prove either, since it never touches disk.
//
// This is deliberately a fixed, explicit allowlist rather than a recursive
// scan (project-evidence-acquisition.md section 21: least privilege, safe
// reference/path validation) -- every entry names exactly one directory or
// exactly one file, and maps to exactly one ProjectSourceKind, so a
// source-kind/path mismatch is always a hard rejection, never a silent
// coercion.

import type { ProjectSourceKind } from "./projectContextTypes";

/** The only ProjectSourceKind values this credential-free document adapter can ever produce. `verified_repository_state` and `verified_integration_evidence` are structurally out of scope -- no repository-local document can satisfy them. */
export const DOCUMENT_ADAPTER_SUPPORTED_SOURCE_KINDS: readonly ProjectSourceKind[] = [
  "repository_document",
  "architecture_document",
  "adr",
  "roadmap_document",
  "product_direction_document",
  "project_status_document",
];

const NULL_BYTE_CHARACTER = String.fromCharCode(0);
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/;
const MARKDOWN_EXTENSION_PATTERN = /\.md$/;

interface AllowlistEntry {
  readonly sourceKind: ProjectSourceKind;
  matches(segments: readonly string[]): boolean;
}

function exactFile(fileName: string, sourceKind: ProjectSourceKind): AllowlistEntry {
  return {
    sourceKind,
    matches: (segments) => segments.length === 1 && segments[0] === fileName,
  };
}

/** Matches any Markdown file strictly under the given directory segments -- not the directory itself, and never a same-named sibling (e.g. "docs/architecture-old/x.md" does not match ["docs", "architecture"]). */
function underDirectory(prefixSegments: readonly string[], sourceKind: ProjectSourceKind): AllowlistEntry {
  return {
    sourceKind,
    matches: (segments) =>
      segments.length > prefixSegments.length &&
      prefixSegments.every((segment, index) => segments[index] === segment) &&
      MARKDOWN_EXTENSION_PATTERN.test(segments[segments.length - 1]),
  };
}

/**
 * The explicit, deterministic allowlist (project-evidence-acquisition.md
 * section 21). Every entry is Markdown-only and maps to exactly one source
 * kind -- there is no broad recursive repository scan, and no entry here
 * ever reaches `.git/`, `node_modules/`, `dist/`, `build/`, `coverage/`,
 * hidden files, or anything outside `docs/` plus the two named root files.
 */
const ALLOWLIST: readonly AllowlistEntry[] = [
  exactFile("README.md", "repository_document"),
  exactFile("PROJECT_STATUS.md", "project_status_document"),
  underDirectory(["docs", "architecture"], "architecture_document"),
  underDirectory(["docs", "decisions", "adr"], "adr"),
  underDirectory(["docs", "product"], "product_direction_document"),
  underDirectory(["docs", "roadmap"], "roadmap_document"),
];

export type PathRejectionReason =
  | "EMPTY"
  | "NULL_BYTE"
  | "PERCENT_ENCODING"
  | "BACKSLASH"
  | "UNC_PATH"
  | "ABSOLUTE_PATH"
  | "WINDOWS_DRIVE"
  | "EMPTY_SEGMENT"
  | "DOT_SEGMENT"
  | "UNSAFE_SEGMENT_CHARACTERS"
  | "UNSUPPORTED_EXTENSION"
  | "NOT_ALLOWLISTED"
  | "UNSUPPORTED_SOURCE_KIND"
  | "SOURCE_KIND_MISMATCH";

export type PathValidationResult =
  | { safe: true; sourceKind: ProjectSourceKind; relativePath: string }
  | { safe: false; reason: PathRejectionReason };

/**
 * Validates that `relativePath` is safely shaped, allowlisted, and matches
 * the caller-requested `sourceKind`. Treats every input as untrusted --
 * including `sourceKind`, which is checked against this adapter's supported
 * subset before any path work happens, so an unsupported kind fails closed
 * without even inspecting the path.
 */
export function validateRepositoryDocumentPath(
  requestedSourceKind: ProjectSourceKind,
  relativePath: unknown,
): PathValidationResult {
  if (!DOCUMENT_ADAPTER_SUPPORTED_SOURCE_KINDS.includes(requestedSourceKind)) {
    return { safe: false, reason: "UNSUPPORTED_SOURCE_KIND" };
  }
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return { safe: false, reason: "EMPTY" };
  }
  if (relativePath.includes(NULL_BYTE_CHARACTER)) return { safe: false, reason: "NULL_BYTE" };
  if (relativePath.includes("%")) return { safe: false, reason: "PERCENT_ENCODING" };
  if (relativePath.includes("\\")) return { safe: false, reason: "BACKSLASH" };
  if (relativePath.startsWith("//")) return { safe: false, reason: "UNC_PATH" };
  if (relativePath.startsWith("/")) return { safe: false, reason: "ABSOLUTE_PATH" };
  if (WINDOWS_DRIVE_PATTERN.test(relativePath)) return { safe: false, reason: "WINDOWS_DRIVE" };

  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (segment.length === 0) return { safe: false, reason: "EMPTY_SEGMENT" };
    if (segment === "." || segment === "..") return { safe: false, reason: "DOT_SEGMENT" };
    if (!SAFE_PATH_SEGMENT_PATTERN.test(segment)) return { safe: false, reason: "UNSAFE_SEGMENT_CHARACTERS" };
  }
  if (!MARKDOWN_EXTENSION_PATTERN.test(segments[segments.length - 1])) {
    return { safe: false, reason: "UNSUPPORTED_EXTENSION" };
  }

  const matchedEntry = ALLOWLIST.find((entry) => entry.matches(segments));
  if (!matchedEntry) return { safe: false, reason: "NOT_ALLOWLISTED" };
  if (matchedEntry.sourceKind !== requestedSourceKind) return { safe: false, reason: "SOURCE_KIND_MISMATCH" };

  return { safe: true, sourceKind: matchedEntry.sourceKind, relativePath };
}
