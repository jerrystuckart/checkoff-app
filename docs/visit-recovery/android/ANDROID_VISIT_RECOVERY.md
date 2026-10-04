# Android visit recovery (feature/android-visit-recovery)

Android versionCode 19+ (version 1.1.10). Opt in, private suggestions, nothing checked off without the user's confirmation.

## 1. iOS pipeline audited and reused (nothing parallel was created)
| Piece | Where | Android |
|---|---|---|
| Preference | `visit_recovery_settings` (opt in), `enableVisitRecovery` / `turnOffVisitRecovery` (`recoverySettings.js`) | same rows and RPC |
| Remote flags | `candidate_visit_detection` master (global ON), `candidate_visit_sentinel_refresh` | same, plus `android_visit_recovery` audience (below) |
| Permission resolver | `recoveryState.js` + `permissions.js` (this branch added Android states) | extended |
| Selection | `coveragePlanner.planCoverage`: nearest eligible venues within 30 km, `classifyVisitEligibility` (coordinates, active, not universal, visit profile, not manual_only), radius `visitGeofenceRadiusM`, open sessions preserved, coverage sentinel | same code; budget differs |
| Region budget | iOS 19 (18 + sentinel) in `regionBudget.js` | Android 40 (39 + sentinel), limit is 100 |
| Movement refresh | iOS native significant-location-change module (`modules/checkoff-movement`, Apple only) | not present; refresh = foreground, sentinel exit, drift on any geofence callback |
| Enter / exit | task `checkoff-candidate-visit-geofence` (`TaskManager.defineTask`, module scope), `eventRouter.js`, `presenceClient.js` | same task, same router |
| Dwell | server decides: `visit_presence_enter` stamps entered_at, `visit_presence_exit` scores by profile (category) thresholds; honor system rule (zone + dwell, no proof of activity) | same RPCs, same thresholds |
| Candidate | server creates `candidate_visits` (never the client), 7 day window | same |
| Offline | `visitPresencePending` queue, bounded retry 90 min, no timers, flushed at next real wake | same |
| Auth | calls run as the signed in user; RLS isolates users | same + this branch: sign-out stop, account owner key |
| Duplicates | local open map, server already_open, one candidate per item/visit, existing check-in excluded (`actionableCandidates.js`) | same |
| Confirm / points | `VisitInboxScreen` + `prevent_expired_list_checkins` (`historical_visit_confirmed`): ownership, item match, status, 7 day expiry, duplicate guards; points server side | same |
| Turn off | RPC `turn_off_visit_recovery` deletes candidates, registration log, debug events; tracker stops geofencing and clears local keys | same |
| Server | no platform condition anywhere in the visit migrations: no database change was needed | none |

## 2. Android mechanism
expo-location `startGeofencingAsync` -> Google Play services `GeofencingClient` with a PendingIntent into expo-task-manager's job service. No foreground
service, no continuous GPS, no route. Verified in the library source: `GeofencingTaskConsumer` has no foreground service;
`expo-task-manager` registers `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED` receivers so geofences are restored after reboot / app update.
Known Android behavior (not reproducible in tests): delivery latency of about 2 to 10 minutes, extra delay under Doze and OEM battery limits,
geofences removed when the user force-stops the app until it is next opened, ENTER on registration for venues the phone is already inside
(handled by the same state-determination rules as iOS).

Native change: `app.json` expo-location plugin `isAndroidBackgroundLocationEnabled: true` (adds ACCESS_BACKGROUND_LOCATION),
`isAndroidForegroundServiceEnabled: false` (no FOREGROUND_SERVICE*). A foreground service was not needed.

## 3. Selection and refresh rules
Maximum 40 regions: the 39 nearest eligible venues plus one sentinel circle. Universal, inactive, no-coordinate, no-profile and manual_only items are never registered.
Refresh on app start and every foreground (5 minute cooldown), on sentinel exit (material travel, rate gated), and as a drift check on any geofence callback.
An unchanged set (same signature, no drift) is not re-registered. Venues with an open presence session stay registered. A metro switch or a different
city simply produces a different nearest set from the phone's position; outside any covered area the plan is empty and monitoring stops.

## 4. Gating
`supportsVisitRecovery(platform, runtime)`: Android only when the runtime is in `ANDROID_RECOVERY_RUNTIMES` (the native fingerprint of builds that carry the permission).
Existing public Android builds (runtime 56c5f2cd..., 570ca4ad..., etc.) stay hidden whatever JavaScript they receive.
Audience: master flag AND (`android_visit_recovery` flag OR visit_detection_tester OR admin). To open to everyone later:
`UPDATE feature_flags SET enabled_globally = true WHERE key = 'android_visit_recovery'` (insert the row if absent). No native build, no code change.

## 5. Data
On the phone (AsyncStorage, removed by turn off, sign-out and account switch): open sessions (item id and time), a queue of unsent reports (dropped after 90 minutes),
the registration time and last error, coverage sentinel center and radius, a catalog cache of items around the phone (catalog data, not user data), refresh timestamps.
On the server (RLS, owner only): presence sessions with the reported fix (lat, lng, accuracy) at enter and exit only, candidate visits, registration log (position rounded to about 111 m), debug events.
Retention: unconfirmed candidates removed 1 day after their 7 day window, confirmed candidates (a link to the check-in) after 30 days, diagnostics after 14 days.
Never stored: a route, a track, continuous positions. Never used for advertising, never sold or shared.

## 6. Differences from iOS (same user promise)
No movement-hint native module (Android relies on foreground refresh and the sentinel). Exit delivery can be later and coarser. Android 11+ background permission is granted on a system Settings page ("Allow all the time"), not an in-app dialog. Approximate-only location is not enough for geofencing (precise is required). Android shows "registering" / "registration error" states and says On only once monitoring is registered; iOS keeps its original definition.

## 7. Diagnostics (tester / admin only, Profile debug panel)
API level, runtime, OTA, foreground / background permission, precision, services, preference, flag, task registered, last registration time and error, open sessions, pending events, last background event, last candidate submitted. Counts and timestamps only.

## 8. Tests
`lib/androidVisitRecovery.test.js` (capability, audience, permission matrix, disclosure, budget, native config), `lib/visitDetection/androidTracker.harness.test.js` (real tracker, Android platform: registration cap and exclusions, duplicate/late events, process recreation, offline queue, sign-out, account switch, registration error), `lib/androidParity.test.js`, plus the full iOS visit suite (dwell, candidates, confirmation, points, duplicates, expiry, other user isolation) which runs the shared logic.
Not provable without a phone: real geofence delivery, Doze, OEM behavior, the system Settings flow.

## 9. Field test (Internal Testing phone, tester account)
1. Install the Internal Testing build (versionCode 19). Profile shows the debug panel (tester) and "Recover checkoffs you forgot" (off).
2. Tap Turn on. Read the disclosure. Continue. Allow Location while using the app (precise). On the next explanation tap OK, then on the system page choose Allow all the time. Return to CheckOff: the card refreshes and shows On.
3. Debug panel: background = Allow all the time, task registered = yes, monitored count > 0, no registration error.
4. Choose a monitored venue (debug panel list). Walk there, stay for its dwell threshold (coffee about 10 to 15 minutes, a meal longer), walk away, wait up to 10 minutes. Open the app: a suggestion appears; nothing was checked off. Confirm it: normal points.
5. Short stop (2 minutes) at another venue: no suggestion.
6. Deny test: revoke Location in Settings: card says Turn on Location; set While using: card says Turn on Allow all the time; turn Location Services off: services off message.
7. Turn off and delete visits: suggestions disappear, task registered = no. Sign out and in as another account: no candidates from the first.
8. Reboot the phone, open nothing for 10 minutes, then check the debug panel: task registered (restored).
