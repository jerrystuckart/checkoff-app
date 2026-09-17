// Archetype Fallback Artwork V1 (2026-09-17), hardened (2026-09-17 follow-up)
// — the ONE reusable "layer remote archetype art over the generic
// treatment" renderer, shared by EditorialCard.jsx (primary/rail/row) and
// WhatsTheThingHero.jsx (dominant mode) so there is exactly one
// implementation of: remote archetype rendering, load-failure handling,
// decorative-image accessibility, and the generic-underneath layering —
// never competing implementations per card family.
//
// Ownership split (deliberately different from this file's first draft,
// which re-derived resolveArtworkTier() itself): the PARENT already calls
// components/home/useCardArtwork.js once per card to decide which visual
// branch to render at all (isPhoto vs isArchetype vs isGeneric) and to own
// the item text/actions/navigation. Having THIS component re-run that same
// resolution would mean two independent tier decisions per render that
// could disagree, and a second, redundant failedUrl-tracking hook. So this
// component takes the already-resolved `url`/`onError` as plain props and
// owns only what's genuinely its own concern: the remote image's own
// load/opacity lifecycle (via lib/archetypeLoadState.js) and rendering.
//
// Layering contract (never violated):
//   1. The generic base layer (`renderGenericFallback`, supplied by the
//      caller — e.g. EditorialCard's extracted *NoImageBackground, or
//      WhatsTheThingHero's HeroNoImageBackground) is ALWAYS rendered
//      first, filling the wrapper. It never depends on network state.
//   2. If `url` is falsy, nothing else renders — the generic layer is the
//      entire result (this is what happens for the plain 'generic' tier,
//      and it's also what a pending/unavailable archetype key resolves to
//      upstream in lib/fallbackArtSource.js — Approach A — so no <Image>
//      is ever mounted for an asset that isn't live yet).
//   3. If `url` is present, a dark gradient scrim renders immediately on
//      top of the generic layer (the same scrim treatment an approved
//      photo gets) so any caller-supplied light overlay text already
//      reads correctly from the first frame, before the remote asset has
//      loaded.
//   4. The remote <Image> itself fades in via a simple opacity swap
//      (0 -> 1) once its onLoad fires — never an animation library.
//   5. If onError fires, the image's opacity is pinned at 0 forever for
//      that url (lib/archetypeLoadState.js's FAILED status) — no retry —
//      leaving the generic layer + scrim visible, never a blank space, a
//      native broken-image icon, a white flash, or a transparent hole.
//   6. Load/failure state resets automatically whenever `url` changes
//      (lib/archetypeLoadState.js's withCandidateUrl), so a previous
//      item's success/failure never leaks into a different item's card.
//
// Accessibility: purely decorative background art. Hidden from the
// accessibility tree so it never produces a noisy "image" announcement —
// real content (venue name, thing, distance, CTA) is layered on top by
// the caller as a sibling, in normal RN Text, exactly as before.
//
// No new native dependency — react-native Image + the already-installed
// expo-linear-gradient, same as every other image-capable card here.

import React, { useState, useEffect } from 'react'
import { View, Image, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import {
  createArchetypeLoadState,
  withCandidateUrl,
  markLoaded,
  markFailed,
  isRemoteVisible,
} from '../../lib/archetypeLoadState'

const DEFAULT_GRADIENT_COLORS = ['transparent', 'rgba(6,6,14,0.35)', 'rgba(6,6,14,0.92)']
const DEFAULT_GRADIENT_LOCATIONS = [0, 0.45, 1]

/**
 * @param {object} props
 * @param {string|null} [props.url]  the already-resolved archetype image
 *   url (e.g. from useCardArtwork's `.url` when `.isArchetype` is true), or
 *   null/undefined — in which case this renders ONLY the generic base
 *   layer, no <Image> at all (used for the plain generic tier, and for any
 *   pending/unavailable archetype key per Approach A).
 * @param {() => import('react').ReactNode} props.renderGenericFallback
 *   the caller's existing zero-network decorative background treatment.
 *   Always rendered as the base layer; never removed or replaced by this
 *   component, only layered under real artwork when one resolves and
 *   loads. Must not include real (non-decorative) content — the caller
 *   layers item text/CTAs as a SIBLING of this component, on top of it.
 * @param {(() => void)|undefined} [props.onError]  forwarded from
 *   useCardArtwork's `.onError` — called once (no retry) when the remote
 *   image fails, so the tier resolution upstream can flip away from
 *   'archetype' on the next render.
 * @param {(() => void)|undefined} [props.onLoad]  optional extra
 *   notification when the remote image finishes loading.
 * @param {boolean} [props.gradient]  whether to apply the dark scrim used
 *   for light overlay text (primary/rail/hero variants). Row/compact
 *   thumbnails pass false — too small for overlay text or a scrim.
 * @param {StyleProp} [props.style]  applied to the outer wrapper (sizing —
 *   mirror whatever the caller would have sized a raw <Image> to).
 */
export default function ArchetypeArtwork({
  url = null,
  renderGenericFallback,
  onError,
  onLoad,
  gradient = true,
  resizeMode = 'cover',
  style,
}) {
  const [loadState, setLoadState] = useState(() => createArchetypeLoadState())

  // Reset/retarget load state whenever the candidate url changes — a new
  // item, a newly-resolved archetype key, or the tier flipping away from
  // 'archetype' (url becomes null) must never inherit a previous url's
  // loaded/failed status.
  useEffect(() => {
    setLoadState((prev) => withCandidateUrl(prev, url))
  }, [url])

  const trackingThisUrl = Boolean(url) && loadState.url === url
  const visible = trackingThisUrl && isRemoteVisible(loadState)

  return (
    <View style={style} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Base layer — the caller's existing zero-network graphic
          treatment, always present underneath so a slow, pending
          (Approach A), or failed remote load never shows a blank card. */}
      <View style={StyleSheet.absoluteFillObject}>{renderGenericFallback()}</View>

      {url ? (
        <>
          <Image
            key={url}
            source={{ uri: url }}
            style={[StyleSheet.absoluteFillObject, { opacity: visible ? 1 : 0 }]}
            resizeMode={resizeMode}
            accessibilityElementsHidden
            importantForAccessibility="no"
            accessibilityLabel=""
            onLoad={() => {
              setLoadState((prev) => markLoaded(prev, url))
              onLoad?.()
            }}
            onError={() => {
              setLoadState((prev) => markFailed(prev, url))
              onError?.()
            }}
          />
          {/* Scrim renders as soon as a candidate url exists (not gated on
              `visible`) — it's the same treatment an approved photo gets,
              so caller-supplied light overlay text reads correctly from
              the very first frame, over the generic layer, before the
              remote asset has finished loading. */}
          {gradient ? (
            <LinearGradient
              colors={DEFAULT_GRADIENT_COLORS}
              locations={DEFAULT_GRADIENT_LOCATIONS}
              style={StyleSheet.absoluteFillObject}
            />
          ) : null}
        </>
      ) : null}
    </View>
  )
}
