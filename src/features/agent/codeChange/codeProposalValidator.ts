// EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
// Deterministic validation only. No network access, no mutation. Every rule
// here fails closed -- an ambiguous or unrecognized shape is rejected, never
// silently normalized into something that might pass.

import type { CodeProposalValidationResult } from "./codeProposalTypes";

export const MAX_REPOSITORY_RELATIVE_PATH_LENGTH = 400;
export const MAX_CODE_FILE_BYTES = 128 * 1024;

const REPO_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const CONTROL_CHAR_CODEPOINTS = new Set<number>([
  ...Array.from({ length: 32 }, (_, index) => index),
  127,
]);
const ALLOWED_CONTROL_CODEPOINTS = new Set<number>([9, 10, 13]); // tab, LF, CR

function hasDisallowedControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (CONTROL_CHAR_CODEPOINTS.has(code) && !ALLOWED_CONTROL_CODEPOINTS.has(code)) return true;
  }
  return false;
}

// Denylist is intentionally explicit and narrow -- every entry blocks a
// concrete secret/credential/CI-authority shape, not a broad guess. A path
// that is not matched here still goes through size/encoding checks.
const PROTECTED_DIRECTORY_SEGMENTS = [".git", ".github/workflows"];
const PROTECTED_FILENAME_EXACT = new Set([
  "credentials",
  "credentials.json",
  "secrets.json",
  "secrets.yml",
  "secrets.yaml",
  ".npmrc",
  ".netrc",
  ".pgpass",
]);
const PROTECTED_FILENAME_PREFIXES = [".env"];
const PROTECTED_FILENAME_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".der"];
const PROTECTED_PRIVATE_KEY_BASENAMES = new Set(["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"]);

export function validateRepositoryIdentifier(repo: string): CodeProposalValidationResult {
  const errors: string[] = [];
  if (typeof repo !== "string" || !repo.trim()) {
    errors.push("repo is required.");
  } else if (repo.trim() !== repo || repo.length > 200 || !REPO_IDENTIFIER_PATTERN.test(repo)) {
    errors.push("repo must be an exact owner/name identifier.");
  }
  return { valid: errors.length === 0, errors };
}

function hasProtectedDirectorySegment(normalized: string): boolean {
  const lower = normalized.toLowerCase();
  return PROTECTED_DIRECTORY_SEGMENTS.some(
    (segment) => lower === segment || lower.startsWith(`${segment}/`) || lower.includes(`/${segment}/`),
  );
}

// id_rsa.pub (the public half) is deliberately not blocked -- only the bare
// basename (the private key, conventionally stored without an extension) is.
function isProtectedFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (PROTECTED_FILENAME_EXACT.has(lower)) return true;
  if (PROTECTED_FILENAME_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}.`))) return true;
  if (PROTECTED_FILENAME_EXTENSIONS.some((extension) => lower.endsWith(extension))) return true;
  if (PROTECTED_PRIVATE_KEY_BASENAMES.has(lower)) return true;
  return false;
}

// Exported separately from the full path validator so the Worker boundary
// and the client-side pre-check can both call the exact same protected-path
// decision instead of maintaining two divergent denylists.
export function isProtectedRepositoryPath(path: string): boolean {
  const normalized = path.trim().replace(/^\/+/, "");
  if (hasProtectedDirectorySegment(normalized)) return true;
  const segments = normalized.split("/");
  const filename = segments[segments.length - 1] ?? "";
  return isProtectedFilename(filename);
}

export function validateRepositoryRelativePath(path: string): CodeProposalValidationResult {
  const errors: string[] = [];
  if (typeof path !== "string" || path.length === 0) {
    errors.push("path is required.");
    return { valid: false, errors };
  }
  if (path !== path.trim()) {
    errors.push("path must not have leading or trailing whitespace.");
  }
  if (path.length > MAX_REPOSITORY_RELATIVE_PATH_LENGTH) {
    errors.push(`path must not exceed ${MAX_REPOSITORY_RELATIVE_PATH_LENGTH} characters.`);
  }
  if (hasDisallowedControlCharacter(path)) {
    errors.push("path must not contain control characters.");
  }
  if (path.includes("\\")) {
    errors.push("path must use forward slashes only.");
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path)) {
    errors.push("path must be repository-relative, not absolute or a URL.");
  }
  if (path.includes("//")) {
    errors.push("path must not contain empty segments.");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    errors.push("path must not contain traversal segments.");
  }
  if (segments.some((segment) => segment.length === 0)) {
    errors.push("path must not contain empty segments.");
  }
  if (errors.length > 0) return { valid: false, errors };

  if (isProtectedRepositoryPath(path)) {
    errors.push("path resolves to a protected location and is denied by default.");
  }

  return { valid: errors.length === 0, errors };
}

export function isWithinCodeFileSizeLimit(byteLength: number): boolean {
  return Number.isFinite(byteLength) && byteLength >= 0 && byteLength <= MAX_CODE_FILE_BYTES;
}

// A JS string is already decoded text, so "binary" here means content that
// could not plausibly have come from a legitimate UTF-8 text file: an
// embedded NUL, an unpaired surrogate half (a sign the bytes were forced
// through a lossy decode), or control characters other than tab/CR/LF.
export function containsBinaryMarkers(content: string): boolean {
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = content.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (CONTROL_CHAR_CODEPOINTS.has(code) && !ALLOWED_CONTROL_CODEPOINTS.has(code)) return true;
  }
  return false;
}

export function utf8ByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export interface CodeFileContentValidationInput {
  content: string;
  label: "base" | "proposed";
}

export function validateCodeFileContent(input: CodeFileContentValidationInput): CodeProposalValidationResult {
  const errors: string[] = [];
  if (typeof input.content !== "string") {
    errors.push(`${input.label} content must be a string.`);
    return { valid: false, errors };
  }
  if (containsBinaryMarkers(input.content)) {
    errors.push(`${input.label} content is not valid UTF-8 text.`);
  }
  const byteLength = utf8ByteLength(input.content);
  if (!isWithinCodeFileSizeLimit(byteLength)) {
    errors.push(`${input.label} content must not exceed ${MAX_CODE_FILE_BYTES} bytes.`);
  }
  return { valid: errors.length === 0, errors };
}

export interface CodeFileProposalInputShape {
  repo: string;
  path: string;
  proposedContent: string;
  baseContent: string;
  operationCount: number;
}

export function validateCodeFileProposalInput(
  input: CodeFileProposalInputShape,
): CodeProposalValidationResult {
  const errors: string[] = [];
  errors.push(...validateRepositoryIdentifier(input.repo).errors);
  errors.push(...validateRepositoryRelativePath(input.path).errors);
  errors.push(...validateCodeFileContent({ content: input.baseContent, label: "base" }).errors);
  errors.push(...validateCodeFileContent({ content: input.proposedContent, label: "proposed" }).errors);
  if (input.operationCount !== 1) {
    errors.push("operationCount must be exactly 1 -- no multi-file proposals in EPIC-08 Slice 1.");
  }
  return { valid: errors.length === 0, errors };
}
