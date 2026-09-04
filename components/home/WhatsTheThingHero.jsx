// Home 2026 — "What's the Thing?" as a true at-place STATE CHANGE, rebuilt
// with real tactile weight for the "make Home feel powerful" pass. Two
// modes:
//   dominant (default) — the primary hero when no destination is active
//     (see lib/homeHeroLayout.js). "YOU'RE AT {venue}" / "What's the
//     Thing?" / item body, each its own visual element, plus an explicit
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
//      inline, next to "Check it off", as CoverCandidateCTA's new 'pill'
//      variant (nested Pressable inside the outer card; RN routes touch to
//      the most specific handler, so this doesn't fight the whole-card tap).
//      Eligibility (lib/coverCandidateEligibility.js) already excludes
//      items with an approved image, so once a real selected cover exists
//      this pill disappears on its own — no extra logic needed here.
//   2. "YOU'RE HERE" bumped up one step in size/letter-spacing for a
//      stronger "CheckOff knows I'm here" moment, still clearly
//      subordinate to "What's the Thing?".
//   3. New image-capable dominant mode: when the item has a real resolved
//      image (a selected community cover, or a future item/venue photo),
//      the hero renders as a full-bleed photo canvas with a real gradient
//      scrim (same LinearGradient approach as EditorialCard's primary
//      image card) instead of a small fixed-height thumbnail — text stays
//      readable over any photo, CTA row moves onto the scrim.

import React, { useEffect, useRef } from 'react'
import { View, Text, Image, StyleSheet, Animated } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import PressableTactile from '../PressableTactile'
import { isSpecialItemPresentation } from '../../lib/whatsGoodDisplayLayout'
import { resolvedItemImage } from '../../lib/whatsGoodImageSource'
import { useCoverCandidateCTA } from '../../lib/useCoverCandidateCTA'
import CoverCandidateCTA from '../CoverCandidateCTA'

export default function WhatsTheThingHero({ item, navigation, colors, compact = false, userId = null }) {
  const anim = useRef(new Animated.Value(0)).current
  const showContributionCTA = useCoverCandidateCTA({ userId, item })

  useEffect(() => {
    anim.setValue(0)
    Animated.timing(anim, { toValue: 1, duration: 350, useNativeDriver: true }).start()
  }, [item?.id, anim])

  if (!item) return null

  const { TEXT, MUTED, AMBER, NAVY, CARD_ELEVATED, ENDED_BG, ENDED_BORDER, ENDED_TEXT, SHADOW_COLOR } = colors
  const isSpecial = isSpecialItemPresentation(item)
  const venueName = item.partnerName ?? null
  const image = resolvedItemImage(item)
  const showImageMode = !compact && Boolean(image)

  const opacity = anim
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] })

  const surface = isSpecial ? ENDED_BG : CARD_ELEVATED
  const accentBorder = isSpecial ? ENDED_BORDER : AMBER
  const accentText = isSpecial ? ENDED_TEXT : AMBER

  const eyebrowText = venueName ? `YOU'RE AT ${venueName.toUpperCase()}` : "YOU'RE HERE"

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
          Check it off →
        </Text>
      </View>
      {showContributionCTA && (
        <CoverCandidateCTA item={item} navigation={navigation} colors={colors} variant="pill" />
      )}
    </View>
  )

  return (
    <Animated.View style={[compact ? styles.compactWrapper : styles.wrapper, { opacity, transform: [{ scale }] }]}>
      <PressableTactile
        intensity={compact ? 'utility' : 'hero'}
        onPress={() => navigation.navigate('ItemDetail', { item })}
        shadowColor={SHADOW_COLOR ?? 'rgba(0,0,0,0.3)'}
        style={[
          compact ? styles.compactCard : styles.card,
          showImageMode ? styles.imageCard : { backgroundColor: surface, borderColor: accentBorder },
        ]}
      >
        {showImageMode ? (
          <View style={styles.imageWrapper}>
            <Image source={{ uri: image.url }} style={styles.image} resizeMode="cover" />
            <LinearGradient
              colors={['transparent', 'rgba(6,6,14,0.4)', 'rgba(6,6,14,0.94)']}
              locations={[0, 0.4, 1]}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.imageTextBlock}>
              <Text style={[styles.eyebrowOnImage, { color: isSpecial ? '#D9C4F5' : '#FFD98C' }]} allowFontScaling={false}>
                {eyebrowText}
              </Text>
              <Text style={styles.titleOnImage}>What's the Thing?</Text>
              <Text style={styles.bodyOnImage} numberOfLines={3}>{item.body}</Text>
              {ctaRow}
            </View>
          </View>
        ) : (
          <>
            {isSpecial && !compact ? <View style={[styles.glowWash, { backgroundColor: ENDED_TEXT }]} pointerEvents="none" /> : null}
            <View style={styles.textBlock}>
              <Text style={[compact ? styles.compactEyebrow : styles.eyebrow, { color: accentText }]} allowFontScaling={false}>
                {eyebrowText}
              </Text>
              <Text style={[compact ? styles.compactTitle : styles.title, { color: TEXT }]}>What's the Thing?</Text>
              <Text style={[compact ? styles.compactBody : styles.body, { color: compact ? MUTED : TEXT }]} numberOfLines={compact ? 1 : 3}>
                {item.body}
              </Text>
              {isSpecial && !compact ? (
                <View style={[styles.specialBadge, { borderColor: ENDED_TEXT }]}>
                  <Text style={[styles.specialBadgeText, { color: ENDED_TEXT }]}>✦ Secret unlocked</Text>
                </View>
              ) : null}
              {!compact && ctaRow}
            </View>
          </>
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
  eyebrowOnImage: { fontSize: 13, fontWeight: '900', letterSpacing: 0.9, marginBottom: 6, textTransform: 'uppercase' },
  titleOnImage: { color: '#fff', fontSize: 23, fontWeight: '900', marginBottom: 6 },
  bodyOnImage: { color: 'rgba(255,255,255,0.92)', fontSize: 15, fontWeight: '600', lineHeight: 21, marginBottom: 4 },
  textBlock: { padding: 20 },
  // "You're Here" emphasis bump (real-device feedback, 2026-09-03): a
  // notch larger and slightly wider letter-spacing than before, still
  // unambiguously smaller/quieter than "What's the Thing?" below it.
  eyebrow: { fontSize: 13, fontWeight: '900', letterSpacing: 0.9, marginBottom: 7 },
  compactEyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 0.7, marginBottom: 2 },
  title: { fontSize: 23, fontWeight: '900', marginBottom: 6 },
  body: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  specialBadge: { alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  specialBadgeText: { fontSize: 11, fontWeight: '800' },

  // Compact side-by-side action row (replaces the old standalone
  // full-width contribution card): both actions get equal flex (same
  // footprint/height) — primary reads visually stronger via solid fill +
  // highlight sheen + shadow, secondary via the dashed/tinted treatment in
  // CoverCandidateCTA's 'pill' variant, not via being smaller.
  ctaRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: 16, gap: 10 },
  ctaPill: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 13, borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 6, elevation: 4,
  },
  // When there's no photo pill to share the row with, the CTA fills it
  // and reverts to its natural left-aligned, content-width look.
  ctaPillSolo: { flex: 0, alignSelf: 'flex-start', alignItems: 'flex-start' },
  ctaPillHighlight: { position: 'absolute', top: 0, left: 0, right: 0, height: '50%', backgroundColor: 'rgba(255,255,255,0.22)' },
  ctaPillText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  glowWash: { position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: 90, opacity: 0.14 },

  compactWrapper: { marginHorizontal: 16, marginTop: 18 },
  compactCard: { borderRadius: 16, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center' },
  compactTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  compactBody: { fontSize: 13, fontWeight: '600' },
})
