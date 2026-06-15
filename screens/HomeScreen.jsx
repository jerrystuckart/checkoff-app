import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar, ActivityIndicator, Alert,
  RefreshControl, Modal, ImageBackground,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { LinearGradient } from 'expo-linear-gradient'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { fetchCuratedLists } from '../lib/useItems'
import { useCrewInvite } from '../lib/useCrewInvite'
import { useTheme } from '../lib/ThemeContext'
import ExperiencesRail from '../components/ExperiencesRail'
import * as Sentry from '@sentry/react-native'

const PURPLE = '#7A4DB3'
const LIST_ACCENT_COLORS = ['#F5A623', '#7A4DB3', '#2E7D8C', '#2E6B3E', '#C0674A', '#378ADD']

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const { colors, isDark, toggleTheme } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, RED,
          SUCCESS_BG, SUCCESS_BORDER, ENDED_BG, ENDED_BORDER, ENDED_TEXT, CARD_URGENT, STATUS_BAR } = colors

  const styles = useMemo(() => createStyles({
    BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN,
    SUCCESS_BG, SUCCESS_BORDER, ENDED_BG, ENDED_BORDER, ENDED_TEXT, CARD_URGENT,
  }), [BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN,
       SUCCESS_BG, SUCCESS_BORDER, ENDED_BG, ENDED_BORDER, ENDED_TEXT, CARD_URGENT])

  const [metros, setMetros] = useState([])
  const [selectedMetro, setSelectedMetro] = useState(null)
  const [season, setSeason] = useState(null)

  const [lists, setLists] = useState([])
  const [officialLists, setOfficialLists] = useState([])

  const [joinedIds, setJoinedIds] = useState(new Set())
  const [user, setUser] = useState(null)
  const [curatedGroups, setCuratedGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [listMemberMap, setListMemberMap] = useState({})
  const [userStreak, setUserStreak] = useState(0)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [nextTenList, setNextTenList] = useState(null)
  const [nextTenDismissed, setNextTenDismissed] = useState(false)
  const [heroImage, setHeroImage] = useState(null)
  const [recapModal, setRecapModal] = useState(null) // { count, pts, streak, weekStartIso }

  const { savedCrew } = useCrewInvite()

  useEffect(() => {
    init()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      try {
        const authUser = session?.user ?? null
        setUser(authUser)
        if (selectedMetro) {
          loadForMetro(selectedMetro.id, authUser?.id, selectedMetro.slug)
        }
      } catch (e) {
        Sentry.captureException(e)
      }
    })
    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (selectedMetro) {
        loadForMetro(selectedMetro.id, user?.id, selectedMetro.slug)
      }
    })
    return unsubscribe
  }, [navigation, selectedMetro, user])

  // Check dismiss state whenever a new nextTenList loads (keyed by list id)
  useEffect(() => {
    if (!nextTenList) return
    const key = `next10_dismissed_${nextTenList.id}`
    AsyncStorage.getItem(key).then(val => {
      if (val === 'true') setNextTenDismissed(true)
    })
  }, [nextTenList?.id])

  async function init() {
    let authUser = null
    try {
      const { data } = await supabase.auth.getUser()
      authUser = data?.user ?? null
    } catch (e) {
      console.warn('HomeScreen getUser error:', e.message)
    }
    setUser(authUser)

    try {
      // Fetch metros and the Next 10 banner in parallel — banner never blocks the screen
      const [{ data: metroData }, { data: n10Data }] = await Promise.all([
        supabase
          .from('metro_areas')
          .select('id, name, state, slug')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('curated_lists')
          .select('id, title')
          .eq('audience_group', 'the-next-10')
          .eq('is_active', true)
          .maybeSingle(),
      ])

      setNextTenList(n10Data ?? null)
      setMetros(metroData ?? [])

      let defaultMetro = null
      try {
        const locationResult = await Promise.race([
          (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync()
            if (status !== 'granted') return null
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Low,
            })
            return pos.coords.latitude
          })(),
          new Promise(resolve => setTimeout(() => resolve(null), 3000)),
        ])

        if (locationResult !== null) {
          defaultMetro = locationResult < 37
            ? (metroData ?? []).find(m => m.name.includes('Phoenix'))
            : (metroData ?? []).find(m => m.name.includes('Milwaukee'))
        }
      } catch (e) {
        /* GPS optional */
      }

      if (!defaultMetro) {
        defaultMetro = (metroData ?? []).find(m => m.name.includes('Phoenix')) ?? metroData?.[0]
      }

      if (defaultMetro) {
        setSelectedMetro(defaultMetro)
        await loadForMetro(defaultMetro.id, authUser?.id, defaultMetro.slug)
      }
    } catch (e) {
      console.warn('HomeScreen init error:', e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadForMetro(metroId, userId, citySlug) {
  // Derive slug from the currently selected metro if not passed explicitly
  // so Milwaukee (or any future city) always gets the correct slug
  const slug = citySlug
    ?? selectedMetro?.slug
    ?? selectedMetro?.name?.toLowerCase().replace(/\s+metro/i, '').trim()
    ?? 'phoenix'
  try {
    const today = new Date().toISOString().split('T')[0]

    // .maybeSingle() never throws — returns null if no season matches
    const { data: seasonData } = await supabase
      .from('seasons')
      .select('*')
      .lte('starts_at', today)
      .gte('ends_at', today)
      .maybeSingle()                          // ← was .single()

    setSeason(seasonData)

    const { data: metroImg } = await supabase
      .from('metro_areas')
      .select('hero_images')
      .eq('id', metroId)
      .maybeSingle()
    const imgs = metroImg?.hero_images ?? []
    setHeroImage(imgs.length > 0 ? imgs[Math.floor(Math.random() * imgs.length)] : null)

    const { data: offLists } = await supabase
      .from('lists')
      .select('id, title, starts_at, ends_at, cover_emoji, metro_id')
      .eq('is_official', true)
      .eq('is_public', true)
      .eq('metro_id', metroId)
      .order('created_at', { ascending: false })

    setOfficialLists(offLists ?? [])

    const { data: curatedData } = await fetchCuratedLists(slug)
    setCuratedGroups((curatedData ?? []).slice(0, 6))

    if (userId) {
      const { data: memberLists } = await supabase
        .from('list_members')
        .select('lists(id, title, starts_at, ends_at, is_public, is_official, creator_id, cover_emoji)')
        .eq('user_id', userId)

      const all = (memberLists ?? []).map(m => m.lists).filter(Boolean)
      const joinedSet = new Set(all.filter(l => l.is_official).map(l => l.id))
      setJoinedIds(joinedSet)
      const userLists = all.filter(l => !l.is_official)

      // Fetch streak in parallel with member map
      const [memberships, streakRes] = await Promise.all([
        userLists.length > 0
          ? supabase
              .from('list_members')
              .select('list_id, user_id, users(id, display_name)')
              .in('list_id', userLists.map(l => l.id))
              .neq('user_id', userId)
          : Promise.resolve({ data: [] }),
        supabase
          .from('users')
          .select('current_streak')
          .eq('id', userId)
          .single(),
      ])

      setUserStreak(streakRes.data?.current_streak ?? 0)

      // Load crew members for each list (up to 4 avatars per list)
      if (userLists.length > 0) {
        const memberMap = {}
        const memberCountMap = {}
        ;(memberships.data ?? []).forEach(m => {
          memberCountMap[m.list_id] = (memberCountMap[m.list_id] ?? 0) + 1
          if (!memberMap[m.list_id]) memberMap[m.list_id] = []
          if (memberMap[m.list_id].length < 4) {
            memberMap[m.list_id].push({
              id:      m.user_id,
              initial: (m.users?.display_name ?? '?')[0].toUpperCase(),
            })
          }
        })
        setListMemberMap(memberMap)
        setLists(userLists.map(l => ({ ...l, memberCount: (memberCountMap[l.id] ?? 0) + 1 })))
      } else {
        setLists([])
      }
    } else {
      setJoinedIds(new Set())
      setLists([])
      setListMemberMap({})
      setUserStreak(0)
    }
  } catch (e) {
    // ← Silent fail
  }
}

  async function joinOfficialList(list) {
  if (!user) {
    Alert.alert('Sign in first', 'You need an account to join a list.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
    ])
    return
  }

  // Check if already a member before inserting
  const { data: existing } = await supabase
    .from('list_members')
    .select('id')
    .eq('list_id', list.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    // Already a member — just navigate to the list
    navigation.navigate('List', { listId: list.id, title: list.title, heroImage: heroImage ?? undefined })
    return
  }

  const { error } = await supabase
    .from('list_members')
    .insert({
      list_id:      list.id,
      user_id:      user.id,
      invite_source: 'direct',
    })

  if (error) {
    Alert.alert('Could not join', error.message)
    return
  }

  Alert.alert(
    '🎯 Quick tip',
    "CheckOff is about going places — not counting places you've already been. Pick a few items you haven't done yet and go make it happen.",
    [{ text: "Let's go →", onPress: () => navigation.navigate('List', { listId: list.id, title: list.title, heroImage: heroImage ?? undefined }) }]
  )
}

  async function deleteList(list) {
    const { count } = await supabase
      .from('list_members')
      .select('*', { count: 'exact', head: true })
      .eq('list_id', list.id)

    const memberCount = count ?? 1
    const message = memberCount > 1
      ? `Delete this list? This will remove it for all ${memberCount} members and cannot be undone.`
      : 'Delete this list? This cannot be undone.'

    Alert.alert(
      'Delete list?',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('lists')
              .delete()
              .eq('id', list.id)
              .eq('creator_id', user?.id)

            if (error) {
              Alert.alert('Could not delete', error.message)
            } else {
              setLists(prev => prev.filter(l => l.id !== list.id))
            }
          },
        },
      ]
    )
  }

  async function leaveList(list) {
    if (!user?.id) return
    Alert.alert(
      'Leave list?',
      'You can rejoin using the original invite link.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('list_members')
              .delete()
              .eq('list_id', list.id)
              .eq('user_id', user.id)

            if (error) {
              Alert.alert('Could not leave', error.message)
            } else {
              setLists(prev => prev.filter(l => l.id !== list.id))
            }
          },
        },
      ]
    )
  }

  async function switchMetro(metro) {
    setSelectedMetro(metro)
    await loadForMetro(metro.id, user?.id, metro.slug)
  }

  async function handleNext10Dismiss() {
    if (!nextTenList) return
    const key = `next10_dismissed_${nextTenList.id}`
    await AsyncStorage.setItem(key, 'true')
    setNextTenDismissed(true)
  }

  // Live tick so countdowns re-render every minute
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  // Monday recap trigger — fires once on mount, entirely fire-and-forget
  useEffect(() => {
    async function checkMondayRecap() {
      try {
        // Only run on Monday (local time)
        if (new Date().getDay() !== 1) return

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const uid = user.id

        // Last week: Monday 00:00 → Sunday 23:59 local time
        const now = new Date()
        const lastMonday = new Date(now)
        lastMonday.setDate(now.getDate() - 7)
        lastMonday.setHours(0, 0, 0, 0)
        const lastSunday = new Date(lastMonday)
        lastSunday.setDate(lastMonday.getDate() + 6)
        lastSunday.setHours(23, 59, 59, 999)
        const weekStartDate = lastMonday.toISOString().split('T')[0]

        // Check if already viewed or dismissed this recap
        const { data: existing } = await supabase
          .from('user_recap_views')
          .select('id')
          .eq('user_id', uid)
          .eq('recap_week_start', weekStartDate)
          .maybeSingle()
        if (existing) return

        // Check for check-ins last week
        const { data: lastWeekCIs } = await supabase
          .from('check_ins')
          .select('id, list_items!inner(point_multiplier, items!inner(difficulty))')
          .eq('user_id', uid)
          .gte('checked_at', lastMonday.toISOString())
          .lte('checked_at', lastSunday.toISOString())
        if (!lastWeekCIs?.length) return

        // Compute summary stats
        let pts = null
        try {
          pts = lastWeekCIs.reduce((sum, ci) => {
            const d = ci.list_items?.items?.difficulty ?? null
            const m = ci.list_items?.point_multiplier ?? 1
            return d != null ? sum + Math.round(d * m) : sum
          }, 0)
        } catch { pts = null }

        const { data: streakRow } = await supabase
          .from('users')
          .select('current_streak')
          .eq('id', uid)
          .single()
        const streakVal = streakRow?.current_streak ?? 0

        // Mark as viewed
        await supabase.from('user_recap_views').insert({
          user_id:           uid,
          recap_week_start:  weekStartDate,
          viewed_at:         new Date().toISOString(),
        })

        // Show modal after short delay so home screen renders first
        setTimeout(() => {
          setRecapModal({
            count:        lastWeekCIs.length,
            pts,
            streak:       streakVal,
            weekStartIso: lastMonday.toISOString(),
            viewRowWeekStart: weekStartDate,
            uid,
          })
        }, 500)
      } catch {
        // Fail silently — never block app load
      }
    }
    checkMondayRecap()
  }, []) // eslint-disable-line

  // Calendar-day comparison — how many full days remain including the end date itself
  function calDaysLeft(endsAt) {
    if (!endsAt) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const end   = new Date(`${endsAt}T00:00:00`); end.setHours(0, 0, 0, 0)
    return Math.round((end - today) / (1000 * 60 * 60 * 24))
  }

  // Returns a formatted time-left string; null if ended
  function timeLeft(endsAt) {
    if (!endsAt) return null
    const days = calDaysLeft(endsAt)
    if (days < 0) return null
    if (days === 0) {
      // Ending today — hour/minute countdown to end of day
      const endOfDay = new Date(`${endsAt}T23:59:59`)
      const msLeft   = endOfDay - new Date()
      if (msLeft <= 0) return 'Ends tonight'
      const h = Math.floor(msLeft / 3600000)
      const m = Math.floor((msLeft % 3600000) / 60000)
      return h > 0 ? `${h}h ${m}m left` : `${m}m left`
    }
    if (days === 1) return '1 day left'
    return `${days} days left`
  }

  // True when a list is ending within N days (for highlighting)
  function isUrgent(endsAt, withinDays = 7) {
    if (!endsAt) return false
    const days = calDaysLeft(endsAt)
    return days !== null && days >= 0 && days <= withinDays
  }

  function isEnded(endsAt) {
    if (!endsAt) return false
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const end   = new Date(`${endsAt}T00:00:00`); end.setHours(0, 0, 0, 0)
    return end < today
  }

  function formatEndedDate(endsAt) {
    if (!endsAt) return 'Ended'
    const d = new Date(`${endsAt}T12:00:00`)
    return `Ended ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  }

  // Derived metro values — always computed from selectedMetro, never hardcoded
  const metroSlug = selectedMetro?.slug
    ?? selectedMetro?.name?.toLowerCase().replace(/\s+metro/i, '').trim()
    ?? 'phoenix'
  const metroDisplayName = selectedMetro?.name?.replace(' Metro', '') ?? 'Phoenix'

  const now = new Date()

  // Official lists bucketed into three states
  const activeOfficial = officialLists
    .filter(l => !isEnded(l.ends_at) && (!l.starts_at || new Date(`${l.starts_at}T12:00:00`) <= now))
    .sort((a, b) => new Date(a.ends_at || '9999-12-31') - new Date(b.ends_at || '9999-12-31'))

  const upcomingOfficial = officialLists
    .filter(l => l.starts_at && new Date(`${l.starts_at}T12:00:00`) > now)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))

  const endedOfficial = officialLists
    .filter(l => isEnded(l.ends_at))
    .sort((a, b) => new Date(b.ends_at) - new Date(a.ends_at))

  // Home shows at most 2 official lists: current (or most recently ended) + next upcoming
  const currentOnHome  = activeOfficial[0] ?? endedOfficial[0] ?? null
  const upcomingOnHome = upcomingOfficial[0] ?? null
  const homeOfficialLists = [currentOnHome, upcomingOnHome].filter(Boolean)
  const homeOfficialIds   = new Set(homeOfficialLists.map(l => l.id))

  // Past official = all ended ones not shown on home
  const pastOfficialLists = endedOfficial.filter(l => !homeOfficialIds.has(l.id))

  const activeLists     = lists.filter(l => !isEnded(l.ends_at))
  const endedLists      = lists.filter(l => isEnded(l.ends_at))
  const totalPastCount  = endedLists.length + pastOfficialLists.length

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={AMBER} size="large" />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ ...styles.content, paddingTop: insets.top + 12 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            if (selectedMetro) {
              setRefreshing(true)
              loadForMetro(selectedMetro.id, user?.id, selectedMetro.slug)
                .finally(() => setRefreshing(false))
            }
          }}
          tintColor={AMBER}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <StatusBar barStyle={STATUS_BAR} />

      <View style={styles.headerCard}>
        <View style={styles.headerTopRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText} allowFontScaling={false} numberOfLines={1}>
                {selectedMetro ? `${selectedMetro.name.replace(' Metro', '')}` : 'Your city'}
              </Text>
            </View>
            {season?.name ? (
              <View style={styles.seasonPill}>
                <Text style={styles.seasonPillText}>{season.name}</Text>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {user && (
              <TouchableOpacity
                onPress={() => navigation.navigate('WeeklyRecap')}
                style={styles.thisWeekBtn}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={styles.thisWeekBtnText}>✦ This Week</Text>
              </TouchableOpacity>
            )}
            {user && (
              <View style={[styles.streakPill, userStreak >= 4 && styles.streakPillActive]}>
                <Text style={[styles.streakPillText, userStreak >= 4 && styles.streakPillTextActive]} allowFontScaling={false}>
                  {userStreak >= 1 ? (userStreak + 'w 🔥') : 'No streak'}
                </Text>
              </View>
            )}
            <TouchableOpacity
              onPress={toggleTheme}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.themeToggle}
            >
              <Text style={styles.themeToggleIcon}>{isDark ? '☀️' : '🌙'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.logo} allowFontScaling={false} numberOfLines={1}>
          Check<Text style={styles.logoOff} allowFontScaling={false}>Off</Text>
        </Text>

        <Text style={styles.tagline} maxFontSizeMultiplier={1.2} numberOfLines={1}>
          Stop saying "I don't know what to do." Challenge your crew.
        </Text>
      </View>

      {/* ── The Next 10 Banner ── */}
      {nextTenList && !nextTenDismissed && (() => {
        const existingNext10 = lists.find(l => l.cover_emoji === '🔟')
        return (
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={() => {
              if (existingNext10) {
                // Already joined — go straight to the list, no duplicate creation
                navigation.navigate('List', {
                  listId: existingNext10.id,
                  title:  existingNext10.title || 'The Next 10',
                })
              } else {
                navigation.navigate('CuratedListPreview', {
                  listId:    nextTenList.id,
                  listTitle: nextTenList.title,
                  groupName: nextTenList.title,
                })
              }
            }}
            style={styles.next10Banner}
          >
            {/* Dismiss button — sibling to content, not a child, so taps don't bubble */}
            <TouchableOpacity
              onPress={handleNext10Dismiss}
              style={styles.next10Dismiss}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.next10DismissText}>✕</Text>
            </TouchableOpacity>

            <Text style={styles.next10BannerLabel}>🔟  THE NEXT 10</Text>
            <Text style={styles.next10BannerTitle} numberOfLines={2}>
              {nextTenList.title}
            </Text>
            {!!nextTenList.tagline && (
              <Text style={styles.next10BannerTagline}>{nextTenList.tagline}</Text>
            )}

            <View style={styles.next10BannerMeta}>
              <Text style={styles.next10BannerMetaText}>
                10 spots  ·  2 secret drops  ·  Drops Friday
              </Text>
            </View>

            <View style={styles.next10BannerCTA}>
              <Text style={styles.next10BannerCTAText}>
                {existingNext10 ? 'Go to the list  →' : 'See the list  →'}
              </Text>
            </View>
          </TouchableOpacity>
        )
      })()}

      <Text style={styles.sectionLabel}>City</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
        {metros.map(m => (
          <TouchableOpacity
            key={m.id}
            style={[styles.pill, selectedMetro?.id === m.id && styles.pillActive]}
            onPress={() => switchMetro(m)}
            activeOpacity={0.85}
          >
            <Text style={[styles.pillText, selectedMetro?.id === m.id && styles.pillTextActive]}>
              {m.name.replace(' Metro', '')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {homeOfficialLists.length > 0 && (
        <>
          <View style={styles.sectionHeaderBlock}>
            <Text style={styles.sectionLabel}>Seasonal lists</Text>
            <Text style={styles.sectionSub}>Join free and start checking things off</Text>
          </View>

          {homeOfficialLists.map(list => {
            const joined   = joinedIds.has(list.id)
            const ended    = isEnded(list.ends_at)
            const upcoming = !ended && list.starts_at && new Date(`${list.starts_at}T12:00:00`) > now

            if (ended) {
              return (
                <TouchableOpacity
                  key={list.id}
                  style={styles.endedOfficialCard}
                  onPress={() => navigation.navigate('List', { listId: list.id, title: list.title })}
                  activeOpacity={0.88}
                >
                  <View style={styles.endedOfficialLeft}>
                    <Text style={styles.officialEmoji}>{list.cover_emoji ?? '🏁'}</Text>
                  </View>
                  <View style={styles.officialCardBody}>
                    <Text style={styles.officialTitle}>{list.title}</Text>
                    <Text style={styles.endedMeta}>{formatEndedDate(list.ends_at)}</Text>
                  </View>
                  <View style={styles.endedBadge}>
                    <Text style={styles.endedBadgeText}>Results →</Text>
                  </View>
                </TouchableOpacity>
              )
            }

            if (upcoming) {
              return (
                <TouchableOpacity
                  key={list.id}
                  style={styles.upcomingOfficialCard}
                  onPress={() => joined
                    ? navigation.navigate('List', { listId: list.id, title: list.title })
                    : joinOfficialList(list)
                  }
                  activeOpacity={0.88}
                >
                  <View style={styles.upcomingOfficialLeft}>
                    <Text style={styles.officialEmoji}>{list.cover_emoji ?? '📋'}</Text>
                  </View>
                  <View style={styles.officialCardBody}>
                    <Text style={styles.officialTitle}>{list.title}</Text>
                    <Text style={styles.upcomingMeta}>
                      Starts {new Date(`${list.starts_at}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                  <View style={styles.upcomingBadge}>
                    <Text style={styles.upcomingBadgeText}>Coming soon</Text>
                  </View>
                </TouchableOpacity>
              )
            }

            return (
              <TouchableOpacity
                key={list.id}
                style={styles.heroCard}
                onPress={() => joined
                  ? navigation.navigate('List', { listId: list.id, title: list.title, heroImage: heroImage ?? undefined })
                  : joinOfficialList(list)
                }
                activeOpacity={0.92}
              >
                {heroImage ? (
                  <ImageBackground
                    source={{ uri: heroImage }}
                    style={styles.heroCardImageBg}
                    borderRadius={20}
                  >
                    <LinearGradient
                      colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.72)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={styles.heroCardGradient}
                    >
                      <Text style={styles.heroCardLabel}>SEASONAL LIST</Text>
                      <Text style={styles.heroCardTitle}>{list.title}</Text>
                      <View style={styles.heroCardPillRow}>
                        {list.ends_at && (
                          <View style={styles.heroCardPill}>
                            <Text style={styles.heroCardPillText}>{timeLeft(list.ends_at)}</Text>
                          </View>
                        )}
                        {/* TODO: item count */}
                      </View>
                    </LinearGradient>
                  </ImageBackground>
                ) : (
                  <LinearGradient
                    colors={[season?.gradient_start ?? '#1A1A2E', season?.gradient_end ?? '#2E1A4A']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.heroCardGradient}
                  >
                    <Text style={styles.heroCardLabel}>SEASONAL LIST</Text>
                    <Text style={styles.heroCardTitle}>{list.title}</Text>
                    <View style={styles.heroCardPillRow}>
                      {list.ends_at && (
                        <View style={styles.heroCardPill}>
                          <Text style={styles.heroCardPillText}>{timeLeft(list.ends_at)}</Text>
                        </View>
                      )}
                      {/* TODO: item count */}
                    </View>
                  </LinearGradient>
                )}

                <View style={styles.heroCardCTA}>
                  <Text style={styles.heroCardCTAText}>{joined ? 'Open List →' : 'Join Free →'}</Text>
                </View>
              </TouchableOpacity>
            )
          })}
        </>
      )}

      <ExperiencesRail citySlug={metroSlug} />

      {curatedGroups.length > 0 && (
  <>
    <View style={styles.sectionRow}>
      <View>
        <Text style={styles.sectionLabel}>Start from a template</Text>
        <Text style={styles.sectionSubSmall}>Lists built for your kind of crew</Text>
      </View>
      <TouchableOpacity
        onPress={() =>
          navigation.navigate('BrowseLists', {
            citySlug:  metroSlug,
            metroName: metroDisplayName,
          })
        }
        activeOpacity={0.8}
      >
        <Text style={styles.seeAllText}>See all →</Text>
      </TouchableOpacity>
    </View>

    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.groupScrollRow}
      contentContainerStyle={{ paddingRight: 20 }}
    >
      {curatedGroups.map(item => {
        const g = item.audience_groups
        if (!g) return null
        const hasImage = !!g.image_url
        const chipPress = () => navigation.navigate('CuratedListPreview', {
          curatedListId: item.id,
          groupName:     g.name,
          groupEmoji:    g.emoji,
          groupTagline:  g.tagline,
          groupImageUrl: g.image_url ?? undefined,
          citySlug:      metroSlug,
          metroName:     metroDisplayName,
        })

        if (hasImage) {
          return (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.88}
              onPress={chipPress}
              style={styles.groupChipImageWrap}
            >
              <ImageBackground
                source={{ uri: g.image_url }}
                style={styles.groupChipImageBg}
                imageStyle={{ borderRadius: 18 }}
              >
                <View style={styles.groupChipOverlay} />
                <Text style={styles.groupChipEmojiOnImg}>{g.emoji ?? '📋'}</Text>
                <Text style={styles.groupChipNameOnImg}>{g.name}</Text>
                <Text style={styles.groupChipTaglineOnImg} numberOfLines={2}>
                  "{g.tagline}"
                </Text>
              </ImageBackground>
            </TouchableOpacity>
          )
        }

        return (
          <TouchableOpacity
            key={item.id}
            style={styles.groupChip}
            activeOpacity={0.88}
            onPress={chipPress}
          >
            <Text style={styles.groupChipEmoji}>{g.emoji ?? '📋'}</Text>
            <Text style={styles.groupChipName}>{g.name}</Text>
            <Text style={styles.groupChipTagline} numberOfLines={2}>
              "{g.tagline}"
            </Text>
          </TouchableOpacity>
        )
      })}

      {/* "See all" card at end of scroll */}
      <TouchableOpacity
        style={styles.groupChipSeeAll}
        activeOpacity={0.88}
        onPress={() =>
          navigation.navigate('BrowseLists', {
            citySlug:  metroSlug,
            metroName: metroDisplayName,
          })
        }
      >
        <Text style={styles.groupChipSeeAllText}>See all →</Text>
      </TouchableOpacity>
    </ScrollView>
  </>
)}

      <View style={styles.sectionRow}>
        <View>
          <Text style={styles.sectionLabel}>Your lists</Text>
          <Text style={styles.sectionSubSmall}>Custom lists for your crew, dates, and plans</Text>
        </View>

        {user && (
          <TouchableOpacity
            style={styles.createNewBtn}
            onPress={() => navigation.navigate('CreateTab')}
            activeOpacity={0.85}
          >
            <Text style={styles.createNewBtnText}>+ New list</Text>
          </TouchableOpacity>
        )}
      </View>

      {activeLists.length === 0 ? (
        <TouchableOpacity
          style={styles.emptyListCard}
          onPress={() => {
            if (!user) {
              setShowSignInPrompt(true)
            } else {
              navigation.navigate('CreateList')
            }
          }}
          activeOpacity={0.88}
        >
          <Text style={styles.emptyListEmoji}>📋</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.emptyListTitle}>Start your first list</Text>
            <Text style={styles.emptyListSub}>
              Pick items, invite your crew, and see who checks off the most.
            </Text>
          </View>
          <Text style={styles.emptyListArrow}>→</Text>
        </TouchableOpacity>
      ) : (
        activeLists.map(list => {
          const crewMembers = listMemberMap[list.id] ?? []
          const accent = LIST_ACCENT_COLORS[list.id.charCodeAt(0) % 6]
          return (
          <TouchableOpacity
            key={list.id}
            style={[styles.listCard, isUrgent(list.ends_at) && styles.listCardUrgent]}
            onPress={() => navigation.navigate('List', { listId: list.id, title: list.title })}
            onLongPress={() => {
              if (list.creator_id === user?.id) {
                deleteList(list)
              } else {
                leaveList(list)
              }
            }}
            activeOpacity={0.85}
          >
            <View style={[styles.listAccent, { backgroundColor: accent, borderColor: accent }]} />

            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{list.title}</Text>
              <View style={styles.listMetaRow}>
                {list.ends_at ? (
                  <Text style={[styles.listMeta, isUrgent(list.ends_at) && styles.listMetaUrgent]}>
                    {timeLeft(list.ends_at)}
                  </Text>
                ) : (
                  <Text style={styles.listMeta}>Open-ended</Text>
                )}
                {crewMembers.length > 0 && (
                  <View style={styles.crewAvatarStack}>
                    {crewMembers.map(m => (
                      <View key={m.id} style={styles.crewAvatarMini}>
                        <Text style={styles.crewAvatarMiniText}>{m.initial}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <View style={styles.listCardRight}>
              {list.memberCount > 1 && (
                <TouchableOpacity
                  style={styles.addCrewBtn}
                  onPress={() => navigation.navigate('SavedCrew', { list })}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.addCrewBtnText}>+ Crew</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.listChevron}>→</Text>
            </View>
          </TouchableOpacity>
          )
        })
      )}

      {activeLists.length > 0 && (
        <Text style={styles.deleteHint}>Long-press a list to delete or leave it</Text>
      )}

      {totalPastCount > 0 && (
        <TouchableOpacity
          style={styles.pastListsBtn}
          onPress={() => navigation.navigate('PastLists', {
            userId:          user?.id ?? null,
            metroId:         selectedMetro?.id ?? null,
          })}
          activeOpacity={0.85}
        >
          <View style={styles.pastListAccent} />
          <Text style={styles.pastListsBtnText}>Past lists</Text>
          <View style={styles.pastListsBtnRight}>
            <Text style={styles.pastListsBtnCount}>{totalPastCount}</Text>
            <Text style={styles.pastListsBtnArrow}>→</Text>
          </View>
        </TouchableOpacity>
      )}

      {!user && (
        <TouchableOpacity
          style={styles.signInBanner}
          onPress={() => navigation.navigate('SignIn')}
          activeOpacity={0.88}
        >
          <Text style={styles.signInTitle}>Track progress and challenge friends</Text>
          <Text style={styles.signInText}>Sign in to save your lists, join seasonal lists, and compete with your crew →</Text>
        </TouchableOpacity>
      )}

      {/* Weekly recap teaser — shown on Mondays if user had check-ins last week */}
      <Modal
        visible={!!recapModal}
        transparent
        animationType="slide"
        onRequestClose={() => setRecapModal(null)}
      >
        <TouchableOpacity
          style={styles.signInModalOverlay}
          activeOpacity={1}
          onPress={() => setRecapModal(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.recapModalCard}>
            <Text style={styles.recapModalTitle}>Your week in CheckOff</Text>
            <Text style={styles.recapModalStats}>
              {recapModal
                ? [
                    `${recapModal.count} check-in${recapModal.count !== 1 ? 's' : ''}`,
                    recapModal.pts != null ? `${recapModal.pts} points` : null,
                    recapModal.streak > 0 ? `🔥 ${recapModal.streak} day streak` : null,
                  ].filter(Boolean).join(' · ')
                : ''}
            </Text>

            <TouchableOpacity
              style={styles.recapModalPrimary}
              onPress={() => {
                setRecapModal(null)
                navigation.navigate('WeeklyRecap', { weekStart: recapModal?.weekStartIso })
              }}
              activeOpacity={0.88}
            >
              <Text style={styles.recapModalPrimaryText}>View Recap</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.recapModalSecondary}
              onPress={async () => {
                setRecapModal(null)
                // Update the row to record dismissal — fire and forget
                try {
                  await supabase
                    .from('user_recap_views')
                    .update({ dismissed_at: new Date().toISOString() })
                    .eq('user_id', recapModal?.uid)
                    .eq('recap_week_start', recapModal?.viewRowWeekStart)
                } catch { /* non-critical */ }
              }}
            >
              <Text style={styles.recapModalSecondaryText}>Maybe Later</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Sign-in prompt modal — shown when unauthenticated user taps "Start your first list" */}
      <Modal
        visible={showSignInPrompt}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSignInPrompt(false)}
      >
        <TouchableOpacity
          style={styles.signInModalOverlay}
          activeOpacity={1}
          onPress={() => setShowSignInPrompt(false)}
        >
          <View style={styles.signInModalCard}>
            <Text style={styles.signInModalEmoji}>📋</Text>
            <Text style={styles.signInModalTitle}>Sign in to create a list</Text>
            <Text style={styles.signInModalSub}>
              Creating a list saves your progress, lets you invite your crew, and tracks who checks off the most. It only takes a second.
            </Text>

            <TouchableOpacity
              style={styles.signInModalBtn}
              onPress={() => {
                setShowSignInPrompt(false)
                navigation.navigate('SignIn')
              }}
              activeOpacity={0.88}
            >
              <Text style={styles.signInModalBtnText}>Sign in or create account</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.signInModalDismiss}
              onPress={() => setShowSignInPrompt(false)}
            >
              <Text style={styles.signInModalDismissText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  )
}

function createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, SUCCESS_BG, SUCCESS_BORDER, ENDED_BG, ENDED_BORDER, ENDED_TEXT, CARD_URGENT }) {
 return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  content: {
    padding: 20,
    paddingBottom: 40,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG,
  },

  // ── The Next 10 Banner ──
  next10Banner: {
    backgroundColor: NAVY,
    borderRadius: 16,
    marginBottom: 12,
    padding: 20,
    borderLeftWidth: 3,
    borderLeftColor: AMBER,
  },
  next10Dismiss: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  next10DismissText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 16,
  },
  next10BannerLabel: {
    color: AMBER,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  next10BannerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
    paddingRight: 28,
  },
  next10BannerTagline: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    marginTop: 4,
  },
  next10BannerMeta: {
    marginTop: 10,
  },
  next10BannerMetaText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },
  next10BannerCTA: {
    backgroundColor: AMBER,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  next10BannerCTAText: {
    color: NAVY,
    fontSize: 15,
    fontWeight: '700',
  },

  headerCard: {
    backgroundColor: CARD,
    borderRadius: 28,
    padding: 20,
    paddingBottom: 12,
    marginBottom: 24,
    borderWidth: 1.2,
    borderColor: BORDER,
  },

  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },

  thisWeekBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: BORDER,
  },
  thisWeekBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
  },

  streakPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F2EBE0',
    borderWidth: 1,
    borderColor: BORDER,
  },

  streakPillActive: {
    backgroundColor: '#FFF0D6',
    borderColor: '#F0C070',
  },

  streakPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: MUTED,
  },

  streakPillTextActive: {
    color: '#A16A00',
  },

  headerBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: SOFT_2,
    borderWidth: 1,
    borderColor: '#DED3C5',
  },

  headerBadgeText: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '800',
  },

  logo: {
    fontSize: 36,
    fontWeight: '900',
    color: AMBER,
    letterSpacing: -1,
    marginBottom: 6,
  },

  logoOff: {
    color: TEXT,
  },

  tagline: {
    fontSize: 14,
    color: MUTED,
    fontWeight: '400',
    marginTop: 6,
  },

  seasonPill: {
    backgroundColor: SOFT,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#E8C98E',
  },

  seasonPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#A16A00',
  },

  sectionHeaderBlock: {
    marginBottom: 10,
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: MUTED,
    textTransform: 'uppercase',
    marginTop: 2,
    marginBottom: 6,
  },

  sectionSub: {
    fontSize: 14,
    color: MUTED,
  },

  sectionSubSmall: {
    fontSize: 13,
    color: MUTED,
    marginTop: -2,
  },

  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 12,
    gap: 12,
  },

  pillRow: {
    marginBottom: 22,
    marginHorizontal: -4,
  },

  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    marginHorizontal: 4,
    backgroundColor: CARD,
  },

  pillActive: {
    backgroundColor: AMBER,
    borderColor: AMBER,
  },

  pillText: {
    fontSize: 13,
    color: TEXT,
    fontWeight: '700',
  },

  pillTextActive: {
    color: NAVY,
    fontWeight: '800',
  },

  heroCard: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 14,
  },

  heroCardImageBg: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
  },

  heroCardGradient: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
  },

  heroCardLabel: {
    color: AMBER,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    opacity: 0.85,
  },

  heroCardTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30,
    marginTop: 6,
  },

  heroCardPillRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },

  heroCardPill: {
    backgroundColor: 'rgba(245,166,35,0.18)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },

  heroCardPillText: {
    color: AMBER,
    fontSize: 12,
    fontWeight: '700',
  },

  heroCardCTA: {
    width: '100%',
    paddingVertical: 14,
    backgroundColor: AMBER,
    alignItems: 'center',
  },

  heroCardCTAText: {
    fontSize: 15,
    fontWeight: '800',
    color: NAVY,
  },

  officialCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.2,
    borderColor: '#F0D29D',
  },

  officialCardLeft: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F0D29D',
  },

  endedOfficialCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  endedOfficialLeft: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: ENDED_BG,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  officialEmoji: {
    fontSize: 24,
  },

  officialCardBody: {
    flex: 1,
  },

  officialTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
  },

  officialMeta: {
    fontSize: 12,
    color: MUTED,
    marginTop: 4,
    fontWeight: '600',
  },

  officialMetaUrgent: {
    color: AMBER,
    fontWeight: '800',
  },

  endedMeta: {
    fontSize: 12,
    color: ENDED_TEXT,
    marginTop: 4,
    fontWeight: '700',
  },

  joinBadge: {
    backgroundColor: AMBER,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  joinBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: NAVY,
  },

  joinBadgeJoined: {
    backgroundColor: SUCCESS_BG,
    borderWidth: 1,
    borderColor: SUCCESS_BORDER,
  },

  joinBadgeTextJoined: {
    color: GREEN,
  },

  endedBadge: {
    backgroundColor: ENDED_BG,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  endedBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: ENDED_TEXT,
  },

  listCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },

  listCardUrgent: {
    borderColor: 'rgba(245,166,35,0.5)',
    backgroundColor: CARD_URGENT,
  },

  listMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },

  crewAvatarStack: {
    flexDirection: 'row',
    gap: -6,
  },

  crewAvatarMini: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#F0D29D',
    marginRight: -6,
  },

  crewAvatarMiniText: {
    fontSize: 9, fontWeight: '800', color: '#A16A00',
  },

  listCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },

  addCrewBtn: {
    backgroundColor: SOFT,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#E8C98E',
  },

  addCrewBtnText: {
    fontSize: 11, fontWeight: '800', color: '#A16A00',
  },

  listAccent: {
    width: 8,
    alignSelf: 'stretch',
    borderRadius: 999,
    backgroundColor: SOFT,
    borderWidth: 1,
    borderColor: '#F0D29D',
  },

  pastListsBtn: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: ENDED_BORDER,
    gap: 12,
  },

  pastListsBtnText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
  },

  pastListsBtnRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  pastListsBtnCount: {
    fontSize: 13,
    fontWeight: '800',
    color: ENDED_TEXT,
    backgroundColor: ENDED_BG,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
    overflow: 'hidden',
  },

  pastListsBtnArrow: {
    fontSize: 17,
    color: MUTED,
    fontWeight: '700',
  },

  upcomingOfficialCard: {
    backgroundColor: '#F0F7FF',
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#C8DDF5',
  },

  upcomingOfficialLeft: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#DFF0FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#C8DDF5',
  },

  upcomingMeta: {
    fontSize: 12,
    color: '#378ADD',
    fontWeight: '700',
    marginTop: 2,
  },

  upcomingBadge: {
    backgroundColor: '#DFF0FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#C8DDF5',
  },

  upcomingBadgeText: {
    fontSize: 11,
    color: '#378ADD',
    fontWeight: '800',
  },

  pastListCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: ENDED_BORDER,
    gap: 12,
  },

  pastListAccent: {
    width: 8,
    alignSelf: 'stretch',
    borderRadius: 999,
    backgroundColor: ENDED_BG,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  pastListBadge: {
    backgroundColor: ENDED_BG,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  pastListBadgeText: {
    fontSize: 11,
    color: ENDED_TEXT,
    fontWeight: '800',
  },

  listTitle: {
    fontSize: 15,
    color: TEXT,
    fontWeight: '800',
    flex: 1,
  },

  listMeta: {
    fontSize: 12,
    color: MUTED,
    marginTop: 4,
    fontWeight: '600',
  },

  listMetaUrgent: {
    color: AMBER,
    fontWeight: '800',
  },

  listChevron: {
    fontSize: 17,
    color: MUTED,
    fontWeight: '700',
  },

  deleteHint: {
    fontSize: 12,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 8,
    fontWeight: '600',
  },

  emptyCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },

  emptyListCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: AMBER,
    backgroundColor: SOFT,
  },
  emptyListEmoji:  { fontSize: 28 },
  emptyListTitle:  { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 3 },
  emptyListSub:    { fontSize: 12, color: MUTED, lineHeight: 17, fontWeight: '500' },
  emptyListArrow:  { fontSize: 18, color: AMBER, fontWeight: '800' },

  emptyTitle: {
    fontSize: 16,
    color: TEXT,
    fontWeight: '800',
    marginBottom: 8,
  },

  emptySub: {
    fontSize: 14,
    color: MUTED,
    lineHeight: 20,
  },

  createNewBtn: {
    backgroundColor: SOFT,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E8C98E',
  },

  createNewBtnText: {
    fontSize: 14,
    color: '#A16A00',
    fontWeight: '800',
  },

  signInBanner: {
    backgroundColor: SUCCESS_BG,
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: SUCCESS_BORDER,
  },

  signInTitle: {
    fontSize: 15,
    color: GREEN,
    fontWeight: '800',
    marginBottom: 6,
  },

  signInText: {
    fontSize: 13,
    color: '#287A5F',
    lineHeight: 19,
    fontWeight: '600',
  },

  signInModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  signInModalCard: {
    backgroundColor: CARD,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 40,
    alignItems: 'center',
  },
  signInModalEmoji:       { fontSize: 40, marginBottom: 16 },
  signInModalTitle:       { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 10, textAlign: 'center' },
  signInModalSub:         { fontSize: 14, color: MUTED, lineHeight: 21, textAlign: 'center', marginBottom: 28, paddingHorizontal: 8 },
  signInModalBtn:         { backgroundColor: AMBER, borderRadius: 16, paddingVertical: 17, paddingHorizontal: 32, alignItems: 'center', width: '100%', marginBottom: 12 },
  signInModalBtnText:     { fontSize: 15, fontWeight: '800', color: NAVY },
  signInModalDismiss:     { paddingVertical: 10 },
  signInModalDismissText: { fontSize: 14, color: MUTED, fontWeight: '600' },

  recapModalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 40,
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#E6D8C7',
  },
  recapModalTitle:         { fontSize: 20, fontWeight: '800', color: '#243045', marginBottom: 8, textAlign: 'center' },
  recapModalStats:         { fontSize: 14, color: '#6F7785', textAlign: 'center', marginBottom: 28, lineHeight: 20 },
  recapModalPrimary:       { backgroundColor: '#F5A623', borderRadius: 16, paddingVertical: 17, paddingHorizontal: 32, alignItems: 'center', width: '100%', marginBottom: 12 },
  recapModalPrimaryText:   { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  recapModalSecondary:     { paddingVertical: 10 },
  recapModalSecondaryText: { fontSize: 14, color: '#6F7785', fontWeight: '600' },

  seeAllText: {
    fontSize: 13,
    fontWeight: '800',
    color: AMBER,
  },

  groupScrollRow: {
    marginHorizontal: -20,
    paddingLeft: 20,
    marginBottom: 24,
  },

  groupChip: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 14,
    width: 160,
    marginRight: 10,
    borderWidth: 1.2,
    borderColor: BORDER,
    gap: 6,
  },

  groupChipEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },

  groupChipName: {
    fontSize: 13,
    fontWeight: '900',
    color: TEXT,
    lineHeight: 18,
  },

  groupChipTagline: {
    fontSize: 11,
    color: MUTED,
    fontStyle: 'italic',
    lineHeight: 15,
  },

  groupChipImageWrap: {
    marginRight: 10,
    borderRadius: 18,
    overflow: 'hidden',
    width: 160,
  },

  groupChipImageBg: {
    width: 160,
    minHeight: 140,
    padding: 14,
    justifyContent: 'flex-end',
    gap: 4,
  },

  groupChipOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 18,
  },

  groupChipEmojiOnImg: {
    fontSize: 28,
    marginBottom: 4,
  },

  groupChipNameOnImg: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
    lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  groupChipTaglineOnImg: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.9)',
    fontStyle: 'italic',
    lineHeight: 15,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  groupChipSeeAll: {
    backgroundColor: SOFT,
    borderRadius: 18,
    padding: 14,
    width: 100,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E8C98E',
  },

  groupChipSeeAllText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#A16A00',
  },

  themeToggle: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },

  themeToggleIcon: {
    fontSize: 16,
  },
 }) // end StyleSheet.create
} // end createStyles