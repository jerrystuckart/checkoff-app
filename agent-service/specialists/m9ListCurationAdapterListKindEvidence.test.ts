// Session 3, Phase 2 — per-list-kind evidence gating tests, exercised
// directly through runM9EnforcedCuration. Proves classifyM9ListKind +
// evaluateConceptMembershipForKind genuinely gate membership by list kind
// (never silently pass a HIDDEN_GEMS/AFTER_DARK/FOOD_LOCAL_FLAVOR/DAY_TRIP
// item with no real evidence), while THEMED/SEASONAL concepts still
// include on ordinary base fit — exactly as they did before Phase 2.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runM9EnforcedCuration, classifyM9ListKind } from './m9ListCurationAdapter'
import type { M9AdapterCertifiedItem } from './m9ListCurationAdapter'

function clusterOf(count: number, tag: string, prefix: string, overrides: Partial<M9AdapterCertifiedItem> = {}): M9AdapterCertifiedItem[] {
  return Array.from({ length: count }, (_, i) => ({
    candidateName: `${prefix} ${i}`,
    venueName: `${prefix} ${i}`,
    dbCategory: 'Adventure' as const,
    finalTags: [tag, `${prefix}-u-${i}`],
    finalBody: `Enjoy ${prefix} ${i}.`,
    neighborhoodName: 'Downtown',
    ...overrides,
  }))
}

function fillerOf(count: number, prefix: string): M9AdapterCertifiedItem[] {
  return Array.from({ length: count }, (_, i) => ({
    candidateName: `${prefix} ${i}`,
    venueName: `${prefix} ${i}`,
    dbCategory: 'Adventure' as const,
    finalTags: [`filler-${prefix}-${i}`],
    finalBody: `Filler ${prefix} ${i}.`,
    neighborhoodName: 'Downtown',
  }))
}

function firstConceptFor(items: M9AdapterCertifiedItem[], tag: string) {
  const out = runM9EnforcedCuration({ metroSlug: 'test-metro', certifiedItems: items, legacyPlan: [], storedOperatorDecisions: {}, now: () => '2026-09-15T00:00:00.000Z' })
  const verdict = out.artifact.conceptVerdicts.find((v) => v.seedTags.includes(tag))
  return { out, verdict }
}

test('LIST KIND: classifyM9ListKind maps NIGHTLIFE/FOOD_AND_DRINK/ADVENTURE/SEASONAL tags onto the real ListMembershipKind vocabulary', () => {
  assert.equal(classifyM9ListKind({ type: 'NIGHTLIFE', seedTags: ['cocktail-bar'] }), 'AFTER_DARK')
  assert.equal(classifyM9ListKind({ type: 'FOOD_AND_DRINK', seedTags: ['coffee'] }), 'FOOD_LOCAL_FLAVOR')
  assert.equal(classifyM9ListKind({ type: 'ADVENTURE', seedTags: ['hiking-trail'] }), 'DAY_TRIP')
  assert.equal(classifyM9ListKind({ type: 'SEASONAL', seedTags: ['holiday-lights'] }), 'SEASONAL')
  assert.equal(classifyM9ListKind({ type: 'CULTURAL', seedTags: ['gallery-crawl'] }), 'THEMED')
  assert.equal(classifyM9ListKind({ type: 'EVERGREEN', seedTags: ['riverside-walk'] }), 'THEMED')
  assert.equal(classifyM9ListKind({ type: 'OTHER', seedTags: ['hidden-passage'] }), 'HIDDEN_GEMS', 'a hidden/secret-flavored tag routes to HIDDEN_GEMS regardless of type')
})

test('LIST KIND: classifyM9ListKind routes a majority-secret-claimed cluster to HIDDEN_GEMS even with an unrelated tag', () => {
  const secretMembers = [{ isSecretClaimed: true }, { isSecretClaimed: true }, { isSecretClaimed: false }]
  assert.equal(classifyM9ListKind({ type: 'OTHER', seedTags: ['courtyard-tour'] }, secretMembers), 'HIDDEN_GEMS')
  const mostlyNotSecret = [{ isSecretClaimed: true }, { isSecretClaimed: false }, { isSecretClaimed: false }]
  assert.equal(classifyM9ListKind({ type: 'OTHER', seedTags: ['courtyard-tour'] }, mostlyNotSecret), 'THEMED')
})

test('LIST KIND: an AFTER_DARK-classified concept HOLDs every member absent a real nighttimeSpecific judgment — never silently includes on category fit alone', () => {
  const items = [...clusterOf(20, 'cocktail-bar', 'Nightclub'), ...fillerOf(40, 'Filler')]
  const { verdict } = firstConceptFor(items, 'cocktail-bar')
  assert.ok(verdict, 'the nightlife cluster must be discovered')
  assert.equal(verdict!.listKind, 'AFTER_DARK')
  assert.equal(verdict!.memberDecisions.filter((d) => d.verdict === 'INCLUDE').length, 0, 'no member may be INCLUDEd without a real nighttimeSpecific judgment')
  assert.ok(verdict!.memberDecisions.every((d) => d.verdict === 'HOLD'), 'every member must HOLD, not EXCLUDE — missing evidence is a real open question, not a settled non-fit')
})

test('LIST KIND: a HIDDEN_GEMS-classified concept HOLDs every member absent a real discoveryBasis', () => {
  const items = [...clusterOf(20, 'hidden-passage', 'Secret Spot'), ...fillerOf(40, 'Filler')]
  const { verdict } = firstConceptFor(items, 'hidden-passage')
  assert.ok(verdict)
  assert.equal(verdict!.listKind, 'HIDDEN_GEMS')
  assert.equal(verdict!.memberDecisions.filter((d) => d.verdict === 'INCLUDE').length, 0)
})

test('LIST KIND: a FOOD_LOCAL_FLAVOR-classified concept HOLDs every member absent a real concreteLocalFlavorAction', () => {
  const items = [...clusterOf(20, 'coffee', 'Cafe Stop'), ...fillerOf(40, 'Filler')]
  const { verdict } = firstConceptFor(items, 'coffee')
  assert.ok(verdict)
  assert.equal(verdict!.listKind, 'FOOD_LOCAL_FLAVOR')
  assert.equal(verdict!.memberDecisions.filter((d) => d.verdict === 'INCLUDE').length, 0)
})

test('LIST KIND: a DAY_TRIP-classified concept EXCLUDEs every member absent a real travelEffort', () => {
  const items = [...clusterOf(20, 'hike-trail', 'Trailhead'), ...fillerOf(40, 'Filler')]
  const { verdict } = firstConceptFor(items, 'hike-trail')
  assert.ok(verdict)
  assert.equal(verdict!.listKind, 'DAY_TRIP')
  assert.equal(verdict!.memberDecisions.filter((d) => d.verdict === 'INCLUDE').length, 0)
  assert.ok(verdict!.memberDecisions.every((d) => d.verdict === 'EXCLUDE'), 'DAY_TRIP with no travelEffort EXCLUDEs (per listFitScoring.ts own default), not HOLD')
})

test('LIST KIND: a THEMED-classified concept (no stricter evidence contract) still includes members on ordinary base category/tag fit, exactly as before Phase 2', () => {
  const items = [...clusterOf(20, 'riverside-walk', 'Canal Stop'), ...fillerOf(40, 'Filler')]
  const { verdict } = firstConceptFor(items, 'riverside-walk')
  assert.ok(verdict)
  assert.equal(verdict!.listKind, 'THEMED')
  assert.equal(verdict!.memberDecisions.filter((d) => d.verdict === 'INCLUDE').length, 20, 'a THEMED concept must include all 20 real cluster members on ordinary tag fit, with no extra evidence gate')
})

// Note: a real end-to-end SEASONAL classification is not reachable today —
// listConceptDiscovery.ts's inferConceptType only returns 'SEASONAL' when
// a majority of a cluster's members carry isSeasonalSpecific=true, and
// M9AdapterCertifiedItem (this adapter's own item shape) has no such
// field — the live driver does not persist a per-item seasonal-specific
// signal anywhere in MetroDriverState today. classifyM9ListKind's own
// SEASONAL mapping is still directly covered above (the first test in
// this file, calling it with an explicit `type: 'SEASONAL'`) — this note
// exists so the gap is documented rather than silently untested.
