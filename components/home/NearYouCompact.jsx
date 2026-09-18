// HomeScreen 2026 Redesign — "closest things," not "five recommendations."
// A grouped module: one FEATURED (closest) result plus up to 2 refined
// compact rows, then a "See all nearby →" link to the Nearby tab —
// deliberately not a horizontal carousel, and deliberately not exposing
// all 5 legacy rail items on Home. Ranking/data is unchanged: this reuses
// the same already-sorted item list Home Rail already computes (see
// lib/nearYouCompact.js's selectNearYouCompactRows, pure slicing only) —
// this component never reorders or re-selects, only renders.
//
// NOT RIGHT HERE REDESIGN PASS (approved mockup, 2026-09-17): the plain
// three-row list is replaced with a single professional grouped module —
// the closest item gets the same EditorialCard 'primary' treatment as a
// What's Good hero card (photo -> archetype artwork -> generic, per the
// shared useCardArtwork/ArchetypeArtwork resolution — see
// components/home/EditorialCard.jsx), roughly 2x the height of a
// secondary row. Items 2 and 3 reuse EditorialCard's existing 'row'
// variant (small thumbnail, venue/thing label, distance, chevron) so
// there is exactly one row-card implementation shared with What's Good,
// not a second competing one. Tapping ANY row opens the existing
// item-detail flow — never a check-in/photo action (this module only
// renders in the Not Right Here state; see lib/homeHeroLayout.js).
//
// Selection/order is untouched: items[0] is always whatever the existing
// proximity sort put first (the same rule the old first row used), items
// 1-2 stay in the same order they already arrived in.

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import EditorialCard from './EditorialCard'

export default function NearYouCompact({ items, onItemPress, onSeeAllPress, colors, userId = null, navigation = null }) {
  if (!items || items.length === 0) return null
  const { TEXT, MUTED } = colors
  const [featured, ...rest] = items
  const secondary = rest.slice(0, 2)

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: MUTED }]} allowFontScaling={false}>NEAR YOU</Text>

      <EditorialCard
        item={featured}
        variant="primary"
        colors={colors}
        userId={userId}
        navigation={navigation}
        onPress={() => onItemPress(featured)}
      />

      {secondary.length > 0 && (
        <View style={styles.secondaryStack}>
          {secondary.map((item) => (
            <EditorialCard
              key={item.id}
              item={item}
              variant="row"
              colors={colors}
              userId={userId}
              navigation={navigation}
              onPress={() => onItemPress(item)}
            />
          ))}
        </View>
      )}

      <TouchableOpacity onPress={onSeeAllPress} style={styles.seeAll} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Text style={[styles.seeAllText, { color: MUTED }]} accessibilityRole="link">See all nearby →</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 18, paddingHorizontal: 16 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 8 },
  secondaryStack: { marginTop: 10, gap: 8 },
  // DEFAULT HOME "WOW" PASS (2026-09-03): tightened from 8 — part of
  // pulling What's Good visually closer, per the Home hierarchy pass.
  seeAll: { alignSelf: 'flex-end', marginTop: 10 },
  seeAllText: { fontSize: 12, fontWeight: '700' },
})
