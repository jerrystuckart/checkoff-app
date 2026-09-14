// agent-service/playbooks/categoryPolicy.ts
//
// Seed Portfolio Audit (M5_75_SEED_PORTFOLIO_AUDIT) — shared policy model,
// adjustment 1 and 2 of the pre-approved architecture. Pure, no I/O.
//
// Adjustment 1 ("counts AND percentages, not percentages alone"): a
// CategoryPolicy WRAPS/extends metroLaunch.ts's existing CategoryTarget
// (minimumViable/healthyTarget) rather than replacing it — every policy is
// built FROM a DEFAULT_CATEGORY_COVERAGE_PLAN target (defaultMetroManifest.ts),
// with percentage fields layered on top. A category fails whenever it falls
// below its applicable absolute minimum OR violates a percentage guardrail —
// either condition alone is sufficient to fail it (evaluateCategoryPolicies
// checks both independently, never ORs them into a single soft signal).
//
// Adjustment 2 ("percentages are guardrails, not quotas"): CategoryPolicyException
// mirrors the EXACT precedent already established in metroLaunch.ts's
// evaluateMetroGates (approvedCategoryExceptions: string[], checked at
// metroLaunch.ts:365) — a plain list of category names Jerry has explicitly
// approved is the ONLY way a gate passes despite a real gap in that module,
// so this module follows the identical shape/spirit rather than inventing a
// second exception mechanism, just with a richer record (reason + evidence +
// approver) since this stage's exceptions need to be independently auditable
// in the SeedPortfolioAuditReport (adjustment 10, section F).

import type { CategoryCoveragePlan, CategoryTarget } from './metroLaunch'

export interface CategoryPercentageBand {
  /** Below this share of the total seed pool, the category is a guardrail violation (not a hard quota — see CategoryPolicyException). */
  minPercent: number
  /** Optional overconcentration cap (adjustment 2's explicit Arts & Culture example) — omitted means no cap. */
  maxPercent?: number
}

/** Optional metro-size adjustment: below `smallMetroTotalThreshold` total seed candidates, `smallMetroAbsoluteMinimum` replaces the ordinary absoluteMinimum for this category — a small single-market metro should not be held to the same raw floor as a major metro. */
export interface CategoryMetroSizeAdjustment {
  smallMetroTotalThreshold: number
  smallMetroAbsoluteMinimum: number
}

export interface CategoryPolicy {
  categoryName: string
  /** Hard floor — falling below this alone fails the category, independent of percentage. */
  absoluteMinimum: number
  /** Count-or-range healthy target — `max` omitted means no explicit healthy ceiling (independent of the percentage overconcentration cap, which is a market-share signal, not a raw-count one). */
  healthyTarget: { min: number; max?: number }
  /** Percentage guardrail — omitted means this category has no percentage band (some categories are legitimately evaluated on raw count alone). */
  percentageBand?: CategoryPercentageBand
  metroSizeAdjustment?: CategoryMetroSizeAdjustment
}

export interface CategoryPolicyException {
  categoryName: string
  reason: string
  /** Concrete evidence of insufficient candidates — e.g. "6 targeted research passes across 3 iterations, plateaued at 4 candidates" — never a bare assertion. */
  evidenceOfInsufficientCandidates: string
  approvedBy: string
  approvedAt: string
}

export interface CategoryPolicySet {
  policies: CategoryPolicy[]
  /** At most one exception per category — see findException. */
  exceptions: CategoryPolicyException[]
}

/**
 * Builds a CategoryPolicySet FROM the existing DEFAULT_CATEGORY_COVERAGE_PLAN
 * (or any CategoryCoveragePlan) — composes rather than discards the existing
 * raw min/healthy counts. `percentageBands` lets a caller layer percentage
 * guardrails onto specific categories (e.g. Arts & Culture's overconcentration
 * cap) without hand-writing every CategoryPolicy from scratch.
 */
export function buildCategoryPolicySetFromPlan(plan: CategoryCoveragePlan, percentageBands?: Readonly<Record<string, CategoryPercentageBand>>, metroSizeAdjustments?: Readonly<Record<string, CategoryMetroSizeAdjustment>>, exceptions: readonly CategoryPolicyException[] = []): CategoryPolicySet {
  return {
    policies: plan.targets.map((t: CategoryTarget) => ({
      categoryName: t.categoryName,
      absoluteMinimum: t.minimumViable,
      healthyTarget: { min: t.healthyTarget },
      percentageBand: percentageBands?.[t.categoryName],
      metroSizeAdjustment: metroSizeAdjustments?.[t.categoryName],
    })),
    exceptions: [...exceptions],
  }
}

/**
 * Adjustment 2's explicit Arts & Culture overconcentration cap — a default,
 * generic starting percentage-band set, mirroring DEFAULT_CATEGORY_COVERAGE_PLAN's
 * own "safe generic default, always overridable" discipline (defaultMetroManifest.ts's
 * own doc). Only categories with a real guardrail get an entry; everything
 * else is evaluated on raw count alone.
 */
export const DEFAULT_CATEGORY_PERCENTAGE_BANDS: Readonly<Record<string, CategoryPercentageBand>> = Object.freeze({
  'Arts & Culture': { minPercent: 3, maxPercent: 30 },
})

function findException(categoryName: string, exceptions: readonly CategoryPolicyException[]): CategoryPolicyException | undefined {
  return exceptions.find((e) => e.categoryName === categoryName)
}

/**
 * FLAG_OVERCONCENTRATION is deliberately distinct from FAIL_PERCENTAGE_BAND
 * (adjustment 2: "percentages are guardrails, not quotas"; Arts & Culture's
 * overconcentration cap is explicit, but this codebase's own established
 * precedent — metroLaunch.ts's CATEGORY_OVERREPRESENTED/
 * CATEGORY_APPROACHING_DOMINANCE — treats too-much-of-a-category as a SOFT
 * warning, never a blocker: dispatching MORE research at an already-
 * overrepresented category cannot fix overrepresentation, and
 * "essential/distinctive items are never rejected purely to hit a
 * number"). FLAG_OVERCONCENTRATION never blocks categoryPolicyGatePasses
 * and never dispatches a research iteration — it is reported, not gated.
 */
export type CategoryPolicyVerdict = 'PASS' | 'PASS_WITH_EXCEPTION' | 'FAIL_ABSOLUTE_MINIMUM' | 'FAIL_PERCENTAGE_BAND' | 'FLAG_OVERCONCENTRATION'

export interface CategoryPolicyResult {
  categoryName: string
  count: number
  percentOfTotal: number
  applicableAbsoluteMinimum: number
  verdict: CategoryPolicyVerdict
  reasons: string[]
  exceptionApplied: CategoryPolicyException | null
}

/**
 * Evaluates every configured CategoryPolicy against real seed-candidate
 * counts. `totalCount` is the total seed candidate pool (across every
 * category, not just policy-covered ones) — percentages are always a share
 * of the WHOLE pool, never just the policy-covered subset.
 */
export function evaluateCategoryPolicies(counts: readonly { categoryName: string; count: number }[], policySet: CategoryPolicySet, totalCount?: number): CategoryPolicyResult[] {
  const countByCategory = new Map(counts.map((c) => [c.categoryName, c.count]))
  const total = totalCount ?? counts.reduce((sum, c) => sum + c.count, 0)

  return policySet.policies.map((policy) => {
    const count = countByCategory.get(policy.categoryName) ?? 0
    const percentOfTotal = total > 0 ? (count / total) * 100 : 0
    const applicableAbsoluteMinimum = policy.metroSizeAdjustment && total <= policy.metroSizeAdjustment.smallMetroTotalThreshold ? policy.metroSizeAdjustment.smallMetroAbsoluteMinimum : policy.absoluteMinimum

    const reasons: string[] = []
    const failsAbsolute = count < applicableAbsoluteMinimum
    if (failsAbsolute) reasons.push(`${count}/${applicableAbsoluteMinimum} absolute minimum`)

    let failsPercentageFloor = false
    let isOverconcentrated = false
    if (policy.percentageBand) {
      if (percentOfTotal < policy.percentageBand.minPercent) {
        failsPercentageFloor = true
        reasons.push(`${percentOfTotal.toFixed(1)}% is below the ${policy.percentageBand.minPercent}% guardrail floor`)
      } else if (policy.percentageBand.maxPercent !== undefined && percentOfTotal > policy.percentageBand.maxPercent) {
        isOverconcentrated = true
        reasons.push(`${percentOfTotal.toFixed(1)}% exceeds the ${policy.percentageBand.maxPercent}% overconcentration cap`)
      }
    }

    if (!failsAbsolute && !failsPercentageFloor && !isOverconcentrated) {
      return { categoryName: policy.categoryName, count, percentOfTotal, applicableAbsoluteMinimum, verdict: 'PASS', reasons: [], exceptionApplied: null }
    }

    if (!failsAbsolute && !failsPercentageFloor && isOverconcentrated) {
      // Soft warning only — never blocks, never eligible for/needs an
      // exception (see FLAG_OVERCONCENTRATION's own doc).
      return { categoryName: policy.categoryName, count, percentOfTotal, applicableAbsoluteMinimum, verdict: 'FLAG_OVERCONCENTRATION', reasons, exceptionApplied: null }
    }

    const exception = findException(policy.categoryName, policySet.exceptions)
    if (exception) {
      return {
        categoryName: policy.categoryName,
        count,
        percentOfTotal,
        applicableAbsoluteMinimum,
        verdict: 'PASS_WITH_EXCEPTION',
        reasons: [...reasons, `Market-specific exception approved by ${exception.approvedBy}: ${exception.reason}`],
        exceptionApplied: exception,
      }
    }

    return {
      categoryName: policy.categoryName,
      count,
      percentOfTotal,
      applicableAbsoluteMinimum,
      verdict: failsAbsolute ? 'FAIL_ABSOLUTE_MINIMUM' : 'FAIL_PERCENTAGE_BAND',
      reasons,
      exceptionApplied: null,
    }
  })
}

export function categoryPolicyGatePasses(results: readonly CategoryPolicyResult[]): boolean {
  return results.every((r) => r.verdict === 'PASS' || r.verdict === 'PASS_WITH_EXCEPTION' || r.verdict === 'FLAG_OVERCONCENTRATION')
}

// ---------------------------------------------------------------------------
// Adjustment 3 — commercial ownership taxonomy.
// ---------------------------------------------------------------------------

export type CommercialOwnershipType = 'INDEPENDENT_LOCAL' | 'SMALL_LOCAL_GROUP' | 'REGIONAL_OPERATOR' | 'NATIONAL_OR_INTERNATIONAL_CHAIN' | 'PUBLIC_INSTITUTION' | 'NONCOMMERCIAL_OUTDOOR_OR_CIVIC' | 'UNKNOWN_REQUIRES_VERIFICATION'

export const VALID_COMMERCIAL_OWNERSHIP_TYPES: readonly CommercialOwnershipType[] = [
  'INDEPENDENT_LOCAL',
  'SMALL_LOCAL_GROUP',
  'REGIONAL_OPERATOR',
  'NATIONAL_OR_INTERNATIONAL_CHAIN',
  'PUBLIC_INSTITUTION',
  'NONCOMMERCIAL_OUTDOOR_OR_CIVIC',
  'UNKNOWN_REQUIRES_VERIFICATION',
]

/** Excluded from the commercial-mix denominator ENTIRELY — never counted against the metro, per adjustment 3. */
const COMMERCIAL_MIX_EXCLUDED_TYPES: ReadonlySet<CommercialOwnershipType> = new Set(['PUBLIC_INSTITUTION', 'NONCOMMERCIAL_OUTDOOR_OR_CIVIC'])

/** "Locally-owned/independently-operated" for the ≥65% threshold. UNKNOWN_REQUIRES_VERIFICATION is deliberately NOT included — it is never silently treated as INDEPENDENT_LOCAL (adjustment 3). */
const LOCALLY_OWNED_TYPES: ReadonlySet<CommercialOwnershipType> = new Set(['INDEPENDENT_LOCAL', 'SMALL_LOCAL_GROUP'])

export const DEFAULT_COMMERCIAL_MIX_MIN_LOCAL_PERCENT = 65

/** Past this many UNKNOWN_REQUIRES_VERIFICATION items in the eligible pool, it's its own reportable finding — never silently absorbed into a pass or fail. */
export const DEFAULT_UNKNOWN_OWNERSHIP_VOLUME_THRESHOLD = 5

export interface CommercialMixItem {
  candidateName: string
  ownershipType: CommercialOwnershipType
}

export type CommercialMixVerdict = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'

export interface CommercialMixResult {
  eligibleCount: number
  excludedCount: number
  locallyOwnedCount: number
  locallyOwnedPercent: number
  unknownCount: number
  minLocalPercent: number
  verdict: CommercialMixVerdict
  reason: string
  /** Set only when unknownCount reaches unknownVolumeThreshold — a "requires verification" finding, never a pass or fail on its own. */
  unknownVolumeFinding: string | null
}

export function evaluateCommercialMix(items: readonly CommercialMixItem[], minLocalPercent: number = DEFAULT_COMMERCIAL_MIX_MIN_LOCAL_PERCENT, unknownVolumeThreshold: number = DEFAULT_UNKNOWN_OWNERSHIP_VOLUME_THRESHOLD): CommercialMixResult {
  const excluded = items.filter((i) => COMMERCIAL_MIX_EXCLUDED_TYPES.has(i.ownershipType))
  const eligible = items.filter((i) => !COMMERCIAL_MIX_EXCLUDED_TYPES.has(i.ownershipType))
  const unknown = eligible.filter((i) => i.ownershipType === 'UNKNOWN_REQUIRES_VERIFICATION')
  // The PASS/FAIL percentage is computed over KNOWN eligible ownership only
  // (adjustment 3's own text: a high UNKNOWN volume "is its own finding...
  // not a pass or fail") — UNKNOWN is never counted toward the numerator
  // (never silently independent) NOR the denominator (never silently
  // penalized as a definite non-independent either); it is reported
  // separately via unknownVolumeFinding instead.
  const known = eligible.filter((i) => i.ownershipType !== 'UNKNOWN_REQUIRES_VERIFICATION')
  const locallyOwned = known.filter((i) => LOCALLY_OWNED_TYPES.has(i.ownershipType))
  const locallyOwnedPercent = known.length > 0 ? (locallyOwned.length / known.length) * 100 : 0

  const unknownVolumeFinding = unknown.length >= unknownVolumeThreshold ? `${unknown.length} eligible commercial item(s) are stuck at UNKNOWN_REQUIRES_VERIFICATION ownership — this is its own gap finding (requires-verification), not folded into the pass/fail commercial-mix verdict: ${unknown.map((u) => u.candidateName).join(', ')}` : null

  if (known.length === 0) {
    return {
      eligibleCount: eligible.length,
      excludedCount: excluded.length,
      locallyOwnedCount: 0,
      locallyOwnedPercent: 0,
      unknownCount: unknown.length,
      minLocalPercent,
      verdict: 'INSUFFICIENT_DATA',
      reason: eligible.length === 0 ? 'No eligible commercial inventory (all items are PUBLIC_INSTITUTION/NONCOMMERCIAL_OUTDOOR_OR_CIVIC or the pool is empty) — commercial mix cannot be evaluated.' : 'Every eligible item is still UNKNOWN_REQUIRES_VERIFICATION ownership — commercial mix cannot yet be evaluated on real data (see unknownVolumeFinding).',
      unknownVolumeFinding,
    }
  }

  const pass = locallyOwnedPercent >= minLocalPercent
  return {
    eligibleCount: eligible.length,
    excludedCount: excluded.length,
    locallyOwnedCount: locallyOwned.length,
    locallyOwnedPercent,
    unknownCount: unknown.length,
    minLocalPercent,
    verdict: pass ? 'PASS' : 'FAIL',
    reason: pass
      ? `${locallyOwned.length}/${known.length} (${locallyOwnedPercent.toFixed(1)}%) known-ownership eligible commercial items are locally-owned/independently-operated — meets the ${minLocalPercent}% threshold.`
      : `${locallyOwned.length}/${known.length} (${locallyOwnedPercent.toFixed(1)}%) known-ownership eligible commercial items are locally-owned/independently-operated — below the ${minLocalPercent}% threshold.`,
    unknownVolumeFinding,
  }
}

// ---------------------------------------------------------------------------
// Adjustment 5 — structured secret evidence.
// ---------------------------------------------------------------------------

export type SecretEvidenceConfidence = 'HIGH' | 'MEDIUM' | 'LOW'
export type SecretEvidenceVerdict = 'READY' | 'HOLD' | 'REJECT'

export interface SecretEvidenceRecord {
  /** The exact claimed mechanic — free text, validated non-empty and specific (see evaluateSecretEvidence). */
  mechanic: string
  evidenceType: string
  /** URL or citation. */
  source: string
  dateVerified: string | null
  confidence: SecretEvidenceConfidence
  verdict: SecretEvidenceVerdict
}

/** Insufficient-by-themselves phrases (adjustment 5) — fail the secret-evidence test as the ONLY justification. */
export const INSUFFICIENT_SECRET_PHRASES: readonly string[] = ['local favorite', 'underrated', 'less touristy', 'hidden gem']

/** The floor of valid concrete mechanic categories (adjustment 5) — not exhaustive, but any of these (or an equivalently concrete phrase containing one) is sufficient to be a real discovery mechanic. */
export const CONCRETE_SECRET_MECHANIC_KEYWORDS: readonly string[] = [
  'unmarked entrance',
  'concealed entrance',
  'hidden entrance',
  'unmarked door',
  'concealed door',
  'hidden room',
  'secret room',
  'unusual access',
  'hidden access',
  'off-menu',
  'secret menu',
  'secret order',
  'secret drink',
  'secret password',
  'password',
  'hidden exit',
  'speakeasy',
  'behind the',
  'through the',
  'unmarked',
]

export interface SecretEvidenceEvaluation {
  supported: boolean
  reason: string
}

/**
 * Whether a claimed isSecret mechanic is supported enough to survive as a
 * real claim. Per adjustment 5's explicit precedent from tonight's session
 * ("if evidence is weak, keep the venue but remove the secret claim"): this
 * function NEVER rejects the underlying candidate — callers strip isSecret,
 * they don't drop the item.
 */
export function evaluateSecretEvidence(record: SecretEvidenceRecord | null | undefined): SecretEvidenceEvaluation {
  if (!record) return { supported: false, reason: 'No secret evidence record provided — the isSecret claim cannot be supported.' }
  const mechanic = record.mechanic.trim()
  if (mechanic.length === 0) return { supported: false, reason: 'Secret evidence mechanic is empty — a claim requires a concrete, specific discovery mechanic.' }

  const lower = mechanic.toLowerCase()
  const hasConcreteMechanic = CONCRETE_SECRET_MECHANIC_KEYWORDS.some((k) => lower.includes(k))
  const onlyInsufficientPhrase = INSUFFICIENT_SECRET_PHRASES.some((p) => lower.includes(p)) && !hasConcreteMechanic

  if (onlyInsufficientPhrase) {
    return { supported: false, reason: `Secret evidence mechanic ("${mechanic}") is only a vague, insufficient-by-itself descriptor (e.g. "hidden gem", "local favorite") with no concrete discovery mechanic — the isSecret claim is stripped, though the item itself is not rejected.` }
  }
  if (!hasConcreteMechanic) {
    return { supported: false, reason: `Secret evidence mechanic ("${mechanic}") does not describe a recognized concrete discovery mechanic (concealed/unmarked entrance, hidden room, unusual access route, verified off-menu order, secret drink, hidden exit, or equivalent) — the isSecret claim is stripped.` }
  }
  if (record.source.trim().length === 0) {
    return { supported: false, reason: 'Secret evidence has a concrete mechanic but no source/citation — the isSecret claim is stripped pending real evidence.' }
  }
  return { supported: true, reason: `Concrete discovery mechanic ("${mechanic}") with source evidence — the isSecret claim is supported.` }
}
