# List model, source of truth, and seasonal selection

## Two-table list system — both live, roles are distinct, not duplicative

- **`lists` / `list_items` / `list_members`**: user-facing lists — official seasonal lists,
  personal lists, creator lists, Destination Hub clones. Has membership (`list_members`),
  join codes (`invite_code`), and per-item overlay (`list_items.city_slug`, Bonus Drop fields).
- **`curated_lists` / `curated_list_items` / `curated_list_metros`**: admin-curated **templates**
  shown as themed rails/previews (Home's curated groups, `CuratedListPreviewScreen`). Not
  joinable, not check-off-able directly — a user clones one into a personal `lists` row via
  `CreateListScreen.jsx`.

This is **not** an obsolete dual-write pattern — both tables are live, serve different UI
surfaces, and there's no evidence of the app writing the same data into both to keep them in
sync. The obsolete piece is narrower: see "Obsolete behavior" below.

## List-class matrix

| Class | Authoritative table | Mirror required? | Public/adoptable | Membership required to check off? | Progress calc | Dates that gate visibility |
|---|---|---|---|---|---|---|
| Seasonal (official) | `lists` (`is_official=true`, `metro_id` set) | No | Public, no join required to check off individual items (per Step 10 finding — public check-off exists) | No for check-off; membership tracked separately via `list_members` | `check_ins` count vs. `list_items` count, season-windowed via `lib/seasonWindow.js` | `starts_at`/`ends_at` on `lists`, gated by `prevent_expired_list_checkins()` |
| Themed/public destination | `lists` (`is_public=true`) | No | Public | No | Same as above | `is_public` flag; optional `starts_at`/`ends_at` |
| Local Guide | `lists` scoped by creator/metro (per `LocalGuidesScreen.jsx`) | No | Public | No | Same | Same |
| Creator | `lists` (`is_creator_list=true`, `goes_public_at`) | No | Public once `goes_public_at` reached (RLS: `is_creator_list=true AND goes_public_at IS NOT NULL`) | No | Same | `goes_public_at` |
| Template (curated) | `curated_lists`/`curated_list_items` | No — cloned into a new `lists` row on adoption, not synced afterward | Read-only template, not directly adoptable/joinable — must be cloned | N/A (not a checkoff surface) | N/A | `curated_lists.is_active` (**RLS gap** — see below) |
| Private/user-created | `lists` (`is_public=false`) | No | Invite-code or membership only | Yes — via `list_members` or `invite_code` | Same as public | None (user-controlled) |
| Adopted Hub copy | `lists` (`source_destination_list_id` set) | No — one-time copy via `adoptDestinationList()`, carries `metro_id`/`city_id` verbatim from source | Public once adopted | No | Same | `destination_lists.is_active`/`visible_from`/`visible_until` |
| Day trip | `metro_destinations`/`metro_destination_lists` → `destination_lists` → `lists` | No | Public | No | Same | `destination_lists.visible_from`/`visible_until` |
| Spotlight/event | `destination_spotlights` (own table, not a `lists` row at all) | N/A | Public | N/A — not a checkoff list | N/A | `visible_from`/`visible_until`, `event_starts_at`/`event_ends_at` |

## Title-based matching — still exists, is a fallback tier, not the primary path

`DeepLinkListResolverScreen.jsx`'s 4-tier resolution falls back to title-pattern matching (tiers
3–4) only after exact `slug`+`city_slug` and `slug`-only matches fail (tier 1–2). This is a
deliberate resilience fallback for older/malformed deep links, not evidence of an obsolete
system still load-bearing in the primary path. Not a Denver-blocking concern, but worth knowing
Denver's curated-list titles should still follow a consistent naming convention
(`{Emoji} {Title} · {Season} {Year}`, matching the pattern seen in all three existing metros) so
this fallback tier continues to work if slugs are ever missing.

## `curated_list_metros` vs. `city_slug` — resolved by direct read of `fetchCuratedLists()`

Per Open Brain's 7/17 note, `curated_list_metros` was meant to supersede `city_slug` for
list-level visibility. Live data shows only ~8 of ~40 curated lists across all three metros
actually have `curated_list_metros` rows — the rest have zero. **Direct read of
`lib/useItems.js:409-458` (`fetchCuratedLists`) resolves the fallback semantics definitively:**

```js
const visible = (data ?? []).filter(l => {
  const metros = l.curated_list_metros ?? []
  return metros.length === 0 || metros.some(m => m.city_slug === citySlug)
})
```

**Zero `curated_list_metros` rows = universal (visible to every metro).** This is intentional,
documented in the code's own comment, and is not a bug — the majority of curated lists today
(the audience-group "Summer 2026" pattern lists) are deliberately universal-by-omission, not
missing configuration. **For Denver: only create `curated_list_metros` rows for lists that
should be Denver-exclusive; leave them absent for any list meant to be shared across metros.**
This closes the "important before launch, unresolved" item this audit initially flagged —
resolved, not still open.

**Bonus finding, also resolved by the same read:** the pre-audit context material (Open Brain
7/18) flagged a "rail sort bug" — `fetchCuratedLists()` allegedly sorting on the legacy
`audience_groups.city_slug` field truthy instead of the real overlay signal, causing
e.g. Milwaukee-tagged lists to rank above Phoenix's own on a Phoenix rail. **This has already
been fixed** — the live sort (lines 447-451) explicitly sorts on `curated_list_metros.length > 0`
with a code comment stating it deliberately avoids `audience_groups.city_slug` "which drifts out
of sync." Do not carry this forward as a still-open issue.

## Adopted Hub copy — `adoptCuratedList()` is dead code

Confirmed by the codebase sweep: `adoptCuratedList()` in `lib/useItems.js` is exported but never
imported or called anywhere in the app. The real, live clone path for curated-list templates is
`CreateListScreen.jsx:133` calling `fetchCuratedListItems(curatedListId, userCitySlug)` to
pre-select template items into a new personal list. **Obsolete process to remove** (or at minimum
must not be documented/relied upon as the live mechanism) — flag for cleanup, not a Denver
blocker itself, but don't build Denver tooling around `adoptCuratedList()`.

## Obsolete/unsafe behavior Denver must not inherit

1. **`curated_lists` RLS double-policy** (`is_active=true` policy coexists with a `USING(true)`
   policy) — makes `is_active` a no-op for public read. If Denver's launch plan involves staging
   curated lists as inactive before go-live, **this must be fixed first**, or staged content will
   leak publicly. See [01](01_current_schema_and_relationships.md).
2. **`adoptCuratedList()`** — dead code, don't build around it (see above).
3. **Multiple concurrent `is_official=true` lists per metro** with no `display_order`/priority
   column — works today because (per this audit's current evidence) the client likely uses some
   selection heuristic not yet fully pinned down (see below). Don't assume creating several
   simultaneous official lists for Denver is safe without first confirming exactly which one
   Home renders as the hero.

## Official seasonal-list selection — traced directly, deterministic but title-blind

`screens/HomeScreen.jsx:301-333` (`loadForMetro`), verified by direct read:

```js
const { data: offLists } = await supabase.from('lists')
  .select('id, title, starts_at, ends_at, cover_emoji, metro_id, hero_image_url')
  .eq('is_official', true).eq('is_public', true).eq('metro_id', metroId)
  .order('created_at', { ascending: false })

const freshActive = offLists
  .filter(l => !isEnded(l.ends_at) && (!l.starts_at || new Date(l.starts_at) <= new Date()))
  .sort((a, b) => new Date(a.ends_at || '9999-12-31') - new Date(b.ends_at || '9999-12-31'))
const freshEnded = offLists.filter(l => isEnded(l.ends_at))
  .sort((a, b) => new Date(b.ends_at) - new Date(a.ends_at))
const currentOnHome = freshActive[0] ?? freshEnded[0] ?? null
```

**Selection rule, precisely:** among `is_official=true AND is_public=true` lists for the metro,
take the currently-active one whose `ends_at` is soonest (earliest-ending-first); if none are
active, fall back to the most-recently-ended one. **Title is never consulted** — no
`title LIKE '%Season%Year%Metro%'` matching happens anywhere in this path, contrary to the
audit's initial hypothesis. Selection is fully deterministic on `starts_at`/`ends_at` alone.

**The real collision risk, precisely stated:** since JS's `Array.prototype.sort` is stable and
the input array is already ordered `created_at DESC`, when multiple active official lists share
the exact same `ends_at` (as Phoenix's 8 lists do — all `2026-11-30`), the tie resolves to
**whichever was created most recently** among the tied set. This is deterministic per-deploy but
fragile: creating a new official list for an already-active season (e.g. an admin adds one more
themed list mid-season) will silently steal the Home hero slot from whatever was showing before,
with no explicit signal that this happened. **Classification: Important before launch** — Denver
is safe from this as long as, for any given active window, only **one** `is_official=true
AND is_public=true` list is created with the *earliest* `ends_at` of the set (or, more simply,
only one official/public list is active with the shortest window at any time). Creating several
simultaneous official lists for Denver (mirroring Phoenix's current pattern) works today only
because whichever was created last with the earliest end-date wins — not a designed
"pick this one" mechanism, just an artifact of stable-sort tie-breaking. Recommend Denver treat
"one currently-active official+public hero list per window" as an operational rule, not rely on
the tie-break behavior.
