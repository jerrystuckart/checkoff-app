// Campaign intake → preview → approval → activation → reporting.
//
// This is the "front half" of a business outreach campaign; the sending,
// follow-up, reply and bounce machinery is the shared engine in
// bizDevOutreach.ts (the same one Blair's sequence runs on).
//
// Everything here is pure or goes through a small injected interface, so the
// whole flow is testable with fakes and nothing touches production until Jerry
// runs `approve` for a specific, previewed list:
//   preview  — READ-ONLY. Parses a CSV, validates, consolidates, renders every
//              message, writes files. Writes nothing to the database.
//   approve  — requires the exact recipient count, the preview hash, and an
//              explicit templates-approved flag; writes the campaign + recipient
//              tasks (existing tables) and EMITS token SQL for Jerry to apply
//              (the agent DB role has read-only access to the token table; the
//              existing seed migrations are the established way to mint tokens).
//   activate — verifies tokens exist, sender is verified, kit URL is live; only
//              then can the monitor send.

import { createHash, randomBytes } from 'node:crypto'
import { addBusinessDays } from './bizDevOutreach'
import { CAMPAIGN_DEFAULTS, type CampaignRuntime, type CampaignBatch } from './bizDevCampaign'
import { buildItemsBlock, checkTemplate, CANONICAL_KIT_URL, confirmUrlFor, extractPlaceholders, renderTemplate, validateOutreachCopy, type ListingForEmail } from './outreachTemplates'

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type Severity = 'ERROR' | 'WARN' | 'INFO'
export interface Issue {
  severity: Severity
  code: string
  message: string
  row?: number
  email?: string
}

const err = (code: string, message: string, extra: Partial<Issue> = {}): Issue => ({ severity: 'ERROR', code, message, ...extra })
const warn = (code: string, message: string, extra: Partial<Issue> = {}): Issue => ({ severity: 'WARN', code, message, ...extra })
const info = (code: string, message: string, extra: Partial<Issue> = {}): Issue => ({ severity: 'INFO', code, message, ...extra })

// ---------------------------------------------------------------------------
// Campaign definition (JSON the operator supplies with the approved templates)
// ---------------------------------------------------------------------------

export interface CampaignDefinition {
  key: string
  name: string
  metroSlug: string
  metroLabel: string
  from?: string
  subjectTemplate: string
  firstTouchBody: string
  followUp1Body: string
  followUp2Body: string
  cadence?: { followUp1AfterBusinessDays?: number; followUp2AfterBusinessDays?: number; closeAfterBusinessDays?: number }
  dailyCap?: number
  providerLimit?: number
  reserve?: number
  batchPerTick?: number
  faqEnabled?: boolean
  allowPriorOutreach?: boolean
  /** Optional hard stop (ISO date-time). Required in practice for canaries so they cannot run indefinitely. */
  expiresAt?: string
  /** Jerry sets these to true only after reading the exact templates. `approve` refuses otherwise. */
  approvals: { firstTouchTemplate: boolean; followUpTemplates: boolean }
}

export function validateDefinition(d: CampaignDefinition): Issue[] {
  const out: Issue[] = []
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(d.key ?? '')) out.push(err('DEF_KEY', 'key must be a lowercase slug (letters, digits, hyphens), 3–61 chars'))
  for (const f of ['name', 'metroSlug', 'metroLabel', 'subjectTemplate', 'firstTouchBody', 'followUp1Body', 'followUp2Body'] as const) if (!String(d[f] ?? '').trim()) out.push(err('DEF_MISSING', `definition.${f} is required`))
  if (!d.approvals) out.push(err('DEF_APPROVALS', 'definition.approvals {firstTouchTemplate, followUpTemplates} is required'))
  for (const [label, t] of [['subjectTemplate', d.subjectTemplate], ['firstTouchBody', d.firstTouchBody], ['followUp1Body', d.followUp1Body], ['followUp2Body', d.followUp2Body]] as const) {
    if (t) out.push(...checkTemplate(t, label).errors.map((m) => err('DEF_TEMPLATE', m)))
    if (t && /(draft,? not approved|\bTODO\b|\bTBD\b|replace me|lorem ipsum|\[\[|\bSAMPLE TEXT\b)/i.test(t)) out.push(err('DEF_DRAFT_MARKER', `${label} still contains a draft/placeholder marker; replace it with the approved text (flipping the approval flag alone cannot send placeholder copy)`))
  }
  if (d.firstTouchBody && !/\{\{\s*(items_block|confirm_url)\s*\}\}/.test(d.firstTouchBody)) out.push(err('DEF_NO_CONFIRM_LINK', 'firstTouchBody must include {{items_block}} (or {{confirm_url}}) so each business gets its existing /confirm link'))
  if (d.subjectTemplate && /\{\{\s*(items_block|confirm_url)\s*\}\}/.test(d.subjectTemplate)) out.push(err('DEF_SUBJECT', 'subject must not contain the confirmation link'))
  if (d.expiresAt !== undefined && Number.isNaN(Date.parse(d.expiresAt))) out.push(err('DEF_EXPIRES', 'expiresAt must be an ISO date-time'))
  const c = d.cadence ?? {}
  for (const [k, v] of Object.entries(c)) if (v !== undefined && (!Number.isInteger(v) || v < 1 || v > 30)) out.push(err('DEF_CADENCE', `cadence.${k} must be an integer from 1 to 30 business days`))
  const cap = d.dailyCap ?? CAMPAIGN_DEFAULTS.dailyCap
  const prov = d.providerLimit ?? CAMPAIGN_DEFAULTS.providerLimit
  const res = d.reserve ?? CAMPAIGN_DEFAULTS.reserve
  if (!Number.isInteger(cap) || cap < 1) out.push(err('DEF_CAP', 'dailyCap must be a positive integer'))
  if (cap > prov - res) out.push(warn('DEF_CAP_LIMITED', `dailyCap ${cap} exceeds providerLimit ${prov} minus reserve ${res}; the effective cap will be ${Math.max(0, prov - res)}`))
  return out
}

export function cadenceOf(d: CampaignDefinition) {
  const c = d.cadence ?? {}
  return {
    followUp1: c.followUp1AfterBusinessDays ?? CAMPAIGN_DEFAULTS.followUpDays[0],
    followUp2: c.followUp2AfterBusinessDays ?? CAMPAIGN_DEFAULTS.followUpDays[1],
    close: c.closeAfterBusinessDays ?? CAMPAIGN_DEFAULTS.closeAfterBusinessDays,
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else q = false
      } else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      rows.push(row); row = []
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const ALIASES: Record<string, string[]> = {
  business_name: ['business_name', 'business', 'official_business_place_name'],
  contact_email: ['contact_email', 'email', 'primary_email', 'best_researched_email'],
  item_id: ['item_id', 'itemid'],
  contact_name: ['contact_name', 'contact', 'owner_or_founder_name'],
  metro: ['metro'],
  website: ['website', 'official_website', 'original_website_alternate'],
  source_url: ['source_url', 'research_source_url', 'contact_ownership_source'],
  confidence: ['confidence'],
  excluded_reason: ['excluded_reason'],
  exact_checkoff_item: ['exact_checkoff_item', 'exact_checkoff_item_wording', 'current_checkoff_item'],
}

export interface CsvRow {
  rowNumber: number
  business_name: string
  contact_email: string
  item_id: string
  contact_name: string
  metro: string
  website: string
  source_url: string
  confidence: string
  excluded_reason: string
  exact_checkoff_item: string
}

export function readCampaignCsv(text: string): { rows: CsvRow[]; issues: Issue[] } {
  const issues: Issue[] = []
  const table = parseCsv(text)
  if (table.length === 0) return { rows: [], issues: [err('CSV_EMPTY', 'The CSV is empty')] }
  const header = table[0].map(norm)
  const idx: Record<string, number> = {}
  for (const [canon, names] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => names.includes(h))
    if (i >= 0) idx[canon] = i
  }
  for (const req of ['business_name', 'contact_email', 'item_id']) if (idx[req] === undefined) issues.push(err('CSV_COLUMN', `Missing required column "${req}" (accepted headers: ${ALIASES[req].join(', ')})`))
  if (issues.length) return { rows: [], issues }
  const rows: CsvRow[] = []
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]
    if (cells.every((c) => !c.trim())) continue
    const get = (k: string) => (idx[k] !== undefined ? (cells[idx[k]] ?? '').trim() : '')
    rows.push({ rowNumber: r + 1, business_name: get('business_name'), contact_email: get('contact_email'), item_id: get('item_id'), contact_name: get('contact_name'), metro: get('metro'), website: get('website'), source_url: get('source_url'), confidence: get('confidence'), excluded_reason: get('excluded_reason'), exact_checkoff_item: get('exact_checkoff_item') })
  }
  return { rows, issues }
}

// ---------------------------------------------------------------------------
// Lookups (read-only; injected)
// ---------------------------------------------------------------------------

export interface ItemInfo {
  id: string
  text: string
  isActive: boolean
  isSecret: boolean
  metroSlug: string | null
  /** An existing /confirm token for this item (reused, never duplicated). */
  existingToken?: string
}

export interface ContactInfo {
  id: string
  suppressed: boolean
  hasOutbound: boolean
}

export interface IntakeLookups {
  items(ids: string[]): Promise<Map<string, ItemInfo>>
  contactsByEmail(emails: string[]): Promise<Map<string, ContactInfo>>
  /** Emails we have already sent to according to Gmail Sent (read-only). Optional. */
  gmailPriorSent?(emails: string[]): Promise<Set<string>>
  /** Emails already queued in THIS campaign (re-running approve after a partial run). */
  existingCampaignRecipients(campaignKey: string): Promise<Set<string>>
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[A-Za-z]{2,}$/
const NO_REPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)@/i

export interface PlannedItem {
  itemId: string
  text: string
  existingToken?: string
  /** Stable placeholder used only in the PREVIEW; a real token is minted at approve time. */
  previewToken: string
}

export interface PlannedRecipient {
  email: string
  businessName: string
  contactName: string | null
  website: string | null
  items: PlannedItem[]
  subject: string
  body: string
  sourceRows: number[]
}

export interface ExcludedRow {
  rowNumber?: number
  email?: string
  business?: string
  reason: string
}

export interface CampaignPlan {
  definition: CampaignDefinition
  recipients: PlannedRecipient[]
  excluded: ExcludedRow[]
  issues: Issue[]
  counts: { csvRows: number; recipients: number; listings: number; excluded: number; errors: number; warnings: number; newTokensNeeded: number; reusedTokens: number }
  inputHash: string
  templateHash: string
  sendingDays: number
}

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16)

export function templateHashOf(d: CampaignDefinition): string {
  return sha({ s: d.subjectTemplate, f: d.firstTouchBody, a: d.followUp1Body, b: d.followUp2Body, c: cadenceOf(d), faq: !!d.faqEnabled })
}

export interface PlanOptions {
  lookups: IntakeLookups
}

export async function buildCampaignPlan(def: CampaignDefinition, csvText: string, opts: PlanOptions): Promise<CampaignPlan> {
  const issues: Issue[] = [...validateDefinition(def)]
  const { rows, issues: csvIssues } = readCampaignCsv(csvText)
  issues.push(...csvIssues)
  const excluded: ExcludedRow[] = []
  const cap = Math.max(1, Math.min(def.dailyCap ?? CAMPAIGN_DEFAULTS.dailyCap, (def.providerLimit ?? CAMPAIGN_DEFAULTS.providerLimit) - (def.reserve ?? CAMPAIGN_DEFAULTS.reserve)))

  if (csvIssues.some((i) => i.severity === 'ERROR')) return finalize(def, rows, [], excluded, issues, cap)

  // ---- row-level validation ----
  type Good = CsvRow & { email: string }
  const good: Good[] = []
  const seenPair = new Set<string>()
  for (const r of rows) {
    const at = { row: r.rowNumber }
    if (r.excluded_reason) { excluded.push({ rowNumber: r.rowNumber, email: r.contact_email, business: r.business_name, reason: `Sheet marks this row excluded: ${r.excluded_reason}` }); continue }
    if (!r.business_name) { issues.push(err('ROW_NO_BUSINESS', 'business_name is empty', at)); continue }
    if (!r.item_id) { issues.push(err('ROW_NO_ITEM', `"${r.business_name}": item_id is empty`, at)); continue }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.item_id)) { issues.push(err('ROW_BAD_ITEM_ID', `"${r.business_name}": item_id "${r.item_id}" is not a UUID`, at)); continue }
    if (!r.contact_email) { issues.push(err('ROW_NO_EMAIL', `"${r.business_name}": contact_email is empty (a contact form or social-only business cannot be emailed)`, at)); continue }
    const email = r.contact_email.toLowerCase()
    if (/[;,\s]/.test(email)) { issues.push(err('ROW_MULTI_EMAIL', `"${r.business_name}": more than one address in one cell ("${r.contact_email}"); put one per row`, { ...at, email })); continue }
    if (!EMAIL_RE.test(email)) { issues.push(err('ROW_BAD_EMAIL', `"${r.business_name}": "${r.contact_email}" is not a valid email address`, { ...at, email })); continue }
    if (NO_REPLY.test(email)) { issues.push(err('ROW_NOREPLY', `"${r.business_name}": ${email} is a no-reply/system mailbox`, { ...at, email })); continue }
    if (/@getcheckoff\.com$/i.test(email)) { issues.push(err('ROW_INTERNAL', `${email} is a CheckOff address`, { ...at, email })); continue }
    if (r.metro && norm(r.metro) !== norm(def.metroLabel) && norm(r.metro) !== norm(def.metroSlug)) issues.push(warn('ROW_METRO', `"${r.business_name}": metro "${r.metro}" differs from the campaign's "${def.metroLabel}"`, { ...at, email }))
    const pair = `${email}|${r.item_id.toLowerCase()}`
    if (seenPair.has(pair)) { issues.push(warn('ROW_DUPLICATE', `"${r.business_name}": duplicate of an earlier row (same email and item); dropped`, { ...at, email })); continue }
    seenPair.add(pair)
    good.push({ ...r, email, item_id: r.item_id.toLowerCase() })
  }

  // ---- item validation ----
  const items = await opts.lookups.items([...new Set(good.map((g) => g.item_id))])
  const withItem: Array<Good & { info: ItemInfo }> = []
  for (const g of good) {
    const info = items.get(g.item_id)
    const at = { row: g.rowNumber, email: g.email }
    if (!info) { issues.push(err('ITEM_NOT_FOUND', `"${g.business_name}": item ${g.item_id} does not exist`, at)); continue }
    if (!info.isActive) { issues.push(err('ITEM_INACTIVE', `"${g.business_name}": item ${g.item_id} is not active`, at)); continue }
    if (info.isSecret) { excluded.push({ rowNumber: g.rowNumber, email: g.email, business: g.business_name, reason: 'Secret/spoiler item: excluded from confirmation outreach (existing Secret Item Protection rule)' }); continue }
    if (info.metroSlug !== def.metroSlug) { issues.push(err('ITEM_WRONG_METRO', `"${g.business_name}": item ${g.item_id} belongs to metro "${info.metroSlug ?? 'none'}", not "${def.metroSlug}"`, at)); continue }
    if (g.exact_checkoff_item && g.exact_checkoff_item.replace(/\s+/g, ' ') !== info.text.replace(/\s+/g, ' ')) issues.push(warn('ITEM_TEXT_DIFFERS', `"${g.business_name}": the sheet's item wording differs from the live item; the LIVE wording will be used`, at))
    withItem.push({ ...g, info })
  }

  // ---- one owner per item ----
  const owners = new Map<string, Set<string>>()
  for (const g of withItem) owners.set(g.item_id, (owners.get(g.item_id) ?? new Set()).add(g.email))
  const conflicted = new Set<string>()
  for (const [itemId, emails] of owners) if (emails.size > 1) { conflicted.add(itemId); issues.push(err('ITEM_MULTI_OWNER', `Item ${itemId} is assigned to ${emails.size} different contacts (${[...emails].join(', ')}); choose one`)) }

  // ---- consolidate by contact email ----
  const byEmail = new Map<string, Array<Good & { info: ItemInfo }>>()
  for (const g of withItem) if (!conflicted.has(g.item_id)) byEmail.set(g.email, [...(byEmail.get(g.email) ?? []), g])

  // ---- prior outreach / suppression / already queued ----
  const emails = [...byEmail.keys()]
  const known = emails.length ? await opts.lookups.contactsByEmail(emails) : new Map<string, ContactInfo>()
  const gmailPrior = emails.length && opts.lookups.gmailPriorSent ? await opts.lookups.gmailPriorSent(emails) : new Set<string>()
  const already = await opts.lookups.existingCampaignRecipients(def.key)

  const recipients: PlannedRecipient[] = []
  for (const [email, group] of byEmail) {
    const names = [...new Set(group.map((g) => g.business_name))]
    const business = names[0]
    if (names.length > 1) issues.push(warn('GROUP_MULTI_BUSINESS', `${email} is shared by ${names.length} business names (${names.join(' / ')}); they will receive ONE email addressed to "${business}". Review.`, { email }))
    const c = known.get(email)
    if (c?.suppressed) { excluded.push({ email, business, reason: 'Contact is suppressed (do-not-contact)' }); continue }
    if (already.has(email)) { excluded.push({ email, business, reason: 'Already queued in this campaign' }); continue }
    const prior = !!c?.hasOutbound || gmailPrior.has(email)
    if (prior && !def.allowPriorOutreach) { excluded.push({ email, business, reason: `Prior outreach exists (${c?.hasOutbound ? 'recorded interaction' : 'Gmail Sent'}); set allowPriorOutreach to include` }); continue }
    if (prior) issues.push(warn('PRIOR_OUTREACH', `${email} was contacted before; included because allowPriorOutreach is on`, { email }))

    const planned: PlannedItem[] = group.map((g, i) => ({ itemId: g.item_id, text: g.info.text, existingToken: g.info.existingToken, previewToken: `NEW_TOKEN_${i + 1}` }))
    const contactName = group.map((g) => g.contact_name).find(Boolean) ?? null
    const rec: PlannedRecipient = { email, businessName: business, contactName, website: group.map((g) => g.website).find(Boolean) ?? null, items: planned, subject: '', body: '', sourceRows: group.map((g) => g.rowNumber) }
    try {
      const vars = mergeVars(def, rec, (it) => it.existingToken ?? it.previewToken)
      rec.subject = renderTemplate(def.subjectTemplate, vars)
      rec.body = renderTemplate(def.firstTouchBody, vars)
      // Follow-ups must also render for this recipient, or the sequence would stall later.
      renderTemplate(def.followUp1Body, vars)
      renderTemplate(def.followUp2Body, vars)
      const check = validateOutreachCopy(`${rec.subject}\n${rec.body}`)
      for (const m of check.issues) issues.push(err('COPY_INVALID', `${email}: ${m}`, { email }))
    } catch (e) {
      issues.push(err('RENDER', `${email}: ${e instanceof Error ? e.message : String(e)}`, { email }))
      continue
    }
    recipients.push(rec)
  }
  recipients.sort((a, b) => a.email.localeCompare(b.email))
  return finalize(def, rows, recipients, excluded, issues, cap)
}

function finalize(def: CampaignDefinition, rows: CsvRow[], recipients: PlannedRecipient[], excluded: ExcludedRow[], issues: Issue[], cap: number): CampaignPlan {
  const listings = recipients.reduce((n, r) => n + r.items.length, 0)
  const reused = recipients.reduce((n, r) => n + r.items.filter((i) => i.existingToken).length, 0)
  const core = { k: def.key, m: def.metroSlug, from: def.from, cap, cad: cadenceOf(def), faq: !!def.faqEnabled, prior: !!def.allowPriorOutreach, r: recipients.map((r) => [r.email, r.businessName, r.items.map((i) => [i.itemId, i.existingToken ?? null])]) }
  return {
    definition: def,
    recipients,
    excluded,
    issues,
    counts: { csvRows: rows.length, recipients: recipients.length, listings, excluded: excluded.length, errors: issues.filter((i) => i.severity === 'ERROR').length, warnings: issues.filter((i) => i.severity === 'WARN').length, newTokensNeeded: listings - reused, reusedTokens: reused },
    inputHash: sha(core),
    templateHash: templateHashOf(def),
    sendingDays: Math.ceil(recipients.length / cap),
  }
}

export function mergeVars(def: CampaignDefinition, r: PlannedRecipient, tokenOf: (i: PlannedItem) => string): Record<string, string> {
  const listings: ListingForEmail[] = r.items.map((i) => ({ text: i.text, confirmUrl: confirmUrlFor(tokenOf(i)) }))
  const vars: Record<string, string> = {
    business_name: r.businessName,
    metro: def.metroLabel,
    items_block: buildItemsBlock(listings),
    item_text: r.items[0].text,
    item_count: String(r.items.length),
    kit_url: CANONICAL_KIT_URL,
    confirm_url: listings[0].confirmUrl,
    sender_name: 'Jerry Stuckart',
  }
  if (r.contactName) vars.contact_name = r.contactName
  return vars
}

// ---------------------------------------------------------------------------
// Preview rendering
// ---------------------------------------------------------------------------

export function renderPreviewMarkdown(plan: CampaignPlan, now: Date = new Date()): string {
  const d = plan.definition
  const cad = cadenceOf(d)
  const cap = Math.min(d.dailyCap ?? CAMPAIGN_DEFAULTS.dailyCap, (d.providerLimit ?? CAMPAIGN_DEFAULTS.providerLimit) - (d.reserve ?? CAMPAIGN_DEFAULTS.reserve))
  const fu1 = addBusinessDays(now, cad.followUp1)
  const fu2 = addBusinessDays(fu1, cad.followUp2)
  const close = addBusinessDays(fu2, cad.close)
  const L: string[] = []
  L.push(`# Campaign preview: ${d.name} (${d.key})`, '', `Generated ${now.toISOString()}. **Nothing has been sent and nothing has been written to the database.**`, '')
  L.push('## Summary', '', `- CSV rows read: ${plan.counts.csvRows}`, `- **Recipients (after consolidation): ${plan.counts.recipients}**`, `- Listings across those recipients: ${plan.counts.listings}`, `- Excluded rows/contacts: ${plan.counts.excluded}`, `- Errors: ${plan.counts.errors} · Warnings: ${plan.counts.warnings}`)
  L.push(`- Confirmation tokens: ${plan.counts.reusedTokens} existing reused, ${plan.counts.newTokensNeeded} new (minted only at approval; SQL is emitted for you to apply)`)
  L.push(`- Sender: ${d.from ?? 'jerry@getcheckoff.com'} · daily cap ${cap}/day → about ${plan.sendingDays} sending day(s) for first touches`)
  L.push(`- Cadence per recipient (illustrative if the first email went out ${now.toISOString().slice(0, 10)}): Follow-Up 1 ~${fu1.toISOString().slice(0, 10)} (${cad.followUp1} business days), Follow-Up 2 ~${fu2.toISOString().slice(0, 10)} (+${cad.followUp2}), close ~${close.toISOString().slice(0, 10)} (+${cad.close}). Max 3 emails per recipient. No follow-up goes to anyone who confirmed, declined, opted out, or replied.`)
  L.push(`- Templates approved by you: first touch **${d.approvals?.firstTouchTemplate ? 'YES' : 'NO'}**, follow-ups **${d.approvals?.followUpTemplates ? 'YES' : 'NO'}**`)
  L.push(`- **Preview hash (required by \`approve\`): \`${plan.inputHash}\`** · template hash \`${plan.templateHash}\``, '')
  const errors = plan.issues.filter((i) => i.severity === 'ERROR')
  if (errors.length) L.push('## Errors (must be fixed before approval)', '', ...errors.map((i) => `- ${i.row ? `row ${i.row}: ` : ''}${i.message}`), '')
  const warns = plan.issues.filter((i) => i.severity === 'WARN')
  if (warns.length) L.push('## Warnings (review)', '', ...warns.map((i) => `- ${i.row ? `row ${i.row}: ` : ''}${i.message}`), '')
  if (plan.excluded.length) L.push('## Excluded', '', ...plan.excluded.map((e) => `- ${e.business ?? ''} ${e.email ? `<${e.email}>` : ''} ${e.rowNumber ? `(row ${e.rowNumber})` : ''}: ${e.reason}`), '')
  L.push('## Follow-up templates (rendered for the first recipient)', '')
  const first = plan.recipients[0]
  if (first) {
    const vars = mergeVars(d, first, (i) => i.existingToken ?? i.previewToken)
    L.push('### Follow-Up 1', '', '```', safeRender(d.followUp1Body, vars), '```', '', '### Follow-Up 2', '', '```', safeRender(d.followUp2Body, vars), '```', '')
  }
  L.push('## Every first-touch message', '')
  for (const r of plan.recipients) {
    L.push(`### ${r.businessName} <${r.email}>`, `Listings: ${r.items.length} · source rows: ${r.sourceRows.join(', ')}`, '', `**Subject:** ${r.subject}`, '', '```', r.body, '```', '')
  }
  return L.join('\n')
}

function safeRender(t: string, vars: Record<string, string>): string {
  try { return renderTemplate(t, vars) } catch (e) { return `(could not render: ${e instanceof Error ? e.message : String(e)})` }
}

export function renderPreviewCsv(plan: CampaignPlan): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  const lines = ['email,business_name,listings,subject,source_rows']
  for (const r of plan.recipients) lines.push([r.email, r.businessName, String(r.items.length), r.subject, r.sourceRows.join(' ')].map(q).join(','))
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Approval (the ONLY step that writes campaign records)
// ---------------------------------------------------------------------------

export interface ApproveArgs {
  confirmRecipients: number
  previewHash: string
  templatesApproved: boolean
  now: Date
}

export class ApprovalRefused extends Error {}

export function assertApprovable(plan: CampaignPlan, a: ApproveArgs): void {
  const why: string[] = []
  if (plan.counts.errors > 0) why.push(`${plan.counts.errors} validation error(s) remain`)
  if (plan.recipients.length === 0) why.push('there are no recipients')
  if (!plan.definition.approvals?.firstTouchTemplate) why.push('definition.approvals.firstTouchTemplate is not true')
  if (!plan.definition.approvals?.followUpTemplates) why.push('definition.approvals.followUpTemplates is not true (follow-up templates must be approved before activation)')
  if (plan.definition.expiresAt && Date.parse(plan.definition.expiresAt) <= a.now.getTime()) why.push(`expiresAt ${plan.definition.expiresAt} is not in the future`)
  if (!a.templatesApproved) why.push('--templates-approved was not passed')
  if (a.confirmRecipients !== plan.recipients.length) why.push(`--confirm-recipients ${a.confirmRecipients} does not match the ${plan.recipients.length} recipients in the plan`)
  if (a.previewHash !== plan.inputHash) why.push(`--preview-hash ${a.previewHash} does not match the current plan (${plan.inputHash}); re-run preview and review it`)
  if (why.length) throw new ApprovalRefused(`Refusing to approve: ${why.join('; ')}.`)
}

/** Appending to a running campaign is only allowed when it cannot change anything already promised to earlier recipients. */
export function assertAppendable(existing: CampaignRuntime, plan: CampaignPlan, a: ApproveArgs): void {
  const why: string[] = []
  if (existing.state === 'COMPLETE') why.push('the campaign is COMPLETE')
  if (existing.expiresAt && Date.parse(existing.expiresAt) <= a.now.getTime()) why.push(`the campaign expired at ${existing.expiresAt}`)
  if (!existing.approval || existing.approval.approvedBy !== 'jerry') why.push('the existing campaign has no recorded approval')
  else if (existing.approval.templateHash !== plan.templateHash) why.push(`the templates/cadence differ from the approved campaign (stored ${existing.approval.templateHash}, this plan ${plan.templateHash}); a changed template needs a new campaign key`)
  if ((plan.definition.from ?? 'jerry@getcheckoff.com').toLowerCase() !== existing.from.toLowerCase()) why.push('the sender differs from the approved campaign')
  if (why.length) throw new ApprovalRefused(`Refusing to append to campaign "${existing.key}": ${why.join('; ')}.`)
}

/** No item may belong to two recipients of one campaign, and no token may be reused for a different listing. */
export function assertNoDuplicateAssignments(minted: MintedRecipient[], assigned: Array<{ email: string; itemId: string; token: string }>): void {
  const why: string[] = []
  const ownerOf = new Map(assigned.map((x) => [x.itemId, x.email.toLowerCase()]))
  const tokenOwner = new Map(assigned.map((x) => [x.token, x.itemId]))
  const batchItem = new Map<string, string>()
  const batchToken = new Map<string, string>()
  for (const r of minted) {
    for (const i of r.items) {
      const owner = ownerOf.get(i.itemId)
      if (owner && owner !== r.email.toLowerCase()) why.push(`item ${i.itemId} already belongs to ${owner} in this campaign`)
      const inBatch = batchItem.get(i.itemId)
      if (inBatch && inBatch !== r.email) why.push(`item ${i.itemId} appears for both ${inBatch} and ${r.email}`)
      batchItem.set(i.itemId, r.email)
      const heldFor = tokenOwner.get(i.token)
      if (heldFor && heldFor !== i.itemId) why.push(`token ${i.token.slice(0, 6)}… is already assigned to a different item`)
      const usedFor = batchToken.get(i.token)
      if (usedFor && usedFor !== i.itemId) why.push(`token ${i.token.slice(0, 6)}… was minted twice in this batch`)
      batchToken.set(i.token, i.itemId)
    }
  }
  if (why.length) throw new ApprovalRefused(`Refusing to approve: ${[...new Set(why)].join('; ')}.`)
}

export function mintToken(): string {
  return randomBytes(24).toString('base64url') // 32 URL-safe characters, same shape as the existing seed tokens
}

export interface MintedItem extends PlannedItem {
  token: string
  isNew: boolean
}
export interface MintedRecipient extends Omit<PlannedRecipient, 'items'> {
  items: MintedItem[]
}

export function mintTokens(plan: CampaignPlan, mint: () => string = mintToken): MintedRecipient[] {
  return plan.recipients.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i, token: i.existingToken ?? mint(), isNew: !i.existingToken })) }))
}

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`

/** SQL for Jerry to review and apply, matching the existing 20260902_business_confirmation_tokens_seed.sql pattern. Only NEW tokens. */
export function buildTokenSql(def: CampaignDefinition, minted: MintedRecipient[], nameOf: (r: MintedRecipient) => string = (r) => r.businessName): string {
  const rows = minted.flatMap((r) => r.items.filter((i) => i.isNew).map((i) => `  (${sqlStr(i.token)}, ${sqlStr(i.itemId)}, ${sqlStr(nameOf(r))}, ${sqlStr(i.text)}, ${sqlStr(`bizdev_${def.key}`)})`))
  if (rows.length === 0) return `-- Campaign ${def.key}: every listing already has a confirmation token. Nothing to apply.\n`
  return [
    `-- Confirmation tokens for campaign ${def.key} (${rows.length} new). Generated by outreachCampaignCli.ts approve.`,
    '-- NOT applied automatically. Review, then apply once:',
    '--   supabase db query -f <this file> --linked',
    '-- Sending stays blocked until these tokens exist (activate verifies them).',
    'BEGIN;',
    'INSERT INTO business_outreach_tokens (token, item_id, business_name, exact_checkoff_item, campaign) VALUES',
    rows.join(',\n') + ';',
    'COMMIT;',
    '',
  ].join('\n')
}

/** Everything that writes. DB-backed in production, a fake in tests. */
export interface CampaignWriter {
  ensureProject(projectKey: string, name: string, summary: string): Promise<void>
  upsertContact(r: { email: string; businessName: string; contactName: string | null; website: string | null; source: string }): Promise<string>
  createCampaignTask(runtime: Omit<CampaignRuntime, 'taskId'>, projectKey: string): Promise<string>
  /** The stored campaign, or null when none exists. A non-null result switches approve into append mode. */
  getCampaign(key: string): Promise<CampaignRuntime | null>
  /** Item/token assignments of the recipients that already belong to an EXISTING campaign (empty when the campaign does not exist). */
  campaignAssignments(key: string): Promise<Array<{ email: string; itemId: string; token: string }>>
  /** Atomically appends one entry to the campaign's batch ledger. Touches nothing else on the campaign record. */
  recordBatch(key: string, batch: CampaignBatch): Promise<void>
  createRecipientTask(input: { projectKey: string; title: string; contactId: string; sourceRef: string; state: Record<string, unknown> }): Promise<boolean>
}

export interface ApprovalResult {
  campaignKey: string
  recipientsQueued: number
  recipientsAlreadyPresent: number
  tokenSql: string
  newTokens: number
  /** True when the recipients were added to an already-approved campaign (its state, schedule and history were not touched). */
  appended: boolean
}

/**
 * Crash-safe ordering: (1) mint tokens and hand the token SQL to `beforeWrite` (the CLI writes the file) BEFORE any database write;
 * (2) create/refresh the recipient tasks (never-sent QUEUED recipients are refreshed with this run's tokens);
 * (3) create the campaign record LAST. Until the campaign record exists nothing can send, and a re-run simply starts over.
 */
export async function approveCampaign(plan: CampaignPlan, args: ApproveArgs, writer: CampaignWriter, mint: () => string = mintToken, beforeWrite?: (tokenSql: string) => void | Promise<void>): Promise<ApprovalResult> {
  assertApprovable(plan, args)
  const d = plan.definition
  const cad = cadenceOf(d)
  const minted = mintTokens(plan, mint)
  const projectKey = `bizdev-campaign-${d.key}`
  const existing = await writer.getCampaign(d.key)
  if (existing) assertAppendable(existing, plan, args)
  assertNoDuplicateAssignments(minted, await writer.campaignAssignments(d.key))
  const tokenSql = buildTokenSql(d, minted)
  await beforeWrite?.(tokenSql)
  await writer.ensureProject(projectKey, `Outreach campaign: ${d.name}`, `Multi-recipient business outreach (${d.metroLabel}). Campaign definition lives on the bizdev_campaign task; recipients are bizdev_outreach tasks.`)

  const runtime: Omit<CampaignRuntime, 'taskId'> = {
    key: d.key,
    name: d.name,
    state: 'APPROVED',
    metroLabel: d.metroLabel,
    from: d.from ?? 'jerry@getcheckoff.com',
    subjectTemplate: d.subjectTemplate,
    firstTouchBody: d.firstTouchBody,
    followUps: [
      { step: 2, afterBusinessDays: cad.followUp1, bodyText: d.followUp1Body },
      { step: 3, afterBusinessDays: cad.followUp2, bodyText: d.followUp2Body },
    ],
    closeAfterBusinessDays: cad.close,
    maxOutbound: CAMPAIGN_DEFAULTS.maxOutbound,
    faqEnabled: !!d.faqEnabled,
    dailyCap: d.dailyCap ?? CAMPAIGN_DEFAULTS.dailyCap,
    providerLimit: d.providerLimit ?? CAMPAIGN_DEFAULTS.providerLimit,
    reserve: d.reserve ?? CAMPAIGN_DEFAULTS.reserve,
    batchPerTick: d.batchPerTick ?? CAMPAIGN_DEFAULTS.batchPerTick,
    sendDelayMs: CAMPAIGN_DEFAULTS.sendDelayMs,
    ...(d.expiresAt ? { expiresAt: new Date(d.expiresAt).toISOString() } : {}),
    approval: { approvedBy: 'jerry', approvedAt: args.now.toISOString(), recipientCount: plan.recipients.length, inputHash: plan.inputHash, templateHash: plan.templateHash },
    consecutiveSendFailures: 0,
    firstTouchSent: 0,
    bounceCount: 0,
    scan: { afterDay: args.now.toISOString().slice(0, 10).replace(/-/g, '/'), processedMessageIds: [] },
  }
  const batch: CampaignBatch = { approvedAt: args.now.toISOString(), inputHash: plan.inputHash, recipientCount: plan.recipients.length, recipients: minted.map((r) => r.email) }
  let queued = 0
  let present = 0
  for (const r of minted) {
    const contactId = await writer.upsertContact({ email: r.email, businessName: r.businessName, contactName: r.contactName, website: r.website, source: `campaign:${d.key}` })
    const tokenOf = new Map(r.items.map((i) => [i.itemId, i.token]))
    const plannedForMerge: PlannedRecipient = { ...r, items: r.items }
    const vars = mergeVars(d, plannedForMerge, (i) => tokenOf.get(i.itemId)!)
    const subject = renderTemplate(d.subjectTemplate, vars)
    const created = await writer.createRecipientTask({
      projectKey,
      title: `${d.name}: ${r.businessName}`,
      contactId,
      sourceRef: `${d.key}:${r.email}`,
      state: {
        sequenceKey: `campaign:${d.key}`,
        campaignKey: d.key,
        contactEmail: r.email,
        threadId: '',
        sequenceStatus: 'QUEUED',
        stepsSent: [],
        subject,
        vars,
        listings: r.items.map((i) => ({ itemId: i.itemId, text: i.text, token: i.token, confirmUrl: confirmUrlFor(i.token) })),
      },
    })
    if (created) queued++
    else present++
  }
  // New campaign: the campaign record is created LAST, the commitment point that lets the monitor act on the recipients.
  // Existing campaign (append): only the batch ledger entry is added; state, schedule, counters and history are never rewritten.
  // Either way a queued recipient cannot be sent until the monitor verifies its token row exists and points at the approved item.
  if (existing) { if (!existing.batches?.some((b) => b.inputHash === batch.inputHash)) await writer.recordBatch(d.key, batch) }
  else await writer.createCampaignTask({ ...runtime, batches: [batch] }, projectKey)
  return { campaignKey: d.key, recipientsQueued: queued, recipientsAlreadyPresent: present, tokenSql, newTokens: minted.reduce((n, r) => n + r.items.filter((i) => i.isNew).length, 0), appended: !!existing }
}

// ---------------------------------------------------------------------------
// Activation / pause / resume (pure decisions; the CLI performs the IO)
// ---------------------------------------------------------------------------

export interface ActivationFacts {
  campaign: Pick<CampaignRuntime, 'key' | 'state' | 'approval'>
  tokensNeeded: string[]
  tokensPresent: Set<string>
  senderVerified: boolean
  kitUrlLive: boolean
}

export function activationBlockers(f: ActivationFacts): string[] {
  const out: string[] = []
  if (!f.campaign.approval || f.campaign.approval.approvedBy !== 'jerry') out.push('The campaign has no recorded approval.')
  if (f.campaign.state === 'COMPLETE') out.push('The campaign is already complete.')
  const missing = f.tokensNeeded.filter((t) => !f.tokensPresent.has(t))
  if (missing.length) out.push(`${missing.length} confirmation token(s) are not in business_outreach_tokens yet. Apply the token SQL first.`)
  if (!f.senderVerified) out.push('jerry@getcheckoff.com is not a verified Gmail send-as identity.')
  if (!f.kitUrlLive) out.push(`${CANONICAL_KIT_URL} did not respond successfully (Business Activation Kit gate).`)
  return out
}

export { extractPlaceholders }

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface ReportRecipient {
  status: string
  state: {
    sequenceStatus: string
    stepsSent: Array<{ kind: string; sentAt: string }>
    lastReplyClass?: string
  }
  nextCheckAt: string | null
  nextAction: string | null
}

export interface CampaignReport {
  campaignKey: string
  state: string
  pauseReason?: string
  recipients: number
  queued: number
  firstTouchesSent: number
  followUpsSent: number
  awaitingReply: number
  pendingFollowUps: number
  nextFollowUpDue: string | null
  confirmations: number
  corrections: number
  photos: number
  questions: number
  partnershipInterest: number
  declines: number
  optOuts: number
  bounces: number
  deferred: number
  needsJerry: number
  uncertainSends: number
  closedNoResponse: number
  expired: number
  expiresAt?: string
  needsJerryItems: string[]
  repliesByClass: Record<string, number>
}

export function summarizeCampaign(runtime: Pick<CampaignRuntime, 'key' | 'state' | 'pauseReason' | 'bounceCount' | 'expiresAt'> | null, key: string, recipients: ReportRecipient[], replyClassCounts: Record<string, number>): CampaignReport {
  const c = (pred: (r: ReportRecipient) => boolean) => recipients.filter(pred).length
  const sent = (r: ReportRecipient) => r.state.stepsSent.some((s) => s.kind === 'INITIAL')
  const pending = recipients.filter((r) => r.status === 'WAITING' && r.state.sequenceStatus === 'ACTIVE' && r.state.stepsSent.filter((s) => s.kind !== 'FAQ_ANSWER').length < 3)
  const dues = pending.map((r) => r.nextCheckAt).filter((x): x is string => !!x).sort()
  const rc = (k: string) => replyClassCounts[k] ?? 0
  return {
    campaignKey: key,
    state: runtime?.state ?? 'UNKNOWN',
    pauseReason: runtime?.pauseReason,
    recipients: recipients.length,
    queued: c((r) => r.state.sequenceStatus === 'QUEUED'),
    firstTouchesSent: c(sent),
    followUpsSent: recipients.reduce((n, r) => n + r.state.stepsSent.filter((s) => s.kind === 'FOLLOW_UP').length, 0),
    awaitingReply: c((r) => r.status === 'WAITING'),
    pendingFollowUps: pending.length,
    nextFollowUpDue: dues[0] ?? null,
    confirmations: c((r) => r.state.sequenceStatus === 'CONFIRMED'),
    corrections: rc('correction_requested'),
    photos: rc('photo_provided'),
    questions: rc('question'),
    partnershipInterest: rc('partnership_interest'),
    declines: c((r) => r.state.sequenceStatus === 'DECLINED'),
    optOuts: c((r) => r.state.sequenceStatus === 'OPTED_OUT'),
    bounces: Math.max(c((r) => r.state.sequenceStatus === 'BOUNCED'), runtime?.bounceCount ?? 0),
    deferred: c((r) => r.state.sequenceStatus === 'DEFERRED'),
    needsJerry: c((r) => r.status === 'NEEDS_JERRY'),
    uncertainSends: c((r) => r.state.sequenceStatus === 'SEND_UNCERTAIN'),
    closedNoResponse: c((r) => r.state.sequenceStatus === 'COMPLETE_NO_RESPONSE'),
    expired: c((r) => r.state.sequenceStatus === 'EXPIRED'),
    expiresAt: runtime?.expiresAt,
    needsJerryItems: recipients.filter((r) => r.status === 'NEEDS_JERRY').map((r) => r.nextAction ?? '(no detail)').slice(0, 20),
    repliesByClass: replyClassCounts,
  }
}

export function renderReport(r: CampaignReport): string {
  const L = [
    `Campaign ${r.campaignKey}: ${r.state}${r.pauseReason ? ` (${r.pauseReason})` : ''}`,
    `  Recipients ............ ${r.recipients}  (queued ${r.queued})`,
    `  First touches sent .... ${r.firstTouchesSent}`,
    `  Follow-ups sent ....... ${r.followUpsSent}`,
    `  Awaiting reply ........ ${r.awaitingReply}  (pending follow-ups ${r.pendingFollowUps}${r.nextFollowUpDue ? `, next due ${r.nextFollowUpDue.slice(0, 10)}` : ''})`,
    `  Listing confirmed ..... ${r.confirmations}`,
    `  Corrections ........... ${r.corrections}`,
    `  Photos ................ ${r.photos}`,
    `  Questions ............. ${r.questions}`,
    `  Partnership interest .. ${r.partnershipInterest}`,
    `  Declines .............. ${r.declines}`,
    `  Opt-outs .............. ${r.optOuts}`,
    `  Bounces ............... ${r.bounces}`,
    `  Deferred .............. ${r.deferred}`,
    `  Uncertain sends ....... ${r.uncertainSends}`,
    `  Closed, no response ... ${r.closedNoResponse}`,
    `  Closed by expiry ...... ${r.expired}${r.expiresAt ? `  (hard stop ${r.expiresAt})` : ''}`,
    `  NEEDS_JERRY ........... ${r.needsJerry}`,
  ]
  if (r.needsJerryItems.length) L.push(...r.needsJerryItems.map((x) => `    - ${x}`))
  return L.join('\n')
}
