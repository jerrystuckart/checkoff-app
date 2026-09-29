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
