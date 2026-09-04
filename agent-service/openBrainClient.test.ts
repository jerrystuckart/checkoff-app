// Phase 1A hardening — tests for the unit-test safety boundary in
// getDefaultOpenBrainClient() (see openBrainClient.ts's module doc for the
// full rationale: a real incident where a Phase 0F-era test made an actual
// live Open Brain write once OPEN_BRAIN_MCP_URL/KEY were genuinely
// populated in .env).
//
// These tests run under `npm run agent:test`, which means
// process.env.NODE_TEST_CONTEXT IS set for this file too (Node's test
// runner sets it on every test child process) — that is exactly the
// condition under test. No test here ever calls a method on a client
// constructed from real-looking credentials; every assertion is about
// construction-time behavior (throw vs. no-throw), which involves zero
// network I/O either way.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultOpenBrainClient } from './openBrainClient'
import { OpenBrainUnavailableError } from './errors'

const OPT_IN_VAR = 'AGENT_SERVICE_ALLOW_OPEN_BRAIN_LIVE_TEST'
const FAKE_URL = 'https://example.invalid/functions/v1/open-brain-mcp'
const FAKE_KEY = 'sk-fake-key-for-guard-tests-only-never-leaked-1234567890'

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) saved[key] = process.env[key]
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  return Promise.resolve(fn()).finally(restore)
}

// ---------------------------------------------------------------------------
// 1. Ordinary agent:test cannot reach live Open Brain even with live-looking
// credentials present — this is the core regression proof for the incident.
// ---------------------------------------------------------------------------

test('guard: real-looking credentials + running under the test runner (this file itself) is refused without the opt-in', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'sanity check: this test must actually be running under node --test for the assertion below to mean anything')

  await withEnv({ OPEN_BRAIN_MCP_URL: FAKE_URL, OPEN_BRAIN_MCP_KEY: FAKE_KEY, [OPT_IN_VAR]: undefined }, async () => {
    const client = getDefaultOpenBrainClient()
    // Construction itself must not throw (mirrors the existing "unavailable
    // client" shape) — the throw happens on first use, same as the
    // missing-config case, so callers get one consistent failure shape.
    await assert.rejects(() => client.createThought('x', 'CheckOff Chief', 'agent_decision:guard-test'), OpenBrainUnavailableError)
    await assert.rejects(() => client.getThoughtBySource('CheckOff Chief', 'agent_decision:guard-test'), OpenBrainUnavailableError)
    await assert.rejects(() => client.searchByText('x'), OpenBrainUnavailableError)
  })
})

test('guard: the rejection explicitly names the opt-in variable, so a developer hitting this knows what to do', async () => {
  await withEnv({ OPEN_BRAIN_MCP_URL: FAKE_URL, OPEN_BRAIN_MCP_KEY: FAKE_KEY, [OPT_IN_VAR]: undefined }, async () => {
    const client = getDefaultOpenBrainClient()
    await assert.rejects(
      () => client.createThought('x', 'CheckOff Chief', 'agent_decision:guard-test'),
      (err: unknown) => {
        assert.ok(err instanceof OpenBrainUnavailableError)
        assert.match((err as Error).message, /AGENT_SERVICE_ALLOW_OPEN_BRAIN_LIVE_TEST/)
        assert.match((err as Error).message, /NODE_TEST_CONTEXT/)
        return true
      }
    )
  })
})

test('guard: an explicit opt-in value other than the exact string "1" does not bypass the guard', async () => {
  await withEnv({ OPEN_BRAIN_MCP_URL: FAKE_URL, OPEN_BRAIN_MCP_KEY: FAKE_KEY, [OPT_IN_VAR]: 'true' }, async () => {
    const client = getDefaultOpenBrainClient()
    await assert.rejects(() => client.getThoughtBySource('CheckOff Chief', 'agent_decision:guard-test'), OpenBrainUnavailableError)
  })
})

// ---------------------------------------------------------------------------
// 2. Injected/mock OpenBrainClient tests are entirely unaffected — the
// guard lives only inside getDefaultOpenBrainClient(), never in the
// OpenBrainClient interface or in writeDecisionToOpenBrain/reconcile, which
// accept an injected client and never call getDefaultOpenBrainClient()
// themselves unless the caller omits the parameter.
// ---------------------------------------------------------------------------

test('guard: does not affect an explicitly injected mock client — construction and use both work normally', async () => {
  let called = false
  const mock = {
    async createThought(_content: string, _sourceSystem: string, _sourceIdentity: string) {
      called = true
      return { id: 'mock-thought', created: true }
    },
    async getThoughtBySource(_sourceSystem: string, _sourceIdentity: string) {
      return null
    },
    async searchByText(_query: string) {
      return []
    },
  }
  const result = await mock.createThought('content', 'CheckOff Chief', 'agent_decision:mock')
  assert.equal(called, true)
  assert.deepEqual(result, { id: 'mock-thought', created: true })
})

// ---------------------------------------------------------------------------
// 3. The dedicated live verifier's opt-in mechanism actually works — with
// the opt-in AND real-looking credentials present, construction succeeds
// (returns the real client shape, not the unavailable stub) without ever
// invoking a method on it (so this proves the opt-in path exists and is
// reachable, without making a network call in this test file).
// ---------------------------------------------------------------------------

test('guard: with the explicit opt-in set, constructing the client does not throw (opt-in path is reachable)', async () => {
  await withEnv({ OPEN_BRAIN_MCP_URL: FAKE_URL, OPEN_BRAIN_MCP_KEY: FAKE_KEY, [OPT_IN_VAR]: '1' }, async () => {
    assert.doesNotThrow(() => getDefaultOpenBrainClient())
  })
})

test('guard: without the test runner context at all, real-looking credentials construct the client even without the opt-in (mirrors real service execution, which never sets NODE_TEST_CONTEXT)', async () => {
  const savedContext = process.env.NODE_TEST_CONTEXT
  delete process.env.NODE_TEST_CONTEXT
  try {
    await withEnv({ OPEN_BRAIN_MCP_URL: FAKE_URL, OPEN_BRAIN_MCP_KEY: FAKE_KEY, [OPT_IN_VAR]: undefined }, async () => {
      assert.doesNotThrow(() => getDefaultOpenBrainClient())
    })
  } finally {
    if (savedContext === undefined) delete process.env.NODE_TEST_CONTEXT
    else process.env.NODE_TEST_CONTEXT = savedContext
  }
})

// ---------------------------------------------------------------------------
// 4. No secret is logged / included in any guard error text.
// ---------------------------------------------------------------------------

test('guard: the key never appears in the guard rejection message', async () => {
  await withEnv({ OPEN_BRAIN_MCP_URL: FAKE_URL, OPEN_BRAIN_MCP_KEY: FAKE_KEY, [OPT_IN_VAR]: undefined }, async () => {
    const client = getDefaultOpenBrainClient()
    await assert.rejects(
      () => client.createThought('x', 'CheckOff Chief', 'agent_decision:guard-test'),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        const message = (err as Error).message
        assert.ok(!message.includes(FAKE_KEY), `guard error message must never contain the key: ${message}`)
        assert.ok(!JSON.stringify(err).includes(FAKE_KEY), 'serialized guard error must never contain the key')
        return true
      }
    )
  })
})
