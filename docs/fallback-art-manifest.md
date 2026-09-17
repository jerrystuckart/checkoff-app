# Archetype Fallback Artwork V1 — Asset Manifest

Documentation/config only — no binary assets are included or referenced
here as bundled files. Every entry's `status` is `pending`: none of these
`.webp` files exist in Storage yet. This manifest is the source of truth
for what Engineering/Design need to produce and upload; the runtime
registry — including the authoritative per-key `status` (`pending` |
`available`), in `ARCHETYPE_STATUS` — lives in `lib/fallbackArtSource.js`.
**`lib/fallbackArtSource.js` is the single source of truth for status.**
This manifest's `status` column is generated from/kept in sync with that
object by hand whenever either changes; if they ever disagree, the code
wins.

## Asset specification (corrected 2026-09-17 — previous "1600×1200" figure was wrong)

- Bucket: `checkoff-images` (public)
- Path convention: `item-fallbacks/<version>/<key>.webp` (versioned
  folder, unchanged — see "Rollback"/version-bump note below)
- Current version: `v1` (see `FALLBACK_ART_VERSION` in `lib/fallbackArtSource.js`)
- **Master dimensions: 1600 × 1000 px**
- **Aspect ratio: 8:5 (1.6:1)**
- Format: WebP
- Color space: sRGB
- No embedded text, logos, labels, or business branding of any kind —
  cards layer real RN `Text` on top via the existing gradient scrim.
- **Main visual interest/focal subject must sit in the right 40–45% of
  the frame.** The left 55% must stay dark, restrained, and text-safe —
  that's where the overlay eyebrow/title/body text renders, so it needs
  to read clearly over the image with only the standard scrim, not
  because the image itself is already busy there.
- Must tolerate crops from **roughly 1.45:1 up to 1.7:1** under
  `resizeMode="cover"` — the same master gets cropped differently across
  `WhatsTheThingHero`'s dominant hero, `EditorialCard`'s `primary`
  variant, and its narrower `rail`/`row` variants. Keep the right-side
  focal subject with enough margin that none of those crops clip it.
- **This one landscape (8:5) master does not cover every future surface.**
  A future portrait or square placement (e.g. a full-bleed Item Detail
  header, a square social/share card) will very likely need its own
  derivative crop or a separate master — do not assume the 1600×1000
  landscape master is sufficient for a layout that hasn't been designed
  yet.

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

## How a key becomes `available` (Approach A)

The client-side resolver (`lib/fallbackArtSource.js`'s `resolveFallbackArt`,
consumed by `lib/artworkResolution.js`'s `resolveArtworkTier`) only ever
returns a remote URL for a key whose `ARCHETYPE_STATUS` entry is
`'available'`. Every key defaults to `'pending'`, which resolves straight
to the generic graphic treatment with **no network request attempted at
all** — there is no 404 round-trip for artwork that doesn't exist yet.

To activate one key once its `.webp` is real:

1. Upload + validate the asset (see "Upload procedure" and "Validation
   procedure" below).
2. In `lib/fallbackArtSource.js`, flip that one key's entry in
   `ARCHETYPE_STATUS` from `'pending'` to `'available'`.
3. Update this manifest's status column for that key to match (generated
   from/kept in sync with step 2 by hand).
4. Ship that JS change through the normal build/OTA pipeline (see
   "Deployment order" below for when it's safe to do so relative to the
   `fallback_art_key` migration).

No other file needs to change, and no component (`ArchetypeArtwork.jsx`,
`EditorialCard.jsx`, `WhatsTheThingHero.jsx`) needs to be touched — they
all read the resolved `url`/`status` through `useCardArtwork` /
`resolveArtworkTier`, never the registry directly.

## Deployment order (production — NOT performed by this task)

This task only builds/hardens the client-side resolution + rendering
logic and this documentation. Applying any of the following steps against
a real database or Storage bucket is explicitly out of scope here. The
safe order, once artwork and a migration exist:

1. Upload final approved artwork to the versioned public Storage paths
   (`checkoff-images/item-fallbacks/v1/<key>.webp`).
2. Validate every public asset URL (see "Validation procedure" below).
3. Apply the nullable `fallback_art_key` migration
   (`supabase/migrations/20260917_items_fallback_art_key.sql`).
4. Confirm existing production binaries still function — the column is
   additive/nullable, so older installed builds that don't know about
   `fallback_art_key` keep working unaffected.
5. Test the new JavaScript (this resolver + these components) against the
   now-migrated schema.
6. Populate a small number of test-item `fallback_art_key` overrides, if
   desired (see "Activating one archetype on a single test item" below).
7. Publish an OTA update only after device QA of that build.
8. Expand overrides gradually from there.

**Explicit warnings:**

- **(a)** The OTA/build containing code that *queries* `fallback_art_key`
  must **NOT** be published before step 3 (the DB column existing) — a
  query against a column that doesn't exist yet will error for every
  client that receives that update early.
- **(b)** The migration itself (step 3) is backward-compatible on its own
  — the column is nullable with no default and no backfill, so it is safe
  to apply ahead of the OTA in step 7; existing/older clients that have
  never heard of the column are entirely unaffected by its existence.
- **(c)** A key's artwork must be uploaded, validated, AND marked
  `'available'` (see "How a key becomes available" above) before it is
  activated on any item — activating a `fallback_art_key` value whose
  registry status is still `'pending'` produces no unnecessary 404s
  precisely because Approach A never attempts the request, but it also
  means the item will keep showing the generic treatment until the status
  flip ships, which can look like "nothing happened" if that step is
  forgotten.

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
