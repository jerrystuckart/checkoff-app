import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Modal, Share, Animated, Dimensions,
  FlatList,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import * as Haptics from 'expo-haptics'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'

const AMBER  = '#F5A623'
const GREEN  = '#1D9E75'
const RED    = '#D85A30'
const NAVY   = '#1A1A2E'

const { height: SCREEN_H } = Dimensions.get('window')

// ── Badge detail queries ─────────────────────────────────────
// Each badge type knows how to fetch the items that triggered it.
// Returns { items: [{body, date}], summary: string }

// check_ins.item_id is the canonical, always-available path to a
// check-in's item throughout this function — it survives list
// deletion. list_items is list-context only from here on and may be
// null once its list is gone (embedded directly off check_ins where
// still needed, never through list_items(items(...))).
async function fetchBadgeDetail(badgeId, userId, earnedAt) {
  if (!userId) return null

  const earnedDate = earnedAt ? new Date(earnedAt) : new Date()

  try {
    switch (badgeId) {

      case 'first_checkin': {
        const { data } = await supabase
          .from('check_ins')
          .select('checked_at, item_id, items(body)')
          .eq('user_id', userId)
          .order('checked_at', { ascending: true })
          .limit(1)
        const item = data?.[0]?.items
        return {
          summary: 'Your very first check-off. Everyone starts somewhere.',
          items: item ? [{ body: item.body, date: data[0].checked_at }] : [],
        }
      }

      case 'checkins_10':
      case 'checkins_25':
      case 'checkins_50':
      case 'checkins_100': {
        const milestones = { checkins_10: 10, checkins_25: 25, checkins_50: 50, checkins_100: 100 }
        const n = milestones[badgeId]
        // Get the Nth check-in (the one that triggered the badge)
        const { data } = await supabase
          .from('check_ins')
          .select('checked_at, item_id, items(body)')
          .eq('user_id', userId)
          .order('checked_at', { ascending: true })
          .range(n - 5, n - 1)  // last 5 leading up to milestone
        const formatted = (data ?? []).map(ci => ({
          body: ci.items?.body ?? 'Unknown item',
          date: ci.checked_at,
        }))
        return {
          summary: `You hit ${n} total check-offs. The last 5 that got you here:`,
          items: formatted.reverse(),
        }
      }

      case 'speed_run': {
        // 3+ check-ins in one day — find the day when this was first achieved
        const { data } = await supabase
          .from('check_ins')
          .select('checked_at, item_id, items(body)')
          .eq('user_id', userId)
          .gte('checked_at', new Date(earnedDate.getTime() - 24 * 60 * 60 * 1000).toISOString())
          .lte('checked_at', new Date(earnedDate.getTime() + 24 * 60 * 60 * 1000).toISOString())
          .order('checked_at', { ascending: true })
        const formatted = (data ?? []).map(ci => ({
          body: ci.items?.body ?? 'Unknown item',
          date: ci.checked_at,
        }))
        return {
          summary: `${formatted.length} check-offs in one day. That's a full session.`,
          items: formatted,
        }
      }

      case 'on_fire': {
        // 5+ check-ins in one week
        const weekStart = new Date(earnedDate)
        weekStart.setDate(weekStart.getDate() - weekStart.getDay())
        weekStart.setHours(0, 0, 0, 0)
        const weekEnd = new Date(weekStart)
        weekEnd.setDate(weekEnd.getDate() + 7)

        const { data } = await supabase
          .from('check_ins')
          .select('checked_at, item_id, items(body)')
          .eq('user_id', userId)
          .gte('checked_at', weekStart.toISOString())
          .lt('checked_at', weekEnd.toISOString())
          .order('checked_at', { ascending: true })
        const formatted = (data ?? []).map(ci => ({
          body: ci.items?.body ?? 'Unknown item',
          date: ci.checked_at,
        }))
        return {
          summary: `${formatted.length} check-offs in the week you earned this. You were on a roll.`,
          items: formatted,
        }
      }

      case 'night_owl': {
        // Check-in after 10pm — find it
        const { data } = await supabase
          .from('check_ins')
          .select('checked_at, item_id, items(body)')
          .eq('user_id', userId)
          .order('checked_at', { ascending: false })
          .limit(50)
        // Find check-ins after 10pm
        const lateNight = (data ?? []).filter(ci => {
          const hour = new Date(ci.checked_at).getHours()
          return hour >= 22 || hour < 3
        })
        const formatted = lateNight.slice(0, 5).map(ci => ({
          body: ci.items?.body ?? 'Unknown item',
          date: ci.checked_at,
        }))
        return {
          summary: `Checked off ${lateNight.length} item${lateNight.length === 1 ? '' : 's'} after 10pm. Some adventures only happen late.`,
          items: formatted,
        }
      }

      case 'streak_3':
      case 'streak_8': {
        const weeks = badgeId === 'streak_3' ? 3 : 8
        // Get recent check-ins to show the streak activity
        const cutoff = new Date(earnedDate)
        cutoff.setDate(cutoff.getDate() - weeks * 7)
        const { data } = await supabase
          .from('check_ins')
          .select('checked_at, item_id, items(body)')
          .eq('user_id', userId)
          .gte('checked_at', cutoff.toISOString())
          .lte('checked_at', earnedDate.toISOString())
          .order('checked_at', { ascending: false })
          .limit(10)
        const formatted = (data ?? []).map(ci => ({
          body: ci.items?.body ?? 'Unknown item',
          date: ci.checked_at,
        }))
        return {
          summary: `${weeks} consecutive weeks checking off items. Consistency is rare.`,
          items: formatted,
        }
      }

      case 'streak_4wk':
      case 'streak_8wk':
      case 'streak_12wk': {
        const weeks = parseInt(badgeId.replace('streak_', '').replace('wk', ''))
        const cutoff = new Date(earnedDate)
        cutoff.setDate(cutoff.getDate() - weeks * 7)
        const { data } = await supabase
          .from('check_ins')
          .select('checked_at, item_id, items(body)')
          .eq('user_id', userId)
          .gte('checked_at', cutoff.toISOString())
          .lte('checked_at', earnedDate.toISOString())
          .order('checked_at', { ascending: false })
          .limit(10)
        const formatted = (data ?? []).map(ci => ({
          body: ci.items?.body ?? 'Unknown item',
          date: ci.checked_at,
        }))
        return {
          summary: `${weeks} consecutive weeks checking off. That's not an accident.`,
          items: formatted,
        }
      }

      case 'points_5':
      case 'points_25':
      case 'points_75':
      case 'points_150':
      case 'points_300':
      case 'points_500': {
        const pts = parseInt(badgeId.replace('points_', ''))
        // Show the check-ins that pushed the user over this threshold
        const { data } = await supabase
          .from('check_ins')
          .select('checked_at, points_awarded, item_id, items(body)')
          .eq('user_id', userId)
          .order('checked_at', { ascending: false })
          .limit(5)
        const formatted = (data ?? []).map(ci => ({
          body: ci.items?.body ?? 'Unknown item',
          date: ci.checked_at,
        }))
        return {
          summary: `You crossed ${pts} lifetime points. This is a Checkpoint.`,
          items: formatted,
        }
      }

      case 'neighborhood_sweep': {
        const { data } = await supabase
          .from('check_ins')
          .select('checked_at, item_id, items(body, neighborhoods!items_neighborhood_id_fkey(name))')
          .eq('user_id', userId)
          .order('checked_at', { ascending: false })
          .limit(20)
        const formatted = (data ?? [])
          .filter(ci => ci.items?.neighborhoods)
          .slice(0, 8)
          .map(ci => ({
            body: ci.items?.body ?? 'Unknown item',
            date: ci.checked_at,
          }))
        return {
          summary: 'Every item in a neighborhood — completely swept.',
          items: formatted,
        }
      }

      case 'dare_accepted': {
        const { data } = await supabase
          .from('dares')
          .select('completed_at, item:items(body), from:users!dares_from_user_id_fkey(display_name)')
          .eq('to_user_id', userId)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(5)
        const formatted = (data ?? []).map(d => ({
          body: `${d.item?.body ?? 'Unknown item'} (dared by ${d.from?.display_name ?? 'a friend'})`,
          date: d.completed_at,
        }))
        return {
          summary: `Accepted and completed a dare from a friend. Respect.`,
          items: formatted,
        }
      }

      case 'dare_issued': {
        const { data } = await supabase
          .from('dares')
          .select('created_at, item:items(body), to:users!dares_to_user_id_fkey(display_name)')
          .eq('from_user_id', userId)
          .in('status', ['accepted', 'completed'])
          .order('created_at', { ascending: false })
          .limit(5)
        const formatted = (data ?? []).map(d => ({
          body: `Dared ${d.to?.display_name ?? 'a friend'}: ${d.item?.body ?? 'Unknown item'}`,
          date: d.created_at,
        }))
        return {
          summary: '5 dares accepted — people trust you to pick good ones.',
          items: formatted,
        }
      }

      case 'crew_builder': {
        return {
          summary: '3 or more friends joined a list you invited them to. You built the crew.',
          items: [],
        }
      }

      case 'seasonal_sweep': {
        const { data } = await supabase
          .from('check_ins')
          .select('checked_at, item_id, items(body)')
          .eq('user_id', userId)
          .order('checked_at', { ascending: false })
          .limit(10)
        const formatted = (data ?? []).map(ci => ({
          body: ci.items?.body ?? 'Unknown item',
          date: ci.checked_at,
        }))
        return {
          summary: 'Completed every item on a seasonal list. Full sweep.',
          items: formatted,
        }
      }

      default:
        return {
          summary: 'Badge earned.',
          items: [],
        }
    }
  } catch (e) {
    console.warn('fetchBadgeDetail error:', e.message)
    return { summary: '', items: [] }
  }
}

// ── Main Screen ──────────────────────────────────────────────

export default function BadgesScreen({ route }) {
  const { userId: paramUserId } = route?.params ?? {}
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2 } = colors
  const styles = useMemo(() => createBadgeStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2 }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2])

  const [userId, setUserId]             = useState(paramUserId ?? null)
  const [badges, setBadges]             = useState([])
  const [earned, setEarned]             = useState(new Set())
  const [earnedDates, setEarnedDates]   = useState({})
  const [streak, setStreak]             = useState(0)
  const [totalCheckins, setTotalCheckins] = useState(0)
  const [loading, setLoading]           = useState(true)

  // Modal state
  const [selectedBadge, setSelectedBadge] = useState(null)
  const [badgeDetail, setBadgeDetail]     = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [modalVisible, setModalVisible]   = useState(false)
  const slideAnim = useRef(new Animated.Value(SCREEN_H)).current

  useFocusEffect(useCallback(() => { load() }, []))

  async function load() {
    setLoading(true)
    let uid = paramUserId
    if (!uid) {
      const { data } = await supabase.auth.getUser()
      uid = data?.user?.id
      setUserId(uid)
    }

    const [badgeDefs, userBadges, userStats] = await Promise.all([
      supabase.from('badge_definitions').select('*').order('sort_order'),
      uid ? supabase.from('user_badges').select('badge_id, earned_at').eq('user_id', uid) : { data: [] },
      uid ? supabase.from('users').select('current_streak, longest_streak').eq('id', uid).single() : { data: null },
    ])

    setBadges(badgeDefs.data ?? [])
    const earnedSet = new Set((userBadges.data ?? []).map(b => b.badge_id))
    const dates = {}
    ;(userBadges.data ?? []).forEach(b => { dates[b.badge_id] = b.earned_at })
    setEarned(earnedSet)
    setEarnedDates(dates)
    if (userStats.data) setStreak(userStats.data.current_streak ?? 0)

    if (uid) {
      const { count } = await supabase
        .from('check_ins')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
      setTotalCheckins(count ?? 0)
    }

    setLoading(false)
  }

  async function openBadge(badge, isEarned) {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedBadge({ ...badge, isEarned })
    setBadgeDetail(null)
    setModalVisible(true)

    // Animate up
    Animated.spring(slideAnim, {
      toValue: 0,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start()

    // Load detail if earned
    if (isEarned && userId) {
      setDetailLoading(true)
      const detail = await fetchBadgeDetail(badge.id, userId, earnedDates[badge.id])
      setBadgeDetail(detail)
      setDetailLoading(false)
    }
  }

  function closeModal() {
    Animated.timing(slideAnim, {
      toValue: SCREEN_H,
      duration: 260,
      useNativeDriver: true,
    }).start(() => {
      setModalVisible(false)
      setSelectedBadge(null)
      setBadgeDetail(null)
    })
  }

  async function shareBadge() {
    if (!selectedBadge) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const msg = selectedBadge.isEarned
      ? `I just earned the "${selectedBadge.name}" ${selectedBadge.icon} badge on CheckOff!\n\n"${selectedBadge.description}"\n\nJoin me: https://getcheckoff.com`
      : `I'm going for the "${selectedBadge.name}" ${selectedBadge.icon} badge on CheckOff — ${selectedBadge.description}\n\nDownload the app: https://getcheckoff.com`
    try {
      await Share.share({ message: msg, title: `CheckOff badge: ${selectedBadge.name}` })
    } catch (e) { /* user cancelled */ }
  }

  function formatDate(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function formatTime(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={AMBER} size="large" />
      </View>
    )
  }

  const earnedBadges = badges.filter(b => earned.has(b.id))
  const lockedBadges = badges.filter(b => !earned.has(b.id))

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{earnedBadges.length}</Text>
            <Text style={styles.statLabel}>earned</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{totalCheckins}</Text>
            <Text style={styles.statLabel}>check-ins</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNum, { color: streak > 0 ? RED : MUTED }]}>
              {streak > 0 ? `${streak} 🔥` : '0'}
            </Text>
            <Text style={styles.statLabel}>week streak</Text>
          </View>
        </View>

        {/* Earned */}
        {earnedBadges.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Earned</Text>
            <View style={styles.badgeGrid}>
              {earnedBadges.map(b => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.badgeCard}
                  onPress={() => openBadge(b, true)}
                  activeOpacity={0.82}
                >
                  <Text style={styles.badgeIcon}>{b.icon}</Text>
                  <Text style={styles.badgeName}>{b.name}</Text>
                  <Text style={styles.badgeDesc}>{b.description}</Text>
                  <Text style={styles.badgeDate}>{formatDate(earnedDates[b.id])}</Text>
                  <View style={styles.tapHint}>
                    <Text style={styles.tapHintText}>Tap for details →</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Locked */}
        {lockedBadges.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Locked</Text>
            <View style={styles.badgeGrid}>
              {lockedBadges.map(b => (
                <TouchableOpacity
                  key={b.id}
                  style={[styles.badgeCard, styles.badgeCardLocked]}
                  onPress={() => openBadge(b, false)}
                  activeOpacity={0.82}
                >
                  <Text style={[styles.badgeIcon, styles.badgeIconLocked]}>{b.icon}</Text>
                  <Text style={[styles.badgeName, styles.badgeNameLocked]}>{b.name}</Text>
                  <Text style={[styles.badgeDesc, styles.badgeDescLocked]}>{b.description}</Text>
                  <Text style={styles.lockIcon}>🔒</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Badge detail modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="none"
        onRequestClose={closeModal}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalDismiss} onPress={closeModal} activeOpacity={1} />

          <Animated.View
            style={[styles.modalSheet, { transform: [{ translateY: slideAnim }] }]}
          >
            {selectedBadge && (
              <>
                {/* Handle */}
                <View style={styles.modalHandle} />

                {/* Hero */}
                <View style={[
                  styles.modalHero,
                  !selectedBadge.isEarned && styles.modalHeroLocked,
                ]}>
                  <Text style={[styles.modalIcon, !selectedBadge.isEarned && styles.modalIconLocked]}>
                    {selectedBadge.icon}
                  </Text>
                  <Text style={styles.modalBadgeName}>{selectedBadge.name}</Text>
                  {selectedBadge.isEarned && earnedDates[selectedBadge.id] && (
                    <View style={styles.earnedDateBadge}>
                      <Text style={styles.earnedDateText}>
                        Earned {formatDate(earnedDates[selectedBadge.id])}
                      </Text>
                    </View>
                  )}
                  {!selectedBadge.isEarned && (
                    <View style={styles.lockedBadge}>
                      <Text style={styles.lockedBadgeText}>🔒 Not yet earned</Text>
                    </View>
                  )}
                </View>

                <ScrollView
                  style={styles.modalBody}
                  contentContainerStyle={styles.modalBodyContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* How to earn / description */}
                  <View style={styles.descCard}>
                    <Text style={styles.descLabel}>
                      {selectedBadge.isEarned ? 'How you earned it' : 'How to earn it'}
                    </Text>
                    <Text style={styles.descText}>{selectedBadge.description}</Text>
                  </View>

                  {/* Items that triggered the badge */}
                  {selectedBadge.isEarned && (
                    <>
                      {detailLoading ? (
                        <View style={styles.detailLoading}>
                          <ActivityIndicator color={AMBER} size="small" />
                          <Text style={styles.detailLoadingText}>Loading your activity…</Text>
                        </View>
                      ) : badgeDetail ? (
                        <>
                          {badgeDetail.summary ? (
                            <Text style={styles.detailSummary}>{badgeDetail.summary}</Text>
                          ) : null}

                          {badgeDetail.items?.length > 0 && (
                            <View style={styles.itemsCard}>
                              <Text style={styles.itemsCardLabel}>Activity</Text>
                              {badgeDetail.items.map((item, idx) => (
                                <View
                                  key={idx}
                                  style={[styles.ciRow, idx < badgeDetail.items.length - 1 && styles.ciRowBorder]}
                                >
                                  <View style={styles.ciDot} />
                                  <View style={styles.ciBody}>
                                    <Text style={styles.ciText}>{item.body}</Text>
                                    {item.date && (
                                      <Text style={styles.ciDate}>{formatTime(item.date)}</Text>
                                    )}
                                  </View>
                                </View>
                              ))}
                            </View>
                          )}
                        </>
                      ) : null}
                    </>
                  )}

                  {/* Progress hint for locked badges */}
                  {!selectedBadge.isEarned && (
                    <View style={styles.progressHint}>
                      <Text style={styles.progressHintIcon}>💡</Text>
                      <Text style={styles.progressHintText}>
                        Keep checking off items and this badge will unlock automatically.
                      </Text>
                    </View>
                  )}

                  {/* Share button */}
                  <TouchableOpacity style={styles.shareBtn} onPress={shareBadge} activeOpacity={0.85}>
                    <Text style={styles.shareBtnText}>
                      {selectedBadge.isEarned
                        ? `Share this badge 🎉`
                        : `Challenge a friend to earn this 😈`}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.closeBtn} onPress={closeModal}>
                    <Text style={styles.closeBtnText}>Close</Text>
                  </TouchableOpacity>
                </ScrollView>
              </>
            )}
          </Animated.View>
        </View>
      </Modal>
    </>
  )
}

function createBadgeStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2 }) {
 return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content:   { padding: 20, paddingBottom: 60 },
  center:    { alignItems: 'center', justifyContent: 'center', flex: 1, backgroundColor: BG },

  statsRow:  { flexDirection: 'row', gap: 8, marginBottom: 24 },
  statCard:  { flex: 1, backgroundColor: CARD, borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  statNum:   { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 3 },
  statLabel: { fontSize: 10, color: MUTED, textAlign: 'center', fontWeight: '700' },

  sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', color: MUTED, marginBottom: 12 },

  badgeGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badgeCard:       { width: '47%', backgroundColor: CARD, borderRadius: 18, padding: 14, borderWidth: 1.2, borderColor: '#F0D29D' },
  badgeCardLocked: { backgroundColor: SOFT_2, borderColor: BORDER, borderWidth: 1 },

  badgeIcon:       { fontSize: 28, marginBottom: 8 },
  badgeIconLocked: { opacity: 0.45 },
  badgeName:       { fontSize: 13, fontWeight: '800', color: TEXT, marginBottom: 4 },
  badgeNameLocked: { color: MUTED },
  badgeDesc:       { fontSize: 11, color: MUTED, lineHeight: 15, fontWeight: '600' },
  badgeDescLocked: { color: MUTED, opacity: 0.7 },
  badgeDate:       { fontSize: 10, color: '#A16A00', marginTop: 8, fontWeight: '700' },
  lockIcon:        { fontSize: 10, color: MUTED, marginTop: 6, opacity: 0.6 },

  tapHint:     { marginTop: 8 },
  tapHintText: { fontSize: 10, color: AMBER, fontWeight: '700' },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(24,20,16,0.55)',
    justifyContent: 'flex-end',
  },
  modalDismiss: {
    position: 'absolute',
    inset: 0,
  },
  modalSheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: SCREEN_H * 0.88,
    overflow: 'hidden',
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: BORDER,
    alignSelf: 'center',
    marginTop: 12, marginBottom: 4,
  },

  // Hero section
  modalHero:       { alignItems: 'center', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#F2EBE0' },
  modalHeroLocked: { backgroundColor: SOFT_2 },
  modalIcon:       { fontSize: 56, marginBottom: 10 },
  modalIconLocked: { opacity: 0.45 },
  modalBadgeName:  { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },

  earnedDateBadge: { backgroundColor: SOFT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: '#F0D29D' },
  earnedDateText:  { fontSize: 12, color: '#A16A00', fontWeight: '700' },
  lockedBadge:     { backgroundColor: SOFT_2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: BORDER },
  lockedBadgeText: { fontSize: 12, color: MUTED, fontWeight: '700' },

  // Modal body
  modalBody:        { flexGrow: 0 },
  modalBodyContent: { padding: 20, paddingBottom: 40 },

  descCard:  { backgroundColor: SOFT_2, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: BORDER },
  descLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: MUTED, marginBottom: 6 },
  descText:  { fontSize: 14, color: TEXT, lineHeight: 21, fontWeight: '600' },

  detailLoading:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  detailLoadingText: { fontSize: 13, color: MUTED, fontWeight: '600' },
  detailSummary:     { fontSize: 13, color: MUTED, lineHeight: 19, fontWeight: '600', marginBottom: 14 },

  itemsCard:      { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 16, overflow: 'hidden' },
  itemsCardLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: MUTED, padding: 14, paddingBottom: 8 },
  ciRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  ciRowBorder:    { borderBottomWidth: 1, borderBottomColor: '#F2EBE0' },
  ciDot:          { width: 7, height: 7, borderRadius: 3.5, backgroundColor: AMBER, flexShrink: 0, marginTop: 5 },
  ciBody:         { flex: 1 },
  ciText:         { fontSize: 13, color: TEXT, fontWeight: '600', lineHeight: 18 },
  ciDate:         { fontSize: 11, color: MUTED, marginTop: 2, fontWeight: '600' },

  progressHint:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: SOFT_2, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: BORDER },
  progressHintIcon: { fontSize: 16 },
  progressHintText: { flex: 1, fontSize: 13, color: MUTED, lineHeight: 18, fontWeight: '600' },

  shareBtn:     { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  shareBtnText: { fontSize: 15, fontWeight: '800', color: NAVY },
  closeBtn:     { alignItems: 'center', paddingVertical: 12 },
  closeBtnText: { fontSize: 14, color: MUTED, fontWeight: '700' },
 })
}
