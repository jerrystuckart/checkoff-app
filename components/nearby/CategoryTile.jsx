// Nearby category rail tile (1.1.10 refresh): circular photo thumbnail with
// the label underneath. Metadata (image/accent) comes from categoryImages.js;
// the live category name/color_hex still drive filtering and the fallback.
// A category with no mapped image falls back to the legacy icon-in-circle.

import React, { useRef } from 'react'
import { View, Text, Image, Pressable, Animated, StyleSheet } from 'react-native'
import CategoryIcon from './CategoryIcon'
import { resolveCategoryImage } from './categoryImages'

const SIZE = 74
const RING = 3

export default function CategoryTile({ name, color, selected, onPress, style, textColor }) {
  const meta = resolveCategoryImage(name)
  const accent = meta?.accent || color || '#888780'
  const scale = useRef(new Animated.Value(1)).current
  const press = to => Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 0 }).start()

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => press(0.94)}
      onPressOut={() => press(1)}
      style={[styles.tile, style]}
      accessibilityRole="button"
      accessibilityLabel={`${name} category`}
      accessibilityState={{ selected: !!selected }}
      accessibilityHint="Filters Nearby results to this category"
    >
      <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
        <View
          style={[
            styles.ring,
            selected
              ? { borderColor: accent, shadowColor: accent, shadowOpacity: 0.7, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 6 }
              : { borderColor: 'rgba(255,255,255,0.22)' },
          ]}
        >
          {meta ? (
            <Image source={meta.image} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={[styles.image, styles.fallback, { backgroundColor: `${accent}22` }]}>
              <CategoryIcon categoryName={name} color={accent} size={26} />
            </View>
          )}
        </View>
        <Text
          style={[styles.label, textColor && { color: textColor }, { opacity: selected ? 1 : 0.8 }, selected && styles.labelSelected]}
          numberOfLines={2}
        >
          {meta?.label ?? name}
        </Text>
      </Animated.View>
    </Pressable>
  )
}

const INNER = SIZE - RING * 2

const styles = StyleSheet.create({
  tile: { width: SIZE + 8, alignItems: 'center' },
  ring: {
    width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: RING,
    overflow: 'visible', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#000',
  },
  image: { width: INNER, height: INNER, borderRadius: INNER / 2 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: 7, fontSize: 11, fontWeight: '600', textAlign: 'center', lineHeight: 13 },
  labelSelected: { fontWeight: '800' },
})
