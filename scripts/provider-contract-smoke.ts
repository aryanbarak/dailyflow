#!/usr/bin/env node
// SmartFlow -- Provider-contract smoke script (task 16-fix, PO-mandated;
// fifth contract added task 28b to cover the reasoning-endpoint schema;
// sixth contract added ADR-0018 S1 to cover the new TextGenerationProvider
// adapter -- see checkTextGenerationAdapterContract below). ADR-0018 S2:
// checks 1-4 (extraction/derivation/task-title/reasoning) now go through
// GeminiStructuredGenerationProvider instead of a hand-rolled fetch --
// same adapter every real [STRUCTURED_GEN] call site uses. ADR-0018 S3:
// check 5 (embedding) now goes through GeminiEmbeddingProvider likewise --
// same adapter both real [EMBEDDING] call sites use.
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
// ADR-0018 S2 Phase C: checks 1-4 go through this adapter now -- the same
// class every real [STRUCTURED_GEN] call site uses via createProviders()
// -- instead of a hand-rolled fetch. That is the whole point of this
// script: a schema/model/translation break here is a break for every one
// of those real call sites, not just one manual fetch that happened to
// mirror them.
import { GeminiStructuredGenerationProvider } from '../agent/worker/providers/gemini/GeminiStructuredGenerationProvider'
// ADR-0018 S3: check 5 (embedding) goes through this adapter now -- same
// principle as S2's checks 1-4 -- instead of a hand-rolled fetch.
import { GeminiEmbeddingProvider } from '../agent/worker/providers/gemini/GeminiEmbeddingProvider'
// MIG-01b: single-source model resolution (see that module's header
// comment) -- this script no longer hardcodes its own default.
import { resolveGeminiModel } from '../agent/worker/geminiModel'
// ADR-0018 S3: single-source embedding model/dimensions -- this script no
// longer hardcodes its own copies of either.
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from '../agent/worker/embeddingConfig'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''
const GEMINI_MODEL = resolveGeminiModel({ GEMINI_MODEL: process.env.GEMINI_MODEL })
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

// ADR-0018 S2: shared by all 4 structured-generation checks below.
// SUPABASE_URL/SUPABASE_SERVICE_KEY are placeholders -- these checks only
// exercise the SUCCESS path, which never touches
// providers/failureEvents.ts's persistence at all (that only fires on a
// caught ProviderUnavailableError), mirroring
// checkTextGenerationAdapterContract's own identical placeholder comment.
const structuredProvider = new GeminiStructuredGenerationProvider({
  GEMINI_API_KEY,
  GEMINI_MODEL,
  SUPABASE_URL: 'https://smoke-test.invalid',
  SUPABASE_SERVICE_KEY: 'unused-in-the-success-path',
})

async function checkExtractionContract(): Promise<ContractResult> {
  const name = 'GeminiStructuredGenerationProvider + buildExtractionResponseSchema (personal-memory-extraction-endpoint.ts)'
  try {
    const prompt = buildExtractionPrompt([{ id: 'smoke-1', provenanceSourceKind: 'chat_turn', text: 'I prefer working in the morning.' }])
    const result = await structuredProvider.generateStructured({
      system: buildExtractionSystemInstruction(),
      turns: [{ role: 'user', content: prompt }],
      schema: buildExtractionResponseSchema(),
      maxOutputTokens: 2048,
      temperature: 0,
    })
    if (result.finishReason !== 'stop') return { name, pass: false, detail: `unexpected finishReason=${result.rawFinishReason ?? result.finishReason}` }
    return { name, pass: true, detail: `finishReason=stop rawFinishReason=${result.rawFinishReason ?? 'n/a'}` }
  } catch (error) {
    return { name, pass: false, detail: (error as Error).message }
  }
}

async function checkDerivationContract(): Promise<ContractResult> {
  const name = 'GeminiStructuredGenerationProvider + buildDerivationResponseSchema (context-derivation-endpoint.ts)'
  try {
    const prompt = buildDerivationPrompt('Smoke Test Project', [{ id: 'smoke-1', sourceKind: 'note', title: 'Kickoff', reference: 'smoke', text: 'Project kickoff scheduled next week.' }])
    const result = await structuredProvider.generateStructured({
      system: buildDerivationSystemInstruction(),
      turns: [{ role: 'user', content: prompt }],
      schema: buildDerivationResponseSchema(),
      maxOutputTokens: 2048,
      temperature: 0,
    })
    if (result.finishReason !== 'stop') return { name, pass: false, detail: `unexpected finishReason=${result.rawFinishReason ?? result.finishReason}` }
    return { name, pass: true, detail: `finishReason=stop rawFinishReason=${result.rawFinishReason ?? 'n/a'}` }
  } catch (error) {
    return { name, pass: false, detail: (error as Error).message }
  }
}

async function checkTaskTitleContract(): Promise<ContractResult> {
  const name = 'GeminiStructuredGenerationProvider + buildTaskTitleResponseSchema (task-title-extraction.ts)'
  try {
    const prompt = buildTaskTitlePrompt('Create a task for tomorrow because I have a family doctor appointment at 11am.')
    const result = await structuredProvider.generateStructured({
      system: buildTaskTitleSystemInstruction(),
      turns: [{ role: 'user', content: prompt }],
      schema: buildTaskTitleResponseSchema(),
      maxOutputTokens: 2048,
      temperature: 0,
    })
    if (result.finishReason !== 'stop') return { name, pass: false, detail: `unexpected finishReason=${result.rawFinishReason ?? result.finishReason}` }
    return { name, pass: true, detail: `finishReason=stop rawFinishReason=${result.rawFinishReason ?? 'n/a'}` }
  } catch (error) {
    return { name, pass: false, detail: (error as Error).message }
  }
}

async function checkReasoningContract(): Promise<ContractResult> {
  const name = 'GeminiStructuredGenerationProvider + buildReasoningResponseSchema (reasoning-endpoint.ts)'
  try {
    const prompt = 'Latest user message: "I spent 45 EUR on groceries today." Propose one intent for this SmartFlow request.'
    const result = await structuredProvider.generateStructured({
      system: buildReasoningSystemInstruction('en'),
      turns: [{ role: 'user', content: prompt }],
      schema: buildReasoningResponseSchema(),
      maxOutputTokens: 2048,
      temperature: 0,
    })
    if (result.finishReason !== 'stop') return { name, pass: false, detail: `unexpected finishReason=${result.rawFinishReason ?? result.finishReason}` }
    if (!result.rawText.trim()) return { name, pass: false, detail: 'model returned no proposal content' }
    const proposal = JSON.parse(result.rawText) as { type?: unknown }
    if (typeof proposal.type !== 'string' || !(SUPPORTED_INTENT_VALUES as readonly string[]).includes(proposal.type)) {
      return { name, pass: false, detail: `intent ${JSON.stringify(proposal.type)} is not in SUPPORTED_INTENT_VALUES` }
    }
    return { name, pass: true, detail: `finishReason=stop intent=${proposal.type}` }
  } catch (error) {
    return { name, pass: false, detail: (error as Error).message }
  }
}

// ADR-0018 S3: proves GeminiEmbeddingProvider's real request envelope
// (including its own client-side L2-normalization) still round-trips
// against the live API -- same principle as checkTextGenerationAdapterContract
// (S1) and checks 1-4 above (S2). SUPABASE_URL/SUPABASE_SERVICE_KEY are
// placeholders: this check only calls embed() on the SUCCESS path, which
// never touches providers/failureEvents.ts's persistence at all (that only
// fires on a caught ProviderUnavailableError).
async function checkEmbeddingContract(): Promise<ContractResult> {
  const name = `GeminiEmbeddingProvider.embed on ${EMBEDDING_MODEL} with outputDimensionality=${EMBEDDING_DIMENSIONS}`
  try {
    const provider = new GeminiEmbeddingProvider({
      GEMINI_API_KEY,
      SUPABASE_URL: 'https://smoke-test.invalid',
      SUPABASE_SERVICE_KEY: 'unused-in-the-success-path',
    })
    const result = await provider.embed(['Smoke test content for embedding contract verification.'])
    const values = result.vectors[0] ?? []
    if (values.length !== EMBEDDING_DIMENSIONS) {
      return { name, pass: false, detail: `expected ${EMBEDDING_DIMENSIONS} values, got ${values.length}` }
    }
    const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0))
    if (Math.abs(norm - 1) > 1e-3) {
      return { name, pass: false, detail: `adapter output was not unit-normalized (norm=${norm})` }
    }
    return { name, pass: true, detail: `valueCount=${values.length} norm=${norm.toFixed(6)}` }
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
