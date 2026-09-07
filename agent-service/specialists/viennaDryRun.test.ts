// Chief Phase 2W — the required Vienna DRY-RUN proof (per Jerry's
// explicit instruction: "Do NOT build Vienna production content yet...
// Run a synthetic/dry integration proof through the actual metro
// driver"). Every executor here is the deterministic TestExecutor —
// nothing touches the network, OpenAI, or any real database. This test
// exists to PROVE the real driver (driveMetroLaunch), not a standalone
// library function, actually invokes:
//   - every required phase, M0 through METRO_LAUNCH_CERTIFICATION
//   - the ITEM_CERTIFICATION_LOOP, including a real self-repair pass on
//     a deliberately generic first draft
//   - official Home-list mirror generation (plan + SQL patch)
//   - a final certification that BLOCKS on an intentionally missing
//     image, and becomes READY_TO_ACTIVATE once that condition is
//     satisfied and every other gate is wired to a passing real source

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'
import type { HomeListRow } from '../playbooks/homeListCertification'
import type { ImageReadinessCard } from '../playbooks/imageReadiness'
import type { VerifiedTagSnapshot } from './tagVocabularyProvider'
import { InMemoryGeoEnrichmentCacheStore } from './metroGeoEnrichmentDriver'

const PROJECT_ID = 'vienna-austria-dry-run'

const PLAN: CategoryCoveragePlan = {
  targets: [
    { categoryName: 'Food & drink', minimumViable: 1, healthyTarget: 2, qualityNotes: [] },
    { categoryName: 'Arts & Culture', minimumViable: 1, healthyTarget: 1, qualityNotes: [] },
  ],
}

const RESOLVED_M0 = {
  geographicScope: 'Innere Stadt + Leopoldstadt, dry-run only',
  categoryCatalogTargets: 'Food & drink (1/2), Arts & Culture (1/1)',
  launchSeason: null,
  executionGoAhead: true,
}

const SNAPSHOT: VerifiedTagSnapshot = {
  version: 1,
  capturedAt: '2026-09-07',
  justification: 'dry-run fixture standing in for a real captured production tag export',
  tagNames: ['coffee', 'live music', 'historic', 'family friendly', 'outdoor', 'museum', 'hidden gem'],
}
const VALID_TAGS = ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'museum']

function buildExecutor(): TestExecutor {
  const executor = new TestExecutor()

  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { neighborhoods: [{ name: 'Innere Stadt', kind: 'core_urban', ring1RadiusM: 500, ring2RadiusM: 1500 }] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )

  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          candidates: [
            { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Innere Stadt', claimSupported: 'a real, specific Viennese coffeehouse dish', source: 'https://example.com/cafe-sperl', address: '11 Gumpendorfer Strasse, Vienna' },
            { name: 'Kunsthistorisches Museum', category: 'Arts & Culture', neighborhood: 'Innere Stadt', claimSupported: 'a real, specific gallery piece', source: 'https://example.com/khm', address: 'Maria-Theresien-Platz, Vienna' },
          ],
        },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )

  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => {
      const checked = ((r.inputs as { candidates?: Array<{ name: string }> }).candidates ?? []).map((c) => c.name)
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { verifiedCandidateNames: checked, removedCandidateNames: [] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
    }
  )

  // M6_5 write pass: Cafe Sperl gets a genuinely specific first draft.
  // Kunsthistorisches Museum DELIBERATELY gets a generic first draft —
  // this is the self-repair proof: it must fail critique on attempt 1
  // and be rewritten before it can certify.
  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR',
    (r) => {
      const venue = (r.inputs as { businessOrPlace?: string }).businessOrPlace ?? ''
      const body = venue === 'Kunsthistorisches Museum' ? `Explore exhibits at '${venue}'.` : `Order the 'Sperl Torte' at '${venue}'.`
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: (r.inputs as { factualSource?: string }).factualSource ?? '', checkoffizedItem: body, tags: VALID_TAGS }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )

  // M7 critique — independent pass. The deliberately generic museum
  // draft genuinely fails (no swap-test-rescuing detail); the coffeehouse
  // draft genuinely passes on attempt 1.
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) => {
      const body = (r.inputs as { body?: string }).body ?? ''
      const genuinelyGeneric = /Explore exhibits at/.test(body)
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          hasConcreteAction: !genuinelyGeneric,
          moreSpecificThanVenuePurpose: !genuinelyGeneric,
          supportedByResearch: true,
          isCurrent: true,
          tellsUsefulNonObviousDetail: !genuinelyGeneric,
          soundsLikeCheckoff: !genuinelyGeneric,
          concise: true,
          critiqueNotes: genuinelyGeneric ? 'generic, venue-level — could describe any museum' : 'specific and research-supported',
        },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
    }
  )

  // M7 rewrite — only reached for the museum item after its first
  // critique fails. Returns a genuinely specific second draft.
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'REWRITE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { checkoffizedItem: `See Klimt's 'Kiss' preparatory sketch at '${(r.inputs as { businessOrPlace?: string }).businessOrPlace}'.`, tags: VALID_TAGS },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )

  return executor
}

async function driveToBoundary(executor: TestExecutor, checkImageReadiness: (plan: readonly { label: string; requiresImage: boolean }[]) => Promise<ImageReadinessCard[]>) {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  await getOrCreateRun(runStore, 'metro_launch', PROJECT_ID, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', PROJECT_ID))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const verifyHomeListRows = async (plan: readonly { label: string; kind: string; itemCandidateNames: string[] }[]): Promise<HomeListRow[]> =>
    plan
      .filter((p) => p.kind !== 'CURATED_MIRROR')
      .map((p) => ({
        label: p.label,
        exists: true,
        isOfficial: true,
        isPublic: true,
        metroId: PROJECT_ID,
        expectedMetroId: PROJECT_ID,
        startsAt: null,
        endsAt: null,
        goesPublicAt: null,
        isFeaturedEligible: p.kind === 'PRIMARY_SEASONAL',
        expectedFeaturedEligible: p.kind === 'PRIMARY_SEASONAL',
        listItemsCount: p.itemCandidateNames.length,
        expectedItemCount: p.itemCandidateNames.length,
        everyMembershipResolves: true,
        requiresImage: true,
        hasImage: true,
        returnedByRuntimeQuery: true,
      }))

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      queryLiveTags: async () => {
        throw new Error('no live DB access in this dry run — snapshot fallback expected')
      },
      verifiedTagSnapshot: SNAPSHOT,
      placesLookup: async (q: string) => ({ topResult: { placeId: 'p-' + q, name: q.includes('Gumpendorfer') ? 'Cafe Sperl' : 'Kunsthistorisches Museum', formattedAddress: q, lat: 48.2, lng: 16.37, websiteUri: 'https://example.at', country: 'AT', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      expectedCountry: 'AT',
      verifyHomeListRows,
      checkImageReadiness,
    },
    PROJECT_ID,
    { categoryPlan: PLAN }
  )
  return { run, runStore, execStore }
}

test('Vienna DRY RUN: the real driver invokes every required phase, self-repairs a generic item, generates the Home-list mirror, and BLOCKS on missing images', async () => {
  const executor = buildExecutor()
  const { run, execStore } = await driveToBoundary(executor, async (plan) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: false })))

  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'LAUNCH_READINESS_BOUNDARY')

  const state = run.state as any

  // Every required phase actually ran (real execution records, not faked).
  const all = await execStore.all()
  assert.ok(all.some((e) => e.request.stage === 'M1_GEOGRAPHY_MAP'), 'M1 geography ran')
  assert.ok(all.some((e) => e.request.stage === 'M3_BROAD_DISCOVERY'), 'M3 broad discovery ran')
  assert.ok(all.some((e) => e.request.stage === 'M6_QUALITY_VERIFICATION'), 'M6 verification ran')
  assert.ok(all.some((e) => e.request.stage === 'M6_5_CHECKOFF_EDITOR'), 'M6.5 checkoff editor ran')
  assert.ok(all.some((e) => e.request.stage === 'M7_ITEM_CERTIFICATION'), 'M7 item certification ran')

  // ITEM_CERTIFICATION_LOOP: self-repair actually happened for the museum item.
  const museum = state.itemCertifications['Kunsthistorisches Museum']
  assert.equal(museum.outcome, 'ITEM_CERTIFIED')
  assert.equal(museum.attempts, 2, 'the museum item needed a real second attempt — this is the self-repair proof')
  assert.match(museum.finalBody, /Klimt/, 'the rewritten body is the genuinely specific second draft, not the generic first one')
  assert.ok(museum.rejectionReasons.length >= 1, 'the rejection from attempt 1 is preserved in the durable per-item record')

  const cafe = state.itemCertifications['Cafe Sperl']
  assert.equal(cafe.outcome, 'ITEM_CERTIFIED')
  assert.equal(cafe.attempts, 1, 'the specific first draft certified without needing repair')

  // A rewrite execution really happened for the museum item, and only the museum item.
  const rewrites = all.filter((e) => e.request.stage === 'M7_ITEM_CERTIFICATION' && (e.request.inputs as any).mode === 'REWRITE')
  assert.equal(rewrites.length, 1)
  assert.match(String(rewrites[0].request.objective), /Kunsthistorisches Museum/)

  // Official Home-list mirror was generated: a real plan and a real SQL patch.
  assert.ok(state.homeListPlan.length >= 2, 'at least the primary seasonal list and one themed/mirror list were planned')
  assert.ok(state.homeListPlan.some((p: any) => p.kind === 'PRIMARY_SEASONAL'))
  assert.match(state.homeListSqlPatch, /DO \$\$/)
  assert.match(state.homeListSqlPatch, /INSERT INTO public\.lists/)
  assert.doesNotMatch(state.homeListSqlPatch, /CREATE TEMP(ORARY)? TABLE/i, 'no cross-statement TEMP-table dependence in the generated patch')

  // Final certification: BLOCKED on images only — every other real gate passed.
  const report = state.finalCertificationReport
  assert.equal(report.verdict, 'BLOCKED')
  assert.equal(report.imageSelectionOnlyBlock, true, 'every other required gate passed — only image selection remains')
  assert.match(report.reportText, /BLOCKED — image selection required/)
  assert.match(run.jerryReason ?? '', /launch-readiness boundary/)
  assert.match(String(run.decisionPacket?.chiefRecommendation ?? ''), /image selection required/)
})

test('Vienna DRY RUN: once the missing images are resolved, METRO_LAUNCH_CERTIFICATION reaches READY_TO_ACTIVATE', async () => {
  const executor = buildExecutor()
  const { run, runStore } = await driveToBoundary(executor, async (plan) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: false })))
  assert.equal((run.state as any).finalCertificationReport.verdict, 'BLOCKED')

  // Reset to re-run M10 with the SAME run, now with images satisfied —
  // exactly how a real resumed run re-evaluates after Jerry finishes a
  // human step (same resume pattern the existing driver tests use).
  const stored = await runStore.get(playbookRunId('metro_launch', PROJECT_ID))
  stored!.currentStage = 'M10_METRO_LAUNCH_CERTIFICATION'
  stored!.status = 'RUNNING'
  await runStore.put(stored!)

  const execStore2 = new InMemoryExecutionStore()
  const verifyHomeListRows = async (plan: readonly { label: string; kind: string; itemCandidateNames: string[] }[]): Promise<HomeListRow[]> =>
    plan
      .filter((p) => p.kind !== 'CURATED_MIRROR')
      .map((p) => ({
        label: p.label,
        exists: true,
        isOfficial: true,
        isPublic: true,
        metroId: PROJECT_ID,
        expectedMetroId: PROJECT_ID,
        startsAt: null,
        endsAt: null,
        goesPublicAt: null,
        isFeaturedEligible: p.kind === 'PRIMARY_SEASONAL',
        expectedFeaturedEligible: p.kind === 'PRIMARY_SEASONAL',
        listItemsCount: p.itemCandidateNames.length,
        expectedItemCount: p.itemCandidateNames.length,
        everyMembershipResolves: true,
        requiresImage: true,
        hasImage: true,
        returnedByRuntimeQuery: true,
      }))

  const resumed = await driveMetroLaunch(
    {
      runStore,
      execStore: execStore2,
      executors: [executor],
      verifiedTagSnapshot: SNAPSHOT,
      placesLookup: async (q: string) => ({ topResult: { placeId: 'p-' + q, name: q.includes('Gumpendorfer') ? 'Cafe Sperl' : 'Kunsthistorisches Museum', formattedAddress: q, lat: 48.2, lng: 16.37, websiteUri: 'https://example.at', country: 'AT', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      expectedCountry: 'AT',
      verifyHomeListRows,
      checkImageReadiness: async (plan) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: true })),
    },
    PROJECT_ID,
    { categoryPlan: PLAN }
  )

  const finalReport = (resumed.state as any).finalCertificationReport
  assert.equal(finalReport.verdict, 'READY_TO_ACTIVATE', `expected READY_TO_ACTIVATE, got BLOCKED: ${finalReport.failingGates?.map((g: any) => g.key + ': ' + g.reason).join(' | ')}`)
  assert.equal(finalReport.missingGates.length, 0)
  assert.equal(finalReport.failingGates.length, 0)
  assert.match(finalReport.reportText, /READY_TO_ACTIVATE/)
  assert.match(String(resumed.decisionPacket?.chiefRecommendation ?? ''), /READY_TO_ACTIVATE/)
  // Public launch is STILL always a human decision — this driver never
  // auto-flips metro_areas.is_active, even when every gate is green.
  assert.equal(resumed.status, 'NEEDS_JERRY')
  assert.equal(resumed.currentStage, 'LAUNCH_READINESS_BOUNDARY')
})

test('Vienna DRY RUN: re-running M8_BATCH_CERTIFICATION (a resumed run re-evaluating geo enrichment) makes zero new paid Places calls — the cache is reused across driver passes, not just within one', async () => {
  const executor = buildExecutor()
  const geoEnrichmentCache = new InMemoryGeoEnrichmentCacheStore()
  let paidCalls = 0
  const placesLookup = async (q: string) => {
    paidCalls++
    return { topResult: { placeId: 'p-' + q, name: q.includes('Gumpendorfer') ? 'Cafe Sperl' : 'Kunsthistorisches Museum', formattedAddress: q, lat: 48.2, lng: 16.37, websiteUri: 'https://example.at', country: 'AT', viewportRadiusM: null }, apiError: null }
  }

  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  await getOrCreateRun(runStore, 'metro_launch', PROJECT_ID, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', PROJECT_ID))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const firstPass = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], verifiedTagSnapshot: SNAPSHOT, placesLookup, geoEnrichmentCache, expectedCountry: 'AT', verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkImageReadiness: async (plan) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: false })) },
    PROJECT_ID,
    { categoryPlan: PLAN }
  )
  assert.equal(paidCalls, 2, 'exactly one real Places call per unique venue on the first pass')
  assert.equal((firstPass.state as any).geoEnrichmentPaidCalls, 2)

  // Reset to re-enter M8_BATCH_CERTIFICATION for a SECOND time against
  // the SAME cache — simulating a resumed run re-evaluating gates (e.g.
  // after a repair pass elsewhere) without ever having applied a code
  // change that would invalidate the cache.
  const stored = await runStore.get(playbookRunId('metro_launch', PROJECT_ID))
  stored!.currentStage = 'M8_BATCH_CERTIFICATION'
  stored!.status = 'RUNNING'
  await runStore.put(stored!)

  const secondPass = await driveMetroLaunch(
    { runStore, execStore: new InMemoryExecutionStore(), executors: [executor], verifiedTagSnapshot: SNAPSHOT, placesLookup, geoEnrichmentCache, expectedCountry: 'AT', verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkImageReadiness: async (plan) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: false })) },
    PROJECT_ID,
    { categoryPlan: PLAN }
  )
  assert.equal(paidCalls, 2, 'REGRESSION: the second pass through M8 must make ZERO additional Places calls — the cache is metro-scoped and durable across driver re-entries')
  assert.equal((secondPass.state as any).geoEnrichmentCacheHits, 2)
})
