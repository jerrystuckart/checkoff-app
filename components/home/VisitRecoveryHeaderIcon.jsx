// Home header entry point for seven-day visit recovery: a compact pin button with a red count of actionable suggestions.
// It replaces the large "Recover checkoffs you forgot" card. These are POSSIBLE visits the user can confirm, so the
// accessibility label says "places you may have visited", never "missed checkoffs".
//
// Everything is reused, nothing is re-derived:
//   - eligibility / visibility / state: useVisitRecovery -> resolveVisitRecoveryState (lib/visitDetection/recoveryState.js)
//   - the count: countPendingSuggestions -> countActionableCandidates (exactly the cards the inbox shows: no expired,
//     dismissed, confirmed or otherwise ineligible rows)
//   - refresh: the hook re-reads on Home focus, app foreground, recovery on/off/delete, and candidate confirm/dismiss
//   - tap: the existing inbox; or, for a signed-in user who has not turned recovery on, the existing setup flow
//     (useVisitRecovery.turnOn, the same one Profile uses: on Android it includes the Play disclosure). Turning it off, and permission management, stay in Profile.
import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { openVisitInbox } from '../../lib/visitDetection/inboxNavigation'
import { useVisitRecovery } from '../../lib/visitDetection/useVisitRecovery'
import { recoveryIconBadgeText, recoveryIconAction } from '../../lib/visitDetection/recoveryHeaderIcon'

const BADGE_RED = '#E5484D'

// Renders nothing for signed-out users, where recovery is unsupported (Android) and where it is not offered to this user.
export default function VisitRecoveryHeaderIcon({ userId, navigation, colors }) {
  const { BORDER } = colors
  const { supported, loaded, resolved, turnOn } = useVisitRecovery(userId)

  if (!supported || !userId || !loaded || !resolved.visible) return null

  const count = resolved.suggestionCount
  const badge = recoveryIconBadgeText(count)

  function onPress() {
    if (recoveryIconAction({ state: resolved.state, suggestionCount: count }) === 'setup') {
      turnOn()
      return
    }
    openVisitInbox(navigation.getParent?.() ?? navigation)
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      style={styles.btn}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Places you may have visited, ${count} waiting` : 'Places you may have visited'}
    >
      <View style={[styles.ring, { borderColor: BORDER }]}>
        <Text style={styles.glyph} allowFontScaling={false}>📍</Text>
      </View>
      {badge ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText} allowFontScaling={false}>{badge}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  btn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 13 },
  badge: {
    position: 'absolute', top: -4, right: -6, minWidth: 16, height: 16, borderRadius: 8,
    paddingHorizontal: 4, backgroundColor: BADGE_RED, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', lineHeight: 12 },
})
