import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveOpenAiModel } from './modelRouting'

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prior: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) prior[k] = process.env[k]
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    fn()
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test('resolveOpenAiModel: research_verifier defaults to gpt-4.1 at STANDARD, not the newest available model', () => {
  withEnv({ CHIEF_OPENAI_RESEARCH_MODEL: undefined }, () => {
    const route = resolveOpenAiModel('research_verifier', 'metro_launch')
    assert.equal(route.model, 'gpt-4.1')
    assert.equal(route.costTier, 'STANDARD')
    assert.equal(route.source, 'default')
  })
})

test('resolveOpenAiModel: research_verifier honors CHIEF_OPENAI_RESEARCH_MODEL override', () => {
  withEnv({ CHIEF_OPENAI_RESEARCH_MODEL: 'gpt-4.1-custom' }, () => {
    const route = resolveOpenAiModel('research_verifier', 'metro_launch')
    assert.equal(route.model, 'gpt-4.1-custom')
    assert.equal(route.source, 'env')
  })
})

test('resolveOpenAiModel: checkoff_editor defaults to the cheap gpt-4.1-mini at ECONOMY tier', () => {
  withEnv({ CHIEF_OPENAI_EDITOR_MODEL: undefined }, () => {
    const route = resolveOpenAiModel('checkoff_editor', 'checkoff_editor')
    assert.equal(route.model, 'gpt-4.1-mini')
    assert.equal(route.costTier, 'ECONOMY')
  })
})

test('resolveOpenAiModel: destination_strategist + destination/dva1 defaults to gpt-4.1 at STANDARD', () => {
  withEnv({ CHIEF_OPENAI_DVA1_MODEL: undefined }, () => {
    const route = resolveOpenAiModel('destination_strategist', 'destination/dva1')
    assert.equal(route.model, 'gpt-4.1')
    assert.equal(route.costTier, 'STANDARD')
  })
})

test('resolveOpenAiModel: destination_strategist + destination/dva2 or destination/dap stays STANDARD at gpt-4.1 by default — never auto-escalated to PREMIUM', () => {
  withEnv({ CHIEF_OPENAI_DEEP_ANALYSIS_MODEL: undefined }, () => {
    const dva2 = resolveOpenAiModel('destination_strategist', 'destination/dva2')
    assert.equal(dva2.model, 'gpt-4.1')
    assert.equal(dva2.costTier, 'STANDARD')

    const dap = resolveOpenAiModel('destination_strategist', 'destination/dap')
    assert.equal(dap.model, 'gpt-4.1')
    assert.equal(dap.costTier, 'STANDARD')
  })
})

test('resolveOpenAiModel: destination/dva2 or destination/dap reaches PREMIUM only via an explicit CHIEF_OPENAI_DEEP_ANALYSIS_MODEL override', () => {
  withEnv({ CHIEF_OPENAI_DEEP_ANALYSIS_MODEL: 'gpt-5' }, () => {
    const route = resolveOpenAiModel('destination_strategist', 'destination/dva2')
    assert.equal(route.model, 'gpt-5')
    assert.equal(route.costTier, 'PREMIUM')
    assert.equal(route.source, 'env')
  })
})

test('resolveOpenAiModel: an unlisted specialist falls back to the research route at STANDARD, never guesses PREMIUM', () => {
  withEnv({ CHIEF_OPENAI_RESEARCH_MODEL: undefined }, () => {
    const route = resolveOpenAiModel('some_future_specialist', 'some/methodology')
    assert.equal(route.model, 'gpt-4.1')
    assert.equal(route.costTier, 'STANDARD')
  })
})
