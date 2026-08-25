# Follow-up: finish timezone threading + verify foundation SQL placeholders

Generated 2026-08-21, same day as the original generation pass
([11_denver_generation_summary.md](11_denver_generation_summary.md)). **Nothing in this pass was
applied, committed, pushed, built, or deployed.** All changes are new diff files or edits to
already-unapplied migration files that were never run.

## Task 1 — `lib/seasonWindow.js` call-site threading

### Result: 5 of 6 real call sites now threaded; 1 flagged as genuinely ambiguous, not guessed at

| Call site | Status | Metro source used |
|---|---|---|
| `screens/HomeScreen.jsx:359` (seasonal "N of M" count, inside `loadForMetro`) | **Threaded** | New local `resolvedTimezone` const, resolved from `metroId` param directly (not `selectedMetro` state — see below) |
| `screens/HomeScreen.jsx:972` (per-list themed-rail progress, separate `useEffect`) | **Threaded** | New `metroTimezone` component state, set by the same `loadForMetro` call that produces `officialLists` |
| `screens/HomeScreen.jsx:582` (inside `loadNearbyRail`) | **NOT threaded — flagged as genuinely ambiguous** | See below |
| `components/PostCheckoffSheet.jsx:161` (active-seasonal-list branch) | **Threaded** | `listRow.metro_areas.timezone`, riding the existing `lists.metro_id` FK via an embedded select — no extra round trip |
| `components/PostCheckoffSheet.jsx:236` (standalone check-off, active public list found) | **Threaded** | `best.metro_areas.timezone`, same FK-embed pattern (required adding `metro_id` to that query's select, which wasn't there before) |
| `components/PostCheckoffSheet.jsx:298` (Also Here/Nearest Next season exclusion) | **Threaded** | `myHood.metro_areas.timezone`, riding `neighborhoods.metro_id`, reusing a query this block already made |

Diffs: [patches/HomeScreen.jsx.diff](patches/HomeScreen.jsx.diff),
[patches/PostCheckoffSheet.jsx.diff](patches/PostCheckoffSheet.jsx.diff). Both apply on top of
the original [patches/lib_seasonWindow.js.diff](patches/lib_seasonWindow.js.diff) (updated in
this pass — see below) — all three must be applied together.

### `lib/seasonWindow.js` itself: no signature change needed

The prior pass's `isWithinWindow(checkedAt, startsAt, endsAt, metroTimezone = 'America/Phoenix')`
signature is sufficient for all 6 call sites — every one just needed to pass (or not pass) a 4th
argument. Only the diff file's own trailing documentation was updated to reflect which sites are
now actually threaded and to explain the one that isn't.

### The one flagged, unresolved site: `HomeScreen.jsx:582`, inside `loadNearbyRail()`

This is the "Near you right now" rail — confirmed (both by this file's own code comments and the
original audit) to be **intentionally metro-agnostic by design**: it pulls candidate items
system-wide across every metro simultaneously, ranked by real GPS distance, independent of
whichever metro is selected. The `checkins` batch being tested here can contain check-ins for
items belonging to different metros at once, and the query doesn't join back to each item's
metro at all.

This is a genuinely different situation from the "seasons table is global" reasoning the prior
pass used to (mis)justify leaving this site untouched — that reasoning was about the season
*window* being metro-agnostic, which doesn't actually mean the *timestamp-to-local-date
conversion* should be too. The real reason this site can't be cleanly fixed is that **there is no
single correct timezone value for a multi-metro batch of check-ins** — passing any one metro's
timezone would be exactly as wrong as the current default for every check-in belonging to a
different metro. A correct fix needs a per-check-in (or per-item) metro join, which is a bigger
change than parameter-threading — not attempted here, flagged explicitly rather than guessed at,
per the instruction not to pick an arbitrary answer for a genuinely ambiguous site.

## Task 1 (bonus finding) — Milwaukee's timezone backfill was wrong, now fixed

While tracing the "byte-for-byte unchanged, except Milwaukee/Tucson which should now correctly
resolve to their own timezone if it differs" instruction, I checked what the original
`20260821_metro_timezone_platform_fix.sql` actually backfilled: **all three existing metros,
including Milwaukee, to `'America/Phoenix'`.** That's wrong. Milwaukee, WI is in the Central time
zone (`America/Chicago`) — a genuinely different IANA zone from Phoenix's, not a relabeling of
the same offset (Chicago observes DST and sits one to two hours ahead of Phoenix depending on the
time of year; Phoenix never observes DST). Tucson, AZ correctly stays `America/Phoenix` — Arizona
has no DST, so Tucson and Phoenix share the exact same offset at every moment of the year, making
that one a genuine byte-for-byte equivalence, not an oversight.

**Fixed in place** in `supabase/migrations/20260821_metro_timezone_platform_fix.sql`: Milwaukee
now backfills to `'America/Chicago'`, with a comment explaining why "preserve current behavior"
doesn't mean "backfill Milwaukee to Phoenix's zone again" — the current behavior for Milwaukee
*is* the bug (confirmed live in the original audit: Milwaukee already has 56 `season_tag` items
whose visibility is being computed on Arizona's clock today). Shipping a `timezone` column
specifically to fix this, then re-encoding the same wrong value into it for Milwaukee, would have
defeated the point of the column. This is a genuine, intentional behavior change for Milwaukee —
not a "preserve exactly" backfill like Phoenix and Tucson's.

**This also means the original generation summary's verification query was wrong** — updated in
[11_denver_generation_summary.md](11_denver_generation_summary.md) to expect
`milwaukee = America/Chicago` instead of `America/Phoenix`.

## Task 2 — foundation SQL placeholder verification

Ran a live read-only query against all 17 current `is_official=true AND is_public=true` lists
across Phoenix, Milwaukee, and Tucson (`creator_id`, `title`, `starts_at`/`ends_at`, joined to
`users` for creator details).

### `creator_id`: the original placeholder was fragile, not wrong — now fixed to the verified pattern

**Finding**: 100% of 17 rows — no exceptions — have `creator_id` equal to the single `is_admin =
true` user in the entire `users` table (`jerrystuckart@hotmail.com`,
`11275026-65be-4421-80a4-46c57195408b`). There is exactly one admin account in the system today.

The original placeholder subquery (`SELECT id FROM users WHERE is_admin = true ORDER BY
created_at LIMIT 1`) would have resolved to this exact same row today, purely because there's
only one admin — so it wasn't *wrong* by coincidence, but it was never verified, and "oldest
admin" is not the real pattern; it would silently pick a different (and wrong) row the moment a
second admin account exists. **Fixed** to resolve by email instead
(`WHERE email = 'jerrystuckart@hotmail.com' AND is_admin = true`), matching the actual verified
usage rather than an ordering heuristic that happened to produce the same answer today.

### Title format: verified correct, no fix needed

Of those 17 rows, the subset that are each metro's actual seasonal-hero list (as opposed to a
themed list like "Roosevelt Row" that also happens to carry `is_official=true`) follows
`"{Season} {Year} — {Metro} Metro"` with zero exceptions across all three metros ("Summer 2026 —
Phoenix Metro", "Fall 2026 — Milwaukee Metro", "Summer 2026 — Tucson Metro", etc.) — this matches
doc 04/03's documented convention exactly. **No correction needed.** The placeholder's literal
title text was changed from the invented word `"Launch 2026"` (not a real season) to an explicit
`"{SEASON} {YEAR} — Denver Metro"` token, so the format is verified-correct while the actual
season/year remain an obvious, unmistakable placeholder rather than a plausible-looking fake value
that could get applied by accident.

### `starts_at`/`ends_at`: left as an open placeholder, as instructed

No season/date pattern was invented — which season Denver launches in, and its exact dates, is
Jerry's call, not something inferable from the other three metros' historical dates.

## Confirmation

No SQL was executed against the database beyond read-only `SELECT` queries via `supabase db
query --linked` (used to pull the real official-list data compared against in Task 2, and to
double-check the users/admin table). No migrations were applied. No files were committed. No
branch was pushed. No build or deploy was triggered.
`supabase/migrations/20260821_metro_timezone_platform_fix.sql` and
`supabase/migrations/20260821_denver_metro_foundation.sql` were edited in place (they are new,
never-applied files from the prior pass, not tracked-and-previously-applied code, so editing them
directly — rather than diffing — is consistent with how they were generated originally).
`screens/HomeScreen.jsx`, `components/PostCheckoffSheet.jsx`, and `lib/seasonWindow.js` remain
completely untouched in the working tree; their changes exist only as `.diff` files under
`patches/`.
