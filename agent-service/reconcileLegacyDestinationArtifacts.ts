#!/usr/bin/env node
// Chief Phase 2O — one-time (idempotent, safe to re-run) ingestion of
// Jerry's REAL legacy DVA-1/DVA-2/DAP research for five Destination
// opportunities that predate the destination_hub_lifecycle driver
// (Grand Lake CO, Buena Vista CO, Williams AZ, Rim Country AZ, Elkhart
// Lake WI). "We are not starting the Destination pipeline over" — every
// structured field below is transcribed verbatim from the real source
// documents Jerry supplied (see SOURCE_FILES); nothing is invented, no
// missing artifact is manufactured, and no methodology stage is
// auto-executed here (DAP generation, where still missing, is flagged
// as the recommended next action, never silently run).
//
// What this does:
//   1. Ensures one DESTINATION_HUB project exists per destination
//      (Grand Lake / Buena Vista / Rim Country already exist from Phase
//      2M's portfolio backfill; Williams AZ and Elkhart Lake WI are new).
//   2. Seeds a `destination_hub_lifecycle` PlaybookRunRecord per
//      destination (DbPlaybookRunStore, same store/pattern as the live
//      driver) with the REAL dva1/dva2/dap artifact content, each
//      carrying its real source file as `artifactRef` (this codebase's
//      own convention — see ExternalArtifactRef's doc: "a file path... a
//      pointer, deliberately not constrained further"), a real sha256
//      contentHash of the verbatim file bytes, and the file's own
//      mtime as `executedAt` (a real, verifiable fact — none of these
//      documents state their own execution date explicitly, so no
//      specific research date is invented).
//   3. Marks Rim Country (Payson–Pine–Strawberry) CLOSED/DECLINED:
//      project status -> CANCELED, the pre-existing Phase 2M follow-up
//      task transitioned to CANCELED with SUPERSESSION_PROOF evidence,
//      and one new DONE task recording Jerry's own stated fact (declined,
//      already thanked) — never a fabricated outreach/interaction record,
//      since no real Gmail message for this decline exists on file.
//
// `npx tsx agent-service/reconcileLegacyDestinationArtifacts.ts`

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { closePool, withWriteTransaction } from './db'
import { getTaskBySource } from './queries'
import { createTask, transitionTask } from './mutations'
import { DbPlaybookRunStore } from './specialists/dbPlaybookRunStore'
import { getOrCreateRun } from './specialists/playbookRun'
import { determineCanonicalStage, validateLegacyArtifactChain, checkDapStaleness, type LegacyDestinationArtifacts } from './playbooks/legacyArtifactReconciliation'
import { DESTINATION_HUB_DRIVER_PLAYBOOK_KEY } from './specialists/destinationHubDriver'
import type { DVA1Artifact, DVA2Artifact, DAPArtifact } from './playbooks/destinationHubLifecycle'

const ACTOR = 'chief'
const DOWNLOADS = '/Users/jerrystuckart/Downloads'

function sourceFile(name: string): string {
  return `${DOWNLOADS}/${name}`
}

function readVerbatim(path: string): { content: string; hash: string } {
  const content = readFileSync(path, 'utf8')
  return { content, hash: createHash('sha256').update(content).digest('hex') }
}

function fileExecutedAtIso(path: string): string {
  return statSync(path).mtime.toISOString()
}

// ---------------------------------------------------------------------------
// Real, verbatim-sourced artifact content — one block per destination.
// ---------------------------------------------------------------------------

const BUENA_VISTA_DVA2_FILE = sourceFile('dva2_buena_vista.md')
const GRAND_LAKE_DVA2_FILE = sourceFile('CheckOff_DVA-2_Grand_Lake_CO.md')
const GRAND_LAKE_DAP_FILE = sourceFile('DAP-Grand-Lake-CO.md')
const WILLIAMS_DVA2_FILE = sourceFile('CheckOff_DVA-2_Williams_AZ.md')
const WILLIAMS_DAP_FILE = sourceFile('DAP-Williams-Arizona.md')
const ELKHART_LAKE_DAP_FILE = sourceFile('DAP-Elkhart-Lake-Wisconsin.md')
const RIM_COUNTRY_DVA2_FILE = sourceFile('CheckOff_DVA-2_Payson_Pine_Strawberry.md')
const RIM_COUNTRY_DAP_FILE = sourceFile('DAP-Payson-Pine-Strawberry-AZ.md')

interface DestinationSeed {
  projectKey: string
  destinationName: string
  isNewProject: boolean
  artifacts: LegacyDestinationArtifacts
}

function buildSeeds(): DestinationSeed[] {
  const buenaVistaDva2Raw = readVerbatim(BUENA_VISTA_DVA2_FILE)
  const grandLakeDva2Raw = readVerbatim(GRAND_LAKE_DVA2_FILE)
  const grandLakeDapRaw = readVerbatim(GRAND_LAKE_DAP_FILE)
  const williamsDva2Raw = readVerbatim(WILLIAMS_DVA2_FILE)
  const williamsDapRaw = readVerbatim(WILLIAMS_DAP_FILE)
  const elkhartLakeDapRaw = readVerbatim(ELKHART_LAKE_DAP_FILE)
  const rimCountryDva2Raw = readVerbatim(RIM_COUNTRY_DVA2_FILE)
  const rimCountryDapRaw = readVerbatim(RIM_COUNTRY_DAP_FILE)

  // --- Buena Vista, CO — DVA-2 only, no DAP yet ---
  const buenaVistaDva1: DVA1Artifact = {
    provider: 'dva1_claude_project',
    destinationId: 'destination-buena-vista',
    destinationName: 'Buena Vista, CO',
    artifactRef: `${BUENA_VISTA_DVA2_FILE}#dva1-recap`,
    executedAt: fileExecutedAtIso(BUENA_VISTA_DVA2_FILE),
    contentHash: null,
    score: 82,
    recommendationText: 'Small–Established Hub; four-season draw beyond the rafting anchor; two realistic Front Range feeder metros; network flywheel potential with Salida/Leadville.',
    currentStrategyFit: 'FITS_CURRENT_STRATEGY',
  }
  const buenaVistaDva2: DVA2Artifact = {
    provider: 'dva2_claude_project',
    destinationId: 'destination-buena-vista',
    destinationName: 'Buena Vista, CO',
    artifactRef: BUENA_VISTA_DVA2_FILE,
    executedAt: fileExecutedAtIso(BUENA_VISTA_DVA2_FILE),
    contentHash: buenaVistaDva2Raw.hash,
    fullReportMarkdown: buenaVistaDva2Raw.content,
    worthPursuing: 'YES',
    recommendedPriority: 'VIABLE_CREATE_DAP_WHEN_CAPACITY_ALLOWS',
    recommendedNextStep: 'BUILD_DAP_NOW',
    rationale: 'Confirmed with meaningful new evidence: de-risked the Champion-structure question (Chaffee County DMC identified as a credible, funded, well-matched Champion) and found a citable positioning hook (the DMC\'s own marketing partner publicly calling for exactly what CheckOff offers).',
    knownRisks: [
      'Champion budget is smaller/more constrained than pricing assumes (DMC ~$480K/yr shared across vendors)',
      'Salida-bundling pressure could disrupt single-Hub sequencing',
      'No confirmed visitor-volume or spend data',
      'Thin experience inventory outside adventure/wellness',
      'Small resident/business base limits Partner-tier upside',
    ],
    consumedDva1ArtifactRef: buenaVistaDva1.artifactRef,
  }

  // --- Grand Lake, CO — DVA-2 + DAP ---
  const grandLakeDva1: DVA1Artifact = {
    provider: 'dva1_claude_project',
    destinationId: 'destination-grand-lake',
    destinationName: 'Grand Lake, CO',
    artifactRef: `${GRAND_LAKE_DVA2_FILE}#dva1-recap`,
    executedAt: fileExecutedAtIso(GRAND_LAKE_DVA2_FILE),
    contentHash: null,
    score: 90,
    recommendationText: 'Elite Candidate — RMNP western gateway + Colorado\'s largest natural lake + winter snowmobiling capital; massive captive anchor, genuine town-level discovery gap, exceptional four-season contrast, strong Denver-Metro feeder.',
    currentStrategyFit: 'FITS_CURRENT_STRATEGY',
  }
  const grandLakeDva2: DVA2Artifact = {
    provider: 'dva2_claude_project',
    destinationId: 'destination-grand-lake',
    destinationName: 'Grand Lake, CO',
    artifactRef: GRAND_LAKE_DVA2_FILE,
    executedAt: fileExecutedAtIso(GRAND_LAKE_DVA2_FILE),
    contentHash: grandLakeDva2Raw.hash,
    fullReportMarkdown: grandLakeDva2Raw.content,
    worthPursuing: 'YES',
    recommendedPriority: 'VIABLE_CREATE_DAP_WHEN_CAPACITY_ALLOWS',
    recommendedNextStep: 'HOLD_DAP_UNTIL_ISSUE_RESOLVED',
    rationale: 'Strengthened, with a revised Champion/timing picture: the Grand Lake Area Chamber is the contracted Town DMO and Visitor Center operator, but its Executive Director seat was vacant since June 2025 — a timing risk, not a disqualifier. "If the ED seat is confirmed filled, this immediately becomes a Create-DAP-now candidate."',
    knownRisks: [
      'Chamber leadership vacancy delays a decision',
      'Constrained/county-pooled funding (GCCTB, not town-controlled)',
      'Single dominant feeder (Denver); Denver Metro not yet built',
      'Free state passport (Colorado Passport Program) muddies "why pay"',
      'Snow-year volatility',
      'Two-key Town–Chamber approval could slow contracting',
    ],
    evidenceGaps: [
      'Has the Chamber filled its Executive Director role, and who is it?',
      'Does the Chamber have independent authority to sign, or does the Town co-approve?',
      'Could the Town or GCCTB co-fund or grant-support the contract?',
      'Is the Creative District interested in a dedicated Arts initiative?',
      'Are there Winter Park / Estes Park cross-promotion sensitivities to clear first?',
    ],
    consumedDva1ArtifactRef: grandLakeDva1.artifactRef,
  }
  const grandLakeDap: DAPArtifact = {
    provider: 'dap_claude_project',
    destinationId: 'destination-grand-lake',
    destinationName: 'Grand Lake, CO',
    artifactRef: GRAND_LAKE_DAP_FILE,
    executedAt: fileExecutedAtIso(GRAND_LAKE_DAP_FILE),
    contentHash: grandLakeDapRaw.hash,
    fullReportMarkdown: grandLakeDapRaw.content,
    consumedDva2ArtifactRef: grandLakeDva2.artifactRef,
    extracted: {
      recommendedChampion: 'Grand Lake Area Chamber of Commerce',
      secondaryChampions: ['Town of Grand Lake'],
      decisionMakers: ['Sara Sable (Executive Director)', 'Patrick Randall (Board President)'],
      stakeholderOrganizations: ['Town of Grand Lake', 'Grand County Colorado Tourism Board (GCCTB)', 'Grand Lake Creative District / Grand Arts Council', 'Trail Groomers / Mile Hi Snowmobile Club'],
      fundingBudgetClues: ['Chamber budget envelope ~$378K–$502K (2024 990)', 'County-pooled 2% lodging tax via GCCTB (~$2.2M)'],
      likelyBuyer: 'Grand Lake Area Chamber of Commerce (Sara Sable, ED)',
      estimatedSalesDifficulty: null,
      timingConsiderations: [
        'Primary gate cleared: Sara Sable hired as ED (previously vacant since 6/2025)',
        'Mid-August is peak summer — Chamber operationally overloaded; substantive marketing conversation lands best in fall off-season',
        'Tourism Commission meets monthly; Village Board 1st & 3rd Mondays',
        'Constitution Week (mid-Sept) is a natural reference/timing hook',
      ],
      politicalStakeholderComplexity: null,
      objectionsHurdles: [
        'No ED to own this (now resolved — Sara Sable hired)',
        'The state passport is free — why pay?',
        'Budget is tight and tax money is county-pooled',
        'The Town/County would need to weigh in',
        'Bad snow years hurt us',
      ],
      destinationPainPoints: ['Quiet west-entrance RMNP traffic never discovers the town/lake/arts scene', 'Severe seasonal swing / weak shoulders'],
      checkoffValueProposition: 'The tool that turns quiet west-entrance park traffic into town discovery and gives past visitors a real reason to come back in a different season.',
      recommendedEntryStrategy: 'Warm-path entry via Board President Patrick Randall, introducing to new ED Sara Sable; low-key relationship-building now, formal proposal paced to the fall off-season planning window.',
      relationshipSequence: [
        '2026-08-18: Send a short, warm, no-ask congratulations note to the Chamber (board@grandlakechamber.com / Patrick Randall) acknowledging Sara Sable\'s arrival — no deck, no pricing, no attachment.',
        '2026-08-27: WAIT — no follow-up, respect peak season.',
        '2026-09-02: Light, destination-specific follow-up (west-entrance discovery gap / summer-winter story); ask for a short chat "once summer winds down."',
        '2026-09-08: WAIT if no reply.',
        '2026-09-15: Gentle nudge tied to Constitution Week; offer two specific fall dates for a 30-min call.',
      ],
      recommendedOfferDirection: 'Standard Champion ~$13,500/yr (range $12,000–$15,000); Founder Year 1 $8,775 (35% off); Founder renewal $10,125 (25% off then-current standard).',
      rightNowTask: {
        currentStage: 'Relationship Building (Milestone 1) — primary timing gate just cleared',
        currentGoal: "Get on the new ED's radar warmly, before pitching anything.",
        highestPriorityTask: 'Send a short, warm, no-ask introduction note to the Grand Lake Chamber (via Board President Patrick Randall / board@grandlakechamber.com), congratulating them on Sara Sable joining as ED. No deck, no pricing, no attachment.',
        targetDate: '2026-08-18',
        estimatedTime: '45 minutes',
        expectedResult: 'A human first impression that opens the door to a fall discovery conversation.',
        whyItMatters: 'The one condition DVA-2 set for starting — a filled ED seat — is now met. Everything downstream depends on a warm, patient first touch with the new leader while she is still finding her feet in peak season.',
      },
    },
  }

  // --- Williams, AZ — DVA-2 + DAP ---
  const williamsDva1: DVA1Artifact = {
    provider: 'dva1_claude_project',
    destinationId: 'destination-williams-az',
    destinationName: 'Williams, AZ',
    artifactRef: `${WILLIAMS_DVA2_FILE}#dva1-recap`,
    executedAt: fileExecutedAtIso(WILLIAMS_DVA2_FILE),
    contentHash: null,
    score: 92,
    recommendationText: 'Elite Candidate — Grand Canyon gateway + Route 66 mountain town; ~5M corridor travelers/yr, severe pass-through discovery gap, genuine four-season change, in-network Phoenix feeder, compact activation-rich downtown.',
    currentStrategyFit: 'FITS_CURRENT_STRATEGY',
  }
  const williamsDva2: DVA2Artifact = {
    provider: 'dva2_claude_project',
    destinationId: 'destination-williams-az',
    destinationName: 'Williams, AZ',
    artifactRef: WILLIAMS_DVA2_FILE,
    executedAt: fileExecutedAtIso(WILLIAMS_DVA2_FILE),
    contentHash: williamsDva2Raw.hash,
    fullReportMarkdown: williamsDva2Raw.content,
    worthPursuing: 'YES',
    recommendedPriority: 'HIGH_PRIORITY_CREATE_DAP',
    recommendedNextStep: 'BUILD_DAP_NOW',
    rationale: 'Strengthened — inventory validated at the strong end (50–80), seasonality confirmed excellent, activation readiness High, and a clear (if two-key Chamber/City) Champion identified.',
    knownRisks: [
      'Two-key funding ambiguity (Chamber vs City)',
      'Anchor complacency ("we\'re already marketed")',
      'Pass-through behavior resists conversion',
      'Chamber leadership/staffing data is dated',
      '2026 Centennial staff bandwidth',
    ],
    consumedDva1ArtifactRef: williamsDva1.artifactRef,
  }
  const williamsDap: DAPArtifact = {
    provider: 'dap_claude_project',
    destinationId: 'destination-williams-az',
    destinationName: 'Williams, AZ',
    artifactRef: WILLIAMS_DAP_FILE,
    executedAt: fileExecutedAtIso(WILLIAMS_DAP_FILE),
    contentHash: williamsDapRaw.hash,
    fullReportMarkdown: williamsDapRaw.content,
    consumedDva2ArtifactRef: williamsDva2.artifactRef,
    extracted: {
      recommendedChampion: 'Williams-Grand Canyon Chamber of Commerce ("Experience Williams")',
      secondaryChampions: ['City of Williams (Tourism/Recreation/Visitor Center)'],
      decisionMakers: ['Chamber Executive Director (name dated/unverified — Thomas P. Kelley / Donna Cochran per stale public data)'],
      stakeholderOrganizations: ['City of Williams', 'Grand Canyon Railway / Xanterra', 'Bearizona', 'Canyon Coaster Adventure Park', 'Route 66 heritage / event organizers'],
      fundingBudgetClues: ['City hotel/bed tax raised to 5.5% (Jan 2024)', 'Chamber membership + guide revenue'],
      likelyBuyer: 'Williams-Grand Canyon Chamber of Commerce',
      estimatedSalesDifficulty: null,
      timingConsiderations: [
        '2026 Route 66 Centennial — highest-value, time-boxed acquisition hook',
        'Winter/holiday (Polar Express) planning ramps in early fall',
        'City fiscal-year budget cycle relevant only if City co-funds',
        'Recently raised 5.5% bed tax signals active funding appetite',
      ],
      politicalStakeholderComplexity: null,
      objectionsHurdles: [
        'The train and Bearizona already market themselves',
        'We already have a website and a guide',
        'Who actually pays — us or the City?',
        'Will it really change pass-through behavior?',
        'We\'re slammed with Centennial planning',
      ],
      destinationPainPoints: ['Pass-through / low local dwell beyond the railway and Bearizona', 'Fragmented discovery across City/Chamber/attraction sites'],
      checkoffValueProposition: 'Williams captures millions of Grand-Canyon-bound travelers, but most book the train and never discover the coaster, breweries, wine room, lakes, or heritage — 2026 is the moment to fix that.',
      recommendedEntryStrategy: 'Chamber-led Champion agreement with City activation/co-funding support; verify the current Chamber ED before first touch (public data is dated).',
      relationshipSequence: [
        '2026-08-15: Verify current Chamber ED/decision-maker and best contact channel; confirm City Visitor Center/events contact.',
        '2026-08-19: First touch to Chamber ED — short, warm, Williams-specific, Centennial-anchored; no pricing/deck/attachment.',
        '2026-08-29: Light follow-up if no reply — one concrete generous idea.',
        '2026-09-10: Second follow-up via alternate channel if still silent; offer two specific short call windows.',
      ],
      recommendedOfferDirection: 'Standard Champion ~$16,000/yr (range $14,000–$18,000); Founder Year 1 $10,400 (35% off); Founder renewal $12,000 (25% off then-current standard).',
      rightNowTask: {
        currentStage: 'Relationship Building (pre-first touch)',
        currentGoal: 'Reach the right Chamber decision-maker with a Centennial-anchored first touch',
        highestPriorityTask: 'Verify the current Williams-Grand Canyon Chamber ("Experience Williams") Executive Director / decision-maker and best contact channel (public data naming Thomas P. Kelley / Donna Cochran is dated and must be re-verified).',
        targetDate: '2026-08-15',
        estimatedTime: '1–2 hours',
        expectedResult: 'A confirmed name and contact channel, so the first touch reaches a real decision-maker.',
        whyItMatters: 'Everything downstream depends on targeting the correct human; a first touch to a stale/wrong contact wastes the single best cold-open moment and the Centennial timing hook.',
      },
    },
  }

  // --- Elkhart Lake, WI — DAP only (raw DVA-2 not independently supplied) ---
  const elkhartLakeDap: DAPArtifact = {
    provider: 'dap_claude_project',
    destinationId: 'destination-elkhart-lake-wi',
    destinationName: 'Elkhart Lake, WI',
    artifactRef: ELKHART_LAKE_DAP_FILE,
    executedAt: fileExecutedAtIso(ELKHART_LAKE_DAP_FILE),
    contentHash: elkhartLakeDapRaw.hash,
    fullReportMarkdown: elkhartLakeDapRaw.content,
    // No independently supplied DVA-2 artifactRef exists to consume — flagged
    // explicitly (see validateLegacyArtifactChain's WARNING for this shape).
    // Using this DAP's own file as a stand-in ref would falsely claim a
    // DVA-2 chain link that doesn't exist; leaving it honestly pointed at
    // "no DVA-2 file supplied" instead.
    consumedDva2ArtifactRef: 'NO_DVA2_ARTIFACT_SUPPLIED',
    extracted: {
      recommendedChampion: 'Elkhart Lake Tourism (municipal DMO)',
      secondaryChampions: [],
      decisionMakers: ['Kathleen Eickhoff (Executive/Tourism Director)', 'Laura Kobes (Advertising & Promotions Coordinator)'],
      stakeholderOrganizations: ['Road America', 'The Osthoff Resort', 'Visit Sheboygan County', 'Elkhart Lake Chamber of Commerce', 'Travel Wisconsin'],
      fundingBudgetClues: ['Room-tax-funded municipal DMO', 'JEM grant co-funding motion familiar to the DMO'],
      likelyBuyer: 'Elkhart Lake Tourism (Kathleen Eickhoff)',
      estimatedSalesDifficulty: null,
      timingConsiderations: [
        'Mid-August is mid-peak-season (racing + lake) — decision-makers busy',
        'Fall/winter build-ahead planning window opens as peak traffic winds down',
        'Tourism Commission meets monthly; Village Board 1st & 3rd Mondays',
        'JEM grant cycle eases the budget path',
      ],
      politicalStakeholderComplexity: null,
      objectionsHurdles: [
        'Road America already brings everyone',
        'We already have ElkhartLake.com, a guide, and the Depot Dispatch',
        'Is this just a free WATA-style passport?',
        "We're a 2-person office — who manages it?",
        'Budget is room-tax and Commission-approved',
      ],
      destinationPainPoints: ['Road America draws ~800,000 visitors/yr who mostly never discover the walkable resort village beyond the track', 'Event-spiked base and soft mid-week/shoulder periods'],
      checkoffValueProposition: 'You bring 800,000 people to Road America every year — how many of them ever discover the village?',
      recommendedEntryStrategy: 'Considerate cold outreach to Kathleen Eickhoff (Tourism Director), softer secondary entry via Laura Kobes; DMO-led partnership structure (no chamber/joint structure needed).',
      relationshipSequence: [
        '2026-08-18: Send a short, warm first-touch email to Kathleen Eickhoff — lead with the village discovery gap, not product/pricing.',
        '2026-09-02: Gentle follow-up with a new concrete hook (off-season discovery layer); offer two 20-min call windows.',
        '2026-09-12: If no reply, one final short nudge or pivot to Laura Kobes.',
      ],
      recommendedOfferDirection: 'Standard Champion ~$17,500/yr (range $15K–$20K); Founder Year 1 $11,375 (35% off); Founder renewal $13,125 (25% off then-current standard).',
      rightNowTask: {
        currentStage: 'Relationship Building (pre-first-touch)',
        currentGoal: 'Get a low-pressure discovery-gap idea onto the DMO director\'s radar without disrupting her peak season.',
        highestPriorityTask: 'Send the first-touch email to Kathleen Eickhoff (Tourism Director) — warm, specific, discovery-gap angle, no pricing, no deck.',
        targetDate: '2026-08-18',
        estimatedTime: '30–45 minutes',
        expectedResult: 'A sent email that plants the village-discovery idea and opens the door to a fall discovery meeting.',
        whyItMatters: 'Everything downstream depends on trust that has to start building now, while there is runway before the fall planning and budget window.',
      },
    },
  }

  // --- Rim Country (Payson–Pine–Strawberry), AZ — DVA-2 + DAP, DECLINED ---
  const rimCountryDva1: DVA1Artifact = {
    provider: 'dva1_claude_project',
    destinationId: 'destination-rim-country',
    destinationName: 'Rim Country (Payson–Pine–Strawberry), AZ',
    artifactRef: `${RIM_COUNTRY_DVA2_FILE}#dva1-recap`,
    executedAt: fileExecutedAtIso(RIM_COUNTRY_DVA2_FILE),
    contentHash: null,
    score: 89,
    recommendationText: 'Excellent Candidate — cool-pine climate escape + forest recreation + historic Main Street; elite Phoenix feeder access, genuine four-season repeat potential, real multi-town discovery gap.',
    currentStrategyFit: 'FITS_CURRENT_STRATEGY',
  }
  const rimCountryDva2: DVA2Artifact = {
    provider: 'dva2_claude_project',
    destinationId: 'destination-rim-country',
    destinationName: 'Rim Country (Payson–Pine–Strawberry), AZ',
    artifactRef: RIM_COUNTRY_DVA2_FILE,
    executedAt: fileExecutedAtIso(RIM_COUNTRY_DVA2_FILE),
    contentHash: rimCountryDva2Raw.hash,
    fullReportMarkdown: rimCountryDva2Raw.content,
    worthPursuing: 'YES',
    recommendedPriority: 'HIGH_PRIORITY_CREATE_DAP',
    recommendedNextStep: 'BUILD_DAP_NOW',
    rationale: 'Strengthened — the feared "fragmented Champion" is materially cleaner (a regional Chamber spans all three towns; the Town owns a funded, data-backed growth mandate via an 18-month, 173,000-phone Visitor Impact Report validating the exact problem CheckOff solves).',
    knownRisks: [
      'Multi-zone coordination (Town vs PSBC vs Chamber)',
      'Small-municipality budget timing',
      'Champion ambiguity (Town vs Chamber)',
      'Winter seasonal thinning (esp. Pine/Strawberry)',
      'Sophisticated buyer expects measurable ROI',
    ],
    consumedDva1ArtifactRef: rimCountryDva1.artifactRef,
  }
  const rimCountryDap: DAPArtifact = {
    provider: 'dap_claude_project',
    destinationId: 'destination-rim-country',
    destinationName: 'Rim Country (Payson–Pine–Strawberry), AZ',
    artifactRef: RIM_COUNTRY_DAP_FILE,
    executedAt: fileExecutedAtIso(RIM_COUNTRY_DAP_FILE),
    contentHash: rimCountryDapRaw.hash,
    fullReportMarkdown: rimCountryDapRaw.content,
    consumedDva2ArtifactRef: rimCountryDva2.artifactRef,
    extracted: {
      recommendedChampion: 'Town of Payson Economic Development / Tourism (Adventure Payson)',
      secondaryChampions: ['Rim Country Regional Chamber of Commerce', 'Pine Strawberry Business Community (PSBC)'],
      decisionMakers: ['Town Manager Darren Coldwell', 'Sharon Rueckert (Chamber Executive Director)'],
      stakeholderOrganizations: ['Pine Strawberry Business Community (PSBC)', 'Rim Country Regional Chamber', 'AZ State Parks / Tonto NF / AZ Game & Fish'],
      fundingBudgetClues: ['5% bed tax (Payson)'],
      likelyBuyer: 'Town of Payson Economic Development / Tourism',
      estimatedSalesDifficulty: null,
      timingConsiderations: [
        'ED seat vacant since June 23, 2026 (Martinez resigned) — staffing-transition moment',
        'Arizona municipal FY budgets finalize late spring for a July 1 fiscal year — realistic budget runway is FY2027–28',
        'Western Heritage & Film Festival (Aug 10–18, 2026) and Labor Day as natural launch anchors',
      ],
      politicalStakeholderComplexity: 'HIGH',
      objectionsHurdles: [
        'We already fund a website, social, and a marketing firm',
        'We just paid for the Visitor Impact Report',
        'How are Pine and Strawberry represented?',
        "We're mid-transition / budget's set",
      ],
      destinationPainPoints: ['Visitors treat Payson as a pass-through/commercial stop (trail visitors stay 5–6 days vs ≤2 days commercial-only)', 'Discovery gap across three under-connected towns'],
      checkoffValueProposition: 'CheckOff is the ready-made execution layer for a strategy the Town has already adopted and paid to validate.',
      recommendedEntryStrategy: 'Enter through the institution (the strategy + Visitor Impact Report outlive the person), not the vacant ED seat; confirm current mandate-owner first, run the Chamber in parallel as a warm-intro/fallback path.',
      relationshipSequence: [
        '2026-09-08: Confirm current staffing — who is Acting ED / who owns tourism strategy post-Martinez.',
        '2026-09-11: Low-key first-touch email to the confirmed tourism/econ-dev contact, tied to the Visitor Impact Report findings.',
        '2026-09-21: Light, additive follow-up with a concrete Rim Country example.',
        '2026-09-22: Parallel soft touch to Sharon Rueckert (Chamber) as fallback/co-Champion.',
      ],
      recommendedOfferDirection: 'Standard Champion ~$18,000/yr; Founder Year 1 $11,700 (35% off); Founder renewal $13,500 (25% off then-current standard); PSBC Partner initiative $2,000–$4,000.',
      rightNowTask: {
        currentStage: 'Pre-outreach / relationship building',
        currentGoal: 'Replace the vacant named champion (Martinez) with the real current mandate-owner before any pitch.',
        highestPriorityTask: 'Call Payson Town Hall and check paysonaz.gov to confirm who currently owns the tourism/economic-development mandate after the June 23 ED resignation.',
        targetDate: '2026-09-08',
        estimatedTime: '1–2 hours',
        expectedResult: 'A verified, named current contact to open with — not a resigned director and not a generic inbox.',
        whyItMatters: "DVA-2's entire acquisition plan was built around a person who no longer works there.",
      },
    },
  }

  return [
    { projectKey: 'destination-buena-vista', destinationName: 'Buena Vista, CO', isNewProject: false, artifacts: { destinationId: 'destination-buena-vista', destinationName: 'Buena Vista, CO', dva1: buenaVistaDva1, dva2: buenaVistaDva2, provenance: { dva1: { sourceFile: buenaVistaDva1.artifactRef, ingestedAt: new Date().toISOString(), documentDate: null }, dva2: { sourceFile: BUENA_VISTA_DVA2_FILE, ingestedAt: new Date().toISOString(), documentDate: null } } } },
    { projectKey: 'destination-grand-lake', destinationName: 'Grand Lake, CO', isNewProject: false, artifacts: { destinationId: 'destination-grand-lake', destinationName: 'Grand Lake, CO', dva1: grandLakeDva1, dva2: grandLakeDva2, dap: grandLakeDap, provenance: { dva1: { sourceFile: grandLakeDva1.artifactRef, ingestedAt: new Date().toISOString(), documentDate: null }, dva2: { sourceFile: GRAND_LAKE_DVA2_FILE, ingestedAt: new Date().toISOString(), documentDate: null }, dap: { sourceFile: GRAND_LAKE_DAP_FILE, ingestedAt: new Date().toISOString(), documentDate: '2026-08-16' } } } },
    { projectKey: 'destination-williams-az', destinationName: 'Williams, AZ', isNewProject: true, artifacts: { destinationId: 'destination-williams-az', destinationName: 'Williams, AZ', dva1: williamsDva1, dva2: williamsDva2, dap: williamsDap, provenance: { dva1: { sourceFile: williamsDva1.artifactRef, ingestedAt: new Date().toISOString(), documentDate: null }, dva2: { sourceFile: WILLIAMS_DVA2_FILE, ingestedAt: new Date().toISOString(), documentDate: null }, dap: { sourceFile: WILLIAMS_DAP_FILE, ingestedAt: new Date().toISOString(), documentDate: '2026-08-15' } } } },
    { projectKey: 'destination-elkhart-lake-wi', destinationName: 'Elkhart Lake, WI', isNewProject: true, artifacts: { destinationId: 'destination-elkhart-lake-wi', destinationName: 'Elkhart Lake, WI', dap: elkhartLakeDap, provenance: { dap: { sourceFile: ELKHART_LAKE_DAP_FILE, ingestedAt: new Date().toISOString(), documentDate: '2026-08-15' } } } },
    { projectKey: 'destination-rim-country', destinationName: 'Rim Country (Payson–Pine–Strawberry), AZ', isNewProject: false, artifacts: { destinationId: 'destination-rim-country', destinationName: 'Rim Country (Payson–Pine–Strawberry), AZ', dva1: rimCountryDva1, dva2: rimCountryDva2, dap: rimCountryDap, provenance: { dva1: { sourceFile: rimCountryDva1.artifactRef, ingestedAt: new Date().toISOString(), documentDate: null }, dva2: { sourceFile: RIM_COUNTRY_DVA2_FILE, ingestedAt: new Date().toISOString(), documentDate: null }, dap: { sourceFile: RIM_COUNTRY_DAP_FILE, ingestedAt: new Date().toISOString(), documentDate: '2026-08-14' } } } },
  ]
}

async function ensureProject(projectKey: string, name: string): Promise<void> {
  await withWriteTransaction(async (client) => {
    await client.query(
      `INSERT INTO agent.projects (project_key, name, project_type, status, summary, owner_id)
       SELECT $1, $2, 'DESTINATION_HUB', 'ACTIVE', $3, (SELECT owner_id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1')
       WHERE NOT EXISTS (SELECT 1 FROM agent.projects WHERE project_key = $1)`,
      [projectKey, name, `Legacy DVA/DAP research destination, ingested via Phase 2O reconciliation (reconcileLegacyDestinationArtifacts.ts).`]
    )
  })
}

async function main(): Promise<void> {
  const seeds = buildSeeds()
  const runStore = new DbPlaybookRunStore()

  for (const seed of seeds) {
    if (seed.isNewProject) await ensureProject(seed.projectKey, seed.destinationName)

    const determination = determineCanonicalStage(seed.artifacts)
    const chainIssues = validateLegacyArtifactChain(seed.artifacts)
    const staleness = seed.artifacts.dap ? checkDapStaleness(seed.artifacts.dap, new Date().toISOString()) : null

    const run = await getOrCreateRun(runStore, DESTINATION_HUB_DRIVER_PLAYBOOK_KEY, seed.projectKey, 'D0_DISCOVERY')
    run.state = {
      candidate: { destinationId: seed.projectKey, destinationName: seed.destinationName },
      dva1: seed.artifacts.dva1 ?? null,
      dva2: seed.artifacts.dva2 ?? null,
      dap: seed.artifacts.dap ?? null,
      legacyReconciliation: {
        canonicalStage: determination.canonicalStage,
        nextMissingStage: determination.nextMissingStage,
        reason: determination.reason,
        sufficientForRelationshipReadiness: determination.sufficientForRelationshipReadiness,
        chainIssues,
        dapStaleness: staleness,
        provenance: seed.artifacts.provenance,
        reconciledAt: new Date().toISOString(),
      },
    }
    run.currentStage = determination.canonicalStage === 'DAP_COMPLETE' ? 'D6_STAKEHOLDER_RESEARCH' : determination.canonicalStage === 'DVA2_COMPLETE' ? 'D4_DAP' : determination.canonicalStage === 'DVA1_COMPLETE' ? 'D2_DVA1' : 'D0_DISCOVERY'
    await runStore.put(run)

    console.log(`[reconcile] ${seed.destinationName} (${seed.projectKey}): canonicalStage=${determination.canonicalStage} nextMissingStage=${determination.nextMissingStage ?? 'none'} chainIssues=${chainIssues.length} stale=${staleness?.stale ?? 'n/a'}`)
  }

  // --- Rim Country: mark CLOSED/DECLINED ---
  await withWriteTransaction(async (client) => {
    await client.query(`UPDATE agent.projects SET status = 'CANCELED' WHERE project_key = 'destination-rim-country' AND status <> 'CANCELED'`)
  })

  const rimCountryFollowUp = await getTaskBySource('bootstrap_v1', 'destination-rim-country-followup')
  if (rimCountryFollowUp && rimCountryFollowUp.status !== 'CANCELED' && rimCountryFollowUp.status !== 'DONE') {
    await transitionTask({
      taskId: rimCountryFollowUp.id,
      toStatus: 'CANCELED',
      actorOwnerKey: ACTOR,
      expectedUpdatedAt: rimCountryFollowUp.updatedAt,
      cancellationReason: "Per Jerry (2026-09-05): Rim Country was previously pursued and declined; Jerry already thanked the destination's contacts. Do not reopen.",
      idempotencyKey: 'rim-country-declined-2026-09-05',
      reconciliation: { evidenceCategory: 'SUPERSESSION_PROOF', evidenceSources: ['jerry:statement:2026-09-05'], evidenceSummary: 'Jerry explicitly declined the Rim Country opportunity and already thanked the contacts — the pursuit goal is superseded by that real-world decision.' },
    })
    console.log('[reconcile] Rim Country follow-up task: transitioned to CANCELED')
  } else {
    console.log(`[reconcile] Rim Country follow-up task: ${rimCountryFollowUp ? `already ${rimCountryFollowUp.status}` : 'not found'}`)
  }

  const declineResult = await createTask({
    title: 'Rim Country (Payson–Pine–Strawberry) — declined, contacts already thanked',
    projectKey: 'destination-rim-country',
    status: 'DONE',
    changedByOwnerKey: ACTOR,
    ownerKey: ACTOR,
    description:
      "Per Jerry (2026-09-05): this destination was previously pursued and declined; Jerry already thanked the destination's contacts. No real Gmail/interaction record for the decline itself is on file — this task records Jerry's own stated fact, not a fabricated outreach record. The full DVA-2 and DAP research remain on file (see the destination_hub_lifecycle playbook run) for reference only; do not reopen or resume pursuit.",
    nextAction: 'None — closed. Do not reopen.',
    sourceType: 'destination_decline',
    sourceRef: 'rim-country-declined-2026-09-05',
  })
  console.log(`[reconcile] Rim Country decline record: ${declineResult.created ? 'created' : 'already existed'} (task ${declineResult.task.id})`)
}

main()
  .catch((err) => {
    console.error('[agent-service/reconcileLegacyDestinationArtifacts] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
