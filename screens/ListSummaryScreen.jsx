import React, { useEffect, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Share,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'

const AMBER  = '#F5A623'
const NAVY   = '#1A1A2E'
const GREEN  = '#1D9E75'
const PURPLE = '#8B5CF6'
const BG     = '#FFF9F2'
const CARD   = '#FFFFFF'
const TEXT   = '#243045'
const MUTED  = '#6B7280'
const BORDER = '#E6D8C7'
const SOFT   = '#FFF1DB'

/**
 * ListSummaryScreen
 *
 * Shown when a user completes all items on a list (100%) OR when a list ends.
 * Celebrates the achievement, shows crew rank, teases the next list.
 *
 * Route params:
 *   listId:        string
 *   title:         string
 *   checkedCount:  number
 *   totalCount:    number
 *   totalPts:      number     — user's total point score
 *   rank:          number     — 1-based rank vs crew (1 = first place)
 *   crewSize:      number     — total crew members
 *   topItem:       object     — { body, difficulty, pts } — highest-value item checked
 *   streak:        number     — current streak weeks
 *   isFullyDone:   boolean    — true = all items checked, false = list ended/expired
 */
export default function ListSummaryScreen({ route, navigation }) {
  const {
    listId,
    title         = 'Your list',
    checkedCount  = 0,
    totalCount    = 0,
    totalPts      = 0,
    rank          = 1,
    crewSize      = 1,
    topItem       = null,
    streak        = 0,
    isFullyDone   = false,
  } = route?.params ?? {}

  const insets = useSafeAreaInsets()

  // Entrance animations
  const fadeAnim   = useRef(new Animated.Value(0)).current
  const slideAnim  = useRef(new Animated.Value(30)).current
  const scaleAnim  = useRef(new Animated.Value(0.8)).current

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
    ]).start()
  }, [])

  const pct         = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0
  const rankLabel   = rank === 1 ? '🥇 1st place'
                    : rank === 2 ? '🥈 2nd place'
                    : rank === 3 ? '🥉 3rd place'
                    : `#${rank} of ${crewSize}`
  const rankColor   = rank === 1 ? AMBER : rank === 2 ? '#A0A8B0' : rank === 3 ? '#CD7F32' : MUTED

  const heroEmoji   = isFullyDone
    ? (rank === 1 ? '🏆' : '🎉')
    : (pct >= 75 ? '💪' : pct >= 50 ? '⚡' : '📋')

  const heroTitle   = isFullyDone
    ? (rank === 1 ? 'You crushed it.' : 'List complete!')
    : 'List ended'

  const heroSub     = isFullyDone
    ? `Every single item checked off. ${rank === 1 ? 'You finished first.' : `You came in ${rankLabel.toLowerCase()}.`}`
    : `${pct}% complete — ${checkedCount} of ${totalCount} items checked off.`

  async function shareResult() {
    const rankStr = rank <= 3 ? rankLabel : `#${rank}`
    const msg = `I just finished "${title}" on CheckOff — ${checkedCount}/${totalCount} items, ${totalPts} pts, ${rankStr}. Come check things off with me: https://getcheckoff.com`
    try {
      await Share.share({ message: msg, title: 'CheckOff result' })
    } catch (e) { /* cancelled */ }
  }

  function goHome() {
    const parent = navigation.getParent()
    if (parent) parent.navigate('HomeTab')
    else navigation.navigate('Home')
  }

  function startNextList() {
    navigation.navigate('BrowseLists')
  }

  function viewLeaderboard() {
    navigation.navigate('Leaderboard', { listId, title })
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Animated.View style={[
          styles.heroCard,
          {
            opacity:   fadeAnim,
            transform: [
              { translateY: slideAnim },
              { scale: scaleAnim },
            ],
          },
        ]}>
          <Text style={styles.heroEmoji}>{heroEmoji}</Text>
          <Text style={styles.heroTitle}>{heroTitle}</Text>
          <Text style={styles.heroSub}>{heroSub}</Text>

          {/* Progress bar */}
          <View style={styles.progressWrap}>
            <View style={styles.progressBg}>
              <Animated.View
                style={[
                  styles.progressFill,
                  { width: `${pct}%`, backgroundColor: pct === 100 ? GREEN : AMBER },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{pct}%</Text>
          </View>
        </Animated.View>

        {/* Stats row */}
        <Animated.View style={[styles.statsRow, { opacity: fadeAnim }]}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{totalPts}</Text>
            <Text style={styles.statLabel}>pts earned</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: rankColor }]}>{rankLabel}</Text>
            <Text style={styles.statLabel}>crew rank</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statValue}>{checkedCount}</Text>
            <Text style={styles.statLabel}>checked off</Text>
          </View>
        </Animated.View>

        {/* Streak callout */}
        {streak >= 1 && (
          <Animated.View style={[styles.streakCard, { opacity: fadeAnim }]}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.streakTitle}>
                {streak}-week streak{streak >= 4 ? ' · 1.5× bonus active' : ''}
              </Text>
              <Text style={styles.streakSub}>
                {streak >= 4
                  ? 'Your streak multiplier is boosting your points on every non-Legend item.'
                  : `Keep going — at 4 weeks your points get a 1.5× multiplier.`}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Top item highlight */}
        {topItem && (
          <Animated.View style={[styles.topItemCard, { opacity: fadeAnim }]}>
            <Text style={styles.topItemLabel}>Best check-off</Text>
            <Text style={styles.topItemBody} numberOfLines={2}>{topItem.body}</Text>
            <View style={styles.topItemBadgeRow}>
              {topItem.difficulty === 25 && (
                <View style={[styles.topItemBadge, { backgroundColor: '#F3EEFF' }]}>
                  <Text style={[styles.topItemBadgeText, { color: PURPLE }]}>Legend · 25pts</Text>
                </View>
              )}
              {topItem.difficulty === 10 && (
                <View style={[styles.topItemBadge, { backgroundColor: '#FFF7E6' }]}>
                  <Text style={[styles.topItemBadgeText, { color: '#92400E' }]}>Rare · 10pts</Text>
                </View>
              )}
              {topItem.difficulty === 5 && (
                <View style={[styles.topItemBadge, { backgroundColor: '#EBF4FF' }]}>
                  <Text style={[styles.topItemBadgeText, { color: '#1E4A8A' }]}>Partner · 5pts</Text>
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* Action buttons */}
        <Animated.View style={[styles.actions, { opacity: fadeAnim }]}>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={startNextList}
            activeOpacity={0.88}
          >
            <Text style={styles.primaryBtnText}>Start your next list →</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={viewLeaderboard}
            activeOpacity={0.88}
          >
            <Text style={styles.secondaryBtnText}>View crew standings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.shareBtn}
            onPress={shareResult}
            activeOpacity={0.88}
          >
            <Text style={styles.shareBtnText}>Share your result</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.homeBtn}
            onPress={goHome}
            activeOpacity={0.8}
          >
            <Text style={styles.homeBtnText}>Back to home</Text>
          </TouchableOpacity>

        </Animated.View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content:   { padding: 20 },

  heroCard: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
  },

  heroEmoji:  { fontSize: 52, marginBottom: 12 },
  heroTitle:  { fontSize: 26, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },
  heroSub:    { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 21, marginBottom: 16, fontWeight: '500' },

  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' },
  progressBg:   { flex: 1, height: 8, backgroundColor: '#F0E8DA', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  progressText: { fontSize: 13, fontWeight: '800', color: MUTED, minWidth: 36, textAlign: 'right' },

  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },

  statCard: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },

  statValue: { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 4 },
  statLabel: { fontSize: 10, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },

  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFF8EE',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0D29D',
    marginBottom: 16,
  },

  streakEmoji: { fontSize: 28 },
  streakTitle: { fontSize: 14, fontWeight: '800', color: '#92400E', marginBottom: 3 },
  streakSub:   { fontSize: 12, color: '#A16A00', lineHeight: 17 },

  topItemCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
  },

  topItemLabel:     { fontSize: 10, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  topItemBody:      { fontSize: 15, fontWeight: '700', color: TEXT, lineHeight: 21, marginBottom: 8 },
  topItemBadgeRow:  { flexDirection: 'row', gap: 6 },
  topItemBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  topItemBadgeText: { fontSize: 11, fontWeight: '800' },

  actions: { gap: 10 },

  primaryBtn: {
    backgroundColor: AMBER,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: NAVY },

  secondaryBtn: {
    backgroundColor: CARD,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', color: TEXT },

  shareBtn: {
    backgroundColor: CARD,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  shareBtnText: { fontSize: 15, fontWeight: '700', color: TEXT },

  homeBtn:     { paddingVertical: 14, alignItems: 'center' },
  homeBtnText: { fontSize: 14, color: MUTED, fontWeight: '600' },
})
