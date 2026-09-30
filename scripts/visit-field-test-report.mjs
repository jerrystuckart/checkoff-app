// Reads what actually happened on a field-test day and states, stage by stage, what is PROVEN by recorded evidence and
// what is not. Read-only. Requires the Supabase CLI linked to the project.
// Usage: node scripts/visit-field-test-report.mjs [YYYY-MM-DD, Europe/Rome day] [userId]
//   defaults: today (Europe/Rome), the visit_detection_tester account.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function q(sql) {
  const f = path.join(os.tmpdir(), `field-report-${process.pid}.sql`)
  fs.writeFileSync(f, sql)
  const out = execFileSync('supabase', ['db', 'query', '-f', f, '--linked'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 })
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows
}
const TZ = 'Europe/Rome'
const day = process.argv[2] ?? new Date().toLocaleDateString('sv-SE', { timeZone: TZ })
const userId = process.argv[3] ?? q('SELECT id FROM users WHERE visit_detection_tester LIMIT 1')[0]?.id
if (!userId) throw new Error('no tester user')
const w = `>= ('${day} 00:00'::timestamp AT TIME ZONE '${TZ}') AND {c} < (('${day} 00:00'::timestamp + interval '1 day') AT TIME ZONE '${TZ}')`
const within = (c) => w.replace('{c}', c)
const rome = (c) => `to_char(${c} AT TIME ZONE '${TZ}', 'HH24:MI:SS')`

const reg = q(`SELECT ${rome('refreshed_at')} t, extract(epoch from refreshed_at) ep, refresh_cause cause, registration_state st, geofencing_started gs, jsonb_array_length(monitored_items) monitored,
  coverage->>'sentinelRadiusM' sentinel_m, coverage->>'nextUnmonitoredM' next_m, coverage->>'tight' tight, coverage->>'cacheSource' cache, coverage->>'reason' reason,
  round(selection_lat::numeric,3) lat, round(selection_lng::numeric,3) lng, left(client_build, 8) build, error_message
  FROM geofence_registration_log WHERE user_id='${userId}' AND refreshed_at ${within('refreshed_at')} ORDER BY refreshed_at`)
const ev = q(`SELECT ${rome('occurred_at')} t, event_type, left(item_id::text, 8) item, detail FROM geofence_debug_events WHERE user_id='${userId}' AND occurred_at ${within('occurred_at')} ORDER BY occurred_at`)
const sess = q(`SELECT ${rome('s.entered_at')} entered, ${rome('s.closed_at')} closed, left(i.body, 44) venue, i.visit_profile_key profile, p.candidate_dwell_minutes need_min, s.status, s.outcome,
  round(extract(epoch from (coalesce(s.closed_at, now()) - s.entered_at))/60, 1) minutes
  FROM visit_presence_sessions s JOIN items i ON i.id = s.item_id LEFT JOIN visit_detection_profiles p ON p.key = i.visit_profile_key
  WHERE s.user_id='${userId}' AND s.entered_at ${within('s.entered_at')} ORDER BY s.entered_at`)
const cand = q(`SELECT ${rome('c.arrival_at')} arrival, ${rome('c.departure_at')} departure, left(i.body, 44) venue, c.dwell_minutes, c.confidence_score score, c.status, c.detection_method,
  c.metadata->>'competingVenueCount' competing, c.confirmed_at IS NOT NULL confirmed, c.converted_checkoff_id IS NOT NULL converted
  FROM candidate_visits c JOIN items i ON i.id = c.item_id WHERE c.user_id='${userId}' AND c.arrival_at ${within('c.arrival_at')} ORDER BY c.arrival_at`)
const chk = q(`SELECT ${rome('k.checked_at')} t, left(i.body, 44) venue, k.verification_method, k.points_awarded, k.list_item_id IS NOT NULL on_list, k.matched_candidate_visit_id IS NOT NULL matched
  FROM check_ins k JOIN items i ON i.id = k.item_id WHERE k.user_id='${userId}' AND k.checked_at ${within('k.checked_at')} ORDER BY k.checked_at`)

// Label how each refresh started. A sentinel_* refresh is 'BACKGROUND' unless the app was opened (app_start / foreground /
// manual / opt_in_change) in the 3 minutes before it - then it is 'app-open nearby' and is not counted as background proof.
const OPEN_CAUSES = new Set(['app_start', 'foreground', 'manual', 'opt_in_change'])
for (const r of reg) {
  if (String(r.cause ?? '').startsWith('sentinel')) {
    const opened = reg.some((o) => OPEN_CAUSES.has(o.cause) && Number(r.ep) - Number(o.ep) >= 0 && Number(r.ep) - Number(o.ep) < 180)
    r.how = opened ? 'app-open nearby' : 'BACKGROUND'
  } else r.how = OPEN_CAUSES.has(r.cause) ? 'app opened' : '(classic/legacy)'
}
const t = (title, rows) => { console.log(`\n== ${title} (${rows.length})`); if (rows.length) console.table(rows) }
console.log(`Field-test report for ${day} (${TZ}), user ${userId}`)
t('Coverage/registration refreshes', reg.map(({ ep, ...r }) => ({ t: r.t, how: r.how, ...r })))
t('Geofence + presence debug events', ev.map((e) => ({ ...e, detail: JSON.stringify(e.detail) })))
t('Presence sessions (enter -> exit)', sess)
t('Candidate visits', cand)
t('Check-ins that day', chk)

const okReg = reg.filter((r) => r.st === 'ok_monitored' && r.gs)
const sentinelRefreshes = reg.filter((r) => r.cause === 'sentinel_exit' && r.st === 'ok_monitored' && r.how === 'BACKGROUND')
const sentinelEvents = ev.filter((e) => e.event_type === 'sentinel_exit')
const qualifying = sess.filter((s) => s.status === 'closed' && s.need_min != null && Number(s.minutes) >= Number(s.need_min))
const candidates = cand.filter((c) => c.detection_method === 'geofence_dwell')
const confirmedFromVisit = chk.filter((k) => k.verification_method === 'historical_visit_confirmed')

const verdict = (ok, yes, no) => (ok ? `PROVEN   ${yes}` : `NOT PROVEN ${no}`)
console.log('\n== Stage verdicts (from recorded evidence only)')
console.log('1 Catalog readiness      ', 'see docs/visit-recovery/catalog_readiness_2026-09-29.md (data check, not a device test)')
console.log('2 Device registration    ', verdict(okReg.length > 0, `${okReg.length} refresh(es) ok_monitored; latest monitored=${okReg.at(-1)?.monitored}`, 'no ok_monitored refresh recorded'))
console.log('3 Background refresh     ', verdict(sentinelRefreshes.length > 0 && sentinelEvents.length > 0,
  `${sentinelEvents.length} sentinel exit event(s) -> ${sentinelRefreshes.length} BACKGROUND re-registration(s) (no app open within 3 min before)`,
  'no sentinel exit -> re-registration pair recorded'))
console.log('4 Real dwell -> candidate', verdict(qualifying.length > 0 && candidates.length > 0,
  `${qualifying.length} closed session(s) at/above the profile threshold; ${candidates.length} geofence_dwell candidate(s)`,
  `qualifying closed sessions=${qualifying.length}, candidates=${candidates.length}`))
console.log('5 Confirm/points/fan-out ', verdict(confirmedFromVisit.length > 0,
  `${confirmedFromVisit.length} check-in row(s) with verification_method historical_visit_confirmed; points on row(s): ${confirmedFromVisit.map((k) => k.points_awarded).join(',')}; list fan-out rows: ${chk.filter((k) => k.on_list).length}`,
  'no check-in created from a visit suggestion that day'))
