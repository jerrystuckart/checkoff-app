import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foundingMemberDisplay } from './foundingMember.js'

test('shows number and subtitle for qualifying members', () => {
  assert.deepEqual(foundingMemberDisplay(42), { title: 'Founding Member #42', subtitle: 'Here since the beginning.' })
  assert.equal(foundingMemberDisplay(1).title, 'Founding Member #1')
  assert.equal(foundingMemberDisplay(500).title, 'Founding Member #500')
})

test('shows nothing for null, invalid or numbers past 500', () => {
  for (const v of [null, undefined, 0, -3, 501, 1200, 'abc', 4.5]) assert.equal(foundingMemberDisplay(v), null, String(v))
})
