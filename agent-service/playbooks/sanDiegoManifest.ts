// Chief Phase 2C — San Diego execution manifest. DATA ONLY. Nothing in
// this file creates a task, writes to the database, or performs any
// research. Per the explicit Phase 2C instruction: "Do not actually
// start building San Diego in this task" — this is the plan Jerry
// reviews before separately triggering execution (see the Phase 2C
// final report's exact next-command answer).

import type { MetroDefinition, CategoryCoveragePlan } from './metroLaunch'

export const SAN_DIEGO_METRO_DEFINITION: MetroDefinition = {
  metroName: 'San Diego',
  slug: 'san-diego',
  includedCities: ['San Diego', 'La Jolla', 'Coronado', 'Pacific Beach', 'North Park', 'Little Italy', 'Ocean Beach', 'Hillcrest'],
  // PROPOSED — Jerry decision needed (see final report): exact northern/
  // eastern extent (Carlsbad/Encinitas/North County are a real judgment
  // call — separate metro later, or included suburbs now).
  excludedAreas: ['Tijuana / border region (separate country, separate product question)'],
  timezone: 'America/Los_Angeles',
  launchSeason: null, // decision deferred, per the v2 playbook's own Phase 3 pattern — get timezone right now regardless
  targetCatalogSize: 120, // PROPOSED — between Denver's (20 neighborhoods) and Tucson's (~58 items) scale; Jerry to confirm
  audienceContext: 'Major coastal metro — beach culture, craft beer, military/Navy history, biotech, Mexican-American culinary identity, year-round outdoor recreation.',
}

// PROPOSED geography — a starting hypothesis for M1, not researched/
// verified yet. Ring radii intentionally small given San Diego's density
// (learned from the Denver lesson: schema defaults are unsafe for
// tightly-packed metros).
export const SAN_DIEGO_PROPOSED_NEIGHBORHOODS = [
  'Downtown/Gaslamp Quarter',
  'Little Italy',
  'Balboa Park/North Park',
  'Hillcrest/Mission Hills',
  'Old Town',
  'La Jolla',
  'Pacific Beach/Mission Beach',
  'Ocean Beach/Point Loma',
  'Coronado',
  'North Park/South Park',
  'East Village',
  'Barrio Logan/Logan Heights',
  'Chula Vista',
  'Encinitas/Del Mar (if included — see excludedAreas decision)',
] as const

export const SAN_DIEGO_CATEGORY_PLAN: CategoryCoveragePlan = {
  targets: [
    { categoryName: 'Food & drink', minimumViable: 15, healthyTarget: 30, qualityNotes: ['Mexican-American/Baja identity should be represented, not generic California cuisine only'] },
    { categoryName: 'Bar & drinks', minimumViable: 8, healthyTarget: 15, qualityNotes: ['Craft beer is a real San Diego identity marker — likely overrepresented risk, watch for filler'] },
    { categoryName: 'Adventure', minimumViable: 8, healthyTarget: 15, qualityNotes: ['Ocean/beach activities, hiking (Torrey Pines, Cabrillo)'] },
    { categoryName: 'Arts & Culture', minimumViable: 6, healthyTarget: 12, qualityNotes: ['Balboa Park museums, murals, historic sites'] },
    { categoryName: 'Shopping', minimumViable: 4, healthyTarget: 8, qualityNotes: ['Historically a weak category in prior metros — flag for an M5 deep dive proactively, do not wait for M4 to discover it'] },
    { categoryName: 'Sports', minimumViable: 3, healthyTarget: 8, qualityNotes: ['Historically a weak category in prior metros (Denver required a dedicated Sports intake pass) — flag for an M5 deep dive proactively'] },
    { categoryName: 'Social', minimumViable: 3, healthyTarget: 6, qualityNotes: ['Historically weak — flag proactively'] },
    { categoryName: 'Travel', minimumViable: 3, healthyTarget: 6, qualityNotes: ['Historically weak — flag proactively'] },
    { categoryName: 'Nightlife', minimumViable: 4, healthyTarget: 8, qualityNotes: [] },
    { categoryName: "Spa & self-care", minimumViable: 2, healthyTarget: 5, qualityNotes: [] },
    { categoryName: 'Misc', minimumViable: 3, healthyTarget: 8, qualityNotes: ['Quirky/unusual/hidden-style experiences — a real CheckOff differentiator, not filler'] },
  ],
}

export interface ManifestSection {
  title: string
  content: string[]
}

export const SAN_DIEGO_EXECUTION_MANIFEST: ManifestSection[] = [
  {
    title: 'Proposed geographic scope',
    content: [
      `${SAN_DIEGO_PROPOSED_NEIGHBORHOODS.length} proposed neighborhoods (list above) — PROPOSED, not researched/verified.`,
      'Open decision: does North County (Encinitas/Del Mar/Carlsbad) belong in this launch or a later separate metro? Flagged for Jerry.',
      'Open decision: how to handle the US/Mexico border proximity in product framing (excluded from scope by default, not a value judgment).',
    ],
  },
  {
    title: 'Neighborhoods/areas research plan',
    content: [
      'M1: verify the proposed neighborhood list against real geography (core urban, important neighborhoods, suburbs, destination-worthy outer areas).',
      'Compute and verify ring-2 non-overlap programmatically (verifyNoRingOverlap) before any item assignment, per the Denver lesson.',
      'Model San Diego\'s foundation on Denver (most recent, most-verified process) rather than re-deriving platform mechanics from scratch, per the v2 playbook\'s own Phase 2 guidance.',
    ],
  },
  {
    title: 'Category audit plan',
    content: [
      `${SAN_DIEGO_CATEGORY_PLAN.targets.length} category targets defined (table above) — PROPOSED, Jerry to confirm minimums/targets.`,
      'Sports, Shopping, Social, and Travel flagged for a PROACTIVE M5 deep dive based on historical pattern (these were weak in prior metros) — do not wait for M4 to discover this again.',
    ],
  },
  {
    title: 'Target candidate/catalog range',
    content: [`Target catalog size: ${SAN_DIEGO_METRO_DEFINITION.targetCatalogSize} viable items — PROPOSED, between Denver (20 neighborhoods, larger) and Tucson (~58 items) scale.`],
  },
  {
    title: 'Expected deep-dive loops',
    content: [
      'At minimum one M4/M5 loop iteration for each of Sports, Shopping, Social, Travel (proactively scheduled, per historical pattern).',
      'Additional loops as the first M4 pass actually reveals — count is not fixed in advance.',
    ],
  },
  {
    title: 'Required research specialists',
    content: [
      'metro_builder — owns the whole M0-M8 build, delegates verification.',
      'research_verifier — closure checks, exact-thing verification, address/contact research for every candidate item before M7 catalog construction.',
      'business_outreach — M10-M12, reusing the existing Phase 2A Business Photo Outreach playbook once M9 visual-coverage/outreach-prep is ready.',
    ],
  },
  {
    title: 'Outreach handoff',
    content: [
      'M11 hands off to the existing business_photo_outreach playbook (Phase 2A) unchanged — no new outreach mechanism for San Diego.',
      'Outreach targets selected only from items that passed M6 quality/verification.',
    ],
  },
  {
    title: 'Launch gates',
    content: [
      'All 7 metro quality gates (GEOGRAPHY, CATEGORY, QUALITY, CATALOG, LOCATION, PRESENTATION, OUTREACH) must PASS or have an explicit Jerry-approved exception before M14.',
      'M14 (public launch) is APPROVAL_REQUIRED regardless of gate state — Chief cannot flip metro_areas.is_active=true on its own, ever.',
    ],
  },
]

export const SAN_DIEGO_JERRY_DECISIONS_NEEDED: string[] = [
  'Confirm or adjust the proposed geographic scope (North County inclusion, border-region framing).',
  'Confirm or adjust target catalog size (120 proposed) and per-category minimum/healthy targets.',
  'Confirm launch season timing (or explicitly defer, per the v2 playbook\'s "timezone now, season later" pattern).',
  'Approve moving from this manifest to actual M0-M1 execution — this manifest is a proposal, not an authorization.',
]
