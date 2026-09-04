import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OpenAiAdapter } from './openAiAdapter'

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
  await assert.rejects(() => adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false }))
})

test('OpenAiAdapter: honestly refuses a live-research request when configured as not web-capable — never answers from memory instead', async () => {
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', supportsLiveWebResearch: false })
  await assert.rejects(() => adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: true }), /does NOT support live web research/)
})

test('OpenAiAdapter: a mocked successful call includes the web_search tool only when live research is required', async () => {
  const captured: { body: { tools?: unknown[] } | undefined } = { body: undefined }
  const fakeFetch = (async (_url: unknown, init?: { body?: string }) => {
    captured.body = JSON.parse(init!.body as string)
    return new Response(JSON.stringify({ output_text: '{"ok":true}' }), { status: 200 })
  }) as unknown as typeof fetch

  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: true })
  assert.equal(result.text, '{"ok":true}')
  assert.ok(Array.isArray(captured.body?.tools))

  await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false })
  assert.equal(captured.body?.tools, undefined)
})

test('OpenAiAdapter: falls back to walking output[].content[] when output_text is absent', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'from output array' }] }] }), { status: 200 })) as unknown as typeof fetch
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false })
  assert.equal(result.text, 'from output array')
})

test('OpenAiAdapter: a non-2xx response throws with the response body included', async () => {
  const fakeFetch = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch
  const adapter = new OpenAiAdapter({ apiKey: 'sk-test-fake', fetchImpl: fakeFetch })
  await assert.rejects(() => adapter.complete({ systemPrompt: 's', userPrompt: 'u', requiresLiveWebResearch: false }), /429/)
})
