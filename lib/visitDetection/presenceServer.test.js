// Guards the server-attested qualification design (supabase/migrations/20260929_visit_presence_sessions.sql):
// no client code can write candidate_visits, the client only reports presence, and the SQL rules cannot drift
// from the JS reference constants unnoticed. Behavioural coverage of the RPCs (forged rows, edits, ownership,
// expiry, duplicates, feasibility) lives in the rollback-only SQL suite described in the migration header and
// is re-run before every change to it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  VISIT_GEOFENCE_DEFAULT_RADIUS_M, VISIT_GEOFENCE_MAX_RADIUS_M, SAME_VENUE_TOLERANCE_M, COMPETING_VENUE_DISTANCE_M,
  ACCURACY_GOOD_M, ACCURACY_POOR_M, STOPPED_SPEED_MPS, MAX_PLAUSIBLE_DWELL_MIN, CANDIDATE_EXPIRY_MS,
} from './visitPipeline.js'

const root = new URL('../../', import.meta.url).pathname
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const sql = read('supabase/migrations/20260929_visit_presence_sessions.sql')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) walk(rel, out)
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(rel)
  }
  return out
}

test('NO client code writes candidate_visits (insert/update/delete/upsert) — only the server RPCs do', () => {
  const files = [...walk('lib'), ...walk('screens'), ...walk('components'), 'App.jsx']
  for (const f of files) {
    const src = read(f)
    for (const m of src.matchAll(/\.from\(\s*['"]candidate_visits['"]\s*\)([\s\S]{0,200})/g)) {
      assert.ok(!/\.(insert|update|delete|upsert)\s*\(/.test(m[1]), `${f} writes candidate_visits directly`)
    }
  }
})

test('the phone reports presence through the RPCs and dismisses through the RPC', () => {
  const t = read('lib/visitDetection/candidateVisitTracker.js')
  for (const rpc of ['visit_presence_enter', 'visit_presence_exit']) { assert.ok(t.includes(`rpc('${rpc}'`)); assert.ok(sql.includes(`FUNCTION public.${rpc}(`)) }
  assert.ok(read('screens/VisitInboxScreen.jsx').includes("rpc('dismiss_candidate_visit'") && sql.includes('FUNCTION public.dismiss_candidate_visit('))
  assert.ok(!/p_arrival|p_dwell|p_score|p_expires/.test(t), 'the phone must not send timing, dwell, score or expiry')
})

test('migration closes the direct-write path and keeps sessions server-written', () => {
  assert.ok(sql.includes('DROP POLICY IF EXISTS candidate_visits_insert_own'))
  assert.ok(sql.includes('DROP POLICY IF EXISTS candidate_visits_update_own'))
  assert.ok(sql.includes('REVOKE INSERT, UPDATE, DELETE ON public.candidate_visits FROM anon, authenticated'))
  assert.ok(sql.includes('REVOKE ALL ON public.visit_presence_sessions FROM anon, authenticated'))
  assert.ok(sql.includes('GRANT SELECT ON public.visit_presence_sessions TO authenticated'))
  assert.ok(!/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*visit_presence_sessions/.test(sql))
  assert.ok(sql.includes('visit_evaluate(uuid, numeric, double precision, double precision, integer) FROM PUBLIC, anon, authenticated'), 'the scorer is not callable by clients')
})

test('server timing: entered_at is server-stamped, and a claimed departure can only shorten the stay', () => {
  assert.ok(/entered_at\s+timestamptz NOT NULL DEFAULT now\(\)/.test(sql))
  assert.ok(!/p_entered|p_arrival/.test(sql), 'no client-supplied arrival parameter exists')
  assert.ok(sql.includes('v_departed := LEAST(now(), GREATEST(s.entered_at, COALESCE(p_client_departed_at, now())))'))
})

test('SQL constants match the JS reference implementation (drift guard)', () => {
  assert.ok(sql.includes(`NULLIF(p_geo_radius, 0), ${VISIT_GEOFENCE_DEFAULT_RADIUS_M}), ${VISIT_GEOFENCE_MAX_RADIUS_M}`))
  assert.ok(sql.includes(`>= ${SAME_VENUE_TOLERANCE_M}`) && sql.includes(`< ${COMPETING_VENUE_DISTANCE_M}`))
  assert.ok(sql.includes(`p_accuracy <= ${ACCURACY_GOOD_M}`) && sql.includes(`p_accuracy > ${ACCURACY_POOR_M}`))
  assert.ok(sql.includes(`p_speed < ${STOPPED_SPEED_MPS}`))
  assert.ok(sql.includes(`p_dwell_min > ${MAX_PLAUSIBLE_DWELL_MIN}`))
  assert.equal(CANDIDATE_EXPIRY_MS, 7 * 24 * 3600 * 1000)
  assert.ok(sql.includes("v_departed + interval '7 days'"))
})

test('abuse limits are present: opt-in, open-session cap, daily caps, geographic compatibility, travel speed, one pending candidate per item', () => {
  for (const needle of ["'not_opted_in'", 'v_open >= 8', 'v_today >= 60', "'incompatible_open_session'", 'v_speed > 70', "'travel_infeasible'", "'duplicate_pending'", 'v_today >= 30']) {
    assert.ok(sql.includes(needle), needle)
  }
})
