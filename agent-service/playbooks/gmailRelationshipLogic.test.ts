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
  if (result.associated) assert.equal(result.matchedBy, 'TRANSPORT_SENDER')
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

// ---------------------------------------------------------------------------
// Phase 2L — forwarded-message unwrapping (Resend relay). A real
// overnight proof caught CheckOff correspondence relayed through
// forwarder@getcheckoff.com/jerry@getcheckoff.com being logged as
// ordinary unmatched noise instead of associated to the real destination.
// ---------------------------------------------------------------------------

const WILLCOX_CONTACT: KnownRelationshipContact = { destinationId: 'destination-willcox-az', contactId: 'contact-lisa', email: 'lisa@willcoxchamber.org', threadId: null }

function forwardedWillcoxEmail(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    from: 'CheckOff Forwarder <forwarder@getcheckoff.com>',
    to: ['jerry@getcheckoff.com'],
    threadId: null,
    subject: 'Fwd: Willcox Destination Hub — pricing follow-up',
    bodyText: [
      'Hey Jerry, fyi see below.',
      '',
      '---------- Forwarded message ---------',
      'From: Desiree Gerth <desiree@example.com>',
      'Date: Thu, Sep 4, 2026 at 6:12 PM',
      'Subject: Willcox Destination Hub — pricing follow-up',
      'To: Lisa Ramirez <lisa@willcoxchamber.org>, Jerry Stuckart <jerry@getcheckoff.com>',
      '',
      'Hi Lisa, following up on the pricing details we discussed for the Willcox Hub...',
    ].join('\n'),
    receivedAt: '2026-09-05T02:00:00Z',
    ...overrides,
  }
}

test('Willcox regression: a Resend-forwarded message (transport sender = forwarder@getcheckoff.com) associates to Willcox via the recovered original recipient, not the forwarding address', () => {
  const result = associateInboundEmail(forwardedWillcoxEmail(), [WILLCOX_CONTACT])
  assert.equal(result.associated, true)
  if (result.associated) {
    assert.equal(result.destinationId, 'destination-willcox-az')
    assert.equal(result.contactId, 'contact-lisa')
    assert.equal(result.matchedBy, 'ORIGINAL_RECIPIENT')
    assert.equal(result.transportSender, 'forwarder@getcheckoff.com')
    assert.equal(result.originalSender, 'desiree@example.com')
  }
})

test('Willcox regression: the recovered ORIGINAL sender (Desiree) also resolves correctly when she herself is the known contact on file', () => {
  const desireeContact: KnownRelationshipContact = { destinationId: 'destination-willcox-az', contactId: 'contact-desiree', email: 'desiree@example.com', threadId: null }
  const result = associateInboundEmail(forwardedWillcoxEmail(), [desireeContact])
  assert.equal(result.associated, true)
  if (result.associated) {
    assert.equal(result.matchedBy, 'ORIGINAL_SENDER')
    assert.equal(result.destinationId, 'destination-willcox-az')
  }
})

test('the forwarding address itself NEVER becomes the relationship contact — even if (hypothetically) a contact record existed with that exact email', () => {
  const misconfiguredContact: KnownRelationshipContact = { destinationId: 'destination-someone-else', contactId: 'contact-bad', email: 'forwarder@getcheckoff.com', threadId: null }
  const result = associateInboundEmail(forwardedWillcoxEmail(), [misconfiguredContact, WILLCOX_CONTACT])
  assert.equal(result.associated, true)
  if (result.associated) {
    assert.equal(result.destinationId, 'destination-willcox-az', 'must resolve via the recovered original recipient, never via the forwarding address matching a (misconfigured) contact')
  }
})

test('a forwarded message with jerry@getcheckoff.com as the transport sender behaves identically to forwarder@getcheckoff.com', () => {
  const result = associateInboundEmail(forwardedWillcoxEmail({ from: 'Jerry <jerry@getcheckoff.com>' }), [WILLCOX_CONTACT])
  assert.equal(result.associated, true)
  if (result.associated) assert.equal(result.destinationId, 'destination-willcox-az')
})

test('an ambiguous forwarded message (recovered recipient matches two destinations) remains unassociated, never guessed', () => {
  const otherContact: KnownRelationshipContact = { destinationId: 'destination-other', contactId: 'contact-other', email: 'lisa@willcoxchamber.org', threadId: null }
  const result = associateInboundEmail(forwardedWillcoxEmail(), [WILLCOX_CONTACT, otherContact])
  assert.equal(result.associated, false)
  if (!result.associated) assert.match(result.reason, /never cross-associat/i)
})

test('a forwarded message that recovers NOTHING (no header block, no useful Reply-To) stays unassociated — never falls back to the forwarding address', () => {
  const result = associateInboundEmail(forwardedWillcoxEmail({ bodyText: 'Just a relayed note, no forwarded header block, no Reply-To.' }), [WILLCOX_CONTACT])
  assert.equal(result.associated, false)
  if (!result.associated) {
    assert.equal(result.transportSender, 'forwarder@getcheckoff.com')
    assert.equal(result.originalSender, null)
  }
})

test('direct (non-forwarded) Gmail messages behave EXACTLY as before — forwarding logic never engages for a normal sender', () => {
  const result = associateInboundEmail(email(), [{ destinationId: 'destination-hood-river-or', contactId: 'contact-1', email: 'jane@example.com', threadId: null }])
  assert.equal(result.associated, true)
  if (result.associated) assert.equal(result.matchedBy, 'TRANSPORT_SENDER')
})

test('the SAME forwarded message can never resume the same relationship twice — association is a pure function of its content, calling it twice yields the identical result', () => {
  const first = associateInboundEmail(forwardedWillcoxEmail(), [WILLCOX_CONTACT])
  const second = associateInboundEmail(forwardedWillcoxEmail(), [WILLCOX_CONTACT])
  assert.deepEqual(first, second)
})
