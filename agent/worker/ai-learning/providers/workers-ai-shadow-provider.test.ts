import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WorkersAIShadowModelProvider } from './workers-ai-shadow-provider'
import type { WorkersAIBinding } from '../../providers/workers-ai/WorkersAITextGenerationProvider'

const VALID_PAYLOAD = {
  schemaVersion: 'intent-routing-v1',
  language: 'en',
  interactionClass: 'write',
  domain: 'calendar',
  intentType: 'create_calendar_event',
  toolId: 'calendar.create_event',
  requiresClarification: false,
  requiresApproval: true,
}

function bindingReturning(content: string): WorkersAIBinding {
  return { run: vi.fn(async () => ({ choices: [{ message: { content } }] })) }
}

function bindingThrowing(): WorkersAIBinding {
  return { run: vi.fn(async () => { throw new Error('binding exploded') }) }
}

describe('WorkersAIShadowModelProvider', () => {
  it('C: returns a successful prediction with correct provider/model/version provenance', async () => {
    const binding = bindingReturning(JSON.stringify(VALID_PAYLOAD))
    const provider = new WorkersAIShadowModelProvider(binding, { modelId: '@cf/some-org/shadow-model', modelVersion: '2026-09-01' })

    const result = await provider.predictRouting({ message: 'irrelevant', schemaVersion: 'intent-routing-v1' })

    expect(result).toEqual({
      ok: true,
      payload: VALID_PAYLOAD,
      providerId: 'workers-ai',
      modelId: '@cf/some-org/shadow-model',
      modelVersion: '2026-09-01',
    })
  })

  it('calls the binding with the CONFIGURED model id, never a hardcoded production model constant', async () => {
    const binding = bindingReturning(JSON.stringify(VALID_PAYLOAD))
    const provider = new WorkersAIShadowModelProvider(binding, { modelId: '@cf/custom/shadow-only-model', modelVersion: 'v9' })

    await provider.predictRouting({ message: 'irrelevant', schemaVersion: 'intent-routing-v1' })

    expect(binding.run).toHaveBeenCalledWith('@cf/custom/shadow-only-model', expect.any(Object))
  })

  it('passes temperature 0 and a bounded max_tokens to the binding', async () => {
    const binding = bindingReturning(JSON.stringify(VALID_PAYLOAD))
    const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

    await provider.predictRouting({ message: 'irrelevant', schemaVersion: 'intent-routing-v1' })

    const inputs = (binding.run as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(inputs.temperature).toBe(0)
    expect(inputs.max_tokens).toBeGreaterThan(0)
    expect(inputs.max_tokens).toBeLessThanOrEqual(512)
  })

  // E. shadow provider throws -> no fallback provider, response unaffected
  // (the "response unaffected" half is proven at the live-capture/index.ts
  // integration level; this proves the adapter itself never retries with
  // a different provider/model and reports a bounded failure).
  it('E: when the binding throws, returns a bounded provider_error failure, never throws itself', async () => {
    const binding = bindingThrowing()
    const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

    await expect(provider.predictRouting({ message: 'irrelevant', schemaVersion: 'intent-routing-v1' })).resolves.toEqual({ ok: false, reason: 'provider_error' })
  })

  it('calls the binding exactly once on failure -- no retry, no fallback attempt', async () => {
    const binding = bindingThrowing()
    const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

    await provider.predictRouting({ message: 'irrelevant', schemaVersion: 'intent-routing-v1' })

    expect(binding.run).toHaveBeenCalledTimes(1)
  })

  // D. shadow model invalid JSON/schema -> no shadow row (proven here at
  // the adapter level: invalid_output is returned, never a fabricated ok:true).
  it('D: invalid JSON content returns invalid_output', async () => {
    const binding = bindingReturning('not json at all')
    const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

    await expect(provider.predictRouting({ message: 'irrelevant', schemaVersion: 'intent-routing-v1' })).resolves.toEqual({ ok: false, reason: 'invalid_output' })
  })

  it('D: valid JSON that fails schema validation returns invalid_output', async () => {
    const binding = bindingReturning(JSON.stringify({ schemaVersion: 'intent-routing-v1', domain: 'bogus' }))
    const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

    await expect(provider.predictRouting({ message: 'irrelevant', schemaVersion: 'intent-routing-v1' })).resolves.toEqual({ ok: false, reason: 'invalid_output' })
  })

  it('an empty or missing response content returns invalid_output', async () => {
    const emptyBinding: WorkersAIBinding = { run: vi.fn(async () => ({ choices: [{ message: { content: '' } }] })) }
    const missingBinding: WorkersAIBinding = { run: vi.fn(async () => ({})) }
    const provider1 = new WorkersAIShadowModelProvider(emptyBinding, { modelId: 'm', modelVersion: 'v1' })
    const provider2 = new WorkersAIShadowModelProvider(missingBinding, { modelId: 'm', modelVersion: 'v1' })

    await expect(provider1.predictRouting({ message: 'x', schemaVersion: 'intent-routing-v1' })).resolves.toEqual({ ok: false, reason: 'invalid_output' })
    await expect(provider2.predictRouting({ message: 'x', schemaVersion: 'intent-routing-v1' })).resolves.toEqual({ ok: false, reason: 'invalid_output' })
  })

  // K/L-adjacent: the raw message is never echoed into a failure result or
  // any field this adapter returns.
  it('the raw request message never appears in a failure result', async () => {
    const binding = bindingThrowing()
    const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

    const result = await provider.predictRouting({ message: 'a very secret raw user message', schemaVersion: 'intent-routing-v1' })

    expect(JSON.stringify(result)).not.toContain('a very secret raw user message')
  })

  // ALF-1A correction (round 2, item 2): Workers AI candidate models
  // return at least two documented shapes -- the OpenAI-compatible
  // Chat-Completions shape (already covered by every test above) and a
  // bespoke `{ response: "..." }` completion shape some candidate
  // families (e.g. Qwen-family models) use instead.
  describe('both Workers AI response shapes (round 2, item 2)', () => {
    it('A: the OpenAI-compatible choices[0].message.content shape still succeeds', async () => {
      const binding = bindingReturning(JSON.stringify(VALID_PAYLOAD))
      const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

      await expect(provider.predictRouting({ message: 'x', schemaVersion: 'intent-routing-v1' })).resolves.toMatchObject({ ok: true, payload: VALID_PAYLOAD })
    })

    it('B: the bespoke { response: validJson } shape succeeds', async () => {
      const binding: WorkersAIBinding = { run: vi.fn(async () => ({ response: JSON.stringify(VALID_PAYLOAD) })) }
      const provider = new WorkersAIShadowModelProvider(binding, { modelId: '@cf/qwen-family/candidate', modelVersion: 'v1' })

      await expect(provider.predictRouting({ message: 'x', schemaVersion: 'intent-routing-v1' })).resolves.toEqual({
        ok: true,
        payload: VALID_PAYLOAD,
        providerId: 'workers-ai',
        modelId: '@cf/qwen-family/candidate',
        modelVersion: 'v1',
      })
    })

    it('C: the bespoke { response: invalidJson } shape returns invalid_output, never a fabricated success', async () => {
      const binding: WorkersAIBinding = { run: vi.fn(async () => ({ response: 'not valid json' })) }
      const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

      await expect(provider.predictRouting({ message: 'x', schemaVersion: 'intent-routing-v1' })).resolves.toEqual({ ok: false, reason: 'invalid_output' })
    })

    it('D: a response matching neither documented shape returns invalid_output', async () => {
      const binding: WorkersAIBinding = { run: vi.fn(async () => ({ output_text: JSON.stringify(VALID_PAYLOAD) })) }
      const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

      await expect(provider.predictRouting({ message: 'x', schemaVersion: 'intent-routing-v1' })).resolves.toEqual({ ok: false, reason: 'invalid_output' })
    })

    it('D: a null/undefined run() result returns invalid_output, never throws', async () => {
      const binding: WorkersAIBinding = { run: vi.fn(async () => null as unknown as Record<string, unknown>) }
      const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

      await expect(provider.predictRouting({ message: 'x', schemaVersion: 'intent-routing-v1' })).resolves.toEqual({ ok: false, reason: 'invalid_output' })
    })

    // E. a configured Qwen-like (or any bespoke-shape) model id is not
    // rejected merely because it uses the bespoke shape -- there is no
    // model-id-based branching anywhere in this adapter; both shapes are
    // always tried for ANY configured model id. Base model remains
    // UNDECIDED (ADR-0020 Decision 11) -- this is a compatibility fix, not
    // a decision that Qwen (or any specific model) is SmartFlow Core's
    // shadow or production model.
    it('E: a configured Qwen-family-shaped model id is accepted via the bespoke shape exactly like any other configured model', async () => {
      const binding: WorkersAIBinding = { run: vi.fn(async () => ({ response: JSON.stringify(VALID_PAYLOAD) })) }
      const provider = new WorkersAIShadowModelProvider(binding, { modelId: '@cf/qwen/qwen1.5-14b-chat-awq', modelVersion: '2026-09-01' })

      const result = await provider.predictRouting({ message: 'x', schemaVersion: 'intent-routing-v1' })

      expect(result.ok).toBe(true)
      expect(binding.run).toHaveBeenCalledWith('@cf/qwen/qwen1.5-14b-chat-awq', expect.any(Object))
    })

    it('prefers the OpenAI-compatible shape when both are somehow present', async () => {
      const binding: WorkersAIBinding = {
        run: vi.fn(async () => ({
          choices: [{ message: { content: JSON.stringify(VALID_PAYLOAD) } }],
          response: 'not json at all -- must never be read since choices already had valid content',
        })),
      }
      const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

      await expect(provider.predictRouting({ message: 'x', schemaVersion: 'intent-routing-v1' })).resolves.toMatchObject({ ok: true, payload: VALID_PAYLOAD })
    })

    it('still exactly one env.AI.run call and no fallback for the bespoke shape\'s own failures', async () => {
      const binding: WorkersAIBinding = { run: vi.fn(async () => ({ response: 'not valid json' })) }
      const provider = new WorkersAIShadowModelProvider(binding, { modelId: 'm', modelVersion: 'v1' })

      await provider.predictRouting({ message: 'x', schemaVersion: 'intent-routing-v1' })

      expect(binding.run).toHaveBeenCalledTimes(1)
    })
  })

  // S. no Gemini/production-provider fallback in shadow adapter. Scoped to
  // actual import statements, not the whole file text -- this module's own
  // header comment legitimately explains IN PROSE why it never falls back
  // to Gemini, which would otherwise trip a naive whole-file substring scan.
  it('S: the module source never imports Gemini or any production text-generation provider', () => {
    const source = readFileSync(join(__dirname, 'workers-ai-shadow-provider.ts'), 'utf8')
    const importLines = source.split('\n').filter((line) => line.trim().startsWith('import ') || line.trim().startsWith('} from'))
    const importText = importLines.join('\n')
    expect(importText.toLowerCase()).not.toContain('gemini')
    expect(importText).not.toContain('createProviders')
    expect(importText).not.toContain('DEFAULT_WORKERS_AI_TEXT_MODEL')
  })
})
