// Chief Phase 2I — the founder meeting-prep packet (methodology 6F).
// Pure assembly, no I/O, no AI call — every field is already known
// structured state (DVA/DAP status, relationship history, DAP's own
// extracted fields) by the time a meeting becomes likely; this just
// renders it into a ~90-second read.

export interface MeetingPrepInput {
  destinationName: string
  contactName: string
  contactRole: string | null
  whyTheyMatter: string
  relationshipHistory: string[]
  dvaDapStatus: string
  whatTheyCareAbout: string[]
  whatWeSent: string[]
  whatTheyAsked: string[]
  budgetTimingIntel: string[]
  likelyObjections: string[]
  meetingObjective: string
  recommendedQuestions: string[]
  doNotPromise: string[]
  desiredNextStep: string
}

function bulletSection(title: string, items: readonly string[]): string {
  if (items.length === 0) return `## ${title}\n(none on file)`
  return `## ${title}\n${items.map((i) => `- ${i}`).join('\n')}`
}

export function buildMeetingPrepPacket(input: MeetingPrepInput): string {
  return [
    `# Meeting Prep — ${input.destinationName}`,
    `**Who you're meeting:** ${input.contactName}${input.contactRole ? ` (${input.contactRole})` : ''}`,
    `**Why they matter:** ${input.whyTheyMatter}`,
    `**DVA/DAP status:** ${input.dvaDapStatus}`,
    bulletSection('Relationship History', input.relationshipHistory),
    bulletSection('What They Care About', input.whatTheyCareAbout),
    bulletSection("What We've Sent", input.whatWeSent),
    bulletSection("What They've Asked", input.whatTheyAsked),
    bulletSection('Budget/Timing Intelligence', input.budgetTimingIntel),
    bulletSection('Likely Objections', input.likelyObjections),
    `## Meeting Objective\n${input.meetingObjective}`,
    bulletSection('Recommended Questions', input.recommendedQuestions),
    bulletSection('Do NOT Promise / Watch-Outs', input.doNotPromise),
    `## Desired Next Step\n${input.desiredNextStep}`,
  ].join('\n\n')
}

// ---------------------------------------------------------------------------
// Meeting follow-up (methodology 6F/6D) — recording what happened and
// deriving the resulting operational tasks + which lessons (if any) are
// durable enough to recommend for Open Brain. Chief only ever
// RECOMMENDS a durable lesson (see openBrainDecisions.ts's own "EXECUTE
// only, never approve itself" discipline) — never auto-promotes one.
// ---------------------------------------------------------------------------

export interface MeetingOutcome {
  destinationId: string
  contactsInvolved: string[]
  keyStatements: string[]
  decisions: string[]
  promisesMade: string[]
  materialsRequested: string[]
  nextSteps: string[]
  /** Explicitly tagged by whoever records the outcome (Jerry, or Chief drafting from notes) as a reusable lesson beyond this one relationship — never auto-inferred from free text. */
  durableLessons: string[]
}

export interface MeetingFollowUpTask {
  kind: 'PROVIDE_MATERIAL' | 'FOLLOW_UP_ACTION' | 'HONOR_PROMISE'
  description: string
}

export interface MeetingFollowUpResult {
  tasks: MeetingFollowUpTask[]
  recommendedForOpenBrain: string[]
}

/** Turns a recorded meeting outcome into concrete follow-up tasks — never leaves a promise or requested material implicit. */
export function deriveMeetingFollowUp(outcome: MeetingOutcome): MeetingFollowUpResult {
  const tasks: MeetingFollowUpTask[] = [
    ...outcome.materialsRequested.map((m): MeetingFollowUpTask => ({ kind: 'PROVIDE_MATERIAL', description: `Provide requested material: ${m}` })),
    ...outcome.promisesMade.map((p): MeetingFollowUpTask => ({ kind: 'HONOR_PROMISE', description: `Honor promise made in meeting: ${p}` })),
    ...outcome.nextSteps.map((n): MeetingFollowUpTask => ({ kind: 'FOLLOW_UP_ACTION', description: n })),
  ]
  return { tasks, recommendedForOpenBrain: outcome.durableLessons }
}
