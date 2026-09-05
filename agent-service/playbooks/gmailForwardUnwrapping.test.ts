import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isKnownForwardingAddress, knownForwardingAddresses, parseForwardedHeaderBlock, unwrapForwardedSender, DEFAULT_FORWARDING_ADDRESSES } from './gmailForwardUnwrapping'

test('knownForwardingAddresses: defaults to the known CheckOff relay identities', () => {
  const prior = process.env.CHIEF_FORWARDING_ADDRESSES
  delete process.env.CHIEF_FORWARDING_ADDRESSES
  try {
    assert.deepEqual(knownForwardingAddresses(), DEFAULT_FORWARDING_ADDRESSES)
    assert.ok(isKnownForwardingAddress('forwarder@getcheckoff.com'))
    assert.ok(isKnownForwardingAddress('jerry@getcheckoff.com'))
    assert.ok(isKnownForwardingAddress('JERRY@GETCHECKOFF.COM')) // case-insensitive
    assert.ok(!isKnownForwardingAddress('desiree@example.com'))
  } finally {
    if (prior !== undefined) process.env.CHIEF_FORWARDING_ADDRESSES = prior
  }
})

test('knownForwardingAddresses: honors CHIEF_FORWARDING_ADDRESSES override, comma-separated', () => {
  const prior = process.env.CHIEF_FORWARDING_ADDRESSES
  process.env.CHIEF_FORWARDING_ADDRESSES = 'relay@example.com, other@example.com'
  try {
    assert.deepEqual(knownForwardingAddresses(), ['relay@example.com', 'other@example.com'])
    assert.ok(isKnownForwardingAddress('relay@example.com'))
    assert.ok(!isKnownForwardingAddress('forwarder@getcheckoff.com'), 'an explicit override replaces the default list, not merges with it')
  } finally {
    if (prior === undefined) delete process.env.CHIEF_FORWARDING_ADDRESSES
    else process.env.CHIEF_FORWARDING_ADDRESSES = prior
  }
})

test('parseForwardedHeaderBlock: extracts From/To/Cc/Subject from a classic Gmail forward marker', () => {
  const body = [
    'Hey Jerry, fyi see below.',
    '',
    '---------- Forwarded message ---------',
    'From: Desiree Gerth <desiree@example.com>',
    'Date: Thu, Sep 4, 2026 at 6:12 PM',
    'Subject: Willcox Destination Hub — pricing follow-up',
    'To: Lisa Ramirez <lisa@willcoxchamber.org>, Jerry Stuckart <jerry@getcheckoff.com>',
    '',
    'Hi Lisa, following up on the pricing details we discussed for the Willcox Hub...',
  ].join('\n')

  const block = parseForwardedHeaderBlock(body)
  assert.ok(block)
  assert.equal(block!.from, 'desiree@example.com')
  assert.deepEqual(block!.to, ['lisa@willcoxchamber.org', 'jerry@getcheckoff.com'])
  assert.equal(block!.subject, 'Willcox Destination Hub — pricing follow-up')
})

test('parseForwardedHeaderBlock: recognizes "Begin forwarded message:" variant too', () => {
  const body = ['Begin forwarded message:', '', 'From: someone@example.com', 'To: recipient@example.com', ''].join('\n')
  const block = parseForwardedHeaderBlock(body)
  assert.ok(block)
  assert.equal(block!.from, 'someone@example.com')
})

test('parseForwardedHeaderBlock: returns null for ordinary body text with no forward marker — never fabricates a block', () => {
  assert.equal(parseForwardedHeaderBlock('Just a normal email reply, nothing forwarded here.'), null)
})

test('parseForwardedHeaderBlock: returns null when the marker exists but no From/To header follows it', () => {
  assert.equal(parseForwardedHeaderBlock('---------- Forwarded message ---------\nNothing that looks like a header here.'), null)
})

test('unwrapForwardedSender: recovers via the header block when present — highest confidence', () => {
  const bodyText = ['---------- Forwarded message ---------', 'From: Desiree Gerth <desiree@example.com>', 'To: lisa@willcoxchamber.org, jerry@getcheckoff.com', 'Subject: Willcox pricing', ''].join('\n')
  const result = unwrapForwardedSender({ transportFrom: 'forwarder@getcheckoff.com', replyTo: null, bodyText })
  assert.equal(result.recovered, true)
  assert.equal(result.recoveredVia, 'FORWARDED_HEADER_BLOCK')
  assert.equal(result.originalFrom, 'desiree@example.com')
  assert.deepEqual(result.originalTo, ['lisa@willcoxchamber.org', 'jerry@getcheckoff.com'])
})

test('unwrapForwardedSender: falls back to Reply-To when no header block is present', () => {
  const result = unwrapForwardedSender({ transportFrom: 'forwarder@getcheckoff.com', replyTo: 'desiree@example.com', bodyText: 'No forward block here, just a note.' })
  assert.equal(result.recovered, true)
  assert.equal(result.recoveredVia, 'REPLY_TO')
  assert.equal(result.originalFrom, 'desiree@example.com')
})

test('unwrapForwardedSender: Reply-To identical to the transport sender is not a real recovery signal', () => {
  const result = unwrapForwardedSender({ transportFrom: 'forwarder@getcheckoff.com', replyTo: 'forwarder@getcheckoff.com', bodyText: 'No forward block here.' })
  assert.equal(result.recovered, false)
})

test('unwrapForwardedSender: recovers nothing when neither a header block nor a useful Reply-To exists — honest, not a guess', () => {
  const result = unwrapForwardedSender({ transportFrom: 'forwarder@getcheckoff.com', replyTo: null, bodyText: 'Just a plain relayed note with no structure.' })
  assert.equal(result.recovered, false)
  assert.equal(result.recoveredVia, null)
  assert.equal(result.originalFrom, null)
})

test('unwrapForwardedSender: the header block takes priority over Reply-To when BOTH are present', () => {
  const bodyText = ['---------- Forwarded message ---------', 'From: header-block-sender@example.com', 'To: someone@example.com', ''].join('\n')
  const result = unwrapForwardedSender({ transportFrom: 'forwarder@getcheckoff.com', replyTo: 'reply-to-sender@example.com', bodyText })
  assert.equal(result.recoveredVia, 'FORWARDED_HEADER_BLOCK')
  assert.equal(result.originalFrom, 'header-block-sender@example.com')
})
