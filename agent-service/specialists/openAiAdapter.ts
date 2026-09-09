// Chief Phase 2F — the OpenAI provider adapter (spec section 9). Same
// ProviderAdapter seam as AnthropicMessagesAdapter (remoteAiExecutor.ts)
// — RemoteAiExecutor, routing.ts, and every playbook/methodology stay
// completely unaware which vendor actually ran a given execution.
// research_verifier is NOT hardcoded to this provider — see routing.ts's
// preference-ordered adapter list.
//
// Uses the OpenAI Responses API (`/v1/responses`) with the `web_search`
// tool when live research is required. Gated entirely on
// OPENAI_API_KEY — isConfigured() is false without it, same discipline
// as the Anthropic adapter.
//
// MODEL SELECTION (Phase 2H): per-call, via modelRouting.ts's
// `specialist + methodology -> configured model` policy — NOT one fixed
// model per adapter instance. `options.model` (or
// CHIEF_OPENAI_RESEARCH_MODEL at construction time) remains available as
// a hard override for callers that want ALL calls through this instance
// pinned to one model regardless of routing (e.g. tests); when unset,
// every call resolves its own model from the routing table using that
// call's actual specialist/methodology.
//
// gpt-4.1 (the routing table's default for research/DVA-1) was verified
// working end-to-end in a real live-provider proof, 2026-09-05: live
// web_search tool use, a real cited source URL, current (2026)
// information. gpt-5 404s on this account — "organization must be
// verified" — so it is deliberately NOT the default; see modelRouting.ts
// for the full pinned-model policy (never auto-escalate to a newer
// model merely because one exists).

import type { ProviderAdapter, ProviderCompletionInput, ProviderCompletionResult } from './remoteAiExecutor'
import { resolveOpenAiModel } from './modelRouting'
import type { TokenUsage } from './usagePricing'

export interface OpenAiAdapterOptions {
  apiKey?: string
  baseUrl?: string
  /** Hard override — when set, EVERY call through this instance uses exactly this model, bypassing modelRouting.ts entirely. Leave unset to let each call route by its own specialist/methodology. */
  model?: string
  fetchImpl?: typeof fetch
  /**
   * Whether the configured model/endpoint actually supports the
   * `web_search` tool. Defaults to true (most current OpenAI models via
   * the Responses API do), but is explicitly configurable — per spec
   * section 9, this adapter must never claim live-web capability it
   * cannot actually provide. Set CHIEF_OPENAI_SUPPORTS_WEB_SEARCH=false
   * if the configured model doesn't support it.
   */
  supportsLiveWebResearch?: boolean
  /**
   * Max automatic retries for a 429 (rate limit) response, WITHIN this
   * one complete() call — never for any other HTTP status (an auth
   * failure, a bad request, a 5xx, etc. still throw immediately; a rate
   * limit is categorically transient in a way those aren't). Found
   * necessary building Vienna, 2026-09-09: a metro with hundreds of
   * candidates fans M6.5 checkoff_editor calls out concurrently
   * (DriverGuardrails.maxConcurrentExecutions), which can trip this
   * account's real per-minute token budget even though every individual
   * call is well-formed — the previous behavior (throw immediately, no
   * retry) surfaced that as EXECUTOR_UNAVAILABLE and BLOCKED the entire
   * run, requiring a human to notice and manually retry over and over.
   * Bounded exactly like every other retry loop in this codebase — see
   * runStepWithRetry's own doc.
   */
  maxRateLimitRetries?: number
  /** Test-only override for the actual delay between retries — real backoff by default (see resolveRetryDelayMs), instant in tests. */
  sleepImpl?: (ms: number) => Promise<void>
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  return raw === '1' || raw.toLowerCase() === 'true'
}

// 6, not 4: real production traffic (Vienna, 2026-09-09) showed a batch
// of concurrent M6.5 calls can keep the account's per-MINUTE token
// budget saturated for several seconds at a time — every sibling call
// in the same fan-out batch is retrying on roughly the same schedule,
// so a short retry budget can exhaust itself before the 60s window
// actually rolls over. 6 retries against the capped exponential backoff
// below (1+2+4+8+16+30 = 61s worst case) is sized to cover one full
// per-minute window — proportionate to what's actually being waited on,
// not an arbitrary large number.
export const DEFAULT_MAX_RATE_LIMIT_RETRIES = 6

/**
 * How long to wait before retrying a 429. Prefers the API's own stated
 * wait (a `retry-after` header, in seconds; or the error body's "Please
 * try again in <N>ms/s" text OpenAI's rate-limit errors include) — the
 * server knows its own reset window better than a guess would. Falls
 * back to a small exponential backoff (attempt 1 -> 1s, 2 -> 2s, 3 -> 4s,
 * ...) when neither is present/parseable, capped so a single retry never
 * waits an unreasonable amount of time.
 */
export function resolveRetryDelayMs(attempt: number, retryAfterHeader: string | null, errorBodyText: string): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30000)
  }
  const match = errorBodyText.match(/try again in\s+([\d.]+)\s*(ms|s)\b/i)
  if (match) {
    const value = Number(match[1])
    if (Number.isFinite(value)) {
      const ms = match[2].toLowerCase() === 's' ? value * 1000 : value
      return Math.min(Math.max(ms, 0), 30000)
    }
  }
  return Math.min(1000 * 2 ** (attempt - 1), 30000)
}

async function realSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export class OpenAiAdapter implements ProviderAdapter {
  readonly providerKey = 'openai'
  readonly supportsLiveWebResearch: boolean

  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  /** Hard override only — undefined means "route per-call" (the normal path). */
  private readonly explicitModel: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly maxRateLimitRetries: number
  private readonly sleepImpl: (ms: number) => Promise<void>

  constructor(options: OpenAiAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    this.baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'
    this.explicitModel = options.model
    this.fetchImpl = options.fetchImpl ?? fetch
    this.supportsLiveWebResearch = options.supportsLiveWebResearch ?? envFlag('CHIEF_OPENAI_SUPPORTS_WEB_SEARCH', true)
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES
    this.sleepImpl = options.sleepImpl ?? realSleep
  }

  isConfigured(): boolean {
    return !!this.apiKey
  }

  /** The model THIS call will use — exposed for logging/reporting, not just internal use. */
  modelFor(specialist: string, methodologyId: string): string {
    return this.explicitModel ?? resolveOpenAiModel(specialist, methodologyId).model
  }

  async complete(input: ProviderCompletionInput): Promise<ProviderCompletionResult> {
    if (!this.apiKey) {
      throw new Error('OpenAiAdapter.complete called without OPENAI_API_KEY configured — canExecute()/isConfigured() should have prevented this.')
    }
    const model = this.modelFor(input.specialist, input.methodologyId)
    if (input.requiresLiveWebResearch && !this.supportsLiveWebResearch) {
      // Honest failure per spec section 9 — never silently drop the web
      // requirement and answer from training data instead.
      throw new Error(`OpenAiAdapter is configured with model "${model}", which this configuration declares does NOT support live web research (CHIEF_OPENAI_SUPPORTS_WEB_SEARCH=false) — refusing to answer a live-research request from memory.`)
    }

    const body: Record<string, unknown> = {
      model,
      input: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
    }
    if (input.requiresLiveWebResearch) {
      body.tools = [{ type: 'web_search' }]
    }

    let response: Awaited<ReturnType<typeof this.fetchImpl>> | undefined
    let lastErrText = ''
    for (let attempt = 1; attempt <= this.maxRateLimitRetries + 1; attempt++) {
      response = await this.fetchImpl(`${this.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      })
      if (response.ok) break
      if (response.status !== 429) {
        const errText = await response.text().catch(() => '<no body>')
        throw new Error(`OpenAI Responses API returned ${response.status}: ${errText}`)
      }
      lastErrText = await response.text().catch(() => '<no body>')
      if (attempt > this.maxRateLimitRetries) {
        throw new Error(`OpenAI Responses API returned 429 after ${this.maxRateLimitRetries} retr${this.maxRateLimitRetries === 1 ? 'y' : 'ies'}: ${lastErrText}`)
      }
      const delayMs = resolveRetryDelayMs(attempt, response.headers.get('retry-after'), lastErrText)
      await this.sleepImpl(delayMs)
    }
    if (!response) {
      throw new Error('OpenAiAdapter.complete: unreachable — the retry loop always assigns a response before exiting')
    }

    const json = (await response.json()) as {
      output_text?: string
      output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    }

    // Real token usage, when the API returned it — never fabricated when
    // absent. Production-integrity pass: this is what lets Chief compute
    // a real per-execution cost instead of a hand-waved estimate.
    const usage: TokenUsage | null = json.usage
      ? {
          inputTokens: typeof json.usage.input_tokens === 'number' ? json.usage.input_tokens : null,
          outputTokens: typeof json.usage.output_tokens === 'number' ? json.usage.output_tokens : null,
          totalTokens: typeof json.usage.total_tokens === 'number' ? json.usage.total_tokens : null,
        }
      : null

    // The Responses API exposes a convenience `output_text` on most SDKs/
    // gateway shims; fall back to walking `output[].content[].text` for a
    // raw API response that doesn't include it.
    if (typeof json.output_text === 'string' && json.output_text.length > 0) {
      return { text: json.output_text, model, usage }
    }
    const text = (json.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n')
    return { text, model, usage }
  }
}
