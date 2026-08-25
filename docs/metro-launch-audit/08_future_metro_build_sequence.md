# Future metro build sequence (proposed, reusable)

This is a proposed dependency order for Denver (and any future metro), derived from the FK
structure confirmed in [01](01_current_schema_and_relationships.md). No SQL is included here —
this is a sequencing document, not an executable script.

## Dependency order

1. **Geography foundation**
   - `metro_areas` row (`is_active=false` initially — see staging recommendation in
     [07](07_denver_metro_manifest_draft.md))
   - `neighborhoods` rows (`metro_id` FK to step 1), with metro-appropriate `ring_*_radius_m`
     values, not the schema defaults
   - Fix required first: `metro_areas.timezone` column (new schema) if season_tag items are
     planned for launch — see [07](07_denver_metro_manifest_draft.md) open technical decision 1
   - Optional: `cities` row — confirmed non-essential (see [01](01_current_schema_and_relationships.md)
     item 5), skip unless a specific consumer needs it

2. **Tags/presentation layer**
   - `tags` (global, or metro-scoped if the new-schema decision in
     [07](07_denver_metro_manifest_draft.md) open decision 4 is made)
   - `categories` (likely already sufficient — global, not metro-scoped, confirm no new
     categories needed)
   - `audience_groups` rows (`city_slug` set to Denver's chosen slug), following Phoenix's
     8-group model or a right-sized Denver-specific set

3. **Item staging**
   - `items` rows — `neighborhood_id` set (not `city_id`), `maps_lat`/`maps_lng` populated via
     `update_item_location()` RPC (not raw UPDATE), `checkin_type` from the 3 valid values,
     `difficulty` from the 4 valid values (1/5/10/25), `season_tag` only if the timezone fix is
     in place
   - Run `scripts/geocode-items.js` (or equivalent) to guarantee every item has coordinates,
     closing the `useNearby.js` fallback-dictionary risk from [02](02_app_metro_dependencies.md)
   - Items create **zero** list memberships automatically — confirmed in [05](05_item_intake_contract.md)

4. **List shells**
   - `lists` rows: one official/public seasonal list per active window (earliest `ends_at` rule
     from [04](04_list_model_and_seasonal_selection.md)), themed/public lists, Local Guide lists
   - `curated_lists` rows for audience-group content, with **`curated_list_metros` rows
     explicitly created** rather than relying on unclear zero-row fallback semantics (open
     question in [04](04_list_model_and_seasonal_selection.md) — resolve before this step)

5. **List membership**
   - `list_items` rows: regular items + Bonus Drop items (`is_bonus_drop`, `unlock_threshold` —
     use thresholds 9/15 as the only confirmed-consistent convention; do not assume a fixed
     `sort_order` position for drops, per [01](01_current_schema_and_relationships.md))
   - `curated_list_items` rows for curated-list templates

6. **Activation**
   - Fix launch blockers 1-4 from [07](07_denver_metro_manifest_draft.md) if not already fixed
     platform-wide (they affect all metros, not just Denver, so ideally fixed once, not per-metro)
   - Flip `metro_areas.is_active=true` — confirmed as the actual city-selector gate
     ([07](07_denver_metro_manifest_draft.md))
   - Flip relevant `curated_lists.is_active=true` (only meaningful for admin-tool/product intent
     tracking until the RLS gap is fixed — does not currently gate public visibility)

7. **Verification**
   - Re-run the metro rollup query (query 10 in [00_schema_preflight.sql](00_schema_preflight.sql))
     scoped to Denver's `metro_id`
   - Re-run the official-lists collision query (query 14) scoped to Denver
   - Confirm `curated_list_metros` coverage for every Denver curated list intended to be
     Denver-only
   - Confirm item geocoding coverage (100% `maps_lat`/`maps_lng` populated, or explicit
     acceptance of the fallback-dictionary risk)

8. **Device QA**
   - City selector shows Denver, defaults correctly for a GPS-enabled test device physically in
     the Denver area
   - Home hero renders the correct single official list (not a stable-sort artifact)
   - Nearby/Discover correctly ring-tiers a sample of Denver items at varying real distances
   - Check-in near a list boundary date (`starts_at`/`ends_at`) confirmed correct in Denver local
     time — this is the direct test for launch blocker 1
   - Deep link test: an intentionally-broken/stale Denver list link should NOT fall through to
     Phoenix's BrowseLists (tests launch blocker 4's fix)
   - New zero-activity Denver test account confirmed to receive Denver-relevant (not
     Phoenix-hardcoded) re-engagement suggestions after 14 days (tests launch blocker 2's fix)

9. **Launch runbook**
   - Coordinated flip of `metro_areas.is_active=true` + any final curated-list activation +
     announcement/marketing timing — sequencing TBD by Jerry, not prescribed here

10. **Repair/rollback**
    - `metro_areas.is_active=false` is the safe, confirmed rollback lever (removes Denver from
      the city selector without deleting data)
    - No cascade-delete risk identified from `metro_areas` — its only FK dependents
      (`neighborhoods`, `metro_destinations`, `partner_pipeline`, `partner_promotions`,
      `spotlights`, `user_suggestions`, `lists.metro_id`) are all nullable or would need explicit
      handling; a true rollback (data removal) was not scoped by this audit (discovery-only) and
      should be planned separately if ever needed

## Reusable files this sequence implies (not created by this audit)

- A schema migration for `metro_areas.timezone` + the 4 function updates + `lib/seasonWindow.js`
  update (platform-wide fix, not Denver-specific)
- A schema/RLS migration for `curated_lists`' double-policy fix (platform-wide)
- A code fix for `get_never_checkin_users()` (platform-wide)
- A code fix for `BrowseListsScreen.jsx`'s fallback (platform-wide)
- A Denver-specific geography/items/lists staging script, once the open product decisions in
  [07](07_denver_metro_manifest_draft.md) are resolved — not generated in this audit per its
  explicit "no invented UUIDs, no mutation SQL" scope
