# Field test results — Laurito → Amalfi → Ravello → Laurito, 2026-09-30 (Europe/Rome)

Source: `node scripts/visit-field-test-report.mjs 2026-09-30`, `node scripts/visit-sentinel-monitor.mjs 24`, `check_ins`, `candidate_visits`, `storage.objects`. One device, build OTA `01a0f128` (refresh logic) for the whole day.

## Proven from recorded device events
| Stage | Evidence |
|---|---|
| 2 Registration | 20 `ok_monitored` refreshes, 18 venues + 1 sentinel every time, cache served every refresh after the 08:48 fetch. |
| 3 Background coverage refresh | **6 sentinel-driven re-registrations with no app open in the preceding 3 min** (`BACKGROUND`): 10:55:56, 12:44:16, 17:10:19, 17:51:48, 18:05:26, 18:30:40; plus 2 background `sentinel_retry`. Each re-centred on a fresh fix and changed the monitored set (Ravello venues registered in the set chosen at 11:39/12:44). |
| 4 Dwell → candidate | 25 presence sessions; 14 closed at/above the profile threshold; **3 candidates**: Villa Rufolo 12:51→14:37 (105.7 min, medium 55), Duomo di Ravello 14:04→14:37 (33.1 min, medium 55), Trattoria Cumpà Cosimo 14:24→15:17 (53.9 min, score 90). 11 qualifying sessions produced none: 8 `below_ignore_band` (Amalfi sessions that began at the 11:39/11:42 app opens, scores 30–45, see below), 2 `duplicate_pending` (Cosimo, Duomo second stays), and 1 `missed_exit`. |
| 5 Confirm / points / fan-out | Cosimo confirmed 18:35:37: one `historical_visit_confirmed` check-in (1 point, candidate linked, photo 4284×5712, memory "Cool") plus one list fan-out row carrying the photo (no points); one storage object. A second confirmation and a second check-in for the item are rejected by the database (`supabase/checks/visit_confirmation_integrity.sql`). |

## What the logs say about background behaviour (honest limits)
* iOS delivered sentinel exits **late and far out**, not at 1.5 km: re-centring fixes were 1.6–1.9 km out on three occasions but 2.6, 3.7 and 2.9 km out on the return, and the 10:59→11:39 bus ride to Amalfi (~5.6 km) produced **no** background exit at all until the app was opened at 11:39. The venue set therefore lagged the phone by kilometres at times: the Amalfi centre venues were not registered on arrival, their sessions started when the app was opened (11:39:16), so any earlier time there was (correctly) not counted.
* `sentinel_born_outside` exits followed every background re-registration within 1–2 s even though a fresh fix put the phone at the new sentinel's centre. They were gated (`gated_min_gap`) and harmless but caused needless `sentinel_retry` attempts. Fixed in `01a0f337`: such an exit is now only believed if a fresh fix agrees.
* One presence session (Il Pirata, Praiano, entered 18:05:28) was closed by the server as `missed_exit` at 18:30:40: its exit event was not delivered before the next enter elsewhere. No candidate, no credit (by design).
* Travel beyond cached coverage was **not exercised**: the farthest point (Ravello) is 9.3 km from the cache centre, well inside the 30 km safe radius, so the cache was never stale, outside its area, or refetched after 08:48.

## The badge discrepancy (3 vs 2, then 2 vs 1)
Candidate Rufolo (created 14:37) was for a place you had already checked off by hand at 14:03:26, during the stay. The inbox hid it (item already checked off); the Home/Profile badge counted every unexpired pending candidate. Badge 3 = Rufolo + Duomo + Cosimo; inbox 2 = Duomo + Cosimo. After confirming Cosimo: badge 2 = Rufolo + Duomo, inbox 1 = Duomo. Fixed: one shared rule (`lib/visitDetection/actionableCandidates.js`) for inbox and badges; refresh events after confirm, dismiss and any check-off; and the server no longer creates a candidate for an item already checked off (`already_checked_off`). Against your real rows the shared rule now returns 1 (Duomo), hiding Rufolo as already checked off.

## Da Adolfo
Monitored as a `restaurant` (15/60 min, 150 m circle). A stay there shows a meal at that address, not a boat ride from Positano's pier (it can also be reached on foot), so the defining action is not observable. Recorded as `manual_only` (`20260930f`). Also seen: at 18:30 the phone, back at Laurito lodging ~180 m away, opened sessions for Da Adolfo and Ceramiche Casola. The server accepts an entry within circle + up to 150 m of slack, so a stay at lodging near a monitored venue can open a session and, after 9–15 minutes, produce a false suggestion. Not changed tonight; see the report.
