// agent-service/specialists/m9CompletedListResolution.ts
//
// M9 wiring, Session 3, Phase 4 — completed-list replace/reopen handling.
// Pure, no I/O: the caller supplies a one-time real production lookup
// (does a list with this title already exist for this metro, and is it
// ACTIVE or COMPLETED?) — this module never queries or guesses that
// itself, same discipline as m9ReusedItemValidation.ts and
// listSqlGeneration.ts.
//
// Mirrors listFitScoring.ts's own existing COMPLETED-list guardrail
// (evaluateItemForListMembership: "List is a completed production list
// and has not been explicitly reopened — no membership change is
// permitted") at the WHOLE-LIST level rather than per-item: a concept
// whose matched production list is COMPLETED needs an explicit REOPEN or
// REPLACE_CONCEPT operator decision (m9EnforcedTypes.ts's
// M9OperatorResolutionAction) before its approved membership may ever be
// linked into that list.

export interface M9ExistingListLookup {
  conceptId: string
  /** null = no existing production list found for this concept's approved title — a genuinely new list. Never guessed; always the caller's own real one-time lookup result. */
  existingList: {
    listId: string
    title: string
    status: 'ACTIVE' | 'COMPLETED'
    /** Real current public.list_items membership for this list, when the caller's lookup fetched it — optional/additive (this module's own REUSE/REOPEN decision never needs it), captured for callers that do (e.g. a future membership-diff instead of blind replace). Omit, never fabricate, when the lookup didn't fetch it. */
    memberItemIds?: readonly string[]
  } | null
}

export interface M9CompletedListOperatorDecision {
  resolutionAction: string
  decisionText: string
  decidedBy: string
  decidedAt: string
}

export interface M9CompletedListResolutionInput {
  lookups: readonly M9ExistingListLookup[]
  /** conceptId -> the real, recorded operator decision resolving that concept (m9EnforcedTypes.ts's M9OperatorDecisionRecord) — only REOPEN/REPLACE_CONCEPT resolutionActions ever satisfy a COMPLETED-list block; any other resolutionAction (even a real, non-empty APPROVE) does not, mirroring evaluateItemForListMembership's own "reopened must be true" guardrail rather than accepting a generic approval as sufficient. */
  operatorDecisionsByConceptId: Readonly<Record<string, M9CompletedListOperatorDecision>>
}

export type M9ListResolutionKind = 'REUSE_EXISTING_ACTIVE' | 'REUSE_EXISTING_REOPENED' | 'CREATE_NEW' | 'BLOCKED_NEEDS_REOPEN'

export interface M9ListResolution {
  conceptId: string
  kind: M9ListResolutionKind
  /** The real production list id to link membership into — set for REUSE_EXISTING_ACTIVE/REUSE_EXISTING_REOPENED only (the SAME id as the existing list, never minted fresh). Null for CREATE_NEW (this module never creates a list itself — that is an explicit, separate, out-of-band step) and BLOCKED_NEEDS_REOPEN (no safe id to use). */
  listId: string | null
  reason: string
  /** Present only for REUSE_EXISTING_REOPENED — the real reopen record, so "reopen records the operator, reason, timestamp, and target concept/list" is satisfiable from this module's own output, not reconstructed elsewhere. */
  reopenedBy?: { decidedBy: string; decidedAt: string; decisionText: string }
}

/**
 * Resolves every approved concept's list-identity handling independently
 * — "partial reopen affects only the targeted list" holds by construction
 * (each lookup is processed with no cross-concept state), and calling
 * this again with the same input always reproduces the identical output
 * (pure function of its arguments — "repeated execution remains
 * idempotent").
 */
export function resolveM9CompletedListHandling(input: M9CompletedListResolutionInput): M9ListResolution[] {
  return input.lookups.map((lookup) => {
    if (!lookup.existingList) {
      return {
        conceptId: lookup.conceptId,
        kind: 'CREATE_NEW',
        listId: null,
        reason: 'No existing production list matches this concept — a genuinely new list identity is required. This module never mints one: list creation is an explicit, separate, out-of-band step (see the Session 3 handoff doc for why the safe SQL module, listSqlGeneration.ts, only ever links membership into an ALREADY-EXISTING list).',
      }
    }
    if (lookup.existingList.status === 'ACTIVE') {
      return {
        conceptId: lookup.conceptId,
        kind: 'REUSE_EXISTING_ACTIVE',
        listId: lookup.existingList.listId,
        reason: `Reusing existing active list "${lookup.existingList.title}" (${lookup.existingList.listId}) — same editorial concept, production UUID preserved, no reopen needed.`,
      }
    }
    // COMPLETED — the whole-list analogue of evaluateItemForListMembership's
    // own per-item COMPLETED guardrail (listFitScoring.ts): a plain
    // APPROVE is never sufficient, regardless of how substantive its
    // decisionText reads; only REOPEN/REPLACE_CONCEPT resolve it.
    const decision = input.operatorDecisionsByConceptId[lookup.conceptId]
    const reopened = decision && (decision.resolutionAction === 'REOPEN' || decision.resolutionAction === 'REPLACE_CONCEPT') && decision.decisionText.trim().length > 0
    if (reopened) {
      return {
        conceptId: lookup.conceptId,
        kind: 'REUSE_EXISTING_REOPENED',
        listId: lookup.existingList.listId,
        reason: `Completed production list "${lookup.existingList.title}" (${lookup.existingList.listId}) explicitly reopened by ${decision!.decidedBy} at ${decision!.decidedAt}: ${decision!.decisionText}`,
        reopenedBy: { decidedBy: decision!.decidedBy, decidedAt: decision!.decidedAt, decisionText: decision!.decisionText },
      }
    }
    return {
      conceptId: lookup.conceptId,
      kind: 'BLOCKED_NEEDS_REOPEN',
      listId: null,
      reason: `List "${lookup.existingList.title}" is a completed production list and has not been explicitly reopened (REOPEN or REPLACE_CONCEPT with real decisionText required) — no membership change is permitted. Mirrors listFitScoring.ts's own evaluateItemForListMembership COMPLETED-list guardrail at the whole-list level.`,
    }
  })
}
