import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryPlaybookRunStore, getOrCreateRun, unblockRun, resumeRun, recordJerryDecision, reopenStage, playbookRunId } from './playbookRun'

test('unblockRun: a BLOCKED run resumes to RUNNING, with jerryReason cleared and state untouched', async () => {
  const store = new InMemoryPlaybookRunStore()
  const run = await getOrCreateRun(store, 'metro_launch', 'proj-1', 'M6_5_CHECKOFF_EDITOR')
  run.status = 'BLOCKED'
  run.jerryReason = 'checkoff_editor unavailable: rate limited'
  run.state = { candidates: ['A', 'B'] }
  await store.put(run)

  const result = await unblockRun(store, playbookRunId('metro_launch', 'proj-1'))
  assert.equal(result.status, 'RUNNING')
  assert.equal(result.jerryReason, null)
  assert.deepEqual(result.state, { candidates: ['A', 'B'] }, 'unblock never touches run state — it is a plain retry signal, never a decision payload')
  assert.equal(result.currentStage, 'M6_5_CHECKOFF_EDITOR', 'stays at the exact stage it was blocked on — the next driveMetroLaunch call re-attempts from there')
})

test('unblockRun: throws (never silently no-ops) on a run that is NOT BLOCKED — RUNNING', async () => {
  const store = new InMemoryPlaybookRunStore()
  await getOrCreateRun(store, 'metro_launch', 'proj-2', 'M1_GEOGRAPHY_MAP')
  await assert.rejects(() => unblockRun(store, playbookRunId('metro_launch', 'proj-2')), /is not BLOCKED \(currently RUNNING\)/)
})

test('unblockRun: throws on a NEEDS_JERRY run — that requires `decide`, never a bare unblock (different semantics: a decision, not a retry)', async () => {
  const store = new InMemoryPlaybookRunStore()
  const run = await getOrCreateRun(store, 'metro_launch', 'proj-3', 'M0_METRO_DEFINITION')
  run.status = 'NEEDS_JERRY'
  run.jerryReason = 'M0 decisions unresolved'
  await store.put(run)
  await assert.rejects(() => unblockRun(store, playbookRunId('metro_launch', 'proj-3')), /is not BLOCKED \(currently NEEDS_JERRY\)/)
})

test('unblockRun: throws on a run id that does not exist', async () => {
  const store = new InMemoryPlaybookRunStore()
  await assert.rejects(() => unblockRun(store, playbookRunId('metro_launch', 'does-not-exist')), /No playbook run/)
})

test('unblockRun and recordJerryDecision are NOT interchangeable — each only accepts its own status', async () => {
  const store = new InMemoryPlaybookRunStore()
  const run = await getOrCreateRun(store, 'metro_launch', 'proj-4', 'M6_5_CHECKOFF_EDITOR')
  run.status = 'BLOCKED'
  run.jerryReason = 'rate limited'
  await store.put(run)

  // decide (NEEDS_JERRY-only) must refuse a BLOCKED run.
  await assert.rejects(() => recordJerryDecision(store, playbookRunId('metro_launch', 'proj-4'), {}), /is not NEEDS_JERRY \(currently BLOCKED\)/)

  const unblocked = await unblockRun(store, playbookRunId('metro_launch', 'proj-4'))
  assert.equal(unblocked.status, 'RUNNING')

  // resume (PAUSED-only) must refuse an already-RUNNING run.
  await assert.rejects(() => resumeRun(store, playbookRunId('metro_launch', 'proj-4')), /is not PAUSED \(currently RUNNING\)/)
})

// ---------------------------------------------------------------------------
// reopenStage — Chief Phase 2Z. Used to repair Vienna after the
// VENUE_QUOTING_GATE canonical-name fix without discarding the 450
// already-researched candidates.
// ---------------------------------------------------------------------------

test('reopenStage: moves currentStage back, clears exactly the named state keys, and preserves everything else', async () => {
  const store = new InMemoryPlaybookRunStore()
  const run = await getOrCreateRun(store, 'metro_launch', 'vienna-repair', 'LAUNCH_READINESS_BOUNDARY')
  run.status = 'NEEDS_JERRY'
  run.jerryReason = 'Metro build reached the launch-readiness boundary'
  run.loopIteration = 3
  run.totalRetries = 205
  run.state = {
    candidates: ['A', 'B', 'C'],
    neighborhoods: ['Innere Stadt'],
    checkoffizedItems: [{ name: 'A', checkoffizedItem: 'wrong', tags: [] }],
    itemCertifications: { A: { outcome: 'EXHAUSTED_RETRIES' } },
    finalCertificationReport: { verdict: 'BLOCKED' },
  }
  await store.put(run)

  const result = await reopenStage(store, playbookRunId('metro_launch', 'vienna-repair'), 'M6_5_CHECKOFF_EDITOR', {
    checkoffizedItems: [],
    itemCertifications: {},
    finalCertificationReport: null,
  })

  assert.equal(result.status, 'RUNNING')
  assert.equal(result.currentStage, 'M6_5_CHECKOFF_EDITOR')
  assert.equal(result.jerryReason, null)
  assert.equal(result.decisionPacket, null)
  assert.equal(result.loopIteration, 0)
  assert.equal(result.totalRetries, 0, 'a stale cumulative retry count from before the fix must not immediately re-trip the global retry cap on the very next ordinary retry')
  assert.deepEqual(result.state.candidates, ['A', 'B', 'C'], 'the paid-for research is NEVER discarded')
  assert.deepEqual(result.state.neighborhoods, ['Innere Stadt'])
  assert.deepEqual(result.state.checkoffizedItems, [], 'invalidated-by-the-fix state is cleared')
  assert.deepEqual(result.state.itemCertifications, {})
  assert.equal(result.state.finalCertificationReport, null)
})

test('reopenStage: with no stateReset given, only moves the stage — every key in state is preserved', async () => {
  const store = new InMemoryPlaybookRunStore()
  const run = await getOrCreateRun(store, 'metro_launch', 'vienna-repair-2', 'M8_BATCH_CERTIFICATION')
  run.status = 'BLOCKED'
  run.state = { candidates: ['X'] }
  await store.put(run)

  const result = await reopenStage(store, playbookRunId('metro_launch', 'vienna-repair-2'), 'M7_ITEM_CERTIFICATION')
  assert.equal(result.currentStage, 'M7_ITEM_CERTIFICATION')
  assert.deepEqual(result.state, { candidates: ['X'] })
})

test('reopenStage: throws on a RUNNING run — never reopens a stage out from under an active step', async () => {
  const store = new InMemoryPlaybookRunStore()
  await getOrCreateRun(store, 'metro_launch', 'vienna-repair-3', 'M6_QUALITY_VERIFICATION')
  await assert.rejects(() => reopenStage(store, playbookRunId('metro_launch', 'vienna-repair-3'), 'M1_GEOGRAPHY_MAP'), /is not NEEDS_JERRY or BLOCKED \(currently RUNNING\)/)
})

test('reopenStage: throws on a run id that does not exist', async () => {
  const store = new InMemoryPlaybookRunStore()
  await assert.rejects(() => reopenStage(store, playbookRunId('metro_launch', 'does-not-exist'), 'M1_GEOGRAPHY_MAP'), /No playbook run/)
})

test('reopenStage: works from BLOCKED, not just NEEDS_JERRY', async () => {
  const store = new InMemoryPlaybookRunStore()
  const run = await getOrCreateRun(store, 'metro_launch', 'vienna-repair-4', 'M6_5_CHECKOFF_EDITOR')
  run.status = 'BLOCKED'
  await store.put(run)
  const result = await reopenStage(store, playbookRunId('metro_launch', 'vienna-repair-4'), 'M6_5_CHECKOFF_EDITOR', { checkoffizedItems: [] })
  assert.equal(result.status, 'RUNNING')
})
