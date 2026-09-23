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
import { View, Text, Image, Pressable, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import PressableTactile from '../PressableTactile'
import { useSavedItems } from '../../lib/SavedItemsContext'
import BookmarkIcon from '../BookmarkIcon'
import { deriveVenueAndThing } from '../../lib/whatsGoodItemPresentation'
import { isSpecialItemPresentation } from '../../lib/whatsGoodDisplayLayout'
import { formatDistanceLabel } from '../../lib/proximity'
import { extractQuotedVenueFromBody } from '../../lib/itemDetailHeaderTitle'
import { railAccentForIndex } from '../../lib/whatsGoodRailLayout'
// Archetype Fallback Artwork V1 (2026-09-17) — see useCardArtwork.js. Every
// spot that used to call resolvedItemImage(item, context) directly now
// goes through this hook instead: same `{ url }` shape for a real approved
// photo (behavior bit-for-bit unchanged), PLUS a resolved archetype/
// category-default illustration when there's no real photo, with its own
// onError -> fall back to the existing no-image treatment.
import { useCardArtwork } from './useCardArtwork'
// Hardening pass (2026-09-17) — the single shared renderer for the
// archetype tier: layers the resolved remote archetype image UNDER a dark
// scrim, ON TOP of the existing generic decorative background (extracted
// below as *NoImageBackground), so a no-photo item with an archetype key
// never shows a blank/broken state while the remote asset loads. The
// 'photo' tier (a real approved image) is untouched — it keeps using a
// plain <Image>, exactly as before this pass.
import ArchetypeArtwork from './ArchetypeArtwork'

// FINAL CLEANUP BEFORE BUILD 144 — item 1: category was competing
// visually with venue/thing on the primary card ("Bar & drinks" reads as
// noise next to a venue name and a headline). Quiet metadata now means
// distance only, when it's actually useful — never category. If there's
// no distance either (not at-place, or a universal item), the footer is
// just the chevron, and the card is cleaner for it.
function metaLine(item) {
  return item?.is_universal ? null : formatDistanceLabel(item?.distM)
}

// Saved Items V1 (2026-09-18) — the shared bookmark control for every
// EditorialCard variant (primary/row/rail). Rendered as a genuinely
// separate Pressable (not an absolutely-positioned plain View sitting
// inside the card's own PressableTactile touchable) — RN's touch
// responder system resolves a tap to the MOST SPECIFIC Pressable under
// the finger, so this nested Pressable's onPress does not bubble up to
// the outer card's onPress, matching the existing precedent already
// established by CoverCandidateCTA's 'pill' variant nested inside
// WhatsTheThingHero's own outer card Pressable (see that file's own
// comment). The card itself stays fully navigable via its own tap target
// everywhere outside this control's hit area.
//
// Reads only from the shared useSavedItems() Set — never issues its own
// Supabase query, so no per-card database call is added anywhere this is
// used.
// Check-In Memory Viewer (2026-09-23) — a small tappable badge shown only
// when hasMemory is true (this user already has a saved photo memory for
// this item). Additive/optional, mirrors SaveToggle's structure exactly
// (own Pressable, own hitSlop) so it never competes with the card's own
// press handler. Not rendered at all when hasMemory is false/absent —
// every existing card that doesn't pass these props is visually unchanged.
function MemoryBadge({ item, onViewMemory, style, color = '#fff', size = 15 }) {
  if (!onViewMemory) return null
  const title = item?.body ?? 'item'
  return (
    <Pressable
      onPress={onViewMemory}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={[styles.saveToggle, style]}
      accessibilityRole="button"
      accessibilityLabel={`View memory for ${title}`}
    >
      <Text style={{ color, fontSize: size, fontWeight: '900' }}>📷</Text>
    </Pressable>
  )
}

function SaveToggle({ item, navigation, style, color = '#fff', size = 16 }) {
  const { isSaved, toggleSaved } = useSavedItems()
  const saved = isSaved(item?.id)
  const title = item?.body ?? ''
  return (
    <Pressable
      onPress={() => toggleSaved(item?.id, navigation)}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={[styles.saveToggle, style]}
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
      accessibilityLabel={saved ? `Remove ${title} from Saved` : `Save ${title}`}
    >
      <BookmarkIcon filled={saved} color={color} size={size} />
    </Pressable>
  )
}

// Shared overlay text block for the primary card's "something photo-like
// is behind this" modes (a real approved photo, OR a loaded/loading
// archetype scrim) — factored out so PrimaryImageMode and
// PrimaryArchetypeMode render byte-identical text markup instead of two
// copies that could drift.
function PrimaryOverlayText({ isSpecial, venueName, thing, meta, accent }) {
  return (
    <>
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
    </>
  )
}

// The primary no-image card's decorative background ONLY (gradient wash +
// the three layered accent shapes) — no text. Extracted so it can serve
// double duty as the pure-generic PrimaryNoImageMode's background AND as
// the generic base layer ArchetypeArtwork renders underneath a loading/
// pending/failed archetype image, per the layering contract in
// ArchetypeArtwork.jsx. Same visual either way — the generic treatment
// never looks different depending on why it's the thing being shown.
function PrimaryNoImageBackground({ colors, isSpecial }) {
  const { CARD_ELEVATED, AMBER, ENDED_BG, ENDED_TEXT } = colors
  const accent = isSpecial ? ENDED_TEXT : AMBER
  const surface = isSpecial ? ENDED_BG : CARD_ELEVATED

  return (
    <>
      <LinearGradient
        colors={[surface, `${accent}14`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.noImageWashOuter(accent)} pointerEvents="none" />
      <View style={styles.noImageWashInner(accent)} pointerEvents="none" />
      <View style={styles.noImageAccentBar(accent)} pointerEvents="none" />
    </>
  )
}

function PrimaryImageMode({ item, colors, isSpecial, venueName, thing, meta, onPress, userId, artwork, navigation }) {
  const { AMBER, ENDED_TEXT } = colors
  const accent = isSpecial ? ENDED_TEXT : AMBER

  return (
    <PressableTactile intensity="hero" onPress={onPress} style={[styles.primaryCard, { shadowColor: colors.SHADOW_COLOR ?? 'rgba(0,0,0,0.3)' }]}>
      <View style={styles.primaryImageWrapper}>
        <Image
          key={artwork.url}
          source={{ uri: artwork.url }}
          style={styles.primaryImage}
          resizeMode="cover"
          onError={artwork.onError}
          accessibilityElementsHidden
          importantForAccessibility="no"
          accessibilityLabel=""
        />
        {/* Real editorial gradient, not a flat wash — guarantees text
            contrast over any photo while still reading as premium/upscale
            rather than a muddy solid tint. */}
        <LinearGradient
          colors={['transparent', 'rgba(6,6,14,0.35)', 'rgba(6,6,14,0.92)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        <PrimaryOverlayText isSpecial={isSpecial} venueName={venueName} thing={thing} meta={meta} accent={accent} />
        {/* Rendered after the overlay text in JSX/tree order (even though
            it's visually positioned in the top-right corner via absolute
            styling) so a screen reader's reading order reaches the
            venue/thing/meta content first — the bookmark control never
            jumps ahead of it. */}
        <SaveToggle item={item} navigation={navigation} style={styles.saveTogglePrimary} color="#fff" size={18} />
      </View>
    </PressableTactile>
  )
}

// Archetype tier for the primary card — no real approved photo, but a
// valid + available (Approach A) archetype resolved. Same footprint/text
// treatment as PrimaryImageMode, but the background goes through
// ArchetypeArtwork so the generic decorative treatment (PrimaryNoImageBackground)
// is always visible underneath immediately, with the remote archetype
// image + scrim layered on top only once it loads.
function PrimaryArchetypeMode({ item, colors, isSpecial, venueName, thing, meta, onPress, artwork, navigation }) {
  const { AMBER, ENDED_TEXT } = colors
  const accent = isSpecial ? ENDED_TEXT : AMBER

  return (
    <PressableTactile intensity="hero" onPress={onPress} style={[styles.primaryCard, { shadowColor: colors.SHADOW_COLOR ?? 'rgba(0,0,0,0.3)' }]}>
      <View style={styles.primaryImageWrapper}>
        <ArchetypeArtwork
          url={artwork.url}
          onError={artwork.onError}
          renderGenericFallback={() => <PrimaryNoImageBackground colors={colors} isSpecial={isSpecial} />}
          style={StyleSheet.absoluteFillObject}
        />
        <PrimaryOverlayText isSpecial={isSpecial} venueName={venueName} thing={thing} meta={meta} accent={accent} />
        <SaveToggle item={item} navigation={navigation} style={styles.saveTogglePrimary} color="#fff" size={18} />
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
function PrimaryNoImageMode({ item, colors, isSpecial, venueName, thing, meta, onPress, navigation }) {
  const { TEXT, MUTED, AMBER, ENDED_TEXT } = colors
  const accent = isSpecial ? ENDED_TEXT : AMBER

  return (
    <PressableTactile intensity="hero" onPress={onPress} style={[styles.primaryCard, styles.primaryCardBordered, { borderColor: `${accent}33`, shadowColor: colors.SHADOW_COLOR ?? 'rgba(0,0,0,0.3)' }]}>
      {/* Three layered shapes at different geometries — reads as a
          designed, asymmetric composition rather than a flat card with a
          decorative circle. */}
      <PrimaryNoImageBackground colors={colors} isSpecial={isSpecial} />
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
      <SaveToggle item={item} navigation={navigation} style={styles.saveTogglePrimary} color={accent} size={18} />
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
function SecondaryRow({ item, colors, onPress, userId, navigation, hasMemory = false, onViewMemory = null }) {
  const { TEXT, CARD_ELEVATED, AMBER, ENDED_TEXT, SHADOW_COLOR } = colors
  const isSpecial = isSpecialItemPresentation(item)
  const { venueName, thing } = deriveVenueAndThing(item)
  const artwork = useCardArtwork(item, userId)
  const accent = isSpecial ? ENDED_TEXT : AMBER
  const distLabel = item?.is_universal ? null : formatDistanceLabel(item?.distM)
  // venueName only exists for items with a real partners row — most
  // real featured businesses don't have one (see lib/itemDetailHeaderTitle.js's
  // note). Try the same quoted-venue extraction from body before falling
  // back to the item hook, or "Order the..." leaks into the teaser here too.
  const teaserLabel = venueName || extractQuotedVenueFromBody(item?.body) || thing
  const rowAccentDot = () => (
    <View style={[styles.rowAccentWrap, { backgroundColor: `${accent}1F` }]}>
      <View style={[styles.rowAccentDot, { backgroundColor: accent }]} />
    </View>
  )

  return (
    <PressableTactile
      intensity="utility"
      onPress={onPress}
      shadowColor={SHADOW_COLOR ?? 'rgba(0,0,0,0.3)'}
      style={[styles.rowCard, { backgroundColor: CARD_ELEVATED, borderColor: `${accent}2E` }]}
    >
      {artwork.isPhoto ? (
        <Image
          key={artwork.url}
          source={{ uri: artwork.url }}
          style={styles.rowImage}
          resizeMode="cover"
          onError={artwork.onError}
          accessibilityElementsHidden
          importantForAccessibility="no"
          accessibilityLabel=""
        />
      ) : artwork.isArchetype ? (
        <ArchetypeArtwork
          url={artwork.url}
          onError={artwork.onError}
          renderGenericFallback={rowAccentDot}
          gradient={false}
          style={styles.rowImage}
        />
      ) : (
        rowAccentDot()
      )}
      <View style={styles.rowTextBlock}>
        {isSpecial && <Text style={[styles.rowSpecialTag, { color: ENDED_TEXT }]}>✦ SECRET</Text>}
        <Text style={[styles.rowVenue, { color: TEXT }]} numberOfLines={1}>{teaserLabel}</Text>
        {distLabel ? <Text style={[styles.rowMeta, { color: TEXT, opacity: 0.5 }]} numberOfLines={1}>{distLabel}</Text> : null}
      </View>
      {hasMemory && onViewMemory ? (
        <MemoryBadge item={item} onViewMemory={onViewMemory} style={styles.saveToggleRow} color={accent} size={15} />
      ) : null}
      <SaveToggle item={item} navigation={navigation} style={styles.saveToggleRow} color={accent} size={15} />
      <Text style={[styles.rowChevron, { color: accent }]}>→</Text>
    </PressableTactile>
  )
}

// What's Good horizontal rail — 3 equal-size cards instead of 1 large +
// 2 stacked rows (see components/home/WhatsGoodDiscovery.jsx for why: the
// large-card layout looked weak whenever the lead item had no photo — a
// mostly-empty card followed by two small rows). Each rail card is
// individually image-capable/not-image-dependent, same as the old primary
// card, just at rail proportions. Deterministic no-photo accent by card
// index (not item id — index is stable across re-renders and re-fetches,
// an id-based hash would also work but index is simpler and the 3 slots
// are always exactly 3), so three no-photo cards in the same rail don't
// look like clones — cycling amber / green / purple, the same three
// accent hues already used elsewhere in this app (e.g. the ring-dot
// palette in DiscoverScreen.jsx), not a new color system. A secret item
// always gets the purple "special" treatment regardless of index — that
// signal takes priority over the position-based cycle.
// Rail no-image decorative background only (no text) — same extraction
// pattern as PrimaryNoImageBackground above, reused both by the pure
// generic rail card and as ArchetypeArtwork's generic base layer for the
// rail archetype tier.
function RailNoImageBackground({ colors, isSpecial, accent }) {
  const { CARD_ELEVATED, ENDED_BG } = colors
  const surface = isSpecial ? ENDED_BG : CARD_ELEVATED
  return (
    <>
      <LinearGradient
        colors={[surface, `${accent}18`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.railWashOuter(accent)} pointerEvents="none" />
      <View style={styles.railWashInner(accent)} pointerEvents="none" />
      <View style={styles.railAccentBar(accent)} pointerEvents="none" />
    </>
  )
}

// Shared "something photo-like is behind this" overlay text for the rail
// card — same reasoning as PrimaryOverlayText above (real photo and
// loaded/loading archetype scrim render identical text markup).
function RailOverlayText({ isSpecial, venueName, thing, meta, accent }) {
  return (
    <>
      {isSpecial && (
        <View style={[styles.railSpecialBadge, { backgroundColor: 'rgba(122,77,179,0.9)' }]}>
          <Text style={styles.railSpecialBadgeText}>✦ SECRET</Text>
        </View>
      )}
      <View style={styles.railOverlayText}>
        {venueName ? <Text style={styles.railOverlayVenue} numberOfLines={1}>{venueName}</Text> : null}
        <Text style={styles.railOverlayThing} numberOfLines={2}>{thing}</Text>
        <View style={styles.railFooter}>
          {meta ? <Text style={styles.railOverlayMeta} numberOfLines={1}>{meta}</Text> : <View />}
          <Text style={[styles.railChevron, { color: accent }]}>→</Text>
        </View>
      </View>
    </>
  )
}

function RailCard({ item, index, colors, onPress, userId, cardWidth, cardHeight, navigation, hasMemory = false, onViewMemory = null }) {
  const { TEXT, MUTED, CARD_ELEVATED, ENDED_BG, SHADOW_COLOR } = colors
  const isSpecial = isSpecialItemPresentation(item)
  const { venueName, thing } = deriveVenueAndThing(item)
  const meta = metaLine(item)
  const artwork = useCardArtwork(item, userId)
  const accent = railAccentForIndex(index, colors, isSpecial)
  const dims = { width: cardWidth, height: cardHeight }

  if (artwork.isPhoto) {
    return (
      <PressableTactile
        intensity="hero"
        onPress={onPress}
        style={[styles.railCard, dims, { shadowColor: SHADOW_COLOR ?? 'rgba(0,0,0,0.3)' }]}
      >
        <Image
          key={artwork.url}
          source={{ uri: artwork.url }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
          onError={artwork.onError}
          accessibilityElementsHidden
          importantForAccessibility="no"
          accessibilityLabel=""
        />
        <LinearGradient
          colors={['transparent', 'rgba(6,6,14,0.35)', 'rgba(6,6,14,0.92)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        <RailOverlayText isSpecial={isSpecial} venueName={venueName} thing={thing} meta={meta} accent={accent} />
        {hasMemory && onViewMemory ? (
          <MemoryBadge item={item} onViewMemory={onViewMemory} style={styles.memoryBadgeRail} color="#fff" size={14} />
        ) : null}
        <SaveToggle item={item} navigation={navigation} style={styles.saveToggleRail} color="#fff" size={14} />
      </PressableTactile>
    )
  }

  if (artwork.isArchetype) {
    return (
      <PressableTactile
        intensity="hero"
        onPress={onPress}
        style={[styles.railCard, dims, { shadowColor: SHADOW_COLOR ?? 'rgba(0,0,0,0.3)' }]}
      >
        <ArchetypeArtwork
          url={artwork.url}
          onError={artwork.onError}
          renderGenericFallback={() => <RailNoImageBackground colors={colors} isSpecial={isSpecial} accent={accent} />}
          style={StyleSheet.absoluteFillObject}
        />
        <RailOverlayText isSpecial={isSpecial} venueName={venueName} thing={thing} meta={meta} accent={accent} />
        {hasMemory && onViewMemory ? (
          <MemoryBadge item={item} onViewMemory={onViewMemory} style={styles.memoryBadgeRail} color="#fff" size={14} />
        ) : null}
        <SaveToggle item={item} navigation={navigation} style={styles.saveToggleRail} color="#fff" size={14} />
      </PressableTactile>
    )
  }

  return (
    <PressableTactile
      intensity="hero"
      onPress={onPress}
      style={[styles.railCard, styles.railCardBordered, dims, { borderColor: `${accent}33`, shadowColor: SHADOW_COLOR ?? 'rgba(0,0,0,0.3)' }]}
    >
      <RailNoImageBackground colors={colors} isSpecial={isSpecial} accent={accent} />
      <View style={styles.railTextBlock}>
        {isSpecial && (
          <View style={[styles.railSpecialInline, { borderColor: accent }]}>
            <Text style={[styles.railSpecialInlineText, { color: accent }]}>✦ SECRET</Text>
          </View>
        )}
        {venueName ? (
          <>
            <Text style={[styles.railNoImageVenue, { color: accent }]} numberOfLines={1}>{venueName}</Text>
            <View style={[styles.railVenueRule, { backgroundColor: accent }]} />
          </>
        ) : null}
        <Text style={[styles.railNoImageThing, { color: TEXT }]} numberOfLines={3}>{thing}</Text>
        <View style={styles.railFooter}>
          {meta ? <Text style={[styles.railNoImageMeta, { color: MUTED }]} numberOfLines={1}>{meta}</Text> : <View />}
          <Text style={[styles.railChevron, { color: accent }]}>→</Text>
        </View>
      </View>
      {hasMemory && onViewMemory ? (
        <MemoryBadge item={item} onViewMemory={onViewMemory} style={styles.memoryBadgeRail} color={accent} size={14} />
      ) : null}
      <SaveToggle item={item} navigation={navigation} style={styles.saveToggleRail} color={accent} size={14} />
    </PressableTactile>
  )
}

export default function EditorialCard({ item, onPress, colors, variant = 'primary', userId = null, index = 0, cardWidth, cardHeight, navigation = null, hasMemory = false, onViewMemory = null }) {
  if (!item) return null

  const isSpecial = isSpecialItemPresentation(item)
  const { venueName, thing } = deriveVenueAndThing(item)
  const meta = metaLine(item)
  const artwork = useCardArtwork(item, userId)

  // Check-In Memory Viewer (2026-09-23) — hasMemory/onViewMemory are only
  // wired into the 'row' variant for now (the natural attachment point
  // for a compact already-completed card on Home; see
  // components/home/NearYouCompact.jsx). Other variants ignore these
  // props entirely — zero behavior change for primary/rail/archetype
  // cards.
  if (variant === 'row') {
    return <SecondaryRow item={item} colors={colors} onPress={onPress} userId={userId} navigation={navigation} hasMemory={hasMemory} onViewMemory={onViewMemory} />
  }

  if (variant === 'rail') {
    return <RailCard item={item} index={index} colors={colors} onPress={onPress} userId={userId} cardWidth={cardWidth} cardHeight={cardHeight} navigation={navigation} />
  }

  if (artwork.isPhoto) {
    return <PrimaryImageMode item={item} colors={colors} isSpecial={isSpecial} venueName={venueName} thing={thing} meta={meta} onPress={onPress} userId={userId} artwork={artwork} navigation={navigation} />
  }
  if (artwork.isArchetype) {
    return <PrimaryArchetypeMode item={item} colors={colors} isSpecial={isSpecial} venueName={venueName} thing={thing} meta={meta} onPress={onPress} artwork={artwork} navigation={navigation} />
  }
  return <PrimaryNoImageMode item={item} colors={colors} isSpecial={isSpecial} venueName={venueName} thing={thing} meta={meta} onPress={onPress} navigation={navigation} />
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

  // Saved Items V1 (2026-09-18) — shared bookmark-control hit area. A
  // plain View style (the touch handling itself lives on the wrapping
  // Pressable in SaveToggle) with enough padding for a practical ~44pt
  // touch target via hitSlop rather than visually inflating the icon.
  saveToggle: { padding: 8, borderRadius: 999 },
  saveTogglePrimary: { position: 'absolute', top: 10, right: 10 },
  saveToggleRail: { position: 'absolute', top: 6, right: 6, padding: 6 },
  // Check-In Memory Viewer (2026-09-23) — opposite corner from the
  // bookmark control above so the two never overlap.
  memoryBadgeRail: { position: 'absolute', top: 6, left: 6, padding: 6 },
  saveToggleRow: { paddingHorizontal: 4 },

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

// ── What's Good horizontal rail card ────────────────────────────────────────
// Compact version of the primary card's two visual languages (photo-forward
// overlay / designed no-photo composition), sized for a fixed width/height
// in a horizontal ScrollView rather than filling the section's full width.
Object.assign(styles, StyleSheet.create({
  railCard: { borderRadius: 20, overflow: 'hidden', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12 },
  railCardBordered: { borderWidth: 1 },

  railOverlayText: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14 },
  railOverlayVenue: { color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginBottom: 3, textTransform: 'uppercase' },
  railOverlayThing: { color: '#fff', fontSize: 15, fontWeight: '900', lineHeight: 19, marginBottom: 6 },
  railOverlayMeta: { color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: '700', flexShrink: 1 },

  railSpecialBadge: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  railSpecialBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },

  railTextBlock: { flex: 1, padding: 16, justifyContent: 'center' },
  railNoImageVenue: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5, marginBottom: 5, textTransform: 'uppercase' },
  railVenueRule: { width: 20, height: 3, borderRadius: 2, marginBottom: 9, marginTop: -3 },
  railNoImageThing: { fontSize: 16, fontWeight: '900', lineHeight: 20, marginBottom: 6, letterSpacing: -0.2 },
  railNoImageMeta: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  railSpecialInline: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, marginBottom: 8 },
  railSpecialInlineText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },

  railFooter: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  railChevron: { fontSize: 14, fontWeight: '900', marginLeft: 8 },
}))

// Same layered-shape idea as the primary no-image hero (styles.noImageWash*
// above), scaled down for the smaller rail card footprint.
styles.railWashOuter = (accentColor) => ({
  position: 'absolute',
  top: -36,
  right: -36,
  width: 130,
  height: 130,
  borderRadius: 65,
  backgroundColor: accentColor,
  opacity: 0.12,
})
styles.railWashInner = (accentColor) => ({
  position: 'absolute',
  bottom: -22,
  left: -22,
  width: 80,
  height: 80,
  borderRadius: 40,
  backgroundColor: accentColor,
  opacity: 0.08,
})
styles.railAccentBar = (accentColor) => ({
  position: 'absolute',
  bottom: 14,
  right: -46,
  width: 120,
  height: 8,
  borderRadius: 4,
  backgroundColor: accentColor,
  opacity: 0.12,
  transform: [{ rotate: '-18deg' }],
})
