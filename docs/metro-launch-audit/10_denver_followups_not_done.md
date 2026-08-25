# Denver launch — explicit follow-ups not done in this pass

Per the generation prompt's B6 and B8, these are deliberately out of scope here, not overlooked.

## B6 — Item staging (not started)

No Denver `items` rows were created or fabricated. This needs a real, separate intake session
once an actual Denver item list exists (venues, activities, google_place_ids, etc.) — not
something to draft speculatively. That session should follow the authoritative contract in
[05_item_intake_contract.md](05_item_intake_contract.md), specifically:

- `neighborhood_id` (not `city_id`) as the geography signal, chosen from the 19 rows created in
  `20260821_denver_metro_foundation.sql`
- `maps_lat`/`maps_lng` set via the confirmed-coordinate pattern (Google Places, same as the
  neighborhood centers in this pass — do not hand-guess), and set through the `update_item_location()`
  RPC once each item row exists, not a raw `UPDATE`
- `checkin_type` from the 3 live values (`tap`/`photo`/`gps`)
- `difficulty` from the 4 live values (1/5/10/25 — a points scale, not 1-5 difficulty)
- `season_tag` left NULL for launch per decision #2 (Denver launches non-seasonal/universal only)
- Given the ring-radius tiering in this pass, prefer setting each item's own `maps_lat`/`maps_lng`
  directly over relying on the neighborhood-center-copy fallback pattern, especially for
  tight-core items (Denver Central/RiNo/LoDo/Capitol Hill/Highlands) where even the tightened
  150-420m rings leave little margin for imprecise venue coordinates

## B8 — Asset gaps (flagged, not generated)

No images were produced — flagging what's needed and where it plugs in:

| Asset | Plugs into | Notes |
|---|---|---|
| Metro hero images (2-3, matching existing metros' count) | `metro_areas.hero_images` (text[]) — currently `'{}'` in the Section 1 INSERT | Random-picked on every Home load for the metro hero; with an empty array the app falls back to a gradient/no-photo look (cosmetic only, not blocking, per [02_app_metro_dependencies.md](02_app_metro_dependencies.md)) |
| Curated-list header images, one per audience group | `audience_groups.image_url` — currently NULL for all 8 rows in Section 3 | Shown on `BrowseListsScreen`'s group cards |
| Denver-aware onboarding replacement | `screens/OnboardingScreen.jsx:59`'s hardcoded `<SeasonalHeroCard emoji="🍂" title="Phoenix Fall 30" cityTag="Phoenix" />` mock, shown to every new user regardless of metro | Not a functional bug — every user sees "Phoenix Fall 30" in onboarding today, including Milwaukee/Tucson users — but a real content gap for a Denver-facing launch. No diff produced for this file in this pass since it needs real Denver marketing copy/imagery, not a mechanical code change. |

## Also not attempted in this pass (surfaced during generation, worth tracking)

- `lib/seasonWindow.js`'s `isWithinWindow()` callers (`screens/HomeScreen.jsx:359,972`,
  `components/PostCheckoffSheet.jsx:161,236,298`) are not yet updated to actually pass a metro
  timezone through — the function signature change alone (in the `lib_seasonWindow.js.diff`
  patch) doesn't change behavior until each caller is updated. See the follow-up note inside that
  diff file for the exact list and what each site needs.
- `season_days_until_start()`'s new `p_metro_id` parameter is unverified against any real caller
  — zero call sites exist in the app today. If/when it's wired up to a UI, re-verify.
- A genuine per-user "home metro" signal (for `get_never_checkin_users()` to eventually use
  instead of the metro-blind compromise in `20260821_never_checkin_users_metro_fix.sql`) would
  need new onboarding-flow + schema work — not attempted here.
- `checkoff_admin.html`'s current metro-dropdown behavior (`METRO_SLUGS` hardcode vs.
  derive-from-name pattern) remains unresolved — that file is outside this repo, per the original
  audit's README.
