// Lists Landing Redesign (2026-09-19) — restyled "Saved" destination card.
// Behaviorally identical to the pre-redesign inline savedEntry block in
// screens/ListsScreen.jsx (Saved Items V1, 2026-09-18): a virtual/system
// destination, NOT a `lists` row — no rename/delete/share/leave/invite
// controls exist in this markup (not just hidden), it reads its count
// straight off the already-loaded savedItemIds Set (zero extra query), and
// it opens the existing SavedItemsScreen via the same 'SavedItems' route.
// Only the visual treatment changes here: a strong compact card matching
// the raised-surface / amber-accent language of Home's EditorialCard and
// Nearby's NearbyResultRow, instead of the flatter pre-redesign row.

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import BookmarkIcon from '../BookmarkIcon'

export default function SavedCollectionCard({ count, onPress, colors }) {
  const { CARD_ELEVATED, TEXT, MUTED, AMBER, SHADOW_COLOR } = colors
  const label = `${count} item${count === 1 ? '' : 's'}`

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: CARD_ELEVATED, borderColor: AMBER, shadowColor: SHADOW_COLOR ?? 'rgba(0,0,0,0.3)' },
      ]}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`Saved, ${label}`}
      accessibilityHint="Opens your saved items"
    >
      <View style={[styles.iconWrap, { backgroundColor: 'rgba(245,166,35,0.14)' }]}>
        <BookmarkIcon filled color={AMBER} size={19} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: TEXT }]}>Saved</Text>
        <Text style={[styles.meta, { color: MUTED }]}>{label}</Text>
      </View>
      <Text style={[styles.chevron, { color: AMBER }]}>→</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 20,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 4,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  meta: {
    fontSize: 12,
    fontWeight: '700',
  },
  chevron: {
    fontSize: 18,
    fontWeight: '900',
  },
})
