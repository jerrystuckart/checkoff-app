import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, RefreshControl, Switch,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'

const AMBER  = '#F5A623'
const NAVY   = '#1A1A2E'
const GREEN  = '#1D9E75'
const RED    = '#D85A30'

const BG             = '#FFF9F2'
const CARD           = '#FFFFFF'
const TEXT           = '#243045'
const MUTED          = '#6F7785'
const BORDER         = '#E6D8C7'
const SOFT           = '#FFF1DB'
const SOFT_2         = '#F8F3EC'

export default function ProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const [user, setUser]                     = useState(null)
  const [profile, setProfile]               = useState(null)
  const [stats, setStats]                   = useState(null)
  const [showAlcohol, setShowAlcohol]         = useState(true)
  const [notifCheckIns, setNotifCheckIns]     = useState(true)
  const [notifInvites, setNotifInvites]       = useState(true)
  const [notifNudges, setNotifNudges]         = useState(true)
  const [badges, setBadges]                 = useState([])
  const [recentCheckins, setRecentCheckins] = useState([])
  const [loading, setLoading]               = useState(true)
  const [refreshing, setRefreshing]         = useState(false)

  useFocusEffect(
    useCallback(() => {
      // Clear stale profile first so previous account data never flashes
      setProfile(null)
      load()
    }, [])
  )

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    const { data: { user: authUser } } = await supabase.auth.getUser()
    setUser(authUser)

    if (!authUser) { setLoading(false); setRefreshing(false); return }

    const uid = authUser.id

    const [profileRes, badgesRes, checkinsRes, totalRes] = await Promise.all([
      supabase.from('users').select('id, display_name, email, current_streak, longest_streak, created_at, is_admin, pref_show_alcohol, notif_check_ins, notif_invites, notif_nudges').eq('id', uid).single(),
      supabase.from('user_badges').select('badge_id, earned_at, badge_definitions(id, name, icon, description)').eq('user_id', uid).order('earned_at', { ascending: false }).limit(6),
      supabase.from('check_ins').select('id, checked_at, checkin_method, list_items(items(body, categories(name, color_hex)))').eq('user_id', uid).order('checked_at', { ascending: false }).limit(5),
      supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    ])

    setProfile(profileRes.data)
    setShowAlcohol(profileRes.data?.pref_show_alcohol !== false)
    setNotifCheckIns(profileRes.data?.notif_check_ins !== false)
    setNotifInvites(profileRes.data?.notif_invites !== false)
    setNotifNudges(profileRes.data?.notif_nudges !== false)
    setBadges((badgesRes.data ?? []).map(b => ({ ...b.badge_definitions, earned_at: b.earned_at })).filter(Boolean))
    setRecentCheckins(checkinsRes.data ?? [])
    setStats({ total: totalRes.count ?? 0, streak: profileRes.data?.current_streak ?? 0, longest: profileRes.data?.longest_streak ?? 0 })
    setLoading(false)
    setRefreshing(false)
  }, [])

  async function toggleAlcohol(value) {
    setShowAlcohol(value)
    if (!user) return
    await supabase.from('users').update({ pref_show_alcohol: value }).eq('id', user.id)
  }

  async function toggleNotif(field, value) {
    const setters = {
      notif_check_ins: setNotifCheckIns,
      notif_invites:   setNotifInvites,
      notif_nudges:    setNotifNudges,
    }
    setters[field]?.(value)
    if (!user) return
    await supabase.from('users').update({ [field]: value }).eq('id', user.id)
  }

  async function signOut() {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
          await supabase.auth.signOut()
          // Small delay to let auth state propagate before navigating
          setTimeout(() => {
            const parent = navigation.getParent()
            if (parent) parent.navigate('HomeTab', { screen: 'Home' })
            else navigation.navigate('Home')
          }, 100)
        },
      },
    ])
}
  async function deleteAccount() {
    // Step 1 — first confirmation
    Alert.alert(
      'Delete account',
      'This will permanently delete your account, all your check-ins, badges, and lists. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            // Step 2 — second confirmation, Apple requires explicit confirmation
            Alert.alert(
              'Are you absolutely sure?',
              `Your account for ${profile?.email} will be permanently deleted. There is no way to recover it.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete my account',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      const { error } = await supabase.rpc('delete_my_account')
                      if (error) throw error
                      await supabase.auth.signOut()
                      setTimeout(() => {
                        const parent = navigation.getParent()
                        if (parent) parent.navigate('HomeTab', { screen: 'Home' })
                        else navigation.navigate('Home')
                      }, 100)
                    } catch (e) {
                      Alert.alert(
                        'Could not delete account',
                        e.message ?? 'Please try again or contact support@getcheckoff.com',
                        [{ text: 'OK' }]
                      )
                    }
                  },
                },
              ]
            )
          },
        },
      ]
    )
  }

  function memberSince(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  function timeAgo(iso) {
    if (!iso) return ''
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
    if (diff < 60)    return 'Just now'
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  if (!loading && !user) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <View style={styles.guestIcon}><Text style={styles.guestIconText}>◉</Text></View>
        <Text style={styles.guestTitle}>You're not signed in</Text>
        <Text style={styles.guestSub}>Sign in to track your check-ins, earn badges, and compete on the leaderboard.</Text>
        <TouchableOpacity style={styles.signInBtn} onPress={() => navigation.navigate('SignIn')}>
          <Text style={styles.signInBtnText}>Sign in</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={AMBER} size="large" />
      </View>
    )
  }

  const displayName = profile?.display_name || profile?.email?.split('@')[0] || 'CheckOffer'
  const initials    = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const hasStreak   = (stats?.streak ?? 0) > 0

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={AMBER} />}
    >
      {/* Hero card */}
      <View style={styles.heroCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.displayName}>{displayName}</Text>
        <Text style={styles.email}>{profile?.email}</Text>
        <Text style={styles.memberSince}>Member since {memberSince(profile?.created_at)}</Text>
        {profile?.is_admin && (
          <View style={styles.adminBadge}><Text style={styles.adminBadgeText}>⚙ Admin</Text></View>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { num: stats?.total ?? 0,   label: 'check-ins' },
          { num: hasStreak ? `${stats.streak} 🔥` : '0', label: 'week streak', color: hasStreak ? RED : undefined },
          { num: stats?.longest ?? 0, label: 'best streak' },
          { num: badges.length,        label: 'badges' },
        ].map((s, i) => (
          <View key={i} style={styles.statCard}>
            <Text style={[styles.statNum, s.color && { color: s.color }]}>{s.num}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Streak motivator */}
      {hasStreak ? (
        <View style={styles.streakCard}>
          <Text style={styles.streakCardText}>🔥 {stats.streak}-week streak — check something off this week to keep it going</Text>
        </View>
      ) : (stats?.total ?? 0) > 0 ? (
        <View style={[styles.streakCard, styles.streakCardNeutral]}>
          <Text style={[styles.streakCardText, { color: MUTED }]}>No active streak — check something off this week to start one</Text>
        </View>
      ) : null}

      {/* Badges */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>Badges</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Badges')}>
          <Text style={styles.sectionLink}>See all →</Text>
        </TouchableOpacity>
      </View>

      {badges.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No badges yet — check something off to earn your first one</Text>
        </View>
      ) : (
        <View style={styles.badgeRow}>
          {badges.slice(0, 6).map(b => (
            <View key={b.id} style={styles.badgeChip}>
              <Text style={styles.badgeChipIcon}>{b.icon}</Text>
              <Text style={styles.badgeChipName}>{b.name}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Recent check-ins */}
      <View style={[styles.sectionHeader, { marginTop: 8 }]}>
        <Text style={styles.sectionLabel}>Recent check-ins</Text>
      </View>

      <View style={styles.checkinsCard}>
        {recentCheckins.length === 0 ? (
          <Text style={[styles.emptyText, { textAlign: 'left' }]}>Nothing checked off yet — get out there!</Text>
        ) : recentCheckins.map((ci, idx) => {
          const item = ci.list_items?.items
          if (!item) return null
          return (
            <View key={ci.id} style={[styles.ciRow, idx < recentCheckins.length - 1 && styles.ciRowBorder]}>
              <View style={[styles.ciDot, { backgroundColor: item.categories?.color_hex ?? '#888' }]} />
              <View style={styles.ciBody}>
                <Text style={styles.ciText} numberOfLines={2}>{item.body}</Text>
                <View style={styles.ciMeta}>
                  {item.categories && <Text style={[styles.ciCat, { color: item.categories.color_hex }]}>{item.categories.name}</Text>}
                  {ci.checkin_method === 'photo' && <Text style={styles.ciPhoto}>📷</Text>}
                </View>
              </View>
              <Text style={styles.ciTime}>{timeAgo(ci.checked_at)}</Text>
            </View>
          )
        })}
      </View>

      {/* Actions */}
      <View style={styles.actionList}>
        <TouchableOpacity style={styles.actionRow} onPress={() => navigation.navigate('Badges')}>
          <Text style={styles.actionIcon}>🏅</Text>
          <Text style={styles.actionText}>All badges</Text>
          <Text style={styles.actionChevron}>›</Text>
        </TouchableOpacity>
        <View style={styles.actionDivider} />
        <TouchableOpacity style={styles.actionRow} onPress={() => navigation.navigate('Dare')}>
          <Text style={styles.actionIcon}>😈</Text>
          <Text style={styles.actionText}>Dare inbox</Text>
          <Text style={styles.actionChevron}>›</Text>
        </TouchableOpacity>
        <View style={styles.actionDivider} />
        <View style={styles.actionRow}>
          <Text style={styles.actionIcon}>🍺</Text>
          <View style={styles.actionBody}>
            <Text style={styles.actionText}>Show alcohol items</Text>
            <Text style={styles.actionSub}>Bars, drinks, and nightlife</Text>
          </View>
          <Switch
            value={showAlcohol}
            onValueChange={toggleAlcohol}
            trackColor={{ false: BORDER, true: '#F0D29D' }}
            thumbColor={showAlcohol ? AMBER : '#fff'}
            ios_backgroundColor={BORDER}
          />
        </View>
      </View>

      {/* Notification preferences */}
      <View style={[styles.sectionHeader, { marginTop: 8 }]}>
        <Text style={styles.sectionLabel}>Notifications</Text>
      </View>

      <View style={styles.actionList}>
        <View style={styles.actionRow}>
          <Text style={styles.actionIcon}>✓</Text>
          <View style={styles.actionBody}>
            <Text style={styles.actionText}>Crew check-ins</Text>
            <Text style={styles.actionSub}>When crew checks off a Partner or higher item</Text>
          </View>
          <Switch
            value={notifCheckIns}
            onValueChange={v => toggleNotif('notif_check_ins', v)}
            trackColor={{ false: BORDER, true: '#F0D29D' }}
            thumbColor={notifCheckIns ? AMBER : '#fff'}
            ios_backgroundColor={BORDER}
          />
        </View>
        <View style={styles.actionDivider} />
        <View style={styles.actionRow}>
          <Text style={styles.actionIcon}>📨</Text>
          <View style={styles.actionBody}>
            <Text style={styles.actionText}>List invites</Text>
            <Text style={styles.actionSub}>When someone invites you to a list</Text>
          </View>
          <Switch
            value={notifInvites}
            onValueChange={v => toggleNotif('notif_invites', v)}
            trackColor={{ false: BORDER, true: '#F0D29D' }}
            thumbColor={notifInvites ? AMBER : '#fff'}
            ios_backgroundColor={BORDER}
          />
        </View>
        <View style={styles.actionDivider} />
        <View style={styles.actionRow}>
          <Text style={styles.actionIcon}>🔥</Text>
          <View style={styles.actionBody}>
            <Text style={styles.actionText}>Leaderboard nudges</Text>
            <Text style={styles.actionSub}>When someone gets close to your score</Text>
          </View>
          <Switch
            value={notifNudges}
            onValueChange={v => toggleNotif('notif_nudges', v)}
            trackColor={{ false: BORDER, true: '#F0D29D' }}
            thumbColor={notifNudges ? AMBER : '#fff'}
            ios_backgroundColor={BORDER}
          />
        </View>
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
        <Text style={styles.signOutBtnText}>Sign out</Text>
      </TouchableOpacity>

      {/* Danger zone */}
      <View style={styles.dangerZone}>
        <Text style={styles.dangerZoneLabel}>Danger zone</Text>
        <TouchableOpacity style={styles.deleteBtn} onPress={deleteAccount}>
          <Text style={styles.deleteBtnText}>Delete my account</Text>
        </TouchableOpacity>
        <Text style={styles.deleteBtnHint}>
          Permanently removes your account, check-ins, badges, and lists. Cannot be undone.
        </Text>
      </View>

      <Text style={styles.version}>CheckOff · getcheckoff.com</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: BG },
  content:           { padding: 20, paddingBottom: 60 },
  center:            { alignItems: 'center', justifyContent: 'center', flex: 1, padding: 32, backgroundColor: BG },

  heroCard:          { backgroundColor: CARD, borderRadius: 28, padding: 20, marginBottom: 16, borderWidth: 1.2, borderColor: BORDER, alignItems: 'center' },
  avatar:            { width: 72, height: 72, borderRadius: 36, backgroundColor: SOFT, borderWidth: 2, borderColor: '#F0D29D', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText:        { fontSize: 26, fontWeight: '800', color: '#A16A00' },
  displayName:       { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 4 },
  email:             { fontSize: 13, color: MUTED, marginBottom: 4, fontWeight: '600' },
  memberSince:       { fontSize: 12, color: MUTED, fontWeight: '600' },
  adminBadge:        { marginTop: 10, backgroundColor: SOFT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: '#E8C98E' },
  adminBadgeText:    { fontSize: 11, color: '#A16A00', fontWeight: '800' },

  statsRow:          { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard:          { flex: 1, backgroundColor: CARD, borderRadius: 16, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  statNum:           { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 3 },
  statLabel:         { fontSize: 9, color: MUTED, textAlign: 'center', fontWeight: '700', lineHeight: 13 },

  streakCard:        { backgroundColor: '#FFF0EA', borderRadius: 14, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#F5C9B3' },
  streakCardNeutral: { backgroundColor: SOFT_2, borderColor: BORDER },
  streakCardText:    { fontSize: 13, color: TEXT, lineHeight: 18, fontWeight: '600' },

  sectionHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionLabel:      { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, color: MUTED, textTransform: 'uppercase' },
  sectionLink:       { fontSize: 13, color: AMBER, fontWeight: '700' },

  badgeRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  badgeChip:         { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CARD, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: '#F0D29D' },
  badgeChipIcon:     { fontSize: 14 },
  badgeChipName:     { fontSize: 12, color: TEXT, fontWeight: '700' },

  checkinsCard:      { backgroundColor: CARD, borderRadius: 18, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: BORDER },
  ciRow:             { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 },
  ciRowBorder:       { borderBottomWidth: 1, borderBottomColor: '#F2EBE0' },
  ciDot:             { width: 8, height: 8, borderRadius: 4, flexShrink: 0, marginTop: 4 },
  ciBody:            { flex: 1 },
  ciText:            { fontSize: 13, color: TEXT, lineHeight: 18, fontWeight: '600' },
  ciMeta:            { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  ciCat:             { fontSize: 10, fontWeight: '700' },
  ciPhoto:           { fontSize: 10 },
  ciTime:            { fontSize: 11, color: MUTED, fontWeight: '600', flexShrink: 0 },

  emptyCard:         { backgroundColor: CARD, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: BORDER },
  emptyText:         { fontSize: 13, color: MUTED, textAlign: 'center', fontWeight: '600' },

  actionList:        { backgroundColor: CARD, borderRadius: 18, marginBottom: 16, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  actionRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  actionDivider:     { height: 1, backgroundColor: '#F2EBE0', marginHorizontal: 16 },
  actionIcon:        { fontSize: 18, width: 24, textAlign: 'center' },
  actionText:        { flex: 1, fontSize: 14, color: TEXT, fontWeight: '600' },
  actionChevron:     { fontSize: 20, color: MUTED },
  actionBody:        { flex: 1 },
  actionSub:         { fontSize: 11, color: MUTED, marginTop: 2, fontWeight: '600' },

  signOutBtn:        { borderWidth: 1.5, borderColor: BORDER, borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 16 },
  signOutBtnText:    { fontSize: 14, color: MUTED, fontWeight: '700' },

  dangerZone:        { borderWidth: 1, borderColor: '#F5C9B3', borderRadius: 14, padding: 16, marginBottom: 16, backgroundColor: '#FFF6F3' },
  dangerZoneLabel:   { fontSize: 10, fontWeight: '800', color: RED, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 },
  deleteBtn:         { borderWidth: 1.5, borderColor: RED, borderRadius: 10, padding: 13, alignItems: 'center', marginBottom: 8 },
  deleteBtnText:     { fontSize: 14, color: RED, fontWeight: '800' },
  deleteBtnHint:     { fontSize: 11, color: MUTED, textAlign: 'center', lineHeight: 15 },

  version:           { fontSize: 11, color: MUTED, textAlign: 'center', fontWeight: '600', opacity: 0.6 },

  guestIcon:         { width: 72, height: 72, borderRadius: 36, backgroundColor: SOFT_2, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  guestIconText:     { fontSize: 32, color: MUTED },
  guestTitle:        { fontSize: 20, fontWeight: '800', color: TEXT, marginBottom: 10, textAlign: 'center' },
  guestSub:          { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: 28, fontWeight: '600' },
  signInBtn:         { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40 },
  signInBtnText:     { fontSize: 16, fontWeight: '800', color: NAVY },
})
