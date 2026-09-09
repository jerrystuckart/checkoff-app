// agent-service/playbooks/businessActivationKit.ts
//
// Chief Phase 2Z — permanent replacement for "CREATE FEATURED KIT" /
// "METRO-SPECIFIC FEATURED KIT READY" anywhere in Winston's process.
// Jerry, 2026-09-08: city-specific Featured Kits (Phoenix/Milwaukee/
// Tucson/Denver zip files, one per metro) are permanently retired. There
// is now exactly ONE canonical, universal Business Activation Kit,
// improved centrally and reused by every metro/destination forever.
//
// Winston NEVER triggers Claude/ChatGPT/Canva/image generation to build
// a normal city-specific kit again. For every future metro, Winston only
// VERIFIES:
//   1. the canonical URL is live
//   2. the universal files are accessible there
//   3. business outreach references that canonical URL (never a
//      metro-specific one)
//   4. business-specific /confirm/<token> links exist separately where
//      applicable (a DIFFERENT system — business operations, never
//      customer-facing signage)
//
// This module is pure — no network/DB calls. checkActivationKitLive()
// in the metro-launch driver (or an outreach-sending caller) is
// responsible for the actual HTTP check against the canonical URL;
// everything here is the deterministic verification/validation logic.

import type { StagingGateResult } from './metroCatalog'

/** The one, permanent, universal Business Activation Kit URL — never a per-metro variant. */
export const UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL = 'https://getcheckoff.com/downloads/featured-kit'

/** The customer-facing app-acquisition URL embedded in the kit's own QR artwork — distinct from the kit page itself. */
export const CUSTOMER_ACQUISITION_URL = 'https://getcheckoff.com/download'

/**
 * A metro-specific kit reference looks like
 * "featured-kit-<city>", "checkoff-featured-kit-<city>.zip", or any
 * `/downloads/...` path that isn't the exact canonical one. Matched
 * broadly (case-insensitive) so a new metro slug doesn't need this list
 * updated — the pattern is "kit" + a per-metro qualifier, not an
 * enumerated city list.
 */
const METRO_SPECIFIC_KIT_PATTERN = /\b(?:checkoff[-_]?)?featured[-_]?kit[-_](?!verified\b)[a-z0-9-]+/i

/** `/confirm/<token>`-shaped business-operations links — must never appear in customer-facing signage/outreach copy. */
const BUSINESS_CONFIRM_LINK_PATTERN = /getcheckoff\.com\/confirm\/[A-Za-z0-9_-]+/i

export interface ActivationKitTextCheck {
  pass: boolean
  issues: string[]
}

/**
 * Validates any outreach template, email body, or generated methodology
 * text: no metro-specific kit reference, no /confirm/<token> link used
 * as if it were customer-facing kit/signage material. Does not require
 * the canonical URL to be PRESENT (not every message references the
 * kit) — only that IF a kit is referenced, it's the universal one.
 */
export function validateActivationKitReference(text: string): ActivationKitTextCheck {
  const issues: string[] = []
  const metroSpecificMatch = text.match(METRO_SPECIFIC_KIT_PATTERN)
  if (metroSpecificMatch) {
    issues.push(`References a metro-specific kit ("${metroSpecificMatch[0]}") — city-specific Featured Kits are permanently retired. Use ${UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL} for every metro.`)
  }
  if (BUSINESS_CONFIRM_LINK_PATTERN.test(text) && /kit|signage|table stand|social|badge|print/i.test(text)) {
    issues.push('A business-operations /confirm/<token> link appears alongside kit/signage language — that link is for business-specific confirmation/photo submission, never customer-facing kit material.')
  }
  return { pass: issues.length === 0, issues }
}

export interface ActivationKitVerification {
  /** Was an HTTP check against UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL performed, and did it succeed? Supplied by the caller — this module has no network access of its own. */
  kitUrlLive: boolean
  /** Every universal asset file expected to be reachable under the kit page actually returned successfully. */
  assetsAccessible: boolean
  /** The outreach template/copy this metro will actually send, for reference validation. */
  outreachCopy: string
}

export const ACTIVATION_KIT_GATE_KEY = 'BUSINESS_ACTIVATION_KIT_GATE'

/**
 * The permanent replacement for a "METRO-SPECIFIC FEATURED KIT READY"
 * step: UNIVERSAL BUSINESS ACTIVATION KIT VERIFIED. PASSes only when the
 * canonical URL is confirmed live, its assets are reachable, and the
 * metro's own outreach copy references only the universal URL.
 */
export function evaluateActivationKitGate(verification: ActivationKitVerification): StagingGateResult {
  const textCheck = validateActivationKitReference(verification.outreachCopy)
  const problems: string[] = []
  if (!verification.kitUrlLive) problems.push(`${UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL} did not respond successfully.`)
  if (!verification.assetsAccessible) problems.push('One or more universal kit assets are not accessible at the canonical URL.')
  problems.push(...textCheck.issues)

  if (problems.length > 0) {
    return { key: ACTIVATION_KIT_GATE_KEY, verdict: 'FAIL', reason: problems.join(' | ') }
  }
  return {
    key: ACTIVATION_KIT_GATE_KEY,
    verdict: 'PASS',
    reason: `UNIVERSAL BUSINESS ACTIVATION KIT VERIFIED — ${UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL} is live, its assets are accessible, and this metro's outreach copy references only the universal kit (no metro-specific kit was created or referenced).`,
  }
}
