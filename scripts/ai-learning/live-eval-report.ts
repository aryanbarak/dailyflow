#!/usr/bin/env node
// ALF-1B: read-only CLI consumer for the live routing-evaluation
// comparison layer (agent/worker/ai-learning/live-routing-comparison.ts).
// See docs/decisions/adr/ADR-0022-live-routing-evaluation-and-comparison-semantics.md
// for the full decision record.
//
// NO NETWORK CALL. NO SUPABASE CLIENT. NO CREDENTIALS. This script reads
// a LOCAL JSONL FILE of already-exported ai_learning_events rows -- e.g.
// produced by running a read-only `select=...` query against Supabase
// (via the Supabase dashboard, `psql`, or any other tool) and saving the
// result as JSONL, entirely OUTSIDE this script. This mirrors
// scripts/ai-learning/score-eval.mjs's own "compares two already-produced
// files, makes no external call itself" posture.
//
// TypeScript, run via vite-node (matching scripts/provider-contract-smoke.ts
// and scripts/smartflow-refresh-project.ts's own precedent for a script
// that needs real TypeScript imports) -- unlike score-eval.mjs, this
// script DOES import directly from agent/worker/ai-learning/ (the actual,
// single source of truth for the comparison logic; see
// live-routing-comparison.ts's own header for why duplicating that pure
// logic a second time here would be a drift risk with no real benefit,
// unlike score-eval.mjs's own small, deliberately-duplicated enum lists).
//
// This file is a THIN CLI ENTRY ONLY -- all its actual logic lives in
// live-eval-report-lib.ts (a pure, side-effect-free, independently
// importable/testable module; see that file's own header for why the
// split exists). Matches scripts/provider-contract-smoke.ts's own
// unconditional `main()` call at the bottom -- this file is never
// imported by anything else, only ever executed directly.
//
// Run manually:
//   npx vite-node scripts/ai-learning/live-eval-report.ts <events.jsonl>
//   npx vite-node scripts/ai-learning/live-eval-report.ts <events.jsonl> --json
//
// PRIVACY: never prints a raw user message (the input JSONL rows
// themselves must never contain one either -- ai_learning_events has no
// such column, see ADR-0020). FAIL-CLOSED on malformed input (ALF-1B
// correction 1, item 4): a row that cannot be normalized aborts the WHOLE
// report rather than being silently dropped, since silent drops could
// corrupt evaluation metrics with no visible signal. Every failure this
// script can report -- a bad line, a bad row, a missing file, a bad
// argument, or any other unexpected error -- prints ONLY a fixed, bounded
// reason code (optionally with a bounded line NUMBER), NEVER JSON.parse's
// own message, row content, or any other exception's arbitrary
// `.message`/`String(error)` (see live-eval-report-lib.ts's
// LiveEvalReportError for the full closed set of codes).

import { compareLiveRoutingEvents } from '../../agent/worker/ai-learning/live-routing-comparison'
import { formatLiveEvalReport, loadEventsFile, LiveEvalReportError, parseArgs } from './live-eval-report-lib'

async function main() {
  const { eventsPath, json } = parseArgs(process.argv.slice(2))
  const events = loadEventsFile(eventsPath)
  const report = compareLiveRoutingEvents(events)
  console.log(json ? JSON.stringify(report, null, 2) : formatLiveEvalReport(report))
}

try {
  await main()
} catch (error) {
  // Deliberately never reads error.message / String(error) for anything
  // other than our own fixed-message LiveEvalReportError -- any other
  // exception type (a future bug, a library internal) falls through to a
  // single fixed, content-free code instead of risking an arbitrary
  // message reaching stderr.
  const code = error instanceof LiveEvalReportError ? error.code : 'INTERNAL_ERROR'
  const line = error instanceof LiveEvalReportError ? error.line : undefined
  const lineSuffix = line === undefined ? '' : ' (line ' + line + ')'
  console.error('[LiveEvalReport] failed: ' + code + lineSuffix)
  process.exit(1)
}
