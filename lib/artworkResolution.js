// Archetype Fallback Artwork V1 — the single, pure "what tier should this
// card render right now" decision, shared by every consumer of
// components/home/ArchetypeArtwork.jsx. Kept separate from that component
// (same reasoning as lib/homeHeroLayout.js) so the actual product rule has
// real automated coverage independent of React Native rendering, which
// this repo has no test harness for today (see lib/*.test.js — all plain
// node:test over pure logic, no component-render tests exist yet).
//
// Three tiers, strictly in this order:
//   'photo'      — resolvedItemImage(item, context) found a real,
//                   trustworthy image. Always wins when present.
//   'archetype'  — no real photo, but lib/fallbackArtSource.js resolved a
//                   valid archetype (explicit override or category
//                   default) AND that remote asset hasn't already failed
//                   to load this render.
//   'generic'    — nothing else available, OR the archetype image failed
//                   to load (imageFailed=true) — the existing zero-
//                   network gradient/typography treatment, the one tier
//                   that's always available.
//
// This module makes no network calls and renders nothing — it only picks
// a tier + url from already-resolved inputs.
//
// Approach A (Hardening pass, 2026-09-17): resolveFallbackArt() only
// returns a non-null `url` for archetype keys marked 'available' in
// lib/fallbackArtSource.js's ARCHETYPE_STATUS (all 23 v1 keys are
// currently 'pending' — no real assets exist in Storage yet). This module
// needed NO changes to honor that: the `if (archetype?.url)` check below
// already gates purely on url presence, so a matched-but-pending key
// falls straight through to the 'generic' tier below, with no network
// request ever attempted for it.

import { resolvedItemImage } from './whatsGoodImageSource.js'
import { resolveFallbackArt } from './fallbackArtSource.js'

/**
 * @param {object} item
 * @param {object} [options]
 * @param {object} [options.imageContext]  passed through to
 *   resolvedItemImage(item, context) — see lib/rotationContext.js.
 * @param {boolean} [options.imageFailed]  true once the remote archetype
 *   image has thrown onError for the CURRENT url — the component is
 *   responsible for resetting this back to false when the url changes.
 * @returns {{ tier: 'photo'|'archetype'|'generic', url: string|null, archetypeKey: string|null }}
 */
export function resolveArtworkTier(item, options = {}) {
  const { imageContext = {}, imageFailed = false } = options

  const photo = resolvedItemImage(item, imageContext)
  if (photo?.url) {
    return { tier: 'photo', url: photo.url, archetypeKey: null }
  }

  if (!imageFailed) {
    const archetype = resolveFallbackArt(item)
    if (archetype?.url) {
      return { tier: 'archetype', url: archetype.url, archetypeKey: archetype.archetypeKey }
    }
  }

  return { tier: 'generic', url: null, archetypeKey: null }
}
