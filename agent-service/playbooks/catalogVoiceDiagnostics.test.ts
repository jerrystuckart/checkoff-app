import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeCatalogVoice, type VoiceCatalogEntry } from './catalogVoiceDiagnostics'

function entries(n: number, opener: string): VoiceCatalogEntry[] {
  return Array.from({ length: n }, (_, i) => ({ candidateName: `Item ${String(i).padStart(3, '0')}`, body: `${opener} the thing at venue ${i}.` }))
}

test('analyzeCatalogVoice: batches under 10 items are never flagged', () => {
  const report = analyzeCatalogVoice(entries(9, 'Order'))
  assert.equal(report.flaggedCandidateNames.length, 0)
  assert.equal(report.dominantOpeningWords.length, 0)
})

test('analyzeCatalogVoice: a dominant opening word over 15% is flagged and its items listed', () => {
  const dominant = entries(8, 'Order')
  const varied = [
    { candidateName: 'V0', body: 'See the view.' },
    { candidateName: 'V1', body: 'Find the hidden door.' },
  ]
  const report = analyzeCatalogVoice([...dominant, ...varied])
  assert.ok(report.dominantOpeningWords.includes('order'))
  assert.equal(report.flaggedCandidateNames.length, 8)
  assert.ok(report.flaggedCandidateNames.every((n) => n.startsWith('Item')))
})

test('analyzeCatalogVoice: no violation when every opening word stays under the max share', () => {
  const varied = [
    { candidateName: 'A', body: 'Order the dish.' },
    { candidateName: 'B', body: 'See the view.' },
    { candidateName: 'C', body: 'Find the door.' },
    { candidateName: 'D', body: 'Walk the trail.' },
    { candidateName: 'E', body: 'Try the drink.' },
    { candidateName: 'F', body: 'Climb the tower.' },
    { candidateName: 'G', body: 'Ride the wheel.' },
    { candidateName: 'H', body: 'Taste the wine.' },
    { candidateName: 'I', body: 'Book the tour.' },
    { candidateName: 'J', body: 'Enter the vault.' },
  ]
  const report = analyzeCatalogVoice(varied)
  assert.equal(report.dominantOpeningWords.length, 0)
  assert.equal(report.flaggedCandidateNames.length, 0)
})

test('analyzeCatalogVoice: repeated 3-word opening phrase is flagged even when the single opening word alone is under threshold', () => {
  // "Order the signature" repeated 3x, remaining openers all distinct single words
  const repeatedPhrase = Array.from({ length: 3 }, (_, i) => ({ candidateName: `P${i}`, body: `Order the signature dish number ${i}.` }))
  const rest = Array.from({ length: 12 }, (_, i) => ({ candidateName: `R${i}`, body: `${['See', 'Find', 'Walk', 'Try', 'Climb', 'Ride', 'Taste', 'Book', 'Enter', 'Visit', 'Explore', 'Discover'][i]} thing ${i}.` }))
  const report = analyzeCatalogVoice([...repeatedPhrase, ...rest])
  assert.ok(report.repeatedOpeningPhrases.some((p) => p.phrase === 'order the signature'))
  assert.ok(repeatedPhrase.every((e) => report.flaggedCandidateNames.includes(e.candidateName)))
})
