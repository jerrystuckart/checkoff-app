// Saved Items V1 (2026-09-18) — unit tests for the pure logic module
// backing lib/SavedItemsContext.js. No React/RN import here, matching
// this repo's established node:test convention for pure-logic modules
// (e.g. lib/coverCandidateEligibility.test.js).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSavedIdsFromRows,
  applyOptimisticUpdate,
  shouldStartToggle,
  shouldIssueWrite,
  isBenignDuplicateInsertError,
  isDeleteConvergedToUnsaved,
  markInFlight,
  clearInFlight,
  resetState,
} from './savedItemsState.js'

test('load saved IDs: initial fetch rows populate the Set correctly', () => {
  const rows = [{ item_id: 'a' }, { item_id: 'b' }, { item_id: 'a' }]
  const ids = buildSavedIdsFromRows(rows)
  assert.ok(ids instanceof Set)
  assert.deepEqual([...ids], ['a', 'b'])
})

test('load saved IDs: empty/null rows produce an empty Set, not a crash', () => {
  assert.equal(buildSavedIdsFromRows(null).size, 0)
  assert.equal(buildSavedIdsFromRows(undefined).size, 0)
  assert.equal(buildSavedIdsFromRows([]).size, 0)
  assert.equal(buildSavedIdsFromRows([{ item_id: null }]).size, 0)
})

test('login/logout/account switch: resetState returns a fresh, empty, non-loading-stale shape', () => {
  const fresh = resetState()
  assert.equal(fresh.savedItemIds.size, 0)
  assert.equal(fresh.inFlightIds.size, 0)
  assert.equal(fresh.loading, false)
})

test('save success: optimistic update adds the id', () => {
  const before = new Set(['x'])
  const after = applyOptimisticUpdate(before, 'y', 'save')
  assert.deepEqual([...after].sort(), ['x', 'y'])
  // input Set is never mutated
  assert.deepEqual([...before], ['x'])
})

test('unsave success: optimistic update removes the id', () => {
  const before = new Set(['x', 'y'])
  const after = applyOptimisticUpdate(before, 'y', 'unsave')
  assert.deepEqual([...after], ['x'])
  assert.deepEqual([...before].sort(), ['x', 'y'])
})

test('optimistic update: Set flips synchronously/purely — a new Set reference every time', () => {
  const before = new Set()
  const after = applyOptimisticUpdate(before, 'z', 'save')
  assert.notEqual(before, after)
})

test('rollback on failure: caller re-applies the pre-toggle Set (this module never rolls back on its own — see SavedItemsContext.js\'s catch block, which sets state back to the captured `previous` value)', () => {
  const previous = new Set(['a'])
  const optimistic = applyOptimisticUpdate(previous, 'b', 'save')
  assert.deepEqual([...optimistic].sort(), ['a', 'b'])
  // Simulated rollback: the caller just re-uses `previous`, unchanged.
  assert.deepEqual([...previous], ['a'])
})

test('duplicate insert convergence: a 23505 unique-violation is treated as success, not failure', () => {
  assert.equal(isBenignDuplicateInsertError({ code: '23505' }), true)
})

test('duplicate insert convergence: an unrelated error is NOT treated as success', () => {
  assert.equal(isBenignDuplicateInsertError({ code: '42501', message: 'permission denied' }), false)
  assert.equal(isBenignDuplicateInsertError(null), false)
})

// Item Detail Corrective Pass (2026-09-18) — regression test for the real
// Detail Save bug traced to this exact function: a blanket
// `error.status === 409` branch used to also classify a genuine
// foreign_key_violation ('23503', e.g. an item_id that doesn't exist in
// `items`) as "already saved" success, because PostgREST surfaces many
// constraint violations (not just a duplicate-PK race) as HTTP 409. That
// silently skipped both the throw AND the rollback in
// SavedItemsContext.js's runMutation, leaving the optimistic "filled"
// bookmark showing with no row ever written and no error surfaced —
// exactly the reported symptom. Only '23505' (unique_violation) may ever
// be treated as benign now.
test('a 409-status error that is NOT a 23505 unique-violation (e.g. an FK violation) is NOT masked as benign', () => {
  assert.equal(isBenignDuplicateInsertError({ status: 409, code: '23503', message: 'foreign key violation' }), false)
  assert.equal(isBenignDuplicateInsertError({ status: 409 }), false)
})

test('a permission/RLS-style error (42501) is NOT masked as benign', () => {
  assert.equal(isBenignDuplicateInsertError({ code: '42501', message: 'permission denied for table saved_items' }), false)
})

test('a generic network error with no .code at all (e.g. a thrown TypeError from a fetch failure) is NOT masked as benign', () => {
  // isBenignDuplicateInsertError itself only ever sees a truthy `error`
  // object with (at most) a `.code`/`.status` — but SavedItemsContext.js's
  // runMutation catch-block is what actually has to handle a raw thrown
  // TypeError (no .code property at all, since it never reached
  // PostgREST). Confirm the classifier's own contract: absent a matching
  // '23505' code, ANY error value — including one with no `.code` field
  // whatsoever — must fall through to the real-failure path.
  assert.equal(isBenignDuplicateInsertError(new TypeError('Network request failed')), false)
  assert.equal(isBenignDuplicateInsertError({}), false)
})

test('the classifier never inspects an HTTP status at all — code is the only signal', () => {
  const fnSource = isBenignDuplicateInsertError.toString()
  assert.ok(!fnSource.includes('.status'), 'must not branch on error.status — only error.code (\'23505\') identifies a benign duplicate')
})

test('absent delete convergence: a delete result with no error is success, even if zero rows matched', () => {
  assert.equal(isDeleteConvergedToUnsaved({ error: null, count: 0 }), true)
  assert.equal(isDeleteConvergedToUnsaved({}), true)
})

test('absent delete convergence: a real delete error is NOT success', () => {
  assert.equal(isDeleteConvergedToUnsaved({ error: { message: 'network' } }), false)
})

test('prevent duplicate in-flight operations: a second toggle for the same itemId while one is pending is a no-op', () => {
  let inFlight = new Set()
  assert.equal(shouldStartToggle(inFlight, 'i1'), true)
  inFlight = markInFlight(inFlight, 'i1')
  assert.equal(shouldStartToggle(inFlight, 'i1'), false, 'a second concurrent toggle for the same item must be rejected')
  assert.equal(shouldStartToggle(inFlight, 'i2'), true, 'a different item is unaffected')
  inFlight = clearInFlight(inFlight, 'i1')
  assert.equal(shouldStartToggle(inFlight, 'i1'), true, 'once cleared, the item can be toggled again')
})

test('markInFlight/clearInFlight never mutate the input Set', () => {
  const before = new Set()
  const marked = markInFlight(before, 'x')
  assert.equal(before.size, 0)
  assert.equal(marked.size, 1)
  const cleared = clearInFlight(marked, 'x')
  assert.equal(marked.size, 1)
  assert.equal(cleared.size, 0)
})

test('idempotent explicit save/unsave: shouldIssueWrite skips a redundant save when already saved', () => {
  const ids = new Set(['a'])
  assert.equal(shouldIssueWrite(ids, 'a', 'save'), false)
  assert.equal(shouldIssueWrite(ids, 'b', 'save'), true)
})

test('idempotent explicit save/unsave: shouldIssueWrite skips a redundant unsave when already unsaved', () => {
  const ids = new Set(['a'])
  assert.equal(shouldIssueWrite(ids, 'b', 'unsave'), false)
  assert.equal(shouldIssueWrite(ids, 'a', 'unsave'), true)
})

test('shouldIssueWrite: force=true always issues the write, e.g. recovering from known-stale state', () => {
  const ids = new Set(['a'])
  assert.equal(shouldIssueWrite(ids, 'a', 'save', true), true)
})

test('completion independence: saved-item pure logic shares no field/function/table name with check-off logic', () => {
  const moduleSource = [
    buildSavedIdsFromRows,
    applyOptimisticUpdate,
    shouldStartToggle,
    shouldIssueWrite,
    isBenignDuplicateInsertError,
    isDeleteConvergedToUnsaved,
    markInFlight,
    clearInFlight,
    resetState,
  ].map((fn) => fn.toString()).join('\n')
  // check_ins / checkin_method / points_awarded / list_item_id are the
  // check-off data model's own vocabulary (see screens/ItemDetailScreen.jsx,
  // lib/useItems.js) — none of it appears anywhere in this pure module,
  // confirming Saved state is structurally unrelated to check-off state.
  assert.ok(!moduleSource.includes('check_ins'))
  assert.ok(!moduleSource.includes('checkin_method'))
  assert.ok(!moduleSource.includes('points_awarded'))
  assert.ok(!moduleSource.includes('list_item_id'))
})
