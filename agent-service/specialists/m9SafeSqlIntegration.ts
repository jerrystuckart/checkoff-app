// agent-service/specialists/m9SafeSqlIntegration.ts
//
// M9 wiring, Session 3, Phase 5 — connects the approved ENFORCED plan to
// the EXISTING, already-audited safe SQL module (listSqlGeneration.ts,
// Munich calibration Phase 4) rather than writing a second SQL generator.
// Pure, no I/O, never executes anything.
//
// SCOPE BOUNDARY (read this before extending): listSqlGeneration.ts's
// generateListMembershipSql only ever LINKS membership into a list that
// ALREADY EXISTS in production (its generated SQL does
// `SELECT id INTO v_list_id FROM public.lists WHERE ...; IF v_list_id IS
// NULL THEN RAISE EXCEPTION ...` — it has no CREATE path for a list, and
// no path for creating a brand-new public.items row either). That is a
// deliberate safety boundary, not an oversight, and this module respects
// it rather than reaching back into the LEGACY buildHomeListSqlPatch/
// NewItemSqlInput machinery (which DOES create catalog items, and is
// exactly the higher-risk surface this whole ENFORCED track exists to
// move away from).
//
// Session 4 — genuinely NEW list creation is now safely supported too, via
// listSqlGeneration.ts's generateNewListCreationSql (idempotent
// deterministic-UUID create-if-missing, still never creates a public.items
// row). It is strictly OPT-IN (input.newListCreatorId) and gated by
// validateNewListCreationApproval below — a concept whose approved
// membership needs a new list, but for which the caller did not supply
// newListCreatorId, or whose approval doesn't clear the extra new-list
// gate, still reports BLOCKED_NEW_LIST_NEEDED / BLOCKED_NEW_LIST_APPROVAL_INVALID
// here, never silently routed through the unsafe LEGACY path.
//
// IDENTITY CORRECTION (Session 4 follow-up): the list a CREATE_NEW concept
// creates is identified by computeM9ListId(conceptId) — a deterministic
// RFC 4122 UUIDv5 derived from the concept's own durable conceptId, NEVER
// from its proposedTitle. The first cut of this module used a
// `(metro_id, title)` natural-key lookup inside the generated SQL itself,
// which was rejected: a title rename could silently create a duplicate
// list, and two unrelated concepts proposing the same title could
// collide. Before generating any SQL for a CREATE_NEW concept, this module
// now also requires a caller-supplied deterministicListIdLookups entry —
// the real, one-time production check for "does a public.lists row
// already exist at this exact deterministic id, and if so, whose is it?"
// — and blocks (BLOCKED_NEW_LIST_ID_CONFLICT) if that id is already
// claimed by an unrelated metro or a non-official list, BEFORE any
// executable SQL exists. This is deliberately a SEPARATE check from the
// (unchanged) title-based listLookups/resolveM9CompletedListHandling
// REUSE-vs-CREATE routing above it in the pipeline — that routing decides
// WHETHER a new list is needed at all (a pre-existing Session 3 concern,
// out of this correction's scope); this new check guards the IDENTITY the
// new list will actually be created under.

import { createHash } from 'node:crypto'
import { generateListMembershipSql, generateNewListCreationSql, type ListSqlItemResolution } from '../playbooks/listSqlGeneration'
import { validateM9ReusedItems, type M9ReusedItemResolution, type M9ReusedItemValidationFinding } from './m9ReusedItemValidation'
import { resolveM9CompletedListHandling, type M9ExistingListLookup, type M9CompletedListOperatorDecision, type M9ListResolution } from './m9CompletedListResolution'
import { computeM9ListId, type M9EnforcedCurationArtifact, type M9EnforcedConceptVerdict } from './m9EnforcedTypes'

export interface M9SafeSqlIntegrationInput {
  artifact: M9EnforcedCurationArtifact
  metroSlug: string
  /** The real metro_areas.id, when known — passed straight through to validateM9ReusedItems's own out-of-metro check. */
  metroId: string | null
  /** Caller-supplied, one real production-item resolution per candidateName across every approved concept's membership. Never invented here. */
  itemResolutions: readonly M9ReusedItemResolution[]
  /** Caller-supplied, one real production-list lookup per approved conceptId. Never invented here. */
  listLookups: readonly M9ExistingListLookup[]
  operatorDecisionsByConceptId: Readonly<Record<string, M9CompletedListOperatorDecision>>
  /** candidateName -> certified item body — used only as the SQL's own human-readable intendedBody label; never the resolution mechanism itself (see listSqlGeneration.ts's own doc on why body-text is never re-used operationally). */
  itemBodyByCandidateName: ReadonlyMap<string, string>
  /**
   * Session 4 — real production creator_id (a user/service-account UUID)
   * to attribute as the creator of any newly-created public.lists row.
   * OPT-IN, never a silent default: omitted (or null) means every
   * CREATE_NEW-resolved concept still reports BLOCKED_NEW_LIST_NEEDED
   * exactly as it did before this field existed — safe new-list creation
   * only activates when the caller explicitly supplies a real creator id
   * (mirrors LEGACY's own always-required officialListCreatorId), never
   * merely by an approved concept resolving to CREATE_NEW.
   */
  newListCreatorId?: string | null
  /**
   * Session 4 — one real, one-time production lookup per CREATE_NEW-bound
   * conceptId: "does a public.lists row already exist at
   * computeM9ListId(conceptId)?" — required (defense in depth, fail
   * closed) whenever `newListCreatorId` is supplied; a missing entry for a
   * concept that needs one blocks that concept exactly like a missing
   * item resolution would, never silently treated as clear.
   */
  deterministicListIdLookups?: readonly M9DeterministicListIdLookup[]
}

export interface M9DeterministicListIdLookup {
  conceptId: string
  /** The real row found at computeM9ListId(conceptId), if any — null when nothing exists there yet (the ordinary case for a genuinely first-time concept). Never guessed. */
  existingRowAtId: { metroSlug: string; title: string; isOfficial: boolean } | null
}

export type M9ListSqlOutcomeStatus =
  | 'GENERATED'
  | 'GENERATED_NEW_LIST'
  | 'BLOCKED_NEW_LIST_NEEDED'
  | 'BLOCKED_NEW_LIST_APPROVAL_INVALID'
  | 'BLOCKED_NEW_LIST_ID_CONFLICT'
  | 'BLOCKED_NEEDS_REOPEN'
  | 'BLOCKED_ITEM_RESOLUTION_FAILED'

/** GENERATED and GENERATED_NEW_LIST are both "real, safe, executable SQL was produced" — the only difference is whether a list row also had to be created. Every whole-plan/manifest/compatibility-plan check below treats them identically. */
function isGeneratedStatus(status: M9ListSqlOutcomeStatus): boolean {
  return status === 'GENERATED' || status === 'GENERATED_NEW_LIST'
}

export interface M9ListSqlOutcome {
  conceptId: string
  listTitle: string
  status: M9ListSqlOutcomeStatus
  sql: string | null
  expectedMembershipCount: number
  errors: string[]
}

export interface M9SafeSqlIntegrationResult {
  /** True ONLY when every approved concept produced real, generated SQL — a single blocked concept fails the whole plan (Phase 5's own "complete the entire preflight before producing destructive membership operations" requirement, at the whole-plan granularity). */
  ok: boolean
  /** Every GENERATED list's SQL, concatenated in conceptId order — null unless ok. Each per-list block is already its own complete BEGIN;...COMMIT; transaction (listSqlGeneration.ts), so sequential blocks in one script is safe — never a single nested transaction. */
  combinedSql: string | null
  perListOutcomes: M9ListSqlOutcome[]
  reusedItemFindings: M9ReusedItemValidationFinding[]
  listResolutions: M9ListResolution[]
}

/**
 * Session 4 — the extra gate a genuinely NEW list must clear beyond what
 * `finalApprovedMemberships` already guarantees (every concept keyed
 * there already has a fresh-fingerprint, decision:'APPROVED' operator
 * decision on record — see m9ListCurationAdapter.ts's PASS 3, which only
 * ever populates finalApprovedMemberships from that exact condition).
 * This function re-checks that explicitly anyway (defense in depth, same
 * discipline as this module's own conceptsWithUnresolvedDuplicates
 * computation) rather than trusting it implicitly, and adds the ONE
 * check that is NOT already guaranteed upstream: a concept can reach
 * approvalState 'APPROVED' via ACCEPT_EXCEPTION/REPLACE_CONCEPT/etc even
 * while `duplicateFindings` is still non-empty (the artifact's own
 * conceptsWithUnresolvedDuplicates set above only flags a duplicate on a
 * NON-approved concept) — creating a brand-new list identity from a
 * concept with ANY residual duplicate-venue finding is refused here
 * regardless of approval, since reusing an EXISTING list under the same
 * circumstances is a materially lower-risk action than minting a new one.
 */
function validateNewListCreationApproval(verdict: M9EnforcedConceptVerdict | undefined): string[] {
  const errors: string[] = []
  if (!verdict) {
    errors.push('No concept verdict was found for this approved concept — cannot verify a Jerry approval exists for new-list creation.')
    return errors
  }
  if (verdict.discoveryVerdict !== 'CREATE') {
    errors.push(`Concept's own PASS A discovery verdict is "${verdict.discoveryVerdict}", not CREATE — a new list may only be created from a genuine CREATE verdict.`)
  }
  if (verdict.approvalState !== 'APPROVED') {
    errors.push(`Concept approvalState is "${verdict.approvalState}", not APPROVED — new-list creation requires explicit approval, never inferred from being present in finalApprovedMemberships alone.`)
  }
  if (verdict.duplicateFindings.length > 0) {
    errors.push(`Concept has ${verdict.duplicateFindings.length} unresolved duplicate-venue finding(s) on record — a brand-new list may never be created while a duplicate conflict remains, even if the concept itself was separately approved (reusing an existing list under the same circumstances is a materially lower-risk action).`)
  }
  const decision = verdict.operatorDecision
  if (!decision) {
    errors.push('No operator decision is on record for this concept — a genuinely new list may never be created without an explicit, attributable Jerry approval.')
  } else {
    if (decision.decidedForFingerprint !== verdict.fingerprint) {
      errors.push(
        `The recorded approval was decided against fingerprint "${decision.decidedForFingerprint}", but this concept's CURRENT fingerprint is "${verdict.fingerprint}" — the approval is stale (the concept's membership/metadata changed since it was approved) and does not authorize creating a new list.`
      )
    }
    if (decision.decision !== 'APPROVED') {
      errors.push(`The recorded operator decision is "${decision.decision}", not APPROVED — cannot authorize new-list creation.`)
    }
  }
  return errors
}

/**
 * Builds the full safe SQL plan for an ENFORCED artifact's approved
 * concepts. Reads ONLY `artifact.finalApprovedMemberships` (never a
 * concept's raw PASS A/B output, never anything still outstanding) — see
 * this module's own module doc and the Session 3 handoff's Phase 1 trace
 * for why finalApprovedMemberships is the one legitimate input here.
 */
export function buildM9SafeSqlPlan(input: M9SafeSqlIntegrationInput): M9SafeSqlIntegrationResult {
  const approvedConceptIds = Object.keys(input.artifact.finalApprovedMemberships)
  const verdictsById = new Map(input.artifact.conceptVerdicts.map((v) => [v.conceptId, v]))

  // Defense in depth (mirrors m9ReusedItemValidation.ts's own doc): every
  // concept reaching here already cleared duplicate resolution to become
  // APPROVED (Prerequisite 2), so this set should always be empty in
  // practice — computed fresh anyway rather than trusted implicitly.
  const conceptsWithUnresolvedDuplicates = new Set(input.artifact.conceptVerdicts.filter((v) => v.duplicateFindings.length > 0 && v.approvalState !== 'APPROVED').map((v) => v.conceptId))

  const itemValidation = validateM9ReusedItems({ metroId: input.metroId, resolutions: input.itemResolutions, conceptsWithUnresolvedDuplicates })
  const listResolutions = resolveM9CompletedListHandling({ lookups: input.listLookups, operatorDecisionsByConceptId: input.operatorDecisionsByConceptId })
  const listResolutionByConceptId = new Map(listResolutions.map((r) => [r.conceptId, r]))
  const listLookupByConceptId = new Map(input.listLookups.map((l) => [l.conceptId, l]))
  const deterministicListIdLookupByConceptId = new Map((input.deterministicListIdLookups ?? []).map((l) => [l.conceptId, l]))

  const perListOutcomes: M9ListSqlOutcome[] = []

  for (const conceptId of approvedConceptIds) {
    const verdict = verdictsById.get(conceptId)
    const memberIds = input.artifact.finalApprovedMemberships[conceptId] ?? []
    const listRes = listResolutionByConceptId.get(conceptId)
    const listTitleForReporting = verdict?.proposedTitle ?? conceptId

    if (!listRes || listRes.kind === 'CREATE_NEW') {
      if (!input.newListCreatorId) {
        perListOutcomes.push({ conceptId, listTitle: listTitleForReporting, status: 'BLOCKED_NEW_LIST_NEEDED', sql: null, expectedMembershipCount: 0, errors: [listRes?.reason ?? 'No list resolution was supplied for this approved concept.'] })
        continue
      }
      const approvalErrors = validateNewListCreationApproval(verdict)
      if (approvalErrors.length > 0) {
        perListOutcomes.push({ conceptId, listTitle: listTitleForReporting, status: 'BLOCKED_NEW_LIST_APPROVAL_INVALID', sql: null, expectedMembershipCount: 0, errors: approvalErrors })
        continue
      }
      const deterministicListId = computeM9ListId(conceptId)
      const idLookup = deterministicListIdLookupByConceptId.get(conceptId)
      if (!idLookup) {
        perListOutcomes.push({
          conceptId,
          listTitle: listTitleForReporting,
          status: 'BLOCKED_NEW_LIST_ID_CONFLICT',
          sql: null,
          expectedMembershipCount: 0,
          errors: [`No deterministicListIdLookups entry was supplied for this concept's deterministic list id (${deterministicListId}) — never assumed clear; a real one-time production check is required before creating a new list.`],
        })
        continue
      }
      if (idLookup.existingRowAtId && (idLookup.existingRowAtId.metroSlug !== input.metroSlug || !idLookup.existingRowAtId.isOfficial)) {
        perListOutcomes.push({
          conceptId,
          listTitle: listTitleForReporting,
          status: 'BLOCKED_NEW_LIST_ID_CONFLICT',
          sql: null,
          expectedMembershipCount: 0,
          errors: [
            `Deterministic list id ${deterministicListId} already belongs to ${
              idLookup.existingRowAtId.metroSlug !== input.metroSlug
                ? `metro "${idLookup.existingRowAtId.metroSlug}", not the intended metro "${input.metroSlug}"`
                : 'a non-official list'
            } (title "${idLookup.existingRowAtId.title}") — refusing to create/repoint a list at this id.`,
          ],
        })
        continue
      }
      if (!itemValidation.ok) {
        perListOutcomes.push({
          conceptId,
          listTitle: listTitleForReporting,
          status: 'BLOCKED_ITEM_RESOLUTION_FAILED',
          sql: null,
          expectedMembershipCount: 0,
          errors: itemValidation.findings.filter((f) => f.blocking).map((f) => `${f.candidateName}: ${f.detail}`),
        })
        continue
      }
      const newListResolutions: ListSqlItemResolution[] = memberIds.map((candidateName, i) => ({
        intendedBody: input.itemBodyByCandidateName.get(candidateName) ?? candidateName,
        sortOrder: i,
        matchedItemIds: itemValidation.resolvedItemIdByCandidateName[candidateName] ? [itemValidation.resolvedItemIdByCandidateName[candidateName]!] : [],
      }))
      const newListSqlResult = generateNewListCreationSql({ metroSlug: input.metroSlug, listId: deterministicListId, listTitle: listTitleForReporting, creatorId: input.newListCreatorId, resolutions: newListResolutions })
      perListOutcomes.push({
        conceptId,
        listTitle: listTitleForReporting,
        status: newListSqlResult.ok ? 'GENERATED_NEW_LIST' : 'BLOCKED_ITEM_RESOLUTION_FAILED',
        sql: newListSqlResult.sql,
        expectedMembershipCount: newListSqlResult.expectedMembershipCount,
        errors: newListSqlResult.errors,
      })
      continue
    }
    if (listRes.kind === 'BLOCKED_NEEDS_REOPEN') {
      perListOutcomes.push({ conceptId, listTitle: listTitleForReporting, status: 'BLOCKED_NEEDS_REOPEN', sql: null, expectedMembershipCount: 0, errors: [listRes.reason] })
      continue
    }
    if (!itemValidation.ok) {
      perListOutcomes.push({
        conceptId,
        listTitle: listTitleForReporting,
        status: 'BLOCKED_ITEM_RESOLUTION_FAILED',
        sql: null,
        expectedMembershipCount: 0,
        errors: itemValidation.findings.filter((f) => f.blocking).map((f) => `${f.candidateName}: ${f.detail}`),
      })
      continue
    }

    // REUSE_EXISTING_ACTIVE / REUSE_EXISTING_REOPENED — use the REAL
    // existing list's own title (from the caller's lookup), never our own
    // proposedTitle: generateListMembershipSql resolves the list by exact
    // title match against public.lists, so using anything other than the
    // real, already-verified title would RAISE EXCEPTION (list not found)
    // even though a perfectly good existing list does exist.
    const existingTitle = listLookupByConceptId.get(conceptId)?.existingList?.title ?? listTitleForReporting
    const resolutions: ListSqlItemResolution[] = memberIds.map((candidateName, i) => ({
      intendedBody: input.itemBodyByCandidateName.get(candidateName) ?? candidateName,
      sortOrder: i,
      matchedItemIds: itemValidation.resolvedItemIdByCandidateName[candidateName] ? [itemValidation.resolvedItemIdByCandidateName[candidateName]!] : [],
    }))
    const sqlResult = generateListMembershipSql({ metroSlug: input.metroSlug, listTitle: existingTitle, resolutions })
    perListOutcomes.push({
      conceptId,
      listTitle: existingTitle,
      status: sqlResult.ok ? 'GENERATED' : 'BLOCKED_ITEM_RESOLUTION_FAILED',
      sql: sqlResult.sql,
      expectedMembershipCount: sqlResult.expectedMembershipCount,
      errors: sqlResult.errors,
    })
  }

  const ok = perListOutcomes.length > 0 && perListOutcomes.every((o) => isGeneratedStatus(o.status))
  const combinedSql = ok ? perListOutcomes.map((o) => o.sql).filter((s): s is string => Boolean(s)).join('\n\n') : null

  return { ok, combinedSql, perListOutcomes, reusedItemFindings: itemValidation.findings, listResolutions }
}

// ---------------------------------------------------------------------------
// Session 3, Phase 6 — M10 consumption support: a deterministic
// compatibility projection of the approved artifact (never a second
// independent source of truth — see the Session 3 handoff's Phase 1
// trace) plus a validation manifest M10 can check every other artifact's
// fingerprint against.
// ---------------------------------------------------------------------------

/**
 * Deliberately shaped to be structurally assignable to metroLaunchDriver.ts's
 * own HomeListPlanEntry (label/title/kind/itemCandidateNames/requiresImage)
 * WITHOUT importing that type — this file must stay standalone (the
 * driver imports FROM it, so the reverse import would be circular; same
 * discipline m9ListCurationAdapter.ts's own M9AdapterLegacyListSummary
 * already established in Session 1). `kind: 'THEMED'` is a real member of
 * HomeListPlanEntry's own kind union (never a fabricated new one M10's
 * existing officialListsCount/themedListsCount reporting wouldn't
 * recognize) — an ENFORCED-approved list genuinely IS a themed list from
 * M10's perspective.
 */
export interface M9CompatibilityPlanEntry {
  label: string
  title: string
  kind: 'THEMED'
  itemCandidateNames: string[]
  requiresImage: boolean
}

/**
 * The ONLY place state.homeListPlan's shape is ever derived from an
 * ENFORCED artifact — deterministically, from `finalApprovedMemberships`
 * and `conceptVerdicts` alone. Called ONLY after `buildM9SafeSqlPlan`
 * reports `ok: true` (never before — a plan with any blocked concept has
 * no safe compatibility projection at all, per this module's own "one
 * blocked concept blocks the whole plan" rule).
 */
export function buildM9CompatibilityPlan(artifact: M9EnforcedCurationArtifact, safeSqlPlan: M9SafeSqlIntegrationResult): M9CompatibilityPlanEntry[] {
  return safeSqlPlan.perListOutcomes
    .filter((o) => isGeneratedStatus(o.status))
    .map((o) => {
      const members = artifact.finalApprovedMemberships[o.conceptId] ?? []
      return { label: `ENFORCED: ${o.listTitle}`, title: o.listTitle, kind: 'THEMED' as const, itemCandidateNames: members, requiresImage: true }
    })
}

export interface M9SqlValidationManifest {
  /** Ties this manifest back to the exact ENFORCED artifact/catalog state that produced it — M10 refuses to proceed if this no longer matches the live state.m9EnforcedCuration.inputCatalogFingerprint (see the driver's own M10 consumption check). */
  inputCatalogFingerprint: string
  /** conceptId -> the concept's own fingerprint at the moment SQL was generated — a later, different fingerprint for the same conceptId means the approval this SQL was built from is now stale. */
  conceptFingerprintsUsed: Record<string, string>
  expectedMembershipCounts: Record<string, number>
  /** Hash of the manifest's own content — the single value every other artifact (compatibility plan, SQL patch, curation artifact) is cross-checked against for exact consistency. */
  manifestFingerprint: string
  generatedAt: string
}

function stableHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

export function computeM9SqlValidationManifest(artifact: M9EnforcedCurationArtifact, safeSqlPlan: M9SafeSqlIntegrationResult, now: () => string): M9SqlValidationManifest {
  const verdictsById = new Map(artifact.conceptVerdicts.map((v) => [v.conceptId, v]))
  const conceptFingerprintsUsed: Record<string, string> = {}
  const expectedMembershipCounts: Record<string, number> = {}
  for (const outcome of safeSqlPlan.perListOutcomes) {
    if (!isGeneratedStatus(outcome.status)) continue
    const fp = verdictsById.get(outcome.conceptId)?.fingerprint
    if (fp) conceptFingerprintsUsed[outcome.conceptId] = fp
    expectedMembershipCounts[outcome.conceptId] = outcome.expectedMembershipCount
  }
  const manifestFingerprint = stableHash(
    ['m9-sql-validation-manifest', 'v1', artifact.inputCatalogFingerprint, JSON.stringify(conceptFingerprintsUsed), JSON.stringify(expectedMembershipCounts)].join('|')
  )
  return { inputCatalogFingerprint: artifact.inputCatalogFingerprint, conceptFingerprintsUsed, expectedMembershipCounts, manifestFingerprint, generatedAt: now() }
}
