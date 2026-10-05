// Compact location-aware strip for the Destination Hub, above the lists.
//   kind 'at'      -> "You're at {venue}" + the experience + its check-off action
//   kind 'closest' -> "Closest to you" + up to two nearest experiences
// Every row opens the existing ItemDetail flow, which owns the real
// presence/eligibility/photo/points/recovery logic — being nearby here never
// implies the user qualifies; the button only opens the normal flow.
import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { formatDistanceLabel } from '../../lib/proximity'

const AMBER = '#F5A623'

export default function HubLocationSection({ section, navigation, colors }) {
  const { fontScale } = useWindowDimensions()
  if (!section?.items?.length) return null
  // Large accessibility text: stack the action under the title so neither is squeezed or clipped.
  const stacked = fontScale >= 1.35
  const { TEXT, MUTED, CARD, BORDER } = colors
  const open = (item) => navigation.navigate('ItemDetail', { item })
  const at = section.kind === 'at'

  const title = at && section.items[0].partnerName
    ? `You're at ${section.items[0].partnerName}`
    : at ? "You're here" : 'Closest to you'

  return (
    <View style={styles.wrap}>
      <Text style={[styles.heading, { color: TEXT }]} numberOfLines={1}>{title}</Text>
      {section.items.map(item => {
        const dist = at ? null : formatDistanceLabel(item.distM)
        return (
          <TouchableOpacity
            key={item.id}
            activeOpacity={0.88}
            onPress={() => open(item)}
            style={[styles.row, stacked && styles.rowStacked, { backgroundColor: CARD, borderColor: at ? AMBER : BORDER }]}
            accessibilityRole="button"
          >
            <View style={stacked ? undefined : styles.textCol}>
              <Text style={[styles.body, { color: TEXT }]} numberOfLines={2}>{item.body}</Text>
              {!!dist && <Text style={[styles.meta, { color: MUTED }]}>{dist}</Text>}
            </View>
            <Text style={[styles.cta, stacked && styles.ctaStacked, item.completed && { color: MUTED }]} numberOfLines={1}>
              {item.completed ? '✓ Done' : at ? 'Check it off →' : 'Open →'}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 16 },
  heading: { fontSize: 14, fontWeight: '800', marginBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 6, minHeight: 56,
  },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch' },
  textCol: { flex: 1, minWidth: 0 },
  body: { fontSize: 14, fontWeight: '700' },
  meta: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  cta: { fontSize: 13, fontWeight: '800', color: AMBER, marginLeft: 12, flexShrink: 0 },
  ctaStacked: { marginLeft: 0, marginTop: 6, alignSelf: 'flex-end' },
})
