// agent-service/playbooks/__fixtures__/munichListCurationFixtures.ts
//
// STANDALONE FIXTURE — NOT WIRED INTO ANY TEST OR PIPELINE CODE.
//
// Companion to munichGoldStandard.ts, extended with the LIST-CURATION
// dimension that file does not cover (it validates catalog-inclusion
// verdicts only). This file captures real, live Munich list-membership
// outcomes from the six official lists rebuilt by
// munich_lists_rebuild_no_temp_tables.sql (verified against production on
// 2026-09-14 — see
// docs/metro-launch-audit/munich/calibration-analysis/09-final-list-rebuild-analysis.md
// through 12-m9-training-requirements.md for the full analysis).
//
// Every entry is either (a) a close paraphrase of a real, live Munich
// item and its real list membership (no production secrets, credentials,
// or personal information — public venue names and publicly-visible
// CheckOff-style descriptions, several already published live in the
// app), or (b) modeled directly on a real documented pattern where the
// live outcome itself is the interesting case (e.g. an item Winston
// included that the final rebuild excluded). Each entry's `provenance`
// says which.
//
// This fixture makes NO assertions. It exists to give a future M9
// `ItemListFitDecision`-shaped implementation (proposed, not built, in
// calibration-analysis/12-m9-training-requirements.md) real regression
// material once it exists — mirroring munichGoldStandard.ts's own
// "recommended next step" pattern.

export interface MunichListCurationFixtureEntry {
  /** Short label for the list-curation pattern this entry demonstrates. */
  label: string
  /** Real, paraphrased, or synthetic — see file header. */
  provenance: 'real-paraphrased' | 'synthetic-modeled-on-real-pattern'
  itemName: string
  itemBody: string
  category: string
  neighborhood: string
  /** The list(s) this item is being evaluated against. */
  targetLists: readonly string[]
  /** What a correct list-fit evaluation should conclude for EACH target list, in order. Not an assertion — for a future test author. */
  expectedVerdicts: readonly ('INCLUDE' | 'EXCLUDE' | 'HOLD')[]
  /** The real-world evidence this fixture is drawn from. */
  note: string
}

export const MUNICH_LIST_CURATION_FIXTURES: readonly MunichListCurationFixtureEntry[] = [
  {
    label: 'Strong Fall list inclusion',
    provenance: 'real-paraphrased',
    itemName: 'Gaststätte Großmarkthalle',
    itemBody: "Eat the cellar-made Weißwurst before noon at 'Gaststätte Großmarkthalle'.",
    category: 'Food & drink',
    neighborhood: 'Sendling',
    targetLists: ['Fall 2026 — Munich Metro'],
    expectedVerdicts: ['INCLUDE'],
    note: 'Real live member of Fall 2026 (and 3 other lists). Specific dish + timing constraint + independent venue — one of the most heavily cross-listed items in the whole rebuild (4 lists total).',
  },
  {
    label: 'Catalog item excluded from Fall despite being a legitimate landmark',
    provenance: 'real-paraphrased',
    itemName: 'Allianz Arena and surrounding',
    itemBody: "Take a stadium tour at 'Allianz Arena and surrounding'.",
    category: 'Adventure',
    neighborhood: 'Milbertshofen-Am Hart (Olympiapark) (approximate — Fröttmaning)',
    targetLists: ['Fall 2026 — Munich Metro'],
    expectedVerdicts: ['EXCLUDE'],
    note: "Winston's ORIGINAL Fall 2026 list member (before the rebuild). Absent from the final, rebuilt Fall list even though it remains a plausible catalog item — real evidence that catalog-worthy does not imply list-worthy, and that a list rebuild can legitimately drop a well-known landmark in favor of more specific/distinctive experiences.",
  },
  {
    label: 'Strong nightlife inclusion — structurally nighttime-specific',
    provenance: 'real-paraphrased',
    itemName: "Schumann's Bar",
    itemBody: "Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar.",
    category: 'Bar & drinks',
    neighborhood: 'Altstadt-Lehel',
    targetLists: ['Munich After Dark'],
    expectedVerdicts: ['INCLUDE'],
    note: 'Real live member. Explicit before/after-midnight claim. Also the item whose body was corrupted by a doubled-apostrophe dollar-quoting bug and repaired inline in the rebuild SQL — see calibration-analysis/13-list-sql-generation-safeguards.md.',
  },
  {
    label: 'Bar-or-restaurant included in nightlife but not meaningfully nighttime-specific',
    provenance: 'real-paraphrased',
    itemName: 'Frisches Bier',
    itemBody: "Choose a small-brewery pour from 14 rotating taps at 'Frisches Bier'.",
    category: 'Bar & drinks',
    neighborhood: 'Sendling',
    targetLists: ['Munich After Dark'],
    expectedVerdicts: ['INCLUDE (real outcome) — flagged as the weak case a stricter nighttime-specific rule should reconsider'],
    note: 'Real live member, but the claim has no time gate — could truthfully be completed at 2pm. calibration-analysis/11-list-portfolio-scorecards.md flags this as the softest of 4 similar cases (with Paulaner Bräuhaus, Higgins Ale Works, Zero Dosage) in an otherwise disciplined list.',
  },
  {
    label: 'Strong local-flavor inclusion',
    provenance: 'real-paraphrased',
    itemName: 'Fausto Kaffeerösterei',
    itemBody: "Smell the roast and order a single-origin espresso at 'Fausto Kaffeerösterei'.",
    category: 'Food & drink',
    neighborhood: 'Obergiesing-Fasangarten',
    targetLists: ['Cafés, Markets & Local Flavor'],
    expectedVerdicts: ['INCLUDE'],
    note: 'Real live member. Specific product, specific sensory ritual, independent-business signal by name (unverified in structured data, per the catalog-wide ownership gap).',
  },
  {
    label: 'Generic restaurant rejected from local flavor',
    provenance: 'real-paraphrased',
    itemName: 'Café Maria',
    itemBody: "Settle in for coffee at 'Café Maria'.",
    category: 'Food & drink',
    neighborhood: 'unknown (original-70 item, pre-neighborhood-expansion)',
    targetLists: ['Cafés, Markets & Local Flavor'],
    expectedVerdicts: ['EXCLUDE'],
    note: "Winston's ORIGINAL Cafés/Markets list member. No specific order or ritual — fails the list's own required bar. Also one of the 14 probable catalog retirements identified in calibration-analysis/01-original-70-disposition.md. Absent from the final, rebuilt list.",
  },
  {
    label: 'Defensible overlooked gem — famous building, hidden/overlooked detail',
    provenance: 'real-paraphrased',
    itemName: 'Neues Rathaus (plague dragon detail)',
    itemBody: "Find the carved plague dragon climbing the corner of 'Neues Rathaus'.",
    category: 'Misc',
    neighborhood: 'Altstadt-Lehel',
    targetLists: ['Hidden Gems'],
    expectedVerdicts: ['INCLUDE'],
    note: "Real live member. The building itself is a famous, unhidden landmark; the specific carved detail being surfaced is genuinely overlooked. Correct use of the 'famous building, hidden/overlooked detail' discovery basis, distinct from mislabeling the whole landmark as secret.",
  },
  {
    label: 'Famous attraction rejected from Hidden Gems — no discovery mechanic',
    provenance: 'real-paraphrased',
    itemName: 'Kunstareal Munich',
    itemBody:
      'Visit a cluster of 18 museums and over 20 galleries, including Alte Pinakothek, Pinakothek der Moderne, Lenbachhaus, Museum Brandhorst, and Glyptothek at \'Kunstareal Munich\'.',
    category: 'Arts & Culture',
    neighborhood: 'Maxvorstadt',
    targetLists: ['Hidden Gems', 'Fall 2026 — Munich Metro'],
    expectedVerdicts: ['EXCLUDE', 'EXCLUDE'],
    note: "Winston's ORIGINAL Fall 2026 list member; not a Hidden Gems candidate in any version. Retired from the catalog entirely (01-original-70-disposition.md) — the whole 'venue' is a district-level museum quarter with the most generic possible action ('visit a cluster of 18 museums'), and its constituent museums are separately, specifically represented elsewhere in the live catalog. The clean boundary case for both 'famous, not hidden' and 'generic action'.",
  },
  {
    label: 'One item validly fitting multiple lists for distinct reasons',
    provenance: 'real-paraphrased',
    itemName: 'Weihenstephan',
    itemBody: "Tour the brewhouse and storage cellars, then finish with a guided tasting at 'Weihenstephan'.",
    category: 'Bar & drinks',
    neighborhood: 'Freising',
    targetLists: ['Beer Gardens, Breweries & Bavarian Rituals', 'Day Trips & Big Adventures', 'Fall 2026 — Munich Metro'],
    expectedVerdicts: ['INCLUDE', 'INCLUDE', 'INCLUDE'],
    note: 'Real live member of all three lists — brewery-ritual framing for Beer Gardens, day-trip-destination framing for Day Trips, seasonal-worthy-experience framing for Fall 2026. Each framing is independently defensible; see calibration-analysis/10-original-vs-final-list-decisions.md for the full multi-list reuse analysis (43 items total are multi-list).',
  },
  {
    label: 'Strong catalog item fitting no curated list',
    provenance: 'synthetic-modeled-on-real-pattern',
    itemName: '(representative — see note)',
    itemBody: 'One of 89 real, live, fully certified Munich items that belongs to zero of the six official lists.',
    category: 'various',
    neighborhood: 'various',
    targetLists: ['(all six)'],
    expectedVerdicts: ['EXCLUDE', 'EXCLUDE', 'EXCLUDE', 'EXCLUDE', 'EXCLUDE', 'EXCLUDE'],
    note: '89 of 184 live Munich items (48%) belong to zero curated lists, confirmed via live query against list_items — this is the plurality outcome, not an edge case, and is the strongest evidence available that "catalog inclusion never implies list inclusion" is achievable in practice, not just in principle.',
  },
  {
    label: 'Category-balancing selection',
    provenance: 'real-paraphrased',
    itemName: 'SAP Garden',
    itemBody: "Lace up for a public-skating session on one of the ice sheets inside 'SAP Garden'.",
    category: 'Sports',
    neighborhood: 'Milbertshofen-Am Hart (Olympiapark)',
    targetLists: ['Fall 2026 — Munich Metro'],
    expectedVerdicts: ['INCLUDE'],
    note: 'Real live member — the only Sports-category item in the Fall 2026 list, in a catalog where Sports sits below its healthy target (calibration-analysis/03-category-geography-comparison.md). A concrete example of a category-balancing list decision.',
  },
  {
    label: 'Geographic-balancing selection',
    provenance: 'real-paraphrased',
    itemName: 'Gans Woanders',
    itemBody: "Climb into the treehouse-like café at 'Gans Woanders'.",
    category: 'Food & drink',
    neighborhood: 'Ramersdorf-Perlach',
    targetLists: ['Fall 2026 — Munich Metro'],
    expectedVerdicts: ['INCLUDE'],
    note: "Real live member — Ramersdorf-Perlach's only active catalog item, and its inclusion in the flagship Fall list gives one of Munich's 16 single-item neighborhoods real visibility rather than leaving it a catalog-only placeholder.",
  },
  {
    label: 'Filler rejected despite an open slot',
    provenance: 'real-paraphrased',
    itemName: 'Viktualienmarkt (generic)',
    itemBody: "Sample local specialties at 'Viktualienmarkt'.",
    category: 'Food & drink',
    neighborhood: 'Altstadt-Lehel',
    targetLists: ['Hidden Gems'],
    expectedVerdicts: ['EXCLUDE'],
    note: "Winston's ORIGINAL Hidden Gems list member (9 items total — below THEMED_LIST_MIN_ITEMS=8's floor by only one item, suggesting the original list may have been padded to clear that minimum). No discovery mechanic whatsoever. Absent from the final, rebuilt 24-item Hidden Gems list despite the final list having far more open capacity to have kept it.",
  },
  {
    label: 'Additional themed-list opportunity derived from a sufficiently strong cluster',
    provenance: 'real-paraphrased',
    itemName: 'Andechs Bräustüberl (representative of the Beer Gardens cluster)',
    itemBody: "Bring your own Brotzeit or carry a tray of monastery food with an Andechser beer into 'Andechs Bräustüberl'.",
    category: 'Food & drink',
    neighborhood: 'Andechs',
    targetLists: ['Beer Gardens, Breweries & Bavarian Rituals (proposed new list, not in THEMED_LIST_DEFINITIONS at Winston build time)'],
    expectedVerdicts: ['INCLUDE — and the cluster it belongs to (20 real items) should have triggered a NEW-LIST proposal'],
    note: 'Real live member of an entirely new, 20-item list Winston never proposed. See calibration-analysis/15-final-calibration-implementation-plan.md for the full analysis of why (catalog material did not exist yet at Winston build time; THEMED_LIST_DEFINITIONS is static, not a discovery mechanism; and the surrounding-municipality geography tier this cluster depends on was still marked out-of-scope in m0.json).',
  },
] as const
