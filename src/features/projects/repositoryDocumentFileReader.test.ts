import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, readLocalGitRevision, readRepositoryDocument } from "./repositoryDocumentFileReader";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smartflow-repo-doc-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

async function write(relativePath: string, content: string | Buffer) {
  const target = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

describe("readRepositoryDocument", () => {
  it("reads a regular Markdown file and returns its exact byte length", async () => {
    await write("README.md", "# Hello\n");
    const result = await readRepositoryDocument(repoRoot, "README.md");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.byteLength).toBe(Buffer.byteLength("# Hello\n"));
      expect(new TextDecoder().decode(result.contentBytes)).toBe("# Hello\n");
    }
  });

  it("computes a stable SHA-256 hash for the same bytes", async () => {
    await write("README.md", "same content");
    const first = await readRepositoryDocument(repoRoot, "README.md");
    const second = await readRepositoryDocument(repoRoot, "README.md");
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.contentHashHex).toBe(second.contentHashHex);
      expect(first.contentHashHex).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("produces a different hash for different bytes", async () => {
    await write("a.md", "content A");
    await write("b.md", "content B");
    const a = await readRepositoryDocument(repoRoot, "a.md");
    const b = await readRepositoryDocument(repoRoot, "b.md");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.contentHashHex).not.toBe(b.contentHashHex);
    }
  });

  it("rejects a missing file as FILE_NOT_FOUND", async () => {
    const result = await readRepositoryDocument(repoRoot, "does-not-exist.md");
    expect(result).toEqual({ ok: false, reason: "FILE_NOT_FOUND" });
  });

  it("rejects a directory as UNSUPPORTED_FILE_TYPE", async () => {
    await fs.mkdir(path.join(repoRoot, "docs", "architecture"), { recursive: true });
    const result = await readRepositoryDocument(repoRoot, "docs/architecture");
    expect(result).toEqual({ ok: false, reason: "UNSUPPORTED_FILE_TYPE" });
  });

  it("rejects binary content that is not valid UTF-8", async () => {
    // A lone continuation byte (0x80) is never valid as the start of a
    // UTF-8 sequence -- guaranteed invalid regardless of platform.
    await write("binary.md", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x80, 0x81, 0x82]));
    const result = await readRepositoryDocument(repoRoot, "binary.md");
    expect(result).toEqual({ ok: false, reason: "INVALID_UTF8" });
  });

  it("rejects a file exceeding the maximum size without truncating", async () => {
    await write("huge.md", "x".repeat(MAX_DOCUMENT_BYTES + 1));
    const result = await readRepositoryDocument(repoRoot, "huge.md");
    expect(result).toEqual({ ok: false, reason: "FILE_TOO_LARGE" });
  });

  it("accepts a file exactly at the maximum size", async () => {
    await write("max.md", "x".repeat(MAX_DOCUMENT_BYTES));
    const result = await readRepositoryDocument(repoRoot, "max.md");
    expect(result.ok).toBe(true);
  });

  it("rejects a real path that resolves outside the repository root via a directory symlink/junction escape", async () => {
    // A directory-level link (Windows: junction, POSIX: symlink) rather than
    // a file-level symlink -- junctions can be created by an unprivileged
    // user on Windows (unlike file symlinks, which require Developer Mode or
    // elevation), so this reliably exercises the real containment check
    // (fs.realpath followed by path.relative) in this environment, rather
    // than only asserting it by inspection.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "smartflow-outside-"));
    try {
      await fs.writeFile(path.join(outside, "escape.md"), "top secret");
      await fs.mkdir(path.join(repoRoot, "docs"), { recursive: true });
      const linkPath = path.join(repoRoot, "docs", "architecture");
      try {
        await fs.symlink(outside, linkPath, "junction");
      } catch {
        // If even a directory junction cannot be created in some other
        // environment, fail the test loudly rather than silently no-op --
        // every other escape vector is covered elsewhere, but this specific
        // check must be known to be exercised or known to be skipped, never
        // ambiguous.
        throw new Error(
          "This environment could not create a directory junction/symlink; the symlink-escape containment check was not exercised.",
        );
      }
      const result = await readRepositoryDocument(repoRoot, "docs/architecture/escape.md");
      expect(result).toEqual({ ok: false, reason: "PATH_OUTSIDE_REPOSITORY_ROOT" });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("does not silently truncate an oversized file's content", async () => {
    const oversized = "y".repeat(MAX_DOCUMENT_BYTES + 10);
    await write("oversized.md", oversized);
    const result = await readRepositoryDocument(repoRoot, "oversized.md");
    expect(result).toEqual({ ok: false, reason: "FILE_TOO_LARGE" });
    // Confirm the file on disk itself was never touched/rewritten.
    const onDisk = await fs.readFile(path.join(repoRoot, "oversized.md"), "utf8");
    expect(onDisk).toBe(oversized);
  });
});

describe("readLocalGitRevision", () => {
  it("returns undefined when the directory is not a Git checkout", async () => {
    const revision = await readLocalGitRevision(repoRoot);
    expect(revision).toBeUndefined();
  });

  it("resolves a detached HEAD containing a full SHA directly", async () => {
    await write(".git/HEAD", "4b825dc642cb6eb9a060e54bf8d69288fbee4904\n");
    const revision = await readLocalGitRevision(repoRoot);
    expect(revision).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  });

  it("resolves a branch HEAD via a loose ref file", async () => {
    await write(".git/HEAD", "ref: refs/heads/main\n");
    await write(".git/refs/heads/main", "1111111111111111111111111111111111111111\n");
    const revision = await readLocalGitRevision(repoRoot);
    expect(revision).toBe("1111111111111111111111111111111111111111");
  });

  it("resolves a branch HEAD via packed-refs when no loose ref file exists", async () => {
    await write(".git/HEAD", "ref: refs/heads/main\n");
    await write(
      ".git/packed-refs",
      "# pack-refs with: peeled fully-peeled sorted\n2222222222222222222222222222222222222222 refs/heads/main\n",
    );
    const revision = await readLocalGitRevision(repoRoot);
    expect(revision).toBe("2222222222222222222222222222222222222222");
  });

  it("returns undefined for a malformed HEAD rather than throwing", async () => {
    await write(".git/HEAD", "not a valid ref or sha");
    await expect(readLocalGitRevision(repoRoot)).resolves.toBeUndefined();
  });
});
