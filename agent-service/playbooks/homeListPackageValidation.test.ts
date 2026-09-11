// Chief Phase 2AM (2026-09-11) — PRE_APPLY vs POST_APPLY regression tests.
//
// Real bug this fixes: finalReadyToApplyAudit.ts used to wire
// `homeListCountsReconcile` directly to HOME_LIST_CERTIFICATION_GATE, a
// live public.lists/public.list_items READ that can only PASS after Jerry
// has actually applied the generated SQL. That made a brand-new metro's
// own not-yet-applied package permanently unable to reach READY_TO_APPLY —
// rows the package is ABOUT to create can never pre-exist.
//
// Fixed with two independent checks:
//   - PRE_APPLY (homeListCertification.ts's HOME_LIST_PACKAGE_VALIDATION_GATE,
//     via derivePackageValidationFromSql) — validates the generated SQL
//     package itself (titles, official/public flags, metro ownership,
//     item-link counts). No DB read, always required.
//   - POST_APPLY (the pre-existing HOME_LIST_CERTIFICATION_GATE live read) —
//     only required once executionState is no longer 'GENERATED'.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { derivePackageValidationFromSql, evaluateHomeListPackageValidationGate, type HomeListPackagePlanEntry } from './homeListCertification'
import { evaluateFinalReadyToApplyAudit } from './finalReadyToApplyAudit'

type PlanEntry = { label: string; title: string; kind: string; itemCandidateNames: readonly string[] }

const PLAN: PlanEntry[] = [
  { label: 'Fall 2026 — Test Metro', title: 'Fall 2026 — Test Metro', kind: 'PRIMARY_SEASONAL', itemCandidateNames: ['Alpha Diner', 'Bravo Bistro'] },
  { label: 'Themed list: After Dark', title: 'After Dark', kind: 'THEMED', itemCandidateNames: ['Charlie Speakeasy'] },
  { label: 'Curated-layer mirror', title: 'Curated-layer mirror', kind: 'CURATED_MIRROR', itemCandidateNames: ['Alpha Diner', 'Bravo Bistro', 'Charlie Speakeasy'] },
]

/** A well-formed SQL package matching exactly the shape buildHomeListSqlPatch() emits (see derivePackageValidationFromSql's own doc) — one anchor + creation block + N list_items inserts per Home-visible list, in plan order. CURATED_MIRROR is correctly never emitted here (that's a separate patch pattern). */
function wellFormedSql(): string {
  return [
    `BEGIN;`,
    `DO $$`,
    `BEGIN`,
    `  SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title = 'Fall 2026 — Test Metro' AND is_official = true;`,
    `  IF v_list_id IS NULL THEN`,
    `    INSERT INTO public.lists (metro_id, title, is_official, is_public, creator_id, is_featured_eligible)`,
    `    VALUES (v_metro_id, 'Fall 2026 — Test Metro', true, true, 'creator-id', true)`,
    `    RETURNING id INTO v_list_id;`,
    `  END IF;`,
    `  INSERT INTO public.list_items (list_id, item_id) VALUES (v_list_id, v_item_id) ON CONFLICT (list_id, item_id) DO NOTHING;`,
    `  INSERT INTO public.list_items (list_id, item_id) VALUES (v_list_id, v_item_id) ON CONFLICT (list_id, item_id) DO NOTHING;`,
    `  SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title = 'After Dark' AND is_official = true;`,
    `  IF v_list_id IS NULL THEN`,
    `    INSERT INTO public.lists (metro_id, title, is_official, is_public, creator_id)`,
    `    VALUES (v_metro_id, 'After Dark', true, true, 'creator-id')`,
    `    RETURNING id INTO v_list_id;`,
    `  END IF;`,
    `  INSERT INTO public.list_items (list_id, item_id) VALUES (v_list_id, v_item_id) ON CONFLICT (list_id, item_id) DO NOTHING;`,
    `END $$;`,
    `COMMIT;`,
  ].join('\n')
}

function goodInputExcept(overrides: Record<string, unknown> = {}) {
  return {
    outOfMarketContaminationVerdict: 'PASS' as const,
    allDuplicateClustersResolved: true,
    allItemsCertified: true,
    emptyNeighborhoods: [] as string[],
    placesCompletenessVerdict: 'PASS' as const,
    listTitlesWithInternalPrefix: [] as string[],
    reusedItemsAdditiveOnly: true,
    sqlSafetyVerdict: 'PASS' as const,
    executionState: 'GENERATED' as const,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. A brand-new metro with valid generated Home-list SQL can pass
//    PRE_APPLY even when no production list rows exist.
// ---------------------------------------------------------------------------

test('derivePackageValidationFromSql + evaluateHomeListPackageValidationGate: PASS on a well-formed, not-yet-applied package', () => {
  const entries = derivePackageValidationFromSql(PLAN, wellFormedSql(), 'test-metro')
  assert.equal(entries.length, 2, 'CURATED_MIRROR must be excluded from package validation, same as SQL generation itself')
  const result = evaluateHomeListPackageValidationGate(entries)
  assert.equal(result.gate.verdict, 'PASS', result.gate.reason)
})

test('evaluateFinalReadyToApplyAudit: a brand-new metro reaches READY_TO_APPLY on PRE_APPLY package validation alone — no production list rows are required or checked before execution', () => {
  const entries = derivePackageValidationFromSql(PLAN, wellFormedSql(), 'test-metro')
  const packageResult = evaluateHomeListPackageValidationGate(entries)
  const result = evaluateFinalReadyToApplyAudit(
    goodInputExcept({
      // executionState stays 'GENERATED' (Winston never applies SQL) and
      // liveVerificationValid is deliberately OMITTED — simulating the
      // real pre-apply state where public.lists has zero rows for this
      // brand-new metro. This must NOT block.
      homeList: { packageValid: packageResult.gate.verdict === 'PASS' },
    })
  )
  assert.equal(result.verdict, 'READY_TO_APPLY', JSON.stringify(result.reasons))
})

// ---------------------------------------------------------------------------
// 2. Malformed/missing list creation in the SQL still blocks — PRE_APPLY
//    is a real validation of the generated package, never a rubber stamp.
// ---------------------------------------------------------------------------

test('derivePackageValidationFromSql: FAILs when the SQL never creates one of the planned lists at all', () => {
  const brokenSql = wellFormedSql().replace(
    `  SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title = 'After Dark' AND is_official = true;\n  IF v_list_id IS NULL THEN\n    INSERT INTO public.lists (metro_id, title, is_official, is_public, creator_id)\n    VALUES (v_metro_id, 'After Dark', true, true, 'creator-id')\n    RETURNING id INTO v_list_id;\n  END IF;\n  INSERT INTO public.list_items (list_id, item_id) VALUES (v_list_id, v_item_id) ON CONFLICT (list_id, item_id) DO NOTHING;\n`,
    '' // "After Dark" is silently missing from the SQL entirely
  )
  const entries = derivePackageValidationFromSql(PLAN, brokenSql, 'test-metro')
  const result = evaluateHomeListPackageValidationGate(entries)
  assert.equal(result.gate.verdict, 'FAIL')
  assert.match(result.gate.reason, /After Dark/)
})

test('derivePackageValidationFromSql: FAILs when the SQL links fewer items than the plan intends (an incomplete/truncated package)', () => {
  // Drop ONE of the two list_items inserts for the flagship list — the
  // list itself is created correctly, but only 1/2 intended items are
  // actually linked.
  const brokenSql = wellFormedSql().replace(
    `  INSERT INTO public.list_items (list_id, item_id) VALUES (v_list_id, v_item_id) ON CONFLICT (list_id, item_id) DO NOTHING;\n  INSERT INTO public.list_items (list_id, item_id) VALUES (v_list_id, v_item_id) ON CONFLICT (list_id, item_id) DO NOTHING;\n  SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title = 'After Dark'`,
    `  INSERT INTO public.list_items (list_id, item_id) VALUES (v_list_id, v_item_id) ON CONFLICT (list_id, item_id) DO NOTHING;\n  SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title = 'After Dark'`
  )
  const entries = derivePackageValidationFromSql(PLAN, brokenSql, 'test-metro')
  const flagship = entries.find((e) => e.title === 'Fall 2026 — Test Metro')!
  assert.equal(flagship.sqlLinkedItemCount, 1)
  assert.equal(flagship.expectedItemCount, 2)
  const result = evaluateHomeListPackageValidationGate(entries)
  assert.equal(result.gate.verdict, 'FAIL')
  assert.match(result.gate.reason, /links 1 item\(s\).*intends 2/)
})

test('derivePackageValidationFromSql: FAILs when a list is inserted with is_official/is_public not both true (a malformed creation block)', () => {
  const brokenSql = wellFormedSql().replace(`VALUES (v_metro_id, 'After Dark', true, true, 'creator-id')`, `VALUES (v_metro_id, 'After Dark', true, false, 'creator-id')`)
  const entries = derivePackageValidationFromSql(PLAN, brokenSql, 'test-metro')
  const afterDark = entries.find((e) => e.title === 'After Dark')!
  assert.equal(afterDark.sqlCreatesListCorrectly, false)
  const result = evaluateHomeListPackageValidationGate(entries)
  assert.equal(result.gate.verdict, 'FAIL')
})

test('evaluateFinalReadyToApplyAudit: a malformed package (missing list creation) is BLOCKED, never waved through as READY_TO_APPLY', () => {
  const result = evaluateFinalReadyToApplyAudit(
    goodInputExcept({
      homeList: { packageValid: false, packageIssues: ['1/2 planned Home-visible list(s) failed PRE_APPLY package validation: Themed list: After Dark [...]'] },
    })
  )
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.includes('PRE_APPLY package validation failed')))
})

// ---------------------------------------------------------------------------
// 3. POST_APPLY verification still fails if expected production rows are
//    absent after Jerry has actually executed the SQL — the human
//    boundary (Winston never executes public.* SQL itself) is preserved;
//    this only exercises what a future/explicit post-apply caller would
//    see if the real rows still weren't there after execution.
// ---------------------------------------------------------------------------

test('evaluateFinalReadyToApplyAudit: PRE_APPLY passing is NOT enough once executionState says the package was actually applied — POST_APPLY absence still blocks', () => {
  const result = evaluateFinalReadyToApplyAudit(
    goodInputExcept({
      executionState: 'APPLIED' as const, // Jerry has run the SQL
      homeList: { packageValid: true, liveVerificationValid: false, liveVerificationIssues: ['no row exists in public.lists at all'] },
    })
  )
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.includes('POST_APPLY verification failed')))
})

test('evaluateFinalReadyToApplyAudit: POST_APPLY is required (missing is a failure, never silently skipped) once executionState is no longer GENERATED', () => {
  const result = evaluateFinalReadyToApplyAudit(
    goodInputExcept({
      executionState: 'APPLIED' as const,
      homeList: { packageValid: true }, // liveVerificationValid omitted entirely
    })
  )
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.includes('POST_APPLY live verification') && r.includes('missing')))
})

test('evaluateFinalReadyToApplyAudit: once POST_APPLY verification genuinely passes (real rows found), the audit reaches READY_TO_APPLY', () => {
  const result = evaluateFinalReadyToApplyAudit(
    goodInputExcept({
      executionState: 'APPLIED' as const,
      homeList: { packageValid: true, liveVerificationValid: true },
    })
  )
  assert.equal(result.verdict, 'READY_TO_APPLY', JSON.stringify(result.reasons))
})

test('evaluateFinalReadyToApplyAudit: PRE_APPLY (executionState GENERATED) never requires or checks POST_APPLY at all, even if liveVerificationValid happens to be present and false', () => {
  // Defense-in-depth: proves the GENERATED branch genuinely skips
  // liveVerificationValid rather than happening to pass because it was
  // omitted — this must stay READY even if some future caller populates a
  // stale/false liveVerificationValid before execution.
  const result = evaluateFinalReadyToApplyAudit(
    goodInputExcept({
      executionState: 'GENERATED' as const,
      homeList: { packageValid: true, liveVerificationValid: false, liveVerificationIssues: ['not applied yet'] },
    })
  )
  assert.equal(result.verdict, 'READY_TO_APPLY', JSON.stringify(result.reasons))
})
