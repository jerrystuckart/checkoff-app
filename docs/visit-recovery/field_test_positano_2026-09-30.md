# Positano field test — visit recovery + background coverage refresh

Goal: prove, with your phone, the two things only a real device can prove: (3) the set of watched places refreshes while CheckOff is backgrounded, and (4) a real stay becomes a suggestion. Stage 5 (confirm, points, list fan-out) follows from tapping Confirm.

What is applied for you only: OTA `01a0ef6f-3a3a-795c-9e2e-68beb5ffb9fc` (runtime `81dbd1f1…`) is served to everyone on 1.1.9, but the new refresh behaviour is behind flag `candidate_visit_sentinel_refresh`, which is on **only for your account** (global flag off, and it is also tester-gated in the app). Everyone else keeps the classic behaviour.

## 1. One-time: load the update (this is the only time you may swipe the app away)

1. Open CheckOff on Wi-Fi/cellular. Wait ~30 seconds. (Launch 1 downloads the update.)
2. Swipe CheckOff away from the app switcher, then open it again. (Launch 2 applies it.)
3. Profile → **Visit detection debug**. It must say `Running bundle: OTA 01a0ef6f-3a3a-795c-9e2e-68beb5ffb9fc`. If it shows `01a0e9f8` or `embedded`, repeat steps 2–3 once more. Do not go on until it shows `01a0ef6f`.

## 2. Confirm tracking is ready (still in the debug panel)

* ✓ Background location permission (Location must be **Always**, Precise Location on)
* ✓ candidate_visit_detection flag
* Tap **Refresh geofences now** once. Then read:
  * `Last registration: N places monitored` (expect up to **18**; with the sentinel it is 18 venues + 1 sentinel = 19)
  * a line `Coverage refresh: manual · ok_monitored · sentinel <X> m · next unmonitored venue <Y> m · cache …`
  * "Missing configuration" must not appear.
* Also on: Background App Refresh, Low Power Mode **off**.

The panel line is your map for the day: the sentinel radius `X` is roughly how far you can go before coverage re-centers (iOS reports the exit a bit late, so expect 100–300 m more). `Y` is how far the nearest venue is that is *not* being watched yet.

## 3. Normal tracking rules (all day)

* Open CheckOff **once** where you start, confirm the panel, then press **Home** and put the phone away.
* **Do not swipe CheckOff away** after that. iOS does not wake a force-quit app for location events; a swiped-away app can silently miss everything (that is an iOS rule, not a bug we can fix).
* **Do not open CheckOff during the route.** Opening it triggers a normal refresh that would re-center coverage and make the background test meaningless. Open it again only after the whole test (step 6).
* Keep the phone charged and connected to data if you can (a refresh works offline from a device cache within about 30 km, but logs upload when there is signal).

## 4. What is being watched now (illustration, not a prediction)

Computed with the app's own selection code from the last place your phone registered (Laurito, ~40.624, 14.507). **Tomorrow's real set depends on where you open the app**; read the debug panel and trust that. From Laurito the 18 nearest suitable venues are:

| Venue | Profile | Needs to be present | Circle | Overlap |
|---|---|---|---|---|
| Ristorante Da Adolfo | restaurant | **15 min** (strong 60) | 150 m | none |
| Ceramiche Casola | retail | **9 min** (20) | 100 m | none |
| Chiesa di San Pietro | attraction | **18 min** (90) | 100 m | none |
| Arienzo Beach Club | outdoor | **12 min** (45) | 200 m | none |
| La Tagliata | restaurant | 15 min (60) | 100 m | none |
| Music on the Rocks | bar | 15 min (90) | 100 m | none |
| Il Ritrovo | restaurant | 15 min (60) | 100 m | none |
| La Gavitella Cooking Classes (Praiano) | event | 20 min (75) | 150 m | none |
| Franco's Bar | bar | 15 min (90) | 100 m | 1 nearby |
| Bacco's Lounge | bar | 15 min (90) | 100 m | 3 nearby |
| Chez Black | restaurant | 15 min (60) | 100 m | 3 nearby |
| Chiesa di Santa Maria Assunta | attraction | 18 min (90) | 120 m | 3 nearby |
| MAR Positano | attraction | 18 min (90) | 100 m | 2 nearby |
| La Zagara | restaurant | 15 min (60) | 100 m | 1 nearby |
| Sapori e Profumi di Positano | retail | 9 min (20) | 100 m | 1 nearby |
| Chiesa di San Gennaro (Praiano) | attraction | 18 min (90) | 120 m | none |
| Collina Positano Bakery | fast_casual | 10 min (25) | 100 m | 3 nearby |
| Latteria | restaurant | 15 min (60) | 100 m | none |

"Needs to be present" is the minimum stay for a suggestion (the profile's candidate dwell); "strong" raises confidence. "Nearby" = other watched venues 25–80 m away: they lower confidence (suggestion arrives as *medium*, marked "N other venues nearby", and no reminder is sent) but the visit is still offered. Two venues under 25 m apart are the same place. Nothing is ever checked off automatically. Exclusions you will not see (deliberately never monitored): boat trips, hikes and stair climbs, Chiesa di San Giacomo, Positano Home Cooking.

## 5. The route

Start where you sleep (Laurito or wherever), open the app (step 3), then:

1. **Walk or bus toward the west end of Positano** (Fornillo). From a Laurito start that is about 2.1 km, past Spiaggia Grande. From that start, coverage should re-center after about 1.5 km (illustration: the new set gains Fornillo Beach, Elisir di Positano Cafè, Artigianato Rallo, Bottega di Brunella, Maria Lampo). **If you start somewhere else, look at the panel's `sentinel X m` and go at least X + 300 m from the start point toward an unwatched suitable place.**
2. **Target A (cleanest test): Fornillo Beach** — outdoor, needs **12 min**, 200 m circle, no overlapping venues. Stay **20–25 minutes** (a swim/sit is fine). It is *not* in the set you registered at Laurito, so a suggestion here can only happen if the background refresh worked.
3. **Target B (optional, tests overlap): Elisir di Positano Cafè** — fast_casual, needs **10 min** (strong 25), 3 watched venues within 80 m, so expect a *medium*-confidence suggestion flagged "other venues nearby". Stay 12–15 minutes.
4. After each stay, **walk away 300 m or more** (an exit is only believed when a fresh location agrees you left), keep the phone in your pocket, and do not open the app.

Suggested day order: Fornillo (25 min) → walk east along the beach → Elisir (15 min) → walk on for 10 min → then step 6.

## 6. After returning (do this in order)

1. Wait ~5 minutes after your last walk away, then open CheckOff. Home → the visit recovery entry (or Profile → "Places you may have visited"). Suggestions for the venues you stayed at should be there. Confirm one, optionally add a photo/memory. Dismiss the other one if you like; that exercises dismissal too.
2. Profile → Visit detection debug → screenshot it (the "Coverage refresh" line shows the last cause; please do not press Refresh before I read the logs).
3. Tell me the times you arrived at and left each place (an approximate wall-clock time is enough) and whether at any point you opened CheckOff.

## 7. What I will read afterwards (and what each proves)

Run: `node scripts/visit-field-test-report.mjs 2026-09-30` (Europe/Rome day). It prints, and states plainly what is and is not proven:

| Stage | Evidence in the database | Proven when |
|---|---|---|
| 2 Device registration | `geofence_registration_log`: `registration_state=ok_monitored`, `geofencing_started=true`, `monitored_items` count, `refresh_cause` | an `ok_monitored` row exists |
| 3 Background coverage refresh | `geofence_debug_events` `sentinel_exit` followed by a `geofence_registration_log` row with `refresh_cause=sentinel_exit`, `ok_monitored`, a new position and a changed monitored set (`coverage.sentinelRadiusM`, `nextUnmonitoredM`, `cacheSource`), with **no** foreground/app_start/manual row between (you promised not to open the app) | the pair exists and the new set contains the venue you then visited |
| 4 Enter → dwell → exit → candidate | `visit_presence_sessions` (entered/closed, minutes ≥ the profile's candidate dwell), `geofence_debug_events` `enter` → `presence_enter_result` → `exit` → `presence_exit_result`, `candidate_visits` row (`geofence_dwell`, score, `competingVenueCount`) | session minutes ≥ need **and** a candidate exists |
| 5 Confirm, points, list fan-out | `check_ins` with `verification_method=historical_visit_confirmed` (points) plus the per-list rows created by the same confirm (`list_item_id` set), `candidate_visits.confirmed_at` | those rows exist after you tap Confirm |

The report also prints every registration row's `client_build`, so I can confirm the day ran on `01a0ef6f`.

## 8. If something does not happen (what it would mean)

* **No `sentinel_exit` at all, but the app never opened:** iOS did not wake the app. Usual causes: the app was swiped away, Location not Always, Low Power Mode, no movement beyond the radius, or the OS delayed the exit (it can lag several minutes). Check the walk distance against `sentinel X m` first.
* **`sentinel_exit` but no re-registration row:** the refresh failed; the `kept_previous_set` rows say why (`no_location_fix`, `gated_min_gap`, `cache_*_offline`, `exception: …`). The attempt is retried at the next geofence event or when you open the app.
* **A session but no candidate:** stay was shorter than the profile need, the exit was ignored as "still inside", or the score fell below the ignore band. The `presence_exit_result` row gives the reason.
* **A wrong-neighbour suggestion in the beach cluster:** expected in dense overlap (the confidence is deliberately lowered and flagged); tell me which and I will look at the scores.
* **Anything crashes or the panel shows "Missing configuration":** send the screenshot.

Not testable tonight and therefore still open: whether iOS relaunches the terminated app for a sentinel exit on your device (documented Apple behaviour, unverified here), the real exit lag, battery impact over a full day, and everything in stages 3–5.
