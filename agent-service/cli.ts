#!/usr/bin/env node
// Chief operator CLI (Phase 2D spec section 30, DB-backed by default as
// of Phase 2E). A thin wrapper around the executor runtime so Jerry (or
// anyone) can inspect and drive executions without editing DB rows by
// hand. This is the MANUAL_EXECUTOR bridge's human interface — not the
// desired end state (Chief invoking specialists autonomously is), but a
// first-class fallback that works today.
//
// Usage:
//   tsx agent-service/cli.ts delegate <request.json>
//   tsx agent-service/cli.ts execution show <executionId>
//   tsx agent-service/cli.ts execution list
//   tsx agent-service/cli.ts execution submit-result <executionId> <result.json>
//   tsx agent-service/cli.ts execution retry <executionId>
//
// Phase 2F — the HIGH-LEVEL commands (spec section 4). Jerry does not
// manage individual execution ids for normal operation; these drive a
// whole playbook run to completion/NEEDS_JERRY/BLOCKED in one command:
//   tsx agent-service/cli.ts run metro_launch <projectKey> [--category-plan file.json] [--geo-depth-plan file.json] [--m0 decisions.json] [--metro-area-facts facts.json] [--metro-slug slug] [--existing-inventory-search-term "term"] [--official-list-creator-id uuid] [--flagship-list-title "Fall 2026 — Vienna Metro"] [--request-metro-finisher-follow-up] [--packet-execution-budget budget.json] [--neighborhood-municipality-registry registry.json] [--reopen-from-launch-boundary]
//     --reopen-from-launch-boundary: an explicit, per-invocation operator
//       override — reopens THIS project's run from NEEDS_JERRY/BLOCKED at
//       LAUNCH_READINESS_BOUNDARY back into METRO_FINISHER_PACKET_EXECUTION.
//       Scoped to the single projectId this command already targets; a
//       no-op for every other stage/status (including the separate
//       M0_METRO_DEFINITION reopen path, unaffected either way).
//     --category-plan/--geo-depth-plan: omit to get a metro-agnostic
//       default (DEFAULT_CATEGORY_COVERAGE_PLAN; geo depth targets
//       auto-derived from this run's own real M1 neighborhoods) — NEVER
//       San Diego's frozen manifest, unless projectId is literally
//       "san_diego"/"san-diego" (see defaultMetroManifest.ts's doc comment
//       for the 2026-09-10 incident this fixed).
//     --metro-slug: the real production metro_areas.slug (e.g.
//       "green-bay") — distinct from projectId, defaults to projectId for
//       backward compatibility.
//     --existing-inventory-search-term: overrides the region name used to
//       search for already-live production items this metro's build
//       should reuse rather than duplicate — defaults to metroAreaFacts.name.
//     --request-metro-finisher-follow-up: wires
//       DriveMetroLaunchOptions.requestMetroFinisherFollowUp (Chief Phase
//       3C) — requests the one permitted METRO_FINISHER_DEEP_RESEARCH
//       follow-up run. A no-op unless the driver's own retry-gate decides
//       the prior attempt is actually eligible (a report that said
//       not-ready, or a first attempt that failed structural validation
//       and never stored a report at all) — never causes an automatic
//       loop and never exceeds MAX_METRO_FINISHER_RUNS.
//   tsx agent-service/cli.ts run destination_hub_lifecycle <projectKey> --candidate candidate.json
//   tsx agent-service/cli.ts status <playbookKey> <projectKey>
//   tsx agent-service/cli.ts pause <playbookKey> <projectKey>
//   tsx agent-service/cli.ts resume <playbookKey> <projectKey>
//   tsx agent-service/cli.ts unblock <playbookKey> <projectKey>   (BLOCKED -> RUNNING, retriable infra failures only — no decision payload)
//   tsx agent-service/cli.ts reopen-stage <playbookKey> <projectKey> <toStage> [stateReset.json]   (methodology fix invalidated a later stage's output — moves currentStage back, clears named state keys, keeps the rest)
//   tsx agent-service/cli.ts decide <playbookKey> <projectKey> <decision.json>   (records a pending Jerry decision and resumes)
//
// STORE SELECTION (Phase 2E): by default this uses the real, durable
// DbExecutionStore (agent.tasks/agent.task_events — see
// dbExecutionStore.ts), which requires AGENT_SERVICE_DATABASE_URL to be
// set (same variable db.ts already uses — no new config surface). Pass
// --file to use the local, non-durable FileExecutionStore instead
// (.chief-executions.json in the cwd, gitignored) — useful for
// dry-running the CLI without a database, but this is explicitly NOT
// production execution state; it never survives being deleted and is
// invisible to any other process.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExecutionRecord, ExecutionStore, SpecialistExecutionRequest } from './specialists/executor'
import { registerExecution, acceptExecutionResult, retryExecution } from './specialists/executor'
import { buildManualAssignmentPackage } from './specialists/manualExecutor'
import { DbExecutionStore } from './specialists/dbExecutionStore'
import type { SpecialistResultEnvelope } from './specialists/types'
import type { PlaybookRunStore, PlaybookRunRecord } from './specialists/playbookRun'
import { playbookRunId, pauseRun, resumeRun, unblockRun, reopenStage, recordJerryDecision, getOrCreateRun } from './specialists/playbookRun'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { driveMetroLaunch, ensureMetroProject, type MetroM0Decisions } from './specialists/metroLaunchDriver'
import { driveDestinationHub } from './specialists/destinationHubDriver'
import { RemoteAiExecutor } from './specialists/remoteAiExecutor'
import { AnthropicMessagesAdapter } from './specialists/remoteAiExecutor'
import { OpenAiAdapter } from './specialists/openAiAdapter'
import { SAN_DIEGO_CATEGORY_PLAN, SAN_DIEGO_GEOGRAPHIC_DEPTH_TARGETS } from './playbooks/sanDiegoManifest'
import { DEFAULT_CATEGORY_COVERAGE_PLAN } from './playbooks/defaultMetroManifest'
import type { CategoryCoveragePlan, GeographicDepthTarget } from './playbooks/metroLaunch'
import type { DiscoveryCandidate } from './playbooks/destinationHubLifecycle'

const STORE_PATH = resolve(process.cwd(), '.chief-executions.json')

class FileExecutionStore implements ExecutionStore {
  private records: ExecutionRecord[]

  constructor() {
    this.records = existsSync(STORE_PATH) ? JSON.parse(readFileSync(STORE_PATH, 'utf8')) : []
  }

  async get(executionId: string): Promise<ExecutionRecord | undefined> {
    return this.records.find((r) => r.request.executionId === executionId)
  }

  async put(record: ExecutionRecord): Promise<void> {
    const i = this.records.findIndex((r) => r.request.executionId === record.request.executionId)
    if (i >= 0) this.records[i] = record
    else this.records.push(record)
    this.save()
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<ExecutionRecord | undefined> {
    return this.records.find((r) => r.request.idempotencyKey === idempotencyKey)
  }

  async all(): Promise<ExecutionRecord[]> {
    return this.records
  }

  private save(): void {
    writeFileSync(STORE_PATH, JSON.stringify(this.records, null, 2))
  }
}

const RUN_STORE_PATH = resolve(process.cwd(), '.chief-playbook-runs.json')

class FilePlaybookRunStore implements PlaybookRunStore {
  private records: PlaybookRunRecord[]
  constructor() {
    this.records = existsSync(RUN_STORE_PATH) ? JSON.parse(readFileSync(RUN_STORE_PATH, 'utf8')) : []
  }
  async get(runId: string): Promise<PlaybookRunRecord | undefined> {
    return this.records.find((r) => r.runId === runId)
  }
  async put(record: PlaybookRunRecord): Promise<void> {
    const i = this.records.findIndex((r) => r.runId === record.runId)
    if (i >= 0) this.records[i] = record
    else this.records.push(record)
    writeFileSync(RUN_STORE_PATH, JSON.stringify(this.records, null, 2))
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T
}

/**
 * Every configured, capability-qualified provider — credential names are
 * documented, never pasted into chat (spec section 12): set
 * ANTHROPIC_API_KEY and/or OPENAI_API_KEY as environment variables. An
 * unconfigured provider is simply absent from this list — it never makes
 * the WHOLE specialist unavailable if another qualified one exists (spec
 * section 11).
 */
function buildDefaultExecutors() {
  return [new RemoteAiExecutor([new AnthropicMessagesAdapter(), new OpenAiAdapter()])]
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const useFile = rawArgs.includes('--file')
  const args = rawArgs.filter((a) => a !== '--file')
  const [command, ...rest0] = args
  const store: ExecutionStore = useFile ? new FileExecutionStore() : new DbExecutionStore()
  const runStore: PlaybookRunStore = useFile ? new FilePlaybookRunStore() : new DbPlaybookRunStore()

  if (command === 'run') {
    const [playbookKey, projectId, ...flags] = rest0
    const executors = buildDefaultExecutors()
    if (playbookKey === 'metro_launch') {
      const projectNameFlagIdx = flags.indexOf('--project-name')
      const projectName: string | undefined = projectNameFlagIdx >= 0 ? flags[projectNameFlagIdx + 1] : undefined
      const projectSummaryFlagIdx = flags.indexOf('--project-summary')
      const projectSummary: string | undefined = projectSummaryFlagIdx >= 0 ? flags[projectSummaryFlagIdx + 1] : undefined
      // ENSURE_METRO_PROJECT — must happen before ANYTHING else touches
      // runStore below: even the --m0 seeding path (a few lines down)
      // calls runStore.put() on a brand-new run, which requires the
      // agent.projects row to already exist (createTask resolves
      // projectKey). driveMetroLaunch() also calls this itself
      // (idempotent, defense-in-depth for direct callers), so calling it
      // here too is deliberate belt-and-suspenders, never wasted work.
      await ensureMetroProject({}, projectId, { projectName, projectSummary })

      // Chief Phase 2AH root-cause fix (Green Bay contamination incident,
      // 2026-09-10): SAN_DIEGO_CATEGORY_PLAN/SAN_DIEGO_GEOGRAPHIC_DEPTH_TARGETS
      // are San Diego's own FROZEN historical manifest (Jerry's explicit
      // instruction: preserve that exact behavior, but ONLY when the
      // metro actually being built IS San Diego). They must never again
      // be the implicit default for any other metro — that silent
      // fallback is exactly what fed real San Diego neighborhood names
      // (Carlsbad/Oceanside/Chula Vista/Coronado) into a live Green Bay
      // web-research call. `projectId` is checked, never `--metro-slug`,
      // since this decision has to be made before `--metro-slug` (below)
      // is even parsed, and San Diego's real historical project key IS
      // its own slug convention ("san_diego"/"san-diego" — both accepted).
      const isFrozenSanDiegoProject = projectId === 'san_diego' || projectId === 'san-diego'
      const planFlagIdx = flags.indexOf('--category-plan')
      const categoryPlan: CategoryCoveragePlan = planFlagIdx >= 0 ? readJson(flags[planFlagIdx + 1]) : isFrozenSanDiegoProject ? SAN_DIEGO_CATEGORY_PLAN : DEFAULT_CATEGORY_COVERAGE_PLAN
      const geoDepthFlagIdx = flags.indexOf('--geo-depth-plan')
      // No metro-agnostic default here at all (requirement 2/3): when no
      // explicit --geo-depth-plan is given and this isn't the frozen San
      // Diego project, `depthTargets` stays undefined — metroLaunchDriver.ts's
      // stepM2 then derives generic floors from THIS run's own real M1
      // neighborhoods (deriveDefaultDepthTargets), which can never
      // reference another metro's geography by construction. This
      // satisfies "generate the metro-specific geo plan automatically
      // from the normal planning methodology" rather than "fail clearly" —
      // M1 always runs before M2 needs this, so there is no chicken-and-egg
      // problem requiring a hard failure instead.
      const depthTargets: GeographicDepthTarget[] | undefined = geoDepthFlagIdx >= 0 ? readJson(flags[geoDepthFlagIdx + 1]) : isFrozenSanDiegoProject ? SAN_DIEGO_GEOGRAPHIC_DEPTH_TARGETS : undefined
      // Only the bare-command path (no explicit --geo-depth-plan, not the
      // frozen San Diego project) opts into deriving depth targets from
      // this run's own real M1 geography — see DriveMetroLaunchOptions's
      // doc. A direct driveMetroLaunch() caller that never sets this stays
      // on the old, safe `depthTargets ?? []` default.
      const autoDeriveDepthTargetsFromGeography = geoDepthFlagIdx < 0 && !isFrozenSanDiegoProject
      const metroSlugFlagIdx = flags.indexOf('--metro-slug')
      // Chief Phase 2AH: the real, established production slug (e.g.
      // "green-bay") is a distinct decision from `projectId` (the CLI/
      // task-tracking key, e.g. "green_bay_wisconsin") — previously
      // conflated, which shipped `metro_areas.slug = 'green_bay_wisconsin'`
      // instead of the kebab-case convention every other metro uses.
      // Defaults to `projectId` only for backward compatibility with
      // existing runs that never distinguished the two.
      const metroSlug: string | undefined = metroSlugFlagIdx >= 0 ? flags[metroSlugFlagIdx + 1] : undefined
      const existingInventorySearchTermFlagIdx = flags.indexOf('--existing-inventory-search-term')
      const existingInventorySearchTerm: string | undefined = existingInventorySearchTermFlagIdx >= 0 ? flags[existingInventorySearchTermFlagIdx + 1] : undefined
      const m0FlagIdx = flags.indexOf('--m0')
      if (m0FlagIdx >= 0) {
        const m0: MetroM0Decisions = readJson(flags[m0FlagIdx + 1])
        const runId = playbookRunId(playbookKey, projectId)
        const existing = await runStore.get(runId)
        if (existing && existing.status === 'NEEDS_JERRY') {
          await recordJerryDecision(runStore, runId, { m0Decisions: m0 })
        } else if (!existing) {
          // Seed the M0 decisions before the run's very first step —
          // getOrCreateRun (also called inside driveMetroLaunch) is idempotent.
          const seeded = await getOrCreateRun(runStore, playbookKey, projectId, 'M0_METRO_DEFINITION')
          seeded.state = { ...seeded.state, m0Decisions: m0 }
          // DbPlaybookRunStore's recordPlaybookStage is idempotency-keyed on
          // (status, currentStage, loopIteration, totalRetries, updatedAt) —
          // getOrCreateRun's own put() and this one would otherwise share
          // the exact same updatedAt (and thus idempotency key), so this
          // second put (the one actually carrying m0Decisions) would be
          // silently deduped as a no-op replay of the first, empty-state
          // snapshot. Bumping updatedAt makes it a distinct snapshot.
          seeded.updatedAt = new Date().toISOString()
          await runStore.put(seeded)
        }
      }
      // --metro-area-facts: the real, known metro_areas identity (name/
      // state/timezone) for THIS metro — never guessed inside the driver
      // (see MetroDriverDeps.metroAreaFacts). Omit to keep the old
      // fail-closed check-only Home-list SQL behavior.
      const metroAreaFactsFlagIdx = flags.indexOf('--metro-area-facts')
      const metroAreaFacts: { name: string; state: string; timezone: string } | undefined = metroAreaFactsFlagIdx >= 0 ? readJson(flags[metroAreaFactsFlagIdx + 1]) : undefined
      const officialListCreatorIdFlagIdx = flags.indexOf('--official-list-creator-id')
      const officialListCreatorId: string | undefined = officialListCreatorIdFlagIdx >= 0 ? flags[officialListCreatorIdFlagIdx + 1] : undefined
      const flagshipListTitleFlagIdx = flags.indexOf('--flagship-list-title')
      const flagshipListTitle: string | undefined = flagshipListTitleFlagIdx >= 0 ? flags[flagshipListTitleFlagIdx + 1] : undefined
      // --canonical-neighborhoods: the real, approved, FROZEN canonical
      // neighborhood model (MetroDriverDeps.canonicalNeighborhoods, Chief
      // Phase 2AL) — a JSON file containing a plain string array. Required
      // for NEIGHBORHOOD_COMPLETENESS_GATE / M9 SQL packaging to pass;
      // there was previously no CLI plumbing for this driver-level input.
      const canonicalNeighborhoodsFlagIdx = flags.indexOf('--canonical-neighborhoods')
      const canonicalNeighborhoods: readonly string[] | undefined = canonicalNeighborhoodsFlagIdx >= 0 ? readJson(flags[canonicalNeighborhoodsFlagIdx + 1]) : undefined
      // --empty-neighborhood-fallback-centroids: MetroDriverDeps.emptyNeighborhoodFallbackCentroids
      // — a JSON file of { [neighborhoodName]: { lat, lng } } real, public
      // locality-centroid fallbacks for canonical neighborhoods with zero
      // retained items (see greenBayNeighborhoodModel.ts's documented
      // convention). Optional.
      const emptyNeighborhoodFallbackCentroidsFlagIdx = flags.indexOf('--empty-neighborhood-fallback-centroids')
      const emptyNeighborhoodFallbackCentroids: Readonly<Record<string, { lat: number; lng: number }>> | undefined =
        emptyNeighborhoodFallbackCentroidsFlagIdx >= 0 ? readJson(flags[emptyNeighborhoodFallbackCentroidsFlagIdx + 1]) : undefined
      // --request-metro-finisher-follow-up: wires DriveMetroLaunchOptions.requestMetroFinisherFollowUp
      // (Chief Phase 3C) — explicitly requests the one permitted
      // METRO_FINISHER_DEEP_RESEARCH follow-up run. A no-op unless the
      // driver's own retry-gate in stepMetroFinisherDeepResearch decides
      // the prior attempt is actually eligible (either a report that said
      // not-ready, or a first attempt that failed validation and never
      // stored a report) — never causes an automatic loop or exceeds
      // MAX_METRO_FINISHER_RUNS by itself.
      const requestMetroFinisherFollowUp = flags.includes('--request-metro-finisher-follow-up')
      // --packet-execution-budget: MetroDriverDeps.packetExecutionBudget
      // (Chief Phase 3C, Phase A) — a JSON file of
      // { maxIncrementalSpendUsd, maxCertificationAttempts } bounding
      // METRO_FINISHER_PACKET_EXECUTION's own automatic late-add work.
      // Omit to use packetExecutionBudget.ts's DEFAULT_PACKET_EXECUTION_BUDGET
      // — always a real, per-metro-configurable input, never a hardcoded
      // constant.
      const packetExecutionBudgetFlagIdx = flags.indexOf('--packet-execution-budget')
      const packetExecutionBudget: { maxIncrementalSpendUsd: number; maxCertificationAttempts: number } | undefined = packetExecutionBudgetFlagIdx >= 0 ? readJson(flags[packetExecutionBudgetFlagIdx + 1]) : undefined
      // --neighborhood-municipality-registry: MetroDriverDeps.neighborhoodMunicipalityRegistry
      // (geographicConsistencyAudit.ts) — a JSON file of
      // { [neighborhoodName]: { municipalityAliases: string[] } } used by
      // METRO_FINISHER_PACKET_EXECUTION's NEIGHBORHOOD_PACKET migration
      // review to confirm a proposed child neighborhood from an affected
      // item's own verified address. Optional — omitting it leaves every
      // migration item honestly reported as UNRESOLVED_NO_REGISTRY rather
      // than guessed.
      const neighborhoodMunicipalityRegistryFlagIdx = flags.indexOf('--neighborhood-municipality-registry')
      const neighborhoodMunicipalityRegistry: Record<string, { municipalityAliases: string[] }> | undefined =
        neighborhoodMunicipalityRegistryFlagIdx >= 0 ? readJson(flags[neighborhoodMunicipalityRegistryFlagIdx + 1]) : undefined
      // --reopen-from-launch-boundary: wires DriveMetroLaunchOptions.reopenFromLaunchBoundary
      // (2026-09-11 Munich re-entry bug fix) — an explicit, per-invocation
      // operator override that lets driveMetroLaunch's re-entry guard pull
      // THIS run back from LAUNCH_READINESS_BOUNDARY into
      // METRO_FINISHER_PACKET_EXECUTION. Scoped to the single projectId
      // this "run" invocation already targets; never affects any other
      // metro's parked run, and is a no-op for every stage/status other
      // than exactly NEEDS_JERRY/BLOCKED at LAUNCH_READINESS_BOUNDARY —
      // see driveMetroLaunch's own doc for the full scoping guarantee.
      const reopenFromLaunchBoundary = flags.includes('--reopen-from-launch-boundary')
      const run = await driveMetroLaunch(
        { runStore, execStore: store, executors, metroAreaFacts, officialListCreatorId, flagshipListTitle, metroAreaSlug: metroSlug, existingInventorySearchTerm, canonicalNeighborhoods, emptyNeighborhoodFallbackCentroids, packetExecutionBudget, neighborhoodMunicipalityRegistry },
        projectId,
        { categoryPlan, depthTargets, autoDeriveDepthTargetsFromGeography, requestMetroFinisherFollowUp, reopenFromLaunchBoundary }
      )
      console.log(JSON.stringify(run, null, 2))
      return
    }
    if (playbookKey === 'destination_hub_lifecycle') {
      const candidateFlagIdx = flags.indexOf('--candidate')
      if (candidateFlagIdx < 0) {
        console.error('destination_hub_lifecycle requires --candidate <candidate.json>')
        process.exitCode = 1
        return
      }
      const candidate: DiscoveryCandidate & { destinationId: string; destinationName: string } = readJson(flags[candidateFlagIdx + 1])
      const run = await driveDestinationHub({ runStore, execStore: store, executors }, projectId, { candidate })
      console.log(JSON.stringify(run, null, 2))
      return
    }
    console.error(`Unknown playbook "${playbookKey}" — expected metro_launch or destination_hub_lifecycle.`)
    process.exitCode = 1
    return
  }

  if (command === 'status') {
    const [playbookKey, projectId] = rest0
    const run = await runStore.get(playbookRunId(playbookKey, projectId))
    if (!run) {
      console.error(`No playbook run for ${playbookKey}:${projectId} — has it been started with "run" yet?`)
      process.exitCode = 1
      return
    }
    console.log(JSON.stringify(run, null, 2))
    return
  }

  if (command === 'pause') {
    const [playbookKey, projectId] = rest0
    const run = await pauseRun(runStore, playbookRunId(playbookKey, projectId))
    console.log(JSON.stringify(run, null, 2))
    return
  }

  if (command === 'resume') {
    const [playbookKey, projectId] = rest0
    const run = await resumeRun(runStore, playbookRunId(playbookKey, projectId))
    console.log(JSON.stringify(run, null, 2))
    return
  }

  if (command === 'unblock') {
    // BLOCKED is reserved for retriable infrastructure/provider failures
    // (a rate limit, a timeout, a momentarily-unavailable executor) —
    // never a genuine product decision (that's NEEDS_JERRY + `decide`).
    // An operator who has judged it's safe to retry (e.g. the rate limit
    // has since reset) uses this — no decision payload, no state edit,
    // just "try again": `tsx agent-service/cli.ts unblock <playbookKey> <projectKey>`.
    const [playbookKey, projectId] = rest0
    const run = await unblockRun(runStore, playbookRunId(playbookKey, projectId))
    console.log(JSON.stringify(run, null, 2))
    return
  }

  if (command === 'reopen-stage') {
    // A methodology defect invalidated a LATER stage's output without
    // invalidating the research the run already paid for — moves
    // currentStage back and clears exactly the state keys named in
    // stateReset.json, leaving everything else (candidates, neighborhoods,
    // plan, research history, ...) untouched:
    //   tsx agent-service/cli.ts reopen-stage <playbookKey> <projectKey> <toStage> <stateReset.json>
    const [playbookKey, projectId, toStage, stateResetFile] = rest0
    const stateReset = stateResetFile ? readJson<Record<string, unknown>>(stateResetFile) : {}
    const run = await reopenStage(runStore, playbookRunId(playbookKey, projectId), toStage, stateReset)
    console.log(JSON.stringify(run, null, 2))
    return
  }

  if (command === 'decide') {
    const [playbookKey, projectId, decisionFile] = rest0
    const decision = readJson<Record<string, unknown>>(decisionFile)
    const run = await recordJerryDecision(runStore, playbookRunId(playbookKey, projectId), decision)
    console.log(JSON.stringify(run, null, 2))
    return
  }

  if (command === 'delegate') {
    const request = readJson<SpecialistExecutionRequest>(rest0[0])
    const record = await registerExecution(store, request, 'MANUAL_EXECUTOR')
    const pkg = buildManualAssignmentPackage(record.request)
    console.log(JSON.stringify({ record, assignmentPackage: pkg }, null, 2))
    return
  }

  if (command === 'execution') {
    const [sub, ...rest] = rest0
    if (sub === 'show') {
      const record = await store.get(rest[0])
      if (!record) {
        console.error(`No execution "${rest[0]}"`)
        process.exitCode = 1
        return
      }
      console.log(JSON.stringify(record, null, 2))
      return
    }
    if (sub === 'list') {
      const records = await store.all()
      console.log(
        JSON.stringify(
          records.map((r) => ({ executionId: r.request.executionId, specialist: r.request.specialist, stage: r.request.stage, status: r.status, methodology: `${r.request.methodologyId}/${r.request.methodologyVersion}` })),
          null,
          2
        )
      )
      return
    }
    if (sub === 'submit-result') {
      const record = await store.get(rest[0])
      if (!record) {
        console.error(`No execution "${rest[0]}"`)
        process.exitCode = 1
        return
      }
      const envelope = readJson<SpecialistResultEnvelope>(rest[1])
      const outcome = await acceptExecutionResult(
        store,
        {
          executionId: record.request.executionId,
          projectId: record.request.projectId,
          destinationId: record.request.destinationId,
          metroId: record.request.metroId,
          playbookKey: record.request.playbookKey,
          stage: record.request.stage,
          methodologyId: record.request.methodologyId,
          methodologyVersion: record.request.methodologyVersion,
        },
        envelope
      )
      console.log(JSON.stringify(outcome, null, 2))
      return
    }
    if (sub === 'retry') {
      const record = await retryExecution(store, rest[0])
      console.log(JSON.stringify(record, null, 2))
      return
    }
  }

  console.error(
    'Usage: tsx agent-service/cli.ts [--file] <' +
      'run <metro_launch|destination_hub_lifecycle> <projectKey> [--category-plan f.json] [--geo-depth-plan f.json] [--m0 f.json] [--candidate f.json] | ' +
      'status <playbookKey> <projectKey> | pause <playbookKey> <projectKey> | resume <playbookKey> <projectKey> | ' +
      'decide <playbookKey> <projectKey> <decision.json> | ' +
      'delegate <request.json> | execution show <id> | execution list | execution submit-result <id> <result.json> | execution retry <id>>'
  )
  process.exitCode = 1
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack || err.message) : err)
  process.exitCode = 1
})
