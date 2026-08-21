import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

const AMBER = '#F5A623'
const NAVY = '#1A1A2E'

/**
 * Small presentational pieces reused inside OnboardingDeviceFrame across
 * the onboarding slides. Static/offline only — no network data.
 */

export function SeasonalHeroCard({ emoji, title, cityTag }) {
  return (
    <View style={s.heroCard}>
      <Text style={s.heroEmoji} allowFontScaling={false}>{emoji}</Text>
      <Text style={s.heroTitle} numberOfLines={1} allowFontScaling={false}>{title}</Text>
      <View style={s.heroTagRow}>
        <View style={s.heroTag}>
          <Text style={s.heroTagText} allowFontScaling={false}>📍 {cityTag}</Text>
        </View>
      </View>
    </View>
  )
}

export function CuratedListRow({ title, subtitle, accent }) {
  return (
    <View style={s.listRow}>
      <View style={[s.listRowDot, { backgroundColor: accent }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.listRowTitle} numberOfLines={1} allowFontScaling={false}>{title}</Text>
        <Text style={s.listRowSub} numberOfLines={1} allowFontScaling={false}>{subtitle}</Text>
      </View>
      <Text style={s.listRowChevron} allowFontScaling={false}>›</Text>
    </View>
  )
}

export function ChecklistCard({ items }) {
  return (
    <View style={s.checklistCard}>
      {items.map((item, i) => (
        <View key={i} style={[s.itemRow, i > 0 && s.itemRowDivider]}>
          <View style={[s.check, item.done && s.checkDone]}>
            {item.done && <Text style={s.checkMark} allowFontScaling={false}>✓</Text>}
            {item.locked && <Text style={{ fontSize: 10 }} allowFontScaling={false}>🔒</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.itemBody} numberOfLines={1} allowFontScaling={false}>{item.label}</Text>
            {item.cat && (
              <View style={[s.tag, { backgroundColor: item.catColor + '20', marginTop: 4 }]}>
                <Text style={[s.tagText, { color: item.catColor }]} allowFontScaling={false}>{item.cat}</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  )
}

export function FriendAvatarsRow({ people, label }) {
  return (
    <View style={s.crewCard}>
      <View style={{ flexDirection: 'row' }}>
        {people.map((p, i) => (
          <View key={i} style={[s.crewAvatar, { backgroundColor: p.color, marginLeft: i === 0 ? 0 : -8 }]}>
            <Text style={s.crewAvatarText} allowFontScaling={false}>{p.initial}</Text>
          </View>
        ))}
      </View>
      <Text style={s.crewLabel} numberOfLines={1} allowFontScaling={false}>{label}</Text>
    </View>
  )
}

export function Pill({ text, color }) {
  return (
    <View style={[s.pill, { backgroundColor: color + '18', borderColor: color + '40' }]}>
      <Text style={[s.pillText, { color }]} allowFontScaling={false}>{text}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  heroCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  heroEmoji: { fontSize: 26, marginBottom: 6 },
  heroTitle: { fontSize: 16, fontWeight: '800', color: '#fff' },
  heroTagRow: { flexDirection: 'row', marginTop: 8 },
  heroTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroTagText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginTop: 8,
  },
  listRowDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  listRowTitle: { fontSize: 12.5, fontWeight: '700', color: '#fff' },
  listRowSub: { fontSize: 10.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  listRowChevron: { fontSize: 16, color: 'rgba(255,255,255,0.3)', fontWeight: '700' },

  checklistCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 },
  itemRowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  check: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  checkDone: { backgroundColor: AMBER, borderColor: AMBER },
  checkMark: { fontSize: 10, color: NAVY, fontWeight: '800' },
  itemBody: { fontSize: 12.5, color: '#fff', fontWeight: '600', lineHeight: 17 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  tagText: { fontSize: 9, fontWeight: '700', includeFontPadding: false },

  crewCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginTop: 10,
  },
  crewAvatar: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#0B0B18',
  },
  crewAvatarText: { fontSize: 12, fontWeight: '800', color: NAVY },
  crewLabel: { fontSize: 11.5, color: 'rgba(255,255,255,0.55)', fontWeight: '600', marginTop: 10 },

  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 10,
  },
  pillText: { fontSize: 11, fontWeight: '800' },
})
