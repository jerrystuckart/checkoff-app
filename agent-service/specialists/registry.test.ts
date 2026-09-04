import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPECIALIST_REGISTRY, listSpecialists, getSpecialist } from './registry'

test('the revised first-generation team is exactly seven specialists (Phase 2D adds checkoff_editor)', () => {
  assert.deepEqual(
    Object.keys(SPECIALIST_REGISTRY).sort(),
    ['business_outreach', 'checkoff_editor', 'destination_activation', 'destination_relationship_manager', 'destination_strategist', 'metro_builder', 'research_verifier'].sort()
  )
})

test('checkoff_editor owns final item wording, not discovery or verification', () => {
  const editor = getSpecialist('checkoff_editor')
  assert.ok(editor.owns.some((o) => o.toLowerCase().includes('wording')))
  assert.ok(!editor.owns.some((o) => o.toLowerCase().includes('discovery')))
  assert.ok(!editor.capabilities.includes('live_web_research'))
})

test('destination_relationship_manager exists and owns the ongoing human relationship (Phase 2C correction)', () => {
  const specialist = getSpecialist('destination_relationship_manager')
  assert.ok(specialist.owns.some((o) => o.toLowerCase().includes('reply')))
  assert.ok(specialist.owns.some((o) => o.toLowerCase().includes('meeting')))
  assert.ok(specialist.capabilities.includes('gmail_read'))
  assert.ok(specialist.capabilities.includes('gmail_send'))
  assert.ok(specialist.capabilities.includes('google_calendar_freebusy'))
  assert.ok(specialist.capabilities.includes('google_calendar_event_create'))
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
