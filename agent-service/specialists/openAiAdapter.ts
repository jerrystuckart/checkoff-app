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

import type { ProviderAdapter, ProviderCompletionInput, ProviderCompletionResult } from './remoteAiExecutor'

export interface OpenAiAdapterOptions {
  apiKey?: string
  baseUrl?: string
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
  private readonly model: string
  private readonly fetchImpl: typeof fetch

  constructor(options: OpenAiAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    this.baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'
    this.model = options.model ?? process.env.CHIEF_OPENAI_RESEARCH_MODEL ?? 'gpt-5'
    this.fetchImpl = options.fetchImpl ?? fetch
    this.supportsLiveWebResearch = options.supportsLiveWebResearch ?? envFlag('CHIEF_OPENAI_SUPPORTS_WEB_SEARCH', true)
  }

  isConfigured(): boolean {
    return !!this.apiKey
  }

  async complete(input: ProviderCompletionInput): Promise<ProviderCompletionResult> {
    if (!this.apiKey) {
      throw new Error('OpenAiAdapter.complete called without OPENAI_API_KEY configured — canExecute()/isConfigured() should have prevented this.')
    }
    if (input.requiresLiveWebResearch && !this.supportsLiveWebResearch) {
      // Honest failure per spec section 9 — never silently drop the web
      // requirement and answer from training data instead.
      throw new Error(`OpenAiAdapter is configured with model "${this.model}", which this configuration declares does NOT support live web research (CHIEF_OPENAI_SUPPORTS_WEB_SEARCH=false) — refusing to answer a live-research request from memory.`)
    }

    const body: Record<string, unknown> = {
      model: this.model,
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
