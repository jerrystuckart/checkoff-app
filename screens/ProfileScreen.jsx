import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, RefreshControl, Switch, StatusBar, Share,
} from 'react-native'
import { getTierByName, getNextTier, getTierProgress } from '../lib/tiers'
import { useFocusEffect } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'
import { useTheme } from '../lib/ThemeContext'
import * as Sentry from '@sentry/react-native'

export default function ProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const { signOut: authSignOut } = useAuth()
  const { colors, isDark, toggleTheme } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, RED, STATUS_BAR } = colors

  const styles = useMemo(() => createStyles({
    BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, RED,
  }), [BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, RED])
  const [user, setUser]                     = useState(null)
  const [profile, setProfile]               = useState(null)
  const [stats, setStats]                   = useState(null)
  const [showAlcohol, setShowAlcohol]         = useState(true)
  const [notifCheckIns, setNotifCheckIns]     = useState(true)
  const [notifInvites, setNotifInvites]       = useState(true)
  const [notifNudges, setNotifNudges]         = useState(true)
  const [badges, setBadges]                 = useState([])
  const [recentCheckins, setRecentCheckins] = useState([])
  const [weeklySummary, setWeeklySummary]   = useState(null) // { count, pts }
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

    let authUser = null
    try {
      const { data } = await supabase.auth.getUser()
      authUser = data?.user ?? null
    } catch (e) {
      console.warn('ProfileScreen getUser error:', e.message)
    }
    setUser(authUser)

    if (!authUser) { setLoading(false); setRefreshing(false); return }

    const uid = authUser.id

    try {
      // Week range: Monday – Sunday
      const now = new Date()
      const day = now.getDay()
      const monday = new Date(now)
      monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day))
      monday.setHours(0, 0, 0, 0)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      sunday.setHours(23, 59, 59, 999)

      const [profileRes, badgesRes, checkinsRes, totalRes, weeklyRes] = await Promise.all([
        supabase.from('users').select('id, display_name, email, current_streak, longest_streak, created_at, is_admin, pref_show_alcohol, notif_check_ins, notif_invites, notif_nudges, founding_number, lifetime_points, insider_tier').eq('id', uid).single(),
        supabase.from('user_badges').select('badge_id, earned_at, badge_definitions(id, name, icon, description)').eq('user_id', uid).order('earned_at', { ascending: false }).limit(6),
        supabase.from('check_ins').select('id, checked_at, checkin_method, list_items(items(body, categories(name, color_hex)))').eq('user_id', uid).order('checked_at', { ascending: false }).limit(5),
        supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        supabase.from('check_ins').select('id, points_awarded, list_items!inner(point_multiplier, items!inner(difficulty))')
          .eq('user_id', uid)
          .gte('checked_at', monday.toISOString())
          .lte('checked_at', sunday.toISOString()),
      ])

      setProfile(profileRes.data)
      setShowAlcohol(profileRes.data?.pref_show_alcohol !== false)
      setNotifCheckIns(profileRes.data?.notif_check_ins !== false)
      setNotifInvites(profileRes.data?.notif_invites !== false)
      setNotifNudges(profileRes.data?.notif_nudges !== false)
      setBadges((badgesRes.data ?? []).map(b => ({ ...b.badge_definitions, earned_at: b.earned_at })).filter(Boolean))
      setRecentCheckins(checkinsRes.data ?? [])
      setStats({ total: totalRes.count ?? 0, streak: profileRes.data?.current_streak ?? 0, longest: profileRes.data?.longest_streak ?? 0 })

      // Weekly summary for recap card — use points_awarded as source of truth;
      // fall back to inline calculation only if points_awarded is null on a row
      const weeklyRows = weeklyRes.data ?? []
      const weeklyPts = weeklyRows.reduce((sum, ci) => {
        const pts = ci.points_awarded ?? (() => {
          const d = ci.list_items?.items?.difficulty ?? null
          const m = ci.list_items?.point_multiplier ?? 1
          return d != null ? Math.round(d * m) : 0
        })()
        return sum + pts
      }, 0)
      setWeeklySummary({ count: weeklyRows.length, pts: weeklyPts })
    } catch (e) {
      Sentry.captureException(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
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
    {
      text: 'Sign out',
      style: 'destructive',
      onPress: async () => {
        Sentry.addBreadcrumb({ category: 'auth', message: 'signOut initiated', level: 'info' })
        try {
          await authSignOut()
          setUser(null)
          setProfile(null)
          navigation.getParent()?.navigate('HomeTab')
          Sentry.addBreadcrumb({ category: 'auth', message: 'signOut completed', level: 'info' })
        } catch (e) {
          Alert.alert(
            'Could not sign out',
            e?.message ?? 'Please try again.',
            [{ text: 'OK' }]
          )
        }
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

                      await authSignOut()
                      setUser(null)
                      setProfile(null)
                      navigation.getParent()?.navigate('HomeTab')
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

  // Detect Apple private relay gibberish names like "2rj2v78vyn"
  function isGibberishName(p) {
    if (!p?.email?.endsWith('@privaterelay.appleid.com')) return false
    const name = p?.display_name ?? ''
    // Real names contain spaces or mixed case. Relay IDs are long lowercase alphanumeric.
    return /^[a-z0-9]{8,}$/.test(name)
  }

  function promptSetName() {
    Alert.prompt(
      'Set your display name',
      'This is how you appear on leaderboards and to your crew.',
      async (name) => {
        const trimmed = name?.trim()
        if (!trimmed) return
        const { error } = await supabase
          .from('users')
          .update({ display_name: trimmed })
          .eq('id', user.id)
        if (error) {
          Alert.alert('Could not update name', error.message)
        } else {
          load()
        }
      },
      'plain-text',
      '',
      'default'
    )
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

  const nameIsGibberish = isGibberishName(profile)
  const displayName = nameIsGibberish
    ? 'Tap to set your name'
    : (profile?.display_name || profile?.email?.split('@')[0] || 'CheckOffer')
  const initials    = nameIsGibberish ? '?' : displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
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
        <TouchableOpacity onPress={promptSetName} activeOpacity={0.7}>
          <Text style={[styles.displayName, nameIsGibberish && { color: AMBER, fontSize: 16 }]}>
            {displayName}
          </Text>
        </TouchableOpacity>
        <Text style={styles.email}>{profile?.email}</Text>
        <Text style={styles.memberSince}>Member since {memberSince(profile?.created_at)}</Text>
        {profile?.founding_number != null && (
          <View style={styles.foundingBadge}>
            <Text style={styles.foundingBadgeText}>⭐ Founding Member #{profile.founding_number}</Text>
          </View>
        )}
        {profile?.is_admin && (
          <View style={styles.adminBadge}><Text style={styles.adminBadgeText}>⚙ Admin</Text></View>
        )}
        {/* Tier badge pill */}
        {(() => {
          const tierName = profile?.insider_tier ?? 'Starter'
          const tier = getTierByName(tierName)
          const next = getNextTier(tierName)
          const pts = profile?.lifetime_points ?? 0
          const progress = getTierProgress(tierName, pts)
          const ptsNeeded = next ? next.minPoints - pts : 0
          return (
            <>
              <View style={[styles.tierPill, { backgroundColor: tier.bg, marginTop: 10 }]}>
                <Text style={[styles.tierPillText, { color: tier.text }]}>{tierName.toUpperCase()}</Text>
              </View>
              <View style={styles.tierBarWrap}>
                <View style={[styles.tierBarFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: '#F5A623' }]} />
              </View>
              <Text style={styles.tierBarLabel}>
                {next
                  ? `${pts} pts · ${ptsNeeded} pts to ${next.name}`
                  : `${pts} pts · Legend — you're at the top`}
              </Text>
              <TouchableOpacity
                style={styles.tierShareBtn}
                onPress={async () => {
                  try {
                    await Share.share({ message: `I'm a ${tierName} on CheckOff.\nStop saying "I don't know what to do."\ngetcheckoff.com` })
                  } catch { /* user cancelled */ }
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.tierShareBtnText}>Share my status</Text>
              </TouchableOpacity>
            </>
          )
        })()}
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { num: stats?.total ?? 0,   label: 'check-ins', onPress: null },
          { num: hasStreak ? `${stats.streak} 🔥` : '0', label: 'week streak', color: hasStreak ? RED : undefined, onPress: null },
          { num: stats?.longest ?? 0, label: 'best streak', onPress: null },
          { num: profile?.lifetime_points ?? 0, label: 'lifetime pts', onPress: () => navigation.navigate('Badges') },
        ].map((s, i) => (
          <TouchableOpacity key={i} style={styles.statCard} onPress={s.onPress ?? undefined} activeOpacity={s.onPress ? 0.7 : 1}>
            <Text style={[styles.statNum, s.color && { color: s.color }]}>{s.num}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </TouchableOpacity>
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

      {/* Weekly Recap */}
      {user && (
        <TouchableOpacity
          style={styles.weeklyRecapCard}
          onPress={() => navigation.navigate('WeeklyRecap')}
          activeOpacity={0.8}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.weeklyRecapTitle}>Weekly Recap</Text>
            {weeklySummary ? (
              <Text style={styles.weeklyRecapSub}>
                {weeklySummary.count} check-in{weeklySummary.count !== 1 ? 's' : ''} this week
                {weeklySummary.pts != null ? ` · ${weeklySummary.pts} pts` : ''}
              </Text>
            ) : (
              <Text style={styles.weeklyRecapSub}>See your week at a glance</Text>
            )}
          </View>
          <Text style={styles.weeklyRecapArrow}>→</Text>
        </TouchableOpacity>
      )}

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
      <StatusBar barStyle={STATUS_BAR} />

      <View style={styles.actionList}>
        <TouchableOpacity style={styles.actionRow} onPress={promptSetName}>
          <Text style={styles.actionIcon}>✏️</Text>
          <View style={styles.actionBody}>
            <Text style={styles.actionText}>Edit display name</Text>
            {nameIsGibberish && <Text style={[styles.actionSub, { color: AMBER }]}>Name needs to be set</Text>}
          </View>
          <Text style={styles.actionChevron}>›</Text>
        </TouchableOpacity>
        <View style={styles.actionDivider} />
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
          <Text style={styles.actionIcon}>{isDark ? '☀️' : '🌙'}</Text>
          <View style={styles.actionBody}>
            <Text style={styles.actionText}>Dark mode</Text>
            <Text style={styles.actionSub}>{isDark ? 'Currently on' : 'Currently off'}</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: BORDER, true: '#F0D29D' }}
            thumbColor={isDark ? AMBER : '#fff'}
            ios_backgroundColor={BORDER}
          />
        </View>
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

function createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, RED }) {
 return StyleSheet.create({
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
  foundingBadge:     { marginTop: 8, backgroundColor: SOFT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: '#F0D29D' },
  foundingBadgeText: { fontSize: 12, color: AMBER, fontWeight: '800' },

  tierPill:          { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 5 },
  tierPillText:      { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  tierBarWrap:       { marginTop: 8, width: '80%', height: 6, borderRadius: 3, backgroundColor: '#E6D8C7', overflow: 'hidden' },
  tierBarFill:       { height: 6, borderRadius: 3 },
  tierBarLabel:      { fontSize: 11, color: MUTED, fontWeight: '600', marginTop: 5, textAlign: 'center' },
  tierShareBtn:      { marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: AMBER, paddingVertical: 8, paddingHorizontal: 24 },
  tierShareBtnText:  { fontSize: 13, fontWeight: '700', color: AMBER },

  statsRow:          { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard:          { flex: 1, backgroundColor: CARD, borderRadius: 16, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  statNum:           { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 3 },
  statLabel:         { fontSize: 9, color: MUTED, textAlign: 'center', fontWeight: '700', lineHeight: 13 },

  streakCard:        { backgroundColor: SOFT, borderRadius: 14, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: BORDER },
  streakCardNeutral: { backgroundColor: SOFT_2, borderColor: BORDER },
  streakCardText:    { fontSize: 13, color: TEXT, lineHeight: 18, fontWeight: '600' },

  weeklyRecapCard:   { backgroundColor: CARD, borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'center' },
  weeklyRecapTitle:  { fontSize: 14, fontWeight: '700', color: TEXT, marginBottom: 3 },
  weeklyRecapSub:    { fontSize: 13, color: MUTED },
  weeklyRecapArrow:  { fontSize: 18, color: MUTED, marginLeft: 8 },

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

  dangerZone:        { borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 16, marginBottom: 16, backgroundColor: SOFT_2 },
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
 }) // end StyleSheet.create
} // end createStyles
