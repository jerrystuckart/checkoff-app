# Visit-recovery catalog readiness: the Amalfi intake gap (2026-09-29)

## What happened

On 2026-09-29 Jerry's debug panel showed **0 monitored / 48 excluded** in Positano. 46 exclusions were `no_visit_profile_assigned`, 2 were `inactive`.

An item is monitored on a phone only if **all** of these hold (`lib/visitDetection/candidateVisitTracker.js` `classifyNearbyItems` + `visitEligibility.js`):

| Gate | Field | Rule |
|---|---|---|
| has a location | `items.maps_lat`, `maps_lng` | The client's query is `.not('maps_lat','is',null)`. An item without coordinates is invisible: it is not even listed as excluded. |
| is a place | `is_universal = false` | otherwise `universal_item` |
| is live | `is_active = true` | otherwise `inactive` |
| has a profile | `visit_profile_key` -> `visit_detection_profiles` | null / unknown key -> `no_visit_profile_assigned` |
| profile is not opt-out | `visit_detection_profiles.manual_only = false` | `manual_only` -> `manual_only_profile` (the deliberate "never auto-detect" choice) |
| within 30 km, and among the nearest 19 | `NEARBY_RADIUS_M`, `MAX_MONITORED_REGIONS` | otherwise `exceeds_region_cap` (iOS allows 20 regions) |

The profile supplies the thresholds (`candidate_dwell_minutes` / `strong_dwell_minutes`). The circle is `geo_radius_m` (default 120 m, max 200 m).

**What the Amalfi launch and bulk upload missed**

* The Amalfi catalog (created 2026-09-26/27) missed the 2026-09-28 `rule_v1` backfill, which was a one-time pass over the catalog as exported on 2026-09-26. Nothing gave later items a profile. All 61 active Amalfi items had `visit_profile_key = NULL`.
* Fifteen of the items Jerry bulk-added on 2026-09-27 also had **no coordinates**: the CSV/ChatGPT bulk path writes only `maps_query`. The panel could not show them at all, so the "48" undercounted the problem: 46 (no profile) + 15 (no profile **and** no coordinates) + 2 inactive = 63 rows.

## Sept 29, Europe/Rome: do the missing profiles explain the missed Positano visits?

Yes. From the database (user `11275026...`, all times Europe/Rome):

* **20 registration refreshes** between 07:49 and 00:04 (the next day). Every one: `monitored = 0`, `excluded = 48` (`no_visit_profile_assigned` 46, `inactive` 2), `geofencing_started = false`, `error_message = null`. 18 carry `registration_state = ok_none_eligible`; 2 (20:12 and 21:09) have no state or build recorded (written by an older client) but show the same 0 / 48. Positions cluster at Positano (about 40.628, 14.488) between 11:44 and 22:11, and at Laurito (40.624, 14.507) at 09:22, 23:57 and 00:04.
* **0** `visit_presence_sessions`, **0** `geofence_debug_events` (no `enter`), **0** `candidate_visits` on Sept 29.
* With zero regions registered, iOS cannot deliver a single enter/exit, so no dwell could ever start. That is sufficient cause on its own.
* Other causes ruled out: no `os_registration_error` or `query_error` (the OS call was never made because the set was empty); the feature flag and opt-in were on; the same bundle family produced a real candidate the day before (Sept 28, 11:02-12:00 Rome, Florence, 58.6 min) because those items had profiles.
* Jerry did manual tap check-offs that evening: Chez Black 19:28 and Franco's Bar 21:21. They are unaffected.

### Are the missed visits recoverable from existing evidence? **No.**

Recovery needs a recorded, qualifying dwell (a presence session with an enter and a departure at a venue). None exists. The only positional evidence is the registration log: 20 foreground refresh points, rounded to about 111 m, minutes to hours apart. That shows where the app was opened, not that time was spent at a specific venue, and in Positano's beachfront cluster it cannot even separate neighbouring venues. Creating candidates or awarding points from it would be fabricating visits, so nothing was created. Nothing was backfilled and no points were awarded. Visits from today forward will be captured (see the refresh step below).

## Database changes (applied via the linked Supabase CLI)

1. `20260929_amalfi_visit_profiles_and_geo.sql`
   * Coordinates, `google_place_id`, `formatted_address`, radius for the 15 coordinate-less items, from Google Places (New) Text Search on each item's own `maps_query` (read-only lookup, addresses compared to the query).
   * A reviewed profile on all 61 active Amalfi items: **49 monitored-eligible, 12 intentionally excluded** (`manual_only`). `visit_profile_source = 'curated_2026-09-29'`. Rationale per venue: `docs/visit-recovery/amalfi_profile_decisions.json`. Reversible by source tag.
2. `20260929b_visit_profile_intake_guard.sql`
   * `classify_visit_profile()`: SQL port of `profileClassifier.js`. `scripts/verify-visit-profile-parity.mjs` compared it to the JS over 2,374 cases (every live item + edge cases): **0 mismatches**.
   * Trigger `trg_zz_items_default_visit_profile`: on INSERT/UPDATE of an active, geocoded, non-universal, non-secret item with a metro and no profile, fill it **only when the conservative rule is confident** (`visit_profile_source = 'auto_v1'`). Never overwrites a profile (including `manual_only`), never guesses. This covers admin, CSV/bulk, direct SQL and Winston, and it also fires when coordinates arrive later.
   * View `item_visit_readiness`: `monitored_ready` / `intentionally_excluded` / `incomplete` (with `missing` = profile and/or coordinates) / `not_applicable` / `inactive`.
3. `20260929c_brief_stop_manual_only.sql`: four walk-up/drive-thru/wine-window items the classifier already ruled out as too brief to time are now explicitly `manual_only`.

Nothing lowered a threshold; no profile definition changed.

### Intentional exclusions (Amalfi), and why

Trails and routes (`Sentiero dei Limoni`, `Sentiero degli Dei`, `Valle delle Ferriere`, `Nocelle` stairs, `Montepertuso` stairs); boat and water activities (`Amalfi Coast Sea Kayak`, parasailing, `Grotta dello Smeraldo` boat, `Lucibello` sail); a roadside bridge viewpoint (`Fiordo di Furore`); a private-villa dinner whose coordinate is only the company address (`Positano Home Cooking`); and `Chiesa di San Giacomo`, which shares the exact coordinate (0 m) with `Chiesa di Santa Maria Assunta` and cannot be told apart from it.

### Dense venues (Positano Spiaggia Grande, Amalfi piazza, Ravello piazza)

Thresholds were kept as-is. In the clusters, pastry/granita counters with monitored neighbours within 80 m use `fast_casual` (10 min) instead of `quick_stop` (5 min), following the classifier's own rule that a doubt is resolved toward the longer dwell. The existing overlap handling still applies: `visit_competing_count()` (25-80 m) subtracts 25 points and drops the +10 "no competitor" bonus, so a lunch at Chez Black surfaces neighbours only as medium-confidence, flagged "N other venues nearby", and reminders are suppressed. Known co-suggestion pair: Monastero Santa Rosa Spa and Il Refettorio (20 m, same complex); the user confirms which.

### Rest of the catalog

Readiness view, active places, by metro (ready / intentionally excluded / incomplete):
san-diego 241/3/13, phoenix 230/2/61, vienna 166/0/41, denver 164/0/44, tucson 120/0/48, florence 88/1/0, milwaukee 82/1/33, green-bay 76/0/24, amalfi 49/12/0, munich 64/1/**134 without coordinates**, no-metro 0/0/28.

* The classifier would assign **nothing** more today: every remaining `incomplete` row is one the rules deliberately decline (Adventure, Sports, Social, Misc with no confident rule; 28 without a named venue or metro) and needs a human choice. They now show in admin as **Incomplete** instead of being invisible.
* **Munich** is the other real gap: 134 active items have no coordinates. I did not bulk-geocode a live metro without match review; that belongs to the Winston geo-enrichment pass. Once coordinates arrive, the trigger classifies them.

## Creation paths

| Path | Now |
|---|---|
| Database (all paths) | trigger + readiness view, as above |
| Admin (`checkoff_admin.html`, outside git) | new **Visit detection** column, **Visit: Ready / Excluded / Incomplete** filter, "N incomplete" in the stats line, a Visit detection field in the item drawer, and a save-time warning naming what is missing. Only sends a profile when the admin picked one. |
| CSV / bulk import scripts | end with a readiness report for the imported ids (ready / excluded / incomplete and what each lacks) |
| Winston | INSERT tags `visit_profile_source = 'winston_v1'`; the package aborts if a geocoded new item has no profile and names items with no coordinates |

## Devices: how they pick this up

No app update is needed for the data fix. On every refresh the app re-reads the `items` table (only the small profile table is cached). Refresh triggers: app launch, each background -> foreground transition (5-minute cooldown), and toggling recovery in Profile.

**Jerry's step:** force-quit CheckOff and reopen it (a cold start skips the cooldown), or Profile -> Visit detection debug -> **Refresh geofences now**. Expected in Positano: about **19 monitored**, 30 `exceeds_region_cap` (the nearest 19 win; iOS allows 20), **12 manual_only**, 2 inactive, and **no** `no_visit_profile_assigned`.

The region cap means a large move (more than about 1.4 km in Positano, farther elsewhere) needs the app to be opened once to re-select the nearest 19. This is the existing design, unchanged.

## Client changes (need an OTA)

* Visit Inbox empty state follows reality: opted in -> "Visit recovery is on - nothing waiting" (no "turn on" text); opted in without Always location -> points to Settings; not opted in -> the original Profile prompt (`lib/visitDetection/inboxEmptyState.js`).
* Debug panel groups the last registration: **Missing configuration** (red, names each nearby item with no profile), Monitored, Intentionally excluded, Not monitored (cap / inactive) (`lib/visitDetection/registrationRowGroups.js`).

---

# Follow-up (2026-09-29, later): OTA, commit 2e75f1a, nearest-19 coverage, catalog-wide readiness

## OTA (published)
iOS-only, production, runtime `81dbd1f1dac8165466982bb95e3625a76d9ea841`, update group `8838ac17-7827-4741-87ee-2155513fd933`, iOS update id `01a0ef50-9ac7-790c-b3a2-c277f6d8a946`, built from a clean worktree at commit `dc4843a` (= the last published OTA's commit `c0dcc2c` + the readiness commit; the app.json version bump 1.1.9/155 present as in earlier OTAs). Verified the manifest endpoint returns this update id for `expo-runtime-version: 81dbd1f1…` on channel `production`, and returns nothing (204) for the 1.1.8 runtime. iTunes lookup shows App Store 1.1.9 live since 2026-09-29T18:07Z; the docs (`APP_STORE_1.1.9.md`) record that binary's fingerprint as `81dbd1f1…`. Devices download on one launch and apply on the next.

## What commit 2e75f1a changed, and why it moved the iOS fingerprint
Only `app.json` (Android): removed `ACCESS_BACKGROUND_LOCATION` from `android.permissions`, and changed the `expo-location` plugin props from `isAndroidBackgroundLocationEnabled: true` to `false` plus `isAndroidForegroundServiceEnabled: false` (drops `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION`). No JS changed.

* **iOS native configuration did not change.** `expo config --type introspect` for the `ios` section is byte-identical before and after that hunk (compared in the same directory). `Info.plist`/`UIBackgroundModes` come from `ios.infoPlist`, which is untouched. The iOS binary would be identical.
* **Why the fingerprint still moved:** `@expo/fingerprint` hashes the whole `expoConfig` (the plugin props are inside it) for every platform, so an Android-only prop edit changes the *iOS* hash (`expoConfig` source `c8baf36f -> 7035f7da`, total `81dbd1f1 -> b3f50a17`). It is a false positive for iOS.
* **Consequence:** an OTA published from `main` computes runtime `b3f50a17…`, which no shipped iOS binary has, so it would never be delivered. The next iOS *build* from main would ship `b3f50a17…` (harmless for that build, but it becomes a new runtime with its own OTA lineage).
* **Not reverted.** It is a correct Android-only change and was left as is. Options when convenient: keep publishing 1.1.9 OTAs from the `c0dcc2c`-based worktree until the next iOS build; or add a fingerprint ignore for Android-only plugin props so Android edits stop moving the iOS runtime. That is a build-config decision for the next binary, not done here.

## Nearest-19 monitoring: what actually happens
Facts (from `candidateVisitTracker.js`, expo-location and iOS behavior):

* iOS keeps monitoring the registered regions with the app closed, and can relaunch a **system-terminated** app to deliver an enter/exit. If the user **force-quits** from the app switcher, iOS does not relaunch it for region events until CheckOff is opened again (documented in the tracker's own header). Nothing on the app side can change that.
* The registered set is fixed at the last refresh. Refresh runs only on launch, on foreground (5-minute cooldown) and when recovery is toggled. Moving through town with the app closed keeps the original 19 venues live; venues outside that set are simply not watched until the next foreground.
* How large is the gap (live data, eligible venues, 19th-nearest distance from a central point): Florence 354 m, Vienna 570 m, Phoenix 915 m, San Diego 1.4 km, Positano 1.4 km, Denver 1.5 km, Amalfi town 4.7 km. So in dense cities a walk of a few hundred metres leaves the covered set. This is the biggest real-world limit on detection and is independent of catalog readiness.
* The 20th iOS region slot is intentionally spare (19 registered), so there is exactly one slot available.

Why not just `startLocationUpdatesAsync`: expo-location's implementation (`EXLocationTaskConsumer.m`) starts continuous GPS updating plus significant-change, which is a large battery cost and a permanent indicator; not appropriate.

**Proposal (JS-only, OTA-deliverable, no new native module): a coverage sentinel region.** Register one extra region in the same `startGeofencingAsync` call: a circle around the position used for the refresh, radius about half the distance to the 19th venue, clamped to 250 m - 1,000 m, identifier `checkoff-refresh-sentinel`, exit only. Venues then use 18 slots + 1 sentinel (still one spare). When iOS reports the sentinel exit (it can relaunch the terminated app), the geofence task takes a fresh fix, re-ranks and re-registers the nearest 18 + a new sentinel, then returns. Safeguards kept unchanged: the sentinel never creates presence sessions or candidates; venue enter/exit handling, fresh-fix exit re-check, server-owned clock, dwell thresholds, confidence, daily cap and 7-day expiry are untouched; a re-registration re-delivers `enter` for the venue the user is inside, which `shouldSendEnter` already dedupes; the venue the user is currently inside is always the nearest and stays registered. Also needed: cache the ranked candidate list on the device (30 km window, re-rank locally) so a background refresh does not re-download the whole ~2,200-row catalog each time, and a 60 s minimum between re-registrations. Not built yet: it changes live detection behavior and needs a field test in a dense city (Florence) before rollout; this is the recommended next piece of work. Limits: needs "Always" location; not effective after a force-quit.

## Reviewed catalog readiness across active metros
Three migrations applied after the Amalfi work:

* `20260929d_munich_verified_coordinates.sql`: 134 active Munich items had only a `maps_query`. Places (New) text search per item, every result classified with the Winston `classifyPlacesMatch`; 93 EXACT within 30 km auto-accepted, 25 more accepted after reading name+address (spelling or word-order variants and day-trip venues within 35 km), giving **118 coordinates set**. The trigger then classified the 99 with a confident rule. Rejected as wrong entity/not a venue (left without coordinates): `Standl 11` (Places returned a Lidl), `Fisch Maier`, `Neues Rathaus` (returned a bar in the building), `BROY`, `Munich Distillers`, `Cine Español`, `Königs Musik-Express`, `Beerencafé Hofreiter`, `Hexenhäusl`, `King Loui`, `Kloster Fürstenfeld Bräustüberl`, `Undosa` (closed). `Tollwood Winter Festival`, `Oide Wiesn`, `Teufelsrad` are seasonal events with no standing venue -> intentional exclusions.
* `20260929e_reviewed_profile_choices.sql`: all **310** remaining items the rule declined were read and decided: 79 attraction, 46 outdoor, 35 event, 18 bar, 10 restaurant, 3 retail, **119 manual_only** (trails, loops, greenways, drives, rides and boat trips, dated festivals and recurring meetups, road trips, and anything without one place). Source `curated_2026-09-29`.

Coverage by metro (active placeable items = ready + intentionally excluded + incomplete; universal and secret-without-profile are not placeable; ready = coordinates + live non-manual profile):

| Metro | Placeable | Ready | Intentionally excluded | Incomplete | Inactive |
|---|---|---|---|---|---|
| Phoenix | 293 | 264 | 29 | 0 | 51 |
| San Diego | 257 | 250 | 7 | 0 | 2 |
| Denver | 208 | 187 | 21 | 0 | 4 |
| Vienna | 207 | 199 | 8 | 0 | 1 |
| Munich | 199 | 178 | 9 | **12** (no verified venue match yet) | 21 |
| Tucson | 168 | 148 | 20 | 0 | 24 |
| Milwaukee | 116 | 96 | 20 | 0 | 54 |
| Green Bay | 100 | 94 | 6 | 0 | 0 |
| Florence | 89 | 88 | 1 | 0 | 7 |
| Amalfi Coast | 61 | 49 | 12 | 0 | 2 |
| No metro (Willcox etc.) | 28 | 19 | 9 | 0 | 46 |
| **Total** | **1,726** | **1,572** | **142** | **12** | |

The 12 Munich items are the only rows that are visibly `incomplete` (they need coordinates from a human-verified venue). Ready is 91% of placeable.

## The guard and its uses (verified)
* Explicit exclusions are accepted: an item inserted with `visit_profile_key = 'manual_only'` and no coordinates reads `intentionally_excluded`; an unknown key is rejected by the foreign key; an undecided item with coordinates (Adventure) stays `incomplete / profile` (tested in a rolled-back transaction).
* One rule set: the database trigger + `item_visit_readiness` are the source of truth. The admin's `visitReadiness()` gives the same answer for all 2,230 live items (0 mismatches). Winston's generated SQL reads the same view (`is_secret, visit_profile_key, visit_profile_source, ...` insert tagged `winston_v1`, fail-closed postflight). The CSV import scripts read the same view for their report, and `checkoff_import_csv.js` now accepts an optional `visit_profile_key` column (including `manual_only`) tagged `csv_import`.

## Three separate questions, three separate answers
1. **Catalog readiness** (data): done as above. 1,572 items are eligible, 142 deliberately excluded, 12 incomplete.
2. **Device registration** (does a phone actually register regions): Jerry's device, build `01a0e9f8`, refreshed at 00:32 Rome: `ok_monitored`, geofencing started, **19 monitored**, exclusions exactly as predicted (30 over the cap, 12 manual_only, 2 inactive), no errors. This is one device, one place.
3. **Actual visit detection** (does a real dwell at a venue become a suggestion): **not yet demonstrated for Amalfi.** The only end-to-end proof is the Florence visit on Sept 28. It needs a real stay at a monitored Positano venue followed by an exit and a candidate row. Until then the rollout is not complete. Also outside catalog readiness: the nearest-19 coverage gap and the force-quit limitation above.
