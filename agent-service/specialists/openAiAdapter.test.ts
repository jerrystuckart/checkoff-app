import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OpenAiAdapter, resolveRetryDelayMs, DEFAULT_MAX_RATE_LIMIT_RETRIES } from './openAiAdapter'

test('OpenAiAdapter: isConfigured() is false without an API key', () => {
  const adapter = new OpenAiAdapter({ apiKey: undefined })
  assert.equal(adapter.isConfigured(), false)
})

test('OpenAiAdapter: isConfigured() is true once an API key is supplied', () => {
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake' })
  assert.equal(adapter.isConfigured(), true)
})

test('OpenAiAdapter: complete() throws rather than silently succeeding with no key', async () => {
  const adapter = new OpenAiAdapter({ apiKey: undefined })
  await assert.rejects(() => adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' }))
})

test('OpenAiAdapter: honestly refuses a live-research request when configured as not web-capable — never answers from memory instead', async () => {
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', supportsLiveWebResearch: false })
  await assert.rejects(() => adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: true, specialist: 'research_verifier', methodologyId: 'metro_launch' }), /does NOT support live web research/)
})

test('OpenAiAdapter: a mocked successful call includes the web_search tool only when live research is required', async () => {
  const captured: { body: { tools?: unknown[] } | undefined } = { body: undefined }
  const fakeFetch = (async (_url: unknown, init?: { body?: string }) => {
    captured.body = JSON.parse(init!.body as string)
    return new Response(JSON.stringify({ output_text: '{"ok":true}' }), { status: 200 })
  }) as unknown as typeof fetch

  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: true, specialist: 'research_verifier', methodologyId: 'metro_launch' })
  assert.equal(result.text, '{"ok":true}')
  assert.ok(Array.isArray(captured.body?.tools))

  await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' })
  assert.equal(captured.body?.tools, undefined)
})

test('OpenAiAdapter: falls back to walking output[].content[] when output_text is absent', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'from output array' }] }] }), { status: 200 })) as unknown as typeof fetch
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' })
  assert.equal(result.text, 'from output array')
})

test('OpenAiAdapter: modelFor() routes per-call via modelRouting.ts when no explicit model override is set at construction', () => {
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake' })
  assert.equal(adapter.modelFor('research_verifier', 'metro_launch'), 'gpt-4.1')
  assert.equal(adapter.modelFor('checkoff_editor', 'checkoff_editor'), 'gpt-4.1')
  assert.equal(adapter.modelFor('destination_strategist', 'destination/dva1'), 'gpt-4.1')
})

test('OpenAiAdapter: an explicit constructor model option is a hard override that bypasses routing for every call', () => {
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', model: 'gpt-4.1-pinned-for-tests' })
  assert.equal(adapter.modelFor('research_verifier', 'metro_launch'), 'gpt-4.1-pinned-for-tests')
  assert.equal(adapter.modelFor('checkoff_editor', 'checkoff_editor'), 'gpt-4.1-pinned-for-tests')
})

test('OpenAiAdapter: complete() sends the routed model in the request body', async () => {
  let capturedBody: { model?: string } | undefined
  const fakeFetch = (async (_url: unknown, init?: { body?: string }) => {
    capturedBody = JSON.parse(init!.body as string)
    return new Response(JSON.stringify({ output_text: '{"ok":true}' }), { status: 200 })
  }) as unknown as typeof fetch
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'checkoff_editor', methodologyId: 'checkoff_editor' })
  assert.equal(capturedBody?.model, 'gpt-4.1')
})

test('OpenAiAdapter: a non-2xx, non-429 response throws immediately with the response body included — never retried', async () => {
  let calls = 0
  const fakeFetch = (async () => {
    calls += 1
    return new Response('bad request', { status: 400 })
  }) as unknown as typeof fetch
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  await assert.rejects(() => adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' }), /400/)
  assert.equal(calls, 1, 'a real error (not a rate limit) must never be retried')
})

// ---------------------------------------------------------------------------
// 429 rate-limit retry (Chief Phase 2Y — found building Vienna: fanning
// M6.5 checkoff_editor out concurrently tripped this account's real
// per-minute token budget, and the previous "throw immediately" behavior
// surfaced that as EXECUTOR_UNAVAILABLE and BLOCKED the whole run).
// sleepImpl is always faked to instant in these tests — the retry COUNT
// and DELAY CALCULATION are what's under test, not real wall-clock time.
// ---------------------------------------------------------------------------

test('OpenAiAdapter: retries a 429 and succeeds once the API stops rate-limiting, within the retry budget', async () => {
  let calls = 0
  const sleeps: number[] = []
  const fakeFetch = (async () => {
    calls += 1
    if (calls <= 2) return new Response('{"error":{"message":"Rate limit reached. Please try again in 10ms."}}', { status: 429 })
    return new Response(JSON.stringify({ output_text: 'ok after retries' }), { status: 200 })
  }) as unknown as typeof fetch
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch, sleepImpl: async (ms) => void sleeps.push(ms) })
  const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' })
  assert.equal(result.text, 'ok after retries')
  assert.equal(calls, 3, '2 rate-limited attempts + 1 successful attempt')
  assert.equal(sleeps.length, 2)
})

test('OpenAiAdapter: DEFAULT_MAX_RATE_LIMIT_RETRIES is a real, small, bounded number', () => {
  assert.equal(DEFAULT_MAX_RATE_LIMIT_RETRIES, 4)
})

test('OpenAiAdapter: a 429 that never resolves is retried exactly maxRateLimitRetries times, then throws — bounded, never an infinite retry', async () => {
  let calls = 0
  const fakeFetch = (async () => {
    calls += 1
    return new Response('{"error":{"message":"still rate limited"}}', { status: 429 })
  }) as unknown as typeof fetch
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch, sleepImpl: async () => {}, maxRateLimitRetries: 2 })
  await assert.rejects(
    () => adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' }),
    /429 after 2 retries/
  )
  assert.equal(calls, 3, '1 initial attempt + 2 retries, never a 4th call')
})

test('OpenAiAdapter: maxRateLimitRetries: 0 preserves the original "throw immediately on 429" behavior for a caller that wants it', async () => {
  let calls = 0
  const fakeFetch = (async () => {
    calls += 1
    return new Response('rate limited', { status: 429 })
  }) as unknown as typeof fetch
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch, maxRateLimitRetries: 0 })
  await assert.rejects(() => adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' }), /429/)
  assert.equal(calls, 1)
})

test('resolveRetryDelayMs: prefers a numeric retry-after header (seconds), converted to ms and capped at 30s', () => {
  assert.equal(resolveRetryDelayMs(1, '2', ''), 2000)
  assert.equal(resolveRetryDelayMs(1, '999', ''), 30000)
})

test('resolveRetryDelayMs: falls back to parsing "try again in <N>ms/s" from the error body when no header is present', () => {
  assert.equal(resolveRetryDelayMs(1, null, 'Rate limit reached. Please try again in 384ms.'), 384)
  assert.equal(resolveRetryDelayMs(1, null, 'Please try again in 2.5s.'), 2500)
})

test('resolveRetryDelayMs: falls back to exponential backoff (1s, 2s, 4s, ...) when neither header nor body gives a usable delay', () => {
  assert.equal(resolveRetryDelayMs(1, null, ''), 1000)
  assert.equal(resolveRetryDelayMs(2, null, ''), 2000)
  assert.equal(resolveRetryDelayMs(3, null, ''), 4000)
  assert.equal(resolveRetryDelayMs(10, null, ''), 30000, 'exponential backoff is still capped at 30s')
})

test('OpenAiAdapter: parses real usage.input_tokens/output_tokens/total_tokens from the Responses API and returns the model used', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ output_text: '{"ok":true}', usage: { input_tokens: 1234, output_tokens: 567, total_tokens: 1801 } }), { status: 200 })) as unknown as typeof fetch
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' })
  assert.equal(result.model, 'gpt-4.1')
  assert.deepEqual(result.usage, { inputTokens: 1234, outputTokens: 567, totalTokens: 1801 })
})

test('OpenAiAdapter: returns usage: null (never fabricated numbers) when the API response omits usage entirely', async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({ output_text: '{"ok":true}' }), { status: 200 })) as unknown as typeof fetch
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false, specialist: 'research_verifier', methodologyId: 'metro_launch' })
  assert.equal(result.usage, null)
})
