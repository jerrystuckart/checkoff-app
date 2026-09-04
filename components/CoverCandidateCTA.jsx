// Community Cover Photos V1 — the subtle contribution CTA. Only ever
// rendered by a caller that has already confirmed eligibility (see
// lib/coverCandidateEligibility.js) — this component itself does not
// re-check any policy, it's pure presentation + navigation.
//
// Surfaces: What's the Thing hero only in V1 (see
// components/home/WhatsTheThingHero.jsx). Deliberately NOT added to normal
// What's Good discovery cards — we don't want users remotely submitting
// photos of places they aren't actually at.

// PREMIUM POLISH PASS (2026-09-03): visibility bump per Jerry feedback —
// "the upload ask should be visible enough to be used, not hidden." Still
// deliberately optional-feeling (dashed border, no full-bleed fill), but
// now uses PressableTactile for real press feedback instead of a flat
// opacity fade, plus a soft amber-tinted surface so it doesn't read as an
// afterthought against the surrounding card/hero.
//
// REAL-DEVICE FOLLOW-UP (2026-09-03): a THIRD variant, 'pill', for
// WhatsTheThingHero's compact side-by-side action row — the standalone
// full-width card below the hero made the at-place state too tall on a
// real device. 'pill' is a compact, obviously-tappable secondary button
// (camera glyph + short label only) meant to sit next to the primary
// "Check it off" pill, not a replacement for the fuller 'card'/'compact'
// treatments still used on Item Detail and the post-checkoff prompt.

import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import PressableTactile from './PressableTactile'

export default function CoverCandidateCTA({ item, navigation, colors, compact = false, variant = 'card' }) {
  const { TEXT, MUTED, AMBER } = colors

  if (variant === 'pill') {
    return (
      <PressableTactile
        intensity="utility"
        shadowColor="transparent"
        onPress={() => navigation.navigate('CoverCandidateCapture', { item })}
        style={[styles.pill, { borderColor: `${AMBER}66`, backgroundColor: `${AMBER}14` }]}
        accessibilityLabel="Take a photo to be considered for the cover"
      >
        <Text style={styles.pillGlyph}>📷</Text>
        <Text
          style={[styles.pillText, { color: AMBER }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          Add photo
        </Text>
      </PressableTactile>
    )
  }

  return (
    <PressableTactile
      intensity="utility"
      shadowColor="transparent"
      onPress={() => navigation.navigate('CoverCandidateCapture', { item })}
      style={[compact ? styles.compactWrapper : styles.wrapper, { borderColor: `${AMBER}55`, backgroundColor: `${AMBER}14` }]}
    >
      <View style={styles.row}>
        <Text style={styles.cameraGlyph}>📷</Text>
        <View style={styles.textCol}>
          {!compact && (
            <>
              <Text style={[styles.title, { color: TEXT }]}>No photo yet</Text>
              <Text style={[styles.subtitle, { color: MUTED }]}>Want to help make this better?</Text>
            </>
          )}
          <Text style={[styles.cta, { color: AMBER }]}>Take a photo to be considered for the cover →</Text>
        </View>
      </View>
    </PressableTactile>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 10, padding: 14, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed' },
  compactWrapper: { marginTop: 8, padding: 12, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed' },
  row: { flexDirection: 'row', alignItems: 'center' },
  cameraGlyph: { fontSize: 20, marginRight: 10 },
  textCol: { flex: 1 },
  title: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  subtitle: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  cta: { fontSize: 12, fontWeight: '800' },

  // FINAL UI PASS BEFORE BUILD 144 — item 5: flex:1 so this pill matches
  // the primary CTA pill's footprint exactly (same flex row, same
  // paddingVertical -> same height) rather than sizing to its own content.
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 10, paddingVertical: 13, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed',
  },
  pillGlyph: { fontSize: 15, marginRight: 6 },
  pillText: { fontSize: 15, fontWeight: '800' },
})
