import { test } from 'node:test'
import assert from 'node:assert/strict'
import { associateCalendarEvent } from './calendarResumeCheck'
import type { KnownRelationshipContact } from '../playbooks/gmailRelationshipLogic'

const contact: KnownRelationshipContact = { destinationId: 'destination-hood-river-or', contactId: 'contact-1', email: 'jane@hoodriver.example.com', threadId: null }

test('associateCalendarEvent: recognizes a scheduled event and associates it to the correct destination via attendee email', () => {
  const result = associateCalendarEvent({ eventId: 'evt-1', summary: 'Discovery call', attendeeEmails: ['jerry@checkoff.app', 'jane@hoodriver.example.com'], startIso: '2026-09-10T17:00:00Z' }, [contact])
  assert.ok(result.associated)
  if (result.associated) assert.equal(result.destinationId, 'destination-hood-river-or')
})

test('associateCalendarEvent: an event with no matching attendee is not associated, never guessed', () => {
  const result = associateCalendarEvent({ eventId: 'evt-2', summary: 'Unrelated meeting', attendeeEmails: ['jerry@checkoff.app', 'someone-else@example.com'], startIso: '2026-09-10T17:00:00Z' }, [contact])
  assert.equal(result.associated, false)
})

test('associateCalendarEvent: an attendee email shared across two destinations refuses association', () => {
  const contactA: KnownRelationshipContact = { destinationId: 'destination-a', contactId: 'contact-a', email: 'shared@example.com', threadId: null }
  const contactB: KnownRelationshipContact = { destinationId: 'destination-b', contactId: 'contact-b', email: 'shared@example.com', threadId: null }
  const result = associateCalendarEvent({ eventId: 'evt-3', summary: 'Meeting', attendeeEmails: ['shared@example.com'], startIso: '2026-09-10T17:00:00Z' }, [contactA, contactB])
  assert.equal(result.associated, false)
})
