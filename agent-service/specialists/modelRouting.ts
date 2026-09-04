// Chief Phase 2H — deliberate cost/quality model-routing policy. Pure,
// no I/O. The whole point of this module: model selection is
// `specialist + methodology + capability + cost tier -> configured
// model`, NEVER `whatever the newest/highest-end model happens to be`.
// A future OpenAI release must never silently change Chief's cost or
// quality behavior — every model id here is pinned (an explicit string,
// never an alias like "latest"), and escalating to a stronger/pricier
// model requires one of three explicit things: a dedicated env var for
// that specific routing slot, a documented quality-gate failure (not yet
// wired — see the module doc below), or Jerry's own configuration
// change. Never "because a newer model exists."

export type ModelCostTier = 'ECONOMY' | 'STANDARD' | 'PREMIUM'

export interface ModelRoute {
  model: string
  costTier: ModelCostTier
  /** Where this model id came from — for reporting/debugging only, never a secret. */
  source: 'default' | 'env'
}

// ---------------------------------------------------------------------------
// Pinned defaults (Phase 2H). research_verifier and DVA-1 both default to
// gpt-4.1 specifically because it was the model CONFIRMED working with
// live web research in this environment during the Phase 2H live-provider
// proof (gpt-5 404s without organization verification) — this is a
// verified-working choice, not an arbitrary one. checkoff_editor defaults
// to a cheaper model: it's a constrained editorial transformation on
// already-verified facts, not open-ended research, so it doesn't need
// research-grade reasoning. DVA-2/DAP ("deep analysis") default to the
// SAME gpt-4.1 as DVA-1 — not automatically upgraded — until testing
// specifically proves a stronger model materially improves output, at
// which point CHIEF_OPENAI_DEEP_ANALYSIS_MODEL is the explicit override
// point (PREMIUM tier).
// ---------------------------------------------------------------------------

const DEFAULT_RESEARCH_MODEL = 'gpt-4.1'
const DEFAULT_EDITOR_MODEL = 'gpt-4.1-mini'
const DEFAULT_DVA1_MODEL = 'gpt-4.1'
const DEFAULT_DEEP_ANALYSIS_MODEL = 'gpt-4.1'

function fromEnvOrDefault(envVar: string, fallback: string): { value: string; source: 'default' | 'env' } {
  const raw = process.env[envVar]
  return raw ? { value: raw, source: 'env' } : { value: fallback, source: 'default' }
}

/**
 * The routing table itself. Deterministic — same (specialist,
 * methodologyId) always resolves to the same model given the same
 * environment configuration.
 *
 * PREMIUM is only ever reached via `CHIEF_OPENAI_DEEP_ANALYSIS_MODEL`
 * being explicitly set (Jerry's own configuration decision). Two other
 * PREMIUM triggers are named in the Phase 2H policy but NOT wired here —
 * stated honestly rather than pretended:
 *   - "failed quality gate" escalation: no such automatic re-run-on-a-
 *     stronger-model mechanism exists in the driver today. If Chief ever
 *     gains one, it should call this function with an explicit override,
 *     never silently pick a different model on its own.
 *   - "explicit Jerry approval" as a per-execution runtime decision
 *     (distinct from a standing env var): no such per-call approval
 *     plumbing exists yet — today, "explicit configuration" (the env
 *     var) IS how Jerry approves PREMIUM, set once, deliberately.
 */
export function resolveOpenAiModel(specialist: string, methodologyId: string): ModelRoute {
  if (specialist === 'research_verifier') {
    const { value, source } = fromEnvOrDefault('CHIEF_OPENAI_RESEARCH_MODEL', DEFAULT_RESEARCH_MODEL)
    return { model: value, costTier: 'STANDARD', source }
  }
  if (specialist === 'checkoff_editor') {
    const { value, source } = fromEnvOrDefault('CHIEF_OPENAI_EDITOR_MODEL', DEFAULT_EDITOR_MODEL)
    return { model: value, costTier: 'ECONOMY', source }
  }
  if (specialist === 'destination_strategist') {
    if (methodologyId === 'destination/dva1') {
      const { value, source } = fromEnvOrDefault('CHIEF_OPENAI_DVA1_MODEL', DEFAULT_DVA1_MODEL)
      return { model: value, costTier: 'STANDARD', source }
    }
    // destination/dva2, destination/dap — "deep analysis." PREMIUM ONLY
    // when CHIEF_OPENAI_DEEP_ANALYSIS_MODEL is explicitly set; otherwise
    // stays STANDARD at the same pinned gpt-4.1 default as DVA-1 — never
    // auto-escalated.
    const raw = process.env.CHIEF_OPENAI_DEEP_ANALYSIS_MODEL
    if (raw) return { model: raw, costTier: 'PREMIUM', source: 'env' }
    return { model: DEFAULT_DEEP_ANALYSIS_MODEL, costTier: 'STANDARD', source: 'default' }
  }
  // Any future specialist wired to OpenAI without its own dedicated route
  // yet falls back to the research route (STANDARD, not a silent
  // upgrade) — deliberately conservative rather than guessing PREMIUM.
  const { value, source } = fromEnvOrDefault('CHIEF_OPENAI_RESEARCH_MODEL', DEFAULT_RESEARCH_MODEL)
  return { model: value, costTier: 'STANDARD', source }
}

/** Documentation-only — the exact env vars this policy reads, for the operator-facing report. Never contains secret values. */
export const MODEL_ROUTING_ENV_VARS = Object.freeze({
  CHIEF_OPENAI_RESEARCH_MODEL: DEFAULT_RESEARCH_MODEL,
  CHIEF_OPENAI_EDITOR_MODEL: DEFAULT_EDITOR_MODEL,
  CHIEF_OPENAI_DVA1_MODEL: DEFAULT_DVA1_MODEL,
  CHIEF_OPENAI_DEEP_ANALYSIS_MODEL: `<unset by default — falls back to ${DEFAULT_DEEP_ANALYSIS_MODEL} at STANDARD tier; set explicitly to opt into PREMIUM>`,
})
