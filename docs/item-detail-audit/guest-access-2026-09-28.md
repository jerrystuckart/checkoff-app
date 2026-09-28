# Signed-out item detail access — 2026-09-28

## Change
`screens/ItemDetailScreen.jsx`: Directions and Website no longer sit inside `{userId && (...)}` — that block
hid both from every signed-out visitor even though neither needs an account (Directions opens a map app,
Website opens a URL; no write, no private data). They now render purely off `hasLoc`/`hasWeb`, unconditional
on auth. Save stays visible to guests too; its own `onPress` now checks `userId` first and, if absent, shows
"Create a free account or sign in to save places" with a Sign In button, instead of hiding the control entirely.

## Return-to-item after sign-in (Save and Check-off)
New `returnToItem: { item, listId, listTitle, pendingAction }` param on the `SignIn` route, handled by
`SignInScreen.jsx`'s existing `navigateAfterAuth()` funnel (same nested-navigate shape it already used for
`returnToInvite`) — routes back to `ItemDetail` with the exact item object (this screen never re-fetches by id)
and `pendingAction` set. `ItemDetailScreen.jsx` has one new effect that fires the pending `save` or `checkoff`
once `userId` resolves post-auth, then clears the param so it can't replay. `handleCheckOff`'s guest branch
now carries the same `returnToItem` context Save's prompt does.

Photo Check-in's own guest branch and the "un-check" guest branch were left untouched (narrower asks; the
task named Check-off specifically) — same pattern is trivially reusable there later if wanted.

## Anonymous data access — verified live, not assumed
`items: public read active` RLS policy is `{public}` (covers anon), `USING (is_active AND is_approved)` — no
column-level restriction found. Confirmed by literally running as `role anon` (no JWT at all) against the
live database and getting back `maps_lat`, `maps_lng`, `maps_query`, `website_url` for a real item, through:
- the Hub-list shape (`list_items` join `items`, matching `lib/useItems.js`'s select) — anon read succeeded.
- the Nearby shape (`lib/useNearby.js`'s select) — anon read succeeded, for both a with-website and a
  without-website item.
- the deep-link resolver's shape (`select('*')`, `screens/DeepLinkItemResolverScreen.jsx`) — anon read succeeded.

`list_items: read if list accessible` policy passes for a public list (`is_public=true`, which both Hub lists
are) even with `auth.uid()` null, confirmed by the same anon-role read.

Home's item data comes from the same `items`/`list_items` reads as the list/Nearby paths above, and none of
HomeScreen.jsx's/DiscoverScreen.jsx's data-loading code has an `if (!user) return` gate on item fetching —
only unrelated personal features (weekly recap, at-place reminder) are user-gated. So all four requested
surfaces — Home, Nearby, a list, a deep link — serve full, correct item data to a signed-out visitor.

## Verification method (no live device/simulator available here)
Same approach as the earlier Directions/Website audit: exact real logic replayed against live data (all 4
paths above, `role anon`), plus a full read of the new JSX to confirm the only remaining condition on
Directions/Website is `hasLoc`/`hasWeb` — no `userId` reference left on either. Not a live on-device test —
please confirm the actual tap-through behavior on your device.

## 1.1.8 compatibility — not safe, not possible from here
Checked git history for any commit tagging `app.json` at `"version": "1.1.8"` / `"buildNumber": "153"` (the
live public build) — **none exists**. That build was never committed to this repo under that version string
(same situation as the current uncommitted 1.1.9/155 bump), so there is no source state here to recompute its
true fingerprint from, or to verify a cherry-picked JS diff against. `runtimeVersion` policy is `"fingerprint"`
— Expo Update's manifest server matches a request's `expo-runtime-version` header exactly against a published
update's computed fingerprint; there's no partial/best-effort match. Publishing without knowing the real 1.1.8
fingerprint risks either the update being silently unreachable (harmless) or, if the guess partially matched,
undefined behavior on a binary that doesn't have whatever native surface the wider codebase has since grown
(background location, task manager, etc.) — not worth risking on real public users.
**The only safe path to 1.1.8 users is the already-documented one: ship 1.1.9 through App Store review.**
