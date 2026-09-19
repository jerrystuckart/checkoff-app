// Nearby Redesign (2026-09-19) — a single category tile in the
// horizontally-scrollable category row. Wraps CategoryIcon (code-native,
// no dependency) with the category's own live color_hex as a tint —
// never a hardcoded palette, since real production categories (12 of
// them) are admin-managed and can change.

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import CategoryIcon from './CategoryIcon'

export default function CategoryTile({ name, color, selected, onPress, style, textColor }) {
  const tint = color || '#888780'
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.tile,
        { borderColor: selected ? tint : `${tint}30`, backgroundColor: selected ? `${tint}18` : 'transparent' },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${name} category`}
      accessibilityState={{ selected: !!selected }}
      accessibilityHint="Filters Nearby results to this category"
    >
      <View style={[styles.iconWrap, { backgroundColor: `${tint}14`, borderColor: `${tint}30` }]}>
        <CategoryIcon categoryName={name} color={tint} size={20} />
      </View>
      <Text style={[styles.label, textColor && { color: textColor }]} numberOfLines={1}>{name}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  tile: {
    width: 76,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    gap: 6,
  },
  iconWrap: {
    width: 34, height: 34, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
})
