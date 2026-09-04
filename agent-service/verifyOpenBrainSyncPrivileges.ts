#!/usr/bin/env node
// Live privilege verification for
// supabase/migrations/20260901_agent_decisions_open_brain_sync.sql — run
// this AFTER that migration has been applied, as a follow-up to the
// migration's own catalog-only postflight checks.
//
// WHY THIS IS A SEPARATE SCRIPT, NOT part of the migration file: the
// Supabase linked-migration connection does not have permission to
// `SET LOCAL ROLE agent_service` (confirmed by a real failed apply
// attempt), so the migration's own postflight can only do catalog
// inspection (schema/column/constraint/grant checks) — it can prove what
// privileges exist, but not exercise them as agent_service actually
// would. This script closes that gap by connecting AS agent_service
// directly, using the real AGENT_SERVICE_DATABASE_URL agent-service
// itself uses (see db.ts) — no role-switching needed, no elevated
// privileges requested or used.
//
// SAFETY: everything below runs inside one BEGIN, with every individual
// probe wrapped in its own SAVEPOINT/ROLLBACK TO SAVEPOINT (so one
// rejected statement doesn't abort the whole transaction and hide later
// checks), and the outer transaction is ALWAYS rolled back in a `finally`
// block — never committed, on any code path. Nothing this script does is
// ever persisted. This is deliberate: agent_service has no DELETE grant on
// agent.decisions and none is requested here — relying on ROLLBACK instead
// of DELETE is what keeps the probe data from requiring one.
//
// Usage:
//   npm run agent:verify:open-brain-sync
// or directly:
//   npx tsx agent-service/verifyOpenBrainSyncPrivileges.ts
//
// Requires AGENT_SERVICE_DATABASE_URL (same variable as the rest of
// agent-service — see .env.example). Importing ./db for its side effect
// loads .env the same way every other agent-service entry point does;
// this script otherwise avoids db.ts's pooled client on purpose, since
// that pool forces every connection read-only and these probes need to
// attempt real (and, in several cases, expected-to-fail) writes inside a
// transaction this script explicitly controls.

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

    // Confirm we really are connected as agent_service before trusting any
    // result below — if this connection string ever points at a more
    // privileged role, every "rejected as expected" result would be
    // meaningless (or dangerous).
    const who = await client.query<{ current_user: string }>('SELECT current_user')
    const currentUser = who.rows[0]?.current_user
    if (currentUser !== 'agent_service') {
      throw new Error(`AGENT_SERVICE_DATABASE_URL connected as '${currentUser}', not 'agent_service' — refusing to run privilege probes under the wrong role`)
    }

    // Legitimate decision creation must still work, using only the columns
    // agent_service is granted (Phase 0F's column-scoped INSERT).
    const legit = await expectSucceeds(
      client,
      'legitimate decision INSERT still works',
      `INSERT INTO agent.decisions (decision_key, decision) VALUES ($1, $2)`,
      ['__phase0f_verify_legit_insert__', 'probe row — this transaction is always rolled back, never committed']
    )
    results.push(legit)
    if (legit.ok) {
      const found = await client.query<{ id: string }>('SELECT id FROM agent.decisions WHERE decision_key = $1', ['__phase0f_verify_legit_insert__'])
      probeDecisionId = found.rows[0]?.id ?? null
    }

    // Direct INSERT of open_brain_eligible = true must be rejected —
    // agent_service's INSERT grant is column-scoped and excludes it.
    results.push(
      await expectRejected(
        client,
        'direct INSERT with open_brain_eligible=true is rejected',
        `INSERT INTO agent.decisions (decision_key, decision, open_brain_eligible) VALUES ($1, $2, true)`,
        ['__phase0f_verify_insert_eligible__', 'probe row — should never be reachable'],
        '42501'
      )
    )

    if (probeDecisionId) {
      // Direct UPDATE of open_brain_eligible must be rejected —
      // agent_service has no UPDATE grant on agent.decisions at all.
      results.push(
        await expectRejected(
          client,
          'direct UPDATE of open_brain_eligible is rejected',
          `UPDATE agent.decisions SET open_brain_eligible = true WHERE id = $1`,
          [probeDecisionId],
          '42501'
        )
      )

      // Direct UPDATE of an Open Brain sync column must be rejected the
      // same way — the only write path for these columns is
      // record_decision_open_brain_sync(), never a bare UPDATE.
      results.push(
        await expectRejected(
          client,
          'direct UPDATE of an Open Brain sync column is rejected',
          `UPDATE agent.decisions SET open_brain_thought_id = 'bypass-attempt' WHERE id = $1`,
          [probeDecisionId],
          '42501'
        )
      )

      // The probe decision is still open_brain_eligible = false (its
      // DEFAULT — agent_service has no way to have set it true) —
      // record_decision_open_brain_sync must refuse it.
      results.push(
        await expectRejected(
          client,
          'record_decision_open_brain_sync rejects an ineligible decision',
          `SELECT agent.record_decision_open_brain_sync($1, $2, $3, $4)`,
          [probeDecisionId, 'thought-verify', 'title-verify', 'summary-verify']
        )
      )
    } else {
      const skipped = 'skipped — no probe decision id available because the legitimate INSERT above did not succeed'
      results.push({ name: 'direct UPDATE of open_brain_eligible is rejected', ok: false, detail: skipped })
      results.push({ name: 'direct UPDATE of an Open Brain sync column is rejected', ok: false, detail: skipped })
      results.push({ name: 'record_decision_open_brain_sync rejects an ineligible decision', ok: false, detail: skipped })
    }
  } finally {
    // Unconditional — this is what makes DELETE unnecessary. No code path
    // above ever commits.
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
    console.error('One or more Open Brain sync privilege checks did not behave as expected.')
    process.exitCode = 1
    return
  }
  console.log('All Open Brain sync privilege checks passed. Every probe was rolled back — nothing was persisted.')
}

main().catch((err) => {
  console.error('[agent-service/verifyOpenBrainSyncPrivileges] failed:', err)
  process.exitCode = 1
})
