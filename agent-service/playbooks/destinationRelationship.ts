// Chief Phase 2C — the Relationship playbook (post-DAP human relationship
// management) + the sales-enablement asset-level model. Pure logic only.
//
// Owned by the destination_relationship_manager specialist (Phase 2C
// correction). Reuses the exact same primitives as every other
// playbook in this codebase: agent.tasks status (WAITING + nextCheckAt
// IS the temporal/WAIT-with-resume-date model — no new concept needed),
// agent.task_events for history, agent.contacts for global identity
// (kept separate from this playbook's own relationship-context state —
// see the isolation section below).

import { evaluateAuthority } from './standingAuthority'

export type RelationshipStage =
  | 'RELATIONSHIP_READY'
  | 'ASSETS_PREP'
  | 'INITIAL_OUTREACH'
  | 'WAITING_FOR_REPLY'
  | 'ENGAGED'
  | 'MATERIAL_REQUESTED'
  | 'MEETING_REQUESTED'
  | 'MEETING_SCHEDULED'
  | 'MEETING_PREP'
  | 'MEETING_COMPLETE'
  | 'FOLLOW_UP'
  | 'PROPOSAL'
  | 'NEGOTIATION'
  | 'COMMITMENT'
  | 'ACTIVATION'

export const RELATIONSHIP_PLAYBOOK_KEY = 'destination_relationship'
export const RELATIONSHIP_SOURCE_TYPE = 'destination_relationship_stage'

export const RELATIONSHIP_STAGE_ORDER: readonly RelationshipStage[] = [
  'RELATIONSHIP_READY',
  'ASSETS_PREP',
  'INITIAL_OUTREACH',
  'WAITING_FOR_REPLY',
  'ENGAGED',
  'MATERIAL_REQUESTED',
  'MEETING_REQUESTED',
  'MEETING_SCHEDULED',
  'MEETING_PREP',
  'MEETING_COMPLETE',
  'FOLLOW_UP',
  'PROPOSAL',
  'NEGOTIATION',
  'COMMITMENT',
  'ACTIVATION',
]

/**
 * NON-LINEAR transitions — real sales relationships do not move
 * perfectly sequentially (spec's own examples: a reply asks for a
 * one-pager mid-outreach, a champion goes quiet and must be revisited,
 * a meeting creates a new stakeholder requiring fresh outreach, a
 * proposal needs revision). This is a graph, not a strict sequence —
 * every stage can return to FOLLOW_UP (a legitimate "still working it"
 * catch-all), and several explicit jumps are allowed beyond simple
 * next-in-order.
 */
export const RELATIONSHIP_TRANSITIONS: Readonly<Record<RelationshipStage, readonly RelationshipStage[]>> = Object.freeze({
  RELATIONSHIP_READY: ['ASSETS_PREP'],
  ASSETS_PREP: ['INITIAL_OUTREACH'],
  INITIAL_OUTREACH: ['WAITING_FOR_REPLY'],
  WAITING_FOR_REPLY: ['ENGAGED', 'FOLLOW_UP'], // no reply after the wait window -> FOLLOW_UP, never silently dropped
  ENGAGED: ['MATERIAL_REQUESTED', 'MEETING_REQUESTED', 'FOLLOW_UP', 'ASSETS_PREP'], // "reply asks for a one-pager" -> back to ASSETS_PREP
  MATERIAL_REQUESTED: ['ASSETS_PREP', 'ENGAGED', 'MEETING_REQUESTED', 'FOLLOW_UP'],
  MEETING_REQUESTED: ['MEETING_SCHEDULED', 'FOLLOW_UP'],
  MEETING_SCHEDULED: ['MEETING_PREP'],
  MEETING_PREP: ['MEETING_COMPLETE'],
  MEETING_COMPLETE: ['FOLLOW_UP', 'PROPOSAL', 'MATERIAL_REQUESTED'], // "meeting creates a new stakeholder" -> MATERIAL_REQUESTED (new person needs their own assets) handled by the dossier's per-contact scoping, not this transition alone
  FOLLOW_UP: ['ENGAGED', 'MEETING_REQUESTED', 'MATERIAL_REQUESTED', 'PROPOSAL', 'WAITING_FOR_REPLY'], // the real catch-all hub — most non-linear jumps route back through here
  PROPOSAL: ['NEGOTIATION', 'FOLLOW_UP'], // "proposal requires revision" -> FOLLOW_UP, then back to PROPOSAL
  NEGOTIATION: ['COMMITMENT', 'FOLLOW_UP'],
  COMMITMENT: ['ACTIVATION'],
  ACTIVATION: [],
})

export function assertRelationshipTransitionAllowed(from: RelationshipStage, to: RelationshipStage): void {
  if (!RELATIONSHIP_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Relationship transition ${from} -> ${to} is not allowed (real, but not arbitrary — see RELATIONSHIP_TRANSITIONS).`)
  }
}

export function coarseStatusForRelationshipStage(stage: RelationshipStage): 'READY' | 'IN_PROGRESS' | 'WAITING' | 'NEEDS_JERRY' | 'DONE' {
  switch (stage) {
    case 'RELATIONSHIP_READY':
      return 'READY'
    case 'ASSETS_PREP':
    case 'MEETING_PREP':
      return 'IN_PROGRESS'
    case 'INITIAL_OUTREACH':
      return 'NEEDS_JERRY' // sending is APPROVAL_REQUIRED until AUTO_TELL is activated — see standingAuthority.ts
    case 'WAITING_FOR_REPLY':
    case 'FOLLOW_UP':
      return 'WAITING'
    case 'ENGAGED':
    case 'MATERIAL_REQUESTED':
      return 'IN_PROGRESS'
    case 'MEETING_REQUESTED':
      return 'NEEDS_JERRY' // creating a meeting needs Jerry's availability/choice
    case 'MEETING_SCHEDULED':
      return 'WAITING'
    case 'MEETING_COMPLETE':
      return 'IN_PROGRESS'
    case 'PROPOSAL':
    case 'NEGOTIATION':
    case 'COMMITMENT':
      return 'NEEDS_JERRY' // pricing/commercial/commitment — always Jerry
    case 'ACTIVATION':
      return 'DONE'
  }
}

// ---------------------------------------------------------------------------
// Sales-enablement asset levels (spec section 6). A capability the
// relationship manager invokes, not a persistent autonomous agent.
// ---------------------------------------------------------------------------

export type SalesAssetLevel = 'LEVEL_0_OUTREACH_MESSAGE' | 'LEVEL_1_ONE_PAGER' | 'LEVEL_2_VISUALS' | 'LEVEL_3_PITCH_DECK'

/**
 * Which asset level a relationship currently needs — never jumps ahead
 * of qualification. A LEVEL_3 pitch deck specifically requires a GREEN/
 * qualified DAP on file (spec's own "do not generate a full pitch deck
 * unnecessarily before there is enough qualification/context").
 */
export function requiredAssetLevel(stage: RelationshipStage, hasQualifiedDap: boolean): SalesAssetLevel {
  if (stage === 'RELATIONSHIP_READY' || stage === 'ASSETS_PREP' || stage === 'INITIAL_OUTREACH' || stage === 'WAITING_FOR_REPLY') {
    return 'LEVEL_0_OUTREACH_MESSAGE'
  }
  if (stage === 'ENGAGED' || stage === 'MATERIAL_REQUESTED') {
    return 'LEVEL_1_ONE_PAGER'
  }
  if (stage === 'MEETING_REQUESTED' || stage === 'MEETING_SCHEDULED' || stage === 'MEETING_PREP' || stage === 'MEETING_COMPLETE') {
    return 'LEVEL_2_VISUALS'
  }
  // PROPOSAL/NEGOTIATION/COMMITMENT/ACTIVATION/FOLLOW_UP-after-those want the full deck, but only once qualification supports it
  return hasQualifiedDap ? 'LEVEL_3_PITCH_DECK' : 'LEVEL_2_VISUALS'
}

// ---------------------------------------------------------------------------
// Contact identity vs. destination relationship context (spec section
// 13). agent.contacts already holds global identity (organization_name/
// person_name/email/phone) — this playbook NEVER writes mutable
// relationship state onto that row. Relationship state (role, sentiment,
// promises, introductions) is scoped to (destinationId, contactId) —
// modeled here as its own record, kept by the engine as agent.tasks
// metadata scoped by BOTH the destination's project and the existing
// tasks.contact_id FK, never as a global mutation.
// ---------------------------------------------------------------------------

export interface DestinationContactContext {
  destinationId: string
  contactId: string // agent.contacts.id — the GLOBAL identity this context is scoped to
  role: string | null
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'CAUTIOUS' | 'NEGATIVE' | 'UNKNOWN'
  promisesMade: string[]
  introducedBy: string | null // another contactId, or null
  isChampion: boolean
  isBlocker: boolean
}

/**
 * The isolation guarantee, enforced: the SAME global contact can have a
 * DIFFERENT DestinationContactContext per destination — this function
 * makes that explicit rather than leaving it as an unenforced
 * convention. Two contexts for the same contactId but different
 * destinationId are never merged/conflated.
 */
export function isolateContactContext(contexts: DestinationContactContext[], destinationId: string, contactId: string): DestinationContactContext | null {
  const matches = contexts.filter((c) => c.contactId === contactId && c.destinationId === destinationId)
  if (matches.length > 1) {
    throw new Error(`Contact ${contactId} has multiple relationship contexts for the SAME destination ${destinationId} — this must never happen (exactly one context per destination+contact pair).`)
  }
  return matches[0] ?? null
}

export function verifyAuthorityCoverage(): void {
  for (const op of [
    'destination_relationship.identify_contact',
    'destination_relationship.select_channel',
    'destination_relationship.draft_outreach',
    'destination_relationship.classify_reply',
    'destination_relationship.schedule_followup',
    'destination_relationship.track_sentiment',
    'destination_relationship.gather_meeting_evidence',
    'destination_relationship.send_email',
    'destination_relationship.create_calendar_event',
    'destination_relationship.change_pricing',
    'destination_relationship.commercial_commitment',
    'destination_relationship.accept_contract',
    'destination_relationship.relationship_sensitive_promise',
  ]) {
    evaluateAuthority(op)
  }
}
