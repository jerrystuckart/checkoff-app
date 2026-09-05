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
    'carry a real source and must be marked needsVerification=true.',
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

export function buildCheckoffEditorPrompt(request: SpecialistExecutionRequest, now: string = new Date().toISOString()): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    methodologyPreamble(request),
    runtimeDateContextLine(now),
    'You transform an ALREADY-VERIFIED factual candidate into final CheckOff item wording. You do NOT research new facts, and you ' +
      'must NEVER invent or embellish a menu item/product/experience beyond what the supplied factual source states.',
    'Required voice: a compelling hook in approximately the first 5-7 words; action/experience first; the business/place ' +
      'incorporated naturally in service of the action; sounds like a specific local recommendation, not a directory listing; ' +
      'concise; energetic; factually faithful to the source. Avoid generic openings ("Visit", "Explore", "Check out", "Stop by") ' +
      'unless genuinely the best fit.',
    'evidence must include: factualSource (verbatim, unchanged from what you were given), checkoffizedItem (the final wording), ' +
      'and fidelityAssessment (one or two sentences confirming every fact in checkoffizedItem traces directly back to factualSource, ' +
      'or naming exactly what could not be preserved).',
    envelopeInstructions(request),
  ].join('\n\n')

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
