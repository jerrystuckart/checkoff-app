# Missing fix-age (p_fix_age_s): who sends it, and what happens to everyone else (2026-09-30)

## Verified
| Bundle | Sends `p_fix_age_s`? | How verified |
|---|---|---|
| Embedded bundle of the submitted 1.1.9 (build 154, `build-1790242579202.ipa`, runtime `81dbd1f1…`) | **No** | `main.jsbundle` contains 0 references to `p_fix_age_s` (and no sentinel code) |
| Embedded 1.1.8 (build 153) | No | same check |
| OTA groups on `production`/`81dbd1f1…` up to and including `179fa0f7` ("badges match actionable inbox cards…") | **No** | `p_fix_age_s` first appears in commit `37f0477` |
| OTA group `21b47297` ("fresh-fix presence evidence…") and every later group (`8b08f89b`, the newest) | **Yes** | published from commits containing `37f0477` |

So **every 1.1.9 install that has not downloaded `21b47297` or newer omits the age.** That includes every user on the embedded bundle, and any user who has not opened the app since the OTA was published. (iOS installs also only download an OTA on launch and apply it on the next launch.)

## Impact of the 2026-10-03 cutoff as originally written
From the cutoff a missing age would be classified `stale`, so every enter from such a client would be rejected as `stale_fix`. Old clients have no retry queue, so the failure would be **silent**: no suggestion, no error. Today the feature is opt-in and only one account is opted in (the tester, whose phone was on an older OTA at its last log), so nobody outside the test would notice; but it would have become a silent outage the day the feature reaches more people on older bundles.

## Change (migration `20260930m`)
* The cutoff is removed (`visit_legacy_fix_cutoff()` returns NULL). A missing age is **always** handled by the strict legacy rule: accepted only when accuracy ≤ 30 m **and** the fix is within the zone circle (no tolerance, no uncertainty credit); otherwise `uncertain`/`outside` exactly as for a new client. Negative/absurd ages are still stale.
* Every user who sends a missing age is logged: `geofence_debug_events.event_type = 'presence_legacy_fix'` (≤ 1 per user per 6 h), so the set of not-yet-updated clients is visible: `select user_id, max(occurred_at) from geofence_debug_events where event_type='presence_legacy_fix' group by 1`.
* Trade-off, stated plainly: for a legacy client the server cannot tell a fresh fix from an old cached one, so a cached fix that happens to be accurate and inside the circle is accepted. That is the same position as before the cutoff; the honor system already rests on the user confirming.
* Checked by `supabase/checks/visit_zone_dwell_rule.sql` (`legacy_logged=1 cutoff=none`).

## Not done
No bundle was changed to force an update; users on the embedded 1.1.9 bundle receive the age-sending code with the next OTA download, and the new 1.1.10 binary embeds it.
