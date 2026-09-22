// Phase 4 — the "unsupported location" card. Renders in place of a silent
// empty/unlabeled-Universal-items What's Good section when
// lib/whatsGoodCoverageMode.js's UNSUPPORTED mode applies: a real, resolved
// device location that falls outside every supported metro's coverage
// radius. See lib/unsupportedLocationCard.js for the pure copy/state
// derivation this component renders as-is — no policy logic lives here.
//
// Universal items rendered here are the SAME items lib/useWhatsGood.js
// already composed for this mode (reused via props, never re-fetched).
// They render with EditorialCard's existing "rail" variant, which already
// never shows a distance/navigation affordance for `is_universal` items
// (see EditorialCard.jsx) — this card adds no distance/navigation UI of
// its own, so a Universal item here can never be mistaken for a nearby
// venue.

import React, { useEffect, useRef } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import EditorialCard from './EditorialCard'
import { deriveUnsupportedLocationCardState } from '../../lib/unsupportedLocationCard'
import { computeRailCardWidth } from '../../lib/whatsGoodRailLayout'
import { trackEvent } from '../../lib/trackEvent'

const SECTION_HORIZONTAL_PADDING = 16
const RAIL_CARD_HEIGHT = 190
const RAIL_CARD_GAP = 12

/**
 * @param {object} props
 * @param {string} props.coverageMode  lib/useWhatsGood.js's `coverageMode`.
 * @param {Array} props.items  lib/useWhatsGood.js's `items` (Universal-only
 *   in UNSUPPORTED mode — see whatsGoodCoverageMode.js doc).
 * @param {object} props.navigation
 * @param {object} props.colors
 * @param {string|null} [props.userId]
 * @param {(() => void)|null} [props.onExploreCities]  HomeScreen.jsx's
 *   existing city picker opener (the same `setMetroPickerVisible(true)`
 *   already wired to its own "Choose your city" / metro-switcher affordance
 *   — reused here, not a new screen). Omitted entirely when not supplied,
 *   per Phase 4's "only wire if it already exists" rule.
 */
export default function UnsupportedLocationCard({ coverageMode, items, navigation, colors, userId = null, onExploreCities = null }) {
  const state = deriveUnsupportedLocationCardState({ coverageMode, items })
  const { width: windowWidth } = useWindowDimensions()
  const cardWidth = computeRailCardWidth(windowWidth, SECTION_HORIZONTAL_PADDING)
  const hasTrackedView = useRef(false)

  useEffect(() => {
    if (state.shouldRender && !hasTrackedView.current) {
      hasTrackedView.current = true
      trackEvent('unsupported_location_viewed')
    }
    if (!state.shouldRender) {
      hasTrackedView.current = false
    }
  }, [state.shouldRender])

  if (!state.shouldRender) return null
  const { TEXT, MUTED, CARD, BORDER, AMBER } = colors

  return (
    <View style={styles.wrapper}>
      <View style={[styles.card, { backgroundColor: CARD, borderColor: BORDER }]}>
        <Text style={[styles.title, { color: TEXT }]}>{state.title}</Text>
        <Text style={[styles.body, { color: MUTED }]}>{state.body}</Text>

        {onExploreCities && (
          <TouchableOpacity onPress={onExploreCities} style={styles.linkRow}>
            <Text style={[styles.linkText, { color: AMBER }]}>Explore CheckOff cities</Text>
          </TouchableOpacity>
        )}
      </View>

      {state.showTryAnywhereAction && (
        <View style={styles.railSection}>
          <Text style={[styles.railHeading, { color: TEXT }]}>Try something anywhere</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={cardWidth + RAIL_CARD_GAP}
            snapToAlignment="start"
            contentContainerStyle={styles.railContent}
          >
            {state.universalItems.map((item, index) => (
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
                onPress={() => {
                  trackEvent('universal_action_opened', { itemId: item.id })
                  navigation.navigate('ItemDetail', { item })
                }}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 16 },
  card: {
    marginHorizontal: SECTION_HORIZONTAL_PADDING,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 20 },
  linkRow: { marginTop: 12 },
  linkText: { fontSize: 14, fontWeight: '700' },
  railSection: { marginTop: 16 },
  railHeading: { fontSize: 16, fontWeight: '800', marginBottom: 12, paddingHorizontal: SECTION_HORIZONTAL_PADDING },
  railContent: { paddingHorizontal: SECTION_HORIZONTAL_PADDING, gap: RAIL_CARD_GAP },
})
