// agent-service/playbooks/itemCertificationLoop.ts
//
// Chief Phase 2V — ITEM_CERTIFICATION_LOOP, permanent per-item metro
// pipeline stage. Converted from Jerry's 2026-09-07 correction: even
// after multiple editorial passes and a batch EDITORIAL_GATE PASS, he
// manually rewrote another ~15-20 San Diego items because individual
// rows were still generic, obvious, or didn't capture the actual
// memorable thing at the venue. Batch-level gates (metroCatalog.ts's
// EDITORIAL_GATE, editorialDistinctiveness.ts's DISTINCTIVE_EXPERIENCE_GATE)
// are necessary but NOT sufficient — this module makes each candidate
// item its own bounded research/editorial/critique problem, so a
// catalog-wide PASS is no longer the only quality checkpoint an item has
// to clear before it enters the final metro.
//
// Pure orchestration only — same discipline as every driver in this
// repo (destinationRelationshipDriver.ts, destinationHubDriver.ts): this
// module has no AI/HTTP calls of its own. Every real step (venue
// research, hook selection, currency verification, OpenAI CheckOff
// editorial, independent critique) is an injected async function the
// caller supplies (backed by the real executor/routing layer, or a
// TestExecutor-style fake in tests) — this module owns only the LOOP
// SHAPE: identify -> read evidence -> ask the distinctive-thing question
// -> targeted research if insufficient -> select hook -> verify current
// -> write -> critique -> repair-and-retry within a bound -> certify.
//
// Research cost is explicitly NOT optimized away here: `runItemCertificationLoop`
// makes one full pass (research if needed, write, critique) PER ATTEMPT,
// per item — Jerry's explicit instruction is to prefer more research/
// model calls per venue over a larger mediocre catalog, and this module
// never batches multiple venues into one write/critique call.

import type { StagingGateResult } from './metroCatalog'
import { checkDistinctiveExperience, checkVenueQuoted } from './editorialDistinctiveness'

// ---------------------------------------------------------------------------
// Evidence + hook shapes — also the permanent per-item research-artifact
// record ("preserve enough structured evidence... to repair one bad item
// later without rerunning the entire metro").
// ---------------------------------------------------------------------------

export interface ResearchFact {
  fact: string
  sourceUrl: string | null
  sourceDescription: string
}

export interface VenueResearchEvidence {
  venueName: string
  facts: ResearchFact[]
  /** True once at least one targeted (not just broad-discovery) research pass has run for THIS venue specifically. */
  targetedResearchPerformed: boolean
}

export interface HookCandidate {
  hookText: string
  supportingFact: ResearchFact
  /** Why this hook was chosen over other candidates, or why a rejected candidate was set aside — kept even for the winning hook, since it's useful provenance. */
  reasoning: string
}

export interface HookCurrencyCheck {
  current: boolean
  reason: string
  checkedAt: string
}

// ---------------------------------------------------------------------------
// The 9 individual certification questions — Jerry's exact list. Two are
// deterministically checkable (reused from editorialDistinctiveness.ts,
// never reimplemented); the rest require the injected critique step's
// own judgment (an OpenAI critique call in production, a scripted fake
// in tests) since "is this supported by research," "is it current," and
// "does it sound like CheckOff" are not regex-checkable facts.
// ---------------------------------------------------------------------------

export interface ItemCritiqueAnswers {
  hasConcreteAction: boolean
  moreSpecificThanVenuePurpose: boolean
  supportedByResearch: boolean
  isCurrent: boolean
  /** "swap the venue name with 10 competitors" — deterministically re-derived from checkDistinctiveExperience() below, never asked of the critique step as a free-form question. */
  tellsUsefulNonObviousDetail: boolean
  soundsLikeCheckoff: boolean
  concise: boolean
  critiqueNotes: string
}

export interface ItemCritiqueResult {
  answers: ItemCritiqueAnswers
  /** Deterministic sub-checks, computed by this module, never left to the AI critique step to self-report (an AI grading its own quoting/swap-test compliance is exactly the kind of thing this repo's philosophy keeps out of AI hands — see categoryNormalization.ts's own doc). */
  swapTestPasses: boolean
  venueQuoted: boolean
  pass: boolean
  failureReasons: string[]
}

/**
 * Combines the AI critique's judgment answers with the two deterministic
 * checks this module owns directly (distinctive-experience swap test,
 * venue quoting) into one PASS/FAIL verdict. ANY false answer fails
 * certification — there is no partial credit, matching "if not, it does
 * not certify."
 */
export function evaluateItemCritique(body: string, venueName: string, answers: ItemCritiqueAnswers): ItemCritiqueResult {
  const distinctiveness = checkDistinctiveExperience(body, venueName)
  const quoting = checkVenueQuoted(body, venueName)

  const checks: Array<[string, boolean]> = [
    ['concrete thing to do/order/find/see/ride/photograph/attend/experience', answers.hasConcreteAction],
    ['more specific than the venue\'s general purpose', answers.moreSpecificThanVenuePurpose],
    ['supported by research', answers.supportedByResearch],
    ['current', answers.isCurrent],
    ['swap-10-competitors test (venue name swap would make the sentence nonsensical/wrong)', distinctiveness.pass],
    ['tells a visitor something useful they would not know from the category alone', answers.tellsUsefulNonObviousDetail],
    ['sounds like CheckOff, not tourism-board/Google-Maps copy', answers.soundsLikeCheckoff],
    ['destination venue wrapped in single quotes', quoting.pass],
    ['concise enough for the app', answers.concise],
  ]

  const failureReasons = checks.filter(([, ok]) => !ok).map(([label]) => label)
  return {
    answers,
    swapTestPasses: distinctiveness.pass,
    venueQuoted: quoting.pass,
    pass: failureReasons.length === 0,
    failureReasons,
  }
}

// ---------------------------------------------------------------------------
// The bounded loop itself.
// ---------------------------------------------------------------------------

/**
 * The three REJECTED_* pruning outcomes (Chief Phase 2AD) are set only by
 * metroLaunchDriver.ts's M8.5 CATALOG_PRUNING stage, never by this loop —
 * they cover an item that reached ITEM_CERTIFIED here (a genuine,
 * distinctive, well-written body) but could not clear a LATER batch gate
 * (tag/geo/metadata) even after that gate's own bounded repair pass. Kept
 * in this union (rather than a separate driver-only type) so every
 * ITEM_CERTIFICATION_GATE/reporting call site that already switches on
 * `outcome` sees the real, final disposition of every candidate.
 */
export type ItemCertificationOutcome =
  | 'ITEM_CERTIFIED'
  | 'REJECTED_NO_DISTINCTIVE_EXPERIENCE'
  | 'EXHAUSTED_RETRIES'
  | 'REJECTED_GEO_UNRESOLVED'
  | 'REJECTED_INSUFFICIENT_TAG_CONTEXT'
  | 'REJECTED_UNCLASSIFIABLE_METADATA'
  /**
   * Chief Phase 2AG (2026-09-09 instruction) — a final human-directed
   * semantic cleanup pass on an already-frozen certified catalog: two
   * (or more) candidates turned out, on manual review cross-referencing
   * Google placeId/address, to be the SAME real venue offering
   * essentially the SAME CheckOff experience. The weaker duplicate is
   * rejected here; the stronger one keeps ITEM_CERTIFIED untouched. When
   * the same venue instead supports genuinely distinct experiences, both
   * are kept — this outcome is never used to collapse those. Set by a
   * one-off audit script, never a new automated pipeline stage (the
   * judgment call — "same experience" vs "distinct experience" — is not
   * something this codebase claims to have made deterministic).
   */
  | 'REJECTED_DUPLICATE_VENUE'
  /**
   * Chief Phase 2AG — the same kind of final human-directed cleanup pass
   * as REJECTED_DUPLICATE_VENUE, but for a candidate that is not a
   * launch-quality visitor-facing CheckOff item at all: a closed/
   * renovating venue presented as bookable, a civic/social-service task,
   * a vague district-wide placeholder, a multi-venue mashup that is not
   * one coherent destination, or a generic "walk through the park"-style
   * body with no distinctive fact or hook. Never used to weaken any
   * automated gate — this is a manual editorial judgment recorded with
   * its specific reason in rejectionReasons.
   */
  | 'REJECTED_NOT_LAUNCH_QUALITY'
  /**
   * Chief Phase 2AH (2026-09-10 instruction, Green Bay contamination
   * incident) — OUT_OF_MARKET_CONTAMINATION_GATE dropped this candidate
   * because its venue/address genuinely belongs to a DIFFERENT metro's
   * known geography (e.g. a Carlsbad/Chula Vista venue surfacing inside a
   * Green Bay build after a targeted-gap-research call literally asked
   * for candidates in a wrong-metro neighborhood name). Never repaired —
   * there is no legitimate way to turn a wrong-city venue into a right-
   * city one, so this is always a drop, never a retry.
   */
  | 'REJECTED_OUT_OF_MARKET'

export interface ItemCertificationRecord {
  venueName: string
  attempts: number
  outcome: ItemCertificationOutcome
  chosenHook: HookCandidate | null
  rejectedHooks: HookCandidate[]
  finalBody: string | null
  currencyCheck: HookCurrencyCheck | null
  lastCritique: ItemCritiqueResult | null
  /** Every attempt's own critique — the durable per-item audit trail so a future repair pass can see exactly what was tried and why it failed, without rerunning research from scratch. */
  history: Array<{ attempt: number; hook: HookCandidate; body: string; critique: ItemCritiqueResult }>
}

export interface ItemCertificationDeps {
  /** Step 4 — targeted research for THIS venue specifically, only invoked when accumulated evidence can't yet answer "what is the distinctive thing to do here." */
  performTargetedResearch: (venueName: string, existingEvidence: VenueResearchEvidence) => Promise<VenueResearchEvidence>
  /** Steps 3+5 — given evidence, propose the strongest specific hook (or explicitly report none exists — see `hookFound: false`, which causes an immediate REJECTED_NO_DISTINCTIVE_EXPERIENCE, never a forced weak hook to hit coverage). */
  selectHook: (venueName: string, evidence: VenueResearchEvidence, rejectedHooks: readonly HookCandidate[]) => Promise<{ hookFound: true; hook: HookCandidate } | { hookFound: false; reason: string }>
  /** Step 6 — verify the chosen hook is still true/current (the object still exists, the offering hasn't changed). */
  verifyHookCurrent: (venueName: string, hook: HookCandidate) => Promise<HookCurrencyCheck>
  /** Step 7 — OpenAI CheckOff editorial, ONE item at a time, never a batch rewrite call (see module doc). */
  writeItem: (venueName: string, hook: HookCandidate) => Promise<string>
  /** Step 8 — an INDEPENDENT critique pass (a separate call/prompt from writeItem, never the same call self-grading its own output). */
  critiqueItem: (venueName: string, body: string, hook: HookCandidate) => Promise<ItemCritiqueAnswers>
}

export const DEFAULT_MAX_ITEM_CERTIFICATION_ATTEMPTS = 3

/**
 * Runs the full 11-step loop for ONE venue/candidate item, bounded at
 * `maxAttempts` (default 3) so a stubborn item can never loop forever —
 * per "bound retries so it cannot loop forever," matching
 * metroLaunchCertification.ts's own runWithBoundedRetries() discipline,
 * but kept as its own function here because this loop's retry body does
 * MORE than re-run one gate: on a critique failure it also re-researches
 * and re-selects a hook (never just re-asks the same weak hook to be
 * rewritten with different words), and it also has its own dedicated
 * "no distinctive experience exists at all" early-exit that
 * runWithBoundedRetries()'s generic shape doesn't model.
 */
export async function runItemCertificationLoop(deps: ItemCertificationDeps, venueName: string, initialEvidence: VenueResearchEvidence, maxAttempts: number = DEFAULT_MAX_ITEM_CERTIFICATION_ATTEMPTS): Promise<ItemCertificationRecord> {
  let evidence = initialEvidence
  const rejectedHooks: HookCandidate[] = []
  const history: ItemCertificationRecord['history'] = []
  let lastCritique: ItemCritiqueResult | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Steps 2-4: read accumulated evidence; if it can't yet answer "what's
    // the distinctive thing here," perform targeted research for this ONE venue.
    if (!evidence.targetedResearchPerformed) {
      evidence = await deps.performTargetedResearch(venueName, evidence)
    }

    // Steps 3+5: select the strongest specific hook from evidence.
    const selection = await deps.selectHook(venueName, evidence, rejectedHooks)
    if (!selection.hookFound) {
      // "A venue is not entitled to an item merely because we need
      // coverage" — no forced weak hook, ever.
      return { venueName, attempts: attempt, outcome: 'REJECTED_NO_DISTINCTIVE_EXPERIENCE', chosenHook: null, rejectedHooks, finalBody: null, currencyCheck: null, lastCritique, history }
    }
    const hook = selection.hook

    // Step 6: verify the hook is current before writing anything.
    const currency = await deps.verifyHookCurrent(venueName, hook)
    if (!currency.current) {
      rejectedHooks.push({ ...hook, reasoning: `${hook.reasoning} — REJECTED: no longer current (${currency.reason})` })
      // Force fresh targeted research next attempt rather than re-proposing a stale hook.
      evidence = { ...evidence, targetedResearchPerformed: false }
      continue
    }

    // Step 7: write the item, ONE at a time, via OpenAI.
    const body = await deps.writeItem(venueName, hook)

    // Step 8: independent critique.
    const critiqueAnswers = await deps.critiqueItem(venueName, body, hook)
    const critique = evaluateItemCritique(body, venueName, critiqueAnswers)
    lastCritique = critique
    history.push({ attempt, hook, body, critique })

    // Step 11: certify.
    if (critique.pass) {
      return { venueName, attempts: attempt, outcome: 'ITEM_CERTIFIED', chosenHook: hook, rejectedHooks, finalBody: body, currencyCheck: currency, lastCritique: critique, history }
    }

    // Step 9-10: generic/venue-level/unsupported/awkward/replaceable ->
    // research/rewrite, not a superficial reword of the same weak hook.
    rejectedHooks.push({ ...hook, reasoning: `${hook.reasoning} — REJECTED after critique: ${critique.failureReasons.join('; ')}` })
    evidence = { ...evidence, targetedResearchPerformed: false }
  }

  return { venueName, attempts: maxAttempts, outcome: 'EXHAUSTED_RETRIES', chosenHook: null, rejectedHooks, finalBody: null, currencyCheck: null, lastCritique, history }
}

// ---------------------------------------------------------------------------
// The batch-level gate: every FINAL catalog item must carry an
// ITEM_CERTIFIED record. "An item should not enter the final metro
// catalog merely because the overall batch passes" — this gate is what
// actually enforces that: it fails the whole catalog if even one item is
// present without its own certification record, or with a record whose
// outcome isn't ITEM_CERTIFIED. Batch-wide gates (duplicates, opener
// repetition, geography, category distribution, tags, metadata,
// unsupported language) still run — see metroLaunchCertification.ts's
// REQUIRED_GATE_CATEGORIES — but only AFTER every item individually
// certifies, never instead of it.
// ---------------------------------------------------------------------------

export interface CatalogItemCertificationCheck {
  candidateName: string
  record: ItemCertificationRecord | null
}

export function evaluateItemCertificationGate(items: readonly CatalogItemCertificationCheck[]): StagingGateResult {
  if (items.length === 0) {
    return { key: 'ITEM_CERTIFICATION_GATE', verdict: 'FAIL', reason: 'No items were evaluated — this gate cannot pass on an empty catalog.' }
  }
  const problems: string[] = []
  for (const item of items) {
    if (!item.record) {
      problems.push(`${item.candidateName}: never ran through ITEM_CERTIFICATION_LOOP at all`)
      continue
    }
    if (item.record.outcome !== 'ITEM_CERTIFIED') {
      problems.push(`${item.candidateName}: outcome is ${item.record.outcome}, not ITEM_CERTIFIED`)
    }
  }
  if (problems.length > 0) {
    return {
      key: 'ITEM_CERTIFICATION_GATE',
      verdict: 'FAIL',
      reason: `${problems.length}/${items.length} item(s) are not individually ITEM_CERTIFIED — a batch-wide PASS on other gates never substitutes for this: ${problems.join(' | ')}`,
    }
  }
  return { key: 'ITEM_CERTIFICATION_GATE', verdict: 'PASS', reason: `All ${items.length} items are individually ITEM_CERTIFIED (own research evidence, verified-current hook, independent critique pass) before any batch-wide gate ran.` }
}
