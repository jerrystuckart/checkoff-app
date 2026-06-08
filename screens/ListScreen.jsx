import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'

import { useFocusEffect } from '@react-navigation/native'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Animated,
  Alert,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { useItems } from '../lib/useItems'
import { useLeaderboard } from '../lib/useLeaderboard'
import { supabase } from '../lib/supabase'
import { SafeAreaView } from 'react-native-safe-area-context'
import { notifyCrewCheckIn } from '../lib/notifyCrewCheckIn'
import { consumePendingCheckIn } from '../lib/checkInResult'
import { pollForNewBadges } from '../lib/badges'
import SuggestPlaceSheet from './SuggestPlaceSheet'
import BadgeCelebrationModal from '../components/BadgeCelebrationModal'
import { useTheme } from '../lib/ThemeContext'

const ACCENT = '#FFB84D'
const ACCENT_DARK = '#7A4B00'
// Colors now come from ThemeContext — see useTheme() inside the component
const ENDED_BG = '#F4EEF9'
const ENDED_BORDER = '#DCCCED'
const ENDED_TEXT = '#7A4DB3'

// Difficulty tier config — mirrors admin DIFFICULTY_TIERS
const DIFFICULTY_LABELS = { 5: 'Partner', 10: 'Rare', 25: 'Legend' }
const DIFFICULTY_COLORS = {
  5:  { bg: '#EBF4FF', border: '#BFDBFE', text: '#1E4A8A' },  // blue — partner
  10: { bg: '#FFF7E6', border: '#FDDCAA', text: '#92400E' },  // amber — rare
  25: { bg: '#F3EEFF', border: '#DDD0FC', text: '#5B21B6' },  // purple — legend
}


export default function ListScreen({ route, navigation }) {
  const { listId, cityId, title } = route.params ?? {}
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY } = colors
  const styles = useMemo(() => createListStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY])

  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [showChecked, setShowChecked] = useState(true)
  const [listMeta, setListMeta] = useState(null)
  const [metaLoading, setMetaLoading] = useState(false)
  const [listDeleted, setListDeleted] = useState(false)

  const {
    items,
    loading,
    checkOff,
  } = useItems(listId)

  // Leaderboard entries used to compute user's rank for the summary screen
  const { entries: lbEntries } = useLeaderboard(listId)
  const [currentUserId, setCurrentUserId] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data?.user?.id ?? null)
    })
  }, [])

  const [localItems, setLocalItems] = useState([])
  const [refreshingChecks, setRefreshingChecks] = useState(false)

  const [cityItems, setCityItems] = useState([])
  const [cityLoading, setCityLoading] = useState(false)

  // User suggestions for this list
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestSheet, setShowSuggestSheet] = useState(false)

  // Celebration flash — tracks which listItemId is currently celebrating
  const [celebratingId, setCelebratingId] = useState(null)
  const flashAnim = useRef(new Animated.Value(0)).current

  // Badge celebration modal
  const [celebrationBadges, setCelebrationBadges] = useState([])

  // Tick every minute so hour/minute countdown updates in real time
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  // Track whether we've already navigated to the summary this session
  // so it fires exactly once per list open, not on every re-render
  const summarySentRef    = useRef(false)
  const hasInitializedRef = useRef(false)
  const checkOffInFlight  = useRef(false)  // prevents refreshCheckedState overwriting during a check-off

  useEffect(() => {
    // Only sync items→localItems on the very first load.
    // After that, localItems is the source of truth for UI.
    // useItems.checkOff manages its own internal state in parallel.
    // Overwriting localItems on every items change causes the double-optimistic
    // update conflict where check-offs appear to revert.
    if (listId && items?.length > 0 && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      setLocalItems(items)
    }
  }, [listId, items])

  // Trigger summary when user checks off the LAST item (100% complete)
  useEffect(() => {
    if (
      listId &&
      derivedTotalCount > 0 &&
      derivedCheckedCount === derivedTotalCount &&
      !ended &&
      currentUserId
    ) {
      navigateToSummary(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedCheckedCount, derivedTotalCount])

  // Trigger summary when opening a RECENTLY ended list (within 7 days)
  // Lists that ended longer ago just show the ended banner -- no surprise redirect
  useEffect(() => {
    if (!listId || !ended || loading || !currentUserId || derivedTotalCount === 0) return

    const endsAt = listMeta?.ends_at
    if (!endsAt) return

    const daysSinceEnd = (Date.now() - new Date(`${endsAt}T12:00:00`).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceEnd <= 7) {
      navigateToSummary(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, loading, currentUserId])

  useEffect(() => {
    if (!listId && cityId) {
      loadCityItems()
    }
  }, [listId, cityId])

  useEffect(() => {
    if (listId) {
      // Reset init flag when navigating to a different list
      hasInitializedRef.current = false
      loadListMeta()
    }
  }, [listId])

  const loadSuggestions = useCallback(async () => {
    if (!listId) return
    const { data } = await supabase
      .from('user_suggestion_list_items')
      .select('id, user_id, checked, checked_at, user_suggestions(place_name, experience_body, website_url)')
      .eq('list_id', listId)
      .order('created_at', { ascending: true })
    setSuggestions(data ?? [])
  }, [listId])

  const handleSuggestionCheckOff = useCallback(async (suggestionItemId, currentChecked, ownerId) => {
    // Only the user who submitted the suggestion can check it off
    if (ownerId !== currentUserId) return
    const now = new Date().toISOString()
    // Optimistic update
    setSuggestions(prev => prev.map(s =>
      s.id === suggestionItemId
        ? { ...s, checked: !currentChecked, checked_at: !currentChecked ? now : null }
        : s
    ))
    await supabase
      .from('user_suggestion_list_items')
      .update({ checked: !currentChecked, checked_at: !currentChecked ? now : null })
      .eq('id', suggestionItemId)
  }, [currentUserId])

  const loadListMeta = useCallback(async () => {
    if (!listId) return
    setMetaLoading(true)

    const { data, error } = await supabase
      .from('lists')
      .select('id, title, starts_at, ends_at, is_official')
      .eq('id', listId)
      .maybeSingle()

    if (!data && !error) {
      // List exists in navigation but not in DB — creator deleted it
      setListDeleted(true)
    } else {
      setListMeta(data ?? null)
    }
    setMetaLoading(false)
  }, [listId])

  const loadCityItems = useCallback(async () => {
    if (!cityId) return

    setCityLoading(true)

    const { data } = await supabase
      .from('items')
      .select('id, body, checkin_type, is_universal, difficulty, photo_required, categories(name, color_hex)')
      .eq('is_active', true)
      .eq('is_approved', true)
      .or(`city_id.eq.${cityId},is_universal.eq.true`)
      .order('is_universal', { ascending: false })

    // Resolve real list_items.id for these items within the current list.
    // City items bypass useItems so their listItemId was previously set to
    // String(item.id) — a fake stand-in that breaks the check_ins DB trigger
    // which requires a valid list_items row. Fetch the real IDs here.
    const cityItemIds = (data ?? []).map(i => i.id)
    let listItemIdMap = {}
    if (listId && cityItemIds.length) {
      const { data: liRows } = await supabase
        .from('list_items')
        .select('id, item_id')
        .eq('list_id', listId)
        .in('item_id', cityItemIds)
      liRows?.forEach(li => { listItemIdMap[li.item_id] = li.id })
    }

    setCityItems(
      (data ?? []).map(i => ({
        listItemId: listItemIdMap[i.id] ?? String(i.id),
        id: i.id,
        body: i.body,
        checkinType: i.checkin_type,
        isUniversal: i.is_universal,
        difficulty: i.difficulty ?? 1,
        photoRequired: i.photo_required ?? false,
        categoryName: i.categories?.name ?? 'Misc',
        categoryColor: i.categories?.color_hex ?? '#888780',
        checked: false,
        checkedAt: null,
      }))
    )

    setCityLoading(false)
  }, [cityId])

  const refreshCheckedState = useCallback(async () => {
    if (!listId || !items?.length) return
    // Don't overwrite optimistic updates while a check-off is still writing to DB
    if (checkOffInFlight.current) return

    try {
      setRefreshingChecks(true)

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser()

      if (userErr || !user) return

      const listItemIds = items.map(item => item.listItemId).filter(Boolean)

      if (!listItemIds.length) {
        setLocalItems(items)
        return
      }

      const { data: checkIns, error: checkErr } = await supabase
        .from('check_ins')
        .select('list_item_id, checked_at')
        .eq('user_id', user.id)
        .in('list_item_id', listItemIds)

      if (checkErr) throw checkErr

      // Skip applying if a check-off started while we were waiting for DB
      if (checkOffInFlight.current) return

      const checkedMap = new Map(
        (checkIns ?? []).map(ci => [String(ci.list_item_id), ci.checked_at])
      )

      // Use localItems as base to preserve any optimistic state not yet in DB
      setLocalItems(prev => {
        const base = prev.length > 0 ? prev : items
        return base.map(item => {
          // If DB confirms this item is checked, always trust DB
          if (checkedMap.has(String(item.listItemId))) {
            return { ...item, checked: true, checkedAt: checkedMap.get(String(item.listItemId)) }
          }
          // If DB says not checked but we have an in-progress optimistic check,
          // keep the optimistic state until the next refresh confirms it
          return { ...item, checked: false, checkedAt: null }
        })
      })
    } catch (e) {
      console.warn('refreshCheckedState:', e.message)
    } finally {
      setRefreshingChecks(false)
    }
  }, [listId, items])


  useFocusEffect(
    useCallback(() => {
      if (listId) {
        refreshCheckedState()
        loadSuggestions()

        // If returning from PhotoCheckInScreen with a completed check-in,
        // trigger the celebration for that item
        const pending = consumePendingCheckIn()
        if (pending && pending.difficulty >= 5) {
          setTimeout(() => triggerCelebration(pending.listItemId, pending.difficulty), 300)
        }
      } else if (cityId) {
        loadCityItems()
      }
    }, [listId, cityId, refreshCheckedState, loadSuggestions, loadCityItems, triggerCelebration])
  )

  function isEnded() {
    if (!listMeta?.ends_at) return false

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const end = new Date(`${listMeta.ends_at}T12:00:00`)
    end.setHours(0, 0, 0, 0)

    // end < today means the end date was BEFORE today — still active on the end date itself
    return end < today
  }

  function navigateToSummary(fullyDone) {
    if (summarySentRef.current || !listId) return
    summarySentRef.current = true

    const myEntry = lbEntries.find(e => e.userId === currentUserId)
    const rank    = myEntry
      ? lbEntries.filter(e => e.score > (myEntry.score ?? 0)).length + 1
      : lbEntries.length + 1

    const myCheckedItems = localItems
      .filter(i => i.checked)
      .sort((a, b) => (b.effectivePts ?? b.difficulty ?? 1) - (a.effectivePts ?? a.difficulty ?? 1))
    const topItem = myCheckedItems[0]
      ? {
          body:       myCheckedItems[0].body,
          difficulty: myCheckedItems[0].difficulty ?? 1,
          pts:        myCheckedItems[0].effectivePts ?? myCheckedItems[0].difficulty ?? 1,
        }
      : null

    // Small delay so the last check-in celebration plays first
    setTimeout(() => {
      navigation.navigate('ListSummary', {
        listId,
        title,
        checkedCount: derivedCheckedCount,
        totalCount:   derivedTotalCount,
        totalPts:     myEntry?.score ?? 0,
        rank,
        crewSize:     lbEntries.length || 1,
        topItem,
        streak:       myEntry?.streak ?? 0,
        isFullyDone:  fullyDone,
      })
    }, fullyDone ? 1800 : 0)  // delay after last celebration, instant for ended
  }

  function formatEndedDate(value) {
    if (!value) return 'Ended'
    const d = new Date(`${value}T12:00:00`)
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  function calDaysLeftList(endsAt) {
    if (!endsAt) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const end   = new Date(`${endsAt}T00:00:00`); end.setHours(0, 0, 0, 0)
    return Math.round((end - today) / (1000 * 60 * 60 * 24))
  }

  function timeLeftList(endsAt) {
    if (!endsAt) return null
    const days = calDaysLeftList(endsAt)
    if (days === null || days < 0) return null
    if (days === 0) {
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

  function formatEndLabel(endsAt) {
    if (!endsAt) return null
    const d = new Date(`${endsAt}T12:00:00`)
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const tl = timeLeftList(endsAt)
    return tl ? `Ends ${dateStr} · ${tl}` : `Ends ${dateStr}`
  }

  const ended = isEnded()
  const displayItems = listId ? localItems : cityItems
  // refreshingChecks intentionally excluded — it runs silently in background
  // without replacing the FlatList, preserving scroll position
  const isLoading = listId ? loading || metaLoading : cityLoading

  const derivedCheckedCount = listId
    ? displayItems.filter(item => item.checked).length
    : 0

  const derivedTotalCount = listId ? displayItems.length : 0

  const derivedPct =
    listId && derivedTotalCount > 0
      ? Math.round((derivedCheckedCount / derivedTotalCount) * 100)
      : 0

  const filtered = useMemo(() => {
    return displayItems.filter(item => {
      if (!showChecked && item.checked) return false
      if (filter !== 'All' && item.categoryName !== filter) return false
      if (search && !item.body.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [displayItems, filter, search, showChecked])

  // Runs a flash animation on the checked item row for Rare/Legend/Partner
  const triggerCelebration = useCallback((listItemId, difficulty) => {
    setCelebratingId(listItemId)
    flashAnim.setValue(0)

    // Partner: single pulse. Rare: double pulse. Legend: triple pulse + strong haptic.
    const pulseCount = difficulty === 25 ? 3 : difficulty === 10 ? 2 : 1
    const pulses = []
    for (let i = 0; i < pulseCount; i++) {
      pulses.push(
        Animated.sequence([
          Animated.timing(flashAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.timing(flashAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
        ])
      )
    }

    Animated.sequence(pulses).start(() => setCelebratingId(null))

    if (difficulty === 25) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } else {
      Haptics.impactAsync(
        difficulty === 10
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light
      )
    }
  }, [flashAnim])

  // Called by badge-polling logic after a check-in awards one or more badges
  function showBadgeCelebration(badges) {
    setCelebrationBadges(badges)
  }

  const handleCheckOff = useCallback(async (listItemId) => {
    if (ended || metaLoading) return  // also block while meta is loading

    const item = localItems.find(i => i.listItemId === listItemId)
      ?? cityItems.find(i => i.listItemId === listItemId)

    // Photo-required items go to PhotoCheckInScreen — no tap shortcut
    if (item?.photoRequired && !item.checked) {
      navigation.navigate('PhotoCheckIn', { item, listItemId })
      return
    }

    const difficulty  = item?.difficulty  ?? 1
    const wasChecked  = item?.checked     ?? false

    // Optimistic local update immediately — preserves scroll position
    // useItems.checkOff runs its own optimistic update in parallel, that's fine
    if (listId) {
      const now = new Date().toISOString()
      setLocalItems(prev => prev.map(i =>
        i.listItemId === listItemId
          ? { ...i, checked: !wasChecked, checkedAt: !wasChecked ? now : null }
          : i
      ))

      // Set in-flight flag so refreshCheckedState won't overwrite our optimistic update
      checkOffInFlight.current = true
      checkOff(listItemId).then((result) => {
        // Clear flag after write completes, then allow refresh after brief delay
        setTimeout(() => {
          checkOffInFlight.current = false
        }, 1500)

        if (result?.error) {
          // Revert the optimistic update immediately — don't wait for next focus refresh
          setLocalItems(prev => prev.map(i =>
            i.listItemId === listItemId
              ? { ...i, checked: wasChecked, checkedAt: wasChecked ? i.checkedAt : null }
              : i
          ))
          checkOffInFlight.current = false
          // Alert on unexpected errors (P0001 is already alerted inside checkOff)
          const code = result.error?.code
          if (code && code !== 'P0001' && result.error !== 'Not signed in') {
            Alert.alert(
              'Check-in failed',
              `Something went wrong (${code}). Please try again.`,
            )
          } else if (result.error === 'Not signed in') {
            Alert.alert('Not signed in', 'Please sign in to check off items.')
          }
          return
        }

        // Poll for newly awarded badges only when the insert confirmed (not on error or un-check)
        if (!wasChecked && currentUserId) {
          pollForNewBadges(currentUserId, supabase).then(earned => {
            if (earned.length > 0) setCelebrationBadges(earned)
          })
        }
      }).catch(() => {
        checkOffInFlight.current = false
        // Revert on unexpected exception
        setLocalItems(prev => prev.map(i =>
          i.listItemId === listItemId
            ? { ...i, checked: wasChecked, checkedAt: wasChecked ? i.checkedAt : null }
            : i
        ))
      })

      // Celebrate and notify immediately on a fresh check (not un-check)
      if (!wasChecked) {
        if (difficulty >= 5) {
          triggerCelebration(listItemId, difficulty)
          notifyCrewCheckIn({
            listItemId,
            itemBody:  item?.body ?? '',
            difficulty,
            checkInId: null,
          }).catch(() => {})
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        }
      }
    }
  }, [ended, listId, checkOff, localItems, cityItems, navigation, triggerCelebration, currentUserId])

  const renderItem = useCallback(({ item }) => {
    const isCelebrating = celebratingId === item.listItemId
    const overlayColor = item.difficulty === 25
      ? 'rgba(139,92,246,0.22)'   // purple for Legend
      : item.difficulty === 10
        ? 'rgba(186,117,23,0.22)' // amber for Rare
        : 'rgba(55,138,221,0.22)' // blue for Partner

    return (
      <View style={{ position: 'relative' }}>
        {isCelebrating && (
          <Animated.View
            pointerEvents="none"
            style={{
              ...StyleSheet.absoluteFillObject,
              borderRadius: 18,
              backgroundColor: overlayColor,
              opacity: flashAnim,
              zIndex: 10,
            }}
          />
        )}
        <TouchableOpacity
          style={[styles.rowCard, item.checked && styles.rowCardChecked]}
          onPress={() => {
            if (item.is_secret || item.isSecret) {
              navigation.navigate('SecretReveal', { item, listItemId: item.listItemId })
              return
            }
            navigation.navigate('ItemDetail', {
              item,
              listId,
              listTitle: route.params?.title ?? 'CheckOff',
            })
          }}
          activeOpacity={0.88}
        >
        <TouchableOpacity
          style={[
            styles.checkbox,
            item.checked && styles.checkboxDone,
            ended && !item.checked && styles.checkboxDisabled,
            item.photoRequired && !item.checked && styles.checkboxCamera,
          ]}
          onPress={() => handleCheckOff(item.listItemId)}
          disabled={ended}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {item.checked
            ? <Text style={styles.checkmark}>✓</Text>
            : item.photoRequired
              ? <Text style={styles.cameraIcon}>📷</Text>
              : null
          }
        </TouchableOpacity>

        <View style={styles.rowBody}>
          <Text style={[styles.itemText, item.checked && styles.itemTextDone]}>
            {(item.is_secret || item.isSecret)
              ? (item.partnerName ? `🔒 Secret at ${item.partnerName}` : '🔒 Secret item')
              : item.body}
          </Text>

          <View style={styles.tagRow}>
            <View
              style={[
                styles.tag,
                { backgroundColor: `${item.categoryColor}18`, borderColor: `${item.categoryColor}30` },
              ]}
            >
              <Text style={[styles.tagText, { color: item.categoryColor }]}>
                {item.categoryName}
              </Text>
            </View>

            {item.difficulty > 1 && (
              <View style={[styles.tagDifficulty, { backgroundColor: DIFFICULTY_COLORS[item.difficulty]?.bg, borderColor: DIFFICULTY_COLORS[item.difficulty]?.border }]}>
                <Text style={[styles.tagDifficultyText, { color: DIFFICULTY_COLORS[item.difficulty]?.text }]}>
                  {DIFFICULTY_LABELS[item.difficulty]} · {item.effectivePts ?? item.difficulty}pts
                </Text>
              </View>
            )}

            {item.pointMultiplier > 1 && (
              <View style={styles.tagBonus}>
                <Text style={styles.tagBonusText}>{item.pointMultiplier}× pts</Text>
              </View>
            )}

            {item.checkinType === 'gps' && (
              <View style={styles.tagGps}>
                <Text style={styles.tagGpsText}>GPS verify</Text>
              </View>
            )}

            {!item.isUniversal && (
              <View style={styles.tagCity}>
                <Text style={styles.tagCityText}>{item.neighborhoodName}</Text>
              </View>
            )}

            {ended && (
              <View style={styles.tagEnded}>
                <Text style={styles.tagEndedText}>Ended</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.rowRight}>
          {item.checked && item.checkedAt ? (
            <Text style={styles.timestamp}>
              {new Date(item.checkedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          ) : null}

          {!ended && !item.checked && listId && (
            <TouchableOpacity
              style={styles.dareBtn}
              onPress={() => navigation.navigate('Dare', { item, listId })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.dareBtnText}>😈</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
      </View>
    )
  }, [navigation, route.params, listId, ended, handleCheckOff, celebratingId, flashAnim])

  const headerEl = useMemo(() => (
    <View style={styles.headerBlock}>
      {ended && (
        <View style={styles.endedBanner}>
          <View style={styles.endedBannerTop}>
            <Text style={styles.endedBannerTitle}>🏁 List ended</Text>
            {listMeta?.ends_at ? (
              <Text style={styles.endedBannerDate}>{formatEndedDate(listMeta.ends_at)}</Text>
            ) : null}
          </View>
          <Text style={styles.endedBannerText}>
            This list is now locked. You can still browse the items and view the final crew results.
          </Text>
          {listId && (
            <TouchableOpacity
              style={styles.resultsBtn}
              onPress={() => navigation.navigate('Leaderboard', { listId, title })}
              activeOpacity={0.88}
            >
              <Text style={styles.resultsBtnText}>View final standings →</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {listId && !ended && listMeta?.ends_at && (
        <View style={styles.endsAtRow}>
          <Text style={styles.endsAtText}>{formatEndLabel(listMeta.ends_at)}</Text>
        </View>
      )}

      {listId && (
        <View style={styles.progressCard}>
          <View style={styles.progressTopRow}>
            <Text style={styles.progressLabel}>{ended ? 'Final progress' : 'Progress'}</Text>
            <Text style={styles.progressText}>
              {derivedCheckedCount} / {derivedTotalCount} · {derivedPct}%
            </Text>
          </View>
          <View style={styles.progressBg}>
            <View
              style={[
                styles.progressFill,
                ended && styles.progressFillEnded,
                { width: `${derivedPct}%` },
              ]}
            />
          </View>
        </View>
      )}

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search items..."
          placeholderTextColor="#9CA3AF"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {listId && (
          <TouchableOpacity
            style={[styles.crewBtn, ended && styles.crewBtnEnded]}
            onPress={() => navigation.navigate('Leaderboard', { listId, title })}
          >
            <Text style={[styles.crewBtnText, ended && styles.crewBtnTextEnded]}>
              {ended ? 'Results' : 'Crew'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filtersSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
          keyboardShouldPersistTaps="handled"
        >
          {(['All', ...Array.from(new Set(localItems.map(i => i.categoryName).filter(Boolean))).sort()]).map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.filterPill, filter === cat && styles.filterPillActive]}
              onPress={() => setFilter(cat)}
            >
              <Text style={[styles.filterText, filter === cat && styles.filterTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <TouchableOpacity
        style={styles.toggleRow}
        onPress={() => setShowChecked(v => !v)}
        activeOpacity={0.8}
      >
        <View style={[styles.toggleDot, showChecked && styles.toggleDotOn]} />
        <Text style={styles.toggleText}>
          {showChecked ? 'Showing checked items' : 'Hiding checked items'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>
        {filtered.length} idea{filtered.length === 1 ? '' : 's'}
      </Text>
    </View>
  ), [
    ended,
    listMeta?.ends_at,
    listId,
    title,
    derivedCheckedCount,
    derivedTotalCount,
    derivedPct,
    search,
    filter,
    showChecked,
    filtered.length,
    navigation,
    tick,
  ])

  const suggestionsFooter = listId ? (
    <View style={styles.suggestionsSection}>
      {suggestions.length > 0 && (
        <>
          <Text style={styles.suggestionsSectionTitle}>📍 Suggested by crew</Text>
          {suggestions.map(s => {
            const isOwner = s.user_id === currentUserId
            return (
              <View key={s.id} style={[styles.suggRow, s.checked && styles.suggRowChecked]}>
                <TouchableOpacity
                  style={[
                    styles.suggCheckbox,
                    s.checked && styles.suggCheckboxDone,
                    !isOwner && styles.suggCheckboxLocked,
                  ]}
                  onPress={() => handleSuggestionCheckOff(s.id, s.checked, s.user_id)}
                  disabled={!isOwner || ended}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  {s.checked && <Text style={styles.suggCheckmark}>✓</Text>}
                </TouchableOpacity>

                <View style={styles.suggBody}>
                  <Text style={[styles.suggName, s.checked && styles.suggNameDone]}>
                    {s.user_suggestions?.place_name}
                  </Text>
                  <Text style={styles.suggExp} numberOfLines={2}>
                    {s.user_suggestions?.experience_body}
                  </Text>
                  <View style={styles.suggTagRow}>
                    <View style={styles.suggTag}>
                      <Text style={styles.suggTagText}>📍 suggested · 1pt</Text>
                    </View>
                    {!isOwner && (
                      <Text style={styles.suggOwnerNote}>Added by crew</Text>
                    )}
                  </View>
                </View>
              </View>
            )
          })}
        </>
      )}

      {!ended && (
        <TouchableOpacity
          style={styles.suggestBtn}
          onPress={() => setShowSuggestSheet(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.suggestBtnText}>+ Suggest a place</Text>
        </TouchableOpacity>
      )}
    </View>
  ) : null

  if (listDeleted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={{ fontSize: 36, marginBottom: 16 }}>🗑️</Text>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#1F2937', marginBottom: 8, textAlign: 'center' }}>
            List no longer available
          </Text>
          <Text style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, paddingHorizontal: 32, marginBottom: 28 }}>
            The creator has deleted this list. Your check-ins on it are saved, but the list itself is gone.
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Home')}
            style={{ backgroundColor: '#FFB84D', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 }}
            activeOpacity={0.85}
          >
            <Text style={{ fontWeight: '800', color: '#7A4B00', fontSize: 15 }}>Go home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.listItemId)}
          renderItem={renderItem}
          ListHeaderComponent={headerEl}
          ListFooterComponent={suggestionsFooter}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyText}>
                {search ? 'Try a different keyword or category.' : 'No items in this category yet.'}
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <SuggestPlaceSheet
        visible={showSuggestSheet}
        onClose={() => setShowSuggestSheet(false)}
        onSuccess={loadSuggestions}
        listId={listId}
        listTitle={route.params?.title ?? ''}
      />

      <BadgeCelebrationModal
        badges={celebrationBadges}
        onDismiss={() => setCelebrationBadges([])}
      />
    </SafeAreaView>
  )
}

function createListStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY }) {
 return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  listContent: {
    paddingBottom: 36,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },

  headerBlock: {
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },

  endedBanner: {
    backgroundColor: ENDED_BG,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  endedBannerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 10,
  },

  endedBannerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: ENDED_TEXT,
  },

  endedBannerDate: {
    fontSize: 12,
    color: ENDED_TEXT,
    fontWeight: '700',
  },

  endedBannerText: {
    fontSize: 13,
    lineHeight: 19,
    color: TEXT,
    fontWeight: '600',
    marginBottom: 12,
  },

  resultsBtn: {
    alignSelf: 'flex-start',
    backgroundColor: CARD,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  resultsBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: ENDED_TEXT,
  },

  endsAtRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 10,
    marginTop: -2,
  },

  endsAtText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F5A623',
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  progressCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  progressTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  progressLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT,
  },

  progressBg: {
    height: 10,
    backgroundColor: '#F4E6D2',
    borderRadius: 999,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    backgroundColor: ACCENT,
    borderRadius: 999,
  },

  progressFillEnded: {
    backgroundColor: ENDED_TEXT,
  },

  progressText: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '600',
  },

  searchWrap: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },

  searchInput: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: TEXT,
    fontSize: 15,
    borderWidth: 1,
    borderColor: BORDER,
  },

  crewBtn: {
    backgroundColor: SOFT,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#F3D2A2',
    justifyContent: 'center',
  },

  crewBtnEnded: {
    backgroundColor: ENDED_BG,
    borderColor: ENDED_BORDER,
  },

  crewBtnText: {
    fontSize: 14,
    color: ACCENT_DARK,
    fontWeight: '700',
  },

  crewBtnTextEnded: {
    color: ENDED_TEXT,
  },

  filtersSection: {
    marginBottom: 10,
  },

  filterContent: {
    paddingRight: 8,
    paddingBottom: 4,
  },

  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    marginRight: 8,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },

  filterPillActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },

  filterText: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '600',
  },

  filterTextActive: {
    color: ACCENT_DARK,
    fontWeight: '800',
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },

  toggleDot: {
    width: 10,
    height: 10,
    borderRadius: 10,
    backgroundColor: '#D1D5DB',
  },

  toggleDotOn: {
    backgroundColor: ACCENT,
  },

  toggleText: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '600',
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 6,
  },

  rowCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },

  rowCardChecked: {
    opacity: 0.72,
  },

  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: '#FFF',
  },

  checkboxDone: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },

  checkboxDisabled: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
  },

  checkmark: {
    fontSize: 12,
    color: ACCENT_DARK,
    fontWeight: '900',
  },

  rowBody: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },

  itemText: {
    fontSize: 17,
    color: TEXT,
    lineHeight: 24,
    fontWeight: '600',
  },

  itemTextDone: {
    textDecorationLine: 'line-through',
    color: '#9CA3AF',
  },

  tagRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },

  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },

  tagText: {
    fontSize: 11,
    fontWeight: '700',
  },

  tagGps: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#FFF3D6',
    borderWidth: 1,
    borderColor: '#F8D999',
  },

  tagGpsText: {
    fontSize: 11,
    color: '#9A6700',
    fontWeight: '700',
  },

  tagDifficulty: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },

  tagDifficultyText: {
    fontSize: 11,
    fontWeight: '800',
  },

  tagBonus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#FFF0F9',
    borderWidth: 1,
    borderColor: '#F9C8E8',
  },

  tagBonusText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#9D1C6E',
  },

  checkboxCamera: {
    borderColor: '#8B5CF6',
    backgroundColor: '#F5F3FF',
  },

  cameraIcon: {
    fontSize: 13,
  },

  tagCity: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#E8F1FF',
    borderWidth: 1,
    borderColor: '#C7DBFF',
  },

  tagCityText: {
    fontSize: 11,
    color: '#295EA8',
    fontWeight: '700',
  },

  tagEnded: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: ENDED_BG,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  tagEndedText: {
    fontSize: 11,
    color: ENDED_TEXT,
    fontWeight: '800',
  },

  rowRight: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    minWidth: 42,
    alignSelf: 'stretch',
  },

  timestamp: {
    fontSize: 11,
    color: MUTED,
    fontWeight: '600',
  },

  dareBtn: {
    backgroundColor: '#F8ECFF',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },

  dareBtnText: {
    fontSize: 16,
  },

  sep: {
    height: 10,
  },

  empty: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 6,
  },

  emptyText: {
    color: MUTED,
    fontSize: 14,
    textAlign: 'center',
  },

  // ── Suggestions footer ──────────────────────────────────────
  suggestionsSection: {
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },

  suggestionsSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: MUTED,
    marginBottom: 10,
    letterSpacing: 0.2,
  },

  suggRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    marginBottom: 8,
  },

  suggRowChecked: {
    opacity: 0.65,
  },

  suggCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#C3B8A8',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
    backgroundColor: '#FFF',
  },

  suggCheckboxDone: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },

  suggCheckboxLocked: {
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },

  suggCheckmark: {
    fontSize: 11,
    color: ACCENT_DARK,
    fontWeight: '900',
  },

  suggBody: {
    flex: 1,
    marginLeft: 10,
  },

  suggName: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
    lineHeight: 21,
  },

  suggNameDone: {
    textDecorationLine: 'line-through',
    color: '#9CA3AF',
  },

  suggExp: {
    fontSize: 12,
    color: MUTED,
    lineHeight: 17,
    marginTop: 3,
  },

  suggTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    flexWrap: 'wrap',
  },

  suggTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#FFD9A0',
  },

  suggTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#A16A00',
  },

  suggOwnerNote: {
    fontSize: 10,
    color: MUTED,
    fontWeight: '600',
  },

  suggestBtn: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderStyle: 'dashed',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },

  suggestBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: MUTED,
  },
 }) // end StyleSheet.create
} // end createListStyles