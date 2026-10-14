import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverPlacement, normalizeFocus, DEFAULT_FOCUS } from './imageCrop.js'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

test('always covers the box, never leaves a gap', () => {
  for (const [w, h] of [[1440, 1920], [1170, 2532], [1600, 900], [500, 500]]) {
    const p = coverPlacement({ imgW: w, imgH: h, boxW: 393, boxH: 613 })
    assert.ok(p.width >= 393 - 1e-6 && p.height >= 613 - 1e-6)
    assert.ok(p.left <= 1e-6 && p.left + p.width >= 393 - 1e-6)
    assert.ok(p.top <= 1e-6 && p.top + p.height >= 613 - 1e-6)
  }
})

test('focus moves the crop on the overflowing axis only', () => {
  // tall image into a squarer box: vertical overflow, so focus.y matters and focus.x does not
  const top = coverPlacement({ imgW: 1170, imgH: 2532, boxW: 393, boxH: 613, focus: { x: 50, y: 0 } })
  const bottom = coverPlacement({ imgW: 1170, imgH: 2532, boxW: 393, boxH: 613, focus: { x: 50, y: 100 } })
  near(top.top, 0)
  near(bottom.top, -(bottom.height - 613))
  near(top.left, bottom.left)
  // wide image: horizontal overflow
  const l = coverPlacement({ imgW: 1600, imgH: 900, boxW: 393, boxH: 613, focus: { x: 0, y: 50 } })
  const r = coverPlacement({ imgW: 1600, imgH: 900, boxW: 393, boxH: 613, focus: { x: 100, y: 50 } })
  near(l.left, 0)
  near(r.left, -(r.width - 393))
})

test('defaults, clamping and bad input', () => {
  assert.deepEqual(normalizeFocus(null), DEFAULT_FOCUS)
  assert.deepEqual(normalizeFocus({ x: -20, y: 400 }), { x: 0, y: 100 })
  assert.deepEqual(normalizeFocus({ x: 'a', y: undefined }), DEFAULT_FOCUS)
  assert.equal(coverPlacement({ imgW: 0, imgH: 10, boxW: 1, boxH: 1 }), null)
})
