// HomeScreen 2026 Redesign — the Destination Hub arrival hero. Same data
// (nearbyZone: banner_title/banner_subtitle/name, dismiss, onPress) as the
// legacy zoneBanner block — visually elevated to a true image-backed hero
// rather than a flat bordered card, and always wins the top hero slot (see
// lib/homeHeroLayout.js). Falls back to a themed gradient-less solid panel
// when the zone's linked curated list has no hero_image_url — same
// "no missing-image error" principle as the rest of the app's image
// fallbacks (see THEMED_LIST_ACCENTS in HomeScreen.jsx).

import React from 'react'
import { View, Text, TouchableOpacity, ImageBackground, StyleSheet } from 'react-native'

export default function DestinationHero({ zone, onPress, onDismiss, colors }) {
  if (!zone) return null
  const { NAVY, AMBER } = colors
  const title = zone.banner_title || zone.name
  const heroImageUrl = zone.curated_lists?.hero_image_url ?? null

  const Content = (
    <>
      <View style={styles.scrim} />
      <TouchableOpacity onPress={onDismiss} style={styles.dismiss} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
        <Text style={styles.dismissText}>✕</Text>
      </TouchableOpacity>
      <View style={styles.textBlock}>
        <Text style={styles.eyebrow} allowFontScaling={false}>YOU'RE IN</Text>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {zone.banner_subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{zone.banner_subtitle}</Text> : null}
        <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={[styles.cta, { backgroundColor: AMBER }]}>
          <Text style={[styles.ctaText, { color: NAVY }]}>See the list →</Text>
        </TouchableOpacity>
      </View>
    </>
  )

  if (heroImageUrl) {
    return (
      <TouchableOpacity activeOpacity={0.95} onPress={onPress} style={styles.wrapper}>
        <ImageBackground source={{ uri: heroImageUrl }} style={styles.image} imageStyle={styles.imageRadius}>
          {Content}
        </ImageBackground>
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity activeOpacity={0.95} onPress={onPress} style={[styles.wrapper, styles.image, styles.imageRadius, { backgroundColor: NAVY }]}>
      {Content}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginHorizontal: 16, marginTop: 10, borderRadius: 20, overflow: 'hidden' },
  image: { minHeight: 180, justifyContent: 'flex-end' },
  imageRadius: { borderRadius: 20 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,21,0.45)' },
  dismiss: { position: 'absolute', top: 12, right: 12, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  dismissText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  textBlock: { padding: 18 },
  eyebrow: { color: '#fff', opacity: 0.85, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 4 },
  title: { color: '#fff', fontSize: 24, fontWeight: '900', marginBottom: 4 },
  subtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginBottom: 12 },
  cta: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  ctaText: { fontSize: 13, fontWeight: '800' },
})
