// Chief Phase 2E — the first real REMOTE_AI_EXECUTOR. Provider details
// live entirely behind ProviderAdapter; RemoteAiExecutor itself and
// everything in executor.ts/delegation.ts/the playbooks never names a
// vendor. If no configured adapter can satisfy a request's required
// capabilities, execute() is never called — canExecute() returns false
// and runExecution() (executor.ts) records EXECUTOR_UNAVAILABLE honestly.
// Never falls back to fabricating a result.

import type { SpecialistExecutor, SpecialistExecutionRequest } from './executor'
import type { SpecialistResultEnvelope, SpecialistKey, ProviderUsageInfo } from './types'
import { buildResearchVerifierPrompt, buildCheckoffEditorPrompt, buildDestinationStrategistPrompt, buildDestinationRelationshipManagerPrompt } from './promptBuilders'
import { getMethodology, methodologyExists } from './methodologyRegistry'
import { estimateCostUsd, type TokenUsage } from './usagePricing'

// ---------------------------------------------------------------------------
// Provider PREFERENCE policy (spec section 10) — data-driven, not a
// hardcoded vendor binding. research_verifier prefers a live-web-capable,
// high-recall provider; checkoff_editor and destination_strategist keep a
// simple ordered default today (no real quality signal exists yet to
// differentiate providers on those tasks). Listing a providerKey here
// does NOT mean it's configured — qualifiedAdapters() below still filters
// to only configured, capability-qualified adapters first.
// ---------------------------------------------------------------------------

export const SPECIALIST_PROVIDER_PREFERENCE: Readonly<Partial<Record<SpecialistKey, readonly string[]>>> = Object.freeze({
  research_verifier: ['openai', 'anthropic'],
  checkoff_editor: ['openai'],
  destination_strategist: ['anthropic', 'openai'],
  destination_relationship_manager: ['anthropic', 'openai'],
})

/**
 * Specialists whose provider is a HARD requirement, not just a
 * preference — San Diego CheckOffization architecture decision (2026-09):
 * Claude Code must never be the author of final CheckOff item wording.
 * Final editorial copy is Winston's OpenAI/ChatGPT editorial provider's
 * job; Claude Code is the developer/operator, not the copywriter. Unlike
 * SPECIALIST_PROVIDER_PREFERENCE (which only orders adapters, so an
 * unlisted/deprioritized provider is still usable as a fallback), an
 * entry here REMOVES every other provider from qualifiedAdapters()
 * entirely — if the named provider isn't configured or fails, execute()
 * returns EXECUTOR_UNAVAILABLE (an honest, persisted provider error),
 * never a silent fallback to a different vendor's prose.
 */
export const SPECIALIST_EXCLUSIVE_PROVIDER: Readonly<Partial<Record<SpecialistKey, string>>> = Object.freeze({
  checkoff_editor: 'openai',
})

/**
 * Orders `adapters` by this specialist's preference list — unlisted
 * providers sort AFTER every listed one, preserving relative input order
 * among themselves.
 */
export function orderAdaptersForSpecialist(specialist: SpecialistKey, adapters: readonly ProviderAdapter[]): ProviderAdapter[] {
  const preference = SPECIALIST_PROVIDER_PREFERENCE[specialist] ?? []
  const rank = (a: ProviderAdapter): number => {
    const i = preference.indexOf(a.providerKey)
    return i === -1 ? preference.length : i
  }
  return [...adapters].sort((a, b) => rank(a) - rank(b))
}

// ---------------------------------------------------------------------------
// Provider adapter — the ONLY seam a specific vendor's API shape touches.
// ---------------------------------------------------------------------------

export interface ProviderCompletionInput {
  systemPrompt: string
  userPrompt: string
  /** Whether this call needs live web research capability — an adapter that can't do this for a given request should be excluded by capability routing before it ever reaches here. */
  requiresLiveWebResearch: boolean
  /**
   * Phase 2H — which specialist/methodology this call is for, so an
   * adapter that supports cost/quality model routing (see
   * modelRouting.ts) can pick the right pinned model. An adapter that
   * doesn't support routing (e.g. AnthropicMessagesAdapter today) is
   * free to ignore these and use its own single configured model.
   */
  specialist: string
  methodologyId: string
}

export interface ProviderCompletionResult {
  text: string
  /** The exact model id actually used for this call — required for cost estimation (usagePricing.ts keys its table by model id). Optional so a minimal/legacy adapter still type-checks; treated as "unknown model" (no cost estimate) when absent. */
  model?: string | null
  /** Real token usage as reported by the provider's own response, when available. Absent/null is expected sometimes (a provider response that omits it) — never treated as an error. */
  usage?: TokenUsage | null
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

    const json = (await response.json()) as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } }
    const text = (json.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    const usage: TokenUsage | null = json.usage
      ? {
          inputTokens: typeof json.usage.input_tokens === 'number' ? json.usage.input_tokens : null,
          outputTokens: typeof json.usage.output_tokens === 'number' ? json.usage.output_tokens : null,
          totalTokens: typeof json.usage.input_tokens === 'number' && typeof json.usage.output_tokens === 'number' ? json.usage.input_tokens + json.usage.output_tokens : null,
        }
      : null
    return { text, model: this.model, usage }
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

// Phase 2G: destination_strategist joins research_verifier/checkoff_editor
// now that its DVA-1/DVA-2/DAP methodologies are ingested and marked
// complete (methodologyRegistry.ts). canExecute()'s own
// `getMethodology(...).complete` check is what actually gates this per
// methodology/version — being "wired" here only means this executor
// knows how to BUILD a prompt for the specialist at all; a specific
// methodology (e.g. a not-yet-ingested v3) still correctly reports
// EXECUTOR_UNAVAILABLE via that completeness check.
const WIRED_SPECIALISTS = new Set(['research_verifier', 'checkoff_editor', 'destination_strategist', 'destination_relationship_manager'])

// ---------------------------------------------------------------------------
// Which (specialist, methodology) combinations actually require LIVE web
// research capability — Phase 2H, a real live proof caught destination_
// strategist NEVER receiving the web_search tool, for ANY of DVA-1/DVA-2/
// DAP, because only 'research_verifier' triggered it here. That silently
// contradicted the real ingested methodologies, which are explicit about
// this:
//   - destination/dva1: "Research Budget: 3-6 web searches, 2-3 full-page
//     fetches" (methodologies/destination/dva1/v2.md)
//   - destination/dva2: "Research Budget: 15-25 web searches, up to 8-12
//     meaningful page/document fetches" (methodologies/destination/dva2/v2.md)
//   - destination/dap: explicitly the OPPOSITE — "Do not perform new
//     research... Use only the information contained in the DVA-2 report"
//     (methodologies/destination/dap/v2.md) — DAP must NOT get live web
//     research; it is a downstream synthesis of DVA-2, not new research.
// Without real search grounding, DVA-1/DVA-2 were producing internally
// inconsistent, ungrounded numbers (e.g. a live DVA-2 proof's own report
// stated a $20,000 Champion price while the downstream DAP referenced an
// "approved DVA-2" price of $9,500 that never appeared anywhere in the
// DVA-2 artifact) — a symptom of the model confabulating a research
// process it was never actually given tools to perform.
// ---------------------------------------------------------------------------

const LIVE_WEB_RESEARCH_METHODOLOGY_IDS: ReadonlySet<string> = new Set(['metro_launch', 'destination/dva1', 'destination/dva2'])

function methodologyRequiresLiveWebResearch(request: SpecialistExecutionRequest): boolean {
  if (request.specialist === 'research_verifier') return true
  if (request.specialist === 'destination_strategist') return LIVE_WEB_RESEARCH_METHODOLOGY_IDS.has(request.methodologyId)
  return false
}

/**
 * Turns a raw ProviderCompletionResult into the envelope's ProviderUsageInfo
 * — real usage when the adapter reported it, honestly marked unavailable
 * (never a fabricated/zero cost) when it didn't. This NEVER throws or
 * blocks the execution; a provider that omits usage data just means
 * `available: false`.
 */
function buildProviderUsageInfo(providerKey: string, completion: ProviderCompletionResult): ProviderUsageInfo {
  const usage = completion.usage ?? null
  const model = completion.model ?? null
  const available = !!usage && usage.inputTokens != null && usage.outputTokens != null
  const cost = available ? estimateCostUsd(providerKey, model, usage as TokenUsage) : null
  return {
    provider: providerKey,
    model,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    costUsd: cost?.costUsd ?? null,
    pricingVersion: cost?.pricingVersion ?? null,
    available,
  }
}

export class RemoteAiExecutor implements SpecialistExecutor {
  readonly executorType = 'REMOTE_AI_EXECUTOR' as const

  /**
   * Adapters in PREFERENCE order — the first one that's both configured
   * and capability-qualified is tried first; a transient failure (network
   * error, non-2xx, rate limit) falls through to the next qualified
   * adapter automatically (spec section 19), preserving the exact same
   * methodology/objective/evidence requirements across the retry. Order
   * is entirely caller-controlled (routing.ts / the driver decides
   * preference — e.g. quality-preferred provider first) — this class
   * itself has no vendor opinion.
   */
  constructor(
    private readonly adapters: ProviderAdapter[],
    /** DI clock (tests inject a fixed value) — the SAME runtime date injected into every prompt via runtimeDateContextLine, so what the model is told matches what the driver actually stamps as executedAt. */
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  private qualifiedAdapters(request: SpecialistExecutionRequest): ProviderAdapter[] {
    const needsLiveWeb = methodologyRequiresLiveWebResearch(request)
    let qualified = this.adapters.filter((a) => a.isConfigured() && (!needsLiveWeb || a.supportsLiveWebResearch))
    const exclusiveProvider = SPECIALIST_EXCLUSIVE_PROVIDER[request.specialist]
    if (exclusiveProvider) qualified = qualified.filter((a) => a.providerKey === exclusiveProvider)
    return orderAdaptersForSpecialist(request.specialist, qualified)
  }

  canExecute(request: SpecialistExecutionRequest): boolean {
    // Only the two specialists Phase 2E/2F actually wire — every other
    // specialist (including destination_strategist until its DVA
    // methodologies are supplied — see methodologyIngestion.ts) is
    // honestly EXECUTOR_UNAVAILABLE through this executor today.
    if (!WIRED_SPECIALISTS.has(request.specialist)) return false
    if (!methodologyExists(request.methodologyId, request.methodologyVersion)) return false
    if (!getMethodology(request.methodologyId, request.methodologyVersion).complete) return false
    return this.qualifiedAdapters(request).length > 0
  }

  async execute(request: SpecialistExecutionRequest): Promise<SpecialistResultEnvelope | { unavailable: true; reason: string }> {
    const qualified = this.qualifiedAdapters(request)
    if (qualified.length === 0) {
      return { unavailable: true, reason: `no configured provider available for specialist=${request.specialist} (live web research required: ${methodologyRequiresLiveWebResearch(request)})` }
    }

    const nowIso = this.now()
    const { systemPrompt, userPrompt } =
      request.specialist === 'research_verifier'
        ? buildResearchVerifierPrompt(request, nowIso)
        : request.specialist === 'checkoff_editor'
          ? buildCheckoffEditorPrompt(request, nowIso)
          : request.specialist === 'destination_relationship_manager'
            ? buildDestinationRelationshipManagerPrompt(request, nowIso)
            : buildDestinationStrategistPrompt(request, nowIso)
    const requiresLiveWebResearch = methodologyRequiresLiveWebResearch(request)

    const failures: string[] = []
    for (const adapter of qualified) {
      let completion: ProviderCompletionResult
      try {
        completion = await adapter.complete({ systemPrompt, userPrompt, requiresLiveWebResearch, specialist: request.specialist, methodologyId: request.methodologyId })
      } catch (err) {
        // Transient/provider-side failure — record it and fall through to
        // the next qualified adapter rather than giving up immediately.
        failures.push(`${adapter.providerKey}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }

      const providerUsage = buildProviderUsageInfo(adapter.providerKey, completion)

      const parsed = parseModelEnvelope(completion.text)
      if (!parsed.ok || !parsed.envelope) {
        // The provider DID run — this is a structurally invalid result,
        // not an unavailable executor. Hand back a minimal, honestly-empty
        // envelope so the normal evidence-validation path
        // (acceptExecutionResult) rejects it as FAILED/NEEDS_MORE_EVIDENCE,
        // with the parse failure recorded as a blocker — never silently
        // discarded, and never retried against another provider (this
        // provider DID respond; retrying a structurally-bad response is a
        // job for the driver's own bounded-retry policy, not provider
        // fallback, which exists for TRANSIENT failures specifically).
        // Usage/cost is still recorded — the call cost money even though
        // its output was unusable, and that must not be lost.
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
          providerKey: adapter.providerKey,
          providerUsage,
        }
      }
      return { ...parsed.envelope, providerKey: adapter.providerKey, providerUsage }
    }

    // Every qualified adapter failed transiently.
    return { unavailable: true, reason: `all ${qualified.length} qualified provider(s) failed: ${failures.join('; ')}` }
  }
}
