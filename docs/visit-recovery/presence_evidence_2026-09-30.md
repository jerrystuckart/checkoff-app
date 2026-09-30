# Presence evidence quality, missed exits, sentinel delivery (2026-09-30, second pass)

> **Terminology correction (2026-09-30, migration 20260930m):** wherever this document says "lower bound" or "proven" for a stay closed without an observed exit, read **"estimated"**. Sparse inside-samples do not prove continuous presence between them.

Migration `20260930g_presence_evidence_quality.sql` (applied); client OTA built from the release branch. Detection remains a **suggestion you confirm**: nothing here proves you did the specific experience, only that the phone was observed near the place.

## 1. Why Casola opened a session while you were at the lodging
Path, end to end, with the recorded values:

1. **Native event.** At 18:30:40 a sentinel re-registration made iOS re-determine every region's state (expo's `EXGeofencingTaskConsumer` resets all states to Unknown and calls `requestStateForRegion`). iOS answered *inside* for Casola and Da Adolfo. iOS region state is coarse (cell/Wi-Fi); a 100 m circle is below what it can resolve reliably. The event itself says nothing about the phone's real position.
2. **Location fix.** The phone took a fix: 10.4 m reported accuracy, **206 m** from Casola's centre (173 m from Da Adolfo's). Client side, `getFix()` also had an unbounded fallback to `getLastKnownPositionAsync({})`, i.e. a position of any age, and never told the server how old the fix was.
3. **Server entry validation.** `visit_presence_enter` accepted any fix within `radius + 100 m + min(accuracy, 50 m)`: for a 100 m circle and 10.4 m accuracy that is **210.4 m**, so 206 m passed with 4 m to spare. The fixed +100 m was meant to absorb callback delay but, relative to a 100 m circle, it doubled the venue. The server never checked location age.
4. The same loose rule decided when *other* open sessions were considered left, so sessions also stayed open far too long.

### The fix (one classification, used everywhere a fix is judged)
`visit_fix_presence(distance, circle, accuracy, age)`:

| result | rule | effect |
|---|---|---|
| `stale` | fix older than 180 s (age reported by the phone) | not evidence either way |
| `outside` | even the closest point of the fix's uncertainty disc (`distance − min(accuracy, 100)`) is beyond `circle + 15 m` | rejects an enter; is the only evidence that closes another session |
| `inside` | fix centre within `circle + 15 m` (catalogue geocode tolerance) **and** accuracy ≤ 65 m | establishes presence |
| `uncertain` | everything else: coarse accuracy, or borderline | presence is not established and nothing is concluded |

The phone now sends `p_fix_age_s`, refuses to use an OS position older than 2 minutes to report presence (it queues the enter for a fresh fix instead), and **retries** an enter rejected as `fix_outside_venue` / `fix_uncertain` / `stale_fix` with a fresh fix at the next callback or app event for up to 90 minutes. So this is **not** a blanket exclusion around the lodging: a genuine arrival at Casola from the lodging is found by the retry (time starts when the accepted fix is reported; never backdated). Limit, stated plainly: the retry runs on the next callback/refresh/app open, and iOS will not re-fire *enter* for a region it believes you are already inside, so a walk from the lodging to a neighbour with no other wake-up in between can be noticed late or, rarely, not until the next registration.

### Verified against today's recorded cases
Replaying the new rule over all 25 sessions recorded 2026-09-30: **20 inside, 3 outside, 2 uncertain**. The five it would have refused: Il Pirata 10:59 (130 m, circle 100, acc 9), the spa 17:46 (285 m, circle 150, acc 58), Il Pirata 18:05 (116 m, borderline → uncertain), Casola 18:30 (206 m → outside), Da Adolfo 18:30 (173 m, circle 150 → uncertain; now also `manual_only`). Every entry behind the three real candidates stays accepted (Rufolo 125 m/r120/acc 6, Duomo 88/r100/acc 16, Cosimo 85/r100/acc 17). Regression checks: `supabase/checks/visit_presence_evidence.sql` (lodging rejected, stale rejected, coarse rejected, neighbour accepted, …) and the harness tests in `sentinelTracker.harness.test.js`.

## 2. Missed Amalfi coverage and delayed sentinel refreshes
Sentinel re-registrations today, distance from the previous centre and time since it:

| time | kind | since previous | from previous centre |
|---|---|---|---|
| 10:55:56 | exit | 8 min | 1.64 km |
| 12:44:16 | exit | 62 min | 1.72 km |
| 17:10:19 | exit | 259 min | 1.61 km |
| 17:51:48 | exit | 40 min | 2.56 km |
| 18:05:26 | exit | 14 min | 3.68 km |
| 18:30:40 | exit | 25 min | 2.86 km |
| (outbound bus) | none | 10:59 → 11:39 app open | 5.6 km with no background exit |

Reading it: 3 of 6 exits arrived within ~0.1–0.2 km of the 1.5 km boundary (good); 3 arrived 1–2 km late, all on the bus, which is consistent with iOS batching region checks for a moving phone, at 10 m/s a minute or two of latency is 1 km; and **one exit (the outbound bus ride to Amalfi) was not delivered at all until the app was opened**. That last failure is not explained by the radius: the phone was 3.7× past the boundary.

Options compared against that sequence:

| option | verdict |
|---|---|
| Smaller radius | **Rejected.** On-time exits already came at ~1.6–1.7 km; the failures were late or missing delivery, which a smaller circle does not change, and it multiplies wake-ups. |
| Second ring | Rejected: costs a venue slot and uses the same delivery mechanism that failed. |
| Drift check on every wake (OTA) | **Implemented** (`sentinel_drift`): any venue callback that obtained a fresh fix outside the sentinel triggers a gated refresh without waiting for the OS exit. Helps when other wake-ups occur (it would not have helped the silent outbound stretch). |
| `Location.startLocationUpdatesAsync` at lowest accuracy | Available over the air, but expo's iOS consumer always runs a continuous location session plus significant-change. That is the always-on tracking this project has excluded; not enabled. |
| **Significant-location-change service alone** (Apple: cell-tower based, wakes or relaunches the app after roughly ≥ 500 m moves, low power) | The right tool for exactly this failure. **Needs a native change** (expo-location cannot start it without the continuous session): a small module/task consumer, hence a **new build and a new runtime**. Not published to `81dbd1f1…`. |
| Apple **Visits** service (`startMonitoringVisits`) | Also native-only; it delivers arrival and departure times itself, and would address missed exits at the source. Worth evaluating in the same build. |

What is not solvable in the current binary: guaranteeing a wake-up while the phone is moving in a bus. The present design improves coverage when iOS delivers events and reports honestly when it does not.

## 3. Missed exits: what later evidence can and cannot prove
* Every accepted fix (enter, re-delivered enter, exit, reconcile) now stamps `last_inside_at` on every other open session it is **inside** of (`visit_touch_inside`). That is observed evidence, never inferred.
* A session is closed as `missed_exit` only when a fresh, reasonably accurate fix is clearly **outside**. Stale or uncertain fixes leave it open.
* On closing without an observed exit, if `last_inside_at − entered_at` credits (estimates) at least the profile's candidate dwell, a candidate is created with `departure_at = last seen inside`, `dwell = that proven minimum`, `metadata.dwellBound = 'lower'`, at most medium confidence, never notifying. The inbox says "Last seen there … — at least N min (we didn't see you leave)". Arrival is never moved, no exit time is invented, unobserved time is never counted. With no later evidence the lower bound is 0: no candidate, the session stays `missed_exit` (uncertain). Checks: `visit_presence_evidence.sql`.
* Venues with close neighbours score below the ignore band on dwell alone (overlap penalty), so a lower bound there produces nothing by design (a 30-minute proven stay at Villa Rufolo scores 30 < 50).
* Today's Il Pirata session (entered 18:05:28, closed at 18:30:40) had no later inside evidence: lower bound 0, correctly left uncertain.

## 4. The Duomo suggestion
Recorded positions (distances in m from each venue centre): Duomo session 14:04:14 → 14:37:18. Enter fix: **71 from Villa Rufolo, 88 from the Duomo, 188 from Cosimo**. The Cosimo session began 14:23:58 with a fix **46 from the Duomo, 85 from Cosimo**. The Duomo session's exit fix at 14:37:18 was **11 m from Cosimo** (141 m from the Duomo, outside its 100 m circle). Distances between centres: Rufolo–Duomo 44, Duomo–Cosimo 130.

Conclusion: the 33.1 minutes is **not evidence of an actual church stay**. It is time near the Duomo–Rufolo piazza (your check-off at Rufolo was 50 s before the Duomo session opened), then time at Cosimo's restaurant, which lies outside the Duomo circle; the Duomo exit was delivered about 13 minutes after the phone was already in Cosimo's circle. It had `competingVenueCount = 1` (Rufolo) and scored 55 (medium). The conservative proven minimum, using the last fix inside the Duomo circle (14:23:58), is ~19.7 minutes of "somewhere within 100 m of the Duomo", still not proof of entering it. The card says other CheckOff places are very close and to confirm only if it is the one you visited; that remains the right framing.

## 5. "Already checked off" and recurring items
* The suppression is exactly the existing server confirm rule (2026-09-24 duplicate-completion guard: any existing `check_ins` row for that user + item blocks a recovery confirm). A suggestion the server would reject on confirm is not offered, so nothing legitimate is lost relative to before. It is evaluated against **current** state: unchecking the item makes hidden suggestions reappear while they are unexpired.
* `items.is_recurring` is not read by any check-off code. Real repeat completions exist in the data (15 user-items completed again more than a day apart, 5 more than 30 days apart, all `is_recurring = true`), but they come through **list** check-offs (a fresh `list_items` row per season), which this change does not touch: manual and list check-offs of recurring items remain repeatable.
* Recovery confirm writes an item-level row, and item-level recovery has always been once per item. Offering recovery again for a recurring item whose earlier completion was in a previous season is a **product decision** (it needs the confirm rule and points handling to change together); I did not change it. If you want it, the proposal is: recurring items only, prior completion older than the current list season, still one recovery per season.

## Status of this pass
Server (applied): evidence classification, age-aware enter/reconcile, last-inside evidence, lower-bound candidates. Client (OTA): fix age, stale-fix refusal, bounded retries, drift refresh, lower-bound label. Needs a physical test: the lodging fix (stay at the lodging ~20 min, expect no session for Casola/Da Adolfo neighbours), retry of a real arrival next door, a lower-bound suggestion, drift refresh. Needs a new build: significant-location-change / Visits.
