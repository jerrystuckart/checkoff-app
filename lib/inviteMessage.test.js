// Item Detail Redesign (2026-09-18), corrected 2026-09-19 — pure-logic
// coverage for lib/inviteMessage.js, this repo's established convention
// (node:test over extracted pure logic, no RN render harness).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInviteMessage,
  buildInviteAskLine,
  truncateItemBody,
  buildItemDeepLinkUrl,
} from './inviteMessage.js'

const VALID_ITEM_ID = '123e4567-e89b-12d3-a456-426614174000'

test('approved message format: conversational opening, complete quoted body, "You in?", URL on its own line', () => {
  const msg = buildInviteMessage({ itemBody: 'Try the tasting flight', itemId: VALID_ITEM_ID })
  assert.equal(
    msg,
    `I found something cool for us to do: "Try the tasting flight" You in?\nhttps://getcheckoff.com/item/${VALID_ITEM_ID}`
  )
})

test('missing-body fallback is a distinct exact string (no colon, no quotes)', () => {
  const msg = buildInviteMessage({ itemBody: null, itemId: VALID_ITEM_ID })
  assert.equal(
    msg,
    `I found something cool for us to do. You in?\nhttps://getcheckoff.com/item/${VALID_ITEM_ID}`
  )
})

test('missing-body fallback also applies for an empty-string body', () => {
  const msg = buildInviteMessage({ itemBody: '   ', itemId: VALID_ITEM_ID })
  assert.ok(msg.startsWith('I found something cool for us to do. You in?'))
})

test('does not lead with CheckOff app promotion, never mentions downloading the app', () => {
  const msg = buildInviteMessage({ itemBody: 'Try the tasting flight', itemId: VALID_ITEM_ID })
  assert.ok(!/download checkoff/i.test(msg), 'must not mention downloading the app anywhere')
  assert.ok(msg.indexOf('I found something cool') < msg.indexOf('getcheckoff.com'), 'the experience copy must precede the URL')
})

test('item-specific HTTPS URL format is exactly https://getcheckoff.com/item/<id>', () => {
  assert.equal(buildItemDeepLinkUrl(VALID_ITEM_ID), `https://getcheckoff.com/item/${VALID_ITEM_ID}`)
})

test('a valid UUID produces the item-specific URL in the built message', () => {
  const msg = buildInviteMessage({ itemBody: 'Thing', itemId: VALID_ITEM_ID })
  assert.ok(msg.includes(`https://getcheckoff.com/item/${VALID_ITEM_ID}`))
})

test('an invalid/malformed UUID falls back to existing generic sharing behavior, never fabricating a broken item URL', () => {
  assert.equal(buildItemDeepLinkUrl('abc-123'), null, 'a non-UUID-shaped id must not produce an item URL')
  assert.equal(buildItemDeepLinkUrl(undefined), null)
  assert.equal(buildItemDeepLinkUrl(null), null)

  const msgNoListCode = buildInviteMessage({ itemBody: 'Thing', itemId: 'abc-123' })
  assert.ok(msgNoListCode.includes('https://getcheckoff.com'), 'must fall back to the bare homepage URL')
  assert.ok(!msgNoListCode.includes('/item/abc-123'), 'must never fabricate an item URL from a malformed id')

  const msgWithListCode = buildInviteMessage({ itemBody: 'Thing', itemId: 'not-a-uuid', listInviteCode: 'XYZ789' })
  assert.ok(msgWithListCode.includes('https://getcheckoff.com/join/XYZ789'), 'must fall back to the existing list join URL when present')
})

test('never fabricates a broken /item/undefined or /item/[object Object] URL', () => {
  assert.ok(!buildInviteMessage({ itemBody: 'Thing', itemId: undefined }).includes('/item/undefined'))
  assert.ok(!buildInviteMessage({ itemBody: 'Thing', itemId: {} }).includes('/item/[object Object]'))
  assert.ok(!buildInviteMessage().includes('/item/undefined'))
})

test('no generic bare-homepage URL is used when a valid item id exists (regression)', () => {
  const msg = buildInviteMessage({ itemBody: 'Thing', itemId: VALID_ITEM_ID, listInviteCode: 'XYZ789' })
  assert.ok(msg.includes(`https://getcheckoff.com/item/${VALID_ITEM_ID}`), 'the item-specific URL must win over the list-join fallback')
  assert.ok(!msg.includes('https://getcheckoff.com/join/'), 'must not fall back to the list-join URL when a valid item id is present')
})

test('no raw checkoff:// URL ever appears in the shared/public message text', () => {
  const cases = [
    buildInviteMessage({ itemBody: 'Thing', itemId: VALID_ITEM_ID }),
    buildInviteMessage({ itemBody: 'Thing', itemId: null }),
    buildInviteMessage({ itemBody: 'Thing', itemId: null, listInviteCode: 'XYZ789' }),
    buildInviteMessage(),
  ]
  for (const msg of cases) {
    assert.ok(!msg.includes('checkoff://'), 'the shared message must never contain a raw checkoff:// URL')
  }
})

test('falls back to the list join URL when no valid itemId but a listInviteCode is present', () => {
  const msg = buildInviteMessage({ itemBody: 'Thing', itemId: null, listInviteCode: 'XYZ789' })
  assert.ok(msg.includes('https://getcheckoff.com/join/XYZ789'), 'must fall back to the existing list join URL')
})

test('falls back to the bare homepage when neither a valid itemId nor a listInviteCode is present', () => {
  const msg = buildInviteMessage({ itemBody: 'Thing', itemId: null })
  assert.ok(msg.includes('https://getcheckoff.com'), 'must fall back to the bare homepage URL')
  assert.ok(!msg.includes('undefined'), 'must never leak an undefined URL into the message')
})

test('never throws and never produces "undefined" with no arguments at all', () => {
  assert.doesNotThrow(() => buildInviteMessage())
  const msg = buildInviteMessage()
  assert.ok(!msg.includes('undefined'))
  assert.ok(msg.includes('https://getcheckoff.com'))
})

test('a long item body (150+ chars) appears in FULL in the shared message — no truncation', () => {
  const longBody = 'A'.repeat(180)
  const msg = buildInviteMessage({ itemBody: longBody, itemId: VALID_ITEM_ID })
  assert.ok(msg.includes(`"${longBody}"`), 'the complete, untruncated body must appear in the shared message')
  assert.ok(!msg.includes('…'), 'the shared message must never contain a truncation ellipsis')
})

test('whitespace is normalized: leading/trailing whitespace on the body is trimmed cleanly', () => {
  const msg = buildInviteMessage({ itemBody: '   Try the tasting flight   ', itemId: VALID_ITEM_ID })
  assert.ok(msg.includes('"Try the tasting flight"'), 'body must be trimmed, not padded with stray whitespace')
  assert.ok(!msg.includes('  '), 'must not contain doubled/collapsed whitespace')
})

test('a body ending in its own punctuation does not produce doubled punctuation or ambiguous quoting', () => {
  const msg = buildInviteMessage({ itemBody: 'Try the tasting flight!', itemId: VALID_ITEM_ID })
  assert.ok(msg.includes('"Try the tasting flight!" You in?'), 'closing quote then "You in?" must read cleanly regardless of the body\'s own trailing punctuation')
  assert.ok(!msg.includes('..'), 'must never produce doubled periods')
  assert.ok(!msg.includes('??'), 'must never produce doubled question marks')
})

test('apostrophes and quotation marks already present in the body are preserved verbatim', () => {
  const msg = buildInviteMessage({ itemBody: `Try the "chef's special" flight`, itemId: VALID_ITEM_ID })
  assert.ok(msg.includes(`"Try the "chef's special" flight"`), 'existing quotes/apostrophes in item.body must not be escaped or mangled')
})

test('excessively long item body is truncated with an ellipsis for the CARD PREVIEW only (buildInviteAskLine), not the shared message', () => {
  const longBody = 'A'.repeat(400)
  const truncated = truncateItemBody(longBody)
  assert.ok(truncated.length < longBody.length, 'must be shorter than the raw input')
  assert.ok(truncated.endsWith('…'), 'must end with an ellipsis marker')

  const askLine = buildInviteAskLine({ itemBody: longBody })
  assert.ok(!askLine.includes(longBody), 'the card preview may clamp the body for display')

  const msg = buildInviteMessage({ itemBody: longBody, itemId: VALID_ITEM_ID })
  assert.ok(msg.includes(longBody), 'the actual shared message must always contain the complete, untruncated body')
})

test('short item body is left untouched by truncateItemBody (no unnecessary truncation)', () => {
  assert.equal(truncateItemBody('Short body'), 'Short body')
})

test('buildInviteAskLine renders the approved conversational card-preview copy, with body-missing fallback', () => {
  assert.equal(
    buildInviteAskLine({ itemBody: 'Try the tasting flight' }),
    'I found something cool for us to do: "Try the tasting flight" You in?'
  )
  assert.equal(
    buildInviteAskLine({ itemBody: null }),
    'I found something cool for us to do. You in?'
  )
  assert.equal(
    buildInviteAskLine(),
    'I found something cool for us to do. You in?'
  )
})
