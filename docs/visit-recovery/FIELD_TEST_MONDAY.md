# Monday Florence field test — one card

**Item:** *Order a scoop of organic gelato at 'Edoardo Il Gelato Biologico'* (id `fee2f65f…`, Duomo area, 43.7725, 11.2577). Quick stop: **5 min minimum** for a suggestion (iOS reports the entry 0.5–3 min after you cross, and the server starts the clock then — so plan **7 min** to be safe, **15 min** for a clean push). No other catalog venue within 100 m, so it is not "ambiguous". Hours unverified — you only need to be within ~120 m, a nearby bench counts. Backup: Vivoli (`6602f653…`, 142 m from its nearest neighbour).

## Before you go (do this once you have signal, e.g. Sunday night)
1. Force-quit and reopen the app **twice** (first launch downloads the update, second applies it).
2. Profile → debug panel → **Running bundle** must read `OTA 01a0dd17-681a-77b1-aebd-e4ca540cc066` (the earlier `01a0dd03…` is superseded by it: it adds the iOS-callback hardening; the app downloads it on one launch and applies it on the next). Runtime `81dbd1f1…`, channel production.
3. Profile card says **On**; Location = **Always** (Settings → CheckOff → Location).
4. Screenshot the panel. If anything differs, stop and send me the screenshot.

## 15 minutes before you reach the gelato shop (outside the ~120 m circle, within 30 km)
5. Open the app → Profile → **Refresh geofences now**.
6. Panel must show **"N places monitored"** and list **…gelato at 'Edoardo Il Gelato Biologico'** as *monitored*. Not there? → see "If a step fails: registration". Do not enter until it is.
7. Background the app (do NOT force-quit — iOS then stops delivering events).

## The visit
8. Walk in / stand within ~120 m. Note the time. Stay **≥ 15 min** (≥ 7 min is the floor).
9. Leave and walk **≥ 200 m** away (must clear radius 120 m + GPS slack). Note the time. Keep the phone in your pocket, app in background.
10. Within ~1–3 min of crossing out: iOS wakes the app; within ~1 min after that a push **"Did you CheckOff the Thing?"** should arrive (tester-only). Tap it → the inbox opens with that suggestion highlighted.
11. Inbox row shows the gelato item, "Today, ~HH:MM", no "other places are very close" note.
12. From ≥ 1 km away (or another city), tap **Check it off** → success, points once. Reopen the inbox: the row is gone. Try the item's normal check-off: must be refused as already done.

## What I inspect if a step fails (tell me the step number and roughly when)
| Fails at | I look at |
|---|---|
| 2–3 bundle/opt-in | `geofence_registration_log.client_build` (which bundle wrote the row), `visit_recovery_settings` for your user |
| 6 not monitored | latest `geofence_registration_log` row: `registration_state` (`ok_none_eligible` = nothing within 30 km, `query_error`, `os_registration_error`), `monitored_items`/`excluded_items` + reasons (`no_visit_profile_assigned`, `exceeds_region_cap`), your `selection_lat/lng`; and `items.visit_profile_key` for the target |
| 8 no enter | `geofence_debug_events` (`presence_enter_result`: `opened` / `already_open` / `rejected` + reason such as `fix_outside_venue`, `travel_infeasible`, `not_opted_in`; `presence_rpc_failed` = network/auth/no fix) and `visit_presence_sessions` (row exists? `entered_at`) |
| 9–10 no candidate | `visit_presence_sessions.outcome` (`below_candidate_dwell` = too short, `missed_exit`, `stale_open`, `duplicate_pending`, `candidate`), `geofence_debug_events` (`exit_ignored_still_inside` = OS said left but your fix was still inside), `presence_exit_result` |
| 10 no push | `candidate_visits` row: `confidence_score` (≥ 85 needed; accuracy/speed missing → 80), `notification_sent_at`; then `notification_queue` (`processed_at`, `error`), `push_tokens` (fresh token), `feature_flag_overrides` for realtime/silent flags |
| 10 tap opens wrong screen | `notification_queue.payload` keys, then the bundle id from step 2 |
| 12 confirm refused | the error text on screen + `candidate_visits` (`status`, `expires_at`), existing `check_ins` for the item (duplicate guard) |
Nothing here needs you to do anything except tell me the step; I'll pull the rows and explain.

Record a screen video of steps 5–12 if you can — it doubles as the App Review recording.
