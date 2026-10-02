import { nearestMetroWithinBoundary, resolveHomeMetro } from './metroSelection.js'

// One coherent description of "which city is Home showing, and how does that relate to where the phone is".
//
// Three different things were being mixed on Home:
//   1. the PHYSICAL metro   - the active metro whose boundary contains the live location (null when the
//      device is outside every launched metro)
//   2. the BROWSING metro   - the metro Home is currently showing (a manual Switch City pick, a link, or the
//      physical metro itself)
//   3. the LINK INTENT      - lib/explicitMetroIntent.js, a temporary request to browse a metro
// The header, the badge and the unsupported notice must all be derived from this one function so they cannot
// contradict each other. Pure, no React Native.
//
// Note on the word LOCAL: the "LOCAL" label next to the streak on Home is the user's points TIER
// (lib/tiers.js: Starter, Explorer, Local, Insider, Legend). It says nothing about geography and is not
// produced here. Geography is expressed only by `kind` and `badge` below.

export const HOME_METRO_KIND = Object.freeze({
  // Browsing the metro the phone is physically in.
  LOCAL: 'LOCAL',
  // Browsing a metro, and the phone is in a different launched metro.
  BROWSING_ELSEWHERE: 'BROWSING_ELSEWHERE',
  // Browsing a metro, and the phone is outside every launched metro.
  BROWSING_UNSUPPORTED_LOCATION: 'BROWSING_UNSUPPORTED_LOCATION',
  // Nothing is being browsed and the phone is outside every launched metro.
  UNSUPPORTED_LOCATION: 'UNSUPPORTED_LOCATION',
  // No usable live location (pending, denied, unavailable): nothing can be said about where the phone is.
  LOCATION_UNKNOWN: 'LOCATION_UNKNOWN',
})

export const BROWSING_BADGE_TEXT = 'BROWSING'

/**
 * @param {{selectedMetro: object|null, physicalMetro: object|null, hasLiveLocation: boolean}} params
 * @returns {{kind: string, headerLabel: string|null, badge: string|null, showUnsupportedNotice: boolean, browsingName: string|null}}
 */
export function deriveHomeMetroContext({ selectedMetro, physicalMetro, hasLiveLocation }) {
  const browsingName = selectedMetro?.name ? selectedMetro.name.replace(' Metro', '') : null

  if (!hasLiveLocation) {
    return { kind: HOME_METRO_KIND.LOCATION_UNKNOWN, headerLabel: browsingName, badge: null, showUnsupportedNotice: false, browsingName }
  }
  if (!physicalMetro) {
    if (!selectedMetro) {
      return { kind: HOME_METRO_KIND.UNSUPPORTED_LOCATION, headerLabel: null, badge: null, showUnsupportedNotice: true, browsingName: null }
    }
    return { kind: HOME_METRO_KIND.BROWSING_UNSUPPORTED_LOCATION, headerLabel: browsingName, badge: BROWSING_BADGE_TEXT, showUnsupportedNotice: true, browsingName }
  }
  if (!selectedMetro) {
    // Transient: inside a launched metro with nothing selected yet; reconcile adopts the physical metro.
    const name = physicalMetro.name ? physicalMetro.name.replace(' Metro', '') : null
    return { kind: HOME_METRO_KIND.LOCAL, headerLabel: name, badge: null, showUnsupportedNotice: false, browsingName: name }
  }
  if (selectedMetro.id === physicalMetro.id) {
    return { kind: HOME_METRO_KIND.LOCAL, headerLabel: browsingName, badge: null, showUnsupportedNotice: false, browsingName }
  }
  return { kind: HOME_METRO_KIND.BROWSING_ELSEWHERE, headerLabel: browsingName, badge: BROWSING_BADGE_TEXT, showUnsupportedNotice: false, browsingName }
}

/**
 * What Home should do about its selected metro when the live location or the link intent changes. Pure
 * decision; HomeScreen applies it.
 *
 *   - an active link intent always wins and is never replaced by location (exact item/list/metro links)
 *   - otherwise, when the physical metro CHANGED since the last look and there is one, adopt it (returning to
 *     Phoenix recognises Phoenix without a relaunch or a link)
 *   - otherwise, when a link-derived selection has just lost its intent (expired), re-resolve from the
 *     persisted manual choice / physical metro instead of leaving the link's metro as the Home metro
 *   - otherwise leave the selection alone (a manual pick stays a browsing choice)
 *
 * @returns {{action: 'keep'|'adopt-physical'|'re-resolve', metro?: object}}
 */
export function planHomeMetroReconcile({ activeIntent, selectedMetro, selectedFromLink, physicalMetro, physicalChanged }) {
  if (activeIntent) return { action: 'keep' }
  if (physicalMetro && physicalChanged && (!selectedMetro || physicalMetro.id !== selectedMetro.id)) {
    return { action: 'adopt-physical', metro: physicalMetro }
  }
  if (selectedFromLink) return { action: 're-resolve' }
  return { action: 'keep' }
}

/**
 * Full reconcile step used by HomeScreen.reconcileHomeMetro, pure so the whole state machine (location
 * ticks, warm resume, expired link intent) is testable without React Native.
 *
 * @param {object} p
 * @param {Array} p.metros  active metros
 * @param {object|null} p.selectedMetro
 * @param {boolean} p.selectedFromLink  the selected metro came from a link intent
 * @param {string|null|undefined} p.lastPhysicalMetroId  undefined = no location seen yet
 * @param {object|null} p.activeIntent  result of getActiveExplicitMetro (already expiry-checked)
 * @param {{latitude:number,longitude:number}|null} p.location
 * @param {string|null} p.persistedSlug  AsyncStorage manual choice
 * @returns {{physicalMetro: object|null, lastPhysicalMetroId: string|null|undefined, action: string,
 *   selectedMetro: object|null, selectedFromLink: boolean, needsMetroSelection: boolean, persistSlug: string|null}}
 */
export function reconcileHomeMetroState({ metros, selectedMetro, selectedFromLink, lastPhysicalMetroId, activeIntent, location, persistedSlug }) {
  const physicalMetro = location ? nearestMetroWithinBoundary(location, metros) : null
  const physicalId = physicalMetro?.id ?? null
  const physicalChanged = lastPhysicalMetroId !== undefined && lastPhysicalMetroId !== physicalId
  const nextLast = location ? physicalId : lastPhysicalMetroId
  const plan = planHomeMetroReconcile({ activeIntent, selectedMetro, selectedFromLink, physicalMetro, physicalChanged })
  const unchanged = { physicalMetro, lastPhysicalMetroId: nextLast, action: plan.action, selectedMetro, selectedFromLink, needsMetroSelection: false, persistSlug: null }

  if (plan.action === 'adopt-physical') {
    return { ...unchanged, selectedMetro: plan.metro, selectedFromLink: false, persistSlug: plan.metro.slug }
  }
  if (plan.action === 're-resolve') {
    const { metro } = resolveHomeMetro({ persistedSlug, metros, location, locationState: location ? 'ready' : 'unavailable' })
    if (metro) return { ...unchanged, selectedMetro: metro, selectedFromLink: false }
    return { ...unchanged, selectedMetro: null, selectedFromLink: false, needsMetroSelection: true }
  }
  return unchanged
}
