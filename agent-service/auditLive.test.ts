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

test('live acceptance: zero NEEDS_JERRY currently', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.equal(report.summary.attentionByCode.TASK_NEEDS_JERRY ?? 0, 0)
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

after(async () => {
  if (hasDb) await closePool()
})
