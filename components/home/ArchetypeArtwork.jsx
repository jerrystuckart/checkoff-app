// Archetype Fallback Artwork V1 (2026-09-17) — the reusable "what do we
// show when there's no approved photo" visual, shared by EditorialCard.jsx
// and WhatsTheThingHero.jsx so both lean on one underlying fallback
// renderer instead of duplicating gradient/typography markup.
//
// Renders whichever tier lib/artworkResolution.js's resolveArtworkTier()
// picked for this item:
//   'photo'      — not this component's job; callers only reach for
//                  ArchetypeArtwork once resolvedItemImage(item) is null.
//   'archetype'  — a remote checkoff-images/item-fallbacks/<v>/<key>.webp
//                  image, same gradient scrim treatment as an approved
//                  photo, rendered UNDER a base layer of the generic
//                  graphic treatment so there is never a blank card while
//                  the remote image loads or if it fails.
//   'generic'    — the existing zero-network gradient/typography
//                  treatment only (no remote Image at all).
//
// Resilience:
//   - The generic treatment is always the base layer; the remote Image
//     sits on top and simply doesn't render (or errors out) without ever
//     leaving a gap — no blank/broken-image state is reachable.
//   - onError flips local `failed` state, which recomputes the tier via
//     resolveArtworkTier(item, { imageFailed: true }) and permanently
//     stops attempting that url — no retry loop.
//   - `failed` resets to false whenever the resolved candidate url
//     changes (new item / new archetype key), so navigating between items
//     never gets stuck showing a previous item's failure.
//
// Accessibility: this is decorative background art — real content (venue
// name, thing, distance, CTA) is layered on top by the caller in normal
// RN Text, exactly as today. Hidden from the accessibility tree so it
// never produces a noisy "image" announcement ahead of the real label.
//
// No new native dependency — react-native Image + the already-installed
// expo-linear-gradient, same as every other image-capable card in this
// codebase.

import React, { useState, useEffect } from 'react'
import { View, Image, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { resolveArtworkTier } from '../../lib/artworkResolution'

/**
 * @param {object} props
 * @param {object} props.item
 * @param {object} [props.imageContext]  see lib/rotationContext.js — only
 *   relevant if the caller hasn't already confirmed resolvedItemImage is
 *   null (ArchetypeArtwork re-derives the tier itself so it can react to
 *   its own onError state independently of the caller's render).
 * @param {Function} props.renderGenericFallback  () => ReactNode — the
 *   CALLER's existing zero-network gradient/typography treatment (e.g.
 *   EditorialCard's PrimaryNoImageMode body, WhatsTheThingHero's textBlock
 *   branch). Always rendered as the base layer; never removed or
 *   replaced by this component, only layered under real artwork when one
 *   resolves.
 * @param {StyleProp} [props.style]  applied to the outer wrapper (sizing).
 */
export default function ArchetypeArtwork({ item, imageContext = {}, renderGenericFallback, style }) {
  const [failedUrl, setFailedUrl] = useState(null)

  const preTier = resolveArtworkTier(item, { imageContext, imageFailed: false })
  const imageFailed = preTier.tier === 'archetype' && failedUrl === preTier.url
  const resolved = resolveArtworkTier(item, { imageContext, imageFailed })

  // Reset failure state when the candidate url changes (different item,
  // different resolved archetype key) — a stale failure must never leak
  // into a different item's card.
  useEffect(() => {
    if (resolved.url !== failedUrl && failedUrl !== null && resolved.tier !== 'archetype') {
      setFailedUrl(null)
    }
  }, [resolved.url, resolved.tier]) // eslint-disable-line

  if (resolved.tier !== 'archetype') {
    // 'photo' tier is the caller's responsibility (they should not have
    // rendered ArchetypeArtwork at all once resolvedItemImage found
    // something) — rendering the generic base layer here is still safe
    // and never leaves a blank card either way.
    return <View style={style}>{renderGenericFallback()}</View>
  }

  return (
    <View style={style} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Base layer — the existing graphic treatment underneath, so a
          slow or failed remote load never shows a blank card. */}
      <View style={StyleSheet.absoluteFillObject}>{renderGenericFallback()}</View>
      <Image
        key={resolved.url}
        source={{ uri: resolved.url }}
        style={StyleSheet.absoluteFillObject}
        resizeMode="cover"
        accessibilityElementsHidden
        importantForAccessibility="no"
        accessibilityLabel=""
        onError={() => setFailedUrl(resolved.url)}
      />
      <LinearGradient
        colors={['transparent', 'rgba(6,6,14,0.35)', 'rgba(6,6,14,0.92)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
      />
    </View>
  )
}
