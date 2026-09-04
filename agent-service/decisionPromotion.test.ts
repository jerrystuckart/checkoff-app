// Phase 1A — recommendDecisionForOpenBrain unit tests. Mock repository,
// no database, no network. This is Chief's ONLY write into the promotion
// workflow — there is deliberately no approve/reject/reconsider counterpart
// to test here, since agent-service has no code path that could ever call
// those (agent_service has no EXECUTE grant on them; see the Phase 1A
// promotion-workflow migration).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recommendDecisionForOpenBrain, syncDecisionToOpenBrain } from './decisionPromotion'
import type { DecisionOpenBrainRepository, DecisionForOpenBrainRow } from './openBrainDecisions'
import type { OpenBrainClient, OpenBrainCreateResult, OpenBrainSearchResult, OpenBrainThought } from './openBrainClient'
import { DecisionNotFoundError, DecisionAlreadyEligibleError, DecisionRejectedForDurableMemoryError } from './errors'

function makeRow(overrides: Partial<DecisionForOpenBrainRow> = {}): DecisionForOpenBrainRow {
  return {
    id: 'decision-1',
    decisionKey: 'test_decision',
    decision: 'We decided to do the thing.',
    decidedAt: new Date('2026-08-01T00:00:00.000Z'),
    project: null,
    decidedBy: null,
    openBrainThoughtId: null,
    openBrainTitleSnapshot: null,
    openBrainSummarySnapshot: null,
    openBrainEligible: false,
    durableMemoryRecommendation: null,
    metadata: {},
    ...overrides,
  }
}

class MockRepository implements DecisionOpenBrainRepository {
  rows = new Map<string, DecisionForOpenBrainRow>()
  recommendCalls: Array<{ decisionId: string; reason: string }> = []

  constructor(rows: DecisionForOpenBrainRow[] = []) {
    for (const r of rows) this.rows.set(r.id, r)
  }

  async ownerExists(ownerKey: string): Promise<boolean> {
    return ownerKey === 'jerry'
  }

  async fetchDecision(decisionId: string): Promise<DecisionForOpenBrainRow | null> {
    return this.rows.get(decisionId) ?? null
  }

  async recordSync(decisionId: string, thoughtId: string, titleSnapshot: string, summarySnapshot: string): Promise<void> {
    const existing = this.rows.get(decisionId)
    if (existing) {
      this.rows.set(decisionId, { ...existing, openBrainThoughtId: thoughtId, openBrainTitleSnapshot: titleSnapshot, openBrainSummarySnapshot: summarySnapshot })
    }
  }

  async recommend(decisionId: string, reason: string): Promise<void> {
    this.recommendCalls.push({ decisionId, reason })
    const existing = this.rows.get(decisionId)
    if (existing) this.rows.set(decisionId, { ...existing, durableMemoryRecommendation: 'RECOMMENDED' })
  }

  syncEventCalls: Array<{ decisionId: string; eventType: 'OPEN_BRAIN_SYNC_SUCCEEDED' | 'OPEN_BRAIN_SYNC_FAILED'; note: string | null }> = []

  async recordSyncEvent(decisionId: string, eventType: 'OPEN_BRAIN_SYNC_SUCCEEDED' | 'OPEN_BRAIN_SYNC_FAILED', note: string | null): Promise<void> {
    this.syncEventCalls.push({ decisionId, eventType, note })
    // record_decision_open_brain_sync (called by writeDecisionToOpenBrain
    // before this) already updated openBrainThoughtId in the real system;
    // this mock's recordSync (below) does the same, so no additional state
    // change is needed here — this only logs the call.
  }
}

/** Minimal mock mirroring openBrainMcpClient's real idempotency semantics — same shape as openBrainDecisions.test.ts's MockOpenBrainClient. */
class MockOpenBrainClient implements OpenBrainClient {
  private bySource = new Map<string, { id: string; content: string }>()
  nextId = 1
  createCallCount = 0

  private key(sourceSystem: string, sourceIdentity: string): string {
    return `${sourceSystem}::${sourceIdentity}`
  }

  async createThought(content: string, sourceSystem: string, sourceIdentity: string): Promise<OpenBrainCreateResult> {
    this.createCallCount += 1
    const k = this.key(sourceSystem, sourceIdentity)
    const existing = this.bySource.get(k)
    if (existing) return { id: existing.id, created: false }
    const id = `thought-${this.nextId++}`
    this.bySource.set(k, { id, content })
    return { id, created: true }
  }

  async getThoughtBySource(sourceSystem: string, sourceIdentity: string): Promise<OpenBrainThought | null> {
    const found = this.bySource.get(this.key(sourceSystem, sourceIdentity))
    return found ? { id: found.id, content: found.content } : null
  }

  async searchByText(): Promise<OpenBrainSearchResult[]> {
    return []
  }
}

test('recommend: not-yet-reviewed decision transitions to RECOMMENDED', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])

  const result = await recommendDecisionForOpenBrain(row.id, 'this is a durable operating rule', repo)

  assert.deepEqual(result, { status: 'RECOMMENDED', decisionId: row.id })
  assert.equal(repo.recommendCalls.length, 1)
  assert.deepEqual(repo.recommendCalls[0], { decisionId: row.id, reason: 'this is a durable operating rule' })
})

test('recommend: already-RECOMMENDED decision reports ALREADY_RECOMMENDED, still calls through (idempotent at the DB layer)', async () => {
  const row = makeRow({ durableMemoryRecommendation: 'RECOMMENDED' })
  const repo = new MockRepository([row])

  const result = await recommendDecisionForOpenBrain(row.id, 'reiterating', repo)

  assert.deepEqual(result, { status: 'ALREADY_RECOMMENDED', decisionId: row.id })
})

test('recommend: decision not found throws DecisionNotFoundError, no repository.recommend call', async () => {
  const repo = new MockRepository([])
  await assert.rejects(() => recommendDecisionForOpenBrain('missing-id', 'reason', repo), DecisionNotFoundError)
  assert.equal(repo.recommendCalls.length, 0)
})

test('recommend: already-eligible (approved) decision is rejected — recommending it again is not meaningful', async () => {
  const row = makeRow({ openBrainEligible: true, durableMemoryRecommendation: 'RECOMMENDED' })
  const repo = new MockRepository([row])

  await assert.rejects(() => recommendDecisionForOpenBrain(row.id, 'reason', repo), DecisionAlreadyEligibleError)
  assert.equal(repo.recommendCalls.length, 0)
})

test('recommend: REJECTED decision is technically sticky — Chief cannot recommend it again', async () => {
  const row = makeRow({ durableMemoryRecommendation: 'REJECTED' })
  const repo = new MockRepository([row])

  await assert.rejects(() => recommendDecisionForOpenBrain(row.id, 'trying again', repo), DecisionRejectedForDurableMemoryError)
  assert.equal(repo.recommendCalls.length, 0, 'a rejected decision must never reach repository.recommend — only reconsider_decision_for_open_brain (agent_approver-only) can reopen it')
})

// ---------------------------------------------------------------------------
// syncDecisionToOpenBrain — the wrapper that adds the decision_events
// bookkeeping the Phase 1A design called for around the existing, UNCHANGED
// writeDecisionToOpenBrain().
// ---------------------------------------------------------------------------

test('sync: first sync (CREATED) writes exactly one OPEN_BRAIN_SYNC_SUCCEEDED event', async () => {
  const row = makeRow({ openBrainEligible: true, durableMemoryRecommendation: 'RECOMMENDED' })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()

  const result = await syncDecisionToOpenBrain(row.id, 'jerry', client, repo)

  assert.equal(result.status, 'CREATED')
  assert.equal(client.createCallCount, 1)
  assert.equal(repo.syncEventCalls.length, 1)
  assert.deepEqual(repo.syncEventCalls[0], { decisionId: row.id, eventType: 'OPEN_BRAIN_SYNC_SUCCEEDED', note: `thought ${(result as { thoughtId: string }).thoughtId}` })
})

test('sync: replay after a successful sync (LOCAL_RECORDED) writes NO additional event and creates nothing new', async () => {
  const row = makeRow({ openBrainEligible: true, durableMemoryRecommendation: 'RECOMMENDED' })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()

  const first = await syncDecisionToOpenBrain(row.id, 'jerry', client, repo)
  assert.equal(first.status, 'CREATED')
  assert.equal(repo.syncEventCalls.length, 1)

  const replay = await syncDecisionToOpenBrain(row.id, 'jerry', client, repo)

  assert.equal(replay.status, 'LOCAL_RECORDED')
  assert.equal(client.createCallCount, 1, 'replay must never call createThought again')
  assert.equal(repo.syncEventCalls.length, 1, 'replay must not write a second SUCCEEDED event — the event is written exactly once, on the sync that actually changed something')
})

test('sync: a thrown failure writes exactly one OPEN_BRAIN_SYNC_FAILED event, and the original error still propagates', async () => {
  const row = makeRow({ openBrainEligible: true, durableMemoryRecommendation: 'RECOMMENDED' })
  const repo = new MockRepository([row])
  const client: OpenBrainClient = {
    async createThought() {
      throw new Error('simulated transport failure')
    },
    async getThoughtBySource() {
      return null
    },
    async searchByText() {
      return []
    },
  }

  await assert.rejects(() => syncDecisionToOpenBrain(row.id, 'jerry', client, repo), /simulated transport failure/)
  assert.equal(repo.syncEventCalls.length, 1)
  assert.equal(repo.syncEventCalls[0].eventType, 'OPEN_BRAIN_SYNC_FAILED')
  assert.match(repo.syncEventCalls[0].note ?? '', /simulated transport failure/)
})

test('sync: decision not found throws DecisionNotFoundError before any Open Brain call', async () => {
  const repo = new MockRepository([])
  const client = new MockOpenBrainClient()
  await assert.rejects(() => syncDecisionToOpenBrain('missing-id', 'jerry', client, repo), DecisionNotFoundError)
  assert.equal(client.createCallCount, 0)
})
