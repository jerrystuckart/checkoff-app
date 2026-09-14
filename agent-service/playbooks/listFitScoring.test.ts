import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreItemForList, scoreItemsForLists, filterCandidatesByListFit, DEFAULT_LIST_FIT_INCLUDE_THRESHOLD, type ListFitCandidate, type ListFitListDefinition } from './listFitScoring'

function item(overrides: Partial<ListFitCandidate> & { candidateName: string }): ListFitCandidate {
  return { venueName: overrides.candidateName, dbCategory: 'Food & drink', finalTags: [], finalBody: 'A body describing the venue.', ...overrides }
}

test('scoreItemForList: catalog inclusion never implies list inclusion — an unconfigured list always scores 0/EXCLUDE', () => {
  const result = scoreItemForList(item({ candidateName: 'Cafe A' }), { title: 'Empty List' })
  assert.equal(result.score, 0)
  assert.equal(result.verdict, 'EXCLUDE')
})

test('scoreItemForList: an item can independently score fit for zero lists (belongs to none)', () => {
  const nightlife: ListFitListDefinition = { title: 'After Dark', categories: ['Nightlife'], tags: ['cocktail-bar'] }
  const result = scoreItemForList(item({ candidateName: 'Quiet Bookstore', dbCategory: 'Shopping', finalTags: ['used-books'] }), nightlife)
  assert.equal(result.verdict, 'EXCLUDE')
})

test('scoreItemForList: strong multi-signal match scores INCLUDE with a clear reason', () => {
  const nightlife: ListFitListDefinition = { title: 'After Dark', categories: ['Nightlife'], tags: ['cocktail-bar'], patterns: [/\bspeakeasy\b/] }
  const result = scoreItemForList(item({ candidateName: 'Hidden Speakeasy', dbCategory: 'Nightlife', finalTags: ['cocktail-bar'], finalBody: 'Find the speakeasy behind the fridge door.' }), nightlife)
  assert.equal(result.verdict, 'INCLUDE')
  assert.equal(result.score, 1)
  assert.match(result.reason, /category/)
})

test('scoreItemForList: a single weak signal out of several configured falls below the threshold', () => {
  const nightlife: ListFitListDefinition = { title: 'After Dark', categories: ['Nightlife'], tags: ['cocktail-bar'], patterns: [/\bspeakeasy\b/] }
  const result = scoreItemForList(item({ candidateName: 'Rooftop Restaurant', dbCategory: 'Food & drink', finalTags: [], finalBody: 'A rooftop dinner spot with city views.' }), nightlife)
  assert.equal(result.score, 0)
  assert.equal(result.verdict, 'EXCLUDE')
  assert.ok(result.score < DEFAULT_LIST_FIT_INCLUDE_THRESHOLD)
})

test('scoreItemsForLists: full matrix covers every item x list pair', () => {
  const items = [item({ candidateName: 'A' }), item({ candidateName: 'B' })]
  const lists: ListFitListDefinition[] = [{ title: 'L1', categories: ['Food & drink'] }, { title: 'L2', categories: ['Shopping'] }]
  const matrix = scoreItemsForLists(items, lists)
  assert.equal(matrix.length, 4)
})

test('filterCandidatesByListFit: never adds names beyond the proposed set, only narrows — catalog/list separation in practice', () => {
  const artsList: ListFitListDefinition = { title: 'Arts & Culture Crawl', categories: ['Arts & Culture'] }
  const items = [item({ candidateName: 'Museum A', dbCategory: 'Arts & Culture' }), item({ candidateName: 'Cafe B', dbCategory: 'Food & drink' })]
  const { included, excluded } = filterCandidatesByListFit(['Museum A', 'Cafe B'], items, artsList)
  assert.deepEqual(included, ['Museum A'])
  assert.equal(excluded.length, 1)
  assert.equal(excluded[0]!.candidateName, 'Cafe B')
})

test('filterCandidatesByListFit: a candidate missing from the scoring data is never silently included', () => {
  const list: ListFitListDefinition = { title: 'L', categories: ['Food & drink'] }
  const { included, excluded } = filterCandidatesByListFit(['Unknown Item'], [], list)
  assert.deepEqual(included, [])
  assert.deepEqual(excluded, [])
})

test('idempotent: scoring the same item/list pair twice produces identical results', () => {
  const list: ListFitListDefinition = { title: 'After Dark', categories: ['Nightlife'], tags: ['cocktail-bar'] }
  const candidate = item({ candidateName: 'Speakeasy', dbCategory: 'Nightlife', finalTags: ['cocktail-bar'] })
  assert.deepEqual(scoreItemForList(candidate, list), scoreItemForList(candidate, list))
})
