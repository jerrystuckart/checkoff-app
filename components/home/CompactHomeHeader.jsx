// HomeScreen 2026 Redesign — compact product chrome, not a giant card.
// Replaces the legacy headerCard (logo/tagline block) + metroStatusRow
// (metro selector + tier dots) with two tight rows and no container
// padding/border. Every existing capability stays reachable:
//   - CheckOff brand: still the most prominent element, top-left.
//   - Streak: preserved as-is (same data, same pill treatment).
//   - Local progress (tier + dots): preserved — this is a real progression
//     mechanic, not decoration, per product guidance.
//   - Metro awareness + switching: preserved, same tap-to-open-picker
//     behavior as before (handler passed in, not reimplemented here).
//   - "This Week": preserved as a small icon-only affordance rather than a
//     removed capability — evaluated per product guidance and kept, just
//     shrunk, since it's one tap to a real destination (WeeklyRecap).
//   - Light/dark toggle: preserved in-header as a small icon (evaluated
//     moving to Profile/Settings; kept here for this pass to avoid
//     unrelated changes to ProfileScreen.jsx, which is shared by all users
//     and outside this flag's scope — see final report).
// Removed: the marketing tagline ("Stop saying...") — pure decoration,
// not a capability, and the biggest single contributor to the old
// header's vertical footprint.

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

const TIER_ORDER = ['Starter', 'Explorer', 'Local', 'Insider', 'Legend']
const DOT_COUNT = 5

export default function CompactHomeHeader({
  colors,
  isDark,
  onToggleTheme,
  userStreak,
  showThisWeek,
  onThisWeekPress,
  metroLabel,
  multiMetro,
  onMetroPress,
  userInsiderTier,
  tierColor,
  tierProgressFilledDots,
  onProfilePress,
  showProfileStatus,
}) {
  const { TEXT, MUTED, BORDER, AMBER, NAVY } = colors

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <Text style={styles.logo} allowFontScaling={false}>
          <Text style={{ color: TEXT }}>Check</Text>
          <Text style={{ color: AMBER }}>Off</Text>
        </Text>

        <View style={styles.rightGroup}>
          {showThisWeek && (
            <TouchableOpacity
              onPress={onThisWeekPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.iconBtn}
            >
              <Text style={styles.iconBtnText}>✦</Text>
            </TouchableOpacity>
          )}
          {userStreak >= 1 && (
            <View style={[styles.streakPill, { borderColor: BORDER }, userStreak >= 4 && { backgroundColor: `${AMBER}22`, borderColor: AMBER }]}>
              <Text style={[styles.streakPillText, { color: TEXT }, userStreak >= 4 && { color: AMBER }]} allowFontScaling={false}>
                {userStreak + 'w 🔥'}
              </Text>
            </View>
          )}
          <TouchableOpacity onPress={onToggleTheme} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>{isDark ? '☀️' : '🌙'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.row}>
        <TouchableOpacity
          onPress={onMetroPress}
          activeOpacity={multiMetro ? 0.7 : 1}
          disabled={!multiMetro}
          style={styles.metroChip}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        >
          <Text style={[styles.metroChipText, { color: MUTED }]}>{metroLabel}</Text>
          {multiMetro && <Text style={[styles.metroChevron, { color: MUTED }]}> ▾</Text>}
        </TouchableOpacity>

        {showProfileStatus && (
          <TouchableOpacity onPress={onProfilePress} activeOpacity={0.75} style={styles.tierGroup}>
            <Text style={[styles.tierLabel, { color: tierColor }]}>{(userInsiderTier ?? '').toUpperCase()}</Text>
            <View style={styles.dotsRow}>
              {Array.from({ length: DOT_COUNT }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    { backgroundColor: i < tierProgressFilledDots ? tierColor : BORDER },
                  ]}
                />
              ))}
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

export { TIER_ORDER }

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
  rightGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: { paddingHorizontal: 2 },
  iconBtnText: { fontSize: 15 },
  streakPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  streakPillText: { fontSize: 11, fontWeight: '800' },
  metroChip: { flexDirection: 'row', alignItems: 'center' },
  metroChipText: { fontSize: 13, fontWeight: '700' },
  metroChevron: { fontSize: 12 },
  tierGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tierLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  dotsRow: { flexDirection: 'row', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
})
