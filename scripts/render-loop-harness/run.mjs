globalThis.__DEV__ = true
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = (await import('react')).default
const TR = (await import('react-test-renderer')).default
const { useWhatsGood } = await import('./lib/useWhatsGood.js')
const orch = await import('./lib/stubOrchestrator.js')
const loc = await import('./lib/stubLocation.js')
let renders = 0
console.error = () => {}
// Permission denied (stubLocation) + a persisted/explicit metro => locationState 'unavailable' with a fallback location.
const metro = { id: 'amalfi', center_lat: 40.6, center_lng: 14.5 }
const items = [{ id: 'a', maps_lat: 40.6, maps_lng: 14.5, is_universal: false, geo_radius_m: 100 }]
function Probe() {
  renders++
  useWhatsGood({ userId: null, rawNearbyItems: items, homeRailItemIds: [], currentMetroId: 'amalfi', locationState: 'unavailable', explicitMetroChoice: metro, navigation: null })
  return null
}
let r
await TR.act(async () => { r = TR.create(React.createElement(Probe)) })
for (let i = 0; i < 20; i++) await TR.act(async () => { await new Promise(res => setTimeout(res, 10)) })
console.log(JSON.stringify({ renders, orchestratorCalls: orch.stats.calls, permissionChecks: loc.stats.permissionCalls }))
r.unmount(); process.exit(0)
