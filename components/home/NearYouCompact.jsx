// HomeScreen 2026 Redesign — "closest things," not "five recommendations."
// A compact vertical stack of up to 3 proximity rows plus a "See all
// nearby →" link to the Nearby tab — deliberately not a horizontal
// carousel, and deliberately not exposing all 5 legacy rail items on Home.
// Ranking/data is unchanged: this reuses the same already-sorted item list
// Home Rail already computes (see lib/nearYouCompact.js's
// selectNearYouCompactRows, pure slicing only).
//
// VISUAL POLISH PASS 2: each row now separates distance / venue / thing
// instead of one raw combined sentence, reusing the same conservative,
// audited extraction as What's Good (lib/whatsGoodItemPresentation.js) —
// when a row's venue name isn't safely separable from its body, the row
// falls back to showing the body as-is, exactly like before.
//
// PREMIUM POLISH PASS: universal items no longer show the literal
// "Anywhere" distance label (Jerry feedback, 2026-09-03 — reads as a
// placeholder/bug, not a feature). A universal row simply omits the
// distance column and lets its item text run full-width instead.

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { formatDistanceLabel } from '../../lib/proximity'
import { deriveVenueAndThing } from '../../lib/whatsGoodItemPresentation'
import PressableTactile from '../PressableTactile'

export default function NearYouCompact({ items, onItemPress, onSeeAllPress, colors }) {
  if (!items || items.length === 0) return null
  const { TEXT, MUTED, BORDER, AMBER } = colors

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: MUTED }]} allowFontScaling={false}>NEAR YOU</Text>

      <View style={[styles.stack, { borderColor: BORDER }]}>
        {items.map((item, i) => {
          const distLabel = item.is_universal ? null : (formatDistanceLabel(item.distM) ?? '')
          const isRightHere = distLabel === 'right here'
          const { venueName, thing } = deriveVenueAndThing(item)

          return (
            <PressableTactile
              key={item.id}
              onPress={() => onItemPress(item)}
              intensity="utility"
              shadowColor="transparent"
              style={[styles.row, i < items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER }]}
            >
              {distLabel !== null && (
                <Text style={[styles.distance, { color: isRightHere ? AMBER : TEXT }]} allowFontScaling={false}>
                  {distLabel}
                </Text>
              )}
              <View style={styles.textCol}>
                {venueName ? (
                  <>
                    <Text style={[styles.venue, { color: TEXT }]} numberOfLines={1}>{venueName}</Text>
                    <Text style={[styles.thing, { color: TEXT, opacity: 0.72 }]} numberOfLines={1}>{thing}</Text>
                  </>
                ) : (
                  <Text style={[styles.venue, { color: TEXT }]} numberOfLines={1}>{thing}</Text>
                )}
              </View>
            </PressableTactile>
          )
        })}
      </View>

      <TouchableOpacity onPress={onSeeAllPress} style={styles.seeAll} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Text style={[styles.seeAllText, { color: MUTED }]}>See all nearby →</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 18, paddingHorizontal: 16 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 8 },
  stack: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12 },
  distance: { fontSize: 12, fontWeight: '800', width: 72 },
  textCol: { flex: 1 },
  venue: { fontSize: 14, fontWeight: '700' },
  thing: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  // DEFAULT HOME "WOW" PASS (2026-09-03): tightened from 8 — part of
  // pulling What's Good visually closer, per the Home hierarchy pass.
  seeAll: { alignSelf: 'flex-end', marginTop: 6 },
  seeAllText: { fontSize: 12, fontWeight: '700' },
})
