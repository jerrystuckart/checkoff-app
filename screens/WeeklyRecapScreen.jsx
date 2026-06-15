import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Share,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../lib/ThemeContext'
import { supabase } from '../lib/supabase'

function getWeekRange() {
  const now = new Date()
  const day = now.getDay() // 0 = Sun
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { weekStart: monday, weekEnd: sunday }
}

function formatDateRange(weekStart, weekEnd) {
  const opts = { month: 'short', day: 'numeric' }
  return `${weekStart.toLocaleDateString(undefined, opts)} – ${weekEnd.toLocaleDateString(undefined, opts)}`
}

export default function WeeklyRecapScreen({ navigation, route }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY } = colors

  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [checkIns, setCheckIns]     = useState([])
  const [totalPts, setTotalPts]     = useState(null) // null = unavailable
  const [streak, setStreak]         = useState(0)

  // Accept an optional weekStart param (ISO string) from the Monday modal.
  // If not provided, default to the current week.
  const { weekStart, weekEnd } = useMemo(() => {
    const paramStart = route?.params?.weekStart
    if (paramStart) {
      const monday = new Date(paramStart)
      monday.setHours(0, 0, 0, 0)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      sunday.setHours(23, 59, 59, 999)
      return { weekStart: monday, weekEnd: sunday }
    }
    return getWeekRange()
  }, [route?.params?.weekStart])

  const dateRange = formatDateRange(weekStart, weekEnd)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); setRefreshing(false); return }
      const uid = user.id

      const [checkInsRes, streakRes] = await Promise.all([
        supabase
          .from('check_ins')
          .select(`
            id,
            checked_at,
            photo_url,
            personal_place,
            personal_note,
            list_items!inner(
              point_multiplier,
              list_id,
              lists(title),
              items!inner(id, body, difficulty)
            )
          `)
          .eq('user_id', uid)
          .gte('checked_at', weekStart.toISOString())
          .lte('checked_at', weekEnd.toISOString())
          .order('checked_at', { ascending: false }),

        supabase
          .from('users')
          .select('current_streak')
          .eq('id', uid)
          .single(),
      ])

      const rawCheckIns = checkInsRes.data ?? []

      // Flatten and compute per-check-in points
      let pointsAvailable = true
      const flat = rawCheckIns.map(ci => {
        const li = ci.list_items
        const item = li?.items
        const difficulty = item?.difficulty ?? null
        const multiplier = li?.point_multiplier ?? 1.0
        let pts = null
        if (difficulty != null) {
          pts = Math.round(difficulty * multiplier)
        } else {
          pointsAvailable = false
        }
        return {
          id:            ci.id,
          checkedAt:     ci.checked_at,
          photoUrl:      ci.photo_url ?? null,
          personalPlace: ci.personal_place ?? null,
          personalNote:  ci.personal_note ?? null,
          body:          item?.body ?? '',
          listTitle:     li?.lists?.title ?? null,
          pts,
        }
      })

      // Sum weekly points
      if (pointsAvailable && flat.length > 0) {
        setTotalPts(flat.reduce((sum, ci) => sum + (ci.pts ?? 0), 0))
      } else if (!pointsAvailable) {
        console.warn('WeeklyRecapScreen: difficulty unavailable for some items, falling back to count only')
        setTotalPts(null)
      } else {
        setTotalPts(0)
      }

      setCheckIns(flat)
      setStreak(streakRes.data?.current_streak ?? 0)
    } catch (e) {
      console.error('WeeklyRecapScreen load error:', e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [])

  const styles = createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY })

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top + 60 }]}>
        <ActivityIndicator color={AMBER} size="large" />
      </View>
    )
  }

  const photos = checkIns.filter(ci => ci.photoUrl)
  const recentFive = checkIns.slice(0, 5)
  const isEmpty = checkIns.length === 0

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={AMBER} />
      }
    >
      {/* Header */}
      <Text style={styles.heading}>Your Week in CheckOff</Text>
      <Text style={styles.dateRange}>{dateRange}</Text>

      {isEmpty ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Nothing checked off yet this week.</Text>
          <Text style={styles.emptyTextSub}>Get out there.</Text>
        </View>
      ) : (
        <>
          {/* Stat row */}
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{checkIns.length}</Text>
              <Text style={styles.statLabel}>check-ins</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>
                {totalPts != null ? totalPts : checkIns.length}
              </Text>
              <Text style={styles.statLabel}>
                {totalPts != null ? 'points' : 'check-ins'}
              </Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statNum, streak > 0 && { color: AMBER }]}>
                {streak > 0 ? `${streak} 🔥` : '0'}
              </Text>
              <Text style={styles.statLabel}>week streak</Text>
            </View>
          </View>

          {/* This week */}
          <Text style={styles.sectionLabel}>This week</Text>
          <View style={styles.sectionCard}>
            {recentFive.map((ci, idx) => (
              <View
                key={ci.id}
                style={[styles.checkInRow, idx < recentFive.length - 1 && styles.checkInRowBorder]}
              >
                <Text style={styles.checkInBody}>{ci.body}</Text>
                {(ci.personalPlace || ci.personalNote) && (
                  <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
                    {ci.personalPlace}
                    {ci.personalNote
                      ? (ci.personalPlace ? ' · ' : '') + ci.personalNote
                      : ''}
                  </Text>
                )}
              </View>
            ))}
            {checkIns.length > 5 && (
              <Text style={styles.moreText}>+{checkIns.length - 5} more this week</Text>
            )}
          </View>

          {/* Photo strip */}
          {photos.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Photos</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoStrip}
              >
                {photos.map(ci => (
                  <Image
                    key={ci.id}
                    source={{ uri: ci.photoUrl }}
                    style={styles.photoThumb}
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>
            </>
          )}

          {/* Streak callout */}
          {streak > 0 && (
            <View style={styles.streakCallout}>
              <Text style={styles.streakCalloutText}>🔥 {streak}-week streak</Text>
            </View>
          )}

          {/* Share button */}
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={async () => {
              const parts = [`${checkIns.length} check-in${checkIns.length !== 1 ? 's' : ''}`]
              if (totalPts != null) parts.push(`${totalPts} points`)
              if (streak > 0) parts.push(`${streak} day streak`)
              const statsLine = parts.join(' · ')
              const msg = `My week in CheckOff 🔥\n${statsLine}\nStop saying "I don't know what to do."\ngetcheckoff.com`
              try {
                await Share.share({ message: msg })
              } catch { /* cancelled or unavailable */ }
            }}
          >
            <Text style={styles.shareBtnText}>Share my week ↗</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  )
}

function createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    content:   { paddingHorizontal: 20 },
    centered:  { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },

    heading:   { fontSize: 24, fontWeight: '800', color: TEXT, marginBottom: 4 },
    dateRange: { fontSize: 13, color: MUTED, marginBottom: 24 },

    statRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
    statCard: {
      flex: 1, backgroundColor: CARD, borderRadius: 16, padding: 14,
      alignItems: 'center', borderWidth: 1, borderColor: BORDER,
    },
    statNum:   { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 2 },
    statLabel: { fontSize: 11, color: MUTED, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },

    sectionLabel: { fontSize: 13, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },

    sectionCard: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 24, overflow: 'hidden' },
    checkInRow: { paddingHorizontal: 16, paddingVertical: 12 },
    checkInRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
    checkInBody: { fontSize: 14, fontWeight: '600', color: TEXT, lineHeight: 20 },
    moreText: { fontSize: 12, color: MUTED, textAlign: 'center', paddingVertical: 10 },

    photoStrip: { paddingBottom: 4, gap: 8, marginBottom: 24 },
    photoThumb: { width: 120, height: 90, borderRadius: 10 },

    streakCallout: {
      backgroundColor: SOFT, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16,
      borderWidth: 1, borderColor: BORDER, marginBottom: 20, alignItems: 'center',
    },
    streakCalloutText: { fontSize: 18, fontWeight: '700', color: AMBER },

    shareBtn: {
      backgroundColor: AMBER, borderRadius: 14, paddingVertical: 16,
      alignItems: 'center', marginTop: 4,
    },
    shareBtnText: { fontSize: 15, fontWeight: '700', color: NAVY },

    emptyCard: {
      marginTop: 60, alignItems: 'center',
    },
    emptyText:    { fontSize: 17, fontWeight: '700', color: TEXT, textAlign: 'center', marginBottom: 6 },
    emptyTextSub: { fontSize: 14, color: MUTED, textAlign: 'center' },
  })
}
