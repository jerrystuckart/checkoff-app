// Phase 0G — unit tests for the real Open Brain MCP transport. NO
// NETWORK ANYWHERE IN THIS FILE: every test injects a fake `fetchImpl`
// (see FetchLike from the SDK) that either simulates the actual Open
// Brain server's Streamable HTTP wire protocol (see fakeMcpFetch below —
// modeled directly on what StreamableHTTPClientTransport's client-side
// code actually sends/expects, inspected in node_modules) or simulates a
// raw transport failure (timeout/network) by throwing before any response
// is produced. This file never sets OPEN_BRAIN_MCP_URL/OPEN_BRAIN_MCP_KEY
// and never calls createOpenBrainMcpClient with a real URL — see
// openBrainMcpClientLive.ts for the one gated, read-only live test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createOpenBrainMcpClient } from './openBrainMcpClient'
import { OpenBrainUnavailableError, OpenBrainWriteFailedError, OpenBrainSourceIdentityConflictError } from './errors'

const TEST_URL = 'https://example.invalid/functions/v1/open-brain-mcp'
const TEST_KEY = 'test-secret-key-do-not-leak-9f8e7d6c'

interface CapturedRequest {
  url: string
  method: string
  headers: Headers
  jsonrpcMethod?: string
}

interface FakeServerConfig {
  /** Returns the MCP tool result for a tools/call with this name/args. */
  toolResult?: (name: string, args: Record<string, unknown>) => { content: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: Record<string, unknown> }
  onRequest?: (req: CapturedRequest) => void
}

/**
 * Models the ACTUAL wire behavior of StreamableHTTPClientTransport talking
 * to a stateless Streamable HTTP server (confirmed against
 * node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js):
 * client sends `initialize` (POST, expects a JSON result with the id
 * echoed back), then a `notifications/initialized` notification (POST,
 * expects 202 with no body — which triggers an unawaited GET SSE probe
 * that a server not supporting it should answer 405 to), then the actual
 * `tools/call` (POST, JSON result). This is not a full MCP server — just
 * enough of the protocol to drive the real SDK client through one
 * connect->call->close cycle without a network socket.
 */
function fakeMcpFetch(config: FakeServerConfig): FetchLike {
  return async (url, init) => {
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)

    if (method === 'GET') {
      config.onRequest?.({ url: url.toString(), method, headers })
      return new Response(null, { status: 405 })
    }

    const bodyText = typeof init?.body === 'string' ? init.body : ''
    const message = bodyText ? JSON.parse(bodyText) : undefined
    config.onRequest?.({ url: url.toString(), method, headers, jsonrpcMethod: message?.method })

    if (!message) return new Response(null, { status: 400 })

    if (message.method === 'initialize') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'open-brain', version: '1.0.0' } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (message.method === 'notifications/initialized') {
      return new Response(null, { status: 202 })
    }

    if (message.method === 'tools/call') {
      const { name, arguments: args } = message.params as { name: string; arguments: Record<string, unknown> }
      const result = config.toolResult
        ? config.toolResult(name, args)
        : { content: [{ type: 'text', text: `no handler configured for tool ${name}` }], isError: true }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

// ---------------------------------------------------------------------------
// Request shaping / header auth / no secret in URL
// ---------------------------------------------------------------------------

test('createThought: sends x-brain-key header, never Authorization, never a key= query param', async () => {
  const requests: CapturedRequest[] = []
  const fetchImpl = fakeMcpFetch({
    onRequest: (r) => requests.push(r),
    toolResult: (name, args) => ({
      content: [{ type: 'text', text: 'Captured' }],
      structuredContent: { id: 'thought-1', created: true, source_system: args.source_system, source_identity: args.source_identity },
    }),
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  await client.createThought('some content', 'CheckOff Chief', 'agent_decision:abc')

  assert.ok(requests.length > 0, 'expected at least one request')
  for (const req of requests) {
    assert.ok(!req.url.includes(TEST_KEY), `request URL must never contain the key: ${req.url}`)
    assert.ok(!req.url.includes('key='), `request URL must never contain a key= query param: ${req.url}`)
  }
  const postRequests = requests.filter((r) => r.method === 'POST')
  assert.ok(postRequests.length > 0)
  for (const req of postRequests) {
    assert.equal(req.headers.get('x-brain-key'), TEST_KEY, 'every POST must carry the exact key in the x-brain-key header')
    assert.equal(req.headers.get('authorization'), null, 'must never send an Authorization header')
  }
})

test('createThought: request shaping — tools/call carries name "capture_thought" and the exact arguments', async () => {
  let capturedArgs: Record<string, unknown> | undefined
  const fetchImpl = fakeMcpFetch({
    toolResult: (name, args) => {
      if (name === 'capture_thought') capturedArgs = args
      return { content: [{ type: 'text', text: 'ok' }], structuredContent: { id: 'thought-2', created: true } }
    },
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  await client.createThought('the content', 'CheckOff Chief', 'agent_decision:xyz')

  assert.deepEqual(capturedArgs, { content: 'the content', source_system: 'CheckOff Chief', source_identity: 'agent_decision:xyz' })
})

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

test('createThought: parses a successful structuredContent into {id, created}', async () => {
  const fetchImpl = fakeMcpFetch({
    toolResult: () => ({ content: [{ type: 'text', text: 'Captured' }], structuredContent: { id: 'thought-parsed', created: true } }),
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  const result = await client.createThought('content', 'CheckOff Chief', 'agent_decision:1')
  assert.deepEqual(result, { id: 'thought-parsed', created: true })
})

test('createThought: created=false on an idempotent replay is parsed correctly', async () => {
  const fetchImpl = fakeMcpFetch({
    toolResult: () => ({ content: [{ type: 'text', text: 'Captured (already captured)' }], structuredContent: { id: 'thought-existing', created: false } }),
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  const result = await client.createThought('content', 'CheckOff Chief', 'agent_decision:1')
  assert.deepEqual(result, { id: 'thought-existing', created: false })
})

test('createThought: missing/malformed structuredContent is a write failure, not a silent success', async () => {
  const fetchImpl = fakeMcpFetch({
    toolResult: () => ({ content: [{ type: 'text', text: 'Captured' }] }), // no structuredContent at all
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  await assert.rejects(() => client.createThought('content', 'CheckOff Chief', 'agent_decision:1'), OpenBrainWriteFailedError)
})

test('getThoughtBySource: exact lookup — found parses {id, content}', async () => {
  const fetchImpl = fakeMcpFetch({
    toolResult: (name) => {
      assert.equal(name, 'get_thought_by_source')
      return {
        content: [{ type: 'text', text: '[thought-found] ...' }],
        structuredContent: { id: 'thought-found', content: 'the exact stored content' },
      }
    },
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  const result = await client.getThoughtBySource('CheckOff Chief', 'agent_decision:known')
  assert.deepEqual(result, { id: 'thought-found', content: 'the exact stored content' })
})

test('getThoughtBySource: exact lookup — not-found text maps to null, not an error', async () => {
  const fetchImpl = fakeMcpFetch({
    toolResult: (name, args) => ({
      content: [{ type: 'text', text: `No thought found for ${args.source_system} / ${args.source_identity}.` }],
      isError: true,
    }),
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  const result = await client.getThoughtBySource('CheckOff Chief', 'agent_decision:missing')
  assert.equal(result, null)
})

test('getThoughtBySource: a non-not-found isError is a write failure, not silently treated as absent', async () => {
  const fetchImpl = fakeMcpFetch({
    toolResult: () => ({ content: [{ type: 'text', text: 'Error: connection to database lost' }], isError: true }),
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  await assert.rejects(() => client.getThoughtBySource('CheckOff Chief', 'agent_decision:x'), OpenBrainWriteFailedError)
})

// ---------------------------------------------------------------------------
// Source-identity conflict mapping (matches the REAL DB error text from
// capture_thought_idempotent — see
// /Users/jerrystuckart/supabase/migrations/20260902_fix_capture_thought_idempotent_ambiguity.sql)
// ---------------------------------------------------------------------------

test('createThought: the real capture_thought_idempotent conflict message maps to OpenBrainSourceIdentityConflictError', async () => {
  const realConflictText =
    'Failed to capture: capture_thought_idempotent: source identity CheckOff Chief/agent_decision:dupe is already recorded ' +
    '(thought id=existing-thought-1) with different content — refusing to treat this as an idempotent retry; this is a genuine ' +
    'conflict, not a duplicate capture, and the existing thought was not modified'
  const fetchImpl = fakeMcpFetch({
    toolResult: () => ({ content: [{ type: 'text', text: realConflictText }], isError: true }),
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  await assert.rejects(
    () => client.createThought('new content', 'CheckOff Chief', 'agent_decision:dupe'),
    (err: unknown) => {
      assert.ok(err instanceof OpenBrainSourceIdentityConflictError)
      assert.equal((err as OpenBrainSourceIdentityConflictError).sourceSystem, 'CheckOff Chief')
      assert.equal((err as OpenBrainSourceIdentityConflictError).sourceIdentity, 'agent_decision:dupe')
      return true
    }
  )
})

test('createThought: an unrelated capture failure is NOT misclassified as a source-identity conflict', async () => {
  const fetchImpl = fakeMcpFetch({
    toolResult: () => ({ content: [{ type: 'text', text: 'Failed to capture: OpenRouter embeddings failed: 503 upstream unavailable' }], isError: true }),
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  await assert.rejects(() => client.createThought('content', 'CheckOff Chief', 'agent_decision:x'), (err: unknown) => {
    assert.ok(err instanceof OpenBrainWriteFailedError)
    assert.ok(!(err instanceof OpenBrainSourceIdentityConflictError))
    return true
  })
})

// ---------------------------------------------------------------------------
// No blind automatic retry on capture_thought
// ---------------------------------------------------------------------------

test('createThought: never retries — a single transport failure fails the call after exactly one attempt', async () => {
  let cycles = 0
  const fetchImpl: FetchLike = async (_url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'POST') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      if (body?.method === 'initialize') cycles += 1
    }
    throw Object.assign(new Error('The operation was aborted.'), { name: 'TimeoutError' })
  }
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  await assert.rejects(() => client.createThought('content', 'CheckOff Chief', 'agent_decision:x'), OpenBrainUnavailableError)
  assert.equal(cycles, 1, 'createThought must attempt exactly one connect cycle, never retry')
})

// ---------------------------------------------------------------------------
// Timeout / network error mapping
// ---------------------------------------------------------------------------

test('timeout: an AbortSignal.timeout-style failure maps to OpenBrainUnavailableError', async () => {
  const fetchImpl: FetchLike = async () => {
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  }
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl, timeoutMs: 5 })

  await assert.rejects(() => client.createThought('c', 'CheckOff Chief', 'agent_decision:t'), OpenBrainUnavailableError)
})

test('network failure: a raw fetch failure (e.g. DNS/connection refused) maps to OpenBrainUnavailableError', async () => {
  const fetchImpl: FetchLike = async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNREFUSED') })
  }
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  await assert.rejects(() => client.createThought('c', 'CheckOff Chief', 'agent_decision:n'), OpenBrainUnavailableError)
})

test('an unexpected, non-transport error is normalized to OpenBrainWriteFailedError, not misreported as unavailable', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error('totally unexpected programming error')
  }
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  await assert.rejects(() => client.createThought('c', 'CheckOff Chief', 'agent_decision:u'), OpenBrainWriteFailedError)
})

// ---------------------------------------------------------------------------
// Bounded retry for getThoughtBySource ONLY (transient transport failures)
// ---------------------------------------------------------------------------

test('getThoughtBySource: retries a transient transport failure and succeeds within the bounded attempt budget', async () => {
  let cycle = 0
  const FAILING_CYCLES = 2 // fails cycles 1-2, succeeds on cycle 3 (within the 3-attempt budget)
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') return new Response(null, { status: 405 })
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    if (body?.method === 'initialize') cycle += 1
    if (cycle <= FAILING_CYCLES) {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    }
    return fakeMcpFetch({
      toolResult: () => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: { id: 'thought-retried', content: 'body' } }),
    })(url, init)
  }
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  const result = await client.getThoughtBySource('CheckOff Chief', 'agent_decision:retry')
  assert.deepEqual(result, { id: 'thought-retried', content: 'body' })
  assert.equal(cycle, 3, 'expected exactly 3 connect cycles: 2 failures + 1 success')
})

test('getThoughtBySource: exhausting the retry budget on persistent transport failure still fails closed', async () => {
  let cycle = 0
  const fetchImpl: FetchLike = async (_url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'POST') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      if (body?.method === 'initialize') cycle += 1
    }
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
  }
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  await assert.rejects(() => client.getThoughtBySource('CheckOff Chief', 'agent_decision:persistent'), OpenBrainUnavailableError)
  assert.equal(cycle, 3, 'expected exactly 3 attempts (the full retry budget), no more')
})

test('getThoughtBySource: a well-formed not-found result is never retried', async () => {
  let calls = 0
  const fetchImpl = fakeMcpFetch({
    toolResult: (name, args) => {
      calls += 1
      return { content: [{ type: 'text', text: `No thought found for ${args.source_system} / ${args.source_identity}.` }], isError: true }
    },
  })
  const client = createOpenBrainMcpClient({ url: TEST_URL, key: TEST_KEY, fetchImpl })

  const result = await client.getThoughtBySource('CheckOff Chief', 'agent_decision:nf')
  assert.equal(result, null)
  assert.equal(calls, 1, 'a well-formed not-found response must never trigger a retry')
})
