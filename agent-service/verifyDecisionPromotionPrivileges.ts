#!/usr/bin/env node
// Live privilege verification for
// supabase/migrations/20260901_agent_decisions_promotion_workflow.sql — run
// this AFTER that migration has been applied, as a follow-up to the
// migration's own catalog-only postflight checks. Same rationale and
// SAFETY posture as verifyOpenBrainSyncPrivileges.ts (see that file's
// header doc) — connects directly as agent_service via the real
// AGENT_SERVICE_DATABASE_URL, everything runs inside one BEGIN with
// per-probe SAVEPOINTs, and the outer transaction is ALWAYS rolled back,
// never committed.
//
// THIS SCRIPT'S SPECIFIC JOB: prove the Phase 1A capability boundary is
// real, not just conventional —
//   - agent_service CAN call recommend_decision_for_open_brain()
//   - agent_service CANNOT call approve/reject/reconsider_decision_for_open_brain()
//     (must fail with a permission error, not a business-logic error)
//   - agent_service CANNOT fabricate a DURABLE_MEMORY_APPROVED or
//     DURABLE_MEMORY_REJECTED agent.decision_events row directly (RLS)
//   - agent_service CAN still write the event types that are legitimately
//     its own (CREATED, as a representative allow-listed type)
//   - agent_service still has zero UPDATE on agent.decisions, including
//     the new durable_memory_recommendation column
//
// This does NOT test agent_approver itself succeeding at approve/reject/
// reconsider — this script only ever connects as agent_service (Chief's
// own credential), by design; agent_approver's own credential is a
// separate, not-yet-wired capability per Jerry's explicit Phase 1A
// decision (manual SQL-editor invocation for now).
//
// Usage:
//   npm run agent:verify:decision-promotion
// or directly:
//   npx tsx agent-service/verifyDecisionPromotionPrivileges.ts
//
// Requires AGENT_SERVICE_DATABASE_URL (see .env.example).

import './db' // side effect only: loads .env into process.env if not already set
import { Client } from 'pg'

const DATABASE_URL = process.env.AGENT_SERVICE_DATABASE_URL

interface CheckResult {
  name: string
  ok: boolean
  detail?: string
}

let savepointCounter = 0

async function withSavepoint<T>(client: Client, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: NodeJS.ErrnoException & { code?: string } }> {
  const savepoint = `sp_${savepointCounter++}`
  await client.query(`SAVEPOINT ${savepoint}`)
  try {
    const value = await fn()
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
    return { ok: true, value }
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
    return { ok: false, error: error as NodeJS.ErrnoException & { code?: string } }
  }
}

async function expectRejected(client: Client, name: string, sql: string, params: unknown[], expectedSqlState?: string): Promise<CheckResult> {
  const outcome = await withSavepoint(client, () => client.query(sql, params))
  if (outcome.ok) {
    return { name, ok: false, detail: 'expected this statement to be rejected, but it succeeded' }
  }
  const { error } = outcome
  if (expectedSqlState && error.code !== expectedSqlState) {
    return { name, ok: false, detail: `rejected, but with unexpected SQLSTATE ${error.code} (expected ${expectedSqlState}): ${error.message}` }
  }
  return { name, ok: true, detail: `rejected as expected (${error.code}): ${error.message}` }
}

async function expectSucceeds(client: Client, name: string, sql: string, params: unknown[]): Promise<CheckResult> {
  const outcome = await withSavepoint(client, () => client.query(sql, params))
  if (!outcome.ok) {
    return { name, ok: false, detail: `expected to succeed but was rejected: ${outcome.error.message}` }
  }
  return { name, ok: true }
}

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    throw new Error('AGENT_SERVICE_DATABASE_URL is not set — see .env.example.')
  }

  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()

  const results: CheckResult[] = []
  let probeDecisionId: string | null = null

  try {
    await client.query('BEGIN')

    const who = await client.query<{ current_user: string }>('SELECT current_user')
    const currentUser = who.rows[0]?.current_user
    if (currentUser !== 'agent_service') {
      throw new Error(`AGENT_SERVICE_DATABASE_URL connected as '${currentUser}', not 'agent_service' — refusing to run privilege probes under the wrong role`)
    }

    const legit = await expectSucceeds(
      client,
      'legitimate decision INSERT still works',
      `INSERT INTO agent.decisions (decision_key, decision) VALUES ($1, $2)`,
      ['__phase1a_verify_legit_insert__', 'probe row — this transaction is always rolled back, never committed']
    )
    results.push(legit)
    if (legit.ok) {
      const found = await client.query<{ id: string }>('SELECT id FROM agent.decisions WHERE decision_key = $1', ['__phase1a_verify_legit_insert__'])
      probeDecisionId = found.rows[0]?.id ?? null
    }

    if (!probeDecisionId) {
      const skipped = 'skipped — no probe decision id available because the legitimate INSERT above did not succeed'
      for (const name of [
        'agent_service CAN call recommend_decision_for_open_brain',
        'agent_service CANNOT call approve_decision_for_open_brain',
        'agent_service CANNOT call reject_decision_for_open_brain',
        'agent_service CANNOT call reconsider_decision_for_open_brain',
        'agent_service CANNOT fabricate a DURABLE_MEMORY_APPROVED decision_event',
        'agent_service CANNOT fabricate a DURABLE_MEMORY_REJECTED decision_event',
        'agent_service CAN write a legitimate CREATED decision_event',
        'agent_service still has zero UPDATE on durable_memory_recommendation',
      ]) {
        results.push({ name, ok: false, detail: skipped })
      }
    } else {
      results.push(
        await expectSucceeds(
          client,
          'agent_service CAN call recommend_decision_for_open_brain',
          `SELECT agent.recommend_decision_for_open_brain($1, $2)`,
          [probeDecisionId, 'privilege probe — recommend']
        )
      )

      results.push(
        await expectRejected(
          client,
          'agent_service CANNOT call approve_decision_for_open_brain',
          `SELECT agent.approve_decision_for_open_brain($1, $2)`,
          [probeDecisionId, 'jerry'],
          '42501'
        )
      )

      results.push(
        await expectRejected(
          client,
          'agent_service CANNOT call reject_decision_for_open_brain',
          `SELECT agent.reject_decision_for_open_brain($1, $2, $3)`,
          [probeDecisionId, 'jerry', 'privilege probe — should never be reachable'],
          '42501'
        )
      )

      results.push(
        await expectRejected(
          client,
          'agent_service CANNOT call reconsider_decision_for_open_brain',
          `SELECT agent.reconsider_decision_for_open_brain($1, $2, $3)`,
          [probeDecisionId, 'jerry', 'privilege probe — should never be reachable'],
          '42501'
        )
      )

      // Direct spoofing of the two human-outcome event types must be
      // blocked by RLS even though agent_service has a general INSERT
      // grant on agent.decision_events — the allow-list policy is what
      // actually closes this, not the function-level EXECUTE denial above
      // (a bare INSERT never calls the function at all).
      results.push(
        await expectRejected(
          client,
          'agent_service CANNOT fabricate a DURABLE_MEMORY_APPROVED decision_event',
          `INSERT INTO agent.decision_events (decision_id, event_type) VALUES ($1, 'DURABLE_MEMORY_APPROVED')`,
          [probeDecisionId],
          '42501'
        )
      )

      results.push(
        await expectRejected(
          client,
          'agent_service CANNOT fabricate a DURABLE_MEMORY_REJECTED decision_event',
          `INSERT INTO agent.decision_events (decision_id, event_type) VALUES ($1, 'DURABLE_MEMORY_REJECTED')`,
          [probeDecisionId],
          '42501'
        )
      )

      results.push(
        await expectSucceeds(
          client,
          'agent_service CAN write a legitimate CREATED decision_event',
          `INSERT INTO agent.decision_events (decision_id, event_type) VALUES ($1, 'CREATED')`,
          [probeDecisionId]
        )
      )

      results.push(
        await expectRejected(
          client,
          'agent_service still has zero UPDATE on durable_memory_recommendation',
          `UPDATE agent.decisions SET durable_memory_recommendation = 'RECOMMENDED' WHERE id = $1`,
          [probeDecisionId],
          '42501'
        )
      )
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  }

  console.log()
  let allOk = true
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.name}`)
    if (r.detail) console.log(`       ${r.detail}`)
    if (!r.ok) allOk = false
  }
  console.log()

  if (!allOk) {
    console.error('One or more decision-promotion privilege checks did not behave as expected.')
    process.exitCode = 1
    return
  }
  console.log('All decision-promotion privilege checks passed. Every probe was rolled back — nothing was persisted.')
}

main().catch((err) => {
  console.error('[agent-service/verifyDecisionPromotionPrivileges] failed:', err)
  process.exitCode = 1
})
