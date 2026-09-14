// PART 3 of the M9 list-curation wiring task (2026-09-14) — end-to-end
// proof that the LIVE driveMetroLaunch/stepM9HomeListMirror path actually
// invokes the new two-pass system (m9ListCurationAdapter.ts ->
// listConceptDiscovery.ts / listFitScoring.ts) when SHADOW mode is
// requested, that it never does so in LEGACY (the default), and that the
// two modes produce byte-for-byte identical authoritative artifacts
// (state.homeListPlan/state.homeListSqlPatch) for identical inputs — the
// regression assertion required before any future ENFORCED work can build
// on this wiring. See docs/metro-launch-audit/munich/calibration-analysis/
// 16-m9-wiring-handoff.md and 17-m9-shadow-wiring.md (this commit) for the
// full scope of this session.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'

const PLAN: CategoryCoveragePlan = { targets: [{ categoryName: 'Adventure', minimumViable: 2, healthyTarget: 5, qualityNotes: [] }] }

const M0: MetroM0Decisions = {
  geographicScope: 'Test metro',
  categoryCatalogTargets: 'Adventure',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'US',
  metroCenter: { lat: 44.5, lng: -88.0 },
}

/**
 * Builds a large-enough certified catalog for listConceptDiscovery.ts's
 * real, unstubbed default config (minViableItems=15, maxTagPrevalenceToSeed=0.5)
 * to actually cluster and CREATE a brand-new concept the legacy
 * THEMED_LIST_DEFINITIONS menu has no entry for — 'canal-crawl' is not one
 * of homeListThemes.ts's predefined tags. 15 of 40 total certified items
 * (37.5%, below the 50% genericness ceiling) carry it, so PASS A's
 * single-tag seed both clears the minimum-viable floor AND survives the
 * prevalence check — proving the LIVE driver, not a stubbed/mocked
 * adapter, ran real tag-co-occurrence discovery against this run's actual
 * catalog.
 */
function buildLargeCatalog(totalCount: number, taggedCount: number) {
  const candidates: { name: string; category: string; neighborhood: string; claimSupported: string; source: string }[] = []
  const itemCertifications: Record<string, DriverItemCertificationRecord> = {}
  const metadataEnrichmentResults: ReturnType<typeof baseMetadata>[] = []
  const geoEnrichmentResults: ReturnType<typeof baseGeo>[] = []

  for (let i = 0; i < totalCount; i++) {
    const name = `Venue ${i}`
    const tagged = i < taggedCount
    candidates.push({ name, category: 'Adventure', neighborhood: 'Downtown', claimSupported: 'x', source: `https://example.com/${i}` })
    itemCertifications[name] = {
      candidateName: name,
      venueName: name,
      attempts: 1,
      outcome: 'ITEM_CERTIFIED',
      finalBody: `Try the real, specific thing at '${name}'.`,
      finalTags: tagged ? ['canal-crawl', `unique-tag-${i}`] : [`unique-tag-${i}`, `other-tag-${i}`],
      supportingFact: `${name} has a real specific attraction.`,
      verifiedAt: '2026-09-14T00:00:00.000Z',
      rejectionReasons: [],
      dbCategory: 'Adventure',
    }
    metadataEnrichmentResults.push(baseMetadata(name))
    geoEnrichmentResults.push(baseGeo(name))
  }

  return { candidates, itemCertifications, metadataEnrichmentResults, geoEnrichmentResults }
}

function baseMetadata(name: string) {
  return {
    candidateName: name,
    hasAlcohol: { evaluated: true, value: false, confidence: 'HIGH' as const, reason: 'test fixture' },
    photoRequired: { evaluated: true, value: false, confidence: 'HIGH' as const, reason: 'test fixture' },
    checkinType: { evaluated: true, value: 'tap' as const, confidence: 'HIGH' as const, reason: 'test fixture' },
    isSecret: { evaluated: true, value: false, confidence: 'HIGH' as const, reason: 'test fixture' },
    difficulty: { evaluated: true, value: 1 as const, confidence: 'HIGH' as const, reason: 'test fixture' },
    visitProfileKey: { evaluated: true, value: null, confidence: 'HIGH' as const, reason: 'test fixture' },
    websiteUrl: { evaluated: false, reason: 'test fixture' },
  }
}

function baseGeo(name: string) {
  return { candidateName: name, classification: 'EXACT' as const, reason: 'test fixture', placeId: `p-${name}`, formattedAddress: `${name}, Downtown, Test Metro`, lat: 44.51, lng: -88.01, geoRadiusM: null, websiteUrl: 'https://example.com/site' }
}

async function seedAtM9(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string, catalog: ReturnType<typeof buildLargeCatalog>) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = (await runStore.get(playbookRunId('metro_launch', projectId)))!
  seeded.state = {
    m0Decisions: M0,
    candidates: catalog.candidates.map((c) => ({ ...c, needsVerification: false })),
    neighborhoods: [],
    plan: PLAN,
    hasRunM6: true,
    itemCertifications: catalog.itemCertifications,
    batchCertificationGates: [],
    metadataEnrichmentResults: catalog.metadataEnrichmentResults,
    geoEnrichmentResults: catalog.geoEnrichmentResults,
  }
  seeded.currentStage = 'M9_HOME_LIST_MIRROR'
  await runStore.put(seeded)
  return seeded
}

function baseDeps(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, overrides: Record<string, unknown> = {}) {
  return {
    runStore,
    execStore: new InMemoryExecutionStore(),
    executors: [new TestExecutor()],
    metroAreaFacts: { name: 'Test Metro', state: 'WI', timezone: 'America/Chicago' },
    metroAreaSlug: 'test-metro',
    canonicalNeighborhoods: ['Downtown'],
    verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
    checkImageReadiness: async (plan: { requiresImage: boolean; label: string }[]) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: true })),
    checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
    ensureProject: async () => ({ projectId: 'test-project', created: false }),
    flagshipListTitle: 'Fall 2026 — Test Metro',
    now: () => '2026-09-14T00:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Core proof: SHADOW invokes the real modules; LEGACY never does; the
// authoritative artifacts are identical between the two modes.
// ---------------------------------------------------------------------------

test('SHADOW WIRING: SHADOW mode runs real listConceptDiscovery/listFitScoring against the actual catalog; LEGACY never invokes the adapter at all', async () => {
  const catalog = buildLargeCatalog(40, 15)

  const legacyStore = new InMemoryPlaybookRunStore()
  await seedAtM9(legacyStore, 'shadow-wiring-legacy', catalog)
  const legacyRun = await driveMetroLaunch(baseDeps(legacyStore) as never, 'shadow-wiring-legacy', { categoryPlan: PLAN, maxSteps: 30 })
  const legacyState = legacyRun.state as { homeListPlan?: unknown; homeListSqlPatch?: string; m9ShadowCuration?: unknown }

  const shadowStore = new InMemoryPlaybookRunStore()
  await seedAtM9(shadowStore, 'shadow-wiring-shadow', catalog)
  const shadowRun = await driveMetroLaunch(baseDeps(shadowStore, { m9CurationMode: 'SHADOW' }) as never, 'shadow-wiring-shadow', { categoryPlan: PLAN, maxSteps: 30 })
  const shadowState = shadowRun.state as {
    homeListPlan?: unknown
    homeListSqlPatch?: string
    m9ShadowCuration?: {
      mode: string
      conceptDiscovery: { proposedTitle: string; verdict: string; seedTags: string[]; candidateNames: string[] }[]
      membershipDecisionsByConcept: Record<string, { verdict: string }[]>
      validationFailures: string[]
    }
  }

  // LEGACY never invokes the adapter — no shadow artifact at all.
  assert.equal(legacyState.m9ShadowCuration, undefined, 'LEGACY mode must never populate state.m9ShadowCuration')

  // SHADOW genuinely ran PASS A/B against the real 40-item catalog, not a
  // stub: it must have discovered the 'canal-crawl' cluster as a CREATE
  // concept (15/40 = 37.5% prevalence, clears both the 15-item floor and
  // the 50% genericness ceiling) with zero validation failures, and PASS B
  // must have produced real per-item membership decisions for it.
  assert.ok(shadowState.m9ShadowCuration, 'SHADOW mode must populate state.m9ShadowCuration')
  assert.equal(shadowState.m9ShadowCuration!.validationFailures.length, 0, 'a clean 40-item catalog must produce zero validation failures')
  const canalConcept = shadowState.m9ShadowCuration!.conceptDiscovery.find((c) => c.seedTags.includes('canal-crawl'))
  assert.ok(canalConcept, 'the real tag-co-occurrence cluster around canal-crawl must have been discovered by the live driver call')
  assert.equal(canalConcept!.verdict, 'CREATE', 'a coherent 15-item, no-overlap cluster must CREATE')
  assert.equal(canalConcept!.candidateNames.length, 15, 'exactly the 15 tagged items must form this concept')
  const canalDecisions = shadowState.m9ShadowCuration!.membershipDecisionsByConcept[canalConcept!.proposedTitle]
  assert.ok(canalDecisions && canalDecisions.length === 15, 'PASS B must have produced a real per-item decision for every member of the CREATE concept')

  // The legacy THEMED_LIST_DEFINITIONS menu has no keyword-defined entry
  // that would ever surface 'canal-crawl' as its own themed list — this
  // concept has no THEMED-kind legacy analogue, which is exactly the real
  // gap this whole task exists to make visible. (It legitimately DOES
  // overlap the flagship PRIMARY_SEASONAL list, which is a near-full-catalog
  // selection by design — that overlap is real and expected, not a bug.)
  const canalDifference = (shadowState.m9ShadowCuration as unknown as { conceptDifferences: { proposedTitle: string; matchedLegacyListTitle: string | null }[] }).conceptDifferences.find((d) => d.proposedTitle === canalConcept!.proposedTitle)
  const legacyPlanEntries = legacyState.homeListPlan as { title: string; kind: string }[]
  const matchedLegacyKind = legacyPlanEntries.find((p) => p.title === canalDifference?.matchedLegacyListTitle)?.kind
  assert.notEqual(matchedLegacyKind, 'THEMED', 'a genuinely novel concept must not match any of the fixed-menu THEMED_LIST_DEFINITIONS lists')

  // The regression assertion: identical inputs must produce byte-for-byte
  // identical authoritative artifacts in both modes — SHADOW's extra work
  // must never leak into, or alter, what LEGACY would have produced alone.
  assert.deepEqual(shadowState.homeListPlan, legacyState.homeListPlan, 'homeListPlan must be identical between LEGACY and SHADOW for identical inputs')
  assert.equal(shadowState.homeListSqlPatch, legacyState.homeListSqlPatch, 'homeListSqlPatch must be identical between LEGACY and SHADOW for identical inputs')

  // SHADOW must never alter the established M9->M10 fall-through behavior
  // or produce a HOLD/NEEDS_JERRY outcome the legacy run didn't already
  // reach on its own (both runs hit the same BLOCKED verdict here, from
  // verifyHomeListRows's forced test failure — unrelated to SHADOW).
  assert.equal(shadowRun.status, legacyRun.status, 'run status must be identical between LEGACY and SHADOW')
  assert.equal(shadowRun.currentStage, legacyRun.currentStage, 'currentStage must be identical between LEGACY and SHADOW')
})

// ---------------------------------------------------------------------------
// SHADOW must default off — omitting m9CurationMode is exactly LEGACY.
// ---------------------------------------------------------------------------

test('SHADOW WIRING: omitting deps.m9CurationMode is byte-for-byte identical to explicitly passing LEGACY', async () => {
  const catalog = buildLargeCatalog(20, 0)

  const implicitStore = new InMemoryPlaybookRunStore()
  await seedAtM9(implicitStore, 'shadow-wiring-implicit', catalog)
  const implicitRun = await driveMetroLaunch(baseDeps(implicitStore) as never, 'shadow-wiring-implicit', { categoryPlan: PLAN, maxSteps: 30 })

  const explicitStore = new InMemoryPlaybookRunStore()
  await seedAtM9(explicitStore, 'shadow-wiring-explicit', catalog)
  const explicitRun = await driveMetroLaunch(baseDeps(explicitStore, { m9CurationMode: 'LEGACY' }) as never, 'shadow-wiring-explicit', { categoryPlan: PLAN, maxSteps: 30 })

  assert.deepEqual((implicitRun.state as { homeListPlan?: unknown }).homeListPlan, (explicitRun.state as { homeListPlan?: unknown }).homeListPlan)
  assert.equal((implicitRun.state as { homeListSqlPatch?: string }).homeListSqlPatch, (explicitRun.state as { homeListSqlPatch?: string }).homeListSqlPatch)
  assert.equal((implicitRun.state as { m9ShadowCuration?: unknown }).m9ShadowCuration, undefined)
  assert.equal((explicitRun.state as { m9ShadowCuration?: unknown }).m9ShadowCuration, undefined)
})
