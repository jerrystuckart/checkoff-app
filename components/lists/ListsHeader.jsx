// Lists Landing Redesign (2026-09-19) — compact header for the Lists tab
// landing screen, matching the editorial-header language established by
// Home/Nearby's own redesigns: a confident title, a short subline, and one
// clear primary action. No oversized empty header space, no duplicated
// global wordmark (this app's tab-root screens don't render one — see
// DiscoverScreen.jsx's headerShown:false precedent cited in the task audit).
//
// The "+ New list" action is the ONLY header action rendered — a "join a
// list" affordance is deliberately omitted: this app's real join flow
// (screens/JoinListScreen.jsx) is only ever reached via an invite deep link
// or a post-sign-in redirect (see SignInScreen.jsx's returnToInvite), never
// via a manual "enter a code" UI anywhere in the app today. Inventing one
// here would be new product surface, not a visual redesign of what exists.

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

export default function ListsHeader({ onCreate, colors }) {
  const { TEXT, MUTED, SOFT, AMBER } = colors
  return (
    <View style={styles.wrap}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: TEXT }]}>Your Lists</Text>
        <Text style={[styles.subline, { color: MUTED }]}>
          Saved places, shared plans, and lists you're doing
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.createBtn, { backgroundColor: SOFT, borderColor: '#E8C98E' }]}
        onPress={onCreate}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Create a new list"
      >
        <Text style={[styles.createBtnText, { color: '#A16A00' }]}>+ New list</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  subline: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    maxWidth: 260,
  },
  createBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    marginTop: 2,
  },
  createBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
})
