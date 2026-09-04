// Chief Phase 2C — the destination dossier + portfolio view. Pure logic
// only. Every function here is a PROJECTION over already-gathered,
// already-scoped-by-destination data — never a duplicate document, never
// itself a source of truth (agent.tasks/task_events/contacts remain
// that). Every input type carries destinationId explicitly so cross-
// destination mixing is a type-level near-impossible, not just a
// convention.

import type { DVA1Artifact, DVA2Artifact, DAPArtifact, DVA2RecommendedNextStep } from './destinationHubLifecycle'
import type { RelationshipStage, DestinationContactContext, SalesAssetLevel } from './destinationRelationship'

// ---------------------------------------------------------------------------
// Cross-destination isolation (spec section 9) — hard validation that a
// caller assembling a dossier or accepting a result never mixes
// destinations. Every artifact/context carries destinationId; this is
// the ONE function that checks a whole batch for a leak.
// ---------------------------------------------------------------------------

export interface DestinationScoped {
  destinationId: string
}

export function assertAllSameDestination(destinationId: string, items: DestinationScoped[]): void {
  const mismatched = items.filter((i) => i.destinationId !== destinationId)
  if (mismatched.length > 0) {
    throw new Error(
      `Cross-destination contamination: expected destinationId ${destinationId}, found ${mismatched.length} item(s) with a different id (${[...new Set(mismatched.map((m) => m.destinationId))].join(', ')}).`
    )
  }
}

// ---------------------------------------------------------------------------
// Dossier sections
// ---------------------------------------------------------------------------

export interface EvaluationSection {
  dva1: { status: 'NOT_STARTED' | 'RECEIVED'; score: number | null; artifactRef: string | null }
  dva2: { status: 'NOT_STARTED' | 'RECEIVED'; recommendedNextStep: DVA2RecommendedNextStep | null; artifactRef: string | null }
  dap: { status: 'NOT_STARTED' | 'RECEIVED'; artifactRef: string | null }
}

export interface PeopleSection {
  champions: DestinationContactContext[]
  decisionMakers: DestinationContactContext[]
  influencers: DestinationContactContext[]
}

export interface CommercialSection {
  offerStage: RelationshipStage | null
  budgetInformation: string[]
  pricingDiscussed: string | null
  objections: string[]
  fundingTiming: string | null
  proposalVersion: number | null
}

export interface RelationshipSection {
  lastContactAt: string | null
  lastInboundAt: string | null
  nextFollowUpAt: string | null
  waitingOn: 'US' | 'THEM' | 'JERRY' | null
  nextMeetingAt: string | null
  outstandingPromises: string[]
}

export interface ProductSection {
  contentBuildStatus: string
  hasDestinationImagery: boolean
  listCount: number
  businessCount: number
  activationReady: boolean
}

export interface TimingSection {
  tourismSeason: string | null
  fiscalBudgetTiming: string | null
  upcomingEvents: string[]
  nextActionDate: string | null
}

export interface DestinationDossier {
  destinationId: string
  destinationName: string
  evaluation: EvaluationSection
  people: PeopleSection
  commercial: CommercialSection
  relationship: RelationshipSection
  product: ProductSection
  timing: TimingSection
}

export interface DossierInputs {
  destinationId: string
  destinationName: string
  dva1: DVA1Artifact | null
  dva2: DVA2Artifact | null
  dap: DAPArtifact | null
  contacts: DestinationContactContext[]
  relationshipStage: RelationshipStage | null
  lastContactAt: string | null
  lastInboundAt: string | null
  nextFollowUpAt: string | null
  nextMeetingAt: string | null
  outstandingPromises: string[]
  product: ProductSection
  timing: TimingSection
}

/**
 * Assembles the dossier — validates every input is actually scoped to
 * this destination BEFORE assembling anything (assertAllSameDestination
 * on the artifacts + contacts), so "Give me the full picture on Grand
 * Lake" can never silently include Willcox's champion or Buena Vista's
 * budget notes.
 */
export function assembleDossier(inputs: DossierInputs): DestinationDossier {
  const artifacts: DestinationScoped[] = [inputs.dva1, inputs.dva2, inputs.dap].filter((a): a is Exclude<typeof a, null> => a !== null)
  assertAllSameDestination(inputs.destinationId, artifacts)
  assertAllSameDestination(inputs.destinationId, inputs.contacts)

  return {
    destinationId: inputs.destinationId,
    destinationName: inputs.destinationName,
    evaluation: {
      dva1: { status: inputs.dva1 ? 'RECEIVED' : 'NOT_STARTED', score: inputs.dva1?.score ?? null, artifactRef: inputs.dva1?.artifactRef ?? null },
      dva2: { status: inputs.dva2 ? 'RECEIVED' : 'NOT_STARTED', recommendedNextStep: inputs.dva2?.recommendedNextStep ?? null, artifactRef: inputs.dva2?.artifactRef ?? null },
      dap: { status: inputs.dap ? 'RECEIVED' : 'NOT_STARTED', artifactRef: inputs.dap?.artifactRef ?? null },
    },
    people: {
      champions: inputs.contacts.filter((c) => c.isChampion),
      decisionMakers: inputs.contacts.filter((c) => c.role?.toLowerCase().includes('decision') ?? false),
      influencers: inputs.contacts.filter((c) => !c.isChampion && !c.isBlocker),
    },
    commercial: {
      offerStage: inputs.relationshipStage,
      budgetInformation: inputs.dap?.extracted.fundingBudgetClues ?? [],
      pricingDiscussed: null, // deliberately not sourced from the artifact — pricing actually discussed is relationship-execution fact, not a DAP projection
      objections: inputs.dap?.extracted.objectionsHurdles ?? [],
      fundingTiming: inputs.dap?.extracted.timingConsiderations.join('; ') ?? null,
      proposalVersion: null,
    },
    relationship: {
      lastContactAt: inputs.lastContactAt,
      lastInboundAt: inputs.lastInboundAt,
      nextFollowUpAt: inputs.nextFollowUpAt,
      waitingOn: deriveWaitingOn(inputs.relationshipStage),
      nextMeetingAt: inputs.nextMeetingAt,
      outstandingPromises: inputs.outstandingPromises,
    },
    product: inputs.product,
    timing: inputs.timing,
  }
}

function deriveWaitingOn(stage: RelationshipStage | null): 'US' | 'THEM' | 'JERRY' | null {
  if (!stage) return null
  if (stage === 'WAITING_FOR_REPLY' || stage === 'MEETING_SCHEDULED') return 'THEM'
  if (stage === 'MEETING_REQUESTED' || stage === 'PROPOSAL' || stage === 'NEGOTIATION' || stage === 'COMMITMENT') return 'JERRY'
  return 'US'
}

// ---------------------------------------------------------------------------
// Portfolio view — cross-destination ranking, never a flat dump.
// ---------------------------------------------------------------------------

export interface PortfolioEntry {
  destinationId: string
  destinationName: string
  dva1Status: 'NOT_STARTED' | 'RECEIVED'
  dva2RecommendedNextStep: DVA2RecommendedNextStep | null
  dapStatus: 'NOT_STARTED' | 'RECEIVED'
  relationshipStage: RelationshipStage | null
  requiredAssetLevel: SalesAssetLevel | null
  waitingOn: 'US' | 'THEM' | 'JERRY' | null
  nextFollowUpAt: string | null
  nextMeetingAt: string | null
  budgetWindowOpeningAt: string | null
  staleDays: number | null
}

export interface RankedPortfolioAction {
  destinationId: string
  destinationName: string
  reason: string
  priority: number // lower = more urgent
}

const STALE_THRESHOLD_DAYS = 14

/**
 * Ranks next actions rather than listing every destination — the spec's
 * own explicit requirement. Priority order: needs Jerry now > follow-up
 * due today/overdue > at risk of going stale > timing window opening >
 * everything else waiting normally.
 */
export function rankPortfolioActions(entries: PortfolioEntry[], now: Date = new Date()): RankedPortfolioAction[] {
  const actions: RankedPortfolioAction[] = []

  for (const e of entries) {
    if (e.waitingOn === 'JERRY') {
      actions.push({ destinationId: e.destinationId, destinationName: e.destinationName, reason: 'Needs Jerry.', priority: 0 })
      continue
    }
    if (e.nextFollowUpAt && new Date(e.nextFollowUpAt).getTime() <= now.getTime()) {
      actions.push({ destinationId: e.destinationId, destinationName: e.destinationName, reason: 'Follow-up due.', priority: 1 })
      continue
    }
    if (e.staleDays !== null && e.staleDays >= STALE_THRESHOLD_DAYS && e.waitingOn === 'US') {
      actions.push({ destinationId: e.destinationId, destinationName: e.destinationName, reason: `At risk — ${e.staleDays} days with no action from us.`, priority: 2 })
      continue
    }
    if (e.budgetWindowOpeningAt && new Date(e.budgetWindowOpeningAt).getTime() <= now.getTime()) {
      actions.push({ destinationId: e.destinationId, destinationName: e.destinationName, reason: 'Timing/budget window opening.', priority: 3 })
      continue
    }
    if (e.dva2RecommendedNextStep === 'BUILD_DAP_NOW' && e.dapStatus === 'NOT_STARTED') {
      actions.push({ destinationId: e.destinationId, destinationName: e.destinationName, reason: 'GREEN DVA-2 — needs DAP.', priority: 4 })
      continue
    }
  }

  return actions.sort((a, b) => a.priority - b.priority)
}

export function filterByWaitingOn(entries: PortfolioEntry[], who: 'US' | 'THEM' | 'JERRY'): PortfolioEntry[] {
  return entries.filter((e) => e.waitingOn === who)
}

export function filterByStage(entries: PortfolioEntry[], predicate: (e: PortfolioEntry) => boolean): PortfolioEntry[] {
  return entries.filter(predicate)
}
