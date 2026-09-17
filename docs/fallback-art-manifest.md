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

## Asset prep / handoff status (2026-09-17 asset-integration pass)

All 23 approved source PNGs (from
`~/Downloads/checkoff-home-archetype-artwork-approved/`, outside this repo)
have been converted to the production spec and are staged locally,
**NOT yet uploaded to Storage**. This section's `status` column
(`approved_prepared`) is a **deployment-prep** status, separate from the
runtime `ARCHETYPE_STATUS` object in `lib/fallbackArtSource.js` — that
object still has **all 23 keys at `pending`** (see "How a key becomes
`available`" below) and is the only thing the app actually reads at
runtime. `approved_prepared` here just means "converted, checksummed, and
ready to upload" — it does NOT mean live, uploaded, or available.

- Converted with `scripts/build-archetype-artwork.js` (uses `cwebp` —
  install via `brew install webp` if not already on PATH — plus macOS
  `sips` for dimension verification).
- Output: exactly 1600×1000 WebP, quality 82, no metadata, written to the
  git-ignored local handoff directory `assets-handoff/item-fallbacks/v1/`
  (see `.gitignore`'s `/assets-handoff/` entry) — these 23 binary files are
  **not** committed to git.
- SHA-256 checksums below were computed with `shasum -a 256` against the
  converted `.webp` files and also written machine-readably to
  `assets-handoff/item-fallbacks/v1/_build-manifest.json` (also git-ignored).

| key | intended experience family | approved source (outside repo) | converted handoff path (git-ignored) | expected Storage object path | dims | size | SHA-256 | prep status | category defaults using this key |
|---|---|---|---|---|---|---|---|---|---|
| restaurant_general | Generic sit-down dining / restaurant interior or plated food | ~/Downloads/checkoff-home-archetype-artwork-approved/restaurant_general.png | assets-handoff/item-fallbacks/v1/restaurant_general.webp | checkoff-images/item-fallbacks/v1/restaurant_general.webp | 1600x1000 | 129.9 KB | `799de4828e8e252c4a7d7de675d5dcf45e5819ee3d5813024a1400dc533a27d5` | approved_prepared | Food & drink |
| signature_food | A standout, ownable dish/plate | ~/Downloads/checkoff-home-archetype-artwork-approved/signature_food.png | assets-handoff/item-fallbacks/v1/signature_food.webp | checkoff-images/item-fallbacks/v1/signature_food.webp | 1600x1000 | 143.0 KB | `47519f91fd4b42bac36fc519e5f26e3d04a77a49787035277017cc454e6dd946` | approved_prepared | — |
| coffee | Coffee cup / cafe counter | ~/Downloads/checkoff-home-archetype-artwork-approved/coffee.png | assets-handoff/item-fallbacks/v1/coffee.webp | checkoff-images/item-fallbacks/v1/coffee.webp | 1600x1000 | 114.1 KB | `3ccb3b2d0c546da3dd4904fb1907c0897e7a40732bd704576f1f2e6e41307ebe` | approved_prepared | — |
| dessert | Dessert / sweets close-up | ~/Downloads/checkoff-home-archetype-artwork-approved/dessert.png | assets-handoff/item-fallbacks/v1/dessert.webp | checkoff-images/item-fallbacks/v1/dessert.webp | 1600x1000 | 148.9 KB | `e7b607b2bb9c38c1f25d4b21295bbc0a8f528447ace4eaa56e0d5887da40d01e` | approved_prepared | — |
| beer | Beer glass / taproom | ~/Downloads/checkoff-home-archetype-artwork-approved/beer.png | assets-handoff/item-fallbacks/v1/beer.webp | checkoff-images/item-fallbacks/v1/beer.webp | 1600x1000 | 168.9 KB | `afa0f8682cac5571e43b6a97f957b1b0b4ed07b86c94ca6b892f9bac2b1cac57` | approved_prepared | — |
| wine | Wine glass / bottle, low light | ~/Downloads/checkoff-home-archetype-artwork-approved/wine.png | assets-handoff/item-fallbacks/v1/wine.webp | checkoff-images/item-fallbacks/v1/wine.webp | 1600x1000 | 161.9 KB | `da9c2f6d9377cefc72c9f2ee02e7a8af3b7fb85ee3c7d5ffa4fbc8cf4e51d065` | approved_prepared | — |
| cocktails | Cocktail glass, bar backlight | ~/Downloads/checkoff-home-archetype-artwork-approved/cocktails.png | assets-handoff/item-fallbacks/v1/cocktails.webp | checkoff-images/item-fallbacks/v1/cocktails.webp | 1600x1000 | 177.7 KB | `642532c447e33579a1b76f3a267cd6ad5486481b88e146532ac07ba7ee24bcae` | approved_prepared | Bar & drinks |
| hidden_entrance | Unmarked door / alley entrance, mystery framing | ~/Downloads/checkoff-home-archetype-artwork-approved/hidden_entrance.png | assets-handoff/item-fallbacks/v1/hidden_entrance.webp | checkoff-images/item-fallbacks/v1/hidden_entrance.webp | 1600x1000 | 98.3 KB | `89131ece5bd33ce78013f1066280b7213bae24c7af51189c0c005bc2a9aaa7ab` | approved_prepared | — |
| outdoor_desert | Desert landscape, warm dusty tones | ~/Downloads/checkoff-home-archetype-artwork-approved/outdoor_desert.png | assets-handoff/item-fallbacks/v1/outdoor_desert.webp | checkoff-images/item-fallbacks/v1/outdoor_desert.webp | 1600x1000 | 188.5 KB | `222359a828294e3f6eba96449c170b0418ea236570697d9cd4bdae42cd467f12` | approved_prepared | — |
| outdoor_mountain | Mountain vista | ~/Downloads/checkoff-home-archetype-artwork-approved/outdoor_mountain.png | assets-handoff/item-fallbacks/v1/outdoor_mountain.webp | checkoff-images/item-fallbacks/v1/outdoor_mountain.webp | 1600x1000 | 155.9 KB | `77632d9c0633dd24f4a25e203d58cd790b2d3678f0522da23132d26e89f2090f` | approved_prepared | — |
| outdoor_forest | Forest / trail canopy | ~/Downloads/checkoff-home-archetype-artwork-approved/outdoor_forest.png | assets-handoff/item-fallbacks/v1/outdoor_forest.webp | checkoff-images/item-fallbacks/v1/outdoor_forest.webp | 1600x1000 | 212.2 KB | `2778742fe4e13cd8aa72b5db5efb8fcc71b991b93e780e1012d9e4482afeb901` | approved_prepared | — |
| outdoor_water | Lake / river / waterfront | ~/Downloads/checkoff-home-archetype-artwork-approved/outdoor_water.png | assets-handoff/item-fallbacks/v1/outdoor_water.webp | checkoff-images/item-fallbacks/v1/outdoor_water.webp | 1600x1000 | 188.8 KB | `121f79c493d5658255b5942c34daee681f1eff5c58ba498ac5dcbf2d481a72bc` | approved_prepared | — |
| outdoor_winter | Snow / winter outdoor scene | ~/Downloads/checkoff-home-archetype-artwork-approved/outdoor_winter.png | assets-handoff/item-fallbacks/v1/outdoor_winter.webp | checkoff-images/item-fallbacks/v1/outdoor_winter.webp | 1600x1000 | 239.5 KB | `1b6cf4e988c2137be4910e9e3d9119654c4ae0b18679f7f4102b124a0cc8a473` | approved_prepared | — |
| outdoor_general | Generic outdoor/adventure scene | ~/Downloads/checkoff-home-archetype-artwork-approved/outdoor_general.png | assets-handoff/item-fallbacks/v1/outdoor_general.webp | checkoff-images/item-fallbacks/v1/outdoor_general.webp | 1600x1000 | 186.0 KB | `86d608077f2d92c9a44c9cf8e2edea26b31a6c0a26943607de147f01bbef6727` | approved_prepared | Adventure |
| scenic_view | Overlook / skyline / travel vista | ~/Downloads/checkoff-home-archetype-artwork-approved/scenic_view.png | assets-handoff/item-fallbacks/v1/scenic_view.webp | checkoff-images/item-fallbacks/v1/scenic_view.webp | 1600x1000 | 152.3 KB | `9429c4566fb5e37cfa25c01cf9dfcea7c50304c0c4bc3594f8bb15ae768d2895` | approved_prepared | Travel |
| historic_place | Historic architecture / landmark detail | ~/Downloads/checkoff-home-archetype-artwork-approved/historic_place.png | assets-handoff/item-fallbacks/v1/historic_place.webp | checkoff-images/item-fallbacks/v1/historic_place.webp | 1600x1000 | 196.7 KB | `127279b7f21a46353f164580242b31fe8cdcd4a2756f8596215686464b7e017f` | approved_prepared | — |
| arts_culture | Gallery / museum / mural, editorial framing | ~/Downloads/checkoff-home-archetype-artwork-approved/arts_culture.png | assets-handoff/item-fallbacks/v1/arts_culture.webp | checkoff-images/item-fallbacks/v1/arts_culture.webp | 1600x1000 | 161.6 KB | `7c14b2b962f983db6481dd0bbef584812d30ab0412fab2fa8c300882c8d668f4` | approved_prepared | Arts & Culture |
| live_entertainment | Stage lighting / crowd energy, low-key | ~/Downloads/checkoff-home-archetype-artwork-approved/live_entertainment.png | assets-handoff/item-fallbacks/v1/live_entertainment.webp | checkoff-images/item-fallbacks/v1/live_entertainment.webp | 1600x1000 | 138.4 KB | `1e7f8aeb8c8881bed4c6777246a0666a26d3c5ab67b40e0f6e47d7665ae0cdaf` | approved_prepared | Social, Nightlife |
| shopping_market | Market stall / retail storefront | ~/Downloads/checkoff-home-archetype-artwork-approved/shopping_market.png | assets-handoff/item-fallbacks/v1/shopping_market.webp | checkoff-images/item-fallbacks/v1/shopping_market.webp | 1600x1000 | 187.1 KB | `62e88e708194d4ff6f6061d25adb5463bba4d8b7e8af1e98a4e6a78a81dca81c` | approved_prepared | Shopping |
| games_play | Arcade / game table, playful lighting | ~/Downloads/checkoff-home-archetype-artwork-approved/games_play.png | assets-handoff/item-fallbacks/v1/games_play.webp | checkoff-images/item-fallbacks/v1/games_play.webp | 1600x1000 | 163.2 KB | `8660bd64648d7206aa4ccd6673486b6fe47b8fd7a007a32dcf759fd30e0278a6` | approved_prepared | Play |
| sports | Athletic/field/court scene | ~/Downloads/checkoff-home-archetype-artwork-approved/sports.png | assets-handoff/item-fallbacks/v1/sports.webp | checkoff-images/item-fallbacks/v1/sports.webp | 1600x1000 | 227.7 KB | `208c9ef4edcb6f8e376e655957eabd542114721888989d71c7b788da56b99e12` | approved_prepared | Sports |
| wellness | Spa / calm, soft light | ~/Downloads/checkoff-home-archetype-artwork-approved/wellness.png | assets-handoff/item-fallbacks/v1/wellness.webp | checkoff-images/item-fallbacks/v1/wellness.webp | 1600x1000 | 187.0 KB | `e5368e57e910c48a688571daf7b1715d6029aaf64992efbe6a6dcf60ff06a6c7` | approved_prepared | Spa & self-care |
| local_oddity | Quirky/offbeat local curiosity, playful framing | ~/Downloads/checkoff-home-archetype-artwork-approved/local_oddity.png | assets-handoff/item-fallbacks/v1/local_oddity.webp | checkoff-images/item-fallbacks/v1/local_oddity.webp | 1600x1000 | 161.9 KB | `37e66bfe369c414f5fbf8440af98fd94fc17a8694ddf83e908602b69960e19a7` | approved_prepared | Misc |

### Prepared post-upload activation patch (NOT applied/imported anywhere live)

Once all 23 objects are uploaded and verified (see "Upload procedure" and
`scripts/verify-archetype-artwork-urls.js` below), the ONLY code change
needed is replacing `lib/fallbackArtSource.js`'s `ARCHETYPE_STATUS`
initializer. Today it is generated as all-`pending`:

```js
export const ARCHETYPE_STATUS = Object.fromEntries(ARCHETYPE_KEYS.map((key) => [key, 'pending']))
```

Post-upload, once every key has been individually verified, it becomes an
explicit object with all 23 keys marked `'available'` (kept as a plain,
explicit object — not a generated one — so a future partial rollback, e.g.
one bad asset pulled from rotation, is a one-line diff on a single key
instead of restructuring the generator call):

```js
export const ARCHETYPE_STATUS = {
  restaurant_general: 'available',
  signature_food: 'available',
  coffee: 'available',
  dessert: 'available',
  beer: 'available',
  wine: 'available',
  cocktails: 'available',
  hidden_entrance: 'available',
  outdoor_desert: 'available',
  outdoor_mountain: 'available',
  outdoor_forest: 'available',
  outdoor_water: 'available',
  outdoor_winter: 'available',
  outdoor_general: 'available',
  scenic_view: 'available',
  historic_place: 'available',
  arts_culture: 'available',
  live_entertainment: 'available',
  shopping_market: 'available',
  games_play: 'available',
  sports: 'available',
  wellness: 'available',
  local_oddity: 'available',
}
```

This snippet is documentation only — it is not imported, referenced, or
active anywhere in the live codebase. Applying it for real means editing
`lib/fallbackArtSource.js` directly (a one-file diff), re-running
`lib/fallbackArtSource.test.js` (several existing tests assert every key is
`pending` today and will need their fixtures/expectations revisited at that
point), and shipping through the normal OTA pipeline — never before the
upload + verification steps above are complete. A doc snippet was chosen
over a `.diff` file because `ARCHETYPE_STATUS` is a single generated
one-liner today; a real diff against it would be nearly unreadable (it
would appear to delete/replace the entire line), whereas showing the full
target object inline is unambiguous about exactly what "activated" state
looks like.

### Prepared upload + verification scripts (NOT run against real Storage by this task)

- `scripts/upload-archetype-artwork.js` — uploads all 23
  `assets-handoff/item-fallbacks/v1/*.webp` files to the pre-existing
  public `checkoff-images` bucket, `item-fallbacks/v1/<key>.webp`, with
  `content-type: image/webp` and `cache-control: public, max-age=31536000,
  immutable` (safe because each version folder is immutable by convention —
  a changed asset ships under a new `v2/` folder, never an in-place
  overwrite). Fails fast if any of the 23 local files is missing, and
  uploads with `upsert: false` so it refuses to silently overwrite an
  object that unexpectedly already exists at a "new" v1 path. Supports
  `--dry-run` (lists what would upload, no network call, no credentials
  needed) — this task ran `--dry-run` only, confirming all 23 local files
  resolve correctly; it did NOT run a real upload.
- `scripts/verify-archetype-artwork-urls.js` — GETs all 23 public URLs
  (built via `lib/fallbackArtSource.js`'s `fallbackArtUrl()`) and checks
  for HTTP 200 + `image/webp`. This task ran it once as a smoke test of the
  script itself — every URL correctly came back `400`/object-not-found,
  which is the **expected** result of nothing being uploaded yet, not a
  failed verification. Do not flip any `ARCHETYPE_STATUS` entry until a
  real post-upload run of this script reports all 23 as OK.

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

This task (2026-09-17 asset-integration/release-prep pass) only converts
approved artwork to the production spec, stages it locally
(git-ignored), prepares upload/verification/activation artifacts, and
updates this documentation. Applying any of the following steps against a
real database or Storage bucket is explicitly out of scope here — nothing
below has been executed against production. The exact required order:

1. Review the local commit and visual QA (static code trace — see
   "Visual QA" note below; this repo has no RN render harness).
2. Apply the nullable `fallback_art_key` migration
   (`supabase/migrations/20260917_items_fallback_art_key.sql`) —
   `supabase db push` (or `supabase migration up`, matching whichever this
   repo's established convention turns out to be at apply time).
3. Verify `items.fallback_art_key` exists:
   ```sql
   select column_name, data_type, is_nullable
   from information_schema.columns
   where table_schema = 'public' and table_name = 'items' and column_name = 'fallback_art_key';
   ```
4. Upload all 23 WebP assets (`scripts/upload-archetype-artwork.js`, real
   run, not `--dry-run` — requires `SUPABASE_SERVICE_ROLE_KEY`).
5. Verify all 23 Storage objects and public URLs
   (`scripts/verify-archetype-artwork-urls.js` — must report 23/23 OK
   before continuing).
6. Change all verified registry statuses from `pending` to `available` in
   `lib/fallbackArtSource.js`'s `ARCHETYPE_STATUS` (see the "Prepared
   post-upload activation patch" snippet above) — only after step 5 passes
   for all 23.
7. Run tests again (`npm run whats-good:test`, `node --test
   lib/fallbackArtSource.test.js lib/artworkResolution.test.js`, etc. —
   several existing `fallbackArtSource.test.js` assertions currently expect
   every key to be `pending` and will need revisiting once step 6 lands).
8. Commit the activation change (its own commit, separate from this
   asset-prep commit).
9. Push the approved commits.
10. Publish the OTA only to the correct production channel and runtime —
    do not assume the currently configured EAS runtime matches installed
    binaries; inspect `app.json`'s `runtimeVersion` policy first (known to
    be `"fingerprint"` as of the last audit, meaning Expo computes the
    runtime version from a hash of native code/config — an OTA only
    reaches installed binaries whose fingerprint matches the one this
    JS-only change was built against; if a native dependency changed since
    the last build, this OTA may not reach the binaries you expect, and a
    full EAS build would be needed instead).
11. Verify the update on actual installed iOS and Android builds.
12. Monitor Home image failures and Supabase Storage traffic.
13. Roll back the OTA if necessary while leaving the harmless nullable
    column and Storage objects in place (see "Rollback" below — neither
    needs reverting just because the OTA was rolled back).

**Explicit warnings:**

- **(a)** The OTA/build containing code that *queries* `fallback_art_key`
  must **NOT** be published before step 2 (the DB column existing). See
  "Migration compatibility review" below for exactly what breaks and why
  if this order is violated.
- **(b)** The migration itself (step 2) is backward-compatible on its own
  — the column is nullable with no default and no backfill, so it is safe
  to apply ahead of the OTA in step 10; existing/older clients that have
  never heard of the column are entirely unaffected by its existence.
- **(c)** Do not mark any key `available` (step 6) before every
  corresponding Storage object is verified (step 5) for that key — a key's
  artwork must be uploaded, validated, AND marked `'available'` before
  it's activated on any item. Activating a `fallback_art_key` value whose
  registry status is still `'pending'` produces no unnecessary 404s
  precisely because Approach A never attempts the request, but it also
  means the item will keep showing the generic treatment until the status
  flip ships, which can look like "nothing happened" if that step is
  forgotten.
- **(d)** Do not overwrite or delete existing Storage objects without
  confirming exact targets first — `scripts/upload-archetype-artwork.js`
  uploads with `upsert: false` specifically so an unexpected pre-existing
  object at a "new" v1 path fails the upload instead of silently
  overwriting it.

## Migration compatibility review (2026-09-17 — review only, not applied)

Reviewed `supabase/migrations/20260917_items_fallback_art_key.sql` against
this deployment order:

- **Nullable, additive, no backfill, no destructive change.** `ALTER TABLE
  public.items ADD COLUMN IF NOT EXISTS fallback_art_key text;` — no
  `NOT NULL`, no `DEFAULT`, no data rewrite, no index, no RLS policy
  change. `IF NOT EXISTS` makes re-running it a no-op rather than an error.
- **Older installed app builds remain compatible after this migration
  applies.** Those builds never reference `fallback_art_key` in any select
  (they predate this feature entirely), so an unused nullable column is
  invisible to them — additive-only, no client-visible change.
- **Applying the migration before the OTA is the correct order (and the
  only safe order).** The reverse — publishing OTA code that selects
  `fallback_art_key` before the column exists — WOULD break the affected
  screens. This codebase's Supabase queries embed explicit column lists
  (e.g. `lib/useItems.js`/`lib/useNearby.js`'s item selects, which would
  need `fallback_art_key` added to their column list to actually consume
  it) via `@supabase/supabase-js`, which sends that select list to
  PostgREST as the `select=` query parameter. PostgREST validates every
  requested column against the live schema and returns an HTTP 400 with a
  Postgrest error body (`column items.fallback_art_key does not exist`)
  for the entire request if any requested column is missing — it does not
  omit just that field. supabase-js surfaces that as a non-null `error` on
  the query result. Any screen whose query was updated to request
  `fallback_art_key` (Home's rails/lists) would receive `data: null` for
  that whole query and would need to handle the error gracefully — at
  best a degraded/empty Home section, at worst an unhandled-error state,
  depending on how each hook currently handles a query error. This is why
  step 2 (migration) must precede any OTA whose query was changed to
  request the new column.
- **Rollback:** the column does not need reverting if the OTA is rolled
  back — an unused, nullable column with no dependents is harmless and
  backward-compatible left in place. If it's ever removed, `ALTER TABLE
  public.items DROP COLUMN IF EXISTS fallback_art_key;` (not needed for
  this task, not executed).

## Upload procedure (when artwork is ready — NOT performed by this task)

The 23 v1 assets are already converted and staged locally at
`assets-handoff/item-fallbacks/v1/*.webp` (git-ignored; see "Asset prep /
handoff status" above) — produced by `scripts/build-archetype-artwork.js`
from the approved PNG originals. When ready to actually upload:

1. `SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-archetype-artwork.js
   --dry-run` first, to confirm all 23 local files are present and see the
   exact object paths/content-type/cache-control that will be used, with
   no network call made.
2. `SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-archetype-artwork.js`
   (real run) — uploads to the **public** `checkoff-images` bucket at
   `item-fallbacks/v1/<key>.webp` for all 23 keys, `content-type:
   image/webp`, `cache-control: public, max-age=31536000, immutable`,
   `upsert: false` (fails loudly instead of silently overwriting anything
   unexpected already at that path).
3. Do not overwrite an existing key's file in place if the art direction
   changes materially — publish under a new version folder (e.g. `v2/`)
   and bump `FALLBACK_ART_VERSION` in `lib/fallbackArtSource.js` instead,
   so any cached/CDN'd `v1` urls keep serving the old art until every
   client has picked up the new constant.

Neither script was run for real against Storage by this task — only
`upload-archetype-artwork.js --dry-run` (no network call, no credentials)
was exercised, to confirm the file set resolves correctly.

## Validation procedure

1. After uploading, run `node scripts/verify-archetype-artwork-urls.js` —
   checks all 23 public URLs for HTTP 200 + `image/webp` in one pass, and
   exits non-zero if any aren't ready yet. (This task ran it once with
   nothing uploaded, as a smoke test of the script itself — every URL
   correctly 400'd; that is the expected result of an empty bucket path,
   not a passed validation.) Equivalently, open
   `https://uggusbbswybyplypkbxz.supabase.co/storage/v1/object/public/checkoff-images/item-fallbacks/v1/<key>.webp`
   directly in a browser for a single key — it should load the image with
   no auth header.
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
