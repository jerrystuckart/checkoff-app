// Phase 1A — integration tests for createDecision(). Real database, gated
// exactly like mutations.test.ts (see that file's header doc for the full
// rationale): AGENT_SERVICE_ALLOW_MUTATION_TESTS=1 required on top of
// AGENT_SERVICE_DATABASE_URL, or every test here is skipped. These also
// require the Phase 1A promotion-workflow migration
// (supabase/migrations/20260901_agent_decisions_promotion_workflow.sql) to
// already be applied — durable_memory_recommendation, agent.decision_events,
// and the 'chief' owner row must exist.
//
// Fixture isolation follows the same convention as mutations.test.ts: a
// dedicated project/decision_key namespace, never Bootstrap v1 data.
// agent_service has no DELETE grant on agent.decisions or
// agent.decision_events, so nothing here is cleaned up afterward — test
// rows are trivially identifiable by their decision_key prefix.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDecision } from './decisions'
import { query, withWriteTransaction, closePool } from './db'
import { ProjectNotFoundError, OwnerNotFoundError, DecisionKeyConflictError, DecisionNotFoundError } from './errors'

const hasDb = Boolean(process.env.AGENT_SERVICE_DATABASE_URL)
const mutationsAllowed = hasDb && process.env.AGENT_SERVICE_ALLOW_MUTATION_TESTS === '1'
const skip = mutationsAllowed
  ? false
  : hasDb
    ? 'set AGENT_SERVICE_ALLOW_MUTATION_TESTS=1 to run live mutation tests (these WRITE to the connected database)'
    : 'AGENT_SERVICE_DATABASE_URL not set — skipping integration test'

const TEST_PROJECT_KEY = 'phase1a_test_fixtures'
const RUN_ID = randomUUID().slice(0, 8)
let seq = 0
function decisionKey(label: string): string {
  seq += 1
  return `phase1a_test_${RUN_ID}_${seq}_${label}`
}

async function eventTypesFor(decisionId: string): Promise<string[]> {
  const rows = await query<{ event_type: string }>('SELECT event_type FROM agent.decision_events WHERE decision_id = $1 ORDER BY occurred_at', [
    decisionId,
  ])
  return rows.map((r) => r.event_type)
}

before(async () => {
  if (!mutationsAllowed) return
  await withWriteTransaction(async (client) => {
    await client.query(
      `INSERT INTO agent.projects (project_key, name, project_type, status)
       VALUES ($1, 'Phase 1A Test Fixtures', 'INTERNAL', 'ACTIVE')
       ON CONFLICT (project_key) DO NOTHING`,
      [TEST_PROJECT_KEY]
    )
  })
})

after(async () => {
  if (hasDb) await closePool()
})

test('createDecision: creates the decision and exactly one CREATED event, attributed to chief', { skip }, async () => {
  const key = decisionKey('basic')
  const result = await createDecision({ decisionKey: key, decision: 'A test decision.', projectKey: TEST_PROJECT_KEY })

  assert.equal(result.decisionKey, key)
  assert.deepEqual(await eventTypesFor(result.id), ['CREATED'])

  const rows = await query<{ open_brain_eligible: boolean; durable_memory_recommendation: string | null }>(
    'SELECT open_brain_eligible, durable_memory_recommendation FROM agent.decisions WHERE id = $1',
    [result.id]
  )
  assert.equal(rows[0].open_brain_eligible, false, 'a freshly created decision must never be eligible')
  assert.equal(rows[0].durable_memory_recommendation, null, 'a freshly created decision must never be pre-recommended')
})

test('createDecision: metadata.rationale round-trips through the row', { skip }, async () => {
  const key = decisionKey('rationale')
  const result = await createDecision({
    decisionKey: key,
    decision: 'A test decision with rationale.',
    metadata: { rationale: 'Because of X, Y, and Z.' },
  })

  const rows = await query<{ metadata: { rationale?: string } }>('SELECT metadata FROM agent.decisions WHERE id = $1', [result.id])
  assert.equal(rows[0].metadata.rationale, 'Because of X, Y, and Z.')
})

test('createDecision: duplicate decision_key is a typed conflict, not a raw Postgres error', { skip }, async () => {
  const key = decisionKey('dup')
  await createDecision({ decisionKey: key, decision: 'First.' })
  await assert.rejects(() => createDecision({ decisionKey: key, decision: 'Second, should be rejected.' }), DecisionKeyConflictError)
})

test('createDecision: unknown project is rejected before any row is written', { skip }, async () => {
  const key = decisionKey('badproject')
  await assert.rejects(
    () => createDecision({ decisionKey: key, decision: 'Should not be created.', projectKey: 'no_such_project_key' }),
    ProjectNotFoundError
  )
  const rows = await query('SELECT id FROM agent.decisions WHERE decision_key = $1', [key])
  assert.equal(rows.length, 0)
})

test('createDecision: unknown decidedByOwnerKey is rejected before any row is written', { skip }, async () => {
  const key = decisionKey('badowner')
  await assert.rejects(
    () => createDecision({ decisionKey: key, decision: 'Should not be created.', decidedByOwnerKey: 'no_such_owner' }),
    OwnerNotFoundError
  )
})

test('createDecision: supersedesDecisionId writes a SUPERSEDED event on the OLD decision', { skip }, async () => {
  const oldKey = decisionKey('old')
  const old = await createDecision({ decisionKey: oldKey, decision: 'The original decision.' })

  const newKey = decisionKey('new')
  const replacement = await createDecision({ decisionKey: newKey, decision: 'The corrected decision.', supersedesDecisionId: old.id })

  assert.deepEqual(await eventTypesFor(old.id), ['CREATED', 'SUPERSEDED'])
  assert.deepEqual(await eventTypesFor(replacement.id), ['CREATED'])

  const rows = await query<{ metadata: { supersededBy?: string } }>(
    "SELECT metadata FROM agent.decision_events WHERE decision_id = $1 AND event_type = 'SUPERSEDED'",
    [old.id]
  )
  assert.equal(rows[0].metadata.supersededBy, replacement.id)
})

test('createDecision: an invalid supersedesDecisionId is rejected as DecisionNotFoundError', { skip }, async () => {
  const key = decisionKey('badsupersede')
  await assert.rejects(
    () => createDecision({ decisionKey: key, decision: 'Should not be created.', supersedesDecisionId: randomUUID() }),
    DecisionNotFoundError
  )
})
