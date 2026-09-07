import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCanonicalTagVocabulary, type VerifiedTagSnapshot } from './tagVocabularyProvider'

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
