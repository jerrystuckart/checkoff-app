// App invitation message + HTTPS linking pass (2026-09-19) — structural/
// source-text guard confirming the item/:id deep link resolves under both
// the checkoff:// custom scheme AND the https://getcheckoff.com universal
// prefix, following this repo's established convention (see
// lib/deepLinkItemResolverInactiveGuard.test.js, lib/itemDetailRedesign.test.js):
// no RN render harness / no live React Navigation instance exists here, so
// this is a grep-based assertion on the live App.jsx linking config source.
//
// React Navigation resolves a single config.screens path tree against
// EVERY configured `prefixes` entry — there is no per-prefix path
// duplication in this codebase (join/:invite_code, list, experience,
// c/:handle, reset-password, auth/confirm all already work this way).
// item/:id was already wired into that same shared tree in 624e549/afc1a61,
// so it already resolves under both prefixes today; these tests lock that
// in rather than changing it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(__dirname, '../App.jsx'), 'utf8')

test('linking.prefixes includes both the custom scheme and the https domain', () => {
  assert.ok(source.includes("'checkoff://'"), 'custom scheme prefix must be registered')
  assert.ok(source.includes("'https://getcheckoff.com'"), 'https domain prefix must be registered')
})

test('DeepLinkItemResolver is registered at path item/:id, once, in the single shared screens tree', () => {
  const matches = source.match(/DeepLinkItemResolver:\s*\{\s*path:\s*'item\/:id'/g) ?? []
  assert.equal(matches.length, 1, 'there must be exactly one item/:id route entry — no separate per-prefix duplicate config')
})

test('item/:id sits in the same config.screens tree as the other already-dual-prefix routes (join/list/experience/c/:handle)', () => {
  const screensBlockMatch = source.match(/screens:\s*\{[\s\S]*?JoinList:\s*'join\/:invite_code'[\s\S]*?DeepLinkItemResolver:[\s\S]*?path:\s*'item\/:id'[\s\S]*?\n\s*\},/)
  assert.ok(screensBlockMatch, 'item/:id must live in the same screens config object as the other established dual-prefix routes, not a separate/second linking config')
})

test('DeepLinkItemResolver parses id via a pass-through parse function, matching the established resolver-route pattern', () => {
  const routeMatch = source.match(/DeepLinkItemResolver:\s*\{\s*path:\s*'item\/:id',\s*parse:\s*\{\s*id:\s*\(id\)\s*=>\s*id,?\s*\},?\s*\}/)
  assert.ok(routeMatch, 'the id param must be parsed through, matching DeepLinkCreatorResolver/DeepLinkListResolver\'s established parse style')
})
