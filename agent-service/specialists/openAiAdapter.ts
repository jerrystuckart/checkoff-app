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
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  return raw === '1' || raw.toLowerCase() === 'true'
}

export class OpenAiAdapter implements ProviderAdapter {
  readonly providerKey = 'openai'
  readonly supportsLiveWebResearch: boolean

  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  /** Hard override only — undefined means "route per-call" (the normal path). */
  private readonly explicitModel: string | undefined
  private readonly fetchImpl: typeof fetch

  constructor(options: OpenAiAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    this.baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'
    this.explicitModel = options.model
    this.fetchImpl = options.fetchImpl ?? fetch
    this.supportsLiveWebResearch = options.supportsLiveWebResearch ?? envFlag('CHIEF_OPENAI_SUPPORTS_WEB_SEARCH', true)
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

    const response = await this.fetchImpl(`${this.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '<no body>')
      throw new Error(`OpenAI Responses API returned ${response.status}: ${errText}`)
    }

    const json = (await response.json()) as {
      output_text?: string
      output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>
    }

    // The Responses API exposes a convenience `output_text` on most SDKs/
    // gateway shims; fall back to walking `output[].content[].text` for a
    // raw API response that doesn't include it.
    if (typeof json.output_text === 'string' && json.output_text.length > 0) {
      return { text: json.output_text }
    }
    const text = (json.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n')
    return { text }
  }
}
