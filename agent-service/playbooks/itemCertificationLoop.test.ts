import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateItemCritique,
  runItemCertificationLoop,
  evaluateItemCertificationGate,
  DEFAULT_MAX_ITEM_CERTIFICATION_ATTEMPTS,
  type ItemCertificationDeps,
  type VenueResearchEvidence,
  type HookCandidate,
  type ItemCritiqueAnswers,
} from './itemCertificationLoop'

function passingAnswers(overrides: Partial<ItemCritiqueAnswers> = {}): ItemCritiqueAnswers {
  return {
    hasConcreteAction: true,
    moreSpecificThanVenuePurpose: true,
    supportedByResearch: true,
    isCurrent: true,
    tellsUsefulNonObviousDetail: true,
    soundsLikeCheckoff: true,
    concise: true,
    critiqueNotes: 'looks good',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// evaluateItemCritique — the 9-question combination
// ---------------------------------------------------------------------------

test('evaluateItemCritique: FAIL example — "Browse more than 200 stores at \'Fashion Valley Mall\'." fails the swap test even with all other answers true', () => {
  const result = evaluateItemCritique("Browse more than 200 stores at 'Fashion Valley Mall'.", 'Fashion Valley Mall', passingAnswers())
  assert.equal(result.pass, false)
  assert.equal(result.swapTestPasses, false)
  assert.ok(result.failureReasons.some((r) => /swap-10-competitors/.test(r)))
})

test('evaluateItemCritique: PASS example — the shark-bitten surfboard item certifies', () => {
  const body = "See Bethany Hamilton's shark-bitten surfboard at 'California Surf Museum'."
  const result = evaluateItemCritique(body, 'California Surf Museum', passingAnswers())
  assert.equal(result.pass, true)
  assert.deepEqual(result.failureReasons, [])
})

test('evaluateItemCritique: PASS example — the hidden cocktail bar item certifies', () => {
  const body = "Enter 'Raised by Wolves' through the rotating fireplace and order from the hidden cocktail bar."
  const result = evaluateItemCritique(body, 'Raised by Wolves', passingAnswers())
  assert.equal(result.pass, true)
})

test('evaluateItemCritique: an unquoted venue name fails even when every AI-judged answer is true', () => {
  const body = 'See the shark-bitten surfboard at California Surf Museum.'
  const result = evaluateItemCritique(body, 'California Surf Museum', passingAnswers())
  assert.equal(result.pass, false)
  assert.equal(result.venueQuoted, false)
  assert.ok(result.failureReasons.some((r) => /single quotes/.test(r)))
})

test('evaluateItemCritique: any single false AI-judged answer fails the item — no partial credit', () => {
  const body = "See Bethany Hamilton's shark-bitten surfboard at 'California Surf Museum'."
  const result = evaluateItemCritique(body, 'California Surf Museum', passingAnswers({ supportedByResearch: false }))
  assert.equal(result.pass, false)
  assert.deepEqual(result.failureReasons, ['supported by research'])
})

test('evaluateItemCritique: multiple failing answers are all reported, not just the first', () => {
  const body = 'See exhibits at Museum X.'
  const result = evaluateItemCritique(body, 'Museum X', passingAnswers({ hasConcreteAction: false, soundsLikeCheckoff: false }))
  assert.equal(result.pass, false)
  assert.ok(result.failureReasons.length >= 4) // hasConcreteAction, swap test, quoting, soundsLikeCheckoff at minimum
})

// ---------------------------------------------------------------------------
// runItemCertificationLoop
// ---------------------------------------------------------------------------

function evidence(overrides: Partial<VenueResearchEvidence> = {}): VenueResearchEvidence {
  return { venueName: 'California Surf Museum', facts: [], targetedResearchPerformed: false, ...overrides }
}

function hook(text: string): HookCandidate {
  return { hookText: text, supportingFact: { fact: text, sourceUrl: null, sourceDescription: 'venue website' }, reasoning: 'strongest available specific hook' }
}

test('runItemCertificationLoop: certifies on the first attempt when research, hook, and critique are all strong', async () => {
  const deps: ItemCertificationDeps = {
    performTargetedResearch: async (venueName, ev) => ({ ...ev, targetedResearchPerformed: true, facts: [{ fact: "Bethany Hamilton's shark-bitten surfboard is on permanent display", sourceUrl: null, sourceDescription: 'museum site' }] }),
    selectHook: async () => ({ hookFound: true, hook: hook("Bethany Hamilton's shark-bitten surfboard") }),
    verifyHookCurrent: async () => ({ current: true, reason: 'still on display', checkedAt: '2026-09-04' }),
    writeItem: async () => "See Bethany Hamilton's shark-bitten surfboard at 'California Surf Museum'.",
    critiqueItem: async () => passingAnswers(),
  }
  const record = await runItemCertificationLoop(deps, 'California Surf Museum', evidence())
  assert.equal(record.outcome, 'ITEM_CERTIFIED')
  assert.equal(record.attempts, 1)
  assert.equal(record.finalBody, "See Bethany Hamilton's shark-bitten surfboard at 'California Surf Museum'.")
  assert.equal(record.rejectedHooks.length, 0)
})

test('runItemCertificationLoop: a generic first draft is rejected by critique, re-researched, and re-written until it certifies', async () => {
  let writeCalls = 0
  const deps: ItemCertificationDeps = {
    performTargetedResearch: async (venueName, ev) => ({ ...ev, targetedResearchPerformed: true }),
    selectHook: async (venueName, ev, rejected) => (rejected.length === 0 ? { hookFound: true, hook: hook('generic exhibits') } : { hookFound: true, hook: hook("Bethany Hamilton's shark-bitten surfboard") }),
    verifyHookCurrent: async () => ({ current: true, reason: 'ok', checkedAt: '2026-09-04' }),
    writeItem: async (venueName, h) => {
      writeCalls++
      return h.hookText === 'generic exhibits' ? "Explore exhibits at 'California Surf Museum'." : "See Bethany Hamilton's shark-bitten surfboard at 'California Surf Museum'."
    },
    critiqueItem: async (venueName, body) => passingAnswers({ hasConcreteAction: !body.includes('Explore exhibits') }),
  }
  const record = await runItemCertificationLoop(deps, 'California Surf Museum', evidence())
  assert.equal(record.outcome, 'ITEM_CERTIFIED')
  assert.equal(record.attempts, 2)
  assert.equal(writeCalls, 2)
  assert.equal(record.rejectedHooks.length, 1)
  assert.match(record.rejectedHooks[0].reasoning, /REJECTED after critique/)
})

test('runItemCertificationLoop: no distinctive hook exists — the venue is REJECTED, never given a forced weak item', async () => {
  const deps: ItemCertificationDeps = {
    performTargetedResearch: async (venueName, ev) => ({ ...ev, targetedResearchPerformed: true }),
    selectHook: async () => ({ hookFound: false, reason: 'nothing distinctive found after targeted research; venue is a generic chain outlet' }),
    verifyHookCurrent: async () => {
      throw new Error('should not be called')
    },
    writeItem: async () => {
      throw new Error('should not be called')
    },
    critiqueItem: async () => {
      throw new Error('should not be called')
    },
  }
  const record = await runItemCertificationLoop(deps, 'Generic Chain Store', evidence({ venueName: 'Generic Chain Store' }))
  assert.equal(record.outcome, 'REJECTED_NO_DISTINCTIVE_EXPERIENCE')
  assert.equal(record.chosenHook, null)
  assert.equal(record.finalBody, null)
})

test('runItemCertificationLoop: a stale hook is rejected by the currency check and a fresh hook is re-selected', async () => {
  let selectCalls = 0
  const deps: ItemCertificationDeps = {
    performTargetedResearch: async (venueName, ev) => ({ ...ev, targetedResearchPerformed: true }),
    selectHook: async () => {
      selectCalls++
      return selectCalls === 1 ? { hookFound: true, hook: hook('seasonal pop-up display (closed last year)') } : { hookFound: true, hook: hook('permanent surfboard exhibit') }
    },
    verifyHookCurrent: async (venueName, h) => ({ current: !h.hookText.includes('closed'), reason: h.hookText.includes('closed') ? 'pop-up ended' : 'still current', checkedAt: '2026-09-04' }),
    writeItem: async () => "See the shark-bitten surfboard permanently on display at 'California Surf Museum'.",
    critiqueItem: async () => passingAnswers(),
  }
  const record = await runItemCertificationLoop(deps, 'California Surf Museum', evidence())
  assert.equal(record.outcome, 'ITEM_CERTIFIED')
  assert.equal(record.rejectedHooks.length, 1)
  assert.match(record.rejectedHooks[0].reasoning, /no longer current/)
})

test('runItemCertificationLoop: exhausts the bounded retry limit and reports EXHAUSTED_RETRIES rather than looping forever', async () => {
  let attempts = 0
  const deps: ItemCertificationDeps = {
    performTargetedResearch: async (venueName, ev) => ({ ...ev, targetedResearchPerformed: true }),
    selectHook: async () => {
      attempts++
      return { hookFound: true, hook: hook(`weak hook attempt ${attempts}`) }
    },
    verifyHookCurrent: async () => ({ current: true, reason: 'ok', checkedAt: '2026-09-04' }),
    writeItem: async () => "Explore exhibits at 'California Surf Museum'.",
    critiqueItem: async () => passingAnswers({ hasConcreteAction: false }),
  }
  const record = await runItemCertificationLoop(deps, 'California Surf Museum', evidence(), 3)
  assert.equal(record.outcome, 'EXHAUSTED_RETRIES')
  assert.equal(record.attempts, 3)
  assert.equal(attempts, 3)
  assert.equal(record.history.length, 3)
})

test('runItemCertificationLoop: defaults to DEFAULT_MAX_ITEM_CERTIFICATION_ATTEMPTS when no bound is given', async () => {
  let attempts = 0
  const deps: ItemCertificationDeps = {
    performTargetedResearch: async (venueName, ev) => ({ ...ev, targetedResearchPerformed: true }),
    selectHook: async () => {
      attempts++
      return { hookFound: true, hook: hook('weak hook') }
    },
    verifyHookCurrent: async () => ({ current: true, reason: 'ok', checkedAt: '2026-09-04' }),
    writeItem: async () => "Explore exhibits at 'California Surf Museum'.",
    critiqueItem: async () => passingAnswers({ hasConcreteAction: false }),
  }
  const record = await runItemCertificationLoop(deps, 'California Surf Museum', evidence())
  assert.equal(record.attempts, DEFAULT_MAX_ITEM_CERTIFICATION_ATTEMPTS)
  assert.equal(attempts, DEFAULT_MAX_ITEM_CERTIFICATION_ATTEMPTS)
})

test('runItemCertificationLoop: never performs a second targeted-research pass once evidence is marked complete for an attempt, but re-triggers research after a rejected hook', async () => {
  let researchCalls = 0
  const deps: ItemCertificationDeps = {
    performTargetedResearch: async (venueName, ev) => {
      researchCalls++
      return { ...ev, targetedResearchPerformed: true }
    },
    selectHook: async (venueName, ev, rejected) => (rejected.length === 0 ? { hookFound: true, hook: hook('weak') } : { hookFound: true, hook: hook('strong specific hook') }),
    verifyHookCurrent: async () => ({ current: true, reason: 'ok', checkedAt: '2026-09-04' }),
    writeItem: async (venueName, h) => (h.hookText === 'weak' ? "Explore exhibits at 'California Surf Museum'." : "See the shark-bitten surfboard, the strong specific hook, at 'California Surf Museum'."),
    critiqueItem: async (venueName, body) => passingAnswers({ hasConcreteAction: !body.includes('Explore exhibits') }),
  }
  const record = await runItemCertificationLoop(deps, 'California Surf Museum', evidence())
  assert.equal(record.outcome, 'ITEM_CERTIFIED')
  assert.equal(researchCalls, 2, 'research should re-run once after the first hook was rejected by critique')
})

// ---------------------------------------------------------------------------
// evaluateItemCertificationGate — the batch-level "every item individually certified" gate
// ---------------------------------------------------------------------------

test('evaluateItemCertificationGate: fails closed on an empty catalog', () => {
  const result = evaluateItemCertificationGate([])
  assert.equal(result.verdict, 'FAIL')
})

test('evaluateItemCertificationGate: fails when any item never ran through the loop at all', () => {
  const result = evaluateItemCertificationGate([{ candidateName: 'Some Venue', record: null }])
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /never ran through ITEM_CERTIFICATION_LOOP/)
})

test('evaluateItemCertificationGate: a batch-wide PASS on other gates never substitutes for missing per-item certification — one uncertified item fails the whole gate', () => {
  const certifiedRecord = { venueName: 'A', attempts: 1, outcome: 'ITEM_CERTIFIED' as const, chosenHook: null, rejectedHooks: [], finalBody: 'body', currencyCheck: null, lastCritique: null, history: [] }
  const rejectedRecord = { venueName: 'B', attempts: 1, outcome: 'REJECTED_NO_DISTINCTIVE_EXPERIENCE' as const, chosenHook: null, rejectedHooks: [], finalBody: null, currencyCheck: null, lastCritique: null, history: [] }
  const result = evaluateItemCertificationGate([
    { candidateName: 'A', record: certifiedRecord },
    { candidateName: 'B', record: rejectedRecord },
  ])
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /B: outcome is REJECTED_NO_DISTINCTIVE_EXPERIENCE/)
})

test('evaluateItemCertificationGate: PASSes when every item is individually ITEM_CERTIFIED', () => {
  const certifiedRecord = (name: string) => ({ venueName: name, attempts: 1, outcome: 'ITEM_CERTIFIED' as const, chosenHook: null, rejectedHooks: [], finalBody: 'body', currencyCheck: null, lastCritique: null, history: [] })
  const result = evaluateItemCertificationGate([
    { candidateName: 'A', record: certifiedRecord('A') },
    { candidateName: 'B', record: certifiedRecord('B') },
  ])
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.key, 'ITEM_CERTIFICATION_GATE')
})
