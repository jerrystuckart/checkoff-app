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
// NewItemSqlInput machinery (which DOES create lists/items, and is
// exactly the higher-risk surface this whole ENFORCED track exists to
// move away from). A concept whose approved membership needs a genuinely
// NEW list is therefore reported as BLOCKED_NEW_LIST_NEEDED here — never
// silently routed through the unsafe path — and creating that list is
// left as an explicit, separate, out-of-band operator step. This is the
// single largest reason ENFORCED cannot yet become the default for a
// brand-new metro (see the Session 3 handoff's default-mode decision):
// a first-ever metro launch is ALL new lists.

import { createHash } from 'node:crypto'
import { generateListMembershipSql, type ListSqlItemResolution } from '../playbooks/listSqlGeneration'
import { validateM9ReusedItems, type M9ReusedItemResolution, type M9ReusedItemValidationFinding } from './m9ReusedItemValidation'
import { resolveM9CompletedListHandling, type M9ExistingListLookup, type M9CompletedListOperatorDecision, type M9ListResolution } from './m9CompletedListResolution'
import type { M9EnforcedCurationArtifact } from './m9EnforcedTypes'

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
}

export type M9ListSqlOutcomeStatus = 'GENERATED' | 'BLOCKED_NEW_LIST_NEEDED' | 'BLOCKED_NEEDS_REOPEN' | 'BLOCKED_ITEM_RESOLUTION_FAILED'

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

  const perListOutcomes: M9ListSqlOutcome[] = []

  for (const conceptId of approvedConceptIds) {
    const verdict = verdictsById.get(conceptId)
    const memberIds = input.artifact.finalApprovedMemberships[conceptId] ?? []
    const listRes = listResolutionByConceptId.get(conceptId)
    const listTitleForReporting = verdict?.proposedTitle ?? conceptId

    if (!listRes || listRes.kind === 'CREATE_NEW') {
      perListOutcomes.push({ conceptId, listTitle: listTitleForReporting, status: 'BLOCKED_NEW_LIST_NEEDED', sql: null, expectedMembershipCount: 0, errors: [listRes?.reason ?? 'No list resolution was supplied for this approved concept.'] })
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

  const ok = perListOutcomes.length > 0 && perListOutcomes.every((o) => o.status === 'GENERATED')
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
    .filter((o) => o.status === 'GENERATED')
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
    if (outcome.status !== 'GENERATED') continue
    const fp = verdictsById.get(outcome.conceptId)?.fingerprint
    if (fp) conceptFingerprintsUsed[outcome.conceptId] = fp
    expectedMembershipCounts[outcome.conceptId] = outcome.expectedMembershipCount
  }
  const manifestFingerprint = stableHash(
    ['m9-sql-validation-manifest', 'v1', artifact.inputCatalogFingerprint, JSON.stringify(conceptFingerprintsUsed), JSON.stringify(expectedMembershipCounts)].join('|')
  )
  return { inputCatalogFingerprint: artifact.inputCatalogFingerprint, conceptFingerprintsUsed, expectedMembershipCounts, manifestFingerprint, generatedAt: now() }
}
