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
