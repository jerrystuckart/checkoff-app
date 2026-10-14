// "Explore Willcox →" / "Explore destinations →" pill (lib/homeHubLinks.js decides the label).
// Never wraps. A long hub NAME is truncated while "Explore" and the arrow stay visible, and shrinks before anything
// beside it (the NEAR YOU label is flexShrink 0), so small phones and big hub names cannot squeeze the heading.
import React from 'react'
import { Text, TouchableOpacity, StyleSheet } from 'react-native'

export default function HubLinkPill({ hubLink, onPress, colors }) {
  if (!hubLink?.parts || !onPress) return null
  const { AMBER } = colors
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.pill, { borderColor: AMBER, backgroundColor: `${AMBER}1F` }]}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityLabel={hubLink.label}
    >
      <Text style={[styles.text, styles.fixed, { color: AMBER }]} numberOfLines={1} allowFontScaling={false}>{hubLink.parts.lead}</Text>
      {hubLink.parts.name ? (
        <>
          <Text style={[styles.text, styles.name, { color: AMBER }]} numberOfLines={1} ellipsizeMode="tail" allowFontScaling={false}>{hubLink.parts.name}</Text>
          <Text style={[styles.text, styles.fixed, styles.tail, { color: AMBER }]} numberOfLines={1} allowFontScaling={false}>{hubLink.parts.tail}</Text>
        </>
      ) : null}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  text: { fontSize: 12, fontWeight: '800' },
  // Gaps are margins, not spaces in the strings: edge whitespace collapses in a flex row.
  fixed: { flexShrink: 0 },
  name: { flexShrink: 1, marginLeft: 4 },
  tail: { marginLeft: 3 },
})
