// DeepLinkItemResolverScreen inactive-item safety fix — structural/source-text
// guards, following this repo's established convention (see
// lib/itemDetailRedesign.test.js): no RN render harness exists, so these are
// grep-based assertions on the live source.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(__dirname, '../screens/DeepLinkItemResolverScreen.jsx'), 'utf8')
// Strip block (/* */) and line (//) comments so assertions about what the
// live CODE does aren't tripped up by descriptive prose in the file's
// header docblock (which legitimately mentions ItemDetail/SecretReveal
// while explaining the resolver's behavior).
const codeOnlySource = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')

test('item query is scoped to the app-wide active/approved catalog filter', () => {
  assert.ok(source.includes(".eq('is_active', true)"), 'must filter on the verified is_active column, same as lib/useItems.js / HomeScreen.jsx / ListScreen.jsx / DiscoverScreen.jsx')
  assert.ok(source.includes(".eq('is_approved', true)"), 'must also filter on is_approved, matching the rest of the app\'s live-catalog queries')
})

test('missing/invalid/not-found/inactive ids all funnel into one shared "unavailable" state, no per-reason branching', () => {
  // Only one state setter should drive the unavailable UI — if per-reason
  // branches existed, we'd expect distinct setters/messages per case.
  const unavailableSetterMatches = source.match(/setUnavailable\(true\)/g) ?? []
  assert.ok(unavailableSetterMatches.length >= 2, 'the same setUnavailable(true) call must be reused for both the missing/malformed-id path and the not-found/inactive/error path')
  // No reason-specific state (e.g. distinguishing "inactive" from "not_found") should be threaded into UI text.
  assert.ok(!/unavailable(Reason|Message|Type)/i.test(source), 'must not carry a per-reason value that could let the UI (or a caller inspecting state) distinguish inactive from not-found/missing')
})

test('unavailable message text matches exactly', () => {
  assert.ok(source.includes("This experience isn't available right now."), 'unavailable message copy must be exact')
})

test('accessible return-to-Home action exists on the unavailable state', () => {
  assert.ok(source.includes('accessibilityRole="button"'), 'the return-to-Home control must declare accessibilityRole="button"')
  assert.ok(/accessibilityLabel="[^"]*Home[^"]*"/.test(source), 'the return-to-Home control must carry a clear accessibilityLabel')
  assert.ok(source.includes("navigation.replace('Home')"), 'the return-to-Home control must navigate to the app\'s Home route')
})

test('ItemDetail is only ever reached through the active/approved query result, never from the unavailable branch', () => {
  const replaceItemDetailCount = (codeOnlySource.match(/navigation\.replace\('ItemDetail'/g) ?? []).length
  assert.equal(replaceItemDetailCount, 1, 'there must be exactly one ItemDetail navigation call, gated on the active/approved query returning data')
})

test('no secret-item-specific branch is duplicated in this resolver (guard still lives solely in ItemDetailScreen.jsx)', () => {
  assert.ok(!/is_secret|isSecret|SecretReveal/.test(codeOnlySource), 'this resolver must not add its own secret-item logic — ItemDetailScreen.jsx owns that guard exclusively')
})

test('malformed UUID is rejected client-side before it can reach a raw query', () => {
  assert.ok(/UUID_RE|uuid/i.test(source), 'a UUID-shape check must exist')
  assert.ok(/UUID_RE\.test\(id\)/.test(source), 'the id must be validated against the UUID regex before the query runs')
})

test('fetch runs at most once per mount (repeated-fetch guard present)', () => {
  assert.ok(/useRef\(false\)/.test(source), 'a ref guard (mirroring this codebase\'s resolver-screen convention) must prevent duplicate fetches')
  assert.ok(/hasFetchedRef\.current/.test(source), 'the ref guard must actually gate the resolve call')
})

test('errors are caught and never surfaced raw to the UI', () => {
  assert.ok(/catch\s*\(e\)/.test(source), 'a catch block must exist around the query')
  assert.ok(!/Text[^>]*>\s*\{e(\?\.message)?\}/.test(source), 'raw error/exception text must never be rendered into the UI')
})

test('loading spinner is preserved for the pre-resolution state', () => {
  assert.ok(source.includes('ActivityIndicator'), 'the loading spinner must still render before resolution completes')
})
