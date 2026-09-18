// Item Detail Redesign (2026-09-18) — the hero artwork consumer for
// screens/ItemDetailScreen.jsx. Detail never had the archetype fallback
// system wired in before this pass: it called resolvedItemImage() directly
// and rendered either a real photo or nothing at all. This component adds
// the same three-tier priority Home already uses — approved photo ->
// archetype -> generic — without changing any of the shared contracts
// those tiers are built on (lib/artworkResolution.js's resolveArtworkTier,
// components/home/useCardArtwork.js, components/home/ArchetypeArtwork.jsx
// are all consumed exactly as Home consumes them, never modified here).
//
// One deliberate addition beyond what Home's own consumers needed:
// useCardArtwork's onError only ever fires for the 'archetype' tier (see
// its own source — `resolved.tier === 'archetype' ? () => ... : undefined`
// — a failed real PHOTO on Home just falls through to that card's own
// existing no-image branch on the next render, since EditorialCard/
// WhatsTheThingHero both re-derive their no-image treatment from the same
// `artwork` object). Detail's hero is a single full-bleed surface with no
// separate "no image" branch of its own to fall back to, so a failed
// approved-photo load here needs its OWN local failure flag — tracked
// below as `photoFailed` — so a broken photo URL still lands on the
// generic treatment instead of a permanently blank/broken hero. This does
// not touch resolveArtworkTier's own tier decision; it only decides, at
// the render layer, whether to hand ArchetypeArtwork a url at all.
import React, { useState, useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import { useCardArtwork } from '../home/useCardArtwork'
import ArchetypeArtwork from '../home/ArchetypeArtwork'

// Full-bleed generic base layer — Detail's own version of the "zero-
// network decorative treatment" every ArchetypeArtwork consumer must
// supply (see ArchetypeArtwork.jsx's renderGenericFallback contract).
// Deliberately no border (approved design: "no heavy border around the
// hero") — just a themed surface fill plus a soft accent wash so a
// generic hero never reads as a dead gray box.
function DetailGenericBackground({ colors }) {
  const { CARD_ELEVATED, AMBER } = colors
  return (
    <View style={[StyleSheet.absoluteFillObject, { backgroundColor: CARD_ELEVATED }]}>
      <View
        style={[styles.glow, { backgroundColor: AMBER }]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </View>
  )
}

/**
 * @param {object} props
 * @param {object} props.item  the resolved item (resolvedItem in
 *   ItemDetailScreen — already merged with fetchedCoverUrl/fetchedImagePool
 *   so resolveArtworkTier sees the same photo pool Home would see).
 * @param {string|null} [props.userId]
 * @param {object} props.colors  from useTheme() — passed through rather
 *   than re-read, matching how the caller already threads colors into
 *   CoverCandidateCTA etc.
 * @param {import('react-native').StyleProp} [props.style]  sizing for the
 *   outer wrapper — full-bleed hero dimensions, not a card thumbnail.
 */
export default function DetailArtwork({ item, userId = null, colors, style }) {
  const artwork = useCardArtwork(item, userId)
  const [photoFailed, setPhotoFailed] = useState(false)

  // A new item must never inherit a previous item's photo failure — same
  // reasoning as useCardArtwork's own failedUrl reset on item?.id change.
  useEffect(() => {
    setPhotoFailed(false)
  }, [item?.id])

  const photoBroken = artwork.isPhoto && photoFailed
  const showArtwork = !photoBroken && (artwork.isPhoto || artwork.isArchetype)
  const effectiveUrl = showArtwork ? artwork.url : null
  const onError = artwork.isPhoto ? () => setPhotoFailed(true) : artwork.onError

  return (
    <View style={style}>
      <ArchetypeArtwork
        url={effectiveUrl}
        onError={onError}
        renderGenericFallback={() => <DetailGenericBackground colors={colors} />}
        gradient
        resizeMode="cover"
        style={StyleSheet.absoluteFillObject}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    opacity: 0.1,
  },
})
