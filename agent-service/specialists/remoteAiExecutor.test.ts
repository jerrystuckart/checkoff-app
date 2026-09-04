import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AnthropicMessagesAdapter, RemoteAiExecutor, parseModelEnvelope, type ProviderAdapter, type ProviderCompletionInput, type ProviderCompletionResult } from './remoteAiExecutor'
import type { SpecialistExecutionRequest } from './executor'

function req(overrides: Partial<SpecialistExecutionRequest> = {}): SpecialistExecutionRequest {
  return {
    specialist: 'research_verifier',
    playbookKey: 'metro_launch',
    stage: 'M3_BROAD_DISCOVERY',
    objective: 'broad discovery for San Diego',
    inputs: { executionType: 'BROAD_DISCOVERY' },
    requiredEvidenceKeys: ['candidates'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: 'exec-research-1',
    projectId: 'project-san-diego',
    destinationId: null,
    metroId: 'metro-san-diego',
    allowedCapabilities: ['live_web_research'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: 'idem-research-1',
    ...overrides,
  }
}

class FakeAdapter implements ProviderAdapter {
  readonly providerKey = 'fake'
  constructor(
    public readonly supportsLiveWebResearch: boolean,
    private configured: boolean,
    private response: ProviderCompletionResult | Error = { text: '{}' }
  ) {}
  isConfigured() {
    return this.configured
  }
  async complete(_input: ProviderCompletionInput): Promise<ProviderCompletionResult> {
    if (this.response instanceof Error) throw this.response
    return this.response
  }
}

// ---------------------------------------------------------------------------
// Real Anthropic adapter — gating only, no live network call
// ---------------------------------------------------------------------------

test('AnthropicMessagesAdapter: isConfigured() is false without an API key — never assumes credentials exist', () => {
  const adapter = new AnthropicMessagesAdapter({ apiKey: undefined })
  assert.equal(adapter.isConfigured(), false)
})

test('AnthropicMessagesAdapter: isConfigured() is true once an API key is supplied', () => {
  const adapter = new AnthropicMessagesAdapter({ apiKey: 'sk-test-fake' })
  assert.equal(adapter.isConfigured(), true)
})

test('AnthropicMessagesAdapter: complete() throws rather than silently succeeding when called with no key', async () => {
  const adapter = new AnthropicMessagesAdapter({ apiKey: undefined })
  await assert.rejects(() => adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' }))
})

test('AnthropicMessagesAdapter: a real (mocked) HTTP call includes the web_search tool only when live research is required', async () => {
  let capturedBody: Record<string, unknown> | null = null
  const fakeFetch = (async (_url: unknown, init?: { body?: string }) => {
    capturedBody = JSON.parse(init!.body as string)
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }), { status: 200 })
  }) as unknown as typeof fetch

  const adapter = new AnthropicMessagesAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: true, specialist: 'research_verifier', methodologyId: 'metro_launch' })
  assert.ok(capturedBody)
  assert.ok(Array.isArray((capturedBody as { tools?: unknown[] }).tools))

  await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' })
  assert.equal((capturedBody as { tools?: unknown[] }).tools, undefined)
})

test('AnthropicMessagesAdapter: a non-2xx response throws with the response body included', async () => {
  const fakeFetch = (async () => new Response('rate limited', { status: 429 })) as typeof fetch
  const adapter = new AnthropicMessagesAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  await assert.rejects(() => adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' }), /429/)
})

// ---------------------------------------------------------------------------
// parseModelEnvelope
// ---------------------------------------------------------------------------

function validEnvelopeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    taskId: 'exec-research-1',
    objective: 'broad discovery for San Diego',
    actionsPerformed: ['searched'],
    evidence: { candidates: [] },
    artifacts: [],
    confidence: 'MEDIUM',
    blockers: [],
    discoveredFollowUpWork: [],
    recommendedNextAction: 'audit coverage',
    jerryRequired: false,
    jerryReason: null,
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    ...overrides,
  })
}

test('parseModelEnvelope: parses a well-formed JSON envelope', () => {
  const result = parseModelEnvelope(validEnvelopeJson())
  assert.equal(result.ok, true)
  assert.equal(result.envelope?.taskId, 'exec-research-1')
})

test('parseModelEnvelope: strips a markdown code fence the model added despite instructions', () => {
  const result = parseModelEnvelope('```json\n' + validEnvelopeJson() + '\n```')
  assert.equal(result.ok, true)
})

test('parseModelEnvelope: rejects non-JSON output', () => {
  const result = parseModelEnvelope('Sure! Here are some great places to check out in San Diego...')
  assert.equal(result.ok, false)
  assert.match(result.reason ?? '', /not valid JSON/)
})

test('parseModelEnvelope: rejects JSON missing a required envelope key', () => {
  const obj = JSON.parse(validEnvelopeJson())
  delete obj.evidence
  const result = parseModelEnvelope(JSON.stringify(obj))
  assert.equal(result.ok, false)
  assert.match(result.reason ?? '', /evidence/)
})

// ---------------------------------------------------------------------------
// RemoteAiExecutor — capability routing, unavailable behavior, methodology completeness
// ---------------------------------------------------------------------------

test('RemoteAiExecutor: canExecute is false with zero adapters configured', () => {
  const executor = new RemoteAiExecutor([])
  assert.equal(executor.canExecute(req()), false)
})

test('RemoteAiExecutor: canExecute is false when the only adapter cannot do live web research but research_verifier needs it', () => {
  const executor = new RemoteAiExecutor([new FakeAdapter(false, true)])
  assert.equal(executor.canExecute(req()), false)
})

test('RemoteAiExecutor: canExecute is true once a configured, web-research-capable adapter exists for research_verifier', () => {
  const executor = new RemoteAiExecutor([new FakeAdapter(true, true)])
  assert.equal(executor.canExecute(req()), true)
})

test('RemoteAiExecutor: checkoff_editor does not require live web research capability from the adapter', () => {
  const executor = new RemoteAiExecutor([new FakeAdapter(false, true)])
  const editorReq = req({ specialist: 'checkoff_editor', methodologyId: 'checkoff_editor', methodologyVersion: 'v1', requiredEvidenceKeys: ['factualSource', 'checkoffizedItem'], authorityOperations: ['metro_launch.build_internal_artifact'] })
  assert.equal(executor.canExecute(editorReq), true)
})

test('RemoteAiExecutor: canExecute is false for destination_strategist against v1 (still gate-semantics-only, superseded)', () => {
  const executor = new RemoteAiExecutor([new FakeAdapter(true, true)])
  const dvaReq = req({ specialist: 'destination_strategist', methodologyId: 'destination/dva1', methodologyVersion: 'v1', authorityOperations: ['destination_hub.dva1_screen'] })
  assert.equal(executor.canExecute(dvaReq), false)
})

test('RemoteAiExecutor: canExecute is TRUE for destination_strategist against v2 (Phase 2G — real ingested methodology, complete) once a provider is configured', () => {
  const executor = new RemoteAiExecutor([new FakeAdapter(true, true)])
  const dvaReq = req({ specialist: 'destination_strategist', methodologyId: 'destination/dva1', methodologyVersion: 'v2', authorityOperations: ['destination_hub.dva1_screen'] })
  assert.equal(executor.canExecute(dvaReq), true)
})

test('RemoteAiExecutor: canExecute is false for destination_strategist/v2 with NO configured provider — methodology-ready is not the same as executor-ready', () => {
  const executor = new RemoteAiExecutor([])
  const dvaReq = req({ specialist: 'destination_strategist', methodologyId: 'destination/dva1', methodologyVersion: 'v2', authorityOperations: ['destination_hub.dva1_screen'] })
  assert.equal(executor.canExecute(dvaReq), false)
})

test('RemoteAiExecutor: canExecute is TRUE for destination_relationship_manager against destination_commercial/v1 once a provider is configured', () => {
  const executor = new RemoteAiExecutor([new FakeAdapter(true, true)])
  const relReq = req({ specialist: 'destination_relationship_manager', methodologyId: 'destination_commercial', methodologyVersion: 'v1', authorityOperations: ['destination_relationship.draft_outreach'] })
  assert.equal(executor.canExecute(relReq), true)
})

test('RemoteAiExecutor: destination_relationship_manager draft output flows through into evidence.artifact.draft', async () => {
  const executor = new RemoteAiExecutor([new FakeAdapter(true, true, { text: validEnvelopeJson({ methodologyId: 'destination_commercial', methodologyVersion: 'v1', evidence: { artifact: { draft: { subject: 'Hi Hood River', bodyText: 'Personalized copy', channel: 'email' } } } }) })])
  const relReq = req({ specialist: 'destination_relationship_manager', methodologyId: 'destination_commercial', methodologyVersion: 'v1', authorityOperations: ['destination_relationship.draft_outreach'] })
  const outcome = await executor.execute(relReq)
  assert.ok(!('unavailable' in outcome))
  if (!('unavailable' in outcome)) {
    const artifact = outcome.evidence.artifact as { draft: { subject: string } }
    assert.equal(artifact.draft.subject, 'Hi Hood River')
  }
})

test('RemoteAiExecutor: execute() returns unavailable, never a fabricated result, when the provider call itself fails', async () => {
  const executor = new RemoteAiExecutor([new FakeAdapter(true, true, new Error('network unreachable'))])
  const outcome = await executor.execute(req())
  assert.ok('unavailable' in outcome && outcome.unavailable)
})

test('RemoteAiExecutor: execute() with a valid model response returns a matching envelope', async () => {
  const executor = new RemoteAiExecutor([new FakeAdapter(true, true, { text: validEnvelopeJson({ evidence: { candidates: [{ name: 'x' }] } }) })])
  const outcome = await executor.execute(req())
  assert.ok(!('unavailable' in outcome))
  if (!('unavailable' in outcome)) {
    assert.equal(outcome.taskId, 'exec-research-1')
    assert.deepEqual(outcome.evidence, { candidates: [{ name: 'x' }] })
  }
})

test('RemoteAiExecutor: execute() with malformed model output returns a structurally valid but empty-evidence envelope carrying the parse failure as a blocker — never EXECUTOR_UNAVAILABLE for a provider that DID respond', async () => {
  const executor = new RemoteAiExecutor([new FakeAdapter(true, true, { text: 'not json at all' })])
  const outcome = await executor.execute(req())
  assert.ok(!('unavailable' in outcome))
  if (!('unavailable' in outcome)) {
    assert.equal(Object.keys(outcome.evidence).length, 0)
    assert.ok(outcome.blockers.length > 0)
  }
})

// ---------------------------------------------------------------------------
// Provider fallback + providerKey attribution (Phase 2F, spec section 19)
// ---------------------------------------------------------------------------

test('RemoteAiExecutor: a transient failure on the FIRST qualified provider falls through to the SECOND, preserving the same request', async () => {
  const failing = new FakeAdapter(true, true, new Error('503 upstream overloaded'))
  const succeeding = new FakeAdapter(true, true, { text: validEnvelopeJson() })
  const executor = new RemoteAiExecutor([failing, succeeding])
  const outcome = await executor.execute(req())
  assert.ok(!('unavailable' in outcome))
  if (!('unavailable' in outcome)) {
    assert.equal(outcome.taskId, 'exec-research-1') // same request preserved across the fallback
  }
})

test('RemoteAiExecutor: records which provider actually produced the accepted result', async () => {
  const openai = new FakeAdapter(true, true, { text: validEnvelopeJson() })
  Object.defineProperty(openai, 'providerKey', { value: 'openai' })
  const executor = new RemoteAiExecutor([openai])
  const outcome = await executor.execute(req())
  assert.ok(!('unavailable' in outcome))
  if (!('unavailable' in outcome)) {
    assert.equal(outcome.providerKey, 'openai')
  }
})

test('RemoteAiExecutor: unavailable ONLY once every qualified provider has failed transiently, and the reason names each', async () => {
  const a = new FakeAdapter(true, true, new Error('network unreachable'))
  Object.defineProperty(a, 'providerKey', { value: 'anthropic' })
  const b = new FakeAdapter(true, true, new Error('rate limited'))
  Object.defineProperty(b, 'providerKey', { value: 'openai' })
  const executor = new RemoteAiExecutor([a, b])
  const outcome = await executor.execute(req())
  assert.ok('unavailable' in outcome && outcome.unavailable)
  if ('unavailable' in outcome) {
    assert.match(outcome.reason, /anthropic/)
    assert.match(outcome.reason, /openai/)
  }
})

test('RemoteAiExecutor: an unconfigured provider never counts as a fallback attempt — only configured, capable ones are tried', async () => {
  const unconfigured = new FakeAdapter(true, false)
  const configured = new FakeAdapter(true, true, { text: validEnvelopeJson() })
  const executor = new RemoteAiExecutor([unconfigured, configured])
  const outcome = await executor.execute(req())
  assert.ok(!('unavailable' in outcome))
})

// ---------------------------------------------------------------------------
// requiresLiveWebResearch routing per (specialist, methodology) — Phase 2H.
// A real live DVA-2/DAP proof caught destination_strategist NEVER
// receiving the web_search tool for ANY methodology, contradicting the
// real ingested DVA-1/DVA-2 research-budget requirements (destination/dap
// is the deliberate exception — it must NOT get new research, per its own
// methodology text).
// ---------------------------------------------------------------------------

class CapturingAdapter implements ProviderAdapter {
  readonly providerKey = 'capturing'
  readonly supportsLiveWebResearch = true
  capturedRequiresLiveWebResearch: boolean | null = null
  isConfigured() {
    return true
  }
  async complete(input: ProviderCompletionInput): Promise<ProviderCompletionResult> {
    this.capturedRequiresLiveWebResearch = input.requiresLiveWebResearch
    return { text: validEnvelopeJson({ methodologyId: 'destination/dva1', methodologyVersion: 'v2' }) }
  }
}

test('RemoteAiExecutor: research_verifier requires live web research', async () => {
  const adapter = new CapturingAdapter()
  const executor = new RemoteAiExecutor([adapter])
  await executor.execute(req())
  assert.equal(adapter.capturedRequiresLiveWebResearch, true)
})

test('RemoteAiExecutor: destination_strategist + destination/dva1 requires live web research (methodology names a 3-6 search budget)', async () => {
  const adapter = new CapturingAdapter()
  const executor = new RemoteAiExecutor([adapter])
  await executor.execute(req({ specialist: 'destination_strategist', methodologyId: 'destination/dva1', methodologyVersion: 'v2', stage: 'D2_DVA1', authorityOperations: ['destination_hub.dva1_screen'] }))
  assert.equal(adapter.capturedRequiresLiveWebResearch, true)
})

test('RemoteAiExecutor: destination_strategist + destination/dva2 requires live web research (methodology names a 15-25 search budget)', async () => {
  const adapter = new CapturingAdapter()
  const executor = new RemoteAiExecutor([adapter])
  await executor.execute(req({ specialist: 'destination_strategist', methodologyId: 'destination/dva2', methodologyVersion: 'v2', stage: 'D3_DVA2', authorityOperations: ['destination_hub.draft_dva2'] }))
  assert.equal(adapter.capturedRequiresLiveWebResearch, true)
})

test('RemoteAiExecutor: destination_strategist + destination/dap does NOT request live web research — its own methodology forbids new research', async () => {
  const adapter = new CapturingAdapter()
  const executor = new RemoteAiExecutor([adapter])
  await executor.execute(req({ specialist: 'destination_strategist', methodologyId: 'destination/dap', methodologyVersion: 'v2', stage: 'D4_DAP', authorityOperations: ['destination_hub.draft_dap'] }))
  assert.equal(adapter.capturedRequiresLiveWebResearch, false)
})

test('RemoteAiExecutor: checkoff_editor does not request live web research', async () => {
  const adapter = new CapturingAdapter()
  const executor = new RemoteAiExecutor([adapter])
  await executor.execute(req({ specialist: 'checkoff_editor', methodologyId: 'checkoff_editor', methodologyVersion: 'v1', authorityOperations: [] }))
  assert.equal(adapter.capturedRequiresLiveWebResearch, false)
})

test('RemoteAiExecutor: destination_relationship_manager does not request live web research — it drafts from context it is already given', async () => {
  const adapter = new CapturingAdapter()
  const executor = new RemoteAiExecutor([adapter])
  await executor.execute(req({ specialist: 'destination_relationship_manager', methodologyId: 'destination_commercial', methodologyVersion: 'v1', authorityOperations: ['destination_relationship.draft_outreach'] }))
  assert.equal(adapter.capturedRequiresLiveWebResearch, false)
})

// ---------------------------------------------------------------------------
// Real usage/cost capture — production-integrity pass. RemoteAiExecutor
// must turn whatever usage an adapter reports into a real providerUsage
// on the envelope (available/costed), and honestly mark it unavailable
// (never $0) when the adapter didn't report usage.
// ---------------------------------------------------------------------------

test('RemoteAiExecutor: attaches real providerUsage (tokens + estimated cost) to the accepted envelope when the adapter reports usage', async () => {
  const adapter = new FakeAdapter(true, true, { text: validEnvelopeJson(), model: 'gpt-4.1', usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 } })
  Object.defineProperty(adapter, 'providerKey', { value: 'openai' })
  const executor = new RemoteAiExecutor([adapter])
  const outcome = await executor.execute(req())
  assert.ok(!('unavailable' in outcome))
  if (!('unavailable' in outcome)) {
    assert.ok(outcome.providerUsage)
    assert.equal(outcome.providerUsage?.available, true)
    assert.equal(outcome.providerUsage?.provider, 'openai')
    assert.equal(outcome.providerUsage?.model, 'gpt-4.1')
    assert.equal(outcome.providerUsage?.inputTokens, 1000)
    assert.equal(outcome.providerUsage?.outputTokens, 500)
    assert.ok(outcome.providerUsage?.costUsd !== null && (outcome.providerUsage?.costUsd as number) > 0)
  }
})

test('RemoteAiExecutor: marks providerUsage unavailable — never a fabricated $0 — when the adapter reports no usage', async () => {
  const adapter = new FakeAdapter(true, true, { text: validEnvelopeJson() })
  const executor = new RemoteAiExecutor([adapter])
  const outcome = await executor.execute(req())
  assert.ok(!('unavailable' in outcome))
  if (!('unavailable' in outcome)) {
    assert.ok(outcome.providerUsage)
    assert.equal(outcome.providerUsage?.available, false)
    assert.equal(outcome.providerUsage?.costUsd, null)
  }
})

test('RemoteAiExecutor: execution still completes successfully even when usage data is unexpectedly absent — never blocks on missing usage', async () => {
  const adapter = new FakeAdapter(true, true, { text: validEnvelopeJson(), usage: null })
  const executor = new RemoteAiExecutor([adapter])
  const outcome = await executor.execute(req())
  assert.ok(!('unavailable' in outcome))
})

test('RemoteAiExecutor: even a structurally-malformed (unparseable) provider response still carries providerUsage — the call cost money regardless of output quality', async () => {
  const adapter = new FakeAdapter(true, true, { text: 'not json at all', model: 'gpt-4.1', usage: { inputTokens: 200, outputTokens: 50, totalTokens: 250 } })
  Object.defineProperty(adapter, 'providerKey', { value: 'openai' })
  const executor = new RemoteAiExecutor([adapter])
  const outcome = await executor.execute(req())
  assert.ok(!('unavailable' in outcome))
  if (!('unavailable' in outcome)) {
    assert.equal(outcome.providerUsage?.available, true)
    assert.ok((outcome.providerUsage?.costUsd as number) > 0)
  }
})

// ---------------------------------------------------------------------------
// Runtime date injection — the SAME `now` clock RemoteAiExecutor is
// constructed with must reach the prompt (via promptBuilders.ts's
// runtimeDateContextLine), so what the model is told matches what the
// driver stamps as executedAt.
// ---------------------------------------------------------------------------

test('RemoteAiExecutor: threads its injected now() clock into the prompt sent to the adapter', async () => {
  let capturedSystemPrompt = ''
  const capturingAdapter: ProviderAdapter = {
    providerKey: 'openai',
    supportsLiveWebResearch: true,
    isConfigured: () => true,
    complete: async (input) => {
      capturedSystemPrompt = input.systemPrompt
      return { text: validEnvelopeJson() }
    },
  }
  const FIXED_NOW = '2026-09-08T12:00:00.000Z'
  const executor = new RemoteAiExecutor([capturingAdapter], () => FIXED_NOW)
  await executor.execute(req())
  assert.match(capturedSystemPrompt, new RegExp(FIXED_NOW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})
