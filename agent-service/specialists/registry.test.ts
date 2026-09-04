import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPECIALIST_REGISTRY, listSpecialists, getSpecialist } from './registry'

test('the revised first-generation team is exactly six specialists', () => {
  assert.deepEqual(
    Object.keys(SPECIALIST_REGISTRY).sort(),
    ['business_outreach', 'destination_activation', 'destination_relationship_manager', 'destination_strategist', 'metro_builder', 'research_verifier'].sort()
  )
})

test('destination_relationship_manager exists and owns the ongoing human relationship (Phase 2C correction)', () => {
  const specialist = getSpecialist('destination_relationship_manager')
  assert.ok(specialist.owns.some((o) => o.toLowerCase().includes('reply')))
  assert.ok(specialist.owns.some((o) => o.toLowerCase().includes('meeting')))
  assert.ok(specialist.capabilities.includes('gmail'))
  assert.ok(specialist.capabilities.includes('google_calendar'))
})

test('destination_activation no longer claims ownership of the outreach/reply lifecycle — that moved to destination_relationship_manager', () => {
  const activation = getSpecialist('destination_activation')
  assert.ok(!activation.owns.some((o) => o.toLowerCase().includes('reply management')))
})

test('every specialist declares canChangeStrategicScope: false — no specialist can independently commit CheckOff', () => {
  for (const s of listSpecialists()) {
    assert.equal(s.canChangeStrategicScope, false)
  }
})

test('every specialist has a distinct owner key', () => {
  const keys = listSpecialists().map((s) => s.ownerKey)
  assert.equal(new Set(keys).size, keys.length)
})
