// Integration tests against Bootstrap v1 data. These need a real
// connection (AGENT_SERVICE_DATABASE_URL) and are SKIPPED, not failed,
// when that env var isn't set — this suite was authored and statically
// reviewed but never run against the linked project (no credential was
// available, and none was created for this purpose — see Phase 0C
// deliverables writeup). Run these yourself once AGENT_SERVICE_DATABASE_URL
// is configured: `npm run agent:test`.
//
// Assertions use stable keys/source refs, never raw UUIDs, per the Phase
// 0C testing requirement.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  getActiveProjects,
  getWaitingTasks,
  getTasksDueForCheck,
  getBlockedTasks,
  getNeedsJerryTasks,
  getRecentTaskChanges,
  getProjectState,
  DEFAULT_RECENT_CHANGES_WINDOW_MS,
  getPendingDurableMemoryRecommendations,
  getInteractionsRequiringAction,
  closePool,
} from './index'

const hasDb = Boolean(process.env.AGENT_SERVICE_DATABASE_URL)
const skip = hasDb ? false : 'AGENT_SERVICE_DATABASE_URL not set — skipping integration test'

test('getActiveProjects: returns the 4 ACTIVE bootstrap projects, excludes the 3 ON_HOLD metros', { skip }, async () => {
  const projects = await getActiveProjects()
  const keys = projects.map((p) => p.projectKey)
  assert.ok(keys.includes('agent_platform'), 'expected agent_platform')
  assert.ok(keys.includes('destination_hubs_wave_1'), 'expected destination_hubs_wave_1')
  assert.ok(keys.includes('denver_metro'), 'expected denver_metro')
  assert.ok(keys.includes('whats_good_widget'), 'expected whats_good_widget')
  assert.ok(!keys.includes('phoenix_metro'), 'phoenix_metro is ON_HOLD, must be excluded')
  assert.ok(!keys.includes('milwaukee_metro'), 'milwaukee_metro is ON_HOLD, must be excluded')
  assert.ok(!keys.includes('tucson_metro'), 'tucson_metro is ON_HOLD, must be excluded')
})

test('getWaitingTasks: includes Grand Lake, Rim Country, and Denver Featured outreach', { skip }, async () => {
  const tasks = await getWaitingTasks()
  const titles = tasks.map((t) => t.title)
  assert.ok(titles.some((t) => t.includes('Grand Lake')), 'expected Grand Lake follow-up')
  assert.ok(titles.some((t) => t.includes('Rim Country')), 'expected Rim Country follow-up')
  assert.ok(titles.some((t) => t.includes('Denver Featured outreach')), 'expected Denver Featured outreach tracking')
})

test('getTasksDueForCheck / waiting due-for-check filter: bootstrap WAITING tasks are due now', { skip }, async () => {
  const dueNow = await getTasksDueForCheck()
  assert.ok(dueNow.length >= 3, `expected at least the 3 bootstrap WAITING tasks due for check, found ${dueNow.length}`)

  const waitingDue = await getWaitingTasks({ dueForCheckOnly: true })
  assert.ok(waitingDue.length >= 3)
  assert.ok(waitingDue.every((t) => t.isDueForCheck), 'every returned task must actually be due for check')
})

test('getBlockedTasks: only widget-marketing remains blocked after the chief-read-layer correction', { skip }, async () => {
  // NOTE: this assertion reflects the state AFTER
  // docs/agent-platform/review_only_phase0c_chief_read_layer_correction.sql
  // has been applied. Before that correction is applied, "Build Chief
  // read/query layer" will still legitimately appear here too — that
  // is the documented "before" state, not a bug in this test.
  const blocked = await getBlockedTasks()
  const titles = blocked.map((t) => t.title)
  assert.ok(
    titles.some((t) => t.toLowerCase().includes('market') && t.toLowerCase().includes('widget')),
    'expected the widget marketing task to still be blocked by widget build'
  )
  assert.ok(
    !titles.includes('Build Chief read/query layer'),
    'chief-read-layer must no longer be BLOCKED once the operational correction has been applied'
  )
})

// Phase 2M created one real NEEDS_JERRY task (Willcox pricing
// confirmation). Phase 2N reconciled Jerry's own real Gmail reply as
// completion proof and transitioned it to DONE
// (reconcileWillcoxJerryReply.ts) — updating this acceptance criterion
// again to match, not weakening it: zero NEEDS_JERRY now that the real
// need has actually been met.
test('getNeedsJerryTasks: zero — the Phase 2M Willcox task was resolved by Jerry\'s real reply (Phase 2N)', { skip }, async () => {
  const needsJerry = await getNeedsJerryTasks()
  assert.equal(needsJerry.length, 0)
})

test('getRecentTaskChanges: returns the Bootstrap v1 CREATED events within a wide window', { skip }, async () => {
  // 30x the default window as a generous margin — this only needs to be
  // wide enough to still include Bootstrap v1's creation time whenever
  // this test happens to run, not to model any real "recent" semantics.
  const since = new Date(Date.now() - 30 * DEFAULT_RECENT_CHANGES_WINDOW_MS)
  const events = await getRecentTaskChanges(since)
  const created = events.filter((e) => e.eventType === 'CREATED')
  assert.ok(created.length >= 9, `expected at least the 9 Bootstrap v1 CREATED events, found ${created.length}`)
})

test("getProjectState('denver_metro'): returns the project and its waiting task", { skip }, async () => {
  const result = await getProjectState('denver_metro')
  assert.equal(result.found, true)
  if (result.found) {
    assert.equal(result.state.project.projectKey, 'denver_metro')
    assert.ok(
      result.state.waitingTasks.some((t) => t.title.includes('Denver Featured outreach')),
      'expected the Denver Featured outreach task in waitingTasks'
    )
  }
})

test("getProjectState('phoenix_metro'): ON_HOLD project with zero tasks is valid", { skip }, async () => {
  const result = await getProjectState('phoenix_metro')
  assert.equal(result.found, true)
  if (result.found) {
    assert.equal(result.state.project.status, 'ON_HOLD')
    assert.equal(Object.keys(result.state.tasksByStatus).length, 0, 'Phoenix intentionally has zero bootstrap tasks')
  }
})

test('getProjectState: nonexistent project key returns a typed not-found result', { skip }, async () => {
  const result = await getProjectState('does_not_exist_xyz')
  assert.equal(result.found, false)
  if (!result.found) {
    assert.equal(result.projectKey, 'does_not_exist_xyz')
  }
})

// ---------------------------------------------------------------------------
// Phase 1B regression: getPendingDurableMemoryRecommendations() must
// exclude already-approved decisions. Found live during the Phase 1B audit
// — the original Phase 1A query only checked durable_memory_recommendation
// = 'RECOMMENDED', so an approved-and-synced decision (whose recommendation
// cache column is never reset) stayed listed as "pending" forever. Asserts
// against the real live decision this was discovered against.
// ---------------------------------------------------------------------------

test('getPendingDurableMemoryRecommendations: excludes a decision that is already open_brain_eligible (regression)', { skip }, async () => {
  const pending = await getPendingDurableMemoryRecommendations()
  const stillListed = pending.find((d) => d.decisionKey === 'durable_memory_requires_human_approval')
  assert.equal(stillListed, undefined, 'this decision is already approved and synced — it must not appear as pending')
})

test('getInteractionsRequiringAction: returns an array (no live rows exist yet — this only proves the query executes cleanly)', { skip }, async () => {
  const interactions = await getInteractionsRequiringAction()
  assert.ok(Array.isArray(interactions))
})

after(async () => {
  if (hasDb) await closePool()
})
