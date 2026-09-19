// Nearby Redesign (2026-09-19) — code-native category glyphs for the
// horizontally-scrollable category tile row.
//
// This app has NO icon/vector library installed anywhere (confirmed:
// grep for @expo/vector-icons / react-native-svg / any icon package
// across package.json turns up nothing) — every existing "icon" is
// either a Unicode glyph already proven safe elsewhere in THIS codebase
// (e.g. App.jsx's TabIcon '⌖'/'⌂'/'☰'/'◉', reused verbatim rather than a
// new glyph choice, since a prior audit flagged uncommon Unicode glyphs
// — particularly the Geometric Shapes block — as an Android OEM-font
// risk) or a hand-composed View/border/rotation shape (BookmarkIcon.jsx).
//
// Rather than gamble on a literal pictogram (fork+knife, mountain) built
// from bordered Views reading recognizably at ~18-22px, this renders a
// small set of distinct ABSTRACT geometric marks — same "simple line-art
// icon" spirit the mockup calls for, built the same way BookmarkIcon.jsx
// already does (View + border composition, no glyph, no dependency),
// picked deterministically per category by a keyword match against the
// REAL live category name (never a hardcoded category list) so visually
// similar concepts (all "food" categories, all "outdoors" categories)
// read consistently without needing per-metro icon curation.
//
// Unmapped/unknown category names fall back to a plain ring — the same
// visual language DiscoverScreen.jsx's existing catDotWrap/catDot already
// uses for the category color dot on each result row, kept intentionally
// simple rather than invented from scratch.

import React from 'react'
import { View, StyleSheet } from 'react-native'

const KEYWORD_SHAPES = [
  { keywords: ['food', 'dining', 'eat', 'drink', 'restaurant', 'brunch', 'coffee', 'bar'], shape: 'cross' },
  { keywords: ['outdoor', 'nature', 'hike', 'park', 'trail', 'mountain'], shape: 'triangle' },
  { keywords: ['art', 'culture', 'museum', 'music', 'theatre', 'theater'], shape: 'diamond' },
  { keywords: ['shop', 'retail', 'market', 'boutique'], shape: 'square' },
  { keywords: ['hidden', 'gem', 'secret', 'explore', 'adventure'], shape: 'pin' },
]

/**
 * resolveCategoryShape(categoryName)
 *
 * Pure, exported separately so the mapping rule is directly unit
 * testable without rendering a component.
 *
 * @param {string|null|undefined} categoryName
 * @returns {'cross'|'triangle'|'diamond'|'square'|'pin'|'ring'}
 */
export function resolveCategoryShape(categoryName) {
  const name = (categoryName ?? '').toLowerCase()
  for (const { keywords, shape } of KEYWORD_SHAPES) {
    if (keywords.some(k => name.includes(k))) return shape
  }
  return 'ring'
}

export default function CategoryIcon({ categoryName, color = '#888780', size = 20 }) {
  const shape = resolveCategoryShape(categoryName)
  const stroke = Math.max(1.5, size * 0.1)

  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shape === 'ring' && (
        <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color }} />
      )}
      {shape === 'triangle' && (
        <View style={{
          width: 0, height: 0,
          borderLeftWidth: size / 2, borderRightWidth: size / 2, borderBottomWidth: size * 0.85,
          borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color,
        }} />
      )}
      {shape === 'diamond' && (
        <View style={{
          width: size * 0.68, height: size * 0.68, borderWidth: stroke, borderColor: color,
          transform: [{ rotate: '45deg' }],
        }} />
      )}
      {shape === 'square' && (
        <View style={{ width: size * 0.8, height: size * 0.8, borderRadius: 3, borderWidth: stroke, borderColor: color }} />
      )}
      {shape === 'pin' && (
        <View style={styles.pinWrap}>
          <View style={{ width: size * 0.62, height: size * 0.62, borderRadius: size * 0.31, borderWidth: stroke, borderColor: color }} />
          <View style={{
            width: 0, height: 0, marginTop: -stroke,
            borderLeftWidth: size * 0.16, borderRightWidth: size * 0.16, borderTopWidth: size * 0.28,
            borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color,
          }} />
        </View>
      )}
      {shape === 'cross' && (
        <View style={styles.crossWrap}>
          <View style={{ position: 'absolute', width: stroke, height: size * 0.85, backgroundColor: color, borderRadius: stroke / 2, transform: [{ rotate: '20deg' }] }} />
          <View style={{ position: 'absolute', width: stroke, height: size * 0.85, backgroundColor: color, borderRadius: stroke / 2, transform: [{ rotate: '-20deg' }] }} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  pinWrap: { alignItems: 'center', justifyContent: 'center' },
  crossWrap: { alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' },
})
