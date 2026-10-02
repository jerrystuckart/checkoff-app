import { nearestMetroWithinBoundary, nearestMetroByCoords } from './metroSelection.js'

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
  // Home shows the nearest launched metro automatically (nothing was chosen) because the phone is outside
  // every launched metro. Coverage for the phone itself stays unsupported.
  NEAREST_CITY_UNSUPPORTED_LOCATION: 'NEAREST_CITY_UNSUPPORTED_LOCATION',
  // Nothing is being browsed and the phone is outside every launched metro.
  UNSUPPORTED_LOCATION: 'UNSUPPORTED_LOCATION',
  // No usable live location (pending, denied, unavailable): nothing can be said about where the phone is.
  LOCATION_UNKNOWN: 'LOCATION_UNKNOWN',
})

export const BROWSING_BADGE_TEXT = 'BROWSING'
export const NEAREST_BADGE_TEXT = 'NEAREST'

/** How the selected metro came to be selected. Never inferred from the mere existence of a selection. */
export const METRO_PROVENANCE = Object.freeze({ LINK: 'link', MANUAL: 'manual', NEAREST: 'nearest', PHYSICAL: 'physical' })

/**
 * @param {{selectedMetro: object|null, physicalMetro: object|null, hasLiveLocation: boolean}} params
 * @returns {{kind: string, headerLabel: string|null, badge: string|null, showUnsupportedNotice: boolean, browsingName: string|null}}
 */
export function deriveHomeMetroContext({ selectedMetro, physicalMetro, hasLiveLocation, provenance = null }) {
  const browsingName = selectedMetro?.name ? selectedMetro.name.replace(' Metro', '') : null

  if (!hasLiveLocation) {
    return { kind: HOME_METRO_KIND.LOCATION_UNKNOWN, headerLabel: browsingName, badge: null, showUnsupportedNotice: false, browsingName }
  }
  if (!physicalMetro) {
    if (!selectedMetro) {
      return { kind: HOME_METRO_KIND.UNSUPPORTED_LOCATION, headerLabel: null, badge: null, showUnsupportedNotice: true, browsingName: null }
    }
    if (provenance === METRO_PROVENANCE.NEAREST) {
      return { kind: HOME_METRO_KIND.NEAREST_CITY_UNSUPPORTED_LOCATION, headerLabel: browsingName, badge: NEAREST_BADGE_TEXT, showUnsupportedNotice: true, browsingName }
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


const PERSISTABLE = new Set([METRO_PROVENANCE.MANUAL, METRO_PROVENANCE.NEAREST, METRO_PROVENANCE.PHYSICAL])

/**
 * One time legacy normalization. Before provenance existed the app stored only a slug, and could not tell a
 * deliberate Switch City pick from a link or an automatic choice. A stored slug WITHOUT a valid source tag is
 * legacy and is dropped (the caller removes the key); a slug with a tag is kept. A new deliberate pick is
 * always written with source 'manual', so it is never erased by this.
 * @returns {{record: {slug: string, source: string}|null, legacy: boolean}}
 */
export function normalizePersistedMetro({ slug, source } = {}) {
  if (!slug) return { record: null, legacy: false }
  if (PERSISTABLE.has(source)) return { record: { slug: String(slug).toLowerCase(), source }, legacy: false }
  return { record: null, legacy: true }
}

function findMetro(metros, ref) {
  if (!ref) return null
  const slug = (ref.slug ?? '').toLowerCase()
  return (metros ?? []).find(m => (ref.id && m.id === ref.id) || (slug && (m.slug ?? '').toLowerCase() === slug)) ?? null
}

/**
 * The single metro decision (cold launch, resume, re-resolve after a link expires).
 *   1. active link intent                         -> link
 *   2. ready location inside a launched metro     -> physical (a travel event beats an older manual pick)
 *   3. deliberate manual pick                     -> manual
 *   4. ready location outside every metro         -> nearest launched metro by distance (nearestMetroByCoords)
 *   5. no location: last known automatic choice   -> its recorded provenance
 *   6. otherwise                                  -> pending / needs_selection
 * Coverage (is the phone inside a launched metro) is NOT decided here; it stays a function of the live
 * location, so choosing the nearest metro never makes an unsupported location supported.
 * @returns {{metro: object|null, provenance: string|null, reason: string}}
 */
export function resolveMetroChoice({ metros, location, locationState, activeIntent, persisted }) {
  const linked = findMetro(metros, activeIntent)
  if (linked) return { metro: linked, provenance: METRO_PROVENANCE.LINK, reason: 'link' }

  const ready = locationState === 'ready' && location
  if (ready) {
    const physical = nearestMetroWithinBoundary(location, metros)
    if (physical) return { metro: physical, provenance: METRO_PROVENANCE.PHYSICAL, reason: 'physical' }
  }
  const saved = persisted ? findMetro(metros, { slug: persisted.slug }) : null
  if (saved && persisted.source === METRO_PROVENANCE.MANUAL) return { metro: saved, provenance: METRO_PROVENANCE.MANUAL, reason: 'manual' }
  if (ready) {
    const nearest = nearestMetroByCoords(location, metros)
    if (nearest) return { metro: nearest, provenance: METRO_PROVENANCE.NEAREST, reason: 'nearest' }
  }
  if (saved) return { metro: saved, provenance: persisted.source, reason: 'last-known' }
  if (locationState === 'pending') return { metro: null, provenance: null, reason: 'pending' }
  return { metro: null, provenance: null, reason: 'needs_selection' }
}

/**
 * Reconcile step used by HomeScreen on a location tick, a resume, a lost link intent or a closed exact link
 * flow. Pure, so the state machine is testable without React Native.
 *   - an active link intent is never replaced
 *   - a link-derived selection whose intent is gone is re-resolved immediately (never left in the header)
 *   - a manual selection stays, unless the phone arrives in a different launched metro
 *   - physical / nearest selections follow the phone: re-resolved on every fix
 * @returns {{physicalMetro: object|null, lastPhysicalMetroId: string|null|undefined, action: 'keep'|'switch'|'retag'|'none-selected',
 *   selectedMetro: object|null, provenance: string|null, needsMetroSelection: boolean, persist: {slug: string, source: string}|null}}
 */
export function reconcileHomeMetroState({ metros, selectedMetro, provenance, lastPhysicalMetroId, activeIntent, location, persisted }) {
  const physicalMetro = location ? nearestMetroWithinBoundary(location, metros) : null
  const physicalId = physicalMetro?.id ?? null
  const physicalChanged = lastPhysicalMetroId !== undefined && lastPhysicalMetroId !== physicalId
  const nextLast = location ? physicalId : lastPhysicalMetroId
  const keep = { physicalMetro, lastPhysicalMetroId: nextLast, action: 'keep', selectedMetro, provenance, needsMetroSelection: false, persist: null }

  if (activeIntent) return keep

  if (provenance === METRO_PROVENANCE.MANUAL) {
    if (physicalMetro && physicalChanged && physicalMetro.id !== selectedMetro?.id) {
      return { ...keep, action: 'switch', selectedMetro: physicalMetro, provenance: METRO_PROVENANCE.PHYSICAL, persist: { slug: physicalMetro.slug, source: METRO_PROVENANCE.PHYSICAL } }
    }
    return keep
  }

  // link (intent gone), physical, nearest, or untagged: follow the phone / saved choice.
  if (!location && provenance !== METRO_PROVENANCE.LINK && selectedMetro) return keep
  const r = resolveMetroChoice({ metros, location, locationState: location ? 'ready' : 'unavailable', activeIntent: null, persisted })
  if (!r.metro) return { ...keep, action: 'none-selected', selectedMetro: null, provenance: null, needsMetroSelection: true }
  const persist = (r.provenance === METRO_PROVENANCE.PHYSICAL || r.provenance === METRO_PROVENANCE.NEAREST) ? { slug: r.metro.slug, source: r.provenance } : null
  if (r.metro.id === selectedMetro?.id) {
    return r.provenance === provenance ? keep : { ...keep, action: 'retag', provenance: r.provenance, persist }
  }
  return { ...keep, action: 'switch', selectedMetro: r.metro, provenance: r.provenance, persist }
}
