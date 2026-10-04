// Real Willcox/Positano Hub data (read-only snapshot, 2026-10-04) driven through the
// same selection logic the Hub uses. Backs docs/hub-location/GPS_TEST_SHEET.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildHubExperiences, selectHubLocationSection, isInsideAnyZone } from './hubLocationSection.js'
import { mapRailItem } from './mapRailItem.js'

const fx = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/hub_live_2026-10-04.json'), 'utf8'))
const items = slug => buildHubExperiences(
  fx.rows.filter(r => r.slug === slug && r.is_active && r.is_approved !== false)
    .map(r => ({ list_id: r.list, item: mapRailItem(r) })),
).map(e => e.item)
const run = (slug, latitude, longitude) =>
  selectHubLocationSection({ location: { latitude, longitude }, zones: [fx.zones[slug]], items: items(slug) })
const bodies = s => s.items.map(i => i.body)

test('live data: experience counts (inactive and universal items excluded)', () => {
  assert.equal(items('willcox').length, 21)
  assert.equal(items('positano').length, 24)
})

test('Willcox at a venue (Rix\'s Tavern)', () => {
  const s = run('willcox', 32.2516952, -109.8333493)
  assert.equal(s.kind, 'at'); assert.match(bodies(s)[0], /Rix's Tavern/)
})
test('Willcox inside zone, between venues -> closest two in order', () => {
  const s = run('willcox', 32.2480, -109.8400)
  assert.equal(s.kind, 'closest')
  assert.match(bodies(s)[0], /Rix's Tavern/); assert.match(bodies(s)[1], /Big Tex/)
  assert.ok(s.items[0].distM < s.items[1].distM)
})
test('Willcox zone boundary: 32.61262 inside, 32.61622 outside', () => {
  assert.equal(run('willcox', 32.61262, -109.8326).kind, 'closest')
  assert.equal(run('willcox', 32.61622, -109.8326), null)
  assert.equal(isInsideAnyZone({ latitude: 32.61622, longitude: -109.8326 }, [fx.zones.willcox]), false)
})
test('Positano venue, between, and boundary', () => {
  const at = run('positano', 40.6263545, 14.4822477)
  assert.equal(at.kind, 'at'); assert.match(bodies(at)[0], /Torre Trasita/)
  const between = run('positano', 40.63, 14.49)
  assert.equal(between.kind, 'closest'); assert.equal(between.items.length, 2)
  assert.equal(run('positano', 40.6909, 14.485).kind, 'closest')
  assert.equal(run('positano', 40.6919, 14.485), null)
})
