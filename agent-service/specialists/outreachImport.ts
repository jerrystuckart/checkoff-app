// Importing recipients that were ALREADY contacted into a running campaign (e.g. the 16 reply-based Green Bay
// first touches that were sent from Gmail on 2026-10-14, outside Winston).
//
// Principles, in order:
//   1. Gmail is authoritative. Recipient, sender, send time, thread and subject come from the Gmail message itself;
//      the spreadsheet only says WHICH message to look at. A disagreement is reported and Gmail wins.
//   2. A first touch is never sent again. Imported recipients are created as WAITING with the first touch recorded
//      and latched (claimedStep = 1), so they are never in the first-touch queue. The prior-contact index
//      (priorContact.ts) is a second, independent barrier.
//   3. The follow-up clock is anchored to the actual Gmail send time, using the campaign's own cadence and templates.
//   4. Existing tables only. Imported recipients are ordinary green-bay-p1 recipient tasks.
//
// Pure apart from the injected ports; the CLI wires them to Gmail and the database.

import { createHash } from 'node:crypto'
import { addBusinessDays } from './bizDevOutreach'
import type { CampaignBatch, CampaignRuntime } from './bizDevCampaign'
import {
  ApprovalRefused, assertNoDuplicateAssignments, buildTokenSql, mergeVars, mintToken, parseCsv,
  type CampaignDefinition, type ContactInfo, type Issue, type ItemInfo, type MintedRecipient, type PlannedRecipient,
} from './outreachCampaign'
import { confirmUrlFor } from './outreachTemplates'
import { describeConflicts, normalizeEmail, type PriorContactConflict, PriorContactIndex } from './priorContact'

const err = (code: string, message: string, extra: Partial<Issue> = {}): Issue => ({ severity: 'ERROR', code, message, ...extra })
const warn = (code: string, message: string, extra: Partial<Issue> = {}): Issue => ({ severity: 'WARN', code, message, ...extra })
const info = (code: string, message: string, extra: Partial<Issue> = {}): Issue => ({ severity: 'INFO', code, message, ...extra })

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** What Gmail says about one sent message. */
export interface SentMessageFacts {
  id: string
  threadId: string
  from: string
  /** The single recipient address, lowercased. */
  to: string
  subject: string
  /** The Date header as an ISO instant (second precision). */
  sentAt: string
  bodyText: string
  /** RFC Message-ID header, used as In-Reply-To for threaded follow-ups. */
  messageIdHeader: string | null
}

export interface ImportDeps {
  /** Gmail is the authority. Null when the message does not exist. */
  getSentMessage(messageId: string): Promise<SentMessageFacts | null>
  items(ids: string[]): Promise<Map<string, ItemInfo>>
  contactsByEmail(emails: string[]): Promise<Map<string, ContactInfo>>
  /** Everything Winston already recorded as contacted (all campaigns). */
  priorContacts: PriorContactIndex
  /** Gmail message ids already recorded on a recipient of THIS campaign (idempotent re-runs). */
  importedMessageIds: ReadonlySet<string>
  /** Item/token assignments already held by the campaign's recipients. */
  assignments: Array<{ email: string; itemId: string; token: string }>
}

export interface ImportConfig {
  campaign: CampaignRuntime
  metroSlug: string
  /** Display name of the source file, recorded on each recipient for provenance. */
  sourceLabel: string
  /** Item/token assignments the campaign's recipients already hold (checked again at write time). */
  assignments?: Array<{ email: string; itemId: string; token: string }>
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export interface ImportCsvRow {
  rowNumber: number
  business_name: string
  contact_email: string
  item_id: string
  gmail_message_id: string
  sent_at: string
  website: string
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const ALIASES: Record<string, string[]> = {
  business_name: ['business_name', 'business', 'venue_business'],
  contact_email: ['contact_email', 'email', 'recipient', 'public_email_not_guessed'],
  item_id: ['item_id', 'checkoff_item_id'],
  gmail_message_id: ['gmail_message_id', 'message_id'],
  sent_at: ['sent_at', 'sent'],
  website: ['website'],
}

export function readImportCsv(text: string): { rows: ImportCsvRow[]; issues: Issue[] } {
  const table = parseCsv(text)
  if (table.length === 0) return { rows: [], issues: [err('CSV_EMPTY', 'The CSV is empty')] }
  const header = table[0].map(norm)
  const idx: Record<string, number> = {}
  for (const [canon, names] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => names.includes(h))
    if (i >= 0) idx[canon] = i
  }
  const issues: Issue[] = []
  for (const req of ['business_name', 'contact_email', 'item_id', 'gmail_message_id']) if (idx[req] === undefined) issues.push(err('CSV_COLUMN', `Missing required column "${req}"`))
  if (issues.length) return { rows: [], issues }
  const rows: ImportCsvRow[] = []
  for (let r = 1; r < table.length; r++) {
    const c = table[r]
    if (c.every((x) => !x.trim())) continue
    const get = (k: string) => (idx[k] !== undefined ? (c[idx[k]] ?? '').trim() : '')
    rows.push({ rowNumber: r + 1, business_name: get('business_name'), contact_email: get('contact_email').toLowerCase(), item_id: get('item_id').toLowerCase(), gmail_message_id: get('gmail_message_id'), sent_at: get('sent_at'), website: get('website') })
  }
  return { rows, issues: [] }
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface ImportItem {
  itemId: string
  text: string
  /** A production token that already exists for the item (test/canary tokens never count). */
  existingToken?: string
}

export interface ImportRecipient {
  email: string
  businessName: string
  website: string | null
  messageId: string
  threadId: string
  subject: string
  messageIdHeader: string | null
  /** From Gmail, never from the spreadsheet. */
  sentAt: string
  followUp1DueAt: string
  items: ImportItem[]
  /** ALREADY_IMPORTED means the message id is recorded on this campaign already; nothing to write. */
  status: 'NEW' | 'ALREADY_IMPORTED'
}

export interface ImportPlan {
  campaignKey: string
  recipients: ImportRecipient[]
  issues: Issue[]
  counts: { rows: number; recipients: number; newRecipients: number; alreadyImported: number; items: number; newTokensNeeded: number; errors: number; warnings: number }
  inputHash: string
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function buildImportPlan(csvText: string, cfg: ImportConfig, deps: ImportDeps): Promise<ImportPlan> {
  const issues: Issue[] = []
  const { rows, issues: csvIssues } = readImportCsv(csvText)
  issues.push(...csvIssues)
  const recipients: ImportRecipient[] = []
  if (csvIssues.some((i) => i.severity === 'ERROR')) return finalize(cfg, rows, recipients, issues)

  // ---- campaign must be able to take them ----
  const c = cfg.campaign
  if (c.state === 'COMPLETE') issues.push(err('CAMPAIGN_COMPLETE', `Campaign ${c.key} is COMPLETE`))
  if (!c.approval || c.approval.approvedBy !== 'jerry') issues.push(err('CAMPAIGN_UNAPPROVED', `Campaign ${c.key} has no recorded approval`))

  // ---- group rows by Gmail message: one message == one recipient (several items allowed) ----
  const groups = new Map<string, ImportCsvRow[]>()
  const seenPair = new Set<string>()
  for (const r of rows) {
    const at = { row: r.rowNumber }
    if (!r.gmail_message_id) { issues.push(err('ROW_NO_MESSAGE', `"${r.business_name}": gmail_message_id is empty`, at)); continue }
    if (!r.business_name || !r.contact_email || !r.item_id) { issues.push(err('ROW_INCOMPLETE', `message ${r.gmail_message_id}: business_name, contact_email and item_id are all required`, at)); continue }
    if (!UUID.test(r.item_id)) { issues.push(err('ROW_BAD_ITEM_ID', `"${r.business_name}": item_id "${r.item_id}" is not a UUID`, at)); continue }
    const pair = `${r.gmail_message_id}|${r.item_id}`
    if (seenPair.has(pair)) { issues.push(warn('ROW_DUPLICATE', `"${r.business_name}": duplicate row for the same message and item; dropped`, at)); continue }
    seenPair.add(pair)
    groups.set(r.gmail_message_id, [...(groups.get(r.gmail_message_id) ?? []), r])
  }

  const allItemIds = [...new Set([...groups.values()].flat().map((r) => r.item_id))]
  const items = await deps.items(allItemIds)
  const emailsSeen = new Map<string, string>()
  const itemsSeen = new Map<string, string>()

  for (const [messageId, g] of groups) {
    const first = g[0]
    const at = { row: first.rowNumber, email: first.contact_email }
    const emails = new Set(g.map((x) => x.contact_email))
    const names = new Set(g.map((x) => x.business_name))
    if (emails.size > 1) { issues.push(err('MESSAGE_MULTI_EMAIL', `message ${messageId} is listed for ${emails.size} different addresses (${[...emails].join(', ')})`, at)); continue }
    if (names.size > 1) issues.push(warn('MESSAGE_MULTI_BUSINESS', `message ${messageId} is listed under ${names.size} business names (${[...names].join(' / ')}); using "${first.business_name}"`, at))

    // ---- Gmail is the authority ----
    const facts = await deps.getSentMessage(messageId)
    if (!facts) { issues.push(err('GMAIL_NOT_FOUND', `"${first.business_name}": Gmail has no sent message ${messageId}`, at)); continue }
    if (facts.from.toLowerCase() !== c.from.toLowerCase()) { issues.push(err('GMAIL_WRONG_SENDER', `"${first.business_name}": message ${messageId} was sent from ${facts.from}, not ${c.from}`, at)); continue }
    if (facts.to !== first.contact_email) { issues.push(err('GMAIL_RECIPIENT_MISMATCH', `"${first.business_name}": the spreadsheet says ${first.contact_email} but Gmail shows message ${messageId} went to ${facts.to}`, at)); continue }
    if (first.sent_at) {
      const wb = Date.parse(first.sent_at.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(first.sent_at) ? '' : 'Z'))
      if (!Number.isNaN(wb) && Math.abs(wb - Date.parse(facts.sentAt)) > 1500) issues.push(warn('GMAIL_TIME_DIFFERS', `"${first.business_name}": spreadsheet time ${first.sent_at} differs from Gmail ${facts.sentAt}; Gmail's time is used`, at))
    }
    if (/getcheckoff\.com\/confirm\//i.test(facts.bodyText)) { issues.push(err('SENT_HAS_CONFIRM_LINK', `"${first.business_name}": message ${messageId} already contains a /confirm link; it is not a reply-only first touch, so its token must come from the email itself`, at)); continue }

    // ---- items: exist, active, not secret, right metro, and ACTUALLY in the sent email ----
    const bodySq = squash(facts.bodyText)
    const planned: ImportItem[] = []
    let itemsOk = true
    for (const r of g) {
      const info_ = items.get(r.item_id)
      const iat = { row: r.rowNumber, email: r.contact_email }
      if (!info_) { issues.push(err('ITEM_NOT_FOUND', `"${r.business_name}": item ${r.item_id} does not exist`, iat)); itemsOk = false; continue }
      if (!info_.isActive) { issues.push(err('ITEM_INACTIVE', `"${r.business_name}": item ${r.item_id} is not active`, iat)); itemsOk = false; continue }
      if (info_.isSecret) { issues.push(err('ITEM_SECRET', `"${r.business_name}": item ${r.item_id} is a secret item`, iat)); itemsOk = false; continue }
      if (info_.metroSlug !== cfg.metroSlug) { issues.push(err('ITEM_WRONG_METRO', `"${r.business_name}": item ${r.item_id} belongs to metro "${info_.metroSlug ?? 'none'}", not "${cfg.metroSlug}"`, iat)); itemsOk = false; continue }
      if (!bodySq.includes(squash(info_.text))) { issues.push(err('ITEM_NOT_IN_EMAIL', `"${r.business_name}": the text of item ${r.item_id} does not appear in the email Gmail shows was sent, so the mapping cannot be verified`, iat)); itemsOk = false; continue }
      const owner = itemsSeen.get(r.item_id)
      if (owner && owner !== r.contact_email) { issues.push(err('ITEM_MULTI_OWNER', `item ${r.item_id} is assigned to both ${owner} and ${r.contact_email}`, iat)); itemsOk = false; continue }
      itemsSeen.set(r.item_id, r.contact_email)
      planned.push({ itemId: r.item_id, text: info_.text, existingToken: info_.existingToken })
    }
    if (!itemsOk) continue

    const prevMsg = emailsSeen.get(normalizeEmail(first.contact_email))
    if (prevMsg && prevMsg !== messageId) { issues.push(err('EMAIL_TWO_MESSAGES', `${first.contact_email} appears on two different sent messages (${prevMsg} and ${messageId})`, at)); continue }
    emailsSeen.set(normalizeEmail(first.contact_email), messageId)

    // ---- idempotence + prior-contact suppression ----
    const already = deps.importedMessageIds.has(messageId)
    const conflicts = deps.priorContacts.check({ email: first.contact_email, businessName: first.business_name, itemIds: planned.map((p) => p.itemId), messageIds: [messageId] })
    const foreign = conflicts.filter((x) => !(already && isOwnRecord(x)))
    if (foreign.length > 0 && !already) {
      issues.push(err('PRIOR_CONTACT', `"${first.business_name}": already contacted elsewhere in Winston (${describeConflicts(foreign)}); importing would record the same contact twice`, at))
      continue
    }
    if (already) issues.push(info('ALREADY_IMPORTED', `"${first.business_name}": message ${messageId} is already recorded on ${c.key}; nothing to do`, at))
    for (const a of deps.assignments) {
      for (const p of planned) if (a.itemId === p.itemId && normalizeEmail(a.email) !== normalizeEmail(first.contact_email)) issues.push(err('ITEM_HELD_BY_OTHER', `item ${p.itemId} already belongs to ${a.email} in ${c.key}`, at))
    }

    recipients.push({
      email: first.contact_email,
      businessName: first.business_name,
      website: g.map((x) => x.website).find(Boolean) ?? null,
      messageId,
      threadId: facts.threadId,
      subject: facts.subject,
      messageIdHeader: facts.messageIdHeader,
      sentAt: facts.sentAt,
      followUp1DueAt: addBusinessDays(new Date(facts.sentAt), c.followUps[0]?.afterBusinessDays ?? 5).toISOString(),
      items: planned,
      status: already ? 'ALREADY_IMPORTED' : 'NEW',
    })
  }
  recipients.sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.email.localeCompare(b.email))
  return finalize(cfg, rows, recipients, issues)
}

// Records that came from the same message id are the candidate's own earlier import, not a foreign contact.
function isOwnRecord(x: PriorContactConflict): boolean {
  return x.via === 'winston'
}

function finalize(cfg: ImportConfig, rows: ImportCsvRow[], recipients: ImportRecipient[], issues: Issue[]): ImportPlan {
  const itemCount = recipients.reduce((n, r) => n + r.items.length, 0)
  const newOnes = recipients.filter((r) => r.status === 'NEW')
  const core = { k: cfg.campaign.key, r: recipients.map((r) => [r.email, r.messageId, r.sentAt, r.status, r.items.map((i) => [i.itemId, i.existingToken ?? null])]) }
  return {
    campaignKey: cfg.campaign.key,
    recipients,
    issues,
    counts: {
      rows: rows.length,
      recipients: recipients.length,
      newRecipients: newOnes.length,
      alreadyImported: recipients.length - newOnes.length,
      items: itemCount,
      newTokensNeeded: newOnes.reduce((n, r) => n + r.items.filter((i) => !i.existingToken).length, 0),
      errors: issues.filter((i) => i.severity === 'ERROR').length,
      warnings: issues.filter((i) => i.severity === 'WARN').length,
    },
    inputHash: createHash('sha256').update(JSON.stringify(core)).digest('hex').slice(0, 16),
  }
}

// ---------------------------------------------------------------------------
// Approval + writing
// ---------------------------------------------------------------------------

export interface ImportApproveArgs {
  confirmRecipients: number
  previewHash: string
  now: Date
}

export function assertImportApprovable(plan: ImportPlan, a: ImportApproveArgs): void {
  const why: string[] = []
  if (plan.counts.errors > 0) why.push(`${plan.counts.errors} validation error(s) remain`)
  if (plan.recipients.length === 0) why.push('there are no recipients')
  if (a.confirmRecipients !== plan.recipients.length) why.push(`--confirm-recipients ${a.confirmRecipients} does not match the ${plan.recipients.length} recipients in the plan`)
  if (a.previewHash !== plan.inputHash) why.push(`--preview-hash ${a.previewHash} does not match the current plan (${plan.inputHash}); re-run the preview and review it`)
  if (why.length) throw new ApprovalRefused(`Refusing to import: ${why.join('; ')}.`)
}

export interface ImportedRecipientWrite {
  projectKey: string
  title: string
  contactId: string
  sourceRef: string
  nextCheckAt: Date
  nextAction: string
  state: Record<string, unknown>
  /** The recorded first touch (Gmail message id is the interaction's unique key). */
  interaction: { occurredAt: string; subject: string; summary: string; messageId: string; threadId: string; extra: Record<string, unknown> }
}

export interface ImportWriter {
  ensureProject(projectKey: string, name: string, summary: string): Promise<void>
  upsertContact(r: { email: string; businessName: string; contactName: string | null; website: string | null; source: string }): Promise<string>
  /** Creates the recipient as WAITING with the first touch already recorded. Returns false (and writes nothing) when sourceRef already exists. */
  createSentRecipient(w: ImportedRecipientWrite): Promise<boolean>
  recordBatch(key: string, batch: CampaignBatch): Promise<void>
}

export interface ImportResult {
  campaignKey: string
  imported: number
  alreadyPresent: number
  newTokens: number
  tokenSql: string
}

export async function importSentRecipients(plan: ImportPlan, args: ImportApproveArgs, cfg: ImportConfig, writer: ImportWriter, mint: () => string = mintToken, beforeWrite?: (tokenSql: string) => void | Promise<void>): Promise<ImportResult> {
  assertImportApprovable(plan, args)
  const c = cfg.campaign
  if (c.expiresAt && Date.parse(c.expiresAt) <= args.now.getTime()) throw new ApprovalRefused(`Refusing to import: campaign ${c.key} expired at ${c.expiresAt}.`)
  const todo = plan.recipients.filter((r) => r.status === 'NEW')

  // 1. Tokens for every item that has no production token. The SQL is handed over BEFORE any database write.
  const minted: MintedRecipient[] = todo.map((r) => ({
    email: r.email,
    businessName: r.businessName,
    contactName: null,
    website: r.website,
    subject: r.subject,
    body: '',
    sourceRows: [],
    items: r.items.map((i, n) => ({ itemId: i.itemId, text: i.text, existingToken: i.existingToken, previewToken: `NEW_TOKEN_${n + 1}`, token: i.existingToken ?? mint(), isNew: !i.existingToken })),
  }))
  assertNoDuplicateAssignments(minted, cfg.assignments ?? [])
  const tokenSql = buildTokenSql({ key: c.key } as CampaignDefinition, minted)
  await beforeWrite?.(tokenSql)

  const projectKey = `bizdev-campaign-${c.key}`
  await writer.ensureProject(projectKey, `Outreach campaign: ${c.name}`, `Imported recipients appended to ${c.key}.`)

  let imported = 0
  let present = 0
  for (const r of minted) {
    const rec = todo.find((t) => t.email === r.email)!
    const tokenOf = new Map(r.items.map((i) => [i.itemId, i.token]))
    const planned: PlannedRecipient = { email: r.email, businessName: r.businessName, contactName: null, website: r.website, items: r.items, subject: rec.subject, body: '', sourceRows: [] }
    const vars = mergeVars({ metroLabel: c.metroLabel } as CampaignDefinition, planned, (i) => tokenOf.get(i.itemId)!)
    const contactId = await writer.upsertContact({ email: r.email, businessName: r.businessName, contactName: null, website: r.website, source: `campaign:${c.key}` })
    const next = new Date(rec.followUp1DueAt)
    const created = await writer.createSentRecipient({
      projectKey,
      title: `${c.name}: ${r.businessName} (imported, reply-based first touch)`,
      contactId,
      sourceRef: `${c.key}:${r.email}`,
      nextCheckAt: next,
      nextAction: `Await reply; Follow-Up 1 due ${next.toISOString().slice(0, 10)} if no substantive reply or confirmation.`,
      state: {
        sequenceKey: `campaign:${c.key}`,
        campaignKey: c.key,
        contactEmail: r.email,
        threadId: rec.threadId,
        sequenceStatus: 'ACTIVE',
        stepsSent: [{ step: 1, kind: 'INITIAL', messageId: rec.messageId, sentAt: rec.sentAt }],
        // Latched: the first touch can never be claimed or sent again.
        claimedStep: 1,
        attempts: [{ step: 1, at: rec.sentAt, outcome: 'ACCEPTED', detail: 'imported from Gmail (already sent)' }],
        subject: rec.subject,
        vars,
        listings: r.items.map((i) => ({ itemId: i.itemId, text: i.text, token: i.token, confirmUrl: confirmUrlFor(i.token) })),
        imported: { source: 'gmail_reconciliation', file: cfg.sourceLabel, importedAt: args.now.toISOString(), firstTouchMode: 'reply_only', firstTouchMessageIdHeader: rec.messageIdHeader },
      },
      interaction: {
        occurredAt: rec.sentAt,
        subject: rec.subject,
        summary: `First-touch outreach (reply-only, no confirm link) sent to ${r.businessName} (step 1); imported from Gmail.`,
        messageId: rec.messageId,
        threadId: rec.threadId,
        extra: { from: c.from, campaignKey: c.key, sequenceKey: `campaign:${c.key}`, sequenceStep: 1, imported: true, firstTouchMode: 'reply_only' },
      },
    })
    if (created) imported++
    else present++
  }

  const batch: CampaignBatch = { approvedAt: args.now.toISOString(), inputHash: plan.inputHash, recipientCount: todo.length, recipients: todo.map((r) => r.email), kind: 'IMPORTED_SENT' }
  if (!c.batches?.some((b) => b.inputHash === batch.inputHash)) await writer.recordBatch(c.key, batch)
  return { campaignKey: c.key, imported, alreadyPresent: present, newTokens: minted.reduce((n, r) => n + r.items.filter((i) => i.isNew).length, 0), tokenSql }
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export function renderImportPreview(plan: ImportPlan, cfg: ImportConfig, now: Date = new Date()): string {
  const c = cfg.campaign
  const L: string[] = []
  L.push(`# Import preview: already-sent recipients into ${plan.campaignKey}`, '', `Generated ${now.toISOString()}. **Nothing has been written to the database and nothing has been sent.**`, '')
  L.push('## Summary', '', `- Source: ${cfg.sourceLabel} (${plan.counts.rows} row(s))`, `- **Recipients: ${plan.counts.recipients}** (${plan.counts.newRecipients} new, ${plan.counts.alreadyImported} already imported) · items: ${plan.counts.items}`)
  L.push(`- New confirmation tokens needed: ${plan.counts.newTokensNeeded} (minted only at apply; SQL is emitted for you to review and apply)`)
  L.push(`- Campaign: ${c.key} (${c.state}); sender ${c.from}; follow-ups at +${c.followUps.map((f) => f.afterBusinessDays).join(', +')} business days, close +${c.closeAfterBusinessDays}; max ${c.maxOutbound} emails`)
  L.push(`- Errors: ${plan.counts.errors} · Warnings: ${plan.counts.warnings}`)
  L.push('- **Gmail is the authority**: recipient, send time, thread and subject below come from Gmail, not the spreadsheet.')
  L.push('- Each recipient is created as WAITING with its first touch recorded and latched. **A first touch is never sent to any of them.**')
  L.push(`- **Preview hash (required by apply): \`${plan.inputHash}\`**`, '')
  const errs = plan.issues.filter((i) => i.severity === 'ERROR')
  if (errs.length) L.push('## Errors (must be fixed before apply)', '', ...errs.map((i) => `- ${i.row ? `row ${i.row}: ` : ''}${i.message}`), '')
  const warns = plan.issues.filter((i) => i.severity === 'WARN')
  if (warns.length) L.push('## Warnings (Gmail was used)', '', ...warns.map((i) => `- ${i.row ? `row ${i.row}: ` : ''}${i.message}`), '')
  L.push('## Recipients', '', '| Business | Recipient | Gmail message | Sent (UTC, from Gmail) | Follow-Up 1 due | Items | Status |', '|---|---|---|---|---|---|---|')
  for (const r of plan.recipients) L.push(`| ${r.businessName} | ${r.email} | \`${r.messageId}\` | ${r.sentAt.replace('T', ' ').slice(0, 19)} | ${r.followUp1DueAt.replace('T', ' ').slice(0, 19)} | ${r.items.length} | ${r.status} |`)
  L.push('', '## Item mapping (each item text was found in the email Gmail shows was sent)', '')
  for (const r of plan.recipients) for (const i of r.items) L.push(`- ${r.businessName}: \`${i.itemId}\` ${i.existingToken ? `(existing production token)` : '(new token)'} — ${i.text}`)
  return L.join('\n') + '\n'
}
