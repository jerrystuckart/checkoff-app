// Chief Phase 2AN (2026-09-11) — real driver-level regression tests for
// the Florence apply failure: `expected exactly 1 public.items row with
// the certified body for "Basilica and complex of San Lorenzo", found 0
// — has this item been created yet via Item Intake?`
//
// Root cause: buildHomeListSqlPatch() never created public.items rows for
// a brand-new metro's own certified catalog — it only linked list_items
// by matching an existing body text, on the WRONG assumption that a
// separate, un-run Item Intake pass had already created them. The real
// per-item METADATA_COMPLETENESS_GATE data (has_alcohol/checkin_type/
// difficulty/photo_required/is_secret/visit_profile_key) was already being
// computed every M8 pass — it was just thrown away as a local variable
// (`metadataResults`) instead of persisted to state, so M9 had nothing to
// build an INSERT from even though the pipeline had already done the work.
//
// These tests drive the REAL driver (never a hand-called library function)
// through a real M8 pass (so metadata/geo/tags are genuinely computed, not
// hand-faked) and inspect the real generated SQL text.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import { scriptPassingMetroFinisher } from './testMetroFinisherFixture'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'
import { InMemoryGeoEnrichmentCacheStore } from './metroGeoEnrichmentDriver'
import type { VerifiedTagSnapshot } from './tagVocabularyProvider'
import { evaluateFinalReadyToApplyAudit } from '../playbooks/finalReadyToApplyAudit'
import { evaluateItemProvenanceGate, derivePackageValidationFromSql, evaluateHomeListPackageValidationGate } from '../playbooks/homeListCertification'

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
  return async (q: string) => ({ topResult: { placeId: `p-${q}`, name: q, formattedAddress: `${q}, Green Bay, WI 54301, USA`, lat: 44.51, lng: -88.01, websiteUri: 'https://example.com/site', country: 'US' as const, viewportRadiusM: 50 }, apiError: null })
}

async function runFullDriver(overrides: Partial<Parameters<typeof driveMetroLaunch>[0]> = {}, projectId = 'item-creation-test') {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const { candidates, certs } = twoCleanCandidates()
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
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkImageReadiness: async (plan) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: true })),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Test Metro',
      ...overrides,
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )
  return run
}

// ---------------------------------------------------------------------------
// 1/2/3. New public.items rows are actually created, item_tags generated,
//        Places/metadata fields survive into the generated SQL.
// ---------------------------------------------------------------------------

test('driveMetroLaunch (Chief Phase 2AN): a brand-new metro package actually creates public.items rows for its certified catalog, with item_tags and real cached Places/metadata fields — the exact Florence apply failure fixed', async () => {
  const run = await runFullDriver({}, 'item-creation-basic-test')
  const state = run.state as { homeListSqlPatch?: string }
  const sql = state.homeListSqlPatch ?? ''
  assert.ok(sql.length > 0, 'a SQL patch must have been generated')

  // 1. New items are actually INSERTed.
  assert.match(sql, /INSERT INTO public\.items \(/, 'the package must create public.items rows itself')
  assert.ok(sql.includes("'Try the triple-stack pancakes at \\'Alpha Diner\\'.'".replace(/\\'/g, "'")) || sql.includes(`'Try the triple-stack pancakes at ''Alpha Diner''.'`), 'the exact certified body must appear in an INSERT')
  assert.match(sql, /RETURNING id INTO v_item_id;/)

  // 2. item_tags are generated for each new item.
  assert.match(sql, /INSERT INTO public\.item_tags \(item_id, tag_id, source, confidence\)/)
  assert.ok(sql.includes("'coffee'") && sql.includes("'historic'"), 'the certified tags must be written verbatim')
  assert.match(sql, /expected % certified tag\(s\) for "%", found %/, 'a real, asserted tag-count safety check must be present')

  // 3. Real cached Places + metadata fields survive into the SQL — never
  //    left NULL/default when the pipeline actually resolved them.
  assert.ok(sql.includes('p-Alpha Diner') || sql.includes('p-Bravo Bistro'), 'the real cached google_place_id must appear in the INSERT')
  assert.ok(sql.includes('44.51') && sql.includes('-88.01'), 'real cached lat/lng must appear')
  assert.match(sql, /ST_SetSRID\(ST_MakePoint\(-88\.01, 44\.51\), 4326\)/, 'geo_location must be derived from the real cached coordinates, same formula as the rest of this codebase')
  assert.ok(sql.includes('https://example.com/site'), 'the real cached website_url must appear')
  assert.match(sql, /difficulty/, 'the real METADATA_COMPLETENESS_GATE-evaluated difficulty must be written, not left at an implicit default')

  // The pre-existing safety net (item must already exist) is now a
  // defense-in-depth "was this already applied?" guard, not the ONLY path.
  assert.match(sql, /already exists — this package must only be applied once/)

  // No SQL was executed.
  assert.equal(run.status, 'NEEDS_JERRY')
})

// ---------------------------------------------------------------------------
// 4. Existing reconciled items are reused rather than duplicated.
// ---------------------------------------------------------------------------

test('driveMetroLaunch (Chief Phase 2AN): an item reconciled to existing production inventory is linked by its real existing id, never re-created as a new public.items row', async () => {
  // Seeded directly at M9 (past M8/M8.5, which is where reconciliation +
  // reuse-pruning actually happen — proven separately by
  // existingInventoryReconciliation.test.ts and the reuseMatchedNames
  // pruning tests in metroLaunchDriver.test.ts). This test's own job is
  // narrower: given a real M8.5-shaped outcome (one certified NEW item,
  // one item already reconciled to REUSE and correctly absent from
  // itemCertifications), does buildHomeListSqlPatch actually link the
  // reused item by its real existing id, and actually NOT create a fresh
  // public.items row for it.
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const projectId = 'item-creation-reuse-test'
  const alphaCert: DriverItemCertificationRecord = {
    candidateName: 'Alpha Diner',
    venueName: 'Alpha Diner',
    attempts: 1,
    outcome: 'ITEM_CERTIFIED',
    finalBody: `Try the triple-stack pancakes at 'Alpha Diner'.`,
    finalTags: ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'craft beer'],
    supportingFact: 'Alpha Diner has a real specific dish.',
    verifiedAt: '2026-09-11T00:00:00.000Z',
    rejectionReasons: [],
    dbCategory: 'Food & drink',
  }
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = {
    m0Decisions: M0,
    // NOTE: 'Bravo Bistro' is deliberately ABSENT from candidates — real
    // M8.5 pruning removes a reuse-matched candidate from the retained
    // set entirely (reuseMatchedNames), so by the time M9 runs it was
    // never part of this metro's own candidate/certification state at all.
    candidates: [{ name: 'Alpha Diner', category: 'Food & drink', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://example.com/alpha', needsVerification: false }],
    neighborhoods: [],
    plan: PLAN,
    hasRunM6: true,
    itemCertifications: { 'Alpha Diner': alphaCert },
    batchCertificationGates: [],
    metadataEnrichmentResults: [
      {
        candidateName: 'Alpha Diner',
        hasAlcohol: { evaluated: true, value: false, confidence: 'HIGH', reason: 'test fixture' },
        photoRequired: { evaluated: true, value: false, confidence: 'HIGH', reason: 'test fixture' },
        checkinType: { evaluated: true, value: 'tap', confidence: 'HIGH', reason: 'test fixture' },
        isSecret: { evaluated: true, value: false, confidence: 'HIGH', reason: 'test fixture' },
        difficulty: { evaluated: true, value: 1, confidence: 'HIGH', reason: 'test fixture' },
        visitProfileKey: { evaluated: true, value: null, confidence: 'HIGH', reason: 'test fixture' },
        websiteUrl: { evaluated: false, reason: 'test fixture' },
      },
    ],
    geoEnrichmentResults: [{ candidateName: 'Alpha Diner', classification: 'EXACT', reason: 'test fixture', placeId: 'p-alpha-diner', formattedAddress: 'Alpha Diner, Downtown, Green Bay, WI', lat: 44.51, lng: -88.01, websiteUrl: 'https://example.com/alpha-site', geoRadiusM: null }],
    // The real, already-computed M8 reconciliation result — Bravo Bistro
    // classified REUSE against a real existing production item id.
    existingInventoryReconciliation: {
      reused: [{ candidateName: 'Bravo Bistro', existingItemId: 'existing-bravo-id', existingBody: `Try the triple-stack pancakes at 'Bravo Bistro'.`, matchedBy: 'google_place_id', sameExperience: true, experienceSimilarity: 1 }],
      distinctSameVenue: [],
      unmatched: [],
    },
  }
  seeded!.currentStage = 'M9_HOME_LIST_MIRROR'
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
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkImageReadiness: async (plan) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: true })),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Test Metro',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )

  const state = run.state as { homeListSqlPatch?: string }
  const sql = state.homeListSqlPatch ?? ''
  assert.ok(sql.length > 0, `expected a generated SQL patch, got run.status=${run.status} jerryReason=${run.jerryReason}`)
  assert.ok(sql.includes('existing-bravo-id'), "the real existing item's id must be linked directly")
  assert.ok(sql.includes('already-live production item(s) reused'), 'the reuse block must be present')
  const insertBlocks = sql.match(/INSERT INTO public\.items \(/g) ?? []
  assert.equal(insertBlocks.length, 1, 'only Alpha Diner (the genuinely new item) should get a fresh public.items INSERT — Bravo Bistro is reused, not recreated')
  assert.ok(!sql.includes(`Try the triple-stack pancakes at 'Bravo Bistro'.`.replace(/'/g, "''")), "Bravo Bistro's body must never appear in a public.items INSERT — it is linked purely by its existing id")
})

// ---------------------------------------------------------------------------
// 5. Home lists link to the newly inserted item ids (not a stale/guessed
//    id) — the list-linking SELECT-by-body-match now finds a row this
//    SAME transaction just inserted, immediately above it.
// ---------------------------------------------------------------------------

test('driveMetroLaunch (Chief Phase 2AN): Home list linking resolves against items this SAME package just created — item creation precedes list linking in the generated SQL', async () => {
  const run = await runFullDriver({}, 'item-creation-ordering-test')
  const state = run.state as { homeListSqlPatch?: string }
  const sql = state.homeListSqlPatch ?? ''
  const firstItemsInsertIdx = sql.indexOf('INSERT INTO public.items (')
  const firstListItemsLinkIdx = sql.indexOf('-- Fall 2026 — Test Metro')
  assert.ok(firstItemsInsertIdx >= 0 && firstListItemsLinkIdx >= 0)
  assert.ok(firstItemsInsertIdx < firstListItemsLinkIdx, 'item creation must appear BEFORE list-linking in the generated SQL, so the same-transaction body lookup finds a real row')
})

// ---------------------------------------------------------------------------
// 6. The package rolls back atomically on failure — one BEGIN/COMMIT
//    wrapping the entire DO $$ block, no intermediate commit point.
// ---------------------------------------------------------------------------

test('driveMetroLaunch (Chief Phase 2AN): the generated package is a single atomic transaction — one BEGIN, one DO $$...END $$, one COMMIT, no intermediate commit a partial failure could leave applied', async () => {
  const run = await runFullDriver({}, 'item-creation-atomicity-test')
  const state = run.state as { homeListSqlPatch?: string }
  const sql = state.homeListSqlPatch ?? ''
  const beginCount = (sql.match(/^BEGIN;$/gm) ?? []).length
  const commitCount = (sql.match(/^COMMIT;$/gm) ?? []).length
  const doBlockCount = (sql.match(/^DO \$\$$/gm) ?? []).length
  assert.equal(beginCount, 1, 'exactly one BEGIN — a partial failure anywhere in the block rolls back everything, including any items already inserted earlier in the same run')
  assert.equal(commitCount, 1, 'exactly one COMMIT — nothing is durable until the whole package (items, tags, lists, memberships) succeeds together')
  assert.equal(doBlockCount, 1, 'exactly one DO $$ block — every RAISE EXCEPTION anywhere in it aborts the whole transaction, never just that statement')
})

// ---------------------------------------------------------------------------
// 7. finalReadyToApplyAudit cannot PASS a list-only package for a new
//    metro — the real ITEM_PROVENANCE_GATE, exercised both as a pure
//    function against a hand-broken "list-only" SQL (the exact SHAPE the
//    old, buggy buildHomeListSqlPatch always produced) and against the
//    real driver's own (now-fixed) output.
// ---------------------------------------------------------------------------

test('evaluateItemProvenanceGate: FAILs a list-only package — list-linking SQL that references a certified item by body with no INSERT for it anywhere (the exact real Florence bug shape)', () => {
  const listOnlySql = [
    `BEGIN;`,
    `DO $$`,
    `BEGIN`,
    `  SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title = 'Fall 2026 — Florence Metro' AND is_official = true;`,
    `  IF v_list_id IS NULL THEN`,
    `    INSERT INTO public.lists (metro_id, title, is_official, is_public, creator_id, is_featured_eligible)`,
    `    VALUES (v_metro_id, 'Fall 2026 — Florence Metro', true, true, 'creator-id', true)`,
    `    RETURNING id INTO v_list_id;`,
    `  END IF;`,
    `  SELECT count(*) INTO v_match_count FROM public.items WHERE body = 'See the Old Sacristy, Medici Chapels, and Laurentian Library within the ''Basilica and complex of San Lorenzo''.';`,
    `  IF v_match_count <> 1 THEN RAISE EXCEPTION 'expected exactly 1 public.items row with the certified body for "%", found % — has this item been created yet via Item Intake?', 'Basilica and complex of San Lorenzo', v_match_count; END IF;`,
    `  SELECT id INTO v_item_id FROM public.items WHERE body = 'See the Old Sacristy, Medici Chapels, and Laurentian Library within the ''Basilica and complex of San Lorenzo''.';`,
    `  INSERT INTO public.list_items (list_id, item_id) VALUES (v_list_id, v_item_id) ON CONFLICT (list_id, item_id) DO NOTHING;`,
    `END $$;`,
    `COMMIT;`,
  ].join('\n')

  const result = evaluateItemProvenanceGate({
    certifiedNewItems: [{ candidateName: 'Basilica and complex of San Lorenzo', body: `See the Old Sacristy, Medici Chapels, and Laurentian Library within the 'Basilica and complex of San Lorenzo'.` }],
    sql: listOnlySql,
  })
  assert.equal(result.gate.verdict, 'FAIL')
  assert.match(result.gate.reason, /Basilica and complex of San Lorenzo/)

  const auditResult = evaluateFinalReadyToApplyAudit({
    outOfMarketContaminationVerdict: 'PASS',
    allDuplicateClustersResolved: true,
    allItemsCertified: true,
    emptyNeighborhoods: [],
    placesCompletenessVerdict: 'PASS',
    listTitlesWithInternalPrefix: [],
    homeList: { packageValid: true, itemProvenanceValid: false, itemProvenanceIssues: [result.gate.reason] },
    reusedItemsAdditiveOnly: true,
    sqlSafetyVerdict: 'PASS',
    executionState: 'GENERATED',
  })
  assert.equal(auditResult.verdict, 'BLOCKED', 'a list-only package for a new metro must never reach READY_TO_APPLY')
  assert.ok(auditResult.reasons.some((r) => r.includes('item provenance')))
})

test('driveMetroLaunch (Chief Phase 2AN): the real driver output PASSes ITEM_PROVENANCE_GATE (the fix actually closes the gap it was built to catch)', async () => {
  const run = await runFullDriver({}, 'item-creation-provenance-pass-test')
  const state = run.state as { homeListSqlPatch?: string; itemCertifications?: Record<string, DriverItemCertificationRecord> }
  const sql = state.homeListSqlPatch ?? ''
  const certifiedNewItems = Object.values(state.itemCertifications ?? {})
    .filter((r): r is DriverItemCertificationRecord & { finalBody: string } => r.outcome === 'ITEM_CERTIFIED' && r.finalBody !== null)
    .map((r) => ({ candidateName: r.candidateName, body: r.finalBody }))
  const result = evaluateItemProvenanceGate({ certifiedNewItems, sql })
  assert.equal(result.gate.verdict, 'PASS', result.gate.reason)

  const finalAudit = (run.state as { finalReadyToApplyAudit?: { verdict: string; reasons: string[] } }).finalReadyToApplyAudit
  assert.ok(finalAudit)
  assert.equal(finalAudit!.verdict, 'READY_TO_APPLY', JSON.stringify(finalAudit!.reasons))
})

test('derivePackageValidationFromSql + evaluateHomeListPackageValidationGate: the real driver output also PASSes the Home-list package gate (item creation did not break list packaging)', async () => {
  const run = await runFullDriver({}, 'item-creation-package-gate-test')
  const state = run.state as { homeListSqlPatch?: string; homeListPlan?: { label: string; title: string; kind: string; itemCandidateNames: readonly string[] }[] }
  const entries = derivePackageValidationFromSql(state.homeListPlan ?? [], state.homeListSqlPatch ?? '', 'test-metro')
  const result = evaluateHomeListPackageValidationGate(entries)
  assert.equal(result.gate.verdict, 'PASS', result.gate.reason)
})
