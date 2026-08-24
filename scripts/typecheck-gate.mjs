#!/usr/bin/env node
// Runs `tsc --noEmit` over two independent targets -- src/ (root) and
// agent/worker/ (TC-01) -- and fails only on regressions against each
// target's own committed per-(file, TS-code) error-count baseline, not on
// either target's pre-existing backlog. See PROJECT_STATUS.md Technical
// Debt for why the root baseline exists and what's in it; see
// docs/debt/worker-typecheck-baseline.txt for the agent/worker one (TC-01).
//
// Two SEPARATE targets, not one merged program, because agent/worker is
// its own deployable unit with its own package.json/node_modules/tsconfig
// (@cloudflare/workers-types, a devDependency ONLY agent/worker has) --
// see agent/worker/tsconfig.json's own header comment. Running it through
// root's tsc/tsconfig.app.json would not resolve those types at all.
//
// Baseline entries are keyed by (file, code), not by line, because line
// numbers shift constantly from unrelated edits elsewhere in the same file
// -- a line-keyed baseline would fail the gate on pure noise. A file/code
// pair whose count goes up is a real regression; one that goes down is an
// improvement and always passes (shrink the baseline by hand when you fix
// something, via --update-baseline).
//
// Usage:
//   node scripts/typecheck-gate.mjs                 # check both targets against their baselines, exit 1 on any regression
//   node scripts/typecheck-gate.mjs --update-baseline  # regenerate BOTH baselines (+ the agent/worker human-readable listing) from the current run

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const workerRoot = path.join(repoRoot, "agent", "worker");

const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): /;

// TC-01: docs/debt/worker-typecheck-baseline.txt is the human-readable
// listing of every currently-tolerated agent/worker error -- the JSON
// baseline below is what the gate itself reads; this file is what a
// reviewer reads. Regenerated together so they can never drift apart.
const workerDebtListPath = path.join(repoRoot, "docs", "debt", "worker-typecheck-baseline.txt");

const targets = [
  {
    label: "src/ (root)",
    tsconfigPath: path.join(repoRoot, "tsconfig.app.json"),
    tscBin: path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
    cwd: repoRoot,
    baselinePath: path.join(repoRoot, "typecheck-baseline.json"),
  },
  {
    // TC-01: agent/worker has its own tsconfig.json (new, this task -- it
    // never had one before) and its own separate node_modules/typescript,
    // so it needs its own tsc binary, not root's.
    label: "agent/worker/",
    tsconfigPath: path.join(workerRoot, "tsconfig.json"),
    tscBin: path.join(workerRoot, "node_modules", "typescript", "bin", "tsc"),
    cwd: workerRoot,
    baselinePath: path.join(workerRoot, "typecheck-baseline.json"),
  },
];

function runTsc(target) {
  // TC-01: agent/worker's tsc binary lives in ITS OWN node_modules (a
  // separate `npm ci`, not root's -- see ci.yml's "Install agent/worker
  // dependencies" step). A missing binary here means that install step
  // didn't run, not a real typecheck failure -- fail loudly and clearly
  // instead of letting execFileSync throw an opaque ENOENT.
  if (!existsSync(target.tscBin)) {
    console.error(
      `${target.label}: tsc binary not found at ${target.tscBin}.\n` +
        `Run 'npm ci' inside ${target.cwd} first (CI does this in a separate step -- see ci.yml).`,
    );
    process.exit(1);
  }
  try {
    return execFileSync(process.execPath, [target.tscBin, "--noEmit", "-p", target.tsconfigPath], {
      cwd: target.cwd,
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

function loadBaseline(baselinePath) {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    return {};
  }
}

function countErrorLines(tscOutput) {
  return tscOutput.split(/\r?\n/).filter((line) => ERROR_LINE.test(line)).length;
}

function totalErrors(counts) {
  return Object.values(counts).reduce(
    (sum, byCode) => sum + Object.values(byCode).reduce((s, n) => s + n, 0),
    0,
  );
}

function regressionsFor(current, baseline) {
  const regressions = [];
  for (const [file, byCode] of Object.entries(current)) {
    for (const [code, count] of Object.entries(byCode)) {
      const allowed = baseline[file]?.[code] ?? 0;
      if (count > allowed) {
        regressions.push({ file, code, count, allowed });
      }
    }
  }
  return regressions;
}

const updateBaseline = process.argv.includes("--update-baseline");

const results = targets.map((target) => ({
  target,
  output: runTsc(target),
}));

if (updateBaseline) {
  for (const { target, output } of results) {
    const current = countsByFileAndCode(output);
    writeFileSync(target.baselinePath, JSON.stringify(current, null, 2) + "\n");
    console.log(
      `Wrote ${target.baselinePath} (${totalErrors(current)} errors across ${Object.keys(current).length} files) -- ${target.label}`,
    );
  }
  const workerOutput = results.find((r) => r.target.label === "agent/worker/").output;
  writeWorkerDebtList(workerOutput);
  process.exit(0);
}

let anyRegressions = false;
const summaries = [];

for (const { target, output } of results) {
  const current = countsByFileAndCode(output);
  const baseline = loadBaseline(target.baselinePath);
  const regressions = regressionsFor(current, baseline);

  if (regressions.length > 0) {
    anyRegressions = true;
    console.error(`Typecheck gate FAILED for ${target.label} -- new or regressed errors beyond the committed baseline:\n`);
    for (const { file, code, count, allowed } of regressions) {
      console.error(`  ${file}: ${code} has ${count}, baseline allows ${allowed}`);
    }
    console.error("");
  } else {
    summaries.push(
      `${target.label}: passed (${totalErrors(current)} baseline-tracked errors remain, ${totalErrors(baseline)} were in the baseline)`,
    );
  }
}

if (anyRegressions) {
  console.error(
    "If these are genuinely new bugs, fix them. If a target's baseline already tolerated this file " +
      "and you added an unrelated, deliberately-accepted error, regenerate BOTH baselines with " +
      "`node scripts/typecheck-gate.mjs --update-baseline` and explain why in the PR -- don't " +
      "do this to silence a real regression.",
  );
  process.exit(1);
}

console.log("Typecheck gate passed. No new or regressed errors.");
for (const summary of summaries) console.log(`  ${summary}`);

function writeWorkerDebtList(tscOutput) {
  const errorCount = countErrorLines(tscOutput);
  const header = [
    "# agent/worker/ typecheck baseline -- TC-01",
    "#",
    `# Every error (${errorCount} total) \`tsc --noEmit -p agent/worker/tsconfig.json\``,
    "# reports as of the commit that generated this file. agent/worker had NO",
    "# tsconfig.json and NO typecheck gate at all before TC-01 -- these are",
    "# pre-existing errors this task's own gate now tolerates",
    "# (agent/worker/typecheck-baseline.json is what the gate script itself",
    "# actually reads; this file is the human-readable listing of the same",
    "# data, for review). NOT fixed by TC-01 on purpose (task instruction: 'Do",
    "# not fix [them] now'). TC-01's own task text estimated '~39 hidden strict",
    "# errors' -- the real count under a genuinely strict tsconfig.json (see",
    "# that file's own settings) turned out higher; not adjusted down to match",
    "# the estimate, since the point of this gate is the real number.",
    "#",
    "# A file outside agent/worker/ (e.g. ../../shared/...) can appear here: tsc",
    "# type-checks every file reachable via import from agent/worker's own",
    "# program, not only files physically inside this directory.",
    "#",
    "# Regenerate together with agent/worker/typecheck-baseline.json via:",
    "#   node scripts/typecheck-gate.mjs --update-baseline",
    "#",
    "# A shrinking count here is always a welcome side effect of unrelated work;",
    "# a GROWING count for an existing (file, code) pair, or any error in a file/",
    "# code pair not already listed, fails the gate (see typecheck-gate.mjs).",
    "",
  ].join("\n");
  mkdirSync(path.dirname(workerDebtListPath), { recursive: true });
  writeFileSync(workerDebtListPath, header + tscOutput.trimEnd() + "\n");
  console.log(`Wrote ${workerDebtListPath}`);
}
