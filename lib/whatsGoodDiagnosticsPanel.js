// ADMIN DIAGNOSTICS PANEL (Phase 1, 2026-09-23) — pure policy/formatting
// layer for the permanent, admin-only What's Good runtime diagnostics panel
// rendered by components/home/UnsupportedLocationCard.jsx. Mirrors this
// codebase's existing convention (see lib/unsupportedLocationCard.js): the
// component renders whatever this module derives, and never re-derives
// policy itself, so the gate/formatting logic stays directly unit-testable
// with plain `node --test` — there is no RN render harness in this repo.
//
// Nothing here does I/O. Every value it formats is passed in by the caller
// (components/home/UnsupportedLocationCard.jsx, via HomeScreen.jsx/
// useWhatsGood.js/whatsGoodOrchestrator.js/whatsGoodDataAdapter.js's
// already-computed diagnostics — see each module's own doc for what it
// added and why).

/**
 * The single gate for whether the diagnostics panel may render at all.
 * Extracted as its own pure function so it's testable without an RN render
 * harness, and so the component has exactly one place to check rather than
 * an inline `isAdmin === true` scattered through JSX.
 *
 * @param {boolean|null|undefined} isAdmin
 * @returns {boolean}
 */
export function shouldShowDiagnostics(isAdmin) {
  return isAdmin === true
}

/**
 * Formats the admin diagnostics payload into an ordered list of
 * {label, value} display rows — pure string formatting, no policy
 * decisions. `value` is always already a display-ready string (never a raw
 * object/number the component would need to format itself), so the
 * component stays a dumb renderer.
 *
 * @param {object} [diagnostics]
 * @param {string|null} [diagnostics.updateId]
 * @param {string|null} [diagnostics.channel]
 * @param {string|null} [diagnostics.runtimeVersion]
 * @param {string|null} [diagnostics.commitHash]  Always null today — see
 *   module doc note below; no runtime commit-hash mechanism exists in this
 *   codebase (checked app.json `extra`, eas.json, and every source file —
 *   none expose one). This is a real gap, not a display bug.
 * @param {string|null} [diagnostics.metroName]
 * @param {string|null} [diagnostics.metroId]
 * @param {{latitude:number,longitude:number}|null} [diagnostics.userLocation]
 * @param {string|null} [diagnostics.locationState]
 * @param {number|null} [diagnostics.cachedSchemaVersion]
 * @param {string|null} [diagnostics.cachedCoverageMode]
 * @param {boolean|null} [diagnostics.fromCache]
 * @param {string|null} [diagnostics.preservationReason]
 * @param {object|null} [diagnostics.adapterDiagnostics]  The adapter's
 *   `diagnostics` object (rawItemCount, coordinateEligibleLocalCount,
 *   eligibleLocalCount, homeRailExcludedCount, outOfSeasonOrNoCoordsCount,
 *   bonusDropMaskedCount, ...) — see lib/whatsGoodDataAdapter.js.
 * @param {number|null} [diagnostics.universalCount]
 * @param {string|null} [diagnostics.coverageMode]
 * @param {string[]|null} [diagnostics.selectedItemIds]
 * @returns {Array<{label: string, value: string}>}
 */
export function buildDiagnosticsRows(diagnostics = {}) {
  const d = diagnostics ?? {}
  const adapter = d.adapterDiagnostics ?? {}
  const loc = d.userLocation
  const locStr = loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number'
    ? `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`
    : 'unknown'

  return [
    { label: 'Expo update ID', value: d.updateId ?? 'none (running embedded bundle)' },
    { label: 'Expo channel', value: d.channel ?? 'unknown' },
    { label: 'Runtime version', value: d.runtimeVersion ?? 'unknown' },
    { label: 'Commit', value: d.commitHash ?? 'not exposed at runtime' },
    { label: 'Metro', value: d.metroName ? `${d.metroName} (${d.metroId ?? 'no id'})` : 'unresolved' },
    { label: 'Live location', value: locStr },
    { label: 'Location state', value: d.locationState ?? 'unknown' },
    { label: 'Cache schema version', value: d.cachedSchemaVersion != null ? String(d.cachedSchemaVersion) : 'n/a' },
    { label: 'Cached coverage mode', value: d.cachedCoverageMode ?? 'n/a' },
    { label: 'From cache', value: d.fromCache === true ? 'yes' : d.fromCache === false ? 'no' : 'unknown' },
    { label: 'Cache decision reason', value: d.preservationReason ?? 'n/a' },
    { label: 'Raw source item count', value: formatCount(adapter.rawItemCount) },
    { label: 'Active item count', value: `${formatCount(adapter.rawItemCount)} (same as raw — query already filters is_active/is_approved)` },
    { label: 'Local non-universal count', value: `${formatCount(adapter.rawItemCount)} (same as raw — query already filters is_universal=false)` },
    { label: 'Out-of-season or no-coords excluded', value: `${formatCount(adapter.outOfSeasonOrNoCoordsCount)} (combined — cannot be split further without changing the filter)` },
    { label: 'Bonus-drop masked', value: formatCount(adapter.bonusDropMaskedCount) },
    { label: 'Coordinate-eligible local count', value: formatCount(adapter.coordinateEligibleLocalCount) },
    { label: 'Eligible local count (authoritative)', value: formatCount(adapter.eligibleLocalCount) },
    { label: 'Home Rail excluded count', value: formatCount(adapter.homeRailExcludedCount) },
    { label: 'Completed items', value: 'not excluded — ranked down instead (see lib/whatsGoodSelection.js)' },
    { label: 'Universal count', value: formatCount(d.universalCount) },
    { label: 'Resulting coverage mode', value: d.coverageMode ?? 'unknown' },
    { label: 'Final selected item IDs', value: Array.isArray(d.selectedItemIds) && d.selectedItemIds.length > 0 ? d.selectedItemIds.join(', ') : 'none' },
  ]
}

function formatCount(value) {
  return typeof value === 'number' ? String(value) : 'n/a'
}
