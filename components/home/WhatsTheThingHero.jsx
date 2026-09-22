// Home 2026 — "Here's the Thing" as a true at-place STATE CHANGE, rebuilt
// with real tactile weight for the "make Home feel powerful" pass. Two
// modes:
//   dominant (default) — the primary hero when no destination is active
//     (see lib/homeHeroLayout.js). "YOU'RE AT {venue}" / "HERE'S THE
//     THING" / item body, each its own visual element, plus an explicit
//     tactile CTA pill (not just whole-card-tap).
//   compact — folded into the secondary slot when a Destination hero is
//     already occupying the primary spot, so the page never stacks two
//     full-size heroes.
//
// Secret items lean further into the app's existing purple "ended/
// special" theme tokens — layered surfaces + a soft glow wash, not just a
// badge — while never assuming a secret item should show a revealing
// image (unchanged: image only renders when resolvedItemImage() finds one).
//
// Uses the existing, approved foreground presence rule
// (min(item.geo_radius_m, 150m)) upstream — this component only renders
// whichever item useWhatsGood.js's atPlaceItem already is; it does not
// recompute or touch any radius/dwell logic.
//
// Press feedback goes through PressableTactile (real elevation-shadow
// compression + scale/translate + haptic).
//
// REAL-DEVICE FOLLOW-UP (2026-09-03):
//   1. The standalone full-width CoverCandidateCTA card below the hero
//      made the at-place state too tall — the photo action now sits
//      inline, next to the primary CTA, as CoverCandidateCTA's new 'pill'
//      variant (nested Pressable inside the outer card; RN routes touch to
//      the most specific handler, so this doesn't fight the whole-card tap).
//      Eligibility (lib/coverCandidateEligibility.js) already excludes
//      items with an approved image, so once a real selected cover exists
//      this pill disappears on its own — no extra logic needed here.
//   2. "YOU'RE HERE" bumped up one step in size/letter-spacing for a
//      stronger "CheckOff knows I'm here" moment, still clearly
//      subordinate to the item body (see Right Here Hero redesign below).
//   3. New image-capable dominant mode: when the item has a real resolved
//      image (a selected community cover, or a future item/venue photo),
//      the hero renders as a full-bleed photo canvas with a real gradient
//      scrim (same LinearGradient approach as EditorialCard's primary
//      image card) instead of a small fixed-height thumbnail — text stays
//      readable over any photo, CTA row moves onto the scrim.
//
// RIGHT HERE HERO REDESIGN (Phase 2/5, 2026-09-22): recentered the card on
// the specific action rather than location confirmation. "YOU'RE HERE" /
// "YOU'RE AT {venue}" stays confirmation-only; "HERE'S THE THING" is a
// short kicker label (a statement, not a question); the item body is now
// the single largest, boldest text in the card (see title/body style
// comments below); the CTA reads "I DID THE THING" and still only
// launches ItemDetail (unchanged — this card never mutates anything
// itself). A one-time AsyncStorage-backed explainer (see
// lib/useRightHereExplainer.js) explains the card the first time it's
// seen, with a persistent "ⓘ" toggle to re-reveal it afterward.

import React, { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Pressable, StyleSheet, Animated } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import PressableTactile from '../PressableTactile'
import { isSpecialItemPresentation } from '../../lib/whatsGoodDisplayLayout'
import { useSavedItems } from '../../lib/SavedItemsContext'
import BookmarkIcon from '../BookmarkIcon'
// Right Here Hero redesign (Phase 2/5, 2026-09-22) — "HERE'S THE THING"
// copy pass: the card's job is to launch the specific action at this venue
// (tap -> ItemDetail, which owns the actual geofence check + mutation),
// not to confirm location. See lib/rightHereHeroLogic.js for the pure
// decision helpers this file uses (explainer auto-show, view-event dedupe).
import { useRightHereExplainer } from '../../lib/useRightHereExplainer'
import { shouldFireRightHereViewed } from '../../lib/rightHereHeroLogic'
import { trackEvent } from '../../lib/trackEvent'
// Archetype Fallback Artwork V1 (2026-09-17) — see useCardArtwork.js.
// Replaces the direct resolvedItemImage() call: same `{ url }` shape for a
// real approved photo, plus resolved archetype/category-default artwork
// when there's no real photo (with its own onError -> generic fallback).
import { useCardArtwork } from './useCardArtwork'
// Hardening pass (2026-09-17) — see components/home/ArchetypeArtwork.jsx
// and EditorialCard.jsx's identical usage. Used only for the dominant
// (non-compact) archetype tier below; the real-photo tier keeps its
// existing plain <Image>, untouched.
import ArchetypeArtwork from './ArchetypeArtwork'
import { useCoverCandidateCTA } from '../../lib/useCoverCandidateCTA'
import CoverCandidateCTA from '../CoverCandidateCTA'

// The dominant (non-compact) no-image hero's decorative background ONLY
// (surface fill + the special-item glow wash) — no text. Mirrors the
// existing generic-tier background exactly, extracted so it can also
// serve as ArchetypeArtwork's generic base layer for the archetype tier,
// per the layering contract in components/home/ArchetypeArtwork.jsx.
function HeroNoImageBackground({ colors, isSpecial }) {
  const { CARD_ELEVATED, ENDED_BG, ENDED_TEXT } = colors
  const surface = isSpecial ? ENDED_BG : CARD_ELEVATED
  return (
    <>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: surface }]} />
      {isSpecial ? <View style={[styles.glowWash, { backgroundColor: ENDED_TEXT }]} pointerEvents="none" /> : null}
    </>
  )
}

export default function WhatsTheThingHero({ item, navigation, colors, compact = false, userId = null }) {
  const anim = useRef(new Animated.Value(0)).current
  const showContributionCTA = useCoverCandidateCTA({ userId, item })
  // Saved Items V1 (2026-09-18) — only in the dominant (non-compact) mode.
  // The compact mode's ctaRow/photo-pill action row is already tight on
  // narrow devices (see ctaRow's own flexWrap comment above) — Check It
  // Off and Add a Photo are the approved dominant actions there, and a
  // fourth competing element in that already-crowded row risks exactly
  // the clutter the approved Right Here redesign explicitly avoided. The
  // dominant card has real unused space in its top-right corner (away
  // from the eyebrow/title/body/CTA column, which is bottom-anchored or
  // left-aligned in every mode), so the bookmark sits there instead —
  // never inside or adjacent to the CTA row.
  const { isSaved, toggleSaved } = useSavedItems()
  // Called unconditionally (rules-of-hooks) even though this component
  // bails out below when item is null — useCardArtwork tolerates a null
  // item (resolveArtworkTier -> generic tier) the same way
  // useCoverCandidateCTA above already does.
  const artwork = useCardArtwork(item, userId)

  // Right Here Hero redesign (Phase 2/5) — one-time explainer state. Called
  // unconditionally (rules-of-hooks), same reasoning as useCardArtwork
  // above: this hook tolerates rendering before `item` exists.
  const { hasSeenExplainer, dismissExplainer, checkingExplainer } = useRightHereExplainer()
  const [explainerOpen, setExplainerOpen] = useState(false)
  const lastViewedItemIdRef = useRef(null)

  useEffect(() => {
    anim.setValue(0)
    Animated.timing(anim, { toValue: 1, duration: 350, useNativeDriver: true }).start()
  }, [item?.id, anim])

  // Auto-open the explainer exactly once, the first time this device ever
  // sees the Right Here hero (compact/folded mode never triggers it — see
  // shouldFireRightHereViewed's compact guard below for the same reasoning
  // applied to the analytics event).
  useEffect(() => {
    if (!compact && !checkingExplainer && !hasSeenExplainer) {
      setExplainerOpen(true)
    }
  }, [compact, checkingExplainer, hasSeenExplainer])

  // Phase 7 analytics — 'right_here_viewed' fires once per distinct
  // at-place item in dominant mode, guarded locally via a ref rather than
  // extending trackEvent.js's own DEBOUNCED_TYPES set (see
  // lib/rightHereHeroLogic.js's comment on shouldFireRightHereViewed for
  // why: that set is a time-based per-subject cooldown, not a "once per
  // item currently shown" guard).
  useEffect(() => {
    if (shouldFireRightHereViewed({ compact, itemId: item?.id, lastFiredItemId: lastViewedItemIdRef.current })) {
      lastViewedItemIdRef.current = item.id
      trackEvent('right_here_viewed', { itemId: item.id })
    }
  }, [compact, item?.id])

  if (!item) return null

  const { TEXT, MUTED, AMBER, NAVY, CARD_ELEVATED, ENDED_BG, ENDED_BORDER, ENDED_TEXT, SHADOW_COLOR } = colors
  const isSpecial = isSpecialItemPresentation(item)
  const venueName = item.partnerName ?? null
  // Compact mode never shows a photo-style background of either kind
  // (real photo or archetype) — unchanged from before this pass.
  const showImageMode = !compact && artwork.isPhoto
  const showArchetypeMode = !compact && artwork.isArchetype
  const showPhotoLikeMode = showImageMode || showArchetypeMode

  const opacity = anim
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] })

  const surface = isSpecial ? ENDED_BG : CARD_ELEVATED
  const accentBorder = isSpecial ? ENDED_BORDER : AMBER
  const accentText = isSpecial ? ENDED_TEXT : AMBER

  const eyebrowText = venueName ? `YOU'RE AT ${venueName.toUpperCase()}` : "YOU'RE HERE"

  // Right Here Hero redesign (Phase 2/5) — the primary message is now a
  // statement ("HERE'S THE THING"), not a question, per product spec.
  // "You're here" stays confirmation-only and visually subordinate (see
  // the eyebrow/title style sizing below — body is the dominant element).
  const primaryMessage = "HERE'S THE THING"

  // Right Here Hero redesign (Phase 2/5) — one-time explainer copy + the
  // small persistent "i" affordance that re-reveals it on demand after the
  // first dismissal (no other discoverable surface exists for this today —
  // see final report). Dominant mode only: the compact/folded row has no
  // room for it and already omits the CTA entirely.
  const explainerOnPress = () => {
    if (explainerOpen) {
      setExplainerOpen(false)
      if (!hasSeenExplainer) dismissExplainer()
    } else {
      setExplainerOpen(true)
    }
  }
  const renderExplainerToggle = (onImage) => (
    <Pressable
      onPress={explainerOnPress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.explainerToggle}
      accessibilityRole="button"
      accessibilityLabel={explainerOpen ? 'Hide explanation' : 'What is this?'}
    >
      <Text style={[styles.explainerToggleText, { color: onImage ? 'rgba(255,255,255,0.85)' : MUTED }]}>ⓘ</Text>
    </Pressable>
  )
  const renderExplainerBanner = (onImage) => (
    explainerOpen ? (
      <Pressable onPress={explainerOnPress} style={[styles.explainerBanner, onImage ? styles.explainerBannerOnImage : { backgroundColor: surface, borderColor: accentBorder }]}>
        <Text style={[styles.explainerBannerText, { color: onImage ? '#fff' : TEXT }]}>
          CheckOff shows you the specific thing worth doing at each place.
        </Text>
        <Text style={[styles.explainerBannerDismiss, { color: onImage ? 'rgba(255,255,255,0.75)' : MUTED }]}>Got it</Text>
      </Pressable>
    ) : null
  )

  // Right Here redesign (2026-09-17) — points/difficulty metadata line.
  // Same "+{difficulty} pts" convention already used by DiscoverScreen's
  // row card (see screens/DiscoverScreen.jsx's ptsText) — no new points
  // logic invented here, and deliberately NOT a duplicate "RIGHT HERE"
  // label (that would be redundant with the eyebrow above/inside the
  // card, per design correction).
  const pointsLabel = `+${item.difficulty ?? 1} pts`

  // FINAL UI PASS BEFORE BUILD 144 — item 5: both actions get equal flex
  // (same footprint) and are hard-capped to one line via
  // adjustsFontSizeToFit (shrinks the text instead of wrapping it or
  // growing the button). When there's no photo pill, the CTA takes the
  // full row instead of half of it.
  const ctaRow = (
    <View style={styles.ctaRow}>
      <View style={[styles.ctaPill, { backgroundColor: accentText }, !showContributionCTA && styles.ctaPillSolo]}>
        <View style={styles.ctaPillHighlight} pointerEvents="none" />
        <Text
          style={[styles.ctaPillText, { color: NAVY }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          I DID THE THING
        </Text>
      </View>
      {showContributionCTA && (
        <CoverCandidateCTA item={item} navigation={navigation} colors={colors} variant="pill" />
      )}
    </View>
  )

  // Shared overlay text for both "something photo-like is behind this"
  // modes (a real approved photo, OR a loaded/loading archetype scrim) —
  // identical markup either way, same reasoning as EditorialCard's
  // PrimaryOverlayText/RailOverlayText.
  const imageTextBlock = (
    <View style={styles.imageTextBlock}>
      <View style={styles.eyebrowRow}>
        <Text style={[styles.eyebrowOnImage, { color: isSpecial ? '#D9C4F5' : '#FFD98C' }]} allowFontScaling={false}>
          {eyebrowText}
        </Text>
        {!compact && renderExplainerToggle(true)}
      </View>
      {!compact && renderExplainerBanner(true)}
      <Text style={styles.titleOnImage}>{primaryMessage}</Text>
      <Text style={styles.bodyOnImage} numberOfLines={compact ? 1 : 4}>{item.body}</Text>
      <Text style={styles.metaOnImage}>{pointsLabel}</Text>
      {ctaRow}
    </View>
  )

  return (
    <Animated.View style={[compact ? styles.compactWrapper : styles.wrapper, { opacity, transform: [{ scale }] }]}>
      <PressableTactile
        intensity={compact ? 'utility' : 'hero'}
        onPress={() => {
          // Phase 7 analytics — the whole card is (and remains, unchanged)
          // the single tap target that launches ItemDetail; the visible
          // "I DID THE THING" pill is that same action's affordance, not a
          // separately-wired control. Only dominant mode shows that pill,
          // so only dominant-mode taps count as a primary-action tap here
          // (compact's folded row has no CTA to represent).
          if (!compact) trackEvent('right_here_primary_action_tapped', { itemId: item.id })
          navigation.navigate('ItemDetail', { item })
        }}
        shadowColor={SHADOW_COLOR ?? 'rgba(0,0,0,0.3)'}
        accessibilityRole="button"
        accessibilityLabel={venueName ? `${item.body}, at ${venueName}` : item.body}
        style={[
          compact ? styles.compactCard : styles.card,
          showPhotoLikeMode ? styles.imageCard : { backgroundColor: surface, borderColor: accentBorder },
        ]}
      >
        {showImageMode ? (
          <View style={styles.imageWrapper}>
            <Image
              key={artwork.url}
              source={{ uri: artwork.url }}
              style={styles.image}
              resizeMode="cover"
              onError={artwork.onError}
              accessibilityElementsHidden
              importantForAccessibility="no"
              accessibilityLabel=""
            />
            <LinearGradient
              colors={['transparent', 'rgba(6,6,14,0.4)', 'rgba(6,6,14,0.94)']}
              locations={[0, 0.4, 1]}
              style={StyleSheet.absoluteFillObject}
            />
            {imageTextBlock}
          </View>
        ) : showArchetypeMode ? (
          <View style={styles.imageWrapper}>
            <ArchetypeArtwork
              url={artwork.url}
              onError={artwork.onError}
              renderGenericFallback={() => <HeroNoImageBackground colors={colors} isSpecial={isSpecial} />}
              style={StyleSheet.absoluteFillObject}
            />
            {imageTextBlock}
          </View>
        ) : (
          <>
            {isSpecial && !compact ? <View style={[styles.glowWash, { backgroundColor: ENDED_TEXT }]} pointerEvents="none" /> : null}
            <View style={styles.textBlock}>
              <View style={styles.eyebrowRow}>
                <Text style={[compact ? styles.compactEyebrow : styles.eyebrow, { color: accentText }]} allowFontScaling={false}>
                  {eyebrowText}
                </Text>
                {!compact && renderExplainerToggle(false)}
              </View>
              {!compact && renderExplainerBanner(false)}
              <Text style={[compact ? styles.compactTitle : styles.title, { color: TEXT }]} numberOfLines={1}>{primaryMessage}</Text>
              <Text style={[compact ? styles.compactBody : styles.body, { color: compact ? MUTED : TEXT }]} numberOfLines={compact ? 1 : 4}>
                {item.body}
              </Text>
              {isSpecial && !compact ? (
                <View style={[styles.specialBadge, { borderColor: ENDED_TEXT }]}>
                  <Text style={[styles.specialBadgeText, { color: ENDED_TEXT }]}>✦ Secret unlocked</Text>
                </View>
              ) : null}
              {!compact ? <Text style={[styles.metaText, { color: MUTED }]}>{pointsLabel}</Text> : null}
              {!compact && ctaRow}
            </View>
          </>
        )}
        {/* Rendered last (after every mode's own text/CTA content) so a
            screen reader reaches "You're here" / "Here's the Thing" /
            body / points / I Did the Thing first — the bookmark never
            jumps the reading order ahead of that content, even though it's
            visually pinned to the top-right corner. */}
        {!compact && (
          <Pressable
            onPress={() => toggleSaved(item.id, navigation)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.saveToggle}
            accessibilityRole="button"
            accessibilityState={{ selected: isSaved(item.id) }}
            accessibilityLabel={isSaved(item.id) ? `Remove ${item.body} from Saved` : `Save ${item.body}`}
          >
            <BookmarkIcon filled={isSaved(item.id)} color={showPhotoLikeMode ? '#fff' : accentText} size={18} />
          </Pressable>
        )}
      </PressableTactile>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginHorizontal: 16, marginTop: 10 },
  card: { borderRadius: 24, borderWidth: 2, overflow: 'hidden' },
  imageCard: { borderRadius: 24, borderWidth: 0, overflow: 'hidden' },
  imageWrapper: { minHeight: 280, justifyContent: 'flex-end' },
  image: { ...StyleSheet.absoluteFillObject },
  imageTextBlock: { padding: 20 },
  // Right Here Hero redesign (Phase 2/5, 2026-09-22) — hierarchy inverted
  // from the original pass: the item body (the actual thing to do) is now
  // the visually dominant element, "HERE'S THE THING" is a short kicker
  // label above it, and the eyebrow stays the smallest/quietest of the
  // three (confirmation only, per the hard requirement that "You're here"
  // never outweighs the body).
  eyebrowOnImage: { fontSize: 13, fontWeight: '900', letterSpacing: 0.9, marginBottom: 6, textTransform: 'uppercase' },
  titleOnImage: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.4, marginBottom: 6, textTransform: 'uppercase' },
  bodyOnImage: { color: 'rgba(255,255,255,0.96)', fontSize: 19, fontWeight: '700', lineHeight: 26, marginBottom: 6 },
  // Right Here redesign (2026-09-17) — points/difficulty metadata, shared
  // shape across both photo-like and plain-surface branches. Deliberately
  // plain text, no pill/badge chrome, so it never competes visually with
  // the "RIGHT HERE"-style redundancy the design correction removed.
  metaOnImage: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginBottom: 10 },
  metaText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginTop: 2, marginBottom: 10 },
  textBlock: { padding: 20 },
  // "You're Here" emphasis bump (real-device feedback, 2026-09-03): a
  // notch larger and slightly wider letter-spacing than the compact
  // variant, still unambiguously smaller/quieter than the item body below
  // it (see title/body hard-requirement comment above).
  eyebrow: { fontSize: 13, fontWeight: '900', letterSpacing: 0.9, marginBottom: 7 },
  compactEyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 0.7, marginBottom: 2 },
  // Same hierarchy inversion as titleOnImage/bodyOnImage above — body is
  // now the largest, boldest text in the card; title is a short kicker.
  title: { fontSize: 15, fontWeight: '800', letterSpacing: 0.4, marginBottom: 6, textTransform: 'uppercase' },
  body: { fontSize: 19, fontWeight: '700', lineHeight: 26 },
  specialBadge: { alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  specialBadgeText: { fontSize: 11, fontWeight: '800' },

  // Right Here Hero redesign (Phase 2/5) — eyebrow shares its row with the
  // small "ⓘ" explainer toggle (a nested Pressable, same pattern as
  // saveToggle below: RN routes touch to the most specific handler, so
  // this doesn't fight the whole-card tap-to-navigate).
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  explainerToggle: { paddingLeft: 8, paddingVertical: 2 },
  explainerToggleText: { fontSize: 15, fontWeight: '700' },
  explainerBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10, gap: 8,
  },
  explainerBannerOnImage: { backgroundColor: 'rgba(0,0,0,0.35)', borderColor: 'rgba(255,255,255,0.25)' },
  explainerBannerText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 16 },
  explainerBannerDismiss: { fontSize: 12, fontWeight: '800' },

  // Compact side-by-side action row (replaces the old standalone
  // full-width contribution card): both actions get equal flex (same
  // footprint/height) — primary reads visually stronger via solid fill +
  // highlight sheen + shadow, secondary via the dashed/tinted treatment in
  // CoverCandidateCTA's 'pill' variant, not via being smaller.
  // flexWrap: 'wrap' (Right Here redesign, 2026-09-17) — narrow devices /
  // large Dynamic Type can push the two actions' natural content width
  // past the available row width; wrapping lets the secondary Add a Photo
  // pill drop to its own line instead of clipping or squeezing unreadably
  // thin. Each pill's own minWidth (below) keeps it from being crushed to
  // near-zero before the wrap kicks in.
  ctaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', marginTop: 16, gap: 10 },
  ctaPill: {
    flex: 1, minWidth: 150, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 13, borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 6, elevation: 4,
  },
  // When there's no photo pill to share the row with, the CTA fills it
  // and reverts to its natural left-aligned, content-width look.
  ctaPillSolo: { flex: 0, alignSelf: 'flex-start', alignItems: 'flex-start' },
  ctaPillHighlight: { position: 'absolute', top: 0, left: 0, right: 0, height: '50%', backgroundColor: 'rgba(255,255,255,0.22)' },
  ctaPillText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  glowWash: { position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: 90, opacity: 0.14 },
  // Saved Items V1 (2026-09-18) — corner overlay, deliberately far from
  // ctaRow (which is bottom-anchored / below the text block in every
  // mode) so it never competes with Check It Off / Add a Photo.
  saveToggle: { position: 'absolute', top: 12, right: 12, padding: 8, borderRadius: 999 },

  compactWrapper: { marginHorizontal: 16, marginTop: 18 },
  compactCard: { borderRadius: 16, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center' },
  compactTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  compactBody: { fontSize: 13, fontWeight: '600' },
})
