// Home 2026 — the What's Good / Near You editorial card, rebuilt for real
// visual weight (see docs on the "MAKE HOME FEEL POWERFUL" pass). Image-
// capable, not image-dependent — every card is fully designed with or
// without a trustworthy photo (lib/whatsGoodImageSource.js's
// resolvedItemImage, the single image-or-null decision this component
// trusts). No giant initials, no flat bordered box: the no-image state is
// an intentionally GRAPHIC treatment (oversized thing-first typography,
// an asymmetric brand accent shape, real elevation), not a degraded
// fallback.
//
// Two size variants:
//   'primary' — the standout hero. Image mode: the photo becomes the
//     canvas — full-bleed, strong scrim, floating tactile CTA pill.
//     No-image mode: oversized "thing" typography dominates, category is
//     quiet metadata (or omitted), one soft brand-color wash in a corner
//     for asymmetry — not a flat card.
//   'row' — compact secondary. Deliberately NOT a miniature clone of the
//     hero: no big typography, no floating CTA, just a fast-scannable row
//     with a small thumbnail (image mode) or a slim accent bar (no-image).
//
// Secret items (item.is_secret) lean further into the app's existing
// purple "ended/special" theme tokens (ENDED_BG/ENDED_BORDER/ENDED_TEXT) —
// layered purple surfaces in the hero, not just a badge.
//
// All press feedback goes through components/PressableTactile.jsx (real
// elevation-shadow compression + scale/translate + haptic) — no more flat
// TouchableOpacity opacity-fade.

import React from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import PressableTactile from '../PressableTactile'
import { resolvedItemImage } from '../../lib/whatsGoodImageSource'
import { deriveVenueAndThing } from '../../lib/whatsGoodItemPresentation'
import { isSpecialItemPresentation } from '../../lib/whatsGoodDisplayLayout'
import { formatDistanceLabel } from '../../lib/proximity'
import { extractQuotedVenueFromBody } from '../../lib/itemDetailHeaderTitle'
import { currentRotationContext } from '../../lib/rotationContext'

// FINAL CLEANUP BEFORE BUILD 144 — item 1: category was competing
// visually with venue/thing on the primary card ("Bar & drinks" reads as
// noise next to a venue name and a headline). Quiet metadata now means
// distance only, when it's actually useful — never category. If there's
// no distance either (not at-place, or a universal item), the footer is
// just the chevron, and the card is cleaner for it.
function metaLine(item) {
  return item?.is_universal ? null : formatDistanceLabel(item?.distM)
}

function PrimaryImageMode({ item, colors, isSpecial, venueName, thing, meta, onPress, userId }) {
  const { AMBER, ENDED_TEXT } = colors
  const image = resolvedItemImage(item, currentRotationContext(userId))
  const accent = isSpecial ? ENDED_TEXT : AMBER

  return (
    <PressableTactile intensity="hero" onPress={onPress} style={[styles.primaryCard, { shadowColor: colors.SHADOW_COLOR ?? 'rgba(0,0,0,0.3)' }]}>
      <View style={styles.primaryImageWrapper}>
        <Image source={{ uri: image.url }} style={styles.primaryImage} resizeMode="cover" />
        {/* Real editorial gradient, not a flat wash — guarantees text
            contrast over any photo while still reading as premium/upscale
            rather than a muddy solid tint. */}
        <LinearGradient
          colors={['transparent', 'rgba(6,6,14,0.35)', 'rgba(6,6,14,0.92)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        {isSpecial && (
          <View style={[styles.specialBadge, { backgroundColor: 'rgba(122,77,179,0.9)' }]}>
            <Text style={styles.specialBadgeText}>✦ SECRET</Text>
          </View>
        )}
        <View style={styles.primaryOverlayText}>
          {venueName ? <Text style={styles.overlayVenue} numberOfLines={1}>{venueName}</Text> : null}
          <Text style={styles.overlayThing} numberOfLines={2}>{thing}</Text>
          {/* REAL-DEVICE FOLLOW-UP (2026-09-03): the large "See the thing"
              CTA button was redundant — the card already tells the user
              what the thing is, and the whole card is tappable. Replaced
              with an understated disclosure footer (meta + chevron). */}
          <View style={styles.overlayFooter}>
            {meta ? <Text style={styles.overlayMeta} numberOfLines={1}>{meta}</Text> : <View />}
            <Text style={[styles.footerChevron, { color: accent }]}>→</Text>
          </View>
        </View>
      </View>
    </PressableTactile>
  )
}

// DEFAULT HOME "WOW" PASS (2026-09-03): the no-image hero was still
// reading as "a fallback" — one flat surface color + two same-shape
// circles. Richer now, same footprint (card height unchanged):
//   - a real diagonal gradient background (surface -> accent-tinted),
//     not a flat fill, for actual depth
//   - THREE layered shapes at different geometries/opacities, not two
//     same-shape circles — an outer circle, an inner circle, AND a thin
//     rotated accent bar for a genuinely "designed" asymmetric composition
//   - a colored accent rule under the venue label + the venue itself
//     promoted to the accent color (amber/purple), not quiet MUTED gray —
//     "more intentional use of amber/navy/purple," not just a CTA color
function PrimaryNoImageMode({ item, colors, isSpecial, venueName, thing, meta, onPress }) {
  const { TEXT, MUTED, CARD_ELEVATED, AMBER, ENDED_BG, ENDED_TEXT } = colors
  const accent = isSpecial ? ENDED_TEXT : AMBER
  const surface = isSpecial ? ENDED_BG : CARD_ELEVATED

  return (
    <PressableTactile intensity="hero" onPress={onPress} style={[styles.primaryCard, styles.primaryCardBordered, { borderColor: `${accent}33`, shadowColor: colors.SHADOW_COLOR ?? 'rgba(0,0,0,0.3)' }]}>
      <LinearGradient
        colors={[surface, `${accent}14`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Three layered shapes at different geometries — reads as a
          designed, asymmetric composition rather than a flat card with a
          decorative circle. */}
      <View style={styles.noImageWashOuter(accent)} pointerEvents="none" />
      <View style={styles.noImageWashInner(accent)} pointerEvents="none" />
      <View style={styles.noImageAccentBar(accent)} pointerEvents="none" />
      <View style={styles.noImageTextBlock}>
        {isSpecial && (
          <View style={[styles.specialBadgeInline, { borderColor: accent }]}>
            <Text style={[styles.specialBadgeInlineText, { color: accent }]}>✦ SECRET</Text>
          </View>
        )}
        {venueName ? (
          <>
            <Text style={[styles.noImageVenue, { color: accent }]} numberOfLines={1}>{venueName}</Text>
            <View style={[styles.noImageVenueRule, { backgroundColor: accent }]} />
          </>
        ) : null}
        <Text style={[styles.noImageThing, { color: TEXT }]} numberOfLines={2}>{thing}</Text>
        <View style={styles.noImageFooter}>
          {meta ? <Text style={[styles.noImageMeta, { color: MUTED }]} numberOfLines={1}>{meta}</Text> : <View />}
          <Text style={[styles.footerChevron, { color: accent }]}>→</Text>
        </View>
      </View>
    </PressableTactile>
  )
}

// FINAL UI PASS BEFORE BUILD 144 — item 8: secondary rows are now
// curiosity/discovery teasers, not miniature item cards. When a real
// venue/business name exists, that's the ENTIRE label — no category, no
// item body, no "Order the..." — just the name, distance, and a chevron.
// The user taps to discover the actual thing on Item Detail. Falls back
// to a short, single-line clamp of the thing text only when there's no
// meaningful venue name to show instead (universal items, etc).
function SecondaryRow({ item, colors, onPress, userId }) {
  const { TEXT, CARD_ELEVATED, AMBER, ENDED_TEXT, SHADOW_COLOR } = colors
  const isSpecial = isSpecialItemPresentation(item)
  const { venueName, thing } = deriveVenueAndThing(item)
  const image = resolvedItemImage(item, currentRotationContext(userId))
  const accent = isSpecial ? ENDED_TEXT : AMBER
  const distLabel = item?.is_universal ? null : formatDistanceLabel(item?.distM)
  // venueName only exists for items with a real partners row — most
  // real featured businesses don't have one (see lib/itemDetailHeaderTitle.js's
  // note). Try the same quoted-venue extraction from body before falling
  // back to the item hook, or "Order the..." leaks into the teaser here too.
  const teaserLabel = venueName || extractQuotedVenueFromBody(item?.body) || thing

  return (
    <PressableTactile
      intensity="utility"
      onPress={onPress}
      shadowColor={SHADOW_COLOR ?? 'rgba(0,0,0,0.3)'}
      style={[styles.rowCard, { backgroundColor: CARD_ELEVATED, borderColor: `${accent}2E` }]}
    >
      {image ? (
        <Image source={{ uri: image.url }} style={styles.rowImage} resizeMode="cover" />
      ) : (
        <View style={[styles.rowAccentWrap, { backgroundColor: `${accent}1F` }]}>
          <View style={[styles.rowAccentDot, { backgroundColor: accent }]} />
        </View>
      )}
      <View style={styles.rowTextBlock}>
        {isSpecial && <Text style={[styles.rowSpecialTag, { color: ENDED_TEXT }]}>✦ SECRET</Text>}
        <Text style={[styles.rowVenue, { color: TEXT }]} numberOfLines={1}>{teaserLabel}</Text>
        {distLabel ? <Text style={[styles.rowMeta, { color: TEXT, opacity: 0.5 }]} numberOfLines={1}>{distLabel}</Text> : null}
      </View>
      <Text style={[styles.rowChevron, { color: accent }]}>→</Text>
    </PressableTactile>
  )
}

export default function EditorialCard({ item, onPress, colors, variant = 'primary', userId = null }) {
  if (!item) return null

  const isSpecial = isSpecialItemPresentation(item)
  const { venueName, thing } = deriveVenueAndThing(item)
  const meta = metaLine(item)
  const image = resolvedItemImage(item, currentRotationContext(userId))

  if (variant === 'row') {
    return <SecondaryRow item={item} colors={colors} onPress={onPress} userId={userId} />
  }

  if (image) {
    return <PrimaryImageMode item={item} colors={colors} isSpecial={isSpecial} venueName={venueName} thing={thing} meta={meta} onPress={onPress} userId={userId} />
  }
  return <PrimaryNoImageMode item={item} colors={colors} isSpecial={isSpecial} venueName={venueName} thing={thing} meta={meta} onPress={onPress} />
}

const styles = StyleSheet.create({
  primaryCard: { borderRadius: 26, overflow: 'hidden', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 18 },
  primaryCardBordered: { borderWidth: 1 },

  primaryImageWrapper: { minHeight: 240, justifyContent: 'flex-end' },
  primaryImage: { ...StyleSheet.absoluteFillObject },
  primaryOverlayText: { padding: 20 },
  overlayVenue: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginBottom: 4, textTransform: 'uppercase' },
  overlayThing: { color: '#fff', fontSize: 23, fontWeight: '900', lineHeight: 28, marginBottom: 6 },
  overlayMeta: { color: 'rgba(255,255,255,0.82)', fontSize: 12, fontWeight: '700', flexShrink: 1 },

  specialBadge: { position: 'absolute', top: 14, left: 14, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  specialBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  noImageTextBlock: { padding: 24, minHeight: 240, justifyContent: 'center' },
  noImageVenue: { fontSize: 12, fontWeight: '900', letterSpacing: 0.6, marginBottom: 6, textTransform: 'uppercase' },
  noImageVenueRule: { width: 28, height: 3, borderRadius: 2, marginBottom: 12, marginTop: -4 },
  noImageThing: { fontSize: 27, fontWeight: '900', lineHeight: 32, marginBottom: 8, letterSpacing: -0.3 },
  noImageMeta: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  specialBadgeInline: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, marginBottom: 10 },
  specialBadgeInlineText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  // REAL-DEVICE FOLLOW-UP (2026-09-03): the large "See the thing" CTA
  // button was removed from both primary card modes — redundant once the
  // whole card is tappable and the card already states what the thing is.
  // Replaced with a quiet disclosure footer: meta text + a small chevron,
  // never another big button.
  overlayFooter: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  noImageFooter: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerChevron: { fontSize: 16, fontWeight: '900', marginLeft: 10 },

  rowCard: { borderRadius: 18, borderWidth: 1.5, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', paddingRight: 14 },
  rowImage: { width: 64, height: 64 },
  rowAccentWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  rowAccentDot: { width: 10, height: 10, borderRadius: 5 },
  rowTextBlock: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' },
  rowVenue: { fontSize: 14, fontWeight: '800' },
  rowMeta: { fontSize: 12, fontWeight: '600', marginTop: 3 },
  rowSpecialTag: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5, marginBottom: 3 },
  rowChevron: { fontSize: 15, fontWeight: '800', marginLeft: 6 },
})

// The layered brand wash for the no-image hero — two overlapping,
// off-center shapes at different sizes/opacities so the no-photo state
// reads as a designed surface (depth/asymmetry) rather than one flat
// corner blob. Defined as functions (not static StyleSheet entries) since
// color depends on the resolved accent (amber vs. purple for secret).
styles.noImageWashOuter = (accentColor) => ({
  position: 'absolute',
  top: -50,
  right: -50,
  width: 190,
  height: 190,
  borderRadius: 95,
  backgroundColor: accentColor,
  opacity: 0.1,
})
styles.noImageWashInner = (accentColor) => ({
  position: 'absolute',
  bottom: -30,
  left: -30,
  width: 110,
  height: 110,
  borderRadius: 55,
  backgroundColor: accentColor,
  opacity: 0.07,
})
// Third shape, a different geometry from the two circles above — a thin
// rotated bar tucked along the bottom-right edge, mostly clipped by the
// card's own overflow:hidden. Deliberately subtle (low opacity, mostly
// off-canvas) — a composition detail, not a competing focal point.
styles.noImageAccentBar = (accentColor) => ({
  position: 'absolute',
  bottom: 18,
  right: -60,
  width: 160,
  height: 10,
  borderRadius: 5,
  backgroundColor: accentColor,
  opacity: 0.1,
  transform: [{ rotate: '-18deg' }],
})
