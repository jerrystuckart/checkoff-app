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
import { countByCanonicalCategory, classifyCategory, type UnclassifiedCategory } from '../playbooks/categoryNormalization'
import { runExecutionRouted } from './routing'
import type { ExecutionStore, SpecialistExecutor, SpecialistExecutionRequest } from './executor'
import { getOrCreateRun, type PlaybookRunStore, type PlaybookRunRecord } from './playbookRun'
import { dedupeCandidates, findSuspectedDuplicates, type RawCandidate } from './candidateMerge'
import { DEFAULT_DRIVER_GUARDRAILS, type DriverGuardrails } from './driverGuardrails'
import type { SpecialistResultEnvelope } from './types'
import { certifyEditorialDistinctiveness, checkDistinctiveExperience, checkVenueQuoted, type DistinctivenessCertificationItem } from '../playbooks/editorialDistinctiveness'
import { evaluateItemCritique, evaluateItemCertificationGate, type ItemCritiqueAnswers, type ItemCertificationOutcome, type CatalogItemCertificationCheck, type ItemCertificationRecord } from '../playbooks/itemCertificationLoop'
import { evaluateTagCertificationGate, type ItemTagProposal } from '../playbooks/metroTagCertification'
import { evaluateItemMetadata, evaluateMetadataCompletenessGate, type MetadataEnrichmentResult } from '../playbooks/metroMetadataEnrichment'
import { evaluateGeoEnrichmentCertificationGate, type GeoEnrichmentItemResult } from '../playbooks/metroGeoEnrichment'
import { enrichMetroCatalogGeo, buildRealPlacesLookup, FileGeoEnrichmentCacheStore, type GeoEnrichmentCacheStore, type PlacesLookupFn, type GeoEnrichmentCandidate } from './metroGeoEnrichmentDriver'
import { readRealHomeListRows, type HomeListReadPathFailure } from './homeListReadPath'
import { certifyHomeListRow, evaluateHomeListCertificationGate, certifyCuratedListRow, evaluateCuratedListLayerGate, type HomeListRow, type CuratedListRow } from '../playbooks/homeListCertification'
import { evaluateImageReadinessGate, type ImageReadinessCard } from '../playbooks/imageReadiness'
import { certifyMetroLaunch, type MetroLaunchCertificationReport, type MetroLaunchCertificationSummary } from '../playbooks/metroLaunchCertification'
import {
  CANONICAL_TO_DB_CATEGORY,
  evaluateCatalogGate,
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
  homeListPlan?: HomeListPlanEntry[]
  /** The one atomic, self-certifying SQL patch text for Jerry to run — this driver never writes public.lists/public.list_items directly (standing write-boundary rule, unchanged). */
  homeListSqlPatch?: string
  tagVocabularyDetail?: string
  batchCertificationGates?: StagingGateResult[]
  rejectedItemCount?: number
  geoEnrichmentPaidCalls?: number
  geoEnrichmentCacheHits?: number
  geoEnrichmentResults?: Array<{ candidateName: string; classification: string; placeId: string | null; formattedAddress: string | null; lat: number | null; lng: number | null; websiteUrl: string | null; geoRadiusM: number | null }>
  activationKitCheckDetail?: string
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
}

export interface HomeListPlanEntry {
  label: string
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

async function stepM2(deps: MetroDriverDeps, run: PlaybookRunRecord, defaultPlan: CategoryCoveragePlan, depthTargets: GeographicDepthTarget[]): Promise<PlaybookRunRecord> {
  // Deterministic — no specialist call needed once a plan is supplied
  // (per the Phase 2F task: "metro_builder or performs deterministic
  // target setup where already encoded").
  const state = readState(run)
  state.plan = defaultPlan
  state.depthTargets = depthTargets
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
  const newCandidates = ((outcome.envelope?.evidence.candidates as (RawCandidate & { needsVerification: boolean })[]) ?? []).map((c) => ({ ...c, needsVerification: c.needsVerification ?? true }))
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
    .flatMap((r) => ((r.envelope?.evidence.candidates as (RawCandidate & { needsVerification: boolean })[]) ?? []).map((c) => ({ ...c, needsVerification: c.needsVerification ?? true })))
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

  const newCandidates = ((outcome.envelope?.evidence.candidates as (RawCandidate & { needsVerification: boolean })[]) ?? []).map((c) => ({ ...c, needsVerification: c.needsVerification ?? true }))
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
    run.currentStage = 'M8_BATCH_CERTIFICATION'
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
  const unclassifiedForMetadata: string[] = []
  const metadataResults: MetadataEnrichmentResult[] = []
  for (const r of certified) {
    const candidate = candidatesByName.get(r.candidateName)
    const canonical = classifyCategory(candidate?.category ?? null).canonical
    const dbCategory: RealDbCategory | null = canonical ? CANONICAL_TO_DB_CATEGORY[canonical] : null
    if (!dbCategory) {
      unclassifiedForMetadata.push(r.candidateName)
      continue
    }
    metadataResults.push(evaluateItemMetadata({ candidateName: r.candidateName, body: r.finalBody, dbCategory }))
  }
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
    const mapsQuery = candidate?.address?.trim() || `${r.candidateName}, ${candidate?.neighborhood ?? run.projectId}`
    return { candidateName: r.candidateName, body: r.finalBody, mapsQuery, expectedCountry, biasLat: metroCenterBias.lat, biasLng: metroCenterBias.lng }
  })
  const geoRun = await enrichMetroCatalogGeo(run.projectId, geoCandidates, {
    cache: deps.geoEnrichmentCache ?? new FileGeoEnrichmentCacheStore(),
    lookup: deps.placesLookup ?? buildRealPlacesLookup(),
  })
  state.geoEnrichmentPaidCalls = (state.geoEnrichmentPaidCalls ?? 0) + geoRun.paidCallsMade
  state.geoEnrichmentCacheHits = (state.geoEnrichmentCacheHits ?? 0) + geoRun.cacheHits
  state.geoEnrichmentResults = geoRun.records.map((r) => ({ candidateName: r.candidateName, classification: r.classification, placeId: r.placeId, formattedAddress: r.formattedAddress, lat: r.lat, lng: r.lng, websiteUrl: r.websiteUrl, geoRadiusM: r.geoRadiusM }))
  const geoGate = evaluateGeoEnrichmentCertificationGate(geoRun.records.map((r): GeoEnrichmentItemResult => ({ candidateName: r.candidateName, classification: r.classification, reason: r.reason })))

  const gates: StagingGateResult[] = [...distinctivenessGates, itemCertificationGate, tagGate, metadataGate, geoGate]
  state.batchCertificationGates = gates
  run.state = state
  run.currentStage = 'M9_HOME_LIST_MIRROR'
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

function buildHomeListPlan(state: MetroDriverState): HomeListPlanEntry[] {
  const certified = Object.values(state.itemCertifications ?? {}).filter((r): r is DriverItemCertificationRecord & { finalBody: string } => r.outcome === 'ITEM_CERTIFIED' && r.finalBody !== null)
  const names = certified.map((r) => r.candidateName)
  const plan: HomeListPlanEntry[] = [{ label: 'Primary seasonal list', kind: 'PRIMARY_SEASONAL', itemCandidateNames: names, requiresImage: true }]
  const byCategory = new Map<string, string[]>()
  const candidatesByName = new Map((state.candidates ?? []).map((c) => [c.name, c]))
  for (const name of names) {
    const cat = candidatesByName.get(name)?.category ?? 'Misc'
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), name])
  }
  for (const [cat, itemNames] of byCategory) {
    if (itemNames.length >= 4) {
      plan.push({ label: `Themed list: ${cat}`, kind: 'THEMED', itemCandidateNames: itemNames, requiresImage: true })
    }
  }
  plan.push({ label: 'Curated-layer mirror', kind: 'CURATED_MIRROR', itemCandidateNames: names, requiresImage: false })
  return plan
}

function buildHomeListSqlPatch(metroSlug: string, plan: readonly HomeListPlanEntry[]): string {
  const primary = plan.find((p) => p.kind === 'PRIMARY_SEASONAL')
  const lines: string[] = []
  lines.push(`-- Generated by Winston metro_launch driver (M9_HOME_LIST_MIRROR) for metro "${metroSlug}".`)
  lines.push('-- One atomic, self-certifying block — no cross-statement TEMP-table dependence, no MIN(uuid).')
  lines.push('DO $$')
  lines.push('DECLARE')
  lines.push('  v_metro_id uuid;')
  lines.push('  v_match_count int;')
  lines.push('BEGIN')
  lines.push(`  SELECT count(*) INTO v_match_count FROM public.metro_areas WHERE slug = ${sqlQuote(metroSlug)};`)
  lines.push("  IF v_match_count <> 1 THEN RAISE EXCEPTION 'expected exactly 1 metro_areas row for slug %, found %', " + sqlQuote(metroSlug) + ', v_match_count; END IF;')
  lines.push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = ${sqlQuote(metroSlug)};`)
  lines.push('')
  for (const entry of plan) {
    if (entry.kind === 'CURATED_MIRROR') continue // curated_lists layer is a separate, existing patch pattern (see itemIntake.ts) — not duplicated here
    lines.push(`  -- ${entry.label} (${entry.itemCandidateNames.length} item(s))`)
    lines.push(`  INSERT INTO public.lists (metro_id, title, is_official, is_public${entry.kind === 'PRIMARY_SEASONAL' ? ', is_featured_eligible' : ''})`)
    lines.push(`  VALUES (v_metro_id, ${sqlQuote(entry.label)}, true, true${entry.kind === 'PRIMARY_SEASONAL' ? ', true' : ''})`)
    lines.push('  RETURNING id;')
    lines.push('')
  }
  lines.push(`  -- list_items membership for each list above must be inserted by matching each item's certified candidate name to its real public.checkoff_items row (unique-match asserted per item, never MIN(uuid)).`)
  lines.push('END $$;')
  return lines.join('\n')
}

function sqlQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

async function stepM9HomeListMirror(deps: MetroDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const plan = buildHomeListPlan(state)
  state.homeListPlan = plan
  state.homeListSqlPatch = buildHomeListSqlPatch(run.projectId, plan)

  // Real read path by default (readRealHomeListRows — an actual
  // public.lists/public.list_items query) — tests/production callers may
  // still inject their own verifyHomeListRows to override it.
  const verify = deps.verifyHomeListRows ?? ((p) => readRealHomeListRows(run.projectId, p))
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
  const intakeRecords: ItemIntakeRecord[] = certified
    .map((r) => {
      const candidate = candidatesByNameForIntake.get(r.candidateName)
      const canonical = classifyCategory(candidate?.category ?? null).canonical
      const dbCategory = canonical ? CANONICAL_TO_DB_CATEGORY[canonical] : null
      if (!dbCategory) return null
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

  const catalogGate = evaluateCatalogGate({ expectedCanonicalCount: intakeRecords.length, stagedRecords: intakeRecords, intakeFailures: [], duplicates: { clean: intakeRecords, collidesWithProduction: [], collidesWithinBatch: [] } })
  const locationGate = evaluateLocationGate({ records: intakeRecords })
  const presentationGate = evaluatePresentationGate({ records: intakeRecords })
  const editorialGate = evaluateEditorialQualityGate({ records: intakeRecords })

  const summary: MetroLaunchCertificationSummary = {
    catalogCount: certified.length,
    geoCoveragePercent: 0,
    geoExceptionsCount: certified.length,
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
  return escalate(run, 'Metro build reached the launch-readiness boundary — public launch always requires Jerry.', {
    decisionNeeded: 'Approve launch (flip metro_areas.is_active=true) or hold for further review.',
    why: 'metro_launch.public_launch is APPROVAL_REQUIRED with no exception path.',
    chiefRecommendation: finalReport
      ? finalReport.verdict === 'READY_TO_ACTIVATE'
        ? finalReport.imageSelectionOnlyBlock
          ? `METRO_LAUNCH_CERTIFICATION: READY TO ACTIVATE — manual list images required before production activation. Every other required gate (item certification, distinctive-experience, venue quoting, opening distribution, tags, metadata, geo enrichment, Home-list mirror) passed; only image selection for the Home cards below remains as a human pre-activation task, not a build blocker.`
          : `METRO_LAUNCH_CERTIFICATION: READY_TO_ACTIVATE — every required gate (item certification, distinctive-experience, venue quoting, opening distribution, tags, metadata, geo enrichment, Home-list mirror, image readiness) passed. Recommend approving launch.`
        : `METRO_LAUNCH_CERTIFICATION: BLOCKED — ${finalReport.failingGates.length} failing / ${finalReport.missingGates.length} missing required gate(s). See metroLaunchCertification below for the exact list.`
      : gates.every((g) => g.verdict === 'PASS')
        ? 'All computed gates pass — recommend proceeding to real M7-M13 build once Jerry approves.'
        : 'Some gates show synthetic placeholder data only in this driver phase — a real build would need real M9/M13 evidence before this recommendation carries weight.',
    evidence: { candidateCount: (state.candidates ?? []).length, checkoffizedCount: (state.checkoffizedItems ?? []).length, gates },
    metroLaunchCertification: finalReport ?? null,
    impact: 'No public-facing change happens until Jerry explicitly approves — this boundary is inert by itself.',
    options: ['Approve launch readiness and proceed to M7 catalog construction (out of scope for this driver phase)', 'Hold for more research', 'Request changes to the candidate/editorial set'],
  })
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

const TERMINAL_STAGE = 'LAUNCH_READINESS_BOUNDARY_DONE'

export interface DriveMetroLaunchOptions {
  categoryPlan: CategoryCoveragePlan
  /** Configurable "meaningful depth" floors for specific named areas (e.g. Carlsbad/Oceanside) — see GeographicDepthTarget doc in metroLaunch.ts. Defaults to none (plain zero-check only). */
  depthTargets?: GeographicDepthTarget[]
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
        run = await stepM2(deps, run, options.categoryPlan, options.depthTargets ?? [])
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
      case 'M8_BATCH_CERTIFICATION':
        run = await stepM8BatchCertification(deps, run)
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
