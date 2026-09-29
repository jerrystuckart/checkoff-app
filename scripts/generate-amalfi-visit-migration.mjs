// One-off generator for supabase/migrations/20260929_amalfi_visit_profiles_and_geo.sql.
// Inputs: an items export (JSON lines: id, body, act), the Places lookup output for the coordinate-less
// items, and docs/visit-recovery/amalfi_profile_decisions.json (the reviewed per-venue decisions).
// Usage: node scripts/generate-amalfi-visit-migration.mjs <items.jsonl> <geo_out.json>
import fs from 'node:fs'

const [itemsPath, geoPath] = process.argv.slice(2)
const dec = JSON.parse(fs.readFileSync(new URL('../docs/visit-recovery/amalfi_profile_decisions.json', import.meta.url), 'utf8'))
const items = fs.readFileSync(itemsPath, 'utf8').trim().split('\n').map(JSON.parse).filter((i) => i.act)
const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'))
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

// Earliest match wins: 'Sentiero degli Dei' bodies also mention Nocelle, 'Il Ritrovo' mentions Montepertuso.
const keyFor = (body) => {
  const hits = Object.keys(dec).map((k) => [body.indexOf(k), k]).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0])
  return hits[0]?.[1]
}
// Larger campuses get a wider check-off/visit circle; everything else keeps the catalog's 100 m convention.
const WIDE = { 'Hotel Santa Caterina Spa': 150, 'Monastero Santa Rosa Spa': 150, 'La Gavitella Cooking Classes': 150 }

const byProfile = {}
const notes = []
let geoCount = 0
const geoSql = []
for (const it of items) {
  const key = keyFor(it.body)
  if (!key) throw new Error('no decision for: ' + it.body)
  const [profile, why] = dec[key]
  ;(byProfile[profile] ??= []).push({ id: it.id, key })
  notes.push(`--   ${profile.padEnd(11)} ${key}: ${why}`)
  const g = geo[it.id]
  if (g?.lat) {
    geoCount++
    geoSql.push(
      `UPDATE items SET maps_lat = ${g.lat}, maps_lng = ${g.lng}, geo_location = ST_SetSRID(ST_MakePoint(${g.lng}, ${g.lat}), 4326),\n` +
      `  geo_radius_m = ${WIDE[key] ?? 100}, google_place_id = ${q(g.pid)}, formatted_address = ${q(g.addr)}\n` +
      `WHERE id = '${it.id}' AND maps_lat IS NULL; -- ${key}`
    )
  }
}
const total = items.length
const excluded = (byProfile.manual_only ?? []).length

let sql = `-- Amalfi Coast visit-detection intake fix (2026-09-29).
-- Root cause: the Amalfi catalog (created 2026-09-26/27) missed the 2026-09-28 rule_v1 profile backfill, and 15 of the
-- 2026-09-27 bulk-added items were inserted without coordinates. Nothing was monitored: 46 geocoded items had no
-- visit_profile_key ('no_visit_profile_assigned') and 15 could not be seen by the client at all.
--
-- 1. Coordinates for the 15 coordinate-less items: Google Places (New) Text Search on each item's own maps_query,
--    address checked against the query. google_place_id / formatted_address stored like the admin's confirm-location flow.
-- 2. A reviewed visit profile for every active Amalfi item (${total}): ${total - excluded} monitored-eligible, ${excluded} intentionally
--    excluded as manual_only (trails, boat trips, private events, a co-located duplicate). Per-venue reasons below and in
--    docs/visit-recovery/amalfi_profile_decisions.json. Existing thresholds are unchanged.
-- Reversible: UPDATE items SET visit_profile_key = NULL, visit_profile_source = NULL WHERE visit_profile_source = 'curated_2026-09-29';
BEGIN;

`
sql += `-- Coordinates (${geoCount})\n` + geoSql.join('\n') + '\n\n'
sql += `-- Profiles (only fills empty profiles: never overwrites a person's earlier choice)\n`
for (const [profile, rows] of Object.entries(byProfile)) {
  sql += `UPDATE items SET visit_profile_key = '${profile}', visit_profile_source = 'curated_2026-09-29'\n` +
    `WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (\n` +
    rows.map((r, n) => `  '${r.id}'${n < rows.length - 1 ? ',' : ''} -- ${r.key}`).join('\n') + '\n);\n\n'
}
sql += `-- Rationale per venue:\n${notes.join('\n')}\n\n`
sql += `DO $$
DECLARE n int; g int;
BEGIN
  SELECT count(*) INTO n FROM items WHERE visit_profile_source = 'curated_2026-09-29';
  IF n <> ${total} THEN RAISE EXCEPTION 'expected ${total} curated Amalfi profiles, found %', n; END IF;
  SELECT count(*) INTO g FROM items i JOIN neighborhoods nb ON nb.id = i.neighborhood_id JOIN metro_areas m ON m.id = nb.metro_id
   WHERE m.slug = 'amalfi-coast' AND i.is_active AND i.maps_lat IS NULL;
  IF g <> 0 THEN RAISE EXCEPTION '% active Amalfi items still lack coordinates', g; END IF;
END $$;

COMMIT;
`
const out = new URL('../supabase/migrations/20260929_amalfi_visit_profiles_and_geo.sql', import.meta.url)
fs.writeFileSync(out, sql)
console.log({ total, geoCount, excluded, byProfile: Object.fromEntries(Object.entries(byProfile).map(([k, v]) => [k, v.length])) })
