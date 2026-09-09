// agent-service/specialists/businessActivationKitCheck.ts
//
// Chief Phase 3A — the ONE real network call behind
// BUSINESS_ACTIVATION_KIT_GATE: is the canonical Universal Business
// Activation Kit URL actually live? Everything else that gate checks
// (no metro-specific kit referenced, outreach copy uses the canonical
// URL, /confirm/<token> kept separate) is deterministic and certified
// from config/process state with zero network calls — see
// agent-service/playbooks/businessActivationKit.ts.
//
// Bounded and fail-clear, per Jerry's explicit instruction: ONE fetch,
// a hard timeout, never retried in a loop by this function itself. A
// transient network hiccup fails this ONE gate evaluation with a clear
// reason; it can never turn into an unbounded/endless metro-build loop
// — if the driver's own bounded self-repair loop wants to try again
// later, that's a decision made by the caller, not by this function.

export interface ActivationKitLiveCheckResult {
  live: boolean
  reason: string
}

const DEFAULT_TIMEOUT_MS = 8000

export async function checkActivationKitUrlLive(url: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ActivationKitLiveCheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal })
    return { live: res.ok, reason: `HTTP ${res.status}` }
  } catch (err) {
    return { live: false, reason: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}
