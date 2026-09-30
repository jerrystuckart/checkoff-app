// Health monitor for the coverage-sentinel rollout (all users). Read-only. Requires the Supabase CLI linked to the project.
// Usage: node scripts/visit-sentinel-monitor.mjs [hours=24]
// Exit code 1 when any ALERT is raised, so it can be scheduled.
//
// Rollback switch (takes effect on the next sentinel wake or app open; an unreadable flag does NOT roll back):
//   supabase db query --linked "UPDATE feature_flags SET enabled_globally=false, updated_at=now() WHERE key='candidate_visit_sentinel_refresh'"
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function q(sql) {
  const f = path.join(os.tmpdir(), `sentinel-monitor-${process.pid}.sql`)
  fs.writeFileSync(f, sql)
  const out = execFileSync('supabase', ['db', 'query', '-f', f, '--linked'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 })
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows
}
const H = Number(process.argv[2] ?? 24)
const since = `now() - interval '${H} hours'`
const alerts = []
const section = (t, rows) => { console.log(`\n== ${t}`); rows.length ? console.table(rows) : console.log('(none)') }

console.log(`Sentinel rollout monitor, last ${H} h (now ${new Date().toISOString()})`)
console.log('flag:', JSON.stringify(q(`SELECT enabled_globally, (SELECT count(*) FROM feature_flag_overrides WHERE flag_key='candidate_visit_sentinel_refresh') overrides FROM feature_flags WHERE key='candidate_visit_sentinel_refresh'`)[0]))

const reach = q(`SELECT (SELECT count(*) FROM visit_recovery_settings WHERE opted_in) opted_in_users,
  (SELECT count(DISTINCT user_id) FROM geofence_registration_log WHERE refreshed_at > ${since}) users_registering,
  (SELECT count(DISTINCT user_id) FROM geofence_registration_log WHERE refreshed_at > ${since} AND refresh_cause IS NOT NULL) users_on_sentinel_build`)[0]
console.log('reach:', JSON.stringify(reach))

const byCause = q(`SELECT coalesce(refresh_cause,'(classic)') cause, registration_state state, count(*) n, count(DISTINCT user_id) users FROM geofence_registration_log WHERE refreshed_at > ${since} GROUP BY 1,2 ORDER BY 1,2`)
section('Refreshes by cause and outcome', byCause)

const failures = q(`SELECT coalesce(refresh_cause,'(classic)') cause, registration_state state, coalesce(error_message, coverage->>'reason') detail, count(*) n, count(DISTINCT user_id) users
  FROM geofence_registration_log WHERE refreshed_at > ${since} AND (registration_state IN ('os_registration_error','query_error','kept_previous_set') OR error_message IS NOT NULL)
  GROUP BY 1,2,3 ORDER BY n DESC`)
section('Failures and deliberate "kept previous set" reasons', failures)
const osErr = failures.filter((f) => ['os_registration_error', 'query_error'].includes(f.state)).reduce((a, f) => a + Number(f.n), 0)
if (osErr > 0) alerts.push(`${osErr} refresh attempt(s) ended in os_registration_error/query_error`)
const exceptions = failures.filter((f) => String(f.detail).startsWith('exception')).reduce((a, f) => a + Number(f.n), 0)
if (exceptions > 0) alerts.push(`${exceptions} refresh(es) threw an exception (see detail above)`)

const repeated = q(`WITH r AS (SELECT user_id, refreshed_at, refresh_cause, lag(refreshed_at) OVER (PARTITION BY user_id ORDER BY refreshed_at) prev
    FROM geofence_registration_log WHERE refreshed_at > ${since} AND registration_state = 'ok_monitored' AND refresh_cause IS NOT NULL)
  SELECT left(user_id::text, 8) usr, count(*) FILTER (WHERE refresh_cause LIKE 'sentinel%') sentinel_refreshes,
    max(c) FILTER (WHERE true) max_per_hour, count(*) FILTER (WHERE prev IS NOT NULL AND refreshed_at - prev < interval '90 seconds') under_90s_apart
  FROM r JOIN LATERAL (SELECT count(*) c FROM r r2 WHERE r2.user_id = r.user_id AND r2.refreshed_at BETWEEN r.refreshed_at - interval '1 hour' AND r.refreshed_at AND r2.refresh_cause LIKE 'sentinel%') x ON true
  GROUP BY user_id ORDER BY sentinel_refreshes DESC LIMIT 10`)
section('Repeated refreshes per user (sentinel-driven count, worst hour, pairs closer than 90 s)', repeated)
for (const r of repeated) {
  if (Number(r.max_per_hour) > 20) alerts.push(`user ${r.usr}: ${r.max_per_hour} sentinel refreshes in one hour (ceiling is 40, expected far fewer)`)
  if (Number(r.under_90s_apart) > 3) alerts.push(`user ${r.usr}: ${r.under_90s_apart} refreshes less than 90 s apart (flapping?)`)
}

section('Sentinel debug events', q(`SELECT event_type, detail->>'reason' reason, count(*) n, count(DISTINCT user_id) users FROM geofence_debug_events WHERE event_type LIKE 'sentinel%' AND occurred_at > ${since} GROUP BY 1,2 ORDER BY 3 DESC`))
const born = q(`SELECT count(*) n FROM geofence_debug_events WHERE event_type='sentinel_born_outside' AND occurred_at > ${since}`)[0].n
if (Number(born) > 10) alerts.push(`${born} sentinel_born_outside events (the first fix after registration keeps disagreeing with the OS)`)

const lost = q(`SELECT coalesce(outcome, status) outcome, count(*) n, count(DISTINCT user_id) users FROM visit_presence_sessions WHERE created_at > ${since} GROUP BY 1 ORDER BY 2 DESC`)
section('Presence sessions by outcome', lost)
const missedExit = lost.filter((l) => ['missed_exit', 'stale_open'].includes(l.outcome)).reduce((a, l) => a + Number(l.n), 0)
const total = lost.reduce((a, l) => a + Number(l.n), 0)
if (total >= 5 && missedExit / total > 0.25) alerts.push(`${missedExit}/${total} presence sessions ended as missed_exit/stale_open (lost sessions)`)
const straddling = q(`SELECT coalesce(s.outcome, s.status) outcome, count(*) n FROM visit_presence_sessions s
  WHERE s.created_at > ${since} AND EXISTS (SELECT 1 FROM geofence_registration_log g WHERE g.user_id = s.user_id AND g.refresh_cause LIKE 'sentinel%' AND g.registration_state = 'ok_monitored' AND g.refreshed_at BETWEEN s.entered_at AND coalesce(s.closed_at, now()))
  GROUP BY 1 ORDER BY 2 DESC`)
section('Sessions that were open while a sentinel re-registration happened (should still close normally, not as missed_exit)', straddling)
const stillOpen = q(`SELECT count(*) n FROM visit_presence_sessions WHERE status='open' AND entered_at < now() - interval '8 hours'`)[0].n
if (Number(stillOpen) > 0) alerts.push(`${stillOpen} presence session(s) open for more than 8 hours`)

const detection = q(`SELECT (SELECT count(*) FROM visit_presence_sessions s JOIN items i ON i.id = s.item_id JOIN visit_detection_profiles p ON p.key = i.visit_profile_key
    WHERE s.created_at > ${since} AND s.status = 'closed' AND s.closed_at - s.entered_at >= make_interval(mins => p.candidate_dwell_minutes)) qualifying_closed_sessions,
  (SELECT count(*) FROM candidate_visits WHERE created_at > ${since} AND detection_method = 'geofence_dwell') candidates_created,
  (SELECT count(*) FROM candidate_visits WHERE created_at > ${since} AND confirmed_at IS NOT NULL) candidates_confirmed`)[0]
section('Detection (qualifying stays vs candidates)', [detection])
const gap = q(`SELECT ${'to_char(s.entered_at AT TIME ZONE \'Europe/Rome\', \'MM-DD HH24:MI\')'} entered_rome, left(i.body, 40) venue, s.outcome, round(extract(epoch from (s.closed_at - s.entered_at))/60, 1) minutes, p.candidate_dwell_minutes need
  FROM visit_presence_sessions s JOIN items i ON i.id = s.item_id JOIN visit_detection_profiles p ON p.key = i.visit_profile_key
  WHERE s.created_at > ${since} AND s.status = 'closed' AND s.closed_at - s.entered_at >= make_interval(mins => p.candidate_dwell_minutes) AND s.candidate_visit_id IS NULL ORDER BY s.entered_at`)
section('Qualifying closed sessions WITHOUT a candidate (reason is in outcome: below_ignore_band, duplicate_pending, daily_candidate_cap ... )', gap)

console.log('\n== Result')
if (alerts.length) { alerts.forEach((a) => console.log('ALERT', a)); process.exit(1) }
console.log('no alerts')
