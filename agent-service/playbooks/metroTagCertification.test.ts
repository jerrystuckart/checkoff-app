import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateItemTags, evaluateTagCertificationGate, MIN_TAGS_PER_ITEM, MAX_TAGS_PER_ITEM } from './metroTagCertification'

const KNOWN_TAGS = new Set(['cocktails', 'nightlife', 'coastal', 'family-friendly', 'outdoor', 'historic', 'live-music', 'craft-beer', 'seafood', 'romantic'])

test('zero-tag metro cannot certify', () => {
  const result = evaluateTagCertificationGate([], KNOWN_TAGS)
  assert.equal(result.gate.verdict, 'FAIL')
  assert.match(result.gate.reason, /cannot pass on an empty catalog/)
})

test('tag count outside 6-8 cannot certify', () => {
  const tooFew = validateItemTags({ candidateName: 'a', tags: ['cocktails', 'nightlife', 'coastal', 'historic', 'seafood'] }, KNOWN_TAGS)
  assert.equal(tooFew.valid, false)
  assert.match(tooFew.issues.join(' '), /only 5 tag\(s\)/)

  const tooMany = validateItemTags({ candidateName: 'b', tags: ['cocktails', 'nightlife', 'coastal', 'historic', 'seafood', 'outdoor', 'family-friendly', 'live-music', 'romantic'] }, KNOWN_TAGS)
  assert.equal(tooMany.valid, false)
  assert.match(tooMany.issues.join(' '), /9 tag\(s\)/)
})

test('a valid 6-tag and a valid 8-tag item both pass', () => {
  const six = validateItemTags({ candidateName: 'a', tags: ['cocktails', 'nightlife', 'coastal', 'historic', 'seafood', 'outdoor'] }, KNOWN_TAGS)
  assert.equal(six.valid, true)
  const eight = validateItemTags({ candidateName: 'b', tags: ['cocktails', 'nightlife', 'coastal', 'historic', 'seafood', 'outdoor', 'family-friendly', 'live-music'] }, KNOWN_TAGS)
  assert.equal(eight.valid, true)
})

// The real San Diego lesson: "cocktails" exists in production, "cocktail" (singular) did not.
test('nonexistent/singularized production tag fails before SQL execution — never auto-corrected', () => {
  const result = validateItemTags({ candidateName: 'a', tags: ['cocktail', 'nightlife', 'coastal', 'historic', 'seafood', 'outdoor'] }, KNOWN_TAGS)
  assert.equal(result.valid, false)
  assert.deepEqual(result.unknownNames, ['cocktail'])
  assert.match(result.issues.join(' '), /never auto-corrected\/singularized\/pluralized/)
})

test('duplicate tag names within one item are rejected', () => {
  const result = validateItemTags({ candidateName: 'a', tags: ['cocktails', 'cocktails', 'coastal', 'historic', 'seafood', 'outdoor'] }, KNOWN_TAGS)
  assert.equal(result.valid, false)
  assert.match(result.issues.join(' '), /duplicate tag/)
})

test('evaluateTagCertificationGate: a fully valid catalog passes', () => {
  const proposals = [
    { candidateName: 'a', tags: ['cocktails', 'nightlife', 'coastal', 'historic', 'seafood', 'outdoor'] },
    { candidateName: 'b', tags: ['cocktails', 'nightlife', 'coastal', 'historic', 'seafood', 'outdoor', 'family-friendly', 'romantic'] },
  ]
  const result = evaluateTagCertificationGate(proposals, KNOWN_TAGS)
  assert.equal(result.gate.verdict, 'PASS')
  assert.equal(result.perItem.every((p) => p.valid), true)
})

test('evaluateTagCertificationGate: one bad item among many still fails the whole gate', () => {
  const proposals = [
    { candidateName: 'a', tags: ['cocktails', 'nightlife', 'coastal', 'historic', 'seafood', 'outdoor'] },
    { candidateName: 'bad', tags: ['cocktail'] }, // wrong name AND too few
  ]
  const result = evaluateTagCertificationGate(proposals, KNOWN_TAGS)
  assert.equal(result.gate.verdict, 'FAIL')
  assert.match(result.gate.reason, /bad/)
})

test('MIN_TAGS_PER_ITEM and MAX_TAGS_PER_ITEM are 6 and 8', () => {
  assert.equal(MIN_TAGS_PER_ITEM, 6)
  assert.equal(MAX_TAGS_PER_ITEM, 8)
})
