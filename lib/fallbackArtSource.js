// Archetype Fallback Artwork V1 (2026-09-17) — the resolution layer
// between "no approved photo" (lib/whatsGoodImageSource.js's job) and
// "still show something better than nothing" (this file's job).
//
// STRICTLY SEPARATE from lib/whatsGoodImageSource.js. That file decides
// whether a TRUSTWORTHY, item/venue-specific photo exists — this file
// never touches that question and is never imported by it. A caller must
// always try resolvedItemImage()/resolvedItemImages() FIRST; this module
// is only consulted once that returns null. Conflating the two would mean
// generic archetype art could someday get reported as "a real item
// photo," which the product spec explicitly forbids.
//
// Resolution order (this module implements steps 2–3 only; step 1 is
// resolvedItemImage(), step 4 is the existing gradient/typography
// component treatment — this module returns null when it has nothing,
// and the caller is responsible for falling through to that treatment):
//   1. Approved/resolved item photo               (whatsGoodImageSource.js)
//   2. Explicit item.fallback_art_key, if valid    (this module)
//   3. Category default, via CATEGORY_DEFAULTS     (this module)
//   4. Existing zero-network graphic treatment     (component-level, final safety net)
//
// Pure, deterministic, no network calls — just registry lookups and URL
// string construction. Same (item) always produces the same result.

// Imports only the shared project URL constant (lib/supabaseConfig.js),
// NOT the full lib/supabase.js client — that file pulls in React
// Native's AsyncStorage/AppState and isn't safe to load under plain Node
// (unit tests, admin-tool builds). Storage's getPublicUrl() for a PUBLIC
// bucket is itself just deterministic string formatting (no network
// call, no auth), so building the same URL shape here keeps this whole
// module pure/synchronous/testable while still reusing the app's one
// real project URL — never a second hardcoded/duplicated one.
import { SUPABASE_URL } from './supabaseConfig.js'

// Bump this one constant to publish a new artwork generation without
// touching any other file or any existing (already-live) asset path.
export const FALLBACK_ART_VERSION = 'v1'

// The only bucket final archetype artwork will ever live in — NOT the
// private submission-photos bucket used for user/business check-in
// photos. This bucket is public (per product decision), so getPublicUrl
// is sufficient; no signing needed.
const FALLBACK_ART_BUCKET = 'checkoff-images'

// ── Archetype Registry V1 ───────────────────────────────────────────────
// The complete, closed set of valid `fallback_art_key` values as of V1.
// Adding an archetype in the future means adding a string here (+ an
// uploaded .webp) — never a migration, never a DB enum change.
export const ARCHETYPE_KEYS = Object.freeze([
  'restaurant_general',
  'signature_food',
  'coffee',
  'dessert',
  'beer',
  'wine',
  'cocktails',
  'hidden_entrance',
  'outdoor_desert',
  'outdoor_mountain',
  'outdoor_forest',
  'outdoor_water',
  'outdoor_winter',
  'outdoor_general',
  'scenic_view',
  'historic_place',
  'arts_culture',
  'live_entertainment',
  'shopping_market',
  'games_play',
  'sports',
  'wellness',
  'local_oddity',
])

const ARCHETYPE_KEY_SET = new Set(ARCHETYPE_KEYS)

/** @param {unknown} key */
export function isValidArchetypeKey(key) {
  return typeof key === 'string' && ARCHETYPE_KEY_SET.has(key)
}

// ── Category → default archetype mapping ────────────────────────────────
// Exact production category.name strings (confirmed via grep against
// supabase/migrations/20260906_add_shopping_sports_social_travel_categories.sql
// and the categories(name, color_hex) embeds already used by
// lib/useItems.js / lib/useNearby.js / screens/HomeScreen.jsx's mapRailItem).
// A category not listed here (or an item with no category at all) resolves
// to no archetype — the caller falls through to the generic graphic
// treatment, per the product spec (case 5 in the test matrix).
export const CATEGORY_DEFAULTS = Object.freeze({
  'Food & drink':   'restaurant_general',
  'Bar & drinks':   'cocktails',
  'Arts & Culture': 'arts_culture',
  'Adventure':      'outdoor_general',
  'Misc':           'local_oddity',
  'Shopping':       'shopping_market',
  'Social':         'live_entertainment',
  'Play':           'games_play',
  'Nightlife':      'live_entertainment',
  'Sports':         'sports',
  'Spa & self-care':'wellness',
  'Travel':         'scenic_view',
})

/**
 * Build the versioned public Storage URL for an archetype key. Does not
 * validate the key — callers that need "only a valid key produces a URL"
 * should check isValidArchetypeKey()/resolveFallbackArt() instead.
 * Mirrors the exact shape supabase-js's storage.from(bucket).getPublicUrl(path)
 * produces for a PUBLIC bucket (`${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`,
 * confirmed against the @supabase/supabase-js Storage client), built from
 * the app's one shared SUPABASE_URL constant rather than a second
 * hardcoded project URL.
 *
 * @param {string} archetypeKey
 * @returns {string}
 */
export function fallbackArtUrl(archetypeKey) {
  const path = `item-fallbacks/${FALLBACK_ART_VERSION}/${archetypeKey}.webp`
  return `${SUPABASE_URL}/storage/v1/object/public/${FALLBACK_ART_BUCKET}/${path}`
}

/**
 * The one archetype resolution to use for a no-photo item. Never call
 * this before confirming resolvedItemImage(item) is null — a real photo
 * always wins.
 *
 * Resolution order:
 *   1. item.fallback_art_key, if it's a valid registry key
 *   2. CATEGORY_DEFAULTS[item.categoryName], if mapped
 *   3. null — caller renders the existing generic graphic treatment
 *
 * @param {object} item  expects item.fallback_art_key (camelCase
 *   fallbackArtKey is also accepted, matching the snake_case->camelCase
 *   adapter convention used elsewhere) and item.categoryName.
 * @returns {{archetypeKey: string, url: string}|null}
 */
export function resolveFallbackArt(item) {
  if (!item) return null

  const explicitKey = item.fallback_art_key ?? item.fallbackArtKey ?? null
  const categoryKey = CATEGORY_DEFAULTS[item.categoryName] ?? null

  const archetypeKey = isValidArchetypeKey(explicitKey) ? explicitKey : categoryKey

  if (!isValidArchetypeKey(archetypeKey)) return null

  const url = fallbackArtUrl(archetypeKey)
  if (!url) return null

  return { archetypeKey, url }
}
