import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyGreenBayNeighborhood, GREEN_BAY_CANONICAL_NEIGHBORHOODS } from './greenBayNeighborhoodModel'
import { evaluateGeographicConsistencyAudit } from './geographicConsistencyAudit'
import { GREEN_BAY_NEIGHBORHOOD_MUNICIPALITY_REGISTRY } from './greenBayNeighborhoodModel'

// Regression coverage for the 2026-09-10 neighborhood-collapse incident:
// real, named examples Jerry flagged as misassigned by the prior package.

test('classifyGreenBayNeighborhood: named correction examples resolve to the real municipality, not a catch-all', () => {
  const cases: Array<[string, string, number | null, number | null, string]> = [
    ['Hinterland', '1001 Lombardi Access Rd, Ashwaubenon, WI 54304, USA', null, null, 'Ashwaubenon'],
    ['Cocoon Brewery', '2233 Kaftan Wy, De Pere, WI 54115, USA', 44.4300575, -88.0199661, 'East De Pere'],
    ['Chives Restaurant', '1749 Riverside Dr, Suamico, WI 54173, USA', null, null, 'Suamico'],
    ['Homefield Pub + Social', '1025 Lombardi Ave Ste 120, Ashwaubenon, WI 54304, USA', null, null, 'Ashwaubenon'],
    ['National Railroad Museum', '2285 S Broadway, Ashwaubenon, WI 54304, USA', null, null, 'Ashwaubenon'],
    ['Ahnapee Brewery guided tasting', '1824 Parkfield Ct, Suamico, WI 54173, USA', null, null, 'Suamico'],
    ['Odyssey Climbing + Fitness', '686 Mike McCarthy Way, Ashwaubenon, WI 54304, USA', null, null, 'Ashwaubenon'],
  ]
  for (const [venueName, formattedAddress, lat, lng, expected] of cases) {
    const result = classifyGreenBayNeighborhood({ venueName, formattedAddress, lat, lng })
    assert.equal(result.neighborhood, expected, `${venueName}: expected ${expected}, got ${result.neighborhood} (${result.reason})`)
  }
})

test('classifyGreenBayNeighborhood: Copper Culture State Park resolves OUT OF SCOPE (Oconto), never silently folded into Suamico', () => {
  const result = classifyGreenBayNeighborhood({ venueName: 'Copper Culture State Park', formattedAddress: '260 Copper Culture Way, Oconto, WI 54153, USA', lat: null, lng: null })
  assert.equal(result.neighborhood, null)
  assert.equal(result.outOfScopeMunicipality, 'Oconto')
})

test('classifyGreenBayNeighborhood: Green Bay ZIP codes resolve to the correct real quadrant', () => {
  assert.equal(classifyGreenBayNeighborhood({ venueName: 'x', formattedAddress: '117 S Washington St, Green Bay, WI 54301, USA', lat: null, lng: null }).neighborhood, 'Downtown Green Bay')
  assert.equal(classifyGreenBayNeighborhood({ venueName: 'x', formattedAddress: '1313 Bay Beach Rd, Green Bay, WI 54302, USA', lat: null, lng: null }).neighborhood, 'The Bay')
  assert.equal(classifyGreenBayNeighborhood({ venueName: 'x', formattedAddress: '320 N Broadway, Green Bay, WI 54303, USA', lat: null, lng: null }).neighborhood, 'West Side Green Bay')
  assert.equal(classifyGreenBayNeighborhood({ venueName: 'x', formattedAddress: '1265 Lombardi Ave, Green Bay, WI 54304, USA', lat: null, lng: null }).neighborhood, 'West Side Green Bay')
  assert.equal(classifyGreenBayNeighborhood({ venueName: 'x', formattedAddress: '2790 University Ave, Green Bay, WI 54311, USA', lat: null, lng: null }).neighborhood, 'East Side Green Bay')
})

test('classifyGreenBayNeighborhood: a rural Oneida Nation address with a De Pere postal city resolves to Oneida, not De Pere', () => {
  const result = classifyGreenBayNeighborhood({ venueName: 'Oneida Nation Museum', formattedAddress: 'W892 County Rd Ee, De Pere, WI 54115, USA', lat: 44.4449074, lng: -88.229739 })
  assert.equal(result.neighborhood, 'Oneida')
  assert.equal(result.confidence, 'HIGH')
})

test('classifyGreenBayNeighborhood: De Pere east/west bank split uses real river-relative longitude', () => {
  const west = classifyGreenBayNeighborhood({ venueName: 'Voyageur Park', formattedAddress: '100 William St, De Pere, WI 54115, USA', lat: 44.4521041, lng: -88.0638259 })
  assert.equal(west.neighborhood, 'West De Pere')
  const east = classifyGreenBayNeighborhood({ venueName: 'Mulva Cultural Center', formattedAddress: '221 S Broadway, De Pere, WI 54115, USA', lat: 44.4470187, lng: -88.0594661 })
  assert.equal(east.neighborhood, 'East De Pere')
})

test('classifyGreenBayNeighborhood: an unrecognized municipality never gets force-mapped to a nearby neighborhood', () => {
  const result = classifyGreenBayNeighborhood({ venueName: 'x', formattedAddress: '1 Main St, Appleton, WI 54911, USA', lat: null, lng: null })
  assert.equal(result.neighborhood, null)
  assert.equal(result.outOfScopeMunicipality, undefined)
  assert.equal(result.confidence, 'LOW')
})

test('GREEN_BAY_CANONICAL_NEIGHBORHOODS has exactly the 13 approved names', () => {
  assert.equal(GREEN_BAY_CANONICAL_NEIGHBORHOODS.length, 13)
  for (const n of ['East Side Green Bay', 'West Side Green Bay', 'Howard', 'Suamico', 'The Bay', 'Ashwaubenon', 'Hobart', 'Bellevue', 'Allouez', 'Downtown Green Bay', 'East De Pere', 'West De Pere', 'Oneida']) {
    assert.ok(GREEN_BAY_CANONICAL_NEIGHBORHOODS.includes(n), `missing ${n}`)
  }
})

test('evaluateGeographicConsistencyAudit: catches the exact incident — a Suamico venue assigned to Downtown Green Bay', () => {
  const result = evaluateGeographicConsistencyAudit(
    [{ candidateName: 'Chives Restaurant', assignedNeighborhood: 'Downtown Green Bay', formattedAddress: '1749 Riverside Dr, Suamico, WI 54173, USA' }],
    GREEN_BAY_NEIGHBORHOOD_MUNICIPALITY_REGISTRY
  )
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.findings.length, 1)
})

test('evaluateGeographicConsistencyAudit: PASSes a correctly-assigned batch', () => {
  const result = evaluateGeographicConsistencyAudit(
    [
      { candidateName: 'Chives Restaurant', assignedNeighborhood: 'Suamico', formattedAddress: '1749 Riverside Dr, Suamico, WI 54173, USA' },
      { candidateName: 'Meyer Theatre', assignedNeighborhood: 'Downtown Green Bay', formattedAddress: '117 S Washington St, Green Bay, WI 54301, USA' },
    ],
    GREEN_BAY_NEIGHBORHOOD_MUNICIPALITY_REGISTRY
  )
  assert.equal(result.verdict, 'PASS')
})

test('evaluateGeographicConsistencyAudit: flags an unrecognized neighborhood name as its own failure', () => {
  const result = evaluateGeographicConsistencyAudit([{ candidateName: 'x', assignedNeighborhood: 'Made Up Neighborhood', formattedAddress: '1 Main St, Green Bay, WI 54301, USA' }], GREEN_BAY_NEIGHBORHOOD_MUNICIPALITY_REGISTRY)
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.findings[0].reason, /not a recognized canonical neighborhood/)
})
