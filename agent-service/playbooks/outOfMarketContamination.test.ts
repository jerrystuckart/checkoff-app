import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateOutOfMarketContaminationGate, evaluateOutOfMarketContaminationStagingGate, KNOWN_METRO_ANCHOR_PLACE_NAMES } from './outOfMarketContamination'

// Direct regression coverage for the 2026-09-10 incident: a Green Bay,
// WI build's targeted gap-research stage was silently handed San Diego's
// frozen depth-target manifest and returned real Carlsbad/Oceanside/
// Chula Vista/Coronado venues. These tests prove that specific class of
// contamination is caught deterministically, independent of the
// upstream root-cause fix (defaultMetroManifest.ts/cli.ts) — a second,
// genuinely independent line of defense per Jerry's explicit instruction.

test('OUT_OF_MARKET_CONTAMINATION_GATE: a Green Bay build cannot inherit Carlsbad, Oceanside, Chula Vista, or Coronado', () => {
  const result = evaluateOutOfMarketContaminationGate({
    targetMetro: { slug: 'green-bay', state: 'WI' },
    candidates: [
      { candidateName: 'Agua Hedionda Lagoon & Discovery Center', body: "Walk through the nature exhibits and participate in educational activities at 'Agua Hedionda Lagoon & Discovery Center'.", formattedAddress: '1580 Cannon Rd, Carlsbad, CA 92008, USA' },
      { candidateName: 'Batiquitos Lagoon', body: "Spot local and migratory bird species along the trails at 'Batiquitos Lagoon'.", formattedAddress: 'Batiquitos Dr, Carlsbad, CA 92009, USA' },
      { candidateName: 'Chula Vista Bayfront & Harbor District', body: "Walk along the marina or visit the Living Coast Discovery Center at 'Chula Vista Bayfront & Harbor District'.", formattedAddress: '996 Marina Pkwy, Chula Vista, CA 91910, USA' },
      { candidateName: 'Downtown Chula Vista', body: "Follow the Walk of History among Victorian homes in 'Downtown Chula Vista'.", formattedAddress: 'Third Ave, Chula Vista, CA 91910, USA' },
      { candidateName: "Ahnapee Brewery taproom", body: "Sample from 16 rotating taps at 'Ahnapee Brewery taproom'.", formattedAddress: '1719 Main St, Algoma, WI 54201, USA' }, // a real, correctly-in-market item — must NOT be flagged
    ],
  })

  assert.equal(result.verdict, 'FAIL')
  // Each of the 4 contaminated candidates trips BOTH the known-anchor-name
  // check AND the CA/WI state-mismatch check — two independent, valid
  // pieces of evidence per candidate, not a bug — so 4 flagged candidates
  // produce 8 total violation records.
  const flaggedNames = new Set(result.violations.map((v) => v.candidateName))
  assert.equal(flaggedNames.size, 4, `expected exactly 4 out-of-market candidates flagged, got: ${JSON.stringify(result.violations)}`)
  assert.ok(flaggedNames.has('Agua Hedionda Lagoon & Discovery Center'))
  assert.ok(flaggedNames.has('Batiquitos Lagoon'))
  assert.ok(flaggedNames.has('Chula Vista Bayfront & Harbor District'))
  assert.ok(flaggedNames.has('Downtown Chula Vista'))
  assert.ok(!flaggedNames.has('Ahnapee Brewery taproom'), 'a real, correctly-in-market Green Bay item must never be flagged as contamination')
  assert.ok(
    result.violations.every((v) => v.matchedMetro === 'san-diego' || v.matchedMetro === 'unknown'),
    'every violation must attribute to the correct known-contaminating metro (or "unknown" for the independent state-mismatch signal)'
  )
})

test('OUT_OF_MARKET_CONTAMINATION_GATE: matches other known San Diego anchor names too (Coronado, Oceanside), not just the 4 from the real incident', () => {
  const result = evaluateOutOfMarketContaminationGate({
    targetMetro: { slug: 'green-bay', state: 'WI' },
    candidates: [
      { candidateName: 'Coronado Ferry Landing', body: "Take the ferry at 'Coronado Ferry Landing'.", formattedAddress: '1201 1st St, Coronado, CA 92118, USA' },
      { candidateName: 'Oceanside Pier', body: "Walk to the end of 'Oceanside Pier'.", formattedAddress: '1 Oceanside Pier, Oceanside, CA 92054, USA' },
    ],
  })
  assert.equal(result.verdict, 'FAIL')
  const flaggedNames = new Set(result.violations.map((v) => v.candidateName))
  assert.equal(flaggedNames.size, 2)
})

test('OUT_OF_MARKET_CONTAMINATION_GATE: a clean, real, in-market Green Bay catalog PASSes', () => {
  const result = evaluateOutOfMarketContaminationGate({
    targetMetro: { slug: 'green-bay', state: 'WI' },
    candidates: [
      { candidateName: 'Titletown Brewing Co', body: "Get a beer in the outdoor beer garden at 'Titletown Brewing Co' and stay for at least two.", formattedAddress: '320 N Broadway, Green Bay, WI 54303, USA' },
      { candidateName: 'CityDeck', body: "Walk the 'CityDeck' along the Fox River at dusk.", formattedAddress: '301 N Washington St, Green Bay, WI 54301, USA' },
    ],
  })
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.violations.length, 0)
})

test('OUT_OF_MARKET_CONTAMINATION_GATE: a state mismatch alone (no known-anchor name) still fails closed', () => {
  const result = evaluateOutOfMarketContaminationGate({
    targetMetro: { slug: 'green-bay', state: 'WI' },
    candidates: [{ candidateName: 'Suspicious Venue', body: "Do a thing at 'Suspicious Venue'.", formattedAddress: '123 Somewhere St, Springfield, IL 62701, USA' }],
  })
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.violations[0].matchedAnchor, 'IL')
})

test('OUT_OF_MARKET_CONTAMINATION_GATE: San Diego building ITS OWN metro is never flagged for its own real anchor names', () => {
  const result = evaluateOutOfMarketContaminationGate({
    targetMetro: { slug: 'san-diego', state: 'CA' },
    candidates: [
      { candidateName: 'Warwick\'s Books', body: "Browse the shelves at 'Warwick's Books' in La Jolla.", formattedAddress: '7812 Girard Ave, La Jolla, CA 92037, USA' },
      { candidateName: 'Chula Vista Marina', body: "Walk the docks at 'Chula Vista Marina'.", formattedAddress: '550 Marina Pkwy, Chula Vista, CA 91910, USA' },
    ],
  })
  assert.equal(result.verdict, 'PASS', `San Diego's own legitimate anchor names must never self-flag: ${JSON.stringify(result.violations)}`)
})

test('OUT_OF_MARKET_CONTAMINATION_GATE: word-boundary matching never flags a substring collision', () => {
  // "Mesa" (a real Phoenix-area anchor) must not fire inside an unrelated word.
  const result = evaluateOutOfMarketContaminationGate({
    targetMetro: { slug: 'green-bay', state: 'WI' },
    candidates: [{ candidateName: 'Amesa Diner', body: "Eat breakfast at 'Amesa Diner'.", formattedAddress: '1 Main St, Green Bay, WI 54301, USA' }],
  })
  assert.equal(result.verdict, 'PASS', 'a substring match ("mesa" inside "Amesa") must never be treated as a real anchor hit')
})

test('evaluateOutOfMarketContaminationStagingGate: adapts to the shared StagingGateResult shape with the correct key', () => {
  const result = evaluateOutOfMarketContaminationStagingGate({
    targetMetro: { slug: 'green-bay', state: 'WI' },
    candidates: [{ candidateName: 'Carlsbad Flower Fields', body: "Walk the 'Carlsbad Flower Fields'.", formattedAddress: '5704 Paseo Del Norte, Carlsbad, CA 92008, USA' }],
  })
  assert.equal(result.key, 'OUT_OF_MARKET_CONTAMINATION_GATE')
  assert.equal(result.verdict, 'FAIL')
})

test('KNOWN_METRO_ANCHOR_PLACE_NAMES registry: San Diego entry covers every real venue found in the actual Green Bay incident', () => {
  const sanDiegoAnchors = KNOWN_METRO_ANCHOR_PLACE_NAMES['san-diego']
  for (const required of ['Carlsbad', 'Oceanside', 'Chula Vista', 'Coronado']) {
    assert.ok(sanDiegoAnchors.includes(required), `expected "${required}" in the san-diego anchor registry`)
  }
})
