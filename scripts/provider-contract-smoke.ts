#!/usr/bin/env node
// SmartFlow -- Provider-contract smoke script (task 16-fix, PO-mandated;
// fifth contract added task 28b to cover the reasoning-endpoint schema;
// sixth contract added ADR-0018 S1 to cover the new TextGenerationProvider
// adapter -- see checkTextGenerationAdapterContract below).
//
// MANUAL USE ONLY -- never wire this into CI. It makes six minimal REAL
// calls against the live Gemini API to catch the exact class of break that
// motivated this script: a provider silently retiring a model
// (text-embedding-004, shut down Jan 2026) turns a previously-working
// contract into a hard failure with zero warning ahead of time. See
// docs/reference/provider-contract-smoke.md for when to run this.
//
// It imports the REAL schema/prompt builders straight from the Worker
// route files -- not copies -- so a schema/model change that breaks the
// provider contract shows up here before deploy, not after.
//
// SECRETS: reads GEMINI_API_KEY (and optionally GEMINI_MODEL) from
// process.env ONLY. Never hardcode a key here, never accept one as a CLI
// argument (shell history / process list would leak it), never print a
// URL that carries the `key` query param -- every log line below uses
// only a URL's pathname, mirroring the redaction-guard discipline already
// enforced in agent/worker/*-endpoint.ts.
//
// MIG-01b: optionally reads SMOKE_DELAY_MS (default 0) -- milliseconds to
// wait between each of the 6 checks, for a free-tier key (5 req/min).
//
// Run manually:
//   GEMINI_API_KEY=... npx vite-node scripts/provider-contract-smoke.ts
// On a free-tier key, space the 6 checks out:
//   SMOKE_DELAY_MS=15000 GEMINI_API_KEY=... npx vite-node scripts/provider-contract-smoke.ts

// Task 28b-guard: this check is written first, before the imports below, so
// a reader sees it before anything else -- even though ESM hoists import
// resolution ahead of it at runtime regardless of text position. That's
// safe here because none of agent/worker/*-endpoint.ts read process.env at
// module scope (env is always passed in as a function parameter, per the
// Cloudflare Worker pattern) -- so this guard is still the first thing
// that can observe or act on GEMINI_API_KEY, and the first thing that can
// fail because of it.
//
// A previous run of this script sourced agent/worker/.dev.vars with `source`
// to get GEMINI_API_KEY into the shell, which also fed the multi-line
// GITHUB_APP_PRIVATE_KEY PEM in that same file into bash as literal
// commands -- echoing most of the private key into the transcript as
// "command not found" errors (that key was rotated afterward). The fix is
// not "remember not to do that" -- it's this guard: it never reads a
// secrets file itself, and it tells the caller exactly how to set the one
// variable this script needs, in-process, without sourcing anything.
if (!process.env.GEMINI_API_KEY) {
  console.error(
    [
      'GEMINI_API_KEY is not set in this process.',
      'Set it for THIS PROCESS ONLY, e.g. PowerShell:',
      '  $env:GEMINI_API_KEY = "<paste key here>"',
      'then run the smoke again in the same session.',
      'NEVER source/cat/echo agent/worker/.dev.vars or any secrets file --',
      'multi-line secrets in it will leak into the transcript.',
    ].join('\n'),
  )
  process.exit(1)
}

import { buildExtractionSystemInstruction, buildExtractionPrompt, buildExtractionResponseSchema } from '../agent/worker/personal-memory-extraction-endpoint'
import { buildDerivationSystemInstruction, buildDerivationPrompt, buildDerivationResponseSchema } from '../agent/worker/context-derivation-endpoint'
import { buildTaskTitleSystemInstruction, buildTaskTitlePrompt, buildTaskTitleResponseSchema } from '../agent/worker/task-title-extraction'
import { buildReasoningSystemInstruction, buildReasoningResponseSchema, SUPPORTED_INTENT_VALUES } from '../agent/worker/reasoning-endpoint'
import { GeminiTextGenerationProvider } from '../agent/worker/providers/gemini/GeminiTextGenerationProvider'
// MIG-01b: single-source model resolution (see that module's header
// comment) -- this script no longer hardcodes its own default.
import { resolveGeminiModel } from '../agent/worker/geminiModel'
// ADR-0018 S2 Phase B (interim): the four builders below now return the
// neutral schema subset, not Gemini's dialect -- translateNeutralSchema()
// converts back for this raw callGenerateContent helper. Phase C replaces
// checks 1-4 with calls through the real provider+translation path (that
// is the point of this script), removing this wrapper.
import { translateNeutralSchema } from '../agent/worker/providers/gemini/geminiSchemaTranslation'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''
const GEMINI_MODEL = resolveGeminiModel({ GEMINI_MODEL: process.env.GEMINI_MODEL })
const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_DIMENSIONS = 768
// MIG-01b: the free tier is 5 req/min and this script makes 6 real calls
// back-to-back -- SMOKE_DELAY_MS (default 0, i.e. no change to prior
// behavior) lets a free-tier key space its checks out so the run's own
// pacing isn't what triggers the very quota error it's trying to detect.
const SMOKE_DELAY_MS = Number(process.env.SMOKE_DELAY_MS) || 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface ContractResult {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

async function callGenerateContent(model: string, systemInstruction: string, prompt: string, responseSchema: unknown): Promise<{ status: number; bodyText: string }> {
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`)
  url.searchParams.set('key', GEMINI_API_KEY)
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        // MIG-01b: 256 -> 2048, thinkingConfig removed -- gemini-3.6-flash
        // returns 400 INVALID_ARGUMENT on thinkingConfig:{thinkingBudget:0}
        // (see agent/worker/geminiModel.ts and scripts/gemini-36-probe.ts's
        // P3 finding); thinking now consumes output budget on every call.
        maxOutputTokens: 2048,
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema,
      },
    }),
  })
  return { status: response.status, bodyText: await response.text() }
}

async function checkExtractionContract(): Promise<ContractResult> {
  const name = 'generateContent + buildExtractionResponseSchema (personal-memory-extraction-endpoint.ts)'
  try {
    const prompt = buildExtractionPrompt([{ id: 'smoke-1', provenanceSourceKind: 'chat_turn', text: 'I prefer working in the morning.' }])
    const { status, bodyText } = await callGenerateContent(GEMINI_MODEL, buildExtractionSystemInstruction(), prompt, translateNeutralSchema(buildExtractionResponseSchema()))
    if (status !== 200) return { name, pass: false, detail: `httpStatus=${status} body=${bodyText.slice(0, 300)}` }
    const parsed = JSON.parse(bodyText) as { candidates?: Array<{ finishReason?: string }> }
    const finishReason = parsed.candidates?.[0]?.finishReason
    if (finishReason !== 'STOP') return { name, pass: false, detail: `unexpected finishReason=${finishReason}` }
    return { name, pass: true, detail: 'httpStatus=200 finishReason=STOP' }
  } catch (error) {
    return { name, pass: false, detail: (error as Error).message }
  }
}

async function checkDerivationContract(): Promise<ContractResult> {
  const name = 'generateContent + buildDerivationResponseSchema (context-derivation-endpoint.ts)'
  try {
    const prompt = buildDerivationPrompt('Smoke Test Project', [{ id: 'smoke-1', sourceKind: 'note', title: 'Kickoff', reference: 'smoke', text: 'Project kickoff scheduled next week.' }])
    const { status, bodyText } = await callGenerateContent(GEMINI_MODEL, buildDerivationSystemInstruction(), prompt, translateNeutralSchema(buildDerivationResponseSchema()))
    if (status !== 200) return { name, pass: false, detail: `httpStatus=${status} body=${bodyText.slice(0, 300)}` }
    const parsed = JSON.parse(bodyText) as { candidates?: Array<{ finishReason?: string }> }
    const finishReason = parsed.candidates?.[0]?.finishReason
    if (finishReason !== 'STOP') return { name, pass: false, detail: `unexpected finishReason=${finishReason}` }
    return { name, pass: true, detail: 'httpStatus=200 finishReason=STOP' }
  } catch (error) {
    return { name, pass: false, detail: (error as Error).message }
  }
}

async function checkTaskTitleContract(): Promise<ContractResult> {
  const name = 'generateContent + buildTaskTitleResponseSchema (task-title-extraction.ts)'
  try {
    const prompt = buildTaskTitlePrompt('Create a task for tomorrow because I have a family doctor appointment at 11am.')
    const { status, bodyText } = await callGenerateContent(GEMINI_MODEL, buildTaskTitleSystemInstruction(), prompt, translateNeutralSchema(buildTaskTitleResponseSchema()))
    if (status !== 200) return { name, pass: false, detail: `httpStatus=${status} body=${bodyText.slice(0, 300)}` }
    const parsed = JSON.parse(bodyText) as { candidates?: Array<{ finishReason?: string }> }
    const finishReason = parsed.candidates?.[0]?.finishReason
    if (finishReason !== 'STOP') return { name, pass: false, detail: `unexpected finishReason=${finishReason}` }
    return { name, pass: true, detail: 'httpStatus=200 finishReason=STOP' }
  } catch (error) {
    return { name, pass: false, detail: (error as Error).message }
  }
}

async function checkReasoningContract(): Promise<ContractResult> {
  const name = 'generateContent + buildReasoningResponseSchema (reasoning-endpoint.ts)'
  try {
    const prompt = 'Latest user message: "I spent 45 EUR on groceries today." Propose one intent for this SmartFlow request.'
    const { status, bodyText } = await callGenerateContent(GEMINI_MODEL, buildReasoningSystemInstruction('en'), prompt, translateNeutralSchema(buildReasoningResponseSchema()))
    if (status !== 200) return { name, pass: false, detail: `httpStatus=${status} body=${bodyText.slice(0, 300)}` }
    const parsed = JSON.parse(bodyText) as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }> }
    const candidate = parsed.candidates?.[0]
    if (candidate?.finishReason !== 'STOP') return { name, pass: false, detail: `unexpected finishReason=${candidate?.finishReason}` }
    const text = candidate.content?.parts?.[0]?.text
    if (typeof text !== 'string' || !text.trim()) return { name, pass: false, detail: 'model returned no proposal content' }
    const proposal = JSON.parse(text) as { type?: unknown }
    if (typeof proposal.type !== 'string' || !(SUPPORTED_INTENT_VALUES as readonly string[]).includes(proposal.type)) {
      return { name, pass: false, detail: `intent ${JSON.stringify(proposal.type)} is not in SUPPORTED_INTENT_VALUES` }
    }
    return { name, pass: true, detail: `httpStatus=200 finishReason=STOP intent=${proposal.type}` }
  } catch (error) {
    return { name, pass: false, detail: (error as Error).message }
  }
}

async function checkEmbeddingContract(): Promise<ContractResult> {
  const name = `embedContent on ${EMBEDDING_MODEL} with outputDimensionality=${EMBEDDING_DIMENSIONS}`
  try {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`)
    url.searchParams.set('key', GEMINI_API_KEY)
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text: 'Smoke test content for embedding contract verification.' }] }, outputDimensionality: EMBEDDING_DIMENSIONS }),
    })
    const bodyText = await response.text()
    if (response.status !== 200) return { name, pass: false, detail: `httpStatus=${response.status} body=${bodyText.slice(0, 300)}` }
    const parsed = JSON.parse(bodyText) as { embedding?: { values?: unknown } }
    const values = parsed.embedding?.values
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
      return { name, pass: false, detail: `expected ${EMBEDDING_DIMENSIONS} values, got ${Array.isArray(values) ? values.length : typeof values}` }
    }
    return { name, pass: true, detail: `httpStatus=200 valueCount=${values.length}` }
  } catch (error) {
    return { name, pass: false, detail: (error as Error).message }
  }
}

// ADR-0018 S1: proves GeminiTextGenerationProvider's real request envelope
// still round-trips against the live API -- the same class of break this
// whole script exists to catch (PA-01's own migrated call sites all go
// through this adapter now, so a schema/model break here is a break for
// all 4 of them, not just one hand-written fetch). SUPABASE_URL/
// SUPABASE_SERVICE_KEY are placeholders: this check only calls
// generateText() on the SUCCESS path, which never touches
// providers/failureEvents.ts's persistence at all (that only fires on a
// caught ProviderUnavailableError) -- see that module's own fail-safe
// design if this check is ever extended to exercise a failure path.
async function checkTextGenerationAdapterContract(): Promise<ContractResult> {
  const name = 'GeminiTextGenerationProvider.generateText (providers/gemini/GeminiTextGenerationProvider.ts)'
  try {
    const provider = new GeminiTextGenerationProvider({
      GEMINI_API_KEY,
      GEMINI_MODEL,
      SUPABASE_URL: 'https://smoke-test.invalid',
      SUPABASE_SERVICE_KEY: 'unused-in-the-success-path',
    })
    const result = await provider.generateText({
      turns: [{ role: 'user', content: 'Reply with exactly one short sentence confirming you received this message.' }],
      // MIG-01b: 128 -> 2048, matching production's own callGemini budget
      // (index.ts) -- this check exercises the exact same adapter path.
      maxOutputTokens: 2048,
      temperature: 0,
    })
    if (result.finishReason !== 'stop') return { name, pass: false, detail: `unexpected finishReason=${result.finishReason}` }
    if (!result.text.trim()) return { name, pass: false, detail: 'adapter returned empty text' }
    return { name, pass: true, detail: `finishReason=stop textLength=${result.text.length}` }
  } catch (error) {
    return { name, pass: false, detail: (error as Error).message }
  }
}

const CHECKS: Array<() => Promise<ContractResult>> = [
  checkExtractionContract,
  checkDerivationContract,
  checkTaskTitleContract,
  checkReasoningContract,
  checkEmbeddingContract,
  checkTextGenerationAdapterContract,
]

async function main() {
  console.log(`Provider-contract smoke test -- model=${GEMINI_MODEL} embeddingModel=${EMBEDDING_MODEL}`)
  console.log(`(manual run only -- never wired into CI; SMOKE_DELAY_MS=${SMOKE_DELAY_MS})\n`)

  const results: ContractResult[] = []
  for (let i = 0; i < CHECKS.length; i += 1) {
    if (i > 0 && SMOKE_DELAY_MS > 0) await sleep(SMOKE_DELAY_MS)
    results.push(await CHECKS[i]())
  }

  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} -- ${result.name}`)
    console.log(`     ${result.detail}`)
  }

  // MIG-01b: the free tier is 5 req/min -- a run with no delay (or too
  // short a delay) against a free-tier key can hit its own quota mid-run.
  // Surface that distinctly from a real contract break so the reader
  // reruns with SMOKE_DELAY_MS instead of chasing a false regression.
  const quotaFailures = results.filter((r) => !r.pass && /free_tier/i.test(r.detail))
  if (quotaFailures.length > 0) {
    console.log(
      `\nHINT: ${quotaFailures.length} check(s) failed with a free_tier quota error. This is likely` +
        ' rate-limiting from this run itself (free tier = 5 req/min, 6 checks), not a real contract' +
        ' break. Rerun with a larger SMOKE_DELAY_MS, e.g.:\n' +
        '  SMOKE_DELAY_MS=15000 GEMINI_API_KEY=... npx vite-node scripts/provider-contract-smoke.ts',
    )
  }

  const allPassed = results.every((r) => r.pass)
  console.log(`\n${allPassed ? 'ALL CONTRACTS PASSED' : 'AT LEAST ONE CONTRACT FAILED'}`)
  process.exit(allPassed ? 0 : 1)
}

main()
