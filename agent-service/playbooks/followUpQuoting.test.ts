import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasBelowReferenceLanguage, validateFollowUpWording, buildQuotedReplyBody } from './followUpQuoting'

test('hasBelowReferenceLanguage: catches "note below", "see below", and bare "below"', () => {
  assert.equal(hasBelowReferenceLanguage('Just following up on the note below —'), true)
  assert.equal(hasBelowReferenceLanguage('See below for details.'), true)
  assert.equal(hasBelowReferenceLanguage('As mentioned below, we should talk.'), true)
})

test('hasBelowReferenceLanguage: real Williams/Elkhart Lake wording that caused the original bug is caught', () => {
  assert.equal(hasBelowReferenceLanguage('Just following up on the note below — I know late summer/early fall gets busy.'), true)
  assert.equal(hasBelowReferenceLanguage('Just circling back on the note below — totally understand if the tail end of summer has been non-stop.'), true)
})

test('hasBelowReferenceLanguage: date-anchored wording does not trip the pattern', () => {
  assert.equal(hasBelowReferenceLanguage('Following up on my note from August 17.'), false)
  assert.equal(hasBelowReferenceLanguage('Circling back on the email I sent a couple weeks ago.'), false)
})

// ---------------------------------------------------------------------------
// Regression coverage required by the fix: quoted -> "below" allowed;
// unquoted -> "below" prohibited.
// ---------------------------------------------------------------------------

test('validateFollowUpWording: "below" wording is VALID when the send actually quotes prior content', () => {
  const result = validateFollowUpWording('Just following up on the note below —', true)
  assert.equal(result.valid, true)
  assert.equal(result.issue, null)
})

test('validateFollowUpWording: "below" wording is INVALID when no prior content is quoted — this is the exact real bug', () => {
  const result = validateFollowUpWording('Just following up on the note below — I know late summer gets busy.', false)
  assert.equal(result.valid, false)
  assert.match(result.issue ?? '', /no prior message is being quoted/)
  assert.match(result.issue ?? '', /Following up on my note from/)
})

test('validateFollowUpWording: date-anchored wording is valid whether or not a quote is included', () => {
  assert.equal(validateFollowUpWording('Following up on my note from August 17.', false).valid, true)
  assert.equal(validateFollowUpWording('Following up on my note from August 17.', true).valid, true)
})

test('validateFollowUpWording: a body with no "below" language at all is always valid', () => {
  assert.equal(validateFollowUpWording('Just wanted to check in — any thoughts?', false).valid, true)
})

test('buildQuotedReplyBody: appends an attribution line and ">"-prefixed quote, preserving the prior body verbatim', () => {
  const result = buildQuotedReplyBody('Just following up on the note below —', {
    fromDisplay: 'Jerry Stuckart <jerry@getcheckoff.com>',
    dateDisplay: 'Mon, Aug 17, 2026 at 1:32 PM',
    bodyText: 'Hi Jessica,\n\nI’m Jerry Stuckart.\n\nWould you be open to a short conversation?',
  })
  assert.match(result, /^Just following up on the note below —/)
  assert.match(result, /On Mon, Aug 17, 2026 at 1:32 PM, Jerry Stuckart <jerry@getcheckoff\.com> wrote:/)
  assert.match(result, /> Hi Jessica,/)
  assert.match(result, /> Would you be open to a short conversation\?/)
})

test('buildQuotedReplyBody: quoting a body with blank lines produces bare ">" markers, not truncated content', () => {
  const result = buildQuotedReplyBody('Hi again.', { fromDisplay: 'Jane <jane@example.com>', dateDisplay: 'Tue, Sep 1, 2026', bodyText: 'Line one.\n\nLine two.' })
  assert.match(result, /> Line one\.\n>\n> Line two\./)
})
