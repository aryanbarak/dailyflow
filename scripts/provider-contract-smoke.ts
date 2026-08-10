#!/usr/bin/env node
// SmartFlow -- Provider-contract smoke script (task 16-fix, PO-mandated).
//
// MANUAL USE ONLY -- never wire this into CI. It makes three minimal REAL
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
// Run manually:
//   GEMINI_API_KEY=... npx vite-node scripts/provider-contract-smoke.ts

import { buildExtractionSystemInstruction, buildExtractionPrompt, buildExtractionResponseSchema } from '../agent/worker/personal-memory-extraction-endpoint'
import { buildDerivationSystemInstruction, buildDerivationPrompt, buildDerivationResponseSchema } from '../agent/worker/context-derivation-endpoint'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_DIMENSIONS = 768

if (!GEMINI_API_KEY) {
  console.error('FAIL: GEMINI_API_KEY is not set in the environment. Aborting before any call.')
  process.exit(1)
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
        maxOutputTokens: 256,
        temperature: 0,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
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
    const { status, bodyText } = await callGenerateContent(GEMINI_MODEL, buildExtractionSystemInstruction(), prompt, buildExtractionResponseSchema())
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
    const { status, bodyText } = await callGenerateContent(GEMINI_MODEL, buildDerivationSystemInstruction(), prompt, buildDerivationResponseSchema())
    if (status !== 200) return { name, pass: false, detail: `httpStatus=${status} body=${bodyText.slice(0, 300)}` }
    const parsed = JSON.parse(bodyText) as { candidates?: Array<{ finishReason?: string }> }
    const finishReason = parsed.candidates?.[0]?.finishReason
    if (finishReason !== 'STOP') return { name, pass: false, detail: `unexpected finishReason=${finishReason}` }
    return { name, pass: true, detail: 'httpStatus=200 finishReason=STOP' }
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

async function main() {
  console.log(`Provider-contract smoke test -- model=${GEMINI_MODEL} embeddingModel=${EMBEDDING_MODEL}`)
  console.log('(manual run only -- never wired into CI)\n')

  const results = [await checkExtractionContract(), await checkDerivationContract(), await checkEmbeddingContract()]

  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} -- ${result.name}`)
    console.log(`     ${result.detail}`)
  }

  const allPassed = results.every((r) => r.pass)
  console.log(`\n${allPassed ? 'ALL CONTRACTS PASSED' : 'AT LEAST ONE CONTRACT FAILED'}`)
  process.exit(allPassed ? 0 : 1)
}

main()
