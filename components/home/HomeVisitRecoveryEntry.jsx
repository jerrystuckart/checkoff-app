// Home entry point for seven-day visit recovery — "Recover check-offs you
// forgot" → opens the existing "Places you may have visited" inbox
// (screens/VisitInboxScreen.jsx via lib/visitDetection/inboxNavigation.js),
// same destination as the Profile entry (components/VisitRecoverySection.jsx).
//
// Unlike VisitRecoverySection's inbox row (which only shows once the user has
// a pending suggestion or has already opted in), this Home entry is visible to
// ANY signed-in user the feature is offered to — including zero candidates and
// not-yet-opted-in — so Home always has a way in. It never duplicates the full
// opt-in card/consent flow (that stays Profile-only, one place to turn it on);
// tapping this always opens the inbox, and the inbox's own empty state already
// explains how it works and points back to Profile to turn it on.
//
// Copy is intentionally the existing RECOVERY_COPY strings only (title +
// intro/needsPermission/paused, already shown elsewhere) — no new wording
// invented for this surface, per product direction.

import React, { useCallback, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Platform } from 'react-native'
import { isFlagEnabled } from '../../lib/featureFlags'
import { hasBackgroundLocationPermission } from '../../lib/visitDetection/permissions'
import { fetchOptIn, countPendingSuggestions, subscribeRecoveryChange, subscribeCandidatesChange } from '../../lib/visitDetection/recoverySettings'
import { recoveryCardState, RECOVERY_COPY } from '../../lib/visitDetection/recoveryPolicy'
import { openVisitInbox } from '../../lib/visitDetection/inboxNavigation'

export default function HomeVisitRecoveryEntry({ userId, navigation, colors }) {
  const { CARD, TEXT, MUTED, BORDER, AMBER } = colors
  const [loaded, setLoaded] = useState(false)
  const [st, setSt] = useState({ flagEnabled: false, optedIn: false, backgroundGranted: false, suggestionCount: 0 })

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [flagEnabled, optedIn, backgroundGranted, suggestionCount] = await Promise.all([
        isFlagEnabled(userId, 'candidate_visit_detection'),
        fetchOptIn(userId),
        hasBackgroundLocationPermission().catch(() => false),
        countPendingSuggestions(userId),
      ])
      setSt({ flagEnabled, optedIn, backgroundGranted, suggestionCount })
    } catch (e) {
      console.warn('HomeVisitRecoveryEntry load failed:', e?.message ?? e)
    } finally {
      setLoaded(true)
    }
  }, [userId])

  useFocusEffect(useCallback(() => { load() }, [load]))
  React.useEffect(() => {
    const offA = subscribeRecoveryChange(load)
    const offB = subscribeCandidatesChange(load)
    return () => { offA(); offB() }
  }, [load])

  if (!userId || !loaded) return null

  const cardState = recoveryCardState({ ...st, platformOS: Platform.OS })
  // Same hide condition as Profile's card section: not offered to this user
  // (flag off, and they haven't opted in) or the platform can't do it yet.
  if (cardState === 'hidden' || cardState === 'unsupported_platform') return null

  const subtitle =
    cardState === 'on'
      ? (st.suggestionCount > 0
          ? `${st.suggestionCount} place${st.suggestionCount === 1 ? '' : 's'} waiting for you to check off`
          : 'On — nothing to review right now')
      : cardState === 'needs_permission'
        ? RECOVERY_COPY.needsPermission
        : cardState === 'paused'
          ? RECOVERY_COPY.paused
          : RECOVERY_COPY.intro // 'off'

  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: CARD, borderColor: BORDER }]}
      onPress={() => openVisitInbox(navigation.getParent?.() ?? navigation)}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <Text style={styles.icon}>📍</Text>
      <View style={styles.body}>
        <Text style={[styles.title, { color: TEXT }]}>{RECOVERY_COPY.title}</Text>
        <Text style={[styles.subtitle, { color: MUTED }]} numberOfLines={2}>{subtitle}</Text>
      </View>
      {st.suggestionCount > 0 && (
        <View style={[styles.badge, { backgroundColor: AMBER }]}>
          <Text style={styles.badgeText}>{st.suggestionCount}</Text>
        </View>
      )}
      <Text style={[styles.chevron, { color: MUTED }]}>›</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 12,
    gap: 10,
  },
  icon: { fontSize: 18 },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700' },
  subtitle: { fontSize: 12, fontWeight: '600', marginTop: 2, lineHeight: 16 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 4 },
  badgeText: { color: '#1A1A2E', fontWeight: '800', fontSize: 12 },
  chevron: { fontSize: 20 },
})
