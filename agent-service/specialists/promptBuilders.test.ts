import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDestinationStrategistPrompt, buildResearchVerifierPrompt, buildCheckoffEditorPrompt, researchExecutionTypeFor } from './promptBuilders'
import type { SpecialistExecutionRequest } from './executor'

function req(overrides: Partial<SpecialistExecutionRequest> = {}): SpecialistExecutionRequest {
  return {
    specialist: 'destination_strategist',
    playbookKey: 'destination_hub_lifecycle',
    stage: 'D2_DVA1',
    objective: 'DVA-1 for Grand Lake',
    inputs: { destinationId: 'destination-grand-lake', destinationName: 'Grand Lake' },
    requiredEvidenceKeys: ['artifact'],
    methodologyId: 'destination/dva1',
    methodologyVersion: 'v2',
    executionId: 'exec-1',
    projectId: 'project-1',
    destinationId: 'destination-grand-lake',
    metroId: null,
    allowedCapabilities: ['open_brain_read'],
    authorityOperations: ['destination_hub.dva1_screen'],
    idempotencyKey: 'idem-1',
    ...overrides,
  }
}

test('buildDestinationStrategistPrompt: embeds the real DVA-1 methodology text VERBATIM — never a paraphrase', () => {
  const { systemPrompt } = buildDestinationStrategistPrompt(req())
  // A phrase that only exists in the real ingested rubric, not in any code-authored summary.
  assert.ok(systemPrompt.includes('Destination Champion Potential'))
  assert.ok(systemPrompt.includes('Current-Strategy Fit') === false || systemPrompt.includes('🎯 Fits Current Expansion Strategy'))
})

test('buildDestinationStrategistPrompt: DVA-1 requests the currentStrategyFit field in the artifact shape', () => {
  const { systemPrompt } = buildDestinationStrategistPrompt(req())
  assert.match(systemPrompt, /currentStrategyFit/)
  assert.match(systemPrompt, /FITS_CURRENT_STRATEGY/)
})

test('buildDestinationStrategistPrompt: DVA-2 requests recommendedNextStep, not GREEN/YELLOW/RED', () => {
  const { systemPrompt } = buildDestinationStrategistPrompt(req({ methodologyId: 'destination/dva2', methodologyVersion: 'v2', stage: 'D3_DVA2' }))
  assert.match(systemPrompt, /recommendedNextStep/)
  assert.match(systemPrompt, /BUILD_DAP_NOW/)
  assert.doesNotMatch(systemPrompt, /"GREEN"/)
})

test('buildDestinationStrategistPrompt: DAP requests the rightNowTask field', () => {
  const { systemPrompt } = buildDestinationStrategistPrompt(req({ methodologyId: 'destination/dap', methodologyVersion: 'v2', stage: 'D4_DAP' }))
  assert.match(systemPrompt, /rightNowTask/)
  assert.match(systemPrompt, /highestPriorityTask/)
})

test('buildDestinationStrategistPrompt: throws for an unregistered methodology rather than silently proceeding with no rubric', () => {
  assert.throws(() => buildDestinationStrategistPrompt(req({ methodologyId: 'destination/dva1', methodologyVersion: 'v99' })))
})

test('buildDestinationStrategistPrompt: requires the FULL report verbatim in fullReportMarkdown, not just the extracted structured fields (Phase 2H — a real live run exposed the full narrative was being discarded)', () => {
  const dva1Prompt = buildDestinationStrategistPrompt(req())
  assert.match(dva1Prompt.systemPrompt, /fullReportMarkdown/)
  assert.match(dva1Prompt.systemPrompt, /authoritative artifact/)

  const dva2Prompt = buildDestinationStrategistPrompt(req({ methodologyId: 'destination/dva2', methodologyVersion: 'v2', stage: 'D3_DVA2' }))
  assert.match(dva2Prompt.systemPrompt, /fullReportMarkdown/)

  const dapPrompt = buildDestinationStrategistPrompt(req({ methodologyId: 'destination/dap', methodologyVersion: 'v2', stage: 'D4_DAP' }))
  assert.match(dapPrompt.systemPrompt, /fullReportMarkdown/)
})

test('researchExecutionTypeFor / buildResearchVerifierPrompt / buildCheckoffEditorPrompt: still work unchanged (Phase 2E/2F regression check)', () => {
  const researchReq: SpecialistExecutionRequest = { ...req(), specialist: 'research_verifier', methodologyId: 'metro_launch', methodologyVersion: 'v1', inputs: { executionType: 'CATEGORY_GAP' } }
  assert.equal(researchExecutionTypeFor(researchReq), 'CATEGORY_GAP')
  assert.match(buildResearchVerifierPrompt(researchReq).systemPrompt, /CATEGORY GAP RESEARCH/)

  const editorReq: SpecialistExecutionRequest = { ...req(), specialist: 'checkoff_editor', methodologyId: 'checkoff_editor', methodologyVersion: 'v1' }
  assert.match(buildCheckoffEditorPrompt(editorReq).systemPrompt, /checkoffizedItem/)
})
