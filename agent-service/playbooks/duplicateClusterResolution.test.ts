import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDuplicateCluster, type DuplicateClusterMember } from './duplicateClusterResolution'

const SAME_PLACE = 'places/decisive-same'

test('resolveDuplicateCluster: decisive same-venue-same-experience cluster auto-resolves to DROP_DUPLICATE', () => {
  const members: DuplicateClusterMember[] = [
    { id: 'existing-1', venueName: "1919 Kitchen & Tap", placeId: SAME_PLACE, body: "Order the wood-fired flatbread at '1919 Kitchen & Tap' and grab a table on the riverside patio." },
    { id: 'candidate-2', venueName: "1919 Kitchen & Tap", placeId: SAME_PLACE, body: "Grab the wood-fired flatbread at '1919 Kitchen & Tap' and sit at a riverside patio table." },
  ]
  const result = resolveDuplicateCluster(members)
  assert.equal(result.verdict, 'DROP_DUPLICATE')
  assert.notEqual(result.verdict, 'NEEDS_HUMAN_REVIEW')
  assert.ok(result.keepId)
  assert.deepEqual(result.dropIds, members.filter((m) => m.id !== result.keepId).map((m) => m.id))
})

test('resolveDuplicateCluster: materially distinct experiences at the same venue resolve to KEEP_BOTH', () => {
  const members: DuplicateClusterMember[] = [
    { id: 'existing-1', venueName: 'Titletown Brewing Co', placeId: SAME_PLACE, body: "Sample the seasonal flight of six draft beers at 'Titletown Brewing Co', brewed on-site in the historic ice house." },
    { id: 'candidate-2', venueName: 'Titletown Brewing Co', placeId: SAME_PLACE, body: "Catch a live acoustic set on 'Titletown Brewing Co''s riverside stage on a Friday night, no cover charge." },
  ]
  const result = resolveDuplicateCluster(members)
  assert.equal(result.verdict, 'KEEP_BOTH')
})

test('resolveDuplicateCluster: a genuinely ambiguous cluster returns NEEDS_HUMAN_REVIEW', () => {
  const members: DuplicateClusterMember[] = [
    { id: 'existing-1', venueName: 'Lion’s Mouth Bookstore', placeId: SAME_PLACE, body: "Browse the staff-picked local author shelf and grab a coffee at 'Lion’s Mouth Bookstore' on a quiet afternoon." },
    { id: 'candidate-2', venueName: 'Lion’s Mouth Bookstore', placeId: SAME_PLACE, body: "Grab a coffee and browse the poetry section at 'Lion’s Mouth Bookstore' on a quiet weekend morning." },
  ]
  const result = resolveDuplicateCluster(members)
  assert.equal(result.verdict, 'NEEDS_HUMAN_REVIEW')
})

test('resolveDuplicateCluster: inconsistent Place IDs across members is MERGE_NOT_SUPPORTED, not auto-merged', () => {
  const members: DuplicateClusterMember[] = [
    { id: 'existing-1', venueName: 'Some Venue', placeId: 'places/a', body: "Do the thing at 'Some Venue'." },
    { id: 'candidate-2', venueName: 'Some Venue', placeId: 'places/b', body: "Do the thing at 'Some Venue'." },
  ]
  const result = resolveDuplicateCluster(members)
  assert.equal(result.verdict, 'MERGE_NOT_SUPPORTED')
})

test('resolveDuplicateCluster: fewer than 2 members is not a real cluster', () => {
  const result = resolveDuplicateCluster([{ id: 'only-1', venueName: 'X', placeId: 'places/x', body: 'body' }])
  assert.equal(result.verdict, 'KEEP_BOTH')
})
