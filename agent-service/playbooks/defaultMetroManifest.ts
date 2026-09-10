// agent-service/playbooks/defaultMetroManifest.ts
//
// Chief Phase 2AH root-cause fix (2026-09-10, Green Bay contamination
// incident). Before this file existed, agent-service/cli.ts's `run
// metro_launch` command defaulted BOTH --category-plan and
// --geo-depth-plan to San Diego's own manifest
// (agent-service/playbooks/sanDiegoManifest.ts) whenever a caller didn't
// supply one explicitly — which is exactly what happened building
// green_bay_wisconsin. SAN_DIEGO_GEOGRAPHIC_DEPTH_TARGETS hardcodes
// literal OTHER-metro neighborhood names (Carlsbad, Oceanside, Chula
// Vista, Coronado) as "meaningful depth" floors; metroLaunchDriver.ts's
// M5 targeted-gap-research stage turns an unmet depth target directly
// into a live OpenAI web-research objective ("<project>: targeted
// research for GEOGRAPHIC_BELOW_MINIMUM Carlsbad ...") — so the model
// went and found REAL Carlsbad/Chula Vista venues for a Green Bay
// project, because that's literally what it was asked to do. Those
// venues then passed every other existing gate (none of them check a
// candidate's real-world geography against the target metro at all) and
// shipped into the generated production SQL patch.
//
// This module is the fix for requirement 1-2 of that incident (see
// outOfMarketContamination.ts for the independent, second-layer
// defense-in-depth check — requirement 4):
//
//   1. San Diego's manifest is no longer an implicit default for ANY
//      other metro. sanDiegoManifest.ts's exports are untouched and
//      still used verbatim, but ONLY when the metro actually being built
//      IS San Diego (see cli.ts's isFrozenSanDiegoProject check) —
//      requirement 6, "preserve San Diego's historical/frozen behavior
//      where needed, but only when the target metro is actually San
//      Diego."
//   2. For every other metro, geographic depth targets are generated
//      automatically FROM THE REAL, ALREADY-RESEARCHED M1 GEOGRAPHY —
//      never a hardcoded list of some other city's neighborhoods, and
//      never fabricated ahead of time. deriveDefaultDepthTargets() below
//      is called from metroLaunchDriver.ts's stepM2 with the REAL
//      NeighborhoodDefinition[] that stepM1 just produced for THIS
//      metro's own confirmed geography — by construction, this can never
//      inject another metro's place names, because it never reads
//      anything except the current run's own M1 output.
//   3. The category coverage plan (DEFAULT_CATEGORY_COVERAGE_PLAN below)
//      is metro-agnostic already at the data level — CategoryCoveragePlan
//      targets are generic category names ("Food & drink", "Shopping",
//      "Nightlife", ...) with count minimums, not place names — so unlike
//      the geographic depth targets, reusing this shape for any metro was
//      never the actual contamination vector. It is still given its own
//      file/export (rather than continuing to import SAN_DIEGO_CATEGORY_PLAN
//      as a generic default) so a future reader never has to reason about
//      whether "San Diego" in the name carries any San-Diego-specific
//      assumption — it doesn't, but the name implied it might.

import type { CategoryCoveragePlan, GeographicDepthTarget, NeighborhoodDefinition, NeighborhoodKind } from './metroLaunch'

/**
 * Generic, metro-agnostic starting category coverage plan. Same category
 * taxonomy and minimums as SAN_DIEGO_CATEGORY_PLAN (that shape was never
 * San-Diego-specific — only the qualityNotes text was), with the
 * San Diego-flavored qualityNotes replaced by generic guidance. A future
 * metro-specific tuning pass (M2 already accepts an explicit
 * --category-plan override) should adjust minimums for a metro's real
 * character (e.g. a much smaller single-market metro needs
 * proportionally smaller minimums) — this is a reasonable, safe DEFAULT
 * starting point, never a metro-specific final answer.
 */
export const DEFAULT_CATEGORY_COVERAGE_PLAN: CategoryCoveragePlan = {
  targets: [
    { categoryName: 'Food & drink', minimumViable: 15, healthyTarget: 30, qualityNotes: ['Represent the metro\'s actual local/regional culinary identity — not generic chain-restaurant coverage.'] },
    { categoryName: 'Bar & drinks', minimumViable: 8, healthyTarget: 15, qualityNotes: ['Watch for filler if this category is historically strong locally — depth over padding.'] },
    { categoryName: 'Adventure', minimumViable: 6, healthyTarget: 12, qualityNotes: ['Outdoor/recreation experiences genuinely native to this metro\'s geography.'] },
    { categoryName: 'Arts & Culture', minimumViable: 5, healthyTarget: 10, qualityNotes: ['Museums, historic sites, public art, performance venues.'] },
    { categoryName: 'Shopping', minimumViable: 3, healthyTarget: 6, qualityNotes: ['Historically a weak category across prior metros — flag for a targeted deep dive proactively.'] },
    { categoryName: 'Sports', minimumViable: 2, healthyTarget: 5, qualityNotes: ['Historically a weak category across prior metros — flag for a targeted deep dive proactively.'] },
    { categoryName: 'Social', minimumViable: 2, healthyTarget: 4, qualityNotes: ['Historically weak — flag proactively.'] },
    { categoryName: 'Travel', minimumViable: 2, healthyTarget: 4, qualityNotes: ['Historically weak — flag proactively.'] },
    { categoryName: 'Nightlife', minimumViable: 3, healthyTarget: 6, qualityNotes: [] },
    { categoryName: "Spa & self-care", minimumViable: 2, healthyTarget: 4, qualityNotes: [] },
    { categoryName: 'Misc', minimumViable: 2, healthyTarget: 5, qualityNotes: ['Quirky/unusual/hidden-style experiences — a real CheckOff differentiator, not filler.'] },
  ],
}

/**
 * Generic per-neighborhood-kind minimum floors, applied only to
 * neighborhoods the CURRENT run's own M1 stage actually researched and
 * confirmed for the metro actually being built. This can never reference
 * another metro's geography by construction — it has no access to
 * anything except the `neighborhoods` array passed in.
 *
 * Deliberately conservative/small numbers relative to San Diego's
 * hand-tuned 3-5 floors: this is a safe, generic default for an
 * unfamiliar metro, not a substitute for a real metro-specific
 * --geo-depth-plan once the metro's actual character is better
 * understood (a caller may still always override via that flag).
 */
const DEFAULT_MINIMUM_ITEMS_BY_KIND: Readonly<Record<NeighborhoodKind, number>> = Object.freeze({
  core_urban: 4,
  important_neighborhood: 3,
  suburb: 2,
  destination_worthy_outer: 1,
})

/**
 * Derives geographic depth targets from THIS metro's own real,
 * already-researched M1 neighborhoods — never a hardcoded list of some
 * other metro's place names. Called from metroLaunchDriver.ts's stepM2
 * whenever the caller didn't supply an explicit --geo-depth-plan.
 */
export function deriveDefaultDepthTargets(neighborhoods: readonly NeighborhoodDefinition[]): GeographicDepthTarget[] {
  return neighborhoods.map((n) => ({
    neighborhoodName: n.name,
    minimumItems: DEFAULT_MINIMUM_ITEMS_BY_KIND[n.kind] ?? 1,
  }))
}
