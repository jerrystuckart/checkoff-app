// Phase 0F — fully mock-based tests. NO DATABASE NEEDED, NO REAL OPEN
// BRAIN ACCESS ANYWHERE IN THIS FILE. Both the Open Brain transport
// (OpenBrainClient) and the database (DecisionOpenBrainRepository) are
// injected mocks — this is necessary, not just convenient: agent-service
// is a standalone Node/`pg` process with no MCP access to Open Brain at
// all (see openBrainClient.ts), so a real OpenBrainClient cannot be
// exercised here regardless of database/migration status. These tests
// validate every behavior the Phase 0F spec calls for, and run
// unconditionally as part of routine `npm run agent:test` — no gate
// needed, since nothing here can possibly write anything real.
//
// supabase/migrations/20260901_agent_decisions_open_brain_sync.sql (which
// adds open_brain_eligible and agent.record_decision_open_brain_sync) is
// applied to the live database; see verifyOpenBrainSyncPrivileges.ts for
// the live-DB privilege probe suite that exercises the real function
// against the real schema (npm run agent:verify:open-brain-sync).
//
// MockOpenBrainClient below models the REAL confirmed capture_thought /
// get_thought_by_source semantics: createThought is idempotent on
// (sourceSystem, sourceIdentity) by content equality — same pair + same
// content returns the existing id with created:false; same pair +
// different content throws OpenBrainSourceIdentityConflictError. This
// mirrors the backend's own database-uniqueness guarantee, not a
// client-side approximation.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewDecisionOpenBrainWrite, writeDecisionToOpenBrain, reconcileDecisionOpenBrainWrite } from './openBrainDecisions'
import type { DecisionOpenBrainRepository, DecisionForOpenBrainRow } from './openBrainDecisions'
import { formatDecisionForOpenBrain } from './openBrainFormat'
import { decisionSourceIdentity } from './openBrainTypes'
import { getDefaultOpenBrainClient } from './openBrainClient'
import type { OpenBrainClient, OpenBrainCreateResult, OpenBrainSearchResult, OpenBrainThought } from './openBrainClient'
import {
  DecisionNotFoundError,
  DecisionNotEligibleError,
  DecisionSyncStateMismatchError,
  OwnerNotFoundError,
  OpenBrainWriteFailedError,
  OpenBrainSourceIdentityConflictError,
  DecisionOpenBrainConflictError,
  AmbiguousSyncOutcomeError,
  OpenBrainUnavailableError,
} from './errors'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<DecisionForOpenBrainRow> = {}): DecisionForOpenBrainRow {
  return {
    id: 'decision-1',
    decisionKey: 'test_decision',
    decision: 'We decided to do the thing.',
    decidedAt: new Date('2026-08-01T00:00:00.000Z'),
    project: { id: 'proj-1', projectKey: 'test_project', name: 'Test Project' },
    decidedBy: { displayName: 'Jerry' },
    openBrainThoughtId: null,
    openBrainTitleSnapshot: null,
    openBrainSummarySnapshot: null,
    openBrainEligible: true,
    durableMemoryRecommendation: null,
    metadata: {},
    ...overrides,
  }
}

class MockRepository implements DecisionOpenBrainRepository {
  rows = new Map<string, DecisionForOpenBrainRow>()
  owners = new Set<string>(['jerry'])
  recordedSyncs: Array<{ decisionId: string; thoughtId: string; titleSnapshot: string; summarySnapshot: string }> = []
  recordSyncError: Error | null = null
  recommendCalls: Array<{ decisionId: string; reason: string }> = []
  recommendError: Error | null = null

  constructor(rows: DecisionForOpenBrainRow[] = []) {
    for (const r of rows) this.rows.set(r.id, r)
  }

  async ownerExists(ownerKey: string): Promise<boolean> {
    return this.owners.has(ownerKey)
  }

  async fetchDecision(decisionId: string): Promise<DecisionForOpenBrainRow | null> {
    return this.rows.get(decisionId) ?? null
  }

  async recordSync(decisionId: string, thoughtId: string, titleSnapshot: string, summarySnapshot: string): Promise<void> {
    if (this.recordSyncError) {
      const err = this.recordSyncError
      this.recordSyncError = null // fail once, then succeed on retry — matches a realistic transient failure
      throw err
    }
    this.recordedSyncs.push({ decisionId, thoughtId, titleSnapshot, summarySnapshot })
    const existing = this.rows.get(decisionId)
    if (existing) {
      this.rows.set(decisionId, { ...existing, openBrainThoughtId: thoughtId, openBrainTitleSnapshot: titleSnapshot, openBrainSummarySnapshot: summarySnapshot })
    }
  }

  async recommend(decisionId: string, reason: string): Promise<void> {
    if (this.recommendError) {
      const err = this.recommendError
      this.recommendError = null
      throw err
    }
    this.recommendCalls.push({ decisionId, reason })
    const existing = this.rows.get(decisionId)
    if (existing) {
      this.rows.set(decisionId, { ...existing, durableMemoryRecommendation: 'RECOMMENDED' })
    }
  }

  syncEventCalls: Array<{ decisionId: string; eventType: 'OPEN_BRAIN_SYNC_SUCCEEDED' | 'OPEN_BRAIN_SYNC_FAILED'; note: string | null }> = []

  async recordSyncEvent(decisionId: string, eventType: 'OPEN_BRAIN_SYNC_SUCCEEDED' | 'OPEN_BRAIN_SYNC_FAILED', note: string | null): Promise<void> {
    this.syncEventCalls.push({ decisionId, eventType, note })
  }
}

/**
 * Models the REAL backend semantics of capture_thought(content,
 * source_system, source_identity) + get_thought_by_source(source_system,
 * source_identity): a single map keyed by the exact (sourceSystem,
 * sourceIdentity) pair is the source of truth for both methods, exactly
 * like the real database-enforced uniqueness constraint.
 */
class MockOpenBrainClient implements OpenBrainClient {
  private bySource = new Map<string, { id: string; content: string }>()
  nextId = 1
  createError: Error | null = null
  searchResults: OpenBrainSearchResult[] = []
  createCallCount = 0

  private key(sourceSystem: string, sourceIdentity: string): string {
    return `${sourceSystem}::${sourceIdentity}`
  }

  /** Test helper to simulate a thought that already exists remotely (e.g. created out-of-band) without going through createThought. */
  seed(sourceSystem: string, sourceIdentity: string, id: string, content: string): void {
    this.bySource.set(this.key(sourceSystem, sourceIdentity), { id, content })
  }

  async createThought(content: string, sourceSystem: string, sourceIdentity: string): Promise<OpenBrainCreateResult> {
    if (this.createError) throw this.createError
    this.createCallCount += 1
    const k = this.key(sourceSystem, sourceIdentity)
    const existing = this.bySource.get(k)
    if (existing) {
      if (existing.content !== content) {
        throw new OpenBrainSourceIdentityConflictError(
          sourceSystem,
          sourceIdentity,
          `existing capture's content differs from this call's content`
        )
      }
      return { id: existing.id, created: false }
    }
    const id = `thought-${this.nextId++}`
    this.bySource.set(k, { id, content })
    return { id, created: true }
  }

  async getThoughtBySource(sourceSystem: string, sourceIdentity: string): Promise<OpenBrainThought | null> {
    const found = this.bySource.get(this.key(sourceSystem, sourceIdentity))
    return found ? { id: found.id, content: found.content } : null
  }

  async searchByText(): Promise<OpenBrainSearchResult[]> {
    return this.searchResults
  }
}

const ACTOR = 'jerry'
const SOURCE_SYSTEM = 'CheckOff Chief'

// ---------------------------------------------------------------------------
// Deterministic preview rendering
// ---------------------------------------------------------------------------

test('preview: deterministic rendering — same decision produces byte-identical content across calls', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const first = await previewDecisionOpenBrainWrite(row.id, repo)
  const second = await previewDecisionOpenBrainWrite(row.id, repo)
  assert.deepEqual(first.content, second.content)
  assert.equal(first.content.title, 'CheckOff decision: Test Decision')
  assert.match(first.content.body, /We decided to do the thing\./)
  assert.match(first.content.body, new RegExp(decisionSourceIdentity(row.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('preview: title is human-readable, never a bare UUID', async () => {
  const row = makeRow({ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  const repo = new MockRepository([row])
  const preview = await previewDecisionOpenBrainWrite(row.id, repo)
  assert.ok(!preview.content.title.includes(row.id), 'title must not contain the raw decision UUID')
})

test('preview: title never exposes the raw snake_case decision_key, even with no authored override', async () => {
  const row = makeRow({ decisionKey: 'some_internal_slug_without_an_override' })
  const repo = new MockRepository([row])
  const preview = await previewDecisionOpenBrainWrite(row.id, repo)
  assert.ok(!preview.content.title.includes('some_internal_slug_without_an_override'), 'title must not contain the raw decision_key')
  assert.ok(!preview.content.title.includes('_'), 'title must not contain underscores — decision_key humanization must replace them')
  assert.equal(preview.content.title, 'CheckOff decision: Some Internal Slug Without An Override')
})

test('preview: an authored title override produces the exact intended human-readable title', async () => {
  const row = makeRow({ decisionKey: 'widget_marketing_after_build' })
  const repo = new MockRepository([row])
  const preview = await previewDecisionOpenBrainWrite(row.id, repo)
  assert.equal(preview.content.title, 'CheckOff decision: Market the widget only after it exists')
})

test('preview: decision not found throws DecisionNotFoundError', async () => {
  const repo = new MockRepository([])
  await assert.rejects(() => previewDecisionOpenBrainWrite('missing-id', repo), DecisionNotFoundError)
})

test('preview: performs no external write and no DB mutation', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  await previewDecisionOpenBrainWrite(row.id, repo)
  assert.equal(repo.recordedSyncs.length, 0)
})

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

test('write: ineligible decision is rejected before any Open Brain call', async () => {
  const row = makeRow({ openBrainEligible: false })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo),
    DecisionNotEligibleError
  )
  assert.equal(client.createCallCount, 0)
})

test('write: eligibility must be explicit — a decision is never inferred eligible from its content or presence alone', async () => {
  const row = makeRow({ openBrainEligible: false, decision: 'This decision text says nothing about eligibility either way.' })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()

  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo),
    DecisionNotEligibleError
  )
  assert.equal(client.createCallCount, 0)
})

test('preview: eligible unsynced decision reports eligible=true with null sync state', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const preview = await previewDecisionOpenBrainWrite(row.id, repo)
  assert.equal(preview.eligible, true)
  assert.equal(preview.ineligibleReason, null)
  assert.deepEqual(preview.existingSyncState, { thoughtId: null, titleSnapshot: null, summarySnapshot: null })
})

test('write: unknown actor owner is rejected', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: 'nobody', expectedOpenBrainThoughtId: null }, client, repo),
    OwnerNotFoundError
  )
})

// ---------------------------------------------------------------------------
// 1. First sourced create returns a UUID and records sync
// ---------------------------------------------------------------------------

test('write: first sourced create returns a thought id and records sync locally', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()

  const result = await writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo)

  assert.equal(result.status, 'CREATED')
  assert.equal((result as { thoughtId: string }).thoughtId.startsWith('thought-'), true)
  assert.equal(client.createCallCount, 1)
  assert.equal(repo.recordedSyncs.length, 1)
  assert.equal(repo.recordedSyncs[0].thoughtId, (result as { thoughtId: string }).thoughtId)

  const [content, sourceSystem, sourceIdentity] = [
    formatDecisionForOpenBrain(row).body,
    SOURCE_SYSTEM,
    decisionSourceIdentity(row.id),
  ]
  const recorded = await client.getThoughtBySource(sourceSystem, sourceIdentity)
  assert.ok(recorded, 'the created thought must be exactly findable by its source identity')
  assert.equal(recorded!.content, content)
})

// ---------------------------------------------------------------------------
// 2. Retry of same source/content reuses the same UUID (no duplicate)
// ---------------------------------------------------------------------------

test('write: retry with the same source identity and identical content reuses the same thought id, no duplicate', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()

  const first = await writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo)
  assert.equal(first.status, 'CREATED')
  const firstThoughtId = (first as { thoughtId: string }).thoughtId

  // Simulate local state having been lost/never recorded (e.g. the
  // recordSync half of a prior attempt failed) — local row still shows no
  // thought id, so a retry goes through the create path again.
  repo.rows.set(row.id, { ...row, openBrainThoughtId: null, openBrainTitleSnapshot: null, openBrainSummarySnapshot: null })

  const retry = await writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo)

  assert.equal(retry.status, 'RECONCILED_EXISTING')
  assert.equal((retry as { thoughtId: string }).thoughtId, firstThoughtId, 'must reuse the exact same UUID, not mint a new one')
  assert.equal(client.createCallCount, 2, 'createThought is called again, but the backend recognizes the idempotent replay')
})

test('write: repeated request after a fully successful sync is a local no-op and creates no duplicate thought', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()

  const first = await writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo)
  assert.equal(first.status, 'CREATED')
  const thoughtId = (first as { thoughtId: string }).thoughtId

  const second = await writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: thoughtId }, client, repo)

  assert.equal(second.status, 'LOCAL_RECORDED')
  assert.equal(client.createCallCount, 1, 'must not call createThought again once local state already shows synced')
})

// ---------------------------------------------------------------------------
// 3. Same source, different content is a hard conflict
// ---------------------------------------------------------------------------

test('write: same source identity with different content is a hard conflict, not a silent retry', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()

  // Something else already captured a DIFFERENT thought under the same
  // source identity — e.g. a decision whose text was edited without going
  // through this repo's immutable decision_key/decision content.
  const sourceIdentity = decisionSourceIdentity(row.id)
  client.seed(SOURCE_SYSTEM, sourceIdentity, 'thought-pre-existing', 'some entirely different content')

  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo),
    OpenBrainSourceIdentityConflictError
  )
  assert.equal(repo.recordedSyncs.length, 0, 'must never record a sync when the backend rejected the capture as a content conflict')
})

// ---------------------------------------------------------------------------
// 4. Exact source lookup recovers an already-created thought without a
//    duplicate capture (reconciliation, and the write-path's own
//    already-synced verification).
// ---------------------------------------------------------------------------

test('reconciliation: exact source lookup recovers an already-created thought and records local sync without a duplicate capture', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()

  // The thought exists remotely (e.g. capture succeeded, local recording
  // failed in a prior run) but was never created via this client instance
  // — recordSync failure being the realistic cause is exercised below; here
  // we seed it directly to isolate the "recover via exact lookup" behavior.
  const sourceIdentity = decisionSourceIdentity(row.id)
  client.seed(SOURCE_SYSTEM, sourceIdentity, 'thought-recoverable', formatDecisionForOpenBrain(row).body)

  const reconciled = await reconcileDecisionOpenBrainWrite(row.id, client, repo)

  assert.deepEqual(reconciled, { status: 'RECONCILED', decisionId: row.id, thoughtId: 'thought-recoverable' })
  assert.equal(client.createCallCount, 0, 'reconciliation must never call createThought')
  assert.equal(repo.recordedSyncs.length, 1)
  assert.equal(repo.recordedSyncs[0].thoughtId, 'thought-recoverable')
})

test('reconciliation: recovers after a real remote-success + local-recording-failure, without creating a duplicate', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  repo.recordSyncError = new Error('connection reset')
  const client = new MockOpenBrainClient()

  await assert.rejects(() => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo))
  assert.equal(client.createCallCount, 1, 'the remote capture really did happen exactly once')

  const reconciled = await reconcileDecisionOpenBrainWrite(row.id, client, repo)
  assert.equal(reconciled.status, 'RECONCILED')
  assert.equal(client.createCallCount, 1, 'reconciliation must never create a second thought')
  assert.equal(repo.recordedSyncs.length, 1)
})

test('reconciliation: already-recorded decision is a no-op', async () => {
  const row = makeRow({ openBrainThoughtId: 'thought-already' })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  const result = await reconcileDecisionOpenBrainWrite(row.id, client, repo)
  assert.deepEqual(result, { status: 'ALREADY_RECORDED', decisionId: row.id, thoughtId: 'thought-already' })
})

test('reconciliation: nothing found via exact lookup reports NOTHING_TO_RECONCILE, not an error', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  const result = await reconcileDecisionOpenBrainWrite(row.id, client, repo)
  assert.deepEqual(result, { status: 'NOTHING_TO_RECONCILE', decisionId: row.id })
})

// ---------------------------------------------------------------------------
// 5. Ineligible decisions still cannot write (covered above for write;
//    confirm reconcile's own DB-enforced gate is exercised at the write
//    boundary, since reconcile itself calls the same recordSync path).
// ---------------------------------------------------------------------------

test('write: ineligible decision cannot be reconciled into a synced state either, once eligibility is re-checked at write time', async () => {
  // Reconcile intentionally does not gate on eligibility in application
  // code (the DB function agent.record_decision_open_brain_sync is the
  // defense-in-depth backstop — see the 20260901 migration), but
  // writeDecisionToOpenBrain, the primary entry point, always rejects an
  // ineligible decision before any Open Brain call, regardless of what
  // reconciliation might otherwise find.
  const row = makeRow({ openBrainEligible: false })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  client.seed(SOURCE_SYSTEM, decisionSourceIdentity(row.id), 'thought-ineligible', formatDecisionForOpenBrain(row).body)

  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo),
    DecisionNotEligibleError
  )
  assert.equal(client.createCallCount, 0)
  assert.equal(repo.recordedSyncs.length, 0)
})

// ---------------------------------------------------------------------------
// Local thought id referencing a remote thought we cannot exactly verify
// ---------------------------------------------------------------------------

test('write: locally-recorded thought id with a miss on exact lookup is reported unverified, not silently recreated', async () => {
  const row = makeRow({ openBrainThoughtId: 'thought-unverifiable', openBrainTitleSnapshot: 'CheckOff decision: test_decision' })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient() // no seed — exact lookup finds nothing

  const result = await writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: 'thought-unverifiable' }, client, repo)

  assert.deepEqual(result, {
    status: 'LOCAL_RECORDED',
    decisionId: row.id,
    thoughtId: 'thought-unverifiable',
    remoteVerification: 'UNVERIFIED',
  })
  assert.equal(client.createCallCount, 0, 'must never recreate just because verification was inconclusive')
})

test('write: a local open_brain_thought_id is authoritative for "already recorded" regardless of lookup outcome', async () => {
  const row = makeRow({ openBrainThoughtId: 'thought-authoritative', openBrainTitleSnapshot: 'CheckOff decision: test_decision' })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  client.seed(SOURCE_SYSTEM, decisionSourceIdentity(row.id), 'thought-authoritative', formatDecisionForOpenBrain(row).body)

  const result = await writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: 'thought-authoritative' }, client, repo)

  assert.equal(result.status, 'LOCAL_RECORDED', 'local state alone determines this status, not the lookup result')
  assert.equal((result as { thoughtId: string }).thoughtId, 'thought-authoritative')
  assert.equal((result as { remoteVerification: string }).remoteVerification, 'EXACT_MATCH')
})

// ---------------------------------------------------------------------------
// Externally changed remote content -> conflict, never overwritten
// ---------------------------------------------------------------------------

test('write: an exactly-found thought whose content no longer matches our title snapshot is a conflict, not silently accepted', async () => {
  const row = makeRow({ openBrainThoughtId: 'thought-edited', openBrainTitleSnapshot: 'CheckOff decision: test_decision' })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  // Found by exact source identity, but the title text we originally wrote
  // is no longer present — simulating an external edit.
  client.seed(SOURCE_SYSTEM, decisionSourceIdentity(row.id), 'thought-edited', 'Someone rewrote this entirely.')

  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: 'thought-edited' }, client, repo),
    DecisionOpenBrainConflictError
  )
  assert.equal(repo.recordedSyncs.length, 0, 'must never overwrite')
})

test('write: an exact lookup returning a DIFFERENT thought id than locally recorded is a conflict', async () => {
  const row = makeRow({ openBrainThoughtId: 'thought-local', openBrainTitleSnapshot: 'CheckOff decision: test_decision' })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  client.seed(SOURCE_SYSTEM, decisionSourceIdentity(row.id), 'thought-remote-different', 'CheckOff decision: test_decision')

  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: 'thought-local' }, client, repo),
    DecisionOpenBrainConflictError
  )
  assert.equal(repo.recordedSyncs.length, 0)
})

// ---------------------------------------------------------------------------
// Concurrency: expected sync state mismatch
// ---------------------------------------------------------------------------

test('write: expectedOpenBrainThoughtId mismatch is rejected before any Open Brain call', async () => {
  const row = makeRow({ openBrainThoughtId: 'thought-real' })
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo),
    DecisionSyncStateMismatchError
  )
  assert.equal(client.createCallCount, 0)
})

// ---------------------------------------------------------------------------
// Auth / unavailable errors map to domain errors, and credentials never leak
// ---------------------------------------------------------------------------

test('auth/unavailable: the default (unconfigured) Open Brain client throws OpenBrainUnavailableError', async () => {
  // MUST force the unconfigured state explicitly, regardless of the
  // ambient environment — openBrainDecisions.ts imports ./db, whose
  // module-level side effect loads the repo root .env (see db.ts), so if
  // OPEN_BRAIN_MCP_URL/KEY are genuinely set there (as they are once Phase
  // 0G/0H live testing has been done), getDefaultOpenBrainClient() would
  // silently return the REAL client here and this "unconfigured" test
  // would make an actual network call — this is not hypothetical, it
  // happened once (a real capture_thought went to production with
  // content='anything'/source_identity='agent_decision:x' before this
  // save/delete/restore guard was added). Never rely on ambient env state
  // for a test that must stay network-free unconditionally.
  const savedUrl = process.env.OPEN_BRAIN_MCP_URL
  const savedKey = process.env.OPEN_BRAIN_MCP_KEY
  delete process.env.OPEN_BRAIN_MCP_URL
  delete process.env.OPEN_BRAIN_MCP_KEY
  try {
    const client = getDefaultOpenBrainClient()
    await assert.rejects(() => client.createThought('anything', SOURCE_SYSTEM, 'agent_decision:x'), OpenBrainUnavailableError)
    await assert.rejects(() => client.getThoughtBySource(SOURCE_SYSTEM, 'agent_decision:x'), OpenBrainUnavailableError)
    await assert.rejects(() => client.searchByText('anything'), OpenBrainUnavailableError)
  } finally {
    if (savedUrl === undefined) delete process.env.OPEN_BRAIN_MCP_URL
    else process.env.OPEN_BRAIN_MCP_URL = savedUrl
    if (savedKey === undefined) delete process.env.OPEN_BRAIN_MCP_KEY
    else process.env.OPEN_BRAIN_MCP_KEY = savedKey
  }
})

test('auth/unavailable: writeDecisionToOpenBrain surfaces OpenBrainUnavailableError distinctly, not collapsed into a generic write failure', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  client.createError = new OpenBrainUnavailableError('simulated auth failure')

  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo),
    OpenBrainUnavailableError
  )
})

test('auth/unavailable: a raw/unexpected transport error is normalized to OpenBrainWriteFailedError', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  const client = new MockOpenBrainClient()
  client.createError = new TypeError('fetch failed')

  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo),
    OpenBrainWriteFailedError
  )
})

// Phase 0G: getDefaultOpenBrainClient(), when BOTH env vars are set, now
// returns a REAL createOpenBrainMcpClient() wired to the global fetch —
// exercising that branch here would mean a real network attempt, which
// this file (and this whole test suite) never does. That branch's
// request-shaping/header/no-secret-in-URL behavior is covered by
// openBrainMcpClient.test.ts instead, which injects a fake fetchImpl. This
// file only covers the fail-closed (missing-config) branch, which never
// touches the network at all.

test('fail-closed: missing OPEN_BRAIN_MCP_URL is named explicitly in the error, key is never touched', async () => {
  const savedUrl = process.env.OPEN_BRAIN_MCP_URL
  const savedKey = process.env.OPEN_BRAIN_MCP_KEY
  delete process.env.OPEN_BRAIN_MCP_URL
  process.env.OPEN_BRAIN_MCP_KEY = 'sk-should-never-appear-in-any-message-1234567890'
  try {
    const client = getDefaultOpenBrainClient()
    await assert.rejects(
      () => client.createThought('anything', SOURCE_SYSTEM, 'agent_decision:x'),
      (err: unknown) => {
        assert.ok(err instanceof OpenBrainUnavailableError)
        const message = (err as Error).message
        assert.match(message, /OPEN_BRAIN_MCP_URL/)
        assert.ok(!message.includes('sk-should-never-appear'), 'error message must never contain the key, even when only the URL is missing')
        return true
      }
    )
  } finally {
    if (savedUrl === undefined) delete process.env.OPEN_BRAIN_MCP_URL
    else process.env.OPEN_BRAIN_MCP_URL = savedUrl
    if (savedKey === undefined) delete process.env.OPEN_BRAIN_MCP_KEY
    else process.env.OPEN_BRAIN_MCP_KEY = savedKey
  }
})

test('fail-closed: missing OPEN_BRAIN_MCP_KEY is named explicitly in the error, without ever including its value (it is unset)', async () => {
  const savedUrl = process.env.OPEN_BRAIN_MCP_URL
  const savedKey = process.env.OPEN_BRAIN_MCP_KEY
  process.env.OPEN_BRAIN_MCP_URL = 'https://example.invalid/functions/v1/open-brain-mcp'
  delete process.env.OPEN_BRAIN_MCP_KEY
  try {
    const client = getDefaultOpenBrainClient()
    await assert.rejects(
      () => client.getThoughtBySource(SOURCE_SYSTEM, 'agent_decision:x'),
      (err: unknown) => {
        assert.ok(err instanceof OpenBrainUnavailableError)
        assert.match((err as Error).message, /OPEN_BRAIN_MCP_KEY/)
        return true
      }
    )
  } finally {
    if (savedUrl === undefined) delete process.env.OPEN_BRAIN_MCP_URL
    else process.env.OPEN_BRAIN_MCP_URL = savedUrl
    if (savedKey === undefined) delete process.env.OPEN_BRAIN_MCP_KEY
    else process.env.OPEN_BRAIN_MCP_KEY = savedKey
  }
})

// ---------------------------------------------------------------------------
// Formatter determinism, isolated from the orchestration layer
// ---------------------------------------------------------------------------

test('formatter: pure function — identical input always produces identical output', () => {
  const source = {
    id: 'd-1',
    decisionKey: 'k',
    decision: 'text',
    decidedAt: new Date('2026-01-01T00:00:00.000Z'),
    project: { id: 'p', projectKey: 'pk', name: 'Project' },
    decidedBy: { displayName: 'Jerry' },
  }
  const a = formatDecisionForOpenBrain(source)
  const b = formatDecisionForOpenBrain(source)
  assert.deepEqual(a, b)
})

test('formatter: provenance includes decision id, project key, decision date, and CheckOff source system', () => {
  const decidedAt = new Date('2026-03-15T00:00:00.000Z')
  const content = formatDecisionForOpenBrain({
    id: 'decision-xyz',
    decisionKey: 'my_key',
    decision: 'content',
    decidedAt,
    project: { id: 'p1', projectKey: 'denver_metro', name: 'Denver Metro' },
    decidedBy: null,
  })
  assert.equal(content.provenance.decisionId, 'decision-xyz')
  assert.equal(content.provenance.projectKey, 'denver_metro')
  assert.equal(content.provenance.sourceSystem, 'CheckOff Chief')
  assert.equal(content.provenance.memoryType, 'decision')
  assert.equal(content.provenance.sourceIdentity, 'agent_decision:decision-xyz')
  assert.match(content.body, /2026-03-15/)
  assert.match(content.body, /Source system: CheckOff Chief/)
  assert.match(content.body, /Memory type: decision/)
  assert.match(content.body, /Source identity: agent_decision:decision-xyz/)
  assert.match(content.body, /Project: denver_metro/)
})

// ---------------------------------------------------------------------------
// Phase 1A: metadata.rationale in the durable Open Brain body
// ---------------------------------------------------------------------------

test('formatter: a non-blank rationale is included, explicitly labeled, right after the decision text', () => {
  const content = formatDecisionForOpenBrain({
    id: 'decision-rationale',
    decisionKey: 'some_decision',
    decision: 'We chose approach A.',
    decidedAt: new Date('2026-03-15T00:00:00.000Z'),
    project: null,
    decidedBy: null,
    rationale: 'Approach B would have required a schema migration we are not ready to commit to yet.',
  })
  const lines = content.body.split('\n')
  assert.deepEqual(lines.slice(0, 4), [
    'We chose approach A.',
    '',
    'Rationale: Approach B would have required a schema migration we are not ready to commit to yet.',
    '',
  ])
})

test('formatter: no rationale field produces a body byte-identical to the pre-Phase-1A shape', () => {
  const source = {
    id: 'decision-no-rationale',
    decisionKey: 'some_decision',
    decision: 'We chose approach A.',
    decidedAt: new Date('2026-03-15T00:00:00.000Z'),
    project: null,
    decidedBy: null,
  }
  const withoutField = formatDecisionForOpenBrain(source)
  const withNullRationale = formatDecisionForOpenBrain({ ...source, rationale: null })
  const withEmptyRationale = formatDecisionForOpenBrain({ ...source, rationale: '' })
  assert.equal(
    withoutField.body,
    'We chose approach A.\n\nDecided: 2026-03-15\n\nSource system: CheckOff Chief\nMemory type: decision\nSource identity: agent_decision:decision-no-rationale'
  )
  assert.equal(withNullRationale.body, withoutField.body)
  assert.equal(withEmptyRationale.body, withoutField.body, 'a blank-string rationale must be treated the same as absent, not rendered as an empty line')
})

// ---------------------------------------------------------------------------
// Ambiguous outcome (remote success + local recording failure)
// ---------------------------------------------------------------------------

test('write: remote capture success + local recording failure surfaces the orphaned thought id, never loses it', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  repo.recordSyncError = new Error('connection reset')
  const client = new MockOpenBrainClient()

  await assert.rejects(
    () => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo),
    (err: unknown) => {
      assert.ok(err instanceof AmbiguousSyncOutcomeError)
      assert.ok((err as AmbiguousSyncOutcomeError).thoughtId.startsWith('thought-'))
      return true
    }
  )
  assert.equal(client.createCallCount, 1, 'the remote write really did happen exactly once')
})

test('write: an ambiguous outcome is never automatically retried with a second capture_thought call', async () => {
  const row = makeRow()
  const repo = new MockRepository([row])
  repo.recordSyncError = new Error('pool exhausted')
  const client = new MockOpenBrainClient()

  await assert.rejects(() => writeDecisionToOpenBrain({ decisionId: row.id, actorOwnerKey: ACTOR, expectedOpenBrainThoughtId: null }, client, repo))

  assert.equal(client.createCallCount, 1, 'writeDecisionToOpenBrain must not internally retry createThought after an ambiguous outcome')
})

// Every test above uses MockOpenBrainClient, or getDefaultOpenBrainClient()
// in its guaranteed-unconfigured state (which throws before any network
// call — see openBrainClient.ts). None of them call a real
// mcp__Open_Brain__* tool, none require AGENT_SERVICE_ALLOW_OPEN_BRAIN_TESTS,
// and this file defines no gated test — `npm run agent:test` runs this
// whole suite unconditionally and it can never create a real thought.
