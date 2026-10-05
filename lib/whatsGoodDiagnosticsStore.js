// Hand-off between Home (which computes the What's Good diagnostics payload as part of its normal work) and Profile's
// admin-only "Diagnostics" disclosure (which displays it). Pure module state — no I/O, no new queries. Home publishes
// the latest payload + its refresh action; Profile subscribes. Nothing is rendered on Home.
let current = { payload: null, refresh: null }
const listeners = new Set()

export function publishWhatsGoodDiagnostics(payload, refresh) {
  if (current.payload === payload && current.refresh === refresh) return
  current = { payload, refresh }
  listeners.forEach(fn => fn(current))
}
export function getWhatsGoodDiagnostics() { return current }
export function subscribeWhatsGoodDiagnostics(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
