# Archetype Fallback Artwork V1 — Asset Manifest

Documentation/config only — no binary assets are included or referenced
here as bundled files. Every entry's `status` is `pending`: none of these
`.webp` files exist in Storage yet. This manifest is the source of truth
for what Engineering/Design need to produce and upload; the runtime
registry (validation + category defaults + URL construction) lives in
`lib/fallbackArtSource.js` and must be kept in sync with this list by hand
if either changes.

- Bucket: `checkoff-images` (public)
- Path convention: `item-fallbacks/<version>/<key>.webp`
- Current version: `v1` (see `FALLBACK_ART_VERSION` in `lib/fallbackArtSource.js`)
- Format: WebP, sRGB
- Recommended dimensions: 1600×1200 (4:3) source, exported so it still
  crops cleanly under `resizeMode="cover"` at both the hero aspect ratio
  (~4:3, `WhatsTheThingHero`'s image mode) and the narrower rail/row
  aspect ratios (`EditorialCard`'s `rail`/`row` variants) — keep the
  focal subject centered with generous margin, since edges get cropped
  differently per layout variant.
- No text/typography baked into the artwork — cards layer real RN `Text`
  on top via the existing gradient scrim.

| key | intended experience family | category defaults that resolve to it | storage path | status |
|---|---|---|---|---|
| restaurant_general | Generic sit-down dining / restaurant interior or plated food, warm ambient lighting | Food & drink | item-fallbacks/v1/restaurant_general.webp | pending |
| signature_food | A standout, ownable dish/plate — for items an editor wants to feel special vs. generic dining (explicit override only, no category default) | — | item-fallbacks/v1/signature_food.webp | pending |
| coffee | Coffee cup / cafe counter, moody warm light | — | item-fallbacks/v1/coffee.webp | pending |
| dessert | Dessert / sweets close-up | — | item-fallbacks/v1/dessert.webp | pending |
| beer | Beer glass / taproom | — | item-fallbacks/v1/beer.webp | pending |
| wine | Wine glass / bottle, low light | — | item-fallbacks/v1/wine.webp | pending |
| cocktails | Cocktail glass, bar backlight | Bar & drinks | item-fallbacks/v1/cocktails.webp | pending |
| hidden_entrance | Unmarked door / alley entrance, mystery framing | — | item-fallbacks/v1/hidden_entrance.webp | pending |
| outdoor_desert | Desert landscape, warm dusty tones | — | item-fallbacks/v1/outdoor_desert.webp | pending |
| outdoor_mountain | Mountain vista | — | item-fallbacks/v1/outdoor_mountain.webp | pending |
| outdoor_forest | Forest / trail canopy | — | item-fallbacks/v1/outdoor_forest.webp | pending |
| outdoor_water | Lake / river / waterfront | — | item-fallbacks/v1/outdoor_water.webp | pending |
| outdoor_winter | Snow / winter outdoor scene | — | item-fallbacks/v1/outdoor_winter.webp | pending |
| outdoor_general | Generic outdoor/adventure scene, no specific biome | Adventure | item-fallbacks/v1/outdoor_general.webp | pending |
| scenic_view | Overlook / skyline / travel vista | Travel | item-fallbacks/v1/scenic_view.webp | pending |
| historic_place | Historic architecture / landmark detail | — | item-fallbacks/v1/historic_place.webp | pending |
| arts_culture | Gallery / museum / mural, editorial framing | Arts & Culture | item-fallbacks/v1/arts_culture.webp | pending |
| live_entertainment | Stage lighting / crowd energy, low-key | Social, Nightlife | item-fallbacks/v1/live_entertainment.webp | pending |
| shopping_market | Market stall / retail storefront | Shopping | item-fallbacks/v1/shopping_market.webp | pending |
| games_play | Arcade / game table, playful lighting | Play | item-fallbacks/v1/games_play.webp | pending |
| sports | Athletic/field/court scene | Sports | item-fallbacks/v1/sports.webp | pending |
| wellness | Spa / calm, soft light | Spa & self-care | item-fallbacks/v1/wellness.webp | pending |
| local_oddity | Quirky/offbeat local curiosity, playful framing | Misc | item-fallbacks/v1/local_oddity.webp | pending |

## Upload procedure (when artwork is ready — NOT performed by this task)

1. Export the final image as WebP at the recommended dimensions above,
   named exactly `<key>.webp` (must match an `ARCHETYPE_KEYS` entry in
   `lib/fallbackArtSource.js` — the resolver rejects any other string).
2. Upload to the **public** `checkoff-images` bucket at
   `item-fallbacks/v1/<key>.webp`, via either:
   - Supabase Studio → Storage → `checkoff-images` → navigate/create the
     `item-fallbacks/v1/` folder → Upload file, or
   - the Supabase CLI: `supabase storage cp ./<key>.webp
     ss:///checkoff-images/item-fallbacks/v1/<key>.webp` (run against the
     project directly, project-scoped credentials — not part of this
     repo's migration/CLI-push workflow).
3. Do not overwrite an existing key's file in place if the art direction
   changes materially — publish under a new version folder (e.g. `v2/`)
   and bump `FALLBACK_ART_VERSION` in `lib/fallbackArtSource.js` instead,
   so any cached/CDN'd `v1` urls keep serving the old art until every
   client has picked up the new constant.

## Validation procedure

1. After uploading, confirm the object is public: open
   `https://uggusbbswybyplypkbxz.supabase.co/storage/v1/object/public/checkoff-images/item-fallbacks/v1/<key>.webp`
   directly in a browser — it should load the image with no auth header.
2. Confirm `lib/fallbackArtSource.js`'s `fallbackArtUrl('<key>')` produces
   that exact URL (covered by `lib/fallbackArtSource.test.js`).
3. Spot-check on device: the archetype only appears once
   `items.fallback_art_key` is set (or falls through to a mapped
   category) AND the item has no real approved photo — see activation
   steps below.

## Activating one archetype on a single test item (not executed by this task)

Once the migration has been applied (see the migration file's own header
and the report's "Migration application instructions" section) and at
least one `.webp` has been uploaded and validated:

```sql
update public.items
set fallback_art_key = 'coffee'
where id = '<test item uuid>';
```

or via the admin tool (`checkoff_admin.html`), if/when an item-edit field
for `fallback_art_key` is added there (not part of this task — see
"Remaining work before production").

## Rollback

- To remove an explicit override from a single item:
  `update public.items set fallback_art_key = null where id = '<item uuid>';`
  — the item falls back to its category default (or the generic graphic
  treatment) automatically, no code change needed.
- To pull a specific archetype out of rotation entirely (e.g. a bad
  asset), delete the Storage object at its path — every item resolving to
  that key falls back to the existing generic graphic treatment
  automatically via `ArchetypeArtwork`'s `onError` handling; no other
  cleanup required, and no client update is needed.
