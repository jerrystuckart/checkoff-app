// Item Detail Redesign (2026-09-18) — pure-logic coverage for
// lib/inviteMessage.js, this repo's established convention (node:test over
// extracted pure logic, no RN render harness).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInviteMessage, truncateItemBody, buildItemDeepLinkUrl } from './inviteMessage.js'

test('venue-present message includes the approved copy verbatim', () => {
  const msg = buildInviteMessage({ itemBody: 'Try the tasting flight', venue: 'Cartel Coffee Lab' })
  assert.ok(
    msg.includes('I found something cool for us to do at Cartel Coffee Lab. You in?'),
    'must include the exact venue-present template'
  )
})

test('venue-missing message falls back to the approved no-venue copy verbatim', () => {
  const msg = buildInviteMessage({ itemBody: 'Try the tasting flight', venue: null })
  assert.ok(
    msg.includes('I found something cool for us to do. You in?'),
    'must include the exact venue-missing template'
  )
})

test('does not lead with CheckOff app promotion', () => {
  const msg = buildInviteMessage({ itemBody: 'Try the tasting flight', venue: 'Cartel Coffee Lab' })
  assert.ok(!/^download checkoff/i.test(msg.trim()), 'must not open with app-download promotion')
  assert.ok(msg.indexOf('I found something cool') < msg.indexOf('getcheckoff.com'), 'the experience copy must precede the URL')
})

test('an explicit item-specific URL is included when supplied', () => {
  const url = 'https://getcheckoff.com/item/abc-123'
  const msg = buildInviteMessage({ itemBody: 'Thing', venue: 'Place', itemUrl: url })
  assert.ok(msg.includes(url), 'supplied itemUrl must appear in the message')
})

test('falls back to the list join URL when no itemUrl but a listInviteCode is present', () => {
  const msg = buildInviteMessage({ itemBody: 'Thing', venue: null, listInviteCode: 'XYZ789' })
  assert.ok(msg.includes('https://getcheckoff.com/join/XYZ789'), 'must fall back to the existing list join URL')
})

test('falls back to the bare homepage when neither itemUrl nor listInviteCode is present', () => {
  const msg = buildInviteMessage({ itemBody: 'Thing', venue: null })
  assert.ok(msg.includes('https://getcheckoff.com'), 'must fall back to the bare homepage URL')
  assert.ok(!msg.includes('undefined'), 'must never leak an undefined URL into the message')
})

test('never throws and never produces "undefined" with no arguments at all', () => {
  assert.doesNotThrow(() => buildInviteMessage())
  const msg = buildInviteMessage()
  assert.ok(!msg.includes('undefined'))
  assert.ok(msg.includes('https://getcheckoff.com'))
})

test('excessively long item body is truncated with an ellipsis, not dumped raw', () => {
  const longBody = 'A'.repeat(400)
  const truncated = truncateItemBody(longBody)
  assert.ok(truncated.length < longBody.length, 'must be shorter than the raw input')
  assert.ok(truncated.endsWith('…'), 'must end with an ellipsis marker')

  const msg = buildInviteMessage({ itemBody: longBody, venue: 'Place' })
  assert.ok(!msg.includes(longBody), 'the raw, untruncated body must never appear in the message')
})

test('short item body is left untouched (no unnecessary truncation)', () => {
  assert.equal(truncateItemBody('Short body'), 'Short body')
})

test('buildItemDeepLinkUrl produces the preferred https://getcheckoff.com/item/<id> format, or null with no id', () => {
  assert.equal(buildItemDeepLinkUrl('abc-123'), 'https://getcheckoff.com/item/abc-123')
  assert.equal(buildItemDeepLinkUrl(null), null)
  assert.equal(buildItemDeepLinkUrl(undefined), null)
})
