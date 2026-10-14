// Prior-contact suppression. A business that CheckOff has already contacted must never receive another first
// touch, whichever way it is identified. Four independent keys are compared, so a change in one (a +tag on the
// address, "The Foo LLC" vs "Foo", a re-sent message) cannot hide a prior contact:
//
//   email       normalized (case, +tags, Gmail dots/googlemail)
//   message_id  the Gmail message id of a recorded send
//   business    normalized business name (case, accents, punctuation, "the", legal suffixes)
//   item        the CheckOff item id
//
// Pure: no I/O. Winston's records and Gmail Sent history are loaded by the caller (outreachCampaignDb.ts / the engine).

export type PriorContactKey = 'email' | 'message_id' | 'business' | 'item'

export interface ContactedRecord {
  /** Where this knowledge came from: a Winston recipient record, or Gmail Sent. */
  via: 'winston' | 'gmail'
  /** Stable reference for reports (task id, "gmail:<id>"). Also used to ignore a record when re-checking the same recipient. */
  ref: string
  email?: string
  businessName?: string
  itemIds?: readonly string[]
  messageIds?: readonly string[]
}

export interface PriorContactConflict {
  key: PriorContactKey
  value: string
  via: 'winston' | 'gmail'
  ref: string
}

export interface PriorContactCandidate {
  email: string
  businessName?: string
  itemIds?: readonly string[]
  messageIds?: readonly string[]
}

/** Lowercase, drop +tags, and for Gmail drop dots and fold googlemail.com into gmail.com. */
export function normalizeEmail(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/^mailto:/, '')
  const at = s.lastIndexOf('@')
  if (at < 1) return s
  let local = s.slice(0, at)
  let domain = s.slice(at + 1)
  const plus = local.indexOf('+')
  if (plus > 0) local = local.slice(0, plus)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return `${local}@${domain}`
}

const LEGAL_SUFFIX = new Set(['llc', 'inc', 'incorporated', 'co', 'corp', 'corporation', 'company', 'ltd', 'llp', 'lp'])

/** "The Fox & Hound, LLC" and "Fox and Hound" compare equal. Empty input returns '' (never matches). */
export function normalizeBusiness(raw: string): string {
  const folded = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[‘’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const words = folded.split(' ').filter(Boolean)
  while (words[0] === 'the') words.shift()
  while (words.length > 1 && LEGAL_SUFFIX.has(words[words.length - 1])) words.pop()
  return words.join(' ')
}

export class PriorContactIndex {
  private byEmail = new Map<string, ContactedRecord[]>()
  private byMessage = new Map<string, ContactedRecord[]>()
  private byBusiness = new Map<string, ContactedRecord[]>()
  private byItem = new Map<string, ContactedRecord[]>()

  constructor(records: readonly ContactedRecord[] = []) {
    for (const r of records) this.add(r)
  }

  add(r: ContactedRecord): void {
    const push = (m: Map<string, ContactedRecord[]>, k: string) => {
      if (!k) return
      const list = m.get(k) ?? []
      list.push(r)
      m.set(k, list)
    }
    if (r.email) push(this.byEmail, normalizeEmail(r.email))
    if (r.businessName) push(this.byBusiness, normalizeBusiness(r.businessName))
    for (const id of r.messageIds ?? []) push(this.byMessage, id)
    for (const id of r.itemIds ?? []) push(this.byItem, id.toLowerCase())
  }

  /** Every way the candidate matches something already contacted. `ignoreRef` skips the candidate's own record. */
  check(c: PriorContactCandidate, opts: { ignoreRef?: string } = {}): PriorContactConflict[] {
    const out: PriorContactConflict[] = []
    const seen = new Set<string>()
    const hit = (key: PriorContactKey, value: string, recs: readonly ContactedRecord[] | undefined) => {
      for (const r of recs ?? []) {
        if (opts.ignoreRef && r.ref === opts.ignoreRef) continue
        const sig = `${key}|${r.ref}`
        if (seen.has(sig)) continue
        seen.add(sig)
        out.push({ key, value, via: r.via, ref: r.ref })
      }
    }
    hit('email', normalizeEmail(c.email), this.byEmail.get(normalizeEmail(c.email)))
    for (const id of c.messageIds ?? []) hit('message_id', id, this.byMessage.get(id))
    const b = c.businessName ? normalizeBusiness(c.businessName) : ''
    if (b) hit('business', b, this.byBusiness.get(b))
    for (const id of c.itemIds ?? []) hit('item', id, this.byItem.get(id.toLowerCase()))
    return out
  }
}

export function describeConflicts(conflicts: readonly PriorContactConflict[]): string {
  return conflicts.map((x) => `${x.key} "${x.value}" already contacted (${x.via} ${x.ref})`).join('; ')
}
