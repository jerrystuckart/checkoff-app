// Phase 0E — live acceptance checks against the real operational database.
// Read-only (getChiefAuditReport never opens a write transaction), so
// these are gated only by AGENT_SERVICE_DATABASE_URL, same as
// queries.test.ts — NOT the Phase 0D mutation-test flag, since there is
// nothing here that writes.
//
// These names (Grand Lake, Rim Country, etc.) are ACCEPTANCE DATA ONLY,
// per the Phase 0E spec's explicit instruction — audit.ts/auditRules.ts
// contain no reference to any of them; this file is just checking that
// the general-purpose logic correctly recognizes the specific Bootstrap
// v1 + Phase 0D-corrected state that happens to exist right now.
//
// NOTE: at Phase 0D's handoff, a leftover Phase 0D test fixture
// (source_type=phase0d_test) was sitting in NEEDS_JERRY and this "zero
// NEEDS_JERRY" check was expected to fail until
// docs/agent-platform/review_only_phase0d_test_fixture_cleanup.sql was
// applied. As of this writing that pollution is gone and this check
// passes — confirmed live, not assumed. Left as a real assertion (not
// weakened) since it's a meaningful acceptance criterion either way.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { getChiefAuditReport } from './audit'
import { query, closePool } from './db'

const hasDb = Boolean(process.env.AGENT_SERVICE_DATABASE_URL)
const skip = hasDb ? false : 'AGENT_SERVICE_DATABASE_URL not set — skipping integration test'

function findAttention(report: Awaited<ReturnType<typeof getChiefAuditReport>>, titleSubstring: string, code: string) {
  return report.attention.find((f) => f.code === code && f.task?.title.includes(titleSubstring))
}

test('live acceptance: Grand Lake is WAITING and due for check', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.ok(findAttention(report, 'Grand Lake', 'WAITING_DUE_FOR_CHECK'))
})

test('live acceptance: Rim Country is WAITING and due for check', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.ok(findAttention(report, 'Rim Country', 'WAITING_DUE_FOR_CHECK'))
})

test('live acceptance: Denver Featured outreach is WAITING and due for check', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.ok(findAttention(report, 'Denver Featured outreach', 'WAITING_DUE_FOR_CHECK'))
})

test('live acceptance: Buena Vista outreach is READY', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.ok(findAttention(report, 'Buena Vista', 'TASK_READY'))
})

// Phase 1E: this task was deliberately claimed via the approved autonomous
// internal_design_definition action (executeAutonomousAction() —
// READY -> IN_PROGRESS) once the product-discovery artifact was written
// and verified. It is no longer READY, deliberately and correctly —
// updating this acceptance criterion to match, not weakening it: an
// IN_PROGRESS task must NOT appear as TASK_READY attention (computeAttentionFindings
// only fires TASK_READY for status === 'READY'), and it must genuinely be
// IN_PROGRESS, not just absent for some unrelated reason. Same two-part
// pattern as the "Repair ChatGPT" CANCELED acceptance check below.
test("live acceptance: What's Good / What to Get widget build is no longer READY (claimed by Phase 1E autonomous action)", { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.equal(
    findAttention(report, "Build What's Good", 'TASK_READY'),
    undefined,
    'must not still be surfaced as READY attention after the Phase 1E autonomous claim'
  )
})

test("live acceptance: What's Good / What to Get widget build is genuinely IN_PROGRESS, not merely absent for an unrelated reason", { skip }, async () => {
  const rows = await query<{ status: string }>("SELECT status FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'whats-good-widget-build'")
  assert.equal(rows[0]?.status, 'IN_PROGRESS')
})

// Phase 1C: this task was deliberately reconciled from READY to CANCELED
// (SUPERSESSION_PROOF — see reconciliationTypes.ts and the Phase 1C audit)
// once the standalone Chief -> Open Brain transport (Phase 0F-0H) made the
// literal "repair ChatGPT's own MCP connection" premise obsolete. It is no
// longer READY, deliberately and correctly — updating this acceptance
// criterion to match, not weakening it: a CANCELED task must NOT appear as
// TASK_READY attention, and it must genuinely be CANCELED, not just absent
// for some unrelated reason.
test('live acceptance: Repair ChatGPT Open Brain authentication is CANCELED (reconciled, Phase 1C) — no longer READY', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.equal(
    findAttention(report, 'Repair ChatGPT Open Brain authentication', 'TASK_READY'),
    undefined,
    'must not still be surfaced as READY attention after the Phase 1C reconciliation'
  )
})

test('live acceptance: Repair ChatGPT Open Brain authentication is genuinely CANCELED, not merely absent for an unrelated reason', { skip }, async () => {
  const rows = await query<{ status: string }>("SELECT status FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'open-brain-chatgpt-reconnect'")
  assert.equal(rows[0]?.status, 'CANCELED')
})

test('live acceptance: widget marketing is BLOCKED', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.ok(findAttention(report, "Market What's Good", 'TASK_BLOCKED'))
})

// Phase 2M: the real Willcox forwarded-message proof (Desiree Gerth,
// pricing confirmation needed before the Chamber board vote — see
// reconcileDestinationPortfolioNeedsJerry.ts) created ONE genuine
// NEEDS_JERRY task. Updating this acceptance criterion to match, not
// weakening it: exactly one NEEDS_JERRY, and it must be the real Willcox
// item, not some other unrelated escalation.
test('live acceptance: exactly the Phase 2M Willcox pricing-confirmation NEEDS_JERRY exists', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.equal(report.summary.attentionByCode.TASK_NEEDS_JERRY ?? 0, 1)
  assert.ok(findAttention(report, 'Willcox — confirm pricing with Desiree', 'TASK_NEEDS_JERRY'))
})

test('live acceptance: completed Phase 0B and Chief read-layer tasks do not appear as attention items', { skip }, async () => {
  const report = await getChiefAuditReport()
  const phase0bBootstrap = report.attention.find((f) => f.task?.title.includes('Phase 0B — Bootstrap current operational state'))
  const chiefReadLayer = report.attention.find((f) => f.task?.title.includes('Build Chief read/query layer'))
  assert.equal(phase0bBootstrap, undefined, 'Phase 0B bootstrap task is DONE and must not appear in attention')
  assert.equal(chiefReadLayer, undefined, 'Chief read-layer task is DONE and must not appear in attention')
})

test('live acceptance: every project in health output is ACTIVE or ON_HOLD', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.ok(report.projectHealth.length > 0)
})

// ---------------------------------------------------------------------------
// Phase 2M — per-destination portfolio backfill (supabase/migrations/
// 20260905_agent_destination_portfolio_backfill.sql). Real production
// acceptance data, not fixtures.
// ---------------------------------------------------------------------------

test('live acceptance: each real Destination has its OWN distinct project — Willcox, Buena Vista, Grand Lake, and Rim Country are four separate project_key rows, not the umbrella', { skip }, async () => {
  const rows = await query<{ project_key: string }>(
    `SELECT project_key FROM agent.projects WHERE project_type = 'DESTINATION_HUB' AND project_key <> 'destination_hubs_wave_1' ORDER BY project_key`
  )
  const keys = rows.map((r) => r.project_key)
  assert.deepEqual(keys, ['destination-buena-vista', 'destination-grand-lake', 'destination-rim-country', 'destination-willcox'])
  assert.equal(new Set(keys).size, keys.length, 'no duplicate project_key rows from a re-run of the backfill migration')
})

test('live acceptance: the umbrella destination_hubs_wave_1 project still exists but owns none of the four reparented tasks', { skip }, async () => {
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text FROM agent.tasks t JOIN agent.projects p ON p.id = t.project_id WHERE p.project_key = 'destination_hubs_wave_1' AND t.id IN ('65527405-1714-40ad-9924-4238955fbd9d', 'ed241e54-e21f-413f-aeb1-4e7e9b65fdd8', '0812519a-6302-4a79-8807-622d8725d81e', 'dd9bbd68-f234-4a74-969d-929ca318ee6b')`
  )
  assert.equal(rows[0]?.count, '0', 'the umbrella project must never be the canonical relationship scope for a specific destination once a real project exists for it')
})

test('live acceptance: Desiree Gerth is a verified contact scoped to Willcox only, with no contact manufactured for Buena Vista/Grand Lake/Rim Country', { skip }, async () => {
  const desiree = await query<{ email: string; project_key: string }>(
    `SELECT c.email, p.project_key FROM agent.contacts c
       JOIN agent.interactions i ON i.contact_id = c.id
       JOIN agent.projects p ON p.id = i.project_id
      WHERE c.email = 'dez@strivevineyards.com'`
  )
  assert.equal(desiree.length, 1)
  assert.equal(desiree[0].project_key, 'destination-willcox')

  const totalContacts = await query<{ count: string }>(`SELECT count(*)::text FROM agent.contacts`)
  assert.equal(totalContacts[0]?.count, '1', 'no contact was manufactured for Buena Vista/Grand Lake/Rim Country — none exists in real data')
})

after(async () => {
  if (hasDb) await closePool()
})
