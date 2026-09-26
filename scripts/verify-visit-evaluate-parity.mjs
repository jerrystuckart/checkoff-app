// Compares the reference JS decision (lib/visitDetection/visitPipeline.js evaluateDeparture) with the
// SERVER decision (public.visit_evaluate) over a grid of inputs, using the LIVE profiles/weights/bands.
// Requires the Supabase CLI linked to the project. Usage: node scripts/verify-visit-evaluate-parity.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluateDeparture } from '../lib/visitDetection/visitPipeline.js'

function q(sql) {
  const f = path.join(os.tmpdir(), `parity-${process.pid}.sql`)
  fs.writeFileSync(f, sql)
  const out = execFileSync('supabase', ['db', 'query', '-f', f, '--linked'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 })
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows
}

const weights = Object.fromEntries(q('SELECT key, weight FROM visit_confidence_weights').map((r) => [r.key, r.weight]))
const b = q('SELECT ignore_below, medium_confidence_below, strong_candidate_below FROM visit_confidence_bands WHERE id=1')[0]
const profiles = Object.fromEntries(q('SELECT key, candidate_dwell_minutes, strong_dwell_minutes, manual_only FROM visit_detection_profiles WHERE is_active').map((r) => [r.key, r]))
const items = q(`SELECT DISTINCT ON (visit_profile_key) id, visit_profile_key FROM items WHERE visit_profile_key IS NOT NULL AND is_active ORDER BY visit_profile_key, id`)

const cases = []
for (const it of items) {
  const p = profiles[it.visit_profile_key]
  const dwells = p.manual_only ? [10] : [p.candidate_dwell_minutes - 0.1, p.candidate_dwell_minutes, p.strong_dwell_minutes - 0.1, p.strong_dwell_minutes, p.strong_dwell_minutes + 10, 480, 481]
  for (const d of dwells) for (const acc of [null, 5, 20, 20.1, 65, 65.1, 90]) for (const sp of [null, -1, 0.5, 1.49, 1.5, 12]) for (const c of [0, 2]) cases.push({ id: it.id, key: it.visit_profile_key, d, acc, sp, c })
}
const lit = (v) => (v === null ? 'NULL::float8' : `${v}::float8`)
const rows = q(`SELECT n, public.visit_evaluate(id::uuid, d::numeric, acc, sp, c) AS r FROM (VALUES ${cases.map((x, i) => `(${i}, '${x.id}', ${x.d}, ${lit(x.acc)}, ${lit(x.sp)}, ${x.c})`).join(',')}) v(n, id, d, acc, sp, c) ORDER BY n`)

let bad = 0
for (const row of rows) {
  const x = cases[row.n]
  const js = evaluateDeparture({
    userId: 'u', item: { id: x.id, visit_profile_key: x.key }, profile: profiles[x.key], arrivalMs: 0, departureMs: Math.round(x.d * 60000),
    exitFix: x.acc === null && x.sp === null ? null : { accuracy: x.acc, speed: x.sp }, competingCount: x.c, weights, bands: b,
  })
  const sv = row.r
  const same = js.outcome === sv.outcome && (js.outcome === 'candidate'
    ? js.score === sv.score && js.row.status === sv.status
    : (js.reason === sv.reason || (js.reason === 'below_ignore_band' && sv.reason === 'below_ignore_band')))
  if (!same) { bad++; if (bad <= 8) console.log('MISMATCH', JSON.stringify(x), 'js=', js.outcome, js.reason ?? js.score, js.row?.status, 'sql=', JSON.stringify(sv)) }
}
console.log(`cases=${cases.length} compared=${rows.length} mismatches=${bad}`)
process.exit(bad ? 1 : 0)
