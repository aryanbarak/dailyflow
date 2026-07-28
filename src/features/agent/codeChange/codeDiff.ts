// EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
// Deterministic unified diff generation. SmartFlow is the sole diff
// authority -- this never accepts a client- or LLM-supplied diff/patch.
// Pure function, no I/O.

import type { UnifiedDiffHunk, UnifiedDiffLine, UnifiedDiffResult } from "./codeProposalTypes";

const DEFAULT_CONTEXT_LINES = 3;

type EditOp = "equal" | "delete" | "insert";

interface Edit {
  op: EditOp;
  originalLine?: string;
  proposedLine?: string;
}

// Splits on \n, normalizing away a single trailing newline so the last real
// line does not appear as a trailing empty line. Known limitation: this
// means a change that is *only* the presence/absence of a trailing newline
// produces zero hunks -- generateUnifiedDiff()'s isNoop flag (an exact
// string comparison on the raw content, not on this line array) is what
// still correctly reports such a proposal as non-identical.
function splitLines(content: string): string[] {
  if (content === "") return [];
  const withoutTrailingNewline = content.endsWith("\n") ? content.slice(0, -1) : content;
  return withoutTrailingNewline.split("\n");
}

// Longest Common Subsequence via dynamic programming, then a standard
// backtrack to produce a minimal equal/delete/insert edit script. Bounded by
// the existing 128 KiB per-file size cap (codeProposalValidator.ts), so the
// O(n*m) table stays small enough to be practical for this slice's scope --
// this is not intended to scale to arbitrarily large files.
function computeEditScript(originalLines: string[], proposedLines: string[]): Edit[] {
  const originalLength = originalLines.length;
  const proposedLength = proposedLines.length;
  const lcsTable: number[][] = Array.from({ length: originalLength + 1 }, () =>
    new Array<number>(proposedLength + 1).fill(0),
  );

  for (let i = originalLength - 1; i >= 0; i -= 1) {
    for (let j = proposedLength - 1; j >= 0; j -= 1) {
      lcsTable[i][j] = originalLines[i] === proposedLines[j]
        ? lcsTable[i + 1][j + 1] + 1
        : Math.max(lcsTable[i + 1][j], lcsTable[i][j + 1]);
    }
  }

  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < originalLength && j < proposedLength) {
    if (originalLines[i] === proposedLines[j]) {
      edits.push({ op: "equal", originalLine: originalLines[i], proposedLine: proposedLines[j] });
      i += 1;
      j += 1;
    } else if (lcsTable[i + 1][j] >= lcsTable[i][j + 1]) {
      edits.push({ op: "delete", originalLine: originalLines[i] });
      i += 1;
    } else {
      edits.push({ op: "insert", proposedLine: proposedLines[j] });
      j += 1;
    }
  }
  while (i < originalLength) {
    edits.push({ op: "delete", originalLine: originalLines[i] });
    i += 1;
  }
  while (j < proposedLength) {
    edits.push({ op: "insert", proposedLine: proposedLines[j] });
    j += 1;
  }
  return edits;
}

interface HunkBuild {
  originalStart: number;
  proposedStart: number;
  lines: UnifiedDiffLine[];
}

interface EditRange {
  start: number;
  end: number;
}

// Merges each changed edit's +/-contextLines window with its neighbors so
// adjacent changes share one hunk instead of producing redundant, overlapping
// hunks.
function mergeContextRanges(edits: Edit[], contextLines: number): EditRange[] {
  const changedIndexes = edits
    .map((edit, index) => (edit.op === "equal" ? -1 : index))
    .filter((index) => index !== -1);

  const ranges: EditRange[] = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(edits.length - 1, index + contextLines);
    const last = ranges.at(-1);
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }
  return ranges;
}

interface LineCursor {
  originalLine: number;
  proposedLine: number;
  editIndex: number;
}

function advanceCursorPastContext(edits: Edit[], cursor: LineCursor, targetIndex: number): void {
  while (cursor.editIndex < targetIndex) {
    const edit = edits[cursor.editIndex];
    if (edit.op !== "insert") cursor.originalLine += 1;
    if (edit.op !== "delete") cursor.proposedLine += 1;
    cursor.editIndex += 1;
  }
}

function buildHunkLine(edit: Edit, cursor: LineCursor): UnifiedDiffLine {
  if (edit.op === "equal") {
    cursor.originalLine += 1;
    cursor.proposedLine += 1;
    return { type: "context", content: edit.originalLine ?? "" };
  }
  if (edit.op === "delete") {
    cursor.originalLine += 1;
    return { type: "removed", content: edit.originalLine ?? "" };
  }
  cursor.proposedLine += 1;
  return { type: "added", content: edit.proposedLine ?? "" };
}

function buildHunkForRange(edits: Edit[], cursor: LineCursor, range: EditRange): HunkBuild {
  advanceCursorPastContext(edits, cursor, range.start);
  const hunk: HunkBuild = { originalStart: cursor.originalLine, proposedStart: cursor.proposedLine, lines: [] };
  while (cursor.editIndex <= range.end) {
    hunk.lines.push(buildHunkLine(edits[cursor.editIndex], cursor));
    cursor.editIndex += 1;
  }
  return hunk;
}

function groupIntoHunks(edits: Edit[], contextLines: number): HunkBuild[] {
  const ranges = mergeContextRanges(edits, contextLines);
  const cursor: LineCursor = { originalLine: 1, proposedLine: 1, editIndex: 0 };
  return ranges.map((range) => buildHunkForRange(edits, cursor, range));
}

function renderHunkHeader(hunk: UnifiedDiffHunk): string {
  return `@@ -${hunk.originalStart},${hunk.originalLines} +${hunk.proposedStart},${hunk.proposedLines} @@`;
}

const HUNK_LINE_PREFIX: Record<UnifiedDiffLine["type"], string> = {
  added: "+",
  removed: "-",
  context: " ",
};

function renderHunkLine(line: UnifiedDiffLine): string {
  return `${HUNK_LINE_PREFIX[line.type]}${line.content}`;
}

function renderDiffText(path: string, hunks: UnifiedDiffHunk[]): string {
  if (hunks.length === 0) return "";
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    lines.push(renderHunkHeader(hunk));
    for (const line of hunk.lines) lines.push(renderHunkLine(line));
  }
  return lines.join("\n");
}

export function generateUnifiedDiff(
  baseContent: string,
  proposedContent: string,
  path: string,
  contextLines: number = DEFAULT_CONTEXT_LINES,
): UnifiedDiffResult {
  const originalLines = splitLines(baseContent);
  const proposedLines = splitLines(proposedContent);
  const edits = computeEditScript(originalLines, proposedLines);
  const hunkBuilds = groupIntoHunks(edits, Math.max(0, contextLines));

  const hunks: UnifiedDiffHunk[] = hunkBuilds.map((build) => {
    // Per hunk, not per file: lines present on the original side (context +
    // removed) vs. the proposed side (context + added).
    const originalSideLineCount = build.lines.filter((line) => line.type !== "added").length;
    const proposedSideLineCount = build.lines.filter((line) => line.type !== "removed").length;
    return {
      // Unified-diff convention: a hunk with zero lines on one side reports
      // that side's start as one less than the next real line number.
      originalStart: originalSideLineCount === 0 ? build.originalStart - 1 : build.originalStart,
      originalLines: originalSideLineCount,
      proposedStart: proposedSideLineCount === 0 ? build.proposedStart - 1 : build.proposedStart,
      proposedLines: proposedSideLineCount,
      lines: build.lines,
    };
  });

  const addedLineCount = edits.filter((edit) => edit.op === "insert").length;
  const removedLineCount = edits.filter((edit) => edit.op === "delete").length;

  return {
    path,
    hunks,
    addedLineCount,
    removedLineCount,
    isNoop: baseContent === proposedContent,
    text: renderDiffText(path, hunks),
  };
}
