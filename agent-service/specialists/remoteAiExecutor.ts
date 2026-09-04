// Chief Phase 2E — the first real REMOTE_AI_EXECUTOR. Provider details
// live entirely behind ProviderAdapter; RemoteAiExecutor itself and
// everything in executor.ts/delegation.ts/the playbooks never names a
// vendor. If no configured adapter can satisfy a request's required
// capabilities, execute() is never called — canExecute() returns false
// and runExecution() (executor.ts) records EXECUTOR_UNAVAILABLE honestly.
// Never falls back to fabricating a result.

import type { SpecialistExecutor, SpecialistExecutionRequest } from './executor'
import type { SpecialistResultEnvelope } from './types'
import { buildResearchVerifierPrompt, buildCheckoffEditorPrompt } from './promptBuilders'
import { getMethodology, methodologyExists } from './methodologyRegistry'

// ---------------------------------------------------------------------------
// Provider adapter — the ONLY seam a specific vendor's API shape touches.
// ---------------------------------------------------------------------------

export interface ProviderCompletionInput {
  systemPrompt: string
  userPrompt: string
  /** Whether this call needs live web research capability — an adapter that can't do this for a given request should be excluded by capability routing before it ever reaches here. */
  requiresLiveWebResearch: boolean
}

export interface ProviderCompletionResult {
  text: string
}

export interface ProviderAdapter {
  /** Internal identifier only (e.g. 'anthropic', 'openai') — never surfaced to playbook/methodology code, which only ever sees SpecialistExecutor/ExecutorType. */
  readonly providerKey: string
  readonly supportsLiveWebResearch: boolean
  isConfigured(): boolean
  complete(input: ProviderCompletionInput): Promise<ProviderCompletionResult>
}

// ---------------------------------------------------------------------------
// Anthropic Messages API adapter — real HTTP, gated entirely on
// ANTHROPIC_API_KEY being set. `fetchImpl` is injectable (default global
// fetch) purely so this module's own tests never make a real network
// call, same DI pattern as chiefBrief.ts/openBrainDecisions.ts.
// ---------------------------------------------------------------------------

export interface AnthropicAdapterOptions {
  apiKey?: string
  baseUrl?: string
  model?: string
  fetchImpl?: typeof fetch
}

export class AnthropicMessagesAdapter implements ProviderAdapter {
  readonly providerKey = 'anthropic'
  readonly supportsLiveWebResearch = true

  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  private readonly model: string
  private readonly fetchImpl: typeof fetch

  constructor(options: AnthropicAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
    this.baseUrl = options.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'
    this.model = options.model ?? process.env.CHIEF_RESEARCH_MODEL ?? 'claude-sonnet-5'
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  isConfigured(): boolean {
    return !!this.apiKey
  }

  async complete(input: ProviderCompletionInput): Promise<ProviderCompletionResult> {
    if (!this.apiKey) {
      throw new Error('AnthropicMessagesAdapter.complete called without ANTHROPIC_API_KEY configured — canExecute()/isConfigured() should have prevented this.')
    }
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      system: input.systemPrompt,
      messages: [{ role: 'user', content: input.userPrompt }],
    }
    if (input.requiresLiveWebResearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
    }

    const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '<no body>')
      throw new Error(`Anthropic Messages API returned ${response.status}: ${errText}`)
    }

    const json = (await response.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = (json.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    return { text }
  }
}

// ---------------------------------------------------------------------------
// Structured envelope parsing — strict, never a silent best-effort guess.
// ---------------------------------------------------------------------------

const REQUIRED_ENVELOPE_KEYS = ['taskId', 'objective', 'actionsPerformed', 'evidence', 'artifacts', 'confidence', 'blockers', 'discoveredFollowUpWork', 'recommendedNextAction', 'jerryRequired', 'methodologyId', 'methodologyVersion'] as const

export interface EnvelopeParseResult {
  ok: boolean
  envelope: SpecialistResultEnvelope | null
  reason: string | null
}

/** Strips a ```json ... ``` or ``` ... ``` fence if the model wrapped its output in one despite instructions not to. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : trimmed
}

export function parseModelEnvelope(text: string): EnvelopeParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(text))
  } catch (err) {
    return { ok: false, envelope: null, reason: `model output is not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, envelope: null, reason: 'model output parsed but is not a JSON object' }
  }
  const missing = REQUIRED_ENVELOPE_KEYS.filter((k) => !(k in (parsed as Record<string, unknown>)))
  if (missing.length > 0) {
    return { ok: false, envelope: null, reason: `model output JSON is missing required envelope key(s): ${missing.join(', ')}` }
  }
  const obj = parsed as Record<string, unknown>
  const envelope: SpecialistResultEnvelope = {
    taskId: String(obj.taskId),
    objective: String(obj.objective),
    actionsPerformed: Array.isArray(obj.actionsPerformed) ? obj.actionsPerformed.map(String) : [],
    evidence: (obj.evidence as Record<string, unknown>) ?? {},
    artifacts: Array.isArray(obj.artifacts) ? obj.artifacts.map(String) : [],
    confidence: obj.confidence === 'LOW' || obj.confidence === 'MEDIUM' || obj.confidence === 'HIGH' ? obj.confidence : 'LOW',
    blockers: Array.isArray(obj.blockers) ? obj.blockers.map(String) : [],
    discoveredFollowUpWork: Array.isArray(obj.discoveredFollowUpWork) ? obj.discoveredFollowUpWork.map(String) : [],
    recommendedNextAction: typeof obj.recommendedNextAction === 'string' ? obj.recommendedNextAction : '',
    jerryRequired: obj.jerryRequired === true,
    jerryReason: typeof obj.jerryReason === 'string' ? obj.jerryReason : null,
    methodologyId: String(obj.methodologyId),
    methodologyVersion: String(obj.methodologyVersion),
  }
  return { ok: true, envelope, reason: null }
}

// ---------------------------------------------------------------------------
// RemoteAiExecutor — the SpecialistExecutor implementation
// ---------------------------------------------------------------------------

const WIRED_SPECIALISTS = new Set(['research_verifier', 'checkoff_editor'])

export class RemoteAiExecutor implements SpecialistExecutor {
  readonly executorType = 'REMOTE_AI_EXECUTOR' as const

  constructor(private readonly adapters: ProviderAdapter[]) {}

  private selectAdapter(request: SpecialistExecutionRequest): ProviderAdapter | null {
    const needsLiveWeb = request.specialist === 'research_verifier'
    return this.adapters.find((a) => a.isConfigured() && (!needsLiveWeb || a.supportsLiveWebResearch)) ?? null
  }

  canExecute(request: SpecialistExecutionRequest): boolean {
    // Only the two specialists Phase 2E actually wires — every other
    // specialist (including destination_strategist until its DVA
    // methodologies are supplied — see methodologyIngestion.ts) is
    // honestly EXECUTOR_UNAVAILABLE through this executor today.
    if (!WIRED_SPECIALISTS.has(request.specialist)) return false
    if (!methodologyExists(request.methodologyId, request.methodologyVersion)) return false
    if (!getMethodology(request.methodologyId, request.methodologyVersion).complete) return false
    return this.selectAdapter(request) !== null
  }

  async execute(request: SpecialistExecutionRequest): Promise<SpecialistResultEnvelope | { unavailable: true; reason: string }> {
    const adapter = this.selectAdapter(request)
    if (!adapter) {
      return { unavailable: true, reason: `no configured provider available for specialist=${request.specialist} (live web research required: ${request.specialist === 'research_verifier'})` }
    }

    const { systemPrompt, userPrompt } = request.specialist === 'research_verifier' ? buildResearchVerifierPrompt(request) : buildCheckoffEditorPrompt(request)

    let completion: { text: string }
    try {
      completion = await adapter.complete({ systemPrompt, userPrompt, requiresLiveWebResearch: request.specialist === 'research_verifier' })
    } catch (err) {
      // A provider call that genuinely fails (network error, non-2xx,
      // rate limit) is EXECUTOR_UNAVAILABLE, not a fabricated result.
      return { unavailable: true, reason: `provider call failed: ${err instanceof Error ? err.message : String(err)}` }
    }

    const parsed = parseModelEnvelope(completion.text)
    if (!parsed.ok || !parsed.envelope) {
      // The provider DID run — this is a structurally invalid result,
      // not an unavailable executor. Hand back a minimal, honestly-empty
      // envelope so the normal evidence-validation path (acceptExecutionResult)
      // rejects it as FAILED/NEEDS_MORE_EVIDENCE, with the parse failure
      // recorded as a blocker — never silently discarded.
      return {
        taskId: request.executionId,
        objective: request.objective,
        actionsPerformed: [],
        evidence: {},
        artifacts: [],
        confidence: 'LOW',
        blockers: [parsed.reason ?? 'model output could not be parsed as a valid ResultEnvelope'],
        discoveredFollowUpWork: [],
        recommendedNextAction: 'retry — model output was not valid structured JSON',
        jerryRequired: false,
        jerryReason: null,
        methodologyId: request.methodologyId,
        methodologyVersion: request.methodologyVersion,
      }
    }
    return parsed.envelope
  }
}
