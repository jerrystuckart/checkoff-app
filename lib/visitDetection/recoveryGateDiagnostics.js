// Last observed facts behind the visit recovery controls, for the admin-only collapsed Diagnostics disclosure.
// Display only: it records what useVisitRecovery already computed, nothing more, and nothing is sent anywhere.
let current = { recorded: false }
const listeners = new Set()

export function recordRecoveryGate(patch) {
  current = { ...current, ...patch, recorded: true, at: Date.now() }
  listeners.forEach((fn) => { try { fn(current) } catch {} })
}
export function getRecoveryGate() { return current }
export function subscribeRecoveryGate(fn) { listeners.add(fn); return () => listeners.delete(fn) }

export function recoveryGateRows(g) {
  if (!g?.recorded) return [{ label: 'Visit recovery', value: 'not evaluated yet (open Home signed in)' }]
  const yn = (v) => (v === true ? 'yes' : v === false ? 'no' : '—')
  return [
    { label: 'Recovery: binary supports it', value: `${yn(g.supported)} (runtime ${g.runtime ?? 'none'})` },
    { label: 'Recovery: offered (master flag)', value: yn(g.flagEnabled) },
    { label: 'Recovery: opted in', value: yn(g.optedIn) },
    { label: 'Recovery: card state', value: g.state ?? '—' },
    { label: 'Recovery: last error', value: g.error ?? 'none' },
  ]
}
