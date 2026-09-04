// Chief Phase 2E — prompt construction for the REMOTE_AI executor. Pure
// string-building, no I/O. Kept separate from remoteAiExecutor.ts so the
// exact instructions given to a provider are reviewable/testable on
// their own, same "logic vs wiring" split used throughout this codebase.
//
// Every prompt requires the model to name the exact methodology it is
// executing and return ONLY the documented JSON shape — never free
// prose Chief would have to re-interpret.

import type { SpecialistExecutionRequest } from './executor'
import type { ResearchExecutionType } from './researchEvidence'

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

export function buildResearchVerifierPrompt(request: SpecialistExecutionRequest): { systemPrompt: string; userPrompt: string } {
  const executionType = researchExecutionTypeFor(request)
  const systemPrompt = [
    methodologyPreamble(request),
    'You have live web search available and must use it — do not rely on training-data memory for what currently exists, is open, ' +
      'or is located where. Every evidence.candidates[] entry must include: name, category, neighborhood, source (a real URL or ' +
      'named source), claimSupported (what that source actually supports), freshnessDate (if the source states one, else null), ' +
      'verificationConfidence (LOW/MEDIUM/HIGH), and needsVerification (boolean).',
    RESEARCH_EXECUTION_TYPE_INSTRUCTIONS[executionType],
    envelopeInstructions(request),
  ].join('\n\n')

  const userPrompt = [`Execution type: ${executionType}`, `Objective: ${request.objective}`, `Context: ${JSON.stringify(request.inputs)}`].join('\n')

  return { systemPrompt, userPrompt }
}

export function buildCheckoffEditorPrompt(request: SpecialistExecutionRequest): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    methodologyPreamble(request),
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
