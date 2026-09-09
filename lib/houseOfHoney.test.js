import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWithinNearbyRadius, rankNearbyItems } from './nearbyRanking.js'
import { mergeSearchMatchCounts } from './searchMatch.js'
import { classifyVisitEligibility } from './visitDetection/visitEligibility.js'

// End-to-end regression coverage for the House of Honey discoverability
// bug: a brand-new, active, correctly-geocoded item with NO list membership
// (we intentionally never auto-add new items to lists) must be discoverable
// through every relevant surface. None of these paths may require list
// membership, a themed/seasonal list, or any tag at all to be eligible.

const MI = 1609.34

// A brand-new Peoria item, standing in for House of Honey: active,
// approved, valid coordinates, zero tags, zero list_items rows, no
// visit_profile_key assigned (matches real production state for ~88% of
// items today — a pre-existing, unrelated gap, not something this item's
// SQL intake introduced).
const newPeoriaItem = {
  id: 'house-of-honey',
  dist_m: 5, // effectively "right here" — the user is standing at the venue
  is_universal: false,
  is_active: true,
  visit_profile_key: null,
}

test('1. a newly inserted active item with valid coordinates and no list membership is within the automatic Nearby radius', () => {
  assert.equal(isWithinNearbyRadius(newPeoriaItem.dist_m), true)
})

test('2. the same item is discoverable by typed name search even when an unrelated tag substring-matches the query', () => {
  // Searching "house" matches tags like "steakhouse"/"lighthouse" that this
  // item does NOT have — its own body text ("House of Honey") must still
  // surface it.
  const tagItemRows = [
    { item_id: 'steakhouse-item', tag_id: 't1' },
    { item_id: 'lighthouse-item', tag_id: 't2' },
  ]
  const bodyMatchIds = [newPeoriaItem.id]
  const counts = mergeSearchMatchCounts(tagItemRows, bodyMatchIds)
  assert.ok(newPeoriaItem.id in counts, 'item must appear in search results via its own body text')
})

test('3. it participates in closest-item ranking on equal footing with tagged/listed items', () => {
  const far = { id: 'far-item', dist_m: 20 * MI }
  const ranked = rankNearbyItems([far, newPeoriaItem], {})
  assert.equal(ranked[0].id, newPeoriaItem.id, 'the item standing distance away must rank closest')
})

test('4. if it has a visit-detection profile assigned, it is considered eligible — list membership plays no role', () => {
  const withProfile = { ...newPeoriaItem, visit_profile_key: 'fast_casual' }
  const profiles = { fast_casual: { manual_only: false } }
  const decision = classifyVisitEligibility(withProfile, profiles, 0)
  assert.deepEqual(decision, { eligible: true })
})

test('4b. (documented, pre-existing, unrelated to this fix) no visit_profile_key means visit detection does not consider it', () => {
  const profiles = { fast_casual: { manual_only: false } }
  const decision = classifyVisitEligibility(newPeoriaItem, profiles, 0)
  assert.equal(decision.reason, 'no_visit_profile_assigned')
})

test('5. the pending 100-mile Nearby cutoff still excludes Tucson/Milwaukee/San Diego from the same Peoria vantage point', () => {
  const tucson = { id: 'tucson', dist_m: 121 * MI }
  const milwaukee = { id: 'milwaukee', dist_m: 1462 * MI }
  const sanDiego = { id: 'san-diego', dist_m: 325 * MI }
  for (const far of [tucson, milwaukee, sanDiego]) {
    assert.equal(isWithinNearbyRadius(far.dist_m), false, `${far.id} must stay excluded`)
  }
  // And the new local item still wins against all of them if somehow merged pre-filter.
  const merged = [tucson, milwaukee, sanDiego, newPeoriaItem].filter(i => isWithinNearbyRadius(i.dist_m))
  assert.deepEqual(merged.map(i => i.id), [newPeoriaItem.id])
})
