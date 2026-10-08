// Home entry point for seven-day visit recovery — "Recover check-offs you
// forgot" → opens the existing "Places you may have visited" inbox
// (screens/VisitInboxScreen.jsx via lib/visitDetection/inboxNavigation.js),
// same destination as the Profile entry (components/VisitRecoverySection.jsx).
//
// Unlike VisitRecoverySection's inbox row (which only shows once the user has
// a pending suggestion or has already opted in), this Home entry is visible to
// ANY signed-in user the feature is offered to — including zero candidates and
// not-yet-opted-in — so Home always has a way in. When the user has not opted in it also offers "Turn on", which runs the
// same user-initiated consent flow as Profile (useVisitRecovery.turnOn: disclosure, then permissions). Nothing is ever
// turned on automatically, and the permission-aware CTAs (Open Settings / Allow all the time) show here too.
//
// Copy is intentionally the existing RECOVERY_COPY strings only (title +
// intro/needsPermission/paused, already shown elsewhere) — no new wording
// invented for this surface, per product direction.

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { RECOVERY_COPY } from '../../lib/visitDetection/recoveryPolicy'
import { openVisitInbox } from '../../lib/visitDetection/inboxNavigation'
import { useVisitRecovery } from '../../lib/visitDetection/useVisitRecovery'

// Renders nothing where visit recovery is unsupported (Android) and nothing until the permission-aware state is known.
// The status line comes from lib/visitDetection/recoveryState.js: it says "On" only when recovery can actually work.
export default function HomeVisitRecoveryEntry({ userId, navigation, colors }) {
  const { CARD, TEXT, MUTED, BORDER, AMBER } = colors
  const { supported, loaded, resolved, runCta, turnOn, enabling } = useVisitRecovery(userId)

  if (!supported || !userId || !loaded || !resolved.visible) return null

  const subtitle = resolved.state === 'off' ? RECOVERY_COPY.intro : resolved.status
  const st = { suggestionCount: resolved.suggestionCount }

  return (
    <View>
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
    {resolved.state === 'off' ? (
      <TouchableOpacity style={[styles.cta, { backgroundColor: AMBER }]} onPress={turnOn} disabled={enabling} activeOpacity={0.85} accessibilityRole="button">
        <Text style={styles.ctaText}>Turn on</Text>
      </TouchableOpacity>
    ) : null}
    {resolved.cta ? (
      <TouchableOpacity style={[styles.cta, { backgroundColor: AMBER }]} onPress={runCta} activeOpacity={0.85} accessibilityRole="button">
        <Text style={styles.ctaText}>{resolved.cta.label}</Text>
      </TouchableOpacity>
    ) : null}
    </View>
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
  cta: { marginHorizontal: 16, marginTop: 8, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  ctaText: { color: '#1A1A2E', fontWeight: '800', fontSize: 13 },
})
