// What's Good V1 — the "You're Here / What's the Thing?" foreground
// state. Product role: "I am at this place — what am I supposed to
// do/get/experience?" Home Rail continues to own general immediate
// proximity; this is the more prominent state for when the user is
// physically at-place (see lib/whatsGoodAtPlace.js for the trigger).
//
// SCOPING CHOICE (documented, not silent): rather than mutating Home
// Rail's existing inline card JSX in HomeScreen.jsx to "transform" in
// place, this renders as a SEPARATE, additive card shown above the Home
// Rail section when at-place — zero risk to the already-shipped Home Rail
// rendering, fully reversible (delete the one conditional block in
// HomeScreen.jsx, nothing else changes). Revisit for a true in-place
// transform once this is validated with a tester. Flagged explicitly in
// the final report.
//
// Visual treatment, per the approved principle (pop, immediately
// apparent, no flashing/looping/pulsing, no HomeScreen redesign): solid
// AMBER background (same strongest-signal treatment the existing "right
// here" rail tag already uses — reusing brand language, not inventing a
// new one), a single one-shot fade/scale-in on mount (Animated, no loop,
// no repeat), nothing else moving.

import React, { useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, Image, StyleSheet, Animated } from 'react-native'

export default function WhatsTheThingCard({ item, navigation, colors }) {
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    anim.setValue(0)
    Animated.timing(anim, { toValue: 1, duration: 350, useNativeDriver: true }).start()
  }, [item?.id, anim])

  if (!item) return null

  const opacity = anim
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] })

  return (
    <Animated.View style={[styles.wrapper, { opacity, transform: [{ scale }] }]}>
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.AMBER, borderColor: colors.AMBER }]}
        onPress={() => navigation.navigate('ItemDetail', { item })}
        activeOpacity={0.9}
      >
        {item.photo_url ? <Image source={{ uri: item.photo_url }} style={styles.image} /> : null}
        <View style={styles.textBlock}>
          <Text style={[styles.eyebrow, { color: colors.NAVY }]}>YOU'RE HERE</Text>
          <Text style={[styles.title, { color: colors.NAVY }]}>What's the Thing?</Text>
          <Text style={[styles.itemBody, { color: colors.NAVY }]} numberOfLines={2}>
            {item.body}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginHorizontal: 16, marginTop: 16 },
  card: { flexDirection: 'row', borderRadius: 16, borderWidth: 2, overflow: 'hidden', alignItems: 'center' },
  image: { width: 72, height: 72 },
  textBlock: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 0.5, marginBottom: 4 },
  title: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  itemBody: { fontSize: 14, fontWeight: '600' },
})
