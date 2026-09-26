# Seven-day visit recovery — all-user iOS rollout runbook

State as of 2026-09-26: everything is deployed and inert. `candidate_visit_detection` is OFF globally; the only
account with the feature is the tester. **The global switch is the last step, after the Florence field test AND a
public App Store release that contains the runtime the OTAs target.**

## What a user gets when the switch is on (iOS only)
Profile → "Recover check-offs you forgot" → Turn on (explanation → consent row → Location "Always"). While on, the phone
reports entering/leaving CheckOff places; the SERVER times the stay and creates the suggestion. It shows in
"Places you may have visited" for 7 days; the user confirms once (normal points, from anywhere) or dismisses. Nothing
auto-checks-off. "Turn off and delete" removes consent, sessions, suggestions and diagnostics. Pushes stay tester-only.

## Order of operations
1. **Field test** on the tester phone (Florence gelato test). Evidence queries: bottom of `rollout_preflight.sql`.
2. **Ship 1.1.9 (build 154+) to the public App Store.** OTAs only reach builds with an identical native fingerprint.
   Public App Store is 1.1.8 (runtime `570ca4ad…`); the OTA runtime is 1.1.9's `81dbd1f1…`. Until 1.1.9 is public and
   adopted, flipping the switch reaches almost nobody. (Also: App Privacy labels — precise location, linked to user, app
   functionality; App Review notes for "Always" location + background location mode.)
3. `supabase db query -f docs/visit-recovery/rollout_preflight.sql --linked` — every row must PASS.
4. **Flip:** `UPDATE feature_flags SET enabled_globally = true WHERE key = 'candidate_visit_detection';`
   (users see it on next app launch; flags are cached per session).
5. Watch: opt-ins, sessions, candidates, discards by reason, RPC errors (queries below).

## Rollback (instant, non-destructive)
`UPDATE feature_flags SET enabled_globally = false WHERE key = 'candidate_visit_detection';` — phones stop listening on
next launch; users' saved choice is kept; existing suggestions stay confirmable until their 7 days end. To purge someone's
data they use "Turn off and delete"; retention removes the rest automatically.
Profile assignments are reversible separately: `UPDATE items SET visit_profile_key=NULL, visit_profile_source=NULL WHERE visit_profile_source='rule_v1';`

## Monitoring
```sql
SELECT count(*) FILTER (WHERE opted_in) opted_in FROM visit_recovery_settings;
SELECT outcome, count(*) FROM visit_presence_sessions WHERE created_at > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC;
SELECT status, count(*) FROM candidate_visits WHERE created_at > now() - interval '1 day' GROUP BY 1;
SELECT event_type, detail->>'reason' reason, count(*) FROM geofence_debug_events WHERE created_at > now() - interval '1 day' AND event_type LIKE 'presence%' GROUP BY 1,2 ORDER BY 3 DESC;
```

## Android
Off and not advertised. Needs a native build with `ACCESS_BACKGROUND_LOCATION` (already in app.json), a device test, then add
`'android'` to `VISIT_RECOVERY_PLATFORMS` (lib/visitDetection/recoveryPolicy.js) and complete Google Play's background-location
declaration + in-app disclosure.

## Security model (honest limits)
Clients cannot create or edit candidates or presence sessions; the server stamps time, validates fixes, scores, and caps
abuse (see migration 20260929 header). It cannot prove physical presence against GPS spoofing without device attestation
(App Attest / Play Integrity) — a future architecture change. The ordinary live check-off has no server distance check today.
