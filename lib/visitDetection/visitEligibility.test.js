import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyVisitEligibility } from './visitEligibility.js'

// Regression coverage from the House of Honey investigation: visit
// detection excludes any item without an assigned visit_profile_key — a
// broad, pre-existing gap (most production items have none), not something
// introduced by SQL-based item intake and not something this fix changes.
// These tests pin the existing decision table so it can't silently drift.

const PROFILES = {
  fast_casual: { manual_only: false, candidate_dwell_minutes: 8, strong_dwell_minutes: 20 },
  manual_profile: { manual_only: true, candidate_dwell_minutes: 5, strong_dwell_minutes: 15 },
}

test('an active, non-universal item with a real (non-manual) profile is eligible', () => {
  const item = { id: 'hoh', is_universal: false, is_active: true, visit_profile_key: 'fast_casual' }
  const decision = classifyVisitEligibility(item, PROFILES, 0)
  assert.deepEqual(decision, { eligible: true })
})

test('an item with no visit_profile_key assigned is excluded — the House of Honey / most-items case', () => {
  const item = { id: 'hoh', is_universal: false, is_active: true, visit_profile_key: null }
  const decision = classifyVisitEligibility(item, PROFILES, 0)
  assert.equal(decision.eligible, false)
  assert.equal(decision.reason, 'no_visit_profile_assigned')
})

test('a universal item is excluded regardless of profile', () => {
  const item = { id: 'x', is_universal: true, is_active: true, visit_profile_key: 'fast_casual' }
  assert.equal(classifyVisitEligibility(item, PROFILES, 0).reason, 'universal_item')
})

test('an inactive item is excluded regardless of profile', () => {
  const item = { id: 'x', is_universal: false, is_active: false, visit_profile_key: 'fast_casual' }
  assert.equal(classifyVisitEligibility(item, PROFILES, 0).reason, 'inactive')
})

test('a manual_only profile is excluded from automatic geofence monitoring', () => {
  const item = { id: 'x', is_universal: false, is_active: true, visit_profile_key: 'manual_profile' }
  assert.equal(classifyVisitEligibility(item, PROFILES, 0).reason, 'manual_only_profile')
})

test('the region cap excludes items once the monitored set is full, not before', () => {
  const item = { id: 'x', is_universal: false, is_active: true, visit_profile_key: 'fast_casual' }
  assert.equal(classifyVisitEligibility(item, PROFILES, 18).eligible, true) // 19th slot (index 18) still fits
  assert.equal(classifyVisitEligibility(item, PROFILES, 19).reason, 'exceeds_region_cap')
})
