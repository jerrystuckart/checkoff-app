// Chief Phase 2C — explicit executor/capability gap record. Per the
// Phase 2C correction's own instruction: "If this cannot currently be
// invoked programmatically, represent it as an explicit executor/
// capability gap rather than pretending it is automated."
//
// THE GAP: agent-service has no way to programmatically invoke a Claude
// Project (DVA-1, DVA-2, or DAP) and retrieve its output. Every run
// today is a human (Jerry, or Jerry directing a Claude session) working
// inside that Project by hand and then handing the resulting markdown
// artifact to Chief. The types in destinationHubLifecycle.ts model the
// CONTRACT for that handoff (ExternalArtifactRef, DVA1Artifact,
// DVA2Artifact, DAPArtifact) so Chief can validate/route/store a
// received artifact correctly — none of them assume invocation is
// automated, and nothing in this codebase calls out to Anthropic's API,
// a Claude Project, or any external LLM provider to PRODUCE one of these
// artifacts.
//
// WHAT THIS MEANS OPERATIONALLY, TODAY: recordExternalArtifact (a future
// mutation, not yet implemented — see below) would be called by a human
// pasting/attaching the already-produced artifact, not by Chief kicking
// off the DVA-1 Project itself. "Chief initiates the correct stage"
// (Phase 2C spec) means Chief creates the tracking task and states what
// input the human needs to hand to the DVA-1/DVA-2/DAP Project — not
// that Chief opens that Project and runs it.
//
// WHAT WOULD CLOSE THIS GAP (not implemented, listed for a future
// decision, never assumed available): a programmatic Claude Projects
// API/export mechanism, or a documented manual hand-off convention
// (e.g. Jerry pastes the artifact into a known location Chief can read
// via the existing bounded artifactWriter.ts). Closing this gap is a
// deliberate, separate decision — not something to silently work around
// with a fake automated path.

export interface ExecutorGap {
  key: string
  description: string
  blockedCapability: string
  workaroundToday: string
}

// ---------------------------------------------------------------------------
// Phase 2D addition — Gmail/Calendar resume-event DESIGN ONLY (spec
// section 22). No Gmail/Calendar integration is wired here or anywhere
// in this codebase; this is the shape a future integration would need to
// slot into the existing WAITING + nextCheckAt resume primitive
// unchanged. Nothing here sends an email or touches Jerry's calendar.
// ---------------------------------------------------------------------------

export type DestinationRelationshipResumeEventKind = 'GMAIL_REPLY_RECEIVED' | 'MEETING_REQUESTED' | 'MEETING_SCHEDULED' | 'MEETING_COMPLETE'

export interface DestinationRelationshipResumeEvent {
  kind: DestinationRelationshipResumeEventKind
  destinationId: string
  contactId: string | null
  occurredAt: string
  /** Free-form payload specific to the event kind — an inbound email's subject/snippet, a meeting's proposed time, etc. Never itself a source of truth; the resume logic re-reads structured state, this just wakes it up. */
  payload: Record<string, unknown>
}

export interface ResumeAction {
  action: 'ASSOCIATE_AND_CLASSIFY' | 'CHECK_JERRY_AVAILABILITY' | 'CREATE_MEETING_PREP_TASK' | 'CAPTURE_OUTCOME_AND_FOLLOW_UPS'
  requiresJerry: boolean
  reason: string
}

/**
 * The dispatcher a future Gmail/Calendar integration would call — pure,
 * no I/O. `GMAIL_REPLY_RECEIVED` -> associate to the correct destination/
 * contact then classify (AUTO — destination_relationship.classify_reply).
 * `MEETING_REQUESTED` -> check Jerry's availability; Jerry's own
 * participation/scheduling choice is APPROVAL_REQUIRED
 * (destination_relationship.create_calendar_event), so this always
 * requires Jerry. `MEETING_SCHEDULED` -> create a meeting-prep task
 * (AUTO — destination_relationship.gather_meeting_evidence).
 * `MEETING_COMPLETE` -> capture outcome/action items, create follow-ups
 * (AUTO).
 */
export function deriveResumeAction(event: DestinationRelationshipResumeEvent): ResumeAction {
  switch (event.kind) {
    case 'GMAIL_REPLY_RECEIVED':
      return { action: 'ASSOCIATE_AND_CLASSIFY', requiresJerry: false, reason: 'Inbound reply — associate to destination/contact and classify deterministically before any further routing.' }
    case 'MEETING_REQUESTED':
      return { action: 'CHECK_JERRY_AVAILABILITY', requiresJerry: true, reason: "Creating a calendar event is APPROVAL_REQUIRED — Jerry's availability/choice is needed regardless of how routine the request looks." }
    case 'MEETING_SCHEDULED':
      return { action: 'CREATE_MEETING_PREP_TASK', requiresJerry: false, reason: 'A scheduled meeting needs a prep brief assembled from the dossier — gathering evidence for that is AUTO.' }
    case 'MEETING_COMPLETE':
      return { action: 'CAPTURE_OUTCOME_AND_FOLLOW_UPS', requiresJerry: false, reason: 'Recording what happened and queuing follow-ups is AUTO; any resulting commercial action is gated separately by its own standing-authority entry.' }
  }
}

export const DESTINATION_EXECUTOR_GAPS: readonly ExecutorGap[] = Object.freeze([
  {
    key: 'dva1_invocation',
    description: 'No programmatic way to invoke the DVA-1 Claude Project or retrieve its markdown output.',
    blockedCapability: 'destination_hub.dva1_screen (fully automated form)',
    workaroundToday: 'Jerry (or a Claude session Jerry directs) runs DVA-1 manually in that Project; the resulting artifact is handed to Chief as a DVA1Artifact reference.',
  },
  {
    key: 'dva2_invocation',
    description: 'No programmatic way to invoke the DVA-2 Claude Project with a DVA-1 artifact as input.',
    blockedCapability: 'destination_hub.draft_dva2 (fully automated form)',
    workaroundToday: 'Same manual hand-off pattern as DVA-1, with the DVA-1 artifact passed in by hand.',
  },
  {
    key: 'dap_invocation',
    description: 'No programmatic way to invoke the DAP Claude Project with a DVA-2 artifact as input.',
    blockedCapability: 'destination_hub.draft_dap (fully automated form)',
    workaroundToday: 'Same manual hand-off pattern, with the DVA-2 artifact passed in by hand.',
  },
  {
    key: 'gmail_calendar_execution',
    description: 'No live Gmail/Google Calendar/Google Contacts integration wired into agent-service today.',
    blockedCapability: 'destination_relationship_manager sending real email or creating real calendar events',
    workaroundToday: 'None — outbound send and calendar mutation remain APPROVAL_REQUIRED and unimplemented; drafts/recommendations only.',
  },
])
