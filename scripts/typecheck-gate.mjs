#!/usr/bin/env node
// Runs `tsc --noEmit` and fails only on regressions against a committed
// per-(file, TS-code) error-count baseline -- not on the pre-existing
// backlog. See PROJECT_STATUS.md Technical Debt for why the baseline exists
// and what's in it.
//
// Baseline entries are keyed by (file, code), not by line, because line
// numbers shift constantly from unrelated edits elsewhere in the same file
// -- a line-keyed baseline would fail the gate on pure noise. A file/code
// pair whose count goes up is a real regression; one that goes down is an
// improvement and always passes (shrink the baseline by hand when you fix
// something, via --update-baseline).
//
// Usage:
//   node scripts/typecheck-gate.mjs                 # check against the baseline, exit 1 on regression
//   node scripts/typecheck-gate.mjs --update-baseline  # regenerate the baseline from the current run

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const baselinePath = path.join(repoRoot, "typecheck-baseline.json");
const tsconfigPath = path.join(repoRoot, "tsconfig.app.json");
const tscBin = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): /;

function runTsc() {
  try {
    return execFileSync(process.execPath, [tscBin, "--noEmit", "-p", tsconfigPath], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 32,
    });
  } catch (error) {
    // tsc exits non-zero when it reports errors; stdout still has the report.
    return error.stdout ?? "";
  }
}

function countsByFileAndCode(tscOutput) {
  const counts = {};
  for (const line of tscOutput.split(/\r?\n/)) {
    const match = ERROR_LINE.exec(line);
    if (!match) continue;
    const [, rawFile, , , code] = match;
    const file = rawFile.replace(/\\/g, "/");
    counts[file] ??= {};
    counts[file][code] = (counts[file][code] ?? 0) + 1;
  }
  return counts;
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    return {};
  }
}

function totalErrors(counts) {
  return Object.values(counts).reduce(
    (sum, byCode) => sum + Object.values(byCode).reduce((s, n) => s + n, 0),
    0,
  );
}

const current = countsByFileAndCode(runTsc());
const updateBaseline = process.argv.includes("--update-baseline");

if (updateBaseline) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n");
  console.log(
    `Wrote ${baselinePath} (${totalErrors(current)} errors across ${Object.keys(current).length} files).`,
  );
  process.exit(0);
}

const baseline = loadBaseline();
const regressions = [];

for (const [file, byCode] of Object.entries(current)) {
  for (const [code, count] of Object.entries(byCode)) {
    const allowed = baseline[file]?.[code] ?? 0;
    if (count > allowed) {
      regressions.push({ file, code, count, allowed });
    }
  }
}

if (regressions.length > 0) {
  console.error("Typecheck gate FAILED -- new or regressed errors beyond the committed baseline:\n");
  for (const { file, code, count, allowed } of regressions) {
    console.error(`  ${file}: ${code} has ${count}, baseline allows ${allowed}`);
  }
  console.error(
    "\nIf these are genuinely new bugs, fix them. If this file was already in the baseline " +
      "and you added an unrelated, deliberately-accepted error, regenerate the baseline with " +
      "`node scripts/typecheck-gate.mjs --update-baseline` and explain why in the PR -- don't " +
      "do this to silence a real regression.",
  );
  process.exit(1);
}

console.log(
  `Typecheck gate passed (${totalErrors(current)} baseline-tracked errors remain, ` +
    `${totalErrors(baseline)} were in the baseline). No new or regressed errors.`,
);
