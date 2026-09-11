// Chief Phase 2F — the Metro Launch orchestration driver. This is what
// makes Chief the actual playbook driver rather than a human issuing one
// `delegate` command per stage (Phase 2D/2E's own limitation, named
// explicitly in the Phase 2F task). Reuses, never reimplements:
// metroLaunch.ts's pure gate/loop functions (Phase 2C), executor.ts's
// execution runtime + routing.ts's provider-qualified selection
// (Phase 2D/2E), candidateMerge.ts's dedupe (Phase 2F), and
// playbookRun.ts's durable run identity (Phase 2F).
//
// EVENT-DRIVEN / RESUMABLE (spec section 2): driveMetroLaunch() persists
// the run record via runStore.put() after every meaningful step, before
// doing the next one. A caller can invoke it again at any time — after a
// crash, a day later, from a different process — and it resumes from
// exactly the persisted stage/state, never restarting from M1. Each call
// performs bounded work (stepMetroLaunchRun in a loop, capped by
// maxSteps) so a single invocation can drive an entire synthetic run in
// tests, or a single real step in production where an execution takes
// real wall-clock time.

import {
  auditCoverage,
  deriveMetroLoopAction,
  evaluateMetroGates,
  DEFAULT_NEIGHBORHOOD_RING_RADII_M,
  type CategoryCoveragePlan,
  type NeighborhoodDefinition,
  type GeographicDepthTarget,
  type CoverageAuditEvidence,
  type CoverageGap,
  type MetroGateEvidence,
} from '../playbooks/metroLaunch'
import { countByCanonicalCategory, classifyCategory, classifyCategoryWithFallback, type UnclassifiedCategory } from '../playbooks/categoryNormalization'
import { runExecutionRouted } from './routing'
import type { ExecutionStore, SpecialistExecutor, SpecialistExecutionRequest } from './executor'
import { getOrCreateRun, type PlaybookRunStore, type PlaybookRunRecord } from './playbookRun'
import { dedupeCandidates, findSuspectedDuplicates, type RawCandidate } from './candidateMerge'

/**
 * Real research_verifier (OpenAI) output has, in practice, occasionally
 * returned a candidate with `name`/`claimSupported` as null or empty
 * despite the RawCandidate contract declaring them required strings —
 * a genuine malformed-output case, not a hypothetical one (hit during
 * the Green Bay metro launch: `normalizeText` in candidateMerge.ts
 * crashed on `null.toLowerCase()` inside `dedupeCandidates`). A
 * candidate with no name is not usable data — silently coercing it to
 * an empty string would be worse than dropping it, since every
 * empty-named candidate would then spuriously dedupe together as "the
 * same thing." Drop and don't fabricate; never crash the whole stage
 * over one bad research row.
 */
function sanitizeRawCandidates<T extends RawCandidate>(candidates: T[]): T[] {
  return candidates.filter(
    (c) => typeof c?.name === 'string' && c.name.trim().length > 0 && typeof c?.claimSupported === 'string' && c.claimSupported.trim().length > 0
  )
}
import { DEFAULT_DRIVER_GUARDRAILS, type DriverGuardrails } from './driverGuardrails'
import type { SpecialistResultEnvelope, ProviderUsageInfo } from './types'
import { certifyEditorialDistinctiveness, checkDistinctiveExperience, checkVenueQuoted, type DistinctivenessCertificationItem } from '../playbooks/editorialDistinctiveness'
import { evaluateItemCritique, evaluateItemCertificationGate, type ItemCritiqueAnswers, type ItemCertificationOutcome, type CatalogItemCertificationCheck, type ItemCertificationRecord } from '../playbooks/itemCertificationLoop'
import { evaluateTagCertificationGate, validateItemTags, type ItemTagProposal } from '../playbooks/metroTagCertification'
import { deriveTagShortlist } from '../playbooks/tagShortlist'
import { buildEditorialThemedLists, selectFlagshipList, THEMED_LIST_DEFINITIONS, type ThemeableItem } from '../playbooks/homeListThemes'
import { evaluateItemMetadata, evaluateMetadataCompletenessGate, type MetadataEnrichmentResult } from '../playbooks/metroMetadataEnrichment'
import { evaluateGeoEnrichmentCertificationGate, CONFIDENT_TIERS, ACCEPTABLE_EXCEPTION_TIERS, type GeoEnrichmentItemResult, type PlacesMatchClassification } from '../playbooks/metroGeoEnrichment'
import { enrichMetroCatalogGeo, buildRealPlacesLookup, FileGeoEnrichmentCacheStore, type GeoEnrichmentCacheStore, type PlacesLookupFn, type GeoEnrichmentCandidate } from './metroGeoEnrichmentDriver'
import { readRealHomeListRows, type HomeListReadPathFailure } from './homeListReadPath'
import { fetchExistingProductionItemsForRegion } from './existingInventoryReadPath'
import { evaluateOutOfMarketContaminationGate } from '../playbooks/outOfMarketContamination'
import { reconcileAgainstExistingInventory, type ExistingProductionItem, type ReconciliationResult } from '../playbooks/existingInventoryReconciliation'
import { deriveDefaultDepthTargets } from '../playbooks/defaultMetroManifest'
import { certifyHomeListRow, evaluateHomeListCertificationGate, certifyCuratedListRow, evaluateCuratedListLayerGate, evaluateHomeListPackageValidationGate, derivePackageValidationFromSql, evaluateItemProvenanceGate, type HomeListRow, type CuratedListRow } from '../playbooks/homeListCertification'
import { evaluateImageReadinessGate, type ImageReadinessCard } from '../playbooks/imageReadiness'
import { certifyMetroLaunch, type MetroLaunchCertificationReport, type MetroLaunchCertificationSummary } from '../playbooks/metroLaunchCertification'
import {
  CANONICAL_TO_DB_CATEGORY,
  evaluateCatalogGate,
  checkForDuplicates,
  evaluateLocationGate,
  evaluatePresentationGate,
  evaluateEditorialQualityGate,
  type RealDbCategory,
  type StagingGateResult,
  type ItemIntakeRecord,
} from '../playbooks/metroCatalog'
import { resolveCanonicalTagVocabulary, loadGeneratedTagSnapshot, type VerifiedTagSnapshot } from './tagVocabularyProvider'
import { evaluateActivationKitGate, validateActivationKitReference, UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL } from '../playbooks/businessActivationKit'
import { checkActivationKitUrlLive, type ActivationKitLiveCheckResult } from './businessActivationKitCheck'
import { ensureProject as ensureProjectMutation, type EnsureProjectInput, type EnsureProjectResult } from '../mutations'
import {
  classifyGapsForRelaxation,
  relaxPlanForGaps,
  sortGapsForDispatch,
  gapHistoryKey,
  type GapResearchHistory,
  type PlanRelaxationRecord,
} from '../playbooks/coveragePlanRelaxation'
import { extractCanonicalVenueOptions, resolveDefaultCanonicalVenueName, resolveConfirmedCanonicalVenueName } from '../playbooks/canonicalVenueName'
import { evaluatePartnerPotential, type PartnerPotentialEvaluation } from '../playbooks/partnerPotential'
import { clusterByPlaceId, buildVenueClusterReviewNotes, evaluateSameVenueClusterReviewGate, type VenueCluster } from '../playbooks/venueDuplicateDetection'
import { analyzeCatalogVoice, evaluateOpeningVerbConcentrationAudit, type VoiceCatalogEntry } from '../playbooks/catalogVoiceDiagnostics'
import { evaluatePlacesCompletenessGate, type PlacesCompletenessItemInput } from '../playbooks/placesCompletenessGate'
import { evaluateNeighborhoodCompletenessGate } from '../playbooks/neighborhoodCompletenessGate'
import { checkSqlPatchSafety } from '../playbooks/sqlPatchSafety'
import { evaluateFinalReadyToApplyAudit, type FinalReadyToApplyResult } from '../playbooks/finalReadyToApplyAudit'
import { buildCostReport } from '../playbooks/metroCostReport'
import { buildStrategicCoverageReport, type StrategicCoverageReport } from '../playbooks/metroStrategicReport'
import { buildStageArtifactFiles } from './metroStageArtifacts'

export const METRO_LAUNCH_DRIVER_PLAYBOOK_KEY = 'metro_launch'

// ---------------------------------------------------------------------------
// M0 decision gate (spec section 5) — the 4 San Diego manifest decisions.
// ---------------------------------------------------------------------------

export interface MetroM0Decisions {
  geographicScope: string
  categoryCatalogTargets: string
  launchSeason: string | null // null is a VALID resolved decision ("deferred" is itself a decision, per the v2 playbook's own pattern) — undefined/missing key is NOT resolved
  executionGoAhead: boolean
  /**
   * ISO-3166-1 alpha-2 (e.g. "US", "AT") — the metro's real geography
   * identity, resolved at M0 like everything else here. Chief Phase 2Y:
   * M8 geo enrichment previously defaulted this to 'US' whenever it was
   * omitted, which silently broke Places country-match classification
   * for any non-US metro (found building Vienna). Required, same
   * discipline as geographicScope — there is no safe default.
   */
  metroCountry: string
  /** A coarse citywide lat/lng that biases every M8 Places query — same "no safe default" reasoning as metroCountry (0,0 is not a real fallback for any metro). */
  metroCenter: { lat: number; lng: number }
}

interface MetroDriverState {
  [key: string]: unknown
  m0Decisions?: MetroM0Decisions
  plan?: CategoryCoveragePlan
  depthTargets?: GeographicDepthTarget[]
  neighborhoods?: NeighborhoodDefinition[]
  candidates?: (RawCandidate & { needsVerification: boolean })[]
  gaps?: CoverageGap[]
  removedCandidateNames?: string[]
  hasRunM6?: boolean
  /** canonicalVenueName: the RESOLVED/CONFIRMED clean venue identity (canonicalVenueName.ts) — never the raw discovery label. What VENUE_QUOTING_GATE actually checks against. */
  checkoffizedItems?: Array<{ name: string; checkoffizedItem: string; tags: string[]; canonicalVenueName: string }>
  /** Candidates whose M6.5 write genuinely, repeatedly failed evidence validation (e.g. the model omitting a required field) — rejected, same as an M7 EXHAUSTED_RETRIES, never silently dropped and never escalated to NEEDS_JERRY for what is an ordinary bounded rejection. Permanently excluded from `remaining` (see stepEditor's alreadyDone). */
  editorRejectedCandidates?: Array<{ name: string; reason: string }>
  /** M7.5 TAG_ASSIGNMENT results, keyed by candidate name — `tags: null` means the bounded tag-selection retry budget was exhausted (the item KEEPS its original body/certification; only its tags stay whatever the last attempt produced, which the TAG_CERTIFICATION_GATE will then correctly fail on, rather than silently accepting an invalid set). */
  tagAssignmentResults?: Record<string, { tags: string[] | null; attempts: number; rejectionReasons: string[] }>
  /** Real OpenAI usage/cost, keyed by playbook stage — accumulated across the WHOLE run (never reset by a resume/reopen), recorded only on a genuinely fresh acceptance, never an idempotent replay. See recordStageUsage. */
  usageByStage?: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number; unknownCostCalls: number }>
  /** Count of provider/infra retries (429/timeout/5xx that survived even OpenAiAdapter's own internal backoff), keyed by stage — these never consume a content-repair attempt (see runStepWithInfraRetry); tracked separately so the two are never conflated in reporting. */
  infraRetriesByStage?: Record<string, number>
  awaitingExecutionLabels?: string[] // labels of executions this run is currently waiting on, for the current stage
  /** Raw candidate categories buildAuditEvidence could not map to the canonical taxonomy — flagged for review, never silently binned. Recomputed fresh every M4 pass, never accumulated. */
  unclassifiedCategories?: UnclassifiedCategory[]
  /** Per-gap real-dispatched-research history (coveragePlanRelaxation.ts) — accumulated across the whole run, never reset, so classification always sees the true research effort so far. */
  gapResearchHistory?: GapResearchHistory
  /** Every plan/depth-target/neighborhood-kind relaxation actually applied, in order — the permanent artifact record of what Winston loosened and why (never rejected candidates, never quality gates). Surfaced in the final report/decision packet. */
  planRelaxations?: PlanRelaxationRecord[]
  /** How many times stepM4 has responded to an exhausted maxLoopIterations budget by relaxing the plan (or granting one more bounded round) — bounded by guardrails.maxPlanRelaxationRounds before a genuine NEEDS_JERRY escalation. */
  planRelaxationRounds?: number
  /** Transient: gap history keys (coveragePlanRelaxation.ts's gapHistoryKey) actually dispatched to M5 research in the pass immediately before the NEXT M4 audit — consumed and cleared by that audit to attribute its counts correctly. Never accumulated. */
  lastDispatchedGapKeys?: string[]

  // ---------------------------------------------------------------------
  // M7-M10 — real, wired-in item + batch + list + final certification.
  // Phase 2W: previously these were pure library functions nothing in
  // the actual driver ever called (Jerry's 2026-09-07 correction) — the
  // bare metro command now owns this whole sequence itself.
  // ---------------------------------------------------------------------
  /** Per-candidate ITEM_CERTIFICATION_LOOP result, keyed by candidate name — the durable per-item research/evidence artifact (Phase 2V), now actually populated by the real driver. */
  itemCertifications?: Record<string, DriverItemCertificationRecord>
  /** Real, computed certification report from M8/M9/M10 — what stepLaunchBoundary reports to Jerry, replacing the old hardcoded synthetic gateEvidence. */
  finalCertificationReport?: MetroLaunchCertificationReport
  /** Chief Phase 2AL (2026-09-11) — the auto-wired, always-computed final ready-to-apply audit (finalReadyToApplyAudit.ts). Never optional in the sense of "may not run" — it runs every time M10 does; this is just its stored result. */
  finalReadyToApplyAudit?: FinalReadyToApplyResult
  homeListPlan?: HomeListPlanEntry[]
  /** The one atomic, self-certifying SQL patch text for Jerry to run — this driver never writes public.lists/public.list_items directly (standing write-boundary rule, unchanged). */
  homeListSqlPatch?: string
  tagVocabularyDetail?: string
  batchCertificationGates?: StagingGateResult[]
  rejectedItemCount?: number
  geoEnrichmentPaidCalls?: number
  geoEnrichmentCacheHits?: number
  geoEnrichmentResults?: Array<{ candidateName: string; classification: string; reason: string; placeId: string | null; formattedAddress: string | null; lat: number | null; lng: number | null; websiteUrl: string | null; geoRadiusM: number | null }>
  /**
   * Chief Phase 2AN (2026-09-11) — the real per-item METADATA_COMPLETENESS_GATE
   * results (has_alcohol/checkin_type/difficulty/photo_required/is_secret/
   * visit_profile_key), computed fresh every M8 pass but previously discarded
   * as a LOCAL variable (`metadataResults`) once the gate's PASS/FAIL verdict
   * was recorded — nothing downstream could ever read the actual evaluated
   * field values. This is the real root cause of a brand-new metro's
   * generated SQL package never creating its own `public.items` rows: M9's
   * SQL builder had no metadata to build an INSERT from, only a gate that
   * said the fields WOULD be evaluable. Now persisted so M9 can build a
   * genuinely self-contained item-creation package from it.
   */
  metadataEnrichmentResults?: MetadataEnrichmentResult[]
  activationKitCheckDetail?: string
  /** Certified items excluded from CATALOG_GATE's intakeRecords because classifyCategoryWithFallback (raw category AND finalBody) still found no canonical category — tracked explicitly, mirrors METADATA_COMPLETENESS_GATE's unclassifiedForMetadata list so this is never a silent drop. Recomputed fresh every M10 pass. */
  unclassifiedForIntake?: string[]
  /** M8.5 CATALOG_PRUNING (Chief Phase 2AD) — names of items already given their ONE bounded pruning-stage repair-or-drop decision, across the WHOLE run (never reset by resume/reopen at M8.5+, so a resumed run never re-spends a second real tag-repair call on the same item, and never flip-flops a drop back to a retry). See stepM8_5CatalogPruning. */
  catalogPruningAttempted?: string[]
  /** Every item permanently dropped by M8.5, with the specific reason and gate — the durable, reportable record of "reject weak/unresolved items rather than hand them to Jerry in bulk" (2026-09-09 instruction). Accumulated across the whole run, never reset. */
  catalogPruningDrops?: Array<{ candidateName: string; reason: 'REJECTED_GEO_UNRESOLVED' | 'REJECTED_INSUFFICIENT_TAG_CONTEXT' | 'REJECTED_UNCLASSIFIABLE_METADATA' | 'REJECTED_OUT_OF_MARKET' | 'REJECTED_DUPLICATE_VENUE'; detail: string }>
  /** Every item M8.5 successfully repaired (currently only tag repair has a real second attempt) rather than dropping — reportable alongside catalogPruningDrops. */
  catalogPruningRepairs?: Array<{ candidateName: string; repaired: 'TAGS' }>
  /** Chief Phase 3B (Vienna post-mortem item 3) — certified items whose GEO_ENRICHMENT result shares a Google Place ID with another certified item. Reporting-only, never an automatic drop (see venueDuplicateDetection.ts's own doc — same venue is not automatically a duplicate). Recomputed fresh every M8 pass. */
  venueDuplicateClusters?: VenueCluster[]
  /** Chief Phase 3B (item 6) — names already given their ONE bounded CATALOG_VOICE_PASS rewrite-or-keep decision, across the WHOLE run (same never-re-spend-a-second-call discipline as catalogPruningAttempted). */
  catalogVoicePassAttempted?: string[]
  /** Every item CATALOG_VOICE_PASS actually rewrote (never every item it considered — most flagged items may legitimately come back unchanged when a rewrite would weaken specificity). */
  catalogVoiceRewrites?: Array<{ candidateName: string; dominantOpeningWord: string }>
  /** Chief Phase 3B (item 10) — the final "what is still weak?" strategic coverage report, computed once at M10 from the frozen retained catalog. */
  strategicReport?: StrategicCoverageReport
  /** Chief Phase 3B (item 7) — filenames actually handed to deps.writeStageArtifact at M10 (empty when no writer was configured — this driver never assumes disk access it wasn't given). */
  stageArtifactManifest?: string[]
  /** Chief Phase 2AH — the real existing-production-inventory reconciliation result, computed once per run at M8 and never recomputed (a resumed run must not re-query production or re-spend judgment on items already classified). `skippedReason` is set (and reused/distinctSameVenue/unmatched left empty) when no real region search term was available — never silently treated as "confirmed nothing exists." */
  existingInventoryReconciliation?: (ReconciliationResult & { skippedReason?: undefined }) | { reused: []; distinctSameVenue: []; unmatched: []; skippedReason: string }
  /** Chief Phase 2AH — the raw existing-production-item snapshot fetched alongside existingInventoryReconciliation (same single fetch, cached the same way) — retained separately so M10's CATALOG_GATE can feed real maps_query values into metroCatalog.ts's checkForDuplicates(), which the driver previously always called with a hardcoded empty collidesWithProduction: []. */
  existingProductionInventorySnapshot?: ExistingProductionItem[]
  /** Chief Phase 2AH — real OUT_OF_MARKET_CONTAMINATION_GATE result from the M8 pass (before catalog certification), kept separately from batchCertificationGates' copy so M9's second, pre-SQL-generation pass can log exactly what changed between the two evaluations. */
  outOfMarketGateAtM8?: StagingGateResult
  /** Chief Phase 2AK — the real per-neighborhood item counts (including zero-item canonical neighborhoods) computed by NEIGHBORHOOD_COMPLETENESS_GATE, kept for the final report. */
  neighborhoodCompletenessReport?: { emptyNeighborhoods: string[]; perNeighborhoodCounts: Array<{ neighborhoodName: string; count: number }> }
}

/**
 * The driver-native per-item certification record — same POLICY as
 * itemCertificationLoop.ts's ItemCertificationRecord (reuses its exact
 * evaluateItemCritique/checkDistinctiveExperience/checkVenueQuoted
 * logic), but shaped around what the REAL checkoff_editor executor
 * evidence contract actually returns (factualSource/checkoffizedItem/tags
 * — no separate structured "hook object" exists in production evidence),
 * rather than forcing the driver through that module's richer
 * injected-deps interface, which assumes per-step evidence this driver's
 * real specialist calls don't produce. See metroLaunchDriver.test.ts for
 * the proof this is the SAME policy applied for real.
 */
export interface DriverItemCertificationRecord {
  candidateName: string
  venueName: string
  attempts: number
  outcome: ItemCertificationOutcome
  finalBody: string | null
  finalTags: string[]
  supportingFact: string
  verifiedAt: string | null
  rejectionReasons: string[]
  /**
   * The real production category (categories.name — one of REAL_DB_CATEGORIES),
   * resolved ONCE via classifyCategoryWithFallback and persisted here by
   * stepM8BatchCertification's METADATA_COMPLETENESS_GATE pass — the
   * single source of truth every later stage (M9's Home-list theming,
   * M10's intake records) reads instead of each recomputing its own
   * classification. Chief Phase 2AE (2026-09-09): buildHomeListPlan
   * previously grouped by the RAW candidate.category free-text label
   * instead of this, so "Museum"/"museum"/"restaurant" each became their
   * own themed list — never a canonical category. Undefined until M8
   * has run for this item (or when METADATA_COMPLETENESS_GATE could not
   * classify it at all, in which case the item never reaches this point
   * uncensored — see stepM8_5CatalogPruning's REJECTED_UNCLASSIFIABLE_METADATA).
   */
  dbCategory?: RealDbCategory
  /**
   * Chief Phase 3B (Vienna post-mortem item 2) — an ADVISORY-ONLY signal
   * (see partnerPotential.ts's own doc for the explicit non-goal: this
   * never determines editorial inclusion). Resolved once, alongside
   * dbCategory, by stepM8BatchCertification's METADATA_COMPLETENESS_GATE
   * pass.
   */
  partnerPotential?: PartnerPotentialEvaluation
}

export interface HomeListPlanEntry {
  /** Internal, human-readable report/log label ONLY — may carry a descriptive prefix like "Themed list: X" for clarity in reports/image-readiness cards. NEVER written to public.lists.title (Chief Phase 2AK, 2026-09-10) — use `title` for that. */
  label: string
  /** The REAL, exact user-facing list title — written verbatim to public.lists.title and used for every DB lookup/match against it. Never carries an internal prefix. */
  title: string
  kind: 'PRIMARY_SEASONAL' | 'THEMED' | 'CURATED_MIRROR'
  itemCandidateNames: string[]
  requiresImage: boolean
}

function readState(run: PlaybookRunRecord): MetroDriverState {
  return (run.state as MetroDriverState) ?? {}
}

export function m0DecisionsResolved(decisions: Partial<MetroM0Decisions> | undefined): decisions is MetroM0Decisions {
  if (!decisions) return false
  return (
    typeof decisions.geographicScope === 'string' &&
    decisions.geographicScope.length > 0 &&
    typeof decisions.categoryCatalogTargets === 'string' &&
    decisions.categoryCatalogTargets.length > 0 &&
    'launchSeason' in decisions &&
    decisions.executionGoAhead === true &&
    typeof decisions.metroCountry === 'string' &&
    decisions.metroCountry.length > 0 &&
    typeof decisions.metroCenter?.lat === 'number' &&
    typeof decisions.metroCenter?.lng === 'number'
  )
}

// ---------------------------------------------------------------------------
// Driver dependencies — everything injectable, same DI discipline as the
// rest of this codebase.
// ---------------------------------------------------------------------------

export interface MetroDriverDeps {
  runStore: PlaybookRunStore
  execStore: ExecutionStore
  executors: readonly SpecialistExecutor[]
  guardrails?: DriverGuardrails
  now?: () => string
  /** M8 tag certification: attempts a real live public.tags SELECT first (see tagVocabularyProvider.ts) — omit/reject to exercise the snapshot fallback. Defaults to always-failing (honest: no live access is configured unless the caller wires one in). */
  queryLiveTags?: () => Promise<string[]>
  /** M8 tag certification fallback — a versioned, justified VERIFIED_SNAPSHOT. Omit to default to the real, checked-in VerifiedTagSnapshot v1 (loadGeneratedTagSnapshot() — Jerry's 2026-09-06 production export, 857 names). Pass `null` explicitly to force the no-snapshot/fail-closed path (used only in tests). */
  verifiedTagSnapshot?: VerifiedTagSnapshot | null
  /** M8: the real Google Places lookup function. Defaults to buildRealPlacesLookup() (a genuine network call gated on GOOGLE_PLACES_API_KEY) — tests inject a fake, exactly like every other executor in this file. */
  placesLookup?: PlacesLookupFn
  /** M8: the Places result cache, scoped per metro — defaults to a real, durable FileGeoEnrichmentCacheStore so a paid lookup is never repeated across separate process runs, not just within one in-memory run. */
  geoEnrichmentCache?: GeoEnrichmentCacheStore
  /** M8: TEST-ONLY override for the coarse citywide lat/lng used to bias every Places query. Production always derives this from state.m0Decisions.metroCenter (resolved at M0 — see MetroM0Decisions) — never a hardcoded default, since a wrong bias silently degrades Places match quality for whichever metro doesn't happen to match the default. */
  metroCenterBias?: { lat: number; lng: number }
  /** M8: TEST-ONLY override for the ISO-3166-1 alpha-2 country every candidate is expected to resolve to (Places match classification treats a country mismatch as a definite wrong match). Production always derives this from state.m0Decisions.metroCountry — a hardcoded 'US' default here previously broke geo enrichment for every non-US metro (found building Vienna, Chief Phase 2Y). */
  expectedCountry?: string
  /** M9: reads the REAL runtime state of the planned Home lists (public.lists/public.list_items) — Chief has no direct public.lists write access (standing boundary, unchanged) and, without this, no way to confirm a hand-run SQL patch actually took effect either. Omit to correctly report HOME_LIST_CERTIFICATION_GATE as pending human application of the generated SQL patch; a caller (production wiring, or a test) supplies this once a real read path exists. */
  verifyHomeListRows?: (plan: readonly HomeListPlanEntry[]) => Promise<HomeListRow[] | HomeListReadPathFailure>
  /**
   * M9: the real, known metro_areas identity facts for THIS metro (name,
   * state/region, IANA timezone) — supplied by the caller the same way
   * metroCountry/metroCenter already are, never invented inside the
   * driver. When provided, the generated Home-list SQL package creates
   * the metro_areas row itself if missing (Vienna, 2026-09-09: the
   * generated SQL previously just RAISE EXCEPTION'd on a missing row,
   * silently expecting Jerry to have created it by hand first — a hidden
   * prerequisite). Omit to keep the old fail-closed check-only behavior
   * (never silently proceeds with a guessed identity).
   */
  metroAreaFacts?: { name: string; state: string; timezone: string }
  /**
   * M9: the real public.users id every official (Winston-authored) list
   * is created under. Defaults to the account already used for EVERY
   * existing official list across every launched metro (San Diego,
   * Denver, Tucson, Milwaukee — verified live, 2026-09-09) — never a
   * fabricated account; a caller may override for a metro that should
   * belong to someone else.
   */
  officialListCreatorId?: string
  /**
   * M9: the real, visitor-facing title for the flagship Home list (e.g.
   * "Fall 2026 — Vienna Metro") — a genuine per-metro editorial/seasonal
   * decision, never guessed or hardcoded inside this general-purpose
   * driver. Omit to keep the generic system label "Primary seasonal
   * list".
   */
  flagshipListTitle?: string
  /** M10: which Home cards already have an image. Omit to correctly report every required card as still needing one — Winston never fabricates image readiness. */
  checkImageReadiness?: (plan: readonly HomeListPlanEntry[]) => Promise<ImageReadinessCard[]>
  /** M10 BUSINESS_ACTIVATION_KIT_GATE: the actual outreach copy this metro would send — validated deterministically (no network call) for a metro-specific kit reference or a misused /confirm/<token> link. Defaults to a clean template referencing only the canonical URL, since no outreach is sent during a metro build itself. */
  outreachCopy?: string
  /** M10 BUSINESS_ACTIVATION_KIT_GATE: the ONE bounded network check (canonical URL live?) — defaults to a real fetch with an 8s timeout, never retried in a loop by the driver itself. Inject a fake in tests. */
  checkActivationKitLive?: (url: string) => Promise<ActivationKitLiveCheckResult>
  /** ENSURE_METRO_PROJECT (bootstrap, before M0): resolves-or-creates the agent.projects row this run's task-store identity requires (createTask's projectKey lookup — see dbPlaybookRunStore.ts/dbExecutionStore.ts). Defaults to the real ensureProject mutation (mutations.ts) — tests inject a fake, exactly like every other real side effect in this file. */
  ensureProject?: (input: EnsureProjectInput) => Promise<EnsureProjectResult>
  /** runStepWithInfraRetry's backoff delay — a real setTimeout-based sleep by default, instant in tests. */
  sleepImpl?: (ms: number) => Promise<void>
  /** Chief Phase 3B (Vienna post-mortem item 7): persists one durable stage artifact (see metroStageArtifacts.ts). Defaults to a no-op — this driver never assumes filesystem access it wasn't explicitly given; a real production caller wires this to a file write under the metro's own temp/output directory. */
  writeStageArtifact?: (name: string, content: string) => Promise<void>
  /**
   * M8 (Chief Phase 2AH, Green Bay incident): fetches real, live
   * production items that may already represent this metro's region
   * under a DIFFERENT metro's ownership (see
   * existingInventoryReadPath.ts's real query — the Green Bay/Milwaukee
   * situation). Defaults to the real DB read, scoped by
   * deps.metroAreaFacts.name (with " Metro" stripped) — a caller may
   * override the search term via existingInventorySearchTerm, or inject
   * a fake in tests. Never fabricated: if metroAreaFacts is absent and no
   * override is supplied, reconciliation is skipped entirely (reported
   * honestly in state.existingInventoryReconciliation as
   * `skippedReason`, never silently treated as "nothing existing found").
   */
  fetchExistingProductionInventory?: (regionSearchTerm: string) => Promise<ExistingProductionItem[]>
  /** Overrides the region search term used by fetchExistingProductionInventory's default real query — omit to derive it from deps.metroAreaFacts.name. */
  existingInventorySearchTerm?: string
  /**
   * M9 (Chief Phase 2AH): the metro's REAL, established production slug
   * convention (e.g. "green-bay", kebab-case, matching san-diego/
   * milwaukee/denver precedent) — distinct from `projectId`, which is
   * the CLI/task-tracking key (e.g. "green_bay_wisconsin") and was
   * previously used as the literal `metro_areas.slug` value by mistake.
   * Defaults to `projectId` for backward compatibility with existing
   * runs/tests that never distinguished the two.
   */
  metroAreaSlug?: string
  /**
   * M8 (Chief Phase 2AK/2AL, 2026-09-10/11 methodology hardening
   * postmortem): the metro's REAL, approved, FROZEN canonical
   * neighborhood model (see e.g. greenBayNeighborhoodModel.ts's
   * 13-neighborhood list for one metro) — used by
   * NEIGHBORHOOD_COMPLETENESS_GATE to report per-neighborhood item
   * counts, INCLUDING any canonical neighborhood with zero items (an
   * accepted, reported fact, never fabricated or misassigned around).
   *
   * REQUIRED for production-ready status as of Chief Phase 2AL: omitting
   * this is now a hard NEIGHBORHOOD_COMPLETENESS_GATE FAIL, not a silent
   * fallback to whatever M1 happened to discover — a metro cannot reach
   * READY_TO_ACTIVATE without an explicit canonical model, surfaced as a
   * real, named blocker rather than proceeding on unverified geography.
   * The canonical model may be produced earlier in the methodology
   * (M0/coverage-planning); it just must be explicit and frozen by the
   * time this gate runs (M8, before M9 generates production SQL).
   */
  canonicalNeighborhoods?: readonly string[]
  /**
   * M9 (Chief Phase 2AL, 2026-09-11): real, documented locality centroids
   * (a village/district's own public center coordinate — e.g. greenBayNeighborhoodModel.ts's
   * GREEN_BAY_EMPTY_NEIGHBORHOOD_FALLBACK_CENTROIDS) for a canonical
   * neighborhood that currently has zero retained items. NEVER a
   * fabricated business location. A canonical neighborhood with neither
   * real items nor an entry here fails the package closed rather than
   * being silently skipped or given an invented coordinate.
   */
  emptyNeighborhoodFallbackCentroids?: Readonly<Record<string, { lat: number; lng: number }>>
}

export function executionId(runId: string, stage: string, label: string): string {
  return `${runId}::${stage}::${label}`
}

/**
 * Real-run finding (San Diego, 2026-09-05): executionId/idempotencyKey
 * are deterministic per (runId, stage, label) — correct for the normal
 * case (never double-run a stage), but it means a genuinely fixed
 * evidence CONTRACT (e.g. requiring `kind` on every M1 neighborhood,
 * added this same day) has no way to invalidate an already-COMPLETE
 * execution recorded under the OLD, looser contract. runExecution's
 * idempotent-replay path (by design — see its own doc comment) returns
 * that stale envelope forever, bypassing the new validation entirely,
 * for any run that revisits M1 after being reset.
 *
 * The fix is NOT to weaken idempotency (that protects real, expensive
 * work from ever re-running by accident) — it's to make the evidence
 * CONTRACT part of the identity being deduplicated. Bumping this
 * constant is the deliberate, explicit way to invalidate every
 * previously-COMPLETE M1 execution the next time a reset run reaches
 * M1 again: the resulting executionId has never been seen before, so
 * registerExecution's findByIdempotencyKey lookup genuinely misses and
 * a fresh (real, paid) research call happens under the new contract —
 * while every OTHER already-COMPLETE execution (M3, M5, M6, ...) is
 * completely undisturbed, and a brand-new project's very first M1 call
 * is unaffected either way (it has no prior record regardless of this
 * version). Bump this ONLY when the M1 evidence shape/requirements
 * actually change again — not for unrelated driver changes.
 */
export const M1_GEOGRAPHY_EVIDENCE_CONTRACT_VERSION = 2 // v2 (2026-09-05): neighborhoods[] now requires a valid `kind` — see validateNeighborhoodDefinitions.

export function m1GeographyExecutionLabel(): string {
  return `geography-contract-v${M1_GEOGRAPHY_EVIDENCE_CONTRACT_VERSION}`
}

async function persist(run: PlaybookRunRecord, deps: MetroDriverDeps): Promise<PlaybookRunRecord> {
  run.updatedAt = (deps.now ?? (() => new Date().toISOString()))()
  await deps.runStore.put(run)
  return run
}

function escalate(run: PlaybookRunRecord, reason: string, packet: Record<string, unknown>): PlaybookRunRecord {
  run.status = 'NEEDS_JERRY'
  run.jerryReason = reason
  run.decisionPacket = packet
  return run
}

function block(run: PlaybookRunRecord, reason: string): PlaybookRunRecord {
  run.status = 'BLOCKED'
  run.jerryReason = reason
  run.decisionPacket = null
  return run
}

// ---------------------------------------------------------------------------
// The one-execution-with-bounded-retry primitive every stage below uses.
// ---------------------------------------------------------------------------

interface StepExecutionOutcome {
  kind: 'ACCEPTED' | 'NEEDS_JERRY' | 'BLOCKED'
  envelope?: SpecialistResultEnvelope
  reason?: string
}

/**
 * Cost/usage instrumentation (Chief Phase 2Z — multiple real OpenAI
 * usage alerts during the Vienna run). Accumulates onto run.state
 * directly (readState(run) returns the SAME object reference as
 * run.state once a run exists — see getOrCreateRun's `state: {}`
 * initialization — so this is safe to call from within
 * runStepWithRetry/runStepWithInfraRetry without racing whatever the
 * calling step function does with its own `state` variable afterward).
 * Recorded ONLY on a genuinely fresh acceptance — never on an idempotent
 * COMPLETE replay, which would double-count a cost already paid (and
 * recorded, if instrumentation existed then) in an earlier call.
 */
function recordStageUsage(run: PlaybookRunRecord, stage: string, usage: ProviderUsageInfo | null | undefined): void {
  const state = readState(run)
  const byStage = { ...(state.usageByStage ?? {}) }
  const existing = byStage[stage] ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unknownCostCalls: 0 }
  byStage[stage] = {
    calls: existing.calls + 1,
    inputTokens: existing.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: existing.outputTokens + (usage?.outputTokens ?? 0),
    costUsd: existing.costUsd + (usage?.costUsd ?? 0),
    unknownCostCalls: existing.unknownCostCalls + (usage?.costUsd == null ? 1 : 0),
  }
  state.usageByStage = byStage
  run.state = state
}

function recordInfraRetry(run: PlaybookRunRecord, stage: string): void {
  const state = readState(run)
  const byStage = { ...(state.infraRetriesByStage ?? {}) }
  byStage[stage] = (byStage[stage] ?? 0) + 1
  state.infraRetriesByStage = byStage
  run.state = state
}

async function runStepWithRetry(deps: MetroDriverDeps, run: PlaybookRunRecord, request: SpecialistExecutionRequest): Promise<StepExecutionOutcome> {
  const guardrails = deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS
  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const outcome = await runExecutionRouted(deps.execStore, request, deps.executors, deps.now)
    if ('status' in outcome && outcome.status === 'EXECUTOR_UNAVAILABLE') {
      return { kind: 'BLOCKED', reason: outcome.errorReason ?? 'EXECUTOR_UNAVAILABLE' }
    }
    if ('accepted' in outcome && outcome.accepted) {
      recordStageUsage(run, request.stage, outcome.record.envelope?.providerUsage)
      return { kind: 'ACCEPTED', envelope: outcome.record.envelope ?? undefined }
    }
    // Bug fix (found resuming the real San Diego run after a manual
    // state reset for M1): runExecution's own idempotent-replay path
    // returns a bare ExecutionRecord (not an AcceptResultOutcome) when
    // the SAME executionId already has a COMPLETE record — e.g. a stage
    // deliberately re-entered after resetting run.currentStage. Neither
    // 'status' in outcome nor 'accepted' in outcome matches that shape,
    // so without this check a genuinely-already-accepted execution was
    // wrongly treated as a fresh failure needing retry (harmlessly, since
    // the idempotent path never re-invokes the executor — but it still
    // burned the retry guardrail and escalated on a call that had, in
    // fact, already succeeded).
    if ('status' in outcome && outcome.status === 'COMPLETE') {
      return { kind: 'ACCEPTED', envelope: outcome.envelope ?? undefined }
    }
    // Not accepted and not unavailable -> evidence/validation failure
    // (NEEDS_MORE_EVIDENCE/FAILED). Bounded retry per spec section 18/20.
    attempt += 1
    run.totalRetries += 1
    if (attempt > guardrails.maxRetriesPerExecution || run.totalRetries > guardrails.maxRetriesPerExecution * 10) {
      const reason = 'reasons' in outcome ? outcome.reasons.join('; ') : 'evidence validation failed'
      return { kind: 'NEEDS_JERRY', reason: `execution ${request.executionId} failed evidence validation ${attempt} time(s), exceeding the retry guardrail: ${reason}` }
    }
    await persist(run, deps) // record the retry attempt durably before trying again
  }
}

async function realSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Wraps runStepWithRetry with a SEPARATE, bounded retry budget for
 * infrastructure/provider failures (EXECUTOR_UNAVAILABLE/BLOCKED — a
 * rate limit that survived even OpenAiAdapter's own internal backoff, a
 * timeout, a transient 5xx) — see requirement #5, Chief Phase 2Z. This
 * is DELIBERATELY separate from runStepWithRetry's own retry loop, which
 * only ever retries a genuine evidence-validation failure (a returned
 * body that's malformed/incomplete) and is what M7's bounded
 * content-repair attempts are meant to count. Retrying the EXACT SAME
 * request (same executionId/idempotencyKey) is safe and correct:
 * registerExecution returns the existing non-COMPLETE record and
 * runExecution re-executes it — the same mechanism unblockRun's
 * playbook-level recovery relies on, just applied inline instead of
 * requiring an operator to notice and re-invoke.
 */
async function runStepWithInfraRetry(deps: MetroDriverDeps, run: PlaybookRunRecord, request: SpecialistExecutionRequest): Promise<StepExecutionOutcome> {
  const guardrails = deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS
  const sleep = deps.sleepImpl ?? realSleep
  let outcome = await runStepWithRetry(deps, run, request)
  let infraAttempt = 0
  while (outcome.kind === 'BLOCKED' && infraAttempt < guardrails.maxInfraRetriesPerStep) {
    infraAttempt += 1
    recordInfraRetry(run, request.stage)
    await sleep(INFRA_RETRY_BASE_DELAY_MS * infraAttempt)
    outcome = await runStepWithRetry(deps, run, request)
  }
  return outcome
}

const INFRA_RETRY_BASE_DELAY_MS = 3000

// ---------------------------------------------------------------------------
// Stage implementations — each performs ONE unit of work and returns the
// updated (already-persisted) run.
// ---------------------------------------------------------------------------

async function stepM0(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const decisions: Partial<MetroM0Decisions> | undefined = state.m0Decisions
  const resolved: boolean = m0DecisionsResolved(decisions)
  if (!resolved) {
    return escalate(run, 'Metro launch cannot start — required M0 decisions are unresolved.', {
      decisionNeeded: 'Confirm the 4 Metro launch decisions before Chief begins research.',
      why: 'metro_launch/v1 methodology requires geographic scope, category/catalog targets, launch season (or an explicit deferral), a resolved metro country + center point, and an execution go-ahead before any specialist work starts.',
      missing: {
        geographicScope: !decisions?.geographicScope,
        categoryCatalogTargets: !decisions?.categoryCatalogTargets,
        launchSeason: !decisions || !('launchSeason' in decisions),
        executionGoAhead: decisions?.executionGoAhead !== true,
        metroCountry: !decisions?.metroCountry,
        metroCenter: typeof decisions?.metroCenter?.lat !== 'number' || typeof decisions?.metroCenter?.lng !== 'number',
      },
    })
  }
  run.currentStage = 'M1_GEOGRAPHY_MAP'
  return run
}

async function stepM1(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  // Phase 2H live-provider proof finding: the M0 geographic-scope decision
  // (including any open questions it deliberately flagged, e.g. "is North
  // County in scope?") was never actually reaching the M1 research
  // prompt — stepM1 only ever sent a generic objective, so the model had
  // no way to know about a scope decision Chief had already recorded.
  // Threading it through here means M1 evidence can actually speak to the
  // specific open question, instead of a comparably-generic result.
  const m0 = readState(run).m0Decisions
  const request: SpecialistExecutionRequest = {
    specialist: 'research_verifier',
    playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
    stage: 'M1_GEOGRAPHY_MAP',
    objective: `${run.projectId}: neighborhood/geography research`,
    inputs: { executionType: 'BROAD_DISCOVERY', geographicScope: m0?.geographicScope ?? null },
    requiredEvidenceKeys: ['neighborhoods'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: executionId(run.runId, 'M1', m1GeographyExecutionLabel()),
    projectId: run.projectId,
    destinationId: null,
    metroId: run.projectId,
    allowedCapabilities: ['live_web_research'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: executionId(run.runId, 'M1', m1GeographyExecutionLabel()),
  }
  const outcome = await runStepWithRetry(deps, run, request)
  if (outcome.kind === 'BLOCKED') return block(run, outcome.reason ?? 'M1 blocked')
  if (outcome.kind === 'NEEDS_JERRY') return escalate(run, outcome.reason ?? 'M1 needs Jerry', { decisionNeeded: 'M1 geography research could not complete evidence validation.', why: outcome.reason })

  const state = readState(run)
  // Evidence validation (delegation.ts's validateResultEnvelope, via
  // validateNeighborhoodDefinitions) already guaranteed every entry has
  // a real name + valid kind before this envelope was ever ACCEPTED —
  // ring radii are NOT requested of the model (see NeighborhoodEvidenceInput
  // doc in metroLaunch.ts), so this is where a real NeighborhoodDefinition
  // is completed with metro-appropriate defaults.
  const rawNeighborhoods = (outcome.envelope?.evidence.neighborhoods as Array<Partial<NeighborhoodDefinition>>) ?? []
  state.neighborhoods = rawNeighborhoods.map((n) => ({
    name: n.name as string,
    kind: n.kind as NeighborhoodDefinition['kind'],
    ring1RadiusM: typeof n.ring1RadiusM === 'number' && n.ring1RadiusM > 0 ? n.ring1RadiusM : DEFAULT_NEIGHBORHOOD_RING_RADII_M.ring1,
    ring2RadiusM: typeof n.ring2RadiusM === 'number' && n.ring2RadiusM > 0 ? n.ring2RadiusM : DEFAULT_NEIGHBORHOOD_RING_RADII_M.ring2,
  }))
  run.state = state
  run.currentStage = 'M2_CATEGORY_COVERAGE_PLAN'
  return run
}

async function stepM2(deps: MetroDriverDeps, run: PlaybookRunRecord, defaultPlan: CategoryCoveragePlan, depthTargets: GeographicDepthTarget[] | undefined, autoDeriveDepthTargetsFromGeography: boolean | undefined): Promise<PlaybookRunRecord> {
  // Deterministic — no specialist call needed once a plan is supplied
  // (per the Phase 2F task: "metro_builder or performs deterministic
  // target setup where already encoded").
  const state = readState(run)
  state.plan = defaultPlan
  // An explicit depthTargets[] (a real --geo-depth-plan, or San Diego's
  // own frozen historical manifest when THIS run genuinely is San Diego —
  // see cli.ts) is always honored verbatim. Omitting it defaults to `[]`
  // (plain zero-check only — GeographicDepthTarget's own doc: "Defaults
  // to none") — the long-standing, safe, test-relied-upon default for any
  // DIRECT driveMetroLaunch() caller.
  //
  // Chief Phase 2AH root-cause fix (Green Bay incident, 2026-09-10): the
  // bare `cli.ts run metro_launch` entry point (never a direct
  // driveMetroLaunch() test caller) additionally sets
  // autoDeriveDepthTargetsFromGeography=true whenever it has no explicit
  // --geo-depth-plan and isn't the frozen San Diego project (see cli.ts).
  // ONLY in that specific case does omitting depthTargets derive generic
  // floors from the CURRENT run's own real, already-researched M1
  // neighborhoods (state.neighborhoods, set by stepM1 immediately before
  // this stage runs) instead of the plain `[]` — satisfying "generate the
  // metro-specific geo plan automatically from the normal planning
  // methodology" for the actual bare-command path, while never changing
  // the default for existing/direct callers that never opted in. Because
  // this only ever reads THIS run's own M1 output, it can never reference
  // a different metro's geography, unlike the SAN_DIEGO_GEOGRAPHIC_DEPTH_TARGETS
  // default this replaced.
  state.depthTargets = depthTargets ?? (autoDeriveDepthTargetsFromGeography ? deriveDefaultDepthTargets(state.neighborhoods ?? []) : [])
  run.state = state
  run.currentStage = 'M3_BROAD_DISCOVERY'
  return run
}

async function stepM3(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const request: SpecialistExecutionRequest = {
    specialist: 'research_verifier',
    playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
    stage: 'M3_BROAD_DISCOVERY',
    objective: `${run.projectId}: broad discovery`,
    inputs: { executionType: 'BROAD_DISCOVERY' },
    requiredEvidenceKeys: ['candidates'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: executionId(run.runId, 'M3', 'broad'),
    projectId: run.projectId,
    destinationId: null,
    metroId: run.projectId,
    allowedCapabilities: ['live_web_research'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: executionId(run.runId, 'M3', 'broad'),
  }
  const outcome = await runStepWithRetry(deps, run, request)
  if (outcome.kind === 'BLOCKED') return block(run, outcome.reason ?? 'M3 blocked')
  if (outcome.kind === 'NEEDS_JERRY') return escalate(run, outcome.reason ?? 'M3 needs Jerry', { decisionNeeded: 'M3 broad discovery could not complete.', why: outcome.reason })

  const state = readState(run)
  const newCandidates = sanitizeRawCandidates((outcome.envelope?.evidence.candidates as (RawCandidate & { needsVerification: boolean })[]) ?? []).map((c) => ({ ...c, needsVerification: c.needsVerification ?? true }))
  const merged = dedupeCandidates([...(state.candidates ?? []), ...newCandidates])
  state.candidates = merged.deduped
  run.state = state
  run.currentStage = 'M4_COVERAGE_AUDIT'
  return run
}

/**
 * A candidate's free-text neighborhood field is exactly as variable as
 * its category ("Carlsbad" vs "Carlsbad (North County)") — substring
 * containment (case-insensitive) against a KNOWN target name is the
 * same deterministic-normalization discipline as categoryNormalization.ts,
 * just simpler because target neighborhood names are the driver's own
 * configured proper nouns, not free-form model output.
 */
function countCandidatesNearNeighborhood(candidates: ReadonlyArray<{ neighborhood?: string | null }>, targetName: string): number {
  const needle = targetName.toLowerCase()
  return candidates.filter((c) => (c.neighborhood ?? '').toLowerCase().includes(needle)).length
}

export interface BuildAuditEvidenceResult {
  evidence: CoverageAuditEvidence
  /** Candidate categories that couldn't be confidently mapped to the canonical taxonomy — surfaced for review, never silently binned into a bad bucket or allowed to invent a new category. */
  unclassifiedCategories: UnclassifiedCategory[]
}

export function buildAuditEvidence(state: MetroDriverState): BuildAuditEvidenceResult {
  const candidates = state.candidates ?? []
  const allNeighborhoods = state.neighborhoods ?? []
  const depthTargets = state.depthTargets ?? []

  // Categories: normalized to the canonical taxonomy BEFORE auditCoverage
  // ever sees them — this is the San Diego run's bug #1 fix. Raw labels
  // are never discarded; countByCanonicalCategory reports them via
  // `unclassified` rather than forcing them into a bucket.
  const { counts: categoryCounts, unclassified: unclassifiedCategories } = countByCanonicalCategory(candidates.map((c) => c.category))

  // Neighborhoods: fuzzy substring match (bug #2's "meaningful depth"
  // companion fix) against every named area auditCoverage actually
  // checks — the plain M1 neighborhood list AND any configured depth targets.
  const targetNames = new Set<string>([...allNeighborhoods.map((n) => n.name), ...depthTargets.map((d) => d.neighborhoodName)])
  const neighborhoodCounts = [...targetNames].map((neighborhoodName) => ({ neighborhoodName, count: countCandidatesNearNeighborhood(candidates, neighborhoodName) }))

  return {
    evidence: {
      categoryCounts,
      neighborhoodCounts,
      plan: state.plan ?? { targets: [] },
      allNeighborhoods,
      depthTargets,
    },
    unclassifiedCategories,
  }
}

/** The achieved count auditCoverage compared a gap's target against — category count for a CATEGORY_* gap, neighborhood count for a GEOGRAPHIC_* gap. Same lookup auditCoverage itself does internally, exposed here so relaxation can compare "what did we actually find" against "what the plan demands". */
function achievedCountForGap(gap: Pick<CoverageGap, 'kind' | 'name'>, evidence: CoverageAuditEvidence): number {
  if (gap.kind.startsWith('CATEGORY_')) {
    return evidence.categoryCounts.find((c) => c.categoryName === gap.name)?.count ?? 0
  }
  return evidence.neighborhoodCounts.find((n) => n.neighborhoodName === gap.name)?.count ?? 0
}

async function stepM4(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const guardrails = deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS
  const state = readState(run)
  const { evidence, unclassifiedCategories } = buildAuditEvidence(state)
  state.unclassifiedCategories = unclassifiedCategories

  // Attribute this audit's counts to whichever gaps were ACTUALLY
  // dispatched for research in the immediately preceding M5 pass — never
  // to a gap that merely sat in the blocking list while fan-out
  // researched something else (coveragePlanRelaxation.ts's plateau
  // detection must reflect real research effort, not audit cadence).
  // Accumulates across the WHOLE run — never reset — so classification
  // always sees the true research effort so far, even across relaxation
  // rounds.
  const history: GapResearchHistory = { ...(state.gapResearchHistory ?? {}) }
  for (const key of state.lastDispatchedGapKeys ?? []) {
    const sep = key.indexOf(':')
    const kind = key.slice(0, sep) as CoverageGap['kind']
    const name = key.slice(sep + 1)
    const count = achievedCountForGap({ kind, name }, evidence)
    const rec = history[key] ?? { timesDispatched: 0, countAfterDispatch: [] }
    history[key] = { ...rec, countAfterDispatch: [...rec.countAfterDispatch, count] }
  }
  state.gapResearchHistory = history
  state.lastDispatchedGapKeys = []

  const gaps = auditCoverage(evidence)
  const loop = deriveMetroLoopAction(gaps)

  if (loop.action === 'PROCEED_TO_VERIFICATION') {
    state.gaps = []
    run.state = state
    run.currentStage = state.hasRunM6 ? 'M6_5_CHECKOFF_EDITOR' : 'M6_QUALITY_VERIFICATION'
    return run
  }

  run.loopIteration += 1
  if (run.loopIteration > guardrails.maxLoopIterations) {
    return stepM4HandleExhaustedLoop(deps, run, state, evidence, loop.blockingGaps, history, guardrails)
  }

  state.gaps = sortGapsForDispatch(loop.blockingGaps, history)
  run.state = state
  run.currentStage = 'M5_TARGETED_DEEP_DIVES'
  return run
}

/**
 * Reached once per exhausted maxLoopIterations budget. Never brute-force
 * (never simply grants more iterations against the SAME plan) — instead
 * classifies every still-blocking gap and relaxes only what's proven
 * (via real, plateaued research) to be an unrealistic target, then
 * grants one fresh maxLoopIterations budget against the revised plan.
 * Bounded overall by guardrails.maxPlanRelaxationRounds: a metro that
 * still can't close its (by-then-already-relaxed) gaps after that many
 * rounds is a genuine product decision, never a planning mistake Winston
 * keeps grinding on unattended.
 */
function stepM4HandleExhaustedLoop(
  deps: MetroDriverDeps,
  run: PlaybookRunRecord,
  state: MetroDriverState,
  evidence: CoverageAuditEvidence,
  blockingGaps: CoverageGap[],
  history: GapResearchHistory,
  guardrails: DriverGuardrails
): PlaybookRunRecord {
  const round = state.planRelaxationRounds ?? 0
  if (round >= guardrails.maxPlanRelaxationRounds) {
    return escalate(
      run,
      `Metro coverage gap loop exceeded ${guardrails.maxLoopIterations} iterations per round across ${round} bounded plan-relaxation round(s) without closing — this is a genuine product decision Winston cannot self-repair further (every automatically-relaxable target already was).`,
      {
        decisionNeeded: 'Approve a further category-minimum/district-depth exception, provide additional research direction, or accept the metro at its current coverage.',
        why: `${blockingGaps.length} blocking gap(s) remain after ${guardrails.maxPlanRelaxationRounds} bounded relaxation round(s) (${(state.planRelaxations ?? []).length} target(s) already relaxed — see planRelaxations).`,
        evidence: blockingGaps,
        planRelaxations: state.planRelaxations ?? [],
      }
    )
  }

  const classifications = classifyGapsForRelaxation(blockingGaps, history, guardrails.minResearchDispatchesBeforeRelaxation)
  const eligible = classifications.filter((c) => c.eligibleForRelaxation).map((c) => c.gap)

  if (eligible.length > 0) {
    const relaxed = relaxPlanForGaps({
      plan: state.plan ?? { targets: [] },
      depthTargets: state.depthTargets ?? [],
      neighborhoods: state.neighborhoods ?? [],
      categoryCounts: evidence.categoryCounts,
      neighborhoodCounts: evidence.neighborhoodCounts,
      gapsToRelax: eligible,
      round: round + 1,
    })
    state.plan = relaxed.plan
    state.depthTargets = relaxed.depthTargets
    state.neighborhoods = relaxed.neighborhoods
    state.planRelaxations = [...(state.planRelaxations ?? []), ...relaxed.relaxations]
  }
  state.planRelaxationRounds = round + 1
  run.loopIteration = 0

  // Re-audit immediately against the (possibly revised) plan — relaxed
  // targets may already close every gap without spending another
  // research pass; gaps still not eligible (genuine missing coverage)
  // simply get one more full, fresh, bounded round.
  const { evidence: revisedEvidence } = buildAuditEvidence(state)
  const revisedGaps = auditCoverage(revisedEvidence)
  const revisedLoop = deriveMetroLoopAction(revisedGaps)
  if (revisedLoop.action === 'PROCEED_TO_VERIFICATION') {
    state.gaps = []
    run.state = state
    run.currentStage = state.hasRunM6 ? 'M6_5_CHECKOFF_EDITOR' : 'M6_QUALITY_VERIFICATION'
    return run
  }
  state.gaps = sortGapsForDispatch(revisedLoop.blockingGaps, history)
  run.state = state
  run.currentStage = 'M5_TARGETED_DEEP_DIVES'
  return run
}

async function stepM5(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const guardrails = deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS
  const state = readState(run)
  const gaps = state.gaps ?? []
  if (gaps.length === 0) {
    run.currentStage = 'M4_COVERAGE_AUDIT'
    return run
  }

  const scoped = gaps.slice(0, guardrails.maxConcurrentExecutions)

  // Record real dispatch BEFORE awaiting research — an attempt was
  // genuinely made regardless of outcome, which is exactly what
  // coveragePlanRelaxation.ts's classification needs to count. Also
  // rotates: gaps beyond maxConcurrentExecutions this pass (not in
  // `scoped`) get priority next time via sortGapsForDispatch, so a long
  // tail of gaps never starves at zero real attempts.
  const dispatchHistory: GapResearchHistory = { ...(state.gapResearchHistory ?? {}) }
  for (const gap of scoped) {
    const key = gapHistoryKey(gap)
    const rec = dispatchHistory[key] ?? { timesDispatched: 0, countAfterDispatch: [] }
    dispatchHistory[key] = { ...rec, timesDispatched: rec.timesDispatched + 1 }
  }
  state.gapResearchHistory = dispatchHistory
  state.lastDispatchedGapKeys = scoped.map(gapHistoryKey)
  // PARALLEL fan-out (spec section 7): each gap is its own independent
  // execution, tracked/validated separately, safe to run concurrently
  // because none mutates shared state — results are merged deterministically below.
  const results = await Promise.all(
    scoped.map(async (gap, i) => {
      const label = `gap-${run.loopIteration}-${i}-${gap.kind}-${gap.name}`.replace(/[^a-zA-Z0-9_-]/g, '_')
      const request: SpecialistExecutionRequest = {
        specialist: 'research_verifier',
        playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
        stage: 'M5_TARGETED_DEEP_DIVES',
        objective: `${run.projectId}: targeted research for ${gap.kind} ${gap.name} (${gap.detail})`,
        inputs: { executionType: gap.kind === 'GEOGRAPHIC_HOLE' ? 'GEOGRAPHIC_GAP' : 'CATEGORY_GAP', gap },
        requiredEvidenceKeys: ['candidates'],
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
        executionId: executionId(run.runId, 'M5', label),
        projectId: run.projectId,
        destinationId: null,
        metroId: run.projectId,
        allowedCapabilities: ['live_web_research'],
        authorityOperations: ['metro_launch.research'],
        idempotencyKey: executionId(run.runId, 'M5', label),
      }
      return runStepWithRetry(deps, run, request)
    })
  )

  const failed = results.filter((r) => r.kind !== 'ACCEPTED')
  if (failed.length > 0 && failed.every((r) => r.kind === 'BLOCKED')) {
    return block(run, `All targeted gap research executions were blocked: ${failed.map((r) => r.reason).join('; ')}`)
  }

  const newCandidates = results
    .filter((r) => r.kind === 'ACCEPTED')
    .flatMap((r) => sanitizeRawCandidates((r.envelope?.evidence.candidates as (RawCandidate & { needsVerification: boolean })[]) ?? []).map((c) => ({ ...c, needsVerification: c.needsVerification ?? true })))
  const merged = dedupeCandidates([...(state.candidates ?? []), ...newCandidates])
  state.candidates = merged.deduped
  run.state = state
  run.currentStage = 'M4_COVERAGE_AUDIT'
  return run
}

async function stepM6(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const toVerify = (state.candidates ?? []).filter((c) => c.needsVerification)
  if (toVerify.length === 0) {
    state.hasRunM6 = true
    run.state = state
    run.currentStage = 'M6_5_CHECKOFF_EDITOR'
    return run
  }

  const request: SpecialistExecutionRequest = {
    specialist: 'research_verifier',
    playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
    stage: 'M6_QUALITY_VERIFICATION',
    objective: `${run.projectId}: verify ${toVerify.length} candidate(s)`,
    inputs: { executionType: 'VERIFICATION', candidates: toVerify },
    // Only 'verifiedCandidateNames' is required (and always non-empty —
    // stepM6 only ever calls this when toVerify.length > 0): a legitimate
    // verification pass may remove ZERO candidates, so 'removedCandidateNames'
    // must stay optional — requiring it would fail the honest, common
    // case where nothing was found stale (Phase 2D's evidence rule treats
    // an empty array as "missing," which is correct for evidence that
    // must exist but wrong to impose on a count that can truthfully be zero).
    requiredEvidenceKeys: ['verifiedCandidateNames'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: executionId(run.runId, 'M6', String(run.loopIteration)),
    projectId: run.projectId,
    destinationId: null,
    metroId: run.projectId,
    allowedCapabilities: ['live_web_research'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: executionId(run.runId, 'M6', String(run.loopIteration)),
  }
  const outcome = await runStepWithRetry(deps, run, request)
  if (outcome.kind === 'BLOCKED') return block(run, outcome.reason ?? 'M6 blocked')
  if (outcome.kind === 'NEEDS_JERRY') return escalate(run, outcome.reason ?? 'M6 needs Jerry', { decisionNeeded: 'M6 verification could not complete.', why: outcome.reason })

  const removedNames = (outcome.envelope?.evidence.removedCandidateNames as string[]) ?? []
  state.hasRunM6 = true
  state.candidates = (state.candidates ?? []).map((c) => (removedNames.includes(c.name) ? null : { ...c, needsVerification: false })).filter((c): c is NonNullable<typeof c> => c !== null)
  state.removedCandidateNames = [...(state.removedCandidateNames ?? []), ...removedNames]
  run.state = state

  run.currentStage = removedNames.length > 0 ? 'M5B_REPLACEMENT' : 'M6_5_CHECKOFF_EDITOR'
  return run
}

async function stepM5B(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const removed = state.removedCandidateNames ?? []
  if (removed.length === 0) {
    run.currentStage = 'M6_5_CHECKOFF_EDITOR'
    return run
  }

  const request: SpecialistExecutionRequest = {
    specialist: 'research_verifier',
    playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
    stage: 'M5_TARGETED_DEEP_DIVES', // replacement research is the same methodology stage as any other targeted deep dive
    objective: `${run.projectId}: replacement research for ${removed.length} candidate(s) removed by verification (${removed.join(', ')})`,
    inputs: { executionType: 'REPLACEMENT', removedCandidateNames: removed },
    requiredEvidenceKeys: ['candidates'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: executionId(run.runId, 'M5B', String(run.loopIteration)),
    projectId: run.projectId,
    destinationId: null,
    metroId: run.projectId,
    allowedCapabilities: ['live_web_research'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: executionId(run.runId, 'M5B', String(run.loopIteration)),
  }
  const outcome = await runStepWithRetry(deps, run, request)
  if (outcome.kind === 'BLOCKED') return block(run, outcome.reason ?? 'M5B blocked')
  if (outcome.kind === 'NEEDS_JERRY') return escalate(run, outcome.reason ?? 'M5B needs Jerry', { decisionNeeded: 'Replacement research could not complete.', why: outcome.reason })

  const newCandidates = sanitizeRawCandidates((outcome.envelope?.evidence.candidates as (RawCandidate & { needsVerification: boolean })[]) ?? []).map((c) => ({ ...c, needsVerification: c.needsVerification ?? true }))
  const merged = dedupeCandidates([...(state.candidates ?? []), ...newCandidates])
  state.candidates = merged.deduped
  state.removedCandidateNames = []
  run.state = state
  run.currentStage = 'M4_COVERAGE_AUDIT'
  return run
}

async function stepEditor(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const verified = state.candidates ?? []
  const alreadyDone = new Set([...(state.checkoffizedItems ?? []).map((c) => c.name), ...(state.editorRejectedCandidates ?? []).map((c) => c.name)])
  const remaining = verified.filter((c) => !alreadyDone.has(c.name))

  if (remaining.length === 0) {
    run.currentStage = 'M7_ITEM_CERTIFICATION'
    return run
  }

  // Bounded batch per call (guardrail: maxConcurrentExecutions) — NOT a
  // silent drop of overflow candidates. `remaining` is recomputed from
  // `state.checkoffizedItems` every call, so repeated calls to this same
  // stage (the driver loop naturally does this since currentStage is
  // only advanced once nothing remains) process the next batch until
  // every verified candidate has been editorialized.
  const batch = remaining.slice(0, (deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS).maxConcurrentExecutions)

  const results = await Promise.all(
    batch.map(async (candidate, i) => {
      const label = `editor-${i}-${candidate.name}`.replace(/[^a-zA-Z0-9_-]/g, '_')
      // Canonical venue identity (canonicalVenueName.ts) — resolved BEFORE
      // the editorial call, never the raw discovery label itself. Tiers
      // 1 (Places) / 2 (verified research name) aren't wired into this
      // pipeline stage yet, so this resolves tier 3 (deterministic
      // cleanup) as the default hint; the editor may instead confirm one
      // of `alternatives` when the discovery label bundled several
      // distinct venues (extractCanonicalVenueOptions).
      const { alternatives } = extractCanonicalVenueOptions(candidate.name)
      const defaultCanonicalVenueName = resolveDefaultCanonicalVenueName({ discoveryName: candidate.name })
      const request: SpecialistExecutionRequest = {
        specialist: 'checkoff_editor',
        playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
        stage: 'M6_5_CHECKOFF_EDITOR',
        objective: `${run.projectId}: checkoffize ${candidate.name}`,
        inputs: { factualSource: candidate.claimSupported, businessOrPlace: candidate.name, canonicalVenueName: defaultCanonicalVenueName, canonicalVenueAlternatives: alternatives },
        requiredEvidenceKeys: ['factualSource', 'checkoffizedItem', 'tags', 'canonicalVenueUsed'],
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
        executionId: executionId(run.runId, 'EDITOR', label),
        projectId: run.projectId,
        destinationId: null,
        metroId: run.projectId,
        allowedCapabilities: ['content_editorial'],
        authorityOperations: ['metro_launch.build_internal_artifact'],
        idempotencyKey: executionId(run.runId, 'EDITOR', label),
      }
      // Infra retry (429/timeout/5xx) — never consumes anything from the
      // bounded content-repair budget (that's M7's job); a provider/
      // network failure here is retried on its own small bounded budget.
      const outcome = await runStepWithInfraRetry(deps, run, request)
      const editorChoice = outcome.kind === 'ACCEPTED' ? (outcome.envelope?.evidence.canonicalVenueUsed as string | undefined) : undefined
      const confirmed = resolveConfirmedCanonicalVenueName(editorChoice, defaultCanonicalVenueName, alternatives)
      // A confirmed-null (editor echoed a name outside the allowed set)
      // falls back to the default rather than failing this stage outright
      // — checkVenueQuoted at M7 will correctly reject a body that
      // doesn't actually contain the default quoted, triggering a real,
      // correctly-instructed rewrite attempt there.
      return { name: candidate.name, outcome, canonicalVenueName: confirmed ?? defaultCanonicalVenueName }
    })
  )

  // Bug fix (found wiring M7-M10 in, Phase 2W): this used to check ONLY
  // for outcome.kind === 'BLOCKED' — an evidence-validation failure
  // (kind === 'NEEDS_JERRY', e.g. checkoff_editor genuinely omitting a
  // required evidence key after exhausting its own bounded retries) fell
  // through this check entirely, was silently dropped from
  // checkoffizedItems, and — because `remaining` is recomputed from
  // checkoffizedItems every call — the SAME failing candidate(s) were
  // reprocessed identically on every subsequent step, forever, never
  // escalating and never advancing.
  //
  // Second correction (Vienna, 2026-09-09): the original fix above then
  // escalated the WHOLE metro build to NEEDS_JERRY the moment even ONE
  // candidate, out of a batch of hundreds, genuinely exhausted its
  // retries (e.g. the model repeatedly omitting `tags` for one
  // thin-source candidate) — a single isolated write failure stopped
  // metro-wide progress and required a human to manually drop that one
  // candidate and resume, every time. A candidate whose evidence
  // genuinely, repeatedly fails to generate is exactly "no strong
  // experience could be certified" (the CORE QUALITY RULE's own
  // rejection case, same as an M7 EXHAUSTED_RETRIES) — it is REJECTED
  // and recorded, never silently dropped (still permanently excluded
  // from `remaining` via editorRejectedCandidates, so the original
  // infinite-loop bug stays fixed) and never escalated to a human for
  // what is an ordinary, bounded, automatable rejection.
  const accepted = results.filter((r) => r.outcome.kind === 'ACCEPTED')
  const blockedResults = results.filter((r) => r.outcome.kind === 'BLOCKED')
  const needsJerryResults = results.filter((r) => r.outcome.kind === 'NEEDS_JERRY')

  state.checkoffizedItems = [
    ...(state.checkoffizedItems ?? []),
    ...accepted.map((r) => ({ name: r.name, checkoffizedItem: String(r.outcome.envelope?.evidence.checkoffizedItem ?? ''), tags: (r.outcome.envelope?.evidence.tags as string[] | undefined) ?? [], canonicalVenueName: r.canonicalVenueName })),
  ]
  state.editorRejectedCandidates = [
    ...(state.editorRejectedCandidates ?? []),
    ...needsJerryResults.map((r) => ({ name: r.name, reason: r.outcome.reason ?? 'evidence validation failed' })),
  ]
  run.state = state

  if (blockedResults.length > 0) {
    return block(run, `checkoff_editor unavailable for ${blockedResults.length} candidate(s): ${blockedResults.map((r) => `${r.name}: ${r.outcome.reason}`).join('; ')}`)
  }

  // Stage advances only once every verified candidate has been
  // editorialized — remaining.length > batch.length means more batches
  // are needed; the driver loop re-enters this SAME stage next iteration.
  if (remaining.length <= batch.length) {
    run.currentStage = 'M7_ITEM_CERTIFICATION'
  }
  return run
}

// ---------------------------------------------------------------------------
// M7 — ITEM_CERTIFICATION_LOOP, wired into the real driver (Phase 2W).
// Every checkoffized item runs its OWN bounded critique/repair loop
// before the batch-wide gates ever see it — never a batch rewrite call,
// per Jerry's 2026-09-07 correction. Reuses the exact certification
// POLICY from itemCertificationLoop.ts (evaluateItemCritique, which
// itself reuses checkDistinctiveExperience/checkVenueQuoted from
// editorialDistinctiveness.ts) — the orchestration below is native to
// this driver's own executor-call conventions (matching every other
// stage in this file) rather than itemCertificationLoop.ts's
// injected-deps shape, because that module assumes a richer per-step
// evidence contract than checkoff_editor's real evidence
// (factualSource/checkoffizedItem/tags) actually returns.
// ---------------------------------------------------------------------------

const ITEM_CERTIFICATION_CRITIQUE_KEYS = ['hasConcreteAction', 'moreSpecificThanVenuePurpose', 'supportedByResearch', 'isCurrent', 'tellsUsefulNonObviousDetail', 'soundsLikeCheckoff', 'concise']
export const MAX_ITEM_CERTIFICATION_ATTEMPTS = 3

async function certifyOneItemDriverNative(
  deps: MetroDriverDeps,
  run: PlaybookRunRecord,
  candidate: RawCandidate,
  item: { name: string; checkoffizedItem: string; tags: string[]; canonicalVenueName: string }
): Promise<DriverItemCertificationRecord> {
  let body = item.checkoffizedItem
  let tags = item.tags
  // The RESOLVED/CONFIRMED canonical venue identity (canonicalVenueName.ts)
  // — never candidate.name (the raw, often compound/parenthetical
  // discovery label). This is what checkVenueQuoted/checkDistinctiveExperience
  // actually validate against below. A rewrite may legitimately re-confirm
  // a DIFFERENT bundled alternative (see the REWRITE branch).
  let canonicalVenueName = item.canonicalVenueName
  const { alternatives } = extractCanonicalVenueOptions(candidate.name)
  const rejectionReasons: string[] = []
  const safeName = candidate.name.replace(/[^a-zA-Z0-9_-]/g, '_')

  for (let attempt = 1; attempt <= MAX_ITEM_CERTIFICATION_ATTEMPTS; attempt++) {
    const critiqueLabel = `critique-${safeName}-attempt${attempt}`
    const critiqueRequest: SpecialistExecutionRequest = {
      specialist: 'checkoff_editor',
      playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
      stage: 'M7_ITEM_CERTIFICATION',
      objective: `${run.projectId}: independently critique the CheckOff item written for ${candidate.name} (attempt ${attempt}) — a separate pass from the one that wrote it, never the same call self-grading its own output`,
      inputs: { mode: 'CRITIQUE', venueName: canonicalVenueName, body, factualSource: candidate.claimSupported },
      requiredEvidenceKeys: ITEM_CERTIFICATION_CRITIQUE_KEYS,
      methodologyId: 'checkoff_editor',
      methodologyVersion: 'v1',
      executionId: executionId(run.runId, 'M7_CRITIQUE', critiqueLabel),
      projectId: run.projectId,
      destinationId: null,
      metroId: run.projectId,
      allowedCapabilities: ['content_editorial'],
      authorityOperations: ['metro_launch.build_internal_artifact'],
      idempotencyKey: executionId(run.runId, 'M7_CRITIQUE', critiqueLabel),
    }
    // Infra retry (429/timeout/5xx) — never consumes this attempt slot;
    // only a genuine returned-and-graded body does (requirement #5).
    const critiqueOutcome = await runStepWithInfraRetry(deps, run, critiqueRequest)
    if (critiqueOutcome.kind !== 'ACCEPTED') {
      rejectionReasons.push(`critique attempt ${attempt}: ${critiqueOutcome.reason ?? 'executor unavailable'}`)
      break
    }
    const ev = critiqueOutcome.envelope?.evidence ?? {}
    const answers: ItemCritiqueAnswers = {
      hasConcreteAction: Boolean(ev.hasConcreteAction),
      moreSpecificThanVenuePurpose: Boolean(ev.moreSpecificThanVenuePurpose),
      supportedByResearch: Boolean(ev.supportedByResearch),
      isCurrent: Boolean(ev.isCurrent),
      tellsUsefulNonObviousDetail: Boolean(ev.tellsUsefulNonObviousDetail),
      soundsLikeCheckoff: Boolean(ev.soundsLikeCheckoff),
      concise: Boolean(ev.concise),
      critiqueNotes: String(ev.critiqueNotes ?? ''),
    }
    // The two deterministic sub-checks (swap-10-competitors test, venue
    // quoting) are computed HERE, never asked of the AI critique step —
    // see evaluateItemCritique's own doc. Against the CANONICAL name,
    // never the raw discovery label — this is the Vienna 1/450 fix.
    const critique = evaluateItemCritique(body, canonicalVenueName, answers)
    if (critique.pass) {
      return { candidateName: candidate.name, venueName: canonicalVenueName, attempts: attempt, outcome: 'ITEM_CERTIFIED', finalBody: body, finalTags: tags, supportingFact: candidate.claimSupported, verifiedAt: (deps.now ?? (() => new Date().toISOString()))(), rejectionReasons }
    }
    rejectionReasons.push(`attempt ${attempt}: ${critique.failureReasons.join('; ')}`)
    if (attempt === MAX_ITEM_CERTIFICATION_ATTEMPTS) break

    const rewriteLabel = `rewrite-${safeName}-attempt${attempt}`
    const rewriteRequest: SpecialistExecutionRequest = {
      specialist: 'checkoff_editor',
      playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
      stage: 'M7_ITEM_CERTIFICATION',
      objective: `${run.projectId}: rewrite the CheckOff item for ${candidate.name} with a genuinely stronger, more distinctive hook — previous attempt rejected (${critique.failureReasons.join('; ')}), research/rewrite rather than reword the same weak hook`,
      inputs: {
        mode: 'REWRITE',
        factualSource: candidate.claimSupported,
        businessOrPlace: candidate.name,
        previousBody: body,
        rejectionReasons: critique.failureReasons,
        canonicalVenueName,
        canonicalVenueAlternatives: alternatives,
      },
      requiredEvidenceKeys: ['checkoffizedItem', 'tags', 'canonicalVenueUsed'],
      methodologyId: 'checkoff_editor',
      methodologyVersion: 'v1',
      executionId: executionId(run.runId, 'M7_REWRITE', rewriteLabel),
      projectId: run.projectId,
      destinationId: null,
      metroId: run.projectId,
      allowedCapabilities: ['content_editorial'],
      authorityOperations: ['metro_launch.build_internal_artifact'],
      idempotencyKey: executionId(run.runId, 'M7_REWRITE', rewriteLabel),
    }
    const rewriteOutcome = await runStepWithInfraRetry(deps, run, rewriteRequest)
    if (rewriteOutcome.kind !== 'ACCEPTED') {
      rejectionReasons.push(`rewrite attempt ${attempt}: ${rewriteOutcome.reason ?? 'executor unavailable'}`)
      break
    }
    body = String(rewriteOutcome.envelope?.evidence.checkoffizedItem ?? body)
    tags = (rewriteOutcome.envelope?.evidence.tags as string[] | undefined) ?? tags
    // A rewrite may legitimately re-focus on a different bundled
    // alternative (e.g. the first draft tried the compound label, the
    // rewrite correctly narrows to one real sub-venue) — re-confirm
    // against the SAME allowed option set, never silently accept
    // whatever string the editor echoes.
    const rewriteChoice = rewriteOutcome.envelope?.evidence.canonicalVenueUsed as string | undefined
    const confirmed = resolveConfirmedCanonicalVenueName(rewriteChoice, item.canonicalVenueName, alternatives)
    canonicalVenueName = confirmed ?? canonicalVenueName
  }

  // Bounded retry budget exhausted (or the executor genuinely could not
  // complete a step) — never manufacture filler. This candidate is
  // rejected out of the final catalog, not force-included.
  return { candidateName: candidate.name, venueName: canonicalVenueName, attempts: MAX_ITEM_CERTIFICATION_ATTEMPTS, outcome: 'EXHAUSTED_RETRIES', finalBody: null, finalTags: [], supportingFact: candidate.claimSupported, verifiedAt: null, rejectionReasons }
}

async function stepM7ItemCertification(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const items = state.checkoffizedItems ?? []
  const alreadyCertified = new Set(Object.keys(state.itemCertifications ?? {}))
  const remaining = items.filter((i) => !alreadyCertified.has(i.name))

  if (remaining.length === 0) {
    run.currentStage = 'M7_5_TAG_ASSIGNMENT'
    return run
  }

  const batch = remaining.slice(0, (deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS).maxConcurrentExecutions)
  const candidatesByName = new Map((state.candidates ?? []).map((c) => [c.name, c]))

  const results = await Promise.all(
    batch.map(async (item) => {
      const candidate = candidatesByName.get(item.name)
      if (!candidate) {
        // Should be structurally impossible (every checkoffizedItem comes
        // from a candidate) — treated as a hard rejection, never silently
        // skipped, so the gap is visible in the certification record.
        const rec: DriverItemCertificationRecord = { candidateName: item.name, venueName: item.name, attempts: 0, outcome: 'EXHAUSTED_RETRIES', finalBody: null, finalTags: [], supportingFact: '', verifiedAt: null, rejectionReasons: ['no matching candidate record found in state.candidates'] }
        return rec
      }
      return certifyOneItemDriverNative(deps, run, candidate, item)
    })
  )

  const itemCertifications = { ...(state.itemCertifications ?? {}) }
  for (const rec of results) itemCertifications[rec.candidateName] = rec
  state.itemCertifications = itemCertifications
  run.state = state

  if (remaining.length <= batch.length) {
    run.currentStage = 'M7_5_TAG_ASSIGNMENT'
  }
  return run
}

// ---------------------------------------------------------------------------
// M7.5 — TAG_ASSIGNMENT (Chief Phase 2AA). A dedicated stage, separate
// from editorial writing/critique: the 299-certified-item Vienna run
// showed TAG_CERTIFICATION_GATE failing 298/299 because the SAME
// write/rewrite call that produces the body was also asked for tags,
// with NO canonical vocabulary ever given to it — the model invented
// plausible-sounding tags. This stage never touches finalBody, never
// triggers an M6.5/M7 rewrite, and never re-spends editorial work — it
// only replaces finalTags on an ALREADY-CERTIFIED item, from a
// deterministic, per-item shortlist (tagShortlist.ts) of the real
// canonical vocabulary, validated with the same never-invent discipline
// as everywhere else.
// ---------------------------------------------------------------------------

export const MAX_TAG_ASSIGNMENT_ATTEMPTS = 3

async function assignTagsForOneItem(
  deps: MetroDriverDeps,
  run: PlaybookRunRecord,
  candidateName: string,
  body: string,
  claimSupported: string,
  category: string | null,
  shortlist: readonly string[],
  knownRealTagNames: ReadonlySet<string>,
  // Distinguishes a genuinely NEW attempt series (M8.5's widened-shortlist
  // repair) from M7.5's original series — without this, a repair call
  // reuses the exact same executionId/idempotencyKey as the original
  // exhausted attempt and the idempotency layer just replays the old
  // (already-invalid) result instead of ever calling the executor again.
  labelPrefix: string = 'tag'
): Promise<{ tags: string[] | null; attempts: number; rejectionReasons: string[] }> {
  const safeName = candidateName.replace(/[^a-zA-Z0-9_-]/g, '_')
  const rejectionReasons: string[] = []

  for (let attempt = 1; attempt <= MAX_TAG_ASSIGNMENT_ATTEMPTS; attempt++) {
    const label = `${labelPrefix}-${safeName}-attempt${attempt}`
    const request: SpecialistExecutionRequest = {
      specialist: 'checkoff_editor',
      playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
      stage: 'M7_5_TAG_ASSIGNMENT',
      objective: `${run.projectId}: select 6-8 canonical tags for ${candidateName} from a ${shortlist.length}-name shortlist`,
      inputs: { mode: 'TAG_SELECTION', body, category, claimSupported, shortlist },
      requiredEvidenceKeys: ['tags'],
      methodologyId: 'checkoff_editor',
      methodologyVersion: 'v1',
      executionId: executionId(run.runId, 'TAG', label),
      projectId: run.projectId,
      destinationId: null,
      metroId: run.projectId,
      allowedCapabilities: ['content_editorial'],
      authorityOperations: ['metro_launch.build_internal_artifact'],
      idempotencyKey: executionId(run.runId, 'TAG', label),
    }
    // Infra retry (429/timeout/5xx) never consumes a content attempt —
    // same discipline as the editorial loop (requirement #5).
    const outcome = await runStepWithInfraRetry(deps, run, request)
    if (outcome.kind !== 'ACCEPTED') {
      rejectionReasons.push(`attempt ${attempt}: ${outcome.reason ?? 'executor unavailable'}`)
      break
    }
    const proposedTags = ((outcome.envelope?.evidence.tags as unknown[] | undefined) ?? []).filter((t): t is string => typeof t === 'string')
    const validation = validateItemTags({ candidateName, tags: proposedTags }, knownRealTagNames)
    if (validation.valid) {
      return { tags: proposedTags, attempts: attempt, rejectionReasons }
    }
    rejectionReasons.push(`attempt ${attempt}: ${validation.issues.join('; ')}`)
  }
  return { tags: null, attempts: MAX_TAG_ASSIGNMENT_ATTEMPTS, rejectionReasons }
}

async function stepTagAssignment(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const certifications = state.itemCertifications ?? {}
  const certifiedNames = Object.values(certifications)
    .filter((r): r is DriverItemCertificationRecord & { finalBody: string } => r.outcome === 'ITEM_CERTIFIED' && r.finalBody !== null)
    .map((r) => r.candidateName)

  const tagVocabulary = await resolveCanonicalTagVocabulary(
    deps.queryLiveTags ?? (async () => { throw new Error('no live tag query configured for this run') }),
    deps.verifiedTagSnapshot !== undefined ? deps.verifiedTagSnapshot : loadGeneratedTagSnapshot()
  )
  if (tagVocabulary.status === 'FAILED') {
    return escalate(run, `Tag vocabulary unavailable — cannot run TAG_ASSIGNMENT: ${tagVocabulary.reason}`, {
      decisionNeeded: 'Provide a live public.tags read path or a fresh verified snapshot before Chief can assign any tags.',
      why: tagVocabulary.reason,
    })
  }
  state.tagVocabularyDetail = tagVocabulary.detail
  const knownRealTagNames = tagVocabulary.tagNames

  const alreadyAssigned = new Set(Object.keys(state.tagAssignmentResults ?? {}))
  const remaining = certifiedNames.filter((n) => !alreadyAssigned.has(n))

  if (remaining.length === 0) {
    run.currentStage = 'M8_BATCH_CERTIFICATION'
    return run
  }

  const batch = remaining.slice(0, (deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS).maxConcurrentExecutions)
  const candidatesByName = new Map((state.candidates ?? []).map((c) => [c.name, c]))
  const vocabList = [...knownRealTagNames]

  const results = await Promise.all(
    batch.map(async (name) => {
      const rec = certifications[name]
      const candidate = candidatesByName.get(name)
      const canonical = classifyCategoryWithFallback(candidate?.category ?? null, rec.finalBody ?? null).canonical
      const shortlist = deriveTagShortlist(vocabList, { category: canonical, body: rec.finalBody ?? '', claimSupported: rec.supportingFact, neighborhood: candidate?.neighborhood ?? null })
      const result = await assignTagsForOneItem(deps, run, name, rec.finalBody ?? '', rec.supportingFact, canonical, shortlist, knownRealTagNames)
      return { name, ...result }
    })
  )

  const itemCertifications = { ...certifications }
  const tagAssignmentResults = { ...(state.tagAssignmentResults ?? {}) }
  for (const r of results) {
    tagAssignmentResults[r.name] = { tags: r.tags, attempts: r.attempts, rejectionReasons: r.rejectionReasons }
    if (r.tags) {
      // Replaces ONLY finalTags on the existing certification record —
      // finalBody/outcome/attempts (the editorial history) are completely
      // untouched. This is the one place besides certifyOneItemDriverNative
      // that ever writes itemCertifications, and it never changes body/outcome.
      itemCertifications[r.name] = { ...itemCertifications[r.name], finalTags: r.tags }
    }
  }
  state.itemCertifications = itemCertifications
  state.tagAssignmentResults = tagAssignmentResults
  run.state = state

  if (remaining.length <= batch.length) {
    run.currentStage = 'M8_BATCH_CERTIFICATION'
  }
  return run
}

// ---------------------------------------------------------------------------
// M8 — batch-wide certification gates, run AFTER individual item
// certification, never instead of it. Deterministic — no specialist
// calls (every input here was already gathered by M6/M7).
// ---------------------------------------------------------------------------

async function stepM8BatchCertification(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const allRecords = Object.values(state.itemCertifications ?? {})
  const certified = allRecords.filter((r): r is DriverItemCertificationRecord & { finalBody: string } => r.outcome === 'ITEM_CERTIFIED' && r.finalBody !== null)

  if (certified.length === 0) {
    return block(run, 'No items reached ITEM_CERTIFIED after the per-item certification loop — quality over count means an empty or near-empty result is a genuine blocker, never filled with filler.')
  }

  const candidatesByName = new Map((state.candidates ?? []).map((c) => [c.name, c]))

  // DISTINCTIVE_EXPERIENCE_GATE / VENUE_QUOTING_GATE / OPENING_DISTRIBUTION_GATE — safety net.
  const distinctivenessItems: DistinctivenessCertificationItem[] = certified.map((r) => ({ candidateName: r.candidateName, venueName: r.venueName, body: r.finalBody }))
  const { gates: distinctivenessGates } = certifyEditorialDistinctiveness(distinctivenessItems)

  // ITEM_CERTIFICATION_GATE — structural invariant: the final catalog (by
  // construction, `certified`) must be exactly the set of ITEM_CERTIFIED records.
  const itemGateChecks: CatalogItemCertificationCheck[] = certified.map((r) => ({
    candidateName: r.candidateName,
    record: { venueName: r.venueName, attempts: r.attempts, outcome: r.outcome, chosenHook: null, rejectedHooks: [], finalBody: r.finalBody, currencyCheck: null, lastCritique: null, history: [] } as ItemCertificationRecord,
  }))
  const itemCertificationGate = evaluateItemCertificationGate(itemGateChecks)

  // TAG_CERTIFICATION_GATE — live DB first, verified snapshot fallback, fail closed on neither.
  const tagVocabulary = await resolveCanonicalTagVocabulary(
    deps.queryLiveTags ?? (async () => { throw new Error('no live tag query configured for this run') }),
    deps.verifiedTagSnapshot !== undefined ? deps.verifiedTagSnapshot : loadGeneratedTagSnapshot()
  )
  let tagGate: StagingGateResult
  if (tagVocabulary.status === 'FAILED') {
    tagGate = { key: 'TAG_CERTIFICATION_GATE', verdict: 'FAIL', reason: tagVocabulary.reason }
  } else {
    state.tagVocabularyDetail = tagVocabulary.detail
    const proposals: ItemTagProposal[] = certified.map((r) => ({ candidateName: r.candidateName, tags: r.finalTags }))
    tagGate = evaluateTagCertificationGate(proposals, tagVocabulary.tagNames).gate
  }

  // METADATA_COMPLETENESS_GATE — deterministic, content-based (no extra AI/DB call needed).
  // This is also the single place that resolves and PERSISTS each
  // certified item's real production dbCategory (see
  // DriverItemCertificationRecord.dbCategory) — every later stage reads
  // it from here rather than each recomputing its own classification.
  const unclassifiedForMetadata: string[] = []
  const metadataResults: MetadataEnrichmentResult[] = []
  const itemCertificationsWithDbCategory = { ...(state.itemCertifications ?? {}) }
  let dbCategoryChanged = false
  for (const r of certified) {
    const candidate = candidatesByName.get(r.candidateName)
    const canonical = classifyCategoryWithFallback(candidate?.category ?? null, r.finalBody ?? null).canonical
    const dbCategory: RealDbCategory | null = canonical ? CANONICAL_TO_DB_CATEGORY[canonical] : null
    if (!dbCategory) {
      unclassifiedForMetadata.push(r.candidateName)
      continue
    }
    metadataResults.push(evaluateItemMetadata({ candidateName: r.candidateName, body: r.finalBody, dbCategory }))
    // partnerPotential (Chief Phase 3B item 2) — advisory only, resolved
    // in the same pass as dbCategory since both are pure functions of
    // (dbCategory, body, tags) that only need computing once per item.
    const partnerPotential = evaluatePartnerPotential({ dbCategory, body: r.finalBody, tags: r.finalTags })
    if (itemCertificationsWithDbCategory[r.candidateName]?.dbCategory !== dbCategory || itemCertificationsWithDbCategory[r.candidateName]?.partnerPotential?.score !== partnerPotential.score) {
      itemCertificationsWithDbCategory[r.candidateName] = { ...itemCertificationsWithDbCategory[r.candidateName], dbCategory, partnerPotential }
      dbCategoryChanged = true
    }
  }
  if (dbCategoryChanged) state.itemCertifications = itemCertificationsWithDbCategory
  // Persist the real, computed per-item metadata — see MetroDriverState.metadataEnrichmentResults's own doc for why this used to be silently discarded.
  state.metadataEnrichmentResults = metadataResults
  const metadataGate: StagingGateResult =
    unclassifiedForMetadata.length > 0
      ? { key: 'METADATA_COMPLETENESS_GATE', verdict: 'FAIL', reason: `${unclassifiedForMetadata.length} certified item(s) have no classifiable category, so metadata could not be evaluated: ${unclassifiedForMetadata.join(', ')}.` }
      : evaluateMetadataCompletenessGate(metadataResults)

  // GEO_ENRICHMENT_GATE — real, cached Google Places enrichment. A cache
  // hit (this exact venue already looked up for this metro, ever) never
  // repeats the paid call — see metroGeoEnrichmentDriver.ts.
  //
  // expectedCountry/metroCenterBias: derived from THIS metro's own
  // resolved M0 decisions (metroCountry/metroCenter), never a hardcoded
  // 'US' default — a Vienna run previously found that default silently
  // misclassifying every real match as a country mismatch. deps.expectedCountry/
  // deps.metroCenterBias remain as an explicit TEST-ONLY override (never
  // exercised in production — m0DecisionsResolved already guarantees
  // state.m0Decisions.metroCountry/metroCenter are set by the time M8 runs).
  const resolvedM0 = state.m0Decisions
  const expectedCountry = deps.expectedCountry ?? resolvedM0?.metroCountry
  const metroCenterBias = deps.metroCenterBias ?? resolvedM0?.metroCenter
  if (!expectedCountry || !metroCenterBias) {
    throw new Error(
      `stepM8BatchCertification: no metroCountry/metroCenter available (state.m0Decisions.metroCountry=${JSON.stringify(resolvedM0?.metroCountry)}, metroCenter=${JSON.stringify(resolvedM0?.metroCenter)}) — m0DecisionsResolved should have made this unreachable in production; only a test that skips M0 entirely (and doesn't inject deps.expectedCountry/deps.metroCenterBias) could hit this.`
    )
  }
  const geoCandidates: GeoEnrichmentCandidate[] = certified.map((r) => {
    const candidate = candidatesByName.get(r.candidateName)
    // mapsQuery is deliberately left keyed on the RAW candidate name
    // (unchanged) — enrichMetroCatalogGeo's cache key is derived from
    // mapsQuery, and a resumed run must never re-pay for a lookup it
    // already made (explicit standing rule). Only the MATCH uses the
    // resolved canonical venue identity (canonicalVenueName.ts), never
    // the raw (often long, compound, parenthetical) M3 discovery label —
    // Vienna, 2026-09-09: matching against the raw label was scoring
    // genuinely-correct matches as AMBIGUOUS/REJECTED purely from
    // parenthetical bloat ("Musikverein (Golden Hall, Brahms Hall, New
    // Halls)" vs. the real Places name) — the same root cause as the
    // venue-quoting and tag bugs. candidateName (the raw name) stays the
    // identity key for the cache/output record/itemCertifications
    // cross-reference.
    const mapsQuery = candidate?.address?.trim() || `${r.candidateName}, ${candidate?.neighborhood ?? run.projectId}`
    return { candidateName: r.candidateName, matchName: r.venueName, neighborhood: candidate?.neighborhood ?? null, body: r.finalBody, mapsQuery, expectedCountry, biasLat: metroCenterBias.lat, biasLng: metroCenterBias.lng }
  })
  const geoRun = await enrichMetroCatalogGeo(run.projectId, geoCandidates, {
    cache: deps.geoEnrichmentCache ?? new FileGeoEnrichmentCacheStore(),
    lookup: deps.placesLookup ?? buildRealPlacesLookup(),
  })
  state.geoEnrichmentPaidCalls = (state.geoEnrichmentPaidCalls ?? 0) + geoRun.paidCallsMade
  state.geoEnrichmentCacheHits = (state.geoEnrichmentCacheHits ?? 0) + geoRun.cacheHits
  state.geoEnrichmentResults = geoRun.records.map((r) => ({ candidateName: r.candidateName, classification: r.classification, reason: r.reason, placeId: r.placeId, formattedAddress: r.formattedAddress, lat: r.lat, lng: r.lng, websiteUrl: r.websiteUrl, geoRadiusM: r.geoRadiusM }))
  const geoGate = evaluateGeoEnrichmentCertificationGate(geoRun.records.map((r): GeoEnrichmentItemResult => ({ candidateName: r.candidateName, classification: r.classification, reason: r.reason })))

  // Chief Phase 3B (item 3) — canonical venue clustering by Google Place
  // ID, reporting-only (see venueDuplicateDetection.ts). Recomputed fresh
  // every M8 pass, never accumulated, so a later-dropped item's cluster
  // membership never lingers stale.
  state.venueDuplicateClusters = clusterByPlaceId(certified.map((r) => ({ candidateName: r.candidateName, placeId: geoRun.records.find((g) => g.candidateName === r.candidateName)?.placeId ?? null, finalBody: r.finalBody })))

  const geoResultsByNameForContamination = new Map(geoRun.records.map((r) => [r.candidateName, r]))

  // OUT_OF_MARKET_CONTAMINATION_GATE — first pass, before catalog
  // certification (Chief Phase 2AH, Green Bay incident, 2026-09-10). See
  // outOfMarketContamination.ts. Evaluated against real geo-enriched
  // formatted addresses (just computed above) plus every candidate's own
  // body text — never repaired, only ever dropped (see M8.5 below).
  const targetMetroSlug = deps.metroAreaSlug ?? run.projectId
  const contaminationResult = evaluateOutOfMarketContaminationGate({
    targetMetro: { slug: targetMetroSlug, state: deps.metroAreaFacts?.state },
    candidates: certified.map((r) => ({ candidateName: r.candidateName, body: r.finalBody, formattedAddress: geoResultsByNameForContamination.get(r.candidateName)?.formattedAddress ?? null })),
  })
  const outOfMarketGate: StagingGateResult = { key: 'OUT_OF_MARKET_CONTAMINATION_GATE', verdict: contaminationResult.verdict, reason: contaminationResult.reason }
  state.outOfMarketGateAtM8 = outOfMarketGate
  const contaminationFailingNames = new Set(contaminationResult.violations.map((v) => v.candidateName))

  // Existing-production-inventory reconciliation (Chief Phase 2AH, Green
  // Bay incident — second systemic gap) — computed ONCE per run and
  // cached in state; a resumed run must never re-query production or
  // re-judge an already-classified candidate. Real region search term is
  // always derived from deps.metroAreaFacts.name (or an explicit
  // override) — never guessed, never a generic/empty term (see
  // existingInventoryReadPath.ts's own guard).
  if (!state.existingInventoryReconciliation) {
    const regionSearchTerm = deps.existingInventorySearchTerm ?? deps.metroAreaFacts?.name?.replace(/\s+metro\s*$/i, '').trim()
    if (regionSearchTerm && regionSearchTerm.length >= 3) {
      const fetchInventory = deps.fetchExistingProductionInventory ?? fetchExistingProductionItemsForRegion
      const existingItems = await fetchInventory(regionSearchTerm)
      state.existingProductionInventorySnapshot = existingItems
      const reconciliationCandidates = certified.map((r) => {
        const geo = geoResultsByNameForContamination.get(r.candidateName)
        return {
          candidateName: r.candidateName,
          body: r.finalBody,
          googlePlaceId: geo?.placeId ?? null,
          formattedAddress: geo?.formattedAddress ?? null,
          websiteUrl: geo?.websiteUrl ?? null,
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
        }
      })
      state.existingInventoryReconciliation = reconcileAgainstExistingInventory(reconciliationCandidates, existingItems)
    } else {
      state.existingInventoryReconciliation = {
        reused: [],
        distinctSameVenue: [],
        unmatched: [],
        skippedReason: 'no metroAreaFacts.name/existingInventorySearchTerm available to derive a real, specific region search term — reconciliation not attempted rather than guessed at.',
      }
    }
  }
  const reuseMatchedNames = new Set((state.existingInventoryReconciliation && !('skippedReason' in state.existingInventoryReconciliation) ? state.existingInventoryReconciliation.reused : []).map((m) => m.candidateName))

  // PLACES_COMPLETENESS_GATE (Chief Phase 2AK, 2026-09-10) — distinct from
  // GEO_ENRICHMENT_GATE's match-QUALITY classification: this asserts every
  // required SQL field is actually populated for every item that resolved
  // to a real venue. Late-added items get zero exemption — this gate is
  // recomputed fresh from the SAME geoRun.records every M8 pass, so an
  // item added after the main build still has to pass it before packaging.
  const mapsQueryByName = new Map(geoCandidates.map((c) => [c.candidateName, c.mapsQuery]))
  const placesCompletenessInputs: PlacesCompletenessItemInput[] = certified.map((r) => {
    const g = geoResultsByNameForContamination.get(r.candidateName)
    return { candidateName: r.candidateName, classification: (g?.classification as PlacesCompletenessItemInput['classification']) ?? 'UNRESOLVED', googlePlaceId: g?.placeId ?? null, formattedAddress: g?.formattedAddress ?? null, mapsQuery: mapsQueryByName.get(r.candidateName) ?? null, lat: g?.lat ?? null, lng: g?.lng ?? null }
  })
  const placesCompletenessResult = evaluatePlacesCompletenessGate(placesCompletenessInputs)
  const placesCompletenessGate: StagingGateResult = { key: placesCompletenessResult.key, verdict: placesCompletenessResult.verdict, reason: placesCompletenessResult.reason }

  // OPENING_VERB_CONCENTRATION_AUDIT (Chief Phase 2AK) — a combined-
  // watchlist check distinct from OPENING_DISTRIBUTION_GATE's single-word
  // threshold; catches a repetition problem spread across several
  // near-synonym generic openers instead of one dominant word.
  const openingVerbResult = evaluateOpeningVerbConcentrationAudit(certified.map((r) => r.finalBody))
  const openingVerbGate: StagingGateResult = { key: openingVerbResult.key, verdict: openingVerbResult.verdict, reason: openingVerbResult.reason }

  // SAME_VENUE_CLUSTER_REVIEW_GATE (Chief Phase 2AK) — always PASS by
  // design (see venueDuplicateDetection.ts), required so cluster findings
  // can never be silently absent from the final certification report.
  const sameVenueClusterResult = evaluateSameVenueClusterReviewGate(state.venueDuplicateClusters ?? [])
  const sameVenueClusterGate: StagingGateResult = { key: sameVenueClusterResult.key, verdict: sameVenueClusterResult.verdict, reason: sameVenueClusterResult.reason }

  // NEIGHBORHOOD_COMPLETENESS_GATE (Chief Phase 2AK) — always PASS by
  // design (an empty canonical neighborhood is an accepted fact, never a
  // blocker); required so it can never be silently absent. Chief Phase
  // 2AL (2026-09-11): NO LONGER defaults to this run's own M1-discovered
  // neighborhoods when the caller omits deps.canonicalNeighborhoods — that
  // silent fallback is exactly the gap this hardening pass closes. Only an
  // explicit, real, frozen canonical model supplied by the caller is
  // accepted; omitting it is now a real FAIL (see neighborhoodCompletenessGate.ts).
  const neighborhoodItemCounts = new Map<string, number>()
  for (const r of certified) {
    const n = candidatesByName.get(r.candidateName)?.neighborhood
    if (n) neighborhoodItemCounts.set(n, (neighborhoodItemCounts.get(n) ?? 0) + 1)
  }
  const canonicalNeighborhoodNames = deps.canonicalNeighborhoods ?? null
  const neighborhoodCompletenessResult = evaluateNeighborhoodCompletenessGate(canonicalNeighborhoodNames, neighborhoodItemCounts)
  const neighborhoodCompletenessGate: StagingGateResult = { key: neighborhoodCompletenessResult.key, verdict: neighborhoodCompletenessResult.verdict, reason: neighborhoodCompletenessResult.reason }
  state.neighborhoodCompletenessReport = { emptyNeighborhoods: neighborhoodCompletenessResult.emptyNeighborhoods, perNeighborhoodCounts: neighborhoodCompletenessResult.perNeighborhoodCounts }

  const gates: StagingGateResult[] = [...distinctivenessGates, itemCertificationGate, tagGate, metadataGate, geoGate, outOfMarketGate, placesCompletenessGate, openingVerbGate, sameVenueClusterGate, neighborhoodCompletenessGate]
  state.batchCertificationGates = gates

  // M8.5 routing (Chief Phase 2AD, 2026-09-09 instruction): a catalog-wide
  // TAG/METADATA/GEO gate FAIL is never sent to Jerry as a bulk review —
  // it is either bounded-repaired or the specific failing item(s) are
  // dropped. Only the item-level failure sets below (never the whole
  // gate) are handed to the pruning stage, and only for items that
  // haven't already had their one pruning attempt (state.catalogPruningAttempted).
  const alreadyPruned = new Set(state.catalogPruningAttempted ?? [])
  const tagFailingNames = tagVocabulary.status === 'FAILED' ? [] : evaluateTagCertificationGate(certified.map((r) => ({ candidateName: r.candidateName, tags: r.finalTags })), tagVocabulary.tagNames).perItem.filter((p) => !p.valid).map((p) => p.candidateName)
  const geoFailingNames = geoRun.records.filter((r) => !CONFIDENT_TIERS.includes(r.classification) && !ACCEPTABLE_EXCEPTION_TIERS.includes(r.classification)).map((r) => r.candidateName)
  const needsPruning = [...new Set([...tagFailingNames, ...unclassifiedForMetadata, ...geoFailingNames, ...contaminationFailingNames, ...reuseMatchedNames])].filter((n) => !alreadyPruned.has(n))

  run.state = state
  run.currentStage = needsPruning.length > 0 ? 'M8_5_CATALOG_PRUNING' : 'M8_75_CATALOG_VOICE_PASS'
  return run
}

// ---------------------------------------------------------------------------
// M8.5 — CATALOG_PRUNING (Chief Phase 2AD). Runs only when M8 found item-
// level TAG/METADATA/GEO failures. Per the 2026-09-09 instruction, these
// are never bulk Jerry-review items: each gets exactly ONE bounded
// repair-or-drop decision, tracked in state.catalogPruningAttempted so a
// resumed run never re-spends a second real call on the same item and
// never re-drops/re-flips a decision already made.
//
//   TAG failures  — one additional real tag-selection call with a WIDER
//                   shortlist (the only dimension with a genuine second
//                   attempt available: the model may simply not have
//                   been offered the right names the first time). Kept
//                   if it now validates; dropped otherwise.
//   GEO failures  — the bounded second pass (geoSecondPassResolver.ts)
//                   already ran automatically inside M8's
//                   enrichMetroCatalogGeo call, on the SAME cached Places
//                   result, for every item — there is no further real
//                   evidence to try without a new paid Places call, which
//                   the instruction explicitly forbids absent necessity.
//                   Dropped directly.
//   METADATA fail — classifyCategoryWithFallback (raw category, THEN
//                   finalBody) already ran inside M8 — that fallback IS
//                   the "existing candidate evidence" pass. No further
//                   source exists. Dropped directly.
//
// After processing, control returns to M8_BATCH_CERTIFICATION so gates
// are recomputed cleanly against the pruned set — this stage never
// recomputes a gate itself, avoiding duplicate gate logic.
// ---------------------------------------------------------------------------

async function stepM8_5CatalogPruning(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const certifications = state.itemCertifications ?? {}
  const certified = Object.values(certifications).filter((r): r is DriverItemCertificationRecord & { finalBody: string } => r.outcome === 'ITEM_CERTIFIED' && r.finalBody !== null)
  if (certified.length === 0) {
    run.currentStage = 'M8_BATCH_CERTIFICATION'
    return run
  }

  const candidatesByName = new Map((state.candidates ?? []).map((c) => [c.name, c]))

  const tagVocabulary = await resolveCanonicalTagVocabulary(
    deps.queryLiveTags ?? (async () => { throw new Error('no live tag query configured for this run') }),
    deps.verifiedTagSnapshot !== undefined ? deps.verifiedTagSnapshot : loadGeneratedTagSnapshot()
  )
  const knownRealTagNames = tagVocabulary.status === 'FAILED' ? null : tagVocabulary.tagNames
  const vocabList = knownRealTagNames ? [...knownRealTagNames] : []

  const alreadyPruned = new Set(state.catalogPruningAttempted ?? [])
  const tagFailingNames = new Set(
    knownRealTagNames ? evaluateTagCertificationGate(certified.map((r) => ({ candidateName: r.candidateName, tags: r.finalTags })), knownRealTagNames).perItem.filter((p) => !p.valid).map((p) => p.candidateName) : []
  )
  const metadataFailingNames = new Set(
    certified
      .filter((r) => !classifyCategoryWithFallback(candidatesByName.get(r.candidateName)?.category ?? null, r.finalBody ?? null).canonical)
      .map((r) => r.candidateName)
  )
  const geoResultsByName = new Map((state.geoEnrichmentResults ?? []).map((r) => [r.candidateName, r]))
  const geoFailingNames = new Set(
    certified
      .filter((r) => {
        const g = geoResultsByName.get(r.candidateName)
        return !g || (!CONFIDENT_TIERS.includes(g.classification as PlacesMatchClassification) && !ACCEPTABLE_EXCEPTION_TIERS.includes(g.classification as PlacesMatchClassification))
      })
      .map((r) => r.candidateName)
  )

  // Chief Phase 2AH (Green Bay incident) — recomputed here (pure, no I/O,
  // cheap) from the same real geoEnrichmentResults/reconciliation state
  // M8 already persisted, rather than duplicating a separate state field.
  // Both are always DROPPED, never repaired here — there is no bounded
  // "second attempt" for either (a wrong-city venue cannot be relocated;
  // a same-venue/same-experience duplicate cannot be made "less
  // duplicate").
  const geoResultsByNameForContamination = new Map((state.geoEnrichmentResults ?? []).map((r) => [r.candidateName, r]))
  const contaminationResult = evaluateOutOfMarketContaminationGate({
    targetMetro: { slug: deps.metroAreaSlug ?? run.projectId, state: deps.metroAreaFacts?.state },
    candidates: certified.map((r) => ({ candidateName: r.candidateName, body: r.finalBody, formattedAddress: geoResultsByNameForContamination.get(r.candidateName)?.formattedAddress ?? null })),
  })
  const contaminationFailingNames = new Set(contaminationResult.violations.map((v) => v.candidateName))
  const reconciliation = state.existingInventoryReconciliation
  const reuseMatches = new Map((reconciliation && !('skippedReason' in reconciliation) ? reconciliation.reused : []).map((m) => [m.candidateName, m]))

  const toProcess = certified.filter(
    (r) => !alreadyPruned.has(r.candidateName) && (tagFailingNames.has(r.candidateName) || metadataFailingNames.has(r.candidateName) || geoFailingNames.has(r.candidateName) || contaminationFailingNames.has(r.candidateName) || reuseMatches.has(r.candidateName))
  )

  if (toProcess.length === 0) {
    run.currentStage = 'M8_BATCH_CERTIFICATION'
    return run
  }

  const batch = toProcess.slice(0, (deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS).maxConcurrentExecutions)
  const itemCertifications = { ...certifications }
  const attempted = new Set(alreadyPruned)
  const drops = [...(state.catalogPruningDrops ?? [])]
  const repairs = [...(state.catalogPruningRepairs ?? [])]

  for (const r of batch) {
    const candidate = candidatesByName.get(r.candidateName)
    let record = itemCertifications[r.candidateName]

    // GEO: droppable whenever the Places check genuinely RAN and still
    // couldn't confidently resolve — either (a) a real result was found
    // and evaluated (placeId present, the "134 ambiguous cases" scenario
    // this stage exists for), or (b) the search genuinely completed and
    // found nothing (a true zero-result response, no apiError — evidence
    // in its own right that this candidate is not a single, real,
    // geocodable venue). The ONE case left untouched is a bare apiError —
    // the check never got to run at all, which is an infra-shaped problem,
    // not "genuinely unresolvable" — never silently drop a real venue
    // over that; it stays ITEM_CERTIFIED and GEO_ENRICHMENT_GATE keeps
    // failing/surfacing it honestly, same as before this stage existed.
    // Still marked attempted either way so the M8<->M8.5 loop terminates.
    const g = geoFailingNames.has(r.candidateName) ? geoResultsByName.get(r.candidateName) : undefined
    const geoGenuinelyEvaluated = g && (g.placeId !== null || !g.reason.startsWith('Places API error'))
    if (contaminationFailingNames.has(r.candidateName)) {
      const violation = contaminationResult.violations.find((v) => v.candidateName === r.candidateName)
      record = { ...record, outcome: 'REJECTED_OUT_OF_MARKET', rejectionReasons: [...record.rejectionReasons, `M8.5: OUT_OF_MARKET_CONTAMINATION_GATE — ${violation?.reason ?? 'out-of-market signal detected'}`] }
      drops.push({ candidateName: r.candidateName, reason: 'REJECTED_OUT_OF_MARKET', detail: violation?.reason ?? 'out-of-market signal detected' })
    } else if (reuseMatches.has(r.candidateName)) {
      const match = reuseMatches.get(r.candidateName)!
      record = {
        ...record,
        outcome: 'REJECTED_DUPLICATE_VENUE',
        rejectionReasons: [...record.rejectionReasons, `M8.5: existing-inventory reconciliation matched an already-live production item (${match.existingItemId}, matched by ${match.matchedBy}, experience similarity ${match.experienceSimilarity.toFixed(2)}) representing the same venue and the same CheckOff experience — reusing the existing item rather than creating a duplicate row.`],
      }
      drops.push({ candidateName: r.candidateName, reason: 'REJECTED_DUPLICATE_VENUE', detail: `reuse existing production item ${match.existingItemId} (matched by ${match.matchedBy})` })
    } else if (g && geoGenuinelyEvaluated) {
      record = { ...record, outcome: 'REJECTED_GEO_UNRESOLVED', rejectionReasons: [...record.rejectionReasons, `M8.5: geo second pass exhausted — ${g.classification}: ${g.reason}`] }
      drops.push({ candidateName: r.candidateName, reason: 'REJECTED_GEO_UNRESOLVED', detail: `classification=${g.classification} (${g.reason})` })
    } else if (metadataFailingNames.has(r.candidateName)) {
      record = { ...record, outcome: 'REJECTED_UNCLASSIFIABLE_METADATA', rejectionReasons: [...record.rejectionReasons, `M8.5: no canonical category from raw label "${candidate?.category ?? ''}" or body text`] }
      drops.push({ candidateName: r.candidateName, reason: 'REJECTED_UNCLASSIFIABLE_METADATA', detail: `raw category="${candidate?.category ?? ''}"` })
    } else if (tagFailingNames.has(r.candidateName) && knownRealTagNames) {
      // ONE additional real tag-selection call, widened shortlist —
      // the genuine second-attempt case.
      const canonical = classifyCategoryWithFallback(candidate?.category ?? null, record.finalBody ?? null).canonical
      const widerShortlist = deriveTagShortlist(vocabList, { category: canonical, body: record.finalBody ?? '', claimSupported: record.supportingFact, neighborhood: candidate?.neighborhood ?? null }, 120)
      const result = await assignTagsForOneItem(deps, run, r.candidateName, record.finalBody ?? '', record.supportingFact, canonical, widerShortlist, knownRealTagNames, 'tag-repair')
      if (result.tags) {
        record = { ...record, finalTags: result.tags }
        repairs.push({ candidateName: r.candidateName, repaired: 'TAGS' })
      } else {
        record = { ...record, outcome: 'REJECTED_INSUFFICIENT_TAG_CONTEXT', rejectionReasons: [...record.rejectionReasons, `M8.5: widened tag shortlist (${widerShortlist.length} names) still insufficient — ${result.rejectionReasons.join('; ')}`] }
        drops.push({ candidateName: r.candidateName, reason: 'REJECTED_INSUFFICIENT_TAG_CONTEXT', detail: result.rejectionReasons.join('; ') })
      }
    } else if (tagFailingNames.has(r.candidateName)) {
      // tagFailingNames matched but no live vocabulary — cannot even
      // attempt repair; drop rather than loop forever.
      record = { ...record, outcome: 'REJECTED_INSUFFICIENT_TAG_CONTEXT', rejectionReasons: [...record.rejectionReasons, 'M8.5: tag vocabulary unavailable, cannot attempt repair'] }
      drops.push({ candidateName: r.candidateName, reason: 'REJECTED_INSUFFICIENT_TAG_CONTEXT', detail: 'tag vocabulary unavailable' })
    }
    // else: this item's only failure was a geo check that never got real
    // Places evidence (no placeId) — left untouched (see comment above);
    // GEO_ENRICHMENT_GATE keeps failing honestly, nothing is dropped.

    itemCertifications[r.candidateName] = record
    attempted.add(r.candidateName)
  }

  state.itemCertifications = itemCertifications
  state.catalogPruningAttempted = [...attempted]
  state.catalogPruningDrops = drops
  state.catalogPruningRepairs = repairs
  run.state = state
  run.currentStage = 'M8_BATCH_CERTIFICATION'
  return run
}

// ---------------------------------------------------------------------------
// M8.75 — CATALOG_VOICE_PASS (Chief Phase 3B, Vienna post-mortem item 6).
// Runs once the retained catalog is stable (after M8.5 pruning has
// nothing left to do). Diagnostic-driven, never blocking: identifies
// items contributing to a repeated opening word/phrase across the batch
// (catalogVoiceDiagnostics.ts) and gives each ONE bounded rewrite
// attempt, same discipline as every other per-item repair stage in this
// driver. A rewrite that fails to validate (drops the quoted venue name,
// or the model declines) simply KEEPS the original body — this stage
// never regresses or blocks a certified item over a voice preference.
// ---------------------------------------------------------------------------

export const MAX_VOICE_REWRITE_ATTEMPTS = 2

async function rewriteOneItemVoice(deps: MetroDriverDeps, run: PlaybookRunRecord, candidateName: string, body: string, venueName: string, dominantOpeningWord: string): Promise<string | null> {
  const safeName = candidateName.replace(/[^a-zA-Z0-9_-]/g, '_')

  for (let attempt = 1; attempt <= MAX_VOICE_REWRITE_ATTEMPTS; attempt++) {
    const label = `voice-${safeName}-attempt${attempt}`
    const request: SpecialistExecutionRequest = {
      specialist: 'checkoff_editor',
      playbookKey: METRO_LAUNCH_DRIVER_PLAYBOOK_KEY,
      stage: 'M8_75_CATALOG_VOICE_PASS',
      objective: `${run.projectId}: vary the opening of ${candidateName} away from the overused "${dominantOpeningWord}" opener`,
      inputs: { mode: 'VOICE_REWRITE', body, venueName, dominantOpeningWord },
      requiredEvidenceKeys: ['body'],
      methodologyId: 'checkoff_editor',
      methodologyVersion: 'v1',
      executionId: executionId(run.runId, 'VOICE', label),
      projectId: run.projectId,
      destinationId: null,
      metroId: run.projectId,
      allowedCapabilities: ['content_editorial'],
      authorityOperations: ['metro_launch.build_internal_artifact'],
      idempotencyKey: executionId(run.runId, 'VOICE', label),
    }
    const outcome = await runStepWithInfraRetry(deps, run, request)
    if (outcome.kind !== 'ACCEPTED') continue
    const newBody = outcome.envelope?.evidence.body
    if (typeof newBody !== 'string' || !newBody.trim()) continue
    // Never accept a rewrite that dropped the quoted venue name, or one
    // that changed length so drastically it likely dropped/invented
    // facts — same "never regress" discipline as every other repair
    // pass. A rewrite that fails these checks is not retried further
    // within this attempt; the outer loop still gets one more try.
    if (!checkVenueQuoted(newBody, venueName).pass) continue
    const lengthRatio = newBody.length / body.length
    if (lengthRatio < 0.5 || lengthRatio > 2) continue
    return newBody
  }
  return null
}

async function stepCatalogVoicePass(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const certifications = state.itemCertifications ?? {}
  const certified = Object.values(certifications).filter((r): r is DriverItemCertificationRecord & { finalBody: string } => r.outcome === 'ITEM_CERTIFIED' && r.finalBody !== null)

  if (certified.length === 0) {
    run.currentStage = 'M9_HOME_LIST_MIRROR'
    return run
  }

  const entries: VoiceCatalogEntry[] = certified.map((r) => ({ candidateName: r.candidateName, body: r.finalBody }))
  const diagnostics = analyzeCatalogVoice(entries)
  const alreadyAttempted = new Set(state.catalogVoicePassAttempted ?? [])
  const toProcess = diagnostics.flaggedCandidateNames.filter((n) => !alreadyAttempted.has(n))

  if (toProcess.length === 0) {
    run.currentStage = 'M9_HOME_LIST_MIRROR'
    return run
  }

  const batch = toProcess.slice(0, (deps.guardrails ?? DEFAULT_DRIVER_GUARDRAILS).maxConcurrentExecutions)
  const itemCertifications = { ...certifications }
  const attempted = new Set(alreadyAttempted)
  const rewrites = [...(state.catalogVoiceRewrites ?? [])]
  const certifiedByName = new Map(certified.map((r) => [r.candidateName, r]))

  for (const candidateName of batch) {
    const record = certifiedByName.get(candidateName)
    attempted.add(candidateName)
    if (!record) continue
    const dominantOpeningWord = diagnostics.dominantOpeningWords.find((w) => record.finalBody.trim().toLowerCase().startsWith(w)) ?? diagnostics.dominantOpeningWords[0] ?? ''
    const newBody = await rewriteOneItemVoice(deps, run, candidateName, record.finalBody, record.venueName, dominantOpeningWord)
    if (newBody && newBody !== record.finalBody) {
      itemCertifications[candidateName] = { ...itemCertifications[candidateName], finalBody: newBody }
      rewrites.push({ candidateName, dominantOpeningWord })
    }
  }

  state.itemCertifications = itemCertifications
  state.catalogVoicePassAttempted = [...attempted]
  state.catalogVoiceRewrites = rewrites
  run.state = state
  // Stays on this stage until every flagged item has had its one
  // attempt (mirrors M8.5's own batching-across-resumes pattern) —
  // never blocks on the diagnostic itself, so a resumed run always
  // makes forward progress even if some rewrites keep their original body.
  //
  // Chief Phase 2AH fix (Green Bay editorial cleanup cycle, 2026-09-10):
  // once every flagged item in this pass has had its one attempt, this
  // used to jump straight to M9 — meaning OPENING_DISTRIBUTION_GATE (and
  // every other M8 gate) stayed frozen at whatever it computed BEFORE any
  // voice-pass rewrite happened, silently reporting a stale, pre-rewrite
  // verdict in the final certification (found via a real Green Bay run:
  // the report said 17/96 "Order" opens, but the actual post-rewrite
  // bodies were 11/96 — comfortably under the 15% threshold — because
  // the gate was never recomputed after 6 successful rewrites). Now loops
  // back through M8_BATCH_CERTIFICATION exactly once so gates are
  // recomputed against the real, current bodies. This can never loop
  // forever: M8 always routes back here when nothing needs pruning, but
  // the SECOND visit's `toProcess` is guaranteed empty (every flagged name
  // is already in catalogVoicePassAttempted), which falls through to the
  // early-exit branch above and proceeds straight to M9.
  run.currentStage = toProcess.length <= batch.length ? 'M8_BATCH_CERTIFICATION' : 'M8_75_CATALOG_VOICE_PASS'
  return run
}

// ---------------------------------------------------------------------------
// M9 — official Home-list mirror. Builds the required launch list package
// (primary seasonal list + themed lists + curated-layer mirrors) as data,
// generates the ONE atomic SQL patch text for Jerry to run (Chief/Winston
// never gets direct public.lists/public.list_items write access — standing
// boundary, unchanged), and certifies against REAL runtime state when
// deps.verifyHomeListRows is wired to an actual read path; otherwise
// honestly reports the gate as pending human application of that patch.
// ---------------------------------------------------------------------------

/**
 * Chief Phase 2AF (2026-09-09 instruction) — a real production category
 * (dbCategory) is NOT the same thing as a visitor-facing themed list.
 * Bucketing straight by dbCategory (Phase 2AE) fixed the "Museum"/
 * "museum" capitalization-split bug but produced category dumps
 * ("Arts & Culture", 81 items), not curated visitor experiences. This
 * build:
 *   - the flagship Home list is a balanced ~30-item selection (never
 *     all certified items) via homeListThemes.ts's selectFlagshipList —
 *     proportional across dbCategory, near-duplicate venues collapsed.
 *   - themed lists are editorially curated, keyword/tag-grounded, and
 *     may cross category lines (homeListThemes.ts's
 *     buildEditorialThemedLists) — only the ones the real, frozen
 *     catalog actually supports (>= minItems) ship; there is no fixed
 *     count, per metro or per run.
 * dbCategory itself is untouched and still persisted on every item
 * (DriverItemCertificationRecord.dbCategory) — this only changes how
 * Home lists are curated FROM that already-correct classification.
 */
const FLAGSHIP_LIST_TARGET_SIZE = 30
const THEMED_LIST_MIN_ITEMS = 8

function buildHomeListPlan(state: MetroDriverState, flagshipListTitle: string): HomeListPlanEntry[] {
  const certified = Object.values(state.itemCertifications ?? {}).filter((r): r is DriverItemCertificationRecord & { finalBody: string } => r.outcome === 'ITEM_CERTIFIED' && r.finalBody !== null)
  const names = certified.map((r) => r.candidateName)
  const themeable: ThemeableItem[] = certified.filter((r) => r.dbCategory).map((r) => ({ candidateName: r.candidateName, venueName: r.venueName, finalBody: r.finalBody, finalTags: r.finalTags, dbCategory: r.dbCategory!, attempts: r.attempts }))

  const flagshipNames = selectFlagshipList(themeable, FLAGSHIP_LIST_TARGET_SIZE)
  // Chief Phase 2AK (2026-09-10, list-title hygiene fix): `title` is the
  // REAL, exact public.lists.title value — never carries the "Themed
  // list:" (or any other internal) prefix. `label` keeps that prefix for
  // human-readable reports/image-readiness cards only. A prior version of
  // this function used `label` (with the prefix) directly as the DB title,
  // which shipped literal "Themed list: X" titles into production.
  const plan: HomeListPlanEntry[] = [{ label: flagshipListTitle, title: flagshipListTitle, kind: 'PRIMARY_SEASONAL', itemCandidateNames: flagshipNames, requiresImage: true }]

  for (const theme of buildEditorialThemedLists(themeable, THEMED_LIST_DEFINITIONS, THEMED_LIST_MIN_ITEMS)) {
    plan.push({ label: `Themed list: ${theme.title}`, title: theme.title, kind: 'THEMED', itemCandidateNames: theme.candidateNames, requiresImage: true })
  }

  plan.push({ label: 'Curated-layer mirror', title: 'Curated-layer mirror', kind: 'CURATED_MIRROR', itemCandidateNames: names, requiresImage: false })
  return plan
}

/** Chief's own known-account default — the SAME real public.users id already used for every existing official list across every launched metro (San Diego, Denver, Tucson, Milwaukee — verified live, 2026-09-09), never a fabricated one. */
export const DEFAULT_OFFICIAL_LIST_CREATOR_ID = '11275026-65be-4421-80a4-46c57195408b'

/**
 * Chief Phase 2AD (2026-09-09), corrected 2026-09-11 (Chief Phase 2AN,
 * the real Florence apply failure) — a single atomic, fail-closed,
 * SELF-CONTAINED SQL package: ensures the metro_areas row (creating it
 * when real metroAreaFacts are supplied — never guessed), creates every
 * canonical neighborhood row, creates a real `public.items` row (with
 * `public.item_tags`) for every NEWLY certified candidate — using ONLY
 * already-certified/already-computed state (the exact certified body,
 * the resolved dbCategory, the METADATA_COMPLETENESS_GATE-evaluated
 * has_alcohol/checkin_type/difficulty/photo_required/is_secret/
 * visit_profile_key, the cached GEO_ENRICHMENT_GATE google_place_id/
 * formatted_address/maps_lat/maps_lng/geo_radius_m/website_url, and the
 * certified 6-8 canonical tags — never re-researched, never re-written),
 * creates/reuses each planned Home list (idempotent — an existing row
 * with the same metro_id+title is reused, never duplicated), and links
 * every item (newly created OR reused from existing production
 * inventory via existingInventoryReconciliation) into its list(s) via
 * public.list_items.
 *
 * The prior version of this function deliberately did NOT create
 * `public.items` rows — its own doc comment claimed "Winston/Chief's
 * metro-launch pipeline never collects checkin_type/difficulty/
 * photo_required/has_alcohol/is_recurring for a certified candidate,"
 * which was WRONG: METADATA_COMPLETENESS_GATE (stepM8BatchCertification)
 * computes every one of those fields for every certified item already —
 * the real bug was that its result (`metadataResults`) was a local
 * variable, discarded the moment the gate's PASS/FAIL verdict was
 * recorded, never persisted to state, so M9 had no metadata to build an
 * INSERT from even though the pipeline had already done the work. Fixed
 * by persisting it (see MetroDriverState.metadataEnrichmentResults) and
 * threading it, plus the already-persisted geoEnrichmentResults and each
 * item's certified finalTags, into `newItems` below. This is exactly the
 * failure Jerry hit applying the real Florence package: `expected exactly
 * 1 public.items row with the certified body ..., found 0` — a
 * brand-new metro's package referenced items it never created and that
 * had no other path to exist. `is_recurring` remains a genuine field this
 * pipeline has never had a determination rule for (a one-time visitable
 * place vs. a recurring/scheduled event is a real editorial fact, not
 * something METADATA_COMPLETENESS_GATE evaluates) — it is set `false`
 * (the schema default, and correct for the overwhelming majority of
 * retained items) and flagged in a SQL comment, never guessed per-item.
 */
export interface NewItemSqlInput {
  candidateName: string
  body: string
  dbCategory: RealDbCategory
  neighborhoodName: string
  mapsQuery: string
  hasAlcohol: boolean
  checkinType: 'tap' | 'photo'
  difficulty: 1 | 5 | 10 | 25
  photoRequired: boolean
  isSecret: boolean
  visitProfileKey: string | null
  /** Certified 6-8 canonical tags (TAG_CERTIFICATION_GATE) — written verbatim, never invented/singularized/pluralized. */
  tags: readonly string[]
  googlePlaceId: string | null
  formattedAddress: string | null
  lat: number | null
  lng: number | null
  geoRadiusM: number | null
  websiteUrl: string | null
}
/** Real, per-item facts buildHomeListSqlPatch needs to generate neighborhood-creation SQL — never a raw discovery-stage label; the caller is responsible for having already resolved this to one of the canonical names. */
export interface NeighborhoodSqlAssignment {
  neighborhoodName: string
  lat: number | null
  lng: number | null
}

export interface NeighborhoodSqlPlan {
  /** The metro's explicit, approved, frozen canonical neighborhood list — same list NEIGHBORHOOD_COMPLETENESS_GATE was evaluated against (Chief Phase 2AL). */
  canonicalNeighborhoods: readonly string[]
  /** Every certified item's resolved canonical neighborhood + real geocoded coordinates (when available) — used to derive each neighborhood's centroid purely from its own real items. */
  itemAssignments: ReadonlyMap<string, NeighborhoodSqlAssignment>
  /** Real, documented locality centroids (a village/district's own public center coordinate — never a fabricated business location) for a canonical neighborhood that currently has zero retained items. Omitting an entry here for a zero-item neighborhood is not an error by itself — see neighborhoodsMissingCentroid on the return value. */
  emptyNeighborhoodFallbackCentroids?: Readonly<Record<string, { lat: number; lng: number }>>
}

const NEIGHBORHOOD_RING_0_RADIUS_M = 12875
const NEIGHBORHOOD_RING_1_RADIUS_M = 32187
const NEIGHBORHOOD_RING_2_RADIUS_M = 64374

function slugifyNeighborhoodName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildHomeListSqlPatch(
  metroSlug: string,
  plan: readonly HomeListPlanEntry[],
  itemBodyByCandidateName: ReadonlyMap<string, string>,
  metroCenter: { lat: number; lng: number } | undefined,
  metroAreaFacts: { name: string; state: string; timezone: string } | undefined,
  officialListCreatorId: string,
  /** Chief Phase 2AH (Green Bay incident) — real ids of already-live production items existing-inventory reconciliation classified REUSE (same venue + same experience as a candidate this run discovered independently). Linked directly by id into the flagship list — never re-created, never matched by body text, since the row already exists. */
  reusedExistingItemIds: readonly string[] = [],
  /** Chief Phase 2AL (2026-09-11) — when supplied, this package also creates every approved canonical public.neighborhoods row itself (generic, no per-metro one-off script required). Omit only when neighborhoods are known to already exist in production for this metro. */
  neighborhoodPlan?: NeighborhoodSqlPlan,
  /** Chief Phase 2AN (2026-09-11) — every NEWLY certified candidate (never a reused-from-production item — those are excluded from the certified catalog entirely by M8.5's reuseMatchedNames pruning, before this function ever sees them) gets its own real public.items + public.item_tags rows created HERE, from already-certified/already-computed state only. See this function's own doc for why the package used to NOT do this, and why that was the real Florence apply bug. */
  newItems: readonly NewItemSqlInput[] = []
): { sql: string; neighborhoodsMissingCentroid: string[] } {
  const lines: string[] = []
  lines.push(`-- Generated by Winston metro_launch driver (M9_HOME_LIST_MIRROR) for metro "${metroSlug}".`)
  lines.push('-- One atomic, self-certifying transaction — no cross-statement TEMP-table dependence, no MIN(uuid).')
  lines.push('-- Self-contained: creates the metro row, canonical neighborhoods, every newly certified')
  lines.push('-- public.items row (+ item_tags) from already-certified/already-cached state, Home lists,')
  lines.push('-- and public.list_items — safe to apply to an EMPTY production inventory for this metro.')
  lines.push('-- Reused existing-production items (existingInventoryReconciliation) are linked by their')
  lines.push('-- real existing id, additively, never recreated.')
  lines.push('BEGIN;')
  lines.push('DO $$')
  lines.push('DECLARE')
  lines.push('  v_metro_id uuid;')
  lines.push('  v_list_id uuid;')
  lines.push('  v_item_id uuid;')
  lines.push('  v_neighborhood_id uuid;')
  lines.push('  v_category_id uuid;')
  lines.push('  v_match_count int;')
  lines.push('BEGIN')
  if (metroAreaFacts) {
    lines.push('  -- Ensure metro_areas exists (create it if this is the first launch for this metro).')
    lines.push(`  IF NOT EXISTS (SELECT 1 FROM public.metro_areas WHERE slug = ${sqlQuote(metroSlug)}) THEN`)
    lines.push(`    INSERT INTO public.metro_areas (name, slug, state, timezone, is_active${metroCenter ? ', center_lat, center_lng' : ''})`)
    lines.push(
      `    VALUES (${sqlQuote(metroAreaFacts.name)}, ${sqlQuote(metroSlug)}, ${sqlQuote(metroAreaFacts.state)}, ${sqlQuote(metroAreaFacts.timezone)}, true${metroCenter ? `, ${metroCenter.lat}, ${metroCenter.lng}` : ''});`
    )
    lines.push('  END IF;')
  } else {
    lines.push(`  SELECT count(*) INTO v_match_count FROM public.metro_areas WHERE slug = ${sqlQuote(metroSlug)};`)
    lines.push(
      `  IF v_match_count <> 1 THEN RAISE EXCEPTION 'expected exactly 1 metro_areas row for slug %, found % — no known metroAreaFacts were supplied for this build, so Chief could not create it automatically', ${sqlQuote(metroSlug)}, v_match_count; END IF;`
    )
  }
  lines.push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = ${sqlQuote(metroSlug)};`)
  lines.push(`  IF v_metro_id IS NULL THEN RAISE EXCEPTION 'metro_areas row for slug % could not be found or created', ${sqlQuote(metroSlug)}; END IF;`)
  lines.push('')

  // Chief Phase 2AL (2026-09-11) — generic canonical-neighborhood creation,
  // moved out of the one-off Green Bay script into the reusable driver
  // itself. Every approved canonical neighborhood gets a real row: a
  // centroid derived purely from THIS metro's own real, geocoded item
  // coordinates when it has any retained items, or the caller's
  // documented real-locality fallback centroid when it has none (never a
  // fabricated business location — see NeighborhoodSqlPlan's doc). A
  // canonical neighborhood with neither real items nor a supplied
  // fallback is a genuine fail-closed condition: its row is NOT created,
  // and its name is returned in neighborhoodsMissingCentroid for the
  // caller (stepM9HomeListMirror) to treat as a real blocker — never
  // silently skipped, never given an invented coordinate.
  const neighborhoodsMissingCentroid: string[] = []
  if (neighborhoodPlan) {
    const byNeighborhood = new Map<string, { lats: number[]; lngs: number[] }>()
    for (const assignment of neighborhoodPlan.itemAssignments.values()) {
      if (!byNeighborhood.has(assignment.neighborhoodName)) byNeighborhood.set(assignment.neighborhoodName, { lats: [], lngs: [] })
      const agg = byNeighborhood.get(assignment.neighborhoodName)!
      if (typeof assignment.lat === 'number' && typeof assignment.lng === 'number') {
        agg.lats.push(assignment.lat)
        agg.lngs.push(assignment.lng)
      }
    }
    lines.push('  -- Canonical neighborhoods (all approved, including any with zero retained items).')
    for (const name of neighborhoodPlan.canonicalNeighborhoods) {
      const agg = byNeighborhood.get(name)
      const hasRealItems = !!agg && agg.lats.length > 0
      const fallback = neighborhoodPlan.emptyNeighborhoodFallbackCentroids?.[name]
      if (!hasRealItems && !fallback) {
        neighborhoodsMissingCentroid.push(name)
        lines.push(`  -- SKIPPED (fail-closed): "${name}" has zero retained items and no documented fallback centroid was supplied — see neighborhoodsMissingCentroid.`)
        continue
      }
      const lat = hasRealItems ? agg!.lats.reduce((a, b) => a + b, 0) / agg!.lats.length : fallback!.lat
      const lng = hasRealItems ? agg!.lngs.reduce((a, b) => a + b, 0) / agg!.lngs.length : fallback!.lng
      const slug = slugifyNeighborhoodName(name)
      if (!hasRealItems) lines.push(`  -- "${name}": 0 items today — using the documented real-locality fallback centroid, not item-derived.`)
      lines.push(`  IF NOT EXISTS (SELECT 1 FROM public.neighborhoods WHERE metro_id = v_metro_id AND name = ${sqlQuote(name)}) THEN`)
      lines.push(
        `    INSERT INTO public.neighborhoods (metro_id, name, slug, state, center_geo, ring_0_radius_m, ring_1_radius_m, ring_2_radius_m, is_active) VALUES (v_metro_id, ${sqlQuote(name)}, ${sqlQuote(slug)}, ${metroAreaFacts ? sqlQuote(metroAreaFacts.state) : 'NULL'}, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${NEIGHBORHOOD_RING_0_RADIUS_M}, ${NEIGHBORHOOD_RING_1_RADIUS_M}, ${NEIGHBORHOOD_RING_2_RADIUS_M}, true);`
      )
      lines.push('  END IF;')
    }
    lines.push('')
  }

  // Chief Phase 2AN (2026-09-11) — new public.items + public.item_tags rows,
  // one per newly certified candidate, using ONLY the certified/cached state
  // already computed by M6.5-M8 (body, dbCategory, neighborhood, the real
  // METADATA_COMPLETENESS_GATE-evaluated fields, the real cached Google
  // Places geo fields, the certified 6-8 canonical tags) — never a fresh
  // research/editorial call. A pre-existing row with the exact same body is
  // a genuine "this package was already (partially) applied, or the
  // catalog drifted" condition — fails closed rather than silently
  // creating a duplicate or silently reusing an unrelated row.
  if (newItems.length > 0) {
    lines.push(`  -- New public.items rows (${newItems.length}) — this metro's own certified catalog, never re-researched.`)
    lines.push('  -- is_recurring: no determination rule exists anywhere in this pipeline for "one-time visitable place" vs.')
    lines.push('  -- "recurring/scheduled event" — set false (schema default, correct for the overwhelming majority of items),')
    lines.push('  -- flagged here rather than guessed per-item. A genuinely recurring item needs a real, separate human review.')
    for (const item of newItems) {
      lines.push(`  IF EXISTS (SELECT 1 FROM public.items WHERE body = ${sqlQuote(item.body)}) THEN`)
      lines.push(
        `    RAISE EXCEPTION 'a public.items row with the certified body for "%" already exists — this package must only be applied once, to an inventory that does not already contain it (re-run reconciliation if this catalog has drifted)', ${sqlQuote(item.candidateName)};`
      )
      lines.push('  END IF;')
      lines.push(`  SELECT id INTO v_category_id FROM public.categories WHERE name = ${sqlQuote(item.dbCategory)};`)
      lines.push(`  IF v_category_id IS NULL THEN RAISE EXCEPTION 'category not found for "%": %', ${sqlQuote(item.candidateName)}, ${sqlQuote(item.dbCategory)}; END IF;`)
      lines.push(`  SELECT id INTO v_neighborhood_id FROM public.neighborhoods WHERE metro_id = v_metro_id AND name = ${sqlQuote(item.neighborhoodName)};`)
      lines.push(`  IF v_neighborhood_id IS NULL THEN RAISE EXCEPTION 'neighborhood not found for "%": %', ${sqlQuote(item.candidateName)}, ${sqlQuote(item.neighborhoodName)}; END IF;`)
      if (item.visitProfileKey !== null) {
        lines.push(`  IF NOT EXISTS (SELECT 1 FROM public.visit_detection_profiles WHERE key = ${sqlQuote(item.visitProfileKey)}) THEN`)
        lines.push(`    RAISE EXCEPTION 'visit_profile_key "%" for "%" does not exist in visit_detection_profiles', ${sqlQuote(item.visitProfileKey)}, ${sqlQuote(item.candidateName)};`)
        lines.push('  END IF;')
      }
      const hasGeo = typeof item.lat === 'number' && typeof item.lng === 'number'
      lines.push('  INSERT INTO public.items (')
      lines.push('    body, category_id, neighborhood_id, checkin_type, maps_query,')
      lines.push('    is_universal, is_active, is_approved, is_recurring, difficulty,')
      lines.push('    photo_required, has_alcohol, is_secret, visit_profile_key,')
      lines.push('    google_place_id, formatted_address, maps_lat, maps_lng, geo_location, geo_radius_m, website_url')
      lines.push('  ) VALUES (')
      lines.push(`    ${sqlQuote(item.body)}, v_category_id, v_neighborhood_id, ${sqlQuote(item.checkinType)}, ${sqlQuote(item.mapsQuery)},`)
      lines.push(`    false, true, true, false, ${item.difficulty},`)
      lines.push(`    ${item.photoRequired}, ${item.hasAlcohol}, ${item.isSecret}, ${item.visitProfileKey === null ? 'NULL' : sqlQuote(item.visitProfileKey)},`)
      lines.push(
        `    ${item.googlePlaceId === null ? 'NULL' : sqlQuote(item.googlePlaceId)}, ${item.formattedAddress === null ? 'NULL' : sqlQuote(item.formattedAddress)}, ${item.lat ?? 'NULL'}, ${item.lng ?? 'NULL'}, ${hasGeo ? `ST_SetSRID(ST_MakePoint(${item.lng}, ${item.lat}), 4326)` : 'NULL'}, ${item.geoRadiusM ?? 'NULL'}, ${item.websiteUrl === null ? 'NULL' : sqlQuote(item.websiteUrl)}`
      )
      lines.push('  )')
      lines.push('  RETURNING id INTO v_item_id;')
      lines.push('')
      lines.push('  INSERT INTO public.item_tags (item_id, tag_id, source, confidence)')
      lines.push('  SELECT v_item_id, t.id, \'auto\', 1.0')
      lines.push('  FROM public.tags t')
      lines.push(`  WHERE t.name IN (${item.tags.map((t) => sqlQuote(t)).join(', ')});`)
      lines.push(`  SELECT count(*) INTO v_match_count FROM public.item_tags WHERE item_id = v_item_id;`)
      lines.push(
        `  IF v_match_count <> ${item.tags.length} THEN RAISE EXCEPTION 'expected % certified tag(s) for "%", found % — one or more tag names do not exist in production', ${item.tags.length}, ${sqlQuote(item.candidateName)}, v_match_count; END IF;`
      )
      lines.push('')
    }
  }

  const primaryEntry = plan.find((p) => p.kind === 'PRIMARY_SEASONAL')
  if (reusedExistingItemIds.length > 0 && primaryEntry) {
    lines.push(`  -- Existing-inventory reconciliation: ${reusedExistingItemIds.length} already-live production item(s) reused (same venue + same experience) rather than duplicated.`)
    lines.push(`  SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title = ${sqlQuote(primaryEntry.title)} AND is_official = true;`)
    lines.push('  IF v_list_id IS NULL THEN')
    lines.push(`    INSERT INTO public.lists (metro_id, title, is_official, is_public, creator_id, is_featured_eligible)`)
    lines.push(`    VALUES (v_metro_id, ${sqlQuote(primaryEntry.title)}, true, true, ${sqlQuote(officialListCreatorId)}, true)`)
    lines.push('    RETURNING id INTO v_list_id;')
    lines.push('  END IF;')
    for (const existingId of reusedExistingItemIds) {
      lines.push(`  SELECT count(*) INTO v_match_count FROM public.items WHERE id = ${sqlQuote(existingId)};`)
      lines.push(`  IF v_match_count <> 1 THEN RAISE EXCEPTION 'reused existing production item id % no longer exists — reconciliation ran against stale data, re-run before applying this patch', ${sqlQuote(existingId)}; END IF;`)
      lines.push(`  INSERT INTO public.list_items (list_id, item_id) VALUES (v_list_id, ${sqlQuote(existingId)}) ON CONFLICT (list_id, item_id) DO NOTHING;`)
    }
    lines.push('')
  }

  for (const entry of plan) {
    if (entry.kind === 'CURATED_MIRROR') continue // curated_lists layer is a separate, existing patch pattern (see itemIntake.ts) — not duplicated here
    lines.push(`  -- ${entry.label} (${entry.itemCandidateNames.length} item(s))`)
    lines.push(`  SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title = ${sqlQuote(entry.title)} AND is_official = true;`)
    lines.push('  IF v_list_id IS NULL THEN')
    lines.push(`    INSERT INTO public.lists (metro_id, title, is_official, is_public, creator_id${entry.kind === 'PRIMARY_SEASONAL' ? ', is_featured_eligible' : ''})`)
    lines.push(
      `    VALUES (v_metro_id, ${sqlQuote(entry.title)}, true, true, ${sqlQuote(officialListCreatorId)}${entry.kind === 'PRIMARY_SEASONAL' ? ', true' : ''})`
    )
    lines.push('    RETURNING id INTO v_list_id;')
    lines.push('  END IF;')
    lines.push('')
    for (const name of entry.itemCandidateNames) {
      const body = itemBodyByCandidateName.get(name)
      if (body === undefined) continue // structurally unreachable — the plan is built only from certified items, which always have a finalBody
      lines.push(`  SELECT count(*) INTO v_match_count FROM public.items WHERE body = ${sqlQuote(body)};`)
      lines.push(
        `  IF v_match_count <> 1 THEN RAISE EXCEPTION 'expected exactly 1 public.items row with the certified body for "%", found % — has this item been created yet via Item Intake?', ${sqlQuote(name)}, v_match_count; END IF;`
      )
      lines.push(`  SELECT id INTO v_item_id FROM public.items WHERE body = ${sqlQuote(body)};`)
      lines.push(`  INSERT INTO public.list_items (list_id, item_id) VALUES (v_list_id, v_item_id) ON CONFLICT (list_id, item_id) DO NOTHING;`)
    }
    lines.push('')
  }

  const nonMirrorCount = plan.filter((p) => p.kind !== 'CURATED_MIRROR').length
  lines.push('  -- Postflight assertions')
  lines.push(`  SELECT count(*) INTO v_match_count FROM public.lists WHERE metro_id = v_metro_id AND is_official = true;`)
  lines.push(
    `  IF v_match_count < ${nonMirrorCount} THEN RAISE EXCEPTION 'postflight: expected at least % official list(s) for metro %, found %', ${nonMirrorCount}, ${sqlQuote(metroSlug)}, v_match_count; END IF;`
  )
  if (neighborhoodPlan) {
    const expectedNeighborhoodCount = neighborhoodPlan.canonicalNeighborhoods.length - neighborhoodsMissingCentroid.length
    lines.push(`  SELECT count(*) INTO v_match_count FROM public.neighborhoods WHERE metro_id = v_metro_id;`)
    lines.push(
      `  IF v_match_count < ${expectedNeighborhoodCount} THEN RAISE EXCEPTION 'postflight: expected at least % canonical neighborhood(s) for metro %, found %', ${expectedNeighborhoodCount}, ${sqlQuote(metroSlug)}, v_match_count; END IF;`
    )
  }
  lines.push('END $$;')
  lines.push('COMMIT;')
  return { sql: lines.join('\n'), neighborhoodsMissingCentroid }
}

function sqlQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

async function stepM9HomeListMirror(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const certifiedForRecheck = Object.values(state.itemCertifications ?? {}).filter((r): r is DriverItemCertificationRecord & { finalBody: string } => r.outcome === 'ITEM_CERTIFIED' && r.finalBody !== null)

  // OUT_OF_MARKET_CONTAMINATION_GATE — SECOND, independent pass,
  // immediately before SQL generation (Chief Phase 2AH — Jerry's
  // explicit instruction: evaluate "again before production SQL
  // generation," never trust the M8 pass alone to have been the only
  // gate standing between research and a real SQL patch). By this point
  // M8.5 should already have dropped every contaminated candidate, so
  // this should always PASS in the normal case — its purpose is to
  // FAIL CLOSED (refuse to generate any SQL at all) if some future code
  // path ever reaches M9 with contamination still present, rather than
  // relying solely on the earlier pass.
  const geoResultsByNameForRecheck = new Map((state.geoEnrichmentResults ?? []).map((r) => [r.candidateName, r]))
  const secondContaminationCheck = evaluateOutOfMarketContaminationGate({
    targetMetro: { slug: deps.metroAreaSlug ?? run.projectId, state: deps.metroAreaFacts?.state },
    candidates: certifiedForRecheck.map((r) => ({ candidateName: r.candidateName, body: r.finalBody, formattedAddress: geoResultsByNameForRecheck.get(r.candidateName)?.formattedAddress ?? null })),
  })
  if (secondContaminationCheck.verdict === 'FAIL') {
    return block(
      run,
      `OUT_OF_MARKET_CONTAMINATION_GATE failed its second pass, immediately before production SQL generation — refusing to generate any SQL patch. This must never happen if M8.5 pruning ran correctly; treat this as a real driver bug, not a data issue, and fix the code path that reached M9 without dropping these candidates first. ${secondContaminationCheck.reason}`
    )
  }

  // Chief Phase 2AL (2026-09-11) — SQL packaging refuses to proceed
  // without an explicit, frozen canonical neighborhood model, exactly
  // like NEIGHBORHOOD_COMPLETENESS_GATE already refuses at M8. This is
  // the SECOND, independent enforcement point (same discipline as the
  // contamination re-check above): by the time SQL packaging begins, the
  // canonical model must be explicit — never silently backfilled from
  // whatever M1 happened to discover.
  if (!deps.canonicalNeighborhoods) {
    return block(
      run,
      'No explicit, frozen canonical neighborhood model was supplied (deps.canonicalNeighborhoods) — refusing to generate production SQL without one. Supply the real, approved neighborhood list before this metro can be packaged.'
    )
  }

  const plan = buildHomeListPlan(state, deps.flagshipListTitle ?? 'Primary seasonal list')
  state.homeListPlan = plan
  const itemBodyByCandidateName = new Map(
    certifiedForRecheck.map((r) => [r.candidateName, r.finalBody])
  )
  const reconciliation = state.existingInventoryReconciliation
  const reusedExistingItemIds = (reconciliation && !('skippedReason' in reconciliation) ? reconciliation.reused : []).map((m) => m.existingItemId)
  const metroSlug = deps.metroAreaSlug ?? run.projectId

  // Generic canonical-neighborhood SQL (Chief Phase 2AL) — every certified
  // item's already-resolved neighborhood + real geocoded coordinates,
  // keyed for buildHomeListSqlPatch to derive real per-neighborhood
  // centroids (or use a caller-supplied real-locality fallback for a
  // zero-item canonical neighborhood).
  const geoResultsByNameForNeighborhoods = new Map((state.geoEnrichmentResults ?? []).map((r) => [r.candidateName, r]))
  const candidatesByNameForNeighborhoods = new Map((state.candidates ?? []).map((c) => [c.name, c]))
  const itemAssignments = new Map<string, NeighborhoodSqlAssignment>()
  for (const r of certifiedForRecheck) {
    const neighborhoodName = candidatesByNameForNeighborhoods.get(r.candidateName)?.neighborhood
    if (!neighborhoodName) continue
    const geo = geoResultsByNameForNeighborhoods.get(r.candidateName)
    itemAssignments.set(r.candidateName, { neighborhoodName, lat: geo?.lat ?? null, lng: geo?.lng ?? null })
  }
  const neighborhoodPlan: NeighborhoodSqlPlan = {
    canonicalNeighborhoods: deps.canonicalNeighborhoods,
    itemAssignments,
    emptyNeighborhoodFallbackCentroids: deps.emptyNeighborhoodFallbackCentroids,
  }

  // Chief Phase 2AN (2026-09-11) — the real, self-contained item-creation
  // package: every certified item at this point is guaranteed NEW (a
  // reused-from-production match is pruned out of the certified catalog
  // entirely by M8.5's reuseMatchedNames, long before M9 ever runs) — so
  // every one of certifiedForRecheck needs its own public.items row built
  // from already-certified/already-cached state only, never re-researched.
  const metadataByName = new Map((state.metadataEnrichmentResults ?? []).map((m) => [m.candidateName, m]))
  const missingMetadataFor: string[] = []
  const newItems: NewItemSqlInput[] = []
  for (const r of certifiedForRecheck) {
    const candidate = candidatesByNameForNeighborhoods.get(r.candidateName)
    const neighborhoodName = candidate?.neighborhood
    const metadata = metadataByName.get(r.candidateName)
    if (!r.dbCategory || !neighborhoodName || !metadata) {
      missingMetadataFor.push(r.candidateName)
      continue
    }
    const geo = geoResultsByNameForNeighborhoods.get(r.candidateName)
    const mapsQuery = geo?.formattedAddress?.trim() || candidate?.address?.trim() || `${r.candidateName}, ${neighborhoodName}`
    newItems.push({
      candidateName: r.candidateName,
      body: r.finalBody,
      dbCategory: r.dbCategory,
      neighborhoodName,
      mapsQuery,
      hasAlcohol: metadata.hasAlcohol.value,
      checkinType: metadata.checkinType.value,
      difficulty: metadata.difficulty.value,
      photoRequired: metadata.photoRequired.value,
      isSecret: metadata.isSecret.value,
      visitProfileKey: metadata.visitProfileKey.value,
      tags: r.finalTags,
      googlePlaceId: geo?.placeId ?? null,
      formattedAddress: geo?.formattedAddress ?? null,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      geoRadiusM: geo?.geoRadiusM ?? null,
      websiteUrl: geo?.websiteUrl ?? null,
    })
  }
  // Fail-closed, never a silent partial package: if a certified item is
  // somehow missing the metadata/category/neighborhood M8 should always
  // have already resolved for it, the whole package refuses rather than
  // shipping some items with no way to create them.
  if (missingMetadataFor.length > 0) {
    return block(
      run,
      `Cannot build a self-contained item-creation package: ${missingMetadataFor.length} certified item(s) are missing dbCategory/neighborhood/metadata that M8 should already have resolved — this is a real driver bug, not a data issue: ${missingMetadataFor.join(', ')}.`
    )
  }

  const { sql: homeListSql, neighborhoodsMissingCentroid } = buildHomeListSqlPatch(
    metroSlug,
    plan,
    itemBodyByCandidateName,
    state.m0Decisions?.metroCenter,
    deps.metroAreaFacts,
    deps.officialListCreatorId ?? DEFAULT_OFFICIAL_LIST_CREATOR_ID,
    reusedExistingItemIds,
    neighborhoodPlan,
    newItems
  )
  // Fail-closed (Chief Phase 2AL): a canonical neighborhood with zero real
  // items AND no documented real-locality fallback centroid is a genuine
  // human-decision blocker, never silently skipped or given an invented
  // coordinate — refuse the whole package rather than ship an incomplete
  // neighborhood model.
  if (neighborhoodsMissingCentroid.length > 0) {
    return block(
      run,
      `${neighborhoodsMissingCentroid.length} canonical neighborhood(s) have zero retained items AND no documented real-locality fallback centroid was supplied (deps.emptyNeighborhoodFallbackCentroids): ${neighborhoodsMissingCentroid.join(', ')}. Supply a real, documented locality centroid for each, or accept the metro without them — never fabricate one.`
    )
  }
  state.homeListSqlPatch = homeListSql

  // Real read path by default (readRealHomeListRows — an actual
  // public.lists/public.list_items query) — tests/production callers may
  // still inject their own verifyHomeListRows to override it.
  const verify = deps.verifyHomeListRows ?? ((p) => readRealHomeListRows(metroSlug, p))
  const readResult = await verify(plan)

  let homeListGate: StagingGateResult
  const curatedLayerGate: StagingGateResult = evaluateCuratedListLayerGate([]).gate // curated_lists layer not required for this metro unless separately requested
  if (!Array.isArray(readResult)) {
    homeListGate = {
      key: 'HOME_LIST_CERTIFICATION_GATE',
      verdict: 'FAIL',
      reason: `SQL patch generated (${plan.length} list(s): ${plan.map((p) => p.label).join(', ')}) but could not be verified against real runtime state: ${readResult.reason}`,
    }
  } else {
    const result = evaluateHomeListCertificationGate(readResult)
    homeListGate = result.gate
  }

  const existingGates = state.batchCertificationGates ?? []
  state.batchCertificationGates = [...existingGates, homeListGate, curatedLayerGate]
  run.state = state
  run.currentStage = 'M10_METRO_LAUNCH_CERTIFICATION'
  return run
}

// ---------------------------------------------------------------------------
// M10 — final aggregation. Image readiness is evaluated HERE, alongside
// every other gate, never used to stop the pipeline earlier — see
// imageReadiness.ts.
// ---------------------------------------------------------------------------

async function stepM10FinalCertification(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const plan = state.homeListPlan ?? []
  const existingGates = state.batchCertificationGates ?? []

  const imageCards: ImageReadinessCard[] = deps.checkImageReadiness
    ? await deps.checkImageReadiness(plan)
    : plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: false }))
  const { gate: imageGate } = evaluateImageReadinessGate(imageCards)

  // BUSINESS_ACTIVATION_KIT_GATE — verification-only, never asset
  // generation. The reference/text checks are deterministic (no network
  // call); the ONE bounded live-URL check is real by default but never
  // retried in a loop by this stage — a transient failure just fails
  // this evaluation, exactly like any other gate result.
  const outreachCopy = deps.outreachCopy ?? `Free Business Activation Kit: ${UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL}`
  const liveCheck = await (deps.checkActivationKitLive ?? checkActivationKitUrlLive)(UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL)
  const activationKitGate = evaluateActivationKitGate({ kitUrlLive: liveCheck.live, assetsAccessible: liveCheck.live, outreachCopy })
  state.activationKitCheckDetail = liveCheck.reason

  const certified = Object.values(state.itemCertifications ?? {}).filter((r): r is DriverItemCertificationRecord & { finalBody: string } => r.outcome === 'ITEM_CERTIFIED' && r.finalBody !== null)
  const rejected = Object.values(state.itemCertifications ?? {}).filter((r) => r.outcome !== 'ITEM_CERTIFIED')

  // CATALOG_GATE / LOCATION_GATE / PRESENTATION_GATE / EDITORIAL_GATE —
  // the metroCatalog.ts (Item Intake) staging gates, built from the same
  // certified items rather than a separate Item Intake pass, since this
  // driver's own M6/M7 already produced everything those gates need
  // (candidateName, body, category, a real specific location string).
  const candidatesByNameForIntake = new Map((state.candidates ?? []).map((c) => [c.name, c]))
  const unclassifiedForIntake: string[] = []
  const intakeRecords: ItemIntakeRecord[] = certified
    .map((r) => {
      const candidate = candidatesByNameForIntake.get(r.candidateName)
      // Prefer the SAME dbCategory stepM8BatchCertification already
      // resolved and persisted (single source of truth — see
      // DriverItemCertificationRecord.dbCategory); only a certified item
      // that somehow never went through that pass (structurally
      // unreachable in the real driver flow) falls back to recomputing.
      const dbCategory = r.dbCategory ?? (() => {
        const canonical = classifyCategoryWithFallback(candidate?.category ?? null, r.finalBody ?? null).canonical
        return canonical ? CANONICAL_TO_DB_CATEGORY[canonical] : null
      })()
      if (!dbCategory) {
        unclassifiedForIntake.push(r.candidateName)
        return null
      }
      const mapsQuery = candidate?.address?.trim() || `${r.candidateName}, ${candidate?.neighborhood ?? run.projectId}`
      return {
        candidateName: r.candidateName,
        body: r.finalBody,
        dbCategory,
        mapsQuery,
        neighborhoodName: candidate?.neighborhood ?? null,
        dedupKey: r.candidateName.toLowerCase(),
        provenance: { claimSupported: r.supportingFact, sourceUrls: candidate?.source ? [candidate.source] : [] },
      } satisfies ItemIntakeRecord
    })
    .filter((r): r is ItemIntakeRecord => r !== null)
  // Tracked, not silent — mirrors the same METADATA_COMPLETENESS_GATE
  // unclassifiedForMetadata list above so a category-unclassifiable
  // certified item is never dropped from the catalog without a reason
  // that shows up in both gates identically.
  state.unclassifiedForIntake = unclassifiedForIntake

  // Chief Phase 2AH (Green Bay incident) — checkForDuplicates() was
  // previously always called with a hardcoded, always-empty
  // collidesWithProduction: [], meaning CATALOG_GATE's real production-
  // dedup check was fully implemented and tested but never actually
  // exercised against production data by this driver. Fixed: real
  // existing-production maps_query values, from the SAME single
  // reconciliation fetch M8 already made (never re-queried here), are
  // now threaded through. Note this checks a DIFFERENT, cruder key
  // (normalized maps_query string) than existingInventoryReconciliation's
  // own richer google_place_id/canonical-name/geo/website matching —
  // genuine defense-in-depth, not a duplicate of that logic; items
  // reconciliation already classified REUSE are dropped by M8.5 before
  // reaching this stage at all, so this mainly catches anything that
  // slipped past reconciliation (e.g. no real region search term was
  // available for this run) via the older, coarser mechanism.
  const existingProductionMapsQueries = (state.existingProductionInventorySnapshot ?? []).map((i) => i.mapsQuery).filter((q): q is string => !!q && q.trim().length > 0)
  const duplicates = checkForDuplicates(intakeRecords, existingProductionMapsQueries)
  const catalogGate = evaluateCatalogGate({ expectedCanonicalCount: intakeRecords.length, stagedRecords: intakeRecords, intakeFailures: [], duplicates })
  const locationGate = evaluateLocationGate({ records: intakeRecords })
  const presentationGate = evaluatePresentationGate({ records: intakeRecords })
  const editorialGate = evaluateEditorialQualityGate({ records: intakeRecords })

  // geoCoveragePercent/geoExceptionsCount were previously hardcoded (0 /
  // certified.length) — never actually derived from state.geoEnrichmentResults,
  // so the reportText's "Geo coverage: 0%" line was always wrong regardless of
  // real GEO_ENRICHMENT_GATE outcome. Fixed: computed the same way the gate
  // itself classifies items (CONFIDENT_TIERS = confidently enriched,
  // ACCEPTABLE_EXCEPTION_TIERS = the explicit NO_CANONICAL_VENUE exception),
  // scoped to the certified catalog actually being reported on here.
  const certifiedNamesForGeo = new Set(certified.map((r) => r.candidateName))
  const geoResultsForCertified = (state.geoEnrichmentResults ?? []).filter((r) => certifiedNamesForGeo.has(r.candidateName))
  const geoConfidentCount = geoResultsForCertified.filter((r) => CONFIDENT_TIERS.includes(r.classification as PlacesMatchClassification)).length
  const geoExceptionCount = geoResultsForCertified.filter((r) => ACCEPTABLE_EXCEPTION_TIERS.includes(r.classification as PlacesMatchClassification)).length
  const geoCoveragePercent = certified.length > 0 ? Math.round((geoConfidentCount / certified.length) * 100) : 0

  const summary: MetroLaunchCertificationSummary = {
    catalogCount: certified.length,
    geoCoveragePercent,
    geoExceptionsCount: geoExceptionCount,
    tagsComplete: existingGates.some((g) => g.key === 'TAG_CERTIFICATION_GATE' && g.verdict === 'PASS'),
    metadataComplete: existingGates.some((g) => g.key === 'METADATA_COMPLETENESS_GATE' && g.verdict === 'PASS'),
    officialListsCount: plan.filter((p) => p.kind === 'PRIMARY_SEASONAL' || p.kind === 'THEMED').length,
    themedListsCount: plan.filter((p) => p.kind === 'THEMED').length,
    imagesComplete: imageGate.verdict === 'PASS',
    homeQueryPass: existingGates.some((g) => g.key === 'HOME_LIST_CERTIFICATION_GATE' && g.verdict === 'PASS'),
  }

  const report = certifyMetroLaunch({ metroName: run.projectId, gates: [...existingGates, imageGate, catalogGate, locationGate, presentationGate, editorialGate, activationKitGate], summary })
  state.finalCertificationReport = report
  state.rejectedItemCount = rejected.length + (state.editorRejectedCandidates ?? []).length

  // Chief Phase 2AL (2026-09-11) — finalReadyToApplyAudit.ts is now
  // AUTOMATICALLY invoked at the end of every real drive, never something
  // a caller has to remember to run separately. Its verdict is stored
  // alongside finalCertificationReport; stepLaunchBoundary's own
  // chiefRecommendation text refuses to call the package "ready" unless
  // THIS audit also passes, even when every individual required gate
  // already did — see evaluateFinalReadyToApplyAudit's own doc for why a
  // gate-by-gate PASS is not automatically the same claim as "ready to
  // apply" (e.g. same-Place-ID clusters can all individually PASS their
  // own gate while still being unresolved).
  const allGatesForFinalAudit = [...existingGates, imageGate, catalogGate, locationGate, presentationGate, editorialGate, activationKitGate]
  const gateVerdict = (key: string): 'PASS' | 'FAIL' | undefined => allGatesForFinalAudit.find((g) => g.key === key)?.verdict as 'PASS' | 'FAIL' | undefined
  const listTitlesWithInternalPrefix = plan.filter((p) => /themed list:/i.test(p.title)).map((p) => p.title)
  const sqlSafety = state.homeListSqlPatch ? checkSqlPatchSafety(state.homeListSqlPatch) : undefined
  const duplicateClustersForFinalAudit = state.venueDuplicateClusters ?? []
  state.finalReadyToApplyAudit = evaluateFinalReadyToApplyAudit({
    outOfMarketContaminationVerdict: gateVerdict('OUT_OF_MARKET_CONTAMINATION_GATE'),
    // No cluster-resolution-tracking mechanism exists yet (out of scope
    // for this hardening pass — see lateAddItemCertification.ts's own
    // doc) — fails closed: any cluster that exists is treated as
    // unresolved until a real "mark resolved" signal exists, never
    // silently assumed reviewed just because it was reported.
    allDuplicateClustersResolved: duplicateClustersForFinalAudit.length === 0,
    unresolvedDuplicateClusterCount: duplicateClustersForFinalAudit.length,
    allItemsCertified: gateVerdict('ITEM_CERTIFICATION_GATE') === 'PASS',
    uncertifiedItemCount: rejected.length,
    emptyNeighborhoods: state.neighborhoodCompletenessReport?.emptyNeighborhoods,
    placesCompletenessVerdict: gateVerdict('PLACES_COMPLETENESS_GATE'),
    listTitlesWithInternalPrefix,
    // Chief Phase 2AM (2026-09-11) — PRE_APPLY (packageValid, always
    // required) is derived from the generated SQL text itself via
    // derivePackageValidationFromSql, never from HOME_LIST_CERTIFICATION_GATE
    // (a live production read that can only pass post-apply — see
    // finalReadyToApplyAudit.ts's own doc for the bug this replaced).
    // POST_APPLY (liveVerificationValid) still carries that same live-gate
    // result, but is only CHECKED when executionState below is no longer
    // 'GENERATED' — which, today, it never is (Winston never applies SQL).
    homeList: (() => {
      const metroSlugForValidation = deps.metroAreaSlug ?? run.projectId
      const packageEntries = state.homeListSqlPatch ? derivePackageValidationFromSql(plan, state.homeListSqlPatch, metroSlugForValidation) : []
      const packageResult = state.homeListSqlPatch ? evaluateHomeListPackageValidationGate(packageEntries) : undefined
      const provenanceResult = state.homeListSqlPatch ? evaluateItemProvenanceGate({ certifiedNewItems: certified.map((r) => ({ candidateName: r.candidateName, body: r.finalBody })), sql: state.homeListSqlPatch }) : undefined
      const liveGate = allGatesForFinalAudit.find((g) => g.key === 'HOME_LIST_CERTIFICATION_GATE')
      return {
        packageValid: packageResult?.gate.verdict === 'PASS',
        packageIssues: packageResult ? [packageResult.gate.reason] : ['No generated SQL package to validate yet.'],
        itemProvenanceValid: provenanceResult?.gate.verdict === 'PASS',
        itemProvenanceIssues: provenanceResult ? [provenanceResult.gate.reason] : ['No generated SQL package to validate yet.'],
        liveVerificationValid: liveGate ? liveGate.verdict === 'PASS' : undefined,
        liveVerificationIssues: liveGate && liveGate.verdict !== 'PASS' ? [liveGate.reason] : undefined,
      }
    })(),
    // Structurally guaranteed by buildHomeListSqlPatch, which only ever
    // emits INSERT ... ON CONFLICT DO NOTHING for a reused existing item's
    // list_items row — never an UPDATE to the item or to another metro's
    // own list. True by construction of the current code, not a
    // per-run computed fact.
    reusedItemsAdditiveOnly: true,
    sqlSafetyVerdict: sqlSafety ? (sqlSafety.safe ? 'PASS' : 'FAIL') : undefined,
    sqlSafetyIssues: sqlSafety?.issues.map((i) => `${i.rule}: ${i.detail}`),
    // Winston/Chief never executes production SQL itself (standing write
    // boundary) — every package this driver produces is GENERATED only,
    // never APPLIED/VERIFIED, unless a caller explicitly overrides this
    // with real, confirmed execution evidence (no such path exists today).
    executionState: 'GENERATED',
  })

  // Chief Phase 3B (items 7, 8, 10) — the strategic close-out report +
  // durable stage artifacts, computed once against the frozen retained
  // catalog. Reuses buildAuditEvidence (the same category/neighborhood
  // counting + coverage-gap logic M4/stepLaunchBoundary already use) so
  // this report never re-derives a second, parallel notion of coverage.
  const { evidence: auditEvidence } = buildAuditEvidence(state)
  const coverageGaps = auditCoverage(auditEvidence)
  const importantNeighborhoodNames = (state.neighborhoods ?? []).filter((n) => n.kind === 'core_urban' || n.kind === 'important_neighborhood').map((n) => n.name)
  const duplicateClusters = state.venueDuplicateClusters ?? []
  const costReport = buildCostReport(state.usageByStage ?? {}, state.geoEnrichmentPaidCalls ?? 0, state.geoEnrichmentCacheHits ?? 0, certified.length)
  state.strategicReport = buildStrategicCoverageReport({
    finalItemCount: certified.length,
    categoryCounts: auditEvidence.categoryCounts,
    neighborhoodCounts: auditEvidence.neighborhoodCounts,
    allImportantNeighborhoodNames: importantNeighborhoodNames,
    partnerPotentialInventoryCount: certified.filter((r) => (r.partnerPotential?.score ?? 0) > 0).length,
    duplicateClustersFound: duplicateClusters.length,
    duplicateCandidateNamesInClusters: duplicateClusters.reduce((sum, c) => sum + c.members.length, 0),
    weakCandidatesRejected: rejected.length,
    coverageGaps,
    costReport,
  })

  // Durable stage artifacts (item 7) — a real write only happens when a
  // caller has configured deps.writeStageArtifact; this driver never
  // assumes filesystem access it wasn't explicitly given.
  if (deps.writeStageArtifact) {
    const files = buildStageArtifactFiles({
      candidates: state.candidates ?? [],
      itemCertifications: state.itemCertifications ?? {},
      catalogPruningDrops: state.catalogPruningDrops ?? [],
      homeListPlan: plan,
      categoryCounts: auditEvidence.categoryCounts,
      neighborhoodCounts: auditEvidence.neighborhoodCounts,
      homeListSqlPatch: state.homeListSqlPatch ?? null,
      venueDuplicateClusters: duplicateClusters,
      finalReportJson: report,
    })
    for (const [name, content] of Object.entries(files)) await deps.writeStageArtifact(name, content)
    state.stageArtifactManifest = Object.keys(files)
  }

  run.state = state
  run.currentStage = 'LAUNCH_READINESS_BOUNDARY'
  return run
}

async function stepLaunchBoundary(run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  // Structural bug fix (San Diego run, 2026-09-05): this used to be a
  // hardcoded `[]` — a real duplicate (251 raw candidates, only 200
  // unique names) sailed through QUALITY_GATE undetected. Run against
  // the canonical, already-deduped state.candidates: on a correctly
  // reconciled set this returns empty (dedupeCandidates already
  // resolved everything upstream); a nonempty result here is a genuine
  // safety-net catch, not the expected steady state.
  const suspectedDuplicates = findSuspectedDuplicates(state.candidates ?? [])
  // Structural fix (San Diego run, 2026-09-05, part 2): CATEGORY_GATE and
  // GEOGRAPHY_GATE used to evaluate against this SAME hardcoded `[]` —
  // Carlsbad dropping to 4/5 after a real dedupe went completely
  // undetected. Reuses buildAuditEvidence (canonical category
  // normalization, the exact same fuzzy geography/depth-target matching
  // M4 uses) and auditCoverage — the single source of truth for gap
  // detection — rather than a second, parallel free-text comparison that
  // could reintroduce the original exact-match bug.
  const { evidence } = buildAuditEvidence(state)
  const coverageGaps = auditCoverage(evidence)
  const gateEvidence: MetroGateEvidence = {
    coverageGaps,
    quality: { knownClosures: [], suspectedDuplicates, filler: [] },
    catalog: { viableItemCount: (state.candidates ?? []).length, targetCatalogSize: (state.candidates ?? []).length },
    location: { totalItems: (state.candidates ?? []).length, itemsWithCoordinates: (state.candidates ?? []).length },
    presentation: { homeRenders: true, listsRender: true, imagesRender: true },
    outreach: { targetBusinessCount: 0, queuedCount: 0 },
    approvedCategoryExceptions: [],
  }
  const gates = evaluateMetroGates(gateEvidence)
  // M14 (public launch) is ALWAYS APPROVAL_REQUIRED regardless of gate
  // state (metro_launch.public_launch has no AUTO/AUTO_TELL path) — the
  // driver stops here every time, by design, not as a failure mode.
  const finalReport = state.finalCertificationReport
  return escalate(run, 'Metro build reached the launch-readiness boundary — public launch (announcing/promoting the metro) always requires Jerry.', {
    // Chief Phase 2AH (2026-09-09 product-rule update): is_active does
    // NOT mean "officially announced/marketed" for CheckOff — it is a
    // normal production flag, already true from the moment a metro row
    // is created (see buildHomeListSqlPatch's metro_areas ensure-insert),
    // never a staging/launch gate. There is no "flip active" step. The
    // real remaining human actions are mechanical (apply the generated
    // SQL, add Home-card images, do a final content review) plus the one
    // genuine business decision this boundary exists for: WHEN to
    // announce/promote the market — never automated, regardless of gate
    // state (metro_launch.public_launch has no AUTO/AUTO_TELL path).
    decisionNeeded: 'Approve public launch (announce/promote) or hold for further review. The metro/catalog content itself is already live-ready once the generated SQL is applied — is_active is not a gate here.',
    why: 'metro_launch.public_launch is APPROVAL_REQUIRED with no exception path — deciding WHEN to publicly announce/promote a market is always a human business call, never a database flag Chief flips.',
    chiefRecommendation: finalReport
      ? finalReport.verdict === 'READY_TO_ACTIVATE'
        ? state.finalReadyToApplyAudit?.verdict === 'READY_TO_APPLY'
          ? finalReport.pendingHumanStepsOnly
            ? `METRO_LAUNCH_CERTIFICATION: READY TO ACTIVATE — every required gate that measures real catalog/content quality passed, AND the auto-wired FINAL_READY_TO_APPLY_AUDIT also passed. Only known, already-generated pending human steps remain (see the reportText below: applying the SQL patch and/or adding Home-card images) — never a build blocker.`
            : `METRO_LAUNCH_CERTIFICATION: READY_TO_ACTIVATE — every required gate passed, AND the auto-wired FINAL_READY_TO_APPLY_AUDIT also passed. Recommend approving public launch (announce/promote) whenever the business is ready.`
          : // Chief Phase 2AL — gate-by-gate PASS is NOT the same claim as
            // "ready to apply." Winston must not report this package as
            // production-ready while the final audit itself is
            // BLOCKED/incomplete, even when every individual gate already
            // passed (e.g. unresolved same-Place-ID clusters).
            `METRO_LAUNCH_CERTIFICATION gates all passed, but the auto-wired FINAL_READY_TO_APPLY_AUDIT has NOT passed: ${(state.finalReadyToApplyAudit?.reasons ?? ['audit result missing — treated as not ready']).join('; ')}. Winston must not call this package production-ready until that audit passes.`
        : `METRO_LAUNCH_CERTIFICATION: BLOCKED — ${finalReport.failingGates.length} failing / ${finalReport.missingGates.length} missing required gate(s). See metroLaunchCertification below for the exact list.`
      : gates.every((g) => g.verdict === 'PASS')
        ? 'All computed gates pass — recommend proceeding to real M7-M13 build once Jerry approves.'
        : 'Some gates show synthetic placeholder data only in this driver phase — a real build would need real M9/M13 evidence before this recommendation carries weight.',
    evidence: { candidateCount: (state.candidates ?? []).length, checkoffizedCount: (state.checkoffizedItems ?? []).length, gates },
    metroLaunchCertification: finalReport ?? null,
    finalReadyToApplyAudit: state.finalReadyToApplyAudit ?? null,
    // Chief Phase 3B — the Vienna post-mortem close-out additions.
    // strategicCoverageReport is the "what is still weak?" report
    // (item 10, computed at M10). venueClusterReviewNotes are
    // reporting-only duplicate-venue prompts (item 3) — never an
    // automatic drop; Jerry (or a future bounded editorial pass)
    // decides same-experience vs. distinct-experience per cluster.
    strategicCoverageReport: state.strategicReport ?? null,
    venueClusterReviewNotes: buildVenueClusterReviewNotes(state.venueDuplicateClusters ?? []),
    impact: 'No PROMOTION/ANNOUNCEMENT happens until Jerry explicitly approves that business decision — this boundary is inert by itself. The metro row, catalog, and lists become live (is_active=true, the normal production default) as soon as the generated SQL is applied; that is a mechanical step, not the thing this approval gates.',
    options: ['Approve public launch (announce/promote)', 'Hold for more research', 'Request changes to the candidate/editorial set'],
  })
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

const TERMINAL_STAGE = 'LAUNCH_READINESS_BOUNDARY_DONE'

export interface DriveMetroLaunchOptions {
  categoryPlan: CategoryCoveragePlan
  /** Configurable "meaningful depth" floors for specific named areas (e.g. Carlsbad/Oceanside) — see GeographicDepthTarget doc in metroLaunch.ts. Defaults to none (plain zero-check only), UNLESS autoDeriveDepthTargetsFromGeography is also set. */
  depthTargets?: GeographicDepthTarget[]
  /** Chief Phase 2AH (Green Bay incident, 2026-09-10) — when true AND depthTargets is omitted, stepM2 derives generic per-neighborhood floors from THIS run's own real M1 geography instead of the plain `[]` default. Set by cli.ts's bare `run metro_launch` command whenever no explicit --geo-depth-plan was given and the metro isn't the frozen San Diego project — never set by a direct driveMetroLaunch() caller/test that doesn't explicitly opt in, so existing depthTargets-omitting callers keep their exact prior `[]` behavior. */
  autoDeriveDepthTargetsFromGeography?: boolean
  /** Bounds how many stage-steps ONE call will perform — prevents an unbounded synchronous loop even with guardrails misconfigured. */
  maxSteps?: number
  /** ENSURE_METRO_PROJECT: overrides the derived agent.projects.name for this metro. Defaults to a humanized form of projectId (e.g. "vienna_austria" -> "Vienna Austria Metro"). */
  projectName?: string
  /** ENSURE_METRO_PROJECT: overrides the derived agent.projects.summary for this metro. */
  projectSummary?: string
}

export const METRO_BUILDER_OWNER_KEY = 'metro_builder'
export const METRO_PROJECT_TYPE = 'METRO'

/** "vienna_austria" -> "Vienna Austria Metro" — a readable default, never used to derive anything other than the agent.projects display name (project identity itself is always the exact projectId/project_key, never reparsed from this). */
export function deriveMetroProjectName(projectId: string): string {
  const words = projectId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  return `${words.join(' ')} Metro`
}

/**
 * ENSURE_METRO_PROJECT — the bootstrap step that always runs before M0.
 * Idempotent: an existing agent.projects row for this projectId is
 * reused exactly (never duplicated, never re-created); a genuinely
 * missing row is created automatically so "Winston, build <metro>" never
 * has a hidden "first go create a project row in Supabase" prerequisite.
 * Fails closed (throws) if the existing row's project_type isn't METRO —
 * an ambiguous identity collision, never silently reused. This is
 * agent.* operational bookkeeping, never public.* production content, so
 * it needs no Jerry-run SQL and no elevated privileges beyond what
 * agent_service already has (see mutations.ts's ensureProject).
 */
export interface EnsureMetroProjectDeps {
  /** Defaults to the real ensureProject mutation (mutations.ts) — tests inject a fake. */
  ensureProject?: (input: EnsureProjectInput) => Promise<EnsureProjectResult>
}

export async function ensureMetroProject(deps: EnsureMetroProjectDeps, projectId: string, options: Pick<DriveMetroLaunchOptions, 'projectName' | 'projectSummary'> = {}): Promise<EnsureProjectResult> {
  const ensure = deps.ensureProject ?? ensureProjectMutation
  return ensure({
    projectKey: projectId,
    name: options.projectName ?? deriveMetroProjectName(projectId),
    projectType: METRO_PROJECT_TYPE,
    ownerKey: METRO_BUILDER_OWNER_KEY,
    summary: options.projectSummary ?? `Metro launch build for "${projectId}" — bootstrapped automatically by the metro_launch driver's ENSURE_METRO_PROJECT step.`,
  })
}

/**
 * Advances a metro_launch playbook run as far as it can go in one call —
 * stopping at NEEDS_JERRY, BLOCKED, DONE, or the maxSteps bound. Safe to
 * call again at any time (idempotent re-entry from persisted state) —
 * this IS the resumability contract (spec section 2).
 */
export async function driveMetroLaunch(deps: MetroDriverDeps, projectId: string, options: DriveMetroLaunchOptions): Promise<PlaybookRunRecord> {
  // ENSURE_METRO_PROJECT runs before anything else, every call — the
  // FIRST persisted write for a brand-new run (getOrCreateRun's own
  // put(), below) already requires this row to exist (createTask
  // resolves projectKey -> agent.projects), so bootstrap cannot happen
  // any later than this. Idempotent, so re-running it on every resumed
  // call (not just the very first) is deliberate, not wasted work — see
  // ensureMetroProject's doc.
  await ensureMetroProject(deps, projectId, { projectName: options.projectName, projectSummary: options.projectSummary })

  let run = await getOrCreateRun(deps.runStore, METRO_LAUNCH_DRIVER_PLAYBOOK_KEY, projectId, 'M0_METRO_DEFINITION')
  if (run.status === 'PAUSED' || run.status === 'DONE') return run
  if (run.status === 'NEEDS_JERRY' || run.status === 'BLOCKED') {
    // Only re-enter if the caller has since resolved the M0 decisions —
    // otherwise stay put rather than re-escalating identically every call.
    if (run.currentStage !== 'M0_METRO_DEFINITION' || !m0DecisionsResolved(readState(run).m0Decisions)) return run
    run.status = 'RUNNING'
  }

  const maxSteps = options.maxSteps ?? 200
  for (let step = 0; step < maxSteps; step++) {
    if (run.currentStage === TERMINAL_STAGE) {
      run.status = 'DONE'
      return persist(run, deps)
    }

    switch (run.currentStage) {
      case 'M0_METRO_DEFINITION':
        run = await stepM0(deps, run)
        break
      case 'M1_GEOGRAPHY_MAP':
        run = await stepM1(deps, run)
        break
      case 'M2_CATEGORY_COVERAGE_PLAN':
        run = await stepM2(deps, run, options.categoryPlan, options.depthTargets, options.autoDeriveDepthTargetsFromGeography)
        break
      case 'M3_BROAD_DISCOVERY':
        run = await stepM3(deps, run)
        break
      case 'M4_COVERAGE_AUDIT':
        run = await stepM4(deps, run)
        break
      case 'M5_TARGETED_DEEP_DIVES':
        run = await stepM5(deps, run)
        break
      case 'M6_QUALITY_VERIFICATION':
        run = await stepM6(deps, run)
        break
      case 'M5B_REPLACEMENT':
        run = await stepM5B(deps, run)
        break
      case 'M6_5_CHECKOFF_EDITOR':
        run = await stepEditor(deps, run)
        break
      case 'M7_ITEM_CERTIFICATION':
        run = await stepM7ItemCertification(deps, run)
        break
      case 'M7_5_TAG_ASSIGNMENT':
        run = await stepTagAssignment(deps, run)
        break
      case 'M8_BATCH_CERTIFICATION':
        run = await stepM8BatchCertification(deps, run)
        break
      case 'M8_5_CATALOG_PRUNING':
        run = await stepM8_5CatalogPruning(deps, run)
        break
      case 'M8_75_CATALOG_VOICE_PASS':
        run = await stepCatalogVoicePass(deps, run)
        break
      case 'M9_HOME_LIST_MIRROR':
        run = await stepM9HomeListMirror(deps, run)
        break
      case 'M10_METRO_LAUNCH_CERTIFICATION':
        run = await stepM10FinalCertification(deps, run)
        break
      case 'LAUNCH_READINESS_BOUNDARY':
        run = await stepLaunchBoundary(run)
        break
      default:
        throw new Error(`Unknown metro_launch driver stage "${run.currentStage}"`)
    }

    await persist(run, deps)
    if (run.status !== 'RUNNING') return run
  }
  return run
}
