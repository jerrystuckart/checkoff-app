// Chief Phase 2AL (2026-09-11) — driver-level regression tests for the
// third and final methodology-hardening pass:
//   1. A metro without an explicit canonical neighborhood model cannot
//      reach READY (SQL packaging refuses to proceed).
//   2/3. Generic neighborhood SQL: the driver itself creates every
//      approved canonical public.neighborhoods row, INCLUDING a
//      zero-item one (via a documented real-locality fallback centroid) —
//      no per-metro one-off script required.
//   4. finalReadyToApplyAudit.ts is invoked automatically at the end of
//      every real drive, with no caller action required.
//   5. A failed final audit prevents Winston from reporting the package
//      as ready, even when every individual required gate already passed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'
import { InMemoryGeoEnrichmentCacheStore } from './metroGeoEnrichmentDriver'
import type { VerifiedTagSnapshot } from './tagVocabularyProvider'

const PLAN: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 2, healthyTarget: 5, qualityNotes: [] }] }

const M0: MetroM0Decisions = {
  geographicScope: 'Test metro',
  categoryCatalogTargets: 'Food & drink',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'US',
  metroCenter: { lat: 44.5, lng: -88.0 },
}

const TEST_TAG_VOCAB: VerifiedTagSnapshot = {
  version: 1,
  capturedAt: '2026-09-09T00:00:00.000Z',
  justification: 'TEST_FIXTURE',
  tagNames: ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'craft beer'],
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

function twoCleanCandidates() {
  const candidates = [
    { name: 'Alpha Diner', category: 'Food & drink', neighborhood: 'Downtown', claimSupported: 'Alpha Diner has a real specific dish.', source: 'https://example.com/alpha', needsVerification: false },
    { name: 'Bravo Bistro', category: 'Food & drink', neighborhood: 'Downtown', claimSupported: 'Bravo Bistro has a real specific dish.', source: 'https://example.com/bravo', needsVerification: false },
  ]
  const certs: Record<string, DriverItemCertificationRecord> = {}
  for (const c of candidates) {
    certs[c.name] = {
      candidateName: c.name,
      venueName: c.name,
      attempts: 1,
      outcome: 'ITEM_CERTIFIED',
      finalBody: `Try the triple-stack pancakes at '${c.name}'.`,
      finalTags: ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'craft beer'],
      supportingFact: c.claimSupported,
      verifiedAt: '2026-09-11T00:00:00.000Z',
      rejectionReasons: [],
      dbCategory: 'Food & drink',
    }
  }
  return { candidates, certs }
}

async function seed(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string, candidates: unknown[], certs: Record<string, DriverItemCertificationRecord>) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: M0, candidates, neighborhoods: [], plan: PLAN, hasRunM6: true, itemCertifications: certs }
  seeded!.currentStage = 'M8_BATCH_CERTIFICATION'
  await runStore.put(seeded!)
}

function basePlacesLookup() {
  return async (q: string) => ({ topResult: { placeId: `p-${q}`, name: q, formattedAddress: `${q}, Green Bay, WI 54301, USA`, lat: 44.51, lng: -88.01, websiteUri: null, country: 'US' as const, viewportRadiusM: null }, apiError: null })
}

// --- 1. Cannot reach READY without an explicit canonical neighborhood model ---

test('driveMetroLaunch (Chief Phase 2AL): a metro with NO canonical neighborhood model supplied cannot reach READY — SQL packaging refuses to proceed', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptTagSelection(executor)
  const { candidates, certs } = twoCleanCandidates()
  const projectId = 'no-canonical-model-test'
  await seed(runStore, projectId, candidates, certs)

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      metroAreaFacts: { name: 'Test Metro', state: 'WI', timezone: 'America/Chicago' },
      metroAreaSlug: 'test-metro',
      // Deliberately OMITTED: canonicalNeighborhoods.
      fetchExistingProductionInventory: async () => [],
      placesLookup: basePlacesLookup(),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Test Metro',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )

  assert.equal(run.status, 'BLOCKED', 'the run must be genuinely BLOCKED, never quietly proceeding to a READY-shaped state')
  assert.match(run.jerryReason ?? '', /canonical neighborhood model/i)
  const state = run.state as { homeListSqlPatch?: string }
  assert.equal(state.homeListSqlPatch, undefined, 'no SQL patch should ever be generated without an explicit canonical neighborhood model')
})

// --- 2/3. Generic neighborhood SQL, including a zero-item canonical neighborhood ---

test('driveMetroLaunch (Chief Phase 2AL): generic SQL creates every canonical neighborhood row, including a zero-item one via a documented fallback centroid', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptTagSelection(executor)
  const { candidates, certs } = twoCleanCandidates()
  const projectId = 'generic-neighborhood-sql-test'
  await seed(runStore, projectId, candidates, certs)

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      metroAreaFacts: { name: 'Test Metro', state: 'WI', timezone: 'America/Chicago' },
      metroAreaSlug: 'test-metro',
      canonicalNeighborhoods: ['Downtown', 'Quiet Suburb'],
      emptyNeighborhoodFallbackCentroids: { 'Quiet Suburb': { lat: 44.6, lng: -88.2 } },
      fetchExistingProductionInventory: async () => [],
      placesLookup: basePlacesLookup(),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Test Metro',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )

  const state = run.state as { homeListSqlPatch?: string }
  const sql = state.homeListSqlPatch ?? ''
  assert.ok(sql.length > 0, 'a SQL patch must have been generated')
  assert.ok(sql.includes("INSERT INTO public.neighborhoods"), 'the generic SQL generator must create neighborhood rows itself — no per-metro one-off script required')
  assert.ok(sql.includes("'Downtown'"), 'the real, item-populated canonical neighborhood must be created')
  assert.ok(sql.includes("'Quiet Suburb'"), 'the zero-item canonical neighborhood must STILL be created, via the documented fallback centroid')
  assert.ok(sql.includes('44.6') && sql.includes('-88.2'), "the zero-item neighborhood's real, documented fallback centroid coordinates must appear in the generated SQL")
  assert.ok(sql.includes('is_active'), 'neighborhoods are created with is_active set')
})

test('driveMetroLaunch (Chief Phase 2AL): a canonical neighborhood with zero items AND no fallback centroid fails the package closed rather than fabricating a coordinate', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptTagSelection(executor)
  const { candidates, certs } = twoCleanCandidates()
  const projectId = 'missing-fallback-centroid-test'
  await seed(runStore, projectId, candidates, certs)

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      metroAreaFacts: { name: 'Test Metro', state: 'WI', timezone: 'America/Chicago' },
      metroAreaSlug: 'test-metro',
      canonicalNeighborhoods: ['Downtown', 'No Data Hood'],
      // Deliberately no emptyNeighborhoodFallbackCentroids entry for 'No Data Hood'.
      fetchExistingProductionInventory: async () => [],
      placesLookup: basePlacesLookup(),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Test Metro',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )

  assert.equal(run.status, 'BLOCKED')
  assert.match(run.jerryReason ?? '', /No Data Hood/)
  assert.match(run.jerryReason ?? '', /never fabricate/i)
})

// --- 4/5. Final ready-to-apply audit: auto-invoked, and a failure prevents READY framing ---

test('driveMetroLaunch (Chief Phase 2AL): finalReadyToApplyAudit is invoked AUTOMATICALLY — no caller action required', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptTagSelection(executor)
  const { candidates, certs } = twoCleanCandidates()
  const projectId = 'auto-final-audit-test'
  await seed(runStore, projectId, candidates, certs)

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
      placesLookup: basePlacesLookup(),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async (plan) =>
        plan
          .filter((p) => p.kind !== 'CURATED_MIRROR')
          .map((p) => ({ label: p.label, exists: true, isOfficial: true, isPublic: true, metroId: 'test-metro', expectedMetroId: 'test-metro', startsAt: null, endsAt: null, goesPublicAt: null, isFeaturedEligible: p.kind === 'PRIMARY_SEASONAL', expectedFeaturedEligible: p.kind === 'PRIMARY_SEASONAL', listItemsCount: p.itemCandidateNames.length, expectedItemCount: p.itemCandidateNames.length, everyMembershipResolves: true, requiresImage: true, hasImage: true, returnedByRuntimeQuery: true })),
      checkImageReadiness: async (plan) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: true })),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Test Metro',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )

  const state = run.state as { finalReadyToApplyAudit?: { verdict: string; reasons: string[] }; finalCertificationReport?: { verdict: string } }
  assert.ok(state.finalReadyToApplyAudit, 'finalReadyToApplyAudit must be present in state WITHOUT the test ever calling it directly — proves auto-wiring')
  assert.equal(state.finalReadyToApplyAudit!.verdict, 'READY_TO_APPLY', `expected a clean run to pass the auto-wired audit: ${JSON.stringify(state.finalReadyToApplyAudit)}`)
  assert.match(String(run.decisionPacket?.chiefRecommendation ?? ''), /FINAL_READY_TO_APPLY_AUDIT also passed/)
})

// --- Chief Phase 2AM: PRE_APPLY vs POST_APPLY, wired at the real driver level ---

test('driveMetroLaunch (Chief Phase 2AM): a brand-new metro reaches READY_TO_APPLY on the auto-wired final audit even though NO production public.lists rows exist yet — PRE_APPLY package validation must never require rows the package itself is about to create', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptTagSelection(executor)
  const { candidates, certs } = twoCleanCandidates()
  const projectId = 'pre-apply-no-rows-test'
  await seed(runStore, projectId, candidates, certs)

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
      placesLookup: basePlacesLookup(),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      // The real pre-apply state (and exactly Florence's real situation):
      // no public.lists rows exist yet for a metro that has never been
      // applied — HOME_LIST_CERTIFICATION_GATE (the live POST_APPLY read)
      // genuinely FAILs here, on purpose.
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkImageReadiness: async (plan) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: true })),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Test Metro',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )

  const state = run.state as { finalReadyToApplyAudit?: { verdict: string; reasons: string[] }; finalCertificationReport?: { failingGates?: { key: string }[] } }
  assert.ok(
    state.finalCertificationReport?.failingGates?.some((g) => g.key === 'HOME_LIST_CERTIFICATION_GATE'),
    'sanity check: the live POST_APPLY gate must genuinely be failing here (no rows exist) — otherwise this test would not be proving anything'
  )
  assert.ok(state.finalReadyToApplyAudit, 'finalReadyToApplyAudit must still have run automatically')
  assert.equal(
    state.finalReadyToApplyAudit!.verdict,
    'READY_TO_APPLY',
    `a well-formed, not-yet-applied package must reach READY_TO_APPLY on PRE_APPLY validation alone: ${JSON.stringify(state.finalReadyToApplyAudit)}`
  )
})

test('driveMetroLaunch (Chief Phase 2AL): a failed final audit prevents READY framing even when every individual gate already passed', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptTagSelection(executor)
  const { candidates, certs } = twoCleanCandidates()
  const projectId = 'final-audit-blocks-ready-test'
  await seed(runStore, projectId, candidates, certs)

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
      // Both candidates resolve to the SAME real Google Place ID and
      // address — a genuine unresolved same-venue cluster (e.g. two
      // catalog entries that turn out to be the same physical venue).
      // The Places result's `name` still echoes each query so per-item
      // GEO_ENRICHMENT_GATE name-matching passes cleanly for both — only
      // the shared placeId/address makes this a duplicate, not a mismatch.
      // Every individual gate (DISTINCTIVE_EXPERIENCE_GATE,
      // TAG_CERTIFICATION_GATE, GEO_ENRICHMENT_GATE, etc.) still PASSes for
      // each item on its own; only the auto-wired final audit catches that
      // the cluster was never explicitly resolved.
      placesLookup: async (q: string) => ({ topResult: { placeId: 'p-shared-venue', name: q, formattedAddress: '1 Main St, Green Bay, WI 54301, USA', lat: 44.51, lng: -88.01, websiteUri: null, country: 'US' as const, viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async (plan) =>
        plan
          .filter((p) => p.kind !== 'CURATED_MIRROR')
          .map((p) => ({ label: p.label, exists: true, isOfficial: true, isPublic: true, metroId: 'test-metro', expectedMetroId: 'test-metro', startsAt: null, endsAt: null, goesPublicAt: null, isFeaturedEligible: p.kind === 'PRIMARY_SEASONAL', expectedFeaturedEligible: p.kind === 'PRIMARY_SEASONAL', listItemsCount: p.itemCandidateNames.length, expectedItemCount: p.itemCandidateNames.length, everyMembershipResolves: true, requiresImage: true, hasImage: true, returnedByRuntimeQuery: true })),
      checkImageReadiness: async (plan) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: true })),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Test Metro',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )

  const state = run.state as { finalReadyToApplyAudit?: { verdict: string; reasons: string[] }; finalCertificationReport?: { verdict: string } }
  assert.ok(state.finalReadyToApplyAudit, 'the audit must still have run automatically')
  assert.equal(state.finalReadyToApplyAudit!.verdict, 'BLOCKED', `expected the shared-Place-ID cluster to block the final audit: ${JSON.stringify(state.finalReadyToApplyAudit)}`)
  assert.ok(state.finalReadyToApplyAudit!.reasons.some((r) => r.includes('same-Place-ID cluster')), 'the specific reason must name the unresolved cluster')
  // Winston must not call the package ready even though the underlying
  // per-item certification gates all passed individually.
  const recommendation = String(run.decisionPacket?.chiefRecommendation ?? '')
  assert.match(recommendation, /has NOT passed/)
  assert.doesNotMatch(recommendation, /Recommend approving public launch/, 'must never recommend launch approval while the final audit is blocked')
})
