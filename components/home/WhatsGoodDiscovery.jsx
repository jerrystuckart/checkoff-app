// HomeScreen 2026 Redesign — What's Good as a compact horizontal rail of 3
// equal cards, replacing the earlier "1 large primary + 2 stacked rows"
// layout. That layout looked weak whenever the lead item had no photo (a
// mostly-empty large card above two small rows); a rail of equal-size
// cards means every item gets the same fully-designed treatment — photo-
// forward when available, an intentional branded no-photo composition
// (see EditorialCard.jsx's RailCard) when not — with no single slot
// carrying disproportionate empty space.
//
// Selection/ranking/rotation/momentum is completely untouched — this only
// changes layout. Items render in the exact order useWhatsGood() already
// returned them (no display-order reshuffling to chase an image into a
// "primary" slot, since a rail has no single hero slot to fill).
//
// Card width is ~80% of the section's content width so the rail reads as
// obviously swipeable: one full card plus a clear peek of the next one.
// Height is intentionally compact — a major reason for this change is
// giving Seasonal Lists more room higher on the page — but still large
// enough that content never feels cramped.

import React from 'react'
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native'
import EditorialCard from './EditorialCard'
import UnsupportedLocationCard from './UnsupportedLocationCard'
import { computeRailCardWidth } from '../../lib/whatsGoodRailLayout'
import { COVERAGE_MODE } from '../../lib/whatsGoodCoverageMode'

const SECTION_HORIZONTAL_PADDING = 16
const RAIL_CARD_HEIGHT = 190
const RAIL_CARD_GAP = 12

/**
 * @param {string} [coverageMode]  Phase 4 (2026-09-22) — lib/useWhatsGood.js's
 *   `coverageMode`. When it's UNSUPPORTED (a real, resolved location outside
 *   every supported metro), this renders UnsupportedLocationCard instead of
 *   either silently returning null or showing unlabeled Universal items in
 *   the ordinary "What's Good" rail — see lib/unsupportedLocationCard.js.
 *   Every other coverage mode (including omitted/undefined, for any caller
 *   not yet passing it) falls through to the pre-existing rail behavior,
 *   completely unchanged.
 * @param {(() => void)|null} [onExploreCities]  Passed straight through to
 *   UnsupportedLocationCard — see its own doc.
 */
export default function WhatsGoodDiscovery({ items, navigation, colors, userId = null, coverageMode = null, onExploreCities = null }) {
  if (coverageMode === COVERAGE_MODE.UNSUPPORTED) {
    return (
      <UnsupportedLocationCard
        coverageMode={coverageMode}
        items={items}
        navigation={navigation}
        colors={colors}
        userId={userId}
        onExploreCities={onExploreCities}
      />
    )
  }

  if (!items || items.length === 0) return null
  const { TEXT } = colors
  const { width: windowWidth } = useWindowDimensions()
  const cardWidth = computeRailCardWidth(windowWidth, SECTION_HORIZONTAL_PADDING)

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.heading, { color: TEXT }]}>What's Good</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + RAIL_CARD_GAP}
        snapToAlignment="start"
        contentContainerStyle={styles.railContent}
      >
        {items.map((item, index) => (
          <EditorialCard
            key={item.id}
            item={item}
            index={index}
            variant="rail"
            colors={colors}
            userId={userId}
            cardWidth={cardWidth}
            cardHeight={RAIL_CARD_HEIGHT}
            navigation={navigation}
            onPress={() => navigation.navigate('ItemDetail', { item })}
          />
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 16 },
  heading: { fontSize: 20, fontWeight: '900', marginBottom: 12, paddingHorizontal: SECTION_HORIZONTAL_PADDING },
  railContent: { paddingHorizontal: SECTION_HORIZONTAL_PADDING, gap: RAIL_CARD_GAP },
})
