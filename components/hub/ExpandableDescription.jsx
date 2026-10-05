// Hub description clamped to two lines with an inline More/Less toggle (shown only when the text really exceeds two
// lines at the current width and font scale). Expansion is inline: no nested scroll view. The full text is always
// rendered by an invisible measuring copy, so nothing is truncated in the data and accessibility text sizes re-measure
// automatically (onTextLayout fires again when width or font scale changes).
import React, { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

const COLLAPSED_LINES = 2
const AMBER = '#F5A623'

export default function ExpandableDescription({ text, textStyle }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  const onMeasure = useCallback((e) => {
    setOverflows(e.nativeEvent.lines.length > COLLAPSED_LINES)
  }, [])

  if (!text) return null
  return (
    <View>
      <Text style={textStyle} numberOfLines={expanded ? undefined : COLLAPSED_LINES}>{text}</Text>
      {/* Invisible full-length copy purely for line counting. */}
      <Text
        style={[textStyle, styles.measure]}
        onTextLayout={onMeasure}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        {text}
      </Text>
      {overflows && (
        <TouchableOpacity
          onPress={() => setExpanded(v => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show less of the description' : 'Show more of the description'}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }} // 28 + 16 = 44pt target
          style={styles.toggle}
        >
          <Text style={styles.toggleText}>{expanded ? 'Less' : 'More'}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  toggle: { alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center' },
  toggleText: { color: AMBER, fontSize: 13, fontWeight: '800' },
})
