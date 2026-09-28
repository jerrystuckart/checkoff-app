# Amalfi Coast item-detail Directions/Website audit — 2026-09-28

## What actually gates Directions/Website (traced in code, not assumed)
`screens/ItemDetailScreen.jsx` never re-fetches the item — `hasLoc`/`hasWeb` (line ~1461-1462) read
`route.params.item` exactly as whatever screen navigated here built it:
```
hasLoc = item.maps_query || ((item.maps_lat ?? item.mapsLat) && (item.maps_lng ?? item.mapsLng))
hasWeb = !!item.website_url
```
`google_place_id` is NOT required by the app anywhere — only `maps_query` or `maps_lat`+`maps_lng`, and
`website_url`. Both buttons (plus Save) are additionally inside `{userId && (...)}` — signed-out shows neither.

## Database audit — clean
61 active Amalfi Coast items. Every one has `maps_query` and/or `maps_lat`+`maps_lng` (100%). 53/61 have a real
`website_url`; 8 legitimately have no official site (churches/beaches/localities) — correctly `null`, not a bug.
Raw dump: `item-detail-audit-raw.json`.

## Two real code bugs found and fixed (catalog-wide, not Amalfi-specific)
Every item-list-producing query in the app was audited (`lib/useItems.js`, `lib/useNearby.js`,
`screens/DiscoverScreen.jsx` x2, `screens/SavedItemsScreen.jsx`, `screens/DeepLinkItemResolverScreen.jsx`,
`lib/whatsGoodDataAdapter.js`+`useWhatsGood.js` hydration) — all correctly select `maps_query`/`website_url`.
Two did not:

1. **`screens/CreatorProfileScreen.jsx`** — the creator-list fetch and the item-detail nav payload it builds
   both omitted `maps_query` and `website_url` entirely. Website was unconditionally hidden for anyone browsing
   a creator's public list; Directions would fail for any item relying on `maps_query` alone (the normal state
   for an item before its geocoding pass). No Amalfi item is currently on a creator list, so this wasn't the
   cause of what was seen today, but it's a real, always-reproducible defect — fixed.
2. **`components/PostCheckoffSheet.jsx`** — the "nearby next" suggestion query (shown right after every
   check-off, app-wide) never selected `website_url` (or `maps_query`). **This one IS always reproducible**:
   Website never showed for a "nearby next" tap, for any item, regardless of whether it had a real site —
   fixed. Directions wasn't broken there (that query already required non-null lat/lng).

No data-level defect was found for any Amalfi item through the paths that actually serve them today (the two
official Hub lists, Nearby, Discover/search, What's Good). If a specific item still shows neither button on
your device after this OTA, the two fixes above may not be the whole story — tell me exactly which item and
which screen (list vs. Nearby vs. post-checkoff suggestion vs. Home rail) and I'll trace that one path directly.

## Representative verification (exact real logic replayed against live data)
| Item | Path | hasLoc | hasWeb |
|---|---|---|---|
| 'La Zagara' (mine, has website) | Positano Essentials list | true | true |
| 'Chiesa di Santa Maria Assunta' (mine, no official site) | Positano Essentials list | true | false (correct — no site) |
| 'Latteria' (mystery batch, has website) | any list | true | true |

## Provenance clarified by Jerry (2026-09-28, after this doc was first written)
The 23-item batch is his own — added via his bulk-upload ChatGPT intake method, deliberately going deeper
than this session's original 38-item pass. Not an unknown/mystery source; nothing here needed reverting.
The 4 items appended directly onto the two official Hub lists (2 on Essentials, 2 on Beyond the Postcard,
all four confirmed present) are his intentional editorial addition, not drift.

Functionally: all 23 already pass the same audit as the rest of the catalog — every one has `maps_query`
and a real `website_url`, so Directions/Website render correctly for all of them through the real paths
(Hub lists, Nearby, Discover). Most don't yet have `google_place_id`/`formatted_address` — expected per his
own documented intake convention (leave lat/lng unset at intake, geocode in a later pass), not a defect.

## Counts
- Active Amalfi Coast items: 61 (38 mine + 23 unaccounted-for batch).
- Directions-eligible (all paths, post-fix): 61/61.
- Website-eligible: 53/61 (8 correctly have no official site).
- Items still lacking any directions data: 0.
