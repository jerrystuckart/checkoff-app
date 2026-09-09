// Chief Phase 2AF — editorial Home-list theming. Pure logic tests, built
// from patterns/false-positives found in the REAL Vienna certified
// catalog (2026-09-09): a naive \bbar\b-style match hits "baroque", the
// canonical 'bar-food' tag is assigned far beyond real bars, and several
// certified candidates are the same real venue phrased two different
// ways ("Prater Dome" / "Praterdome").

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemMatchesTheme, buildEditorialThemedLists, selectFlagshipList, isSameVenue, normalizedVenueKey, THEMED_LIST_DEFINITIONS, type ThemeableItem, type ThemedListDefinition } from './homeListThemes'
import type { RealDbCategory } from './metroCatalog'

function item(overrides: Partial<ThemeableItem> & { candidateName: string }): ThemeableItem {
  return {
    venueName: overrides.candidateName,
    finalBody: `Do the real thing at '${overrides.candidateName}'.`,
    finalTags: [],
    dbCategory: 'Misc' as RealDbCategory,
    attempts: 1,
    ...overrides,
  }
}

test('itemMatchesTheme: word-boundary keyword matching never false-positives on a substring (the real "baroque" contains "bar" bug)', () => {
  const afterDark = THEMED_LIST_DEFINITIONS.find((d) => d.id === 'after_dark')!
  const baroque = item({ candidateName: 'Am Hof square', finalBody: "Find the baroque architecture and atmosphere many visitors miss at 'Am Hof square'.", dbCategory: 'Arts & Culture' })
  assert.equal(itemMatchesTheme(baroque, afterDark), false, '"baroque" must never match a bare "bar" pattern')

  const realBar = item({ candidateName: 'Kleinod', finalBody: "Order a signature gin cocktail at the award-winning 'Kleinod'.", dbCategory: 'Bar & drinks' })
  assert.equal(itemMatchesTheme(realBar, afterDark), true, 'a genuine cocktail bar must still match')
})

test('itemMatchesTheme: a category match qualifies outright even with no keyword text present', () => {
  const afterDark = THEMED_LIST_DEFINITIONS.find((d) => d.id === 'after_dark')!
  const nightclub = item({ candidateName: 'Grelle Forelle', finalBody: "Catch a techno night at 'Grelle Forelle'.", dbCategory: 'Nightlife' })
  assert.equal(itemMatchesTheme(nightclub, afterDark), true)
})

test('normalizedVenueKey / isSameVenue: catches spacing/punctuation/accent-only differences, never merges genuinely different venues that merely share one word', () => {
  assert.equal(normalizedVenueKey('Prater Dome'), normalizedVenueKey('Praterdome'))
  assert.equal(isSameVenue('Prater Dome', 'Praterdome'), true)
  assert.equal(isSameVenue("St. Stephen's Cathedral", 'St. Stephen’s Cathedral'), true, 'a straight vs curly apostrophe must not create a fake distinct venue')

  // Real Vienna false-positive risk: two DIFFERENT district museums sharing the word "Bezirksmuseum".
  assert.equal(isSameVenue('Bezirksmuseum Währing', 'Bezirksmuseum Meidling'), false, 'sharing one generic word must never merge two different real venues')

  // Real Vienna word-subset case: the same M3 discovery bundle described with extra/fewer words.
  assert.equal(isSameVenue('Augarten Baroque Park & Porcelain Manufactory', 'Augarten park and Augarten Porcelain Manufactory'), true)
})

test('buildEditorialThemedLists: a candidate theme with fewer than minItems real matches is dropped entirely — never shipped half-supported', () => {
  const thinDef: ThemedListDefinition = { id: 'thin', title: 'Thin Theme', patterns: [/\bunobtanium\b/] }
  const items = [item({ candidateName: 'A', finalBody: "See the 'unobtanium' display at 'A'." }), item({ candidateName: 'B', finalBody: "See the 'unobtanium' display at 'B'." })]
  const result = buildEditorialThemedLists(items, [thinDef], 3)
  assert.deepEqual(result, [])
})

test('buildEditorialThemedLists: a theme can cross real production category lines when the real content supports it', () => {
  const def: ThemedListDefinition = { id: 'mixed', title: 'Mixed Theme', patterns: [/\bwine\b/] }
  const items = [
    item({ candidateName: 'Wine Bar A', finalBody: "Order 'wine' at 'Wine Bar A'.", dbCategory: 'Bar & drinks' }),
    item({ candidateName: 'Wine Museum B', finalBody: "See a 'wine' exhibit at 'Wine Museum B'.", dbCategory: 'Arts & Culture' }),
    item({ candidateName: 'Wine Shop C', finalBody: "Buy 'wine' at 'Wine Shop C'.", dbCategory: 'Shopping' }),
  ]
  const result = buildEditorialThemedLists(items, [def], 3)
  assert.equal(result.length, 1)
  assert.deepEqual(result[0]!.candidateNames.sort(), ['Wine Bar A', 'Wine Museum B', 'Wine Shop C'])
})

test('buildEditorialThemedLists: near-duplicate venues within a theme collapse to one representative, never two slots for the same real place', () => {
  const def: ThemedListDefinition = { id: 'club', title: 'Clubs', patterns: [/\bdisco\b/] }
  const items = [
    item({ candidateName: 'Prater Dome', venueName: 'Prater Dome', finalBody: "Dance at 'Prater Dome', a real disco." }),
    item({ candidateName: 'Praterdome', venueName: 'Praterdome', finalBody: "Dance at 'Praterdome', a real disco." }),
    item({ candidateName: 'Other Disco', venueName: 'Other Disco', finalBody: "Dance at 'Other Disco', a real disco." }),
  ]
  const result = buildEditorialThemedLists(items, [def], 2)
  assert.equal(result[0]!.candidateNames.length, 2, 'Prater Dome/Praterdome must collapse to one slot')
})

test('selectFlagshipList: returns every item unchanged when the catalog is already at or under the target size', () => {
  const items = [item({ candidateName: 'A' }), item({ candidateName: 'B' })]
  const result = selectFlagshipList(items, 30)
  assert.equal(result.length, 2)
})

test('selectFlagshipList: caps at approximately the target size and never exceeds the real available inventory for a thin category', () => {
  const items: ThemeableItem[] = []
  for (let i = 0; i < 80; i++) items.push(item({ candidateName: `Arts Venue Number${i}`, dbCategory: 'Arts & Culture' }))
  for (let i = 0; i < 2; i++) items.push(item({ candidateName: `Spa Venue Number${i}`, dbCategory: 'Spa & self-care' }))
  const result = selectFlagshipList(items, 30)
  assert.ok(result.length <= 31 && result.length >= 29, `expected ~30, got ${result.length}`)
  const spaCount = result.filter((n) => n.startsWith('Spa')).length
  assert.ok(spaCount <= 2, 'never allocates more slots to a category than it has real items')
})

test('selectFlagshipList: proportional balance — a much larger category gets more slots than a much smaller one, but the smaller one is never zeroed out entirely if it has real inventory', () => {
  const items: ThemeableItem[] = []
  for (let i = 0; i < 100; i++) items.push(item({ candidateName: `Big Arts Venue Number${i}`, dbCategory: 'Arts & Culture' }))
  for (let i = 0; i < 10; i++) items.push(item({ candidateName: `Small Sports Venue Number${i}`, dbCategory: 'Sports' }))
  const result = selectFlagshipList(items, 30)
  const bigCount = result.filter((n) => n.startsWith('Big')).length
  const smallCount = result.filter((n) => n.startsWith('Small')).length
  assert.ok(bigCount > smallCount)
  assert.ok(smallCount >= 1, 'a real, non-trivial category must never be zeroed out of the flagship list entirely')
})

test('selectFlagshipList: near-duplicate venues collapse before allocation, so the same real place never takes two flagship slots', () => {
  const items: ThemeableItem[] = []
  items.push(item({ candidateName: 'Prater Dome', venueName: 'Prater Dome', dbCategory: 'Nightlife' }))
  items.push(item({ candidateName: 'Praterdome', venueName: 'Praterdome', dbCategory: 'Nightlife' }))
  for (let i = 0; i < 40; i++) items.push(item({ candidateName: `Arts ${i}`, dbCategory: 'Arts & Culture' }))
  const result = selectFlagshipList(items, 30)
  const nightlifeInResult = result.filter((n) => n === 'Prater Dome' || n === 'Praterdome')
  assert.ok(nightlifeInResult.length <= 1)
})

test('selectFlagshipList: deterministic — the same input catalog (regardless of input array order) always produces the same selection', () => {
  const items: ThemeableItem[] = []
  for (let i = 0; i < 50; i++) items.push(item({ candidateName: `X${i}`, dbCategory: i % 2 === 0 ? 'Arts & Culture' : 'Food & drink', attempts: (i % 3) + 1 }))
  const a = selectFlagshipList(items, 30)
  const shuffled = [...items].reverse()
  const b = selectFlagshipList(shuffled, 30)
  assert.deepEqual([...a].sort(), [...b].sort())
})
