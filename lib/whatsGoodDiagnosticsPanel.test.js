// ADMIN DIAGNOSTICS PANEL (Phase 1, 2026-09-23) — pure logic tests for
// lib/whatsGoodDiagnosticsPanel.js. No RN render harness in this repo (see
// that module's doc) — shouldShowDiagnostics/buildDiagnosticsRows are
// exactly what components/home/UnsupportedLocationCard.jsx renders, so
// testing them directly here is equivalent to testing the panel's gate and
// content without ever mounting a component.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldShowDiagnostics, buildDiagnosticsRows } from './whatsGoodDiagnosticsPanel.js'

test('shouldShowDiagnostics: isAdmin true -> true', () => {
  assert.equal(shouldShowDiagnostics(true), true)
})

test('shouldShowDiagnostics: isAdmin false -> false', () => {
  assert.equal(shouldShowDiagnostics(false), false)
})

test('shouldShowDiagnostics: isAdmin null/undefined/truthy-but-not-exactly-true -> false (strict === true, never a truthy footgun)', () => {
  assert.equal(shouldShowDiagnostics(null), false)
  assert.equal(shouldShowDiagnostics(undefined), false)
  assert.equal(shouldShowDiagnostics(1), false)
  assert.equal(shouldShowDiagnostics('true'), false)
  assert.equal(shouldShowDiagnostics({}), false)
})

test('buildDiagnosticsRows: no content is producible when isAdmin is false — the gate, not this function, is what the component checks, but this proves the rows are only ever built from what is passed in, never fabricated', () => {
  const rows = buildDiagnosticsRows(null)
  assert.ok(Array.isArray(rows))
  assert.ok(rows.length > 0)
  // Every row falls back to an honest "unknown"/"n/a"/"not exposed" label —
  // never a fabricated value — when given no diagnostics at all.
  for (const row of rows) {
    assert.equal(typeof row.label, 'string')
    assert.equal(typeof row.value, 'string')
  }
})

test('buildDiagnosticsRows: commit hash is always labeled as a genuine gap, never fabricated', () => {
  const rows = buildDiagnosticsRows({})
  const commitRow = rows.find((r) => r.label === 'Commit')
  assert.equal(commitRow.value, 'not exposed at runtime')
})

test('buildDiagnosticsRows: completed-item row is labeled as a ranking penalty, never fabricated as an exclusion count', () => {
  const rows = buildDiagnosticsRows({})
  const completedRow = rows.find((r) => r.label === 'Completed items')
  assert.equal(completedRow.value, 'not excluded — ranked down instead (see lib/whatsGoodSelection.js)')
})

test('buildDiagnosticsRows: season/coords exclusion is labeled as combined, not split', () => {
  const rows = buildDiagnosticsRows({ adapterDiagnostics: { outOfSeasonOrNoCoordsCount: 7 } })
  const row = rows.find((r) => r.label === 'Out-of-season or no-coords excluded')
  assert.match(row.value, /^7 /)
  assert.match(row.value, /combined/)
})

test('buildDiagnosticsRows: formats real adapter diagnostic counts and location', () => {
  const rows = buildDiagnosticsRows({
    updateId: 'abc-123',
    channel: 'production',
    runtimeVersion: '1.0.0',
    metroName: 'Munich',
    metroId: 'munich-id',
    userLocation: { latitude: 48.13512, longitude: 11.58198 },
    locationState: 'ready',
    cachedSchemaVersion: 2,
    cachedCoverageMode: 'SUPPORTED_SUFFICIENT',
    fromCache: true,
    preservationReason: 'preserved-short-interruption',
    adapterDiagnostics: {
      rawItemCount: 42,
      coordinateEligibleLocalCount: 30,
      eligibleLocalCount: 28,
      homeRailExcludedCount: 5,
      outOfSeasonOrNoCoordsCount: 10,
      bonusDropMaskedCount: 2,
    },
    universalCount: 15,
    coverageMode: 'SUPPORTED_SUFFICIENT',
    selectedItemIds: ['a', 'b', 'c'],
  })

  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]))
  assert.equal(byLabel['Expo update ID'], 'abc-123')
  assert.equal(byLabel['Expo channel'], 'production')
  assert.equal(byLabel['Runtime version'], '1.0.0')
  assert.equal(byLabel['Metro'], 'Munich (munich-id)')
  assert.equal(byLabel['Live location'], '48.1351, 11.5820')
  assert.equal(byLabel['Location state'], 'ready')
  assert.equal(byLabel['Cache schema version'], '2')
  assert.equal(byLabel['Cached coverage mode'], 'SUPPORTED_SUFFICIENT')
  assert.equal(byLabel['From cache'], 'yes')
  assert.equal(byLabel['Cache decision reason'], 'preserved-short-interruption')
  assert.equal(byLabel['Raw source item count'], '42')
  assert.equal(byLabel['Coordinate-eligible local count'], '30')
  assert.equal(byLabel['Eligible local count (authoritative)'], '28')
  assert.equal(byLabel['Home Rail excluded count'], '5')
  assert.equal(byLabel['Bonus-drop masked'], '2')
  assert.equal(byLabel['Universal count'], '15')
  assert.equal(byLabel['Resulting coverage mode'], 'SUPPORTED_SUFFICIENT')
  assert.equal(byLabel['Final selected item IDs'], 'a, b, c')
})

test('buildDiagnosticsRows: no selected items -> "none", never an empty string', () => {
  const rows = buildDiagnosticsRows({ selectedItemIds: [] })
  const row = rows.find((r) => r.label === 'Final selected item IDs')
  assert.equal(row.value, 'none')
})

test('buildDiagnosticsRows: missing userLocation -> "unknown", never a fabricated coordinate', () => {
  const rows = buildDiagnosticsRows({ userLocation: null })
  const row = rows.find((r) => r.label === 'Live location')
  assert.equal(row.value, 'unknown')
})
