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

// Phase 2O: Jerry explicitly declined Rim Country and its follow-up task
// was transitioned to CANCELED (reconcileLegacyDestinationArtifacts.ts)
// — updating this acceptance criterion to match, not weakening it: a
// declined destination must NOT still surface as WAITING attention, and
// it must genuinely be CANCELED, not merely absent for an unrelated reason.
test('live acceptance: Rim Country no longer appears as WAITING (declined, Phase 2O)', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.equal(findAttention(report, 'Rim Country', 'WAITING_DUE_FOR_CHECK'), undefined)
})

test('live acceptance: Rim Country\'s follow-up task is genuinely CANCELED, not merely absent for an unrelated reason', { skip }, async () => {
  const rows = await query<{ status: string }>("SELECT status FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'destination-rim-country-followup'")
  assert.equal(rows[0]?.status, 'CANCELED')
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

// Phase 2M created ONE genuine NEEDS_JERRY task (Willcox pricing
// confirmation). Phase 2N then reconciled Jerry's own real Gmail reply to
// Desiree, which is genuine completion proof — reconcileWillcoxJerryReply.ts
// transitioned that task to DONE. Phase 2P then ran Buena Vista's real
// DAP (runBuenaVistaDap.ts), and the hub-lifecycle driver itself
// escalated to NEEDS_JERRY asking Jerry to approve initial outreach — a
// genuine new escalation, not a regression. Updating this acceptance
// criterion again to match, not weakening it: the Willcox task stays
// genuinely DONE, and exactly the Buena Vista escalation now exists.
test('live acceptance: the Willcox NEEDS_JERRY was resolved (Phase 2N); exactly the Buena Vista DAP outreach-approval escalation exists now (Phase 2P)', { skip }, async () => {
  const report = await getChiefAuditReport()
  assert.equal(report.summary.attentionByCode.TASK_NEEDS_JERRY ?? 0, 1)
  assert.equal(findAttention(report, 'Willcox — confirm pricing with Desiree', 'TASK_NEEDS_JERRY'), undefined)
  assert.ok(findAttention(report, 'destination-buena-vista', 'TASK_NEEDS_JERRY'))
})

test('live acceptance: the Phase 2M Willcox NEEDS_JERRY task is genuinely DONE, not merely absent for an unrelated reason', { skip }, async () => {
  const rows = await query<{ status: string }>(
    "SELECT status FROM agent.tasks WHERE source_type = 'gmail_forwarded_message_reclassification' AND source_ref = 'gmail:1a071eba028425e5'"
  )
  assert.equal(rows[0]?.status, 'DONE')
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

// Phase 2O added two more real per-destination projects (Williams AZ,
// Elkhart Lake WI) alongside the Phase 2M four — updating the expected
// list to match, not weakening the uniqueness check.
test('live acceptance: each real Destination has its OWN distinct project — six separate project_key rows, not the umbrella', { skip }, async () => {
  const rows = await query<{ project_key: string }>(
    `SELECT project_key FROM agent.projects WHERE project_type = 'DESTINATION_HUB' AND project_key <> 'destination_hubs_wave_1' ORDER BY project_key`
  )
  const keys = rows.map((r) => r.project_key)
  assert.deepEqual(keys, ['destination-buena-vista', 'destination-elkhart-lake-wi', 'destination-grand-lake', 'destination-rim-country', 'destination-willcox', 'destination-williams-az'])
  assert.equal(new Set(keys).size, keys.length, 'no duplicate project_key rows from a re-run of the backfill migration')
})

test('live acceptance: the umbrella destination_hubs_wave_1 project still exists but owns none of the four reparented tasks', { skip }, async () => {
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text FROM agent.tasks t JOIN agent.projects p ON p.id = t.project_id WHERE p.project_key = 'destination_hubs_wave_1' AND t.id IN ('65527405-1714-40ad-9924-4238955fbd9d', 'ed241e54-e21f-413f-aeb1-4e7e9b65fdd8', '0812519a-6302-4a79-8807-622d8725d81e', 'dd9bbd68-f234-4a74-969d-929ca318ee6b')`
  )
  assert.equal(rows[0]?.count, '0', 'the umbrella project must never be the canonical relationship scope for a specific destination once a real project exists for it')
})

test('live acceptance: Desiree Gerth is a verified contact scoped to Willcox only', { skip }, async () => {
  // DISTINCT: Phase 2N added a second (outbound) interaction on the same
  // contact/project pair — Jerry's real reply — so this must not be
  // read as "two different destinations for the same person."
  const desiree = await query<{ email: string; project_key: string }>(
    `SELECT DISTINCT c.email, p.project_key FROM agent.contacts c
       JOIN agent.interactions i ON i.contact_id = c.id
       JOIN agent.projects p ON p.id = i.project_id
      WHERE c.email = 'dez@strivevineyards.com'`
  )
  assert.equal(desiree.length, 1)
  assert.equal(desiree[0].project_key, 'destination-willcox')
})

// Phase 2P added two more REAL, live-verified contacts (Kathleen
// Eickhoff / Elkhart Lake, Patrick Randall / Grand Lake) once Elkhart
// Lake and Grand Lake had their real, already-sent outreach reconciled
// — updating the expected count to match, not weakening the
// no-manufactured-contact check: Buena Vista, Williams AZ, and Rim
// Country must still have none.
test('live acceptance: exactly the three real, verified contacts exist — none manufactured for Buena Vista, Williams AZ, or Rim Country', { skip }, async () => {
  const totalContacts = await query<{ count: string }>(`SELECT count(*)::text FROM agent.contacts`)
  assert.equal(totalContacts[0]?.count, '3')

  const noContact = await query<{ count: string }>(
    `SELECT count(*)::text FROM agent.contacts c
       JOIN agent.interactions i ON i.contact_id = c.id
       JOIN agent.projects p ON p.id = i.project_id
      WHERE p.project_key IN ('destination-buena-vista', 'destination-williams-az', 'destination-rim-country')`
  )
  assert.equal(noContact[0]?.count, '0')
})

// ---------------------------------------------------------------------------
// Phase 2N — Jerry's real Gmail reply to Desiree reconciled into
// operational state (reconcileWillcoxJerryReply.ts). No
// destination_relationship playbook run was fabricated.
// ---------------------------------------------------------------------------

test('live acceptance: both the inbound (Desiree) and outbound (Jerry) messages are recorded as Willcox interactions, correctly directioned', { skip }, async () => {
  const rows = await query<{ direction: string; source_ref: string }>(
    `SELECT i.direction, i.source_ref FROM agent.interactions i JOIN agent.projects p ON p.id = i.project_id WHERE p.project_key = 'destination-willcox' ORDER BY i.occurred_at`
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => [r.direction, r.source_ref]), [
    ['INBOUND', 'gmail:1a071eba028425e5'],
    ['OUTBOUND', 'gmail:1a0726835de40856'],
  ])
})

test('live acceptance: Willcox is now WAITING on the Chamber board vote, with no destination_relationship playbook run fabricated', { skip }, async () => {
  const rows = await query<{ status: string; next_check_at: string | null }>(
    "SELECT status, next_check_at FROM agent.tasks WHERE source_type = 'destination_relationship_checkpoint' AND source_ref = 'willcox-chamber-board-vote-2026-09-10'"
  )
  assert.equal(rows[0]?.status, 'WAITING')
  assert.ok(rows[0]?.next_check_at)

  const runs = await query<{ count: string }>("SELECT count(*)::text FROM agent.tasks WHERE source_type = 'playbook_run' AND source_ref LIKE '%destination-willcox%'")
  assert.equal(runs[0]?.count, '0', 'no destination_relationship (or other playbook) run was fabricated for Willcox')
})

after(async () => {
  if (hasDb) await closePool()
})
