# Denver/Boulder audience-group proposal (product-judgment draft — react to this, don't treat as settled)

Per decision #3: Phoenix's broad ~8-group model, adapted for Denver/Boulder/Longmont, not
Tucson's thin/none model. This is my judgment call on names/count/theming — every line below is
something to accept, reject, or rewrite, not a verified audit finding. `city_slug='denver'` on
every row, matching the audience_groups schema and the existing metros' pattern.

Phoenix's current 8 groups (for reference): Main Character Cardio, Ferda Girls, Trail Mix Crew,
Soft Launch Season, West Valley's Best, Snack Pack Survivors, The Heat Refugees, Wine Trail
Wanderers.

## Proposed 8 groups for Denver/Boulder

| # | Name | Kept / New | Reasoning (1 line) |
|---|---|---|---|
| 1 | **Trail Mix Crew** | Kept as-is | Outdoors/hiking culture is if anything more central to Denver/Boulder's identity than Phoenix's — no rename needed. |
| 2 | **Main Character Cardio** | Kept as-is | Fitness/wellness framing is city-agnostic and Denver is a famously fitness-forward metro (running, cycling, gyms) — translates directly. |
| 3 | **Soft Launch Season** | Kept as-is | Early-dating/new-relationship framing is a concept, not a place — no geographic dependency, works identically in any metro. |
| 4 | **Snack Pack Survivors** | Kept as-is | Same reasoning as #3 — food-crawl framing is portable. |
| 5 | **Powder Day People** | New, replaces "The Heat Refugees" | Phoenix's heat-avoidance framing doesn't map to Denver (no comparable extreme-heat problem); ski/mountain-day-trip culture is the closest Denver/Boulder equivalent — a distinctly local seasonal identity. |
| 6 | **Hoptimists** | New, replaces "Wine Trail Wanderers" | Denver/Boulder's brewery scene (RiNo, Boulder, Golden — Coors' hometown) is a stronger, more locally-specific identity than a wine-trail framing borrowed from Willcox/Phoenix. |
| 7 | **RiNo Rats** | New, replaces "West Valley's Best" (a Phoenix geo-specific slot) | Gives the arts-district/RiNo micro-culture its own identity group, mirroring how Phoenix carved out a geo-specific slot for its own distinct sub-area. |
| 8 | **Pearl Street Regulars** | New, geographic-flavor addition | Boulder's Pearl Street/college-town energy is distinct enough from core Denver that it likely deserves its own group rather than being folded into a Denver-wide one — flagged as the least certain of the 8, most likely candidate to cut or merge if 8 feels like too many for a launch metro. |

## Open questions for Jerry (not resolved by this draft)

- Is 8 the right count for a **launch** metro, or should Denver launch with fewer (e.g. the 4
  "kept as-is" ones, which require zero new copywriting) and add the 4 Denver-specific ones
  post-launch once there's real usage signal? Tucson launched with 0 audience groups and is
  functioning; Milwaukee launched with 6, several of which are `is_active=false` today (see
  [03_existing_metro_comparison.md](03_existing_metro_comparison.md)) — suggesting over-launching
  audience groups without content behind them is a real, already-observed failure mode worth
  avoiding for Denver.
- "Pearl Street Regulars" specifically risks being too Boulder-narrow for a metro-wide group —
  consider whether it should instead be a **curated list** *within* a broader group rather than
  its own `audience_groups` row.
- No emoji/tagline/description/image_url values are proposed here — those are copywriting, not
  structural, and are left for a separate pass once the group list itself is confirmed.

**If this proposal is approved as-is**, the mechanical `audience_groups` INSERT statements
implementing it are in
[supabase/migrations/20260821_denver_metro_foundation.sql](../../supabase/migrations/20260821_denver_metro_foundation.sql),
Section 3 — clearly delimited so it can be edited or skipped independently of Sections 1/2/4 if
the names/count above change.
