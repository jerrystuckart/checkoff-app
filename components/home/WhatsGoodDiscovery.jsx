// HomeScreen 2026 Redesign — What's Good as the premium visual discovery
// centerpiece. Ranking/rotation/momentum/exclusion logic is completely
// untouched — this only changes how the same already-selected 3 items are
// laid out and styled (see lib/whatsGoodDisplayLayout.js's
// splitWhatsGoodDisplayLayout, pure).
//
// VISUAL POLISH PASS 2 layout: a moderately-sized primary editorial card
// plus 2 compact full-width rows stacked underneath — not side-by-side
// secondary cards (that truncated real content on real iPhone
// screenshots), and not a giant primary card (wasted vertical space). All
// 3 always visible without horizontal scrolling. Card rendering itself —
// image-capable/not-image-dependent, venue/thing separation, secret-item
// purple treatment — lives in the shared components/home/EditorialCard.jsx
// so Near You can reuse the exact same visual language.
//
// No subtitle (already-approved "What's Good" stands on its own) and, per
// this pass, no decorative accent line above the heading either.
//
// Save (❤) remains deliberately NOT rendered — see git history /
// tester-build report (2026-09-02): a visible non-functional heart reads
// as broken during tester review. Re-add once Save is actually built.

import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { splitWhatsGoodDisplayLayout } from '../../lib/whatsGoodDisplayLayout'
import EditorialCard from './EditorialCard'

export default function WhatsGoodDiscovery({ items, navigation, colors, userId = null }) {
  if (!items || items.length === 0) return null
  const { TEXT } = colors
  const { primary, secondary } = splitWhatsGoodDisplayLayout(items)
  if (!primary) return null

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.heading, { color: TEXT }]}>What's Good</Text>

      <EditorialCard item={primary} variant="primary" colors={colors} userId={userId} onPress={() => navigation.navigate('ItemDetail', { item: primary })} />

      {secondary.length > 0 && (
        <View style={styles.secondaryStack}>
          {secondary.map(item => (
            <EditorialCard key={item.id} item={item} variant="row" colors={colors} userId={userId} onPress={() => navigation.navigate('ItemDetail', { item })} />
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  // DEFAULT HOME "WOW" PASS (2026-09-03): tightened from 24 — What's Good
  // should read as the next thing on the page, not a separate section a
  // full screen down. Near You stays utility-sized; this is what pulls
  // What's Good up to visually dominate sooner.
  wrapper: { marginTop: 16, paddingHorizontal: 16 },
  heading: { fontSize: 20, fontWeight: '900', marginBottom: 12 },
  secondaryStack: { marginTop: 12, gap: 12 },
})
