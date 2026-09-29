import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupRegistrationRows, missingConfigHeadline } from './registrationRowGroups.js'

const rows = [
  { item_id: 'a', item_name: 'A', distance_m: 50, state: 'monitored' },
  { item_id: 'b', item_name: 'B', distance_m: 60, state: 'excluded: no_visit_profile_assigned' },
  { item_id: 'c', item_name: 'C', distance_m: 70, state: 'excluded: manual_only_profile' },
  { item_id: 'd', item_name: 'D', distance_m: 80, state: 'excluded: exceeds_region_cap' },
  { item_id: 'e', item_name: 'E', distance_m: 90, state: 'excluded: no_visit_profile_assigned' },
  { item_id: 'f', item_name: 'F', distance_m: 95, state: 'excluded: inactive' },
]

test('splits monitored, missing configuration, intentional and structural exclusions', () => {
  const g = groupRegistrationRows(rows)
  assert.deepEqual(g.monitored.map((r) => r.item_id), ['a'])
  assert.deepEqual(g.missingConfig.map((r) => r.item_id), ['b', 'e'])
  assert.deepEqual(g.intentional.map((r) => r.item_id), ['c'])
  assert.deepEqual(g.other.map((r) => r.item_id), ['d', 'f'])
})

test('headline names the incomplete-data problem and how many; null when nothing is missing', () => {
  assert.match(missingConfigHeadline(groupRegistrationRows(rows)), /^2 nearby items have no visit profile/)
  assert.match(missingConfigHeadline(groupRegistrationRows([rows[1]])), /^1 nearby item has no visit profile/)
  assert.equal(missingConfigHeadline(groupRegistrationRows([rows[0], rows[2]])), null)
  assert.equal(missingConfigHeadline(groupRegistrationRows(null)), null)
})
