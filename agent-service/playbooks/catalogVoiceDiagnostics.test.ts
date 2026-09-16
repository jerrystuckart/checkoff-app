import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeCatalogVoice, evaluateOpeningVerbConcentrationAudit, snapshotOpeningWordDistribution, buildOpeningWordDiversityReport, type VoiceCatalogEntry } from './catalogVoiceDiagnostics'

function entries(n: number, opener: string): VoiceCatalogEntry[] {
  return Array.from({ length: n }, (_, i) => ({ candidateName: `Item ${String(i).padStart(3, '0')}`, body: `${opener} the thing at venue ${i}.` }))
}

/**
 * A genuinely distinct opening WORD per index (never a shared stem with a
 * numeric suffix glued on — firstWordOf's regex stops at the first
 * non-letter character, so e.g. "Uniqueword0"/"Uniqueword1" would both
 * collapse to the SAME captured word "uniqueword," silently defeating the
 * whole point of "varied filler"). Base-26 letter pairs give 676 distinct
 * words, comfortably more than any fixture here needs.
 */
function distinctFillerWord(i: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const first = letters[Math.floor(i / 26) % 26]
  const second = letters[i % 26]
  const word = `${first}${second}word`
  return word.charAt(0).toUpperCase() + word.slice(1)
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

// ---------------------------------------------------------------------------
// MUNICH REGRESSION FIXTURE (2026-09-16) — the real reported pattern: 184
// items, Catch×12, Choose×8, Find×12, Order×18, Take×9 (59/184 = 32.07%
// combined), no single word over the 15% dominance threshold, and
// "catch"/"choose" not on the old DEFAULT_WEAK_OPENER_WATCHLIST. This
// fixture is the regression test proving the diffuse-concentration fix
// actually catches the real, confirmed gap.
// ---------------------------------------------------------------------------

function munichCatalogFixture(): VoiceCatalogEntry[] {
  const groups: Array<{ opener: string; count: number }> = [
    { opener: 'Catch', count: 12 },
    { opener: 'Choose', count: 8 },
    { opener: 'Find', count: 12 },
    { opener: 'Order', count: 18 },
    { opener: 'Take', count: 9 },
  ]
  const items: VoiceCatalogEntry[] = []
  for (const { opener, count } of groups) {
    for (let i = 0; i < count; i++) {
      // A DISTINCT concrete noun phrase per item (real Munich shape — same
      // generic opener, different specific order/object each time), so
      // only the diffuse-concentration (shared opening WORD) signal fires
      // here, never the separate repeated-3-word-opening-phrase mechanism
      // (which correctly flags a truly identical template and is out of
      // scope for this fixture).
      items.push({ candidateName: `${opener} Item ${i}`, body: `${opener} the ${distinctFillerWord(300 + i)} at 'Venue ${opener}${i}'.` })
    }
  }
  // 125 remaining items, each with its OWN distinct opening word — real
  // healthy variety padding the batch out to Munich's real 184-item total.
  for (let i = 0; i < 125; i++) {
    items.push({ candidateName: `Varied Item ${i}`, body: `${distinctFillerWord(i)} the detail at 'Venue Varied${i}'.` })
  }
  return items
}

test('MUNICH REGRESSION: no single opening word individually dominates (confirms the single-word gate alone would not have caught this)', () => {
  const report = analyzeCatalogVoice(munichCatalogFixture())
  assert.equal(report.totalItems, 184)
  assert.equal(report.openingWordCounts['order'], 18)
  assert.equal(report.dominantOpeningWords.length, 0, 'no word individually exceeds the 15% single-word threshold — "order" is 18/184 = 9.8%')
})

test('MUNICH REGRESSION: the OLD fixed-watchlist-only check (opts.watchlist explicitly restricted) would NOT have caught this — documents the real gap', () => {
  const bodies = munichCatalogFixture().map((e) => e.body)
  const oldWatchlistOnly = evaluateOpeningVerbConcentrationAudit(bodies, { watchlist: ['try', 'attend', 'take', 'sit', 'find', 'walk', 'visit', 'explore', 'order', 'sample', 'sip', 'ask'], maxCombinedShare: 0.45 })
  // Only "find"/"order"/"take" are on that list — "catch"/"choose" are invisible to it.
  assert.equal(oldWatchlistOnly.verdict, 'PASS', 'the old watchlist+0.45-threshold combination genuinely misses the real Munich pattern (39/184 = 21%, under 45%)')
})

test('MUNICH REGRESSION: the new default (frequency-driven, no watchlist restriction) audit FAILs on the real pattern', () => {
  const bodies = munichCatalogFixture().map((e) => e.body)
  const result = evaluateOpeningVerbConcentrationAudit(bodies)
  assert.equal(result.verdict, 'FAIL')
  assert.ok(Math.abs(result.combinedSharePercent - 32.07) < 0.1, `expected ~32.07%, got ${result.combinedSharePercent}`)
  const words = result.breakdown.map((b) => b.word).sort()
  assert.deepEqual(words, ['catch', 'choose', 'find', 'order', 'take'])
})

test('MUNICH REGRESSION: analyzeCatalogVoice flags via hasDiffuseConcentration even though dominantOpeningWords is empty, but the OLD "flag all 59" behavior no longer happens', () => {
  const report = analyzeCatalogVoice(munichCatalogFixture())
  assert.equal(report.hasDiffuseConcentration, true)
  assert.deepEqual([...report.notableConcentrationWords].sort(), ['catch', 'choose', 'find', 'order', 'take'], 'notableConcentrationWords still reports every CONTRIBUTING word (diagnostic), even though only some of their items are selected for repair')
  assert.ok(report.flaggedCandidateNames.length < 59, 'must select fewer than every one of the 59 items behind a notable opener — repairing all of them was the bug this follow-up fixes')
  assert.ok(report.flaggedCandidateNames.every((n) => !n.startsWith('Varied Item')), 'the 125 genuinely varied items must never be flagged')
})

// ---------------------------------------------------------------------------
// FOLLOW-UP FIX (2026-09-16): minimum-necessary repair selection + the
// experience-anchor preservation safeguard (the anchor extraction/check
// itself lives in editorialDistinctiveness.ts and is tested there;
// metroLaunchDriverCatalogVoicePass.test.ts proves both through the real
// driver end to end).
// ---------------------------------------------------------------------------

test('MINIMUM REPAIR SELECTION: selects a real strict subset of the 59 Munich contributors, deterministically, and the selection alone is provably sufficient', () => {
  const fixture = munichCatalogFixture()
  const report = analyzeCatalogVoice(fixture)
  const selected = report.diffuseConcentrationRepairCandidates
  assert.ok(selected.length > 0 && selected.length < 59, `expected a real strict subset, got ${selected.length}`)
  assert.ok(selected.every((n) => !n.startsWith('Varied Item')))

  // Simulate removing exactly the selected items — each gets its OWN
  // distinct new opener (never one shared new template; a shared
  // replacement would itself become a new notable word once enough items
  // used it, confounding this test's own measurement) — and confirm the
  // PROJECTED combined share is at/under the 25% threshold, proving the
  // selection is genuinely sufficient, not just "some subset."
  const selectedSet = new Set(selected)
  let repairIndex = 0
  const projected = fixture.map((e) => (selectedSet.has(e.candidateName) ? { ...e, body: `${distinctFillerWord(400 + repairIndex++)} the thing at 'Venue'.` } : e))
  const projectedReport = analyzeCatalogVoice(projected)
  assert.equal(projectedReport.hasDiffuseConcentration, false, 'after repairing exactly the selected items, the catalog must no longer be in diffuse concentration')

  // Determinism: running the same analysis twice on the same input
  // yields the identical selection, in the identical order.
  const again = analyzeCatalogVoice(munichCatalogFixture())
  assert.deepEqual(again.diffuseConcentrationRepairCandidates, selected)
})

test('MINIMUM REPAIR SELECTION: stops as soon as the projection passes — removing one fewer selected item would NOT have passed', () => {
  const fixture = munichCatalogFixture()
  const report = analyzeCatalogVoice(fixture)
  const selected = report.diffuseConcentrationRepairCandidates
  // Repair every selected item EXCEPT the last one chosen — again, each
  // repaired item gets its own distinct new opener.
  const oneFewer = new Set(selected.slice(0, -1))
  let repairIndex = 0
  const projected = fixture.map((e) => (oneFewer.has(e.candidateName) ? { ...e, body: `${distinctFillerWord(500 + repairIndex++)} the thing at 'Venue'.` } : e))
  const projectedReport = analyzeCatalogVoice(projected)
  assert.equal(projectedReport.hasDiffuseConcentration, true, 'one fewer repair than selected must still fail the concentration check — the selection stops at the minimum, not earlier')
})

test('MUNICH REGRESSION: structured before/after report shows the real counts and percentages, and reflects a real repair', () => {
  const before = munichCatalogFixture()
  // Simulate a successful, targeted repair of every "Order" item (the
  // densest single contributor) — each item gets its OWN distinct new
  // opener, exactly like the real rewriteOneItemVoice pass (a genuinely
  // different, venue-specific hook per item, never one shared new
  // template rotated in for all of them — rotating to a single new
  // synonym would just relocate the concentration problem, not fix it).
  let orderIndex = 0
  const after = before.map((e) =>
    e.candidateName.startsWith('Order Item') ? { ...e, body: e.body.replace(/^Order/, distinctFillerWord(200 + orderIndex++)) } : e
  )
  const report = buildOpeningWordDiversityReport(before, after, 18)
  assert.equal(report.before.rows.find((r) => r.word === 'order')?.count, 18)
  assert.equal(report.after.rows.find((r) => r.word === 'order'), undefined, 'no items open with "order" anymore after the repair')
  assert.equal(report.itemsRewritten, 18)
  assert.equal(report.before.concentrationVerdict, 'FAIL')
  // Removing "order" (18/184=9.8%) brings the combined share from 32.07%
  // down to (59-18)/184 = 22.28% — still non-zero (catch/choose/find/take
  // remain), and now under the 25% threshold.
  assert.ok(Math.abs(report.after.combinedNotableSharePercent - 22.28) < 0.1)
  assert.equal(report.after.concentrationVerdict, 'PASS')
})

test('DOES NOT BAN VERBS ABSOLUTELY: a word used only once or twice is never flagged, however "generic" it sounds', () => {
  const items: VoiceCatalogEntry[] = [
    { candidateName: 'A', body: "Order the tasting flight at 'Venue A'." }, // "order" used once
    { candidateName: 'B', body: "Take the elevator to 'Venue B'." }, // "take" used once
    ...Array.from({ length: 18 }, (_, i) => ({ candidateName: `V${i}`, body: `${distinctFillerWord(i)} at 'Venue ${i}'.` })),
  ]
  const report = analyzeCatalogVoice(items)
  assert.equal(report.hasDiffuseConcentration, false)
  assert.equal(report.flaggedCandidateNames.length, 0, 'a single incidental use of a common verb must never be flagged — the audit judges by actual repetition in THIS catalog, never by word identity alone')
})

test('VENUE NAME / QUOTED TEXT DISTINCTION: a leading quote mark never creates a spurious, separate opening-word bucket from the same real word without one', () => {
  // Before the fix, firstWordOf's regex included the apostrophe itself in
  // the captured word (`'kunst` vs `kunst`), so a body that happened to
  // open with a quoted venue name would silently fork into a DIFFERENT
  // word bucket than the same word written without a leading quote —
  // undercounting real repetition on one side and fabricating a
  // one-off "word" on the other. Now both normalize to the same key.
  const quoted: VoiceCatalogEntry = { candidateName: 'Q1', body: "'Vereinsheim' hosts a lively weekly pub quiz." }
  const unquoted: VoiceCatalogEntry = { candidateName: 'Q2', body: "Vereinsheim also hosts live music on Fridays." }
  const filler = Array.from({ length: 8 }, (_, i) => ({ candidateName: `V${i}`, body: `${distinctFillerWord(i)} at 'Venue ${i}'.` }))
  const report = analyzeCatalogVoice([quoted, unquoted, ...filler])
  assert.equal(report.openingWordCounts['vereinsheim'], 2, 'the quoted and unquoted forms of the same real word must count together under one key, not split into two spurious buckets')
})

test('snapshotOpeningWordDistribution: reports full counts and percentages for every distinct opening word, not just flagged ones', () => {
  const snapshot = snapshotOpeningWordDistribution(munichCatalogFixture())
  assert.equal(snapshot.totalItems, 184)
  const orderRow = snapshot.rows.find((r) => r.word === 'order')!
  assert.equal(orderRow.count, 18)
  assert.ok(Math.abs(orderRow.sharePercent - 9.7826) < 0.01)
  // 125 distinct "uniqueword*" openers + 5 notable ones = 130 distinct rows.
  assert.equal(snapshot.rows.length, 130)
})
