// SmartFlow -- ADR-0018 S1b: second TextGenerationProvider, via Cloudflare
// Workers AI (the `env.AI` binding). Structured generation and embeddings
// stay Gemini-only and fail-closed (ADR-0018 Decision 5) -- this file is
// text generation only, and this slice adds NO fallback chain (that is
// S1c, a separate slice after real-world quality comparison): a deployment
// picks exactly one TextGenerationProvider via createProviders' own
// AI_TEXT_PROVIDER selection, and that is the only one that ever runs.
//
// Precedent: workers/ai-worker-recovered/index.js's callWorkersAI used
// Workers AI as a Gemini fallback via `@cf/meta/llama-3.1-8b-instruct`
// (now retired from the binding's own catalog -- only -fp8/-awq quantized
// variants remain). This adapter picks a current, newer-generation model
// instead (see DEFAULT_WORKERS_AI_TEXT_MODEL below for the choice and its
// rationale) but keeps the same request/response TRANSLATION shape that
// precedent established: system text as a leading message, turns mapped
// user/assistant, maxOutputTokens/temperature passed straight through.
//
// Model interface note: the binding exposes two different input/output
// shapes across its catalog -- an older bespoke {messages, max_tokens,
// temperature} -> {response, usage} shape (used by llama-2/3/3.1/3.2,
// mistral, qwen1.5, ...), and a newer OpenAI-compatible Chat Completions
// shape (messages with system/user/assistant roles -> choices[0].message
// .content + finish_reason + usage) used by every model added to the
// catalog most recently (Gemma 4, GLM-4.7-flash, Kimi K2.5/2.6,
// Nemotron-3, gpt-oss). DEFAULT_WORKERS_AI_TEXT_MODEL uses the latter --
// this adapter is written against that shape only, not the older one.
//
// Deliberately does NOT reference the ambient `Ai` class (or
// `ChatCompletionsOutput`/`ChatCompletionMessageParam`/...) from
// worker-configuration.d.ts anywhere in this file -- see chatMessage.ts's
// own header comment for the exact incident this avoids: those ambient
// Cloudflare Workers types require @cloudflare/workers-types, unavailable
// to the root project's tsconfig.app.json, and a handful of
// src/*.equivalence.test.ts files reach into this file's own import chain
// (via createProviders.ts) for cross-implementation parity checks. This
// file defines its own minimal structural types instead (WorkersAIBinding,
// WorkersAIChatMessage, WorkersAIChatCompletionResponse) -- the real
// `env.AI` (typed `Ai` at the one real call site, agent/worker/types.ts's
// `Env`) satisfies WorkersAIBinding structurally, so nothing is lost by
// not naming the richer type here.
import type { ChatMessage } from '../../chatMessage'
import { ProviderUnavailableError } from '../../provider-errors'
import { recordProviderFailure, type ProviderFailureEnv } from '../failureEvents'
import type { TextGenerationProvider, TextGenerationRequest, TextGenerationResult } from '../types'

// ADR-0018 S1b diagnosis (model selection): the PO's stated priority is
// multilingual quality for German AND Dari/Farsi, plus context length and
// speed. Every current text-generation model on the binding was reviewed
// (worker-configuration.d.ts's AiModels catalog, wrangler-types-generated
// 2026-08-24). Two realistic candidates, both Mixture-of-Experts (fast --
// only a fraction of total parameters active per token) and both newer
// than the retired llama-3.1-8b precedent:
//   - @cf/google/gemma-4-26b-a4b-it (chosen): newest Gemma generation on
//     the binding, 26B total / ~4B active. The Gemma family is documented
//     as pretrained across 140+ languages -- the broadest multilingual net
//     of any candidate reviewed, which matters most for Dari specifically:
//     it is an extremely low-resource language even among "supported"
//     multilingual models, so the widest pretraining net is the best
//     available bet, not a verified guarantee. German is well within any
//     major model's coverage. Uses the OpenAI-compatible Chat Completions
//     shape (finishReason/usage map directly onto this adapter's neutral
//     contract) rather than a bespoke one.
//   - @cf/qwen/qwen3-30b-a3b-fp8 (alternate): also MoE (30B/~3B active),
//     Alibaba's Qwen technical reports explicitly name Persian in their
//     supported-language list (a stronger documented claim for Farsi
//     specifically than Gemma's general "140+ languages"), but the
//     binding's own type for it is a bespoke completions shape (not Chat
//     Completions), and Qwen's documented language list is narrower than
//     Gemma's overall.
// This is a recommendation, not a verified benchmark -- neither model's
// Dari quality has been checked against real output. PO should spot-check
// both languages against a live deploy before treating this as final;
// changing the default is a one-line change to this constant.
export const DEFAULT_WORKERS_AI_TEXT_MODEL = '@cf/google/gemma-4-26b-a4b-it'

// Minimal structural view of the binding -- see this file's header comment
// for why this is not the real ambient `Ai` type. `run`'s real signature is
// generic/overloaded per model name; a plain `(model: string, inputs) =>
// Promise<unknown>` is what every model on the binding actually satisfies,
// and is exactly what this adapter needs.
export interface WorkersAIBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>
}

export interface WorkersAIProviderEnv extends ProviderFailureEnv {
  AI: WorkersAIBinding
}

type WorkersAIChatRole = 'system' | 'user' | 'assistant'

interface WorkersAIChatMessage {
  role: WorkersAIChatRole
  content: string
}

// The subset of the Chat Completions response shape this adapter reads.
// Deliberately loose (all optional) -- parsed defensively below, the same
// discipline GeminiTextGenerationProvider's own `data.candidates?.[0]`
// read uses.
interface WorkersAIChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null }
    finish_reason?: string
  }>
}

function mapRole(role: ChatMessage['role']): 'user' | 'assistant' {
  return role === 'assistant' ? 'assistant' : 'user'
}

function buildMessages(req: TextGenerationRequest): WorkersAIChatMessage[] {
  const messages: WorkersAIChatMessage[] = []
  if (req.system !== undefined) messages.push({ role: 'system', content: req.system })
  for (const turn of req.turns) {
    messages.push({ role: mapRole(turn.role), content: turn.content })
  }
  return messages
}

// ADR-0018 Decision 3 note (finishReason mapping): the Chat Completions
// shape's finish_reason is 'stop' | 'length' | 'tool_calls' |
// 'content_filter' | 'function_call'. This adapter never sends tools, so
// 'tool_calls'/'function_call' should not occur in practice; they collapse
// into 'other' along with 'content_filter' and anything unrecognized, same
// two-bit distinction GeminiTextGenerationProvider's own mapFinishReason
// makes ('stop' vs 'cut off for length' vs 'anything else').
function mapFinishReason(raw: unknown): TextGenerationResult['finishReason'] {
  if (raw === 'stop') return 'stop'
  if (raw === 'length') return 'length'
  return 'other'
}

// Work item 2 (S1b task): a text-only model must not silently drop an
// attachment -- it must fail loudly and typed, so a caller that forgets
// this adapter's own limitation finds out immediately, not via a
// quietly-degraded answer. `.code` is the stable, typed discriminant a
// caller can check without a message-string match.
export class AttachmentsUnsupportedError extends Error {
  readonly code = 'ATTACHMENTS_UNSUPPORTED'

  constructor(
    readonly providerId: string,
    readonly model: string,
  ) {
    super(
      `${providerId} (${model}) is text-only and cannot accept an attachment. The caller must pin this request to a provider that supports attachments (e.g. Gemini) instead of relying on selection.`,
    )
    this.name = 'AttachmentsUnsupportedError'
  }
}

export class WorkersAITextGenerationProvider implements TextGenerationProvider {
  readonly id = 'workers-ai'

  constructor(
    private readonly env: WorkersAIProviderEnv,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
    // Presence-only check: this adapter does not need to know the
    // attachment's shape, only that the caller is asking for one. Every
    // real call site that carries an attachment sets
    // providerOptions.inlineDataAttachment (GeminiTextGenerationProvider's
    // own escape-hatch key -- ADR-0018 Decision 2 -- reused here as the
    // one signal both adapters recognize) regardless of which adapter
    // ultimately handles the request.
    if (req.providerOptions?.inlineDataAttachment !== undefined) {
      throw new AttachmentsUnsupportedError(this.id, DEFAULT_WORKERS_AI_TEXT_MODEL)
    }

    const inputs: Record<string, unknown> = { messages: buildMessages(req) }
    if (req.maxOutputTokens !== undefined) inputs.max_tokens = req.maxOutputTokens
    if (req.temperature !== undefined) inputs.temperature = req.temperature

    let raw: unknown
    try {
      raw = await this.env.AI.run(DEFAULT_WORKERS_AI_TEXT_MODEL, inputs)
    } catch (err) {
      // ADR-0018 S1b: the binding throws on any inference failure -- there
      // is no HTTP response and so no status code to classify by (unlike
      // fetchGeminiOrThrow's 429/5xx-vs-other split). Every binding error
      // maps to the same ProviderUnavailableError analog the task asked
      // for; provider_failure_events.http_status is nullable already (see
      // the 20260823000000 migration's own column comment), so no schema
      // change is needed to persist this with http_status left absent.
      await recordProviderFailure(this.env, {
        capability: 'text_generation',
        provider_id: this.id,
      }, this.fetcher)
      throw new ProviderUnavailableError(
        `Workers AI text generation (${DEFAULT_WORKERS_AI_TEXT_MODEL}): ${(err as Error)?.message ?? String(err)}`,
      )
    }

    const data = raw as WorkersAIChatCompletionResponse
    const choice = data?.choices?.[0]
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : ''
    const finishReason = mapFinishReason(choice?.finish_reason)

    return { text, finishReason }
  }
}
