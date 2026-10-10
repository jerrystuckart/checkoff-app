import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '')

test('Home asks for hubs by the SELECTED metro id only; the phone location plays no part', () => {
  const hook = code(read('./useDiscoveryHubs.js'))
  assert.doesNotMatch(hook, /location|coords|latitude|userLocation/i)
  assert.match(code(read('../screens/HomeScreen.jsx')), /useDiscoveryHubs\(selectedMetro\?\.id \?\? null\)/)
  assert.match(code(read('./homeHubLinks.js')), /rpc\('get_metro_discovery_hubs', \{ p_metro_id: metroId \}\)/)
})

test('the link lives in the Near You heading row, not in a new Home section, and Home order is unchanged', () => {
  const nearYou = read('../components/home/NearYouCompact.jsx')
  assert.match(nearYou, /headingRow/)
  assert.match(nearYou, /NEAR YOU/)
  const home = read('../screens/HomeScreen.jsx')
  const iNear = home.indexOf('<NearYouCompact')
  const iGood = home.indexOf('<WhatsGoodDiscovery')
  assert.ok(iNear > 0 && iGood > iNear, 'Near You stays ahead of What\'s Good')
  assert.match(home, /hubLink=\{hubLink\.kind === HUB_LINK_KIND\.NONE \? null : hubLink\}/)
})

test('no hubs renders nothing and reserves no space; a long name truncates but the arrow stays', () => {
  const pill = read('../components/home/HubLinkPill.jsx')
  assert.match(pill, /if \(!hubLink\?\.parts \|\| !onPress\) return null/)
  assert.match(pill, /name: \{ flexShrink: 1,/)
  assert.match(pill, /fixed: \{ flexShrink: 0 \}/)
  assert.match(pill, /ellipsizeMode="tail"/)
  assert.match(read('../components/home/NearYouCompact.jsx'), /label: \{[^}]*flexShrink: 0/)
  const home = read('../screens/HomeScreen.jsx')
  // The standalone pill (no Near You items) is also conditional on a hub existing: no wrapper, no spacing otherwise.
  assert.match(home, /nearYouCompactItems\.length === 0 && hubLink\.kind !== HUB_LINK_KIND\.NONE/)
})

test('tapping opens the existing Hub screen directly (single) or the chooser (several)', () => {
  const home = read('../screens/HomeScreen.jsx')
  assert.match(home, /navigation\.navigate\('Hub', \{ destinationId: hub\.id \}\)/)
  assert.match(home, /HUB_LINK_KIND\.MULTI\) setHubChooserVisible\(true\)/)
  assert.match(read('../components/home/HubChooserModal.jsx'), /onSelect\(item\)/)
})

test('migration is additive, hides by default, leaves existing state alone and exposes only eligible hubs', () => {
  const sql = read('../supabase/migrations/20261010a_hub_metro_discovery.sql')
  const c = code(sql)
  assert.match(c, /ADD COLUMN IF NOT EXISTS discovery_enabled boolean NOT NULL DEFAULT false/)
  assert.match(c, /PRIMARY KEY \(metro_id, destination_id\)/)
  assert.match(c, /REFERENCES public\.metro_areas\(id\)\s+ON DELETE CASCADE/)
  assert.match(c, /REFERENCES public\.destinations\(id\) ON DELETE CASCADE/)
  assert.match(c, /REVOKE ALL ON public\.metro_hub_connections FROM anon, authenticated/)
  assert.match(c, /d\.is_active = true\s+AND d\.discovery_enabled = true/)
  assert.match(c, /SECURITY DEFINER[\s\S]*SET search_path = public/)
  assert.match(c, /ON CONFLICT \(metro_id, destination_id\) DO NOTHING/)
  // It never publishes or alters anything that exists today.
  assert.doesNotMatch(c, /^\s*(UPDATE|DELETE FROM|DROP TABLE|TRUNCATE)\b|destination_zones/im)
  assert.doesNotMatch(c, /SET\s+discovery_enabled/i)
})
