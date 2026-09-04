// Chief production-integrity pass — real provider usage/cost tracking.
// Pure, no I/O. A versioned, explicit pricing table — never a hardcoded
// prose estimate ("roughly $0.10-$0.30") like the one given in an earlier
// report. Model ids are pinned the same way modelRouting.ts pins them;
// this table must be updated by hand when list pricing changes, never
// inferred or guessed at query time.

export const USAGE_PRICING_TABLE_VERSION = '2026-09-08'

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMillionUsd: number
  /** USD per 1,000,000 output tokens. */
  outputPerMillionUsd: number
}

// As configured on USAGE_PRICING_TABLE_VERSION above — verify against
// the provider's current published pricing before trusting this for a
// real invoicing/budgeting decision; this table is a point-in-time
// snapshot, not a live feed.
const OPENAI_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  'gpt-4.1': { inputPerMillionUsd: 2.0, outputPerMillionUsd: 8.0 },
  'gpt-4.1-mini': { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
  'gpt-4.1-nano': { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  'gpt-4o': { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10.0 },
  'gpt-4o-mini': { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
})

const PRICING_TABLES_BY_PROVIDER: Readonly<Record<string, Readonly<Record<string, ModelPricing>>>> = Object.freeze({
  openai: OPENAI_PRICING,
})

export interface TokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface CostEstimate {
  costUsd: number
  pricingVersion: string
}

/**
 * Returns null — never a guessed/zero cost — when the model isn't in the
 * pricing table or token counts are unavailable. A missing price is a
 * real "we don't know," not $0.
 */
export function estimateCostUsd(providerKey: string, model: string | null, usage: TokenUsage): CostEstimate | null {
  if (!model || usage.inputTokens == null || usage.outputTokens == null) return null
  const table = PRICING_TABLES_BY_PROVIDER[providerKey]
  const pricing = table?.[model]
  if (!pricing) return null
  const costUsd = (usage.inputTokens / 1_000_000) * pricing.inputPerMillionUsd + (usage.outputTokens / 1_000_000) * pricing.outputPerMillionUsd
  return { costUsd, pricingVersion: USAGE_PRICING_TABLE_VERSION }
}
