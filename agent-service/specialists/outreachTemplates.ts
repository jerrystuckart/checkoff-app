// Pure merge-field rendering shared by the campaign intake (outreachCampaign.ts)
// and the follow-up engine (bizDevOutreach.ts). One renderer, no I/O.
//
// Fields are written {{field_name}}. Rendering is STRICT: a field with no
// value is an error, never silently blanked — a half-rendered email to a real
// business is worse than a refused send.

import { validateActivationKitReference, UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL } from '../playbooks/businessActivationKit'

export const TEMPLATE_FIELDS = ['business_name', 'contact_name', 'metro', 'items_block', 'item_text', 'item_count', 'kit_url', 'confirm_url', 'sender_name', 'experiences_block', 'download_url'] as const
export type TemplateField = (typeof TEMPLATE_FIELDS)[number]
export type TemplateVars = Partial<Record<TemplateField, string>>

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

export function extractPlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))]
}

export interface TemplateCheck {
  ok: boolean
  errors: string[]
}

/** Unknown fields (typos) are an error up front, before any recipient is rendered. */
export function checkTemplate(template: string, label: string): TemplateCheck {
  const errors: string[] = []
  if (!template.trim()) errors.push(`${label}: template is empty`)
  for (const f of extractPlaceholders(template)) {
    if (!(TEMPLATE_FIELDS as readonly string[]).includes(f)) errors.push(`${label}: unknown merge field {{${f}}} (known: ${TEMPLATE_FIELDS.join(', ')})`)
  }
  return { ok: errors.length === 0, errors }
}

export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(PLACEHOLDER, (_m, name: string) => {
    const v = vars[name]
    if (v === undefined || v === null || v === '') throw new Error(`renderTemplate: no value for {{${name}}}`)
    return v
  })
}

export interface ListingForEmail {
  text: string
  confirmUrl: string
  /** The safe public page for this exact experience (https://getcheckoff.com/item/<itemId>). Never contains a token. */
  publicUrl?: string
}

/** One bullet per listing; consolidated businesses get every listing in ONE email. */
export function buildItemsBlock(items: readonly ListingForEmail[]): string {
  return items.map((i) => `• ${i.text}\n  Confirm or update it here: ${i.confirmUrl}`).join('\n\n')
}

/** One experience per bullet with BOTH links: the public page anyone can open (no token) and the business's private confirmation link. */
export function buildExperiencesBlock(items: readonly ListingForEmail[]): string {
  return items
    .map((i) => `• ${i.text}\n  See it in CheckOff (public page): ${i.publicUrl}\n  Confirm or update it (your private link): ${i.confirmUrl}`)
    .join('\n\n')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DOWNLOAD_URL = 'https://getcheckoff.com/download'

/** The canonical safe public link for an experience; throws on a malformed id so a bad link can never be rendered. */
export function publicItemUrlFor(itemId: string): string {
  if (!UUID.test(itemId)) throw new Error(`cannot build a public item URL from "${itemId}"`)
  return `https://getcheckoff.com/item/${itemId.toLowerCase()}`
}

export function confirmUrlFor(token: string): string {
  return `https://getcheckoff.com/confirm/${token}`
}

const CONFIRM_URL = /https:\/\/getcheckoff\.com\/confirm\/[A-Za-z0-9_-]+/g

/**
 * Reuses businessActivationKit.ts's validator unchanged. Its second rule flags
 * a /confirm/<token> link sitting next to kit/signage language, which is
 * correct for signage but NOT for a business-facing outreach email that
 * deliberately carries both — so confirm URLs are masked before validation
 * and the metro-specific-kit rule still applies in full.
 */
export function validateOutreachCopy(text: string): { pass: boolean; issues: string[] } {
  const masked = text.replace(CONFIRM_URL, '[CONFIRM_LINK]')
  const base = validateActivationKitReference(masked)
  const issues = [...base.issues]
  if (/\{\{|\}\}/.test(text)) issues.push('Unrendered merge field remains in the text.')
  return { pass: issues.length === 0, issues }
}

export const CANONICAL_KIT_URL = UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL

/** The literal text a subject starts with (e.g. "We selected") — what a batched Gmail search keys on. Falls back to the longest literal run. */
export function staticSubjectStem(subjectTemplate: string): string {
  const parts = subjectTemplate.split(PLACEHOLDER).filter((_, i) => i % 2 === 0).map((p) => p.trim()).filter(Boolean)
  return parts.find((p) => p.length >= 6) ?? parts.sort((a, b) => b.length - a.length)[0] ?? ''
}
