import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'

import { useFocusEffect } from '@react-navigation/native'
import { useHeaderHeight } from '@react-navigation/elements'
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
  ImageBackground,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import { useItems } from '../lib/useItems'
import { useLeaderboard } from '../lib/useLeaderboard'
import { supabase } from '../lib/supabase'
import { SafeAreaView } from 'react-native-safe-area-context'
import { notifyCrewCheckIn } from '../lib/notifyCrewCheckIn'
import { consumePendingCheckIn } from '../lib/checkInResult'
import { pollForNewBadges } from '../lib/badges'
import { handleFirstCheckinReferralBonus } from '../lib/referral'
import SuggestPlaceSheet from './SuggestPlaceSheet'
import BadgeCelebrationModal from '../components/BadgeCelebrationModal'
import { useTheme } from '../lib/ThemeContext'

const ACCENT = '#FFB84D'
const ACCENT_DARK = '#7A4B00'
const TIER_ORDER = ['Starter', 'Explorer', 'Local', 'Insider', 'Legend']
// Colors now come from ThemeContext — see useTheme() inside the component
// ENDED_BG, ENDED_BORDER, ENDED_TEXT now come from ThemeContext (light/dark aware)

function computeInsiderUnlocked(item, userLifetimePts, userInsiderTier) {
  if (!item.isInsiderDrop) return true
  const reqPts    = item.insiderDropRequiresPoints
  const reqStatus = item.insiderDropRequiresStatus
  if (reqPts == null && reqStatus == null) return true
  let unlocked = false
  if (reqPts != null && (userLifetimePts ?? 0) >= reqPts) unlocked = true
  if (!unlocked && reqStatus != null) {
    const userIdx = TIER_ORDER.indexOf(userInsiderTier ?? 'Starter')
    const reqIdx  = TIER_ORDER.indexOf(reqStatus)
    if (reqIdx >= 0 && userIdx >= reqIdx) unlocked = true
  }
  return unlocked
}

// Difficulty tier config — mirrors admin DIFFICULTY_TIERS
const DIFFICULTY_LABELS = { 5: 'Partner', 10: 'Rare', 25: 'Legend' }
const DIFFICULTY_COLORS = {
  5:  { bg: '#EBF4FF', border: '#BFDBFE', text: '#1E4A8A' },  // blue — partner
  10: { bg: '#FFF7E6', border: '#FDDCAA', text: '#92400E' },  // amber — rare
  25: { bg: '#F3EEFF', border: '#DDD0FC', text: '#5B21B6' },  // purple — legend
}


function PhotoWithLoader({ uri, style }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  return (
    <View style={[style, { overflow: 'hidden' }]}>
      {!error && (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoadEnd={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true) }}
        />
      )}
      {loading && !error && (
        <ActivityIndicator
          style={StyleSheet.absoluteFill}
          color="#888"
        />
      )}
    </View>
  )
}

export default function ListScreen({ route, navigation }) {
  const { listId, cityId, title, heroImage } = route.params ?? {}
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY, ENDED_BG, ENDED_BORDER, ENDED_TEXT } = colors
  const styles = useMemo(() => createListStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY, ENDED_BG, ENDED_BORDER, ENDED_TEXT }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY, ENDED_BG, ENDED_BORDER, ENDED_TEXT])
  const headerHeight = useHeaderHeight()

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
  const [userLifetimePts, setUserLifetimePts] = useState(0)
  const [userInsiderTier, setUserInsiderTier] = useState('Starter')

  // IDs of items checked in the last 600ms — kept in current sort position
  // during this window so the UI shows the in-place check before reordering.
  const [pendingSortIds, setPendingSortIds] = useState(() => new Set())
  // Item to navigate to Discover after memory modal closes (Fix 5)
  const [pendingDiscoverItem, setPendingDiscoverItem] = useState(null)

  // Transparent nav bar when hero image is present so photo fills behind the header
  useEffect(() => {
    if (heroImage) {
      navigation.setOptions({
        headerTransparent: true,
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { color: '#FFFFFF', fontWeight: '800' },
      })
    }
  }, [heroImage, navigation])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id ?? null
      setCurrentUserId(uid)
      if (uid) {
        supabase.from('users').select('lifetime_points, insider_tier').eq('id', uid).single()
          .then(({ data: u }) => {
            if (u) {
              setUserLifetimePts(u.lifetime_points ?? 0)
              setUserInsiderTier(u.insider_tier ?? 'Starter')
            }
          })
      }
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

  // Personalized check-in memory modal
  const [memoryModal,   setMemoryModal]   = useState(null)  // { listItemId, placeLabel, noteLabel }
  const [memoryPlace,   setMemoryPlace]   = useState('')
  const [memoryNote,    setMemoryNote]    = useState('')
  const [memorySaving,  setMemorySaving]  = useState(false)
  const [memoryError,   setMemoryError]   = useState(null)

  // Check-in detail sheet — shown when user taps ⓘ on a completed item
  const [detailModal,   setDetailModal]   = useState(null)   // { item }
  const [detailCI,      setDetailCI]      = useState(null)   // fetched check_in row
  const [detailLoading, setDetailLoading] = useState(false)

  // Partner suggestion card — shown after check-in (after memory modal if present)
  const [pendingSuggestionStack, setPendingSuggestionStack] = useState(null)
  const [suggestionStack,        setSuggestionStack]        = useState(null)
  const suggAnim        = useRef(new Animated.Value(200)).current
  const suggDismissAnim = useRef(new Animated.Value(1)).current

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
        .select('list_item_id, checked_at, personal_place, personal_note')
        .eq('user_id', user.id)
        .in('list_item_id', listItemIds)

      if (checkErr) throw checkErr

      // Skip applying if a check-off started while we were waiting for DB
      if (checkOffInFlight.current) return

      const checkedMap = new Map(
        (checkIns ?? []).map(ci => [String(ci.list_item_id), ci])
      )

      // Use localItems as base to preserve any optimistic state not yet in DB
      setLocalItems(prev => {
        const base = prev.length > 0 ? prev : items
        return base.map(item => {
          // If DB confirms this item is checked, always trust DB
          if (checkedMap.has(String(item.listItemId))) {
            const ci = checkedMap.get(String(item.listItemId))
            return {
              ...item,
              checked:       true,
              checkedAt:     ci.checked_at,
              personalPlace: ci.personal_place ?? null,
              personalNote:  ci.personal_note  ?? null,
            }
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

  // Promote pending partner suggestion once memory modal is fully dismissed
  useEffect(() => {
    if (!memoryModal && pendingSuggestionStack) {
      setSuggestionStack(pendingSuggestionStack)
      setPendingSuggestionStack(null)
    }
  }, [memoryModal, pendingSuggestionStack])

  // Fire post-checkin discover after memory modal is dismissed (Fix 5)
  useEffect(() => {
    if (!memoryModal && pendingDiscoverItem) {
      triggerPostCheckinDiscover(pendingDiscoverItem)
      setPendingDiscoverItem(null)
    }
  }, [memoryModal, pendingDiscoverItem])

  // Slide card in when a suggestion stack becomes active
  useEffect(() => {
    if (suggestionStack?.length) {
      suggDismissAnim.setValue(1)
      Animated.spring(suggAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 12,
      }).start()
    }
  }, [suggestionStack])

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
      // Keep recently-checked items visible for 600ms regardless of showChecked,
      // so the UI shows the in-place checkmark before any reorder or removal.
      if (!showChecked && item.checked && !pendingSortIds.has(item.listItemId)) return false
      if (filter !== 'All' && item.categoryName !== filter) return false
      if (search && !item.body.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [displayItems, filter, search, showChecked, pendingSortIds])

  const sortedFiltered = useMemo(() => {
    const getGroup = (item) => {
      // Checked items stay in their original position (Fix 4 — no sort-to-bottom)
      const unlocked = computeInsiderUnlocked(item, userLifetimePts, userInsiderTier)
      if (item.isInsiderDrop && !unlocked) return 0
      if (item.isInsiderDrop && unlocked)  return 1
      return 2
    }
    return [...filtered].sort((a, b) => getGroup(a) - getGroup(b))
  }, [filtered, userLifetimePts, userInsiderTier])

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

  // Fire-and-forget: opens Discover screen in post-checkin mode if the item
  // has coordinates and tags. Never throws — skips silently on any missing data.
  function triggerPostCheckinDiscover(item) {
    // useItems returns mapsLat/mapsLng (camelCase); also handle maps_lat/maps_lng as fallback
    const lat = item?.mapsLat ?? item?.maps_lat ?? null
    const lng = item?.mapsLng ?? item?.maps_lng ?? null
    if (!lat || !lng) {
      if (__DEV__) console.log('postCheckin skip: no coordinates on item', item?.id)
      return
    }
    supabase
      .from('item_tags')
      .select('tags(name)')
      .eq('item_id', item.id)
      .limit(5)
      .then(({ data, error }) => {
        if (error) {
          if (__DEV__) console.log('postCheckin skip: fetch failed', error.message)
          return
        }
        const checkinTags = (data ?? []).map(r => r.tags?.name).filter(Boolean)
        if (!checkinTags.length) {
          if (__DEV__) console.log('postCheckin skip: no tags found for item', item.id)
          return
        }
        if (__DEV__) console.log('postCheckin fired for item', item.id, 'with tags', checkinTags)
        navigation.navigate('NearbyTab', {
          screen: 'Nearby',
          params: {
            mode:          'post_checkin',
            checkinLat:    lat,
            checkinLng:    lng,
            checkinItemId: item.id,
            checkinTags,
          },
        })
      })
      .catch(() => {
        if (__DEV__) console.log('postCheckin skip: fetch failed')
      })
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

      // Hold the item in its current sort position for 600ms so the user sees
      // the in-place checkmark before any reorder or removal.
      if (!wasChecked) {
        setPendingSortIds(prev => new Set([...prev, listItemId]))
        setTimeout(() => {
          setPendingSortIds(prev => { const n = new Set(prev); n.delete(listItemId); return n })
        }, 600)
      }

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
            if (earned.some(b => b.id === 'first_checkin')) {
              handleFirstCheckinReferralBonus(currentUserId).catch(() => {})
            }
          })
        }

        // Open the personal memory modal if the item supports it
        if (!wasChecked && item?.allowsPersonalNote) {
          setMemoryPlace('')
          setMemoryNote('')
          setMemoryError(null)
          setMemoryModal({
            listItemId: listItemId,
            placeLabel:  item.personalPlaceLabel  ?? 'Place or location',
            noteLabel:   item.personalPromptLabel ?? 'Any notes?',
            itemBody:    item.body    ?? '',
            difficulty:  item.difficulty ?? 5,
          })
        }

        // Fetch partner suggestion — fire-and-forget, never blocks check-in
        if (!wasChecked) {
          fetchPartnerSuggestion(item?.id, !!item?.allowsPersonalNote)
          // Defer discover navigation until after the memory modal (if any) so the
          // modal doesn't get dismissed by navigation away from this screen.
          if (item?.allowsPersonalNote) {
            setPendingDiscoverItem(item)
          } else {
            triggerPostCheckinDiscover(item)
          }
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

      // Celebrate and notify immediately on a fresh check (not un-check).
      // For memory-eligible items, notification is deferred to saveMemory / skip
      // so personal_place and personal_note are already in the DB when it fires.
      if (!wasChecked) {
        if (difficulty >= 5) {
          triggerCelebration(listItemId, difficulty)
          if (!item?.allowsPersonalNote) {
            notifyCrewCheckIn({
              listItemId,
              itemBody:  item?.body ?? '',
              difficulty,
              checkInId: null,
            }).catch(() => {})
          }
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        }
      }
    }
  }, [ended, listId, checkOff, localItems, cityItems, navigation, triggerCelebration, currentUserId])

  function slideOutSuggStack(onDone) {
    Animated.timing(suggAnim, { toValue: 200, useNativeDriver: true, duration: 200 }).start(() => {
      setSuggestionStack(null)
      suggAnim.setValue(200)
      onDone?.()
    })
  }

  function dismissCard(idx) {
    if (!suggestionStack) return
    if (idx !== 0) {
      // Peeking card — remove instantly without animation
      setSuggestionStack(prev => {
        const next = prev.filter((_, i) => i !== idx)
        return next.length ? next : null
      })
      return
    }
    // Front card — fade out then remove
    Animated.timing(suggDismissAnim, { toValue: 0, useNativeDriver: true, duration: 180 }).start(() => {
      setSuggestionStack(prev => {
        if (!prev) return null
        const next = prev.slice(1)
        if (!next.length) {
          slideOutSuggStack()
          return null
        }
        suggDismissAnim.setValue(1)
        return next
      })
    })
  }

  function bringToFront(idx) {
    if (!suggestionStack || idx === 0) return
    setSuggestionStack(prev => {
      if (!prev) return prev
      const next = [...prev]
      const [card] = next.splice(idx, 1)
      next.unshift(card)
      suggDismissAnim.setValue(1)
      return next
    })
  }

  async function fetchPartnerSuggestion(itemId, hasMemoryModal) {
    if (!itemId) return
    try {
      const now = new Date().toISOString()
      const { data } = await supabase
        .from('item_partner_suggestions')
        .select('suggestion_title, suggestion_body, is_secret_partner, reveal_item_id, partners!inner(id, business_name, address, photo_url)')
        .eq('item_id', itemId)
        .eq('is_active', true)
        .or(`starts_at.is.null,starts_at.lte.${now}`)
        .or(`ends_at.is.null,ends_at.gte.${now}`)
        .order('priority', { ascending: true })
      if (!data?.length) return
      if (hasMemoryModal) {
        setPendingSuggestionStack(data)
      } else {
        setSuggestionStack(data)
      }
    } catch {
      // non-critical — never block or surface errors from this
    }
  }

  async function navigateToRevealItem(revealItemId) {
    if (!revealItemId) return
    try {
      const { data } = await supabase
        .from('items')
        .select(`
          id, body, checkin_type, is_universal, ring_weight,
          difficulty, photo_required, is_secret, secret_reveal_text,
          maps_lat, maps_lng, geo_radius_m,
          website_url, maps_query, partner_id, has_alcohol,
          allows_personal_note, personal_prompt_label, personal_place_label,
          categories ( name, color_hex ),
          neighborhoods!items_neighborhood_id_fkey ( name ),
          partners ( business_name )
        `)
        .eq('id', revealItemId)
        .single()
      if (!data) return
      navigation.navigate('ItemDetail', {
        item: data,
        listId,
        listTitle: route.params?.title ?? 'CheckOff',
      })
    } catch {
      // non-critical
    }
  }

  const saveMemory = useCallback(async () => {
    if (!memoryModal) return
    const place = memoryPlace.trim()
    const note  = memoryNote.trim()
    if (!place && !note) {
      setMemoryModal(null)
      return
    }
    setMemorySaving(true)
    setMemoryError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: updatedCI, error } = await supabase
        .from('check_ins')
        .update({ personal_place: place || null, personal_note: note || null })
        .eq('user_id', user.id)
        .eq('list_item_id', memoryModal.listItemId)
        .select('id')
        .single()
      if (error) throw error
      // Optimistic update so the note displays immediately
      setLocalItems(prev => prev.map(i =>
        i.listItemId === memoryModal.listItemId
          ? { ...i, personalPlace: place || null, personalNote: note || null }
          : i
      ))
      // Fire crew notification now that memory is in the DB
      if ((memoryModal.difficulty ?? 0) >= 5) {
        notifyCrewCheckIn({
          listItemId: memoryModal.listItemId,
          itemBody:   memoryModal.itemBody   ?? '',
          difficulty: memoryModal.difficulty ?? 5,
          checkInId:  updatedCI?.id ?? null,
        }).catch(() => {})
      }
      setMemoryModal(null)
    } catch {
      setMemoryError("Couldn't save your memory, but your check-in is safe.")
    } finally {
      setMemorySaving(false)
    }
  }, [memoryModal, memoryPlace, memoryNote])

  function formatCheckInDate(isoStr) {
    const d = new Date(isoStr)
    const datePart = d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    })
    const timePart = d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
    return `${datePart} at ${timePart}`
  }

  async function openDetailModal(item) {
    setDetailCI(null)
    setDetailModal({ item })
    if (!currentUserId) return
    setDetailLoading(true)
    try {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, checked_at, photo_url, personal_place, personal_note')
        .eq('list_item_id', item.listItemId)
        .eq('user_id', currentUserId)
        .maybeSingle()
      if (error) {
        console.error('openDetailModal: check_ins query failed:', error.message)
      }

      let ciData = data ?? null

      // Resolve photo to a signed URL — public URLs fail on private buckets
      if (ciData?.photo_url) {
        const url = ciData.photo_url
        const marker = '/object/public/checkin-photos/'
        const markerIdx = url.indexOf(marker)
        if (markerIdx >= 0) {
          const storagePath = url.slice(markerIdx + marker.length)
          try {
            const { data: signed } = await supabase.storage
              .from('checkin-photos')
              .createSignedUrl(storagePath, 3600)
            if (signed?.signedUrl) {
              ciData = { ...ciData, photo_url: signed.signedUrl }
            }
          } catch { /* fall back to original URL */ }
        }
      }

      setDetailCI(ciData)
    } catch (e) {
      console.error('openDetailModal error:', e.message)
      setDetailCI(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const renderItem = useCallback(({ item }) => {
    const isCelebrating = celebratingId === item.listItemId
    const overlayColor = item.difficulty === 25
      ? 'rgba(139,92,246,0.22)'   // purple for Legend
      : item.difficulty === 10
        ? 'rgba(186,117,23,0.22)' // amber for Rare
        : 'rgba(55,138,221,0.22)' // blue for Partner

    // ── Insider Drop unlock check ──────────────────────────────────
    const isInsiderDrop    = item.isInsiderDrop ?? false
    const insiderUnlocked  = computeInsiderUnlocked(item, userLifetimePts, userInsiderTier)

    // ── Locked Insider Drop card ────────────────────────────────────
    if (isInsiderDrop && !insiderUnlocked) {
      const reqPts    = item.insiderDropRequiresPoints
      const reqStatus = item.insiderDropRequiresStatus
      const ptsNeeded = reqPts != null ? Math.max(0, reqPts - userLifetimePts) : null
      return (
        <TouchableOpacity
          style={[styles.rowCard, styles.rowCardLocked]}
          onPress={() => {
            const bodyParts = ['Keep checking off items to unlock this.']
            if (ptsNeeded != null) {
              bodyParts.push(`${ptsNeeded} more point${ptsNeeded !== 1 ? 's' : ''} and it's yours.`)
            } else if (reqStatus) {
              bodyParts.push(`Reach ${reqStatus} status to unlock.`)
            }
            Alert.alert('This is an Insider Drop', bodyParts.join(' '), [{ text: 'Got it' }])
          }}
          activeOpacity={0.9}
        >
          <View style={styles.lockedIconWrap}>
            <Text style={styles.lockedIcon}>🔒</Text>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.lockedTeaserText}>
              {item.insiderDropTeaserText ?? 'Insider Drop'}
            </Text>
            <Text style={styles.lockedReqText}>
              {reqPts != null
                ? `Unlock at ${reqPts} pts · You have ${userLifetimePts} pts`
                : reqStatus != null
                  ? `Unlock at ${reqStatus} status`
                  : ''}
            </Text>
          </View>
        </TouchableOpacity>
      )
    }

    // ── Normal card (+ ⭐ badge for unlocked Insider Drops) ─────────
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
            if (item.checked) {
              openDetailModal(item)
              return
            }
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
            {isInsiderDrop && (
              <View style={styles.tagInsiderDrop}>
                <Text style={styles.tagInsiderDropText}>⭐ Insider Drop</Text>
              </View>
            )}

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

          {item.checked && (item.personalPlace || item.personalNote) && (
            <Text style={{ color: '#6F7785', fontSize: 12, marginTop: 4 }}>
              {item.personalPlace}{item.personalNote ? (item.personalPlace ? ' · ' : '') + item.personalNote : ''}
            </Text>
          )}
          {item.checked && (
            <Text style={{ color: '#F5A623', fontSize: 11, marginTop: 4, textAlign: 'right' }}>
              View memory →
            </Text>
          )}
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

          {!item.checked && !ended && listId ? (
            <TouchableOpacity
              style={styles.dareBtn}
              onPress={() => navigation.navigate('Dare', { item, listId })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.dareBtnText}>😈</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
      </View>
    )
  }, [navigation, route.params, listId, ended, handleCheckOff, celebratingId, flashAnim, userLifetimePts, userInsiderTier])

  const headerEl = useMemo(() => (
    <View style={[styles.headerBlock, heroImage && { paddingTop: headerHeight }]}>
      {heroImage ? (
        <ImageBackground
          source={{ uri: heroImage }}
          style={[styles.headerHeroImage, { height: headerHeight + 180 }]}
          imageStyle={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        >
          <LinearGradient
            colors={['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.5)', BG]}
            locations={[0, 0.55, 1]}
            style={[styles.headerHeroGradient, { height: headerHeight + 180 }]}
          />
        </ImageBackground>
      ) : null}
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
    heroImage,
    headerHeight,
    BG,
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
          data={sortedFiltered}
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

      {/* Partner suggestion cards — stacked, slides up from bottom after check-in */}
      {suggestionStack?.length > 0 && (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.suggCard, { transform: [{ translateY: suggAnim }] }]}
        >
          {/* Count badge — only when 3+ cards */}
          {suggestionStack.length >= 3 && (
            <View style={styles.suggCountBadge}>
              <Text style={styles.suggCountText}>{suggestionStack.length} spots nearby</Text>
            </View>
          )}

          <View style={styles.suggStack}>
            {/* Render peek cards behind front card (index 2 first = furthest back) */}
            {suggestionStack.length >= 3 && (() => {
              const peek = suggestionStack[2]
              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => bringToFront(2)}
                  style={[
                    styles.suggInner,
                    styles.suggPeekCard,
                    { transform: [{ translateY: 15 }, { scale: 0.94 }], opacity: 0.85 },
                  ]}
                >
                  <View style={styles.suggTop}>
                    {peek.partners?.photo_url ? (
                      <Image source={{ uri: peek.partners.photo_url }} style={styles.suggImage} />
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggTitle} numberOfLines={1}>
                        {peek.suggestion_title ?? 'Nice one. Want a reward nearby?'}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )
            })()}

            {suggestionStack.length >= 2 && (() => {
              const peek = suggestionStack[1]
              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => bringToFront(1)}
                  style={[
                    styles.suggInner,
                    styles.suggPeekCard,
                    { transform: [{ translateY: 9 }, { scale: 0.96 }], opacity: 0.90 },
                  ]}
                >
                  <View style={styles.suggTop}>
                    {peek.partners?.photo_url ? (
                      <Image source={{ uri: peek.partners.photo_url }} style={styles.suggImage} />
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggTitle} numberOfLines={1}>
                        {peek.suggestion_title ?? 'Nice one. Want a reward nearby?'}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )
            })()}

            {/* Front card (index 0) — fully interactive */}
            {(() => {
              const front = suggestionStack[0]
              const isSecret = !!front.is_secret_partner
              return (
                <Animated.View style={[
                  styles.suggInner,
                  isSecret && styles.suggInnerSecret,
                  { opacity: suggDismissAnim },
                ]}>
                  <View style={styles.suggTop}>
                    {isSecret ? (
                      <View style={styles.suggSecretLockArea}>
                        <Text style={styles.suggSecretLockEmoji}>🔒</Text>
                      </View>
                    ) : front.partners?.photo_url ? (
                      <Image
                        source={{ uri: front.partners.photo_url }}
                        style={styles.suggImage}
                      />
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggTitle}>
                        {front.suggestion_title ?? (isSecret
                          ? 'You unlocked something nearby'
                          : 'Nice one. Want a reward nearby?')}
                      </Text>
                      <Text style={styles.suggBody}>
                        {front.suggestion_body ?? (isSecret
                          ? 'Check off this item to reveal a secret spot.'
                          : 'People who check this off often stop here after.')}
                      </Text>
                      {!isSecret && (front.partners?.business_name || front.partners?.address) && (
                        <Text style={styles.suggPartnerMeta} numberOfLines={1}>
                          {[front.partners?.business_name, front.partners?.address]
                            .filter(Boolean).join(' · ')}
                        </Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.suggButtons}>
                    {isSecret ? (
                      <TouchableOpacity
                        style={front.reveal_item_id ? styles.suggPrimaryBtn : styles.suggPrimaryBtnDisabled}
                        disabled={!front.reveal_item_id}
                        onPress={() => {
                          if (!front.reveal_item_id) return
                          dismissCard(0)
                          navigateToRevealItem(front.reveal_item_id)
                        }}
                      >
                        <Text style={front.reveal_item_id ? styles.suggPrimaryBtnText : styles.suggPrimaryBtnTextDisabled}>
                          {front.reveal_item_id ? 'Reveal the secret' : 'Coming soon'}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={styles.suggPrimaryBtn}
                        onPress={() => {
                          dismissCard(0)
                          navigation.navigate('PartnerPreview', { partner_id: front.partners?.id })
                        }}
                      >
                        <Text style={styles.suggPrimaryBtnText}>View spot</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.suggGhostBtn}
                      onPress={() => dismissCard(0)}
                    >
                      <Text style={styles.suggGhostBtnText}>Maybe later</Text>
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              )
            })()}
          </View>
        </Animated.View>
      )}

      {/* Personalized check-in memory modal */}
      {/* Check-in detail sheet */}
      <Modal
        visible={!!detailModal}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailModal(null)}
      >
        <TouchableOpacity
          style={styles.memoryOverlay}
          activeOpacity={1}
          onPress={() => setDetailModal(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.detailSheet}>
            {detailLoading ? (
              <ActivityIndicator color={AMBER} style={{ marginVertical: 32 }} />
            ) : !detailCI ? (
              <Text style={styles.detailFallback}>Check-in details unavailable.</Text>
            ) : (
              <>
                <Text style={styles.detailTitle} numberOfLines={0}>
                  {detailModal?.item?.body ?? ''}
                </Text>

                <Text style={styles.detailDate}>
                  {detailCI.checked_at ? formatCheckInDate(detailCI.checked_at) : ''}
                </Text>

                {detailCI.photo_url ? (
                  <PhotoWithLoader uri={detailCI.photo_url} style={styles.detailPhoto} />
                ) : null}

                {detailCI.personal_place ? (
                  <Text style={styles.detailPlace}>📍 {detailCI.personal_place}</Text>
                ) : null}

                {detailCI.personal_note ? (
                  <Text style={styles.detailNote}>{detailCI.personal_note}</Text>
                ) : null}

                {!detailCI.personal_place && !detailCI.personal_note ? (
                  <Text style={styles.detailNoMemory}>No memory added for this one.</Text>
                ) : null}

                <TouchableOpacity
                  style={styles.detailEditBtn}
                  onPress={() => {
                    const item = detailModal?.item
                    setDetailModal(null)
                    setMemoryPlace(detailCI.personal_place ?? '')
                    setMemoryNote(detailCI.personal_note ?? '')
                    setMemoryError(null)
                    setMemoryModal({
                      listItemId: item?.listItemId,
                      placeLabel: item?.personalPlaceLabel ?? 'Place or location',
                      noteLabel:  item?.personalPromptLabel ?? 'Any notes?',
                    })
                  }}
                >
                  <Text style={styles.detailEditBtnText}>Edit memory</Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={!!memoryModal}
        transparent
        animationType="slide"
        onRequestClose={() => setMemoryModal(null)}
      >
        <KeyboardAvoidingView
          style={styles.memoryOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setMemoryModal(null)}
          />
          <View style={styles.memorySheet}>
            <Text style={styles.memoryTitle}>Make this yours</Text>
            <Text style={styles.memorySub}>
              Want to add where you did it or what made it memorable?
            </Text>

            <Text style={styles.memoryLabel}>{memoryModal?.placeLabel ?? 'Place or location'}</Text>
            <TextInput
              style={styles.memoryInput}
              placeholder="e.g. The Roosevelt Row location"
              placeholderTextColor="#A0A0AA"
              value={memoryPlace}
              onChangeText={setMemoryPlace}
              returnKeyType="next"
            />

            <Text style={styles.memoryLabel}>{memoryModal?.noteLabel ?? 'Any notes?'}</Text>
            <TextInput
              style={[styles.memoryInput, styles.memoryInputMulti]}
              placeholder="What made it memorable?"
              placeholderTextColor="#A0A0AA"
              value={memoryNote}
              onChangeText={setMemoryNote}
              multiline
              returnKeyType="done"
              blurOnSubmit
            />

            {memoryError ? (
              <Text style={styles.memoryErrorText}>{memoryError}</Text>
            ) : null}

            <TouchableOpacity
              style={styles.memorySaveBtn}
              onPress={saveMemory}
              disabled={memorySaving}
            >
              <Text style={styles.memorySaveBtnText}>
                {memorySaving ? 'Saving…' : 'Save memory'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.memorySkipBtn}
              onPress={() => {
                if ((memoryModal?.difficulty ?? 0) >= 5) {
                  notifyCrewCheckIn({
                    listItemId: memoryModal.listItemId,
                    itemBody:   memoryModal.itemBody   ?? '',
                    difficulty: memoryModal.difficulty ?? 5,
                    checkInId:  null,
                  }).catch(() => {})
                }
                setMemoryModal(null)
              }}
              disabled={memorySaving}
            >
              <Text style={styles.memorySkipBtnText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

function createListStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY, ENDED_BG, ENDED_BORDER, ENDED_TEXT }) {
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

  headerHeroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
  },

  headerHeroGradient: {
    flex: 1,
    height: 220,
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

  rowCardLocked: {
    backgroundColor: '#1A1A2E',
    borderColor: '#F5A623',
    borderWidth: 1.5,
  },

  lockedIconWrap: {
    width: 24,
    marginTop: 2,
    alignItems: 'center',
    flexShrink: 0,
  },

  lockedIcon: {
    fontSize: 18,
  },

  lockedTeaserText: {
    fontSize: 17,
    color: '#F5A623',
    lineHeight: 24,
    fontWeight: '700',
  },

  lockedReqText: {
    fontSize: 11,
    color: '#6F7785',
    marginTop: 6,
    fontWeight: '600',
  },

  tagInsiderDrop: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
  },

  tagInsiderDropText: {
    fontSize: 10,
    color: '#F5A623',
    fontWeight: '800',
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
  // ── Partner suggestion card ──
  suggCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingBottom: 28,
    paddingTop: 4,
  },
  suggStack: {
    position: 'relative',
  },
  suggPeekCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: -1,
  },
  suggCountBadge: {
    alignSelf: 'flex-end',
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6D8C7',
  },
  suggCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6F7785',
  },
  suggInner: {
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 10,
  },
  suggTop: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  suggImage: {
    width: 52,
    height: 52,
    borderRadius: 10,
    flexShrink: 0,
  },
  suggTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 3,
  },
  suggBody: {
    fontSize: 13,
    color: MUTED,
    lineHeight: 18,
    marginBottom: 5,
  },
  suggPartnerMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
  },
  suggButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  suggPrimaryBtn: {
    flex: 1,
    backgroundColor: AMBER,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  suggPrimaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: NAVY,
  },
  suggGhostBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  suggGhostBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: MUTED,
  },

  // ── Secret partner suggestion card ──
  suggInnerSecret: {
    borderColor: '#F5A623',
    borderWidth: 1.5,
  },
  suggSecretLockArea: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#FFF9F2',
    borderWidth: 1,
    borderColor: '#F5A62355',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  suggSecretLockEmoji: {
    fontSize: 22,
  },
  suggPrimaryBtnDisabled: {
    flex: 1,
    backgroundColor: SOFT ?? '#F4F2EE',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  suggPrimaryBtnTextDisabled: {
    fontSize: 14,
    fontWeight: '700',
    color: MUTED,
  },

  // ── Personalized memory modal ──
  memoryOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  memorySheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
  },
  memoryTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 6,
  },
  memorySub: {
    fontSize: 14,
    color: MUTED,
    marginBottom: 20,
    lineHeight: 20,
  },
  memoryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  memoryInput: {
    backgroundColor: BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: TEXT,
    marginBottom: 16,
  },
  memoryInputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  memoryErrorText: {
    fontSize: 13,
    color: '#D85A30',
    marginBottom: 12,
  },
  memorySaveBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  memorySaveBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A1A2E',
  },
  memorySkipBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  memorySkipBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: MUTED,
  },

  // ── Check-in detail sheet ──
  infoBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  infoBtnText: {
    fontSize: 15,
    color: MUTED,
    opacity: 0.6,
  },
  detailSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: '#E6D8C7',
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#243045',
    marginBottom: 6,
    lineHeight: 24,
  },
  detailDate: {
    fontSize: 13,
    color: '#6F7785',
    marginBottom: 16,
  },
  detailPhoto: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    marginBottom: 16,
  },
  detailPlace: {
    fontSize: 15,
    color: '#243045',
    fontWeight: '600',
    marginBottom: 6,
  },
  detailNote: {
    fontSize: 14,
    color: '#6F7785',
    lineHeight: 20,
    marginBottom: 16,
  },
  detailNoMemory: {
    fontSize: 14,
    color: '#6F7785',
    fontStyle: 'italic',
    marginBottom: 16,
  },
  detailFallback: {
    fontSize: 14,
    color: '#6F7785',
    textAlign: 'center',
    marginVertical: 32,
  },
  detailEditBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  detailEditBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F5A623',
  },
 }) // end StyleSheet.create
} // end createListStyles