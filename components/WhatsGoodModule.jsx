// What's Good V1 — HomeScreen module. Product role: "what else worthwhile
// is nearby" (distinct from Home Rail's "what's immediately around me").
// Deliberately simple V1: a horizontal rail of up to 3 cards, reusing the
// existing ItemDetail navigation path — no parallel detail system.
// Behind the `whats_good_v1` feature flag; renders nothing when its
// `items` array is empty (e.g., flag disabled, or nothing selected yet).
//
// TESTER-ROUND VISUAL PASS (see "First On-Device Test" report): dropped
// the explanatory subheading per Jerry's call — "What's Good" stands on
// its own, the cards answer the "what" — and gave the rail a modest,
// existing-design-language "pop" so it doesn't read as just another rail:
// a thin AMBER accent bar + AMBER-tinted border on each card (same brand
// color WhatsTheThingCard/the debug panel already use for "strongest
// signal" treatment, not a new color), slightly larger cards, and enough
// of the next card peeking at the right edge to signal horizontal scroll.
// No animation changes here — no looping/pulsing, nothing added that moves.

import React from 'react'
import { View, Text, ScrollView, TouchableOpacity, Image, StyleSheet } from 'react-native'

export default function WhatsGoodModule({ items, navigation, colors }) {
  if (!items || items.length === 0) return null

  return (
    <View style={styles.container}>
      <View style={[styles.accentBar, { backgroundColor: colors.AMBER }]} />
      <Text style={[styles.heading, { color: colors.TEXT }]}>What's Good</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent}>
        {items.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.card, { backgroundColor: colors.CARD, borderColor: colors.AMBER }]}
            onPress={() => navigation.navigate('ItemDetail', { item })}
            activeOpacity={0.85}
          >
            {item.photo_url ? <Image source={{ uri: item.photo_url }} style={styles.cardImage} /> : null}
            <Text style={[styles.cardTitle, { color: colors.TEXT }]} numberOfLines={2}>
              {item.body}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { marginTop: 24, paddingHorizontal: 16 },
  accentBar: { width: 28, height: 3, borderRadius: 2, marginBottom: 6 },
  heading: { fontSize: 19, fontWeight: '800', marginBottom: 12 },
  railContent: { paddingRight: 40 },
  card: { width: 172, marginRight: 12, borderRadius: 12, borderWidth: 1.5, overflow: 'hidden' },
  cardImage: { width: '100%', height: 104 },
  cardTitle: { fontSize: 13, fontWeight: '600', padding: 10 },
})
