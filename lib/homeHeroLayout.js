// HomeScreen 2026 Redesign — pure hierarchy decision for the top-of-Home
// hero stack. Kept separate from any React/RN code so the actual product
// rule ("which hero wins, and what do the secondary slots become") has
// real automated test coverage independent of rendering.
//
// Rule (per product spec): destination context always wins the primary
// hero slot when present — an at-place moment inside a destination is
// folded into a compact secondary treatment underneath, never a second
// full-size hero stacked on top of the destination hero. Outside a
// destination, at-place is promoted to the primary hero. Normal state has
// no primary hero at all — Near You starts the page.
//
// Restore Destination Hero into redesigned Home (2026-09-03) — Near You
// is now ALWAYS shown beneath whatever hero(es) render above it, per the
// explicit required hierarchy for the destination + at-place case
// ("...Destination arrival hero, compact/dominant What's the Thing
// treatment, Near You, What's Good" — all four, not at-place displacing
// Near You). showAtPlaceCompact and showNearYouCompact are therefore
// independent flags, not a single mutually-exclusive secondarySlot.

/**
 * @param {object} params
 * @param {boolean} params.hasDestination  a destination arrival zone is active (nearbyZone)
 * @param {boolean} params.hasAtPlace  whatsGood.atPlaceItem is set
 * @returns {{primaryHero: 'destination'|'at_place'|'none', showAtPlaceCompact: boolean, showNearYouCompact: boolean}}
 */
export function deriveHomeHeroLayout({ hasDestination, hasAtPlace }) {
  if (hasDestination) {
    return { primaryHero: 'destination', showAtPlaceCompact: hasAtPlace, showNearYouCompact: true }
  }
  if (hasAtPlace) {
    return { primaryHero: 'at_place', showAtPlaceCompact: false, showNearYouCompact: true }
  }
  return { primaryHero: 'none', showAtPlaceCompact: false, showNearYouCompact: true }
}
