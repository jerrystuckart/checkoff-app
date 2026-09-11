// Chief Phase 2AK (2026-09-10, methodology hardening postmortem) —
// driver-level regression test proving the real list-title hygiene bug is
// fixed: a themed list's PLANNED internal report label may carry a
// "Themed list:" prefix, but the REAL public.lists.title generated into
// the production SQL (and used for the real Home-list DB verification
// query) must be the exact, plain, user-facing title with no prefix.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'
import { InMemoryGeoEnrichmentCacheStore } from './metroGeoEnrichmentDriver'
import type { VerifiedTagSnapshot } from './tagVocabularyProvider'

const PLAN: CategoryCoveragePlan = { targets: [{ categoryName: 'Bar & drinks', minimumViable: 2, healthyTarget: 5, qualityNotes: [] }] }

const M0: MetroM0Decisions = {
  geographicScope: 'Test metro',
  categoryCatalogTargets: 'Bar & drinks',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'US',
  metroCenter: { lat: 44.5, lng: -88.0 },
}

const TEST_TAG_VOCAB: VerifiedTagSnapshot = {
  version: 1,
  capturedAt: '2026-09-09T00:00:00.000Z',
  justification: 'TEST_FIXTURE',
  tagNames: ['nightlife', 'cocktail-bar', 'hidden-bar', 'late-night', 'night-out', 'craft-beer', 'local'],
}

function scriptTagSelection(executor: TestExecutor) {
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => {
      const shortlist = (r.inputs as { shortlist?: string[] }).shortlist ?? []
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { tags: shortlist.slice(0, 6) }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )
}

test('driveMetroLaunch (list-title hygiene): a themed list\'s real public.lists.title has no "Themed list:" prefix, even though the internal report label does', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptTagSelection(executor)

  // Names must have genuinely distinct significant words (homeListThemes.ts's
  // dedupByVenue collapses venues whose 3+-letter words are a subset match —
  // a numeric suffix alone, e.g. "Venue 0"/"Venue 1", is too short to count
  // and would wrongly collapse all 9 into one).
  const venueNames = ['Alpha Lounge', 'Bravo Tavern', 'Charlie Speakeasy', 'Delta Saloon', 'Echo Cantina', 'Foxtrot Pub', 'Golf Taproom', 'Hotel Cocktail Room', 'India Nightclub']
  const candidates = venueNames.map((name) => ({ name, category: 'Bar & drinks', neighborhood: 'Downtown', claimSupported: `${name} has a real specific cocktail.`, source: `https://example.com/${name}`, needsVerification: false }))
  const certs: Record<string, DriverItemCertificationRecord> = {}
  for (const c of candidates) {
    certs[c.name] = {
      candidateName: c.name,
      venueName: c.name,
      attempts: 1,
      outcome: 'ITEM_CERTIFIED',
      finalBody: `Order the signature late-night cocktail at '${c.name}'.`,
      finalTags: ['nightlife', 'cocktail-bar', 'hidden-bar', 'late-night', 'night-out', 'craft-beer'],
      supportingFact: c.claimSupported,
      verifiedAt: '2026-09-10T00:00:00.000Z',
      rejectionReasons: [],
      dbCategory: 'Bar & drinks',
    }
  }

  const projectId = 'list-title-hygiene-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: M0, candidates, neighborhoods: [], plan: PLAN, hasRunM6: true, itemCertifications: certs }
  seeded!.currentStage = 'M8_BATCH_CERTIFICATION'
  await runStore.put(seeded!)

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      metroAreaFacts: { name: 'Test Metro', state: 'WI', timezone: 'America/Chicago' },
      metroAreaSlug: 'test-metro',
      canonicalNeighborhoods: ['Downtown'],
      fetchExistingProductionInventory: async () => [],
      placesLookup: async (q: string) => ({ topResult: { placeId: `p-${q}`, name: q, formattedAddress: `${q}, Green Bay, WI 54301, USA`, lat: 44.51, lng: -88.01, websiteUri: null, country: 'US', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Test Metro',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )

  const state = run.state as { homeListPlan?: Array<{ label: string; title: string; kind: string }>; homeListSqlPatch?: string }
  const themedEntry = state.homeListPlan?.find((p) => p.kind === 'THEMED')
  assert.ok(themedEntry, `expected a THEMED list to be generated from 9 nightlife items, got plan: ${JSON.stringify(state.homeListPlan)}`)
  assert.equal(themedEntry!.title, 'After Dark', 'the REAL title must be the plain display name')
  assert.equal(themedEntry!.label, 'Themed list: After Dark', 'the internal report label may still carry the descriptive prefix')

  const sql = state.homeListSqlPatch ?? ''
  assert.ok(sql.includes("'After Dark'"), 'the generated SQL must use the plain title as the literal public.lists.title value')
  assert.ok(!sql.includes("'Themed list: After Dark'"), 'the generated SQL must NEVER write the internal-prefixed label as a literal title value')

  // Chief Phase 2AK item 3 — is_active is an ordinary field set at creation
  // time, never a staging flag this driver treats specially. Locks the
  // real, current, correct behavior against a future regression back
  // toward "build inactive, flip on launch."
  assert.match(sql, /INSERT INTO public\.metro_areas[^;]*is_active[^;]*VALUES \([^;]*true/s, 'metro_areas.is_active is inserted true at creation time, not held false as a staging gate')
})
