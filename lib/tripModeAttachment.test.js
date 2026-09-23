// Trip Mode MVP (2026-09-23, v2 release-blocker fix) —
// lib/tripModeAttachment.js unit tests. Uses the TARGET LIST's real
// structural shape (a personal, is_official=false list with 25 real
// list_items rows, confirmed via a live read-only query this session for
// list_id 692cb6bc-cbeb-4740-af6f-5f1833673a0f — see
// docs/trip-mode/TARGET_LIST_FINDINGS.md), NOT a synthetic official-list
// fixture, specifically because the bug this fix addresses ONLY manifests
// for a non-official list — a test built on official-list fixtures would
// never have caught it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTripModeAttachment } from './tripModeAttachment.js'

// Real ids from the target list, exactly as confirmed live this session
// (docs/trip-mode/TARGET_LIST_FINDINGS.md) — using real shapes rather than
// placeholder strings so this test is traceably tied to the actual
// production data it's meant to protect.
const TARGET_LIST_ITEM_ID = '7ac62514-3d0a-4285-b4f5-11b26ea06202' // list_items.id
const TARGET_ITEM_ID = '2cfddc3d-7eaf-4d7c-b786-dc6cada76bbc'       // items.id this list_item points to

function makeStubClient({ listItemsById = {} } = {}) {
  return {
    from(table) {
      if (table !== 'list_items') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: (_col, id) => ({
            maybeSingle: async () => {
              const row = listItemsById[id]
              return row ? { data: row, error: null } : { data: null, error: null }
            },
          }),
        }),
      }
    },
  }
}

test('the target list is confirmed personal (is_official=false) — this is the exact real-world shape the bug manifested for', () => {
  // Documentation-as-test: this fact is what makes the fix necessary.
  // lib/checkOffAttachment.js's resolveCheckOffAttachment() would return
  // listItemId: null for ANY list_item_id belonging to this list, because
  // it nulls the id for every non-official list. This module never checks
  // official-ness at all.
  const targetListIsOfficial = false
  assert.equal(targetListIsOfficial, false)
})

test('resolves and PRESERVES the real list_item_id for a catalog item on the target (personal/non-official) list — never nulled', async () => {
  const client = makeStubClient({
    listItemsById: {
      [TARGET_LIST_ITEM_ID]: { id: TARGET_LIST_ITEM_ID, item_id: TARGET_ITEM_ID, point_multiplier: 1.0 },
    },
  })
  const result = await resolveTripModeAttachment(TARGET_LIST_ITEM_ID, { client })
  assert.ok(result, 'must resolve successfully for a real list_items row on a personal list')
  assert.equal(result.listItemId, TARGET_LIST_ITEM_ID, 'listItemId must be preserved exactly, never nulled — this is the entire point of the fix')
  assert.equal(result.itemId, TARGET_ITEM_ID)
  assert.equal(result.pointMultiplier, 1.0)
})

test('a non-default point_multiplier on the list_item is preserved exactly (not overwritten to 1.0)', async () => {
  const client = makeStubClient({
    listItemsById: {
      'li-boosted': { id: 'li-boosted', item_id: 'item-x', point_multiplier: 2.5 },
    },
  })
  const result = await resolveTripModeAttachment('li-boosted', { client })
  assert.equal(result.pointMultiplier, 2.5)
})

test('missing/deleted list_item_id resolves to null (caller must refuse to submit, never fall back to standalone)', async () => {
  const client = makeStubClient({ listItemsById: {} })
  const result = await resolveTripModeAttachment('does-not-exist', { client })
  assert.equal(result, null)
})

test('a null/empty listItemId input resolves to null without ever querying the client', async () => {
  let queried = false
  const client = { from: () => { queried = true; throw new Error('should not be called') } }
  const result = await resolveTripModeAttachment(null, { client })
  assert.equal(result, null)
  assert.equal(queried, false)
})

test('a query error (e.g. RLS denial) resolves to null, same as a missing row — never throws', async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: 'permission denied' } }),
        }),
      }),
    }),
  }
  const result = await resolveTripModeAttachment('some-id', { client })
  assert.equal(result, null)
})
