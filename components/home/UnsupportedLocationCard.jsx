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

import React, { useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import EditorialCard from './EditorialCard'
import { deriveUnsupportedLocationCardState } from '../../lib/unsupportedLocationCard'
import { computeRailCardWidth } from '../../lib/whatsGoodRailLayout'
import { trackEvent } from '../../lib/trackEvent'
import { shouldShowDiagnostics, buildDiagnosticsRows } from '../../lib/whatsGoodDiagnosticsPanel'

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
 * @param {boolean} [props.isAdmin]  ADMIN DIAGNOSTICS PANEL (Phase 1,
 *   2026-09-23) — HomeScreen.jsx's resolved `users.is_admin` flag. Gates an
 *   appended diagnostics section via lib/whatsGoodDiagnosticsPanel.js's
 *   shouldShowDiagnostics() — when this is not exactly `true`, this
 *   component renders IDENTICALLY to before this addition, nothing extra.
 * @param {object|null} [props.diagnostics]  HomeScreen.jsx's assembled
 *   What's Good diagnostics payload — see lib/whatsGoodDiagnosticsPanel.js's
 *   buildDiagnosticsRows() for the shape it expects. Only read when
 *   `isAdmin` is true.
 * @param {(() => void)|null} [props.onRefreshWhatsGood]  "Refresh What's
 *   Good" diagnostics action — HomeScreen.jsx's callback that clears the
 *   session cache and re-triggers the existing location-driven selection
 *   refresh (see HomeScreen.jsx's `refreshWhatsGoodDiagnostics`). Only
 *   rendered/used inside the admin diagnostics section.
 */
export default function UnsupportedLocationCard({ coverageMode, items, navigation, colors, userId = null, onExploreCities = null, isAdmin = false, diagnostics = null, onRefreshWhatsGood = null }) {
  const state = deriveUnsupportedLocationCardState({ coverageMode, items })
  const { width: windowWidth } = useWindowDimensions()
  const cardWidth = computeRailCardWidth(windowWidth, SECTION_HORIZONTAL_PADDING)
  const hasTrackedView = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const showDiagnostics = shouldShowDiagnostics(isAdmin)

  useEffect(() => {
    if (state.shouldRender && !hasTrackedView.current) {
      hasTrackedView.current = true
      trackEvent('unsupported_location_viewed')
    }
    if (!state.shouldRender) {
      hasTrackedView.current = false
    }
  }, [state.shouldRender])

  if (!state.shouldRender && !showDiagnostics) return null
  const { TEXT, MUTED, CARD, BORDER, AMBER } = colors

  const handleRefresh = async () => {
    if (!onRefreshWhatsGood || refreshing) return
    setRefreshing(true)
    try {
      await onRefreshWhatsGood()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <View style={styles.wrapper}>
      {state.shouldRender && (
        <>
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
        </>
      )}

      {showDiagnostics && (
        <View style={[styles.diagnosticsCard, { backgroundColor: CARD, borderColor: BORDER }]}>
          <Text style={[styles.diagnosticsTitle, { color: TEXT }]}>What's Good Diagnostics (admin only)</Text>
          {buildDiagnosticsRows(diagnostics).map((row) => (
            <View key={row.label} style={styles.diagnosticsRow}>
              <Text style={[styles.diagnosticsLabel, { color: MUTED }]}>{row.label}</Text>
              <Text style={[styles.diagnosticsValue, { color: TEXT }]}>{row.value}</Text>
            </View>
          ))}
          <TouchableOpacity
            onPress={handleRefresh}
            disabled={!onRefreshWhatsGood || refreshing}
            style={[styles.refreshButton, { borderColor: BORDER }]}
          >
            <Text style={[styles.linkText, { color: AMBER }]}>
              {refreshing ? 'Refreshing…' : "Refresh What's Good"}
            </Text>
          </TouchableOpacity>
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
  // ADMIN DIAGNOSTICS PANEL (Phase 1, 2026-09-23)
  diagnosticsCard: {
    marginTop: 16,
    marginHorizontal: SECTION_HORIZONTAL_PADDING,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  diagnosticsTitle: { fontSize: 13, fontWeight: '800', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  diagnosticsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 8 },
  diagnosticsLabel: { fontSize: 12, flexShrink: 0 },
  diagnosticsValue: { fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  refreshButton: { marginTop: 10, paddingVertical: 8, borderTopWidth: 1, alignItems: 'center' },
})
