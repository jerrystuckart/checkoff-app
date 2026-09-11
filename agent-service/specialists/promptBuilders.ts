// Chief Phase 2E — prompt construction for the REMOTE_AI executor. Pure
// string-building, no I/O. Kept separate from remoteAiExecutor.ts so the
// exact instructions given to a provider are reviewable/testable on
// their own, same "logic vs wiring" split used throughout this codebase.
//
// Every prompt requires the model to name the exact methodology it is
// executing and return ONLY the documented JSON shape — never free
// prose Chief would have to re-interpret.

import { readFileSync } from 'node:fs'
import type { SpecialistExecutionRequest } from './executor'
import type { ResearchExecutionType } from './researchEvidence'
import { getMethodology } from './methodologyRegistry'

const ENVELOPE_JSON_SHAPE = `{
  "taskId": "<echo the executionId you were given, exactly>",
  "objective": "<echo the objective you were given, exactly>",
  "actionsPerformed": ["<what you actually did, e.g. specific searches run>"],
  "evidence": { /* keyed exactly by the requiredEvidenceKeys you were given */ },
  "artifacts": [],
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "blockers": ["<anything that stopped you from fully completing this>"],
  "discoveredFollowUpWork": ["<gaps/leads worth a future execution>"],
  "recommendedNextAction": "<one sentence>",
  "jerryRequired": false,
  "jerryReason": null,
  "methodologyId": "<echo exactly>",
  "methodologyVersion": "<echo exactly>"
}`

/**
 * Production-integrity pass — every REMOTE_AI prompt gets an explicit,
 * authoritative runtime date, appended as its own system-prompt segment
 * (never edited into the verbatim methodology text, and never mixed into
 * the ENVELOPE_JSON_SHAPE). A real live proof caught models defaulting
 * to a stale internal "current date" (e.g. mid-2024) when reasoning
 * about future dates/timing, even though the actual executedAt metadata
 * is correctly runtime-stamped regardless (see destinationHubDriver.ts's
 * stampExecutedAt) — this segment targets the SEPARATE problem of the
 * model's own date reasoning inside narrative/planning content it
 * produces (e.g. DAP's rightNowTask.targetDate, relationshipSequence).
 */
function runtimeDateContextLine(now: string): string {
  return (
    `RUNTIME CONTEXT: the actual current date/time is ${now}. This is authoritative and supersedes any date, season, or "current year" ` +
    `assumption you might otherwise draw from training data. Any future dates, deadlines, or timing recommendations you produce must be ` +
    `consistent with this actual date — never propose a date that is already in the past relative to it.`
  )
}

function methodologyPreamble(request: SpecialistExecutionRequest): string {
  return (
    `You are executing CheckOff's "${request.specialist}" specialist role under the versioned methodology ` +
    `${request.methodologyId}/${request.methodologyVersion} (agent-service/specialists/methodologies/${request.methodologyId}/${request.methodologyVersion}.md). ` +
    `Follow that methodology's rules exactly. Do not invent a different process.`
  )
}

function envelopeInstructions(request: SpecialistExecutionRequest): string {
  return (
    `Respond with ONLY a single JSON object matching this exact shape — no markdown fences, no prose before or after:\n${ENVELOPE_JSON_SHAPE}\n\n` +
    `executionId to echo as taskId: ${request.executionId}\n` +
    `objective to echo exactly: ${request.objective}\n` +
    `methodologyId to echo exactly: ${request.methodologyId}\n` +
    `methodologyVersion to echo exactly: ${request.methodologyVersion}\n` +
    `evidence MUST include a non-empty value for every one of these keys: ${request.requiredEvidenceKeys.join(', ') || '(none required)'}`
  )
}

/**
 * research_verifier's five distinct execution types (spec section 3).
 * `executionType` is read from request.inputs.executionType, defaulting
 * to BROAD_DISCOVERY only when genuinely unspecified — a caller should
 * always set it explicitly.
 */
export function researchExecutionTypeFor(request: SpecialistExecutionRequest): ResearchExecutionType {
  const raw = request.inputs.executionType
  if (raw === 'BROAD_DISCOVERY' || raw === 'CATEGORY_GAP' || raw === 'GEOGRAPHIC_GAP' || raw === 'VERIFICATION' || raw === 'REPLACEMENT') return raw
  return 'BROAD_DISCOVERY'
}

const RESEARCH_EXECUTION_TYPE_INSTRUCTIONS: Record<ResearchExecutionType, string> = {
  BROAD_DISCOVERY:
    'BROAD DISCOVERY: optimize for high recall, local originality, and diversity — not a generic business directory. ' +
    'Some questionable/stale candidates are acceptable at this stage; verification happens later. Every candidate must still ' +
    'carry a real source and must be marked needsVerification=true. ' +
    'BUSINESS-FIRST EXPERIENCE DISCOVERY (Vienna post-mortem): generic destination research over-indexes on attractions, museums, ' +
    'parks, and cultural venues. Run dedicated searches for the kinds of experiences that research tends to miss — search for the ' +
    'THING TO DO/ORDER/FIND, not merely the business: signature food or a specific dish, unusual coffee/café experiences, hidden ' +
    'bars, specialty cocktails, breweries, wine bars/tasting rooms, local markets and specific vendors, unusual retail, ' +
    'vintage/maker/specialty shops, participatory sports, social/game venues, distinctive wellness experiences, and neighborhood ' +
    'institutions. The strongest candidates here name a specific, ownable hook (a hidden entry through a vending machine, a ' +
    'bartender-built bespoke cocktail, a tasting flight, a signature dish, coffee chosen by flavor preference, billiards in an ' +
    'old-school café) — not just "this business exists and is well-reviewed."',
  CATEGORY_GAP:
    'CATEGORY GAP RESEARCH: the objective names a specific category and how many more viable candidates are needed (e.g. ' +
    '"Need 8 more viable Sports items"). Stay scoped to that category — do not return unrelated candidates.',
  GEOGRAPHIC_GAP:
    'GEOGRAPHIC GAP RESEARCH: the objective names a specific underrepresented area. Stay scoped to that area — do not return ' +
    'candidates outside it.',
  VERIFICATION:
    'VERIFICATION: for each candidate given to you, check whether it is currently open, whether the exact item/experience still ' +
    'exists as described, its location, whether it is a duplicate of something else, and how fresh your supporting source is. ' +
    'Report a clear verdict per candidate (still valid / closed / changed / duplicate) with the evidence behind it.',
  REPLACEMENT:
    'REPLACEMENT RESEARCH: the objective names a specific deficit created by a verification removal. Find replacement ' +
    'candidates for exactly that deficit — same discipline as BROAD_DISCOVERY otherwise.',
}

export function buildResearchVerifierPrompt(request: SpecialistExecutionRequest, now: string = new Date().toISOString()): { systemPrompt: string; userPrompt: string } {
  const executionType = researchExecutionTypeFor(request)
  // Structural bug fix (San Diego run, 2026-09-05): this prompt used to
  // describe ONLY evidence.candidates[]'s shape, even for the M1
  // geography stage (which requires evidence.neighborhoods[] instead) —
  // so live output filled neighborhoods[] with candidate-shaped records
  // missing `kind` entirely, silently disabling auditCoverage's
  // GEOGRAPHIC_HOLE gate. requiredEvidenceKeys is the caller's own
  // declaration of what this execution needs, so branch on it here
  // rather than inventing a second prompt-builder function.
  const wantsNeighborhoods = request.requiredEvidenceKeys.includes('neighborhoods')
  const systemPrompt = [
    methodologyPreamble(request),
    runtimeDateContextLine(now),
    'You have live web search available and must use it — do not rely on training-data memory for what currently exists, is open, ' +
      'or is located where. Every evidence.candidates[] entry must include: name, category, neighborhood, source (a real URL or ' +
      'named source), claimSupported (what that source actually supports), freshnessDate (if the source states one, else null), ' +
      'verificationConfidence (LOW/MEDIUM/HIGH), and needsVerification (boolean).',
    ...(wantsNeighborhoods
      ? [
          'This execution ALSO requires evidence.neighborhoods[] — a SEPARATE array describing the metro\'s own geography ' +
            '(areas/districts/neighborhoods), never individual businesses or experiences. Every evidence.neighborhoods[] entry ' +
            'MUST include: name (the area/neighborhood name) and kind, where kind is EXACTLY one of these 4 values — no others, ' +
            'never invent your own label: "core_urban" (a dense central district), "important_neighborhood" (a well-known, ' +
            'destination-worthy area outside the core), "suburb" (a residential/commuter area with limited destination pull), or ' +
            '"destination_worthy_outer" (a farther-out area still worth building real coverage for). An entry with a missing or ' +
            'invented kind value is rejected outright, not accepted with a guess.',
        ]
      : []),
    RESEARCH_EXECUTION_TYPE_INSTRUCTIONS[executionType],
    envelopeInstructions(request),
  ].join('\n\n')

  const userPrompt = [`Execution type: ${executionType}`, `Objective: ${request.objective}`, `Context: ${JSON.stringify(request.inputs)}`].join('\n')

  return { systemPrompt, userPrompt }
}

/**
 * WRITE and REWRITE calls carry a resolved canonical venue identity in
 * `inputs.canonicalVenueName` (+ optional `inputs.canonicalVenueAlternatives`
 * when the discovery label bundled several distinct venues) — see
 * canonicalVenueName.ts. CRITIQUE calls never carry these (nothing to
 * write), so this returns null for them; the quoting requirement itself
 * is a deterministic, code-side check (checkVenueQuoted), never asked
 * of the AI critique step.
 */
function canonicalVenueQuotingInstruction(request: SpecialistExecutionRequest): string | null {
  const mode = request.inputs.mode
  if (mode === 'CRITIQUE') return null
  const canonicalVenueName = request.inputs.canonicalVenueName
  if (typeof canonicalVenueName !== 'string' || !canonicalVenueName.trim()) return null
  const alternatives = Array.isArray(request.inputs.canonicalVenueAlternatives) ? (request.inputs.canonicalVenueAlternatives as unknown[]).filter((a): a is string => typeof a === 'string') : []
  const altClause =
    alternatives.length > 0
      ? ` The discovery label bundles several distinct venues/experiences together — if this item is genuinely about one of the OTHER specific venues instead, use that exact name instead: ${alternatives.map((a) => `"${a}"`).join(', ')}. Use exactly ONE of these names (the default or one alternative), never the full compound/bundled label, and never a name that is not one of the options given.`
      : ''
  return (
    `CANONICAL VENUE NAME (required formatting, not a suggestion): the final sentence in checkoffizedItem MUST contain the exact string '${canonicalVenueName}' ` +
    `(that literal text wrapped in single quotes, straight or curly) — this is the clean venue/place name, never the raw research label with its ` +
    `parenthetical annotations, bundled venue lists, category text, or neighborhood notes.${altClause} ` +
    `evidence must also include canonicalVenueUsed: the exact name you actually used (verbatim, matching what you wrapped in quotes) — this is how ` +
    `Chief confirms which of the allowed names you picked.`
  )
}

/**
 * TAG_ASSIGNMENT stage (Chief Phase 2AA) — a dedicated call, separate
 * from editorial writing, that selects 6-8 tags for an ALREADY-CERTIFIED
 * item from a compact, pre-narrowed shortlist (tagShortlist.ts — never
 * the full ~857-name vocabulary; that would waste tokens on every call
 * and is not this call's job to filter). The shortlist IS the entire
 * canonical vocabulary this call may choose from — inventing a name
 * outside it is refused just as hard as an unknown tag anywhere else in
 * this codebase (metroTagCertification.ts never relaxes that).
 */
function buildTagSelectionPrompt(request: SpecialistExecutionRequest, now: string): { systemPrompt: string; userPrompt: string } {
  const shortlist = Array.isArray(request.inputs.shortlist) ? (request.inputs.shortlist as unknown[]).filter((t): t is string => typeof t === 'string') : []
  const body = typeof request.inputs.body === 'string' ? request.inputs.body : ''
  const category = typeof request.inputs.category === 'string' ? request.inputs.category : null
  const claimSupported = typeof request.inputs.claimSupported === 'string' ? request.inputs.claimSupported : ''

  const systemPrompt = [
    methodologyPreamble(request),
    runtimeDateContextLine(now),
    'You select tags for an ALREADY-WRITTEN, already-certified CheckOff item. You do NOT edit, rewrite, or judge the wording — that ' +
      'work is already done and finished. Your only job is choosing which tags genuinely apply.',
    `The candidate tag list below (${shortlist.length} name(s)) is the COMPLETE set you may choose from — it is a pre-narrowed shortlist ` +
      'from the real canonical production vocabulary, not an example or a starting point. You MUST pick your 6-8 tags from this exact ' +
      'list, using the exact spelling/wording given. Never invent a tag, never singularize/pluralize/rephrase one to "fix" it, never ' +
      'pick a tag not in this list even if a better-sounding one occurs to you — if the right tag genuinely is not in the list, that is ' +
      'a real limitation of this pass, not something to work around by improvising a similar-sounding name.',
    'Consider the WHOLE venue/business this item belongs to (its category, its general character, its neighborhood) — not only the ' +
      'narrow action described in the CheckOff sentence itself. E.g. a specific-dish item at a historic coffeehouse can genuinely carry ' +
      'both a food-specific tag and a venue-character tag like "historic" or "coffeehouse", when those are in the shortlist.',
    'Pick 6-8 tags — prefer 8 when that many are genuinely, individually relevant; never pad with a marginal or generic tag merely to ' +
      'reach a count, and never drop a clearly relevant one to stay under 8.',
    `Item category: ${category ?? '(none classified)'}`,
    `Item body (final, already certified — for context only, do not edit): ${body}`,
    `Supporting research evidence: ${claimSupported}`,
    `Candidate tag shortlist (choose ONLY from these ${shortlist.length}): ${JSON.stringify(shortlist)}`,
    envelopeInstructions(request),
  ].join('\n\n')

  const userPrompt = [`Objective: ${request.objective}`, `Item + shortlist: ${JSON.stringify({ body, category, shortlist })}`].join('\n')

  return { systemPrompt, userPrompt }
}

/**
 * CATALOG_VOICE_PASS (Vienna post-mortem item 6) — a dedicated,
 * narrowly-scoped rewrite call for an item ALREADY flagged by
 * catalogVoiceDiagnostics.ts as contributing to a repeated
 * opening-word/phrase pattern across the batch. Unlike the main
 * write/rewrite prompt, this call's only job is varying the OPENING —
 * every fact, the quoted canonical venue name, and the category/tags
 * must survive unchanged. This is deliberately a much narrower prompt
 * than a full rewrite: "rewrite for variety" alone invites drift away
 * from already-verified facts, which this pass must never do.
 */
function buildVoiceRewritePrompt(request: SpecialistExecutionRequest, now: string): { systemPrompt: string; userPrompt: string } {
  const body = typeof request.inputs.body === 'string' ? request.inputs.body : ''
  const venueName = typeof request.inputs.venueName === 'string' ? request.inputs.venueName : ''
  const dominantOpeningWord = typeof request.inputs.dominantOpeningWord === 'string' ? request.inputs.dominantOpeningWord : ''

  const systemPrompt = [
    methodologyPreamble(request),
    runtimeDateContextLine(now),
    'You are given ONE already-certified, already-fact-checked CheckOff item body. The catalog it belongs to has too many items ' +
      `opening with the same word or phrase ("${dominantOpeningWord}") — your ONLY job is to rewrite the OPENING of this one sentence ` +
      'so it no longer starts that way, while preserving every fact, the exact quoted venue name, and the overall meaning. This is a ' +
      'voice-variety pass, not a content rewrite: do not add, remove, or change any factual claim; do not shorten or lengthen the ' +
      'body materially; do not rephrase the parts of the sentence that are already specific and fine.',
    `The exact string '${venueName}' (wrapped in single quotes, straight or curly) must still appear in the rewritten body, exactly as it did before.`,
    'If the body genuinely cannot be varied without weakening its specificity or changing a fact, return it completely unchanged — ' +
      'do not force an awkward or vaguer rewrite just to avoid the flagged opening.',
    `Original body: ${body}`,
    'evidence must include: body (the rewritten — or, if unchanged, the identical — final text).',
    envelopeInstructions(request),
  ].join('\n\n')

  const userPrompt = [`Objective: ${request.objective}`, `Item to revise: ${JSON.stringify({ body, venueName, dominantOpeningWord })}`].join('\n')

  return { systemPrompt, userPrompt }
}

export function buildCheckoffEditorPrompt(request: SpecialistExecutionRequest, now: string = new Date().toISOString()): { systemPrompt: string; userPrompt: string } {
  if (request.inputs.mode === 'TAG_SELECTION') return buildTagSelectionPrompt(request, now)
  if (request.inputs.mode === 'VOICE_REWRITE') return buildVoiceRewritePrompt(request, now)
  const quotingInstruction = canonicalVenueQuotingInstruction(request)
  const systemPrompt = [
    methodologyPreamble(request),
    runtimeDateContextLine(now),
    'You transform an ALREADY-VERIFIED factual candidate into final CheckOff item wording. You do NOT research new facts, and you ' +
      'must NEVER invent or embellish a menu item/product/experience beyond what the supplied factual source states.',
    // Rewritten (San Diego CheckOffization quality regression, 2026-09):
    // the prior wording ("action/experience first") still let the model
    // default to a small, repeated set of generic action verbs (Savor,
    // Experience, Sip, Shop, Catch, Dance...) as an opening template —
    // Jerry found large real-production clusters of items all starting
    // the same way, none of them saying what makes that visit
    // CheckOff-worthy. The rule is no longer "start with an action" — it
    // is "say the distinctive thing as early as possible," which is a
    // different, stricter requirement that generic verbs almost never
    // satisfy on their own.
    'THE CORE RULE: the distinctive thing to do, order, find, or notice must appear as early as possible in the sentence — ideally ' +
      'in the first few words. A CheckOff item is a specific instruction, not a description of the venue. Before writing, identify ' +
      'the ONE specific, concrete thing from the factual source that makes this worth doing: the actual dish/drink name, the ' +
      'specific room/feature/entrance, the exact ride or activity, the off-menu or hidden detail, the ritual or tradition, the ' +
      'specific viewpoint or moment, the exact class or format. If the factual source genuinely gives you nothing more specific ' +
      'than "this venue exists and is good," that is a sign the source is too thin for a real CheckOff item — write the most ' +
      'concrete sentence the facts actually support, never pad it with vague enthusiasm to compensate.',
    'DO NOT default to opening with a generic action verb ("Savor", "Experience", "Discover", "Explore", "Enjoy", "Indulge", ' +
      '"Immerse yourself", "Sip", "Shop", "Dine", "Catch", "Dance", "Taste", "Visit", "Check out", "Stop by", or any close synonym ' +
      'of these). These verbs are not individually banned words — the problem is using ANY of them as the reflexive default opening ' +
      'for every item, which produces a wall of interchangeable copy. The test is not "which verb did I use" but "could this exact ' +
      'sentence, with only the venue name swapped, describe a dozen unrelated places?" If yes, it is not specific enough yet, ' +
      'regardless of which verb it uses.',
    'Venue-first phrasing is fine ONLY when the venue itself, not an activity inside it, genuinely is the specific thing — a ' +
      'famous landmark, a singular building, a one-of-a-kind sight. Do not use that exception as a loophole for an ordinary ' +
      'restaurant/bar/shop where a specific dish, drink, or feature is available in the source and simply wasn\'t used.',
    'Do not add ranking or superlative filler ("top-rated", "best", "vibrant", "world-class", "must-see", "iconic") unless the ' +
      'ranking or superlative itself is the specific, source-verified fact being conveyed (e.g. "San Diego\'s only three-Michelin-' +
      'star restaurant" is a specific fact; "one of the best restaurants in town" is filler).',
    'Do not let internal reasoning, deduplication notes, or process language ("already counted", "redundant", "does not require a ' +
      'new checkoff item") leak into checkoffizedItem — that field is user-facing copy only.',
    'Vary sentence structure naturally across items because each is about a different specific thing, not as a deliberate ' +
      'thesaurus exercise — do not simply rotate through a list of synonym verbs to "diversify" wording that is still generic ' +
      'underneath.',
    'evidence must include: factualSource (verbatim, unchanged from what you were given), checkoffizedItem (the final wording), ' +
      'and fidelityAssessment (one or two sentences confirming every fact in checkoffizedItem traces directly back to factualSource, ' +
      'or naming exactly what could not be preserved).',
    quotingInstruction,
    envelopeInstructions(request),
  ]
    .filter((line): line is string => line !== null)
    .join('\n\n')

  const userPrompt = [`Objective: ${request.objective}`, `Verified factual candidate + supporting evidence: ${JSON.stringify(request.inputs)}`].join('\n')

  return { systemPrompt, userPrompt }
}

// ---------------------------------------------------------------------------
// destination_strategist — DVA-1 / DVA-2 / DAP (Phase 2G). Unlike the two
// prompts above (which describe the methodology in this codebase's own
// words), this one embeds the REAL, ingested methodology text VERBATIM —
// per the explicit "do not paraphrase or summarize the ingested content
// anywhere in code" rule (methodologyIngestion.ts). The model receives
// the exact rubric Jerry's own Claude Projects use, not a re-derived
// summary of it.
// ---------------------------------------------------------------------------

const DVA_ARTIFACT_ENVELOPE_SHAPE: Record<string, string> = {
  'destination/dva1': `evidence.artifact must be exactly:
{
  "provider": "dva1_claude_project",
  "destinationId": "<echo exactly>",
  "destinationName": "<the destination name>",
  "artifactRef": "<a stable id you generate for this run, e.g. dva1-<destinationId>-<date>>",
  "executedAt": "<ISO timestamp>",
  "contentHash": null,
  "score": <the Overall Opportunity Score, 0-100, from the rubric's own "Calculate" section>,
  "recommendationText": "<the Section 12 Recommendation, one sentence>",
  "currentStrategyFit": "FITS_CURRENT_STRATEGY" | "STRONG_BUT_LATER_STAGE" | "WEAK_STRATEGIC_FIT",  // from Section 13, exactly one of these three
  "fullReportMarkdown": "<the COMPLETE report you produced, every required section verbatim — Executive Summary, Destination Snapshot, weighted Opportunity Scorecard, Why People Visit, Why CheckOff Could Win, Regional Integration Opportunity, Preliminary Hub Scale, Complexity Profile, Opportunities, Risks, Confidence, Recommendation, Current-Strategy Fit. This is the authoritative artifact — the fields above are only an extracted projection of it, never a replacement for it.>"
}`,
  'destination/dva2': `evidence.artifact must be exactly:
{
  "provider": "dva2_claude_project",
  "destinationId": "<echo exactly>",
  "destinationName": "<the destination name>",
  "artifactRef": "<a stable id you generate for this run>",
  "executedAt": "<ISO timestamp>",
  "contentHash": null,
  "worthPursuing": "YES" | "MAYBE" | "NO",  // Section 23
  "recommendedPriority": "HIGH_PRIORITY_CREATE_DAP" | "VIABLE_CREATE_DAP_WHEN_CAPACITY_ALLOWS" | "PROMISING_BUT_PREMATURE_MONITOR" | "DO_NOT_PURSUE_CURRENTLY",  // Section 23
  "recommendedNextStep": "BUILD_DAP_NOW" | "HOLD_DAP_UNTIL_ISSUE_RESOLVED" | "STOP_PURSUIT",  // Section 24 (DAP Handoff)
  "rationale": "<why>",
  "knownRisks": ["<risk>", ...],
  "evidenceGaps": ["<from Section 24's 'Questions DAP Must Resolve', only if recommendedNextStep is HOLD_DAP_UNTIL_ISSUE_RESOLVED>"],
  "consumedDva1ArtifactRef": "<the DVA-1 artifactRef you were given as input — echo exactly>",
  "fullReportMarkdown": "<the COMPLETE report you produced, every required section verbatim. This is the authoritative artifact — the fields above are only an extracted projection of it.>"
}`,
  'destination/dap': `evidence.artifact must be exactly:
{
  "provider": "dap_claude_project",
  "destinationId": "<echo exactly>",
  "destinationName": "<the destination name>",
  "artifactRef": "<a stable id you generate for this run>",
  "executedAt": "<ISO timestamp>",
  "contentHash": null,
  "consumedDva2ArtifactRef": "<the DVA-2 artifactRef you were given as input — echo exactly>",
  "extracted": {
    "recommendedChampion": "<from Section 12>",
    "secondaryChampions": ["..."],
    "decisionMakers": ["<from Section 11>"],
    "stakeholderOrganizations": ["..."],
    "fundingBudgetClues": ["<from Section 2/3>"],
    "likelyBuyer": "<or null>",
    "estimatedSalesDifficulty": "LOW" | "MEDIUM" | "HIGH" | null,
    "timingConsiderations": ["<from Section 3>"],
    "politicalStakeholderComplexity": "LOW" | "MEDIUM" | "HIGH" | null,
    "objectionsHurdles": ["<from Section 7>"],
    "destinationPainPoints": ["<carried from DVA-2>"],
    "checkoffValueProposition": "<from Section 7>",
    "recommendedEntryStrategy": "<from Section 7>",
    "relationshipSequence": ["<from Section 4>"],
    "recommendedOfferDirection": "<from Section 2, or null — never recalculate pricing>",
    "rightNowTask": {
      "currentStage": "<Section 21>",
      "currentGoal": "<Section 21>",
      "highestPriorityTask": "<Section 21 — exactly ONE task>",
      "targetDate": "<Section 21, a real date>",
      "estimatedTime": "<Section 21>",
      "expectedResult": "<Section 21>",
      "whyItMatters": "<Section 21>"
    }
  },
  "fullReportMarkdown": "<the COMPLETE report you produced, every required section verbatim. This is the authoritative artifact — the fields above are only an extracted projection of it.>"
}`,
}

function readMethodologyFileVerbatim(methodologyId: string, methodologyVersion: string): string {
  const methodology = getMethodology(methodologyId, methodologyVersion) // throws UnknownMethodologyError if unregistered — never silently proceeds with no rubric
  return readFileSync(`${__dirname}/../../${methodology.docPath}`, 'utf8')
}

export function buildDestinationStrategistPrompt(request: SpecialistExecutionRequest, now: string = new Date().toISOString()): { systemPrompt: string; userPrompt: string } {
  const methodologyText = readMethodologyFileVerbatim(request.methodologyId, request.methodologyVersion)
  const artifactShape = DVA_ARTIFACT_ENVELOPE_SHAPE[request.methodologyId]
  if (!artifactShape) {
    throw new Error(`buildDestinationStrategistPrompt: no known artifact envelope shape for methodology "${request.methodologyId}" — this function only supports destination/dva1, destination/dva2, destination/dap.`)
  }

  const systemPrompt = [
    `You are executing CheckOff's "destination_strategist" specialist role. Below is the EXACT, VERBATIM methodology you must follow — every rule, section, and constraint in it is authoritative. Do not skip sections, do not invent a different process, do not add or remove requirements.`,
    runtimeDateContextLine(now),
    `--- BEGIN METHODOLOGY (${request.methodologyId}/${request.methodologyVersion}) ---\n${methodologyText}\n--- END METHODOLOGY ---`,
    `Produce the FULL report the methodology describes, with every required section. Then put that complete report VERBATIM into evidence.artifact.fullReportMarkdown (never summarized or omitted — it is the authoritative artifact) and extract the structured decision fields alongside it into evidence.artifact using this exact shape:\n${artifactShape}`,
    envelopeInstructions(request),
  ].join('\n\n')

  const userPrompt = [
    `Objective: ${request.objective}`,
    `Input context (destination identity + any prior-stage artifact this methodology consumes): ${JSON.stringify(request.inputs)}`,
    `If the input context above includes a prior-stage artifact (e.g. consumedDva1Artifact, consumedDva2Artifact), that IS the real, actual output of that prior stage — use its fullReportMarkdown and fields as your evidence base per the methodology's own instructions. Do not invent or re-derive numbers the prior artifact already reports.`,
  ].join('\n')

  return { systemPrompt, userPrompt }
}

// ---------------------------------------------------------------------------
// destination_relationship_manager (Phase 2I). Scope is deliberately
// narrow: ONLY personalized outreach/reply drafting — the one asset that
// genuinely benefits from AI-written prose tailored to a specific
// relationship. Everything else the specialist "owns" per registry.ts
// (classification, follow-up timing, the one-pager/deck, contact
// association) is deterministic code (gmailRelationshipLogic.ts,
// followUpEngine.ts, salesAssets.ts) — never an AI call for something
// this bounded. This specialist NEVER drafts pricing, commercial terms,
// or a promise — those stay APPROVAL_REQUIRED and outside its scope
// entirely; the prompt says so explicitly, not just standingAuthority.ts.
// ---------------------------------------------------------------------------

const RELATIONSHIP_DRAFT_ENVELOPE_SHAPE = `{
  "draft": {
    "subject": "<email subject line, or empty string for a non-email channel>",
    "bodyText": "<the full personalized message text>",
    "channel": "<email | linkedin | phone_script — whatever the input context's recommended channel is>"
  }
}`

// ---------------------------------------------------------------------------
// metro_finisher — Chief Phase 3C, METRO_FINISHER_DEEP_RESEARCH. Runs the
// versioned metro_finisher/v1 methodology VERBATIM (same pattern as
// destination_strategist above) — the actual research missions live in
// that doc, never re-derived or paraphrased here. This call gets live web
// research (see remoteAiExecutor.ts's LIVE_WEB_RESEARCH_METHODOLOGY_IDS /
// methodologyRequiresLiveWebResearch). Output is validated/truncated by
// metroFinisherReport.ts's validateMetroFinisherReport — this prompt only
// asks for the shape, it never trusts the model's output as-is.
// ---------------------------------------------------------------------------

const METRO_FINISHER_REPORT_SHAPE = `evidence.report must be exactly a MetroFinisherReport:
{
  "metro": "<echo the metro identity you were given>",
  "generatedAt": "<ISO timestamp, matching the runtime date you were given>",
  "catalogAssessment": {
    "currentItemCount": <number>,
    "strengths": ["..."],
    "weaknesses": ["..."],
    "categoryGaps": [{ "area": "<category or category-cluster>", "evidence": "<what you found>", "severity": "LOW"|"MEDIUM"|"HIGH", "recommendation": "<what to do>" }],
    "neighborhoodGaps": [{ "area": "<neighborhood>", "evidence": "<what you found>", "severity": "LOW"|"MEDIUM"|"HIGH", "recommendation": "<what to do>" }]
  },
  "cityIdentity": {
    "signatureFoodAndDrink": [{ "title": "...", "description": "...", "sourceNote": "..." }],
    "ritualsAndTraditions": [{ "title": "...", "description": "...", "sourceNote": "..." }],
    "artisanAndMakerCulture": [{ "title": "...", "description": "...", "sourceNote": "..." }],
    "localOnlyExperiences": [{ "title": "...", "description": "...", "sourceNote": "..." }],
    "unusualOrHidden": [{ "title": "...", "description": "...", "sourceNote": "..." }],
    "sportsAndCivicCulture": [{ "title": "...", "description": "...", "sourceNote": "..." }]
  },
  "mustHaveMissingExperiences": [{ "candidateName": "...", "venueName": "...", "category": "...", "neighborhoodName": "..." | null, "rationale": "...", "distinctivenessNote": "..." }],
  "enrichmentCandidates": [{ "candidateName": "...", "venueName": "...", "category": "...", "neighborhoodName": "..." | null, "rationale": "...", "distinctivenessNote": "..." }],
  "neighborhoodRecommendations": {
    "keep": ["<neighborhood name>", ...],
    "split": [{ "parentNeighborhood": "...", "proposedChildren": ["..."], "rationale": "...", "affectedExistingItemIds": ["<must be non-empty>"] }],
    "add": [{ "name": "...", "rationale": "..." }],
    "reject": [{ "name": "...", "reason": "..." }]
  },
  "themedListOpportunities": [{ "title": "<a novel, city-specific title — never pick from a generic template list>", "rationale": "...", "existingItemIds": ["..."], "missingExperiences": [/* CandidateFinding, same shape as above */], "strengthScore": <0-100>, "recommendation": "CREATE_NOW"|"ENRICH_THEN_CREATE"|"DO_NOT_CREATE" }],
  "duplicateOrIdentityConcerns": [{ "venueName": "...", "placeId": "..." | null, "itemIds": ["..."], "verdict": "DISTINCT"|"MERGE_RECOMMENDED"|"NEEDS_HUMAN_REVIEW", "rationale": "..." }],
  "finalAssessment": {
    "readyToFinish": <boolean — must be justified by real explored-gap findings above, never a bare item-count target>,
    "recommendedAdditionalItemRange": { "min": <number>, "max": <number> },
    "highestPriorityNextActions": ["..."]
  }
}`

export function buildMetroFinisherPrompt(request: SpecialistExecutionRequest, now: string = new Date().toISOString()): { systemPrompt: string; userPrompt: string } {
  const methodologyText = readMethodologyFileVerbatim(request.methodologyId, request.methodologyVersion)
  const systemPrompt = [
    `You are executing CheckOff's "metro_finisher" specialist role — deep research and synthesis ONLY, never item-writing or production creation. Below is the EXACT, VERBATIM methodology governing this run.`,
    runtimeDateContextLine(now),
    `--- BEGIN METHODOLOGY (${request.methodologyId}/${request.methodologyVersion}) ---\n${methodologyText}\n--- END METHODOLOGY ---`,
    'You have live web search available and must use it for the city-identity research missions — do not rely on training-data memory for what currently exists, is open, or is a real local tradition. Research in English AND the primary local language where one applies; preserve any local-language name or alias exactly as found, never transliterate or "clean up" it.',
    'RESEARCH THE NEGATIVE SPACE AROUND THIS CATALOG: your job is to find what is missing, thin, misclassified, or duplicated in the catalog you are given — not to re-verify what is already there.',
    'Nothing you produce is a certified item. Every candidate you name is a research lead that must still pass the real certification pipeline (duplicate/reconciliation review, Places verification, canonical neighborhood assignment, category/tag/metadata certification, distinctiveness and venue-quoting gates) before it can ever become production data.',
    METRO_FINISHER_REPORT_SHAPE,
    envelopeInstructions(request),
  ].join('\n\n')

  const userPrompt = [
    `Objective: ${request.objective}`,
    `Metro identity, retained catalog (id/body/category/neighborhood), category/neighborhood distributions, existing lists, reconciliation results, duplicate clusters, rejected-candidate summaries, Places completeness, and partner-potential signals: ${JSON.stringify(request.inputs)}`,
  ].join('\n')

  return { systemPrompt, userPrompt }
}

export function buildDestinationRelationshipManagerPrompt(request: SpecialistExecutionRequest, now: string = new Date().toISOString()): { systemPrompt: string; userPrompt: string } {
  const methodologyText = readMethodologyFileVerbatim(request.methodologyId, request.methodologyVersion)
  const systemPrompt = [
    `You are executing CheckOff's "destination_relationship_manager" specialist role, drafting personalized outbound outreach or a reply — NOT sending it (sending is a separate, human-approved step you have no part in). Below is the EXACT, VERBATIM methodology governing this relationship.`,
    runtimeDateContextLine(now),
    `--- BEGIN METHODOLOGY (${request.methodologyId}/${request.methodologyVersion}) ---\n${methodologyText}\n--- END METHODOLOGY ---`,
    `You draft outreach ONLY. You must NEVER: state or imply specific pricing, make a commercial commitment, agree to terms, promise a specific deliverable date, or say anything that could be read as a contractual commitment. If the input context includes hasPriorCorrespondence: true, the draft must acknowledge the prior relationship — never write as though this is a cold first contact when it is not. Personalize using the destination's real DAP findings given in the input context — never generic partner-outreach boilerplate.`,
    `Respond with evidence.artifact using this exact shape:\n${RELATIONSHIP_DRAFT_ENVELOPE_SHAPE}`,
    envelopeInstructions(request),
  ].join('\n\n')

  const userPrompt = [`Objective: ${request.objective}`, `Input context (destination/contact identity, DAP findings, relationship history, prior-correspondence flag, requested tone): ${JSON.stringify(request.inputs)}`].join('\n')

  return { systemPrompt, userPrompt }
}
