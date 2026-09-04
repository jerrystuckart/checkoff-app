import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyReply, associateInboundEmail, hasPriorCorrespondence, extractEmailAddress, type InboundEmail, type KnownRelationshipContact } from './gmailRelationshipLogic'

test('classifyReply: a clear decline is NO_INTEREST even if other words are present elsewhere', () => {
  const r = classifyReply("Thanks for reaching out, but we're not interested at this time.")
  assert.equal(r.classification, 'NO_INTEREST')
  assert.equal(r.confidence, 'HIGH')
})

test('classifyReply: "I\'d love to talk next week" is MEETING_INTEREST', () => {
  const r = classifyReply("I'd love to talk next week if you have time!")
  assert.equal(r.classification, 'MEETING_INTEREST')
})

test('classifyReply: a referral/introduction is INTRODUCTION_REFERRAL', () => {
  const r = classifyReply('Looping in Jamie from our marketing team, they should be part of this conversation.')
  assert.equal(r.classification, 'INTRODUCTION_REFERRAL')
})

test('classifyReply: a request for a one-pager is INFORMATION_REQUEST', () => {
  const r = classifyReply('This sounds interesting — can you send over a one-pager with more info?')
  assert.equal(r.classification, 'INFORMATION_REQUEST')
})

test('classifyReply: a pricing question is BUDGET_PRICING', () => {
  const r = classifyReply('How much does this cost annually?')
  assert.equal(r.classification, 'BUDGET_PRICING')
})

test('classifyReply: a bare "?" with no other signal is QUESTION at LOW confidence', () => {
  const r = classifyReply('What is this exactly?')
  assert.equal(r.classification, 'QUESTION')
  assert.equal(r.confidence, 'LOW')
})

test('classifyReply: no recognizable signal at all is UNCLEAR', () => {
  const r = classifyReply('Thanks.')
  assert.equal(r.classification, 'UNCLEAR')
})

test('classifyReply: multiple matched categories lower confidence to MEDIUM, never silently pick one with false certainty', () => {
  const r = classifyReply("I'm a little concerned about cost — how much does this run?")
  assert.equal(r.confidence, 'MEDIUM')
})

test('hasPriorCorrespondence: true only when search actually returned results', () => {
  assert.equal(hasPriorCorrespondence([]), false)
  assert.equal(hasPriorCorrespondence([{ id: 'm1' }]), true)
})

test('extractEmailAddress: pulls the bare address out of a display-name header', () => {
  assert.equal(extractEmailAddress('Jane Doe <jane@example.com>'), 'jane@example.com')
  assert.equal(extractEmailAddress('jane@example.com'), 'jane@example.com')
})

function email(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return { from: 'jane@example.com', to: ['chief@checkoff.app'], threadId: 'thread-1', subject: 'Re: Hood River', bodyText: 'Sounds interesting!', receivedAt: '2026-09-08T00:00:00Z', ...overrides }
}

test('associateInboundEmail: matches by threadId when it uniquely identifies one known contact', () => {
  const known: KnownRelationshipContact[] = [{ destinationId: 'destination-hood-river-or', contactId: 'contact-1', email: 'jane@example.com', threadId: 'thread-1' }]
  const result = associateInboundEmail(email(), known)
  assert.ok(result.associated)
  if (result.associated) {
    assert.equal(result.destinationId, 'destination-hood-river-or')
    assert.equal(result.matchedBy, 'THREAD_ID')
  }
})

test('associateInboundEmail: falls back to sender email when threadId is absent', () => {
  const known: KnownRelationshipContact[] = [{ destinationId: 'destination-hood-river-or', contactId: 'contact-1', email: 'jane@example.com', threadId: null }]
  const result = associateInboundEmail(email({ threadId: null }), known)
  assert.ok(result.associated)
  if (result.associated) assert.equal(result.matchedBy, 'EMAIL_ADDRESS')
})

test('associateInboundEmail: an email matching NO known contact is rejected, not guessed', () => {
  const known: KnownRelationshipContact[] = [{ destinationId: 'destination-hood-river-or', contactId: 'contact-1', email: 'someone-else@example.com', threadId: null }]
  const result = associateInboundEmail(email({ threadId: null }), known)
  assert.equal(result.associated, false)
})

test('associateInboundEmail: NEVER cross-associates — the same sender email reused across two destinations is refused, not attached to either', () => {
  const known: KnownRelationshipContact[] = [
    { destinationId: 'destination-hood-river-or', contactId: 'contact-1', email: 'jane@example.com', threadId: null },
    { destinationId: 'destination-willcox-az', contactId: 'contact-2', email: 'jane@example.com', threadId: null },
  ]
  const result = associateInboundEmail(email({ threadId: null }), known)
  assert.equal(result.associated, false)
  if (!result.associated) {
    assert.match(result.reason, /never cross-associat/i)
    assert.match(result.reason, /2 different destination/)
  }
})

test('associateInboundEmail: an ambiguous threadId match across two destinations is refused even though a same-destination fallback might exist', () => {
  const known: KnownRelationshipContact[] = [
    { destinationId: 'destination-hood-river-or', contactId: 'contact-1', email: 'jane@example.com', threadId: 'thread-shared' },
    { destinationId: 'destination-willcox-az', contactId: 'contact-2', email: 'bob@example.com', threadId: 'thread-shared' },
  ]
  const result = associateInboundEmail(email({ threadId: 'thread-shared' }), known)
  assert.equal(result.associated, false)
})
