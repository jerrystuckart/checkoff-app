import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as mod from './homeHubLinks.js'

async function load() { return mod }

test('no hubs: no link, no label', async () => {
  const { deriveHubLink, HUB_LINK_KIND } = await load()
  for (const rows of [[], null, undefined, [{}], [{ id: 'a' }]]) {
    const r = deriveHubLink(rows)
    assert.equal(r.kind, HUB_LINK_KIND.NONE)
    assert.equal(r.label, null)
    assert.equal(r.hubs.length, 0)
  }
})

test('exactly one hub uses its real name', async () => {
  const { deriveHubLink, HUB_LINK_KIND } = await load()
  const r = deriveHubLink([{ id: '1', name: 'Willcox', slug: 'willcox' }])
  assert.equal(r.kind, HUB_LINK_KIND.SINGLE)
  assert.equal(r.label, 'Explore Willcox →')
})

test('duplicates collapse to one hub, still the named label', async () => {
  const { deriveHubLink, HUB_LINK_KIND } = await load()
  const r = deriveHubLink([{ id: '1', name: 'Willcox' }, { id: '1', name: 'Willcox' }])
  assert.equal(r.kind, HUB_LINK_KIND.SINGLE)
})

test('several hubs: generic label, sorted by name', async () => {
  const { deriveHubLink, HUB_LINK_KIND } = await load()
  const r = deriveHubLink([{ id: '2', name: 'Willcox' }, { id: '1', name: 'Bisbee' }])
  assert.equal(r.kind, HUB_LINK_KIND.MULTI)
  assert.equal(r.label, 'Explore destinations →')
  assert.deepEqual(r.hubs.map(h => h.name), ['Bisbee', 'Willcox'])
})

test('fetch: asks the RPC with the SELECTED metro id and nothing else', async () => {
  const { fetchDiscoveryHubs } = await load()
  const calls = []
  const sb = { rpc: async (fn, args) => { calls.push([fn, args]); return { data: [{ id: '1', name: 'Willcox' }], error: null } } }
  const hubs = await fetchDiscoveryHubs(sb, 'phoenix-id')
  assert.deepEqual(calls, [['get_metro_discovery_hubs', { p_metro_id: 'phoenix-id' }]])
  assert.equal(hubs.length, 1)
})

test('fetch: no metro means no request; errors and throws mean no hubs', async () => {
  const { fetchDiscoveryHubs } = await load()
  let called = 0
  const sb = { rpc: async () => { called++; return { data: null, error: { message: 'x' } } } }
  assert.deepEqual(await fetchDiscoveryHubs(sb, null), [])
  assert.equal(called, 0)
  assert.deepEqual(await fetchDiscoveryHubs(sb, 'm'), [])
  assert.deepEqual(await fetchDiscoveryHubs({ rpc: async () => { throw new Error('offline') } }, 'm'), [])
})
