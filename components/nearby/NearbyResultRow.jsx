// Nearby Redesign (2026-09-19) — a single result row: category accent
// bar, body text (no aggressive clamp, but a smaller max-line-count than
// Item Detail's hero given Nearby's list density — 3 lines), venue/
// neighborhood secondary line, distance + category meta line, and a
// right-side bookmark + completion cluster + chevron.
//
// Bookmark tap isolation: mirrors components/home/EditorialCard.jsx's
// SaveToggle exactly — a Pressable with its own hitSlop, stopped from
// bubbling to the row's own onPress by simply being a SEPARATE Pressable
// sibling (not nested inside the row's TouchableOpacity), same structural
// technique EditorialCard already uses (SaveToggle is a sibling overlay
// on the card, not a child of the card's own Pressable).
//
// Completed + Saved are independent state dimensions and must both be
// showable at once. Design decision (this pass): the bookmark control
// itself never disappears — completion is shown as a separate small
// filled teal check-circle badge to its LEFT, so a completed+saved item
// shows [teal check] [bookmark], and a completed-but-unsaved item shows
// [teal check] [outline bookmark] — the mockup's single teal-circle-in-
// place-of-bookmark treatment is what an incomplete+unsaved OR
// completed+unsaved row already looks like in practice (bookmark still
// present, just outline), and this two-slot cluster is the cleanest way
// to never hide either independent piece of state.
//
// Wrapped in React.memo (perf ask: avoid re-rendering every row on every
// unrelated state change, e.g. a single bookmark toggle elsewhere in the
// list) — memo works here because the row receives only the specific
// per-item saved/completed booleans it needs, not entire Sets.

import React from 'react'
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native'
import BookmarkIcon from '../BookmarkIcon'
import { extractQuotedVenueFromBody } from '../../lib/itemDetailHeaderTitle'

const TEAL = '#1D9E75'

// Check-In Memory Viewer (2026-09-23) — hasMemory/onViewMemory are
// additive, optional props: when the current user has a saved photo
// memory for this completed item, the existing teal completion badge
// becomes tappable (Pressable) and opens the shared CheckInMemoryModal.
// Nothing else about the row (title, distance, category, saved state)
// changes. Both props default to inert so every other caller/row is
// unaffected.
function NearbyResultRow({
  item, colors, onPress, onToggleSaved, saved, completed, matchCount,
  hasMemory = false, onViewMemory = null,
}) {
  const { CARD, TEXT, MUTED, BORDER } = colors
  const catColor = item.categoryColor ?? '#888780'
  const venue = item.partnerName ?? extractQuotedVenueFromBody(item.body)

  const completionLabel = completed ? 'Already done' : null
  const savedLabel = saved ? 'Saved' : null
  const a11yLabel = [
    item.is_secret ? 'Secret item' : item.body,
    venue,
    item.dist_label,
    item.categoryName,
    completionLabel,
    savedLabel,
  ].filter(Boolean).join(', ')

  return (
    <TouchableOpacity
      style={[styles.rowCard, { backgroundColor: CARD, borderColor: BORDER }, completed && styles.rowCardCompleted]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Opens item details"
    >
      <View
        style={[styles.accentBar, { backgroundColor: catColor }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <View style={styles.rowBody}>
        <Text
          style={[styles.rowText, { color: TEXT }, completed && { color: MUTED }]}
          numberOfLines={3}
        >
          {item.is_secret
            ? (item.partnerName ? `Secret at ${item.partnerName}` : 'Secret item')
            : item.body}
        </Text>
        {venue ? (
          <Text style={[styles.venueText, { color: MUTED }]} numberOfLines={1}>{venue}</Text>
        ) : null}
        <View style={styles.metaRow}>
          {item.dist_label && (
            <View style={styles.metaGroup}>
              <Text
                style={styles.metaPin}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >⌖</Text>
              <Text style={[styles.metaText, { color: MUTED }]}>
                {item.hasExactLocation ? item.dist_label : `~${item.dist_label}`}
              </Text>
            </View>
          )}
          {item.dist_label && item.categoryName && <View style={[styles.metaDivider, { backgroundColor: BORDER }]} />}
          {item.categoryName && (
            <Text style={[styles.metaCategory, { color: catColor }]} numberOfLines={1}>{item.categoryName}</Text>
          )}
          {matchCount > 1 && (
            <View style={styles.matchBadge}>
              <Text style={styles.matchText}>{matchCount} tags</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.rowRight}>
        {completed && hasMemory && onViewMemory ? (
          <Pressable
            onPress={onViewMemory}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.completedBadge}
            accessibilityRole="button"
            accessibilityLabel={`View memory for ${item.body ?? 'item'}`}
          >
            <View style={styles.completedDot} />
          </Pressable>
        ) : completed ? (
          <View
            style={styles.completedBadge}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={styles.completedDot} />
          </View>
        ) : null}
        <Pressable
          onPress={onToggleSaved}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.bookmarkTouch}
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          accessibilityLabel={saved ? `Remove ${item.body ?? 'item'} from Saved` : `Save ${item.body ?? 'item'}`}
        >
          <BookmarkIcon filled={saved} color="#F5A623" size={17} />
        </Pressable>
        <Text style={[styles.chevron, { color: MUTED }]}>›</Text>
      </View>
    </TouchableOpacity>
  )
}

export default React.memo(NearbyResultRow)

const styles = StyleSheet.create({
  rowCard: {
    flexDirection: 'row', alignItems: 'stretch', marginHorizontal: 16,
    borderRadius: 16, borderWidth: 1, overflow: 'hidden',
  },
  rowCardCompleted: { opacity: 0.72 },
  accentBar: { width: 4 },
  rowBody: { flex: 1, paddingVertical: 12, paddingHorizontal: 12, gap: 4 },
  rowText: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  venueText: { fontSize: 12, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  metaGroup: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaPin: { fontSize: 11, color: '#9A6A00' },
  metaText: { fontSize: 11, fontWeight: '700' },
  metaDivider: { width: 1, height: 10, marginHorizontal: 2 },
  metaCategory: { fontSize: 11, fontWeight: '800' },
  matchBadge: { backgroundColor: 'rgba(245,166,35,0.12)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  matchText: { fontSize: 10, color: '#9A6A00', fontWeight: '700' },
  rowRight: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, gap: 8 },
  completedBadge: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: TEAL,
    alignItems: 'center', justifyContent: 'center',
  },
  completedDot: { width: 7, height: 3.5, borderLeftWidth: 1.6, borderBottomWidth: 1.6, borderColor: '#fff', transform: [{ rotate: '-45deg' }], marginTop: -2 },
  bookmarkTouch: { alignItems: 'center', justifyContent: 'center', minWidth: 24, minHeight: 24 },
  chevron: { fontSize: 18, fontWeight: '700' },
})
