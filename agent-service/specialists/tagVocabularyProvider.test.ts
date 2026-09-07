import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCanonicalTagVocabulary, loadGeneratedTagSnapshot, type VerifiedTagSnapshot } from './tagVocabularyProvider'
import { evaluateTagCertificationGate, type ItemTagProposal } from '../playbooks/metroTagCertification'

const SNAPSHOT: VerifiedTagSnapshot = { version: 1, capturedAt: '2026-09-07', justification: 'captured from a real production export while SELECT was briefly available', tagNames: ['cocktails', 'live music', 'family friendly'] }

test('resolveCanonicalTagVocabulary: prefers a successful live query over any configured snapshot', async () => {
  const result = await resolveCanonicalTagVocabulary(async () => ['tag-a', 'tag-b'], SNAPSHOT)
  assert.notEqual(result.status, 'FAILED')
  if (result.status !== 'FAILED') {
    assert.equal(result.status, 'LIVE_DB')
    assert.deepEqual([...result.tagNames], ['tag-a', 'tag-b'])
  }
})

test('resolveCanonicalTagVocabulary: falls back to the verified snapshot when the live query throws (e.g. permission denied)', async () => {
  const result = await resolveCanonicalTagVocabulary(async () => {
    throw new Error('permission denied for table tags')
  }, SNAPSHOT)
  assert.notEqual(result.status, 'FAILED')
  if (result.status !== 'FAILED') {
    assert.equal(result.status, 'VERIFIED_SNAPSHOT')
    assert.deepEqual([...result.tagNames], [...SNAPSHOT.tagNames])
    assert.match(result.detail, /permission denied for table tags/)
    assert.match(result.detail, /v1/)
  }
})

test('resolveCanonicalTagVocabulary: falls back to the snapshot when the live query resolves but returns zero rows', async () => {
  const result = await resolveCanonicalTagVocabulary(async () => [], SNAPSHOT)
  assert.equal(result.status, 'VERIFIED_SNAPSHOT')
})

test('resolveCanonicalTagVocabulary: fails closed — never invents a tag list — when neither live DB nor a snapshot is available', async () => {
  const result = await resolveCanonicalTagVocabulary(async () => {
    throw new Error('permission denied for table tags')
  }, null)
  assert.equal(result.status, 'FAILED')
  if (result.status === 'FAILED') {
    assert.match(result.reason, /permission denied for table tags/)
    assert.match(result.reason, /Never invents a tag list/)
  }
})

// ---------------------------------------------------------------------------
// VerifiedTagSnapshot v1 — the real, generated snapshot from Jerry's
// 2026-09-06 production export (Appendix A of
// docs/checkoff-item-intake-chatgpt-instructions-UPDATED-2026-09-06.md),
// via scripts/generate-tag-snapshot.ts. Never hand-retyped here.
// ---------------------------------------------------------------------------

test('loadGeneratedTagSnapshot: loads a real, non-empty, version-1, source-documented snapshot', () => {
  const snapshot = loadGeneratedTagSnapshot()
  assert.ok(snapshot, 'the generated snapshot file must exist and load')
  assert.equal(snapshot!.version, 1)
  assert.equal(snapshot!.capturedAt, '2026-09-06')
  assert.match(snapshot!.justification, /2026-09-06/)
  assert.ok(snapshot!.tagNames.length > 800, `expected the real ~857-name production export, got ${snapshot!.tagNames.length}`)
})

test('VerifiedTagSnapshot v1: "cocktails" exists in the snapshot', () => {
  const snapshot = loadGeneratedTagSnapshot()
  assert.ok(snapshot!.tagNames.includes('cocktails'))
})

test('VerifiedTagSnapshot v1: "cocktail" (singular) does NOT exist — exact strings only, never normalized/singularized', () => {
  const snapshot = loadGeneratedTagSnapshot()
  assert.equal(snapshot!.tagNames.includes('cocktail'), false)
})

test('VerifiedTagSnapshot v1: every name is unique', () => {
  const snapshot = loadGeneratedTagSnapshot()
  const unique = new Set(snapshot!.tagNames)
  assert.equal(unique.size, snapshot!.tagNames.length)
})

test('VerifiedTagSnapshot v1: tag selection outside the snapshot fails certification', () => {
  const snapshot = loadGeneratedTagSnapshot()!
  const proposal: ItemTagProposal = { candidateName: 'Some Venue', tags: ['cocktails', 'coffee', 'brunch', 'a-completely-invented-tag-not-in-the-snapshot', 'burger', 'beach'] }
  const result = evaluateTagCertificationGate([proposal], new Set(snapshot.tagNames))
  assert.equal(result.gate.verdict, 'FAIL')
  assert.match(result.gate.reason, /a-completely-invented-tag-not-in-the-snapshot/)
})

test('VerifiedTagSnapshot v1: end-to-end — resolveCanonicalTagVocabulary falls back to the real snapshot, and 6-8 metro-tag certification passes using it', async () => {
  const resolved = await resolveCanonicalTagVocabulary(async () => {
    throw new Error('permission denied for table tags')
  }, loadGeneratedTagSnapshot())
  if (resolved.status === 'FAILED') throw new Error('expected VERIFIED_SNAPSHOT, got FAILED: ' + resolved.reason)
  assert.equal(resolved.status, 'VERIFIED_SNAPSHOT')

  // 6 real, exact-string tag names actually present in the snapshot.
  const proposals: ItemTagProposal[] = [
    { candidateName: 'Cafe Sperl', tags: ['cocktails', 'coffee', 'brunch', 'cafe', 'bistro', 'wine'] },
    { candidateName: 'Kunsthistorisches Museum', tags: ['art', 'art-museum', 'architecture', 'arts', 'views', 'unique'] },
  ]
  const gate = evaluateTagCertificationGate(proposals, resolved.tagNames)
  assert.equal(gate.gate.verdict, 'PASS', gate.gate.reason)
})
