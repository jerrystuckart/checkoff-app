import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeHeaderValue } from './googleAdapters'

const decode = (h: string) => h.split(/\r\n /).map((w) => { const m = w.match(/^=\?UTF-8\?B\?(.+)\?=$/); return m ? Buffer.from(m[1], 'base64').toString('utf8') : w }).join('')

test('ASCII subjects are untouched', () => {
  assert.equal(encodeHeaderValue('CheckOff launches in Willcox today!'), 'CheckOff launches in Willcox today!')
})

test("the Willcox invitation subject (em dash) is RFC 2047 encoded and round-trips exactly", () => {
  const s = "CheckOff just launched in Willcox — we'd love to include your business"
  const h = encodeHeaderValue(s)
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(h), 'header is pure ASCII on the wire')
  assert.ok(h.split(/\r\n /).every((w) => w.length <= 75))
  assert.equal(decode(h), s)
})

test('long non-ASCII subjects never split a multi-byte character', () => {
  const s = 'Café — ' + '日本語'.repeat(20) + ' — “quoted”'
  assert.equal(decode(encodeHeaderValue(s)), s)
})
