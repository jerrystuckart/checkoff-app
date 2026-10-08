import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProximityGate, shouldAnimateReveal } from './secretRevealVisit.js'

const R = 100

test('opened already in range: reveals once when eligibility is established', () => {
  const g = createProximityGate()
  assert.equal(g.update(40, R), 'reveal')
  assert.equal(g.update(35, R), 'done')
})

test('opened out of range: far until the user enters range, then reveals once', () => {
  const g = createProximityGate()
  assert.equal(g.update(900, R), 'far')
  assert.equal(g.update(300, R), 'far')
  assert.equal(g.update(99, R), 'reveal')
})

test('GPS updates and boundary jitter never retrigger within a visit', () => {
  const g = createProximityGate()
  assert.equal(g.update(120, R), 'far')
  assert.equal(g.update(99, R), 'reveal')
  for (const d of [101, 98, 130, 100, 99.9, 400, 50]) assert.equal(g.update(d, R), 'done')
})

test('boundary is inclusive and uses the configured radius', () => {
  assert.equal(createProximityGate().update(100, 100), 'reveal')
  assert.equal(createProximityGate().update(100.1, 100), 'far')
  assert.equal(createProximityGate().update(250, 315), 'reveal')
  assert.equal(createProximityGate().update(320, 315), 'far')
})

test('leaving and opening the screen again (a new gate) allows another reveal', () => {
  const first = createProximityGate()
  assert.equal(first.update(10, R), 'reveal')
  const second = createProximityGate()
  assert.equal(second.update(10, R), 'reveal')
})

test('Try again after a location error re-arms the gate', () => {
  const g = createProximityGate()
  assert.equal(g.update(10, R), 'reveal')
  g.reset()
  assert.equal(g.update(10, R), 'reveal')
})

test('the animation plays once per visit and never under Reduce Motion', () => {
  assert.equal(shouldAnimateReveal({ arrival: true, alreadyPlayed: false, reduceMotion: false }), true)
  assert.equal(shouldAnimateReveal({ arrival: true, alreadyPlayed: true, reduceMotion: false }), false)
  assert.equal(shouldAnimateReveal({ arrival: false, alreadyPlayed: false, reduceMotion: false }), false)
  assert.equal(shouldAnimateReveal({ arrival: true, alreadyPlayed: false, reduceMotion: true }), false)
})

test('Reduce Motion does not change eligibility: the gate result is identical', () => {
  const a = createProximityGate(), b = createProximityGate()
  assert.deepEqual([a.update(500, R), a.update(50, R)], [b.update(500, R), b.update(50, R)])
})
