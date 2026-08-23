#!/usr/bin/env node
// SmartFlow -- MIG-01a: Gemini 3.6 diagnostic probe.
//
// MANUAL DIAGNOSTIC ONLY -- not wired into CI, not a contract check (see
// provider-contract-smoke.ts for that). gemini-2.5-flash is unavailable to
// new API keys and gemini-2.0-flash is fully retired, so migrating to
// gemini-3.6-flash is mandatory; provider-contract-smoke.ts against
// gemini-3.6-flash currently returns 400 INVALID_ARGUMENT on all four
// structured-generation checks, and the plain text-generation check
// completes but with finishReason=length (thinking models consume output
// budget). This script isolates WHICH request shape gemini-3.6-flash
// rejects, and whether disabling thinking or raising maxOutputTokens fixes
// the length problem, by sending a sequence of minimal requests and
// printing exactly what each one did -- so the real migration (MIG-01) has
// a diagnosed cause instead of a guess.
//
// Delete this script after MIG-01 lands -- it exists to answer one
// migration question, not to be a permanent fixture like
// provider-contract-smoke.ts.
//
// SECRETS: reads GEMINI_API_KEY (and optionally GEMINI_MODEL) from
// process.env ONLY -- same pattern as provider-contract-smoke.ts. Never
// hardcode a key, never accept one as a CLI argument (shell history /
// process list would leak it), never print a URL (it carries the `key`
// query param). Any error body is truncated to 500 chars before printing.
//
// Run manually:
//   GEMINI_API_KEY=... GEMINI_MODEL=gemini-3.6-flash npx vite-node scripts/gemini-36-probe.ts
if (!process.env.GEMINI_API_KEY) {
  console.error(
    [
      'GEMINI_API_KEY is not set in this process.',
      'Set it for THIS PROCESS ONLY, e.g. PowerShell:',
      '  $env:GEMINI_API_KEY = "<paste key here>"',
      'then run the probe again in the same session.',
      'NEVER source/cat/echo agent/worker/.dev.vars or any secrets file --',
      'multi-line secrets in it will leak into the transcript.',
    ].join('\n'),
  )
  process.exit(1)
}

// Real schema builders, not hand-typed copies -- a schema that changed
// shape since this probe was written would otherwise go unnoticed.
import { buildTaskTitleResponseSchema } from '../agent/worker/task-title-extraction'
import { buildReasoningResponseSchema } from '../agent/worker/reasoning-endpoint'
// MIG-01b: single-source model resolution (see that module's header
// comment) -- this script no longer hardcodes its own default.
import { resolveGeminiModel } from '../agent/worker/geminiModel'
// ADR-0018 S2 Phase B: both builders above now return the neutral schema
// subset, not Gemini's dialect -- this probe sends raw wire-level
// requests by design (it exists to find real Gemini dialect quirks), so
// it translates back explicitly rather than going through any adapter.
import { translateNeutralSchema } from '../agent/worker/providers/gemini/geminiSchemaTranslation'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''
const GEMINI_MODEL = resolveGeminiModel({ GEMINI_MODEL: process.env.GEMINI_MODEL })
const MAX_DETAIL_CHARS = 500

const SAY_OK = 'Say OK'

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...(truncated)` : text
}

interface ProbeResult {
  readonly name: string
  readonly httpStatus: number
  readonly detail: string
}

async function runProbe(name: string, body: Record<string, unknown>): Promise<ProbeResult> {
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`)
  url.searchParams.set('key', GEMINI_API_KEY)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { name, httpStatus: 0, detail: `network error: ${(err as Error).message}` }
  }

  const bodyText = await response.text()

  if (!response.ok) {
    let errStatus = 'UNKNOWN'
    let errMessage = truncate(bodyText, MAX_DETAIL_CHARS)
    try {
      const parsed = JSON.parse(bodyText) as { error?: { status?: string; message?: string } }
      if (parsed.error?.status) errStatus = parsed.error.status
      if (parsed.error?.message) errMessage = truncate(parsed.error.message, MAX_DETAIL_CHARS)
    } catch {
      // Not JSON -- errMessage stays the truncated raw body.
    }
    return { name, httpStatus: response.status, detail: `error.status=${errStatus} error.message=${errMessage}` }
  }

  let parsed: { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }> }
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return { name, httpStatus: response.status, detail: `200 but body was not JSON: ${truncate(bodyText, MAX_DETAIL_CHARS)}` }
  }
  const candidate = parsed.candidates?.[0]
  const finishReason = candidate?.finishReason ?? 'UNKNOWN'
  const text = candidate?.content?.parts?.[0]?.text ?? ''
  return { name, httpStatus: response.status, detail: `finishReason=${finishReason} text=${JSON.stringify(text.slice(0, 80))}` }
}

async function main() {
  console.log(`Gemini 3.6 diagnostic probe -- model=${GEMINI_MODEL}`)
  console.log('(manual diagnostic only -- never wired into CI, delete after MIG-01)\n')

  const results: ProbeResult[] = []

  // P1: bare generateContent, no generationConfig at all.
  results.push(
    await runProbe('P1 bare generateContent', {
      contents: [{ role: 'user', parts: [{ text: SAY_OK }] }],
    }),
  )

  // P2: P1 + generationConfig.maxOutputTokens.
  results.push(
    await runProbe('P2 P1 + maxOutputTokens:1024', {
      contents: [{ role: 'user', parts: [{ text: SAY_OK }] }],
      generationConfig: { maxOutputTokens: 1024 },
    }),
  )

  // P3: P2 + thinkingConfig.thinkingBudget:0 -- the 2.5-era "disable
  // thinking" quirk, suspect #1 for gemini-3.6-flash's structured-gen 400s.
  results.push(
    await runProbe('P3 P2 + thinkingConfig{thinkingBudget:0}', {
      contents: [{ role: 'user', parts: [{ text: SAY_OK }] }],
      generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
    }),
  )

  // P4: P2 + responseMimeType application/json, NO schema -- isolates
  // whether JSON-mode itself is rejected, before adding a schema.
  results.push(
    await runProbe('P4 P2 + responseMimeType:application/json (no schema)', {
      contents: [{ role: 'user', parts: [{ text: SAY_OK }] }],
      generationConfig: { maxOutputTokens: 1024, responseMimeType: 'application/json' },
    }),
  )

  // P5: P4 + the simplest real schema in the codebase.
  results.push(
    await runProbe('P5 P4 + buildTaskTitleResponseSchema (simplest real schema)', {
      contents: [{ role: 'user', parts: [{ text: SAY_OK }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema: translateNeutralSchema(buildTaskTitleResponseSchema()),
      },
    }),
  )

  // P6: P4 + the biggest real schema in the codebase.
  results.push(
    await runProbe('P6 P4 + buildReasoningResponseSchema (biggest real schema)', {
      contents: [{ role: 'user', parts: [{ text: SAY_OK }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema: translateNeutralSchema(buildReasoningResponseSchema()),
      },
    }),
  )

  // P7: P3 + P5 combined -- thinkingConfig AND a schema together, since
  // either one alone (P3, P5) might pass while the combination is what
  // production actually sends (see reasoning-endpoint.ts/callGeminiReasoning).
  results.push(
    await runProbe('P7 P3 + P5 combined (thinkingConfig + schema)', {
      contents: [{ role: 'user', parts: [{ text: SAY_OK }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
        responseSchema: translateNeutralSchema(buildTaskTitleResponseSchema()),
      },
    }),
  )

  // P8: P2 with a much larger maxOutputTokens -- length probe, tests
  // whether P2's finishReason=length is just thinking tokens eating a
  // 1024 budget (fixed by more budget) rather than a real regression.
  results.push(
    await runProbe('P8 P2 with maxOutputTokens:8192 (length probe)', {
      contents: [{ role: 'user', parts: [{ text: SAY_OK }] }],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  )

  for (const result of results) {
    console.log(`${result.name}`)
    console.log(`  httpStatus=${result.httpStatus} ${result.detail}`)
  }
}

main()
