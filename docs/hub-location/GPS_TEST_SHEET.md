# Destination Hub location section — simulator GPS test sheet

Coordinates are real: Willcox/Positano item and zone rows read from production (read-only) on 2026-10-04;
expected results come from the same selection code the Hub runs (`lib/hubLocationSection.js`, locked by
`lib/hubLocationSectionLiveFixture.test.js` and `lib/__fixtures__/hub_live_2026-10-04.json`).

## Prerequisites
- Signed in **as Jerry's account**. The Willcox zone row is `is_active = false`; RLS lets only that account read it.
  Any other account sees no Willcox zone, so no section (correct).
- Debug/dev-client simulator build (`__DEV__`), which skips the client-side `is_active` filter. A production build
  also filters `is_active = true`, so the section will not show on Willcox in TestFlight/OTA until the zone is activated.
- Location permission granted (`scripts` below grants it). No permission = no section, by design.
- Open Destinations → Willcox (or Positano) Hub. Positano's zone is active, so it works for any account.

## Willcox (zone centre 32.2526, -109.8326, radius 40.2335 km)
| # | Name | Lat, Lng | Expected |
|---|---|---|---|
| 1 | At Rix's Tavern | 32.2516952, -109.8333493 | "You're here" (no partner linked) + "Grill your own meat at 'Rix's Tavern'", button "Check it off →" |
| 5 | At Historic Theater | 32.2526337, -109.8313725 | At-place: "Catch a movie at the 'Willcox Historic Theater'…". Rex Allen museum is ~20 m away; nearest wins |
| 2 | Between venues | 32.2480, -109.8400 | "Closest to you": Rix's Tavern (0.5 mi), then Big Tex BBQ (0.6 mi) |
| 3 | 200 m inside zone edge (north) | 32.61262, -109.8326 | "Closest to you": U-Pick at Apple Annies Orchard (18 mi), Warren Earp grave (25 mi) |
| 4 | 200 m outside zone edge | 32.61622, -109.8326 | No section. Hub looks exactly as before |

## Positano (zone centre 40.6281, 14.485, radius 7 km, active)
| # | Name | Lat, Lng | Expected |
|---|---|---|---|
| 1 | At Torre Trasita | 40.6263545, 14.4822477 | At-place: "Slip past 16th-century Torre Trasita…" |
| 2 | Between venues | 40.6300, 14.4900 | Closest two: "Grab a first-come seat before sunset…" (0.1 mi), "Dance after midnight…" (0.2 mi) |
| 3 | Inside edge | 40.6909, 14.485 | Closest two (≈4 mi) |
| 4 | Outside edge | 40.6919, 14.485 | No section |

Notes: venue names show only when an item has a linked partner; none of the Willcox/Positano items do, so the
at-place heading reads "You're here" (same fallback as Home's hero). At-place needs distance ≤ min(item radius, 150 m).
A venue within 150 m is "here" only for the nearest item; being here never marks anything eligible — tapping opens the
normal Item Detail, which runs its own geofence/photo/points checks.

## Setting the simulator location
- CLI (easiest, works while the app runs): `scripts/hub-sim-location.sh willcox-01` (or `willcox-02`..`-05`, `positano-01`..`-04`, or `lat,lng`).
- GUI: Simulator → Features → Location → Custom Location… → enter latitude/longitude → OK. (The Simulator menu cannot
  load GPX directly.)
- GPX files for each point are in `docs/hub-location/gpx/` for use in an Xcode scheme (Run → Options → Default Location → Add GPX File).
- The location store updates on the next fix (watcher 25 m / 10 s); the Hub updates without leaving the page.

## What this does NOT prove
A stationary simulated foreground fix tests only the Hub's foreground presence/zone logic. It does not exercise native
background movement, region/geofence monitoring, dwell tracking, visit detection or recovery. Those need a device (or
a simulated route plus real background time) and are not validated here.
