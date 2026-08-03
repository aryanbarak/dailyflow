// SmartFlow -- Repository Documents Adapter.
//
// The only module in this adapter that touches the real filesystem. Every
// caller here has already proven, via repositoryDocumentPathSecurity.ts,
// that `relativePath` is safely *shaped* -- no traversal segments, no
// absolute/UNC/drive form, allowlisted, Markdown-only. This module performs
// the part that pure string validation cannot: proving the path *resolves*,
// after following any symlink, to a real file that actually stays inside
// the trusted repository root. Containment is checked against the resolved
// real path (`fs.realpath`), never by string-prefix comparison on the
// unresolved candidate path, so a symlink that points outside the root
// cannot be laundered through an otherwise-allowlisted name. If real-path
// resolution cannot complete (the target does not exist, a symlink loop, or
// any other resolution failure), this fails closed as "not found" rather
// than guessing.
//
// Strictly read-only: no function here ever creates, writes, or deletes
// anything on disk (project-evidence-acquisition.md section 8, section 21).

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * 512 KiB -- comfortably more than 10x the largest current repository
 * document (PROJECT_STATUS.md, ~45 KB as of this slice), while remaining a
 * clearly bounded ceiling rather than an effectively unlimited ingestion
 * path. Chosen relative to *current* project documents per this slice's
 * scope, not as a general file-size policy.
 */
export const MAX_DOCUMENT_BYTES = 512 * 1024;

export type FileReadFailureReason =
  | "FILE_NOT_FOUND"
  | "PATH_OUTSIDE_REPOSITORY_ROOT"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "INVALID_UTF8"
  | "CONTENT_CHANGED_DURING_ACQUISITION"
  | "READ_FAILED";

export type FileReadResult =
  | { ok: true; contentBytes: Uint8Array; contentHashHex: string; byteLength: number }
  | { ok: false; reason: FileReadFailureReason };

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Standard SHA-256 crypto API is unavailable.");
  }
  // A Node Buffer (returned by fs.readFile) is a Uint8Array view whose
  // backing ArrayBufferLike type is wider than DOM's BufferSource expects.
  // Copying into a plain Uint8Array is a cheap, bounded copy (this module
  // never reads more than MAX_DOCUMENT_BYTES) and resolves the mismatch
  // without weakening the hash itself -- the copy contains the identical
  // bytes.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function readRepositoryDocument(repositoryRoot: string, relativePath: string): Promise<FileReadResult> {
  let resolvedRoot: string;
  try {
    resolvedRoot = await fs.realpath(repositoryRoot);
  } catch {
    return { ok: false, reason: "FILE_NOT_FOUND" };
  }

  const candidate = path.join(resolvedRoot, ...relativePath.split("/"));
  let realPath: string;
  try {
    realPath = await fs.realpath(candidate);
  } catch {
    return { ok: false, reason: "FILE_NOT_FOUND" };
  }

  const relativeFromRoot = path.relative(resolvedRoot, realPath);
  if (relativeFromRoot === "" || relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    return { ok: false, reason: "PATH_OUTSIDE_REPOSITORY_ROOT" };
  }

  let stats;
  try {
    stats = await fs.stat(realPath);
  } catch {
    return { ok: false, reason: "FILE_NOT_FOUND" };
  }
  if (!stats.isFile()) {
    return { ok: false, reason: "UNSUPPORTED_FILE_TYPE" };
  }
  if (stats.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: "FILE_TOO_LARGE" };
  }

  let contentBytes: Buffer;
  try {
    contentBytes = await fs.readFile(realPath);
  } catch {
    return { ok: false, reason: "READ_FAILED" };
  }

  // Bounded TOCTOU check: the file's size at read time must match the size
  // observed at stat time. This is not a full lock (none is portable here),
  // but it catches the common concurrent-overwrite case without silently
  // hashing content that no longer matches what was inspected above.
  if (contentBytes.byteLength !== stats.size) {
    return { ok: false, reason: "CONTENT_CHANGED_DURING_ACQUISITION" };
  }
  if (contentBytes.byteLength > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: "FILE_TOO_LARGE" };
  }

  // `fatal: true` throws on any invalid UTF-8 byte sequence instead of
  // silently substituting U+FFFD -- the hash below must be a provenance
  // guarantee over bytes that are genuinely valid UTF-8 text, never over
  // silently-corrected content.
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
  } catch {
    return { ok: false, reason: "INVALID_UTF8" };
  }

  const contentHashHex = await sha256Hex(contentBytes);
  return { ok: true, contentBytes, contentHashHex, byteLength: contentBytes.byteLength };
}

const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Best-effort, optional local Git revision lookup. Reads `.git/HEAD` and,
 * where it names a branch ref, the corresponding loose or packed ref file --
 * entirely via local filesystem reads, never by invoking the `git` binary
 * (no child process, no shell, nothing caller-controlled reaches a command
 * line). Returns `undefined` on any failure (not a Git repository, detached
 * state that cannot be resolved, missing/unreadable ref) rather than
 * throwing -- this is optional provenance, never mandatory, and a directory
 * that is not a Git checkout at all is an entirely ordinary case, not an
 * error.
 */
export async function readLocalGitRevision(repositoryRoot: string): Promise<string | undefined> {
  try {
    const gitDir = path.join(repositoryRoot, ".git");
    const headContent = (await fs.readFile(path.join(gitDir, "HEAD"), "utf8")).trim();

    const refMatch = /^ref:\s*(refs\/[^\s]+)$/.exec(headContent);
    if (!refMatch) {
      return FULL_GIT_SHA_PATTERN.test(headContent) ? headContent : undefined;
    }

    const refPath = path.join(gitDir, ...refMatch[1].split("/"));
    try {
      const shaFromRefFile = (await fs.readFile(refPath, "utf8")).trim();
      if (FULL_GIT_SHA_PATTERN.test(shaFromRefFile)) return shaFromRefFile;
    } catch {
      // Loose ref file absent -- fall through to packed-refs below.
    }

    let packedRefs: string;
    try {
      packedRefs = await fs.readFile(path.join(gitDir, "packed-refs"), "utf8");
    } catch {
      return undefined;
    }
    for (const line of packedRefs.split("\n")) {
      const [sha, ref] = line.trim().split(/\s+/);
      if (ref === refMatch[1] && FULL_GIT_SHA_PATTERN.test(sha)) return sha;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
