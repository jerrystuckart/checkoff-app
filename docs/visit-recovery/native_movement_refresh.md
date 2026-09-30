# Native movement refresh (significant-location-change): design, build and travel test

Status: **implemented on branch `native/movement-refresh`, not merged, not published, not submitted.** It needs a new iOS binary (and therefore a new runtime). Nothing that requires it was or will be published to the existing 1.1.9 runtime `81dbd1f1…`. The compatible 1.1.9 OTA line stays on branch `release/ios-1.1.9-runtime-81dbd1f1`.

## Why: what the real trip showed
Sentinel re-registrations on 2026-09-30 (distance from the previous centre; the circle is 1.5 km): on time at 1.64, 1.72, 1.61 km; late at 2.56, 3.68, 2.86 km; and **no background exit at all** on the outbound bus ride (5.6 km, found only when the app was opened). Region exits depend on the OS noticing a boundary crossing, and it did not for a moving phone. Coverage therefore lagged kilometres behind the phone and Amalfi's venues were not watched on arrival.

## Apple's two candidate services (official documentation)
* **Significant-location-change** (`CLLocationManager.startMonitoringSignificantLocationChanges()`, developer.apple.com/documentation/corelocation/cllocationmanager/startmonitoringsignificantlocationchanges()): events only after the device moves **≥ 500 m** from the previous notification, **not more than once every five minutes**; designed to be battery-efficient; if the app is terminated the system **relaunches it into the background** when a new location arrives (launch options carry `.location`); the app **must recreate its location manager and call the method again**, and the triggering location is then delivered immediately.
* **Visits** (`startMonitoringVisits()`, `CLVisit`): events when the user arrives at or leaves a *place where they stay*; arrival/departure dates are approximate and either may be absent; the system relaunches a terminated app; reduced accuracy without precise authorization.

| | Significant-location-change | Visits |
|---|---|---|
| Fires while travelling (the failure we saw) | **Yes**, every ≥ 500 m / ≥ 5 min | No: only at places where the user stays |
| Relaunches a terminated app | Yes | Yes |
| Gives a dwell or exit time | No (a position hint) | Yes (approximate arrival/departure) |
| Battery | Low (cell-tower based) | Low |
| Fits "refresh coverage without opening the app" | **Best fit** | Partial: it reports arrival only after the stay has started and cannot help mid-journey |

**Chosen: significant-location-change**, as a refresh trigger only. Visits would be a separate, later decision: it could also help recover the departure time of missed exits, but the brief here is explicit that movement callbacks must not establish dwell, so using its dates as presence evidence needs its own design and consent review. Neither service changes the fact that a user **force-quitting** the app from the switcher stops the OS relaunching it until it is opened again; nothing in our code can override that.

## Design
* **Native (`modules/checkoff-movement`, Swift, Expo module):** `MovementMonitor` owns one `CLLocationManager`, starts SLC only with **Always** authorization, restarts it on every launch (app-delegate subscriber for `.location` launches, and on module creation), queues each location as a *hint* in `UserDefaults` (bounded to 20) and pings JS. JS calls `consumePendingAsync`, so a hint that arrives before JS is listening is not lost and is never handled twice. It exposes only: `isAvailableAsync`, `isEnabledAsync`, `startAsync` (`started | unavailable | no_always_permission`), `stopAsync`, `consumePendingAsync`, event `onMovement`. No dwell, visit, check-off or points code exists in the module.
* **JS (`lib/visitDetection/movementRefresh.js`, `movementNative.js`, tracker):** `requireOptionalNativeModule('CheckoffMovement')` is `null` on every existing binary, so the JS can be present and inert. A movement wake takes a fresh fix (≤ 2 min old; a coarse/old hint is only a wake-up, never a position) and asks for a coverage refresh **only if** there is no coverage, coverage is flagged stale, or the phone is ≥ max(200 m, half the sentinel radius) from the sentinel centre.
* **Same refresh engine as the sentinel:** one single-flight coordinator, one rate gate (60 s between refreshes, 40/hour), one "unchanged set → skip" rule. A sentinel exit and a movement hint arriving together produce **one** registration (tested). A redundant movement hint that collides with a refresh we just did is not recorded as a failure and queues no retry.
* **In-progress sessions are preserved** exactly as for the sentinel (open venues stay registered, the open map is never touched). Queued rejected enters are flushed after a refresh (a real wake-up, no timer).
* **Offline:** the refresh uses the device catalog cache when it covers the position, otherwise leaves the registered set alone and queues its diagnostics (`kept_previous_set`).
* **Permissions / opt-out / rollback:** started only when the flag is on, the user is opted in and Always is granted; any change stops it. Opt-out clears the local marker and stops the native service (late hints are ignored). The flag `candidate_visit_movement_refresh` is independent of `candidate_visit_sentinel_refresh`; it is **off globally** and on for the single tester's account only. Turning it off (`UPDATE feature_flags SET enabled_globally=false …`, and deleting the override) stops the service at the next movement wake or app open; an unreadable flag does not stop it.
* **Coverage engine choice:** if the sentinel flag is on, a movement refresh uses the coverage planner (18 venues + sentinel); if it is off, the classic 19-venue re-registration.
* **Diagnostics:** `geofence_registration_log.refresh_cause = 'movement_update'` with `coverage.movement` = `{ hints, source (fix|hint), driftM, hintAgeS, hintAccuracyM, appState }`; debug events `movement_update` / `movement_ignored` (with reason). `scripts/visit-field-test-report.mjs` labels these background refreshes like sentinel ones; `scripts/visit-sentinel-monitor.mjs` counts them.

## What has been verified
* **Compile:** `expo prebuild --platform ios` autolinks the module (`ExpoModulesProvider.swift` lists `CheckoffMovementModule` and `CheckoffMovementAppDelegate`); `pod install` succeeds; the `CheckoffMovement` pod target builds for the iOS simulator with Xcode 26.4 (see the build result recorded in the branch's final commit message).
* **Logic:** `movementRefresh.test.js` (decision rules, wrapper reports `not_installed` on a binary without the module, movement code references no presence/candidate/check-in/points function) and 10 harness tests against the real tracker with a fake native module: out-of-coverage hint refreshes, in-coverage hint ignored, sentinel+movement dedupe to one registration, opt-out ignores late wake-ups, remote rollback vs unreadable flag, offline cache / no cache, in-progress sessions preserved, stale/coarse hint never a position, classic fallback, start/stop follows flag + permission.
* **Not testable off-device:** that iOS actually relaunches a terminated app for this device and route, real delivery latency, battery over a day. That is the travel test below.

## Next iOS build procedure
Prerequisites (decisions for you): the current live App Store version is 1.1.9, so the new build needs a **new version number** (proposal: `1.1.10`) and your uncommitted `app.json` bump is not in git; commit the version change first.

```bash
cd /Users/jerrystuckart/Downloads/checkoff
git fetch . native/movement-refresh            # review the branch first:  git log main..native/movement-refresh
git checkout -b release/ios-1.1.10-movement native/movement-refresh     # or merge into main when you are happy
# edit app.json: "version": "1.1.10", ios.buildNumber as EAS requires (the profile auto-increments)
git add app.json && git commit -m "1.1.10: movement refresh build"
npx expo-updates fingerprint:generate --platform ios     # record this: it is the NEW runtime (must differ from 81dbd1f1…)
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
npx eas-cli build --platform ios --profile production    # add --local to build on this Mac (as previous builds did)
# verify the binary before submitting: the embedded fingerprint must equal the value recorded above
unzip -p <build>.ipa 'Payload/*.app/EXUpdates.bundle/fingerprint'
npx eas-cli submit --platform ios --profile production   # TestFlight, only when you decide
```
OTA afterwards (for the NEW runtime only): publish from the 1.1.10 branch with `eas update --branch production --platform ios --environment production`, after the same fingerprint / ancestry / regression checks. The 1.1.9 OTA line continues from `release/ios-1.1.9-runtime-81dbd1f1` unchanged.

## Travel test plan (new TestFlight build, flag already on for your account)
1. Install the build, open CheckOff, Profile → debug panel: confirm the running bundle, Always location, and that **Movement: started** appears (panel line reads `movement` state from the last log).
2. Before leaving, open the app once at the start point and press Home. **Do not swipe the app away.**
3. Take a bus or car ≥ 10 km without opening the app. Every ≥ 500 m / ≥ 5 min the OS should wake the app.
4. Stop at a venue you have not been near (at least the venue's dwell) and leave; then open the app after ~10 min.
5. Report to me the times only; I read `node scripts/visit-field-test-report.mjs <date>`:
   * `movement_update` debug events and `refresh_cause = movement_update` rows with no app-open row in the 3 minutes before = **background movement refreshes proven**.
   * Gaps: compare movement refresh times and distances with the sentinel's (`docs/visit-recovery/presence_evidence_2026-09-30.md` table). Success = the newly watched set is in place before arrival on the outbound leg.
   * Battery: note the % at start/end and whether the "Location" usage in Settings → Battery looks normal.
6. Force-quit check (optional, separate day): swipe the app away, travel 2 km, and confirm that **nothing** refreshes until you open it (this is iOS behaviour, recorded so nobody expects otherwise).

## Limits stated plainly
Force-quit apps are not relaunched. SLC is coarse (cell-tower based), can lag, and is capped at about one event per 5 minutes; it improves coverage refresh, it does not guarantee it. It needs Always authorization. A phone in Low Power Mode or with Background App Refresh restricted may deliver less. It is a refresh trigger; presence is still only established by venue events with a fresh, accurate fix.
