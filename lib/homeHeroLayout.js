// HomeScreen 2026 Redesign — pure hierarchy decision for the top-of-Home
// hero stack. Kept separate from any React/RN code so the actual product
// rule ("which hero wins, and what does the secondary slot become") has
// real automated test coverage independent of rendering.
//
// Rule (per product spec): destination context always wins the primary
// hero slot when present — an at-place moment inside a destination is
// folded into a compact secondary treatment underneath, never a second
// full-size hero stacked on top of the destination hero. Outside a
// destination, at-place is promoted to the primary hero. Normal state has
// no primary hero at all — Near You starts the page.

/**
 * @param {object} params
 * @param {boolean} params.hasDestination  a destination arrival zone is active (nearbyZone)
 * @param {boolean} params.hasAtPlace  whatsGood.atPlaceItem is set
 * @returns {{primaryHero: 'destination'|'at_place'|'none', secondarySlot: 'at_place_compact'|'near_you_compact'}}
 */
export function deriveHomeHeroLayout({ hasDestination, hasAtPlace }) {
  if (hasDestination) {
    return { primaryHero: 'destination', secondarySlot: hasAtPlace ? 'at_place_compact' : 'near_you_compact' }
  }
  if (hasAtPlace) {
    return { primaryHero: 'at_place', secondarySlot: 'near_you_compact' }
  }
  return { primaryHero: 'none', secondarySlot: 'near_you_compact' }
}
