// Saved Items V1 (2026-09-18) — a code-native bookmark/ribbon shape built
// from plain RN View + StyleSheet primitives. This app has NO icon/vector
// library installed (no @expo/vector-icons, no SVG lib) — every existing
// "icon" elsewhere is either a Unicode glyph (e.g. App.jsx's TabIcon) or a
// hand-styled shape (e.g. EditorialCard.jsx's rowAccentDot). A prior
// investigation (see the header of supabase/migrations/20260918_saved_items.sql
// and the Detail redesign's own "Case C" note in lib/itemDetailRedesign.test.js)
// found no bookmark glyph already in use anywhere in this codebase, and a
// known Android OEM-font risk with uncommon Unicode glyphs (the prior "◎"
// finding, since removed from ItemDetailScreen.jsx). Rather than gamble on
// 🔖 rendering consistently across Android manufacturers/fonts, this
// renders a simple "tag" abstraction: a rounded-top rectangle body with a
// small solid triangle tail at the bottom, reading clearly as a ribbon/
// bookmark shape without depending on font glyph coverage on either
// platform. Kept intentionally simple (not pixel-perfect) per instruction —
// it only needs to unambiguously read as "bookmark."
//
// filled=false renders a hollow (outline) tag: border only, transparent
// fill, with the tail rendered as a thin outlined wedge via a rotated
// bordered square (no background-color-matching trick needed, so it
// looks correct regardless of what's behind it — a real photo, a scrim,
// or a plain card surface).

import React from 'react'
import { View, StyleSheet } from 'react-native'

export default function BookmarkIcon({ filled = false, color = '#F5A623', size = 18 }) {
  const bodyWidth  = size
  const bodyHeight = size * 1.05
  const tailSize   = size * 0.42

  return (
    <View style={[styles.wrap, { width: bodyWidth, height: bodyHeight + tailSize * 0.5 }]} pointerEvents="none">
      <View
        style={[
          styles.body,
          {
            width: bodyWidth,
            height: bodyHeight,
            borderRadius: size * 0.18,
            borderColor: color,
            borderWidth: Math.max(1.5, size * 0.1),
            backgroundColor: filled ? color : 'transparent',
          },
        ]}
      />
      <View
        style={[
          styles.tail,
          filled
            ? {
                borderLeftWidth: bodyWidth / 2,
                borderRightWidth: bodyWidth / 2,
                borderTopWidth: tailSize,
                borderLeftColor: 'transparent',
                borderRightColor: 'transparent',
                borderTopColor: color,
              }
            : {
                width: tailSize * 0.9,
                height: tailSize * 0.9,
                backgroundColor: 'transparent',
                borderColor: color,
                borderWidth: Math.max(1.5, size * 0.1),
                transform: [{ rotate: '45deg' }],
                top: -tailSize * 0.55,
              },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'flex-start' },
  body: { alignSelf: 'center' },
  tail: { alignSelf: 'center', marginTop: -1 },
})
