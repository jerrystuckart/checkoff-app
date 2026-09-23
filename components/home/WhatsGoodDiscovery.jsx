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
 * @param {Set<string>|null} [memoryItemIds]  Check-In Memory Viewer
 *   (2026-09-23) — item ids (among `items`) the current user has a saved
 *   photo memory for. Purely additive/presentational: only changes
 *   whether a rail card shows a small memory badge. No effect on
 *   selection/ranking/coverage-mode branching above.
 * @param {((item: object) => void)|null} [onViewMemory]  Called with the
 *   tapped item when its memory badge is pressed.
 * @param {boolean} [isAdmin]  ADMIN DIAGNOSTICS PANEL (Phase 1, 2026-09-23) —
 *   HomeScreen.jsx's resolved `users.is_admin` flag, passed straight through
 *   to UnsupportedLocationCard (the only current render site of the
 *   diagnostics panel — see its own doc). Purely additive: has no effect on
 *   anything above when omitted/false.
 * @param {object|null} [diagnostics]  HomeScreen.jsx's assembled What's Good
 *   diagnostics payload — see lib/whatsGoodDiagnosticsPanel.js for the shape
 *   it expects. Passed straight through, never read here.
 * @param {(() => void)|null} [onRefreshWhatsGood]  Passed straight through
 *   to UnsupportedLocationCard's "Refresh What's Good" diagnostics action.
 */
export default function WhatsGoodDiscovery({ items, navigation, colors, userId = null, coverageMode = null, onExploreCities = null, memoryItemIds = null, onViewMemory = null, isAdmin = false, diagnostics = null, onRefreshWhatsGood = null }) {
  if (coverageMode === COVERAGE_MODE.UNSUPPORTED) {
    return (
      <UnsupportedLocationCard
        coverageMode={coverageMode}
        items={items}
        navigation={navigation}
        colors={colors}
        userId={userId}
        onExploreCities={onExploreCities}
        isAdmin={isAdmin}
        diagnostics={diagnostics}
        onRefreshWhatsGood={onRefreshWhatsGood}
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
            hasMemory={!!memoryItemIds?.has(item.id)}
            onViewMemory={onViewMemory ? () => onViewMemory(item) : null}
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
