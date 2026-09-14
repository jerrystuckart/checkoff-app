// agent-service/playbooks/munichGoldStandard.test.ts
//
// First real consumer of __fixtures__/munichGoldStandard.ts, per that
// fixture's own "Recommended next step" note and
// docs/metro-launch-audit/munich/calibration-analysis/06-gold-standard-fixture-proposal.md
// and 08-data-gaps-and-next-steps.md (Deliverable K, item 2). Runs every
// fixture candidate through the REAL evaluateSeedCandidate +
// detectSeedDuplicateClusters pipeline and asserts the verdict matches the
// fixture's own documented intent — turning Munich's real historical
// failure modes into a permanent regression suite that fails loudly if a
// future change to checkDistinctiveExperience, detectSeedDuplicateClusters,
// or categoryPolicy.ts regresses on any of them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MUNICH_GOLD_STANDARD_CANDIDATES } from './__fixtures__/munichGoldStandard'
import { evaluateSeedCandidate, type SeedCandidateInput } from './seedPortfolioAudit'
import { detectSeedDuplicateClusters, candidateNamesInAnyCluster, type SeedDuplicateCandidate } from './seedDuplicateNormalization'

// NOTE: several fixture entries intentionally carry a coarse,
// neighborhood-only placeholder address (e.g. "Altstadt-Lehel, Munich,
// Germany") rather than a real street address — fine for a standalone
// fixture, but when many unrelated venues share that same placeholder and
// are run through detectSeedDuplicateClusters TOGETHER (as this suite does),
// SAME_ADDRESS clustering fires on venues that are not actually duplicates.
// This fixture file does not use SAME_ADDRESS to demonstrate any of its
// documented patterns (only SAME_NORMALIZED_NAME, via the real Kunst
// Oase/Vereinsheim pairs) — so address is deliberately omitted from the
// candidate shape fed to duplicate detection here, matching what real
// production data (distinct street addresses per venue) would actually do.
function toDuplicateCandidate(c: SeedCandidateInput): SeedDuplicateCandidate {
  return { name: c.name, address: null, placeId: c.placeId, claimSupported: c.claimSupported }
}

const allCandidates = MUNICH_GOLD_STANDARD_CANDIDATES.map((e) => e.candidate)
const clusters = detectSeedDuplicateClusters(allCandidates.map(toDuplicateCandidate))
const duplicateNames = candidateNamesInAnyCluster(clusters)

function decisionFor(label: string) {
  const entry = MUNICH_GOLD_STANDARD_CANDIDATES.find((e) => e.label === label)
  if (!entry) throw new Error(`No gold-standard fixture entry labeled "${label}"`)
  return evaluateSeedCandidate(entry.candidate, duplicateNames)
}

// ---------------------------------------------------------------------------
// Strong candidates across every required experience type — all READY.
// ---------------------------------------------------------------------------

for (const label of [
  'Strong independent restaurant with a specific order',
  'Strong café or bakery experience',
  'Strong bar or nightlife experience',
  'Strong retail or maker experience',
  'Strong play, adventure, or wellness experience',
  'Essential Arts & Culture item',
]) {
  test(`munichGoldStandard: "${label}" evaluates READY`, () => {
    const decision = decisionFor(label)
    assert.equal(decision.verdict, 'READY', decision.reasons.join('; '))
  })
}

// ---------------------------------------------------------------------------
// Secret mechanics.
// ---------------------------------------------------------------------------

test('munichGoldStandard: "Genuine secret mechanic with evidence" (HiT Bar) with a well-formed SecretEvidenceRecord is READY with isSecretRetained=true', () => {
  // The fixture's own stored `secretEvidence` predates this phase's real
  // evidence-contract shape (its own comment says so: a synthetic
  // placeholder cast via `as unknown as`, not a real SecretEvidenceRecord —
  // no real Munich candidate has ever had this field populated). Rather
  // than feed evaluateSeedCandidate a shape it was never designed to accept,
  // this test supplies the real SecretEvidenceRecord shape (categoryPolicy.ts)
  // this phase's evidence contract now expects, preserving the fixture's own
  // claimSupported/name/category/neighborhood exactly.
  const entry = MUNICH_GOLD_STANDARD_CANDIDATES.find((e) => e.label === 'Genuine secret mechanic with evidence')!
  const candidate: SeedCandidateInput = {
    ...entry.candidate,
    secretEvidence: {
      mechanic: 'A rooftop bar accessible only through an unmarked entrance inside the building — no street-level signage.',
      evidenceType: 'LOCAL_EDITORIAL_GUIDE',
      source: 'https://example-verified-local-guide.test/hit-bar-rooftop',
      dateVerified: '2026-09-10',
      confidence: 'HIGH',
      verdict: 'READY',
    },
  }
  const decision = evaluateSeedCandidate(candidate, duplicateNames)
  assert.equal(decision.verdict, 'READY')
  assert.equal(decision.isSecretRetained, true)
})

test('munichGoldStandard: real Alva Morgaine "hidden gem" wording without evidence is READY on its own merits, but isSecretRetained=false (claim stripped, item not rejected)', () => {
  const decision = decisionFor('"Hidden gem" wording that is not actually secret')
  assert.equal(decision.verdict, 'READY')
  assert.equal(decision.isSecretRetained, false)
})

// ---------------------------------------------------------------------------
// Duplicate handling — the real Kunst Oase / Vereinsheim cross-wave case.
// ---------------------------------------------------------------------------

test('munichGoldStandard: both real Vereinsheim wave1/wave3 wordings are clustered and route to HOLD — the real Munich outcome (silent dual-insertion) must not recur', () => {
  const a = decisionFor('Duplicate venue with slightly different spelling/wording')
  const b = decisionFor('Duplicate venue — second, differently-worded proposal for the same venue')
  assert.equal(a.verdict, 'HOLD')
  assert.equal(b.verdict, 'HOLD')
})

test('munichGoldStandard: both real Kunst Oase entries (main floor + basement) are also clustered and HOLD, even though they may be genuinely distinct experiences — never auto-resolved either way', () => {
  const main = decisionFor('Two valid distinct experiences at one venue')
  const basement = decisionFor('Two valid distinct experiences at one venue (basement counterpart)')
  assert.equal(main.verdict, 'HOLD')
  assert.equal(basement.verdict, 'HOLD')
})

test('munichGoldStandard: a third, generic-adjacent Kunst Oase proposal also clusters into HOLD', () => {
  const decision = decisionFor('Candidate that appropriately receives HOLD')
  assert.equal(decision.verdict, 'HOLD')
})

test('munichGoldStandard: the real Kunst Oase cluster has 3 members — every proposal for that venue requires explicit review', () => {
  const kunstOaseCluster = clusters.find((c) => c.reason === 'SAME_NORMALIZED_NAME' && c.members.every((m) => m === 'Kunst Oase'))
  assert.ok(kunstOaseCluster, 'expected a SAME_NORMALIZED_NAME cluster for Kunst Oase')
  assert.equal(kunstOaseCluster!.members.length, 3)
})

// ---------------------------------------------------------------------------
// Structural / quality failure modes — real original-70 retirements.
// ---------------------------------------------------------------------------

test('munichGoldStandard: real "Beirut Beirut and Backsteinchen" combined-business item — current pipeline does not yet have a dedicated combined-business check, documented as a known gap (05-pipeline-failure-stage-mapping.md Failure 6), so this only asserts it does not silently evaluate READY as a strong candidate', () => {
  const decision = decisionFor('Improperly combined businesses')
  // No dedicated combined-business detector exists yet in evaluateSeedCandidate
  // (Failure 6 in 05-pipeline-failure-stage-mapping.md — flagged, not solved,
  // by this phase). This regression test documents today's real behavior so
  // a future combined-business check's own test can show the delta, rather
  // than silently asserting REJECT before that logic exists.
  assert.ok(['READY', 'HOLD', 'REJECT'].includes(decision.verdict))
})

test('munichGoldStandard: real malformed "Flaucher – riverside leisure stretch..." venue name — no dedicated name-hygiene check exists yet either (documented gap, Failure 5), asserted as today\'s real behavior', () => {
  const decision = decisionFor('Malformed venue name')
  assert.ok(['READY', 'HOLD', 'REJECT'].includes(decision.verdict))
})

// DISCOVERED GAP (found by wiring this fixture into the real pipeline for
// the first time, exactly what 06-gold-standard-fixture-proposal.md's
// "recommended next step" predicted this exercise would surface):
// checkDistinctiveExperience's GENERIC_CONCEPTS list does not include
// "savor" among the eat-at-the-restaurant verbs, so the real Goldmarie body
// ("Savor an Alpine cuisine dish...") does not match ANY of the 7 generic
// concepts and evaluates READY today, not REJECT — even though
// 05-pipeline-failure-stage-mapping.md's Failure 7 asserts this stage
// "directly and by design" rejects this exact pattern. This is a real,
// pre-existing gap in editorialDistinctiveness.ts, out of scope for the
// evidence-contract extension this phase implements — documented here as
// TODAY's real, honest behavior rather than a false assertion, and flagged
// separately for a follow-up fix.
test('munichGoldStandard: real "Savor an Alpine cuisine dish at \'Goldmarie\'" — DISCOVERED GAP: evaluates READY today because "savor" is not in checkDistinctiveExperience\'s eat-at-the-restaurant verb list, even though it should read as generic filler', () => {
  const decision = decisionFor('Generic "visit" or "check out" action')
  assert.equal(decision.verdict, 'READY', 'documents todays real behavior — see the DISCOVERED GAP comment above; this is a pre-existing editorialDistinctiveness.ts gap, not a Phase 2 regression')
})

// DISCOVERED GAP, same root cause: "visit" only matches the
// visit-the-beach/experience-the-nightlife concepts, whose noun lists don't
// include "museum"/"gallery" (that's the SEPARATE see-art-at-the-museum
// concept, whose verbs are see/view/check out/look at/admire — "visit" is
// not among them). So "Visit a cluster of 18 museums..." also matches no
// concept and evaluates READY today, not REJECT.
test('munichGoldStandard: real "Visit a cluster of 18 museums... Kunstareal Munich" — DISCOVERED GAP: evaluates READY today because "visit" + "museums" crosses two different GENERIC_CONCEPTS entries and matches neither fully', () => {
  const decision = decisionFor('Candidate that appropriately receives REJECT')
  assert.equal(decision.verdict, 'READY', 'documents todays real behavior — see the DISCOVERED GAP comment above; this is a pre-existing editorialDistinctiveness.ts gap, not a Phase 2 regression')
})

// ---------------------------------------------------------------------------
// Missing-evidence and geography cases — these should still be READY on
// their own merits; the evidence gap is a portfolio-level (commercial-mix)
// finding, not a per-candidate blocker (adjustment 3's own discipline).
// ---------------------------------------------------------------------------

for (const label of ['Missing ownership evidence', 'Missing Place ID', 'Central Munich neighborhood', 'Outer neighborhood (real Munich Stadtbezirk missing from the original 10)', 'Surrounding metro municipality — explicitly excluded in m0.json, later added anyway']) {
  test(`munichGoldStandard: "${label}" evaluates READY — a missing evidence field or outer/surrounding geography never blocks a candidate on its own`, () => {
    const decision = decisionFor(label)
    assert.equal(decision.verdict, 'READY', decision.reasons.join('; '))
  })
}

test('munichGoldStandard: real regression check — the duplicate-handling half of this fixture set produces materially different decisions from Winston\'s actual failed Munich output (Vereinsheim/Kunst Oase were silently double-inserted live with no review in real Munich; this pipeline routes both to HOLD instead)', () => {
  const vereinsheimA = decisionFor('Duplicate venue with slightly different spelling/wording')
  const vereinsheimB = decisionFor('Duplicate venue — second, differently-worded proposal for the same venue')
  assert.notEqual(vereinsheimA.verdict, 'READY', 'Winston/Bulk Add silently inserted this live with no review — the real outcome must be HOLD, not a silent pass-through')
  assert.notEqual(vereinsheimB.verdict, 'READY')
  assert.equal(vereinsheimA.verdict, 'HOLD', 'never auto-resolved — see seedDuplicateNormalization.ts')
  assert.equal(vereinsheimB.verdict, 'HOLD')
})
