// Postgres-backed implementations for outreachCampaign.ts. Existing tables only:
//   reads : public.items / neighborhoods / metro_areas / business_outreach_tokens,
//           agent.contacts / agent.interactions / agent.tasks
//   writes: ONLY DbCampaignWriter, and ONLY when `approve` passes every gate.

import { query, withWriteTransaction } from '../db'
import { createTask, ensureProject } from '../mutations'
import type { GmailAdapter } from './googleAdapters'
import { BIZDEV_CAMPAIGN_SOURCE_TYPE, BIZDEV_SOURCE_TYPE, DbBizDevStore } from './bizDevOutreach'
import type { CampaignBatch, CampaignRuntime } from './bizDevCampaign'
import { PriorContactIndex, type ContactedRecord } from './priorContact'
import type { ImportWriter, ImportedRecipientWrite } from './outreachImport'
import { ApprovalRefused, TEST_TOKEN_CAMPAIGN_PATTERN, summarizeCampaign, type CampaignReport, type CampaignWriter, type ContactInfo, type IntakeLookups, type ItemInfo, type ReportRecipient } from './outreachCampaign'

export class DbIntakeLookups implements IntakeLookups {
  /** Winston's contacted-records (all campaigns, test/canary excluded). Gmail Sent history is added by the existing gmailPriorSent check. */
  async priorContactIndex(): Promise<PriorContactIndex> {
    return new PriorContactIndex(await loadContactedRecords())
  }

  constructor(private readonly gmail?: GmailAdapter) {
    if (gmail) this.gmailPriorSent = (emails: string[]) => this.priorSent(emails)
  }
  gmailPriorSent?: (emails: string[]) => Promise<Set<string>>

  async items(ids: string[]): Promise<Map<string, ItemInfo>> {
    const out = new Map<string, ItemInfo>()
    if (ids.length === 0) return out
    const rows = await query<{ id: string; body: string; is_active: boolean; is_secret: boolean; metro_slug: string | null }>(
      `SELECT i.id, i.body, i.is_active, i.is_secret, m.slug AS metro_slug
         FROM public.items i
         LEFT JOIN public.neighborhoods n ON n.id = i.neighborhood_id
         LEFT JOIN public.metro_areas m ON m.id = n.metro_id
        WHERE i.id = ANY($1::uuid[])`,
      [ids]
    )
    const tokens = await query<{ item_id: string; token: string }>(
      // Tokens minted for test/canary campaigns are retired from planning: a real campaign never reuses them, so it mints fresh production tokens.
      // The test rows themselves stay untouched (history, opened_at, links already emailed to Jerry keep working).
      `SELECT DISTINCT ON (item_id) item_id, token FROM public.business_outreach_tokens WHERE item_id = ANY($1::uuid[]) AND coalesce(campaign, '') !~ $2 ORDER BY item_id, created_at`,
      [ids, TEST_TOKEN_CAMPAIGN_PATTERN]
    )
    const tokenOf = new Map(tokens.map((t) => [t.item_id, t.token]))
    for (const r of rows) out.set(r.id, { id: r.id, text: r.body, isActive: r.is_active, isSecret: r.is_secret, metroSlug: r.metro_slug, existingToken: tokenOf.get(r.id) })
    return out
  }

  async contactsByEmail(emails: string[]): Promise<Map<string, ContactInfo>> {
    const rows = await query<{ id: string; email: string; relationship_status: string | null; has_out: boolean }>(
      `SELECT c.id, lower(c.email) AS email, c.relationship_status,
              EXISTS (SELECT 1 FROM agent.interactions i WHERE i.contact_id = c.id AND i.direction = 'OUTBOUND') AS has_out
         FROM agent.contacts c WHERE lower(c.email) = ANY($1::text[])`,
      [emails]
    )
    return new Map(rows.map((r) => [r.email, { id: r.id, suppressed: r.relationship_status === 'DO_NOT_CONTACT', hasOutbound: r.has_out }]))
  }

  private async priorSent(emails: string[]): Promise<Set<string>> {
    const found = new Set<string>()
    const want = new Set(emails.map((e) => e.toLowerCase()))
    for (let i = 0; i < emails.length; i += 20) {
      const chunk = emails.slice(i, i + 20)
      const hits = await this.gmail!.searchMessages(`in:sent (${chunk.map((e) => `to:${e}`).join(' OR ')})`, 100)
      for (const m of hits) for (const to of m.to) {
        const addr = (to.match(/<([^<>]+)>/)?.[1] ?? to).trim().toLowerCase()
        if (want.has(addr)) found.add(addr)
      }
    }
    return found
  }

  /** Gmail message ids already recorded on recipients of a campaign (for idempotent re-imports). */
  async importedMessageIds(campaignKey: string): Promise<Set<string>> {
    const rows = await query<{ id: string }>(
      `SELECT s->>'messageId' AS id FROM agent.tasks t, jsonb_array_elements(coalesce(t.metadata #> '{bizdev,stepsSent}', '[]'::jsonb)) s
        WHERE t.source_type = $1 AND t.metadata #>> '{bizdev,campaignKey}' = $2`,
      [BIZDEV_SOURCE_TYPE, campaignKey]
    )
    return new Set(rows.map((r) => r.id))
  }

  async existingCampaignRecipients(campaignKey: string): Promise<Set<string>> {
    // Only recipients of a campaign that actually EXISTS count: orphans from an interrupted approval are refreshed by the next approve, not excluded.
    const rows = await query<{ source_ref: string }>(
      `SELECT t.source_ref FROM agent.tasks t
        WHERE t.source_type = $1 AND t.source_ref LIKE $2
          AND EXISTS (SELECT 1 FROM agent.tasks c WHERE c.source_type = $3 AND c.source_ref = $4)
          -- A recipient that was queued but never claimed/sent is NOT "already in the campaign": a retried approval refreshes it.
          AND NOT (t.status = 'READY' AND coalesce(t.metadata #>> '{bizdev,sequenceStatus}', 'QUEUED') = 'QUEUED'
                   AND coalesce((t.metadata #>> '{bizdev,claimedStep}')::int, 0) = 0)`,
      [BIZDEV_SOURCE_TYPE, `${campaignKey}:%`, BIZDEV_CAMPAIGN_SOURCE_TYPE, campaignKey]
    )
    return new Set(rows.map((r) => r.source_ref.slice(campaignKey.length + 1).toLowerCase()))
  }
}

export class DbCampaignWriter implements CampaignWriter, ImportWriter {
  async ensureProject(projectKey: string, name: string, summary: string): Promise<void> {
    await ensureProject({ projectKey, name, projectType: 'INTERNAL', ownerKey: 'chief', summary })
  }

  async upsertContact(r: { email: string; businessName: string; contactName: string | null; website: string | null; source: string }): Promise<string> {
    const existing = await query<{ id: string }>(`SELECT id FROM agent.contacts WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1`, [r.email])
    if (existing[0]) return existing[0].id
    return withWriteTransaction(async (c) => {
      const ins = await c.query<{ id: string }>(
        `INSERT INTO agent.contacts (organization_name, person_name, email, website, source, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [r.businessName, r.contactName, r.email.toLowerCase(), r.website, r.source, 'Created by outreach campaign approval.']
      )
      return ins.rows[0].id
    })
  }

  async getCampaign(key: string): Promise<CampaignRuntime | null> {
    const rows = await query<{ id: string; campaign: Omit<CampaignRuntime, 'taskId'> | null }>(`SELECT id, metadata->'campaign' AS campaign FROM agent.tasks WHERE source_type = $1 AND source_ref = $2`, [BIZDEV_CAMPAIGN_SOURCE_TYPE, key])
    const r = rows[0]
    if (!r) return null
    if (!r.campaign) throw new ApprovalRefused(`Campaign task "${key}" exists but has no campaign record; refusing to append to it.`)
    return { ...r.campaign, taskId: r.id }
  }

  async campaignAssignments(key: string): Promise<Array<{ email: string; itemId: string; token: string }>> {
    const rows = await query<{ email: string; item_id: string; token: string }>(
      `SELECT lower(t.metadata #>> '{bizdev,contactEmail}') AS email, l->>'itemId' AS item_id, l->>'token' AS token
         FROM agent.tasks t, jsonb_array_elements(coalesce(t.metadata #> '{bizdev,listings}', '[]'::jsonb)) l
        WHERE t.source_type = $1 AND t.metadata #>> '{bizdev,campaignKey}' = $2
          AND EXISTS (SELECT 1 FROM agent.tasks c WHERE c.source_type = $3 AND c.source_ref = $2)`,
      [BIZDEV_SOURCE_TYPE, key, BIZDEV_CAMPAIGN_SOURCE_TYPE]
    )
    return rows.map((r) => ({ email: r.email, itemId: r.item_id, token: r.token }))
  }

  async recordBatch(key: string, batch: CampaignBatch): Promise<void> {
    const n = await withWriteTransaction(async (c) => {
      const r = await c.query(
        `UPDATE agent.tasks SET metadata = jsonb_set(metadata, '{campaign,batches}', coalesce(metadata #> '{campaign,batches}', '[]'::jsonb) || $2::jsonb)
          WHERE source_type = $3 AND source_ref = $1 AND metadata ? 'campaign'`,
        [key, JSON.stringify([batch]), BIZDEV_CAMPAIGN_SOURCE_TYPE]
      )
      return r.rowCount ?? 0
    })
    if (n !== 1) throw new Error(`campaign ${key} not found while recording the batch`)
  }

  async createCampaignTask(runtime: Omit<CampaignRuntime, 'taskId'>, projectKey: string): Promise<string> {
    const res = await createTask({
      title: `Outreach campaign: ${runtime.name}`,
      projectKey,
      status: 'READY',
      changedByOwnerKey: 'chief',
      ownerKey: 'chief',
      nextAction: `Approved. Apply the token SQL, then run: npx tsx agent-service/outreachCampaignCli.ts activate ${runtime.key}`,
      sourceType: BIZDEV_CAMPAIGN_SOURCE_TYPE,
      sourceRef: runtime.key,
    })
    if (!res.created) throw new ApprovalRefused(`Campaign "${runtime.key}" already exists; refusing to overwrite its approval record.`)
    await withWriteTransaction(async (c) => {
      await c.query(`UPDATE agent.tasks SET metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{campaign}', $2::jsonb) WHERE id = $1`, [res.task.id, JSON.stringify(runtime)])
    })
    return res.task.id
  }

  /**
   * Imported recipient: WAITING, first touch already recorded and latched. Idempotent and crash-safe: the task is keyed by source_ref,
   * the bizdev state is only ever written to a task that does not have one yet, and the interaction is keyed by the Gmail message id.
   * An existing recipient is never overwritten.
   */
  async createSentRecipient(w: ImportedRecipientWrite): Promise<boolean> {
    const res = await createTask({
      title: w.title,
      projectKey: w.projectKey,
      status: 'WAITING',
      changedByOwnerKey: 'chief',
      ownerKey: 'chief',
      contactId: w.contactId,
      nextAction: w.nextAction,
      nextCheckAt: w.nextCheckAt,
      sourceType: BIZDEV_SOURCE_TYPE,
      sourceRef: w.sourceRef,
    })
    await withWriteTransaction(async (c) => {
      await c.query(`UPDATE agent.tasks SET metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{bizdev}', $2::jsonb) WHERE id = $1 AND NOT (coalesce(metadata,'{}'::jsonb) ? 'bizdev')`, [res.task.id, JSON.stringify(w.state)])
      await c.query(
        `INSERT INTO agent.interactions (contact_id, project_id, task_id, channel, direction, occurred_at, subject, summary, requires_action, source_ref, metadata)
         SELECT $1, t.project_id, t.id, 'EMAIL', 'OUTBOUND', $3::timestamptz, $4, $5, false, $6, $7::jsonb FROM agent.tasks t WHERE t.id = $2
         ON CONFLICT DO NOTHING`,
        [w.contactId, res.task.id, w.interaction.occurredAt, w.interaction.subject, w.interaction.summary, `gmail:${w.interaction.messageId}`, JSON.stringify({ gmailMessageId: w.interaction.messageId, gmailThreadId: w.interaction.threadId, ...w.interaction.extra })]
      )
    })
    return res.created
  }

  async createRecipientTask(i: { projectKey: string; title: string; contactId: string; sourceRef: string; state: Record<string, unknown> }): Promise<boolean> {
    const res = await createTask({
      title: i.title,
      projectKey: i.projectKey,
      status: 'READY',
      changedByOwnerKey: 'chief',
      ownerKey: 'chief',
      contactId: i.contactId,
      nextAction: 'Queued for first-touch send once the campaign is activated.',
      sourceType: BIZDEV_SOURCE_TYPE,
      sourceRef: i.sourceRef,
    })
    // Set (or, for a never-sent QUEUED recipient from an interrupted earlier attempt, REFRESH) the recipient state. A recipient that
    // has already been claimed or sent is never touched.
    await withWriteTransaction(async (c) => {
      await c.query(
        `UPDATE agent.tasks SET metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{bizdev}', $2::jsonb)
          WHERE id = $1 AND status = 'READY'
            AND (NOT (coalesce(metadata,'{}'::jsonb) ? 'bizdev')
                 OR (metadata #>> '{bizdev,sequenceStatus}' = 'QUEUED' AND coalesce((metadata #>> '{bizdev,claimedStep}')::int, 0) = 0))`,
        [res.task.id, JSON.stringify(i.state)]
      )
    })
    return res.created
  }
}

export async function loadDigest(key: string): Promise<{ report: CampaignReport; extras: import('./outreachCampaign').DigestExtras }> {
  const report = await loadCampaignReport(key)
  const camp = await query<{ campaign: CampaignRuntime }>(`SELECT metadata->'campaign' AS campaign FROM agent.tasks WHERE source_type = $1 AND source_ref = $2`, [BIZDEV_CAMPAIGN_SOURCE_TYPE, key])
  const c = camp[0]?.campaign
  const r = await query<{ ft: string; fu: string; due: string }>(
    `SELECT
       count(*) FILTER (WHERE jsonb_array_length(coalesce(t.metadata #> '{bizdev,stepsSent}','[]'::jsonb)) > 0 AND (t.metadata #>> '{bizdev,stepsSent,0,sentAt}')::timestamptz >= now() - interval '24 hours')::text AS ft,
       coalesce(sum((SELECT count(*) FROM jsonb_array_elements(coalesce(t.metadata #> '{bizdev,stepsSent}','[]'::jsonb)) s WHERE s->>'kind' = 'FOLLOW_UP' AND (s->>'sentAt')::timestamptz >= now() - interval '24 hours')), 0)::text AS fu,
       count(*) FILTER (WHERE t.status = 'WAITING' AND t.metadata #>> '{bizdev,sequenceStatus}' = 'ACTIVE' AND jsonb_array_length(coalesce(t.metadata #> '{bizdev,stepsSent}','[]'::jsonb)) < 3 AND t.next_check_at <= now() + interval '24 hours')::text AS due
       FROM agent.tasks t WHERE t.source_type = $1 AND t.metadata #>> '{bizdev,campaignKey}' = $2`,
    [BIZDEV_SOURCE_TYPE, key]
  )
  return { report, extras: { firstTouchesLast24h: Number(r[0]?.ft ?? 0), followUpsLast24h: Number(r[0]?.fu ?? 0), followUpsDueNext24h: Number(r[0]?.due ?? 0), dailyLimit: c?.firstTouchDailyLimit ?? 50, dailyCap: c?.dailyCap ?? 80 } }
}

export async function loadCampaignReport(key: string): Promise<CampaignReport> {
  const camp = await query<{ campaign: CampaignRuntime }>(`SELECT metadata->'campaign' AS campaign FROM agent.tasks WHERE source_type = $1 AND source_ref = $2`, [BIZDEV_CAMPAIGN_SOURCE_TYPE, key])
  const rows = await query<{ status: string; bizdev: ReportRecipient['state']; next_check_at: Date | null; next_action: string | null }>(
    `SELECT t.status, t.metadata->'bizdev' AS bizdev, t.next_check_at, t.next_action
       FROM agent.tasks t WHERE t.source_type = $1 AND t.metadata #>> '{bizdev,campaignKey}' = $2`,
    [BIZDEV_SOURCE_TYPE, key]
  )
  const classes = await query<{ rc: string | null; n: string }>(
    `SELECT i.metadata->>'replyClass' AS rc, count(*)::text AS n
       FROM agent.interactions i JOIN agent.tasks t ON t.id = i.task_id
      WHERE i.direction = 'INBOUND' AND t.source_type = $1 AND t.metadata #>> '{bizdev,campaignKey}' = $2
      GROUP BY 1`,
    [BIZDEV_SOURCE_TYPE, key]
  )
  const counts: Record<string, number> = {}
  for (const c of classes) if (c.rc) counts[c.rc] = Number(c.n)
  const recips: ReportRecipient[] = rows.map((r) => ({ status: r.status, state: r.bizdev, nextCheckAt: r.next_check_at ? r.next_check_at.toISOString() : null, nextAction: r.next_action }))
  return summarizeCampaign(camp[0]?.campaign ?? null, key, recips, counts)
}

/** Everything Winston has recorded as actually CONTACTED (test and canary campaigns excluded), for the prior-contact index. */
export function loadContactedRecords(): Promise<ContactedRecord[]> {
  return new DbBizDevStore().contactedRecords()
}
