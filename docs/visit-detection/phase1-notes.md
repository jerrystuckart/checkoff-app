# Candidate visit detection — Phase 1 pilot notes

Status: review-ready, nothing applied to the database, nothing built into a shipped binary yet.

## Scope confirmation

Phase 1 validates **historical candidate-visit detection only**. A `candidate_visits`
row is written on geofence **EXIT**, because dwell is only known in hindsight
(arrival → departure). Phase 1 does **not** validate real-time dwell notification
timing, and contains no notification-sending code anywhere. A real-time
"What's the thing?" prompt needs a different mechanism — most likely a timer
armed on ENTER that re-checks presence once a profile's candidate threshold
elapses — layered on top of this in a later phase, evaluated against pilot
results first.

## Monitored-set refresh strategy

Refresh happens on hook mount and on every foreground transition (via
`AppState`), with a 5-minute cooldown to avoid thrashing on rapid
app-switcher use. This is deliberately not continuous GPS polling.

Expo does not expose iOS's significant-location-change service or Android's
passive/low-power location provider without a custom native module, so
foreground-triggered refresh is the lightest mechanism available today
without adding continuous polling or new native code. **Known limitation**:
if the user travels far enough to leave the monitored set while the app
stays backgrounded for a long stretch with no foreground event in between,
the monitored set won't update until the next foreground. Acceptable for
the pilot; revisit if it causes missed visits during testing.

## App-termination behavior (test explicitly — do not assume)

| State | iOS | Android |
|---|---|---|
| Foreground | Reliable | Reliable |
| Backgrounded (not terminated) | Reliable | Reliable, subject to OEM battery management |
| Terminated by the **OS** (e.g. memory pressure) | Region monitoring can relaunch the app in the background to deliver the event | Not guaranteed — varies by OS version/vendor |
| Terminated by the **user** (swiped away in app switcher) | **Will NOT relaunch** for geofence events until the user manually reopens the app — a visit that starts and ends while force-quit is silently missed | **Not guaranteed** — do not represent as reliable |

Test plan (§ below) explicitly includes all three states per test case, not
just foreground.

## iOS region cap: 19, not 20

iOS caps monitored regions at 20 per app. We register 19 intentionally — the
spare slot is headroom for the moment between stopping the old region set
and starting the new one during a refresh (not atomic), and against any
other future feature that might also monitor a region. This avoids ever
hitting the hard cap and silently failing to register the last region.

## Debug/audit instrumentation (pilot-only, short retention)

New tables (`20260828_visit_detection_phase1.sql`):
- `geofence_registration_log` — one row per refresh: approximate (rounded to
  ~111m) selection point, the monitored item set with distances, the
  excluded set with per-item reasons, whether `startGeofencingAsync`
  succeeded, and any error.
- `geofence_debug_events` — one row per enter/exit/discard/error, so you can
  tell "we saw the enter/exit but the dwell didn't clear the threshold"
  apart from "we never saw an enter at all."

Two views for tester/admin querying:
- `candidate_visit_debug_view` — item name, profile, entered/exited,
  dwell, confidence score + band, scoring factors, whether the item was in
  the last monitored set, status, timestamps.
- `current_monitored_geofences` — the latest monitored + excluded set per
  user, with item names and exclusion reasons.

Retention: `cleanup_visit_detection_debug_logs(retention_days default 14)`
deletes debug rows and terminal-state `candidate_visits` rows older than the
window. Not scheduled by the migration — wire to pg_cron once you're ready.
14 days is a pilot value meant to shrink once detection accuracy is
validated; the product's steady-state target is closer to the 24h grace
window. App-wide, not conditioned on metro.

## Feature flag semantics

`candidate_visit_silent_mode` is structural in Phase 1, not a runtime check —
there is no notification-sending code path anywhere in the detector, so
there's nothing to accidentally trigger even if the flag were flipped off.
`candidate_visit_detection` (master switch) is the only flag Phase 1 code
actually reads, and it's combined with `users.visit_detection_tester` inside
`isFlagEnabled()` so no non-tester ever runs the detector regardless of the
global flag value.

## Known limitations that could cause a false negative

1. **Force-quit app** — see termination table above; visits during a
   force-quit window are silently missed on both platforms, worse on iOS.
2. **Backgrounded too long without a foreground event** — monitored set goes
   stale (see refresh strategy above); a venue visited after the user moved
   far from the last refresh point may not be in the monitored set at all.
3. **iOS geofence radius minimum** — iOS enforces a practical minimum radius
   (~100m is the commonly cited safe floor); an item with `geo_radius_m`
   smaller than that may not fire reliably. Not adjusted in Phase 1 — check
   `geofence_registration_log.error_message` if a specific venue never logs
   an enter.
2. **19-region cap in dense areas** — in a strip mall or dense downtown with
   more than 19 eligible venues nearby, the furthest ones are excluded
   (`exceeds_region_cap` in the debug log) until the user gets closer.
4. **No visit_profile_key assigned** — an item with no profile is
   structurally never monitored (`no_visit_profile_assigned`); this is by
   design, not a bug, but it's the single most likely reason a "why didn't
   this fire" investigation turns up nothing.
5. **OS-level geofence dwell/debounce** — both iOS and Android apply their
   own internal debounce before firing enter/exit (typically tens of
   seconds); an extremely brief in-and-out near a boundary may not fire an
   event at all — this is OS behavior, not something Phase 1 controls.

## Is Phase 1 safe to migrate/build?

Yes, with the caveats above understood going in — this is genuinely a
best-effort pilot instrumentation layer, not a guarantee of catching every
visit. The debug tooling exists specifically so you can tell detector
failure apart from "never monitored" rather than treating every silent miss
as a mystery. Recommend running the migration and the prebuild/rebuild once,
then working through the test plan below before drawing conclusions about
detection accuracy.
