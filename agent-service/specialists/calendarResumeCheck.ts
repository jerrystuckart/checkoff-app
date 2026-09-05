// Chief Phase 2J — the Calendar resume path (spec section 11). No
// constant calendar polling — Jerry explicitly doesn't need that. This
// recognizes an event that ALREADY exists on the calendar (Jerry
// accepted/created it himself, since creating one is APPROVAL_REQUIRED
// and Chief never does it autonomously), associates it to the correct
// destination by matching attendee emails against known relationship
// contacts, and triggers the existing MEETING_SCHEDULED resume action
// (applyRelationshipResumeEvent -> CREATE_MEETING_PREP_TASK). Never
// guesses: more than one destination's contact among the attendees is
// refused, exactly like email association.

import { associateInboundEmail, type KnownRelationshipContact } from '../playbooks/gmailRelationshipLogic'

export interface CalendarEventSummary {
  eventId: string
  summary: string
  attendeeEmails: string[]
  startIso: string
}

export type CalendarAssociationResult = { associated: true; destinationId: string; contactId: string } | { associated: false; reason: string }

/**
 * Reuses associateInboundEmail's exact matching semantics (email-based,
 * refuse-on-ambiguity) by treating each attendee as a candidate "from"
 * address — a calendar event has no thread id, so this only ever matches
 * on email address, which is sufficient since a genuine meeting invite
 * necessarily includes the real contact's real address.
 */
export function associateCalendarEvent(event: CalendarEventSummary, knownContacts: readonly KnownRelationshipContact[]): CalendarAssociationResult {
  for (const attendeeEmail of event.attendeeEmails) {
    const result = associateInboundEmail({ from: attendeeEmail, to: [], threadId: null, subject: event.summary, bodyText: '', receivedAt: event.startIso }, knownContacts)
    if (result.associated) return result
  }
  return { associated: false, reason: `No attendee (${event.attendeeEmails.join(', ') || '(none)'}) matches any known relationship contact.` }
}
